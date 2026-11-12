# Chatter: one image with the server and the web app.
# Build and start it with:  docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
# Then open http://localhost:3001

# The image runs on these processors: linux/amd64, linux/arm64, and linux/arm/v7 (32-bit Raspberry Pi OS).

# ---- 1. Build the shared package, the web app, and the server ----
# The output is JavaScript and web files, which are the same on each processor.
# So this stage runs on the processor of the build computer, which is much faster than emulation.
FROM --platform=$BUILDPLATFORM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build -w @local-chatter/shared \
 && npm run build -w apps/web \
 && npm run build -w apps/server

# ---- 2. Install only the packages the server needs to run ----
# Native modules must match the processor of the image, so this stage runs on that processor.
# It has the full Debian image, so native modules can build if they must.
FROM node:22-bookworm AS server-packages
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# better-sqlite3 has no ready-made file for 32-bit ARM, so npm builds it from source there.
# That takes some minutes under emulation.
RUN npm ci --omit=dev -w apps/server -w @local-chatter/shared \
 && mkdir -p apps/server/node_modules

# ---- 3. The image that runs ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001 \
    WEB_DIR=/app/apps/web/dist \
    DATABASE_PATH=/app/data/chatter.db \
    LD_LIBRARY_PATH=/app/apps/server/native/focas/linux-x64:/app/apps/server/native/focas/linux-arm
WORKDIR /app

COPY --from=server-packages /app/node_modules node_modules
COPY --from=server-packages /app/apps/server/node_modules apps/server/node_modules
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
# Your own FANUC FOCAS2 files, if you added them (see docs/guide/fanuc.md)
COPY apps/server/native apps/server/native
COPY --from=build /app/apps/web/dist apps/web/dist

# The database lives in /app/data. Docker keeps it in a volume, so it survives updates.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data

# ChatterBox writes the vmalert file of the alert rules here, and vmalert reads it from the same volume.
# The empty file is there so vmalert finds a file before ChatterBox first starts.
RUN mkdir -p /app/alert-rules && printf 'groups: []\n' > /app/alert-rules/rules.yml && chown -R node:node /app/alert-rules

# The version of this image: "1.2.0" from a release tag, "edge-<commit>" from main.
# It is here, at the end of the last stage, so a new version does not rebuild the stages above.
ARG CHATTER_VERSION=development
ENV CHATTER_VERSION=$CHATTER_VERSION

# Do not run as root
USER node
WORKDIR /app/apps/server
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/index.js"]

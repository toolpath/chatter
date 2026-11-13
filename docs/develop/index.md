# Run from source

## Prerequisites

- Node.js 22 or newer (the database library, better-sqlite3 13, needs it)
- npm
- Docker, for the machine history in development (optional)

## Folders

| Folder | What it holds |
| --- | --- |
| `apps/server` | The server and the API (Hono, Node.js) |
| `apps/web` | The web app (React, Vite) |
| `packages/shared` | The types and rules that the server and the web app share |
| `tools/fake-machines` | Fake CNC machines for tests (see [Fake machines](./fake-machines.md)) |
| `tools/fake-notify` | A fake Twilio and webhook receiver for the notifications (see [Fake notifications](./fake-machines.md#fake-notifications)) |
| `tools/pi-image` | The Raspberry Pi card image (see [Pi card image](./pi-image.md)) |
| `tools/release` | The scripts that make the release files |
| `docs` | These docs |

## Run in development mode

```bash
npm install
npm run dev:history   # VictoriaMetrics and vmalert in Docker, on localhost only
npm run dev
```

This starts:
- **VictoriaMetrics** on http://localhost:8428 and **vmalert** (`docker-compose.dev.yml`). Stop them with `docker compose -f docker-compose.dev.yml down`. Without them, Chatter still runs, but it cannot save or show the machine history.
- **Server** on http://localhost:3001
- **Web app** on http://localhost:3000 (it sends `/api` on to the server)

vmalert sends its alerts to the server on port 3002. The server tells vmalert to read the alert rules again on http://localhost:8880.
`npm run dev:history` makes `apps/server/data/alert-rules/`. The server writes the alert rules there, and vmalert reads them from there.
If you start `docker-compose.dev.yml` yourself, run `mkdir -p apps/server/data/alert-rules` first. Else Docker can make the folder for the root user, and the server cannot write to it.
On Linux, set `ALERT_HOST=0.0.0.0` in `apps/server/.env`, because Docker cannot reach `127.0.0.1` of the computer. Then use a firewall rule, so that other computers cannot reach port 3002 (it has no login).

To test without real machines, run the fake machines in another terminal: `npm run fake-machines` (see [Fake machines](./fake-machines.md)).
To test Chatter on a Pi with the fake machines, use `npm run fake-machines -- --lan`. Then the Pi can find them on your local network. Their FTP servers take any password, so read [On the local network](./fake-machines.md#on-the-local-network) first.

For FANUC machines, see [FANUC machines](../guide/fanuc.md).

## Build the Docker image yourself

To run your own code changes in Docker, build the image in your copy of this repo:
```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Server settings

The server reads these environment variables. Each one is optional.
To keep them, copy `apps/server/.env.example` to `apps/server/.env`.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3001` | The port of the server and the API |
| `DATABASE_PATH` | `data/chatter.db` | The SQLite database. The path starts in the folder where the server runs (`apps/server` with `npm run dev`). |
| `WEB_DIR` | not set | The built web app. When it is set, the server also serves the web app. |
| `VICTORIA_METRICS_URL` | `http://localhost:8428` | Where the server saves the machine history |
| `ALERT_PORT` | `3002` | The port that gets the alerts from vmalert |
| `ALERT_HOST` | `127.0.0.1` | The address of the alert port (see [Security](../security.md)) |
| `ALERT_RULES_DIR` | `data/alert-rules` (next to the database) | The folder where the server writes the vmalert rules file. vmalert must read the same folder. |
| `VMALERT_URL` | `http://localhost:8880` | Where the server tells vmalert to read the rules again |
| `TRUST_PROXY` | not set | The reverse proxy addresses to trust (see [HTTPS and proxy](../guide/https.md)) |
| `TWILIO_API_URL` | `https://api.twilio.com` | For development only: the address of a fake Twilio (see [Fake notifications](./fake-machines.md#fake-notifications)). Chatter sends the auth token there, so it takes only `https://`, or `http://` on this computer (`127.0.0.1`, `localhost`) |

The Docker image sets `CHATTER_VERSION`, the version that the app shows.
Two more variables are for the updates, and you do not usually set them:
`CHATTER_UPDATE_FOLDER` (the folder that the Pi card mounts, when it is not set) and
`CHATTER_RELEASES_REPO` (the GitHub repo to check for releases, for a fork; it must look like `owner/repo`, or Chatter does not start).
You do not need them with `npm run dev`.

## Testing

```bash
npm test                # all tests: web app, server, and fake machines
npm run test:client     # web app tests only
npm run test:server     # server tests only
npm run test:tools      # fake machine tests only
npm run typecheck       # check the TypeScript types in all parts
```

## Production build

```bash
# macOS and Linux
npm run build
WEB_DIR=../web/dist npm run start -w apps/server
```

This builds the shared package, the web app (`apps/web/dist/`), and the server (`apps/server/dist/`).
With `WEB_DIR` set, the server also serves the web app. The Docker image does this for you.

To remove the admin accounts outside Docker: `npm run reset-password -w apps/server` (or `reset-password:dev` without a build).
The users who are not admins stay. The next person who opens Chatter makes a new admin account.

## Work on these docs

The docs are in `docs/`. They are Markdown files, and [VitePress](https://vitepress.dev/) makes them into a website.
The docs have their own packages. Install them one time, then start the site on your computer:

```bash
npm install --prefix docs
npm run docs:dev
```

Then open the address that it prints. The menu on the left is in `docs/.vitepress/config.mts`. When you add a page, add it there too.
`npm run docs:build` makes the site, and stops on a link to a page that does not exist.
When a change to `docs/` goes into `main`, GitHub puts the new site on GitHub Pages (`.github/workflows/docs.yml`).

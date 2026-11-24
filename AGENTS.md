# Agent guide for Chatter

Chatter watches CNC machines on a shop network. It runs on a Raspberry Pi card or in Docker on a computer.
For the folders and how to run it, read [docs/develop/index.md](docs/develop/index.md). To test without real machines, use the [fake machines](docs/develop/fake-machines.md).

## Checks

Run these from the repo root before you say a change is done:

```bash
npm run build:shared   # after each pull, and after each change in packages/shared
npm run typecheck
npm run lint
npm test
```

- The web app and the server import `packages/shared` from its `dist` folder. A stale `dist` gives "missing export" errors in the typecheck and the tests, and `npm run build:shared` fixes them.
- In a workspace, run the tests once with `npm run test:run -w apps/server` (or `apps/web`). The `test` script of a workspace starts vitest in watch mode, which does not stop.
- `npm test` also runs `test:tools`, the tests of `tools/fake-machines`, `tools/fake-notify`, `tools/quality`, `tools/guardrails` and `tools/loc`. These folders are not workspaces, so the workspace commands skip them.
- To find code with no test, run `npm run coverage`, then `npm run coverage:changed`. Coverage is a signal, not a gate.
- The CI fails when a pull request adds copied code. Run `npm run dup:new` to see the copies. `npm run dead` lists unused code, as a signal only.
- `npm run loc` prints the lines of code, tests, and docs and comments that the commits of the branch add and remove (add `-- --base <ref>` for a stack). The skill `/chatter-pr-description` ([.agents/skills/chatter-pr-description/SKILL.md](.agents/skills/chatter-pr-description/SKILL.md)) puts this table at the top of the pull request description. It is a signal, not a gate.
- `docs/` is its own npm package. Run `npm --prefix docs ci` once, then `npm run docs:build`. The build fails on a dead link.

## How we work

- To add a machine type (a new control or protocol), first read [.agents/skills/add-machine-type/SKILL.md](.agents/skills/add-machine-type/SKILL.md).
- To add a notification service (a new channel type), first read [.agents/skills/add-notification-channel/SKILL.md](.agents/skills/add-notification-channel/SKILL.md).
- Before a pull request, review the change with the skills `/chatter-review-code` ([.agents/skills/chatter-review-code/SKILL.md](.agents/skills/chatter-review-code/SKILL.md)) and `/chatter-review-testing` ([.agents/skills/chatter-review-testing/SKILL.md](.agents/skills/chatter-review-testing/SKILL.md)). Both use `npm run quality`, which runs all the checks for the branch and prints one table.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md): test first, and one kind of change in each commit. Start each commit message with a prefix such as `feat(web):`, `fix(server):`, `docs:` or `ci:`.
- Do not add AI attribution. A commit message has no `Co-Authored-By` line, and a pull request has no "Generated with" line. `.claude/settings.json` turns off these lines in Claude Code.
- Write docs and screen text in ASD-STE100 Simplified Technical English: short sentences, active voice, one idea in each sentence.
- Server logging: use `createLogger('component')` from `apps/server/src/logging/logger.ts`. In tests, read the log with `captureLog()` from `logging/testSupport.ts`.
- Web colors: text uses `text-primary-text`, so it is easy to read in light mode. Fills and borders use `primary`.

## Guardrails

- **FANUC files:** the FANUC FOCAS2 library belongs to FANUC. Each user uploads it in **Settings > FANUC library**. Keep its files (`Fwlib*.dll`, `libfwlib32*.so*`) out of the repo and out of each image that we publish. `.gitignore` keeps `apps/server/native/focas/` out of git. A Docker image that a user builds on their own computer copies that folder on purpose (see [docs/guide/fanuc.md](docs/guide/fanuc.md)), so publish only the images that the Actions build from a clean checkout.
- **Pi memory:** a Pi can have 512 MB of RAM. Stream uploads and downloads to disk, as `apps/server/src/updates/streamToFile.ts` does.
- **Update helper:** on the Pi, Chatter only writes a request file. The helper outside Docker installs only a signed, newer update and trusts nothing from Chatter. Keep that boundary (see [docs/security.md](docs/security.md#updates-on-the-pi-card)).
- **User data:** Docker Compose takes the project name from the folder name `chatter` (`tools/release/make-docker-package.sh` zips that folder, and the Pi uses `/opt/chatter`). So the volumes are `chatter_chatterbox-data` and `chatter_victoriametrics-data`. Keep the folder name and the volume names in `docker-compose.yml`, or an update cannot find the user's data.
- **Doc links in released apps:** older app versions link to `guide/update#back-up` and `guide/manage`. Keep these pages and anchors.
- **History restore:** keep `-dedup.minScrapeInterval=1ms` for VictoriaMetrics in `docker-compose.yml`. Without it, a second restore of a machine history doubles its samples.
- **Closed ports:** VictoriaMetrics, vmalert and the alert port 3002 have no login. Keep them unpublished in `docker-compose.yml`. Keep VictoriaMetrics and vmalert only on the internal network `history`, with `internal: true`.

The tests in `tools/guardrails` check some of these rules. If one fails, fix the change, not the test.

For the full list of known security limits, read [docs/security.md](docs/security.md).

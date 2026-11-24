# Guardrail tests

Tests that keep the guardrails in [AGENTS.md](../../AGENTS.md#guardrails):

- No FANUC FOCAS2 files are in git.
- `docker-compose.yml` keeps the volume names, and the folder name `chatter` stays in the Docker package and on the Pi card.
- `docker-compose.yml` and `docker-compose.dev.yml` keep the deduplication of VictoriaMetrics, so a second history restore does not double the samples.
- `docker-compose.yml` keeps the facts that the docs quote: the container name `chatterbox` (for `docker logs chatterbox`) and the port of Chatter: `"3001:3001"` when `CHATTER_BIND_ADDRESS` is not set (so Docker publishes it on all IPv4 and IPv6 addresses), and `"<address>:3001:3001"` when it is set (the docs tell users to set it in a `.env` file). To change one, change the docs in the same change.
- No compose file opens VictoriaMetrics, vmalert or the alert port 3002 to the network. The test reads the variables of a port (`$NAME`, `${NAME}`, `${NAME:-word}`, `${NAME-word}`, `${NAME:+word}`, `${NAME+word}`), and a variable can set only the host address: the host port and the container port (the last two `:` parts, with the protocol) must be plain text in the file. The test reads each port with the variables not set, empty, and set to a network address or to a hostile value (for example `0.0.0.0:8428:8428` or `1.2.3.4/udp`), one variable at a time and all together. Then no port opens a different container port, and no port opens 8428, 8880 or 3002 to the network. Docker Compose also refuses a host address that is not an IP address. A different variable form makes the test fail.
- VictoriaMetrics and vmalert stay only on the internal network `history` of `docker-compose.yml`, which keeps `internal: true`. Only `chatterbox` is also on `default`. A compose file that Docker Compose merges with `docker-compose.yml` adds no network.
- Each service of `docker-compose.yml` drops all Linux capabilities (`cap_drop: [ALL]`), gets none back (no `cap_add`, no `privileged`), has only `no-new-privileges:true` in `security_opt`, and has a `pids_limit` from 64 to 1024. No service gets access to the computer (`pid`, `ipc`, `userns_mode`, `cgroup`, `devices`, `device_cgroup_rules`, `sysctls`, `deploy`), and `chatterbox` sets no `user`. No compose file mounts the Docker socket. A compose file that Docker Compose merges with `docker-compose.yml` changes none of these settings and no `user`. The tests merge a YAML merge key (`<<:`), as Docker Compose does. The test of the compose files fails on a new compose file (also `compose.yaml`), so that a person adds it to the right list.
- The update helper on the Pi (`STEPS` in `update-chatter.sh`) and Chatter (`UPDATE_STEPS` in `packages/shared`) have the same steps, in the same order.
- Each docs link in the app goes to a page and a heading that exist. The links of released apps (`guide/update#back-up` and `guide/manage`) always stay.
- Each link in the docs to a heading (`./page.md#heading` or `#heading`) goes to a heading that exists, with the anchor that VitePress makes (or a `{#id}`). `npm run docs:build` does not check these links. The check reads inline links and reference definitions (`[label]: ./page.md#heading`) in the `.md` files. It does not read these links:
  - HTML links (`<a href="...">`).
  - Links in the frontmatter, for example the buttons of the home page.
  - Links in `.vue` files and in `docs/.vitepress/config.mts` (the menu and the sidebar).
  - A link or a reference definition on more than one line, and a target with spaces or parentheses.

  The check does not read HTML or entities (such as `&amp;`) in a heading, or a heading with a line of `===` or `---` under it. Then the check can report a link to that heading as dead. Give such a heading a `{#id}`.
- Each workflow gives only read permissions at the top. A job that must write gets its permissions in its own block. Only the jobs in the allow-list of the test can write, and each one gets exactly the write scopes of its entry. No job gets `write-all`. To give a job write permissions, add it to the allow-list in the same change.
- Each job that writes in the Pi card, the image cleanup and the moving image tags runs only from main or a release tag.
- Each workflow pins each action by a full commit, with the version in a comment. A local action (`./`) is not pinned.
- Only the sign job in `docker.yml` gets the update signing key and the `release` environment. It runs after the publish job, runs no action except the checkout, and gets only `contents: write` and `packages: read`. No job gets all the secrets (`secrets: inherit` or `toJSON(secrets)`), and no workflow reads a secret by a computed name (`secrets[...]`).
- The publish job and the sign job run `tools/release/check-tag-on-main.sh` before they publish or sign. The script stops the job when the tag is not on main.
- A workflow step runs each shell test of the Pi card (`tools/pi-image/test/*.test.sh`) and of the release scripts (`tools/release/test/*.test.sh`). `npm test` does not run them.
- The built web app (`apps/web/dist`) obeys the Content-Security-Policy of the server: no script in the page, no event attribute (such as `onload`), no `eval(` or `new Function(` in the scripts, and no `@import` or `url()` to another site in the styles. The CI `build` job runs `npm run check:web-dist` after `npm run build`. `npm test` runs only the tests of this check.

`npm test` runs them (through `npm run test:tools`). If one fails, fix the change, not the test.

# Security

## Report a security problem

Do not open a public issue for a security problem. Other people can read it before a fix is ready.

Report it in private on GitHub:
1. Open the **Security** tab of this repo.
2. Click **Report a vulnerability**.
3. Fill in the form.

Tell us:
- What the problem is, and what an attacker can do with it
- The steps to make it happen
- The Chatter version (the commit or the release)
- How you run Chatter (the Pi card, Docker, or Node.js, and the operating system)

## Supported versions

We fix security problems only in the newest version. To get a fix, update to the newest version (see [Update Chatter](docs/guide/update.md)).

## How Chatter is made to be used

Chatter is made for a **shop network that you trust**, behind a firewall. Do not make it open to the internet.

For the known limits, the update helper rules, and how to keep `chatter.db` and VictoriaMetrics private, read [docs/security.md](docs/security.md).

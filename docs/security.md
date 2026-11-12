# Security

## Report a security problem

Do not open a public issue for a security problem. Other people can read it before a fix is ready.
Open the **Security** tab of the repo, click **Report a vulnerability**, and fill in the form. Tell us:
- What the problem is, and what an attacker can do with it
- The steps to make it happen
- The Chatter version
- How you run Chatter (the Pi card or Docker, and the operating system)

We fix security problems only in the newest version. To get a fix, [update Chatter](./guide/update.md).

## How Chatter is made to be used

Chatter is made for a **shop network that you trust**, behind a firewall. Do not make it open to the internet.

These limits are known. They are not bugs, but you must know them:

- **Every computer on the network can open Chatter** on port 3001. Use a firewall rule if only some computers must reach it.
- **No HTTPS by itself.** Other people on the network can read the login cookie, and the password that a program sends. To use HTTPS, put a reverse proxy in front of Chatter (see [Use HTTPS](./guide/https.md)).
- **Trust only the address of your proxy** in **Settings > HTTPS and proxy**, or with `TRUST_PROXY`. A wrong address lets a computer hide its real address, and so get around the 15 minute wait after 10 wrong passwords. An Admin can end the wait for a computer in **Settings > Logins**.
- **FTP is not encrypted.** The FTP username, the FTP password, and the files go over the network as plain text.
- **The machines have no login on their data ports** (Brother, Haas, MTConnect, FANUC). Anyone on the network can read the machine data from those ports. A Siemens control has a login only if you set one up for OPC UA (see [Siemens machines](./guide/siemens.md)).
- **A login lasts 1 year.** Log out stops the login of that browser, also a copy of its cookie. To stop your other logins, use **Log out all other browsers** in **Settings > Your account**, or change your password. To log out a different user, an Admin sets a new password for that user.
- **Give each person their own account, with the smallest role that they need.** A Viewer can only look, and change their own password. An Operator can also send and delete files. An Admin can do everything.
- **The first visit sets up the first Admin.** Until an Admin exists, the first person who opens Chatter can make the Admin account. So set it up at once after you install.
- **Anyone on the network can see the Chatter version** at `/api/health`, with no login. The update helper needs it.
- **Chatter asks GitHub once a day for the newest version.** It sends no machine data. To stop this, turn off **Check for updates on GitHub** in **Settings > Updates**.
- **Chatter runs the FANUC FOCAS2 library as program code.** In **Settings > FANUC library**, upload only the files that you got from FANUC.

## Updates on the Pi card

Chatter itself cannot install an update. It only puts the update file and a request in a folder. A helper on the Pi, outside Docker, does the install.

- The helper installs only a file that is signed with the Chatter release key, and only a newer version. So a bad download or a bad upload cannot install.
- The helper does not trust anything that Chatter says or puts in the folder. So an attacker who breaks into Chatter cannot use the helper to take control of the Pi.

## Keep `chatter.db` private

`chatter.db` is the database file. With Docker, it is in the volume `chatterbox-data`. It holds:

- The FTP passwords of the machines and the OPC UA passwords of Siemens machines, as plain text, because Chatter must send them to the machines.
- The usernames and roles. Each password is kept only as a hash (a one-way code, so nobody can read the password back from it).
- The logged-in browsers and the last 50 password tries, with their addresses. A login cookie is kept only as a hash, so the file cannot be used to log in.

The folder `opcua-pki` next to `chatter.db` holds the private key of the Chatter certificate for Siemens machines.

Do not share these files. Keep their backups private, and also the backups of the machine history (the volume `victoriametrics-data`).

## Keep VictoriaMetrics and vmalert closed

VictoriaMetrics (the machine history database) and vmalert have no login. Anyone who reaches them can read and delete the machine history. Chatter's alert port 3002 has no login either: anyone who reaches it can add false alerts.

- `docker-compose.yml` does not publish these ports, so only Chatter can reach them. Do not add a `ports:` line for `victoriametrics` or `vmalert`, or for port 3002 of `chatterbox`.
- Without Docker, Chatter listens on port 3002 only on `127.0.0.1`. Change `ALERT_HOST` only to an address that other computers cannot reach.

Only an Admin can change the alert rules. A custom alert query can only read the machine history. It cannot change or delete data.

## Forgot a password

An Admin sets a new one in **Settings > Users and roles**, with **Reset password**.

If no Admin knows their password, run this in the Chatter folder, then open Chatter and make a new Admin account at once:
```bash
docker compose exec chatterbox npm run reset-password
```
On the Raspberry Pi card, first run `cd /opt/chatter`, and put `sudo` before `docker`.

This removes the Admin accounts and logs out every browser. The Viewer and Operator accounts, your machines, and the upload history stay.

## Not in scope

- Problems in the machine controls, or in their own protocols
- Problems in the FANUC FOCAS2 library (report them to FANUC)
- Attacks that need access to the computer that runs Chatter, or to `chatter.db`

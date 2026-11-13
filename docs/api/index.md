# API overview

Chatter has an HTTP API. The web app uses it, and your own programs can use it too.
Each endpoint starts with `/api`. The default port is `3001`.

## Login

Every endpoint needs a Chatter login, except `/api/health` and `/api/auth/*`.
The web app logs in with a cookie. A program sends the username and password with each request (HTTP Basic):

```bash
curl -u <username>:<password> http://localhost:3001/api/machines
```

A request with no login, or a wrong login, gets `401`.
After 10 wrong passwords from one address, that address must wait 15 minutes. During that wait, a password try gets `429`.
Browsers that are logged in, and programs whose login worked before, keep working during that wait.
**Log out** stops the login of that browser only. To log out your other browsers, use **Log out all other browsers** in **Settings > Your account**, or change your password.

## Roles

Each user that is logged in can see the machines, their history, and the alerts, and can download files.
Some endpoints also need a role. A role that cannot do the action gets `403`:
- Sending and deleting files needs **Operator** or **Admin**.
- Adding, changing, or removing machines, the network scan, the MTConnect port scan, `/api/focas/*`, `/api/settings/*`, and `/api/updates/*` need **Admin**.

## Errors

An error reply has the form `{ "error": "<the reason>" }`.
- `400`: a bad request body, query, or path value.
- `404`: the machine (or other item) does not exist.
- `500`: an error in Chatter, or on the machine.

## The endpoints

- [Login and settings](./auth-and-settings.md): log in, log out, users, proxies, and login tries
- [Machines and files](./machines.md): the machine status, the machine list, the network scan, the program files, and the upload history
- [History and alerts](./history.md): values over time, periods, reports, and alerts
- [Notifications](./notifications.md): the channels that get the alert messages, the message list, and the message settings
- [FANUC library and updates](./admin.md): the FOCAS2 file, and updates on the Pi card
- [Live events](./live-events.md): live machine status with server-sent events

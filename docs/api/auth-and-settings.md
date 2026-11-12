# Login and settings

## Login

These endpoints need no login first.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/status` | `{ setupNeeded, loggedIn, user }`. `user` is `{ username, role }`, or `null`. Only a browser login counts here |
| POST | `/api/auth/setup` | Make the first Admin: `{ "username": "...", "password": "..." }`. Sets the session cookie. `409` when an Admin exists already |
| POST | `/api/auth/login` | Log in: `{ "username": "...", "password": "..." }`. Sets the session cookie. `401` for a wrong username or password, `429` during the 15-minute wait |
| POST | `/api/auth/logout` | Stop this browser's session and remove the cookie |
| POST | `/api/auth/password` | Change your password (browser login only): `{ "currentPassword": "...", "newPassword": "..." }`. Logs out your other browsers. `401` for a wrong current password |
| GET | `/api/auth/sessions` | The browsers where you are logged in (browser login only): `{ sessions: [{ device, address, createdAt, lastSeenAt, isThisBrowser }] }` |
| POST | `/api/auth/sessions/log-out-others` | Log out each of your browsers except this one (browser login only). The reply is the new list of sessions |

The rules for a username and a password:
- Username: 1 to 64 characters, with no colon (`:`).
- New password: 8 to 200 characters.

## Settings (Admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings/users` | The users: `{ users: [{ id, username, role, createdAt, lastLoginAt, isYou }] }` |
| POST | `/api/settings/users` | Add a user: `{ "username": "...", "password": "...", "role": "viewer" }` (role: `viewer`, `operator`, or `admin`). `409` when the username exists already |
| PUT | `/api/settings/users/:id/role` | Change the role of a user: `{ "role": "operator" }`. `409` when it would remove the last Admin |
| PUT | `/api/settings/users/:id/password` | Set a new password for a user: `{ "password": "..." }`. Logs out each browser of that user |
| DELETE | `/api/settings/users/:id` | Remove a user, and log out each of their browsers |
| GET | `/api/settings/proxy` | The trusted reverse proxies, the computers that sent proxy headers, and how this request came |
| PUT | `/api/settings/proxy` | Trust these proxies (at most 20): `{ "addresses": ["172.18.0.1"] }`. `400` for a bad address, `409` when `TRUST_PROXY` is set |
| GET | `/api/settings/logins` | The last 50 password tries, and the computers that must wait after 10 wrong passwords |
| POST | `/api/settings/logins/unlock` | Let a computer try again now: `{ "address": "192.168.1.44" }` |

Each user endpoint replies with the new list of users. A user that does not exist gets `404`.
You cannot change your own role, set your own password, or remove yourself here (`400`). To change your own password, use `/api/auth/password`.

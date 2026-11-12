# FANUC library and updates

These endpoints are for an **Admin** only.

## FANUC library

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/focas/status` | `{ fileName, problem, source, sha256, restartNeeded }`: the file name that this computer needs, and the file that Chatter uses (`source`: `uploaded`, `bundled`, or `null`) |
| POST | `/api/focas/library` | Upload the library: a form with the field `file` (at most 20 MB). `400` when the file is not for this computer, or does not load. `413` when the file is too large |
| DELETE | `/api/focas/library` | Remove the uploaded library |

`bundled` means a file that you copied into `apps/server/native/focas/`, when you run Chatter from source. `null` means that Chatter has no library.
After Chatter has loaded a library, a replace or a remove gives `restartNeeded: true`. Restart Chatter to use the change.
For more about the library, see [FANUC machines](../guide/fanuc.md).

## Updates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/updates/status` | The version, whether the update helper is there, the last check or install, the free space, and the newest version on GitHub |
| POST | `/api/updates/file` | Upload an update file as the raw body (`Content-Type: application/octet-stream`, with `Content-Length`). At most 600 MiB. `415` with another type, `411` without a length, `413` when too large, `408` when the file stops coming in for 60 seconds, `507` when the card has too little free space, `409` while another file comes in or the helper works |
| POST | `/api/updates/download` | Download the update file of the newest GitHub release in the background. `/api/updates/status` shows when it is done, or why it failed. `507` when the card has too little free space |
| POST | `/api/updates/check` | Ask the update helper to check the update file |
| POST | `/api/updates/install` | Ask the update helper to install the checked update file. Chatter stops during the install |
| PUT | `/api/updates/settings` | Turn the daily check on GitHub on or off: `{ "checkGitHub": false }` |

A refused request gets `409` with `{ "error": "<the reason>" }`, for example on a computer without the update helper, or in a development build. To check the releases of a fork, set `CHATTER_RELEASES_REPO` (for example `my-org/chatter`) in the environment of the Chatter container.
For how updates work, see [Update Chatter](../guide/update.md) and [Updates on the Pi card](../security.md#updates-on-the-pi-card).

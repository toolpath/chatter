# Notifications

These endpoints are for an **Admin** only. Another role gets `403`.
For what notifications do, see [Notifications](../guide/notifications.md).

The server never sends a secret value back, such as the Twilio auth token or the webhook secret.
`hasSecret` tells which secrets have a saved value, for example `{ "authToken": true }`.

## Channel types

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notification-types` | The channel types that this Chatter knows, with the fields of their form |

Each type is `{ id, name, fields, note? }`. Each field is `{ key, label, kind, required, hint?, mono? }`.
`kind` is `text`, `secret`, `url`, or `phone-list`. The value of a `phone-list` field is a list of phone numbers. The value of each other field is one text.
Version 1 has the types `twilio-sms` and `webhook`.

## Channels

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notification-channels` | The channels |
| POST | `/api/notification-channels` | Add a channel. `201` with the channel |
| PUT | `/api/notification-channels/:id` | Change a channel. `404` when it is not there |
| DELETE | `/api/notification-channels/:id` | Delete a channel and its waiting messages. Its sent and failed messages stay. `204`, or `404` when it is not there |
| POST | `/api/notification-channels/test` | Send a test message with a form that is not saved |
| POST | `/api/notification-channels/:id/test` | Send a test message with the form of a saved channel. The result goes in the message list. `404` when the channel is not there |

A channel is `{ id, type, name, settings, hasSecret, minSeverity, machineIds, enabled, createdAt }`. `settings` has the values that are not secret.

The body of POST, PUT, and the tests is a form:

```json
{
  "type": "twilio-sms",
  "name": "Shop phones",
  "values": {
    "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "authToken": "",
    "from": "+15551230000",
    "to": ["+15559870001", "+15559870002"]
  },
  "minSeverity": "critical",
  "machineIds": null,
  "enabled": true
}
```

- `values` has a value for each field of the type, also the secret fields.
- On PUT and on the test of a saved channel, an empty secret keeps the saved secret.
- `clearSecrets` (optional, on PUT and on the test of a saved channel) is a list of secret keys to delete, for example `["secret"]` to stop sending a webhook secret.
- `minSeverity` is `warning` (warning and critical alerts) or `critical` (only critical alerts).
- `machineIds` is `null` for all machines, also the machines that you add later, or a list of machine ids.

On POST and PUT, a wrong form gets `400` with `{ "error": "<the problem in plain words>" }`. A body larger than 64 KB gets `413`.

A test sends a real message at once, and gives `{ "ok": true, "detail": "Sent to 2 phones" }` or `{ "ok": false, "error": "<the reason>" }`.
A test of a form with a wrong value, for example a wrong phone number, gets `200` with `ok: false`. Only a body with a missing or wrong part, for example no `minSeverity`, gets `400`.

## Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notification-messages` | The messages of the last 30 days, the newest first. Chatter keeps at most 1000. `?channel=<id>` gives the messages of one channel |

Each message is `{ id, channelId, alertId, kind, machineId, severity, text, status, attempts, lastError, detail, createdAt, sentAt }`.

- `kind` is `started`, `ended`, `combined` (started and ended), `more` (an "And N more alerts" message), or `test`.
- `status` is `waiting`, `sent`, `failed`, or `grouped` (the alert went in a `more` message).
- `lastError` is the reason of the last failed try. `detail` is the answer of the service when it took the message.

## Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notification-settings` | `{ linkBaseUrl, timeZone }` |
| PUT | `/api/notification-settings` | Save them, and get the saved settings back. Empty text or `null` means not set. A wrong value gets `400` |

- `linkBaseUrl`: the address that people use to open Chatter, for example `http://chatter.local:3001`. It must start with `http://` or `https://`, with no user name or password. With `null`, the messages have no link.
- `timeZone`: a time zone name, for example `America/Chicago`. With `null`, the times in the messages are in UTC.

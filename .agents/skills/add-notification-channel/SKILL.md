---
name: add-notification-channel
description: Adds a new notification service to Chatter (a new channel type, for example Microsoft Teams, Pushover or Telegram), from the server file to its tests and the docs. Use when the user wants Chatter to send alert messages to a service that it does not support yet.
---

# Add a notification channel type

A channel type is **one server file, its test, one line, and the docs**. The web app makes the form from the fields of the type, so a new service needs no web code. Your **template** is `apps/server/src/notifications/channels/webhook.ts` and its test. `twilio.ts` is the template for a service with an API error format and a list of phone numbers.

## 1. Know the service first

Before you write code, write down for the user:
- The endpoint, the login (token, key, or address with a key in it), and the success status.
- The error answers: which mean "wrong settings" (do not try again) and which mean "busy or down" (try again). Use the service's own docs.
- Any rule that stops the first message, for example a sender that the service must verify first. That rule goes in `note`.
- The inputs of the form. Each must fit one of `CHANNEL_FIELD_KINDS` (`packages/shared/src/notifications.ts`): `text`, `secret`, `url`, `phone-list`. When an input fits none, stop and ask the user: a new kind needs web code in `apps/web/src/pages/settings/ChannelFields.tsx` and `channelFormState.ts`.
- The **license** of each library. Chatter is MIT. Prefer plain `fetch` to an SDK: the Pi has 512 MB of RAM.

Done when the user agrees with the list.

## 2. Write the type, test first

Write `channels/<service>.test.ts` before the code (see CONTRIBUTING.md). Copy the `fakeFetch` helper of `webhook.test.ts`, so no test sends a real message. Then write `channels/<service>.ts` with one `ChannelDefinition` (`channels/ChannelType.ts`):

- **`id`** is fixed forever: saved channels keep it in `chatter.db`. Use kebab-case, for example `pushover`.
- **`fields`** are the inputs of the form, in order. Give each token, key, or password `kind: 'secret'`: `ChannelStore` keeps secret fields out of each answer to the browser, and an empty secret box keeps the saved value. Give `hint` a plain line that tells where in the service to find the value.
- **`settings`** is a zod schema of the values, also the secret values. Its messages are for the shop admin, in plain words, and the form shows the first one.
- **`send(settings, message, { fetch, signal })`** sends one `OutgoingMessage`. Use `message.text` when the service shows one line. Pass `signal` to `fetch`, and use the `fetch` of the context. The signal stops the request after 10 seconds (`SEND_TIMEOUT_MS` in `OutboxSender.ts`).
- **Results:** return `{ ok: true, detail }` with a short fact, for example "Sent to 2 phones". Return `{ ok: false, retry, error }` with `retry: true` for 408, 429, 5xx and network failures, and `retry: false` for each answer where a new try fails too. For a thrown `fetch`, return `networkFailure(error, '<the service>')`. `OutboxSender` tries again with longer waits, for at most 24 hours.
- **Partial sends:** when the service sends to a list and only some got the message, return `retry: false`, so no one gets it two times. `twilio.ts` does this for its phones.
- **Secrets stay out of text:** each `error` and `detail` goes in the message list, so it never has the token, the key, or a web address with a key in it.

Done when the tests cover:
- the fields
- each settings problem
- the request: address, method, headers, body
- success
- each error class, with its `retry`
- a network failure

## 3. Add it to Chatter

1. Add one line to `CHANNEL_TYPES` in `channels/index.ts`, after the types that are there. Update the order test in `channels/index.test.ts`.
2. Docs, in ASD-STE100 Simplified Technical English:
   - `docs/guide/notifications.md`: a section with the steps in the service, the boxes in Chatter, and its rows in the **Check** table.
   - `docs/api/notifications.md`: the new `id` in the sentence that lists the types, under **Channel types**.
   - `docs/security.md`: the new secret in the list of plain-text values in `chatter.db`, and the service that gets the alert text.
   - `README.md`: the service in the **Notifications** line.

## Done

- `npm run build:shared`, `npm run typecheck`, `npm test` and `npm run docs:build` pass.
- With `npm run dev`, **Settings > Notifications > Add channel** shows the new type, and its form has each field.
- When the user has an account on the service, **Send test** gets a real message to them. Otherwise, the docs say "not tested with a real account yet". `tools/fake-notify` fakes only Twilio and plain webhooks, so a new service needs no fake.

# Notifications

Chatter can send a message when a machine alert starts and when it ends.
The message goes to a **channel**: the phones of the shop as text messages (Twilio), or a web address (a webhook), for example Slack, ntfy, or Home Assistant.

You set up the channels in **Settings > Notifications**. Only an **Admin** can see this tab.
To make the alerts themselves, see [Alerts](./alerts.md).

## What a message says

| When | Example |
| --- | --- |
| An alert starts | `CRITICAL - Haas VF-2: Spindle load above 80%. Spindle load is 92%. Started 9:02 AM.` |
| The alert ends | `OK - Haas VF-2: Spindle load above 80% ended at 9:40 AM.` |
| The alert started and ended before Chatter could send the first message | `CRITICAL - Haas VF-2: Spindle load above 80% started 9:02 AM and ended 9:40 AM.` |
| A channel got too many messages | `And 7 more alerts. Open Chatter to see them.` |
| You click **Send test** | `Test from Chatter. Messages to this channel work.` |

The message starts with `CRITICAL` or `WARNING` when an alert starts (`ALERT` when the alert has no known level), and with `OK` when it ends.

## Set up the message settings

The **Message settings** panel is at the bottom of the tab.

- **Chatter address for links:** the address that people type to open Chatter, for example `http://chatter.local:3001`. Each message then ends with a link to the machine page, or to Chatter when the message is not about one machine. Leave it empty to send no link.
- **Time zone:** the time zone of the shop, for example `America/Chicago`. The times in the messages use it. The first time, Chatter fills in the time zone of your browser. Click **Save settings** to keep it. Without a time zone, the messages use UTC and say "UTC".

## Add a channel

1. Click **Add channel**.
2. Select the **Type**, and type a **Name**, for example "Shop phones".
3. Fill in the boxes of the type. See [Text messages with Twilio](#text-messages-with-twilio) or [Webhooks](#webhooks).
4. Under **Which alerts**, select:
   - **Level:** **Warning and up** sends each alert. **Critical only** sends only the critical alerts.
   - **Machines:** **All machines, also the machines that you add later** sends the alerts of each machine, now and later. **Pick machines** sends only the alerts of the machines that you select.
5. Click **Send test**. The result shows under the form. Fix the problem if the test fails.
6. Click **Save channel**.

Each alert sends 2 messages: one when it starts, and one when it ends.

## Change, turn off, or delete a channel

- The switch in the **On** column turns a channel off or on. A channel that is off keeps its settings, but it gets no messages.
- **Send test** in the row sends a test message with the saved settings.
- **Edit** opens the channel. Change it, then click **Save channel**.
- To delete a channel, click **Edit**, then **Delete channel**, then **Delete the channel**. Chatter stops its waiting messages. Its sent and failed messages stay in the message list as **Deleted channel**, until Chatter removes them.

After you save, Chatter never shows a secret again, such as the Twilio auth token. To keep the saved secret, leave its box empty.
To change it, type the new one. To stop sending a webhook secret, select **Delete the saved secret**.

## Text messages with Twilio

[Twilio](https://www.twilio.com) is a service that sends text messages. You need your own Twilio account. Twilio asks a small price for each message.

1. Make a Twilio account, and get a phone number that can send SMS.
2. On the Twilio Console home page, copy the **Account SID** and the **Auth token**.
3. In Chatter, add a channel of the type **Text message (Twilio)**:
   - **Account SID** and **Auth token:** from step 2.
   - **From number:** your Twilio number, with `+` and the country code, for example `+15551230000`.
   - **Phone numbers:** the phones that get the messages, also with `+` and the country code. Click **Add a number** for each phone. A channel can have at most 20 numbers.

### Before the first message

- **In the US, register your number for A2P 10DLC.** A2P 10DLC is the US rule for text messages that a program sends from a normal phone number. Twilio stops the messages of a number that is not registered (error 30034). Do the registration in the Twilio Console. It can take some days.
- **A trial account sends only to verified numbers.** With a Twilio trial account, add each phone as a verified number in the Twilio Console first (error 21608).
- **A phone that sent STOP gets no messages** (error 21610). The phone can send START to your Twilio number to get them again.

## Webhooks

A webhook channel sends each message as JSON to a web address, with `POST`:

```json
{
  "text": "CRITICAL - Haas VF-2: Spindle load above 80%. Spindle load is 92%. Started 9:02 AM.",
  "state": "started",
  "level": "critical",
  "machine": { "id": "haas-vf2", "name": "Haas VF-2" },
  "alert": "Spindle load above 80%",
  "summary": "Spindle load is 92%",
  "startedAt": "2026-11-13T15:02:00.000Z",
  "endedAt": null,
  "link": "http://chatter.local:3001/machine/haas-vf2"
}
```

- `state` is `started`, `ended`, `combined` (started and ended), `more` (an "And 7 more alerts" message), or `test`.
- `level` is `warning`, `critical`, or `null` (for `more`, `test`, and an alert with an unknown level).
- `machine`, `alert`, `summary`, `startedAt`, `endedAt`, and `link` can be `null`.

If you type a **Secret (optional)**, Chatter sends it in the header `Authorization: Bearer <secret>`. Then the other app can check that the message is from Chatter.

### Slack

1. In Slack, make an app with an **incoming webhook** for your channel, and copy its address. It starts with `https://hooks.slack.com/`.
2. In Chatter, add a **Webhook** channel, and paste the address in **Web address**. Leave **Secret** empty.

Slack shows the `text` line.

### ntfy

[ntfy](https://ntfy.sh) sends push messages to the ntfy app on a phone. ntfy can show one field of the JSON, so add <code v-pre>?tpl=yes&amp;m={{.text}}</code> to the address of your topic:

```
https://ntfy.sh/your-topic?tpl=yes&m={{.text}}
```

Use a topic name that other people cannot guess. If your topic needs a login, put an ntfy access token in **Secret**.

### Home Assistant

1. In Home Assistant, make an automation with a **Webhook** trigger, and copy its webhook address, for example `http://homeassistant.local:8123/api/webhook/chatter-alerts`.
2. In Chatter, add a **Webhook** channel with that address. Leave **Secret** empty.

In the automation, `trigger.json.text` is the message, and `trigger.json.machine.name` is the machine name.

## The message list

The **Messages** panel shows each message of the last 30 days, the newest first. Chatter keeps at most 1000 messages, so a busy shop sees fewer days. Select a channel in **Channel** to see only its messages.

| Result | Meaning |
| --- | --- |
| **Sent** | The service took the message. Under it is the answer of the service, for example "Sent to 2 phones". |
| **Waiting** | Chatter sends it soon, or tries again soon. |
| **Failed** | Chatter did not send it. Under it is the reason. |
| **In an "And more alerts" message** | The channel got too many messages, so this alert went in an "And N more alerts" message. |

## Check

| What you see | What to do |
| --- | --- |
| No message comes when an alert starts | Check that the channel is **On**, and that its **Level** and **Machines** include the alert. Then look in the message list. |
| **Failed:** Twilio refused the login | The Account SID or the auth token is wrong. Copy them again from the Twilio Console. |
| **Failed:** error 30034 | Your US number is not registered for A2P 10DLC. See [Before the first message](#before-the-first-message). |
| **Failed:** a number is not verified | A trial account sends only to verified numbers. Verify the number in Twilio, or upgrade the account. |
| **Failed:** Sent to 1 of 2 phones | One number has a problem. For a wrong or blocked number, the reason tells which one. Chatter does not try again, so no phone gets the message two times. |
| **Failed:** the address answered 404 | The web address is wrong. Copy it again. |
| **Failed:** the address answered 401 or 403 | The secret is wrong, or the app needs one. |
| **Failed:** the address points to another address | Chatter does not follow a redirect. Use the new address, for example `https://` in place of `http://`. |
| **Waiting** for a long time | The service does not answer, or answers with an error that can go away. Chatter tries again for 24 hours, then the message fails. |
| An "And 7 more alerts" message | A channel gets at most 10 messages in 10 minutes. Chatter puts the other alerts in one message. Make fewer alerts fire, or select **Critical only**. |
| The times are in UTC | Set the **Time zone** in **Message settings**. |
| The messages have no link | Set **Chatter address for links** in **Message settings**. |

## How it works

When an alert starts or ends, Chatter makes one message for each channel that wants the alert.
The message waits in a queue in `chatter.db`.
After a restart or a power cut, the message is still in the queue, and Chatter sends it.
If the end of an alert comes before Chatter sent its start, Chatter sends one message for both.

Sometimes the service does not answer, or answers that it is busy. Then Chatter tries the message again.
The waits are 30 seconds, 1 minute, 2 minutes, and 5 minutes, then 10 minutes each time. After 24 hours, the message fails.
It does not try again when the service refuses the message, for example for a wrong login, because the next try fails too.

Chatter keeps the Twilio auth token and the webhook secret in `chatter.db` as plain text, because it must send them to the service. See [Keep chatter.db private](../security.md#keep-chatter-db-private).

Chatter sends the messages directly to Twilio or to the web address. It cannot send them through a proxy server yet.

To manage the channels from a program, see [Notifications API](../api/notifications.md).

# Notifications

Chatter can send a message when a machine alert starts and when it ends.
The message goes to a **channel**. There are six types of channel:

- **Twilio** sends a text message to the phones of the shop.
- **Webhook** sends the message to a web address, for example Slack or Home Assistant.
- **Apprise** sends the message to an Apprise server. Apprise then sends it to Teams, Pushover, email, and many more services.
- **Discord** sends the message to a channel of a Discord server. It can mention people or roles.
- **Telegram** sends the message to a Telegram chat, with a bot of your own.
- **ntfy** sends a push message to the ntfy app on your phones.

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
- **Time zone:** the time zone of the shop, for example `America/Chicago`. The times in the messages use it. When an admin opens the **Notifications** tab for the first time, Chatter saves the time zone of the browser. To use another time zone, type it and click **Save settings**. Without a time zone, the messages use UTC and say "UTC", and the panel shows **No time zone is saved**.

## Add a channel

1. Click **Add channel**.
2. Select the **Type**, and type a **Name**, for example "Shop phones".
3. Fill in the boxes of the type. See [Text messages with Twilio](#text-messages-with-twilio), [Webhooks](#webhooks), [Apprise](#apprise), [Discord](#discord), [Telegram](#telegram), or [ntfy](#ntfy-app).
4. Under **Which alerts**, select:
   - **Level:** **Warning and up** sends each alert. **Critical only** sends only the critical alerts.
   - **Machines:** **All machines, also the machines that you add later** sends the alerts of each machine, now and later. **Pick machines** sends only the alerts of the machines that you select.
   - **Ignore messages (optional):** Chatter does not send a message when its text has one of these patterns. For example, `Door open` stops each message about an open door, and `Haas VF-2*Idle` stops the idle alerts of the Haas VF-2. Click **Add a pattern** to add a box. See [Ignore some messages](#ignore-some-messages).
5. Click **Send test**. The result shows under the form. Fix the problem if the test fails.
6. Click **Save channel**.

Each alert sends 2 messages: one when it starts, and one when it ends.

## Ignore some messages

An alert can be useful on the screen, but too frequent for the phones. To stop some messages of a channel, add **ignore patterns** under **Ignore messages**. A channel can have at most 20 patterns.

- A pattern finds text in any part of the message. Chatter looks at the full text that it sends, for example `CRITICAL - Haas VF-2: Door open. Started 9:02 AM.`
- Upper case and lower case are the same. `door open` also finds `Door open`.
- `*` finds any text, also no text. `?` finds one character. All the other characters are only text. For example, `.` and `(` are not special.
- Under each pattern, Chatter tells how many of the last messages it finds, for example "Matches 3 of the last 40 messages." Use this line to check the pattern before you save.
- Chatter does not keep a pattern of only `*` and `?`, because that pattern finds each message. To stop all the messages, turn the channel off.

| Pattern | Finds |
| --- | --- |
| `Door open` | Each message about an open door, on each machine. |
| `Haas VF-2*Idle` | The idle alerts of the Haas VF-2. |
| `WARNING - ` | The start of each warning alert. The end of that alert is ignored too. |
| `Haas VF-?:` | The alerts of the Haas VF-2, the Haas VF-4, and each other Haas VF with one digit. It does not find the Haas VF-10. |

Chatter does not send an ignored message. It shows the message in the message list as **Ignored**, with the pattern that found it.

- When Chatter ignores the start of an alert, it also ignores the end of that alert.
- When the start of an alert waits and the alert ends, Chatter sends one message for both. Chatter checks only the start text of this message. So a pattern for the end messages, such as `ended`, does not stop an alert that nobody saw.
- When the start of an alert went, Chatter checks the text of the end alone.
- Chatter never ignores a test or an "And N more alerts" message.
- An ignored message does not count in the limit of 10 messages in 10 minutes.

:::tip The limit of 10 messages in 10 minutes
A channel gets at most 10 alert messages in 10 minutes. When more alerts come, Chatter puts them in one "And N more alerts" message.
A **Program ended** message counts in this limit too. See [Limits for each channel](#limits-for-each-channel).
:::

## Limits for each channel

Chatter limits the messages of each channel. A service such as `ntfy.sh` stops a sender that sends too many messages.

- **10 messages in 10 minutes.** When more alerts come, Chatter puts them in one "And N more alerts" message.
- **One event message in 15 minutes.** A channel gets at most one **Program ended** message for each machine in 15 minutes. Chatter keeps the other program ends of that machine for the next message. That message tells the count, for example "This happened 20 times since 9:02 AM." A program that runs for 15 minutes or longer still gets one message for each end. The other messages of the channel do not wait for it.
- **A service that asks Chatter to wait.** Some services answer "too many requests" (429) or "busy" (503) with a time to wait. Chatter then sends no message to the channel until that time, for at most 24 hours. Without a time, Chatter uses its usual waits. See [How it works](#how-it-works).
- **End the wait early.** When you fixed the problem, for example with an ntfy access token, you do not have to wait. Save the channel, or click **Send test**. Each save ends the wait, also a save with no change. A test ends the wait only when the service takes the test message. If the problem is still there, the service refuses the next message, and the channel waits again.
- **No flood after a wait.** When a channel can send again and more than 4 messages waited, Chatter sends one summary message and then only the newest 3 messages. This also occurs when you end the wait early. The summary tells how many alerts Chatter could not send, for each alert and machine, for example "Chatter could not send 14 alerts while the channel was blocked: Program ended on Haas ST-10 (12), In alarm on Haas VF-2 (2)."

The message list shows each message that Chatter did not send alone as **Grouped**, with the reason.

## Change, turn off, or delete a channel

- The switch in the **On** column turns a channel off or on. A channel that is off keeps its settings, but it gets no messages.
- **Send test** in the row sends a test message with the saved settings.
- **Edit** opens the channel. Change it, then click **Save channel**.
- To delete a channel, click **Edit**, then **Delete channel**, then **Delete the channel**. Chatter stops its waiting messages. Its sent and failed messages stay in the message list as **Deleted channel**, until Chatter removes them.

After you save, Chatter never shows a secret again, such as the Twilio auth token, the Apprise password, the Discord webhook address, the Telegram bot token, or the ntfy access token. To keep the saved secret, leave its box empty.
To change it, type the new one. To stop sending an optional secret, for example a webhook secret or an ntfy access token, select **Delete the saved secret**.

When you change the address of a channel, type the saved secret again. The address is the **Web address** of a webhook, the **Server** of ntfy, or the **Apprise address**. Chatter does not send a saved secret to a new address. Before you save, the text under the secret box tells you to type it again. If the secret box is empty, Chatter does not save the channel and does not send the test. It shows "Type the Secret again" (or the name of the other secret). To use no secret at the new address, select **Delete the saved secret**. The same address with spaces around it is not a new address.

## Text messages with Twilio

[Twilio](https://www.twilio.com) is a service that sends text messages. You need your own Twilio account. Twilio asks a small price for each message.

1. Make a Twilio account, upgrade it from the trial, and get a phone number that can send SMS.
2. On the Twilio Console home page, copy the **Account SID** and the **Auth token**.
3. In Chatter, add a channel of the type **Text message (Twilio)**:
   - **Account SID** and **Auth token:** from step 2.
   - **From number:** your Twilio number, with `+` and the country code, for example `+15551230000`.
   - **Phone numbers:** the phones that get the messages, also with `+` and the country code. Click **Add a number** for each phone. A channel can have at most 20 numbers.

### Before the first message

- **Upgrade the Twilio account.** A Twilio trial account can send only the message templates of Twilio, not the messages of Chatter (error 572006).
- **In the US, register your number for A2P 10DLC.** A2P 10DLC is the US rule for text messages that a program sends from a normal phone number. Do the registration in the Twilio Console. It can take some days.
  Before the registration, Twilio takes each message, but does not deliver it. Chatter then shows **Sent**, but the phones get nothing. The Twilio message logs show error 30034.
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

- `state` is `started`, `ended`, `combined` (started and ended), `more` (an "And 7 more alerts" message, or a summary after the channel was blocked), or `test`.
- `level` is `warning`, `critical`, or `null` (for `more`, `test`, and an alert with an unknown level).
- `machine`, `alert`, `summary`, `startedAt`, `endedAt`, and `link` can be `null`.

**Secret (optional)** is under **Advanced**. If you type a secret, Chatter sends it in the header `Authorization: Bearer <secret>`. Then the other app can check that the message is from Chatter.

### Slack

1. In Slack, make an app with an **incoming webhook** for your channel, and copy its address. It starts with `https://hooks.slack.com/`.
2. In Chatter, add a **Webhook** channel, and paste the address in **Web address**. Leave **Advanced** closed.

Slack shows the `text` line.

### ntfy with a webhook

Use the [ntfy](#ntfy-app) channel type for new channels. A webhook channel that you made before for ntfy continues to work.
ntfy can show one field of the JSON, so the address of the topic ends with <code v-pre>?tpl=yes&amp;m={{.text}}</code>:

```
https://ntfy.sh/your-topic?tpl=yes&m={{.text}}
```

Use a topic name that other people cannot guess. If your topic needs a login, open **Advanced**, and put an ntfy access token in **Secret**.

### Home Assistant

1. In Home Assistant, make an automation with a **Webhook** trigger, and copy its webhook address, for example `http://homeassistant.local:8123/api/webhook/chatter-alerts`.
2. In Chatter, add a **Webhook** channel with that address. Leave **Advanced** closed.

In the automation, `trigger.json.text` is the message, and `trigger.json.machine.name` is the machine name.

## Apprise

[Apprise](https://github.com/caronc/apprise) sends one message to more than 100 services, for example Microsoft Teams, Discord, Telegram, email, Pushover, and Signal.
Chatter sends each message to **Apprise API**, a small server that you run in the shop. Apprise then sends it to your services.
The logins of your services stay in Apprise, not in Chatter.

Apprise API runs on a computer with a 64-bit processor (Intel, AMD, or 64-bit ARM). It does not run on the Chatter Raspberry Pi card, so put it on another computer.

1. Start Apprise API with Docker, for example with this `docker-compose.yml`:

   ```yaml
   services:
     apprise:
       image: caronc/apprise:latest
       ports:
         - "8000:8000"
       environment:
         APPRISE_STATEFUL_MODE: simple
       volumes:
         - ./config:/config
       restart: unless-stopped
   ```

2. Open Apprise in a browser, for example `http://apprise.local:8000`. Save the addresses of your services under a **config key**, for example `chatter`.
   Each service has its own address form, for example `tgram://bottoken/ChatID` for Telegram. The [Apprise wiki](https://github.com/caronc/apprise/wiki) has the form of each service.
3. In Apprise, send a test to the config key. Make sure that each service gets it.
4. In Chatter, add a channel of the type **Apprise**:
   - **Apprise address:** the Apprise address, then `/notify/`, then your config key, for example `http://apprise.local:8000/notify/chatter`.
   - **Tag (optional):** sends only to the services that have this tag in Apprise. Leave it empty to send to the services with no tag. Type `all` to send to each service.
   - **User name** and **Password (optional):** under **Advanced**. Only when your Apprise asks for a login (`APPRISE_AUTH_REQUIRED=yes`).
5. Click **Send test**.

Chatter gives each message an Apprise type, so each service can show it with its own color or icon:

| Message | Apprise type |
| --- | --- |
| A critical alert starts | `failure` |
| A warning alert starts, or an "And N more alerts" message | `warning` |
| An alert ends | `success` |
| A test | `info` |

The title is `Chatter: ` and the machine name.
A test and an "And N more alerts" message have only the title `Chatter`.
In an email, the title is the subject.
The text is the same as in a text message.

Apprise answers only after it sent the message to each service. So Chatter waits up to 60 seconds for Apprise. For the other types, it waits 10 seconds.
If Apprise does not answer in 60 seconds, Chatter tries again later. Then a service that already got the message can get it two times.

## Discord

Chatter sends each message to a channel of a Discord server, through a **webhook**. A webhook is a web address that lets an app post to one channel. You need the **Manage Webhooks** permission on the server.

1. In Discord, open **Server Settings > Integrations > Webhooks**. Click **New Webhook**, and select the channel. Click **Copy Webhook URL**.
2. In Chatter, add a channel of the type **Discord**:
   - **Webhook address:** the address from step 1. It starts with `https://discord.com/api/webhooks/`. It has a token in it, so Chatter never shows it again after you save.
   - **Mention (optional):** the people or roles that Discord mentions when an alert starts. See [Mention people in Discord](#mention-people-in-discord).
   - **Notification sound:** **Normal** or **Quiet**. Quiet still shows each message in the Discord channel, but Discord sends no notification to phones and computers. The sound is the same for each message of the channel, also for a test.
3. Click **Send test**.

Each message is an embed (a card) with the text of the message. The color of the bar shows the kind of message:

| Message | Color |
| --- | --- |
| A critical alert starts | Red |
| A warning alert starts | Amber |
| An alert ends | Green |
| A test, an "And N more alerts" message, or an alert with no known level | Gray |

Discord shows the time of the alert under the embed.

### Mention people in Discord

Type one mention or more in **Mention (optional)**. Put a space between them:

| To mention | Type |
| --- | --- |
| A person | `<@USER_ID>` |
| A role | `<@&ROLE_ID>` |
| The people in the channel who are online | `@here` |
| Everyone on the server | `@everyone` |

To get an ID, turn on **Developer Mode** in Discord (**User Settings > Advanced**). Then right-click the person, or the role in **Server Settings > Roles**, and click **Copy ID**. Put the ID in the form, for example `<@&123456789012345678>` for a role.

Chatter mentions the people when an alert starts, and for a test. It does not mention them when an alert ends, or for an "And N more alerts" message.
Only the mentions in this box send a notification to people. A machine name that has `@everyone` in it sends none.

## Telegram

Chatter sends each message to a Telegram chat, with a bot of your own. The chat can be a group, a channel, or a private chat with you.

1. In Telegram, send `/newbot` to **@BotFather**. Follow the steps, and copy the **bot token**.
2. Send a message to your bot. Or add the bot to your group or channel, and write a message there. Telegram does not let a bot write first.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser. Put your bot token in place of `<TOKEN>`. Look for `"chat":{"id":` in the answer. The number after it is the chat ID.
   A group has a negative number, for example `-1001234567890`. A private chat with you has a positive number.
4. In Chatter, add a channel of the type **Telegram**:
   - **Bot token:** from step 1. Chatter never shows it again after you save.
   - **Chat ID:** from step 3. For a public channel, you can type `@` and the name of the channel. The bot must be an admin of the channel.
   - **Notification sound:** **Normal** or **Quiet**. Quiet still shows each message, but the phone makes no sound. The sound is the same for each message of the channel, also for a test.
5. Click **Send test**.

The message has the same text as a text message.

## ntfy app {#ntfy-app}

[ntfy](https://ntfy.sh) sends push messages to the ntfy app on Android and iPhone. You can use the free public server `ntfy.sh`, or run your own ntfy server in the shop.

1. Install the **ntfy** app on each phone.
2. In Chatter, add a channel of the type **ntfy**.
3. In **Topic**, click **Make a random topic**. Chatter fills in three random words, for example `maple-otter-lantern`. You can also type your own topic name. Use only letters, digits, `-` and `_`, and use a name that other people cannot guess.
4. In the ntfy app on each phone, subscribe to the same topic. To add a phone later, open the channel in Chatter and read the topic there.
5. Select the **Notification sound**. See the table below. Quiet still shows each message.
6. Only for your own ntfy server, or for a topic that needs a login: open **Advanced**.
   - **Server (optional):** the address of your own ntfy server, for example `http://ntfy.shop.local`. Do not put the topic in the address. Leave it empty for `ntfy.sh`. If you type the address of `ntfy.sh`, type only `https://ntfy.sh`, with no path after it. In the ntfy app, type the same server address.
   - **Access token (optional):** only when the topic needs a login. In ntfy, make a token under **Account > Access tokens**.
7. Click **Send test**.

::: warning
On `ntfy.sh`, a topic has no login. Each person who knows the topic name can read your alerts and send messages to it. Use a name that is hard to guess, or use an access token on a reserved topic or on your own server.
:::

::: warning The daily limit of ntfy.sh
Without an account, `ntfy.sh` takes about 250 messages each day from one network (one public IP address). All the computers of the shop network use the same limit, also a second Chatter and the **Send test** button. The limit resets one time each day, at a time that `ntfy.sh` sets. When the limit is used, Chatter shows "The limit is used" and waits until the reset. For more messages, use an access token of an `ntfy.sh` account, or your own ntfy server.
:::

The **Notification sound** sets the ntfy priority of each message of the channel, also of a test. The level of the alert does not change it.

| Notification sound | ntfy priority | On the phone |
| --- | --- | --- |
| **Quiet** | 2 (low) | The message shows, with no sound and no vibration. |
| **Normal** | 3 (default) | The message shows, with the usual sound and vibration. |
| **High** | 4 (high) | A longer vibration, and the message shows over other apps. |
| **Urgent** | 5 (urgent) | The longest vibration, and the message shows over other apps. |

To make the critical alerts louder than the warnings, make two ntfy channels. Give one **Critical only** and **Urgent**. Give the other **Warning and up**, **Normal**, and an ignore pattern `CRITICAL - `.

Chatter gives each message an icon:

| Message | Icon |
| --- | --- |
| A critical alert starts | 🚨 |
| A warning alert starts, or an "And N more alerts" message | ⚠️ |
| An alert ends | ✅ |
| A test | 🔔 |

The title is `Chatter: ` and the machine name. When you tap the message, the phone opens the machine in Chatter. For this, set **Chatter address for links** in **Message settings**. The phone must also be on the shop network.

## The message list

The **Messages** panel shows each message of the last 30 days, the newest first. Chatter keeps at most 1000 messages, so a busy shop sees fewer days. Select a channel in **Channel** to see only its messages.

The panel shows the newest 10 messages. To see 10 more, click **Show more** at the bottom of the list. While the tab is open, Chatter adds new messages to the list every 20 seconds.

| Result | Meaning |
| --- | --- |
| **Sent** | The service took the message. Under it is the answer of the service, for example "Sent to 2 phones". Twilio can still fail to deliver a text after that. |
| **Waiting** | Chatter sends it soon, or tries again soon. After a failed try, under it is the reason, for example a limit of the service. |
| **Failed** | Chatter did not send it. Under it is the reason. |
| **Grouped** | Chatter did not send it alone. It went in an "And N more alerts" message, in a summary after the channel was blocked, or in the next message about the same event. Under it is the reason. See [Limits for each channel](#limits-for-each-channel). |
| **Ignored** | Chatter did not send it, because its text has an ignore pattern of the channel. Under it is the pattern. See [Ignore some messages](#ignore-some-messages). |

## Check

| What you see | What to do |
| --- | --- |
| No message comes when an alert starts | Check that the channel is **On**, and that its **Level** and **Machines** include the alert. Check that no pattern in **Ignore messages** finds the text. Then look in the message list. An ignored message shows as **Ignored**. |
| **Failed:** Twilio refused the login | The Account SID or the auth token is wrong. Copy them again from the Twilio Console. |
| **Sent**, but the phone gets no text | **Sent** means only that Twilio took the message. In the Twilio Console, open **Monitor > Logs > Messaging** and look at the status of the message. Error 30034 means that your US number is not registered for A2P 10DLC. See [Before the first message](#before-the-first-message). |
| **Failed:** a Twilio trial account can send only the message templates of Twilio | Upgrade the Twilio account. |
| **Failed:** a number is not verified | An old Twilio trial account sends only to verified numbers. Verify the number in Twilio, or upgrade the account. |
| **Failed:** Sent to 1 of 2 phones | One number has a problem. For a wrong or blocked number, the reason tells which one. Chatter does not try again, so no phone gets the message two times. |
| **Failed:** the address answered 404 | The web address is wrong. Copy it again. |
| **Failed:** the address answered 401 or 403 | The secret is wrong, or the app needs one. |
| **Failed:** the address points to another address | Chatter does not follow a redirect. Use the new address, for example `https://` in place of `http://`. |
| **Failed:** Apprise could not send to one service or more | One of your services in Apprise failed, or no service has the tag. Look in the Apprise log. Chatter does not try again, so no service gets the message two times. |
| **Failed:** Apprise has no config with this key | The config key in the **Apprise address** is wrong, or you did not save the config in Apprise. |
| **Failed:** Apprise refused the login | Type the user name and password of Apprise. |
| **Failed:** Discord answered 401, 403, or 404 | The webhook is deleted, or the address is wrong. Copy the webhook address from Discord again. |
| **Failed:** Discord answered 400 and refused the message | Check the **Mention** box. Empty it, and send a test. |
| **Failed:** Telegram refused the bot token | The bot token is wrong. Copy it again from @BotFather. |
| **Failed:** Telegram cannot find the chat | The chat ID is wrong. Look in `getUpdates` again. |
| **Failed:** The group is now a supergroup | Telegram gave the group a new chat ID. Type the new chat ID from the message in **Chat ID**. |
| **Failed:** Telegram answered 400 | The answer had no reason. A proxy of the shop network can cause this. Check the chat ID and the bot token. |
| **Failed:** Telegram refused the message: ... | The text after the colon is the reason from Telegram. |
| **Failed:** The bot cannot write to the chat | Send a message to the bot, or add the bot to the group or channel. For a channel, make the bot an admin. |
| **Failed:** ntfy refused the access | The access token is wrong, or it cannot write to the topic. Make a new token in ntfy. |
| **Failed:** ntfy answered 404 | The **Server** address is wrong. Do not put the topic in it. |
| **Waiting** or **Failed:** ntfy.sh allows 250 messages each day | The daily limit of `ntfy.sh` for your network is used. Chatter waits until the reset, and then sends a summary. Other computers on the same network, for example a second Chatter, use the same limit. Use an access token of an `ntfy.sh` account, or your own ntfy server. Then save the channel, and Chatter sends again at once. See [The daily limit of ntfy.sh](#ntfy-app). |
| **Waiting:** Too many requests to ntfy | Chatter sent too many requests in a short time. Chatter waits the time that ntfy tells, and tries again. After **Send test**, wait for that time. |
| The ntfy app gets no message, but Chatter shows **Sent** | The app subscribes to another topic or another server. Check the topic name in the app. |
| **Failed:** Chatter could not reach Apprise | Apprise API is not running, or the address is wrong. Chatter tries again for 24 hours. |
| **Waiting:** Apprise did not answer in time | Apprise needs more than 60 seconds to send to your services. Look in the Apprise log for a slow service. Chatter tries again later. |
| **Waiting:** Apprise answered 500 (or 502, 503, 429) | Apprise or one of its parts has a problem, or is busy. Look in the Apprise log. Chatter tries again for 24 hours. |
| Apprise API does not start on the Chatter Raspberry Pi card | The Apprise image is only for 64-bit processors. The Pi card is 32-bit. Run Apprise API on another computer. See [Apprise](#apprise). |
| **Waiting** for a long time | The service does not answer, or answers with an error that can go away. Chatter tries again for 24 hours, then the message fails. |
| An "And 7 more alerts" message | A channel gets at most 10 alert messages in 10 minutes. Chatter puts the other alerts in one message. A **Program ended** message counts too. Make fewer alerts fire, or select **Critical only**. |
| "This happened 20 times since 9:02 AM" | A channel gets at most one **Program ended** message for each machine in 15 minutes. The message tells the program ends since the last message. See [Limits for each channel](#limits-for-each-channel). |
| "Chatter could not send 14 alerts while the channel was blocked" | The service did not take messages for a time, for example because of its limit. After that, Chatter sent this summary and the newest 3 messages. Open the message list to see each alert. |
| The times are in UTC | Set the **Time zone** in **Message settings**, and click **Save settings**. |
| An **OK** message comes, but the machine still has the alarm | vmalert saw no alarm at one check. Then the alert starts again, and a new start message comes. Look at the machine history at that time. See [When an alert ends](./alerts.md#when-an-alert-ends). |
| The messages have no link | Set **Chatter address for links** in **Message settings**. |

## How it works

When an alert starts or ends, Chatter makes one message for each channel that wants the alert.
The message waits in a queue in `chatter.db`.
After a restart or a power cut, the message is still in the queue, and Chatter sends it.
If the end of an alert comes before Chatter sent its start, Chatter sends one message for both.
When the text of a message has an ignore pattern of the channel, Chatter keeps the message in the list as **Ignored**, and does not send it.
A channel that did not get the start of an alert gets no end message for it, for example a channel that you add while the alert is on.
A **Program ended** alert gets only its start message. Chatter sends no end message and no combined message for it. It counts in the limit of the channel. See [Program ended](./alerts.md#program-ended) and [Limits for each channel](#limits-for-each-channel).

Sometimes the service does not answer, or answers that it is busy. Then Chatter tries the message again.
The waits are 30 seconds, 1 minute, 2 minutes, and 5 minutes, then 10 minutes each time. After 24 hours, the message fails.
When the service tells a longer wait (the `Retry-After` header, or the wait in a Telegram answer), Chatter uses that wait, for at most 24 hours.
While Chatter waits, the channel gets no other message. So Chatter does not send more requests to a service that refused one.
It does not try again when the service refuses the message, for example for a wrong login, because the next try fails too.
**Send test** sends one time only. It does not try again.

Chatter keeps the Twilio auth token, the webhook secret, the Discord webhook address, the Telegram bot token, the ntfy access token, and the Apprise password in `chatter.db` as plain text, because it must send them to the service. It also keeps the ntfy topic there. The topic is not secret in the form, but each person who knows it can read the messages. See [Keep chatter.db private](../security.md#keep-chatter-db-private).

Chatter sends the messages directly to Twilio, to the web address, or to Apprise. It cannot send them through a proxy server yet.

To manage the channels from a program, see [Notifications API](../api/notifications.md).

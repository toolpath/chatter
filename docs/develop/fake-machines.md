# Fake machines

Fake CNC machines for trying Chatter without a real shop floor.
The files are in `tools/fake-machines/`. Each fake opens the same network ports as the real control and answers in the same language.

| Machine | Chatter type | Ports | Protocol | FTP port |
| --- | --- | --- | --- | --- |
| Fake Brother Speedio | `brother` | 10000 | Brother LOD frames (`%CLOD ... %`) | 2121 |
| Fake Haas VF-2 | `haas` | 9998 (data stream), 5051 (Q commands) | Haas data stream + `?Q` queries | 2122 |
| Fake Okuma Genos | `mtconnect` (generic) | 5000 | MTConnect HTTP (`/probe`, `/current`) | 2123 |
| Fake DMG Mori DMU 50 | `mtconnect` (`dmg_mori`) | 5001 | MTConnect HTTP | 2124 |

FANUC is not here. Chatter talks to FANUC controls through FANUC's closed FOCAS2 library, so there is no fake FANUC control.

## Run

Start Chatter first (`npm run dev`), then in a second terminal:

```bash
npm run fake-machines
```

To also add the 4 machines to Chatter, use `--add` with the login of a Chatter admin:

```bash
CHATTER_USERNAME=admin CHATTER_PASSWORD='your password' npm run fake-machines -- --add
```

`--add` adds the machines through `POST /api/machines`. Only an admin can add machines, so the script sends the
username and password from `CHATTER_USERNAME` and `CHATTER_PASSWORD` (HTTP Basic). Without them, the machines
still run, and the script tells you how to set them.
If a machine is already there, the server answers 409 and the script skips it.
If the login is wrong (401), or Chatter blocks the computer after too many wrong logins (429), the script stops adding and says so.

Options:

- `--speed 10` runs the machines 10 times faster than real time (default 5).
- `--api http://host:3001` points `--add` at a different Chatter server.
- `--lan` lets other devices on your local network reach the machines (see [On the local network](#on-the-local-network)).
- `--slow-start 20` makes the Brother and Haas machines answer slowly for 20 seconds after Chatter connects (default 10). Each answer then takes 0.7 seconds, like a real control. The first poll has about 8 answers, so Chatter shows **Connecting** for about 6 seconds. `--slow-start 0` makes them answer at once. The MTConnect machines and the Haas data stream are never slow.

## On the local network

Without `--lan`, only this computer can reach the machines (`127.0.0.1`).
With `--lan`, they listen on all addresses of this computer, like real machines on a shop network.
Then Chatter on another computer, for example a Raspberry Pi, can find them with **Find machines**:

```bash
npm run fake-machines -- --lan
```

All 4 machines are at the local network address of this computer, for example `192.168.1.83`.
The script prints the address. In **Find machines**, scan the range of that address, for example `192.168.1`.
With `--add`, the machines get that address too, so `--add --api http://chatter.local:3001` adds them to the Pi.

`--lan` opens the fake FTP servers to your local network, and they take any password.
Use `--lan` only on a network that you trust, and stop the script when you are done.

Press Ctrl+C to stop. The machines stay in Chatter and show as **Offline**.

## FTP files

Each machine also runs a small FTP server, so the Files tab and uploads work.
Real machines use FTP port 21. The fakes share one computer, so each one has its own port (see the table).
If you add a fake machine with **Find machines**, set its FTP port in **Machine settings**. `--add` sets it for you.

The FTP server takes any username and password. Use it only on this computer, or with `--lan` on a network that you trust.
On the first start, each machine gets two sample programs in `tools/fake-machines/.ftp-files/<machine>/`.
Git ignores that folder. Delete it to get the sample programs back.

## What the machines do

Every machine runs the same cycle, copied from the old chatter-pyMachine emulator:

1. Setup in MDI mode, spindle stopped.
2. Run the part program in MEMORY mode. Each step uses one tool at one spindle speed.
3. Count the part, then wait while the operator loads the next blank.
4. Now and then, stop (feed hold) or show an alarm for a short time.
5. When the part goal is reached, pick a new program and goal, and set up again.

## Files

- `simulator.ts` — the brand-neutral machine model
- `programs.ts` — the part programs that the machines run
- `brother.ts`, `haas.ts`, `mtconnect.ts` — one server for each control language; `tcp.ts` — shared TCP helpers
- `ftp.ts` — the small FTP server; `sampleFiles.ts` — the sample programs
- `profiles.ts` — the 4 machines
- `options.ts` — the command-line options; `network.ts` — the addresses for `--lan`
- `chatterApi.ts` — adds the machines to Chatter for `--add`
- `index.ts` — starts everything

The tests are next to the files (`*.test.ts`). Run them with `npm run test:tools`.

## Fake notifications

A fake Twilio and a fake webhook receiver, so you can try **Settings > Notifications** without a Twilio account.
The files are in `tools/fake-notify/`. The fake sends nothing out. It prints each message that Chatter sends.

```bash
npm run fake-notify
```

Then start the Chatter server with the address of the fake Twilio:

```bash
TWILIO_API_URL=http://127.0.0.1:4010 npm run dev
```

- **Text messages:** add a **Text message (Twilio)** channel. Use `AC` and then 32 zeros as the Account SID, and any auth token.
- **Webhooks:** add a **Webhook** channel with the web address `http://127.0.0.1:4010/any-path`.

Use these values to see how Chatter shows a refusal:

| Value | The fake answers like Twilio |
| --- | --- |
| Phone number `+15005550001` | Error 21211: not a valid phone number |
| Phone number `+15005550004` | Error 21610: the phone sent STOP |
| Phone number `+15005550008` | Error 21608: a trial account sends only to verified numbers |
| Auth token `wrong` | 401: the login is wrong |

Options:

- `--port 4010` sets the port (default 4010). Then use the same port in `TWILIO_API_URL`.
- `--webhook-status 500` makes each webhook answer 500, so you can see how Chatter tries again.

The fake listens only on this computer (`127.0.0.1`). Press Ctrl+C to stop.

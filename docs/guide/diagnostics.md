# Diagnostics

Use these tools to find a problem with no SSH to the Pi. An Admin can use all of them. Each user can see the connection of a machine.

## If a machine shows Offline

1. Open the machine, then the **Settings** tab, then the **Connection** section.
   It shows the time of the last good poll, since when the machine is offline, the last error with its time, and the last 10 connection changes.
2. Click **Test connection**. Chatter does these steps, each in at most 3 seconds:
   - **Address**: a DNS lookup of the host name. An IP address needs no lookup.
   - **Port**: a connection to each port of the machine (data, Q commands, MTConnect agent, FOCAS, OPC UA, FTP).
   - **Answer**: one short question in the protocol of the machine (Brother, Haas and MTConnect). It reads only.

   Chatter stops the polls of the machine during the test, because some controls accept only one connection. After the test, the polls start again.
   The test does not use ping, because the Chatter container cannot send ping, and many controls block it.
   Chatter allows one test of a machine in each 10 seconds.
3. Read the result of each step and its hint:

| Result | What it tells you |
| --- | --- |
| Address failed | Chatter cannot find the host name. Use the IP address of the machine. |
| Port: no route | The address is wrong, the cable is out, or the machine is on another network. |
| Port: no answer in 3 s | The machine is off, or a firewall blocks the port. |
| Port: refused | The machine is on, but nothing listens on this port. Check the port, and the setting on the control. |
| Answer: connected, no reply | **Another program may be connected.** A Brother control serves only one connection. Stop the other program, for example a second Chatter. |

4. Click **Reconnect**. Chatter disconnects the machine and polls it at once.
   If a poll has not ended, Chatter says so and does not start a second poll. 1 minute after the start of that poll, Chatter stops the wait for it and polls the machine again.

### Another Chatter on the network

**Find machines** also looks for other Chatter servers on port 3001. It shows each one as "Chatter 1.2.0 at 192.168.1.30".
If another Chatter polls the same machine, it takes the connection of the machine. A Brother control serves only one connection. Then one of the two Chatter servers shows the machine as offline.
A common cause is a Chatter on a laptop for tests. Stop it, or remove the machine from it.

### After a start of the Pi

The network of a Pi can need some time after a start. For the first 2 minutes after Chatter starts, a machine that Chatter cannot reach because there is no route to it yet stays **Connecting**. It does not show as Offline.

## Settings > Diagnostics

### This computer

This panel shows the version of Chatter, the time when it started, and the address of this page.
On the Pi card, it also shows the host name, the name on the network (for example `chatter.local`), each address, the gateway, and if SSH is on.

::: info A new card image is necessary
The network facts, **Restart the Pi**, and the **Update helper log** come from the update helper of the Pi.
An update of Chatter does not change the helper. Only a new card image brings them. On an older card, the page shows the address of this page only.
:::

### Restart

- **Restart Chatter**: Chatter stops, and Docker starts it again. This takes about 1 minute. It works only when Chatter runs in Docker.
- **Restart the Pi**: the update helper restarts the Pi. This takes about 2 minutes. The helper does not restart the Pi while it checks or installs an update, and it restarts the Pi at most once in 15 minutes. A checked update file must be checked again after the restart.

Each restart asks you first. Chatter writes each restart, with your user name, in the log.
The page asks each 2 seconds if Chatter is back. After 5 minutes, it tells you what to check.

### Server log

- **Download the log**: the last 2000 lines (at most 600 000 characters) of the log, as a text file. Choose a level and a machine first, if you want.
- **Show the live log**: the lines as they come. The page keeps the last 500 lines. If the browser is too slow, Chatter drops lines and tells how many. At most 3 live logs can be open at the same time.
- **Debug level for 15 minutes**: the log has more lines. It turns off by itself after 15 minutes.

Chatter also keeps the log in the data volume (`logs/chatter.log`, 2 files of 1 MB), so the lines from before a restart stay. The support bundle has these files. To turn the file off, set `LOG_FILE=off` in the `environment:` of the `chatterbox` service.
For more about the log, see [Server logs](./logs.md).

### Support bundle

**Download the support bundle** gives one `.tar.gz` file. Send it to the person who helps you. It has:

- The version, the time since the start, the memory, and the free space
- The status of each machine, and its last connection changes
- The notification channels (their type and name only) and the status of the newest messages, for example a `429` error of ntfy
- The answers of VictoriaMetrics and vmalert
- The files of the update helper (on the Pi card)
- The server log
- The audit log (`logs/audit.log`): each change and each login try, with the user and the address. See [Audit log](./logs.md#audit-log).

It does not have the passwords and tokens that are saved in the settings. But the error texts and the log lines can contain addresses or phone numbers. The bundle is for your own support. Read it before you send it to another person. See [Security](../security.md#diagnostics).

### Update helper log

On the Pi card, this panel (also on the **Updates** tab) shows what the update helper did in each check, install and restart, with the time of each step.
Before, this needed SSH and `journalctl -u chatter-update`.

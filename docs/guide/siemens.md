# Siemens machines

Chatter reads Siemens SINUMERIK controls (840D sl, 828D, ONE) through the OPC UA server that is built into the control.
It needs no extra software on the Chatter computer.

## Set up the control

1. The control needs the OPC UA option ("SINUMERIK Access MyMachine /OPC UA"). It must be licensed and turned on.
2. On the control, open **Commissioning > Network > OPC UA** and check that OPC UA is on. Its port is usually `4840`.
3. Give Chatter a login with read rights (`SinuReadAll`), or turn on anonymous access.

A SINUMERIK control allows only a few OPC UA sessions. Chatter uses one session for each machine. Do not add the same control twice.

## Add the machine

Add the machine with the type **Siemens SINUMERIK**. Then, on the machine page, open **Settings** and set:

- **OPC UA port**: usually `4840`.
- **Security**: **None**, or **Sign and encrypt (Basic256Sha256)**.
- **OPC UA username** and **OPC UA password**: the login from the control. Leave the username empty for an anonymous login.

The server never sends the password back, the same as the FTP password.

### Sign and encrypt

With **Sign and encrypt**, the control must trust the certificate of Chatter:

1. Save the settings in Chatter. Chatter makes its certificate and tries to connect. The control rejects the first try.
2. On the control, open **Commissioning > Network > OPC UA > Certificates**. Move the Chatter certificate from **Rejected** to **Trusted**.
3. Chatter connects at its next try.

Chatter keeps its certificate in the data folder (in `opcua-pki`, next to `chatter.db`), so the certificate stays after an update and you trust it only once. All Siemens machines use the same certificate.
Chatter trusts the certificate of each control the first time it connects.

## What Chatter reads

Chatter reads these values from channel 1 of the control, every poll, in one request:

| Value | SINUMERIK variable |
|-------|--------------------|
| Run state | `/Channel/State/chanStatus`: 0 reset (Ready), 1 active (Running), 2 interrupted |
| Program state | `/Channel/State/progStatus` |
| Mode | `/Bag/State/opMode`: JOG, MDA or AUTO |
| Program | `/Channel/ProgramInfo/selectedWorkPProg`, shown as `PART1.MPF` |
| Parts and part goal | `/Channel/State/actParts` and `/Channel/State/reqParts` |
| Tool | `/Channel/State/actTNumber` and `/Channel/State/actToolIdent` |
| Spindle speed and load | `/Channel/Spindle/actSpeed` and `/Channel/Spindle/driveLoad` |
| Feed and feed override | `/Channel/State/actFeedRateIpo` and `/Channel/State/feedRateIpoOvr` |

The run state must be readable. A control that does not have one of the other values leaves it empty.
The control counts parts only when its part counter is set up (machine data `MD27880`).

On the machine page, **R parameters** adds R parameters to the Current job card: type `5` to read `R5`.

### Alarms

The control sends its alarms as OPC UA events. When Chatter connects, it asks for the alarms that are active already.
The alarm code is the SINUMERIK alarm number, for example `700209`.
If the control sends no alarm events, Chatter still reads the other values, and the machine page tells why the alarms are missing.

## Check

When a machine does not connect, the machine page shows the reason:

| Message | Meaning |
|---------|---------|
| `BadUserAccessDenied` | Wrong username or password, or the user has no read rights |
| `The connection cannot be established` | OPC UA is off or not licensed, or the IP address or port is wrong |
| `BadSecurityChecksFailed` or `BadCertificateUntrusted` | The control does not trust the Chatter certificate yet (see [Sign and encrypt](#sign-and-encrypt)) |
| `Cannot read /Channel/State/chanStatus` | The control does not give the SINUMERIK variables, or the user cannot read them |

The values in the table above were checked on SINUMERIK 828D controls. Other versions may give some values under other names.

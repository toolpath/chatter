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

The server never sends the password back, the same as the FTP password. When you change the IP address or the OPC UA port, type the OPC UA password again. Chatter does not send a saved password to a new address. Before you save, the text under the password box tells you to type it again.

### Sign and encrypt

With **Sign and encrypt**, the control must trust the certificate of Chatter:

1. Save the settings in Chatter. Chatter makes its certificate and tries to connect. The control rejects the first try.
2. On the control, open **Commissioning > Network > OPC UA > Certificates**. Move the Chatter certificate from **Rejected** to **Trusted**.
3. Chatter connects at its next try.

Chatter keeps its certificate in the data folder (in `opcua-pki`, next to `chatter.db`), so the certificate stays after an update and you trust it only once. All Siemens machines use the same certificate.

## The certificate of the control

The control also has a certificate. Chatter trusts the certificate that the control shows at the first connect. This is "trust on first use". Chatter keeps the thumbprint of that certificate in `chatter.db`. The thumbprint is the SHA-256 of the certificate, as 64 hex digits.

At each later connect, Chatter reads the certificate of the control before it logs in. When the certificate is not the trusted one, Chatter does not send the OPC UA username and password. The machine stays offline, and the machine page shows this error:

`The OPC UA certificate of the control changed. Chatter did not send the login.`

The error also gives the thumbprint of the new certificate and the thumbprint of the trusted certificate. Chatter tries again at each poll, but it does not log in until an Admin trusts the new certificate.

A control can get a new certificate for a good reason. For example, a person made a new certificate on the control, or the control was replaced. But a different device at the address of the control also shows a different certificate. So find the reason before you trust a new certificate:

1. Ask the person who looks after the control if the certificate changed.
2. Compare the thumbprint. Export the certificate of the control from **Commissioning > Network > OPC UA > Certificates** (a `.der` file). On a computer, run `openssl x509 -inform der -in <file> -noout -fingerprint -sha256`. Remove the colons. The result must be the same as the new thumbprint in the error.
3. An Admin trusts the new certificate. The machine page has no button for this yet. Send the thumbprint of the new certificate to Chatter:

   ```bash
   curl -u <admin username> -X POST -H 'Content-Type: application/json' \
     -d '{"thumbprint":"<new thumbprint>"}' \
     http://<Chatter address>:3001/api/machine/<machine ID>/opcua/trust-certificate
   ```

   The machine ID is the last part of the address of the machine page, after `/machine/`. curl asks for the password of the Admin.

Chatter trusts only the thumbprint that you send, and only when the control shows that certificate now. If the control shows a different certificate again, Chatter trusts nothing and replies with `409` and "The certificate of the control changed again". Then check the new thumbprint. After a good reply, Chatter connects at once with the new certificate. The audit log records who trusted which thumbprint.

When you change the IP address or the OPC UA port of the machine, Chatter forgets the trusted certificate. The next connect trusts the certificate of the device at the new address. A machine that you added with an older version of Chatter has no trusted certificate yet. Its first connect after the update trusts the certificate that the control shows then.

How much the check protects depends on the **Security** setting:

- **Sign and encrypt**: the session opens only with the device that has the private key of the trusted certificate. So a different device cannot get the login, also when it shows a copy of the certificate of the control.
- **None**: the control does not prove that the certificate is its own. A device in the middle can show a copy of the certificate of the control. So the check finds a new control, or a device that shows its own certificate. It does not stop a device in the middle that copies the certificate. When the control encrypts the password with its certificate, only the device with the private key can read the password. But with security None, a device in the middle can also ask for the password with no encryption. To keep the OPC UA password safe, use **Sign and encrypt**.

For the other limits, see [Security](../security.md).

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
| `The OPC UA certificate of the control changed` | The control shows a certificate that is not the trusted one (see [The certificate of the control](#the-certificate-of-the-control)) |
| `The control has no OPC UA endpoint for Sign and encrypt` | Security is **Sign and encrypt**, but the control does not offer Basic256Sha256. Turn it on at the control, or set Security to **None** |

The values in the table above were checked on SINUMERIK 828D controls. Other versions may give some values under other names.

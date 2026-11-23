# Machines and files

## Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Get status of all machines |
| GET | `/api/health` | Server health check: `{ status, uptime, version }`. Needs no login |

## CNC machines

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machines` | List all machines |
| POST | `/api/machines` | Add a new machine (Admin). The reply is `201` with the new machine |
| GET | `/api/machine/:id` | Get a specific machine |
| PUT | `/api/machine/:id` | Update machine settings (Admin). Send only the fields to change |
| DELETE | `/api/machine/:id` | Remove a machine (Admin) |

### Add machine request

```json
{
  "type": "brother",
  "name": "Speedio S300",
  "host": "192.168.1.50",
  "dataPort": 10000,
  "ftpPort": 21
}
```

**Validation:**
- `type`, `name`, and `host` are required
- `type` is `brother`, `haas`, `mtconnect`, `fanuc`, or `siemens`
- `host` must be a valid IPv4 address
- Each port must be 1 to 65535
- Two machines cannot have the same IP address and the same data port (`409`)

The data port of each type, and its default:

| Type | Field | Default |
|------|-------|---------|
| Brother | `dataPort` | `10000` |
| Haas | `dataPort` (and `queryPort` for the query port) | `9998` (`queryPort`: `5051`) |
| MTConnect | `mtConnectPort` (and `mtConnectDeviceId`) | `5000` |
| FANUC | `focasPort` | `8193` |
| Siemens | `opcuaPort` | `4840` |

### FTP login

Set the FTP login with `ftpUser` and `ftpPassword`, when you add or update a machine.
Use the same username and password that are set on the machine control.
- The server never sends the password back. Machine replies and live events give only `hasFtpPassword` (true or false).
- An update with no `ftpPassword` keeps the saved password. An empty `ftpPassword` (`""`) removes it.
- Exception: when a password is saved and the update changes `host` or `ftpPort`, send `ftpPassword` again. To remove the password, send `""`. Else the reply is `400` and the server saves nothing. Chatter does not send a saved password to a new address.
- An empty `ftpUser` means `anonymous`.

### OPC UA login (Siemens)

A Siemens machine also takes `opcuaUser`, `opcuaPassword`, and `opcuaSecurity` (`none` or `signAndEncrypt`, default `none`).
- An empty `opcuaUser` means an anonymous login.
- The password works like the FTP password: the server never sends it back (replies give only `hasOpcuaPassword`), an update with no `opcuaPassword` keeps it, and `""` removes it.
- When an OPC UA password is saved and the update changes `host` or `opcuaPort`, send `opcuaPassword` again, or `""` to remove it. Else the reply is `400` and the server saves nothing. A new `host` needs each saved password: the FTP password and the OPC UA password.
- `macros` are R parameters: `{ "location": 5 }` reads `R5`.

See [Siemens machines](../guide/siemens.md).

## Find machines (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/discovery/ranges` | The address ranges where the machines probably are, best guess first: `{ ranges: ["192.168.1"] }` |
| POST | `/api/discovery/scan` | Scan the 254 addresses of one local range: `{ "range": "192.168.1" }`. The reply is `{ range, found: [{ machine, isConfirmed, detail }] }`. `409` while another scan runs |
| POST | `/api/mtconnect/scan-port` | Find the port of the MTConnect agent on a computer: `{ "host": "192.168.1.60" }`. The reply is `{ host, ports, recommendedPort }` |

The scan finds only machines that are not added yet. To add a found machine, send its `machine` to `POST /api/machines`.
`isConfirmed` is false when Chatter saw only an open port, and could not ask the machine what it is.

## Machine file management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/:id/files` | List files. Query: `path` (default `.`) and `depth` (1 to 5, default `2`). Other values of `depth` get `400`. A list has at most 5000 files and folders. Chatter opens at most 200 folders, reads at most 1 MB of one folder list, and stops after 2 minutes. When Chatter cuts the list short, the reply has the header `X-Chatter-List-Cut-Short: true` |
| GET | `/api/machine/:id/files/download` | Download a file (Operator or Admin). Query: `path`. A file is at most 64 MB, and a download stops after 30 minutes. When the machine refuses the file (for example `550`), the reply is an error with the reply of the machine. When the client closes the connection, Chatter stops the transfer from the machine and frees its FTP connection. This is also true when the machine has not sent the first byte of the file. |
| POST | `/api/machine/:id/files/upload` | Upload a single file (Operator or Admin). Form fields: `file`, `path`, `overwrite`, `targetName`. `409` when the file exists and `overwrite` is not `true` |
| POST | `/api/machine/:id/files/upload-batch` | Upload multiple files (Operator or Admin). Form fields: `files`, `basePath`, `overwrite`, `targetNames`. The reply is `{ success, failed }` |
| DELETE | `/api/machine/:id/files` | Delete a file (Operator or Admin). Query: `path`. The audit log gets the file name (see [Audit log](../guide/logs.md#audit-log)) |

The upload form fields:
- `path`: the full path of the file on the machine. `basePath`: the folder on the machine.
- `overwrite`: `true` or `false` (default `false`).
- `targetName`: the name of the file on the machine. `targetNames`: JSON text that gives the name on the machine for each file name.

## Upload history

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/:id/uploads` | Get upload history for a machine. Query: `limit` (default `50`) |
| GET | `/api/machine/:id/uploads/:fileId/events` | Get upload events for a file, newest first |
| GET | `/api/machine/:id/uploads/events/:eventId` | Get specific upload event with content (Operator or Admin) |

Each upload event has these fields:

- `id`, `target_name` (the name on the machine), `remote_path` and `uploaded_at`.
- `action`: `sent`. Each event is a send. The audit log records a delete.
- `uploaded_by`: the user who sent the file. Only an Operator and an Admin get this field. A Viewer does not.
- `address`: the address of the computer of that user. Only an Admin gets this field.
- `file_content`: the text of the program. Only the event with `:eventId` has it.

An event from before Chatter recorded the user has `null` in `uploaded_by` and `address`.

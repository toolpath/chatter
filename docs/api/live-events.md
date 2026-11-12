# Live events

`GET /api/events` sends live machine status as server-sent events (SSE).
SSE is one long HTTP reply that the server adds to. The browser `EventSource` reconnects by itself.
The data of each event is JSON. Every 25 seconds, the server also sends a comment line (`: keep-alive`), so that a proxy does not close a quiet connection.

| Event | Data | When |
|-------|------|------|
| `machines` | every machine (the same list as `/api/status`) | first, and again after each reconnect |
| `machine` | one machine | its status changed |
| `machine-removed` | `{ "id": "..." }` | the machine was removed |

```bash
curl -N -u <username>:<password> http://localhost:3001/api/events
```

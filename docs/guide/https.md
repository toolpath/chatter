# Use HTTPS

Chatter serves plain HTTP. To use HTTPS, put a reverse proxy in front of it, for example Caddy or nginx.
A reverse proxy is a server that takes the HTTPS requests from the browsers, and sends them on to Chatter.

## Set up the proxy

1. Set up the proxy to send the requests to Chatter on port 3001, with the `X-Forwarded-For` and `X-Forwarded-Proto` headers.
   Caddy sends these headers by itself. For nginx, add:
   ```nginx
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   ```
2. Open Chatter through the proxy, and log in as an Admin. Go to **Settings > HTTPS and proxy**.
   The proxy is in the list **Computers that sent proxy headers**. Click **Trust** on its line.
   You can also type its address in **Add a proxy address or range**.
   Do not trust a wide range, like `172.16.0.0/12`, if normal users also have addresses in it.
3. Reload the page. At the bottom, **This page came** shows **Over HTTPS**, and **Through the proxy** shows the address of the proxy.
4. Let only the proxy reach port 3001. This step is part of the security: a computer that reaches port 3001 directly, from a trusted address, can send a false user address.
   If the proxy runs on the same computer, change `"3001:3001"` to `"127.0.0.1:3001:3001"`, then run `docker compose up -d`. Else, use a firewall rule.

Chatter believes the `X-Forwarded-*` headers only from the trusted addresses, because any computer can send them.
Only one proxy in front of Chatter is supported.

## Set the trusted addresses in a file

You can also set the trusted addresses with the `TRUST_PROXY` environment variable, for example in `docker-compose.yml` (see the example in the file). Then run `docker compose up -d`.
Put commas between more than one address or range. A wrong value stops Chatter at the start, and the log tells which entry is wrong.
When `TRUST_PROXY` is set, it always wins, and you cannot change the list in Settings.
Without Docker, set it before the start: `TRUST_PROXY=127.0.0.1 npm run start -w apps/server`.

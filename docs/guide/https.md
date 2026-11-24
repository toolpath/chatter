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
2. Open Chatter through the proxy, and log in as an Admin. If no Admin exists yet, first do the setup at the IP address of Chatter, not through the proxy. Chatter accepts the first-run setup only at a local address. Go to **Settings > HTTPS and proxy**.
   The proxy is in the list **Computers that sent proxy headers**. Click **Trust** on its line.
   You can also type its address in **Add a proxy address or range**.
   Do not trust a wide range, like `172.16.0.0/12`, if normal users also have addresses in it.
3. Reload the page. At the bottom, **This page came** shows **Over HTTPS**, and **Through the proxy** shows the address of the proxy.
4. Let only the proxy reach port 3001. This step is part of the security: a computer that reaches port 3001 directly, from a trusted address, can send a false user address.
   - **The proxy runs directly on the same computer, not in Docker.** Make a file with the name `.env` next to `docker-compose.yml`, with the line `CHATTER_BIND_ADDRESS=127.0.0.1`. Then run `docker compose up -d`. An update does not change the `.env` file. See [Publish Chatter on one address](../security.md#publish-chatter-on-one-address). Did you change `"3001:3001"` to `"127.0.0.1:3001:3001"` in an older `docker-compose.yml`? Do not change the new line. Use the `.env` file.
   - **The proxy runs in a Docker container on the same computer.** Do not use `CHATTER_BIND_ADDRESS=127.0.0.1`. This proxy connects through the gateway of the Docker network (the `TRUST_PROXY: "172.18.0.1"` example in `docker-compose.yml`), so it cannot reach `127.0.0.1` of the computer. Use a rule in the `DOCKER-USER` chain, and leave out `! -s <proxy address>`. The rule then stops each computer on the network. The proxy container can still reach Chatter, because its traffic does not come in on the network interface.
   - **The proxy runs on a different computer.** Use a rule in the `DOCKER-USER` chain. Put the address of the proxy after `! -s`, not the address of your network:
     ```bash
     sudo iptables -I DOCKER-USER -i <LAN interface> -p tcp -m conntrack --ctorigdstport 3001 --ctdir ORIGINAL ! -s <proxy address> -j DROP
     ```

   A ufw or firewalld rule does not limit a port that Docker publishes. For `<LAN interface>`, and to keep the rule after a restart, see [Limit who can reach Chatter](../security.md#limit-who-can-reach-chatter).
5. Stop all old logins after a move to HTTPS. Before the move, other people on the network could read a login cookie. Each user does these steps:
   1. Open Chatter through the proxy. In **Settings > Your account**, click **Log out**.
   2. Log in again through the proxy. The browser then gets a new login cookie.
   3. In **Settings > Your account**, click **Log out all other browsers**.
   4. On each other browser, log in again through the proxy.

   This step stops each copy of an old cookie. **Log out all other browsers** alone does not stop the old login of the browser that you use, so do not skip **Log out**.

Chatter believes the `X-Forwarded-*` headers only from the trusted addresses, because any computer can send them.
Only one proxy in front of Chatter is supported.

A browser that logged in over plain HTTP before the move keeps that login. The login ends when the browser is not used for 14 days, and 1 year after the login at the latest. A visible Chatter page counts as a use. A hidden tab does not.

A login cookie from plain HTTP has no Secure flag, so the browser can also send it over plain HTTP. When the browser uses the login through the proxy, Chatter gives it the same cookie again, with the Secure flag. Then the browser sends that cookie only over HTTPS. This does not stop a copy of the cookie that a person already read. Only step 5 stops that copy.

After the move, use only the HTTPS address of the proxy for that host name. The browser does not send a cookie with the Secure flag over plain HTTP. So a plain HTTP address of the same host name, for example `http://chatter.local:3001`, shows the login page again, also after a login.

## Security headers from the proxy

Chatter sends its own security headers on each reply. It does not send HSTS (`Strict-Transport-Security`), because HSTS on a LAN address can stop the access to Chatter.
When all users open Chatter through the proxy, you can set the proxy to add HSTS.

Do not set the proxy to add a second `Content-Security-Policy` or `X-Frame-Options` header.
Chatter already sends them. If the proxy adds a second Content-Security-Policy, the browser obeys the two policies together, and the page can stop working.

## Set the trusted addresses in a file

You can also set the trusted addresses with the `TRUST_PROXY` environment variable, for example in `docker-compose.yml` (see the example in the file). Then run `docker compose up -d`.
Put commas between more than one address or range. A wrong value stops Chatter at the start, and the log tells which entry is wrong.
When `TRUST_PROXY` is set, it always wins, and you cannot change the list in Settings.
Without Docker, set it before the start: `TRUST_PROXY=127.0.0.1 npm run start -w apps/server`.

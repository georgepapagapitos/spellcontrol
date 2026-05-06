# Wiring binder behind Nginx Proxy Manager

Matches the existing rubygal.com pattern: NPM proxies to the host LAN IP and a
published container port (same shape as jellyfin / overseerr / plex).

## 1. Bring up the binder stack

From the repo root on the server:

```bash
docker compose up -d --build
```

This publishes:
- `binder-frontend` on host port `8088`
- `binder-backend`  on host port `3737`

Both bind to all interfaces by default — your LAN can reach them directly,
which is fine since only NPM is exposed to the public internet.

## 2. Add a Cloudflare DNS record

In Cloudflare → DNS → Records, add:
- Type: `A`
- Name: `binder`
- IPv4: `65.128.254.227` (same as the other rubygal.com records)
- Proxy status: **Proxied** (orange cloud, matches the existing setup)

Then add `binder` to `/srv/docker/cloudflare-ddns/config.json`'s subdomain list
and restart that stack so future home-IP changes propagate.

## 3. Add a Proxy Host in NPM

In the NPM admin UI, add a new Proxy Host:

**Details tab**
- Domain Names: `binder.rubygal.com`
- Scheme: `http`
- Forward Hostname / IP: `192.168.0.28`
- Forward Port: `8088`
- Block Common Exploits: on
- Websockets Support: off

**Custom locations tab** — add one:
- Define location: `/api`
- Scheme: `http`
- Forward Hostname / IP: `192.168.0.28`
- Forward Port: `3737`
- Click the gear icon and paste:

  ```
  client_max_body_size 25m;
  proxy_read_timeout 180s;
  proxy_send_timeout 180s;
  ```

**SSL tab**
- Use whichever method you used for jellyfin / requests / watch. If those
  certs were issued via DNS challenge with a Cloudflare API token, do the same
  here. If they were issued via HTTP-01 with the record temporarily set to
  DNS-only, do the same: grey-cloud the new `binder` record, request the
  cert, then flip back to orange.
- Force SSL: on
- HTTP/2 Support: on

Save.

## 4. Optional: gate test users with Cloudflare Access

For a closed beta, Cloudflare Access (free up to 50 users) lets you put email
auth in front of `binder.rubygal.com` without writing any auth code. Configure
it on the Cloudflare side under Zero Trust → Access → Applications.

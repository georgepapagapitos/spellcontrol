# Wiring binder behind Nginx Proxy Manager

Matches the existing rubygal.com pattern: NPM proxies to the host LAN IP and a
published container port (same shape as jellyfin / overseerr / plex).

## 1. Bring up the binder stack

Images are published to GHCR by the `Build & publish images` GitHub Actions
workflow on every merge to `main`. The server only needs `docker-compose.yml`
— no source checkout required.

```bash
sudo mkdir -p /srv/docker/mtg-binder-planner
cd /srv/docker/mtg-binder-planner
sudo curl -fsSL \
  https://raw.githubusercontent.com/georgepapagapitos/mtg-binder-planner/main/docker-compose.yml \
  -o docker-compose.yml
sudo docker compose pull
sudo docker compose up -d
```

This publishes:
- `binder-frontend` on host port `8088`
- `binder-backend`  on host port `3737`

Both bind to all interfaces by default — your LAN can reach them directly,
which is fine since only NPM is exposed to the public internet.

### Updates

Watchtower (already running on this host) will detect new `:latest` images
within its poll interval and recreate the containers automatically. The
backend's SQLite cache survives because `binder-data` is a named volume.

To force an immediate update without waiting for Watchtower:

```bash
cd /srv/docker/mtg-binder-planner
sudo docker compose pull && sudo docker compose up -d
```

### GHCR auth (only if the package is private)

By default GHCR packages inherit the repo's visibility. If the repo is public
the `:latest` tag is pullable without auth — nothing to do. If you make the
package private later, you'll need to log in once on the server:

```bash
echo $GHCR_PAT | sudo docker login ghcr.io -u georgepapagapitos --password-stdin
```

(PAT needs `read:packages` scope.)

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

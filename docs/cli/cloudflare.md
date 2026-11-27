# Cloudflare Tunnel: opening the panel from the internet

The panel only listens on `127.0.0.1`. From outside, it is reached through Cloudflare Tunnel: the
phone connects out to Cloudflare, so you need no public IP and no open router port.
You need a domain that already uses Cloudflare.

## What the panel does by itself

Once the tunnel exists and the panel is open, you never touch the tunnel for sites again.
Create a site in the panel: it adds a route to `~/.cloudflared/config.yml` (checked first with
`cloudflared tunnel ingress validate`), creates the DNS record, then restarts cloudflared.
DNS uses the Cloudflare API token in Administration → Settings when set (Zone:Read and
DNS:Edit permissions), or the cloudflared login on the phone.

## Once at the start: `panel init` does it

`panel init` runs `cloudflared tunnel login` and opens its link in the phone's browser.
Pick your domain on the Cloudflare page; the result is `~/.cloudflared/cert.pem`. Then init creates
(or reuses) a tunnel, writes `~/.cloudflared/config.yml`, creates the DNS record of the panel
domain and installs cloudflared as a runit service. If that domain already points at another
tunnel, init asks before moving it.

## Setting it up yourself (without init, or `panel init --skip tunnel`)

1. `cloudflared tunnel login`, open the link, pick the domain.
2. `cloudflared tunnel create <name>`. Tunnel id: `cloudflared tunnel list`.
3. Write `~/.cloudflared/config.yml`:

```
tunnel: <name>
credentials-file: /data/data/com.termux/files/home/.cloudflared/<id>.json
ingress:
  - hostname: panel.<domain>
    service: http://localhost:3200
  - service: http_status:404
```

4. Check it: `cloudflared tunnel ingress validate`
5. Create the panel DNS record: `cloudflared tunnel route dns <name> panel.<domain>`
6. Write `$PREFIX/var/service/cloudflared/run` with these three lines, then `sv-enable cloudflared`:

```
#!/data/data/com.termux/files/usr/bin/sh
export HOME=/data/data/com.termux/files/home
exec cloudflared tunnel --no-autoupdate run <name> 2>&1
```

7. Set `APP_BASE_URL=https://panel.<domain>` in `~/panel/.env`, then `sv restart panel`.

## Protect the private pages with Cloudflare Access

In the Cloudflare dashboard: Zero Trust → Access controls → Applications → Self-hosted.
One application, one public hostname per path: `panel`, `dev`, `api/panel`, `api/dev`
(no `/*`). Policy Allow → Emails with the owner's email. Never leave Path empty:
the landing page and Google sign-in must stay public. Details: README, section Install on the phone.

## Secrets

- `cert.pem`, `<id>.json` and the tunnel token are like your house keys. Do not share them.
- Do not run commands that print the token (`cloudflared tunnel token`) in front of others
  or in a chat. The panel never shows it.

Check the tunnel and services: `panel doctor`. Upgrading cloudflared: `panel docs packages`.

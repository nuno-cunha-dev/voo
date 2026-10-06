# addon2m3u

Portugal-only M3U service with lazy watch-time resolving. Built with Bun + Hono, deployed to Cloudflare Workers.

Upstream addon is never exposed to players: the playlist contains OUR internal `/watch/` URLs, and each `/watch/:id` resolves the live NoFreeze URL at watch-time (302).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nuno-cunha-dev/voo)

- Catalog: `GET {ADDON_BASE}/catalog/tv/vavoo_tv_pt.json[?skip=N]` (`PAGE_SIZE=100`, empty array when done)
- Streams: `GET {ADDON_BASE}/stream/tv/<encodeURIComponent(meta.id)>.json` → first `name === "NoFreeze"` (case-insensitive; title `[⚡] ... (No-Freeze)`)

## Run

```bash
bun install
bun run dev            # wrangler dev on :8787
# or
bun run dev:worker
```

Smoke test (with dev server running):

```bash
curl -s http://localhost:8787/health
curl -s http://localhost:8787/playlist.m3u | head -20
curl -I http://localhost:8787/watch/<encodeURIComponent(meta.id)>
```

## Deploy

1-click (recommended): hit the **Deploy to Cloudflare** button above, then set `ADDON_BASE` (default `https://tvvoo.hayd.uk`) when prompted.

Or manually:

```bash
bunx wrangler deploy
```

## Env vars (wrangler.toml `[vars]`)

| Var | Default | Description |
| --- | ------- | ----------- |
| `ADDON_BASE` | `https://tvvoo.hayd.uk` | Upstream Stremio addon origin |
| `CATALOG_TTL_SECONDS` | `21600` (6h) | `caches.default` TTL + `Cache-Control: max-age` for the playlist |

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/playlist.m3u` | Full Portugal M3U (absolute `/watch/` URLs) |
| GET | `/pt.m3u` | Alias of `/playlist.m3u` |
| GET | `/watch/:id` | 302 to NoFreeze URL; forwards `CF-Connecting-IP`/`X-Forwarded-For`; `404` when no NoFreeze, `502` on upstream failure; `Cache-Control: no-store` |
| GET | `/health` | `{ "ok": true }` |

Playlist response headers:

- `Content-Type: audio/x-mpegurl`
- `Content-Disposition: attachment; filename="pt.m3u"`
- `Cache-Control: public, max-age=<TTL>`

M3U entry example:

```m3u
#EXTM3U
#EXTINF:-1 tvg-id="pt-eurosport-1" tvg-logo="https://..." group-title="Portugal",EuroSport 1
https://<this-worker>/watch/vavoo_EuroSport%25201%7Cgroup%3Apt
```

Notes:

- No EPG in v1.
- `tvg-logo` is omitted when the catalog has no logo or it is a `placehold.co` placeholder.
- Never embeds NoFreeze URLs — only NoFreeze, resolved at watch-time.

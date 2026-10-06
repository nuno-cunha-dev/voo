/**
 * addon2m3u — Portugal M3U service with lazy watch-time resolving.
 *
 * - GET /playlist.m3u (+ alias /pt.m3u): M3U with OUR internal /watch/ URLs
 * - GET /watch/:id: 302 to the live NoFreeze URL (resolved at watch-time)
 * - GET /health: { ok: true }
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { fetchAllPortugalMetas, fetchNoFreezeUrl } from "./addonClient.ts";
import { buildM3U } from "./m3u.ts";
import { sortMetasByPriority } from "./order.ts";

type Bindings = {
  ADDON_BASE: string;
  CATALOG_TTL_SECONDS?: string;
};

type AppContext = Context<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

function getTtlSeconds(env: Bindings): number {
  const raw: string = env.CATALOG_TTL_SECONDS ?? "21600";
  const parsed: number = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 21600;
}

function getClientIp(c: AppContext): string | undefined {
  const cfIp: string | undefined = c.req.header("CF-Connecting-IP");
  if (cfIp && cfIp.trim() !== "") {
    return cfIp.trim();
  }
  const forwarded: string | undefined = c.req.header("X-Forwarded-For");
  if (forwarded && forwarded.trim() !== "") {
    const first: string | undefined = forwarded.split(",")[0]?.trim();
    if (first && first !== "") {
      return first;
    }
  }
  return undefined;
}

async function handlePlaylist(c: AppContext): Promise<Response> {
  const ttl: number = getTtlSeconds(c.env);
  const base: string = c.env.ADDON_BASE;

  if (!base || base.trim() === "") {
    return c.json({ error: "ADDON_BASE is not configured" }, 500);
  }

  const cacheKey = new Request(c.req.url, { method: "GET" });
  const cacheAvailable: boolean =
    typeof caches !== "undefined" && typeof (caches as CacheStorage).default !== "undefined";

  if (cacheAvailable) {
    try {
      const cached: Response | undefined = await caches.default.match(cacheKey);
      if (cached) {
        return new Response(cached.body, cached);
      }
    } catch {
      // Cache read failures must not break the playlist — fall through.
    }
  }

  let m3u: string;
  try {
    const metas = sortMetasByPriority(await fetchAllPortugalMetas(base));
    const origin: string = new URL(c.req.url).origin;
    m3u = buildM3U(metas, origin);
  } catch (err) {
    const message: string = (err as Error).message ?? "catalog fetch failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const res = new Response(m3u, {
    headers: {
      "content-type": "audio/x-mpegurl; charset=utf-8",
      "content-disposition": 'attachment; filename="pt.m3u"',
      "cache-control": `public, max-age=${ttl}`,
    },
  });

  if (cacheAvailable) {
    try {
      const toCache = new Response(m3u, {
        headers: {
          "content-type": "audio/x-mpegurl; charset=utf-8",
          "content-disposition": 'attachment; filename="pt.m3u"',
          "cache-control": `public, max-age=${ttl}`,
        },
      });
      c.executionCtx.waitUntil(caches.default.put(cacheKey, toCache));
    } catch {
      // Cache write failures are non-fatal.
    }
  }

  return res;
}

app.get("/playlist.m3u", (c) => handlePlaylist(c));
app.get("/pt.m3u", (c) => handlePlaylist(c));

app.get("/watch/:id", async (c) => {
  const metaId: string = c.req.param("id");
  if (!metaId || metaId.trim() === "") {
    return c.json({ error: "missing channel id" }, 404);
  }

  const base: string = c.env.ADDON_BASE;
  if (!base || base.trim() === "") {
    return c.json({ error: "ADDON_BASE is not configured" }, 500);
  }

  const clientIp: string | undefined = getClientIp(c);

  let target: string | null;
  try {
    target = await fetchNoFreezeUrl(base, metaId, clientIp);
  } catch (err) {
    const message: string = (err as Error).message ?? "stream fetch failed";
    console.error(`[watch] ${metaId} failed: ${message}`);
    return c.json({ error: message }, 502);
  }

  if (!target) {
    console.warn(`[watch] ${metaId} not found: NoFreeze stream not found`);
    return c.json({ error: "NoFreeze stream not found" }, 404);
  }

  console.log(`[watch] ${metaId} -> ${target}`);
  return new Response(null, {
    status: 302,
    headers: { location: target, "cache-control": "no-store" },
  });
});

app.get("/health", (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
};

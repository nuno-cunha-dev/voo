/**
 * Upstream Stremio addon client (Portugal catalog + NoFreeze resolver).
 *
 * Upstream API (verified):
 * - GET {base}/catalog/tv/vavoo_tv_pt.json[?skip=N]
 *   -> { metas: [{ id, name, logo, genres }] }, PAGE_SIZE=100,
 *      empty array when done.
 *   id format: vavoo_<urlEncodedName>|group:pt
 * - GET {base}/stream/tv/<encodeURIComponent(meta.id)>.json
 *   -> { streams: [{ name, title, url }] }, pick first name === "NoFreeze"
 *      (case-insensitive; title looks like "[⚡] ... (No-Freeze)").
 *   URL looks like {ADDON}/live/manifest.m3u8?url=...
 *   Never embed NoFreeze URLs — only resolve NoFreeze at watch-time.
 */

/** Single catalog entry from the upstream addon. */
export interface PortugalMeta {
  id: string;
  name: string;
  logo?: string;
  genres?: string[];
}

/** Number of items per catalog page. */
export const PAGE_SIZE: number = 100;

/** Safety cap on paginated catalog fetches (100 * 10 = 1000 channels max). */
export const MAX_PAGES: number = 10;

/** Catalog id for the Portugal TV list. */
export const CATALOG_ID: string = "vavoo_tv_pt";

/**
 * Fetch a single catalog page.
 *
 * @param base - Upstream addon base URL (e.g. https://tvvoo.hayd.uk)
 * @param skip - Pagination offset (0, 100, 200, ...)
 * @returns Array of metas (empty when pagination is exhausted)
 * @throws Error when the upstream response is not OK or has an unexpected shape
 */
export async function fetchCatalogPage(base: string, skip: number): Promise<PortugalMeta[]> {
  if (!base || base.trim() === "") {
    throw new Error("Addon base URL must not be empty");
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new Error(`skip must be a non-negative integer, got ${skip}`);
  }

  const normalizedBase: string = base.replace(/\/+$/, "");
  const path: string =
    skip > 0
      ? `/catalog/tv/${CATALOG_ID}.json?skip=${skip}`
      : `/catalog/tv/${CATALOG_ID}.json`;
  const url: string = `${normalizedBase}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
    });
  } catch (err) {
    throw new Error(`Failed to fetch catalog page (skip=${skip}): ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new Error(`Catalog page fetch failed (skip=${skip}): HTTP ${res.status}`);
  }

  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null || !("metas" in data)) {
    throw new Error(`Unexpected catalog shape (skip=${skip}): missing "metas"`);
  }

  const metas: unknown = (data as { metas: unknown }).metas;
  if (!Array.isArray(metas)) {
    throw new Error(`Unexpected catalog shape (skip=${skip}): "metas" is not an array`);
  }

  return metas as PortugalMeta[];
}

/**
 * Fetch the full Portugal catalog by paging until an empty page.
 *
 * Deduplicates by meta id: some upstreams ignore `skip` and return the
 * full list on every page, so we stop when a page yields no NEW ids.
 *
 * @param base - Upstream addon base URL
 * @returns All unique metas across pages (up to MAX_PAGES)
 */
export async function fetchAllPortugalMetas(base: string): Promise<PortugalMeta[]> {
  const all: PortugalMeta[] = [];
  const seen: Set<string> = new Set();

  for (let page: number = 0; page < MAX_PAGES; page++) {
    const skip: number = page * PAGE_SIZE;
    const metas: PortugalMeta[] = await fetchCatalogPage(base, skip);
    if (metas.length === 0) {
      break;
    }
    let newInPage: number = 0;
    for (const meta of metas) {
      if (!meta || !meta.id || seen.has(meta.id)) {
        continue;
      }
      seen.add(meta.id);
      all.push(meta);
      newInPage++;
    }
    if (newInPage === 0) {
      break;
    }
    if (metas.length < PAGE_SIZE) {
      break;
    }
  }

  return all;
}

/**
 * Resolve the NoFreeze stream URL for a channel at watch-time.
 *
 * Picks the first stream with name === "NoFreeze" (case-insensitive; the addon
 * emits name "NoFreeze", title "[⚡] ... (No-Freeze)"). The URL looks like
 * {ADDON}/live/manifest.m3u8?url=... Returns null when no NoFreeze entry
 * exists — never falls back to Vavoo.
 *
 * @param base - Upstream addon base URL
 * @param metaId - Full catalog meta id (e.g. vavoo_EuroSport%201|group:pt)
 * @param clientIp - Optional end-user IP to forward via X-Forwarded-For
 * @returns NoFreeze URL, or null when unavailable
 * @throws Error on network failure or non-OK upstream status
 */
export async function fetchNoFreezeUrl(
  base: string,
  metaId: string,
  clientIp?: string,
): Promise<string | null> {
  if (!base || base.trim() === "") {
    throw new Error("Addon base URL must not be empty");
  }
  if (!metaId || metaId.trim() === "") {
    throw new Error("metaId must not be empty");
  }

  const normalizedBase: string = base.replace(/\/+$/, "");
  const url: string = `${normalizedBase}/stream/tv/${encodeURIComponent(metaId)}.json`;

  const headers: Record<string, string> = { accept: "application/json" };
  if (clientIp && clientIp.trim() !== "") {
    headers["X-Forwarded-For"] = clientIp.trim();
  }

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new Error(`Failed to fetch streams for ${metaId}: ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new Error(`Stream fetch failed for ${metaId}: HTTP ${res.status}`);
  }

  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null || !("streams" in data)) {
    return null;
  }
  const streams: unknown = (data as { streams: unknown }).streams;
  if (!Array.isArray(streams)) {
    return null;
  }

  for (const s of streams) {
    if (
      typeof s === "object" &&
      s !== null &&
      typeof (s as { name?: unknown }).name === "string" &&
      ((s as { name: string }).name.toLowerCase() === "nofreeze") &&
      typeof (s as { url?: unknown }).url === "string" &&
      ((s as { url: string }).url.trim() !== "")
    ) {
      return (s as { url: string }).url;
    }
  }

  return null;
}

/** Deprecated alias kept so older imports keep working. Use fetchNoFreezeUrl. */
export const fetchVavooUrl = fetchNoFreezeUrl;

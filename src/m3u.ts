/**
 * Pure M3U playlist builders.
 */
import type { PortugalMeta } from "./addonClient.ts";
import { renameElevenToDazn } from "./order.ts";

/**
 * Build a stable, URL-safe channel slug from a meta id + display name.
 *
 * Example: ("vavoo_EuroSport%201|group:pt", "EuroSport 1") -> "pt-eurosport-1"
 *
 * @param metaId - Full upstream meta id (fallback source when name is blank)
 * @param name - Human-readable channel name
 * @returns Slug prefixed with "pt-"
 */
export function slugId(metaId: string, name: string): string {
  const source: string = name && name.trim() !== "" ? name : metaId;
  let slug: string = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (slug === "") {
    slug = "channel";
  }
  if (!slug.startsWith("pt-")) {
    slug = `pt-${slug}`;
  }
  return slug;
}

/**
 * Escape a value used inside a quoted EXTINF attribute.
 *
 * @param value - Raw attribute value
 * @returns Value safe to embed inside double quotes
 */
export function escapeAttr(value: string): string {
  return value.replace(/"/g, "'").replace(/[\r\n]+/g, " ").trim();
}

/**
 * Escape the display name shown after the comma in #EXTINF.
 *
 * Commas would confuse naive M3U parsers, so they become semicolons.
 *
 * @param name - Raw channel name
 * @returns Safe display name
 */
export function escapeDisplayName(name: string): string {
  return name.replace(/,/g, ";").replace(/[\r\n]+/g, " ").trim();
}

/**
 * Decide whether a logo URL is usable in the playlist.
 *
 * placehold.co placeholders carry no value, so they are omitted.
 *
 * @param logo - Logo URL from the catalog (may be undefined)
 * @returns True when the logo should be emitted as tvg-logo
 */
export function isUsableLogo(logo: string | undefined): boolean {
  if (!logo || logo.trim() === "") {
    return false;
  }
  return !logo.includes("placehold.co");
}

/**
 * Build a full M3U playlist with OUR internal lazy-resolve watch URLs.
 *
 * Each entry points at {baseUrl}/watch/{encodeURIComponent(meta.id)} so the
 * NoFreeze URL is resolved at watch-time, never embedded.
 *
 * @param metas - Catalog entries
  * @param baseUrl - Public origin (e.g. https://voo.workers.dev), no trailing slash
 * @returns M3U playlist text
 */
export function buildM3U(metas: PortugalMeta[], baseUrl: string): string {
  const origin: string = baseUrl.replace(/\/+$/, "");
  const lines: string[] = ["#EXTM3U"];
  const seenSlugs: Map<string, number> = new Map();

  for (const meta of metas) {
    if (!meta || !meta.id) {
      continue;
    }
    const rawName: string =
      meta.name && meta.name.trim() !== "" ? meta.name.trim() : meta.id;
    // Display-only rename: meta.id stays untouched for /watch/ URLs.
    const displayName: string = renameElevenToDazn(rawName);

    let tvgId: string = slugId(meta.id, displayName);
    const count: number = seenSlugs.get(tvgId) ?? 0;
    seenSlugs.set(tvgId, count + 1);
    if (count > 0) {
      tvgId = `${tvgId}-${count + 1}`;
    }

    const attrs: string[] = [`tvg-id="${escapeAttr(tvgId)}"`];
    if (isUsableLogo(meta.logo)) {
      attrs.push(`tvg-logo="${escapeAttr(meta.logo as string)}"`);
    }
    attrs.push(`group-title="${escapeAttr("Portugal")}"`);

    lines.push(`#EXTINF:-1 ${attrs.join(" ")},${escapeDisplayName(displayName)}`);
    lines.push(`${origin}/watch/${encodeURIComponent(meta.id)}`);
  }

  return lines.join("\n") + "\n";
}

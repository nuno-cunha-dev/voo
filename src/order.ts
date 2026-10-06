/**
 * Sports-first + NOS-grid priority ordering for the Portugal playlist.
 *
 * Sports block first (DAZN native, Eleven Sports, Sport TV, Benfica TV / BTV,
 * Canal 11), then the user-provided NOS grid order below.
 * User-provided NOS grid order (applied after the sports block):
 *   1. RTP1 — 2. RTP2 — 3. SIC (standalone) — 4. TVI (standalone)
 *   5. SIC Notícias — 6. RTP3 — 7. CNN Portugal — 8. CMTV
 *   9. Sport TV 1 — 10. Canal 11 — 11. Canal Panda — 12. Nickelodeon
 *   13. Hollywood — 14. FOX / Star Channel
 *
 * Matching rule (documented):
 * - Names are normalized via {@link normalizeChannelName}: lowercase, NFD
 *   strip diacritics, non-alphanumerics -> single space, collapse, trim.
 *   A compact (spaceless) form is also compared so "RTP1" matches "RTP 1",
 *   "SPORTTV1" matches "SPORT TV 1", "CANAL11" matches "CANAL 11", etc.
 * - Channels are matched against {@link NOS_PRIORITY} in list order; the
 *   first matching key determines the rank. Output is ordered by rank.
 * - Standalone short keys ("sic", "tvi") require EXACT equality (after
 *   stripping trailing quality suffixes like HD/FHD/UHD/4K/SD) so "SIC"
 *   never swallows "SIC NOTICIAS" and "TVI" never swallows "TVI 24" /
 *   "TVI FICCAO". "SIC HD" still counts as SIC; "SIC NOTICIAS" falls
 *   through to its own rank; "TVI 24" stays unmatched (upstream order).
 * - All other keys use substring matching on both spaced and compact
 *   forms (so "FOX LIFE" ranks as FOX, "RTP 1 HD" ranks as RTP 1).
 *   Keys ending in a digit additionally require a non-digit boundary
 *   after the match so "SPORT TV 1" never swallows "SPORT TV 15" and
 *   "RTP 1" never swallows "RTP 12".
 * - "NICK JR" is intentionally NOT matched: only the "nickelodeon"
 *   substring ranks (Nick Jr stays in upstream order).
 * - Non-matching channels keep their relative upstream order (stable,
 *   no A-Z resort) after the prioritized block.
 */
import type { PortugalMeta } from "./addonClient.ts";

/** Normalized priority keys in NOS grid order. */
export const NOS_PRIORITY: string[] = [
  "rtp 1",
  "rtp 2",
  "sic",
  "tvi",
  "sic noticias",
  "rtp 3",
  "cnn portugal",
  "cmtv",
  "sport tv 1",
  "canal 11",
  "canal panda",
  "nickelodeon",
  "hollywood",
  "fox",
  "star channel",
];

/** Normalized keys that must match standalone (exact equality). */
const STANDALONE_KEYS: Set<string> = new Set(["sic", "tvi"]);

/** Trailing quality tokens stripped before matching (iteratively). */
const QUALITY_TOKENS: Set<string> = new Set(["uhd", "fhd", "hd", "4k", "sd"]);

/**
 * Rename upstream "Eleven Sports N ..." to "DAZN N ...".
 *
 * Matches case-insensitively, singular/plural ("Sport"/"Sports"), preserves
 * any trailing suffix (HD/FHD/(BACKUP)/...) with a single separating space.
 * Non-Eleven names pass through untouched.
 *
 * Examples: "Eleven Sports 1" -> "DAZN 1",
 * "eleven sport 2 HD" -> "DAZN 2 HD",
 * "Eleven Sports 1 (BACKUP)" -> "DAZN 1 (BACKUP)".
 *
 * @param name - Raw channel display name
 * @returns Renamed display name, or the original when not an Eleven channel
 */
export function renameElevenToDazn(name: string): string {
  if (!name) {
    return name;
  }
  const trimmed: string = name.trim();
  const m: RegExpMatchArray | null = trimmed.match(
    /^eleven\s+sports?\s*(\d+)(.*)$/i,
  );
  if (!m) {
    return name;
  }
  const num: string = m[1] as string;
  const rest: string = (m[2] ?? "").trim();
  if (rest === "") {
    return `DAZN ${num}`;
  }
  return `DAZN ${num} ${rest}`.trim();
}

/**
 * Sports tier for a pre-normalized channel name.
 *
 * Anchored so look-alikes never match:
 * - 0 = native DAZN (`^dazn\b`)
 * - 1 = upstream Eleven (`^eleven\s+sports?\b`)
 * - 2 = Sport TV (`^sport tv\b`)
 * - 3 = Benfica TV / BTV (`^benfica tv\b` or `^btv\b`)
 * - 4 = Canal 11 (`^canal 11\b`)
 * - Infinity = non-sports (Sporting TV, EuroSport, A Bola TV,
 *   Canal 12, Canal 111, Canal Panda, ... never match because of the
 *   `^` anchor + word boundary / digit-boundary guard).
 *
 * Spaceless inputs are also accepted via the compact (spaceless) form:
 * "btv1" / "btvhd" match tier 3, "benficatv..." matches tier 3,
 * "canal11..." (with no digit right after "canal11") matches tier 4.
 *
 * @param normalized - Output of {@link normalizeChannelName}
 * @returns Tier index (0/1/2/3/4) or Infinity for non-sports
 */
export function getSportsTier(normalized: string): number {
  if (!normalized) {
    return Number.POSITIVE_INFINITY;
  }
  if (/^dazn\b/.test(normalized)) {
    return 0;
  }
  if (/^eleven\s+sports?\b/.test(normalized)) {
    return 1;
  }
  if (/^sport tv\b/.test(normalized)) {
    return 2;
  }
  if (/^benfica tv\b/.test(normalized) || /^btv\b/.test(normalized)) {
    return 3;
  }
  if (/^canal 11\b/.test(normalized)) {
    return 4;
  }
  // Spaceless edge: normalizeChannelName("BTV1") -> "btv1" (no word
  // boundary after "btv"), "CANAL11" -> "canal11". Accept via compact form.
  // Any compact string starting with "btv" is BTV-family (no known
  // non-BTV "btv*" collisions in the PT grid); "benficatv*" likewise.
  const compact: string = normalized.replace(/ /g, "");
  if (compact.startsWith("benficatv") || compact.startsWith("btv")) {
    return 3;
  }
  if (/^canal11(?!\d)/.test(compact)) {
    return 4;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Numeric sub-sort within a sports tier.
 *
 * Parses the leading number of the remainder after the tier prefix, so
 * "dazn 1" < "dazn 2" < "dazn 11" (no lexicographic "11 < 2" bug).
 * Quality suffixes ("hd"/"fhd"/...) and "(backup)"-style tails are ignored
 * for the parse because only the leading digits are read. Non-numeric
 * remainders ("+", "nba", bare "sport tv") get Infinity so they sort after
 * all numbered channels in the same tier.
 * Tier 3 (Benfica TV / BTV) parses the same way ("btv 1" < bare "btv");
 * tier 4 (Canal 11) always returns Infinity (single channel, no sub-sort).
 * Spaceless "btv1" is parsed via the compact form ("1").
 *
 * @param normalized - Output of {@link normalizeChannelName}
 * @param tier - Tier from {@link getSportsTier}
 * @returns Channel number, or Infinity when absent/non-sports
 */
export function getSportsNum(normalized: string, tier: number): number {
  if (!Number.isFinite(tier)) {
    return Number.POSITIVE_INFINITY;
  }
  let rest = "";
  if (tier === 0) {
    rest = normalized.replace(/^dazn\b\s*/, "");
  } else if (tier === 1) {
    rest = normalized.replace(/^eleven\s+sports?\b\s*/, "");
  } else if (tier === 2) {
    rest = normalized.replace(/^sport tv\b\s*/, "");
  } else if (tier === 3) {
    rest = normalized.replace(/^benfica tv\b\s*|^btv\b\s*/, "");
    if (rest === normalized) {
      // Spaceless fallback: "btv1" -> "1", "btvhd" -> "hd" (Infinity).
      const compact: string = normalized.replace(/ /g, "");
      rest = compact.replace(/^benficatv|^btv/, "");
    }
  } else if (tier === 4) {
    return Number.POSITIVE_INFINITY;
  } else {
    return Number.POSITIVE_INFINITY;
  }
  const m: RegExpMatchArray | null = rest.match(/^(\d+)/);
  if (!m) {
    return Number.POSITIVE_INFINITY;
  }
  const n: number = parseInt(m[1] as string, 10);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Sports sort key for a raw display name.
 *
 * Convenience wrapper that normalizes then applies {@link getSportsTier} /
 * {@link getSportsNum}. Runs on the ORIGINAL upstream name (not the
 * DAZN-renamed display form) so Eleven stays tier 1 even after rename.
 *
 * @param name - Raw channel name (or id fallback)
 * @returns Tuple-like {tier, num} with Infinity defaults for non-sports
 */
export function getSportsSortKey(name: string): { tier: number; num: number } {
  const normalized: string = normalizeChannelName(name ?? "");
  if (normalized === "") {
    return { tier: Number.POSITIVE_INFINITY, num: Number.POSITIVE_INFINITY };
  }
  const tier: number = getSportsTier(normalized);
  if (!Number.isFinite(tier)) {
    return { tier: Number.POSITIVE_INFINITY, num: Number.POSITIVE_INFINITY };
  }
  return { tier, num: getSportsNum(normalized, tier) };
}

/**
 * Normalize a channel name for priority matching.
 *
 * Lowercases, NFD-strips diacritics, maps every non-alphanumeric run to a
 * single space, collapses whitespace and trims.
 * Example: "SIC Notícias" -> "sic noticias", "RTP-1" -> "rtp 1".
 *
 * @param raw - Raw channel name (or id fallback)
 * @returns Normalized comparison key (may be "")
 */
export function normalizeChannelName(raw: string): string {
  if (!raw) {
    return "";
  }
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove spaces for space-tolerant comparison.
 * Example: "rtp 1" -> "rtp1".
 *
 * @param normalized - Output of {@link normalizeChannelName}
 * @returns Spaceless form
 */
export function compactKey(normalized: string): string {
  return normalized.replace(/ /g, "");
}

/**
 * Strip trailing quality tokens (" hd", " fhd", " uhd", " 4k", " sd").
 *
 * @param normalized - Normalized channel name
 * @returns Name without trailing quality suffixes
 */
function stripQualitySuffix(normalized: string): string {
  let current: string = normalized;
  for (;;) {
    const idx: number = current.lastIndexOf(" ");
    if (idx <= 0) {
      break;
    }
    const tail: string = current.slice(idx + 1);
    if (!QUALITY_TOKENS.has(tail)) {
      break;
    }
    current = current.slice(0, idx);
  }
  return current;
}

/**
 * Check whether a compact remainder (text after the matched key) is only
 * quality tokens, e.g. "hd", "fhd", "uhd", "4k", "sd".
 * Used for spaceless inputs like "sichd" -> remainder "hd".
 *
 * @param remainder - Compact string after removing the key prefix
 * @returns True when the remainder is empty or only quality tokens
 */
function isQualityRemainder(remainder: string): boolean {
  if (remainder === "") {
    return true;
  }
  let rest: string = remainder;
  // Longest tokens first so "fhd" is not consumed as "hd".
  const tokens: string[] = ["uhd", "fhd", "4k", "hd", "sd"];
  for (;;) {
    let consumed = false;
    for (const tok of tokens) {
      if (rest.startsWith(tok)) {
        rest = rest.slice(tok.length);
        consumed = true;
        break;
      }
    }
    if (!consumed) {
      break;
    }
    if (rest === "") {
      return true;
    }
  }
  return rest === "";
}

/**
 * Substring match with a non-digit boundary guard for keys ending in a
 * digit. Prevents "sport tv 1" matching "sport tv 15".
 *
 * @param haystack - Normalized (spaced or compact) channel text
 * @param needle - Priority key in the same form (spaced or compact)
 * @returns True when needle occurs with a non-digit (or end) right after
 */
function includesWithDigitBoundary(haystack: string, needle: string): boolean {
  if (needle === "") {
    return false;
  }
  const needsBoundary: boolean = /[0-9]$/.test(needle);
  if (!needsBoundary) {
    return haystack.includes(needle);
  }
  let from: number = 0;
  for (;;) {
    const idx: number = haystack.indexOf(needle, from);
    if (idx < 0) {
      return false;
    }
    const after: string | undefined = haystack[idx + needle.length];
    if (after === undefined || after === " " || !/[0-9]/.test(after)) {
      return true;
    }
    from = idx + 1;
  }
}

/**
 * Rank a pre-normalized channel name against NOS_PRIORITY.
 *
 * @param normalized - Normalized channel name
 * @param compacted - Spaceless normalized form
 * @param stripped - Normalized name with quality suffixes removed
 * @param strippedCompact - Spaceless stripped form
 * @returns Priority index (0-based) or -1 when unmatched
 */
function rankForParts(
  normalized: string,
  compacted: string,
  stripped: string,
  strippedCompact: string,
): number {
  for (let i = 0; i < NOS_PRIORITY.length; i++) {
    const key: string = NOS_PRIORITY[i] as string;
    const compactNeedle: string = compactKey(key);

    if (STANDALONE_KEYS.has(key)) {
      if (stripped === key || strippedCompact === compactNeedle) {
        return i;
      }
      // Spaceless quality suffix, e.g. "sichd".
      if (
        compacted.startsWith(compactNeedle) &&
        isQualityRemainder(compacted.slice(compactNeedle.length))
      ) {
        // Guard: "sicnoticias" remainder is not quality -> no match.
        // But "sichd" remainder "hd" -> match. Exact equality above
        // already covers the plain case, so only accept when a
        // non-empty quality remainder exists.
        if (compacted.length > compactNeedle.length) {
          return i;
        }
      }
      continue;
    }

    if (stripped === key || strippedCompact === compactNeedle) {
      return i;
    }
    if (
      includesWithDigitBoundary(stripped, key) ||
      includesWithDigitBoundary(strippedCompact, compactNeedle)
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Get the NOS priority rank for a display name.
 *
 * @param name - Raw channel name (falls back to "" when blank)
 * @returns Priority index (0-based) or -1 when the channel is not prioritized
 */
export function getPriorityRank(name: string): number {
  const normalized: string = normalizeChannelName(name ?? "");
  if (normalized === "") {
    return -1;
  }
  const compacted: string = compactKey(normalized);
  const stripped: string = stripQualitySuffix(normalized);
  const strippedCompact: string = compactKey(stripped);
  return rankForParts(normalized, compacted, stripped, strippedCompact);
}

/**
 * Display name used for sorting (name, falling back to id like buildM3U).
 *
 * @param meta - Catalog entry
 * @returns Trimmed name or id
 */
function sortNameOf(meta: PortugalMeta): string {
  if (meta.name && meta.name.trim() !== "") {
    return meta.name.trim();
  }
  return meta.id ?? "";
}

/**
 * Stable sort of catalog metas by sports-first, then NOS-grid priority.
 *
 * Sort key is (sportsTier, sportsNum, nosRank, index):
 * - sportsTier: 0=native DAZN, 1=Eleven Sports, 2=Sport TV,
 *   3=Benfica TV / BTV, 4=Canal 11, Infinity=rest.
 *   Computed from the ORIGINAL upstream name via {@link getSportsSortKey},
 *   so Eleven stays tier 1 even though it displays as DAZN.
 * - sportsNum: trailing channel number within the tier (1 < 2 < 11);
 *   non-numeric ("+", "NBA", bare) sorts after numbered via Infinity.
 *   Tier 4 (Canal 11) always uses Infinity (single channel, no sub-sort).
 * - nosRank: first matching NOS_PRIORITY index (Infinity when unmatched).
 *   NOS_PRIORITY order is unchanged and applies after the sports block.
 * - index: upstream stability for full ties.
 *
 * Never mutates input.
 *
 * @param metas - Catalog entries in upstream order
 * @returns New array with sports first, then NOS priority, rest stable
 */
export function sortMetasByPriority(metas: PortugalMeta[]): PortugalMeta[] {
  const decorated: {
    meta: PortugalMeta;
    sportsTier: number;
    sportsNum: number;
    rank: number;
    index: number;
  }[] = metas.map((meta: PortugalMeta, index: number) => {
    const sortName: string = sortNameOf(meta);
    const sports: { tier: number; num: number } = getSportsSortKey(sortName);
    const rankRaw: number = getPriorityRank(sortName);
    const rank: number = rankRaw < 0 ? Number.POSITIVE_INFINITY : rankRaw;
    return { meta, sportsTier: sports.tier, sportsNum: sports.num, rank, index };
  });
  decorated.sort((a, b) => {
    if (a.sportsTier !== b.sportsTier) {
      return a.sportsTier - b.sportsTier;
    }
    if (a.sportsNum !== b.sportsNum) {
      return a.sportsNum - b.sportsNum;
    }
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.index - b.index;
  });
  return decorated.map((d) => d.meta);
}

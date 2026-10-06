import { describe, expect, test } from "bun:test";
import type { PortugalMeta } from "../src/addonClient.ts";
import { buildM3U } from "../src/m3u.ts";
import {
  NOS_PRIORITY,
  compactKey,
  getPriorityRank,
  getSportsNum,
  getSportsSortKey,
  getSportsTier,
  normalizeChannelName,
  renameElevenToDazn,
  sortMetasByPriority,
} from "../src/order.ts";

function meta(name: string, id?: string): PortugalMeta {
  return { id: id ?? `vavoo_${name}|group:pt`, name };
}

describe("normalizeChannelName", () => {
  test("strips accents, lowercases, collapses separators", () => {
    expect(normalizeChannelName("SIC Notícias")).toBe("sic noticias");
    expect(normalizeChannelName("RTP-1")).toBe("rtp 1");
    expect(normalizeChannelName("  SPORT   TV--1  HD ")).toBe("sport tv 1 hd");
    expect(normalizeChannelName("TVI Ficção")).toBe("tvi ficcao");
    expect(normalizeChannelName("")).toBe("");
  });

  test("compactKey removes spaces for space-tolerant matching", () => {
    expect(compactKey("rtp 1")).toBe("rtp1");
    expect(compactKey("sport tv 1")).toBe("sporttv1");
  });
});

describe("NOS_PRIORITY", () => {
  test("has the user-provided NOS grid order", () => {
    expect(NOS_PRIORITY).toEqual([
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
    ]);
  });
});

describe("getPriorityRank", () => {
  test("space-tolerant: RTP1 matches RTP 1, SPORTTV1 matches SPORT TV 1", () => {
    expect(getPriorityRank("RTP1")).toBe(0);
    expect(getPriorityRank("RTP 1")).toBe(0);
    expect(getPriorityRank("RTP 1 HD")).toBe(0);
    expect(getPriorityRank("SPORTTV1")).toBe(8);
    expect(getPriorityRank("Sport TV 1")).toBe(8);
    expect(getPriorityRank("CANAL11")).toBe(9);
    expect(getPriorityRank("Canal 11")).toBe(9);
  });

  test("accent-tolerant: SIC Notícias matches sic noticias", () => {
    expect(getPriorityRank("SIC Notícias")).toBe(4);
    expect(getPriorityRank("SIC NOTICIAS HD")).toBe(4);
  });

  test("SIC standalone does not swallow SIC NOTICIAS", () => {
    expect(getPriorityRank("SIC")).toBe(2);
    expect(getPriorityRank("SIC HD")).toBe(2);
    // SIC NOTICIAS must fall through to its own rank, not SIC's.
    expect(getPriorityRank("SIC NOTICIAS")).toBe(4);
  });

  test("TVI standalone does not swallow TVI variants", () => {
    expect(getPriorityRank("TVI")).toBe(3);
    expect(getPriorityRank("TVI HD")).toBe(3);
    expect(getPriorityRank("TVI 24")).toBe(-1);
    expect(getPriorityRank("TVI Ficção")).toBe(-1);
  });

  test("numbered keys do not swallow higher numbers", () => {
    expect(getPriorityRank("SPORT TV 15")).toBe(-1);
    expect(getPriorityRank("SPORT TV 2")).toBe(-1);
    expect(getPriorityRank("RTP 12")).toBe(-1);
    expect(getPriorityRank("CANAL 111")).toBe(-1);
  });

  test("FOX family matches, STAR CHANNEL ranks after FOX", () => {
    const foxRank = getPriorityRank("FOX");
    const foxLifeRank = getPriorityRank("FOX LIFE");
    const starRank = getPriorityRank("Star Channel");
    expect(foxRank).toBe(13);
    expect(foxLifeRank).toBe(13);
    expect(starRank).toBe(14);
    expect(foxRank).toBeLessThan(starRank);
  });

  test("Nick Jr is intentionally unmatched", () => {
    expect(getPriorityRank("Nick Jr")).toBe(-1);
    expect(getPriorityRank("Nickelodeon")).toBe(11);
    expect(getPriorityRank("Nickelodeon HD")).toBe(11);
  });

  test("unknown channels are unmatched", () => {
    expect(getPriorityRank("EuroSport 1")).toBe(-1);
    expect(getPriorityRank("")).toBe(-1);
  });
});

describe("sortMetasByPriority", () => {
  test("orders prioritized channels in NOS order regardless of input order", () => {
    const input: PortugalMeta[] = [
      meta("Star Channel"),
      meta("CNN Portugal"),
      meta("RTP 2"),
      meta("SIC Notícias"),
      meta("RTP 1"),
      meta("TVI"),
      meta("SIC"),
      meta("RTP 3"),
    ];
    const names = sortMetasByPriority(input).map((m) => m.name);
    expect(names).toEqual([
      "RTP 1",
      "RTP 2",
      "SIC",
      "TVI",
      "SIC Notícias",
      "RTP 3",
      "CNN Portugal",
      "Star Channel",
    ]);
  });

  test("SIC sorts before SIC NOTICIAS even when input is reversed", () => {
    const input: PortugalMeta[] = [meta("SIC NOTICIAS"), meta("SIC")];
    const names = sortMetasByPriority(input).map((m) => m.name);
    expect(names).toEqual(["SIC", "SIC NOTICIAS"]);
  });

  test("unmatched channels keep relative upstream order after the priority block", () => {
    const input: PortugalMeta[] = [
      meta("EuroSport 1"),
      meta("RTP 1"),
      meta("TVI 24"),
      meta("SIC"),
      meta("Nick Jr"),
    ];
    const names = sortMetasByPriority(input).map((m) => m.name);
    expect(names).toEqual(["RTP 1", "SIC", "EuroSport 1", "TVI 24", "Nick Jr"]);
  });

  test("does not mutate the input array", () => {
    const input: PortugalMeta[] = [meta("SIC"), meta("RTP 1")];
    const snapshot = input.map((m) => m.name);
    sortMetasByPriority(input);
    expect(input.map((m) => m.name)).toEqual(snapshot);
  });

  test("falls back to id when name is blank", () => {
    const input: PortugalMeta[] = [
      { id: "vavoo_EuroSport 1|group:pt", name: "   " },
      { id: "vavoo_RTP 1|group:pt", name: "" },
    ];
    const ids = sortMetasByPriority(input).map((m) => m.id);
    expect(ids).toEqual(["vavoo_RTP 1|group:pt", "vavoo_EuroSport 1|group:pt"]);
  });

  test("sports block sorts before NOS priority (DAZN, Eleven, SportTV, RTP 1)", () => {
    const input: PortugalMeta[] = [
      meta("SIC"),
      meta("RTP 1"),
      meta("Sport TV 1"),
      meta("Eleven Sports 1"),
      meta("DAZN 1"),
      meta("Some Random Channel"),
    ];
    const names = sortMetasByPriority(input).map((m) => m.name);
    expect(names).toEqual([
      "DAZN 1",
      "Eleven Sports 1",
      "Sport TV 1",
      "RTP 1",
      "SIC",
      "Some Random Channel",
    ]);
  });

  test("full sports block: DAZN < Eleven < Sport TV < BTV/Benfica < Canal 11 < NOS < rest", () => {
    const input: PortugalMeta[] = [
      meta("Some Random Channel"),
      meta("RTP 1"),
      meta("Canal 11"),
      meta("Benfica TV"),
      meta("BTV 1"),
      meta("Sport TV 2"),
      meta("Sport TV 1"),
      meta("Eleven Sports 1"),
      meta("DAZN 1"),
    ];
    const names = sortMetasByPriority(input).map((m) => m.name);
    expect(names).toEqual([
      "DAZN 1",
      "Eleven Sports 1",
      "Sport TV 1",
      "Sport TV 2",
      "BTV 1",
      "Benfica TV",
      "Canal 11",
      "RTP 1",
      "Some Random Channel",
    ]);
  });
});

describe("renameElevenToDazn", () => {
  test("renames plural/singular, preserving suffixes", () => {
    expect(renameElevenToDazn("Eleven Sports 1")).toBe("DAZN 1");
    expect(renameElevenToDazn("Eleven Sport 1")).toBe("DAZN 1");
    expect(renameElevenToDazn("Eleven Sports 2 HD")).toBe("DAZN 2 HD");
    expect(renameElevenToDazn("Eleven Sports 3 FHD")).toBe("DAZN 3 FHD");
    expect(renameElevenToDazn("Eleven Sports 1 (BACKUP)")).toBe(
      "DAZN 1 (BACKUP)",
    );
    expect(renameElevenToDazn("Eleven Sports 4 HD (BACKUP)")).toBe(
      "DAZN 4 HD (BACKUP)",
    );
  });

  test("is case-insensitive", () => {
    expect(renameElevenToDazn("eleven sports 1")).toBe("DAZN 1");
    expect(renameElevenToDazn("ELEVEN SPORTS 2 HD")).toBe("DAZN 2 HD");
    expect(renameElevenToDazn("Eleven SPORT 5")).toBe("DAZN 5");
  });

  test("non-Eleven names pass through untouched", () => {
    expect(renameElevenToDazn("DAZN 1")).toBe("DAZN 1");
    expect(renameElevenToDazn("Sport TV 1")).toBe("Sport TV 1");
    expect(renameElevenToDazn("RTP 1")).toBe("RTP 1");
    expect(renameElevenToDazn("EuroSport 1")).toBe("EuroSport 1");
    expect(renameElevenToDazn("Sporting TV")).toBe("Sporting TV");
  });
});

describe("sports tier", () => {
  test("tiers native DAZN < Eleven < Sport TV < rest", () => {
    expect(getSportsTier(normalizeChannelName("DAZN 1"))).toBe(0);
    expect(getSportsTier(normalizeChannelName("Eleven Sports 1"))).toBe(1);
    expect(getSportsTier(normalizeChannelName("Eleven Sport 1"))).toBe(1);
    expect(getSportsTier(normalizeChannelName("Sport TV 1"))).toBe(2);
    expect(getSportsTier(normalizeChannelName("RTP 1"))).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  test("does not swallow look-alikes", () => {
    for (const name of [
      "Sporting TV",
      "EuroSport 1",
      "EuroSport",
      "A Bola TV",
      "Canal 12",
      "Canal 111",
      "Canal Panda",
      "RTP 1",
    ]) {
      expect(getSportsTier(normalizeChannelName(name))).toBe(
        Number.POSITIVE_INFINITY,
      );
      expect(getSportsSortKey(name).tier).toBe(Number.POSITIVE_INFINITY);
    }
  });

  test("tiers Benfica TV / BTV = 3, Canal 11 = 4", () => {
    for (const name of [
      "Benfica TV",
      "Benfica TV HD",
      "BTV",
      "BTV HD",
      "BTV 1",
      "BTV1",
      "BenficaTV",
      "BTVHD",
    ]) {
      expect(getSportsTier(normalizeChannelName(name))).toBe(3);
      expect(getSportsSortKey(name).tier).toBe(3);
    }
    for (const name of ["Canal 11", "Canal 11 HD", "CANAL11"]) {
      expect(getSportsTier(normalizeChannelName(name))).toBe(4);
      expect(getSportsSortKey(name).tier).toBe(4);
    }
  });

  test("tier 3 numeric sub-sort: BTV 1 < bare BTV / Benfica TV", () => {
    expect(getSportsNum(normalizeChannelName("BTV 1"), 3)).toBe(1);
    expect(getSportsNum(normalizeChannelName("BTV1"), 3)).toBe(1);
    expect(getSportsNum(normalizeChannelName("Benfica TV 2"), 3)).toBe(2);
    expect(getSportsNum(normalizeChannelName("BTV"), 3)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(getSportsNum(normalizeChannelName("BTV HD"), 3)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(getSportsNum(normalizeChannelName("Benfica TV"), 3)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(getSportsNum(normalizeChannelName("Benfica TV HD"), 3)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  test("tier 4 always returns Infinity (single channel, no sub-sort)", () => {
    expect(getSportsNum(normalizeChannelName("Canal 11"), 4)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(getSportsNum(normalizeChannelName("CANAL11"), 4)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  test("numeric sub-sort: 1 < 2 < 11 (no lexicographic bug)", () => {
    expect(
      getSportsNum(normalizeChannelName("DAZN 1"), 0),
    ).toBeLessThan(getSportsNum(normalizeChannelName("DAZN 11"), 0));
    const input: PortugalMeta[] = [
      meta("DAZN 11"),
      meta("DAZN 2"),
      meta("DAZN 1"),
    ];
    const names = sortMetasByPriority(input).map((m) => m.name);
    expect(names).toEqual(["DAZN 1", "DAZN 2", "DAZN 11"]);
  });

  test("Sport TV +/NBA sort after numbered Sport TV", () => {
    const input: PortugalMeta[] = [
      meta("Sport TV NBA"),
      meta("Sport TV +"),
      meta("Sport TV 2"),
      meta("Sport TV 1"),
    ];
    const names = sortMetasByPriority(input).map((m) => m.name);
    expect(names.slice(0, 2)).toEqual(["Sport TV 1", "Sport TV 2"]);
    // Non-numeric tail keeps upstream relative order after numbered.
    expect(names.slice(2)).toEqual(["Sport TV NBA", "Sport TV +"]);
  });

  test("Eleven keeps tier 1 (does not jump to DAZN tier via renamed form)", () => {
    // Sorted on ORIGINAL names: DAZN native first, Eleven second.
    const input: PortugalMeta[] = [
      meta("Eleven Sports 2"),
      meta("DAZN 2"),
      meta("Eleven Sports 1"),
      meta("DAZN 1"),
    ];
    const names = sortMetasByPriority(input).map((m) => m.name);
    expect(names).toEqual([
      "DAZN 1",
      "DAZN 2",
      "Eleven Sports 1",
      "Eleven Sports 2",
    ]);
  });
});

describe("buildM3U display rename", () => {
  test("renames Eleven at display layer but keeps meta.id in watch URL", () => {
    const metas: PortugalMeta[] = [
      { id: "vavoo_Eleven Sports 1|group:pt", name: "Eleven Sports 1" },
      { id: "vavoo_DAZN 1|group:pt", name: "DAZN 1" },
    ];
    const m3u: string = buildM3U(metas, "https://example.dev");
    expect(m3u).toContain(",DAZN 1\n");
    // Renamed display name appears...
    expect(m3u).not.toContain(",Eleven Sports 1\n");
    // ...but the watch URL still uses the raw upstream id.
    expect(m3u).toContain(
      "https://example.dev/watch/vavoo_Eleven%20Sports%201%7Cgroup%3Apt",
    );
    expect(m3u).toContain(
      "https://example.dev/watch/vavoo_DAZN%201%7Cgroup%3Apt",
    );
  });
});

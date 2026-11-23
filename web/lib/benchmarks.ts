import type { GeoFile, ZipEntry } from "./types";

/** One area figure a property is compared with, and where it came from. */
export type Benchmark = {
  seriesId: string;
  value: number;
  end: string;
  /** Value for the same month one and five years earlier (ZIP data only). */
  y1: number | null;
  y5: number | null;
  releaseDate: string | null;
  vintageDate: string;
  flags: string[];
  /** "zip" when the ZIP has this figure, "metro" when it fell back to the parent metro. */
  from: "zip" | "metro";
};

/** The comparisons the analyzer makes. */
export type BenchmarkKey =
  "value" | "ppsf" | "listPrice" | "rent" | "dom" | "priceCuts" | "listings";

const SERIES: Record<BenchmarkKey, string> = {
  value: "zillow.zhvi.all.mid.sa",
  ppsf: "realtor.median_list_ppsf.all.nsa",
  listPrice: "realtor.median_list_price.all.nsa",
  rent: "zillow.zori.all.sa",
  dom: "realtor.dom.all.nsa",
  priceCuts: "realtor.price_reduced_share.all.nsa",
  listings: "realtor.active_listings.all.nsa",
};

/** Zillow's bedroom-count series for a home with this many bedrooms (5 means 5+). */
export const bedroomSeries = (beds: number) =>
  `zillow.zhvi.b${Math.min(Math.max(Math.round(beds), 1), 5)}.mid.sa`;

function fromZip(zip: ZipEntry | undefined, id: string): Benchmark | undefined {
  const b = zip?.series[id];
  return b && {
    seriesId: id, value: b.value, end: b.end, y1: b.y1, y5: b.y5,
    releaseDate: b.release_date, vintageDate: b.vintage_date, flags: b.flags, from: "zip",
  }; // prettier-ignore
}

function fromMetro(metro: GeoFile | undefined, id: string): Benchmark | undefined {
  const s = metro?.series[id];
  const last = s?.points.at(-1);
  return s && last && {
    seriesId: id, value: last[2], end: last[1], y1: null, y5: null,
    releaseDate: s.release_date, vintageDate: s.vintage_date, flags: last[3], from: "metro",
  }; // prettier-ignore
}

/**
 * Picks each comparison figure: the ZIP's own first, then the parent metro's.
 * The typical value uses the same bedroom count when the ZIP publishes it.
 * @param zip - the ZIP's entry, if the ZIP has data
 * @param metro - the parent metro's series file, if any
 * @param beds - the property's bedrooms, if known
 * @returns figures by comparison; missing ones are absent
 */
export function pickBenchmarks(
  zip: ZipEntry | undefined,
  metro: GeoFile | undefined,
  beds?: number,
): Partial<Record<BenchmarkKey, Benchmark>> {
  const out: Partial<Record<BenchmarkKey, Benchmark>> = {};
  for (const [key, id] of Object.entries(SERIES) as [BenchmarkKey, string][]) {
    const b =
      (key === "value" && beds !== undefined ? fromZip(zip, bedroomSeries(beds)) : undefined) ??
      fromZip(zip, id) ??
      fromMetro(metro, id);
    if (b) out[key] = b;
  }
  return out;
}

/**
 * Percent change between two values of the same series.
 * @param now - latest value
 * @param then - earlier value
 * @returns the % change, or null if the earlier value is unknown
 */
export const changePct = (now: number, then: number | null) =>
  then ? (now / then - 1) * 100 : null;

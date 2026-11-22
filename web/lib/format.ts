import type { Metric, SeriesMeta, Source } from "./types";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const dec = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: n, maximumFractionDigits: n });
const one = dec(1);
const two = dec(2);
const int = dec(0);

/**
 * Formats a value in its metric's unit.
 * @param value - the number
 * @param unit - the metric unit
 * @returns display text, e.g. "$420,000" or "6.85%"
 */
export function formatValue(value: number, unit: Metric["unit"]): string {
  switch (unit) {
    case "usd":
      return usd.format(value);
    case "index":
    case "months":
      return one.format(value) + (unit === "months" ? " months" : "");
    case "pct":
      return `${two.format(value)}%`;
    case "days":
      return `${int.format(value)} days`;
    default:
      return int.format(value);
  }
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Writes an ISO date in words.
 * @param iso - a YYYY-MM-DD date
 * @returns e.g. "Jun 30, 2026"; input that is not an ISO date is returned unchanged
 */
export function formatDate(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(t) ? dateFmt.format(t) : iso;
}

const METHOD: Record<string, string> = {
  repeat_sales: "Repeat-sales index",
  median: "Median price",
  hedonic_avm: "Model-based estimate",
  survey: "Survey",
  listing: "Based on listings",
};

/**
 * Provenance line shown next to every displayed number, in plain English.
 * @param series - series metadata
 * @param source - the series' source
 * @param releaseDate - release date, or null
 * @param vintageDate - vintage date (when HouseLens saved this version of the value)
 * @param periodEnd - end of the displayed period
 * @param latest - true when the dates belong to the series' latest point, not the displayed one
 * @returns e.g. "FHFA House Price Index · Repeat-sales index · Not seasonally adjusted · Period
 *   ending Jun 30, 2026 · Published on Aug 26, 2026 · Usually published about 60 days after the
 *   period ends · Data version from Nov 1, 2026"
 */
export function provenanceText(
  series: SeriesMeta,
  source: Source,
  releaseDate: string | null,
  vintageDate: string,
  periodEnd: string,
  latest = false,
): string {
  const kind = series.release_date_kind === "published" ? "published" : "first seen by HouseLens";
  const released = latest ? `Latest point ${kind}` : kind[0].toUpperCase() + kind.slice(1);
  const lag =
    series.typical_lag_days === null
      ? "Usual delay unknown"
      : `Usually published about ${series.typical_lag_days} days after the period ends`;
  return [
    source.name,
    METHOD[series.method_family] ?? series.method_family,
    series.seasonal_adj ? "Seasonally adjusted" : "Not seasonally adjusted",
    `Period ending ${formatDate(periodEnd)}`,
    `${released} ${releaseDate ? `on ${formatDate(releaseDate)}` : "(date unknown)"}`,
    lag,
    `${latest ? "Latest data version" : "Data version"} from ${formatDate(vintageDate)}`,
  ].join(" · ");
}

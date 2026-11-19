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

/**
 * Provenance line shown next to every displayed number.
 * @param series - series metadata
 * @param source - the series' source
 * @param releaseDate - release date, or null
 * @param vintageDate - vintage date
 * @param periodEnd - end of the displayed period
 * @param latest - true when the dates belong to the series' latest point, not the displayed one
 * @returns e.g. "FHFA · repeat_sales · NSA · Period ending … · Released … · lag ~60 days · Vintage …"
 */
export function provenanceText(
  series: SeriesMeta,
  source: Source,
  releaseDate: string | null,
  vintageDate: string,
  periodEnd: string,
  latest = false,
): string {
  const published = series.release_date_kind === "published";
  const released = latest
    ? `Latest ${published ? "release" : "first seen"}`
    : published
      ? "Released"
      : "First seen";
  const lag = series.typical_lag_days === null ? "lag n/a" : `lag ~${series.typical_lag_days} days`;
  return [
    source.name,
    series.method_family,
    series.seasonal_adj ? "SA" : "NSA",
    `Period ending ${periodEnd}`,
    `${released} ${releaseDate ?? "n/a"}`,
    lag,
    `${latest ? "Latest vintage" : "Vintage"} ${vintageDate}`,
  ].join(" · ");
}

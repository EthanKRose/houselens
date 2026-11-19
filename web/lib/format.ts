import type { Metric } from "./types";

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

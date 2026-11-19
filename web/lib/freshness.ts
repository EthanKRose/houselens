import type { Freshness, Frequency } from "./types";

const CADENCE_DAYS: Record<Frequency, number> = { weekly: 7, monthly: 31, quarterly: 92 };

/**
 * Rates how overdue a series' next data point is.
 * @param f - one series' entry from freshness.json
 * @param today - reference date (only its UTC calendar day is used)
 * @returns green if on time, amber if up to half a cadence late, red beyond that
 */
export function freshnessStatus(f: Freshness[string], today: Date): "green" | "amber" | "red" {
  const cadence = CADENCE_DAYS[f.frequency];
  const expected =
    Date.parse(`${f.last_period_end}T00:00:00Z`) / 86_400_000 + (f.typical_lag_days ?? 0) + cadence;
  const day = Math.floor(today.getTime() / 86_400_000);
  if (day <= expected) return "green";
  return day <= expected + cadence / 2 ? "amber" : "red";
}

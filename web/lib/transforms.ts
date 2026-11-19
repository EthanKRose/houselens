import type { Frequency, Point } from "./types";

/** How a series is displayed: raw level, year-over-year %, period-over-period %, or rebased to 100. */
export type Transform = "level" | "yoy" | "mom" | "rebased";

/** A relative lookback window or an explicit inclusive start-date range. */
export type Range = "1y" | "5y" | "10y" | "max" | { start: string; end: string };

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Key a monthly/quarterly point by calendar period, shifted back `back` periods of `step` months. */
function periodKey(iso: string, step: number, back: number): string {
  const d = new Date(utc(iso));
  d.setUTCMonth(d.getUTCMonth() - step * back, 1);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

/** Finds the comparison partner of each point, or undefined. */
function partners(points: Point[], t: "yoy" | "mom", frequency: Frequency): (Point | undefined)[] {
  if (frequency === "weekly") {
    const lag = t === "yoy" ? 364 : 28;
    return points.map((p) => {
      let best: Point | undefined;
      let bestOff = Infinity;
      for (const q of points) {
        const off = Math.abs((utc(p.start) - utc(q.start)) / DAY - lag);
        if (off <= 3 && off < bestOff) [best, bestOff] = [q, off];
      }
      return best;
    });
  }
  const step = frequency === "monthly" ? 1 : 3;
  const back = t === "yoy" ? 12 / step : 1;
  const byKey = new Map(points.map((p) => [periodKey(p.start, step, 0), p]));
  return points.map((p) => byKey.get(periodKey(p.start, step, back)));
}

/**
 * Applies a display transform to a series.
 * @param points - observations, oldest first
 * @param t - the transform
 * @param frequency - series cadence, which decides the YoY/MoM partner
 * @param rebaseDate - for "rebased": the date set to 100 (nearest earlier point if none on it); defaults to the first point
 * @returns transformed points keeping start/end/flags; points with no usable partner are omitted
 */
export function applyTransform(
  points: Point[],
  t: Transform,
  frequency: Frequency,
  rebaseDate?: string,
): Point[] {
  if (t === "level") return points;
  if (t === "rebased") {
    const date = rebaseDate ?? points[0]?.start;
    const base = points.filter((p) => date !== undefined && p.start <= date).at(-1);
    if (!base || base.value === 0) return [];
    return points.map((p) => ({ ...p, value: (p.value / base.value) * 100 }));
  }
  const ps = partners(points, t, frequency);
  return points.flatMap((p, i) => {
    const q = ps[i];
    return q && q.value !== 0 ? [{ ...p, value: (p.value / q.value - 1) * 100 }] : [];
  });
}

/**
 * Keeps the points inside a time range.
 * @param points - observations
 * @param range - "1y"/"5y"/"10y" (by end date, back from today), "max", or an inclusive start-date range
 * @param today - reference date
 * @returns the points in range
 */
export function filterRange(points: Point[], range: Range, today: Date): Point[] {
  if (range === "max") return points;
  if (typeof range === "object") {
    return points.filter((p) => p.start >= range.start && p.start <= range.end);
  }
  const cutoff = new Date(today);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number.parseInt(range));
  const iso = cutoff.toISOString().slice(0, 10);
  return points.filter((p) => p.end >= iso);
}

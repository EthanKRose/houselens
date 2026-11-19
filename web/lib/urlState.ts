import type { Range, Transform } from "./transforms";

/** Everything a compare view needs, as encoded in the URL. */
export type ViewState = {
  geo: string;
  series: string[];
  transform: Transform;
  range: Range;
  rebase?: string;
};

const MAX_SERIES = 6;
const TRANSFORMS: Transform[] = ["level", "yoy", "mom", "rebased"];
const RANGES = ["1y", "5y", "10y", "max"] as const;
const DEFAULTS: ViewState = { geo: "US", series: [], transform: "level", range: "10y" };

/** True for a real calendar date in YYYY-MM-DD form. */
function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(s);
}

function parseRange(r: string): Range | undefined {
  if ((RANGES as readonly string[]).includes(r)) return r as Range;
  const [start, end, extra] = r.split("..");
  if (extra === undefined && start && end && isIsoDate(start) && isIsoDate(end) && start <= end) {
    return { start, end };
  }
  return undefined;
}

/**
 * Reads view state from URL params, falling back to defaults for anything invalid.
 * @param params - the page's search params (`geo`, `s`, `t`, `r`, `b`)
 * @param known - geo and series ids that exist in the site data
 * @returns the valid state and one warning per kind of problem found
 */
export function parseViewState(
  params: URLSearchParams,
  known: { geoIds: Set<string>; seriesIds: Set<string> },
): { state: ViewState; warnings: string[] } {
  const warnings: string[] = [];
  const state: ViewState = { ...DEFAULTS };

  const geo = params.get("geo");
  if (geo !== null) {
    if (known.geoIds.has(geo)) state.geo = geo;
    else warnings.push(`Unknown geography "${geo}"; showing US.`);
  }

  const ids = [...new Set((params.get("s") ?? "").split(",").filter(Boolean))];
  const unknown = ids.filter((id) => !known.seriesIds.has(id));
  if (unknown.length) warnings.push(`Unknown series dropped: ${unknown.join(", ")}.`);
  const valid = ids.filter((id) => known.seriesIds.has(id));
  if (valid.length > MAX_SERIES) {
    warnings.push(`At most ${MAX_SERIES} series can be compared; kept the first ${MAX_SERIES}.`);
  }
  state.series = valid.slice(0, MAX_SERIES);

  const t = params.get("t");
  if (t !== null) {
    if ((TRANSFORMS as string[]).includes(t)) state.transform = t as Transform;
    else warnings.push(`Unknown transform "${t}"; showing level.`);
  }

  const r = params.get("r");
  if (r !== null) {
    const range = parseRange(r);
    if (range) state.range = range;
    else warnings.push(`Invalid range "${r}"; showing 10y.`);
  }

  const b = params.get("b");
  if (b !== null) {
    if (isIsoDate(b)) state.rebase = b;
    else warnings.push(`Invalid rebase date "${b}"; ignored.`);
  }

  return { state, warnings };
}

/**
 * Encodes view state as a query string (no leading "?"), omitting defaults.
 * @param s - the view state
 * @returns the query string; "" for the default view
 */
export function serializeViewState(s: ViewState): string {
  const p = new URLSearchParams();
  if (s.geo !== DEFAULTS.geo) p.set("geo", s.geo);
  if (s.series.length) p.set("s", s.series.join(","));
  if (s.transform !== DEFAULTS.transform) p.set("t", s.transform);
  const r = typeof s.range === "object" ? `${s.range.start}..${s.range.end}` : s.range;
  if (r !== DEFAULTS.range) p.set("r", r);
  if (s.rebase) p.set("b", s.rebase);
  // Literal ":" and "," keep share URLs readable; parsing accepts either form.
  return p.toString().replaceAll("%3A", ":").replaceAll("%2C", ",");
}

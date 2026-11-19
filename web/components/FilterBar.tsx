"use client";

import { useState } from "react";
import { GeoPicker } from "@/components/GeoPicker";
import type { Range, Transform } from "@/lib/transforms";
import type { Catalog, Geography, SeriesMeta } from "@/lib/types";
import type { ViewState } from "@/lib/urlState";

const MAX_SERIES = 6;
const TRANSFORMS: [Transform, string][] = [
  ["level", "Level"],
  ["yoy", "Year over year %"],
  ["mom", "Period over period %"],
  ["rebased", "Rebased to 100"],
];
const RANGES = ["1y", "5y", "10y", "max"] as const;

/** Why a series can't be shown for a geography, or null if it can. */
function unavailableReason(s: SeriesMeta, g: Geography): string | null {
  if (g.series_ids.includes(s.series_id) || s.national_only) return null;
  if (s.series_id === "fhfa.hpi.at.q.nsa" && g.level === "CBSA" && g.has_msad) {
    return "FHFA publishes divisions, not the whole metro";
  }
  if (s.series_id === "fred.cs.metro.sa" && g.level === "CBSA") {
    return "Case-Shiller covers 20 metros only";
  }
  return "Not published for this geography";
}

/**
 * Compare controls: geography, up to six series (unavailable ones disabled with a reason),
 * transform and range.
 * @param props - component props
 * @param props.state - current view state
 * @param props.catalog - the catalog
 * @param props.geography - the selected geography
 * @param props.geographies - all geographies, for the picker
 * @param props.onChange - called with the next view state
 * @returns the filter controls
 */
export function FilterBar({
  state,
  catalog,
  geography,
  geographies,
  onChange,
}: {
  state: ViewState;
  catalog: Catalog;
  geography: Geography;
  geographies: Geography[];
  onChange: (next: ViewState) => void;
}) {
  const [refused, setRefused] = useState(false);
  const toggle = (id: string) => {
    const on = state.series.includes(id);
    if (!on && state.series.length >= MAX_SERIES) return setRefused(true);
    setRefused(false);
    onChange({
      ...state,
      series: on ? state.series.filter((x) => x !== id) : [...state.series, id],
    });
  };
  const custom =
    typeof state.range === "object" ? `${state.range.start}..${state.range.end}` : null;
  return (
    <div className="space-y-4">
      <GeoPicker
        geographies={geographies}
        value={state.geo}
        onChange={(geo) => onChange({ ...state, geo })}
      />
      <fieldset>
        <legend className="font-medium">Series (up to {MAX_SERIES})</legend>
        {refused && (
          <p role="alert" className="text-sm text-amber-700">
            At most {MAX_SERIES} series can be compared; remove one first.
          </p>
        )}
        <ul className="grid gap-1 sm:grid-cols-2">
          {catalog.series.map((s) => {
            const metric = catalog.metrics.find((m) => m.metric_id === s.metric_id);
            const source = catalog.sources.find((x) => x.source_id === s.source_id);
            const reason = unavailableReason(s, geography);
            const checked = state.series.includes(s.series_id);
            return (
              <li key={s.series_id}>
                <label className="flex items-baseline gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    // A selected series stays clickable so it can be removed after a geo change.
                    disabled={reason !== null && !checked}
                    onChange={() => toggle(s.series_id)}
                  />
                  <span>
                    {metric?.label ?? s.metric_id} · {source?.name ?? s.source_id}{" "}
                    <span className="text-muted-foreground text-xs">{s.series_id}</span>
                    {s.national_only && geography.geo_id !== "US" && " (US)"}
                    {reason && <span className="text-muted-foreground text-xs"> — {reason}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          Transform
          <select
            className="rounded border px-2 py-1"
            value={state.transform}
            onChange={(e) => onChange({ ...state, transform: e.target.value as Transform })}
          >
            {TRANSFORMS.map(([t, name]) => (
              <option key={t} value={t}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Range
          <select
            className="rounded border px-2 py-1"
            value={custom ?? (state.range as string)}
            onChange={(e) => onChange({ ...state, range: e.target.value as Range })}
          >
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {r === "max" ? "All" : r}
              </option>
            ))}
            {custom && <option value={custom}>{custom}</option>}
          </select>
        </label>
      </div>
    </div>
  );
}

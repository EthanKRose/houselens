"use client";

import { useState } from "react";
import { GeoPicker } from "@/components/GeoPicker";
import { SeriesInfo } from "@/components/SeriesInfo";
import type { Range, Transform } from "@/lib/transforms";
import type { Catalog, Geography, SeriesMeta } from "@/lib/types";
import type { ViewState } from "@/lib/urlState";

const MAX_SERIES = 6;
const TRANSFORMS: [Transform, string][] = [
  ["level", "Actual values"],
  ["yoy", "% change from a year earlier"],
  ["mom", "% change from the previous period"],
  ["rebased", "Growth since a start date (= 100)"],
];
const RANGES: [Exclude<Range, object>, string][] = [
  ["1y", "Last year"],
  ["5y", "Last 5 years"],
  ["10y", "Last 10 years"],
  ["max", "All available"],
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The last ten years as an explicit range, the starting point for a custom range. */
function lastTenYears(): { start: string; end: string } {
  const d = new Date();
  const end = iso(d);
  d.setUTCFullYear(d.getUTCFullYear() - 10);
  return { start: iso(d), end };
}

/**
 * Why a series can't be shown for a geography.
 * @param s - the series
 * @param g - the geography
 * @returns the reason, or null if it can be shown
 */
export function unavailableReason(s: SeriesMeta, g: Geography): string | null {
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
  const custom = typeof state.range === "object" ? state.range : null;
  const setCustom = (part: "start" | "end", value: string) => {
    const range = { ...custom!, [part]: value };
    // Ignore cleared or inverted pairs; the URL parser would reject them anyway.
    if (range.start && range.end && range.start <= range.end) onChange({ ...state, range });
  };
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
          {/* ZIP-only series (e.g. by bedroom count) live on the property page. */}
          {catalog.series
            .filter((s) => s.levels.some((l) => l !== "ZIP"))
            .map((s) => {
              const reason = unavailableReason(s, geography);
              const checked = state.series.includes(s.series_id);
              return (
                <li key={s.series_id} className="flex items-start gap-1">
                  <label className="flex items-baseline gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      // A selected series stays clickable so it can be removed after a geo change.
                      disabled={reason !== null && !checked}
                      onChange={() => toggle(s.series_id)}
                    />
                    <span>
                      {s.name} <span className="text-muted-foreground text-xs">{s.series_id}</span>
                      {s.national_only && geography.geo_id !== "US" && " (US)"}
                      {s.source_id === "realtor" && (
                        <strong className="text-xs">
                          {" "}
                          Listing data (asking prices), not sales
                        </strong>
                      )}
                      {reason && <span className="text-muted-foreground text-xs"> — {reason}</span>}
                    </span>
                  </label>
                  {/* Outside the label: a button inside it would be nested interactive content. */}
                  <SeriesInfo series={s} />
                </li>
              );
            })}
        </ul>
      </fieldset>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          Show as
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
        {state.transform === "rebased" && (
          <label className="flex items-center gap-2">
            Start date (= 100)
            <input
              type="date"
              className="rounded border px-2 py-1"
              value={state.rebase ?? ""}
              onChange={(e) => onChange({ ...state, rebase: e.target.value || undefined })}
            />
          </label>
        )}
        <label className="flex items-center gap-2">
          Time period
          <select
            className="rounded border px-2 py-1"
            value={custom ? "custom" : (state.range as string)}
            onChange={(e) =>
              onChange({
                ...state,
                range: e.target.value === "custom" ? lastTenYears() : (e.target.value as Range),
              })
            }
          >
            {RANGES.map(([r, name]) => (
              <option key={r} value={r}>
                {name}
              </option>
            ))}
            <option value="custom">Custom dates</option>
          </select>
        </label>
        {custom && (
          <>
            <label className="flex items-center gap-2">
              From
              <input
                type="date"
                className="rounded border px-2 py-1"
                value={custom.start}
                onChange={(e) => setCustom("start", e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2">
              To
              <input
                type="date"
                className="rounded border px-2 py-1"
                value={custom.end}
                onChange={(e) => setCustom("end", e.target.value)}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}

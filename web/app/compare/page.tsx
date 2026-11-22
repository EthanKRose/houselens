"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AboutThisNumber } from "@/components/AboutThisNumber";
import { FilterBar, unavailableReason } from "@/components/FilterBar";
import { FreshnessDot } from "@/components/FreshnessDot";
import { SeriesChart } from "@/components/SeriesChart";
import { SourceBadge } from "@/components/SourceBadge";
import { Button } from "@/components/ui/button";
import { toCsv, type CsvRow } from "@/lib/csv";
import {
  geoFileName,
  toPoints,
  useCatalog,
  useFreshness,
  useGeoFile,
  useGeographies,
} from "@/lib/data";
import { formatValue } from "@/lib/format";
import { applyTransform, filterRange, type Transform } from "@/lib/transforms";
import type { Catalog, Freshness, GeoFile, Geography, Metric } from "@/lib/types";
import { parseViewState, serializeViewState, type ViewState } from "@/lib/urlState";

const unitOf = (t: Transform, unit: Metric["unit"]): Metric["unit"] =>
  t === "yoy" || t === "mom" ? "pct" : t === "rebased" ? "index" : unit;

const LATEST: Record<Transform, string> = {
  level: "Latest",
  yoy: "Latest (YoY %)",
  mom: "Latest (period-over-period %)",
  rebased: "Latest (rebased)",
};

function View({
  state,
  catalog,
  freshness,
  geo,
  geoFile,
  usFile,
}: {
  state: ViewState;
  catalog: Catalog;
  freshness: Freshness;
  geo: Geography;
  geoFile: GeoFile;
  usFile: GeoFile;
}) {
  const today = useMemo(() => new Date(), []);
  const { plotted, transform, mixed, base } = useMemo(() => {
    const picked = state.series.flatMap((id) => {
      const meta = catalog.series.find((s) => s.series_id === id);
      const metric = catalog.metrics.find((m) => m.metric_id === meta?.metric_id);
      const source = catalog.sources.find((s) => s.source_id === meta?.source_id);
      const national = !!meta?.national_only && geo.geo_id !== "US";
      const data = (meta?.national_only ? usFile : geoFile).series[id];
      return meta && metric && source && data ? [{ meta, metric, source, national, data }] : [];
    });
    const mixed = new Set(picked.map((p) => unitOf(state.transform, p.metric.unit))).size >= 3;
    const transform: Transform = mixed ? "rebased" : state.transform;
    const all = picked.map((p) => toPoints(p.data.points));
    // Common base: the latest first in-range start, so every line is 100 on the same date.
    const base =
      state.rebase ??
      all
        .map((ps) => filterRange(ps, state.range, today)[0]?.start)
        .filter(Boolean)
        .sort()
        .at(-1);
    const plotted = picked.map((p, i) => ({
      ...p,
      label: `${p.metric.label} · ${p.meta.series_id}${p.national ? " (US)" : ""}`,
      unit: unitOf(transform, p.metric.unit),
      releaseDate: p.data.release_date,
      vintageDate: p.data.vintage_date,
      // Transform the full history, then window it, so YoY/MoM keep their first in-range points.
      points: filterRange(
        applyTransform(all[i], transform, p.meta.frequency, base),
        state.range,
        today,
      ),
    }));
    return { plotted, transform, mixed, base };
  }, [state, catalog, geo, geoFile, usFile, today]);

  const exportCsv = () => {
    const rows: CsvRow[] = plotted.flatMap((p) => {
      // The dates describe only the series' latest point; earlier points have no known vintage.
      const latestEnd = p.data.points.at(-1)?.[1];
      return p.points.map((pt) => ({
        series_id: p.meta.series_id,
        source: p.source.name,
        method_family: p.meta.method_family,
        seasonal_adj: p.meta.seasonal_adj,
        geo_id: p.national ? "US" : geo.geo_id,
        period_start: pt.start,
        period_end: pt.end,
        value: pt.value,
        transform,
        vintage_date: pt.end === latestEnd ? p.data.vintage_date : null,
        release_date: pt.end === latestEnd ? p.data.release_date : null,
        quality_flags: pt.flags,
      }));
    });
    const attributions = [...new Set(plotted.map((p) => p.source.attribution))];
    const url = URL.createObjectURL(new Blob([toCsv(rows, attributions)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `houselens-${geoFileName(geo.geo_id)}-${transform}.csv`;
    a.click();
    // Revoking in the same tick can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url));
  };

  // Picks survive a geography change, so say which ones this geography can't show.
  const missing = state.series.flatMap((id) => {
    const meta = catalog.series.find((s) => s.series_id === id);
    if (!meta || plotted.some((p) => p.meta.series_id === id)) return [];
    return [`${id} (${unavailableReason(meta, geo) ?? "no data"})`];
  });
  const note = missing.length > 0 && (
    <p className="text-sm text-amber-700">{`Not shown for ${geo.name}: ${missing.join(", ")}.`}</p>
  );
  if (!plotted.length) return note || <p>Select up to 6 series to compare.</p>;
  return (
    <div className="space-y-4">
      {note}
      {mixed && (
        <p className="text-sm text-amber-700">
          Rebased to 100 because the selection mixes 3+ units.
        </p>
      )}
      <SeriesChart series={plotted} knownEvents={catalog.known_events} />
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Latest plotted point per series</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            <th scope="col">
              {transform === "rebased"
                ? `Latest (rebased, 100 = ${base ?? "n/a"})`
                : LATEST[transform]}
            </th>
            <th scope="col">Provenance</th>
          </tr>
        </thead>
        <tbody>
          {plotted.map((p) => {
            const last = p.points.at(-1);
            return (
              <tr key={p.meta.series_id} className="border-t align-top">
                <th scope="row" className="py-2 pr-4 font-medium">
                  {p.label}
                </th>
                <td className="py-2 pr-4">
                  {last ? formatValue(last.value, p.unit) : "No data in range"}
                </td>
                <td className="space-y-1 py-2">
                  {last && (
                    <SourceBadge
                      series={p.meta}
                      source={p.source}
                      releaseDate={p.data.release_date}
                      vintageDate={p.data.vintage_date}
                      periodEnd={last.end}
                    />
                  )}
                  <div className="flex items-center gap-2">
                    {freshness[p.meta.series_id] && (
                      <FreshnessDot freshness={freshness[p.meta.series_id]} today={today} />
                    )}
                    <AboutThisNumber
                      series={p.meta}
                      source={p.source}
                      flags={last?.flags ?? []}
                      knownEvents={catalog.known_events}
                      nonDisclosure={!p.national && geo.non_disclosure}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Button variant="outline" onClick={exportCsv}>
        Export CSV
      </Button>
    </div>
  );
}

function Compare() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const catalogQ = useCatalog();
  const geosQ = useGeographies();
  const freshnessQ = useFreshness();
  const catalog = catalogQ.data;
  const geos = geosQ.data;
  const freshness = freshnessQ.data;
  const { state, warnings } = useMemo(
    () =>
      parseViewState(new URLSearchParams(params.toString()), {
        geoIds: new Set(geos?.map((g) => g.geo_id)),
        seriesIds: new Set(catalog?.series.map((s) => s.series_id)),
      }),
    [params, geos, catalog],
  );
  const needsUs = state.series.some(
    (id) => catalog?.series.find((s) => s.series_id === id)?.national_only,
  );
  const geoQ = useGeoFile(state.geo);
  // Same query key as geoQ when US isn't needed, so nothing extra is fetched.
  const usQ = useGeoFile(needsUs ? "US" : state.geo);
  const geo = geos?.find((g) => g.geo_id === state.geo);
  const failed = <p role="alert">Could not load housing data. Please try again later.</p>;
  if (catalogQ.isError || geosQ.isError) return failed;
  if (!catalog || !geos || !geo) return <p>Loading…</p>;
  return (
    <div className="space-y-6">
      <FilterBar
        state={state}
        catalog={catalog}
        geography={geo}
        geographies={geos}
        onChange={(next) => router.replace(`${pathname}?${serializeViewState(next)}`)}
      />
      {warnings.map((w) => (
        <p key={w} role="alert" className="text-sm text-amber-700">
          {w}
        </p>
      ))}
      {/* Only the results wait on per-geo data, so the controls keep focus and stay usable. */}
      {[freshnessQ, geoQ, usQ].some((q) => q.isError) ? (
        failed
      ) : !freshness || !geoQ.data || !usQ.data ? (
        <p>Loading…</p>
      ) : (
        <View
          state={state}
          catalog={catalog}
          freshness={freshness}
          geo={geo}
          geoFile={geoQ.data}
          usFile={usQ.data}
        />
      )}
    </div>
  );
}

/**
 * Compare page: up to six series for one geography, with provenance and CSV export.
 * @returns the page
 */
export default function ComparePage() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Compare</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Compare />
      </Suspense>
    </main>
  );
}

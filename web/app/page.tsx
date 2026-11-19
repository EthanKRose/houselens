"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GeoPicker } from "@/components/GeoPicker";
import { KpiCard } from "@/components/KpiCard";
import { useCatalog, useFreshness, useGeoFile, useGeographies, toPoints } from "@/lib/data";
import { parseViewState, serializeViewState } from "@/lib/urlState";
import type { Catalog, Freshness, GeoFile, Geography } from "@/lib/types";

function Cards({
  file,
  catalog,
  freshness,
  geo,
  today,
  national,
}: {
  file: GeoFile;
  catalog: Catalog;
  freshness: Freshness;
  geo: Geography;
  today: Date;
  national: boolean;
}) {
  const pts = useMemo(
    () =>
      Object.fromEntries(Object.entries(file.series).map(([id, s]) => [id, toPoints(s.points)])),
    [file],
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(file.series).map(([id, s]) => {
        const series = catalog.series.find((x) => x.series_id === id);
        const metric = catalog.metrics.find((m) => m.metric_id === series?.metric_id);
        const source = catalog.sources.find((x) => x.source_id === series?.source_id);
        // Own-geo cards skip national-only series; the strip shows them.
        if (!series || !metric || !source || !s.points.length) return null;
        if ((national || geo.geo_id !== "US") && series.national_only !== national) return null;
        return (
          <KpiCard
            key={id}
            series={series}
            metric={metric}
            source={source}
            points={pts[id]}
            releaseDate={s.release_date}
            vintageDate={s.vintage_date}
            freshness={freshness[id]}
            today={today}
            knownEvents={catalog.known_events}
            nonDisclosure={geo.non_disclosure}
            national={national}
          />
        );
      })}
    </div>
  );
}

function Dashboard() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const today = useMemo(() => new Date(), []);
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
  const geoQ = useGeoFile(state.geo);
  const usQ = useGeoFile("US");
  const geoFile = geoQ.data;
  const usFile = usQ.data;
  const geo = geos?.find((g) => g.geo_id === state.geo);
  if ([catalogQ, geosQ, freshnessQ, geoQ, usQ].some((q) => q.isError)) {
    return <p role="alert">Could not load housing data. Please try again later.</p>;
  }
  if (!catalog || !geos || !freshness || !geoFile || !usFile || !geo) return <p>Loading…</p>;
  const nat = state.geo !== "US";
  return (
    <div className="space-y-6">
      <GeoPicker
        geographies={geos}
        value={state.geo}
        onChange={(g) => router.replace(`${pathname}?${serializeViewState({ ...state, geo: g })}`)}
      />
      {warnings.map((w) => (
        <p key={w} role="alert" className="text-sm text-amber-700">
          {w}
        </p>
      ))}
      <section aria-label={geo.name}>
        <h2 className="mb-2 text-lg font-semibold">{geo.name}</h2>
        <Cards
          file={geoFile}
          catalog={catalog}
          freshness={freshness}
          geo={geo}
          today={today}
          national={false}
        />
      </section>
      {nat && (
        <section aria-labelledby="national-context">
          <h2 id="national-context" className="mb-2 text-lg font-semibold">
            National context (US)
          </h2>
          <Cards
            file={usFile}
            catalog={catalog}
            freshness={freshness}
            geo={geos.find((g) => g.geo_id === "US") ?? geo}
            today={today}
            national
          />
        </section>
      )}
    </div>
  );
}

/**
 * Dashboard page: KPI cards for the geography in `?geo=`, plus national context.
 * @returns the page
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">HouseLens</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

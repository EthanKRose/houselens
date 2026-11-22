"use client";

import { useCatalog } from "@/lib/data";

/**
 * Sources page: every catalog source with its series and methodology.
 * @returns the page
 */
export default function SourcesPage() {
  const { data: catalog, isError } = useCatalog();
  if (isError) return <p role="alert">Could not load housing data. Please try again later.</p>;
  if (!catalog) return <p>Loading…</p>;
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Sources</h1>
      {catalog.sources.map((src) => (
        <section key={src.source_id} aria-labelledby={`src-${src.source_id}`} className="space-y-3">
          <h2 id={`src-${src.source_id}`} className="text-xl font-semibold">
            {src.name}
          </h2>
          <p>Publisher: {src.publisher}</p>
          <p>
            <strong>License:</strong> <span>{src.license_note}</span>
          </p>
          <p>{src.attribution}</p>
          <a
            href={src.homepage_url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {src.name} homepage
          </a>
          {catalog.series
            .filter((s) => s.source_id === src.source_id)
            .map((s) => (
              <article key={s.series_id} className="space-y-2 rounded border p-3">
                <h3 className="font-medium">
                  {s.name} <span className="text-sm font-normal">({s.series_id})</span>
                </h3>
                <p className="text-sm">{s.summary}</p>
                <dl className="grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-5">
                  <dt>Frequency</dt>
                  <dd>{s.frequency}</dd>
                  <dt>Typical lag</dt>
                  <dd>{s.typical_lag_days === null ? "n/a" : `${s.typical_lag_days} days`}</dd>
                  <dt>Seasonality</dt>
                  <dd>{s.seasonal_adj ? "Seasonally adjusted" : "Not seasonally adjusted"}</dd>
                  <dt>Method family</dt>
                  <dd>{s.method_family}</dd>
                  <dt>Release date</dt>
                  <dd>
                    {s.release_date_kind === "published"
                      ? "published release date"
                      : "first seen by HouseLens"}
                  </dd>
                </dl>
                {s.methodology_md.split(/\n\s*\n/).map((p, i) => (
                  <p key={i} className="text-sm">
                    {p}
                  </p>
                ))}
              </article>
            ))}
        </section>
      ))}
    </main>
  );
}

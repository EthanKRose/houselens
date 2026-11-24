"use client";

import { Fragment } from "react";
import { SeriesInfo } from "@/components/SeriesInfo";
import { changePct, type Benchmark, type BenchmarkKey } from "@/lib/benchmarks";
import { flip, liveIn, pctVs, rental, signals, type Assumptions, type Signal } from "@/lib/deal";
import { formatValue, provenanceText } from "@/lib/format";
import type { Mode } from "@/lib/property";
import type { Catalog } from "@/lib/types";

const usd = (n: number) => formatValue(n, "usd");
const pct = (n: number | null, digits = 1) =>
  n === null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

const LEVEL: Record<Signal["level"], { word: string; className: string }> = {
  good: { word: "Good", className: "text-emerald-700 dark:text-emerald-400" },
  ok: { word: "Neutral", className: "text-muted-foreground" },
  bad: { word: "Watch out", className: "text-red-700 dark:text-red-400" },
};

/** The numbers the results need from the page. */
export type ResultsInput = {
  price: number;
  sqft?: number;
  mode: Mode;
  assumptions: Assumptions;
  /** Rent or resale typed by the visitor; overrides the area figure when set. */
  rentOverride?: number;
  resaleOverride?: number;
  bench: Partial<Record<BenchmarkKey, Benchmark>>;
  areaName: string;
  metroName: string | null;
  /** True in states where sale prices are not public (weaker price estimates). */
  nonDisclosure: boolean;
};

/**
 * Area comparison table plus the live-in, rental or flip figures and plain-English checks.
 * @param props - component props
 * @param props.input - property, assumptions and benchmarks
 * @param props.catalog - the catalog, for series names, descriptions and provenance
 * @returns the results
 */
export function PropertyResults({ input, catalog }: { input: ResultsInput; catalog: Catalog }) {
  const { price, sqft, mode, assumptions: a, bench } = input;
  const ppsf = sqft ? price / sqft : undefined;
  const rent = input.rentOverride ?? bench.rent?.value ?? null;
  const resale = input.resaleOverride ?? bench.value?.value ?? null;
  const own = liveIn(price, a);
  const rent$ = rental(price, rent, a);
  const flip$ = flip(price, resale, a);
  const checks = signals(mode, {
    priceVsValuePct: pctVs(price, bench.value?.value),
    ppsfVsAreaPct: ppsf ? pctVs(ppsf, bench.ppsf?.value) : null,
    domDays: bench.dom?.value,
    priceCutSharePct: bench.priceCuts?.value,
    cashFlowMo: rent$.cashFlowMo,
    capRatePct: rent$.capRatePct,
    onePctRule: rent$.onePctRule,
    marginPct: flip$.marginPct,
    price,
    seventyPctMaxPrice: flip$.seventyPctMaxPrice,
    valueWhat:
      bench.value?.from === "metro"
        ? "the metro's typical home value"
        : bench.value?.seriesId.startsWith("zillow.zhvi.b")
          ? "the typical value of homes with the same bedroom count in this ZIP"
          : "the typical value of homes in this ZIP",
    ppsfWhat:
      bench.ppsf?.from === "metro"
        ? "the metro's median asking price per square foot"
        : "the ZIP's median asking price per square foot",
  });

  const rows: {
    key: BenchmarkKey;
    area: (v: number) => string;
    yours?: string;
    diff?: number | null;
  }[] = [
    { key: "value", area: usd, yours: usd(price), diff: pctVs(price, bench.value?.value) },
    {
      key: "ppsf",
      area: (v) => `${usd(v)}/sq ft`,
      yours: ppsf ? `${usd(ppsf)}/sq ft` : "Add square feet",
      diff: ppsf ? pctVs(ppsf, bench.ppsf?.value) : null,
    },
    { key: "listPrice", area: usd, yours: usd(price), diff: pctVs(price, bench.listPrice?.value) },
    { key: "rent", area: (v) => `${usd(v)}/mo` },
    { key: "dom", area: (v) => `${Math.round(v)} days` },
    { key: "priceCuts", area: (v) => `${v.toFixed(0)}% of listings` },
    { key: "listings", area: (v) => formatValue(v, "count") },
  ];
  const trend = bench.value?.from === "zip" ? bench.value : undefined;

  return (
    <div className="space-y-8">
      <section aria-labelledby="area-heading" className="space-y-2">
        <h2 id="area-heading" className="text-lg font-semibold">
          Compared with {input.areaName}
        </h2>
        <p className="text-muted-foreground text-sm">
          These are area figures, not an appraisal of this home. A home can be worth more or less
          than its area&apos;s typical value for many reasons (condition, lot, view, upgrades).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Area figures compared with this property</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-2 sm:pr-4">
                  Measure
                </th>
                <th scope="col" className="py-2 pr-2 sm:pr-4">
                  Area
                </th>
                <th scope="col" className="py-2 pr-2 sm:pr-4">
                  This property
                </th>
                <th scope="col" className="py-2">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, area, yours, diff }) => {
                const b = bench[key];
                const meta = catalog.series.find((s) => s.series_id === b?.seriesId);
                const source = catalog.sources.find((s) => s.source_id === meta?.source_id);
                if (!b || !meta || !source) return null;
                // The source line gets its own full-width row so phones keep four readable columns.
                return (
                  <Fragment key={key}>
                    <tr className="align-top">
                      <th scope="row" className="pt-2 pr-2 sm:pr-4 font-medium">
                        <span className="inline-flex items-start gap-1">
                          {meta.name}
                          <SeriesInfo series={meta} />
                        </span>
                      </th>
                      <td className="pt-2 pr-2 sm:pr-4">{area(b.value)}</td>
                      <td className="pt-2 pr-2 sm:pr-4">{yours ?? "—"}</td>
                      <td className="pt-2">{diff === undefined ? "—" : pct(diff ?? null)}</td>
                    </tr>
                    <tr className="border-b">
                      <td colSpan={4} className="text-muted-foreground pb-2 text-xs">
                        {b.from === "metro" && <strong>Metro figure ({input.metroName}) · </strong>}
                        {provenanceText(meta, source, b.releaseDate, b.vintageDate, b.end)}
                        {b.flags.map((f) => (
                          <span key={f} className="block text-amber-800 dark:text-amber-300">
                            Flag: {catalog.known_events[f] ?? f}
                          </span>
                        ))}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {input.nonDisclosure && (
          <p className="text-sm">
            Non-disclosure state: sale prices are not public here, so price estimates rest on
            limited data.
          </p>
        )}
        {trend && (
          <p className="text-sm">
            Typical value trend here: {pct(changePct(trend.value, trend.y1))} over 1 year,{" "}
            {pct(changePct(trend.value, trend.y5))} over 5 years.
          </p>
        )}
      </section>

      <section aria-labelledby="deal-heading" className="space-y-3">
        <h2 id="deal-heading" className="text-lg font-semibold">
          {mode === "live"
            ? "As a home to live in"
            : mode === "rental"
              ? "As a rental"
              : "As a flip"}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm sm:max-w-lg">
          {mode === "live" && (
            <>
              <dt>Loan</dt>
              <dd>{usd(own.loan)}</dd>
              <dt>Principal and interest</dt>
              <dd>{usd(own.principalInterest)}/mo</dd>
              <dt>Property tax</dt>
              <dd>{usd(own.tax)}/mo</dd>
              <dt>Insurance</dt>
              <dd>{usd(own.insurance)}/mo</dd>
              <dt>HOA</dt>
              <dd>{usd(own.hoa)}/mo</dd>
              <dt className="font-semibold">Total monthly cost</dt>
              <dd className="font-semibold">{usd(own.total)}/mo</dd>
              <dt>Cash needed at closing</dt>
              <dd>{usd(own.cashToClose)}</dd>
              {rent !== null && (
                <>
                  <dt>Price-to-rent ratio</dt>
                  <dd>
                    {(price / (rent * 12)).toFixed(1)} years of rent
                    <span className="text-muted-foreground">
                      {" "}
                      (above ~20 usually favors renting)
                    </span>
                  </dd>
                </>
              )}
            </>
          )}
          {mode === "rental" && (
            <>
              <dt>Rent used</dt>
              <dd>
                {rent === null ? "Enter an expected rent" : `${usd(rent)}/mo`}
                {input.rentOverride === undefined && rent !== null && (
                  <span className="text-muted-foreground">
                    {" "}
                    (area rent index; edit under Assumptions)
                  </span>
                )}
              </dd>
              <dt>Gross yield</dt>
              <dd>{rent$.grossYieldPct === null ? "n/a" : `${rent$.grossYieldPct.toFixed(1)}%`}</dd>
              <dt>Cap rate</dt>
              <dd>{rent$.capRatePct === null ? "n/a" : `${rent$.capRatePct.toFixed(1)}%`}</dd>
              <dt className="font-semibold">Monthly cash flow</dt>
              <dd className="font-semibold">
                {rent$.cashFlowMo === null ? "n/a" : `${usd(rent$.cashFlowMo)}/mo`}
              </dd>
              <dt>Cash invested</dt>
              <dd>{usd(rent$.cashInvested)}</dd>
              <dt>Cash-on-cash return</dt>
              <dd>
                {rent$.cashOnCashPct === null ? "n/a" : `${rent$.cashOnCashPct.toFixed(1)}%/yr`}
              </dd>
            </>
          )}
          {mode === "flip" && (
            <>
              <dt>Resale value used</dt>
              <dd>
                {resale === null ? "Enter a resale value" : usd(resale)}
                {input.resaleOverride === undefined && resale !== null && (
                  <span className="text-muted-foreground">
                    {" "}
                    (area typical value; edit under Assumptions)
                  </span>
                )}
              </dd>
              <dt>Holding costs</dt>
              <dd>{usd(flip$.holding)}</dd>
              <dt>Total cost</dt>
              <dd>{usd(flip$.totalCost)}</dd>
              <dt className="font-semibold">Estimated profit</dt>
              <dd className="font-semibold">{flip$.profit === null ? "n/a" : usd(flip$.profit)}</dd>
              <dt>&quot;70% rule&quot; maximum price</dt>
              <dd>{flip$.seventyPctMaxPrice === null ? "n/a" : usd(flip$.seventyPctMaxPrice)}</dd>
            </>
          )}
        </dl>
        {checks.length > 0 && (
          <ul aria-label="Deal checks" className="space-y-1 text-sm">
            {checks.map((c) => (
              <li key={c.text}>
                <strong className={LEVEL[c.level].className}>{LEVEL[c.level].word}:</strong>{" "}
                {c.text}
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">
          Checks are common rules of thumb, not advice. Change the assumptions above to match your
          own loan, taxes and costs.
        </p>
      </section>
    </div>
  );
}

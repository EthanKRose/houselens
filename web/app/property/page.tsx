"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PropertyResults } from "@/components/PropertyResults";
import { SavedProperties } from "@/components/SavedProperties";
import { Button } from "@/components/ui/button";
import { pickBenchmarks } from "@/lib/benchmarks";
import { useCatalog, useGeoFile, useGeographies, useZipShard } from "@/lib/data";
import { DEFAULTS, type Assumptions } from "@/lib/deal";
import { parseListing } from "@/lib/parseListing";
import {
  loadSaved,
  parsePropertyParams,
  saveSaved,
  serializeProperty,
  type Mode,
  type Property,
} from "@/lib/property";

type Form = {
  zip: string;
  price: string;
  beds: string;
  baths: string;
  sqft: string;
  address: string;
};
const EMPTY: Form = { zip: "", price: "", beds: "", baths: "", sqft: "", address: "" };
const MODES: [Mode, string][] = [
  ["live", "Live in it"],
  ["rental", "Rent it out"],
  ["flip", "Fix and resell (flip)"],
];
/** Assumption inputs: field, label, unit hint. Which modes show each. */
const ASSUMPTIONS: [keyof Assumptions, string, Mode[]][] = [
  ["downPct", "Down payment (%)", ["live", "rental", "flip"]],
  ["ratePct", "Mortgage rate (%)", ["live", "rental", "flip"]],
  ["taxPct", "Property tax (% of price per year)", ["live", "rental", "flip"]],
  ["insuranceYr", "Insurance ($ per year)", ["live", "rental", "flip"]],
  ["hoaMo", "HOA ($ per month)", ["live", "rental", "flip"]],
  ["closingPct", "Closing costs (% of price)", ["live", "rental", "flip"]],
  ["vacancyPct", "Vacancy (% of rent)", ["rental"]],
  ["otherExpensePct", "Repairs and management (% of rent)", ["rental"]],
  ["rehab", "Renovation budget ($)", ["flip"]],
  ["holdMonths", "Months until sold", ["flip"]],
  ["sellingPct", "Selling costs (% of resale)", ["flip"]],
];

const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(/[$,\s]/g, "")));
const ok = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n > 0;

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  inputMode = "decimal",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  inputMode?: "decimal" | "numeric" | "text";
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      {label}
      <input
        id={id}
        inputMode={inputMode}
        className="rounded border px-2 py-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <span id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </span>
      )}
    </label>
  );
}

function Analyzer() {
  const params = useSearchParams();
  const [form, setForm] = useState<Form>(EMPTY);
  const [mode, setMode] = useState<Mode>("live");
  const [paste, setPaste] = useState("");
  const [pasteNote, setPasteNote] = useState("");
  const [edits, setEdits] = useState<Partial<Record<keyof Assumptions, string>>>({});
  const [rentText, setRentText] = useState("");
  const [resaleText, setResaleText] = useState("");
  const [notes, setNotes] = useState("");
  const [shareAddress, setShareAddress] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const [saved, setSaved] = useState<Property[]>([]);
  const [storageOk, setStorageOk] = useState(true);

  // Share links and saved properties are read once, after mount (browser-only state).
  useEffect(() => {
    const p = parsePropertyParams(new URLSearchParams(params.toString()));
    setForm({
      zip: p.zip ?? "",
      price: p.price ? String(p.price) : "",
      beds: p.beds !== undefined ? String(p.beds) : "",
      baths: p.baths !== undefined ? String(p.baths) : "",
      sqft: p.sqft ? String(p.sqft) : "",
      address: p.address ?? "",
    });
    setMode(p.mode);
    setSaved(loadSaved());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catalogQ = useCatalog();
  const geosQ = useGeographies();
  const zip = /^\d{5}$/.test(form.zip.trim()) ? form.zip.trim() : "";
  const shardQ = useZipShard(zip);
  const entry = zip ? shardQ.data?.[zip] : undefined;
  const metroQ = useGeoFile(entry?.cbsa ?? "");
  const usQ = useGeoFile("US");

  const marketRate = usQ.data?.series["fred.pmms.30y.nsa"]?.points.at(-1)?.[2];
  const assumptions: Assumptions = useMemo(() => {
    const a: Assumptions = { ...DEFAULTS, ratePct: marketRate ?? DEFAULTS.ratePct };
    for (const [k, v] of Object.entries(edits) as [keyof Assumptions, string][]) {
      const n = num(v);
      if (n !== undefined && Number.isFinite(n) && n >= 0) a[k] = n;
    }
    return a;
  }, [edits, marketRate]);

  const price = num(form.price);
  const beds = num(form.beds);
  const sqft = num(form.sqft);
  const bench = useMemo(
    () => pickBenchmarks(entry, metroQ.data, ok(beds) || beds === 0 ? beds : undefined),
    [entry, metroQ.data, beds],
  );
  const metroName = geosQ.data?.find((g) => g.geo_id === entry?.cbsa)?.name ?? null;
  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const fillFromPaste = () => {
    const got = parseListing(paste);
    const found = Object.keys(got);
    setForm((f) => ({
      ...f,
      ...(got.zip && { zip: got.zip }),
      ...(got.price && { price: String(got.price) }),
      ...(got.beds !== undefined && { beds: String(got.beds) }),
      ...(got.baths !== undefined && { baths: String(got.baths) }),
      ...(got.sqft && { sqft: String(got.sqft) }),
    }));
    setPasteNote(
      found.length
        ? `Filled in: ${found.join(", ")}. Check them below.`
        : "Couldn't find a price, beds, baths, square feet or ZIP in that text.",
    );
  };

  const inputs = {
    zip,
    price: ok(price) ? price : undefined,
    beds: beds !== undefined && Number.isInteger(beds) ? beds : undefined,
    baths: ok(num(form.baths)) ? num(form.baths) : undefined,
    sqft: ok(sqft) ? sqft : undefined,
    address: form.address.trim() || undefined,
    mode,
  };

  const share = async () => {
    const url = `${window.location.origin}/property?${serializeProperty(inputs, shareAddress)}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareNote("Link copied.");
    } catch {
      setShareNote(url);
    }
  };

  const save = () => {
    if (!inputs.zip || !inputs.price) return;
    const next = [
      ...saved,
      {
        ...inputs,
        zip: inputs.zip,
        price: inputs.price,
        notes: notes.trim() || undefined,
        id: `${Date.now()}`,
        savedAt: new Date().toISOString().slice(0, 10),
      },
    ];
    setSaved(next);
    setStorageOk(saveSaved(next));
  };

  const updateSaved = (next: Property[]) => {
    setSaved(next);
    setStorageOk(saveSaved(next));
  };

  const open = (p: Property) => {
    setForm({
      zip: p.zip,
      price: String(p.price),
      beds: p.beds !== undefined ? String(p.beds) : "",
      baths: p.baths !== undefined ? String(p.baths) : "",
      sqft: p.sqft ? String(p.sqft) : "",
      address: p.address ?? "",
    });
    setMode(p.mode);
    setNotes(p.notes ?? "");
    document.getElementById("property-heading")?.scrollIntoView();
  };

  const ready = inputs.zip && inputs.price;
  return (
    <div className="space-y-10">
      <section aria-labelledby="property-heading" className="space-y-4">
        <h2 id="property-heading" className="text-lg font-semibold">
          The property
        </h2>
        <details className="rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Paste a listing&apos;s text
          </summary>
          <div className="mt-3 space-y-2">
            <label htmlFor="paste" className="block text-sm">
              Copy the text of a listing you&apos;re viewing (price, beds, baths, square feet,
              address) and paste it here. It is read only in your browser; HouseLens never visits
              the listing.
            </label>
            <textarea
              id="paste"
              rows={4}
              className="w-full rounded border p-2 text-sm"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <Button variant="outline" onClick={fillFromPaste} disabled={!paste.trim()}>
              Fill in from text
            </Button>
            {pasteNote && (
              <p role="status" className="text-sm">
                {pasteNote}
              </p>
            )}
          </div>
        </details>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            id="zip"
            label="ZIP code (required)"
            value={form.zip}
            onChange={set("zip")}
            inputMode="numeric"
          />
          <Field
            id="price"
            label="Asking price (required)"
            value={form.price}
            onChange={set("price")}
            hint="e.g. 549900"
          />
          <Field
            id="sqft"
            label="Square feet"
            value={form.sqft}
            onChange={set("sqft")}
            inputMode="numeric"
          />
          <Field
            id="beds"
            label="Bedrooms"
            value={form.beds}
            onChange={set("beds")}
            inputMode="numeric"
          />
          <Field id="baths" label="Bathrooms" value={form.baths} onChange={set("baths")} />
          <Field
            id="address"
            label="Address (optional)"
            value={form.address}
            onChange={set("address")}
            inputMode="text"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What would you buy it for?</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {MODES.map(([m, label]) => (
              <label key={m} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <details className="rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Assumptions (rate {assumptions.ratePct.toFixed(2)}%, {assumptions.downPct}% down; edit
            to match yours)
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {ASSUMPTIONS.filter(([, , modes]) => modes.includes(mode)).map(([k, label]) => (
              <Field
                key={k}
                id={`a-${k}`}
                label={label}
                value={edits[k] ?? String(Math.round(assumptions[k] * 100) / 100)}
                onChange={(v) => setEdits((e) => ({ ...e, [k]: v }))}
                hint={
                  k === "ratePct" && !edits.ratePct
                    ? "Latest weekly 30-year fixed average (Freddie Mac)"
                    : undefined
                }
              />
            ))}
            {mode === "rental" && (
              <Field
                id="rent"
                label="Expected rent ($ per month)"
                value={rentText}
                onChange={setRentText}
                hint="Blank uses the area rent index"
              />
            )}
            {mode === "flip" && (
              <Field
                id="resale"
                label="Resale value after repairs ($)"
                value={resaleText}
                onChange={setResaleText}
                hint="Blank uses the area typical value"
              />
            )}
          </div>
        </details>
      </section>

      <div id="results" aria-live="polite">
        {!ready ? (
          <p className="text-sm">
            Enter a ZIP code and asking price to see how this property compares.
          </p>
        ) : catalogQ.isError || shardQ.isError ? (
          <p role="alert">Could not load housing data. Please try again later.</p>
        ) : !catalogQ.data || shardQ.isLoading ? (
          <p>Loading…</p>
        ) : !entry && !metroQ.data ? (
          <p role="alert" className="text-sm">
            No data for ZIP {zip}. Check the ZIP, or try a nearby one.
          </p>
        ) : (
          <PropertyResults
            catalog={catalogQ.data}
            input={{
              price: inputs.price!,
              sqft: inputs.sqft,
              mode,
              assumptions,
              rentOverride: ok(num(rentText)) ? num(rentText) : undefined,
              resaleOverride: ok(num(resaleText)) ? num(resaleText) : undefined,
              bench,
              areaName: entry ? `ZIP ${entry.name}` : `ZIP ${zip}`,
              metroName,
            }}
          />
        )}
      </div>

      {ready && (
        <section aria-labelledby="keep-heading" className="space-y-3">
          <h2 id="keep-heading" className="text-lg font-semibold">
            Keep or share it
          </h2>
          <Field
            id="notes"
            label="Notes (saved with the property, never shared)"
            value={notes}
            onChange={setNotes}
            inputMode="text"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save}>Save to this browser</Button>
            <Button variant="outline" onClick={share}>
              Copy share link
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shareAddress}
                onChange={(e) => setShareAddress(e.target.checked)}
              />
              Include the address in the link
            </label>
          </div>
          {shareNote && (
            <p role="status" className="text-sm break-all">
              {shareNote}
            </p>
          )}
        </section>
      )}

      <SavedProperties list={saved} onChange={updateSaved} onOpen={open} storageOk={storageOk} />
    </div>
  );
}

/**
 * Property analyzer: compare one property with its ZIP and judge it as a home, rental or flip.
 * @returns the page
 */
export default function PropertyPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Analyze a property</h1>
      <p className="text-muted-foreground max-w-3xl text-sm">
        Enter a home you found. HouseLens compares its price with free public figures for its ZIP
        code (Zillow, Realtor.com) and works out the costs of living in it, renting it out or
        flipping it. What you type stays in your browser; the site only downloads public figures for
        the area (by the first three digits of the ZIP).
      </p>
      <Suspense fallback={<p>Loading…</p>}>
        <Analyzer />
      </Suspense>
    </main>
  );
}

"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatValue } from "@/lib/format";
import { exportSaved, importSaved, type Property } from "@/lib/property";

const USE = { live: "Live in", rental: "Rental", flip: "Flip" } as const;

/**
 * Properties saved in this browser: side-by-side table, open/remove, and backup export/import.
 * @param props - component props
 * @param props.list - saved properties
 * @param props.onChange - called with the new list after a remove or import
 * @param props.onOpen - called to load a saved property into the analyzer
 * @param props.storageOk - false when the browser blocks storage
 * @returns the panel
 */
export function SavedProperties({
  list,
  onChange,
  onOpen,
  storageOk,
}: {
  list: Property[];
  onChange: (next: Property[]) => void;
  onOpen: (p: Property) => void;
  storageOk: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportSaved(list)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "houselens-properties.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url));
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      onChange(importSaved(await f.text(), list));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
    if (file.current) file.current.value = "";
  };

  return (
    <section aria-labelledby="saved-heading" className="space-y-3">
      <h2 id="saved-heading" className="text-lg font-semibold">
        Saved properties
      </h2>
      <p className="text-muted-foreground text-sm">
        Saved only in this browser on this device. Nobody else can see them; export a backup to keep
        them or move them to another device.
      </p>
      {!storageOk && (
        <p role="alert" className="text-sm text-amber-700">
          This browser is blocking site storage (private window or blocked site data), so saved
          properties won&apos;t be kept after you leave.
        </p>
      )}
      {list.length === 0 ? (
        <p className="text-sm">Nothing saved yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Saved properties side by side</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4">
                  Property
                </th>
                <th scope="col" className="py-2 pr-4">
                  Price
                </th>
                <th scope="col" className="py-2 pr-4">
                  Beds / baths
                </th>
                <th scope="col" className="py-2 pr-4">
                  Price per sq ft
                </th>
                <th scope="col" className="py-2 pr-4">
                  Judged as
                </th>
                <th scope="col" className="py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b align-top">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {p.address || `ZIP ${p.zip}`}
                    {p.address && (
                      <span className="text-muted-foreground block text-xs">ZIP {p.zip}</span>
                    )}
                    {p.notes && (
                      <span className="text-muted-foreground block text-xs font-normal">
                        {p.notes}
                      </span>
                    )}
                  </th>
                  <td className="py-2 pr-4">{formatValue(p.price, "usd")}</td>
                  <td className="py-2 pr-4">
                    {p.beds ?? "?"} / {p.baths ?? "?"}
                  </td>
                  <td className="py-2 pr-4">
                    {p.sqft ? `${formatValue(p.price / p.sqft, "usd")}/sq ft` : "—"}
                  </td>
                  <td className="py-2 pr-4">{USE[p.mode]}</td>
                  <td className="space-x-2 py-2 whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => onOpen(p)}>
                      Open<span className="sr-only"> {p.address || `ZIP ${p.zip}`}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onChange(list.filter((x) => x.id !== p.id))}
                    >
                      Remove<span className="sr-only"> {p.address || `ZIP ${p.zip}`}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={download} disabled={list.length === 0}>
          Export backup
        </Button>
        {/* The file input is visually hidden; focus-within shows keyboard focus on its button. */}
        <label className="focus-within:ring-ring inline-flex cursor-pointer items-center gap-2 rounded-md text-sm focus-within:ring-2">
          <span className="rounded-md border px-3 py-1.5">Import backup</span>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

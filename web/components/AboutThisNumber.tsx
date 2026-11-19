"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { SeriesMeta, Source } from "@/lib/types";

/**
 * Button that opens a drawer with methodology, license, flags and disclosure notes.
 * @param props - component props
 * @param props.series - series metadata
 * @param props.source - the series' source
 * @param props.flags - flag ids present on the displayed point
 * @param props.knownEvents - catalog.known_events, id to explanation
 * @param props.nonDisclosure - true if the geography is a non-disclosure state
 * @returns the button and drawer
 */
export function AboutThisNumber({
  series,
  source,
  flags,
  knownEvents,
  nonDisclosure,
}: {
  series: SeriesMeta;
  source: Source;
  flags: string[];
  knownEvents: Record<string, string>;
  nonDisclosure: boolean;
}) {
  const [open, setOpen] = useState(false);
  const priceBased =
    (series.source_id === "fred" && series.metric_id === "price_index") ||
    series.series_id.startsWith("zillow.zhvi");
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        About this number
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto p-4">
          <SheetHeader>
            <SheetTitle>{series.series_id}</SheetTitle>
            <SheetDescription>{source.name}</SheetDescription>
          </SheetHeader>
          {series.methodology_md.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <p>License: {source.license_note}</p>
          {flags.map((f) => (
            <p key={f}>Flag: {knownEvents[f] ?? f}</p>
          ))}
          {nonDisclosure && priceBased && (
            <p>
              Non-disclosure state: sale prices are not public here, so price estimates rest on
              limited data.
            </p>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

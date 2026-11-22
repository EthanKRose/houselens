"use client";

import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import type { SeriesMeta } from "@/lib/types";

/**
 * Small "i" button that opens a plain-language description of a series.
 * Opens on click, tap or Enter/Space; Escape or clicking outside closes it.
 * @param props - component props
 * @param props.series - the series to describe
 * @returns the button and its popover
 */
export function SeriesInfo({ series }: { series: SeriesMeta }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`What is ${series.name}?`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle focus-visible:ring-2 focus-visible:outline-none"
      >
        <Info aria-hidden="true" className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} className="z-50">
          <Popover.Popup className="bg-popover text-popover-foreground max-w-xs space-y-1 rounded-md border p-3 text-sm shadow-md">
            <Popover.Title className="font-medium">{series.name}</Popover.Title>
            <Popover.Description>{series.summary}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

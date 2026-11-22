"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { Geography } from "@/lib/types";

/**
 * Searchable geography picker (matches name, geo_id or CBSA code). Opening moves focus to the
 * search box; Escape or choosing a place closes it and returns focus to the button.
 * @param props - component props
 * @param props.geographies - all geographies
 * @param props.value - selected geo_id
 * @param props.onChange - called with the chosen geo_id
 * @returns the picker
 */
export function GeoPicker({
  geographies,
  value,
  onChange,
}: {
  geographies: Geography[];
  value: string;
  onChange: (geoId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // Closing unmounts the focused search box, so hand focus back or keyboard users lose their place.
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const current = geographies.find((g) => g.geo_id === value);
  return (
    <div className="max-w-sm">
      <Button ref={button} variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {current?.name ?? value}
      </Button>
      {open && (
        <Command className="mt-1 border" onKeyDown={(e) => e.key === "Escape" && close()}>
          <CommandInput autoFocus placeholder="Search by name, ID or CBSA code" />
          <CommandList>
            <CommandEmpty>No geography found.</CommandEmpty>
            {geographies.map((g) => (
              <CommandItem
                key={g.geo_id}
                value={`${g.name} ${g.geo_id}`}
                onSelect={() => {
                  onChange(g.geo_id);
                  close();
                }}
              >
                {g.name} <span className="text-muted-foreground text-xs">{g.geo_id}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      )}
    </div>
  );
}

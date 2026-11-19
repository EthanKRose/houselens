import { freshnessStatus } from "@/lib/freshness";
import type { Freshness } from "@/lib/types";

const LOOK = {
  green: { label: "Fresh", cls: "bg-green-600" },
  amber: { label: "Due", cls: "bg-amber-500" },
  red: { label: "Stale", cls: "bg-red-600" },
};

/**
 * Coloured dot plus text label for how current a series is.
 * @param props - component props
 * @param props.freshness - the series' freshness entry
 * @param props.today - reference date
 * @returns the indicator
 */
export function FreshnessDot({ freshness, today }: { freshness: Freshness[string]; today: Date }) {
  const { label, cls } = LOOK[freshnessStatus(freshness, today)];
  return (
    <span aria-label={label} className="inline-flex items-center gap-1 text-xs">
      <span className={`inline-block size-2 rounded-full ${cls}`} aria-hidden="true" />
      {label}
    </span>
  );
}

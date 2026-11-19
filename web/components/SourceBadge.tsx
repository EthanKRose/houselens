import { provenanceText } from "@/lib/format";
import type { SeriesMeta, Source } from "@/lib/types";

/**
 * Always-visible provenance line for a displayed number.
 * @param props - component props
 * @param props.series - series metadata
 * @param props.source - the series' source
 * @param props.releaseDate - release date, or null
 * @param props.vintageDate - vintage date
 * @param props.periodEnd - end of the displayed period
 * @returns the provenance text
 */
export function SourceBadge({
  series,
  source,
  releaseDate,
  vintageDate,
  periodEnd,
}: {
  series: SeriesMeta;
  source: Source;
  releaseDate: string | null;
  vintageDate: string;
  periodEnd: string;
}) {
  return (
    <p className="text-muted-foreground text-xs">
      {provenanceText(series, source, releaseDate, vintageDate, periodEnd)}
      {series.source_id === "realtor" && (
        <>
          {" "}
          · <strong>Listing data (asking prices), not sales</strong>
        </>
      )}
    </p>
  );
}

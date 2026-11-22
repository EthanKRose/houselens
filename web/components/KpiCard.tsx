import { useMemo } from "react";
import { AboutThisNumber } from "@/components/AboutThisNumber";
import { FreshnessDot } from "@/components/FreshnessDot";
import { SourceBadge } from "@/components/SourceBadge";
import { SeriesInfo } from "@/components/SeriesInfo";
import { Sparkline } from "@/components/Sparkline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatValue } from "@/lib/format";
import { applyTransform } from "@/lib/transforms";
import type { Freshness, Metric, Point, SeriesMeta, Source } from "@/lib/types";

/**
 * Card with the latest value, YoY change, sparkline and full provenance for one series.
 * @param props - component props
 * @param props.series - series metadata
 * @param props.metric - the series' metric
 * @param props.source - the series' source
 * @param props.points - observations, oldest first (non-empty)
 * @param props.releaseDate - release date, or null
 * @param props.vintageDate - vintage date
 * @param props.freshness - freshness entry, if known
 * @param props.today - reference date for freshness
 * @param props.knownEvents - catalog.known_events
 * @param props.nonDisclosure - true if the geography is a non-disclosure state
 * @param props.national - true to label the card "(US)"
 * @returns the card
 */
export function KpiCard({
  series,
  metric,
  source,
  points,
  releaseDate,
  vintageDate,
  freshness,
  today,
  knownEvents,
  nonDisclosure,
  national = false,
}: {
  series: SeriesMeta;
  metric: Metric;
  source: Source;
  points: Point[];
  releaseDate: string | null;
  vintageDate: string;
  freshness?: Freshness[string];
  today: Date;
  knownEvents: Record<string, string>;
  nonDisclosure: boolean;
  national?: boolean;
}) {
  const spark = useMemo(() => points.slice(-60).map((p) => p.value), [points]);
  const last = points[points.length - 1];
  // The last YoY point can belong to an older period when the latest point has no year-ago partner.
  const latestYoy = applyTransform(points, "yoy", series.frequency).at(-1);
  const yoy = latestYoy?.end === last.end ? latestYoy : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-start gap-1">
          <h3>
            {series.name}
            {national && " (US)"}
          </h3>
          <SeriesInfo series={series} />
        </CardTitle>
        <p className="text-muted-foreground text-xs">{series.series_id}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-2xl font-semibold">{formatValue(last.value, metric.unit)}</p>
        <p className="text-sm">
          Period ending {last.end} · YoY{" "}
          {yoy ? `${yoy.value >= 0 ? "+" : ""}${yoy.value.toFixed(1)}%` : "n/a"}
        </p>
        <Sparkline values={spark} />
        <SourceBadge
          series={series}
          source={source}
          releaseDate={releaseDate}
          vintageDate={vintageDate}
          periodEnd={last.end}
        />
        <div className="flex items-center gap-2">
          {freshness && <FreshnessDot freshness={freshness} today={today} />}
          <AboutThisNumber
            series={series}
            source={source}
            flags={last.flags}
            knownEvents={knownEvents}
            nonDisclosure={nonDisclosure}
          />
        </div>
      </CardContent>
    </Card>
  );
}

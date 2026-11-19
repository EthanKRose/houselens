/** One exported observation; field order matches the CSV columns. */
export type CsvRow = {
  series_id: string;
  source: string;
  method_family: string;
  seasonal_adj: boolean;
  geo_id: string;
  period_start: string;
  period_end: string;
  value: number;
  transform: string;
  vintage_date: string;
  release_date: string | null;
  quality_flags: string[];
};

const COLUMNS: (keyof CsvRow)[] = [
  "series_id",
  "source",
  "method_family",
  "seasonal_adj",
  "geo_id",
  "period_start",
  "period_end",
  "value",
  "transform",
  "vintage_date",
  "release_date",
  "quality_flags",
];

const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/**
 * Builds the compare-view CSV.
 * @param rows - observations to export
 * @param attributions - source attribution lines, written first as "# " comments
 * @returns RFC 4180 CSV text, lines joined with "\n"
 */
export function toCsv(rows: CsvRow[], attributions: string[]): string {
  return [
    ...attributions.map((a) => `# ${a.replace(/[\r\n]+/g, " ")}`),
    COLUMNS.join(","),
    ...rows.map((r) =>
      COLUMNS.map((c) => {
        const v = r[c];
        return field(Array.isArray(v) ? v.join(";") : v === null ? "" : String(v));
      }).join(","),
    ),
  ].join("\n");
}

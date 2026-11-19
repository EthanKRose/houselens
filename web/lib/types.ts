/** Publication cadence of a series. */
export type Frequency = "weekly" | "monthly" | "quarterly";

/** A data source and its licensing/attribution text. */
export type Source = {
  source_id: string;
  name: string;
  publisher: string;
  homepage_url: string;
  license_note: string;
  attribution: string;
};

/** A measured quantity (e.g. median sale price). */
export type Metric = {
  metric_id: string;
  label: string;
  unit: "usd" | "index" | "pct" | "count" | "days" | "months";
  higher_is: "up" | "down" | "neutral" | null;
};

/** Metadata describing one series. */
export type SeriesMeta = {
  series_id: string;
  source_id: string;
  metric_id: string;
  method_family: string;
  market: string;
  property_type: string;
  bedrooms: string;
  tier: string;
  new_or_existing: string;
  seasonal_adj: boolean;
  frequency: Frequency;
  typical_lag_days: number | null;
  methodology_md: string;
  release_date_kind: "published" | "first_seen";
  national_only: boolean;
};

/** Contents of catalog.json. */
export type Catalog = {
  sources: Source[];
  metrics: Metric[];
  series: SeriesMeta[];
  known_events: Record<string, string>;
};

/** One entry of geographies.json. */
export type Geography = {
  geo_id: string;
  level: "US" | "ST" | "CBSA";
  name: string;
  state_fips: string | null;
  non_disclosure: boolean;
  has_msad: boolean;
  series_ids: string[];
};

/** Contents of freshness.json, keyed by series_id. */
export type Freshness = Record<
  string,
  {
    last_period_end: string;
    last_release_date: string | null;
    last_ingest_at: string | null;
    frequency: Frequency;
    typical_lag_days: number | null;
  }
>;

/** Contents of geo/{geo}.json. */
export type GeoFile = {
  geo_id: string;
  series: Record<
    string,
    {
      vintage_date: string;
      release_date: string | null;
      points: [string, string, number, string[]][];
    }
  >;
};

/** One observation of a series. */
export type Point = {
  start: string;
  end: string;
  value: number;
  flags: string[];
};

CREATE TABLE IF NOT EXISTS source (
  source_id TEXT PRIMARY KEY, name TEXT NOT NULL, publisher TEXT NOT NULL,
  homepage_url TEXT, license_note TEXT NOT NULL, access_method TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metric (
  metric_id TEXT PRIMARY KEY, label TEXT NOT NULL,
  unit TEXT NOT NULL,             -- usd|index|pct|count|days|months
  higher_is TEXT                  -- up|down|neutral
);
CREATE TABLE IF NOT EXISTS series (
  series_id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES source, metric_id TEXT REFERENCES metric,
  method_family TEXT NOT NULL,    -- repeat_sales|median|hedonic_avm|survey|listing
  market TEXT NOT NULL,           -- sale|rent|finance|construction
  property_type TEXT DEFAULT 'all', bedrooms TEXT DEFAULT 'all',
  tier TEXT DEFAULT 'all', new_or_existing TEXT DEFAULT 'all',
  seasonal_adj BOOLEAN NOT NULL, frequency TEXT NOT NULL,
  typical_lag_days INTEGER, methodology_md TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS geography (
  geo_id TEXT PRIMARY KEY, level TEXT NOT NULL, name TEXT NOT NULL,
  state_fips TEXT, non_disclosure BOOLEAN DEFAULT FALSE,
  valid_from DATE, valid_to DATE
);
CREATE TABLE IF NOT EXISTS geo_crosswalk (
  from_geo_id TEXT, to_geo_id TEXT, res_ratio DOUBLE, tot_ratio DOUBLE,
  vintage TEXT NOT NULL, PRIMARY KEY (from_geo_id, to_geo_id, vintage)
);
CREATE TABLE IF NOT EXISTS vendor_geo_map (
  source_id TEXT, vendor_region_id TEXT, vendor_name TEXT, geo_id TEXT,
  match_method TEXT,              -- fips|cbsa_code|zip_code|name_fuzzy|manual
  PRIMARY KEY (source_id, vendor_region_id)
);
CREATE TABLE IF NOT EXISTS observation (
  series_id TEXT, geo_id TEXT, period_start DATE NOT NULL, period_end DATE NOT NULL,
  value DOUBLE, vintage_date DATE NOT NULL, release_date DATE,
  is_derived BOOLEAN DEFAULT FALSE,
  quality_flags TEXT[]
  -- No PRIMARY KEY: its index was ~5x the data at ZIP scale. ingest.write_vintage enforces
  -- (series_id, geo_id, period_start, vintage_date) uniqueness instead.
);
CREATE TABLE IF NOT EXISTS ingest_run (
  run_id TEXT PRIMARY KEY, source_id TEXT, started_at TIMESTAMP, finished_at TIMESTAMP,
  status TEXT, file_checksum TEXT, rows_written BIGINT, message TEXT
);
CREATE TABLE IF NOT EXISTS discrepancy (
  geo_id TEXT, metric_family TEXT, period_start DATE, n_sources INTEGER,
  min_yoy DOUBLE, max_yoy DOUBLE, spread_pp DOUBLE, sign_conflict BOOLEAN,
  confidence TEXT, explanation_md TEXT,
  PRIMARY KEY (geo_id, metric_family, period_start)
);
CREATE OR REPLACE VIEW observation_latest AS
SELECT * FROM observation o WHERE vintage_date = (
  SELECT max(vintage_date) FROM observation x
  WHERE x.series_id=o.series_id AND x.geo_id=o.geo_id AND x.period_start=o.period_start);

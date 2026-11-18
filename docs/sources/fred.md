# FRED (Federal Reserve Economic Data)

- **Endpoint:** `GET https://api.stlouisfed.org/fred/series/observations?series_id=<ID>&api_key=<KEY>&file_type=json`, one request per series id, 30 s timeout. Needs a free `FRED_API_KEY`; the adapter never logs it or includes it in errors.
- **Series ids:** CSUSHPISA, CSUSHPINSA, SPCS20RSA (Case-Shiller national / 20-city), 20 metro `*RSA` ids mapped to CBSA codes (see `catalog.yaml`, `fred.cs.metro.sa`), MORTGAGE30US (Freddie Mac PMMS, weekly), HOUST (Census starts), CUSR0000SEHA (CPI rent), CUSR0000SEHC (CPI OER).
- **Parsing:** `date` becomes a period by series frequency (weekly = 7 days ending on the date, monthly = calendar month); `release_date` = `realtime_start`.
- **License:** mostly public domain, but Case-Shiller is copyrighted by S&P Dow Jones Indices; attribute "S&P Dow Jones Indices via FRED" wherever those series are shown. Freddie Mac, Census and BLS series are attributed to their owners.
- **Quirks:** missing values arrive as the string `"."` and are skipped. `realtime_start` is the date of the request's real-time window, not a true publication date, so it is a proxy for release date. Metro Case-Shiller areas are not identical to OMB CBSAs.
- **Fixtures:** `pipeline/tests/fixtures/fred/*.json` are hand-built in API shape; replace with real responses once a key exists.

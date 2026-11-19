# Zillow Research (ZHVI, ZORI)

- **Files:** `https://files.zillowstatic.com/research/public_csvs/` + `zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv` (`zhvi_metro`), `zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv` (`zhvi_state`), `zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv` (`zori_metro`). Plain GET, no key.
- **Series:** `zillow.zhvi.all.mid.sa` (parts `zhvi_metro|zhvi_state`), `zillow.zori.all.sa` (part `zori_metro`).
- **Shape:** `RegionID,SizeRank,RegionName,RegionType,StateName,<YYYY-MM-DD month-end>...`, unpivoted wide to long; each month column becomes a calendar-month period. Blank cells are skipped.
- **Regions:** `country` gives level US, `state` gives ST (`vendor_name` = RegionName), `msa` gives CBSA with `code` null (names resolve in geo). `vendor_region_id` = RegionID.
- **Release date:** null from the adapter; the files carry none, so the date HouseLens first saw the file is used ("first seen").
- **License / attribution:** free for public use with clear attribution: "Data: Zillow Research (ZHVI, ZORI), used with attribution." Show it wherever these series appear.
- **Hard rule:** no Zillow or Bridge API, and never scrape zillow.com pages. Only these public Research CSVs are used, and Zillow API data is never stored.
- **Quirks:** files are revised in place monthly (new vintage each time). The state file has no US row. Small metros have long blank runs. The ZORI file covers fewer regions than ZHVI.
- **Fixtures:** `pipeline/tests/fixtures/zillow/*.csv` are real rows (cut 2026-11-18), last 14 month columns; ZHVI metro has one blank cell (Lamesa, TX), ZORI has a sparse micro (Spirit Lake, IA).

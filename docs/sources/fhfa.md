# FHFA House Price Index

- **Endpoint:** `GET https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv` (one ~17 MB file, no key; the adapter follows redirects, 120 s timeout). Stored as part `hpi_master.csv`.
- **Columns:** `hpi_type,hpi_flavor,frequency,level,place_name,place_id,yr,period,index_nsa,index_sa,rstderr,note`. `place_name` is quoted and contains commas for metros.
- **Parsing:** only `hpi_type == "traditional"` rows matching a catalog `vendor_key` (`flavor|frequency|level|value column`): purchase-only monthly US (`index_sa`), purchase-only quarterly State (`index_sa`), all-transactions quarterly MSA (`index_nsa`). Monthly `period` 1-12 = calendar month; quarterly 1-4 = calendar quarter. Blank values are skipped.
- **Regions:** US row `USA` (level `US`, code null); states level `ST`, vendor_name = state name, code null; MSAs level `CBSA`, code = `place_id`. Census divisions (`DV_*`) are skipped.
- **Metro divisions:** MSA rows include metro divisions (names end "(MSAD)", e.g. Boston `14454`). They are emitted with their code; geo resolution maps them via `msad.csv` or skips them. A check of the live file (410 MSA place_ids, Nov 2026) found every id in `cbsa.csv` or `msad.csv`, none unresolved.
- **Release date:** not in the file, so `release_date` is null and the series use `release_date_kind: first_seen`; typical lag about 60 days. Values are revised as new sale pairs arrive (new vintage each time).
- **License:** public domain; attribute "Federal Housing Finance Agency, House Price Index".
- **Fixtures:** `pipeline/tests/fixtures/fhfa/hpi_master.csv` is real live rows, trimmed (US monthly, Texas quarterly, Austin 12420, Boston MSAD 14454, a division row, one non-catalog all-transactions State row). The live file had no blank values in catalog columns, so Texas 2025 Q1 `index_sa` was blanked by hand to exercise the skip.

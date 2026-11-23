# Realtor.com Research (`realtor`)

**Listing data, not sales.** Every value is an asking price or an active-listing measure.

## URLs

`https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_{Country,State,Metro}_History.csv`
and, for ZIP codes, the latest-month file `RDC_Inventory_Core_Metrics_Zip.csv` (~7.5 MB). The ZIP
*history* file is ~840 MB, so it is not downloaded; ZIP history builds up one monthly vintage at a
time instead (so ZIP 1-year comparisons for Realtor.com figures appear after a year).
(published at https://www.realtor.com/research/data/; monthly, updated around the 10th with the prior month).

## Columns used

Region: country file `country` (-> US); state file `state_id`/`state`; metro file `cbsa_code`/`cbsa_title`;
ZIP file `postal_code`/`zip_name` (-> ZIP; ~0.6% are not Census ZCTAs and are reported unmatched).
Period: `month_date_yyyymm` -> calendar month. Values: `median_listing_price`, `active_listing_count`,
`median_days_on_market`, `price_reduced_share`, `median_listing_price_per_square_foot` (series `realtor.median_list_ppsf.all.nsa`). The `_mm`/`_yy` columns are ignored (HouseLens computes transforms). `price_reduced_share` is a 0-1 fraction in the file; the adapter multiplies it by 100 so it matches the catalog's `pct` unit.
`quality_flag == 1` -> row flag `realtor_quality_flag`. Blank values are skipped. `release_date` is null (first seen).

## Attribution

"Data: Realtor.com ® Economic Research." Wording from the data page; see `LICENSES.md`.
Never scrape realtor.com pages.

## Notes

- Metro codes are 2023-CBSA compatible; the live file also carries Micropolitan codes (e.g. 25100).
- Blank values in the live file are rare (only `median_days_on_market` for CBSA 25100, 2016-09 to 2017-02).

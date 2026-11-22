#!/usr/bin/env bash
# Usage: r2.sh get|put <local-path> <key>. State store for houselens.duckdb in private R2.
set -euo pipefail

: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${R2_BUCKET:?}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

cmd="${1:?usage: r2.sh get|put <local> <key>}"
local_path="${2:?missing local path}"
key="${3:?missing key}"
prev_key="${key%.duckdb}.prev.duckdb"

# Prints 1 if the key exists, 0 if not; exits 1 on any aws error (no text parsing of errors).
key_exists() {
  local n
  n=$(aws s3api list-objects-v2 --endpoint-url "$ENDPOINT" --bucket "$R2_BUCKET" --prefix "$key" \
    --query "length(Contents[?Key=='$key'] || \`[]\`)" --output text) || {
    echo "R2 list-objects-v2 failed; refusing to continue" >&2
    exit 1
  }
  echo "$n"
}

# Own statement (not inside [ ]) so set -e aborts if the listing fails.
exists=$(key_exists)
case "$exists" in 0 | 1) ;; *) echo "unexpected R2 listing result" >&2; exit 1 ;; esac

case "$cmd" in
  get)
    if [ "$exists" = 1 ]; then
      aws s3 cp --endpoint-url "$ENDPOINT" --only-show-errors "s3://${R2_BUCKET}/${key}" "$local_path"
    elif [ "${ALLOW_FRESH:-}" = 1 ]; then
      echo "no remote DB (first run)"
    else
      echo "no remote DB and ALLOW_FRESH is not set; refusing to start from an empty DB" >&2
      exit 1
    fi
    ;;
  put)
    if [ "$exists" = 1 ]; then
      # R2 has no GetObjectTagging; the default copy-props would call it and fail.
      aws s3 cp --endpoint-url "$ENDPOINT" --only-show-errors --copy-props none \
        "s3://${R2_BUCKET}/${key}" "s3://${R2_BUCKET}/${prev_key}"
    elif [ "${ALLOW_FRESH:-}" != 1 ]; then
      echo "no remote DB and ALLOW_FRESH is not set; refusing to create one" >&2
      exit 1
    fi
    aws s3 cp --endpoint-url "$ENDPOINT" --only-show-errors "$local_path" "s3://${R2_BUCKET}/${key}"
    ;;
  *) echo "usage: r2.sh get|put <local> <key>" >&2; exit 2 ;;
esac

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

head_object() { aws s3api head-object --endpoint-url "$ENDPOINT" --bucket "$R2_BUCKET" --key "$key" 2>&1; }

case "$cmd" in
  get)
    if out=$(head_object); then
      aws s3 cp --endpoint-url "$ENDPOINT" --only-show-errors "s3://${R2_BUCKET}/${key}" "$local_path"
    elif grep -qE '404|NoSuchKey|Not Found' <<<"$out"; then
      echo "no remote DB (first run)"
    else
      echo "R2 head-object failed (not a 404); refusing to continue" >&2
      echo "$out" | grep -v -F "$R2_SECRET_ACCESS_KEY" >&2
      exit 1
    fi
    ;;
  put)
    if out=$(head_object); then
      aws s3 cp --endpoint-url "$ENDPOINT" --only-show-errors "s3://${R2_BUCKET}/${key}" "s3://${R2_BUCKET}/${prev_key}"
    elif ! grep -qE '404|NoSuchKey|Not Found' <<<"$out"; then
      echo "R2 head-object failed (not a 404); not overwriting" >&2
      exit 1
    fi
    aws s3 cp --endpoint-url "$ENDPOINT" --only-show-errors "$local_path" "s3://${R2_BUCKET}/${key}"
    ;;
  *) echo "usage: r2.sh get|put <local> <key>" >&2; exit 2 ;;
esac

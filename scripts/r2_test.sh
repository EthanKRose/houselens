#!/usr/bin/env bash
# Self-check for r2.sh using a stub `aws` on PATH. STUB_LIST: fail|0|1.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/aws" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
if [ "$2" = list-objects-v2 ]; then
  [ "$STUB_LIST" = fail ] && exit 255
  echo "$STUB_LIST"
fi
exit 0
STUB
chmod +x "$tmp/aws"
export PATH="$tmp:$PATH" STUB_LOG="$tmp/log"
export R2_ACCOUNT_ID=a R2_ACCESS_KEY_ID=b R2_SECRET_ACCESS_KEY=c R2_BUCKET=bkt

# run <list> <fresh> <cmd>: prints exit code; resets log.
run() {
  : > "$STUB_LOG"
  STUB_LIST="$1" ALLOW_FRESH="$2" "$here/r2.sh" "$3" f houselens.duckdb > /dev/null 2>&1 && echo 0 || echo $?
}
check() { [ "$1" = "$2" ] || { echo "FAIL: $3 (got $1, want $2)" >&2; exit 1; }; }

for c in get put; do
  check "$(run fail 1 $c)" 1 "$c aws error with ALLOW_FRESH"
  check "$(run fail "" $c)" 1 "$c aws error"
done
check "$(run 0 "" get)" 1 "get missing, no ALLOW_FRESH"
check "$(run 0 1 get)" 0 "get missing, ALLOW_FRESH"
check "$(run 0 "" put)" 1 "put missing, no ALLOW_FRESH"
check "$(run 1 "" put)" 0 "put exists"
grep -q "s3 cp .*s3://bkt/houselens.duckdb s3://bkt/houselens.prev.duckdb" "$STUB_LOG" || { echo "FAIL: no prev copy" >&2; exit 1; }
grep -q "s3 cp .* f s3://bkt/houselens.duckdb" "$STUB_LOG" || { echo "FAIL: no upload" >&2; exit 1; }
echo "r2_test OK"

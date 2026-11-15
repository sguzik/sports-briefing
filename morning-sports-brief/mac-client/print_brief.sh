#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Morning Sports Brief — Headless Mac Mini Print Client
# Dependencies: curl, Google Chrome, CUPS (lp)
# ==============================================================================

BRIEF_URL="${BRIEF_URL:-https://YOUR_GITHUB_USERNAME.github.io/morning-sports-brief/latest.html}"
PRINTER_NAME="${PRINTER_NAME:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
STATE_FILE="${STATE_FILE:-$HOME/.sports_brief_last_printed}"
CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

DRY_RUN=false
FORCE_PRINT=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --force)
      FORCE_PRINT=true
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--force]"
      echo "  --dry-run   Generate latest.pdf in /tmp without sending to printer or updating state"
      echo "  --force     Print even if today's edition-date was already printed"
      exit 0
      ;;
  esac
done

if [[ ! -x "$CHROME_BIN" ]]; then
  echo "ERROR: Google Chrome not found at: $CHROME_BIN" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

HTML_FILE="$TMP_DIR/latest.html"
PDF_FILE="$TMP_DIR/latest.pdf"

CURL_ARGS=(-fsSL --retry 3 --retry-delay 5)
if [[ -n "$GITHUB_TOKEN" ]]; then
  CURL_ARGS+=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi

echo "Fetching $BRIEF_URL ..."
curl "${CURL_ARGS[@]}" "$BRIEF_URL" -o "$HTML_FILE"

EDITION_DATE="$(grep -i '<meta[^>]*name=["'\'']edition-date["'\'']' "$HTML_FILE" | sed -E 's/.*content=["'\'']([^"'\'']+)["'\''].*/\1/' | head -n 1 || true)"

if [[ -z "$EDITION_DATE" ]]; then
  echo "WARNING: Could not find <meta name=\"edition-date\"> tag; using current date."
  EDITION_DATE="$(date +%Y-%m-%d)"
fi

if [[ "$DRY_RUN" == false && "$FORCE_PRINT" == false && -f "$STATE_FILE" ]]; then
  LAST_PRINTED="$(cat "$STATE_FILE" || true)"
  if [[ "$LAST_PRINTED" == "$EDITION_DATE" ]]; then
    echo "Edition $EDITION_DATE already printed (per $STATE_FILE). Skipping."
    exit 0
  fi
fi

echo "Rendering US Letter PDF for edition $EDITION_DATE ..."
"$CHROME_BIN" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --no-pdf-header-footer \
  --print-to-pdf="$PDF_FILE" \
  "file://$HTML_FILE" >/dev/null 2>&1

if [[ ! -s "$PDF_FILE" ]]; then
  echo "ERROR: PDF generation failed." >&2
  exit 1
fi

if [[ "$DRY_RUN" == true ]]; then
  PREVIEW_PATH="/tmp/morning_sports_brief_${EDITION_DATE}.pdf"
  cp "$PDF_FILE" "$PREVIEW_PATH"
  echo "DRY RUN complete. Preview PDF saved to: $PREVIEW_PATH"
  exit 0
fi

LP_ARGS=(-o media=letter)
if [[ -n "$PRINTER_NAME" ]]; then
  LP_ARGS+=(-d "$PRINTER_NAME")
fi

echo "Submitting $PDF_FILE to printer ..."
lp "${LP_ARGS[@]}" "$PDF_FILE"

echo "$EDITION_DATE" > "$STATE_FILE"
echo "Successfully printed edition $EDITION_DATE."

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
INPUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --force)
      FORCE_PRINT=true
      shift
      ;;
    --file)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --file requires a path argument." >&2
        exit 1
      fi
      INPUT_FILE="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--force] [--file /path/to/latest.html]"
      echo "  --dry-run       Generate latest.pdf in /tmp without sending to printer or updating state"
      echo "  --force         Print even if today's edition-date was already printed"
      echo "  --file <path>   Render from a local HTML file instead of fetching BRIEF_URL"
      exit 0
      ;;
    *)
      if [[ -z "$INPUT_FILE" && "$1" != -* ]]; then
        INPUT_FILE="$1"
        shift
      else
        echo "ERROR: Unknown argument: $1" >&2
        exit 1
      fi
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

SOURCE_TARGET="${INPUT_FILE:-$BRIEF_URL}"
# Trim leading/trailing whitespace and expand leading ~/
SOURCE_TARGET="${SOURCE_TARGET#"${SOURCE_TARGET%%[![:space:]]*}"}"
SOURCE_TARGET="${SOURCE_TARGET%"${SOURCE_TARGET##*[![:space:]]}"}"
if [[ "$SOURCE_TARGET" == "~/"* ]]; then
  SOURCE_TARGET="$HOME/${SOURCE_TARGET#\~/}"
fi

resolve_local_file() {
  local raw="$1"
  local candidate=""

  if [[ "$raw" == file://* ]]; then
    candidate="${raw#file://}"
    candidate="${candidate#localhost}"
    if [[ "$candidate" == "~/"* ]]; then
      candidate="$HOME/${candidate#\~/}"
    fi
    # Handle missing third slash like file://Users/name/file.html
    if [[ ! -e "$candidate" && "$candidate" != /* && -e "/$candidate" ]]; then
      candidate="/$candidate"
    fi
    echo "$candidate"
    return 0
  fi

  if [[ "$raw" == file:* ]]; then
    candidate="${raw#file:}"
    echo "$candidate"
    return 0
  fi

  if [[ "$raw" != http://* && "$raw" != https://* ]]; then
    if [[ -e "$raw" || "$raw" == /* || "$raw" == ./* || "$raw" == ../* || "$raw" == *.html || "$raw" == *.htm ]]; then
      echo "$raw"
      return 0
    fi
  fi

  return 1
}

if LOCAL_PATH="$(resolve_local_file "$SOURCE_TARGET")"; then
  if [[ ! -f "$LOCAL_PATH" ]]; then
    echo "ERROR: Local HTML file not found: $LOCAL_PATH" >&2
    exit 1
  fi
  echo "Loading local file $LOCAL_PATH ..."
  cp "$LOCAL_PATH" "$HTML_FILE"
else
  # Normalize localhost/127.0.0.1 URLs missing an explicit http:// scheme
  if [[ "$SOURCE_TARGET" == localhost:* || "$SOURCE_TARGET" == 127.0.0.1:* ]]; then
    SOURCE_TARGET="http://$SOURCE_TARGET"
  fi

  if [[ "$SOURCE_TARGET" == *"YOUR_GITHUB_USERNAME"* || "$SOURCE_TARGET" == *"<"* || "$SOURCE_TARGET" == *">"* ]]; then
    echo "ERROR: BRIEF_URL is still a placeholder ($SOURCE_TARGET)." >&2
    echo "Set BRIEF_URL to your GitHub Pages URL or pass --file /path/to/latest.html." >&2
    exit 1
  fi

  CURL_ARGS=(-fsSL --retry 3 --retry-delay 5)
  if [[ -n "$GITHUB_TOKEN" ]]; then
    CURL_ARGS+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  fi

  echo "Fetching $SOURCE_TARGET ..."
  curl "${CURL_ARGS[@]}" "$SOURCE_TARGET" -o "$HTML_FILE"
fi

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

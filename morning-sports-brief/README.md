# The Morning Box Score — Automated Morning Sports Brief

An automated, two-part pipeline that publishes a daily, kid-friendly, grayscale-ready US Letter (`8.5" × 11"`) newspaper of yesterday's sports box scores and silently prints it before breakfast:

1. **Cloud Generator (GitHub Actions + Python):** Runs daily around **5:05 AM ET** (`5 9 * * *` EDT / `5 10 * * *` EST with DST guard), fetches completed games from ESPN's public endpoints and recent highlights from Distance Running, Gymnastics, and Skiing RSS feeds, writes an easy-reader Top Story, embeds the lead game photo (falling back to a rotating **Sports Fact of the Day** when no photo is available), and deploys a single self-contained `dist/latest.html` to **GitHub Pages**.
2. **Local Print Client (Headless Mac Mini):** A minimal `launchd`-scheduled Bash script (`mac-client/print_brief.sh`) that fetches `latest.html`, converts it to PDF with headless Google Chrome, and prints once per edition date via macOS CUPS (`lp`).

---

## Repository Layout

```text
morning-sports-brief/
├── .github/workflows/daily_brief.yml  # Daily cron + state commit + GitHub Pages deploy
├── config.yaml                        # Favorite teams, secondary leagues, RSS feeds & settings
├── requirements.txt                   # requests, pyyaml, jinja2, premailer
├── build_brief.py                     # Entrypoint: fetch -> curate -> editorial -> dist/latest.html
├── curator.py                         # Priority filtering, excitement ranking & RSS mixing
├── editorial.py                       # Kid-friendly Top Story (Gemini / OpenAI / Offline fallback)
├── fetchers/
│   ├── __init__.py                    # Normalized schema + BaseFetcher adapter interface
│   ├── espn_fetcher.py                # Zero-cost ESPN scoreboard, summary & schedule fetcher
│   └── rss_fetcher.py                 # RSS fetcher for Distance Running, Gymnastics & Skiing
├── data/
│   ├── facts.json                     # 36 seeded kid-friendly sports trivia facts
│   └── state.json                     # Persists edition number and printed fact IDs
├── templates/
│   ├── newspaper.html                 # Jinja2 US Letter newspaper layout
│   └── newspaper.css                  # Print-safe grayscale stylesheet (inlined into latest.html)
└── mac-client/
    ├── print_brief.sh                 # curl -> headless Chrome PDF -> lp print script
    ├── com.user.sportsbrief.plist     # macOS launchd schedule (5:25 AM daily)
    └── README.md                      # Detailed Mac Mini CUPS & pmset guide
```

---

## Part 1: GitHub Setup

### 1. Push & Enable GitHub Pages
1. Create a new GitHub repository and push the contents of `morning-sports-brief/` to the `main` branch.
2. Open **Settings → Pages** in your GitHub repository.
3. Under **Build and deployment → Source**, select **GitHub Actions**.

### 2. Enable Workflow Write Permissions
The daily workflow commits `data/state.json` back to the repository so edition numbers and used Sports Facts persist across runs:
1. Open **Settings → Actions → General**.
2. Under **Workflow permissions**, select **Read and write permissions** and click **Save**.

### 3. Configure Repository Secrets (Environment Variables)
Go to **Settings → Secrets and variables → Actions → New repository secret** and add any of the following **optional** secrets:

| Secret Name | Required? | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Optional | Enables AI-written 120–160 word Top Stories via Google Gemini (`editorial.gemini_model` in `config.yaml`, default `gemini-4-hydrogen`). |
| `OPENAI_API_KEY` | Optional | Alternative/fallback LLM writer via OpenAI (`editorial.openai_model` in `config.yaml`, default `gpt-4o-mini`). |
| `API_SPORTS_KEY` | Optional | Only required if you implement and switch `data_provider.name` to `api_sports` in `config.yaml`. |
| `BALLDONTLIE_API_KEY` | Optional | Only required if you implement and switch `data_provider.name` to `balldontlie` in `config.yaml`. |

> **Zero-Key Offline Mode:** If neither `GEMINI_API_KEY` nor `OPENAI_API_KEY` is configured, `editorial.py` automatically falls back to a deterministic 3-sentence journalist summary built directly from ESPN's verified headline, score, leaders, and season records.

### 4. Customize Teams, Sports & Layout (`config.yaml`)
Edit `config.yaml` directly in GitHub to change:
- `favorite_teams` (Priority 1 full mini-box scores & upcoming schedule — defaults to **New York Knicks**, **New York Liberty**, and **New York Mets**)
- `secondary_leagues` (Priority 2 leagues — defaults to **NBA**, **WNBA**, **MLB**, **Premier League**, and **Champions League**)
- `highlight_feeds` (Individual/Olympic sports — defaults to **Distance Running**, **Gymnastics**, and **Skiing**)
- `curation.max_interesting_games` (Default: `6` cards across the 3-column grid)

### 5. Run Your First Build
Go to **Actions → Daily Morning Sports Brief → Run workflow** to generate your first edition immediately and verify it publishes to:
```text
https://<your-github-username>.github.io/<your-repo-name>/latest.html
```

---

## Part 2: Running the Generator Locally (Python)

To test or preview newspaper builds on your own machine:

```bash
cd morning-sports-brief
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Optional: set an LLM key in your shell, or omit to use the offline writer
export GEMINI_API_KEY="your-gemini-api-key"

python build_brief.py
```

This generates a self-contained HTML file at `dist/latest.html` (with all CSS and the lead story photo inlined) and updates `data/state.json`. Open `dist/latest.html` in any browser to inspect or print.

---

## Part 3: Headless Mac Mini Print Client Setup

The Mac Mini client requires **no Python environment**—only macOS's built-in `curl` and `lp` (CUPS), plus **Google Chrome**.

### Print Script Environment Variables (`mac-client/print_brief.sh`)

| Variable | Default / Example | Description |
| --- | --- | --- |
| `BRIEF_URL` | `https://<user>.github.io/<repo>/latest.html` | URL of the published `latest.html` file. |
| `PRINTER_NAME` | `""` *(system default)* | Exact CUPS printer queue name from `lpstat -p -d`. |
| `GITHUB_TOKEN` | `""` | Optional GitHub PAT if fetching `latest.html` from a private repo. |
| `STATE_FILE` | `$HOME/.sports_brief_last_printed` | Stores the last printed `<meta name="edition-date">` to prevent duplicate prints on wake/reboot. |
| `CHROME_BIN` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | Path to Google Chrome binary for headless PDF conversion. |

### Quick Mac Setup
1. Find your printer queue name:
   ```bash
   lpstat -p -d
   ```
2. Install the script and run a dry-run PDF test (saves to `/tmp/morning_sports_brief_YYYY-MM-DD.pdf` without printing):
   ```bash
   mkdir -p ~/morning-sports-brief
   cp mac-client/print_brief.sh ~/morning-sports-brief/print_brief.sh
   chmod +x ~/morning-sports-brief/print_brief.sh

   BRIEF_URL="https://<your-username>.github.io/<your-repo>/latest.html" \
     ~/morning-sports-brief/print_brief.sh --dry-run
   ```
3. Edit `mac-client/com.user.sportsbrief.plist` with your macOS username, `BRIEF_URL`, and `PRINTER_NAME`, then load the `launchd` schedule (runs daily at **5:25 AM**):
   ```bash
   cp mac-client/com.user.sportsbrief.plist ~/Library/LaunchAgents/com.user.sportsbrief.plist
   launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.user.sportsbrief.plist
   ```
4. *(Optional)* Wake a sleeping Mac Mini at 5:20 AM daily:
   ```bash
   sudo pmset repeat wakeorpoweron MTWRFSU 05:20:00
   ```

See `mac-client/README.md` for full troubleshooting and launchd reload commands.

# The Morning Box Score — Automated Sports Brief & Broadsheet Studio

A split-architecture daily sports newspaper pipeline paired with an interactive full-stack studio for previewing, configuring, and exporting editions.

- **Broadsheet Studio (Web App — `server.ts` + `src/`):** Live preview of the US Letter (`8.5" × 11"`) grayscale newspaper powered by real-time ESPN JSON endpoints, RSS feeds (Distance Running, Gymnastics, Skiing), and Gemini editorial summarization, plus interactive editors for `config.yaml`, `data/facts.json`, and a one-click `.zip` download of the deployment repository.
- **Cloud Generator (`morning-sports-brief/`):** Python 3.11 + GitHub Actions pipeline that builds a self-contained `dist/latest.html` every morning at `11:00 UTC` (~6:00 AM EST) and deploys it to GitHub Pages.
- **Headless Mac Print Client (`morning-sports-brief/mac-client/`):** Lightweight `launchd` + Bash script that curls `latest.html`, converts it to US Letter PDF via headless Google Chrome, and prints silently via CUPS (`lp`) with duplicate-print protection.

---

## Project Structure

```text
.
├── server.ts                          # Express + Vite server (ESPN, RSS, Gemini, config & zip APIs)
├── server/
│   ├── espnService.ts                 # Live ESPN scoreboard/boxscore/schedule + RSS highlight fetcher
│   ├── editorialService.ts            # @google/genai Top Story writer + deterministic offline fallback
│   └── htmlCompiler.ts                # Compiles self-contained latest.html with inlined CSS & base64 photo
├── src/                               # React + Tailwind frontend (Broadsheet, Team Desk, Facts, Deploy & Mac)
├── .env.example                       # Environment variable template for local studio runs
└── morning-sports-brief/              # Standalone GitHub Actions + Python + Mac Mini repository
    ├── .github/workflows/daily_brief.yml
    ├── config.yaml
    ├── build_brief.py
    ├── curator.py
    ├── editorial.py
    ├── fetchers/
    ├── data/
    ├── templates/
    ├── mac-client/
    └── README.md
```

---

## Local Setup: Broadsheet Studio (Node.js Web App)

### Prerequisites
- **Node.js 20+** and `npm`

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required? | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Optional | Enables AI-written 120–160 word kid-friendly Top Stories via `@google/genai` (`gemini-4-hydrogen`). If omitted, the app automatically uses the deterministic offline journalist fallback. |
| `PORT` | Optional | Server port (defaults to `3000`). |
| `APP_URL` | Optional | Public URL of the hosted studio (injected automatically in AI Studio). |

### 3. Run Locally
```bash
npm run dev
```

Open `http://localhost:3000` in your browser to:
- Preview today's (or any historical date's) US Letter broadsheet and click **Print Broadsheet** or **Download latest.html**
- Edit favorite teams, secondary leagues, and individual sport RSS feeds in **Team Desk** (updates `morning-sports-brief/config.yaml`)
- Browse or reset the 36 rotating trivia facts in **Facts Archive**
- Inspect all deployment files or download `morning-sports-brief.zip` from **Deploy & Mac**

### Build & Typecheck
```bash
npm run lint
npm run build
```

---

## Local Setup: Cloud Generator CLI (Python)

If you want to run the standalone Python generator directly from `morning-sports-brief/`:

### Prerequisites
- **Python 3.11+**

### Steps
```bash
cd morning-sports-brief
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Optional: set an API key for LLM story generation (omit to use offline fallback)
export GEMINI_API_KEY="your-gemini-api-key"

python build_brief.py
```

This compiles `morning-sports-brief/dist/latest.html` with inlined CSS and a base64-embedded lead game photo (falling back to **Sports Fact of the Day** if no photo is available) and updates `morning-sports-brief/data/state.json`.

---

## GitHub Setup (Automated Daily Cloud Builds)

This repository already includes `/.github/workflows/daily_brief.yml` at the **repository root** (configured to run inside `morning-sports-brief/`), so pushing the entire repository works out of the box. *(If you instead export `morning-sports-brief.zip` from the **Deploy & Mac** tab into a separate standalone repository, `morning-sports-brief/.github/workflows/daily_brief.yml` becomes that repo's root workflow.)*

> **Note:** GitHub Actions only discovers workflows placed in `/.github/workflows/` at the root of the repository on your default branch (typically `main`).

### 1. Enable GitHub Pages
1. Go to **Settings → Pages** in your GitHub repository.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

### 2. Enable Workflow Write Permissions
Required so GitHub Actions can commit updated `data/state.json` (edition counter and used fact IDs) back to your repo:
1. Go to **Settings → Actions → General**.
2. Under **Workflow permissions**, select **Read and write permissions** and click **Save**.

### 3. Add GitHub Actions Secrets
Go to **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Required? | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Optional | Used by `editorial.py` (`gemini_model` in `config.yaml`) to generate the lead Top Story. |
| `OPENAI_API_KEY` | Optional | Used by `editorial.py` (`openai_model` in `config.yaml`) if `GEMINI_API_KEY` is unset or `llm_mode: "openai"`. |
| `API_SPORTS_KEY` | Optional | Only used if `data_provider.name` is set to `api_sports` in `config.yaml`. |
| `BALLDONTLIE_API_KEY` | Optional | Only used if `data_provider.name` is set to `balldontlie` in `config.yaml`. |

> If no LLM secret is added, the workflow automatically uses the deterministic offline story builder with zero external AI dependency.

### 4. Verify the Workflow
1. Open **Actions → Daily Morning Sports Brief → Run workflow** to trigger an immediate test build.
2. Once finished, verify your paper loads at `https://<your-username>.github.io/<your-repo>/latest.html`.
3. Subsequent editions build automatically every morning at `0 11 * * *` UTC (~6:00 AM EST / 7:00 AM EDT).

---

## Headless Mac Mini Setup (Automatic Morning Printing)

The Mac client lives in `morning-sports-brief/mac-client/` and requires **no Python installation**—only macOS `curl`, **Google Chrome**, and CUPS (`lp`).

### Mac Environment Variables
Configure these in `morning-sports-brief/mac-client/com.user.sportsbrief.plist` (or pass via your shell):

| Variable | Required? | Description |
| --- | --- | --- |
| `BRIEF_URL` | Yes | Static HTTPS URL to `latest.html` on GitHub Pages. |
| `PRINTER_NAME` | Optional | CUPS printer queue name from `lpstat -p -d` (defaults to system default printer if omitted). |
| `GITHUB_TOKEN` | Optional | Read-only GitHub token, needed only if fetching from a private repository. |
| `STATE_FILE` | Optional | Path storing the last printed `edition-date` (defaults to `$HOME/.sports_brief_last_printed`). |
| `CHROME_BIN` | Optional | Path to Google Chrome (defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). |

### Installation Steps
1. Find your printer name on the Mac Mini:
   ```bash
   lpstat -p -d
   ```
2. Copy and test `print_brief.sh` in dry-run mode (generates `/tmp/morning_sports_brief_YYYY-MM-DD.pdf` without printing):
   ```bash
   mkdir -p ~/morning-sports-brief
   cp morning-sports-brief/mac-client/print_brief.sh ~/morning-sports-brief/print_brief.sh
   chmod +x ~/morning-sports-brief/print_brief.sh

   BRIEF_URL="https://<your-username>.github.io/<your-repo>/latest.html" \
     ~/morning-sports-brief/print_brief.sh --dry-run
   ```
3. Update `YOUR_MAC_USER`, `BRIEF_URL`, and `PRINTER_NAME` inside `morning-sports-brief/mac-client/com.user.sportsbrief.plist`, then install and load the 6:25 AM daily `launchd` agent:
   ```bash
   cp morning-sports-brief/mac-client/com.user.sportsbrief.plist ~/Library/LaunchAgents/com.user.sportsbrief.plist
   launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.user.sportsbrief.plist
   ```
4. *(Optional)* Wake the Mac Mini automatically at 6:20 AM if it sleeps overnight:
   ```bash
   sudo pmset repeat wakeorpoweron MTWRFSU 06:20:00
   ```

See `morning-sports-brief/mac-client/README.md` for additional launchd management and troubleshooting commands.

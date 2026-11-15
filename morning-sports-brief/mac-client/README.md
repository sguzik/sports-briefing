# Headless Mac Mini Print Client Setup

This client requires **zero Python environment** on your Mac Mini—only macOS's built-in `curl` and `lp` (CUPS), plus **Google Chrome**.

---

## 1. Enable GitHub Pages in Your Repository
1. Push this repository to GitHub.
2. Go to **Settings → Pages** in your GitHub repository.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Go to **Actions → Daily Morning Sports Brief → Run workflow** to trigger your first build and confirm `https://<username>.github.io/<repo>/latest.html` loads.
5. *(Optional)* Add `GEMINI_API_KEY` or `OPENAI_API_KEY` under **Settings → Secrets and variables → Actions** for AI-written Top Stories. Without a key, the generator automatically uses its built-in offline journalist fallback.

---

## 2. Find Your Printer Name
Connect your printer (USB or AirPrint/IPP) and list configured CUPS queues:

```bash
lpstat -p -d
```

Copy the exact printer name (for example, `Brother_HL_L2350DW_series`).

---

## 3. Install & Test the Script Locally
1. Copy `print_brief.sh` to a permanent folder on the Mac Mini (e.g., `~/morning-sports-brief/print_brief.sh`) and mark it executable:

   ```bash
   mkdir -p ~/morning-sports-brief
   cp print_brief.sh ~/morning-sports-brief/print_brief.sh
   chmod +x ~/morning-sports-brief/print_brief.sh
   ```

2. Run a dry-run test (generates a PDF without printing):

   ```bash
   BRIEF_URL="https://YOUR_GITHUB_USERNAME.github.io/morning-sports-brief/latest.html" \
     ~/morning-sports-brief/print_brief.sh --dry-run
   ```

   Open `/tmp/morning_sports_brief_*.pdf` to verify the US Letter layout.

3. Test a real print:

   ```bash
   BRIEF_URL="https://YOUR_GITHUB_USERNAME.github.io/morning-sports-brief/latest.html" \
   PRINTER_NAME="YOUR_CUPS_PRINTER_NAME" \
     ~/morning-sports-brief/print_brief.sh --force
   ```

---

## 4. Schedule Automatic Printing with `launchd`
1. Edit `com.user.sportsbrief.plist` and replace:
   - `YOUR_MAC_USER` with your macOS username (`whoami`)
   - `YOUR_GITHUB_USERNAME` with your GitHub username
   - `YOUR_CUPS_PRINTER_NAME` with the printer name from `lpstat -p` (or delete the `PRINTER_NAME` entry to use the system default printer)

2. Install and load the LaunchAgent:

   ```bash
   cp com.user.sportsbrief.plist ~/Library/LaunchAgents/com.user.sportsbrief.plist
   launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.user.sportsbrief.plist
   ```

3. Verify it is loaded:

   ```bash
   launchctl list | grep sportsbrief
   ```

---

## 5. Wake the Mac Mini Before 6:25 AM (Optional)
If the Mac Mini sleeps overnight, schedule an automatic wake-up at 6:20 AM every day:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 06:20:00
```

Verify the power schedule with:

```bash
pmset -g sched
```

If the Mac wakes late or reboots later in the morning, `print_brief.sh` checks `~/.sports_brief_last_printed` against `<meta name="edition-date">` so it **never prints the same day's paper twice**.

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import requests
import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape
from premailer import Premailer

from curator import curate_edition
from editorial import generate_top_story, pick_fact_of_the_day
from fetchers import LeadImage, get_fetcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("build_brief")

ROOT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = ROOT_DIR / "config.yaml"
FACTS_PATH = ROOT_DIR / "data" / "facts.json"
STATE_PATH = ROOT_DIR / "data" / "state.json"
TEMPLATES_DIR = ROOT_DIR / "templates"
DIST_DIR = ROOT_DIR / "dist"


def load_yaml(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def inline_lead_image(lead_image: Optional[LeadImage], timeout: int = 10) -> Optional[Dict[str, str]]:
    """Fetch the ESPN lead photo and embed it as a base64 data URI for self-contained latest.html."""
    if not lead_image or not lead_image.url:
        return None
    try:
        resp = requests.get(
            lead_image.url,
            headers={"User-Agent": "MorningSportsBrief/1.0"},
            timeout=timeout,
        )
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
        if not content_type.startswith("image/"):
            return None
        b64 = base64.b64encode(resp.content).decode("ascii")
        return {
            "data_uri": f"data:{content_type};base64,{b64}",
            "caption": lead_image.caption,
            "credit": lead_image.credit,
        }
    except Exception as exc:
        logger.warning("Could not fetch lead image (%s); falling back to Sports Fact: %s", lead_image.url, exc)
        return None


def main() -> None:
    config = load_yaml(CONFIG_PATH)
    tz_name = config.get("newspaper", {}).get("timezone", "America/New_York")
    tz = ZoneInfo(tz_name)

    now_et = datetime.now(tz)
    yesterday_et = now_et - timedelta(days=1)

    edition_date_iso = now_et.strftime("%Y-%m-%d")
    edition_date_pretty = now_et.strftime("%A, %B %-d, %Y")
    yesterday_display = yesterday_et.strftime("%a, %b %-d")
    today_yyyymmdd = now_et.strftime("%Y%m%d")
    yesterday_yyyymmdd = yesterday_et.strftime("%Y%m%d")

    logger.info("Building Morning Sports Brief for %s (scores from %s)", edition_date_iso, yesterday_yyyymmdd)

    facts: List[Dict[str, Any]] = load_json(FACTS_PATH, [])
    state: Dict[str, Any] = load_json(STATE_PATH, {"edition_number": 0, "used_fact_ids": []})

    edition_number = int(state.get("edition_number", 0)) + 1
    state["edition_number"] = edition_number

    fetcher = get_fetcher(config)
    curated = curate_edition(
        fetcher=fetcher,
        config=config,
        yesterday_yyyymmdd=yesterday_yyyymmdd,
        today_yyyymmdd=today_yyyymmdd,
    )

    lead_game = curated["lead_game"]
    top_story = generate_top_story(lead_game, config)

    # Attempt to embed lead game image; fall back to Sports Fact of the Day if unavailable
    timeout = int(config.get("data_provider", {}).get("timeout_seconds", 12))
    lead_image_data = inline_lead_image(lead_game.lead_image if lead_game else None, timeout=timeout)

    if lead_image_data is None:
        fact_of_day, updated_state = pick_fact_of_the_day(facts, state)
    else:
        fact_of_day = None
        updated_state = dict(state)

    updated_state["last_edition_date"] = edition_date_iso

    css_text = (TEMPLATES_DIR / "newspaper.css").read_text(encoding="utf-8")
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    template = env.get_template("newspaper.html")

    raw_html = template.render(
        title=config.get("newspaper", {}).get("title", "THE MORNING BOX SCORE"),
        subtitle=config.get("newspaper", {}).get("subtitle", ""),
        edition_date_iso=edition_date_iso,
        edition_date_pretty=edition_date_pretty,
        yesterday_display=yesterday_display,
        edition_number=edition_number,
        top_story=top_story,
        lead_image=lead_image_data,
        fact_of_day=fact_of_day,
        favorite_items=curated["favorite_items"],
        interesting_games=curated["interesting_games"],
        inline_css=css_text,
    )

    inlined_html = Premailer(
        raw_html,
        keep_style_tags=True,
        strip_important=False,
        disable_validation=True,
        cssutils_logging_level=logging.CRITICAL,
    ).transform()

    if "@page" not in inlined_html:
        inlined_html = inlined_html.replace(
            "</head>", f"<style>\n{css_text}\n</style>\n</head>", 1
        )

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    out_path = DIST_DIR / "latest.html"
    out_path.write_text(inlined_html, encoding="utf-8")
    save_json(STATE_PATH, updated_state)

    logger.info("Published self-contained newspaper to %s (Edition #%d)", out_path, edition_number)


if __name__ == "__main__":
    main()

from __future__ import annotations

import html
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

import requests

from fetchers import HighlightItem

logger = logging.getLogger(__name__)

TAG_RE = re.compile(r"<[^>]+>")
WP_FOOTER_RE = re.compile(r"The post .*? appeared first on .*?$", re.IGNORECASE)
WHITESPACE_RE = re.compile(r"\s+")
BANNED_TERMS_RE = re.compile(
    r"\b(odds|spread|moneyline|parlay|over/under|wager|betting|bettor|sportsbook|vegas)\b",
    re.IGNORECASE,
)


def _clean_text(raw: str, max_len: int = 120) -> str:
    text = html.unescape(raw or "")
    text = TAG_RE.sub(" ", text)
    text = WP_FOOTER_RE.sub("", text)
    text = WHITESPACE_RE.sub(" ", text).strip()
    if BANNED_TERMS_RE.search(text):
        text = BANNED_TERMS_RE.sub("matchup", text)
    if len(text) > max_len:
        trimmed = text[: max_len - 1].rsplit(" ", 1)[0]
        text = f"{trimmed}…"
    return text


def fetch_rss_highlights(
    feed_cfg: Dict[str, Any],
    reference_date_iso: str,
    tz_name: str = "America/New_York",
    timeout: int = 10,
) -> List[HighlightItem]:
    url = feed_cfg.get("feed_url", "")
    label = feed_cfg.get("label", "Sports")
    if not url:
        return []

    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "MorningSportsBrief/1.0"},
            timeout=timeout,
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
    except Exception as exc:
        logger.warning("RSS fetch failed for %s (%s): %s", label, url, exc)
        return []

    tz = ZoneInfo(tz_name)
    ref_dt = datetime.fromisoformat(f"{reference_date_iso}T12:00:00").replace(tzinfo=tz)
    items: List[HighlightItem] = []

    for node in root.findall(".//item")[:8]:
        raw_title = node.findtext("title") or ""
        raw_desc = node.findtext("description") or ""
        raw_pub = node.findtext("pubDate") or ""

        title = _clean_text(raw_title, max_len=92)
        summary = _clean_text(raw_desc, max_len=118)
        if not title:
            continue

        date_display = "Recent"
        days_diff = 3
        if raw_pub:
            try:
                dt = parsedate_to_datetime(raw_pub)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                dt_local = dt.astimezone(tz)
                date_display = dt_local.strftime("%b %-d")
                days_diff = abs((ref_dt.date() - dt_local.date()).days)
            except Exception:
                pass

        if days_diff > 10:
            continue

        # Favor fresh results close to the edition date
        recency_score = max(10, 90 - days_diff * 15)
        items.append(
            HighlightItem(
                kind="rss",
                league_label=label,
                status_detail=date_display,
                title=title,
                summary=summary,
                sort_score=recency_score,
            )
        )

    items.sort(key=lambda x: x.sort_score, reverse=True)
    return items

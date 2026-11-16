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
SCRIPT_STYLE_RE = re.compile(r"<(script|style|noscript|nav|footer|header)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
WP_FOOTER_RE = re.compile(r"The post .*? appeared first on .*?$", re.IGNORECASE)
WHITESPACE_RE = re.compile(r"\s+")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
BANNED_TERMS_RE = re.compile(
    r"\b(odds|spread|moneyline|parlay|over/under|wager|betting|bettor|sportsbook|vegas)\b",
    re.IGNORECASE,
)


def _clean_text(raw: str) -> str:
    text = html.unescape(raw or "")
    text = TAG_RE.sub(" ", text)
    text = html.unescape(text)
    text = WP_FOOTER_RE.sub("", text)
    text = WHITESPACE_RE.sub(" ", text).strip()
    if BANNED_TERMS_RE.search(text):
        text = BANNED_TERMS_RE.sub("matchup", text)
    return text


ABBREV_RE = re.compile(r"\b(?:U\.S\.A\.|U\.S\.|U\.K\.|Dr\.|Mr\.|Mrs\.|Ms\.|St\.|Jr\.|Sr\.|No\.|vs\.)", re.IGNORECASE)


def first_complete_sentences(text: str, max_chars: int = 190) -> str:
    """Return 1-2 complete sentences without mid-sentence ellipsis truncation."""
    cleaned = WHITESPACE_RE.sub(" ", (text or "").strip())
    if not cleaned:
        return ""
    dot_token = "__DOT__"
    protected = ABBREV_RE.sub(lambda m: m.group(0).replace(".", dot_token), cleaned)
    sentences = [s.replace(dot_token, ".").strip() for s in SENTENCE_SPLIT_RE.split(protected) if s.strip()]
    if not sentences:
        return cleaned

    selected: List[str] = []
    total = 0
    for s in sentences[:2]:
        if selected and total + len(s) + 1 > max_chars:
            break
        selected.append(s)
        total += len(s) + 1
        if len(s) >= 75:
            break

    out = " ".join(selected).strip()
    if out and out[-1] not in ".!?":
        out += "."
    return out


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
        raw_encoded = node.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or ""
        raw_link = (node.findtext("link") or "").strip()
        raw_pub = node.findtext("pubDate") or ""

        title = _clean_text(raw_title)
        desc_clean = _clean_text(raw_desc)
        encoded_clean = _clean_text(raw_encoded)
        article_text = encoded_clean if len(encoded_clean) >= len(desc_clean) else desc_clean
        if len(article_text) > 2500:
            article_text = article_text[:2500]

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

        recency_score = max(10, 90 - days_diff * 15)
        items.append(
            HighlightItem(
                kind="rss",
                league_label=label,
                status_detail=date_display,
                title=title,
                summary=first_complete_sentences(article_text, max_chars=160),
                link=raw_link,
                article_text=article_text,
                sort_score=recency_score,
            )
        )

    items.sort(key=lambda x: x.sort_score, reverse=True)
    return items


def enrich_rss_article(item: HighlightItem, timeout: int = 8) -> HighlightItem:
    """Fetch full article paragraphs when the RSS feed only includes a brief blurb."""
    if item.kind != "rss" or not item.link or len(item.article_text) >= 350:
        return item

    try:
        resp = requests.get(
            item.link,
            headers={"User-Agent": "MorningSportsBrief/1.0"},
            timeout=timeout,
        )
        resp.raise_for_status()
        cleaned_html = SCRIPT_STYLE_RE.sub(" ", resp.text)
        paragraphs = re.findall(r"<p[^>]*>(.*?)</p>", cleaned_html, flags=re.IGNORECASE | re.DOTALL)
        extracted: List[str] = []
        for p in paragraphs:
            text = _clean_text(p)
            if len(text) >= 40:
                extracted.append(text)
            if sum(len(x) for x in extracted) >= 2200:
                break
        if extracted:
            combined = " ".join(extracted)[:2500]
            if len(combined) > len(item.article_text):
                item.article_text = combined
                if not item.summary:
                    item.summary = first_complete_sentences(combined, max_chars=160)
    except Exception as exc:
        logger.debug("Could not fetch full article for %s: %s", item.link, exc)

    return item

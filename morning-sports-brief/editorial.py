from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import requests

from fetchers import GameRecord, HighlightItem

logger = logging.getLogger(__name__)

BANNED_TERMS_PATTERN = re.compile(
    r"\b(odds|spread|moneyline|parlay|over/under|wager|betting|bettor|sportsbook|vegas)\b",
    re.IGNORECASE,
)


def _clean_betting_language(text: str) -> str:
    return BANNED_TERMS_PATTERN.sub("matchup", text).strip()


def _strip_ellipsis(text: str) -> str:
    return (text or "").replace("...", "").replace("…", "").strip()


def _build_game_context(game: GameRecord) -> str:
    winner = game.home if game.home.score >= game.away.score else game.away
    loser = game.away if winner is game.home else game.home
    leaders = (winner.leaders[:2] + loser.leaders[:1]) if (winner.leaders or loser.leaders) else []
    milestones = "; ".join(game.milestones) if game.milestones else "None noted"
    return (
        f"League: {game.league_label}\n"
        f"Matchup: {game.away.name} ({game.away.record or 'N/A'}) at "
        f"{game.home.name} ({game.home.record or 'N/A'})\n"
        f"Final Score: {winner.name} {winner.score}, {loser.name} {loser.score} ({game.status_detail})\n"
        f"Top Performers: ${'; '.join(leaders) if leaders else 'Team effort'}\n".replace("$", "")
        + f"Milestones: {milestones}\n"
        f"Headline Hint: {game.headline or 'Exciting finish'}\n"
        f"Recap Snippet: {game.summary_text or 'N/A'}"
    )


def _call_gemini_text(
    prompt: str,
    api_key: str,
    model: str,
    max_tokens: int = 450,
    json_mode: bool = False,
) -> Optional[str]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    gen_cfg: Dict[str, Any] = {
        "maxOutputTokens": max_tokens,
        "thinkingConfig": {"thinkingLevel": "LOW"},
    }
    if json_mode:
        gen_cfg["response_mime_type"] = "application/json"

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": gen_cfg,
    }
    try:
        resp = requests.post(
            url,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=payload,
            timeout=25,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as exc:
        logger.warning("Gemini API call failed, falling back: %s", exc)
        return None


def _call_openai_text(
    prompt: str,
    api_key: str,
    model: str,
    system_prompt: str,
    max_tokens: int = 450,
    json_mode: bool = False,
) -> Optional[str]:
    url = "https://api.openai.com/v1/chat/completions"
    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.6,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    try:
        resp = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=25,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.warning("OpenAI API call failed, falling back: %s", exc)
        return None


def _parse_headline_and_body(raw_text: str) -> Optional[Tuple[str, str]]:
    cleaned = _clean_betting_language(raw_text)
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    if not lines:
        return None

    headline = "Big Win in Yesterday's Game!"
    body_lines: List[str] = []

    for idx, line in enumerate(lines):
        if idx == 0 and line.upper().startswith("HEADLINE:"):
            headline = line.split(":", 1)[1].strip().strip('"')
        elif line.upper().startswith("STORY:"):
            rest = line.split(":", 1)[1].strip()
            if rest:
                body_lines.append(rest)
        else:
            body_lines.append(line)

    body = _strip_ellipsis(" ".join(body_lines))
    headline = _strip_ellipsis(headline)
    if len(body.split()) < 30:
        return None
    return headline, body


def _generate_offline_story(game: Optional[GameRecord]) -> Tuple[str, str]:
    if not game:
        return (
            "No Big Games Last Night",
            "Our teams did not play yesterday. The players got to rest and get ready for the next game! "
            "There are still lots of fun sports stories to read today. Look at the boxes below to see "
            "when our teams play next. You can also check out the cool sports news from around the world!",
        )

    winner = game.home if game.home.score >= game.away.score else game.away
    loser = game.away if winner is game.home else game.home
    place = "at home" if winner.is_home else "away from home"

    if game.headline:
        headline = _strip_ellipsis(_clean_betting_language(game.headline))
    else:
        headline = f"{winner.short_name} Beat {loser.short_name} {winner.score}-{loser.score}!"

    if game.is_overtime:
        opener = (
            f"What a fun game! The {winner.name} beat the {loser.name} "
            f"{winner.score} to {loser.score} in extra time {place}."
        )
    elif (game.margin <= 2 and game.sport in ("baseball", "hockey", "soccer")) or (
        game.sport == "basketball" and game.margin <= 5
    ):
        opener = (
            f"It was a very close game! The {winner.name} beat the {loser.name} "
            f"{winner.score} to {loser.score} {place}."
        )
    else:
        opener = (
            f"The {winner.name} had a great day! They beat the {loser.name} "
            f"{winner.score} to {loser.score} {place}."
        )

    top_leaders = winner.leaders[:2]
    if top_leaders:
        middle = f"Big stars for the {winner.short_name} were {' and '.join(top_leaders)}. Everyone helped out!"
    elif game.milestones:
        middle = f"Big moment in the game: {game.milestones[0]}. Both teams played hard!"
    else:
        middle = f"The {winner.short_name} shared the ball and played strong defense to win."

    opp_note = f" {loser.leaders[0]} also played hard for the {loser.short_name}." if loser.leaders else ""
    rec_note = f" Now the {winner.short_name} have a {winner.record} record." if winner.record else ""
    closer = f"{opp_note}{rec_note} Watch for their next game soon!".strip()

    body = _strip_ellipsis(_clean_betting_language(f"{opener} {middle} {closer}"))
    return headline, body


def generate_top_story(game: Optional[GameRecord], config: Dict[str, Any]) -> Dict[str, str]:
    editorial_cfg = config.get("editorial", {})
    mode = editorial_cfg.get("llm_mode", "auto").lower()
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()

    if game and mode != "offline":
        prompt = (
            "Write a happy, easy-to-read newspaper Top Story about this sports game for a 1st or 2nd grade child (ages 6-8).\n"
            "Rules:\n"
            "- Use very simple, everyday words (mostly 1-2 syllables).\n"
            "- Write short, clear sentences (6-12 words per sentence).\n"
            "- Keep all facts, names, and numbers true to the Game Data.\n"
            "- Explain sports terms simply if needed, and strictly NO betting, odds, or gambling words.\n"
            "- Do NOT cut off sentences or use '...' or '…'.\n\n"
            "Output exactly two labeled parts:\n"
            "HEADLINE: <simple, punchy 4-8 word headline>\n"
            "STORY: <90-130 word story telling what happened, who starred, and the final score>\n\n"
            f"Game Data:\n{_build_game_context(game)}"
        )

        raw_text: Optional[str] = None
        if mode in ("auto", "gemini") and gemini_key:
            model = editorial_cfg.get("gemini_model", "gemini-4-hydrogen")
            raw_text = _call_gemini_text(prompt, gemini_key, model, max_tokens=450)
        if raw_text is None and mode in ("auto", "openai") and openai_key:
            model = editorial_cfg.get("openai_model", "gpt-4o-mini")
            raw_text = _call_openai_text(
                prompt,
                openai_key,
                model,
                system_prompt="You write cheerful sports stories for 1st and 2nd grade kids (ages 6-8) using short sentences and simple words.",
                max_tokens=450,
            )

        if raw_text:
            parsed = _parse_headline_and_body(raw_text)
            if parsed:
                return {
                    "kicker": f"{game.league_label} TOP STORY",
                    "headline": parsed[0],
                    "body": parsed[1],
                }

    headline, body = _generate_offline_story(game)
    kicker = f"{game.league_label} TOP STORY" if game else "MORNING BRIEFING"
    return {
        "kicker": kicker,
        "headline": headline,
        "body": body,
    }


def summarize_rss_highlights(
    highlights: List[HighlightItem], config: Dict[str, Any]
) -> List[HighlightItem]:
    """Summarize non-box-score RSS sports items at a 1st/2nd grade reading level with zero truncation."""
    rss_entries = [(idx, item) for idx, item in enumerate(highlights) if item.kind == "rss"]
    if not rss_entries:
        return highlights

    editorial_cfg = config.get("editorial", {})
    mode = editorial_cfg.get("llm_mode", "auto").lower()
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()

    if mode == "offline" or (not gemini_key and not openai_key):
        return highlights

    items_payload = [
        {
            "id": seq_idx,
            "sport": item.league_label,
            "headline": item.title,
            "article": (item.article_text or item.summary or item.title)[:1800],
        }
        for seq_idx, (_, item) in enumerate(rss_entries)
    ]

    prompt = (
        "Summarize each sports story below for a 1st or 2nd grade child (ages 6-8) to read in a printed morning newspaper.\n"
        "Rules for EVERY item:\n"
        "- Write at a 1st or 2nd grade reading level: short, simple words and short sentences.\n"
        "- Summarize the whole headline and article clearly so NOTHING is cut off.\n"
        "- NEVER use '...' or '…' or trail off.\n"
        "- Keep all names, places, and facts true to the provided article.\n"
        "- Strictly NO betting, odds, or gambling words.\n"
        "- 'id': Copy the exact numeric id from the input story.\n"
        "- 'title': A complete, punchy headline (5-9 simple words, under 60 characters).\n"
        "- 'summary': 1 to 2 complete short sentences (14-24 words total) ending with a period or exclamation mark.\n\n"
        "Return a JSON object with this exact shape:\n"
        "{\"items\": [{\"id\": 0, \"title\": \"...\", \"summary\": \"...\"}]}\n\n"
        f"Stories:\n{json.dumps(items_payload, ensure_ascii=False)}"
    )

    raw_json: Optional[str] = None
    if mode in ("auto", "gemini") and gemini_key:
        model = editorial_cfg.get("gemini_model", "gemini-4-hydrogen")
        raw_json = _call_gemini_text(prompt, gemini_key, model, max_tokens=900, json_mode=True)
    if raw_json is None and mode in ("auto", "openai") and openai_key:
        model = editorial_cfg.get("openai_model", "gpt-4o-mini")
        raw_json = _call_openai_text(
            prompt,
            openai_key,
            model,
            system_prompt="You summarize sports articles for 1st and 2nd grade kids (ages 6-8) in crisp, complete sentences with no truncation.",
            max_tokens=900,
            json_mode=True,
        )

    if not raw_json:
        return highlights

    try:
        cleaned_raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_json.strip())
        parsed = json.loads(cleaned_raw)
        entries = parsed.get("items", parsed) if isinstance(parsed, dict) else parsed
        if not isinstance(entries, list):
            return highlights

        by_id: Dict[int, Dict[str, Any]] = {}
        for pos, e in enumerate(entries):
            if isinstance(e, dict):
                key = int(e["id"]) if "id" in e else pos
                by_id[key] = e

        for seq_idx, (_, item) in enumerate(rss_entries):
            rewritten = by_id.get(seq_idx) or (entries[seq_idx] if seq_idx < len(entries) and isinstance(entries[seq_idx], dict) else None)
            if not rewritten:
                continue
            new_title = _strip_ellipsis(_clean_betting_language(str(rewritten.get("title") or "")))
            new_summary = _strip_ellipsis(_clean_betting_language(str(rewritten.get("summary") or "")))
            if new_title:
                item.title = new_title
            if new_summary:
                if new_summary[-1] not in ".!?":
                    new_summary += "."
                item.summary = new_summary
    except Exception as exc:
        logger.warning("Failed to parse RSS AI summary JSON, using fallback text: %s", exc)

    return highlights


def pick_fact_of_the_day(
    facts: List[Dict[str, Any]], state: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    used_ids = list(state.get("used_fact_ids", []))
    available = [f for f in facts if f["id"] not in used_ids]

    if not available:
        used_ids = []
        available = list(facts)

    chosen = available[0]
    used_ids.append(chosen["id"])

    new_state = dict(state)
    new_state["used_fact_ids"] = used_ids
    return chosen, new_state

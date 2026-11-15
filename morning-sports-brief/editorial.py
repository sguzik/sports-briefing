from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import requests

from fetchers import GameRecord

logger = logging.getLogger(__name__)

BANNED_TERMS_PATTERN = re.compile(
    r"\b(odds|spread|moneyline|parlay|over/under|wager|betting|bettor|sportsbook|vegas)\b",
    re.IGNORECASE,
)


def _clean_betting_language(text: str) -> str:
    return BANNED_TERMS_PATTERN.sub("matchup", text).strip()


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
        f"Top Performers: {'; '.join(leaders) if leaders else 'Team effort'}\n"
        f"Milestones: {milestones}\n"
        f"Headline Hint: {game.headline or 'Exciting finish'}\n"
        f"Recap Snippet: {game.summary_text or 'N/A'}"
    )


def _generate_with_gemini(prompt: str, api_key: str, model: str) -> Optional[Tuple[str, str]]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "maxOutputTokens": 450,
        },
    }
    try:
        resp = requests.post(
            url,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=payload,
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return _parse_headline_and_body(text)
    except Exception as exc:
        logger.warning("Gemini API call failed, falling back: %s", exc)
        return None


def _generate_with_openai(prompt: str, api_key: str, model: str) -> Optional[Tuple[str, str]]:
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are an enthusiastic youth sports journalist writing for 9-to-12-year-old readers.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 450,
    }
    try:
        resp = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"]
        return _parse_headline_and_body(text)
    except Exception as exc:
        logger.warning("OpenAI API call failed, falling back: %s", exc)
        return None


def _parse_headline_and_body(raw_text: str) -> Optional[Tuple[str, str]]:
    cleaned = _clean_betting_language(raw_text)
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    if not lines:
        return None

    headline = "Big Win Highlights Yesterday's Action"
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

    body = " ".join(body_lines).strip()
    if len(body.split()) < 35:
        return None
    return headline, body


def _generate_offline_story(game: Optional[GameRecord]) -> Tuple[str, str]:
    if not game:
        return (
            "Quiet Night on the Scoreboard — Big Games Ahead!",
            "Our favorite hometown teams took a well-earned breather from the schedule yesterday, "
            "giving players time to rest up, practice their fundamentals, and study film for the "
            "next big matchup. Across the sports world, teams are gearing up for another exciting "
            "stretch of action on courts, fields, and rinks everywhere. Check out the schedule box "
            "below to see when your favorite squads return to action, and test your sports smarts "
            "with today's Fact of the Day!",
        )

    winner = game.home if game.home.score >= game.away.score else game.away
    loser = game.away if winner is game.home else game.home
    location_phrase = "on their home turf" if winner.is_home else "on the road"

    if game.headline:
        headline = _clean_betting_language(game.headline)
    else:
        headline = f"{winner.short_name} Top {loser.short_name} {winner.score}-{loser.score} in {game.league_label} Action"

    if game.is_overtime:
        opener = (
            f"Fans got bonus action yesterday as the {winner.name} outlasted the {loser.name} "
            f"{winner.score}-{loser.score} in a thrilling overtime battle {location_phrase}!"
        )
    elif game.margin <= 2 and game.sport in ("baseball", "hockey", "soccer"):
        opener = (
            f"Every single play mattered yesterday as the {winner.name} edged past the {loser.name} "
            f"{winner.score}-{loser.score} in a nail-biting {game.league_label} showdown {location_phrase}."
        )
    elif game.sport == "basketball" and game.margin <= 5:
        opener = (
            f"It came right down to the final buzzer as the {winner.name} held off the {loser.name} "
            f"{winner.score}-{loser.score} in an exciting {game.league_label} clash {location_phrase}."
        )
    else:
        opener = (
            f"The {winner.name} put together a strong team performance yesterday, defeating the "
            f"{loser.name} {winner.score}-{loser.score} {location_phrase} in {game.league_label} play."
        )

    top_leaders = winner.leaders[:2]
    if game.milestones:
        middle = (
            f"Leading the charge was an unforgettable effort where {game.milestones[0]}, "
            f"giving the {winner.short_name} all the momentum they needed."
        )
    elif top_leaders:
        middle = (
            f"The {winner.short_name} got standout contributions across the lineup, led by "
            f"{' and '.join(top_leaders)}."
        )
    else:
        middle = (
            f"Smart teamwork and sharp defense helped the {winner.short_name} take control when "
            f"the game was on the line."
        )

    opp_note = f" Despite the loss, {loser.leaders[0]} kept the {loser.short_name} fighting hard." if loser.leaders else ""
    rec_note = f" With the victory, {winner.short_name} move to {winner.record} on the season." if winner.record else ""
    closer = (
        f"{opp_note}{rec_note} Keep an eye on how both clubs build on this performance in their upcoming matchups!"
    ).strip()

    body = _clean_betting_language(f"{opener} {middle} {closer}")
    return headline, body


def generate_top_story(game: Optional[GameRecord], config: Dict[str, Any]) -> Dict[str, str]:
    editorial_cfg = config.get("editorial", {})
    mode = editorial_cfg.get("llm_mode", "auto").lower()
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()

    if game and mode != "offline":
        prompt = (
            "Write a kid-friendly newspaper Top Story about the following sports game for a 4th-to-6th grade reader "
            "(ages 9-12). Keep the tone energetic, clear, and joyful. Strictly NO betting, odds, or gambling terms.\n\n"
            "Requirements:\n"
            "- Output exactly two labeled parts:\n"
            "HEADLINE: <punchy 6-10 word newspaper headline>\n"
            "STORY: <120-160 word story summarizing the action, key players, and final score>\n\n"
            f"Game Data:\n{_build_game_context(game)}"
        )

        result: Optional[Tuple[str, str]] = None
        if mode in ("auto", "gemini") and gemini_key:
            model = editorial_cfg.get("gemini_model", "gemini-4-hydrogen")
            result = _generate_with_gemini(prompt, gemini_key, model)
        if result is None and mode in ("auto", "openai") and openai_key:
            model = editorial_cfg.get("openai_model", "gpt-4o-mini")
            result = _generate_with_openai(prompt, openai_key, model)

        if result:
            return {
                "kicker": f"{game.league_label} TOP STORY",
                "headline": result[0],
                "body": result[1],
            }

    headline, body = _generate_offline_story(game)
    kicker = f"{game.league_label} TOP STORY" if game else "MORNING BRIEFING"
    return {
        "kicker": kicker,
        "headline": headline,
        "body": body,
    }


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

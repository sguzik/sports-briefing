from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set, Tuple

from fetchers import BaseFetcher, GameRecord, HighlightItem, UpcomingEvent
from fetchers.rss_fetcher import fetch_rss_highlights

logger = logging.getLogger(__name__)


@dataclass
class FavoriteSectionItem:
    team_config: Dict[str, Any]
    game: Optional[GameRecord]
    upcoming: UpcomingEvent


def _parse_win_pct(record: str) -> float:
    """Convert '12-4' or '10-4-1' into an approximate win percentage."""
    if not record or "-" not in record:
        return 0.5
    parts = record.split("-")
    try:
        wins = int(parts[0])
        losses = int(parts[1])
        ties = int(parts[2]) if len(parts) > 2 else 0
        total = wins + losses + ties
        return (wins + 0.5 * ties) / total if total > 0 else 0.5
    except ValueError:
        return 0.5


def score_game_excitement(game: GameRecord) -> int:
    """Rank completed games by closeness, overtime, upsets, and milestones."""
    score = 10
    margin = game.margin

    if game.sport == "basketball":
        if margin <= 5:
            score += 35
        if margin <= 2:
            score += 15
        if game.is_overtime:
            score += 30
    elif game.sport == "baseball":
        if margin <= 1:
            score += 35
        if game.is_overtime:
            score += 30
        if game.home.score == 0 or game.away.score == 0:
            score += 15
    elif game.sport == "football":
        if margin <= 7:
            score += 30
        if margin <= 3:
            score += 15
        if game.is_overtime:
            score += 30
    elif game.sport == "hockey":
        if margin <= 1:
            score += 30
        if game.is_overtime:
            score += 25
        if game.home.score == 0 or game.away.score == 0:
            score += 15
    elif game.sport == "soccer":
        if margin <= 1:
            score += 25
        if game.total_score >= 4:
            score += 20

    home_pct = _parse_win_pct(game.home.record)
    away_pct = _parse_win_pct(game.away.record)
    if home_pct >= 0.60 and away_pct >= 0.60:
        score += 15
    if (game.home.winner and home_pct + 0.12 < away_pct) or (
        game.away.winner and away_pct + 0.12 < home_pct
    ):
        score += 20

    score += len(game.milestones) * 25
    return score


def _matches_favorite(game: GameRecord, fav: Dict[str, Any]) -> bool:
    if game.sport != fav["sport"] or game.league != fav["league"]:
        return False
    fav_id = str(fav.get("espn_team_id", ""))
    fav_abbr = fav.get("abbreviation", "").upper()
    return (
        game.home.team_id == fav_id
        or game.away.team_id == fav_id
        or game.home.abbreviation.upper() == fav_abbr
        or game.away.abbreviation.upper() == fav_abbr
    )


def curate_edition(
    fetcher: BaseFetcher,
    config: Dict[str, Any],
    yesterday_yyyymmdd: str,
    today_yyyymmdd: str,
) -> Dict[str, Any]:
    tz_name = config.get("newspaper", {}).get("timezone", "America/New_York")
    timeout = int(config.get("data_provider", {}).get("timeout_seconds", 12))
    favorites_cfg = config.get("favorite_teams", [])
    secondary_cfg = config.get("secondary_leagues", [])
    highlight_feeds_cfg = config.get("highlight_feeds", [])
    max_interesting = int(config.get("curation", {}).get("max_interesting_games", 6))

    leagues_to_fetch: Dict[Tuple[str, str], str] = {}
    for fav in favorites_cfg:
        leagues_to_fetch[(fav["sport"], fav["league"])] = fav["league"].upper()
    for sec in secondary_cfg:
        leagues_to_fetch[(sec["sport"], sec["league"])] = sec.get("label", sec["league"].upper())

    all_completed_games: List[GameRecord] = []
    for (sport, league), label in leagues_to_fetch.items():
        games = fetcher.fetch_scoreboard(sport, league, label, yesterday_yyyymmdd)
        completed = [g for g in games if g.completed]
        all_completed_games.extend(completed)

    favorite_items: List[FavoriteSectionItem] = []
    favorite_event_ids: Set[str] = set()
    favorite_completed_games: List[GameRecord] = []

    for fav in favorites_cfg:
        matched_game: Optional[GameRecord] = None
        for g in all_completed_games:
            if _matches_favorite(g, fav):
                matched_game = g
                break

        if matched_game:
            matched_game.is_favorite_game = True
            matched_game.favorite_team_id = str(fav.get("espn_team_id", ""))
            matched_game = fetcher.enrich_game_details(matched_game)
            favorite_event_ids.add(matched_game.event_id)
            favorite_completed_games.append(matched_game)

        upcoming = fetcher.fetch_team_next_event(fav, today_yyyymmdd, tz_name)
        favorite_items.append(
            FavoriteSectionItem(
                team_config=fav,
                game=matched_game,
                upcoming=upcoming,
            )
        )

    other_games = [g for g in all_completed_games if g.event_id not in favorite_event_ids]
    pre_scored = sorted(other_games, key=score_game_excitement, reverse=True)
    candidates = pre_scored[: max_interesting + 5]
    enriched_candidates = [fetcher.enrich_game_details(g) for g in candidates]
    final_ranked = sorted(enriched_candidates, key=score_game_excitement, reverse=True)

    # Fetch individual/Olympic RSS highlights (Distance Running, Gymnastics, Skiing)
    today_iso = f"{today_yyyymmdd[:4]}-{today_yyyymmdd[4:6]}-{today_yyyymmdd[6:8]}"
    rss_by_feed: List[List[HighlightItem]] = [
        fetch_rss_highlights(feed, today_iso, tz_name=tz_name, timeout=timeout)
        for feed in highlight_feeds_cfg
    ]

    # Pick 1 fresh highlight per feed first (up to 3), then fill remaining slots up to 6 with team games
    selected_rss: List[HighlightItem] = []
    overflow_rss: List[HighlightItem] = []
    for feed_items in rss_by_feed:
        if feed_items:
            selected_rss.append(feed_items[0])
            overflow_rss.extend(feed_items[1:3])

    game_slots_target = max(0, max_interesting - len(selected_rss))
    selected_games: List[GameRecord] = []
    league_counts: Dict[str, int] = {}

    for g in final_ranked:
        if len(selected_games) >= game_slots_target:
            break
        cnt = league_counts.get(g.league_label, 0)
        if cnt < 2 or len(final_ranked) <= game_slots_target:
            selected_games.append(g)
            league_counts[g.league_label] = cnt + 1

    if len(selected_games) < game_slots_target:
        chosen_ids = {g.event_id for g in selected_games}
        for g in final_ranked:
            if len(selected_games) >= game_slots_target:
                break
            if g.event_id not in chosen_ids:
                selected_games.append(g)

    highlights: List[HighlightItem] = [
        HighlightItem(
            kind="game",
            league_label=g.league_label,
            status_detail=g.status_detail,
            game=g,
            sort_score=score_game_excitement(g),
        )
        for g in selected_games
    ] + selected_rss

    # If fewer than max_interesting (e.g., quiet league day), top up with extra RSS highlights
    if len(highlights) < max_interesting and overflow_rss:
        for extra in overflow_rss:
            if len(highlights) >= max_interesting:
                break
            highlights.append(extra)

    lead_game: Optional[GameRecord] = None
    if favorite_completed_games:
        lead_game = max(favorite_completed_games, key=score_game_excitement)
    elif selected_games:
        lead_game = selected_games[0]
    elif final_ranked:
        lead_game = final_ranked[0]

    return {
        "favorite_items": favorite_items,
        "interesting_games": highlights[:max_interesting],
        "lead_game": lead_game,
    }

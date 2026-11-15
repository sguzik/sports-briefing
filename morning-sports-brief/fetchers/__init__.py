from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class TeamBox:
    team_id: str
    name: str
    short_name: str
    abbreviation: str
    score: int
    is_home: bool
    winner: bool = False
    record: str = ""
    linescores: List[str] = field(default_factory=list)
    leaders: List[str] = field(default_factory=list)


@dataclass
class LeadImage:
    url: str
    caption: str = ""
    credit: str = ""


@dataclass
class GameRecord:
    event_id: str
    sport: str
    league: str
    league_label: str
    start_time_utc: str
    status_state: str          # "pre", "in", "post"
    status_detail: str         # "Final", "Final/OT", "FT", etc.
    completed: bool
    period: int
    away: TeamBox
    home: TeamBox
    headline: str = ""
    summary_text: str = ""
    milestones: List[str] = field(default_factory=list)
    venue: str = ""
    is_favorite_game: bool = False
    favorite_team_id: Optional[str] = None
    has_box_details: bool = False
    lead_image: Optional[LeadImage] = None

    @property
    def margin(self) -> int:
        return abs(self.home.score - self.away.score)

    @property
    def total_score(self) -> int:
        return self.home.score + self.away.score

    @property
    def is_overtime(self) -> bool:
        detail = self.status_detail.upper()
        if "OT" in detail or "SO" in detail or "PK" in detail:
            return True
        if self.sport == "basketball" and self.period > 4:
            return True
        if self.sport == "baseball" and self.period > 9:
            return True
        if self.sport == "hockey" and self.period > 3:
            return True
        if self.sport == "football" and self.period > 4:
            return True
        return False


@dataclass
class HighlightItem:
    kind: str                  # "game" or "rss"
    league_label: str
    status_detail: str
    game: Optional[GameRecord] = None
    title: str = ""
    summary: str = ""
    sort_score: int = 0


@dataclass
class UpcomingEvent:
    team_name: str
    short_name: str
    league_label: str
    status_type: str           # "today", "upcoming", "offseason"
    matchup: str
    time_display: str
    record: str = ""


class BaseFetcher(ABC):
    """Adapter interface for sports data providers."""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.timeout = int(config.get("data_provider", {}).get("timeout_seconds", 12))

    @abstractmethod
    def fetch_scoreboard(
        self, sport: str, league: str, league_label: str, yyyymmdd: str
    ) -> List[GameRecord]:
        """Fetch all games for a league on a given YYYYMMDD date (local ET calendar)."""

    @abstractmethod
    def enrich_game_details(self, game: GameRecord) -> GameRecord:
        """Fetch box score / player stat lines and milestones for a specific game."""

    @abstractmethod
    def fetch_team_next_event(
        self, fav_team: Dict[str, Any], today_yyyymmdd: str, tz_name: str
    ) -> UpcomingEvent:
        """Fetch the next scheduled game or off-season status for a favorite team."""


class ApiSportsFetcher(BaseFetcher):
    """
    Placeholder adapter for API-Sports (api-sports.io).
    Requires API_SPORTS_KEY environment variable when enabled in config.yaml.
    """

    def fetch_scoreboard(
        self, sport: str, league: str, league_label: str, yyyymmdd: str
    ) -> List[GameRecord]:
        raise NotImplementedError(
            "ApiSportsFetcher is a stub adapter. Set data_provider.name: 'espn' or implement API-Sports mapping."
        )

    def enrich_game_details(self, game: GameRecord) -> GameRecord:
        return game

    def fetch_team_next_event(
        self, fav_team: Dict[str, Any], today_yyyymmdd: str, tz_name: str
    ) -> UpcomingEvent:
        return UpcomingEvent(
            team_name=fav_team["name"],
            short_name=fav_team.get("short_name", fav_team["name"]),
            league_label=fav_team["league"].upper(),
            status_type="offseason",
            matchup="Schedule unavailable",
            time_display="",
        )


class BallDontLieFetcher(BaseFetcher):
    """
    Placeholder adapter for BALLDONTLIE (api.balldontlie.io).
    Requires BALLDONTLIE_API_KEY environment variable when enabled in config.yaml.
    """

    def fetch_scoreboard(
        self, sport: str, league: str, league_label: str, yyyymmdd: str
    ) -> List[GameRecord]:
        raise NotImplementedError(
            "BallDontLieFetcher is a stub adapter. Set data_provider.name: 'espn' or implement BALLDONTLIE mapping."
        )

    def enrich_game_details(self, game: GameRecord) -> GameRecord:
        return game

    def fetch_team_next_event(
        self, fav_team: Dict[str, Any], today_yyyymmdd: str, tz_name: str
    ) -> UpcomingEvent:
        return UpcomingEvent(
            team_name=fav_team["name"],
            short_name=fav_team.get("short_name", fav_team["name"]),
            league_label=fav_team["league"].upper(),
            status_type="offseason",
            matchup="Schedule unavailable",
            time_display="",
        )


def get_fetcher(config: Dict[str, Any]) -> BaseFetcher:
    from fetchers.espn_fetcher import ESPNFetcher

    provider = config.get("data_provider", {}).get("name", "espn").lower()
    if provider == "espn":
        return ESPNFetcher(config)
    if provider == "api_sports":
        return ApiSportsFetcher(config)
    if provider == "balldontlie":
        return BallDontLieFetcher(config)
    raise ValueError(f"Unsupported data_provider.name: {provider}")

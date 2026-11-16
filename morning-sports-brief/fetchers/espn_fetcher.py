from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import requests

from fetchers import BaseFetcher, GameRecord, LeadImage, TeamBox, UpcomingEvent

logger = logging.getLogger(__name__)

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports"


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(float(str(val)))
    except (TypeError, ValueError):
        return default


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(str(val))
    except (TypeError, ValueError):
        return default


class ESPNFetcher(BaseFetcher):
    """Zero-cost fetcher backed by ESPN's public JSON endpoints."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "MorningSportsBrief/1.0 (Personal Home Newspaper)",
                "Accept": "application/json",
            }
        )
        self._scoreboard_cache: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    def _get_json(self, url: str, params: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        try:
            resp = self.session.get(url, params=params, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            logger.warning("ESPN request failed for %s: %s", url, exc)
            return {}

    def _get_scoreboard_raw(self, sport: str, league: str, yyyymmdd: str) -> Dict[str, Any]:
        key = (sport, league, yyyymmdd)
        if key not in self._scoreboard_cache:
            url = f"{ESPN_BASE}/{sport}/{league}/scoreboard"
            self._scoreboard_cache[key] = self._get_json(url, params={"dates": yyyymmdd})
        return self._scoreboard_cache[key]

    def fetch_scoreboard(
        self, sport: str, league: str, league_label: str, yyyymmdd: str
    ) -> List[GameRecord]:
        data = self._get_scoreboard_raw(sport, league, yyyymmdd)
        events = data.get("events", [])
        games: List[GameRecord] = []

        for event in events:
            parsed = self._parse_event(event, sport, league, league_label)
            if parsed:
                games.append(parsed)

        return games

    def _parse_event(
        self, event: Dict[str, Any], sport: str, league: str, league_label: str
    ) -> Optional[GameRecord]:
        competitions = event.get("competitions", [])
        if not competitions:
            return None
        comp = competitions[0]
        competitors = comp.get("competitors", [])
        if len(competitors) < 2:
            return None

        status_obj = comp.get("status", {})
        status_type = status_obj.get("type", {})
        state = status_type.get("state", "pre")
        completed = bool(status_type.get("completed", False) or state == "post")
        detail = status_type.get("shortDetail") or status_type.get("detail") or ""
        period = _safe_int(status_obj.get("period", 0))

        home_raw = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0])
        away_raw = next((c for c in competitors if c.get("homeAway") == "away"), competitors[1])

        home_box = self._parse_competitor(home_raw, is_home=True)
        away_box = self._parse_competitor(away_raw, is_home=False)

        headline = ""
        summary_text = ""
        headlines = comp.get("headlines", [])
        if headlines and isinstance(headlines, list):
            headline = headlines[0].get("shortLinkText") or headlines[0].get("description") or ""
            summary_text = headlines[0].get("description") or ""

        venue = comp.get("venue", {}).get("fullName", "")

        game = GameRecord(
            event_id=str(event.get("id", "")),
            sport=sport,
            league=league,
            league_label=league_label,
            start_time_utc=event.get("date", ""),
            status_state=state,
            status_detail=detail,
            completed=completed,
            period=period,
            away=away_box,
            home=home_box,
            headline=headline,
            summary_text=summary_text,
            venue=venue,
        )

        if sport == "soccer":
            self._extract_soccer_details(comp, game)

        return game

    def _parse_competitor(self, comp_data: Dict[str, Any], is_home: bool) -> TeamBox:
        team = comp_data.get("team", {})
        records = comp_data.get("records", [])
        record_str = records[0].get("summary", "") if records else ""

        raw_lines = comp_data.get("linescores", [])
        linescores = [
            str(_safe_int(ls.get("value", 0))) if ls.get("displayValue") is None else str(ls.get("displayValue"))
            for ls in raw_lines
        ]

        leaders = []
        for cat in comp_data.get("leaders", [])[:3]:
            cat_abbr = cat.get("shortDisplayName") or cat.get("abbreviation") or ""
            top_list = cat.get("leaders", [])
            if top_list:
                top = top_list[0]
                athlete = top.get("athlete", {})
                name = athlete.get("shortName") or athlete.get("displayName") or ""
                disp = top.get("displayValue", "")
                if name and disp:
                    leaders.append(f"{name}: {disp} {cat_abbr}".strip())

        return TeamBox(
            team_id=str(team.get("id", "")),
            name=team.get("displayName", team.get("name", "Team")),
            short_name=team.get("shortDisplayName", team.get("name", "Team")),
            abbreviation=team.get("abbreviation", "TM"),
            score=_safe_int(comp_data.get("score", 0)),
            is_home=is_home,
            winner=bool(comp_data.get("winner", False)),
            record=record_str,
            linescores=linescores,
            leaders=leaders,
        )

    def _extract_soccer_details(self, comp: Dict[str, Any], game: GameRecord) -> None:
        details = comp.get("details", [])
        home_goals: List[str] = []
        away_goals: List[str] = []
        scorer_counts: Dict[str, int] = {}

        for d in details:
            if not d.get("scoringPlay"):
                continue
            clock = d.get("clock", {}).get("displayValue", "")
            team_id = str(d.get("team", {}).get("id", ""))
            athletes = d.get("athletesInvolved", [])
            scorer = athletes[0].get("shortName") or athletes[0].get("displayName", "") if athletes else "Goal"
            if scorer:
                scorer_counts[scorer] = scorer_counts.get(scorer, 0) + 1
            entry = f"{scorer} ({clock})".strip()
            if team_id == game.home.team_id:
                home_goals.append(entry)
            elif team_id == game.away.team_id:
                away_goals.append(entry)

        if home_goals:
            game.home.leaders = home_goals[:4]
        if away_goals:
            game.away.leaders = away_goals[:4]

        for scorer, cnt in scorer_counts.items():
            if cnt >= 2:
                game.milestones.append(f"{scorer} scored {cnt} goals")

    def enrich_game_details(self, game: GameRecord) -> GameRecord:
        if game.has_box_details or not game.event_id:
            return game

        url = f"{ESPN_BASE}/{game.sport}/{game.league}/summary"
        data = self._get_json(url, params={"event": game.event_id})
        if not data:
            return game

        article = data.get("article", {})
        if article:
            if not game.headline:
                game.headline = article.get("headline", "")
            if not game.summary_text:
                game.summary_text = article.get("description", "")

            images = article.get("images", [])
            if isinstance(images, list) and images:
                # Prefer editorial photography over generic video highlight stills when available
                editorial_imgs = [
                    img for img in images
                    if img.get("url") and str(img.get("type", "")).lower() != "media"
                ]
                chosen_img = editorial_imgs[0] if editorial_imgs else images[0]
                img_url = chosen_img.get("url", "").strip()
                if img_url:
                    game.lead_image = LeadImage(
                        url=img_url,
                        caption=(chosen_img.get("caption") or game.headline or "").strip(),
                        credit=(chosen_img.get("credit") or "").strip(),
                    )

        if game.lead_image is None:
            videos = data.get("videos", [])
            if isinstance(videos, list) and videos:
                thumb = (videos[0].get("thumbnail") or "").strip()
                if thumb:
                    game.lead_image = LeadImage(
                        url=thumb,
                        caption=(videos[0].get("headline") or game.headline or f"{game.away.short_name} at {game.home.short_name}").strip(),
                        credit="",
                    )

        boxscore = data.get("boxscore", {})
        players_sections = boxscore.get("players", [])
        if players_sections:
            for team_sec in players_sections:
                t_id = str(team_sec.get("team", {}).get("id", ""))
                target_box = (
                    game.home
                    if t_id == game.home.team_id
                    else game.away
                    if t_id == game.away.team_id
                    else None
                )
                if not target_box:
                    continue

                stat_lines, milestones = self._extract_team_stat_lines(
                    game.sport, team_sec.get("statistics", [])
                )
                if stat_lines:
                    target_box.leaders = stat_lines[:3]
                game.milestones.extend(milestones)

        game.has_box_details = True
        return game

    def _extract_team_stat_lines(
        self, sport: str, statistics: List[Dict[str, Any]]
    ) -> Tuple[List[str], List[str]]:
        if not statistics:
            return [], []

        if sport == "basketball":
            return self._extract_basketball_lines(statistics[0])
        if sport == "baseball":
            return self._extract_baseball_lines(statistics)
        if sport == "hockey":
            return self._extract_hockey_lines(statistics)
        if sport == "football":
            return self._extract_football_lines(statistics)
        return [], []

    def _extract_basketball_lines(
        self, stat_group: Dict[str, Any]
    ) -> Tuple[List[str], List[str]]:
        keys = [k.upper() for k in stat_group.get("keys", stat_group.get("labels", []))]
        labels = [l.upper() for l in stat_group.get("labels", [])]
        cols = labels if labels else keys

        idx_pts = cols.index("PTS") if "PTS" in cols else -1
        idx_reb = cols.index("REB") if "REB" in cols else -1
        idx_ast = cols.index("AST") if "AST" in cols else -1

        scored_players: List[Tuple[int, str]] = []
        milestones: List[str] = []

        for row in stat_group.get("athletes", []):
            if row.get("didNotPlay"):
                continue
            stats = row.get("stats", [])
            if not stats or idx_pts < 0 or idx_pts >= len(stats):
                continue

            athlete = row.get("athlete", {})
            name = athlete.get("shortName") or athlete.get("displayName", "")
            pts = _safe_int(stats[idx_pts])
            reb = _safe_int(stats[idx_reb]) if 0 <= idx_reb < len(stats) else 0
            ast = _safe_int(stats[idx_ast]) if 0 <= idx_ast < len(stats) else 0

            if pts >= 40:
                milestones.append(f"{name} exploded for {pts} PTS")
            elif pts >= 30:
                milestones.append(f"{name} scored {pts} PTS")

            double_cats = sum(1 for v in (pts, reb, ast) if v >= 10)
            if double_cats >= 3:
                milestones.append(f"{name} recorded a triple-double ({pts}P/{reb}R/{ast}A)")

            parts = [f"{pts} PTS"]
            if reb > 0:
                parts.append(f"{reb} REB")
            if ast > 0:
                parts.append(f"{ast} AST")
            rank_score = pts * 2 + reb + ast
            scored_players.append((rank_score, f"{name}: {', '.join(parts)}"))

        scored_players.sort(key=lambda x: x[0], reverse=True)
        return [line for _, line in scored_players[:3]], milestones

    def _extract_baseball_lines(
        self, stat_groups: List[Dict[str, Any]]
    ) -> Tuple[List[str], List[str]]:
        batters: List[Tuple[int, str]] = []
        pitchers: List[Tuple[int, str]] = []
        milestones: List[str] = []

        for grp in stat_groups:
            grp_name = (grp.get("type") or grp.get("name") or "").lower()
            cols = [c.upper() for c in grp.get("labels", grp.get("names", []))]

            if "batting" in grp_name or "H" in cols:
                idx_hab = cols.index("H-AB") if "H-AB" in cols else -1
                idx_ab = cols.index("AB") if "AB" in cols else -1
                idx_h = cols.index("H") if "H" in cols else -1
                idx_hr = cols.index("HR") if "HR" in cols else -1
                idx_rbi = cols.index("RBI") if "RBI" in cols else -1

                for row in grp.get("athletes", []):
                    stats = row.get("stats", [])
                    if not stats:
                        continue
                    name = row.get("athlete", {}).get("shortName", "")
                    hits = _safe_int(stats[idx_h]) if 0 <= idx_h < len(stats) else 0
                    ab = _safe_int(stats[idx_ab]) if 0 <= idx_ab < len(stats) else 0
                    hr = _safe_int(stats[idx_hr]) if 0 <= idx_hr < len(stats) else 0
                    rbi = _safe_int(stats[idx_rbi]) if 0 <= idx_rbi < len(stats) else 0

                    if hr >= 2:
                        milestones.append(f"{name} hit {hr} home runs")
                    if rbi >= 4:
                        milestones.append(f"{name} drove in {rbi} RBI")

                    hab = stats[idx_hab] if 0 <= idx_hab < len(stats) else f"{hits}-{ab}"
                    extras = []
                    if hr > 0:
                        extras.append(f"{hr} HR" if hr > 1 else "HR")
                    if rbi > 0:
                        extras.append(f"{rbi} RBI")
                    score = hits * 2 + hr * 5 + rbi * 2
                    if score > 0:
                        detail = f"{hab}" + (f", {', '.join(extras)}" if extras else "")
                        batters.append((score, f"{name}: {detail}"))

            elif "pitching" in grp_name or "IP" in cols:
                idx_ip = cols.index("IP") if "IP" in cols else -1
                idx_er = cols.index("ER") if "ER" in cols else -1
                idx_k = cols.index("K") if "K" in cols else (cols.index("SO") if "SO" in cols else -1)

                for row in grp.get("athletes", []):
                    stats = row.get("stats", [])
                    if not stats or idx_ip < 0 or idx_ip >= len(stats):
                        continue
                    name = row.get("athlete", {}).get("shortName", "")
                    ip_str = stats[idx_ip]
                    ip_val = _safe_float(ip_str)
                    er = _safe_int(stats[idx_er]) if 0 <= idx_er < len(stats) else 0
                    ks = _safe_int(stats[idx_k]) if 0 <= idx_k < len(stats) else 0

                    if ks >= 10:
                        milestones.append(f"{name} struck out {ks} batters")

                    score = int(ip_val * 3) + ks - er * 2
                    if ip_val >= 4.0:
                        pitchers.append((score, f"{name}: {ip_str} IP, {er} ER, {ks} K"))

        batters.sort(key=lambda x: x[0], reverse=True)
        pitchers.sort(key=lambda x: x[0], reverse=True)
        combined = [line for _, line in batters[:2]] + [line for _, line in pitchers[:1]]
        return combined[:3], milestones

    def _extract_hockey_lines(
        self, stat_groups: List[Dict[str, Any]]
    ) -> Tuple[List[str], List[str]]:
        skaters: List[Tuple[int, str]] = []
        goalies: List[Tuple[int, str]] = []
        milestones: List[str] = []

        for grp in stat_groups:
            cols = [c.upper() for c in grp.get("labels", grp.get("names", []))]
            if "G" in cols and "A" in cols:
                idx_g = cols.index("G")
                idx_a = cols.index("A")
                for row in grp.get("athletes", []):
                    stats = row.get("stats", [])
                    if len(stats) <= max(idx_g, idx_a):
                        continue
                    name = row.get("athlete", {}).get("shortName", "")
                    g = _safe_int(stats[idx_g])
                    a = _safe_int(stats[idx_a])
                    pts = g + a
                    if g >= 3:
                        milestones.append(f"{name} scored a hat trick ({g} G)")
                    elif pts >= 3:
                        milestones.append(f"{name} tallied {pts} points ({g} G, {a} A)")
                    if pts > 0:
                        skaters.append((pts * 3 + g, f"{name}: {g} G, {a} A"))
            elif "SV" in cols:
                idx_sv = cols.index("SV")
                idx_ga = cols.index("GA") if "GA" in cols else -1
                for row in grp.get("athletes", []):
                    stats = row.get("stats", [])
                    if len(stats) <= idx_sv:
                        continue
                    name = row.get("athlete", {}).get("shortName", "")
                    sv = _safe_int(stats[idx_sv])
                    ga = _safe_int(stats[idx_ga]) if 0 <= idx_ga < len(stats) else 0
                    if sv >= 30 and ga == 0:
                        milestones.append(f"{name} posted a {sv}-save shutout")
                    if sv > 0:
                        goalies.append((sv, f"{name}: {sv} SV, {ga} GA"))

        skaters.sort(key=lambda x: x[0], reverse=True)
        goalies.sort(key=lambda x: x[0], reverse=True)
        combined = [line for _, line in skaters[:2]] + [line for _, line in goalies[:1]]
        return combined[:3], milestones

    def _extract_football_lines(
        self, stat_groups: List[Dict[str, Any]]
    ) -> Tuple[List[str], List[str]]:
        lines: List[Tuple[int, str]] = []
        milestones: List[str] = []

        for grp in stat_groups:
            grp_name = (grp.get("name") or "").lower()
            cols = [c.upper() for c in grp.get("labels", grp.get("names", []))]
            if grp_name not in ("passing", "rushing", "receiving"):
                continue

            idx_yds = cols.index("YDS") if "YDS" in cols else -1
            idx_td = cols.index("TD") if "TD" in cols else -1
            idx_rec = cols.index("REC") if "REC" in cols else -1

            athletes = grp.get("athletes", [])
            if not athletes or idx_yds < 0:
                continue

            top = athletes[0]
            stats = top.get("stats", [])
            if len(stats) <= idx_yds:
                continue
            name = top.get("athlete", {}).get("shortName", "")
            yds = _safe_int(stats[idx_yds])
            td = _safe_int(stats[idx_td]) if 0 <= idx_td < len(stats) else 0

            if grp_name == "passing":
                if yds >= 350 or td >= 3:
                    milestones.append(f"{name} threw for {yds} YDS and {td} TD")
                lines.append((yds + td * 40, f"{name}: {yds} PASS YDS, {td} TD"))
            elif grp_name == "rushing":
                if yds >= 150 or td >= 2:
                    milestones.append(f"{name} rushed for {yds} YDS, {td} TD")
                lines.append((yds * 2 + td * 40, f"{name}: {yds} RUSH YDS, {td} TD"))
            elif grp_name == "receiving":
                rec = _safe_int(stats[idx_rec]) if 0 <= idx_rec < len(stats) else 0
                if yds >= 150 or td >= 2:
                    milestones.append(f"{name} caught {rec} passes for {yds} YDS")
                lines.append((yds * 2 + td * 40, f"{name}: {rec} REC, {yds} YDS, {td} TD"))

        lines.sort(key=lambda x: x[0], reverse=True)
        return [line for _, line in lines[:3]], milestones

    def fetch_team_next_event(
        self, fav_team: Dict[str, Any], today_yyyymmdd: str, tz_name: str
    ) -> UpcomingEvent:
        sport = fav_team["sport"]
        league = fav_team["league"]
        team_id = str(fav_team["espn_team_id"])
        tz = ZoneInfo(tz_name)
        window_days = int(self.config.get("curation", {}).get("upcoming_window_days", 14))
        today_date = datetime.strptime(today_yyyymmdd, "%Y%m%d").date()

        url = f"{ESPN_BASE}/{sport}/{league}/teams/{team_id}"
        data = self._get_json(url)
        team_obj = data.get("team", {})

        record_items = team_obj.get("record", {}).get("items", [])
        record_str = record_items[0].get("summary", "") if record_items else ""

        next_events = team_obj.get("nextEvent", [])
        if next_events:
            ev = next_events[0]
            ev_date_str = ev.get("date", "")
            matchup = ev.get("shortName") or ev.get("name") or "Scheduled Game"

            if ev_date_str:
                dt_utc = datetime.fromisoformat(ev_date_str.replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(tz)
                local_yyyymmdd = dt_local.strftime("%Y%m%d")
                days_away = (dt_local.date() - today_date).days
                time_fmt = dt_local.strftime("%-I:%M %p ET")

                if local_yyyymmdd == today_yyyymmdd:
                    return UpcomingEvent(
                        team_name=fav_team["name"],
                        short_name=fav_team.get("short_name", fav_team["name"]),
                        league_label=league.upper(),
                        status_type="today",
                        matchup=matchup,
                        time_display=f"Today at {time_fmt}",
                        record=record_str,
                    )

                if 0 < days_away <= window_days:
                    day_fmt = dt_local.strftime("%a, %b %-d")
                    return UpcomingEvent(
                        team_name=fav_team["name"],
                        short_name=fav_team.get("short_name", fav_team["name"]),
                        league_label=league.upper(),
                        status_type="upcoming",
                        matchup=matchup,
                        time_display=f"{day_fmt} at {time_fmt}",
                        record=record_str,
                    )

                if days_away > window_days:
                    return UpcomingEvent(
                        team_name=fav_team["name"],
                        short_name=fav_team.get("short_name", fav_team["name"]),
                        league_label=league.upper(),
                        status_type="offseason",
                        matchup="Off-Season",
                        time_display="Off-Season",
                        record=record_str,
                    )

        today_games = self.fetch_scoreboard(sport, league, league.upper(), today_yyyymmdd)
        for g in today_games:
            if team_id in (g.home.team_id, g.away.team_id):
                dt_utc = datetime.fromisoformat(g.start_time_utc.replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(tz)
                return UpcomingEvent(
                    team_name=fav_team["name"],
                    short_name=fav_team.get("short_name", fav_team["name"]),
                    league_label=league.upper(),
                    status_type="today",
                    matchup=f"{g.away.abbreviation} @ {g.home.abbreviation}",
                    time_display=f"Today at {dt_local.strftime('%-I:%M %p ET')}",
                    record=record_str,
                )

        return UpcomingEvent(
            team_name=fav_team["name"],
            short_name=fav_team.get("short_name", fav_team["name"]),
            league_label=league.upper(),
            status_type="offseason",
            matchup="Off-Season",
            time_display="Off-Season",
            record=record_str,
        )

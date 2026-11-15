export interface TeamBox {
  team_id: string;
  name: string;
  short_name: string;
  abbreviation: string;
  score: number;
  is_home: boolean;
  winner: boolean;
  record: string;
  linescores: string[];
  leaders: string[];
}

export interface LeadImage {
  url: string;
  caption: string;
  credit: string;
}

export interface GameRecord {
  event_id: string;
  sport: string;
  league: string;
  league_label: string;
  start_time_utc: string;
  status_state: string;
  status_detail: string;
  completed: boolean;
  period: number;
  away: TeamBox;
  home: TeamBox;
  headline: string;
  summary_text: string;
  milestones: string[];
  venue: string;
  is_favorite_game: boolean;
  favorite_team_id: string | null;
  has_box_details: boolean;
  excitement_score?: number;
  lead_image?: LeadImage | null;
}

export interface UpcomingEvent {
  team_name: string;
  short_name: string;
  league_label: string;
  status_type: 'today' | 'upcoming' | 'offseason';
  matchup: string;
  time_display: string;
  record: string;
}

export interface FavoriteTeamConfig {
  name: string;
  short_name: string;
  sport: string;
  league: string;
  espn_team_id: string;
  abbreviation: string;
}

export interface SecondaryLeagueConfig {
  label: string;
  sport: string;
  league: string;
}

export interface HighlightFeedConfig {
  label: string;
  sport: string;
  feed_url: string;
}

export interface HighlightItem {
  kind: 'game' | 'rss';
  league_label: string;
  status_detail: string;
  game?: GameRecord;
  title?: string;
  summary?: string;
}

export interface BriefConfig {
  newspaper: {
    title: string;
    subtitle: string;
    timezone: string;
  };
  data_provider: {
    name: string;
    timeout_seconds: number;
  };
  editorial: {
    llm_mode: string;
    gemini_model: string;
    openai_model: string;
    target_word_count: string;
  };
  curation: {
    max_interesting_games: number;
    min_interesting_games: number;
  };
  favorite_teams: FavoriteTeamConfig[];
  secondary_leagues: SecondaryLeagueConfig[];
  highlight_feeds?: HighlightFeedConfig[];
}

export interface FavoriteSectionItem {
  team_config: FavoriteTeamConfig;
  game: GameRecord | null;
  upcoming: UpcomingEvent;
}

export interface TopStory {
  kicker: string;
  headline: string;
  body: string;
  source: 'gemini' | 'offline';
}

export interface SportsFact {
  id: string;
  category: string;
  fact: string;
}

export interface BriefState {
  edition_number: number;
  used_fact_ids: string[];
  last_edition_date: string;
}

export interface EditionPayload {
  title: string;
  subtitle: string;
  edition_date_iso: string;
  edition_date_pretty: string;
  yesterday_iso: string;
  yesterday_display: string;
  edition_number: number;
  top_story: TopStory;
  lead_image: LeadImage | null;
  fact_of_day: SportsFact;
  favorite_items: FavoriteSectionItem[];
  interesting_games: GameRecord[];
  highlights: HighlightItem[];
  lead_game: GameRecord | null;
  gemini_available: boolean;
}

export interface RepoFileEntry {
  path: string;
  content: string;
  language: string;
}

import React, { useEffect, useState } from 'react';
import { Check, Plus, Save, Search, Trash2 } from 'lucide-react';
import type { BriefConfig, FavoriteTeamConfig } from '../types';

interface TeamDeskViewProps {
  onConfigSaved: () => void;
}

const LEAGUE_OPTIONS = [
  { label: 'NBA', sport: 'basketball', league: 'nba' },
  { label: 'WNBA', sport: 'basketball', league: 'wnba' },
  { label: 'MLB', sport: 'baseball', league: 'mlb' },
  { label: 'NFL', sport: 'football', league: 'nfl' },
  { label: 'NHL', sport: 'hockey', league: 'nhl' },
  { label: 'Premier League', sport: 'soccer', league: 'eng.1' },
  { label: 'Champions League', sport: 'soccer', league: 'uefa.champions' },
];

const HIGHLIGHT_FEED_OPTIONS = [
  { label: 'Distance Running', sport: 'running', feed_url: 'https://www.letsrun.com/feed/' },
  { label: 'Gymnastics', sport: 'gymnastics', feed_url: 'https://usagym.org/feed/' },
  { label: 'Skiing', sport: 'skiing', feed_url: 'https://www.skiracing.com/feed/' },
];

export const TeamDeskView: React.FC<TeamDeskViewProps> = ({ onConfigSaved }) => {
  const [config, setConfig] = useState<BriefConfig | null>(null);
  const [rawYaml, setRawYaml] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const [browseLeague, setBrowseLeague] = useState(LEAGUE_OPTIONS[0]);
  const [directoryTeams, setDirectoryTeams] = useState<FavoriteTeamConfig[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        setConfig(data.config);
        setRawYaml(data.rawYaml || '');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setDirectoryLoading(true);
    fetch(`/api/teams?sport=${browseLeague.sport}&league=${browseLeague.league}`)
      .then((r) => r.json())
      .then((data) => setDirectoryTeams(data.teams || []))
      .finally(() => setDirectoryLoading(false));
  }, [browseLeague]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setRawYaml(data.rawYaml);
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 2500);
        onConfigSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  const addFavorite = (team: FavoriteTeamConfig) => {
    if (!config) return;
    const exists = config.favorite_teams.some(
      (f) => f.league === team.league && f.espn_team_id === team.espn_team_id
    );
    if (exists) return;
    setConfig({
      ...config,
      favorite_teams: [...config.favorite_teams, team],
    });
  };

  const removeFavorite = (idx: number) => {
    if (!config) return;
    setConfig({
      ...config,
      favorite_teams: config.favorite_teams.filter((_, i) => i !== idx),
    });
  };

  const toggleSecondaryLeague = (opt: { label: string; sport: string; league: string }) => {
    if (!config) return;
    const exists = config.secondary_leagues.some(
      (s) => s.sport === opt.sport && s.league === opt.league
    );
    const next = exists
      ? config.secondary_leagues.filter(
          (s) => !(s.sport === opt.sport && s.league === opt.league)
        )
      : [...config.secondary_leagues, opt];
    setConfig({ ...config, secondary_leagues: next });
  };

  const toggleHighlightFeed = (opt: { label: string; sport: string; feed_url: string }) => {
    if (!config) return;
    const current = config.highlight_feeds || [];
    const exists = current.some((f) => f.sport === opt.sport);
    const next = exists ? current.filter((f) => f.sport !== opt.sport) : [...current, opt];
    setConfig({ ...config, highlight_feeds: next });
  };

  if (loading || !config) {
    return (
      <div className="rounded-md border border-[#DDD6C8] bg-white p-8 text-sm text-[#5C574F]">
        Loading team configuration...
      </div>
    );
  }

  const filteredDirectory = directoryTeams.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.abbreviation.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#DDD6C8] pb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#1A1816]">
            Team Desk &amp; Curation Rules
          </h2>
          <p className="mt-1 text-sm text-[#5C574F]">
            Configure Priority 1 favorite teams, secondary leagues, and masthead settings stored in{' '}
            <code className="font-tabular text-xs">morning-sports-brief/config.yaml</code>.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#172D6E] disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          {savedNotice ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving...' : savedNotice ? 'Saved to config.yaml' : 'Save Configuration'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Column: Current Favorites & Settings */}
        <div className="space-y-6 lg:col-span-7">
          <section className="rounded-md border border-[#DDD6C8] bg-white p-5">
            <h3 className="text-base font-semibold text-[#1A1816]">
              01. Priority Favorite Teams
            </h3>
            <p className="mt-0.5 text-xs text-[#5C574F]">
              Rendered with full period-by-period line scores, player leaders, and next-game schedules.
            </p>

            <div className="mt-4 divide-y divide-[#EDE8DF] border-t border-[#EDE8DF]">
              {config.favorite_teams.map((fav, idx) => (
                <div
                  key={`${fav.league}-${fav.espn_team_id}`}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[#1A1816]">{fav.name}</div>
                    <div className="text-xs text-[#5C574F]">
                      {fav.league.toUpperCase()} · {fav.abbreviation} · ESPN ID {fav.espn_team_id}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFavorite(idx)}
                    aria-label={`Remove ${fav.name}`}
                    className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium text-[#7F1D1D] hover:bg-[#FEF2F2] transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              ))}
              {config.favorite_teams.length === 0 && (
                <p className="py-4 text-sm italic text-[#5C574F]">
                  No favorite teams selected. Add teams from the ESPN Directory on the right.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-md border border-[#DDD6C8] bg-white p-5">
            <h3 className="text-base font-semibold text-[#1A1816]">
              02. Around the League &amp; Masthead
            </h3>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-xs font-medium text-[#4A453E]">
                Newspaper Title
                <input
                  type="text"
                  value={config.newspaper.title}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      newspaper: { ...config.newspaper, title: e.target.value },
                    })
                  }
                  className="mt-1 w-full rounded border border-[#CFC7B8] px-3 py-1.5 text-sm text-[#1A1816] focus:border-[#1E3A8A] focus:outline-none"
                />
              </label>

              <label className="block text-xs font-medium text-[#4A453E]">
                Max Highlights (Priority 2)
                <select
                  value={config.curation.max_interesting_games}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      curation: {
                        ...config.curation,
                        max_interesting_games: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-1 w-full rounded border border-[#CFC7B8] bg-white px-3 py-1.5 text-sm text-[#1A1816] focus:border-[#1E3A8A] focus:outline-none"
                >
                  <option value={3}>3 games</option>
                  <option value={4}>4 games</option>
                  <option value={5}>5 games</option>
                  <option value={6}>6 games</option>
                </select>
              </label>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs font-medium text-[#4A453E]">
                Secondary Leagues Scanned for Close Finishes &amp; Milestones
              </div>
              <div className="flex flex-wrap gap-2">
                {LEAGUE_OPTIONS.map((opt) => {
                  const active = config.secondary_leagues.some(
                    (s) => s.sport === opt.sport && s.league === opt.league
                  );
                  return (
                    <button
                      key={`${opt.sport}-${opt.league}`}
                      type="button"
                      onClick={() => toggleSecondaryLeague(opt)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white'
                          : 'border-[#CFC7B8] bg-[#FAF8F4] text-[#4A453E] hover:bg-[#EFECE4]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs font-medium text-[#4A453E]">
                Individual &amp; Olympic Highlight Feeds
              </div>
              <div className="flex flex-wrap gap-2">
                {HIGHLIGHT_FEED_OPTIONS.map((opt) => {
                  const active = (config.highlight_feeds || []).some((f) => f.sport === opt.sport);
                  return (
                    <button
                      key={opt.sport}
                      type="button"
                      onClick={() => toggleHighlightFeed(opt)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white'
                          : 'border-[#CFC7B8] bg-[#FAF8F4] text-[#4A453E] hover:bg-[#EFECE4]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rounded-md border border-[#DDD6C8] bg-white p-5">
            <h3 className="text-base font-semibold text-[#1A1816]">Live config.yaml Preview</h3>
            <pre className="mt-3 max-h-64 overflow-auto rounded bg-[#1F1D1A] p-4 font-tabular text-xs leading-relaxed text-[#EFECE4]">
              {rawYaml}
            </pre>
          </section>
        </div>

        {/* Right Column: Live ESPN Team Directory */}
        <div className="lg:col-span-5">
          <section className="rounded-md border border-[#DDD6C8] bg-white p-5">
            <h3 className="text-base font-semibold text-[#1A1816]">
              ESPN Team Directory
            </h3>
            <p className="mt-0.5 text-xs text-[#5C574F]">
              Look up official ESPN team IDs from live league rosters and add them to your paper.
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {LEAGUE_OPTIONS.map((opt) => (
                <button
                  key={opt.league}
                  type="button"
                  onClick={() => setBrowseLeague(opt)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    browseLeague.league === opt.league
                      ? 'bg-[#1A1816] text-white'
                      : 'bg-[#F3EFE7] text-[#4A453E] hover:bg-[#E7E1D5]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#78716C]" />
              <input
                type="text"
                placeholder={`Filter ${browseLeague.label} teams...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded border border-[#CFC7B8] pl-9 pr-3 py-1.5 text-sm text-[#1A1816] focus:border-[#1E3A8A] focus:outline-none"
              />
            </div>

            <div className="mt-3 max-h-[460px] divide-y divide-[#EDE8DF] overflow-y-auto border-t border-[#EDE8DF]">
              {directoryLoading ? (
                <div className="py-8 text-center text-xs text-[#5C574F]">
                  Loading {browseLeague.label} directory from ESPN...
                </div>
              ) : (
                filteredDirectory.map((team) => {
                  const alreadyAdded = config.favorite_teams.some(
                    (f) => f.league === team.league && f.espn_team_id === team.espn_team_id
                  );
                  return (
                    <div
                      key={`${team.league}-${team.espn_team_id}`}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="truncate text-sm font-medium text-[#1A1816]">
                          {team.name}
                        </div>
                        <div className="text-xs text-[#5C574F]">
                          {team.abbreviation} · ID {team.espn_team_id}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={alreadyAdded}
                        onClick={() => addFavorite(team)}
                        className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                          alreadyAdded
                            ? 'bg-[#EFECE4] text-[#5C574F]'
                            : 'border border-[#1E3A8A] text-[#1E3A8A] hover:bg-[#1E3A8A] hover:text-white'
                        }`}
                      >
                        {alreadyAdded ? (
                          <>
                            <Check className="h-3 w-3" /> Added
                          </>
                        ) : (
                          <>
                            <Plus className="h-3 w-3" /> Add
                          </>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Calendar, Download, RefreshCw, Sparkles } from 'lucide-react';
import type { EditionPayload, GameRecord, HighlightItem } from '../types';

interface BroadsheetViewProps {
  edition: EditionPayload | null;
  loading: boolean;
  regenerating: boolean;
  error: string | null;
  selectedDate: string;
  storyMode: 'auto' | 'offline';
  onDateChange: (dateIso: string) => void;
  onStoryModeChange: (mode: 'auto' | 'offline') => void;
  onRefresh: () => void;
  onRegenerateStory: () => void;
  onDownloadHtml: () => void;
}

function getPeriodLabel(game: GameRecord, index: number): string {
  if (game.sport === 'basketball') {
    return index < 4 ? `Q${index + 1}` : `OT${index > 4 ? index - 3 : ''}`;
  }
  if (game.sport === 'football') {
    return index < 4 ? `Q${index + 1}` : 'OT';
  }
  if (game.sport === 'hockey') {
    return index < 3 ? `P${index + 1}` : 'OT';
  }
  return String(index + 1);
}

export const BroadsheetView: React.FC<BroadsheetViewProps> = ({
  edition,
  loading,
  regenerating,
  error,
  selectedDate,
  storyMode,
  onDateChange,
  onStoryModeChange,
  onRefresh,
  onRegenerateStory,
  onDownloadHtml,
}) => {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [edition?.lead_image?.url, edition?.edition_date_iso]);

  const showLeadPhoto = Boolean(edition?.lead_image?.url) && !imageFailed;

  return (
    <div className="space-y-6">
      {/* Press Utility Bar (Hidden when printing) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 border-b border-[#DDD6C8] pb-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[#4A453E]">
            <Calendar className="h-4 w-4 text-[#5C574F]" />
            <span className="font-medium whitespace-nowrap">Edition Date</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="rounded-md border border-[#CFC7B8] bg-white px-2.5 py-1.5 text-sm font-tabular text-[#1A1816] focus:border-[#1E3A8A] focus:outline-none"
            />
          </label>

          <div
            className="flex items-center rounded-md border border-[#CFC7B8] bg-[#EFECE4] p-0.5"
            role="group"
            aria-label="Editorial writer mode"
          >
            <button
              type="button"
              onClick={() => onStoryModeChange('auto')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                storyMode === 'auto'
                  ? 'bg-white text-[#1A1816] shadow-xs'
                  : 'text-[#5C574F] hover:text-[#1A1816]'
              }`}
            >
              Gemini Writer
            </button>
            <button
              type="button"
              onClick={() => onStoryModeChange('offline')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                storyMode === 'offline'
                  ? 'bg-white text-[#1A1816] shadow-xs'
                  : 'text-[#5C574F] hover:text-[#1A1816]'
              }`}
            >
              Offline Fallback
            </button>
          </div>

          {edition && (
            <span className="text-xs text-[#5C574F] whitespace-nowrap">
              Scores from {edition.yesterday_display} · Story by{' '}
              {edition.top_story.source === 'gemini' ? 'Gemini 4 Flash' : 'Deterministic Journalist'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onRegenerateStory}
            disabled={loading || regenerating || !edition}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CFC7B8] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#1A1816] transition-colors hover:bg-[#F3EFE7] disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#1E3A8A]" />
            {regenerating ? 'Writing...' : 'Rewrite Top Story'}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CFC7B8] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#1A1816] transition-colors hover:bg-[#F3EFE7] disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Fetching ESPN...' : 'Refresh Scores'}
          </button>

          <button
            type="button"
            onClick={onDownloadHtml}
            disabled={loading || !edition}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#1E3A8A] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#1E3A8A] transition-colors hover:bg-[#1E3A8A]/5 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Download latest.html
          </button>
        </div>
      </div>

      {error && (
        <div className="no-print rounded-md border border-[#991B1B]/30 bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
          Unable to load live sports data: {error}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !edition && (
        <div className="mx-auto max-w-[8.5in] border border-[#D8D2C5] bg-white p-10 shadow-sm">
          <div className="space-y-4 animate-pulse">
            <div className="h-4 w-full bg-[#ECE8DF]" />
            <div className="mx-auto h-10 w-2/3 bg-[#ECE8DF]" />
            <div className="h-px w-full bg-[#111111]" />
            <div className="grid grid-cols-3 gap-6 pt-4">
              <div className="col-span-2 space-y-3">
                <div className="h-6 w-3/4 bg-[#ECE8DF]" />
                <div className="h-28 w-full bg-[#F3EFE7]" />
              </div>
              <div className="h-36 bg-[#F3EFE7]" />
            </div>
            <div className="grid grid-cols-2 gap-4 pt-4">
              <div className="h-32 bg-[#F3EFE7]" />
              <div className="h-32 bg-[#F3EFE7]" />
            </div>
          </div>
        </div>
      )}

      {/* US Letter Grayscale Broadsheet Sheet */}
      {edition && (
        <div className="print-sheet-wrapper mx-auto max-w-[8.5in] border border-[#CFC7B8] bg-white p-[0.4in] text-[#111111] shadow-sm">
          {/* Masthead */}
          <header className="mb-3 text-center">
            <div className="mb-1.5 flex items-center justify-between border-y border-[#111111] py-1 text-[9.5px] font-bold tracking-wider text-[#111111]">
              <span>EDITION NO. {edition.edition_number}</span>
              <span className="hidden sm:inline">{edition.subtitle}</span>
              <span>{edition.edition_date_pretty.toUpperCase()}</span>
            </div>
            <h1 className="font-display text-3xl sm:text-[36px] font-black tracking-wide text-[#111111] leading-none py-1">
              {edition.title}
            </h1>
            <div className="mt-1.5 h-[3px] border-t-[2.5px] border-b border-[#111111]" />
          </header>

          {/* Top Row: Lead Story + Fact of the Day */}
          <section className="mb-3.5 grid grid-cols-1 gap-4 border-b-[1.5px] border-[#111111] pb-3 md:grid-cols-3">
            <article className="broadsheet-card md:col-span-2">
              <div className="mb-1 text-[10px] font-extrabold tracking-widest text-[#333333]">
                {edition.top_story.kicker}
              </div>
              <h2 className="font-display mb-1.5 text-[21px] font-bold leading-tight text-[#111111] text-balance">
                {edition.top_story.headline}
              </h2>
              <p className="font-editorial text-[13px] leading-[1.45] text-[#111111] first-letter:float-left first-letter:mr-2 first-letter:font-display first-letter:text-4xl first-letter:font-bold first-letter:leading-none">
                {edition.top_story.body}
              </p>
            </article>

            {showLeadPhoto && edition.lead_image ? (
              <figure className="broadsheet-card flex flex-col justify-between border-[1.5px] border-[#111111] bg-[#FAFAFA] p-1.5">
                <img
                  src={`/api/media?url=${encodeURIComponent(edition.lead_image.url)}`}
                  alt={edition.lead_image.caption || edition.top_story.headline}
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  className="aspect-[16/10] w-full border border-[#CCCCCC] object-cover grayscale contrast-110"
                />
                {(edition.lead_image.caption || edition.lead_image.credit) && (
                  <figcaption className="mt-1.5 font-editorial text-[10.5px] leading-snug text-[#222222]">
                    {edition.lead_image.caption}
                    {edition.lead_image.credit && (
                      <span className="ml-1 font-sans text-[9.5px] text-[#555555]">
                        ({edition.lead_image.credit})
                      </span>
                    )}
                  </figcaption>
                )}
              </figure>
            ) : (
              <aside className="broadsheet-card flex flex-col justify-center border-2 border-[#111111] bg-[#F4F4F4] p-3">
                <div className="mb-1.5 bg-[#111111] px-2 py-1 text-center text-[10px] font-extrabold tracking-widest text-white">
                  SPORTS FACT OF THE DAY
                </div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#333333]">
                  {edition.fact_of_day.category}
                </div>
                <p className="font-editorial text-[12px] leading-[1.4] text-[#111111]">
                  {edition.fact_of_day.fact}
                </p>
              </aside>
            )}
          </section>

          {/* Middle Row: Your Teams (Priority 1) */}
          <section className="mb-3.5">
            <div className="mb-2 flex items-baseline justify-between border-b-2 border-[#111111] pb-0.5">
              <h3 className="text-[12.5px] font-extrabold tracking-wider text-[#111111]">
                YOUR TEAMS — YESTERDAY&apos;S BOX SCORES
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#333333]">
                {edition.yesterday_display}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {edition.favorite_items.map((item) => {
                const g = item.game;
                if (!g) {
                  return (
                    <div
                      key={`${item.team_config.league}-${item.team_config.espn_team_id}`}
                      className="broadsheet-card border border-dashed border-[#111111] bg-[#FAFAFA] p-2.5"
                    >
                      <div className="mb-1.5 flex items-center justify-between text-[10px]">
                        <span className="bg-[#111111] px-1.5 py-0.5 font-extrabold tracking-wider text-white">
                          {item.upcoming.league_label}
                        </span>
                        <span className="font-bold uppercase text-[#333333]">NO GAME YESTERDAY</span>
                      </div>
                      <div className="font-display text-[15px] font-bold text-[#111111]">
                        {item.team_config.name}
                      </div>
                      {item.upcoming.record && (
                        <div className="mb-1 text-[11px] text-[#444444]">
                          Season Record: {item.upcoming.record}
                        </div>
                      )}
                      <div className="text-[11px] text-[#111111]">
                        {item.upcoming.status_type === 'offseason' ? (
                          <>
                            <strong>Status:</strong> {item.upcoming.matchup}
                          </>
                        ) : (
                          <>
                            <strong>Next Up:</strong> {item.upcoming.matchup} —{' '}
                            {item.upcoming.time_display}
                          </>
                        )}
                      </div>
                    </div>
                  );
                }

                const maxCols = Math.max(g.away.linescores.length, g.home.linescores.length);
                const favBox = g.home.team_id === g.favorite_team_id ? g.home : g.away;
                const oppBox = favBox === g.home ? g.away : g.home;

                return (
                  <div
                    key={g.event_id}
                    className="broadsheet-card border border-[#111111] bg-white p-2.5"
                  >
                    <div className="mb-1.5 flex items-center justify-between text-[10px]">
                      <span className="bg-[#111111] px-1.5 py-0.5 font-extrabold tracking-wider text-white">
                        {g.league_label}
                      </span>
                      <span className="font-bold uppercase text-[#111111]">{g.status_detail}</span>
                    </div>

                    <table className="mb-1.5 w-full border-collapse font-tabular text-[11px]">
                      <thead>
                        <tr className="border-b-[1.5px] border-[#111111] text-[9.5px] text-[#444444]">
                          <th className="py-0.5 text-left font-bold">TEAM</th>
                          {Array.from({ length: maxCols }).map((_, idx) => (
                            <th key={idx} className="px-1 py-0.5 text-center font-semibold">
                              {getPeriodLabel(g, idx)}
                            </th>
                          ))}
                          <th className="border-l border-[#111111] bg-[#F4F4F4] px-1.5 py-0.5 text-center font-extrabold text-[#111111]">
                            F
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          className={`border-b border-[#D4D4D4] ${
                            g.away.winner ? 'font-extrabold' : ''
                          }`}
                        >
                          <td className="py-0.5 pr-1 text-left whitespace-nowrap">
                            <span>{g.away.abbreviation}</span>{' '}
                            {g.away.record && (
                              <span className="text-[9.5px] font-normal text-[#444444]">
                                ({g.away.record})
                              </span>
                            )}
                          </td>
                          {Array.from({ length: maxCols }).map((_, idx) => (
                            <td key={idx} className="px-1 py-0.5 text-center">
                              {idx < g.away.linescores.length ? g.away.linescores[idx] : '-'}
                            </td>
                          ))}
                          <td className="border-l border-[#111111] bg-[#F4F4F4] px-1.5 py-0.5 text-center font-extrabold">
                            {g.away.score}
                          </td>
                        </tr>
                        <tr
                          className={`border-b border-[#D4D4D4] ${
                            g.home.winner ? 'font-extrabold' : ''
                          }`}
                        >
                          <td className="py-0.5 pr-1 text-left whitespace-nowrap">
                            <span>{g.home.abbreviation}</span>{' '}
                            {g.home.record && (
                              <span className="text-[9.5px] font-normal text-[#444444]">
                                ({g.home.record})
                              </span>
                            )}
                          </td>
                          {Array.from({ length: maxCols }).map((_, idx) => (
                            <td key={idx} className="px-1 py-0.5 text-center">
                              {idx < g.home.linescores.length ? g.home.linescores[idx] : '-'}
                            </td>
                          ))}
                          <td className="border-l border-[#111111] bg-[#F4F4F4] px-1.5 py-0.5 text-center font-extrabold">
                            {g.home.score}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <div className="border-t border-[#CCCCCC] pt-1 text-[10.5px] leading-snug">
                      {favBox.leaders.length > 0 && (
                        <div>
                          <div className="text-[9.5px] font-extrabold tracking-wide text-[#111111]">
                            {favBox.abbreviation} LEADERS:
                          </div>
                          {favBox.leaders.slice(0, 3).map((line, i) => (
                            <div key={i} className="truncate">
                              {line}
                            </div>
                          ))}
                        </div>
                      )}
                      {oppBox.leaders.length > 0 && (
                        <div className="mt-0.5 truncate text-[#333333]">
                          <strong>{oppBox.abbreviation}:</strong> {oppBox.leaders[0]}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Bottom Row: Around the World of Sports */}
          <section className="mb-3">
            <div className="mb-2 flex items-baseline justify-between border-b-2 border-[#111111] pb-0.5">
              <h3 className="text-[12.5px] font-extrabold tracking-wider text-[#111111]">
                AROUND THE WORLD OF SPORTS
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#333333]">
                CLOSE FINISHES &amp; BIG PERFORMANCES
              </span>
            </div>

            {(() => {
              const items: HighlightItem[] = edition.highlights?.length
                ? edition.highlights
                : edition.interesting_games.map(
                    (g): HighlightItem => ({
                      kind: 'game',
                      league_label: g.league_label,
                      status_detail: g.status_detail,
                      game: g,
                    })
                  );

              if (!items.length) {
                return (
                  <p className="font-editorial text-xs italic text-[#444444]">
                    Quiet slate across the major leagues yesterday—check back tomorrow for more scores!
                  </p>
                );
              }

              return (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {items.map((h, idx) => {
                    if (h.kind === 'game' && h.game) {
                      const g = h.game;
                      const note = g.milestones.length
                        ? `★ ${g.milestones[0]}`
                        : g.home.winner && g.home.leaders.length
                          ? g.home.leaders[0]
                          : g.away.leaders.length
                            ? g.away.leaders[0]
                            : '';

                      return (
                        <div
                          key={g.event_id}
                          className="broadsheet-card border border-[#222222] bg-white p-2"
                        >
                          <div className="mb-1 flex items-center justify-between border-b border-[#E0E0E0] pb-0.5 text-[9.5px]">
                            <span className="font-extrabold uppercase">{g.league_label}</span>
                            <span className="font-semibold text-[#333333]">{g.status_detail}</span>
                          </div>
                          <div className="mb-1 space-y-0.5 font-tabular text-[11.5px]">
                            <div
                              className={`flex items-center justify-between ${
                                g.away.winner ? 'font-extrabold' : ''
                              }`}
                            >
                              <span className="truncate pr-2">
                                {g.away.short_name}{' '}
                                {g.away.record && (
                                  <span className="text-[9.5px] font-normal text-[#444444]">
                                    ({g.away.record})
                                  </span>
                                )}
                              </span>
                              <span>{g.away.score}</span>
                            </div>
                            <div
                              className={`flex items-center justify-between ${
                                g.home.winner ? 'font-extrabold' : ''
                              }`}
                            >
                              <span className="truncate pr-2">
                                {g.home.short_name}{' '}
                                {g.home.record && (
                                  <span className="text-[9.5px] font-normal text-[#444444]">
                                    ({g.home.record})
                                  </span>
                                )}
                              </span>
                              <span>{g.home.score}</span>
                            </div>
                          </div>
                          {note && (
                            <div className="border-t border-dotted border-[#BBBBBB] pt-1 text-[10px] leading-tight text-[#222222]">
                              {note}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`rss-${h.league_label}-${idx}`}
                        className="broadsheet-card border border-[#222222] bg-white p-2"
                      >
                        <div className="mb-1 flex items-center justify-between border-b border-[#E0E0E0] pb-0.5 text-[9.5px]">
                          <span className="font-extrabold uppercase">{h.league_label}</span>
                          <span className="font-semibold text-[#333333]">{h.status_detail}</span>
                        </div>
                        <div className="font-editorial mb-1 text-[11px] font-bold leading-snug text-[#111111]">
                          {h.title}
                        </div>
                        {h.summary && (
                          <div className="border-t border-dotted border-[#BBBBBB] pt-1 text-[10px] leading-tight text-[#222222]">
                            {h.summary}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </section>

          {/* Upcoming Schedule Strip */}
          <section className="broadsheet-card mb-2 border-[1.5px] border-[#111111] bg-[#F5F5F5] px-3 py-2">
            <div className="mb-1.5 border-b border-[#BBBBBB] pb-0.5 text-[10.5px] font-extrabold tracking-wider text-[#111111]">
              UPCOMING ON THE SCHEDULE — YOUR TEAMS
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-[10.5px]">
              {edition.favorite_items.map((item) => (
                <div key={`${item.team_config.league}-${item.team_config.espn_team_id}`}>
                  <div className="font-extrabold text-[#111111]">
                    {item.upcoming.short_name} ({item.upcoming.league_label})
                  </div>
                  <div className="text-[#222222]">
                    {item.upcoming.status_type === 'today' ? (
                      <>
                        <strong>TODAY:</strong> {item.upcoming.matchup} · {item.upcoming.time_display}
                      </>
                    ) : item.upcoming.status_type === 'upcoming' ? (
                      <>
                        {item.upcoming.matchup} · {item.upcoming.time_display}
                      </>
                    ) : (
                      'Off-Season'
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

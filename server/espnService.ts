import type {
  BriefConfig,
  FavoriteSectionItem,
  FavoriteTeamConfig,
  GameRecord,
  HighlightFeedConfig,
  HighlightItem,
  TeamBox,
  UpcomingEvent,
} from '../src/types.ts';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

function safeInt(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeFloat(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function isOvertime(game: Pick<GameRecord, 'sport' | 'period' | 'status_detail'>): boolean {
  const detail = (game.status_detail || '').toUpperCase();
  if (detail.includes('OT') || detail.includes('SO') || detail.includes('PK')) return true;
  if (game.sport === 'basketball' && game.period > 4) return true;
  if (game.sport === 'baseball' && game.period > 9) return true;
  if (game.sport === 'hockey' && game.period > 3) return true;
  if (game.sport === 'football' && game.period > 4) return true;
  return false;
}

async function fetchJson(url: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MorningSportsBrief/1.0',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

function parseCompetitor(compData: any, isHome: boolean): TeamBox {
  const team = compData?.team || {};
  const records = Array.isArray(compData?.records) ? compData.records : [];
  const recordStr = records[0]?.summary || '';

  const rawLines = Array.isArray(compData?.linescores) ? compData.linescores : [];
  const linescores: string[] = rawLines.map((ls: any) =>
    ls?.displayValue != null ? String(ls.displayValue) : String(safeInt(ls?.value, 0))
  );

  const leaders: string[] = [];
  const rawLeaders = Array.isArray(compData?.leaders) ? compData.leaders : [];
  for (const cat of rawLeaders.slice(0, 3)) {
    const catAbbr = cat?.shortDisplayName || cat?.abbreviation || '';
    const top = cat?.leaders?.[0];
    if (top) {
      const name = top?.athlete?.shortName || top?.athlete?.displayName || '';
      const disp = top?.displayValue || '';
      if (name && disp) {
        leaders.push(`${name}: ${disp} ${catAbbr}`.trim());
      }
    }
  }

  return {
    team_id: String(team.id || ''),
    name: team.displayName || team.name || 'Team',
    short_name: team.shortDisplayName || team.name || 'Team',
    abbreviation: team.abbreviation || 'TM',
    score: safeInt(compData?.score, 0),
    is_home: isHome,
    winner: Boolean(compData?.winner),
    record: recordStr,
    linescores,
    leaders,
  };
}

function extractSoccerDetails(comp: any, game: GameRecord): void {
  const details = Array.isArray(comp?.details) ? comp.details : [];
  const homeGoals: string[] = [];
  const awayGoals: string[] = [];
  const scorerCounts: Record<string, number> = {};

  for (const d of details) {
    if (!d?.scoringPlay) continue;
    const clock = d?.clock?.displayValue || '';
    const teamId = String(d?.team?.id || '');
    const athletes = Array.isArray(d?.athletesInvolved) ? d.athletesInvolved : [];
    const scorer = athletes[0]?.shortName || athletes[0]?.displayName || 'Goal';
    if (scorer) {
      scorerCounts[scorer] = (scorerCounts[scorer] || 0) + 1;
    }
    const entry = `${scorer} (${clock})`.trim();
    if (teamId === game.home.team_id) homeGoals.push(entry);
    else if (teamId === game.away.team_id) awayGoals.push(entry);
  }

  if (homeGoals.length > 0) game.home.leaders = homeGoals.slice(0, 4);
  if (awayGoals.length > 0) game.away.leaders = awayGoals.slice(0, 4);

  for (const [scorer, cnt] of Object.entries(scorerCounts)) {
    if (cnt >= 2) game.milestones.push(`${scorer} scored ${cnt} goals`);
  }
}

function parseEvent(
  event: any,
  sport: string,
  league: string,
  leagueLabel: string
): GameRecord | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  if (competitors.length < 2) return null;

  const statusObj = comp.status || {};
  const statusType = statusObj.type || {};
  const state = statusType.state || 'pre';
  const completed = Boolean(statusType.completed || state === 'post');
  const detail = statusType.shortDetail || statusType.detail || '';
  const period = safeInt(statusObj.period, 0);

  const homeRaw = competitors.find((c: any) => c.homeAway === 'home') || competitors[0];
  const awayRaw = competitors.find((c: any) => c.homeAway === 'away') || competitors[1];

  const homeBox = parseCompetitor(homeRaw, true);
  const awayBox = parseCompetitor(awayRaw, false);

  const headlines = Array.isArray(comp.headlines) ? comp.headlines : [];
  const headline = headlines[0]?.shortLinkText || headlines[0]?.description || '';
  const summaryText = headlines[0]?.description || '';

  const game: GameRecord = {
    event_id: String(event.id || ''),
    sport,
    league,
    league_label: leagueLabel,
    start_time_utc: event.date || '',
    status_state: state,
    status_detail: detail,
    completed,
    period,
    away: awayBox,
    home: homeBox,
    headline,
    summary_text: summaryText,
    milestones: [],
    venue: comp?.venue?.fullName || '',
    is_favorite_game: false,
    favorite_team_id: null,
    has_box_details: false,
  };

  if (sport === 'soccer') {
    extractSoccerDetails(comp, game);
  }
  return game;
}

function extractBasketballLines(statGroup: any): { lines: string[]; milestones: string[] } {
  const rawCols: string[] = (statGroup?.labels?.length ? statGroup.labels : statGroup?.keys) || [];
  const cols = rawCols.map((c) => String(c).toUpperCase());
  const idxPts = cols.indexOf('PTS');
  const idxReb = cols.indexOf('REB');
  const idxAst = cols.indexOf('AST');

  const scored: Array<{ score: number; line: string }> = [];
  const milestones: string[] = [];

  for (const row of statGroup?.athletes || []) {
    if (row?.didNotPlay) continue;
    const stats: string[] = row?.stats || [];
    if (idxPts < 0 || idxPts >= stats.length) continue;

    const name = row?.athlete?.shortName || row?.athlete?.displayName || '';
    const pts = safeInt(stats[idxPts]);
    const reb = idxReb >= 0 && idxReb < stats.length ? safeInt(stats[idxReb]) : 0;
    const ast = idxAst >= 0 && idxAst < stats.length ? safeInt(stats[idxAst]) : 0;

    if (pts >= 40) milestones.push(`${name} exploded for ${pts} PTS`);
    else if (pts >= 30) milestones.push(`${name} scored ${pts} PTS`);

    const dblCats = [pts, reb, ast].filter((v) => v >= 10).length;
    if (dblCats >= 3) {
      milestones.push(`${name} recorded a triple-double (${pts}P/${reb}R/${ast}A)`);
    }

    const parts = [`${pts} PTS`];
    if (reb > 0) parts.push(`${reb} REB`);
    if (ast > 0) parts.push(`${ast} AST`);
    scored.push({ score: pts * 2 + reb + ast, line: `${name}: ${parts.join(', ')}` });
  }

  scored.sort((a, b) => b.score - a.score);
  return { lines: scored.slice(0, 3).map((s) => s.line), milestones };
}

function extractBaseballLines(statGroups: any[]): { lines: string[]; milestones: string[] } {
  const batters: Array<{ score: number; line: string }> = [];
  const pitchers: Array<{ score: number; line: string }> = [];
  const milestones: string[] = [];

  for (const grp of statGroups) {
    const grpName = String(grp?.type || grp?.name || '').toLowerCase();
    const rawCols: string[] = grp?.labels || grp?.names || [];
    const cols = rawCols.map((c) => String(c).toUpperCase());

    if (grpName.includes('batting') || cols.includes('H')) {
      const idxHab = cols.indexOf('H-AB');
      const idxAb = cols.indexOf('AB');
      const idxH = cols.indexOf('H');
      const idxHr = cols.indexOf('HR');
      const idxRbi = cols.indexOf('RBI');

      for (const row of grp?.athletes || []) {
        const stats: string[] = row?.stats || [];
        if (!stats.length) continue;
        const name = row?.athlete?.shortName || '';
        const hits = idxH >= 0 && idxH < stats.length ? safeInt(stats[idxH]) : 0;
        const ab = idxAb >= 0 && idxAb < stats.length ? safeInt(stats[idxAb]) : 0;
        const hr = idxHr >= 0 && idxHr < stats.length ? safeInt(stats[idxHr]) : 0;
        const rbi = idxRbi >= 0 && idxRbi < stats.length ? safeInt(stats[idxRbi]) : 0;

        if (hr >= 2) milestones.push(`${name} hit ${hr} home runs`);
        if (rbi >= 4) milestones.push(`${name} drove in ${rbi} RBI`);

        const hab = idxHab >= 0 && idxHab < stats.length ? stats[idxHab] : `${hits}-${ab}`;
        const extras: string[] = [];
        if (hr > 0) extras.push(hr > 1 ? `${hr} HR` : 'HR');
        if (rbi > 0) extras.push(`${rbi} RBI`);

        const score = hits * 2 + hr * 5 + rbi * 2;
        if (score > 0) {
          const detail = extras.length ? `${hab}, ${extras.join(', ')}` : hab;
          batters.push({ score, line: `${name}: ${detail}` });
        }
      }
    } else if (grpName.includes('pitching') || cols.includes('IP')) {
      const idxIp = cols.indexOf('IP');
      const idxEr = cols.indexOf('ER');
      const idxK = cols.includes('K') ? cols.indexOf('K') : cols.indexOf('SO');

      for (const row of grp?.athletes || []) {
        const stats: string[] = row?.stats || [];
        if (idxIp < 0 || idxIp >= stats.length) continue;
        const name = row?.athlete?.shortName || '';
        const ipStr = stats[idxIp];
        const ipVal = safeFloat(ipStr);
        const er = idxEr >= 0 && idxEr < stats.length ? safeInt(stats[idxEr]) : 0;
        const ks = idxK >= 0 && idxK < stats.length ? safeInt(stats[idxK]) : 0;

        if (ks >= 10) milestones.push(`${name} struck out ${ks} batters`);
        const score = Math.trunc(ipVal * 3) + ks - er * 2;
        if (ipVal >= 4.0) {
          pitchers.push({ score, line: `${name}: ${ipStr} IP, ${er} ER, ${ks} K` });
        }
      }
    }
  }

  batters.sort((a, b) => b.score - a.score);
  pitchers.sort((a, b) => b.score - a.score);
  const combined = [...batters.slice(0, 2), ...pitchers.slice(0, 1)].slice(0, 3).map((x) => x.line);
  return { lines: combined, milestones };
}

function extractHockeyLines(statGroups: any[]): { lines: string[]; milestones: string[] } {
  const skaters: Array<{ score: number; line: string }> = [];
  const goalies: Array<{ score: number; line: string }> = [];
  const milestones: string[] = [];

  for (const grp of statGroups) {
    const rawCols: string[] = grp?.labels || grp?.names || [];
    const cols = rawCols.map((c) => String(c).toUpperCase());

    if (cols.includes('G') && cols.includes('A')) {
      const idxG = cols.indexOf('G');
      const idxA = cols.indexOf('A');
      for (const row of grp?.athletes || []) {
        const stats: string[] = row?.stats || [];
        if (stats.length <= Math.max(idxG, idxA)) continue;
        const name = row?.athlete?.shortName || '';
        const g = safeInt(stats[idxG]);
        const a = safeInt(stats[idxA]);
        const pts = g + a;
        if (g >= 3) milestones.push(`${name} scored a hat trick (${g} G)`);
        else if (pts >= 3) milestones.push(`${name} tallied ${pts} points (${g} G, ${a} A)`);
        if (pts > 0) skaters.push({ score: pts * 3 + g, line: `${name}: ${g} G, ${a} A` });
      }
    } else if (cols.includes('SV')) {
      const idxSv = cols.indexOf('SV');
      const idxGa = cols.indexOf('GA');
      for (const row of grp?.athletes || []) {
        const stats: string[] = row?.stats || [];
        if (stats.length <= idxSv) continue;
        const name = row?.athlete?.shortName || '';
        const sv = safeInt(stats[idxSv]);
        const ga = idxGa >= 0 && idxGa < stats.length ? safeInt(stats[idxGa]) : 0;
        if (sv >= 30 && ga === 0) milestones.push(`${name} posted a ${sv}-save shutout`);
        if (sv > 0) goalies.push({ score: sv, line: `${name}: ${sv} SV, ${ga} GA` });
      }
    }
  }

  skaters.sort((a, b) => b.score - a.score);
  goalies.sort((a, b) => b.score - a.score);
  const combined = [...skaters.slice(0, 2), ...goalies.slice(0, 1)].slice(0, 3).map((x) => x.line);
  return { lines: combined, milestones };
}

function extractFootballLines(statGroups: any[]): { lines: string[]; milestones: string[] } {
  const lines: Array<{ score: number; line: string }> = [];
  const milestones: string[] = [];

  for (const grp of statGroups) {
    const grpName = String(grp?.name || '').toLowerCase();
    if (!['passing', 'rushing', 'receiving'].includes(grpName)) continue;

    const rawCols: string[] = grp?.labels || grp?.names || [];
    const cols = rawCols.map((c) => String(c).toUpperCase());
    const idxYds = cols.indexOf('YDS');
    const idxTd = cols.indexOf('TD');
    const idxRec = cols.indexOf('REC');

    const top = grp?.athletes?.[0];
    const stats: string[] = top?.stats || [];
    if (!top || idxYds < 0 || stats.length <= idxYds) continue;

    const name = top?.athlete?.shortName || '';
    const yds = safeInt(stats[idxYds]);
    const td = idxTd >= 0 && idxTd < stats.length ? safeInt(stats[idxTd]) : 0;

    if (grpName === 'passing') {
      if (yds >= 350 || td >= 3) milestones.push(`${name} threw for ${yds} YDS and ${td} TD`);
      lines.push({ score: yds + td * 40, line: `${name}: ${yds} PASS YDS, ${td} TD` });
    } else if (grpName === 'rushing') {
      if (yds >= 150 || td >= 2) milestones.push(`${name} rushed for ${yds} YDS, ${td} TD`);
      lines.push({ score: yds * 2 + td * 40, line: `${name}: ${yds} RUSH YDS, ${td} TD` });
    } else if (grpName === 'receiving') {
      const rec = idxRec >= 0 && idxRec < stats.length ? safeInt(stats[idxRec]) : 0;
      if (yds >= 150 || td >= 2) milestones.push(`${name} caught ${rec} passes for ${yds} YDS`);
      lines.push({ score: yds * 2 + td * 40, line: `${name}: ${rec} REC, ${yds} YDS, ${td} TD` });
    }
  }

  lines.sort((a, b) => b.score - a.score);
  return { lines: lines.slice(0, 3).map((x) => x.line), milestones };
}

export async function fetchScoreboard(
  sport: string,
  league: string,
  leagueLabel: string,
  yyyymmdd: string,
  timeoutMs = 10000
): Promise<GameRecord[]> {
  const url = `${ESPN_BASE}/${sport}/${league}/scoreboard?dates=${yyyymmdd}`;
  const data = await fetchJson(url, timeoutMs);
  const events = Array.isArray(data?.events) ? data.events : [];
  const games: GameRecord[] = [];

  for (const ev of events) {
    const parsed = parseEvent(ev, sport, league, leagueLabel);
    if (parsed) games.push(parsed);
  }
  return games;
}

export async function enrichGameDetails(game: GameRecord, timeoutMs = 10000): Promise<GameRecord> {
  if (game.has_box_details || !game.event_id) return game;

  const url = `${ESPN_BASE}/${game.sport}/${game.league}/summary?event=${game.event_id}`;
  const data = await fetchJson(url, timeoutMs);
  if (!data || !Object.keys(data).length) return game;

  if (data.article) {
    if (!game.headline) game.headline = data.article.headline || '';
    if (!game.summary_text) game.summary_text = data.article.description || '';

    const images = Array.isArray(data.article.images) ? data.article.images : [];
    if (images.length > 0) {
      const editorialImgs = images.filter(
        (img: any) => img?.url && String(img?.type || '').toLowerCase() !== 'media'
      );
      const chosen = editorialImgs[0] || images[0];
      const imgUrl = String(chosen?.url || '').trim();
      if (imgUrl) {
        game.lead_image = {
          url: imgUrl,
          caption: String(chosen?.caption || game.headline || '').trim(),
          credit: String(chosen?.credit || '').trim(),
        };
      }
    }
  }

  if (!game.lead_image) {
    const videos = Array.isArray(data.videos) ? data.videos : [];
    const thumb = String(videos[0]?.thumbnail || '').trim();
    if (thumb) {
      game.lead_image = {
        url: thumb,
        caption: String(
          videos[0]?.headline || game.headline || `${game.away.short_name} at ${game.home.short_name}`
        ).trim(),
        credit: '',
      };
    }
  }

  const playersSections = data?.boxscore?.players;
  if (Array.isArray(playersSections)) {
    for (const teamSec of playersSections) {
      const tId = String(teamSec?.team?.id || '');
      const targetBox =
        tId === game.home.team_id
          ? game.home
          : tId === game.away.team_id
            ? game.away
            : null;
      if (!targetBox) continue;

      const statistics = Array.isArray(teamSec?.statistics) ? teamSec.statistics : [];
      if (!statistics.length) continue;

      let res: { lines: string[]; milestones: string[] } = { lines: [], milestones: [] };
      if (game.sport === 'basketball') res = extractBasketballLines(statistics[0]);
      else if (game.sport === 'baseball') res = extractBaseballLines(statistics);
      else if (game.sport === 'hockey') res = extractHockeyLines(statistics);
      else if (game.sport === 'football') res = extractFootballLines(statistics);

      if (res.lines.length > 0) targetBox.leaders = res.lines.slice(0, 3);
      game.milestones.push(...res.milestones);
    }
  }

  game.has_box_details = true;
  return game;
}

function formatEtDateParts(date: Date, tzName: string): { yyyymmdd: string; dayPretty: string; timePretty: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tzName,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);

  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const monthShort = new Intl.DateTimeFormat('en-US', {
    timeZone: tzName,
    month: 'short',
  }).format(date);

  const yyyymmdd = `${get('year')}${get('month')}${get('day')}`;
  const dayPretty = `${get('weekday')}, ${monthShort} ${Number(get('day'))}`;
  const timePretty = `${get('hour')}:${get('minute')} ${get('dayPeriod')} ET`;
  return { yyyymmdd, dayPretty, timePretty };
}

export async function fetchTeamNextEvent(
  fav: FavoriteTeamConfig,
  todayYyyymmdd: string,
  tzName: string,
  timeoutMs = 10000
): Promise<UpcomingEvent> {
  const url = `${ESPN_BASE}/${fav.sport}/${fav.league}/teams/${fav.espn_team_id}`;
  const data = await fetchJson(url, timeoutMs);
  const teamObj = data?.team || {};

  const recordStr = teamObj?.record?.items?.[0]?.summary || '';
  const nextEvents = Array.isArray(teamObj?.nextEvent) ? teamObj.nextEvent : [];

  if (nextEvents.length > 0) {
    const ev = nextEvents[0];
    const evDateStr = ev?.date || '';
    const matchup = ev?.shortName || ev?.name || 'Scheduled Game';
    if (evDateStr) {
      const dt = new Date(evDateStr);
      if (!Number.isNaN(dt.getTime())) {
        const { yyyymmdd, dayPretty, timePretty } = formatEtDateParts(dt, tzName);
        if (yyyymmdd === todayYyyymmdd) {
          return {
            team_name: fav.name,
            short_name: fav.short_name || fav.name,
            league_label: fav.league.toUpperCase(),
            status_type: 'today',
            matchup,
            time_display: `Today at ${timePretty}`,
            record: recordStr,
          };
        }
        return {
          team_name: fav.name,
          short_name: fav.short_name || fav.name,
          league_label: fav.league.toUpperCase(),
          status_type: 'upcoming',
          matchup,
          time_display: `${dayPretty} at ${timePretty}`,
          record: recordStr,
        };
      }
    }
  }

  return {
    team_name: fav.name,
    short_name: fav.short_name || fav.name,
    league_label: fav.league.toUpperCase(),
    status_type: 'offseason',
    matchup: 'No games currently scheduled (Off-Season)',
    time_display: 'Check back soon',
    record: recordStr,
  };
}

function parseWinPct(record: string): number {
  if (!record || !record.includes('-')) return 0.5;
  const parts = record.split('-').map((p) => Number(p));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return 0.5;
  const wins = parts[0];
  const losses = parts[1];
  const ties = parts[2] || 0;
  const total = wins + losses + ties;
  return total > 0 ? (wins + 0.5 * ties) / total : 0.5;
}

export function scoreGameExcitement(game: GameRecord): number {
  let score = 10;
  const margin = Math.abs(game.home.score - game.away.score);
  const total = game.home.score + game.away.score;
  const ot = isOvertime(game);

  if (game.sport === 'basketball') {
    if (margin <= 5) score += 35;
    if (margin <= 2) score += 15;
    if (ot) score += 30;
  } else if (game.sport === 'baseball') {
    if (margin <= 1) score += 35;
    if (ot) score += 30;
    if (game.home.score === 0 || game.away.score === 0) score += 15;
  } else if (game.sport === 'football') {
    if (margin <= 7) score += 30;
    if (margin <= 3) score += 15;
    if (ot) score += 30;
  } else if (game.sport === 'hockey') {
    if (margin <= 1) score += 30;
    if (ot) score += 25;
    if (game.home.score === 0 || game.away.score === 0) score += 15;
  } else if (game.sport === 'soccer') {
    if (margin <= 1) score += 25;
    if (total >= 4) score += 20;
  }

  const homePct = parseWinPct(game.home.record);
  const awayPct = parseWinPct(game.away.record);
  if (homePct >= 0.6 && awayPct >= 0.6) score += 15;
  if ((game.home.winner && homePct + 0.12 < awayPct) || (game.away.winner && awayPct + 0.12 < homePct)) {
    score += 20;
  }

  score += game.milestones.length * 25;
  return score;
}

function matchesFavorite(game: GameRecord, fav: FavoriteTeamConfig): boolean {
  if (game.sport !== fav.sport || game.league !== fav.league) return false;
  const favId = String(fav.espn_team_id || '');
  const favAbbr = (fav.abbreviation || '').toUpperCase();
  return (
    game.home.team_id === favId ||
    game.away.team_id === favId ||
    game.home.abbreviation.toUpperCase() === favAbbr ||
    game.away.abbreviation.toUpperCase() === favAbbr
  );
}

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
    '&rsquo;': '’',
    '&lsquo;': '‘',
    '&rdquo;': '”',
    '&ldquo;': '“',
  };
  return input
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&[a-zA-Z]+;/g, (m) => named[m] ?? m);
}

function cleanRssText(raw: string, maxLen: number): string {
  let text = decodeHtmlEntities(raw || '');
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  text = decodeHtmlEntities(text);
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/The post .*? appeared first on .*?$/i, '');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/\b(odds|spread|moneyline|parlay|over\/under|wager|betting|bettor|sportsbook|vegas)\b/gi, 'matchup');
  if (text.length > maxLen) {
    const cut = text.slice(0, maxLen - 1);
    const spaceIdx = cut.lastIndexOf(' ');
    text = `${spaceIdx > 20 ? cut.slice(0, spaceIdx) : cut}…`;
  }
  return text;
}

function extractXmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1] : '';
}

export async function fetchRssHighlights(
  feed: HighlightFeedConfig,
  referenceDateIso: string,
  tzName = 'America/New_York',
  timeoutMs = 10000
): Promise<Array<HighlightItem & { sort_score: number }>> {
  if (!feed.feed_url) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let xml = '';
  try {
    const res = await fetch(feed.feed_url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MorningSportsBrief/1.0' },
    });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }

  const refDate = new Date(`${referenceDateIso}T12:00:00Z`);
  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8);
  const parsed: Array<HighlightItem & { sort_score: number }> = [];

  for (const m of itemMatches) {
    const block = m[1];
    const title = cleanRssText(extractXmlTag(block, 'title'), 92);
    if (!title) continue;
    const summary = cleanRssText(extractXmlTag(block, 'description'), 118);
    const pubRaw = extractXmlTag(block, 'pubDate').trim();

    let dateDisplay = 'Recent';
    let daysDiff = 3;
    if (pubRaw) {
      const dt = new Date(pubRaw);
      if (!Number.isNaN(dt.getTime())) {
        dateDisplay = new Intl.DateTimeFormat('en-US', {
          timeZone: tzName,
          month: 'short',
          day: 'numeric',
        }).format(dt);
        daysDiff = Math.abs(Math.round((refDate.getTime() - dt.getTime()) / (24 * 60 * 60 * 1000)));
      }
    }

    if (daysDiff > 10) continue;

    parsed.push({
      kind: 'rss',
      league_label: feed.label,
      status_detail: dateDisplay,
      title,
      summary,
      sort_score: Math.max(10, 90 - daysDiff * 15),
    });
  }

  return parsed.sort((a, b) => b.sort_score - a.sort_score);
}

export async function curateEdition(
  config: BriefConfig,
  yesterdayYyyymmdd: string,
  todayYyyymmdd: string
): Promise<{
  favorite_items: FavoriteSectionItem[];
  interesting_games: GameRecord[];
  highlights: HighlightItem[];
  lead_game: GameRecord | null;
}> {
  const tzName = config.newspaper?.timezone || 'America/New_York';
  const timeoutMs = (config.data_provider?.timeout_seconds || 12) * 1000;
  const maxInteresting = config.curation?.max_interesting_games || 6;
  const highlightFeeds = config.highlight_feeds || [];

  const leaguesToFetch = new Map<string, { sport: string; league: string; label: string }>();
  for (const fav of config.favorite_teams) {
    leaguesToFetch.set(`${fav.sport}:${fav.league}`, {
      sport: fav.sport,
      league: fav.league,
      label: fav.league.toUpperCase(),
    });
  }
  for (const sec of config.secondary_leagues) {
    leaguesToFetch.set(`${sec.sport}:${sec.league}`, {
      sport: sec.sport,
      league: sec.league,
      label: sec.label || sec.league.toUpperCase(),
    });
  }

  const todayIso = `${todayYyyymmdd.slice(0, 4)}-${todayYyyymmdd.slice(4, 6)}-${todayYyyymmdd.slice(6, 8)}`;

  const [scoreboardEntries, rssByFeed] = await Promise.all([
    Promise.all(
      Array.from(leaguesToFetch.values()).map((entry) =>
        fetchScoreboard(entry.sport, entry.league, entry.label, yesterdayYyyymmdd, timeoutMs)
      )
    ),
    Promise.all(
      highlightFeeds.map((feed) => fetchRssHighlights(feed, todayIso, tzName, timeoutMs))
    ),
  ]);

  const allCompleted = scoreboardEntries.flat().filter((g) => g.completed);

  const favoriteItems: FavoriteSectionItem[] = [];
  const favoriteEventIds = new Set<string>();
  const favoriteCompleted: GameRecord[] = [];

  await Promise.all(
    config.favorite_teams.map(async (fav, idx) => {
      let matched = allCompleted.find((g) => matchesFavorite(g, fav)) || null;
      if (matched) {
        matched.is_favorite_game = true;
        matched.favorite_team_id = String(fav.espn_team_id);
        matched = await enrichGameDetails(matched, timeoutMs);
        matched.excitement_score = scoreGameExcitement(matched);
        favoriteEventIds.add(matched.event_id);
        favoriteCompleted.push(matched);
      }

      const upcoming = await fetchTeamNextEvent(fav, todayYyyymmdd, tzName, timeoutMs);
      favoriteItems[idx] = {
        team_config: fav,
        game: matched,
        upcoming,
      };
    })
  );

  const otherGames = allCompleted.filter((g) => !favoriteEventIds.has(g.event_id));
  const preScored = [...otherGames].sort((a, b) => scoreGameExcitement(b) - scoreGameExcitement(a));
  const candidates = preScored.slice(0, maxInteresting + 5);

  const enrichedCandidates = await Promise.all(
    candidates.map(async (g) => {
      const enriched = await enrichGameDetails(g, timeoutMs);
      enriched.excitement_score = scoreGameExcitement(enriched);
      return enriched;
    })
  );

  const finalRanked = enrichedCandidates.sort(
    (a, b) => (b.excitement_score || 0) - (a.excitement_score || 0)
  );

  // Reserve 1 highlight slot per configured individual-sport RSS feed, fill remaining slots with team games
  const selectedRss: HighlightItem[] = [];
  const overflowRss: HighlightItem[] = [];
  for (const items of rssByFeed) {
    if (items.length > 0) {
      const { sort_score: _s, ...first } = items[0];
      selectedRss.push(first);
      for (const extra of items.slice(1, 3)) {
        const { sort_score: _es, ...rest } = extra;
        overflowRss.push(rest);
      }
    }
  }

  const gameSlotsTarget = Math.max(0, maxInteresting - selectedRss.length);
  const selectedGames: GameRecord[] = [];
  const leagueCounts: Record<string, number> = {};
  for (const g of finalRanked) {
    if (selectedGames.length >= gameSlotsTarget) break;
    const cnt = leagueCounts[g.league_label] || 0;
    if (cnt < 2 || finalRanked.length <= gameSlotsTarget) {
      selectedGames.push(g);
      leagueCounts[g.league_label] = cnt + 1;
    }
  }

  if (selectedGames.length < gameSlotsTarget) {
    const chosenIds = new Set(selectedGames.map((g) => g.event_id));
    for (const g of finalRanked) {
      if (selectedGames.length >= gameSlotsTarget) break;
      if (!chosenIds.has(g.event_id)) selectedGames.push(g);
    }
  }

  const highlights: HighlightItem[] = [
    ...selectedGames.map(
      (g): HighlightItem => ({
        kind: 'game',
        league_label: g.league_label,
        status_detail: g.status_detail,
        game: g,
      })
    ),
    ...selectedRss,
  ];

  // Top up to maxInteresting with overflow RSS highlights on quiet team-sport days
  for (const extra of overflowRss) {
    if (highlights.length >= maxInteresting) break;
    highlights.push(extra);
  }

  let leadGame: GameRecord | null = null;
  if (favoriteCompleted.length > 0) {
    leadGame = favoriteCompleted.reduce((best, cur) =>
      (cur.excitement_score || 0) > (best.excitement_score || 0) ? cur : best
    );
  } else if (selectedGames.length > 0) {
    leadGame = selectedGames[0];
  } else if (finalRanked.length > 0) {
    leadGame = finalRanked[0];
  }

  return {
    favorite_items: favoriteItems,
    interesting_games: selectedGames,
    highlights: highlights.slice(0, maxInteresting),
    lead_game: leadGame,
  };
}

export async function fetchLeagueTeams(
  sport: string,
  league: string
): Promise<FavoriteTeamConfig[]> {
  const url = `${ESPN_BASE}/${sport}/${league}/teams?limit=60`;
  const data = await fetchJson(url, 10000);
  const teamsRaw = data?.sports?.[0]?.leagues?.[0]?.teams || [];

  return teamsRaw
    .map((entry: any) => {
      const t = entry?.team || entry;
      if (!t?.id) return null;
      return {
        name: t.displayName || t.name,
        short_name: t.shortDisplayName || t.name || t.displayName,
        sport,
        league,
        espn_team_id: String(t.id),
        abbreviation: t.abbreviation || '',
      } as FavoriteTeamConfig;
    })
    .filter(Boolean);
}

import { GoogleGenAI } from '@google/genai';
import type { BriefConfig, GameRecord, TopStory } from '../src/types.ts';

const BANNED_TERMS = /\b(odds|spread|moneyline|parlay|over\/under|wager|betting|bettor|sportsbook|vegas)\b/gi;

function cleanBettingLanguage(text: string): string {
  return text.replace(BANNED_TERMS, 'matchup').trim();
}

function isOvertime(game: GameRecord): boolean {
  const d = (game.status_detail || '').toUpperCase();
  if (d.includes('OT') || d.includes('SO') || d.includes('PK')) return true;
  if (game.sport === 'basketball' && game.period > 4) return true;
  if (game.sport === 'baseball' && game.period > 9) return true;
  if (game.sport === 'hockey' && game.period > 3) return true;
  if (game.sport === 'football' && game.period > 4) return true;
  return false;
}

function buildGameContext(game: GameRecord): string {
  const winner = game.home.score >= game.away.score ? game.home : game.away;
  const loser = winner === game.home ? game.away : game.home;
  const leaders = [...winner.leaders.slice(0, 2), ...loser.leaders.slice(0, 1)];
  const milestones = game.milestones.length ? game.milestones.join('; ') : 'None noted';

  return [
    `League: ${game.league_label}`,
    `Matchup: ${game.away.name} (${game.away.record || 'N/A'}) at ${game.home.name} (${game.home.record || 'N/A'})`,
    `Final Score: ${winner.name} ${winner.score}, ${loser.name} ${loser.score} (${game.status_detail})`,
    `Top Performers: ${leaders.length ? leaders.join('; ') : 'Team effort'}`,
    `Milestones: ${milestones}`,
    `Headline Hint: ${game.headline || 'Exciting finish'}`,
    `Recap Snippet: ${game.summary_text || 'N/A'}`,
  ].join('\n');
}

function parseHeadlineAndBody(rawText: string): { headline: string; body: string } | null {
  const cleaned = cleanBettingLanguage(rawText);
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  let headline = "Big Win Highlights Yesterday's Action";
  const bodyLines: string[] = [];

  lines.forEach((line, idx) => {
    if (idx === 0 && line.toUpperCase().startsWith('HEADLINE:')) {
      headline = line.split(':').slice(1).join(':').trim().replace(/^"|"$/g, '');
    } else if (line.toUpperCase().startsWith('STORY:')) {
      const rest = line.split(':').slice(1).join(':').trim();
      if (rest) bodyLines.push(rest);
    } else {
      bodyLines.push(line);
    }
  });

  const body = bodyLines.join(' ').trim();
  if (body.split(/\s+/).length < 35) return null;
  return { headline, body };
}

export function generateOfflineStory(game: GameRecord | null): TopStory {
  if (!game) {
    return {
      kicker: 'MORNING BRIEFING',
      headline: 'Quiet Night on the Scoreboard — Big Games Ahead!',
      body: 'Our favorite hometown teams took a well-earned breather from the schedule yesterday, giving players time to rest up, practice their fundamentals, and study film for the next big matchup. Across the sports world, teams are gearing up for another exciting stretch of action on courts, fields, and rinks everywhere. Check out the schedule box below to see when your favorite squads return to action, and test your sports smarts with today’s Fact of the Day!',
      source: 'offline',
    };
  }

  const winner = game.home.score >= game.away.score ? game.home : game.away;
  const loser = winner === game.home ? game.away : game.home;
  const locationPhrase = winner.is_home ? 'on their home turf' : 'on the road';
  const margin = Math.abs(game.home.score - game.away.score);

  const headline = game.headline
    ? cleanBettingLanguage(game.headline)
    : `${winner.short_name} Top ${loser.short_name} ${winner.score}-${loser.score} in ${game.league_label} Action`;

  let opener = '';
  if (isOvertime(game)) {
    opener = `Fans got bonus action yesterday as the ${winner.name} outlasted the ${loser.name} ${winner.score}-${loser.score} in a thrilling overtime battle ${locationPhrase}!`;
  } else if (margin <= 2 && ['baseball', 'hockey', 'soccer'].includes(game.sport)) {
    opener = `Every single play mattered yesterday as the ${winner.name} edged past the ${loser.name} ${winner.score}-${loser.score} in a nail-biting ${game.league_label} showdown ${locationPhrase}.`;
  } else if (game.sport === 'basketball' && margin <= 5) {
    opener = `It came right down to the final buzzer as the ${winner.name} held off the ${loser.name} ${winner.score}-${loser.score} in an exciting ${game.league_label} clash ${locationPhrase}.`;
  } else {
    opener = `The ${winner.name} put together a strong team performance yesterday, defeating the ${loser.name} ${winner.score}-${loser.score} ${locationPhrase} in ${game.league_label} play.`;
  }

  let middle = '';
  if (game.milestones.length > 0) {
    middle = `Leading the charge was an unforgettable effort where ${game.milestones[0]}, giving the ${winner.short_name} all the momentum they needed.`;
  } else if (winner.leaders.length > 0) {
    middle = `The ${winner.short_name} got standout contributions across the lineup, led by ${winner.leaders.slice(0, 2).join(' and ')}.`;
  } else {
    middle = `Smart teamwork and sharp defense helped the ${winner.short_name} take control when the game was on the line.`;
  }

  const oppNote = loser.leaders.length
    ? ` Despite the loss, ${loser.leaders[0]} kept the ${loser.short_name} fighting hard.`
    : '';
  const recNote = winner.record
    ? ` With the victory, ${winner.short_name} move to ${winner.record} on the season.`
    : '';
  const closer = `${oppNote}${recNote} Keep an eye on how both clubs build on this performance in their upcoming matchups!`.trim();

  return {
    kicker: `${game.league_label} TOP STORY`,
    headline,
    body: cleanBettingLanguage(`${opener} ${middle} ${closer}`),
    source: 'offline',
  };
}

export async function generateTopStory(
  game: GameRecord | null,
  config: BriefConfig,
  overrideMode?: string
): Promise<TopStory> {
  const mode = (overrideMode || config.editorial?.llm_mode || 'auto').toLowerCase();
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (game && mode !== 'offline' && apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = [
        'Write a kid-friendly newspaper Top Story about the following sports game for a 4th-to-6th grade reader (ages 9-12).',
        'Keep the tone energetic, clear, and joyful. Strictly NO betting, odds, or gambling terms.',
        '',
        'Output exactly two labeled parts:',
        'HEADLINE: <punchy 6-10 word newspaper headline>',
        'STORY: <120-160 word story summarizing the action, key players, and final score>',
        '',
        'Game Data:',
        buildGameContext(game),
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are an enthusiastic youth sports journalist writing a morning newspaper front-page story for 9-to-12-year-old readers. Keep stories accurate to the provided box score data, energetic, and between 120 and 160 words.',
        },
      });

      const parsed = parseHeadlineAndBody(response.text ?? '');
      if (parsed) {
        return {
          kicker: `${game.league_label} TOP STORY`,
          headline: parsed.headline,
          body: parsed.body,
          source: 'gemini',
        };
      }
    } catch (err) {
      console.warn('Gemini story generation fell back to offline mode:', err);
    }
  }

  return generateOfflineStory(game);
}

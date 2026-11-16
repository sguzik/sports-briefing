import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { BriefConfig, GameRecord, HighlightItem, TopStory } from '../src/types.ts';

const BANNED_TERMS = /\b(odds|spread|moneyline|parlay|over\/under|wager|betting|bettor|sportsbook|vegas)\b/gi;

function cleanBettingLanguage(text: string): string {
  return text.replace(BANNED_TERMS, 'matchup').trim();
}

function stripEllipsis(text: string): string {
  return (text || '').replace(/\.\.\./g, '').replace(/…/g, '').trim();
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

  let headline = "Big Win in Yesterday's Game!";
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

  const finalHeadline = stripEllipsis(headline);
  const body = stripEllipsis(bodyLines.join(' '));
  if (body.split(/\s+/).length < 30) return null;
  return { headline: finalHeadline, body };
}

export function generateOfflineStory(game: GameRecord | null): TopStory {
  if (!game) {
    return {
      kicker: 'MORNING BRIEFING',
      headline: 'No Big Games Last Night',
      body: 'Our teams did not play yesterday. The players got to rest and get ready for the next game! There are still lots of fun sports stories to read today. Look at the boxes below to see when our teams play next. You can also check out the cool sports news from around the world!',
      source: 'offline',
    };
  }

  const winner = game.home.score >= game.away.score ? game.home : game.away;
  const loser = winner === game.home ? game.away : game.home;
  const place = winner.is_home ? 'at home' : 'away from home';
  const margin = Math.abs(game.home.score - game.away.score);

  const headline = game.headline
    ? stripEllipsis(cleanBettingLanguage(game.headline))
    : `${winner.short_name} Beat ${loser.short_name} ${winner.score}-${loser.score}!`;

  let opener = '';
  if (isOvertime(game)) {
    opener = `What a fun game! The ${winner.name} beat the ${loser.name} ${winner.score} to ${loser.score} in extra time ${place}.`;
  } else if (
    (margin <= 2 && ['baseball', 'hockey', 'soccer'].includes(game.sport)) ||
    (game.sport === 'basketball' && margin <= 5)
  ) {
    opener = `It was a very close game! The ${winner.name} beat the ${loser.name} ${winner.score} to ${loser.score} ${place}.`;
  } else {
    opener = `The ${winner.name} had a great day! They beat the ${loser.name} ${winner.score} to ${loser.score} ${place}.`;
  }

  let middle = '';
  if (winner.leaders.length > 0) {
    middle = `Big stars for the ${winner.short_name} were ${winner.leaders.slice(0, 2).join(' and ')}. Everyone helped out!`;
  } else if (game.milestones.length > 0) {
    middle = `Big moment in the game: ${game.milestones[0]}. Both teams played hard!`;
  } else {
    middle = `The ${winner.short_name} shared the ball and played strong defense to win.`;
  }

  const oppNote = loser.leaders.length
    ? ` ${loser.leaders[0]} also played hard for the ${loser.short_name}.`
    : '';
  const recNote = winner.record
    ? ` Now the ${winner.short_name} have a ${winner.record} record.`
    : '';
  const closer = `${oppNote}${recNote} Watch for their next game soon!`.trim();

  return {
    kicker: `${game.league_label} TOP STORY`,
    headline,
    body: stripEllipsis(cleanBettingLanguage(`${opener} ${middle} ${closer}`)),
    source: 'offline',
  };
}

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
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
      const ai = createGeminiClient(apiKey);

      const prompt = [
        'Write a happy, easy-to-read newspaper Top Story about this sports game for a 1st or 2nd grade child (ages 6-8).',
        'Rules:',
        '- Use very simple, everyday words (mostly 1-2 syllables).',
        '- Write short, clear sentences (6-12 words per sentence).',
        '- Keep all facts, names, and numbers true to the Game Data.',
        '- Explain sports terms simply if needed, and strictly NO betting, odds, or gambling words.',
        "- Do NOT cut off sentences or use '...' or '…'.",
        '',
        'Output exactly two labeled parts:',
        'HEADLINE: <simple, punchy 4-8 word headline>',
        'STORY: <90-130 word story telling what happened, who starred, and the final score>',
        '',
        'Game Data:',
        buildGameContext(game),
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You are a friendly youth sports writer making a morning paper for 1st and 2nd grade kids (ages 6-8). Use short sentences, simple words, accurate scores/stats, and 90-130 words.',
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

export async function summarizeRssHighlights(
  highlights: HighlightItem[],
  config: BriefConfig,
  overrideMode?: string
): Promise<HighlightItem[]> {
  const rssEntries = highlights
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.kind === 'rss');

  if (rssEntries.length === 0) return highlights;

  const mode = (overrideMode || config.editorial?.llm_mode || 'auto').toLowerCase();
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (mode === 'offline' || !apiKey) {
    return highlights;
  }

  const storiesPayload = rssEntries.map(({ item }, seqIdx) => ({
    id: seqIdx,
    sport: item.league_label,
    headline: item.title || '',
    article: (item.article_text || item.summary || item.title || '').slice(0, 1800),
  }));

  const prompt = [
    'Summarize each sports story below for a 1st or 2nd grade child (ages 6-8) to read in a printed morning newspaper.',
    'Rules for EVERY item:',
    '- Write at a 1st or 2nd grade reading level: short, simple words and short sentences.',
    '- Summarize the whole headline and article clearly so NOTHING is cut off.',
    "- NEVER use '...' or '…' or trail off.",
    '- Keep all names, places, and facts true to the provided article.',
    '- Strictly NO betting, odds, or gambling words.',
    '- id: Copy the exact numeric id from the input story.',
    '- title: A complete, punchy headline (5-9 simple words, under 60 characters).',
    '- summary: 1 to 2 complete short sentences (14-24 words total) ending with a period or exclamation mark.',
    '',
    'Stories:',
    JSON.stringify(storiesPayload),
  ].join('\n');

  const ai = createGeminiClient(apiKey);
  try {
    const geminiCall = ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You summarize sports news for 1st and 2nd grade readers (ages 6-8) into crisp, complete headlines and 1-2 short sentences with zero truncation.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  summary: { type: Type.STRING },
                },
                required: ['id', 'title', 'summary'],
              },
            },
          },
          required: ['items'],
        },
      },
    });

    const timeoutGuard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini RSS summarization timed out')), 25000)
    );
    const response = await Promise.race([geminiCall, timeoutGuard]);

    const parsed = JSON.parse(response.text || '{}') as {
      items?: Array<{ id?: number; title?: string; summary?: string }>;
    };
    const entries = parsed.items || [];
    if (entries.length === 0) return highlights;

    const byId = new Map<number, { title?: string; summary?: string }>();
    entries.forEach((entry, pos) => {
      const key = typeof entry.id === 'number' ? entry.id : pos;
      byId.set(key, entry);
    });

    const seqByHighlightIndex = new Map<number, number>();
    rssEntries.forEach(({ index }, seqIdx) => {
      seqByHighlightIndex.set(index, seqIdx);
    });

    return highlights.map((item, idx) => {
      if (item.kind !== 'rss') return item;
      const seqIdx = seqByHighlightIndex.get(idx);
      const rewritten =
        (seqIdx !== undefined ? byId.get(seqIdx) : undefined) ||
        (seqIdx !== undefined ? entries[seqIdx] : undefined);
      if (!rewritten) return item;

      const cleanTitle = stripEllipsis(cleanBettingLanguage(rewritten.title || ''));
      let cleanSummary = stripEllipsis(cleanBettingLanguage(rewritten.summary || ''));
      if (cleanSummary && !/[.!?]$/.test(cleanSummary)) {
        cleanSummary += '.';
      }

      return {
        ...item,
        title: cleanTitle || item.title,
        summary: cleanSummary || item.summary,
      };
    });
  } catch (err) {
    console.warn('Gemini RSS summarization fell back to clean sentence excerpts:', err);
  }

  return highlights;
}

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import { curateEdition, fetchLeagueTeams } from './server/espnService.ts';
import { generateTopStory } from './server/editorialService.ts';
import { compileStandaloneHtml } from './server/htmlCompiler.ts';
import type {
  BriefConfig,
  BriefState,
  EditionPayload,
  RepoFileEntry,
  SportsFact,
} from './src/types.ts';

const ROOT_DIR = process.cwd();
const BRIEF_DIR = path.resolve(ROOT_DIR, 'morning-sports-brief');
const CONFIG_PATH = path.join(BRIEF_DIR, 'config.yaml');
const FACTS_PATH = path.join(BRIEF_DIR, 'data', 'facts.json');
const STATE_PATH = path.join(BRIEF_DIR, 'data', 'state.json');

function loadConfig(): BriefConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return yamlLoad(raw) as BriefConfig;
}

function saveConfig(cfg: BriefConfig): void {
  const dumped = yamlDump(cfg, { lineWidth: 110, noRefs: true });
  fs.writeFileSync(CONFIG_PATH, dumped, 'utf-8');
}

function loadFacts(): SportsFact[] {
  return JSON.parse(fs.readFileSync(FACTS_PATH, 'utf-8')) as SportsFact[];
}

function loadState(): BriefState {
  if (!fs.existsSync(STATE_PATH)) {
    return { edition_number: 0, used_fact_ids: [], last_edition_date: '' };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as BriefState;
}

function saveState(state: BriefState): void {
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function getDateStringsInTz(editionDateIsoOverride: string | undefined, tzName: string) {
  let baseDate: Date;
  if (editionDateIsoOverride && /^\d{4}-\d{2}-\d{2}$/.test(editionDateIsoOverride)) {
    baseDate = new Date(`${editionDateIsoOverride}T12:00:00Z`);
  } else {
    baseDate = new Date();
  }

  const fmtIso = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tzName,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    const y = get('year');
    const m = get('month');
    const day = get('day');
    return { iso: `${y}-${m}-${day}`, yyyymmdd: `${y}${m}${day}` };
  };

  const today = fmtIso(baseDate);
  const yesterdayDate = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = fmtIso(yesterdayDate);

  const editionDatePretty = new Intl.DateTimeFormat('en-US', {
    timeZone: tzName,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(baseDate);

  const yesterdayDisplay = new Intl.DateTimeFormat('en-US', {
    timeZone: tzName,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(yesterdayDate);

  return {
    editionDateIso: today.iso,
    todayYyyymmdd: today.yyyymmdd,
    editionDatePretty,
    yesterdayIso: yesterday.iso,
    yesterdayYyyymmdd: yesterday.yyyymmdd,
    yesterdayDisplay,
  };
}

function pickFact(facts: SportsFact[], state: BriefState, forcedFactId?: string): SportsFact {
  if (forcedFactId) {
    const found = facts.find((f) => f.id === forcedFactId);
    if (found) return found;
  }
  const used = new Set(state.used_fact_ids || []);
  const available = facts.filter((f) => !used.has(f.id));
  return available[0] || facts[0];
}

function collectRepoFiles(dir: string, prefix = ''): RepoFileEntry[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: RepoFileEntry[] = [];

  for (const entry of entries) {
    if (entry.name === 'dist' || entry.name === '__pycache__' || entry.name === '.DS_Store') {
      continue;
    }
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectRepoFiles(full, rel));
    } else {
      const ext = path.extname(entry.name).slice(1);
      files.push({
        path: rel,
        content: fs.readFileSync(full, 'utf-8'),
        language: ext || 'text',
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function buildEditionPayload(params: {
  dateIso?: string;
  storyMode?: string;
  factId?: string;
  advanceEdition?: boolean;
}): Promise<EditionPayload> {
  const config = loadConfig();
  const facts = loadFacts();
  const state = loadState();
  const tzName = config.newspaper?.timezone || 'America/New_York';
  const dates = getDateStringsInTz(params.dateIso, tzName);

  let editionNumber = state.edition_number || 1;
  const fact = pickFact(facts, state, params.factId);

  if (params.advanceEdition) {
    editionNumber = (state.edition_number || 0) + 1;
    const used = new Set(state.used_fact_ids || []);
    used.add(fact.id);
    if (used.size >= facts.length) used.clear();
    saveState({
      edition_number: editionNumber,
      used_fact_ids: Array.from(used),
      last_edition_date: dates.editionDateIso,
    });
  }

  const curated = await curateEdition(config, dates.yesterdayYyyymmdd, dates.todayYyyymmdd);
  const topStory = await generateTopStory(curated.lead_game, config, params.storyMode);
  const leadImage = params.factId ? null : (curated.lead_game?.lead_image ?? null);

  return {
    title: config.newspaper?.title || 'THE MORNING BOX SCORE',
    subtitle: config.newspaper?.subtitle || '',
    edition_date_iso: dates.editionDateIso,
    edition_date_pretty: dates.editionDatePretty,
    yesterday_iso: dates.yesterdayIso,
    yesterday_display: dates.yesterdayDisplay,
    edition_number: editionNumber,
    top_story: topStory,
    lead_image: leadImage,
    fact_of_day: fact,
    favorite_items: curated.favorite_items,
    interesting_games: curated.interesting_games,
    highlights: curated.highlights,
    lead_game: curated.lead_game,
    gemini_available: Boolean(process.env.GEMINI_API_KEY?.trim()),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/edition', async (req, res) => {
    try {
      const dateIso = typeof req.query.date === 'string' ? req.query.date : undefined;
      const storyMode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
      const factId = typeof req.query.factId === 'string' ? req.query.factId : undefined;
      const advanceEdition = req.query.advance === 'true';

      const payload = await buildEditionPayload({
        dateIso,
        storyMode,
        factId,
        advanceEdition,
      });
      res.json(payload);
    } catch (err: any) {
      console.error('Error building edition:', err);
      res.status(500).json({ error: err?.message || 'Failed to build morning edition' });
    }
  });

  app.post('/api/edition/regenerate-story', async (req, res) => {
    try {
      const { lead_game, mode } = req.body || {};
      const config = loadConfig();
      const story = await generateTopStory(lead_game ?? null, config, mode);
      res.json(story);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to regenerate top story' });
    }
  });

  app.post('/api/edition/latest-html', async (req, res) => {
    try {
      const edition = req.body as EditionPayload;
      const html = await compileStandaloneHtml(edition);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="latest.html"');
      res.send(html);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to compile latest.html' });
    }
  });

  app.get('/api/edition/latest.html', async (req, res) => {
    try {
      const dateIso = typeof req.query.date === 'string' ? req.query.date : undefined;
      const storyMode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
      const payload = await buildEditionPayload({ dateIso, storyMode });
      const html = await compileStandaloneHtml(payload);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err: any) {
      res.status(500).send(`<pre>Failed to compile latest.html: ${err?.message || 'Error'}</pre>`);
    }
  });

  app.get('/api/media', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    try {
      const parsed = new URL(rawUrl);
      const allowed =
        parsed.protocol === 'https:' &&
        (parsed.hostname.endsWith('.espncdn.com') ||
          parsed.hostname === 'espncdn.com' ||
          parsed.hostname === 'espnmedia-cdn.akamaized.net');
      if (!allowed) {
        res.status(400).send('Disallowed image host');
        return;
      }
      const upstream = await fetch(parsed.toString(), {
        headers: { 'User-Agent': 'MorningSportsBrief/1.0' },
      });
      if (!upstream.ok) {
        res.status(502).send('Upstream image unavailable');
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.status(400).send('Invalid image URL');
    }
  });

  app.get('/api/config', (_req, res) => {
    try {
      const config = loadConfig();
      const rawYaml = fs.readFileSync(CONFIG_PATH, 'utf-8');
      res.json({ config, rawYaml });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read config.yaml' });
    }
  });

  app.put('/api/config', (req, res) => {
    try {
      const incoming = req.body?.config as BriefConfig | undefined;
      if (!incoming || !Array.isArray(incoming.favorite_teams)) {
        res.status(400).json({ error: 'Invalid configuration payload' });
        return;
      }
      saveConfig(incoming);
      const rawYaml = fs.readFileSync(CONFIG_PATH, 'utf-8');
      res.json({ config: incoming, rawYaml });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to save config.yaml' });
    }
  });

  app.get('/api/teams', async (req, res) => {
    try {
      const sport = String(req.query.sport || 'basketball');
      const league = String(req.query.league || 'nba');
      const teams = await fetchLeagueTeams(sport, league);
      res.json({ teams });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load teams' });
    }
  });

  app.get('/api/facts', (_req, res) => {
    try {
      res.json({ facts: loadFacts(), state: loadState() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load facts' });
    }
  });

  app.post('/api/facts/mark-used', (req, res) => {
    try {
      const { factId } = req.body || {};
      const facts = loadFacts();
      const state = loadState();
      const used = new Set(state.used_fact_ids || []);
      if (factId && facts.some((f) => f.id === factId)) {
        used.add(factId);
      }
      const nextState: BriefState = {
        ...state,
        used_fact_ids: Array.from(used),
      };
      saveState(nextState);
      res.json({ state: nextState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to update state.json' });
    }
  });

  app.post('/api/facts/reset', (_req, res) => {
    try {
      const state = loadState();
      const nextState: BriefState = { ...state, used_fact_ids: [] };
      saveState(nextState);
      res.json({ state: nextState });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to reset used facts' });
    }
  });

  app.get('/api/repo/files', (_req, res) => {
    try {
      const files = collectRepoFiles(BRIEF_DIR);
      res.json({ files });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to read repository files' });
    }
  });

  app.get('/api/repo/download-zip', async (_req, res) => {
    try {
      const files = collectRepoFiles(BRIEF_DIR);
      const zip = new JSZip();
      const folder = zip.folder('morning-sports-brief');
      for (const file of files) {
        folder?.file(file.path, file.content);
      }
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="morning-sports-brief.zip"');
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to package zip' });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Morning Sports Brief Studio running on http://0.0.0.0:${port}`);
  });
}

startServer();

import fs from 'node:fs';
import path from 'node:path';
import type { EditionPayload, GameRecord, HighlightItem, LeadImage } from '../src/types.ts';

async function fetchImageAsDataUri(leadImage: LeadImage | null): Promise<{ dataUri: string; caption: string; credit: string } | null> {
  if (!leadImage?.url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(leadImage.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MorningSportsBrief/1.0' },
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      dataUri: `data:${contentType};base64,${buf.toString('base64')}`,
      caption: leadImage.caption,
      credit: leadImage.credit,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPeriodHeaders(game: GameRecord, maxCols: number): string {
  let out = '';
  for (let i = 0; i < maxCols; i++) {
    let label = String(i + 1);
    if (game.sport === 'basketball') {
      label = i < 4 ? `Q${i + 1}` : `OT${i > 4 ? i - 3 : ''}`;
    } else if (game.sport === 'football') {
      label = i < 4 ? `Q${i + 1}` : 'OT';
    } else if (game.sport === 'hockey') {
      label = i < 3 ? `P${i + 1}` : 'OT';
    }
    out += `<th class="col-period">${label}</th>`;
  }
  return out;
}

function renderLinescoreCells(lines: string[], maxCols: number): string {
  let out = '';
  for (let i = 0; i < maxCols; i++) {
    out += `<td class="col-period">${escapeHtml(i < lines.length ? lines[i] : '-')}</td>`;
  }
  return out;
}

export async function compileStandaloneHtml(edition: EditionPayload): Promise<string> {
  const cssPath = path.resolve(process.cwd(), 'morning-sports-brief/templates/newspaper.css');
  const cssText = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';
  const embeddedPhoto = await fetchImageAsDataUri(edition.lead_image);

  const playedFavorites = edition.favorite_items.filter((item) => Boolean(item.game));

  const favoriteCardsHtml = playedFavorites
    .map((item) => {
      const g = item.game!;
      const maxCols = Math.max(g.away.linescores.length, g.home.linescores.length);
      const favBox = g.home.team_id === g.favorite_team_id ? g.home : g.away;
      const oppBox = favBox === g.home ? g.away : g.home;

      const favLeadersHtml = favBox.leaders.length
        ? `<div class="leader-group">
            <span class="leader-team-tag">${escapeHtml(favBox.abbreviation)} LEADERS:</span>
            ${favBox.leaders
              .slice(0, 3)
              .map((l) => `<div class="leader-line">${escapeHtml(l)}</div>`)
              .join('')}
          </div>`
        : '';

      const oppLeaderHtml = oppBox.leaders.length
        ? `<div class="leader-line leader-opp"><strong>${escapeHtml(oppBox.abbreviation)}:</strong> ${escapeHtml(oppBox.leaders[0])}</div>`
        : '';

      return `
      <div class="game-card">
        <div class="card-top-meta">
          <span class="league-pill">${escapeHtml(g.league_label)}</span>
          <span class="status-pill">${escapeHtml(g.status_detail)}</span>
        </div>
        <table class="box-table">
          <thead>
            <tr>
              <th class="col-team">TEAM</th>
              ${renderPeriodHeaders(g, maxCols)}
              <th class="col-total">F</th>
            </tr>
          </thead>
          <tbody>
            <tr class="${g.away.winner ? 'row-winner' : ''}">
              <td class="col-team"><strong>${escapeHtml(g.away.abbreviation)}</strong> ${
                g.away.record ? `<span class="rec">(${escapeHtml(g.away.record)})</span>` : ''
              }</td>
              ${renderLinescoreCells(g.away.linescores, maxCols)}
              <td class="col-total">${g.away.score}</td>
            </tr>
            <tr class="${g.home.winner ? 'row-winner' : ''}">
              <td class="col-team"><strong>${escapeHtml(g.home.abbreviation)}</strong> ${
                g.home.record ? `<span class="rec">(${escapeHtml(g.home.record)})</span>` : ''
              }</td>
              ${renderLinescoreCells(g.home.linescores, maxCols)}
              <td class="col-total">${g.home.score}</td>
            </tr>
          </tbody>
        </table>
        <div class="stat-leaders">
          ${favLeadersHtml}
          ${oppLeaderHtml}
        </div>
      </div>`;
    })
    .join('\n');

  const highlightsList: HighlightItem[] = edition.highlights?.length
    ? edition.highlights
    : edition.interesting_games.map(
        (g): HighlightItem => ({
          kind: 'game',
          league_label: g.league_label,
          status_detail: g.status_detail,
          game: g,
        })
      );

  const highlightsHtml = highlightsList.length
    ? `<div class="highlights-grid">
        ${highlightsList
          .map((h) => {
            if (h.kind === 'game' && h.game) {
              const g = h.game;
              const note = g.milestones.length
                ? `★ ${g.milestones[0]}`
                : g.home.winner && g.home.leaders.length
                  ? g.home.leaders[0]
                  : g.away.leaders.length
                    ? g.away.leaders[0]
                    : '';
              return `
              <div class="highlight-card">
                <div class="hl-meta">
                  <span class="league-pill-sm">${escapeHtml(g.league_label)}</span>
                  <span class="hl-status">${escapeHtml(g.status_detail)}</span>
                </div>
                <div class="hl-scores">
                  <div class="hl-team ${g.away.winner ? 'hl-winner' : ''}">
                    <span>${escapeHtml(g.away.short_name)} ${
                      g.away.record ? `<small>(${escapeHtml(g.away.record)})</small>` : ''
                    }</span>
                    <strong>${g.away.score}</strong>
                  </div>
                  <div class="hl-team ${g.home.winner ? 'hl-winner' : ''}">
                    <span>${escapeHtml(g.home.short_name)} ${
                      g.home.record ? `<small>(${escapeHtml(g.home.record)})</small>` : ''
                    }</span>
                    <strong>${g.home.score}</strong>
                  </div>
                </div>
                ${note ? `<div class="hl-note">${escapeHtml(note)}</div>` : ''}
              </div>`;
            }
            return `
            <div class="highlight-card">
              <div class="hl-meta">
                <span class="league-pill-sm">${escapeHtml(h.league_label)}</span>
                <span class="hl-status">${escapeHtml(h.status_detail)}</span>
              </div>
              <div class="hl-rss-title">${escapeHtml(h.title || '')}</div>
              ${h.summary ? `<div class="hl-note">${escapeHtml(h.summary)}</div>` : ''}
            </div>`;
          })
          .join('\n')}
      </div>`
    : `<p class="empty-note">Quiet slate across the major leagues yesterday—check back tomorrow for more scores!</p>`;

  const upcomingHtml = edition.favorite_items
    .map((item) => {
      let detail = 'Off-Season';
      if (item.upcoming.status_type === 'today') {
        detail = `<strong>TODAY:</strong> ${escapeHtml(item.upcoming.matchup)} • ${escapeHtml(item.upcoming.time_display)}`;
      } else if (item.upcoming.status_type === 'upcoming') {
        detail = `${escapeHtml(item.upcoming.matchup)} • ${escapeHtml(item.upcoming.time_display)}`;
      }
      return `
      <div class="upcoming-item">
        <span class="up-team">${escapeHtml(item.upcoming.short_name)} (${escapeHtml(item.upcoming.league_label)})</span>
        <span class="up-detail">${detail}</span>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="edition-date" content="${escapeHtml(edition.edition_date_iso)}">
  <title>${escapeHtml(edition.title)} — ${escapeHtml(edition.edition_date_pretty)}</title>
  <style>
${cssText}
  </style>
</head>
<body>
  <div class="paper-sheet">
    <header class="masthead">
      <div class="masthead-top-bar">
        <span>EDITION NO. ${edition.edition_number}</span>
        <span>${escapeHtml(edition.subtitle)}</span>
        <span>${escapeHtml(edition.edition_date_pretty.toUpperCase())}</span>
      </div>
      <h1 class="masthead-title">${escapeHtml(edition.title)}</h1>
      <div class="masthead-rule-double"></div>
    </header>

    <section class="top-row">
      <article class="top-story">
        <div class="section-kicker">${escapeHtml(edition.top_story.kicker)}</div>
        <h2 class="lead-headline">${escapeHtml(edition.top_story.headline)}</h2>
        <p class="lead-body">${escapeHtml(edition.top_story.body)}</p>
      </article>

      ${
        embeddedPhoto
          ? `<figure class="lead-photo-box">
        <img class="lead-photo-img" src="${embeddedPhoto.dataUri}" alt="${escapeHtml(embeddedPhoto.caption || edition.top_story.headline)}">
        ${
          embeddedPhoto.caption || embeddedPhoto.credit
            ? `<figcaption class="lead-photo-caption">${escapeHtml(embeddedPhoto.caption)}${
                embeddedPhoto.credit
                  ? `<span class="lead-photo-credit">(${escapeHtml(embeddedPhoto.credit)})</span>`
                  : ''
              }</figcaption>`
            : ''
        }
      </figure>`
          : `<aside class="fact-box">
        <div class="fact-badge">SPORTS FACT OF THE DAY</div>
        <div class="fact-category">${escapeHtml(edition.fact_of_day.category)}</div>
        <p class="fact-text">${escapeHtml(edition.fact_of_day.fact)}</p>
      </aside>`
      }
    </section>

    ${
      playedFavorites.length > 0
        ? `<section class="section-block">
      <div class="section-header">
        <h3>YOUR TEAMS — YESTERDAY'S BOX SCORES</h3>
        <span class="section-sub">${escapeHtml(edition.yesterday_display)}</span>
      </div>
      <div class="favorites-grid${playedFavorites.length === 1 ? ' favorites-grid-single' : ''}">
        ${favoriteCardsHtml}
      </div>
    </section>`
        : ''
    }

    <section class="section-block">
      <div class="section-header">
        <h3>AROUND THE WORLD OF SPORTS</h3>
        <span class="section-sub">CLOSE FINISHES &amp; BIG PERFORMANCES</span>
      </div>
      ${highlightsHtml}
    </section>

    <section class="upcoming-section">
      <div class="upcoming-title">UPCOMING ON THE SCHEDULE — YOUR TEAMS</div>
      <div class="upcoming-grid">
        ${upcomingHtml}
      </div>
    </section>

  </div>
</body>
</html>`;
}

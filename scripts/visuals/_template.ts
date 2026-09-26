// THE STARTER. Copy this file to make a new visual: rename it, change the slug, add it to
// index.ts, then `npm run visual -- <slug> --stills` to look at it before rendering video.
//
// It draws a real chart on purpose (runs scored by each club in the regular season, bars growing
// in) so the copy starts from something that renders, and it shows the three things every visual
// does: load rows with fetchAll, draw the chart inside the box it is given, and scale type and
// strokes by `f.k` so the portrait sizes do not come out tiny.
//
// Before a number goes on an image, check it against the site: a visual is a public claim with
// our name on it, and a screenshot outlives any correction.
import { countsInStandings } from '../../src/wpbl/season'
import type { WpblGame } from '../../src/wpbl/types'
import { CLUBS, P, fetchAll, text, tween, type Visual } from './kit'

interface Row { id: string; name: string; color: string; runs: number }

const visual: Visual<Row[]> = {
  slug: 'template',
  title: 'Runs scored, 2026',
  subtitle: ['Every regular-season run, by club'],
  path: '/wpbl/standings',
  duration: 4,
  landscape: 'header',
  source: 'Data: WPBL league feed',

  async load() {
    const games = await fetchAll<WpblGame>('wpbl_games', 'id,status,game_type,counts_in_standings,home_team_id,away_team_id,home_score,away_score', 'id.asc')
    // countsInStandings is the one definition of "regular season" (CLAUDE.md): never re-derive it.
    const finals = games.filter(g => g.status === 'final' && countsInStandings(g))
    const runs = new Map<string, number>()
    for (const g of finals) {
      runs.set(g.home_team_id, (runs.get(g.home_team_id) ?? 0) + (g.home_score ?? 0))
      runs.set(g.away_team_id, (runs.get(g.away_team_id) ?? 0) + (g.away_score ?? 0))
    }
    return CLUBS.map(c => ({ id: c.id, name: c.name, color: c.color, runs: runs.get(c.id) ?? 0 }))
      .sort((a, b) => b.runs - a.runs)
  },

  chart(rows, t, box, f) {
    const max = Math.max(...rows.map(r => r.runs), 1)
    const gap = 14 * f.k
    const barH = (box.h - gap * (rows.length - 1)) / rows.length
    const labelW = 150 * f.k
    const size = Math.min(22 * f.k, barH * 0.45)
    return rows.map((r, i) => {
      const y = box.y + i * (barH + gap)
      const p = tween(t, 0.3 + i * 0.25, 1.4)
      const w = (box.w - labelW - 80 * f.k) * (r.runs / max) * p
      return text(box.x + (f.landscape ? 8 : 64), y + barH / 2 + size * 0.35, r.name, size, P.text, { weight: 700 }) +
        `<rect x="${box.x + labelW}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${barH.toFixed(1)}" rx="${(6 * f.k).toFixed(1)}" fill="${r.color}"/>` +
        text(box.x + labelW + w + 12 * f.k, y + barH / 2 + size * 0.35, String(Math.round(r.runs * p)), size, P.soft, { weight: 700 })
    }).join('')
  },
}

export default visual

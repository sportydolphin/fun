import React, { useState } from 'react'
import {
  Box, Typography, Paper, List, ListItemButton, Divider,
  ClickAwayListener, Tooltip, CircularProgress,
} from '@mui/material'
import { Search, InfoOutlined } from '@mui/icons-material'
import { TeamSummary } from '../types'
import { ACCENT, TEAM_BG, TEAM_SEASONS } from '../constants'
import { pillActionSx } from '../ui'
import { TeamEraOpsPlot, TeamWinRDPlot, TeamFraudPanel } from '../charts'

export interface VizViewProps {
  vizSeason: number
  setVizSeason: (s: number) => void
  teamSummaries: TeamSummary[]
  loadingViz: boolean
  nameMap: Map<number, string>
  handleVizNavigate: (id: number) => void
  canHover: boolean
}

export function VizView({
  vizSeason, setVizSeason, teamSummaries, loadingViz,
  nameMap, handleVizNavigate, canHover,
}: VizViewProps) {
  const [vizHighlightId, setVizHighlightId] = useState<number | null>(null)
  const [vizHoverId, setVizHoverId] = useState<number | null>(null)
  const [vizSearch, setVizSearch] = useState('')
  const [vizSearchOpen, setVizSearchOpen] = useState(false)

  return (
    <Box>
      {/* Season picker + team highlight search */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.85rem', color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
            All 30 teams · click to focus · hover to inspect
          </Typography>

          {/* Team highlight */}
          {vizHighlightId != null ? (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.55, borderRadius: 999, bgcolor: TEAM_BG[vizHighlightId] ?? 'grey.700' }}>
              <Typography sx={{ color: '#fff', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>
                {nameMap.get(vizHighlightId) ?? teamSummaries.find(t => t.id === vizHighlightId)?.abbr}
              </Typography>
              <Box
                onClick={() => { setVizHighlightId(null); setVizSearch('') }}
                sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', ml: 0.25, '&:hover': { color: '#fff' } }}
              >×</Box>
            </Box>
          ) : (
            <ClickAwayListener onClickAway={() => setVizSearchOpen(false)}>
              <Box sx={{ position: 'relative', minWidth: { xs: 0, sm: 180 }, flex: { xs: 1, sm: 'none' } }}>
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75,
                  px: 1.25, py: 0.6, borderRadius: 999,
                  border: '1.5px solid', borderColor: 'divider', bgcolor: 'background.paper',
                  transition: 'border-color 0.15s',
                  '&:focus-within': { borderColor: ACCENT },
                }}>
                  <Search sx={{ fontSize: '0.85rem', color: 'text.disabled', flexShrink: 0 }} />
                  <Box
                    component="input"
                    value={vizSearch}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setVizSearch(e.target.value); setVizSearchOpen(true) }}
                    onFocus={() => setVizSearchOpen(true)}
                    placeholder="Highlight a team…"
                    sx={{
                      flex: 1, minWidth: 0, border: 'none', outline: 'none', bgcolor: 'transparent',
                      fontSize: '0.8rem', color: 'text.primary', p: 0, fontFamily: 'inherit',
                      '&::placeholder': { color: 'text.disabled' },
                    }}
                  />
                </Box>
                {vizSearchOpen && (() => {
                  const q = vizSearch.toLowerCase()
                  const matches = vizSearch.length > 0
                    ? teamSummaries.filter(t => {
                        const name = nameMap.get(t.id) ?? ''
                        return name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q)
                      })
                    : [...teamSummaries].sort((a, b) => (nameMap.get(a.id) ?? a.abbr).localeCompare(nameMap.get(b.id) ?? b.abbr))
                  if (matches.length === 0) return null
                  return (
                    <Paper elevation={8} sx={{ position: 'absolute', width: '100%', zIndex: 20, mt: 0.5, borderRadius: 2, overflow: 'hidden' }}>
                      <List dense disablePadding>
                        {matches.map((t, i) => (
                          <React.Fragment key={t.id}>
                            {i > 0 && <Divider />}
                            <ListItemButton
                              onClick={() => { setVizHighlightId(t.id); setVizSearch(''); setVizSearchOpen(false) }}
                              sx={{ gap: 1.25, py: 0.6 }}
                            >
                              <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: TEAM_BG[t.id] ?? 'grey.700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: t.abbr.length > 2 ? '0.52rem' : '0.62rem', lineHeight: 1 }}>{t.abbr}</Typography>
                              </Box>
                              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>{nameMap.get(t.id) ?? t.abbr}</Typography>
                            </ListItemButton>
                          </React.Fragment>
                        ))}
                      </List>
                    </Paper>
                  )
                })()}
              </Box>
            </ClickAwayListener>
          )}
        </Box>

        <Box sx={{ ...pillActionSx, p: 0, '&:hover': { borderColor: ACCENT }, '&:focus-within': { borderColor: ACCENT } }}>
          <select value={vizSeason} onChange={e => setVizSeason(Number(e.target.value))}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: 'inherit', padding: '6px 16px', borderRadius: 999, fontFamily: 'inherit' }}>
            {TEAM_SEASONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Box>
      </Box>

      {loadingViz && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} /></Box>}

      {!loadingViz && teamSummaries.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: { md: 5 }, rowGap: 0 }} onMouseLeave={() => setVizHoverId(null)}>
          {/* Chart 1: ERA vs OPS */}
          <Box sx={{ pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Pitching vs Hitting</Typography>
              <Tooltip arrow placement="top" title={
                <Box sx={{ maxWidth: 260, p: 0.5 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                    Each bubble is a team plotted by their pitching quality (ERA, vertical) vs their hitting power (OPS, horizontal).
                    Lower ERA = better pitching, so the top of the chart is elite pitching.
                    Higher OPS = better hitting, so the right side is elite offense.
                    The quadrants label each team style — top-right teams have both elite pitching and elite hitting.
                  </Typography>
                </Box>
              }>
                <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
              </Tooltip>
            </Box>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
              How good a team's pitching and hitting are · top-right = best of both
            </Typography>
            <TeamEraOpsPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
          </Box>

          {/* Chart 2: Win% vs Run Differential */}
          <Box sx={{ pt: { xs: 3, md: 0 }, pb: 3.5, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>Wins vs Run Margin</Typography>
              <Tooltip arrow placement="top" title={
                <Box sx={{ maxWidth: 280, p: 0.5 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                    Each bubble is a team's actual win% plotted against their run margin (runs scored minus runs allowed).
                    The blue dashed curve is the expected win rate — how often a team should win based on their scoring margin alone.
                    Teams above the curve are winning more games than their scoring predicts (often luck or clutch play in close games).
                    Teams below the curve are underperforming — they're outscoring opponents overall but losing too many tight games.
                    Hover a team to see their actual record vs expected W-L.
                  </Typography>
                </Box>
              }>
                <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
              </Tooltip>
            </Box>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
              Actual record vs expected W-L based on scoring · above the curve = outperforming
            </Typography>
            <TeamWinRDPlot data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={canHover ? handleVizNavigate : undefined} onHoverTeam={canHover ? setVizHoverId : undefined} />
          </Box>

          {/* Desktop-only row divider */}
          <Divider sx={{ display: { xs: 'none', md: 'block' }, gridColumn: '1 / -1' }} />

          {/* Chart 3: Fraud Watch — Top Frauds */}
          <Box sx={{ pt: { xs: 3, md: 3.5 }, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>🚨 Top Frauds</Typography>
              <Tooltip arrow placement="top" title={
                <Box sx={{ maxWidth: 270, p: 0.5 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                    Teams winning the most games above what their run differential predicts, weighted by how well they're actually doing.
                    A first-place team winning 5 more than expected ranks higher than a last-place team winning 6 more — because the first-place team is actually fooling people.
                    Bar length = weighted fraud score. Number = raw wins above expectation.
                  </Typography>
                </Box>
              }>
                <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
              </Tooltip>
            </Box>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
              Winning more than their scoring predicts · weighted by standings position
            </Typography>
            <TeamFraudPanel data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={handleVizNavigate} onHoverTeam={canHover ? setVizHoverId : undefined} type="fraud" />
          </Box>

          {/* Chart 4: Fraud Watch — Most Cursed */}
          <Box sx={{ pt: { xs: 3, md: 3.5 }, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.3px' }}>💀 Most Cursed</Typography>
              <Tooltip arrow placement="top" title={
                <Box sx={{ maxWidth: 270, p: 0.5 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', mb: 0.5 }}>What this shows</Typography>
                  <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                    Teams losing the most games beyond what their run differential predicts, weighted by how poorly they're already doing.
                    A last-place team underperforming by 4 wins ranks higher than a first-place team underperforming by 5 — because the first-place team is still fine.
                    Bar length = weighted cursed score. Number = raw wins below expectation.
                  </Typography>
                </Box>
              }>
                <InfoOutlined sx={{ fontSize: '0.95rem', color: 'text.disabled', cursor: 'help', mt: '1px' }} />
              </Tooltip>
            </Box>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.72rem', mb: 1.5 }}>
              Losing more than their scoring predicts · weighted by standings position
            </Typography>
            <TeamFraudPanel data={teamSummaries} nameMap={nameMap} highlightTeamId={vizHoverId ?? vizHighlightId} onSelectTeam={handleVizNavigate} onHoverTeam={canHover ? setVizHoverId : undefined} type="cursed" />
          </Box>
        </Box>
      )}

      {!loadingViz && teamSummaries.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No team stats available for {vizSeason}.</Typography>
      )}
    </Box>
  )
}

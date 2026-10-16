// Files written before the type scale existed, which still carry a typed-in font size: a raw rem
// literal or a bare pixel number. Frozen on Oct 12, 2026, when the scale stopped being opt-in.
//
// THIS LIST ONLY SHRINKS. Every other file under src/ is held to the scale by typeScale.test.ts,
// including every file created from now on, which is the point: the opt-in list it replaced
// caught a file only if somebody remembered to enrol it. Convert a file and take it off here; the
// test fails if a listed file has nothing left to convert, so the list cannot go stale.
export const TYPE_SCALE_LEGACY: readonly string[] = [
  'src/AdminAwards.tsx',
  'src/AdminPage.tsx',
  'src/AdminPanel.tsx',
  'src/AdminUserDetail.tsx',
  'src/AdminUsers.tsx',
  'src/dev/DevSettings.tsx',
  'src/mlb/components/ContractPanel.tsx',
  'src/mlb/components/LiveGameCard.tsx',
  'src/mlb/components/PlayerTrendsChart.tsx',
  'src/mlb/components/RollingWindowChart.tsx',
  'src/mlb/components/cards.tsx',
  'src/mlb/components/charts.tsx',
  'src/mlb/components/ui.tsx',
  'src/mlb/dev/IconStudio.tsx',
  'src/mlb/views/LiveGameCenter.tsx',
  'src/mlb/views/PlayoffOddsBoard.tsx',
  'src/mlb/views/PredictionStats.tsx',
  'src/mlb/views/PredictorModal.tsx',
  'src/mlb/views/Standings.tsx',
  'src/mlb/views/VizView.tsx',
  'src/wpbl/AdminClips.tsx',
  'src/wpbl/AdminPhotos.tsx',
  'src/wpbl/DraftValue.tsx',
  'src/wpbl/Live.tsx',
  'src/wpbl/LiveGameView.tsx',
  'src/wpbl/PhotoCropper.tsx',
]

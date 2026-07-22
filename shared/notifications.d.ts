// Types for shared/notifications.js. Hand-written because the catalog is plain
// ESM .js (so Node can run it directly) and the project doesn't enable allowJs.

/** Transport-agnostic notification content — rendered by the bell and by Web Push. */
export interface NotificationPayload {
  /** Stable identity: dedupe key in the bell, `tag` for Web Push. */
  id:    string
  /** Catalog type that produced this payload (see NOTIFICATION_TYPES). */
  type:  string
  /** Emoji shown in the bell. */
  icon:  string
  title: string
  body:  string
  /** In-app path a click should land on. */
  url:   string
}

export interface NotificationMeta {
  label:      string
  icon:       string
  defaultUrl: string
}

export const NOTIFICATION_TYPES: {
  PICKS_READY: string
  GAME_START:  string
}

export const NOTIFICATION_META: Record<string, NotificationMeta>

export const DEFAULT_GAME_START_LEAD_MIN: number

export function todayISO(): string

export function buildPicksReady(args: {
  date:      string
  remaining: number
  total:     number
}): NotificationPayload

export function buildGameStart(args: {
  gamePk:         number
  teamName:       string
  matchup:        string
  minutesToStart: number
}): NotificationPayload

export const SAMPLE_BUILDERS: Record<string, () => NotificationPayload>

export function sampleNotifications(): Array<{
  type:    string
  label:   string
  payload: NotificationPayload
}>

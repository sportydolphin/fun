// MLB's copy-link chip: the shared control (src/ui/CopyLinkButton.tsx) copying the SHORT link
// (/m/<code>, routes.ts), as WPBL's sheets copy /p and /g, so a share fits a post's character
// limit. The edge 302s it to the canonical page, which is what unfurls. Built from the target
// rather than read off the bar, because the bar is the page under a sheet for the frame before the
// sheet's entry lands, and a link to Scores is not the link the reader asked for.
import { CopyLinkButton } from '../../ui/CopyLinkButton'
import { track, EVENTS } from '../../lib/analytics'
import { mlbShortPath } from '../routes'
import type { MlbShortTarget } from '../routes'

export const mlbShareUrl = (t: MlbShortTarget): string => `${window.location.origin}${mlbShortPath(t)}`

export const trackMlbShare = (t: MlbShortTarget) => track(EVENTS.MLB_SHARE_COPIED, { kind: t.kind, path: mlbShortPath(t) })

export function MlbCopyLink({ target, title }: { target: MlbShortTarget; title: string }) {
  return <CopyLinkButton url={mlbShareUrl(target)} title={title} onCopy={() => trackMlbShare(target)} />
}

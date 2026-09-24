import { useIsAdmin } from '../lib/admin'
import { useIsTester } from '../lib/roles'

/**
 * Whether fan photos are shown at all. OWNER AND TESTERS ONLY FOR NOW (Sep 23, 2026): the owner is
 * loading the first batch and wants it seen on production, by themselves and by the tester role,
 * before any reader does. Every photo surface asks this one hook (the Home card, the player strip,
 * the gallery page, the footer link and the More menu), so going public is this function
 * returning true, plus putting /wpbl/photos back in the sitemap and taking `noindex` off it in
 * seo.ts. Its own module so the footer can ask without pulling the photo views into its bundle.
 * Cosmetic, like every role gate: unpublished photos are held back by RLS, and a published one is
 * public data either way.
 */
export function useFanPhotosVisible(): boolean {
  // Both hooks every render, never short-circuited: hook order must not depend on the answer.
  const admin = useIsAdmin()
  const tester = useIsTester()
  return admin || tester
}

/** Whether the reader can edit a photo from where it is shown (the Edit button in the enlarged
 *  view). The owner only, NOT testers: every write is refused by RLS for anyone but the owner, so
 *  a tester given the button would get an editor whose every save silently fails. */
export function useCanEditFanPhotos(): boolean {
  return useIsAdmin()
}

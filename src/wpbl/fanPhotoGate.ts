import { useIsAdmin } from '../lib/admin'

/**
 * Whether fan photos are shown at all. OWNER-ONLY FOR NOW (Sep 23, 2026): the owner is loading
 * the first batch and wants to see the Home card, the player strips and the gallery on production
 * before any reader does. Every photo surface asks this one hook (the Home card, the player strip,
 * the gallery page, the footer link and the More menu), so going public is this function
 * returning true, plus putting /wpbl/photos back in the sitemap and taking `noindex` off it in
 * seo.ts. Its own module so the footer can ask without pulling the photo views into its bundle.
 * Cosmetic, like every useIsAdmin gate: unpublished photos are held back by RLS, and a published
 * one is public data either way.
 */
export function useFanPhotosVisible(): boolean {
  return useIsAdmin()
}

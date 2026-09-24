import { useIsAdmin } from '../lib/admin'

// FAN PHOTOS ARE PUBLIC as of Sep 24, 2026. They were owner-and-testers only while the first batch
// was checked on production, behind a `useFanPhotosVisible` hook every photo surface asked; that
// hook is gone rather than returning true, so nothing can quietly put a surface back behind it.
// Unpublished photos were never the gate's job: RLS holds those back. What is left here is who may
// EDIT, which is a real permission.

/** Whether the reader can edit a photo from where it is shown (the Edit button in the enlarged
 *  view). The owner only, NOT testers: every write is refused by RLS for anyone but the owner, so
 *  a tester given the button would get an editor whose every save silently fails. */
export function useCanEditFanPhotos(): boolean {
  return useIsAdmin()
}

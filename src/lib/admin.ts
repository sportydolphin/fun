import { useAuth } from '../AuthContext'

// Cosmetic gate only: decides whether admin-only UI renders. It grants NO privilege:
// every admin *action* is enforced server-side by RLS (public.is_site_owner(), see
// scripts/harden_admin_gate.sql), which reads the confirmed email from auth.users by the
// verified auth.uid() and can't be spoofed by faking a client value. Single source of
// truth for the owner email so App.tsx and feature-flagged sections agree.
export const ADMIN_EMAIL = 'snichols246@gmail.com'

/**
 * Owner view under `npm run dev`, from the dev menu: `localStorage.sdForceOwner = '1'`, read once
 * at load, as the forced tester role in roles.ts is. So owner-gated UI can be developed and checked
 * in the dev preview without the owner's real session there, which would carry real owner powers
 * over the production database. Dead in every production build. It draws owner UI and grants
 * nothing: an owner-only table or RPC still answers this browser as the signed-out reader it is,
 * which is why the World Cup pages read their files from the dev server (vite-plugin-wbsc-dev.mjs).
 */
const DEV_FORCE_OWNER: boolean = (() => {
  try {
    return !!import.meta.env?.DEV && localStorage.getItem('sdForceOwner') === '1'
  } catch { return false }
})()

// True when the signed-in user is the site owner. Use to hide admin-only / in-progress
// UI from everyone else. Not a security boundary. See the note above.
export function useIsAdmin(): boolean {
  const { user } = useAuth()
  return DEV_FORCE_OWNER || user?.email === ADMIN_EMAIL
}

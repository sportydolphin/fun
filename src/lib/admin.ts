import { useAuth } from '../AuthContext'

// Cosmetic gate only: decides whether admin-only UI renders. It grants NO privilege —
// every admin *action* is enforced server-side by RLS (public.is_site_owner(), see
// scripts/harden_admin_gate.sql), which reads the confirmed email from auth.users by the
// verified auth.uid() and can't be spoofed by faking a client value. Single source of
// truth for the owner email so App.tsx and feature-flagged sections agree.
export const ADMIN_EMAIL = 'snichols246@gmail.com'

// True when the signed-in user is the site owner. Use to hide admin-only / in-progress
// UI from everyone else. Not a security boundary — see the note above.
export function useIsAdmin(): boolean {
  const { user } = useAuth()
  return user?.email === ADMIN_EMAIL
}

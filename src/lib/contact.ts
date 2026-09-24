// The site's one public contact address: the Privacy and Terms pages, the feedback dialog's
// fallback, and the gallery's "send us your photos" prompt. A domain address rather than the
// owner's personal inbox, delivered by Cloudflare Email Routing (sportydolphin.fun's MX points
// there). This is NOT the owner's identity: ADMIN_EMAIL in admin.ts and the is_site_owner() SQL
// check the sign-in address, and changing this one must never touch those.
export const CONTACT_EMAIL = 'support@sportydolphin.fun'

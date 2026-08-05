import { Box, Typography } from '@mui/material'

// Privacy Policy + Terms of Service pages. Reachable at /privacy and /terms, linked
// from the footer, and used as the Google OAuth consent-screen policy links. Written
// to match how the site actually works (Supabase auth, a predictions game, feedback),
// not boilerplate. Plain language, no legalese theater.

const LAST_UPDATED = 'August 5, 2026'
const CONTACT_EMAIL = 'snichols246@gmail.com'
const SITE = 'sportydolphin.fun'

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', px: { xs: 0.5, sm: 1 }, py: 1, lineHeight: 1.6 }}>
      <Typography sx={{ fontSize: { xs: '1.6rem', sm: '2rem' }, fontWeight: 900, letterSpacing: '-0.5px' }}>
        {title}
      </Typography>
      <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mt: 0.5, mb: 3 }}>
        Last updated: {LAST_UPDATED}
      </Typography>
      {children}
      <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mt: 4, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        Questions? Email <Box component="a" href={`mailto:${CONTACT_EMAIL}`} sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>{CONTACT_EMAIL}</Box>.
      </Typography>
    </Box>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="h2" sx={{ fontSize: '1.15rem', fontWeight: 800, mt: 3.5, mb: 1 }}>
      {children}
    </Typography>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: '0.95rem', color: 'text.primary', mb: 1.25 }}>
      {children}
    </Typography>
  )
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <Box component="ul" sx={{ pl: 3, mb: 1.5, '& li': { fontSize: '0.95rem', color: 'text.primary', mb: 0.6 } }}>
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </Box>
  )
}

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy">
      <P>
        {SITE} is a free, personal baseball stats project. It covers Major League Baseball and
        the Women's Pro Baseball League, and it includes an optional predictions game. This
        policy explains what information the site collects, why, and what happens to it. The
        short version: the site collects as little as it can, does not sell your data, and does
        not show ads.
      </P>

      <H>Who runs this site</H>
      <P>
        {SITE} is run by an individual hobbyist, not a company. You can reach the operator at{' '}
        {CONTACT_EMAIL}.
      </P>

      <H>Information the site collects</H>
      <P>You can browse most of the site without signing in. The site collects information only in these cases:</P>
      <Bullets items={[
        <><b>When you sign in with Google.</b> The site uses Google sign-in (through Supabase Auth) to create your account. From Google it receives your email address and basic profile information (such as your name and profile image). It does not receive your Google password.</>,
        <><b>When you use your account.</b> If you set a username or display name, make picks in the predictions game, or follow players and teams, that information is stored and tied to your account so the site can show it back to you.</>,
        <><b>When you send feedback.</b> If you use the feedback form, the message you write is stored, along with your account email if you are signed in, so the operator can read and respond.</>,
        <><b>Basic technical data.</b> Like most websites, the hosting and database providers may process standard technical information (such as IP address and browser type) to run and secure the service.</>,
      ]} />
      <P>
        The site also stores some preferences directly in your browser (for example your theme
        choice, followed players and teams, recent searches, and notification state). This stays
        on your device and is not an account profile.
      </P>

      <H>How the information is used</H>
      <Bullets items={[
        'To sign you in and keep you signed in.',
        'To save and show your account content: username, predictions, record, and followed players and teams.',
        'To respond to feedback you send.',
        'To operate, secure, and improve the site.',
      ]} />
      <P>The site does not use your information for advertising and does not sell or rent it to anyone.</P>

      <H>Services the site relies on</H>
      <P>A few third-party services help run the site. When you use the site, some data is handled by:</P>
      <Bullets items={[
        <><b>Supabase</b> hosts the database and handles sign-in. Your account and account content are stored there.</>,
        <><b>Google</b> provides the sign-in. Your use of Google sign-in is also covered by Google's own privacy policy.</>,
        <><b>MLB Stats API and the official WPBL stats feed</b> supply the baseball data shown on the site. These are read-only sources; the site does not send your personal information to them.</>,
        <><b>Ko-fi</b> hosts the optional support link. If you follow it, any information you provide there is handled by Ko-fi under its own policy.</>,
        <><b>Cloudflare</b> serves the site and provides privacy-friendly, cookieless traffic analytics (aggregate page views and performance). It does not use cookies, does not track you across other sites, and does not collect personal information.</>,
      ]} />

      <H>Cookies and local storage</H>
      <P>
        The site uses cookies and browser local storage only for essential purposes: keeping you
        signed in and remembering your preferences. It does not use advertising or cross-site
        tracking cookies. The site's traffic analytics are cookieless, so they add no cookies of
        their own.
      </P>

      <H>Keeping and deleting your data</H>
      <P>
        Your account data is kept while your account exists. You can delete your account from the
        account menu, or email {CONTACT_EMAIL} to ask for your account and its data to be removed.
        You can also clear the browser-stored preferences at any time by clearing your browser data.
      </P>

      <H>Children</H>
      <P>
        This site is not directed to children under 13, and it does not knowingly collect
        information from them.
      </P>

      <H>Changes to this policy</H>
      <P>
        This policy may be updated from time to time. When it changes, the date at the top of the
        page will be updated.
      </P>

      <H>Not affiliated</H>
      <P>
        {SITE} is an independent fan project. It is not affiliated with, endorsed by, or
        sponsored by Major League Baseball, the Women's Pro Baseball League, or any team.
      </P>
    </LegalLayout>
  )
}

export function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service">
      <P>
        Welcome to {SITE}, a free baseball stats project covering Major League Baseball and the
        Women's Pro Baseball League. By using the site you agree to these terms. If you do not
        agree, please do not use the site.
      </P>

      <H>What the site is</H>
      <P>
        {SITE} is a personal, non-commercial hobby project. It shows baseball statistics and
        includes an optional predictions game for fun. It is provided free of charge and is
        offered as-is, with no guarantee that it will always be available, complete, or accurate.
      </P>

      <H>Accuracy of the data</H>
      <P>
        Statistics and scores come from third-party sources, including the public MLB Stats API
        and the official WPBL stats feed. The site does its best to present this data faithfully,
        but it cannot guarantee that everything is correct or up to date. Do not rely on the site
        for any decision that matters, and never for betting or wagering.
      </P>

      <H>Your account</H>
      <Bullets items={[
        'You sign in using Google. You are responsible for keeping your Google account secure.',
        'You agree to provide accurate information and not to impersonate anyone else.',
        'The operator may suspend or remove accounts that abuse the site or these terms.',
      ]} />

      <H>The predictions game</H>
      <P>
        The predictions game is for entertainment only. It does not involve real money, wagering,
        or prizes. Standings and records are just for fun.
      </P>

      <H>Acceptable use</H>
      <P>You agree not to:</P>
      <Bullets items={[
        'Use the site for any unlawful purpose.',
        'Attempt to disrupt, overload, attack, or gain unauthorized access to the site or its data.',
        'Scrape or bulk-download the site in a way that harms its operation.',
        'Submit abusive, hateful, or unlawful content through the feedback form.',
      ]} />

      <H>Names and logos</H>
      <P>
        Team names, logos, and other marks shown on the site belong to their respective owners
        and are used only to identify teams and players. {SITE} claims no ownership of them and is
        not affiliated with, endorsed by, or sponsored by Major League Baseball, the Women's Pro
        Baseball League, or any team.
      </P>

      <H>No warranty and limitation of liability</H>
      <P>
        The site is provided without warranties of any kind. To the fullest extent allowed by law,
        the operator is not liable for any damages arising from your use of, or inability to use,
        the site.
      </P>

      <H>Changes to these terms</H>
      <P>
        These terms may be updated from time to time. When they change, the date at the top of the
        page will be updated. Continuing to use the site after a change means you accept the
        updated terms.
      </P>

      <H>Contact</H>
      <P>
        If you have any questions about these terms, email {CONTACT_EMAIL}.
      </P>
    </LegalLayout>
  )
}

// Rewriting a page's preview tags at the edge, for both sections' Pages Functions
// (functions/wpbl/index.ts and functions/mlb/index.ts). One copy, because the rules below are
// what make an unfurl work at all, and two copies would drift the way the slug rules once did.
//
// Imports nothing: it runs in the Workers runtime, and HTMLRewriter is that runtime's global.

export interface OgTags {
  title: string
  ogTitle: string
  description: string
  url: string
  /** Absolute, 1200x630, or null to keep index.html's default cover. */
  image: string | null
  imageAlt: string | null
  ogType: string
}

/**
 * The page with its tags replaced. Every tag is edited in place, never appended, because
 * unfurlers take the FIRST occurrence of a property: a second og:title further down the head is
 * ignored. index.html carries a full set of defaults, including the image tags, so there is always
 * something to edit. Where the runtime has no HTMLRewriter (the test runner), the page goes out
 * untouched, which is also what every caller does when it cannot build a card.
 */
export function rewriteOgTags(page: Response, tags: OgTags): Response {
  if (typeof HTMLRewriter === 'undefined') return page
  const replacements: Record<string, string> = {
    'og:type': tags.ogType,
    'og:title': tags.ogTitle,
    'og:description': tags.description,
    'og:url': tags.url,
    'twitter:title': tags.ogTitle,
    'twitter:description': tags.description,
    description: tags.description,
  }

  // The image must already be 1200x630, the shape of the default cover, so the size tags carry
  // over untouched. That shape is the only instruction an unfurler that asks us nothing can
  // follow: Bluesky reads og: alone, never sees twitter:card, and centre-crops whatever it gets to
  // one 1.91:1 band, which is how a square headshot once arrived as a strip across a face.
  if (tags.image) {
    replacements['og:image'] = tags.image
    if (tags.imageAlt) replacements['og:image:alt'] = tags.imageAlt
    replacements['twitter:image'] = tags.image
    replacements['twitter:card'] = 'summary_large_image'
  }

  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(tags.title) } })
    .on('meta', {
      element(el) {
        const key = el.getAttribute('property') || el.getAttribute('name')
        if (!key) return
        const value = replacements[key]
        if (value) el.setAttribute('content', value)
      },
    })
    .transform(page)
}

// Minimal shapes for the one Workers global this touches, so the repo does not take on
// @cloudflare/workers-types for it.
declare class HTMLRewriter {
  on(selector: string, handlers: { element(el: HtmlElement): void }): HTMLRewriter
  transform(response: Response): Response
}
interface HtmlElement {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  setInnerContent(content: string): void
}

// Single source of truth for site identity. Imported by both astro.config.mjs
// and the components, so the domain can never drift between them.

const url = 'https://abhilakshsinghreen.com';

export const SITE = {
  url,

  /**
   * Header wordmark. Deliberately the domain rather than the author's name:
   * every post carries a full author card (docs/design.md line 10), so a name
   * in the header would just repeat the byline a hundred pixels below it.
   *
   * Derived from `url` so it updates automatically. Replace with a string
   * literal if you'd rather show a handle (e.g. '@abhilakshreen').
   */
  title: new URL(url).host,
};

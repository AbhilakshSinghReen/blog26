import { defineConfig } from 'astro/config';
import { SITE } from './site.config.mjs';

export default defineConfig({
  // Domain lives in site.config.mjs so the config and the header wordmark
  // cannot drift. Drives canonical URLs, RSS and sitemap. No `base` needed:
  // a custom domain serves from the root on GitHub Pages.
  site: SITE.url,

  // No trailing slashes in URLs.
  //   build.format: 'file'  -> writes dist/blog/slug.html (not slug/index.html)
  //   trailingSlash:'never' -> Astro matches/generates URLs without the slash
  // GitHub Pages resolves /blog/slug to blog/slug.html, so this serves cleanly.
  trailingSlash: 'never',
  build: {
    format: 'file',
  },

});

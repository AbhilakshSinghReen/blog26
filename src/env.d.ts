/// <reference types="astro/client" />

/**
 * Client-visible configuration. Only PUBLIC_-prefixed vars reach the browser
 * bundle, which is what these are for — none of them is a secret, and all three
 * are inlined verbatim into the shipped JS.
 *
 * Every one is optional: src/scripts/analytics.ts defaults to production, so a
 * build with no .env at all (which is what CI runs) is the correct build.
 */
interface ImportMetaEnv {
  /** Ingest host, no trailing slash. Default: https://analytics.abhilakshsinghreen.com */
  readonly PUBLIC_ANALYTICS_BASE_URL?: string;
  /** Partition key in the shared ingest stream. Default: abhilaksh-blog */
  readonly PUBLIC_ANALYTICS_APP_NAME?: string;
  /** Exactly 'true' to report from a host outside the allowlist. */
  readonly PUBLIC_ANALYTICS_FORCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

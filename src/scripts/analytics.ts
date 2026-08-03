/**
 * Analytics client for the analytics-backend ingest service.
 *
 * Contract (see analytics-backend/README.md):
 *   POST /create-session -> 201 {"sessionId": "<ts>---<uuid>"}
 *   POST /record-event   -> 201 {"eventId":   "<type>---<ts>---<uuid>"}
 *                           body: {sessionId, eventType, additionalDetails?}
 *
 * Two rules shape everything below:
 *
 *  1. Analytics must never break the site. Every call into the network, into
 *     localStorage and into the Intl APIs is individually guarded, and a
 *     failure degrades to "no analytics" rather than a thrown error. Nothing
 *     here is retried: a backend that is down stays down for the page's
 *     lifetime, and retry storms would only make that worse.
 *
 *  2. No cookies (docs/design.md). The session ID lives in localStorage, which
 *     means it is per-origin and never travels on a request automatically.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The single place the backend location is configured.
// Change this to the deployed ingest host before going live.
// ─────────────────────────────────────────────────────────────────────────────
const ANALYTICS_BASE_URL = 'http://localhost:8080';

const SESSION_STORAGE_KEY = 'analytics.sessionId';
const STILL_OPEN_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;

type EventType = 'PAGE_VIEW' | 'PAGE_STILL_OPEN';

/**
 * The visitor's country, derived from their locale — never logged, never sent
 * anywhere but the ingest endpoint.
 *
 * This is deliberately local: no geo-IP lookup, no third-party request, no
 * extra origin for an ad blocker to trip over. The trade-off is that it
 * reports the *locale's* region, not the device's physical location — someone
 * in Berlin running an `en-US` browser reports `US`. It is a population
 * signal, not a fact about any one visitor.
 *
 * This is also the part most likely to fail: `navigator.language` is often a
 * bare `"en"` with no region at all, `Intl.Locale` throws outright on a
 * malformed tag, and both `Intl` and `navigator.languages` can be missing.
 * Hence a per-tag try, an outer try, and `null` as an ordinary outcome rather
 * than an error.
 */
function resolveCountryCode(): string | null {
  try {
    // navigator.language first: it is the user's top preference, and
    // navigator.languages may repeat or reorder it.
    const tags = [navigator.language, ...(navigator.languages ?? [])];
    for (const tag of tags) {
      if (!tag) continue;
      try {
        const region = new Intl.Locale(tag).region;
        if (region) return region;
      } catch {
        // Malformed or unsupported tag — try the next one.
      }
    }
  } catch {
    // No Intl, or no navigator.languages.
  }
  return null;
}

// Resolved once: it cannot change while the page is open, and it is on the
// path of an event fired every 10 seconds.
const COUNTRY_CODE = resolveCountryCode();

/**
 * Aborts a request that hangs, so a stalled backend cannot leak a fetch per
 * 10-second tick for the lifetime of the tab. Feature-detected because losing
 * `AbortSignal.timeout` should cost us the timeout, not all analytics.
 */
function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

/** POSTs JSON and returns the decoded body, or null on any failure. Never throws. */
async function post<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const response = await fetch(ANALYTICS_BASE_URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Lets the request outlive the page, so the tick that happens to land as
      // the visitor navigates away is still delivered.
      keepalive: true,
      signal: timeoutSignal(),
    });

    if (!response.ok) {
      console.warn(`[analytics] ${path} failed: HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.warn(`[analytics] ${path} failed:`, error);
    return null;
  }
}

function readStoredSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage disabled or blocked (Safari private browsing, strict settings).
    return null;
  }
}

function writeStoredSessionId(sessionId: string): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Not fatal: the ID is still held in memory, so this page's events are
    // attributed correctly. Only continuity across page loads is lost.
  }
}

/**
 * Resolves the session ID, creating one on the backend the first time.
 *
 * The promise is memoised rather than the value: PAGE_VIEW fires immediately
 * and the first PAGE_STILL_OPEN could arrive before session creation returns,
 * and without this both would create their own session.
 */
let sessionIdRequest: Promise<string | null> | null = null;

function getSessionId(): Promise<string | null> {
  if (sessionIdRequest) return sessionIdRequest;

  sessionIdRequest = (async () => {
    const existing = readStoredSessionId();
    if (existing) return existing;

    const created = await post<{ sessionId?: string }>('/create-session');
    if (!created?.sessionId) return null;

    writeStoredSessionId(created.sessionId);
    // The ID itself is deliberately not logged.
    console.log('[analytics] session created');
    return created.sessionId;
  })();

  return sessionIdRequest;
}

/** Where the visitor has read to. */
function scrollPosition(): { scrollY: number; scrollPercent: number } {
  const scrollY = Math.round(window.scrollY);
  const scrollable = Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
  );

  return {
    scrollY,
    // A page shorter than the viewport has nothing to scroll, and reporting 0%
    // would read as "never engaged" when in fact the whole page is visible.
    scrollPercent:
      scrollable > 0 ? Math.min(100, Math.round((scrollY / scrollable) * 100)) : 100,
  };
}

/** Sends one event. Never throws, never rejects. */
async function recordEvent(
  eventType: EventType,
  additionalDetails: Record<string, unknown>,
): Promise<void> {
  try {
    const sessionId = await getSessionId();
    if (!sessionId) return; // Session creation already warned.

    const result = await post<{ eventId?: string }>('/record-event', {
      sessionId,
      eventType,
      additionalDetails,
    });

    // Event type only — the event ID embeds a timestamp and UUID.
    if (result) console.log(`[analytics] event recorded: ${eventType}`);
  } catch (error) {
    console.warn('[analytics] could not record event:', error);
  }
}

function start(): void {
  const base = { url: window.location.href, countryCode: COUNTRY_CODE };

  // Every navigation on this site is a full page load, so this runs once per
  // page visit — including the first, where it waits on session creation.
  void recordEvent('PAGE_VIEW', base);

  // Heartbeat. Browsers throttle timers in background tabs (typically to about
  // once a minute), so these ticks measure "open", not "actively watched".
  window.setInterval(() => {
    void recordEvent('PAGE_STILL_OPEN', { ...base, ...scrollPosition() });
  }, STILL_OPEN_INTERVAL_MS);
}

try {
  start();
} catch (error) {
  console.warn('[analytics] disabled:', error);
}

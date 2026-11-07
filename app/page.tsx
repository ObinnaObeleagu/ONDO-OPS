/**
 * Root route. middleware.ts already redirects a signed-in user to their
 * own portal before this ever renders — this page is only reached by a
 * signed-out visitor for the instant between request and redirect, or if
 * middleware is ever bypassed, so it sends them to /login rather than
 * showing anything.
 *
 * `force-dynamic` matters here, not just as a formality: with nothing
 * dynamic in this component (no cookies, no headers, no data fetch),
 * Next.js prerenders it once at build time as static HTML, and Vercel's
 * edge CDN will then cache and serve that static response directly —
 * which skips the server, and with it middleware.ts, entirely. That
 * turns `/` into a dead redirect frozen at whatever it resolved to at
 * build time, instead of the live per-request routing decision the rest
 * of the app depends on. This forces every request to actually reach
 * the server (and middleware) instead of being answered from cache.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function RootPage() {
  redirect('/login');
}

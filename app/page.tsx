/**
 * Root route. middleware.ts already redirects a signed-in user to their
 * own portal before this ever renders — this page is only reached by a
 * signed-out visitor for the instant between request and redirect, or if
 * middleware is ever bypassed, so it sends them to /login rather than
 * showing anything.
 */
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/login');
}

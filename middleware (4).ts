/**
 * Portal routing.
 *
 * Four portals, one application, one database:
 *
 *   /agent     a polling agent, their own unit only
 *   /ward      a ward coordinator, the units in their ward
 *   /lga       an LGA coordinator, the wards in their LGA
 *   /control   the district control room
 *
 * This middleware decides which portal a signed-in user is allowed to
 * open and sends them to their own one if they try another. It is a
 * convenience, not the security boundary: row-level security in the
 * database is the boundary (db/02_security.sql), and it holds even if
 * this file were deleted. A ward coordinator who forced their way to
 * /control would load the page and then find it empty of everything
 * outside their ward, because the queries behind it return nothing else.
 *
 * Speed: this runs on every click, so it makes ONE call to Supabase, not
 * two. It reads the session from the cookie (no network call unless the
 * token has expired and needs refreshing), then calls my_scope(). That
 * call is also the authentication check: Supabase's API verifies the
 * token's signature and refuses a forged or expired one. The result is
 * handed to the page in a request header (see lib/scope.ts), so the page
 * doesn't look the user up a second time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** Which portals each role may open. First entry is where they land. */
const ALLOWED: Record<string, string[]> = {
  agent:            ['/agent'],
  ward_coordinator: ['/ward', '/agent'],     // may also file a result themselves
  lga_coordinator:  ['/lga', '/ward'],       // may drill into any ward they cover
  admin:            ['/control', '/lga', '/ward', '/agent'],
  observer:         ['/control'],
};

// /api/ is passed straight through: every route under it checks the
// caller itself (session, role, RLS scope) and answers with JSON. Before
// this, the portal check below redirected /api/submit to the user's
// portal page, so a web submission could never reach the route.
const PUBLIC = ['/login', '/auth', '/_next', '/favicon.ico', '/api/'];

/** Header carrying my_scope() to the page. Only this file may set it. */
export const SCOPE_HEADER = 'x-portal-scope';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Never let a browser supply the scope header itself.
  const headers = new Headers(req.headers);
  headers.delete(SCOPE_HEADER);

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next({ request: { headers } });
  }

  // A refreshed session has to reach both the page rendering now (request
  // cookies) and the browser (response cookies).
  const refreshed: CookieToSet[] = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list: CookieToSet[]) =>
          list.forEach((c) => {
            req.cookies.set(c.name, c.value);
            refreshed.push(c);
          }),
      },
    },
  );
  const withCookies = (res: NextResponse) => {
    refreshed.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
    return res;
  };
  const toLogin = (params: Record<string, string>) => {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = new URLSearchParams(params).toString();
    return withCookies(NextResponse.redirect(url));
  };

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return toLogin({ next: pathname });
  }

  const { data: scope, error } = await supabase.rpc('my_scope');

  if (error) {
    // A token Supabase won't accept (expired, revoked, forged) means sign in again.
    const badToken = /jwt|token/i.test(error.message) || error.code === 'PGRST301' || error.code === 'PGRST302';
    console.error('[middleware] my_scope() failed:', error.message, error.code);
    return badToken ? toLogin({ next: pathname }) : toLogin({ error: 'not-provisioned' });
  }
  if (!scope?.signed_in) {
    console.warn('[middleware] signed in but not in app_users:', session.user?.id);
    return toLogin({ error: 'not-provisioned' });
  }

  const role = scope.role as string;
  const allowed = ALLOWED[role] ?? [];
  const home = allowed[0] ?? '/login';

  if (pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = home;
    url.search = '';
    return withCookies(NextResponse.redirect(url));
  }

  if (!allowed.some((p) => pathname.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = home;
    url.search = new URLSearchParams({ denied: pathname }).toString();
    return withCookies(NextResponse.redirect(url));
  }

  // Encoded because names can carry characters (ẹ, ọ, ṣ) a raw header can't.
  headers.set(SCOPE_HEADER, encodeURIComponent(JSON.stringify(scope)));
  headers.set('cookie', req.headers.get('cookie') ?? '');
  return withCookies(NextResponse.next({ request: { headers } }));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

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
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/** Which portals each role may open. First entry is where they land. */
const ALLOWED: Record<string, string[]> = {
  agent:            ['/agent'],
  ward_coordinator: ['/ward', '/agent'],     // may also file a result themselves
  lga_coordinator:  ['/lga', '/ward'],       // may drill into any ward they cover
  admin:            ['/control', '/lga', '/ward', '/agent'],
  observer:         ['/control'],
};

const PUBLIC = ['/login', '/auth', '/_next', '/favicon.ico', '/api/whatsapp'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options)),
      },
    },
  );

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // One call: role, scope, and the portal this person belongs in.
  const { data: scope, error } = await supabase.rpc('my_scope');

  if (error || !scope?.signed_in) {
    // Authenticated with Supabase but not provisioned in app_users.
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('error', 'not-provisioned');
    return NextResponse.redirect(url);
  }

  const role = scope.role as string;
  const allowed = ALLOWED[role] ?? [];
  const home = allowed[0] ?? '/login';

  if (pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = home;
    return NextResponse.redirect(url);
  }

  if (!allowed.some((p) => pathname.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = home;
    url.searchParams.set('denied', pathname);
    return NextResponse.redirect(url);
  }

  // Pass the scope down so pages do not each re-query it.
  res.headers.set('x-portal-role', role);
  res.headers.set('x-portal-scope', JSON.stringify(scope));
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

/**
 * Browser-side Supabase client, for the login page and any client
 * component that needs to react to auth state. Uses the public anon key
 * only — row-level security is what keeps this safe to ship to the browser.
 */
'use client';

import { createBrowserClient } from '@supabase/ssr';

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

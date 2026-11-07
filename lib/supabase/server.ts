/**
 * Server-side Supabase client, bound to the signed-in user's own cookies.
 * Row-level security applies as that user — this is the client every
 * server component and route handler should use for reads and writes
 * that are supposed to be scoped to the caller.
 */
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export function supabaseServer() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // called from a Server Component with no response to write to;
            // the middleware refresh covers this case
          }
        },
        remove: (name: string, options: CookieOptions) => {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // see above
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses row-level security entirely.
 *
 * Only for: the submit_result()/verify_result() RPC calls (which are
 * themselves SECURITY DEFINER and do their own checking), the WhatsApp
 * webhook (which has no Supabase session to carry), and scheduled jobs.
 * Never expose this client, or the key it holds, to anything that runs
 * in a browser.
 */
import { createClient } from '@supabase/supabase-js';

export function supabaseService() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

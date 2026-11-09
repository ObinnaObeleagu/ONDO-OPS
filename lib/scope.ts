/**
 * The signed-in user's role and scope, from my_scope() in
 * db/02_security.sql. Pages call this once at the top.
 *
 * middleware.ts has already decided the user may open the page; this is
 * for deciding what to show. Row-level security stays the real boundary.
 */
import { supabaseServer } from '@/lib/supabase/server';

export interface Scope {
  signed_in: boolean;
  user_id: string;
  full_name: string;
  role: 'agent' | 'ward_coordinator' | 'lga_coordinator' | 'admin' | 'observer';
  portal: string;
  lga_id: number | null;
  ward_id: number | null;
  pu_id: number | null;
  pu_count: number;
  can_verify: boolean;
  can_manage: boolean;
  read_only: boolean;
}

export async function getScope(): Promise<Scope | null> {
  const { data, error } = await supabaseServer().rpc('my_scope');
  if (error || !data?.signed_in) return null;
  return data as Scope;
}

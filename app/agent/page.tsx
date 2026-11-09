/**
 * Agent portal — the result form a polling agent fills in on their phone.
 *
 * A polling agent always reports for their own unit (my_scope().pu_id).
 * A ward coordinator can enter a result for any unit in their ward, and
 * an admin for any unit, by choosing it here (?ward= then ?pu=). That's
 * the fallback for an agent whose phone has died.
 *
 * The page only works out which unit and agent this is; the form itself
 * (AgentForm) uploads the photo to /api/ec8a and sends the figures to
 * /api/submit, which validates them and calls submit_result().
 */
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getScope } from '@/lib/scope';
import { timeOf } from '@/lib/format';
import PortalHeader from '@/components/PortalHeader';
import ScopePicker, { type PickerGroup } from '@/components/ScopePicker';
import AgentForm from './AgentForm';
import type { PuCurrent, Party, WardCoverage } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AgentPage({ searchParams }: { searchParams: { pu?: string; ward?: string } }) {
  const supabase = supabaseServer();
  const scope = await getScope();
  const isAgent = scope?.role === 'agent';

  // ---- which unit --------------------------------------------------
  let puId: number | null = isAgent ? scope?.pu_id ?? null : Number(searchParams.pu) || null;

  // Coordinators and admins choose a ward, then a unit in it.
  let wardId: number | null = null;
  let wardGroups: PickerGroup[] = [];
  let unitOptions: { value: string; label: string }[] = [];

  if (!isAgent) {
    if (scope?.role === 'ward_coordinator') {
      wardId = scope.ward_id;
    } else {
      const { data: wl } = await supabase.from('v_ward_coverage').select('ward_id, ward_name, lga_name')
        .order('lga_name').order('ward_code');
      const wards = (wl ?? []) as Pick<WardCoverage, 'ward_id' | 'ward_name' | 'lga_name'>[];
      for (const w of wards) {
        let g = wardGroups.find((x) => x.label === w.lga_name);
        if (!g) wardGroups.push((g = { label: w.lga_name, options: [] }));
        g.options.push({ value: String(w.ward_id), label: w.ward_name });
      }
      wardId = Number(searchParams.ward) || null;
      if (!wardId && puId) {
        const { data: p } = await supabase.from('polling_units').select('ward_id').eq('id', puId).maybeSingle();
        wardId = p?.ward_id ?? null;
      }
    }
    if (wardId) {
      const { data: ul } = await supabase.from('v_pu_current').select('pu_id, pu_name, inec_code, status')
        .eq('ward_id', wardId).order('inec_code');
      unitOptions = ((ul ?? []) as Pick<PuCurrent, 'pu_id' | 'pu_name' | 'inec_code' | 'status'>[]).map((u) => ({
        value: String(u.pu_id),
        label: `${u.inec_code} · ${u.pu_name}${u.status === 'not_reported' ? '' : ' (reported)'}`,
      }));
    }
  }

  // ---- the unit, its agent, the ballot -----------------------------
  const [puRes, agentRes, partyRes] = puId
    ? await Promise.all([
        supabase.from('v_pu_current').select('*').eq('pu_id', puId).maybeSingle(),
        supabase.from('agents').select('id, user_id, full_name, agent_phones(phone, is_primary, is_active)')
          .eq('pu_id', puId).eq('is_active', true).order('created_at'),
        supabase.from('parties').select('code, name, is_tracked, sort_order').order('sort_order'),
      ])
    : [{ data: null, error: null }, { data: [], error: null }, { data: [], error: null }];

  const pu = puRes.data as PuCurrent | null;
  type AgentRow = { id: string; user_id: string | null; full_name: string;
    agent_phones: { phone: string; is_primary: boolean; is_active: boolean }[] };
  const agents = (agentRes.data ?? []) as AgentRow[];
  const agent = (isAgent ? agents.find((a) => a.user_id === scope?.user_id) : null) ?? agents[0] ?? null;
  const phones = (agent?.agent_phones ?? []).filter((p) => p.is_active)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).map((p) => p.phone);
  const parties = (partyRes.data ?? []) as Party[];

  return (
    <div>
      <PortalHeader title="Submit result" subtitle={pu ? pu.pu_name : 'Ondo North'} current="/agent" scope={scope} />
      <div className="wrap" style={{ maxWidth: 560 }}>
        {!isAgent && (
          <div className="panel" style={{ marginBottom: 14 }}>
            <h3>Entering a result on an agent&apos;s behalf</h3>
            <div className="sub">Use this when the agent cannot submit themselves. The record shows it was you.</div>
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              {scope?.role !== 'ward_coordinator' && (
                <ScopePicker label="Ward" param="ward" value={wardId ? String(wardId) : null}
                  groups={wardGroups} placeholder="Choose a ward…" />
              )}
              {wardId && (
                <ScopePicker label="Unit" param="pu" value={puId ? String(puId) : null}
                  groups={[{ options: unitOptions }]} placeholder="Choose a polling unit…"
                  keep={scope?.role === 'ward_coordinator' ? undefined : { ward: String(wardId) }} />
              )}
            </div>
          </div>
        )}

        {isAgent && !puId && (
          <div className="panel"><div className="empty">
            No polling unit is linked to your account yet. Call your ward coordinator.
          </div></div>
        )}

        {puId && !pu && (
          <div className="panel"><div className="empty">
            That polling unit is not assigned to you. {!isAgent && <Link href="/agent">Choose another</Link>}
          </div></div>
        )}

        {pu && (
          <>
            {pu.status !== 'not_reported' && (
              <div className="viewnote">
                A result for this unit was already sent at {timeOf(pu.submitted_at)} (reference{' '}
                <b>{pu.submission_id?.slice(0, 8).toUpperCase()}</b>, {pu.status}). Sending again records a
                correction — the earlier result is kept, and the control room is told.
              </div>
            )}
            <AgentForm
              key={pu.pu_id}
              pu={{
                id: pu.pu_id,
                name: pu.pu_name,
                code: pu.inec_code,
                ward: pu.ward_name,
                lga: pu.lga_name,
                registered: pu.registered_voters,
              }}
              agent={agent ? { id: agent.id, name: agent.full_name, phones } : null}
              parties={parties.map((p) => ({ code: p.code, name: p.name, tracked: p.is_tracked }))}
              anotherHref={isAgent ? null : `/agent${scope?.role === 'ward_coordinator' ? '' : `?ward=${pu.ward_id}`}`}
            />
          </>
        )}
      </div>
    </div>
  );
}

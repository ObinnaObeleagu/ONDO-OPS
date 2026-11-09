/**
 * Ward portal — a ward coordinator checks each result against its EC8A
 * photo and verifies or disputes it, and chases the units that are quiet.
 *
 * A ward coordinator always sees their own ward. An LGA coordinator picks
 * a ward inside their LGA, and an admin picks any ward, with ?ward=.
 * Everything is read through the user's own session, so RLS applies.
 *
 * EC8A photos sit in a private bucket. For the rows RLS has already let
 * this user read, the page makes short-lived signed links (15 minutes),
 * so a photo is never at a permanent public address.
 */
import Link from 'next/link';
import { supabaseServer, supabaseService } from '@/lib/supabase/server';
import { getScope } from '@/lib/scope';
import { fmt, timeOf } from '@/lib/format';
import { telHref, waHref } from '@/lib/portals';
import PortalHeader from '@/components/PortalHeader';
import ScopePicker, { type PickerGroup } from '@/components/ScopePicker';
import { StatusStack, StatusChip } from '@/components/Charts';
import VerifyActions from '@/components/VerifyActions';
import type { WardCoverage, PuCurrent, AgentWithPhones } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function WardPage({ searchParams }: { searchParams: { ward?: string } }) {
  const supabase = supabaseServer();
  const scope = await getScope();

  const { data: wardList } = await supabase
    .from('v_ward_coverage')
    .select('*')
    .order('lga_name')
    .order('ward_code');
  let wards = (wardList ?? []) as WardCoverage[];
  if (scope?.role === 'lga_coordinator') wards = wards.filter((w) => w.lga_id === scope.lga_id);

  let wardId: number | null;
  if (scope?.role === 'ward_coordinator') {
    wardId = scope.ward_id;
  } else {
    const asked = Number(searchParams.ward);
    wardId = wards.some((w) => w.ward_id === asked) ? asked : wards[0]?.ward_id ?? null;
  }
  const ward = wards.find((w) => w.ward_id === wardId) ?? null;

  const { data: puData, error: puErr } = wardId
    ? await supabase.from('v_pu_current').select('*').eq('ward_id', wardId).order('inec_code')
    : { data: [], error: null };
  const pus = (puData ?? []) as PuCurrent[];
  const puIds = pus.map((p) => p.pu_id);
  const subIds = pus.map((p) => p.submission_id).filter((x): x is string => !!x);

  const [agentsRes, votesRes, photosRes] = await Promise.all([
    puIds.length
      ? supabase
          .from('agents')
          .select('id, pu_id, full_name, agent_phones(phone, label, is_primary, whatsapp_enabled, consent_recorded_at, is_active)')
          .in('pu_id', puIds)
          .eq('is_active', true)
      : Promise.resolve({ data: [], error: null }),
    subIds.length
      ? supabase.from('submission_party_votes').select('submission_id, votes, parties(code, sort_order)').in('submission_id', subIds)
      : Promise.resolve({ data: [], error: null }),
    subIds.length
      ? supabase.from('result_submissions').select('id, ec8a_photo_path').in('id', subIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const agentsByPu = new Map<number, AgentWithPhones[]>();
  for (const a of (agentsRes.data ?? []) as AgentWithPhones[]) {
    agentsByPu.set(a.pu_id, [...(agentsByPu.get(a.pu_id) ?? []), a]);
  }

  type VoteRow = { submission_id: string; votes: number; parties: { code: string; sort_order: number } | null };
  const votesBySub = new Map<string, { code: string; votes: number; order: number }[]>();
  for (const v of (votesRes.data ?? []) as unknown as VoteRow[]) {
    if (!v.parties || v.votes <= 0) continue;
    const list = votesBySub.get(v.submission_id) ?? [];
    list.push({ code: v.parties.code, votes: v.votes, order: v.parties.sort_order });
    votesBySub.set(v.submission_id, list);
  }

  // Signed links for the photos of rows this user can already read.
  const photoPaths = ((photosRes.data ?? []) as { id: string; ec8a_photo_path: string | null }[])
    .filter((r) => r.ec8a_photo_path && r.ec8a_photo_path.trim() !== '');
  const photoUrlBySub = new Map<string, string>();
  if (photoPaths.length) {
    const { data: signed } = await supabaseService()
      .storage.from('ec8a')
      .createSignedUrls(photoPaths.map((r) => r.ec8a_photo_path!), 900);
    (signed ?? []).forEach((s, i) => {
      if (s.signedUrl) photoUrlBySub.set(photoPaths[i].id, s.signedUrl);
    });
  }

  const reported = pus.filter((p) => p.status !== 'not_reported');
  const verified = pus.filter((p) => p.status === 'verified').length;
  const disputed = pus.filter((p) => p.status === 'disputed').length;
  const pending = pus.filter((p) => p.status === 'pending').length;
  const outstanding = pus.length - reported.length;
  const validVotes = reported.reduce((t, p) => t + (p.total_valid_votes ?? 0), 0);
  const registered = pus.reduce((t, p) => t + p.registered_voters, 0);
  const canEnterResult = scope?.role === 'ward_coordinator' || scope?.role === 'admin';

  const groups: PickerGroup[] = [];
  for (const w of wards) {
    let g = groups.find((x) => x.label === w.lga_name);
    if (!g) groups.push((g = { label: w.lga_name, options: [] }));
    g.options.push({ value: String(w.ward_id), label: w.ward_name });
  }

  return (
    <div>
      <PortalHeader
        title="Ward"
        subtitle={ward ? `${ward.ward_name}, ${ward.lga_name}` : 'Ondo North'}
        current="/ward"
        scope={scope}
      />
      <div className="wrap">
        {scope?.role !== 'ward_coordinator' && (
          <div className="spread">
            <ScopePicker label="Ward" param="ward" value={wardId ? String(wardId) : null}
              groups={scope?.role === 'lga_coordinator' ? [{ options: groups[0]?.options ?? [] }] : groups} />
            {ward && scope?.role !== 'lga_coordinator' && (
              <Link className="linkbtn" href={`/lga?lga=${ward.lga_id}`}>← {ward.lga_name}</Link>
            )}
          </div>
        )}

        {(puErr || agentsRes.error || votesRes.error) && (
          <div className="viewnote" style={{ borderLeftColor: 'var(--critical)' }}>
            Some figures may be incomplete — a data source failed to load. Refresh to try again.
          </div>
        )}

        {!ward ? (
          <div className="panel"><div className="empty">No ward is assigned to your account. Contact an admin.</div></div>
        ) : (
          <>
            <div className="stats" style={{ marginBottom: 14 }}>
              <div className="stat">
                <div className="k">Reported</div>
                <div className="v">
                  {reported.length}<span style={{ fontSize: 15, color: 'var(--muted)' }}> / {pus.length}</span>
                </div>
                <div className="d">{ward.ward_name}, {ward.lga_name}</div>
              </div>
              <div className="stat">
                <div className="k">To verify</div>
                <div className="v">{pending}</div>
                <div className="d">results awaiting your check</div>
              </div>
              <div className={`stat ${disputed ? 'alarm' : ''}`}>
                <div className="k">Disputed</div>
                <div className="v">{disputed}</div>
                <div className="d">failed a check or queried</div>
              </div>
              <div className="stat">
                <div className="k">Valid votes</div>
                <div className="v">{fmt(validVotes)}</div>
                <div className="d">of {fmt(registered)} registered</div>
              </div>
            </div>

            <div className="panel" style={{ marginBottom: 14 }}>
              <h3>Ward progress</h3>
              <div className="sub">{reported.length} of {pus.length} units in</div>
              <StatusStack verified={verified} pending={pending} disputed={disputed} outstanding={outstanding} />
            </div>

            <div className="panel">
              <h3>Polling units</h3>
              <div className="sub">Open the EC8A photo and check the figures against it before verifying</div>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Unit</th><th>Code</th><th>Agent</th><th className="n">Reg.</th>
                      <th className="n">Votes</th><th>EC8A</th><th>Status</th><th style={{ width: 190 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pus.length === 0 && (
                      <tr><td colSpan={8} className="empty">No polling units are loaded for this ward yet.</td></tr>
                    )}
                    {pus.map((p) => {
                      const agents = agentsByPu.get(p.pu_id) ?? [];
                      const phones = agents.flatMap((a) => a.agent_phones.filter((ph) => ph.is_active))
                        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
                      const consented = phones.filter((ph) => ph.consent_recorded_at);
                      const wa = consented.find((ph) => ph.whatsapp_enabled);
                      const cast = (p.total_valid_votes ?? 0) + (p.rejected_votes ?? 0);
                      const over = p.status !== 'not_reported' && cast > p.registered_voters;
                      const breakdown = p.submission_id
                        ? (votesBySub.get(p.submission_id) ?? []).sort((a, b) => a.order - b.order)
                        : [];
                      const photoUrl = p.submission_id ? photoUrlBySub.get(p.submission_id) : undefined;
                      return (
                        <tr key={p.pu_id}>
                          <td style={{ color: 'var(--ink)' }}>
                            {p.pu_name}
                            {p.remarks && <div className="pvotes" style={{ maxWidth: 260 }}>“{p.remarks}”</div>}
                          </td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.inec_code}</td>
                          <td>
                            {agents.length ? agents.map((a) => a.full_name).join(', ')
                              : <span style={{ color: 'var(--warning)' }}>No agent assigned</span>}
                            {phones.map((ph, i) => (
                              <div key={ph.phone} className="pvotes" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span>{ph.phone}</span>
                                {i === 0 && <span className="tag">primary</span>}
                                {ph.whatsapp_enabled && ph.consent_recorded_at && <span className="tag wa">WA</span>}
                                {!ph.consent_recorded_at && <span className="tag no">no consent</span>}
                              </div>
                            ))}
                          </td>
                          <td className="n">{fmt(p.registered_voters)}</td>
                          <td className="n" style={over ? { color: 'var(--critical)', fontWeight: 680 } : undefined}>
                            {p.status === 'not_reported' ? '—' : fmt(cast)}
                            {breakdown.length > 0 && (
                              <div className="pvotes">{breakdown.map((b) => `${b.code} ${fmt(b.votes)}`).join(' · ')}</div>
                            )}
                            {p.submitted_at && <div className="pvotes">at {timeOf(p.submitted_at)}</div>}
                          </td>
                          <td>
                            {p.status === 'not_reported' ? '—'
                              : photoUrl ? <a href={photoUrl} target="_blank" rel="noopener noreferrer">View photo</a>
                              : p.has_ec8a ? <span style={{ color: 'var(--muted)' }}>attached</span>
                              : <span style={{ color: 'var(--warning)' }}>✕ missing</span>}
                          </td>
                          <td><StatusChip status={p.status} /></td>
                          <td>
                            {p.status === 'not_reported' && (
                              <div className="row">
                                {consented[0] && <a className="linkbtn" href={telHref(consented[0].phone)}>Call</a>}
                                {wa && (
                                  <a className="linkbtn" target="_blank" rel="noopener noreferrer"
                                    href={waHref(wa.phone, `Hello, we have not received the result for ${p.pu_name} (${p.inec_code}). Please send it now.`)}>
                                    WhatsApp
                                  </a>
                                )}
                                {canEnterResult && <Link className="linkbtn" href={`/agent?pu=${p.pu_id}`}>Enter result</Link>}
                              </div>
                            )}
                            {p.status === 'pending' && p.submission_id && scope?.can_verify && (
                              <VerifyActions submissionId={p.submission_id} hasEc8a={!!p.has_ec8a} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

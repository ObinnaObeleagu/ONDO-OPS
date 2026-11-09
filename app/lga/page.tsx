/**
 * LGA portal — an LGA coordinator's view of their wards, plus the chase
 * list of units that have not reported.
 *
 * An LGA coordinator always sees their own LGA (from my_scope()). An
 * admin picks one with ?lga=. Reads go through the user's own session,
 * so RLS applies: a coordinator who edits the URL to another LGA gets
 * their own LGA back, and the views would return nothing outside it anyway.
 */
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getScope } from '@/lib/scope';
import { fmt, timeOf, units } from '@/lib/format';
import { telHref, waHref } from '@/lib/portals';
import PortalHeader from '@/components/PortalHeader';
import ScopePicker from '@/components/ScopePicker';
import { CoverageBar, StatusStack, PartyBars } from '@/components/Charts';
import type { LgaCoverage, WardCoverage, PartyTotalByLga, OutstandingPu } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function LgaPage({ searchParams }: { searchParams: { lga?: string } }) {
  const supabase = supabaseServer();
  const scope = await getScope();

  const { data: lgaList } = await supabase.from('v_lga_coverage').select('*').order('lga_name');
  const lgas = (lgaList ?? []) as LgaCoverage[];

  const lgaId =
    scope?.role === 'lga_coordinator'
      ? scope.lga_id
      : Number(searchParams.lga) || lgas[0]?.lga_id || null;

  const lga = lgas.find((l) => l.lga_id === lgaId) ?? null;

  const [wardsRes, partiesRes, outRes] = lgaId
    ? await Promise.all([
        supabase.from('v_ward_coverage').select('*').eq('lga_id', lgaId).order('ward_code'),
        supabase.from('v_party_totals_by_lga').select('*').eq('lga_id', lgaId),
        supabase.from('v_outstanding_pus').select('*').eq('lga_id', lgaId).limit(300),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

  const loadError = wardsRes.error || partiesRes.error || outRes.error;
  const wards = (wardsRes.data ?? []) as WardCoverage[];
  const parties = (partiesRes.data ?? []) as PartyTotalByLga[];
  const outstanding = (outRes.data ?? []) as OutstandingPu[];

  const pending = lga ? lga.reported_pus - lga.verified_pus - lga.disputed_pus : 0;

  return (
    <div>
      <PortalHeader title="LGA" subtitle={lga ? lga.lga_name : 'Ondo North'} current="/lga" scope={scope} />
      <div className="wrap">
        {scope?.role !== 'lga_coordinator' && (
          <div className="spread">
            <ScopePicker
              label="Local government"
              param="lga"
              value={lgaId ? String(lgaId) : null}
              groups={[{ options: lgas.map((l) => ({ value: String(l.lga_id), label: l.lga_name })) }]}
            />
          </div>
        )}

        {loadError && (
          <div className="viewnote" style={{ borderLeftColor: 'var(--critical)' }}>
            Some figures may be incomplete — a data source failed to load ({loadError.message}). Refresh to try again.
          </div>
        )}

        {!lga ? (
          <div className="panel"><div className="empty">No LGA is assigned to your account. Contact an admin.</div></div>
        ) : (
          <>
            <div className="stats" style={{ marginBottom: 14 }}>
              <div className="stat">
                <div className="k">Units reported</div>
                <div className="v">
                  {fmt(lga.reported_pus)}
                  <span style={{ fontSize: 15, color: 'var(--muted)' }}> / {fmt(lga.total_pus)}</span>
                </div>
                <div className="d">{lga.reported_pct}% across {lga.total_wards} wards</div>
              </div>
              <div className="stat">
                <div className="k">Outstanding</div>
                <div className="v">{fmt(lga.outstanding_pus)}</div>
                <div className="d">units yet to send a result</div>
              </div>
              <div className={`stat ${lga.disputed_pus ? 'alarm' : ''}`}>
                <div className="k">Disputed</div>
                <div className="v">{fmt(lga.disputed_pus)}</div>
                <div className="d">failed a check or queried</div>
              </div>
              <div className="stat">
                <div className="k">Valid votes</div>
                <div className="v">{fmt(lga.valid_votes)}</div>
                <div className="d">{fmt(lga.rejected_votes)} rejected · last at {timeOf(lga.last_report_at)}</div>
              </div>
            </div>

            <div className="grid twocol" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
              <div className="panel">
                <h3>Ward by ward</h3>
                <div className="sub">Reporting progress inside {lga.lga_name} — click a ward to open it</div>
                <div className="bars">
                  {wards.map((w) => (
                    <CoverageBar
                      key={w.ward_id}
                      label={w.ward_name}
                      done={w.reported_pus}
                      total={w.total_pus}
                      href={`/ward?ward=${w.ward_id}`}
                      tip={`${w.ward_name}: ${w.reported_pus} of ${w.total_pus} reported · ${w.outstanding_pus} outstanding`}
                    />
                  ))}
                </div>
              </div>
              <div className="panel">
                <h3>Vote totals in {lga.lga_name}</h3>
                <div className="sub">From {units(lga.reported_pus)} reported — not a projection</div>
                <PartyBars rows={parties.map((p) => ({ code: p.party_code, name: p.party_name, votes: p.votes }))} />
                <div style={{ marginTop: 15, paddingTop: 13, borderTop: '1px solid var(--border)' }}>
                  <h3>Unit status</h3>
                  <div className="sub">All {fmt(lga.total_pus)} units in this LGA</div>
                  <StatusStack
                    verified={lga.verified_pus}
                    pending={pending}
                    disputed={lga.disputed_pus}
                    outstanding={lga.outstanding_pus}
                  />
                </div>
              </div>
            </div>

            <div className="panel" style={{ marginTop: 14 }}>
              <div className="spread">
                <div>
                  <h3>Chase list</h3>
                  <div className="sub" style={{ margin: 0 }}>
                    {lga.outstanding_pus === 0 ? 'Every unit has reported.' : `${units(lga.outstanding_pus)} ${lga.outstanding_pus === 1 ? 'has' : 'have'} not reported. Work down this list.`}
                  </div>
                </div>
              </div>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Ward</th><th>Polling unit</th><th>Code</th><th>Agent</th>
                      <th className="n">Registered</th><th style={{ width: 150 }}>Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.length === 0 && (
                      <tr><td colSpan={6} className="empty">Every unit has reported.</td></tr>
                    )}
                    {outstanding.map((p) => (
                      <tr key={p.pu_id}>
                        <td><Link className="plain" href={`/ward?ward=${p.ward_id}`}>{p.ward_name}</Link></td>
                        <td style={{ color: 'var(--ink)' }}>{p.pu_name}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.inec_code}</td>
                        <td>
                          {p.agent_name ?? <span style={{ color: 'var(--warning)' }}>No agent assigned</span>}
                          {p.agent_phone && (
                            <div className="pvotes">
                              {p.agent_phone}
                              {(p.agent_phones?.length ?? 0) > 1 ? ` +${(p.agent_phones?.length ?? 1) - 1} more` : ''}
                            </div>
                          )}
                        </td>
                        <td className="n">{fmt(p.registered_voters)}</td>
                        <td>
                          <div className="row">
                            {p.contactable && p.agent_phone && (
                              <a className="linkbtn" href={telHref(p.agent_phone)}>Call</a>
                            )}
                            {!p.contactable && p.agent_phone && <span className="tag no">no consent</span>}
                            {p.contactable && p.whatsapp_phone && (
                              <a className="linkbtn" target="_blank" rel="noopener noreferrer"
                                href={waHref(p.whatsapp_phone, `Hello ${p.agent_name ?? ''}, we have not received the result for ${p.pu_name} (${p.inec_code}). Please send it now.`)}>
                                WhatsApp
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
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

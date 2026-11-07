/**
 * Control Room — the district-wide view for admins and observers.
 *
 * Pulls live from the reporting views in db/03_views.sql through the
 * signed-in user's own Supabase session, so row-level security applies
 * exactly as it does everywhere else (see middleware.ts): an admin or
 * observer passes `can_read_all()` and sees the whole district; nothing
 * here bypasses RLS to do that.
 *
 * `force-dynamic` because every number on this page is a live read —
 * see app/page.tsx for why a static/cacheable page is dangerous here.
 */
import { supabaseServer } from '@/lib/supabase/server';
import { fmt, timeOf, pctColor, flagLabel, flagIcon } from '@/lib/format';
import type { DistrictSummary, PartyTotal, LgaCoverage, OpenAlert, IncidentRemark } from '@/lib/types';
import SignOutButton from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

export default async function ControlPage() {
  const supabase = supabaseServer();

  const [summaryRes, partiesRes, lgasRes, alertsRes, remarksRes] = await Promise.all([
    supabase.from('v_district_summary').select('*').single(),
    supabase.from('v_party_totals').select('*').order('votes', { ascending: false }),
    supabase.from('v_lga_coverage').select('*').order('lga_name'),
    supabase.from('v_open_alerts').select('*'),
    supabase.from('v_incident_remarks').select('*').limit(14),
  ]);

  const loadError =
    summaryRes.error || partiesRes.error || lgasRes.error || alertsRes.error || remarksRes.error;

  const s = (summaryRes.data ?? null) as DistrictSummary | null;
  const parties = (partiesRes.data ?? []) as PartyTotal[];
  const lgas = (lgasRes.data ?? []) as LgaCoverage[];
  const alerts = (alertsRes.data ?? []) as OpenAlert[];
  const remarks = (remarksRes.data ?? []) as IncidentRemark[];

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const missingEc8aCount = alerts.filter((a) => a.type === 'MISSING_EC8A').length;
  const maxPartyVotes = Math.max(1, ...parties.map((p) => p.votes));
  const totalPartyVotes = Math.max(1, parties.reduce((t, p) => t + p.votes, 0));

  return (
    <div>
      <div className="topbar">
        <div className="brand">
          <strong><span className="livedot" />Control Room</strong>
          <span>Ondo North senatorial district</span>
        </div>
        <SignOutButton />
      </div>

      <div className="wrap">
        {loadError && (
          <div className="viewnote" style={{ borderLeftColor: 'var(--critical)' }}>
            Some figures below may be incomplete — a data source failed to load
            ({loadError.message}). Refresh to try again.
          </div>
        )}

        {s && (
          <div className="stats" style={{ marginBottom: 14 }}>
            <div className="stat">
              <div className="k">Units reported</div>
              <div className="v">
                {fmt(s.reported_pus)}
                <span style={{ fontSize: 15, color: 'var(--muted)' }}> / {fmt(s.total_pus)}</span>
              </div>
              <div className="d">{s.reported_pct}% of the district</div>
            </div>
            <div className="stat">
              <div className="k">Votes counted</div>
              <div className="v">{fmt(s.valid_votes)}</div>
              <div className="d">{fmt(s.rejected_votes)} rejected ballots</div>
            </div>
            <div className="stat">
              <div className="k">Turnout so far</div>
              <div className="v">{s.turnout_pct_of_reported ?? '—'}%</div>
              <div className="d">of registered voters across the district</div>
            </div>
            <div className={`stat ${criticalCount ? 'alarm' : ''}`}>
              <div className="k">Open alerts</div>
              <div className="v">{fmt(alerts.length)}</div>
              <div className="d">{criticalCount} critical, needs a call now</div>
            </div>
            <div className="stat">
              <div className="k">Awaiting EC8A</div>
              <div className="v">{fmt(missingEc8aCount)}</div>
              <div className="d">cannot be verified without the photo</div>
            </div>
          </div>
        )}

        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)' }}>
          <div className="panel">
            <h3>Reporting progress by LGA</h3>
            <div className="sub">Share of polling units that have sent a result</div>
            <div className="bars">
              {lgas.map((l) => (
                <CoverageBarRow
                  key={l.lga_id}
                  label={l.lga_name}
                  done={l.reported_pus}
                  total={l.total_pus}
                  tip={`${l.lga_name}: ${l.reported_pus} of ${l.total_pus} units · ${l.outstanding_pus} outstanding`}
                />
              ))}
            </div>
            {s && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <h3>Status of every unit in the district</h3>
                <div className="sub">All {fmt(s.total_pus)} polling units</div>
                <StatusStack
                  verified={s.verified_pus}
                  pending={s.pending_pus}
                  disputed={s.disputed_pus}
                  outstanding={s.outstanding_pus}
                />
              </div>
            )}
          </div>

          <div className="panel">
            <h3>Running vote totals</h3>
            <div className="sub">
              Across the {fmt(s?.reported_pus)} units reported so far — not a projection
            </div>
            {parties
              .filter((p) => p.votes > 0)
              .map((p) => (
                <div className="party" key={p.party_id}>
                  <div className="code" style={{ color: `var(--p-${p.party_code})` }}>
                    {p.party_code}
                  </div>
                  <div className="track" data-tip={`${p.party_name}: ${fmt(p.votes)} votes`}>
                    <div
                      className="fill"
                      style={{
                        width: `${(100 * p.votes) / maxPartyVotes}%`,
                        background: `var(--p-${p.party_code})`,
                      }}
                    />
                  </div>
                  <div>
                    <span className="num">{fmt(p.votes)}</span>
                    <span className="pct">{((100 * p.votes) / totalPartyVotes).toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            {s && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 11,
                  borderTop: '1px solid var(--border)',
                  fontSize: '11.5px',
                  color: 'var(--muted)',
                }}
              >
                Figures come only from submitted EC8A forms. {fmt(s.outstanding_pus)} units are
                still outstanding, so these totals will move.
              </div>
            )}
          </div>
        </div>

        <div
          className="grid"
          style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', marginTop: 14 }}
        >
          <div className="panel">
            <div className="spread">
              <div>
                <h3>Alerts</h3>
                <div className="sub" style={{ margin: 0 }}>
                  Critical first. Each one is a phone call.
                </div>
              </div>
            </div>
            <div className="scroll">
              {alerts.length === 0 && <div className="empty">No open alerts.</div>}
              {alerts.slice(0, 40).map((a) => (
                <div className={`alert ${a.severity}`} key={a.id}>
                  <div
                    className="ico"
                    style={{ color: a.severity === 'critical' ? 'var(--critical)' : 'var(--warning)' }}
                  >
                    {flagIcon(a.severity)}
                  </div>
                  <div className="body">
                    <div className="t">
                      {flagLabel(a.type)} — {a.pu_name}
                    </div>
                    <div className="m">{a.detail}</div>
                    <div className="w">
                      {a.lga_name} · {a.ward_name} · {a.inec_code}
                      {a.agent_name ? ` · ${a.agent_name}` : ''}
                      {a.agent_phone ? ` ${a.agent_phone}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>Incident remarks from agents</h3>
            <div className="sub">What agents wrote alongside their figures</div>
            <div className="scroll">
              {remarks.length === 0 && <div className="empty">No remarks yet.</div>}
              {remarks.map((r) => (
                <div
                  className="alert"
                  style={{ borderLeft: '3px solid var(--accent)' }}
                  key={r.submission_id}
                >
                  <div className="body">
                    <div className="m">&ldquo;{r.remarks}&rdquo;</div>
                    <div className="w">
                      {r.agent_name ?? 'Unknown agent'} · {r.pu_name} · {r.ward_name},{' '}
                      {r.lga_name} · {timeOf(r.submitted_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 14 }}>
          <div className="spread">
            <div>
              <h3>Every LGA at a glance</h3>
              <div className="sub" style={{ margin: 0 }}>
                Figures refresh on every page load
              </div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>LGA</th>
                <th>Wards</th>
                <th className="n">Units</th>
                <th className="n">Reported</th>
                <th className="n">Outstanding</th>
                <th className="n">Disputed</th>
                <th className="n">Registered</th>
                <th className="n">Valid votes</th>
                <th style={{ width: 120 }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {lgas.map((l) => (
                <tr key={l.lga_id}>
                  <td style={{ color: 'var(--ink)', fontWeight: 600 }}>{l.lga_name}</td>
                  <td>{l.total_wards}</td>
                  <td className="n">{fmt(l.total_pus)}</td>
                  <td className="n">{fmt(l.reported_pus)}</td>
                  <td
                    className="n"
                    style={l.outstanding_pus > 60 ? { color: 'var(--serious)', fontWeight: 650 } : undefined}
                  >
                    {fmt(l.outstanding_pus)}
                  </td>
                  <td
                    className="n"
                    style={l.disputed_pus ? { color: 'var(--critical)', fontWeight: 650 } : undefined}
                  >
                    {fmt(l.disputed_pus)}
                  </td>
                  <td className="n">{fmt(l.registered_voters)}</td>
                  <td className="n">{fmt(l.valid_votes)}</td>
                  <td>
                    <div className="track" style={{ height: 9 }} data-tip={`${l.reported_pct}% reported`}>
                      <div
                        className="fill"
                        style={{ width: `${l.reported_pct}%`, background: pctColor(l.reported_pct) }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CoverageBarRow({
  label,
  done,
  total,
  tip,
}: {
  label: string;
  done: number;
  total: number;
  tip: string;
}) {
  const pct = total ? (100 * done) / total : 0;
  return (
    <div className="barrow">
      <div className="lbl" title={label}>
        {label}
      </div>
      <div className="track" data-tip={tip}>
        <div className="fill" style={{ width: `${pct}%`, background: pctColor(pct) }} />
      </div>
      <div className="num">{pct.toFixed(0)}%</div>
    </div>
  );
}

function StatusStack({
  verified,
  pending,
  disputed,
  outstanding,
}: {
  verified: number;
  pending: number;
  disputed: number;
  outstanding: number;
}) {
  const seg = (n: number, color: string) => (n ? { flexGrow: n, background: color } : null);
  return (
    <>
      <div className="stack">
        {verified > 0 && <div style={seg(verified, 'var(--good)') as React.CSSProperties} />}
        {pending > 0 && <div style={seg(pending, 'var(--accent)') as React.CSSProperties} />}
        {disputed > 0 && <div style={seg(disputed, 'var(--critical)') as React.CSSProperties} />}
        {outstanding > 0 && <div style={seg(outstanding, 'var(--axis)') as React.CSSProperties} />}
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--good)' }} />Verified {fmt(verified)}
        </span>
        <span>
          <i style={{ background: 'var(--accent)' }} />Pending {fmt(pending)}
        </span>
        <span>
          <i style={{ background: 'var(--critical)' }} />Disputed {fmt(disputed)}
        </span>
        <span>
          <i style={{ background: 'var(--axis)' }} />Not reported {fmt(outstanding)}
        </span>
      </div>
    </>
  );
}

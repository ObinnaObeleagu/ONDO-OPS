/**
 * Chart pieces shared by the control, LGA and ward pages. Plain markup
 * and CSS (see .barrow, .stack, .party in app/globals.css): no chart
 * library, nothing to load on a weak connection.
 */
import Link from 'next/link';
import { fmt, pctColor } from '@/lib/format';

export function CoverageBar({
  label,
  done,
  total,
  tip,
  href,
}: {
  label: string;
  done: number;
  total: number;
  tip?: string;
  href?: string;
}) {
  const pct = total ? (100 * done) / total : 0;
  return (
    <div className="barrow">
      <div className="lbl" title={label}>
        {href ? <Link href={href}>{label}</Link> : label}
      </div>
      <div className="track" title={tip ?? `${done} of ${total} units reported`}>
        <div className="fill" style={{ width: `${pct}%`, background: pctColor(pct) }} />
      </div>
      <div className="num">{total ? `${pct.toFixed(0)}%` : '—'}</div>
    </div>
  );
}

export function StatusStack({
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
  const segs: [number, string, string][] = [
    [verified, 'var(--good)', 'Verified'],
    [pending, 'var(--accent)', 'Pending check'],
    [disputed, 'var(--critical)', 'Disputed'],
    [outstanding, 'var(--axis)', 'Not reported'],
  ];
  return (
    <>
      <div className="stack">
        {segs.map(([n, color, label]) =>
          n > 0 ? (
            <div key={label} style={{ flexGrow: n, background: color }} title={`${label}: ${fmt(n)} units`} />
          ) : null,
        )}
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--good)' }} />Verified {fmt(verified)}</span>
        <span><i style={{ background: 'var(--accent)' }} />Pending {fmt(pending)}</span>
        <span><i style={{ background: 'var(--critical)' }} />Disputed {fmt(disputed)}</span>
        <span><i style={{ background: 'var(--axis)' }} />Not reported {fmt(outstanding)}</span>
      </div>
    </>
  );
}

export function PartyBars({
  rows,
}: {
  rows: { code: string; name: string; votes: number }[];
}) {
  const shown = rows.filter((r) => r.votes > 0).sort((a, b) => b.votes - a.votes);
  if (shown.length === 0) return <div className="empty">No votes recorded yet.</div>;
  const max = Math.max(1, ...shown.map((r) => r.votes));
  const total = Math.max(1, shown.reduce((t, r) => t + r.votes, 0));
  return (
    <>
      {shown.map((r) => (
        <div className="party" key={r.code}>
          <div className="code" style={{ color: `var(--p-${r.code}, var(--p-OTHER))` }}>{r.code}</div>
          <div className="track" title={`${r.name}: ${fmt(r.votes)} votes`}>
            <div
              className="fill"
              style={{ width: `${(100 * r.votes) / max}%`, background: `var(--p-${r.code}, var(--p-OTHER))` }}
            />
          </div>
          <div>
            <span className="num">{fmt(r.votes)}</span>
            <span className="pct">{((100 * r.votes) / total).toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </>
  );
}

export function StatusChip({ status }: { status: string }) {
  if (status === 'verified') return <span className="chip verified"><i />Verified</span>;
  if (status === 'disputed') return <span className="chip disputed"><i />Disputed</span>;
  if (status === 'pending') return <span className="chip pending"><i />Pending</span>;
  return <span className="chip waiting"><i />Not reported</span>;
}

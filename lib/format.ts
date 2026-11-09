/** Shared number/time formatting for the portal pages. */

export function fmt(n: number | null | undefined): string {
  return new Intl.NumberFormat('en-NG').format(n ?? 0);
}

export function timeOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function pctColor(pct: number): string {
  return pct >= 80 ? 'var(--good)' : pct >= 50 ? 'var(--warning)' : 'var(--serious)';
}

/** Human label for a flag_type enum value, e.g. 'MISSING_EC8A' -> 'No EC8A photo'. */
export function flagLabel(type: string): string {
  const labels: Record<string, string> = {
    OVER_VOTE: 'Over-vote',
    EXCEEDS_ACCREDITED: 'Exceeds accredited',
    MISSING_EC8A: 'No EC8A photo',
    LATE_REPORT: 'Not reported',
    TOTAL_MISMATCH: 'Total mismatch',
    CORRECTION: 'Correction',
    MANUAL_DISPUTE: 'Disputed by coordinator',
  };
  return labels[type] ?? type;
}

export function flagIcon(severity: string): string {
  return severity === 'critical' ? '!' : severity === 'warning' ? '▢' : '◷';
}

/** "1 unit" / "3 units" */
export function units(n: number | null | undefined): string {
  return `${fmt(n)} ${n === 1 ? 'unit' : 'units'}`;
}

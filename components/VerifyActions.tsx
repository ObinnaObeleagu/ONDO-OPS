'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Verify / Dispute buttons for one pending result. Verify is disabled
 * when there is no EC8A photo, because verify_result() refuses it.
 * Dispute asks for a reason inline (no browser pop-up) and sends it.
 */
export default function VerifyActions({
  submissionId,
  hasEc8a,
}: {
  submissionId: string;
  hasEc8a: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function send(approve: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submissionId, approve, note: approve ? undefined : note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json.error ?? 'That did not save. Try again.');
        return;
      }
      setDisputing(false);
      router.refresh();
    } catch {
      setErr('Could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  if (disputing) {
    return (
      <div style={{ minWidth: 200 }}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why? e.g. figures don't match the EC8A photo"
          style={{ minHeight: 48, fontSize: 12 }}
          maxLength={500}
          autoFocus
        />
        <div className="row" style={{ marginTop: 5 }}>
          <button className="linkbtn pri" disabled={busy || !note.trim()} onClick={() => send(false)}
            style={{ background: 'var(--critical)' }}>
            {busy ? 'Saving…' : 'Dispute'}
          </button>
          <button className="linkbtn" disabled={busy} onClick={() => setDisputing(false)}>Cancel</button>
        </div>
        {err && <div style={{ color: 'var(--critical)', fontSize: 11, marginTop: 4 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div>
      <div className="row">
        <button
          className="linkbtn pri"
          disabled={busy || !hasEc8a}
          title={hasEc8a ? 'Figures match the EC8A photo' : 'No EC8A photo — cannot verify'}
          onClick={() => send(true)}
        >
          {busy ? 'Saving…' : 'Verify'}
        </button>
        <button className="linkbtn" disabled={busy} onClick={() => setDisputing(true)}>Dispute</button>
      </div>
      {err && <div style={{ color: 'var(--critical)', fontSize: 11, marginTop: 4 }}>{err}</div>}
    </div>
  );
}

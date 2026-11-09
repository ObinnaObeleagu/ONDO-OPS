'use client';

/**
 * The result form itself. Runs on an agent's phone, often on a weak
 * connection, so:
 *  - the EC8A photo is shrunk in the browser before upload (a phone photo
 *    is 3–8 MB; this sends ~0.5 MB and stays under Vercel's 4.5 MB limit),
 *  - totals and the over-vote warning update as figures are typed, with
 *    no round trip,
 *  - every failure says what to do next instead of hanging.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fmt } from '@/lib/format';

interface Props {
  pu: { id: number; name: string; code: string; ward: string; lga: string; registered: number };
  agent: { id: string; name: string; phones: string[] } | null;
  parties: { code: string; name: string; tracked: boolean }[];
  anotherHref: string | null;
}

type Flag = { type: string; severity: string; detail: string };
type Receipt = { reference: string; flags: Flag[]; warnings: { message: string }[] };

const toInt = (s: string) => (s.trim() === '' ? null : Number(s));
const isWhole = (n: number | null) => n === null || (Number.isInteger(n) && n >= 0);

async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (blob) return blob;
  } catch {
    // fall through to the original file
  }
  return file;
}

export default function AgentForm({ pu, agent, parties, anotherHref }: Props) {
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState('');
  const [accredited, setAccredited] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [noPhoto, setNoPhoto] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const tracked = parties.filter((p) => p.tracked);
  const other = parties.filter((p) => !p.tracked);

  const t = useMemo(() => {
    const entries = Object.entries(votes).map(([c, v]) => [c, toInt(v)] as const);
    const valid = entries.reduce((s, [, v]) => s + (v && v > 0 ? v : 0), 0);
    const rej = toInt(rejected) ?? 0;
    const acc = toInt(accredited);
    const bad = entries.some(([, v]) => !isWhole(v)) || !isWhole(toInt(rejected)) || !isWhole(acc);
    return { valid, rej, all: valid + rej, acc, bad };
  }, [votes, rejected, accredited]);

  const over = t.all > pu.registered;
  const overAcc = t.acc !== null && t.valid > t.acc;
  const photoReady = !!photo || noPhoto;
  const canSubmit = t.valid > 0 && !t.bad && photoReady && !busy && !preparing;

  async function onPhoto(f: File | undefined) {
    if (!f) return;
    setPreparing(true);
    setErr(null);
    const small = await shrinkPhoto(f);
    setPhoto(small);
    setPhotoName(f.name);
    setNoPhoto(false);
    setPreparing(false);
  }

  async function submit() {
    setErr(null);
    setIssues([]);
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setErr('You have been signed out. Sign in again — your figures are still on this page.');
        return;
      }

      let ec8aPath: string | null = null;
      if (photo) {
        setBusy('Uploading the EC8A photo…');
        const fd = new FormData();
        fd.append('puId', String(pu.id));
        fd.append('photo', photo, 'ec8a.jpg');
        const up = await fetch('/api/ec8a', { method: 'POST', body: fd });
        const upJson = await up.json().catch(() => ({}));
        if (!up.ok) {
          setErr(`${upJson.error ?? 'The photo did not upload.'} Your figures have not been sent yet.`);
          return;
        }
        ec8aPath = upJson.path;
      }

      setBusy('Sending the result…');
      const partyVotes: Record<string, number> = {};
      for (const [code, v] of Object.entries(votes)) {
        const n = toInt(v);
        if (n !== null) partyVotes[code] = n;
      }
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          puId: pu.id,
          agentId: agent?.id ?? null,
          partyVotes,
          rejectedVotes: t.rej,
          accreditedVoters: t.acc,
          ec8aPath,
          remarks: remarks.trim() || null,
          channel: 'web',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 422 && Array.isArray(json.issues)) {
        setErr(json.error ?? 'The figures need correcting.');
        setIssues(json.issues.filter((i: { severity: string }) => i.severity === 'error').map((i: { message: string }) => i.message));
        return;
      }
      if (!res.ok) {
        setErr(json.error ?? 'The result was not saved. Try again, or call your ward coordinator.');
        return;
      }
      setReceipt({ reference: json.reference, flags: json.flags ?? [], warnings: json.warnings ?? [] });
      window.scrollTo({ top: 0 });
    } catch {
      setErr('Could not reach the server. Check your signal and try again — nothing has been lost from this page.');
    } finally {
      setBusy(null);
    }
  }

  if (receipt) {
    const serious = receipt.flags.filter((f) => f.type !== 'MISSING_EC8A');
    return (
      <div className="phoneWrap"><div className="phone"><div className="receipt">
        <div className="tick">✓</div>
        <h2 style={{ fontSize: 17 }}>Result recorded</h2>
        <div style={{ color: 'var(--ink-2)', fontSize: 13, marginTop: 5 }}>{pu.name}</div>
        <div className="ref">{receipt.reference}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Your reference number — write it on your copy of the EC8A</div>
        {serious.map((f, i) => (
          <div key={i} className="inlinewarn" style={{ textAlign: 'left' }}>
            <b>The control room has been alerted</b>{f.detail}
          </div>
        ))}
        {receipt.flags.some((f) => f.type === 'MISSING_EC8A') && (
          <div className="inlinewarn" style={{ textAlign: 'left', borderLeftColor: 'var(--warning)' }}>
            <b style={{ color: 'var(--warning)' }}>No photo yet</b>
            This result can&apos;t be verified until the EC8A photo arrives. Send it as soon as you can.
          </div>
        )}
        <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
          padding: 12, margin: '19px 0', fontSize: 12.5, color: 'var(--ink-2)', textAlign: 'left' }}>
          Keep the signed EC8A safe. Your ward coordinator may call to check the figures against the photo.
        </div>
        {anotherHref
          ? <Link className="btn ghost" style={{ display: 'block', textDecoration: 'none' }} href={anotherHref}>Enter another unit</Link>
          : <button className="btn ghost" onClick={() => location.reload()}>Send a correction</button>}
      </div></div></div>
    );
  }

  const voteRow = (p: { code: string; name: string }) => (
    <div className="voterow" key={p.code}>
      <div className="pname">
        <span className="swatch" style={{ background: `var(--p-${p.code}, var(--p-OTHER))` }} />
        <b>{p.code}</b>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{p.name}</span>
      </div>
      <input type="number" inputMode="numeric" min={0} placeholder="0" aria-label={`Votes for ${p.code}`}
        value={votes[p.code] ?? ''} onChange={(e) => setVotes({ ...votes, [p.code]: e.target.value })} />
    </div>
  );

  return (
    <div className="phoneWrap"><div className="phone">
      <div className="head">
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', fontWeight: 600 }}>
          Polling unit result
        </div>
        <div className="pu">{pu.name}</div>
        <div className="meta">{pu.code} · {pu.ward}, {pu.lga}</div>
        <div className="meta" style={{ marginTop: 6, color: 'var(--ink-2)' }}>
          Agent: <b>{agent?.name ?? 'none assigned'}</b> · Registered voters: <b>{fmt(pu.registered)}</b>
        </div>
        {agent && agent.phones.length > 0 && <div className="meta" style={{ marginTop: 3 }}>{agent.phones.join(' · ')}</div>}
      </div>

      <div className="form">
        <div className="field">
          <label htmlFor="acc">Accredited voters <span className="hint">— from the BVAS</span></label>
          <input id="acc" type="number" inputMode="numeric" min={0} placeholder="0"
            value={accredited} onChange={(e) => setAccredited(e.target.value)} />
        </div>

        <div className="field">
          <label>Votes for each party <span className="hint">— copy from the signed EC8A</span></label>
          {tracked.map(voteRow)}
          {other.length > 0 && (
            showOther ? other.map(voteRow) : (
              <button type="button" className="linkbtn" onClick={() => setShowOther(true)}>
                + {other.length} more parties on the form
              </button>
            )
          )}
        </div>

        <div className="field">
          <label htmlFor="rej">Rejected ballots</label>
          <input id="rej" type="number" inputMode="numeric" min={0} placeholder="0"
            value={rejected} onChange={(e) => setRejected(e.target.value)} />
        </div>

        <div className="totalbox">
          <div className="r"><span>Valid votes</span><span>{fmt(t.valid)}</span></div>
          <div className="r"><span>Rejected</span><span>{fmt(t.rej)}</span></div>
          <div className="r big"><span>Total cast</span><span style={over ? { color: 'var(--critical)' } : undefined}>{fmt(t.all)}</span></div>
          <div className="r" style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted)' }}>
            <span>Registered at this unit</span><span>{fmt(pu.registered)}</span>
          </div>
        </div>

        {t.bad && <div className="inlinewarn"><b>Check the figures</b>Every number must be a whole number, zero or more.</div>}
        {over && (
          <div className="inlinewarn">
            <b>More votes than registered voters</b>
            You have entered {fmt(t.all)} votes, but only {fmt(pu.registered)} voters are registered at this unit.
            Check the figures against the EC8A. If the form really says this, send it anyway and explain in the
            remarks — the control room will be alerted.
          </div>
        )}
        {overAcc && !over && (
          <div className="inlinewarn" style={{ borderLeftColor: 'var(--warning)' }}>
            <b style={{ color: 'var(--warning)' }}>More valid votes than accredited voters</b>
            {fmt(t.valid)} valid votes against {fmt(t.acc)} accredited. Check both against the EC8A and the BVAS.
          </div>
        )}

        <div className="field">
          <label>Photo of the signed Form EC8A <span className="hint">— required to verify</span></label>
          <label className={`photo ${photo ? 'on' : ''}`} style={{ display: 'block' }}>
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={(e) => onPhoto(e.target.files?.[0])} />
            <div className="big" style={photo ? { color: 'var(--good)' } : undefined}>{photo ? '✓' : '▢'}</div>
            <div className="t">{preparing ? 'Preparing photo…' : photo ? 'EC8A photo attached' : 'Tap to take the photo'}</div>
            <div className="s">
              {photo ? `${photoName} · ${(photo.size / 1024).toFixed(0)} KB · tap to retake` : 'Hold the sheet flat. All figures must be readable.'}
            </div>
          </label>
          {!photo && (
            <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: 'var(--muted)',
              fontWeight: 400, marginTop: 8 }}>
              <input type="checkbox" checked={noPhoto} onChange={(e) => setNoPhoto(e.target.checked)} />
              <span>I can&apos;t take the photo now. Send the figures without it — the unit stays flagged and can&apos;t be
                verified until the photo arrives.</span>
            </label>
          )}
        </div>

        <div className="field">
          <label htmlFor="rem">Remarks <span className="hint">— incidents, delays, disputes</span></label>
          <textarea id="rem" maxLength={1000} placeholder="Leave blank if nothing happened."
            value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        {err && (
          <div className="inlinewarn">
            <b>Not sent</b>{err}
            {issues.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{issues.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          </div>
        )}

        <button className="btn" disabled={!canSubmit} onClick={submit}>
          {busy ?? (t.valid > 0 && !photoReady ? 'Attach the EC8A photo to continue' : 'Submit result')}
        </button>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', marginTop: 9 }}>
          You can correct a figure after sending. Nothing is ever deleted.
        </div>
      </div>
    </div></div>
  );
}

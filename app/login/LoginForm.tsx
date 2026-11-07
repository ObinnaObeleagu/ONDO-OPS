'use client';

/**
 * One login page, two paths:
 *   - Phone + SMS code, for agents. No password to forget in the field.
 *   - Email + password, for coordinators and admins, who sign in from a
 *     desk rather than a crowded polling unit.
 *
 * Either path ends the same way: a Supabase session exists, the browser
 * is redirected to "/", and middleware.ts sends the person on to their
 * own portal based on what my_scope() returns for them.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { toE164 } from '@/lib/validation';

type Mode = 'phone' | 'password';
type PhoneStep = 'enter' | 'code';

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const deniedPath = params.get('denied');
  const notProvisioned = params.get('error') === 'not-provisioned';

  const [mode, setMode] = useState<Mode>('phone');

  // phone+OTP state
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('enter');
  const [phoneInput, setPhoneInput] = useState('');
  const [code, setCode] = useState('');

  // email+password state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const phone = toE164(phoneInput);
    if (!phone) {
      setErr('Enter a Nigerian number, e.g. 0803 123 4567.');
      return;
    }
    setBusy(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) {
      setErr('Could not send a code. Check the number and try again.');
      return;
    }
    setPhoneStep('code');
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const phone = toE164(phoneInput)!;
    setBusy(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    setBusy(false);
    if (error) {
      setErr('That code did not work. Check it and try again.');
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setErr('Email or password is wrong.');
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Election Control Room</h1>
        <p style={styles.sub}>Ondo North Senatorial District</p>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'phone' ? styles.tabActive : {}) }}
            onClick={() => { setMode('phone'); setErr(null); }}
          >
            Agent (phone)
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'password' ? styles.tabActive : {}) }}
            onClick={() => { setMode('password'); setErr(null); }}
          >
            Coordinator / admin
          </button>
        </div>

        {deniedPath && (
          <p style={styles.notice}>
            You do not have access to {deniedPath}. Signed in to your own section below.
          </p>
        )}
        {notProvisioned && (
          <p style={styles.notice}>
            That account is not yet set up in the system. Ask an admin to add you.
          </p>
        )}

        {mode === 'phone' && phoneStep === 'enter' && (
          <form onSubmit={sendCode}>
            <label style={styles.label}>Phone number</label>
            <input
              style={styles.input}
              type="tel"
              inputMode="tel"
              placeholder="0803 123 4567"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              autoFocus
            />
            <button style={styles.btn} disabled={busy} type="submit">
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {mode === 'phone' && phoneStep === 'code' && (
          <form onSubmit={verifyCode}>
            <label style={styles.label}>Code sent to {phoneInput}</label>
            <input
              style={styles.input}
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <button style={styles.btn} disabled={busy} type="submit">
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              style={styles.linkBtn}
              onClick={() => { setPhoneStep('enter'); setCode(''); }}
            >
              Use a different number
            </button>
          </form>
        )}

        {mode === 'password' && (
          <form onSubmit={signInWithPassword}>
            <label style={styles.label}>Email</label>
            <input
              style={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <label style={styles.label}>Password</label>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button style={styles.btn} disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {err && <p style={styles.err}>{err}</p>}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d', padding: 16 },
  card: { width: '100%', maxWidth: 380, background: '#1a1a19', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 26 },
  h1: { color: '#f0efec', fontSize: 19, margin: 0, fontWeight: 650 },
  sub: { color: '#898781', fontSize: 13, margin: '4px 0 20px' },
  tabs: { display: 'flex', gap: 2, background: '#222221', padding: 3, borderRadius: 10, marginBottom: 20 },
  tab: { flex: 1, border: 0, background: 'transparent', color: '#c3c2b7', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 550, cursor: 'pointer' },
  tabActive: { background: '#1a1a19', color: '#f0efec', boxShadow: '0 1px 2px rgba(0,0,0,.3)' },
  label: { display: 'block', color: '#c3c2b7', fontSize: 12.5, fontWeight: 600, marginBottom: 6 },
  input: { width: '100%', padding: '10px 12px', marginBottom: 14, fontSize: 15, background: '#0d0d0d', color: '#f0efec', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxSizing: 'border-box' },
  btn: { width: '100%', padding: 12, border: 0, borderRadius: 8, background: '#3987e5', color: '#fff', fontSize: 14.5, fontWeight: 650, cursor: 'pointer' },
  linkBtn: { width: '100%', padding: 9, marginTop: 8, border: 0, background: 'transparent', color: '#898781', fontSize: 12.5, cursor: 'pointer' },
  notice: { background: '#222221', border: '1px solid rgba(255,255,255,0.1)', borderLeft: '3px solid #3987e5', borderRadius: 6, padding: '9px 11px', fontSize: 12, color: '#c3c2b7', marginBottom: 16 },
  err: { color: '#e66767', fontSize: 12.5, marginTop: 10 },
};

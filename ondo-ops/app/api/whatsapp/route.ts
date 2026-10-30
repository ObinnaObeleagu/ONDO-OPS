/**
 * WhatsApp result reporting — Meta Cloud API webhook.
 *
 * Many agents will have WhatsApp and a weak data connection rather than
 * a browser session that stays alive. This handler walks them through
 * the same submission, one question at a time, and ends at the same
 * submit_result() call the web form uses.
 *
 * Conversation:
 *   agent sends anything  ->  confirm identity + polling unit
 *   "YES"                 ->  ask accredited voters
 *   number                ->  ask votes, party by party
 *   ...                   ->  ask rejected votes
 *   number                ->  ask for the EC8A photo
 *   image                 ->  ask for remarks (or SKIP)
 *   text / SKIP           ->  show a summary, ask to confirm
 *   "CONFIRM"             ->  submit, reply with the reference number
 *
 * State lives in whatsapp_sessions (see the migration at the foot of
 * this file), keyed by phone number, so a dropped connection resumes
 * where the agent left off.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { toE164 } from '@/lib/validation';

export const runtime = 'nodejs';

const GRAPH = 'https://graph.facebook.com/v21.0';

type Step =
  | 'idle'
  | 'confirm_identity'
  | 'accredited'
  | 'party_votes'
  | 'rejected'
  | 'ec8a'
  | 'remarks'
  | 'confirm';

interface SessionData {
  step: Step;
  puId?: number;
  agentId?: string;
  partyIndex?: number;
  partyVotes?: Record<string, number>;
  accredited?: number | null;
  rejected?: number;
  ec8aPath?: string | null;
  remarks?: string | null;
}

function svc() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function send(to: string, text: string) {
  await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });
}

/** Pulls a media file off the Graph API and puts it in private storage. */
async function storeMedia(mediaId: string, puId: number): Promise<string | null> {
  try {
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    });
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    });
    const buf = Buffer.from(await binRes.arrayBuffer());

    const ext = (meta.mime_type ?? 'image/jpeg').split('/')[1] ?? 'jpg';
    const path = `ec8a/${puId}/${Date.now()}.${ext}`;

    const { error } = await svc()
      .storage.from('ec8a')
      .upload(path, buf, { contentType: meta.mime_type ?? 'image/jpeg', upsert: false });

    return error ? null : path;
  } catch (e) {
    console.error('storeMedia failed', e);
    return null;
  }
}

async function getSession(phone: string): Promise<SessionData> {
  const { data } = await svc()
    .from('whatsapp_sessions')
    .select('data')
    .eq('phone', phone)
    .maybeSingle();
  return (data?.data as SessionData) ?? { step: 'idle' };
}

async function setSession(phone: string, data: SessionData) {
  await svc()
    .from('whatsapp_sessions')
    .upsert({ phone, data, updated_at: new Date().toISOString() }, { onConflict: 'phone' });
}

// ---------------------------------------------------------------------
// Webhook verification handshake (Meta calls this once on setup)
// ---------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (
    p.get('hub.mode') === 'subscribe' &&
    p.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

// ---------------------------------------------------------------------
// Inbound messages
// ---------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Verify the payload really came from Meta before acting on it.
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(raw).digest('hex');
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return new NextResponse('Bad signature', { status: 401 });
  }

  const body = JSON.parse(raw);
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return NextResponse.json({ ok: true }); // delivery receipt etc.

  const from = toE164(msg.from) ?? `+${msg.from}`;
  const text: string = (msg.text?.body ?? '').trim();
  const upper = text.toUpperCase();

  try {
    await handle(from, upper, text, msg);
  } catch (e) {
    console.error('whatsapp handler error', e);
    await send(from, 'Something went wrong on our side. Please call your ward coordinator.');
  }

  // Always 200, or Meta retries the same message.
  return NextResponse.json({ ok: true });
}

async function handle(from: string, upper: string, text: string, msg: Record<string, any>) {
  const db = svc();
  let s = await getSession(from);

  // Who is this? A number lives in agent_phones, and an agent may hold
  // several numbers, so resolve the number first and then the agent.
  const { data: phoneRows } = await db
    .from('agent_phones')
    .select(`
      phone, whatsapp_enabled, consent_recorded_at, is_active,
      agents!inner (
        id, full_name, pu_id, is_active,
        polling_units ( name, inec_code, registered_voters )
      )
    `)
    .eq('phone', from)
    .eq('is_active', true);

  const live = (phoneRows ?? []).filter((r: any) => r.agents?.is_active);

  if (live.length === 0) {
    await send(
      from,
      'This number is not registered as a polling agent for this district. ' +
        'Please contact your ward coordinator.',
    );
    return;
  }

  // NDPA 2023: consent is recorded against the specific number. A number
  // with no consent, or one not enabled for WhatsApp, is not messaged.
  const usable = live.filter(
    (r: any) => r.consent_recorded_at !== null && r.whatsapp_enabled,
  );
  if (usable.length === 0) {
    await send(
      from,
      'Before we can take your report, your ward coordinator needs to record your ' +
        'consent for us to hold this number. Please contact them.',
    );
    return;
  }

  // One number can belong to an agent covering more than one unit (a
  // collation agent, or someone standing in). Ask which one rather than
  // guessing — a result filed against the wrong unit is worse than a
  // extra question.
  let chosen = usable[0];
  if (usable.length > 1) {
    const idx = parseInt(text, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= usable.length) {
      chosen = usable[idx - 1];
      s.puId = undefined; // force a fresh confirmation for the chosen unit
    } else {
      await send(
        from,
        'This number is registered for more than one polling unit.\n\n' +
          usable
            .map((r: any, i: number) => `*${i + 1}.* ${r.agents.polling_units.name}`)
            .join('\n') +
          '\n\nReply with the number of the unit you are reporting for.',
      );
      return;
    }
  }

  const agent = {
    id: chosen.agents.id,
    full_name: chosen.agents.full_name,
    pu_id: chosen.agents.pu_id,
  };
  const pu = chosen.agents.polling_units;

  if (upper === 'CANCEL' || upper === 'RESTART') {
    s = { step: 'idle' };
    await setSession(from, s);
    await send(from, 'Cancelled. Send any message to start again.');
    return;
  }

  const { data: parties } = await db
    .from('parties')
    .select('code, name')
    .eq('is_tracked', true)
    .order('sort_order');
  const ballot = parties ?? [];

  switch (s.step) {
    case 'idle': {
      s = { step: 'confirm_identity', puId: agent.pu_id, agentId: agent.id, partyVotes: {} };
      await setSession(from, s);
      await send(
        from,
        `Hello ${agent.full_name}.\n\n` +
          `You are reporting for:\n*${pu.name}*\n${pu.inec_code}\n` +
          `Registered voters: ${pu.registered_voters}\n\n` +
          `Is that correct? Reply *YES* to continue, or *CANCEL* to stop.`,
      );
      return;
    }

    case 'confirm_identity': {
      if (upper !== 'YES') {
        await send(from, 'Reply *YES* to confirm the polling unit, or *CANCEL* to stop.');
        return;
      }
      s.step = 'accredited';
      await setSession(from, s);
      await send(
        from,
        'How many voters were *accredited* at your unit?\n' +
          'Send the number only. Send *SKIP* if you do not have it.',
      );
      return;
    }

    case 'accredited': {
      if (upper === 'SKIP') {
        s.accredited = null;
      } else {
        const n = Number(text);
        if (!Number.isInteger(n) || n < 0) {
          await send(from, 'Please send a whole number, or *SKIP*.');
          return;
        }
        s.accredited = n;
      }
      s.step = 'party_votes';
      s.partyIndex = 0;
      await setSession(from, s);
      await send(
        from,
        `Now the votes, party by party.\n\nHow many votes for *${ballot[0].code}* ` +
          `(${ballot[0].name})?`,
      );
      return;
    }

    case 'party_votes': {
      const idx = s.partyIndex ?? 0;
      const n = Number(text);
      if (!Number.isInteger(n) || n < 0) {
        await send(from, `Please send a whole number for *${ballot[idx].code}*.`);
        return;
      }
      s.partyVotes = { ...(s.partyVotes ?? {}), [ballot[idx].code]: n };

      if (idx + 1 < ballot.length) {
        s.partyIndex = idx + 1;
        await setSession(from, s);
        await send(
          from,
          `How many votes for *${ballot[idx + 1].code}* (${ballot[idx + 1].name})?`,
        );
      } else {
        s.step = 'rejected';
        await setSession(from, s);
        await send(from, 'How many *rejected* ballots? Send the number, or *0*.');
      }
      return;
    }

    case 'rejected': {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 0) {
        await send(from, 'Please send a whole number for rejected ballots, or *0*.');
        return;
      }
      s.rejected = n;
      s.step = 'ec8a';
      await setSession(from, s);
      await send(
        from,
        'Now send a *photo of the signed Form EC8A*.\n\n' +
          'Take the picture straight on, with all the figures readable. ' +
          'The result cannot be verified without it.',
      );
      return;
    }

    case 'ec8a': {
      if (msg.type !== 'image') {
        await send(
          from,
          'Please send the EC8A as a photo. If you truly cannot, send *NOPHOTO* — ' +
            'but the result will be held unverified.',
        );
        if (upper === 'NOPHOTO') {
          s.ec8aPath = null;
          s.step = 'remarks';
          await setSession(from, s);
          await send(from, 'Any remarks? Incidents, delays, disputes. Send *SKIP* if none.');
        }
        return;
      }
      const path = await storeMedia(msg.image.id, s.puId!);
      s.ec8aPath = path;
      s.step = 'remarks';
      await setSession(from, s);
      await send(
        from,
        path
          ? 'Photo received.\n\nAny remarks? Incidents, delays, disputes. Send *SKIP* if none.'
          : 'The photo did not upload. Send it again, or send *SKIP* to continue without it.',
      );
      return;
    }

    case 'remarks': {
      s.remarks = upper === 'SKIP' ? null : text.slice(0, 1000);
      s.step = 'confirm';
      await setSession(from, s);

      const lines = Object.entries(s.partyVotes ?? {})
        .filter(([, v]) => v > 0)
        .map(([c, v]) => `  ${c}: ${v}`)
        .join('\n');
      const total = Object.values(s.partyVotes ?? {}).reduce((a, b) => a + b, 0);

      await send(
        from,
        `Please check before sending:\n\n` +
          `*${pu.name}*\n` +
          `Accredited: ${s.accredited ?? 'not given'}\n` +
          `${lines}\n` +
          `  Rejected: ${s.rejected}\n` +
          `  *Total valid: ${total}*\n` +
          `EC8A photo: ${s.ec8aPath ? 'attached' : 'NOT attached'}\n` +
          `Remarks: ${s.remarks ?? 'none'}\n\n` +
          `Reply *CONFIRM* to submit, or *RESTART* to do it again.`,
      );
      return;
    }

    case 'confirm': {
      if (upper !== 'CONFIRM') {
        await send(from, 'Reply *CONFIRM* to submit, or *RESTART* to start over.');
        return;
      }

      const { data: subId, error } = await db.rpc('submit_result', {
        p_pu_id: s.puId,
        p_agent_id: s.agentId,
        p_party_votes: s.partyVotes,
        p_rejected_votes: s.rejected ?? 0,
        p_accredited: s.accredited ?? null,
        p_ec8a_path: s.ec8aPath ?? null,
        p_remarks: s.remarks ?? null,
        p_channel: 'whatsapp',
        p_submitted_by: null,
      });

      if (error) {
        console.error('whatsapp submit failed', error.message);
        await send(from, 'The result could not be saved. Please call your ward coordinator.');
        return;
      }

      await setSession(from, { step: 'idle' });

      const ref = String(subId).slice(0, 8).toUpperCase();
      const { data: flags } = await db
        .from('flags')
        .select('type')
        .eq('submission_id', subId);

      let extra = '';
      if ((flags ?? []).some((f: { type: string }) => f.type === 'OVER_VOTE')) {
        extra =
          '\n\n⚠️ The figures show more votes than registered voters at your unit. ' +
          'Your ward coordinator will call you about this.';
      } else if (!s.ec8aPath) {
        extra = '\n\n⚠️ Recorded without the EC8A photo. Send it to your coordinator as soon as you can.';
      }

      await send(
        from,
        `Result recorded for *${pu.name}*.\nReference: *${ref}*\n\n` +
          `Thank you. Keep the signed EC8A safe.${extra}`,
      );
      return;
    }
  }
}

/*
-- Migration for the session store:

create table whatsapp_sessions (
  phone      text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table whatsapp_sessions enable row level security;
-- no policies: reachable only via the service role used by this webhook

-- Sessions are working state, not records. Clear anything stale.
create index on whatsapp_sessions (updated_at);

-- Numbers live in agent_phones, not on agents. The bot resolves an
-- inbound number to an agent through that table, and refuses to message
-- any number whose consent_recorded_at is NULL or whose
-- whatsapp_enabled is false.
*/

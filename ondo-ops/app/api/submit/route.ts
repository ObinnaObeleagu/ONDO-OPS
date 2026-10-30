/**
 * POST /api/submit — record a polling-unit result from the web form.
 *
 * The route never writes to the tables directly. It calls the
 * submit_result() database function, which validates, supersedes any
 * earlier submission, writes the party votes and raises the automatic
 * flags — all in one transaction.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateSubmission, type SubmissionInput } from '@/lib/validation';

export const runtime = 'nodejs';

function serviceClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: req.headers.get('authorization') ?? '' } },
      auth: { persistSession: false },
    },
  );

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: SubmissionInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  if (!Number.isInteger(body.puId)) {
    return NextResponse.json({ error: 'A polling unit is required.' }, { status: 400 });
  }

  // RLS means this only returns a row if the caller is entitled to that PU.
  const { data: pu, error: puErr } = await supabase
    .from('polling_units')
    .select('id, name, registered_voters')
    .eq('id', body.puId)
    .single();

  if (puErr || !pu) {
    return NextResponse.json(
      { error: 'That polling unit is not assigned to you.' },
      { status: 403 },
    );
  }

  const { data: parties } = await supabase.from('parties').select('code');
  const partyCodes = (parties ?? []).map((p: { code: string }) => p.code);

  const check = validateSubmission(body, pu.registered_voters, partyCodes);
  if (!check.ok) {
    return NextResponse.json(
      { error: 'The figures need correcting.', issues: check.issues },
      { status: 422 },
    );
  }

  // submit_result is SECURITY DEFINER, so it runs with the rights it needs
  // while the caller's own grants stay minimal.
  const svc = serviceClient();
  const { data: submissionId, error: rpcErr } = await svc.rpc('submit_result', {
    p_pu_id: body.puId,
    p_agent_id: body.agentId ?? null,
    p_party_votes: body.partyVotes,
    p_rejected_votes: body.rejectedVotes ?? 0,
    p_accredited: body.accreditedVoters ?? null,
    p_ec8a_path: body.ec8aPath ?? null,
    p_remarks: body.remarks ?? null,
    p_channel: body.channel ?? 'web',
    p_submitted_by: auth.user.id,
  });

  if (rpcErr) {
    console.error('submit_result failed', { puId: body.puId, err: rpcErr.message });
    return NextResponse.json(
      { error: 'The result could not be saved. Try again, or call your ward coordinator.' },
      { status: 500 },
    );
  }

  // Anything the system flagged, so the agent sees it immediately.
  const { data: flags } = await svc
    .from('flags')
    .select('type, severity, detail')
    .eq('submission_id', submissionId);

  return NextResponse.json({
    ok: true,
    submissionId,
    reference: String(submissionId).slice(0, 8).toUpperCase(),
    totalValidVotes: check.totalValidVotes,
    warnings: check.issues.filter((i) => i.severity === 'warning'),
    flags: flags ?? [],
  });
}

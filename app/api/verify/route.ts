/**
 * POST /api/verify — a coordinator verifies or disputes a result.
 *
 * Body: { submissionId: string, approve: boolean, note?: string }
 *
 * Three checks before anything changes:
 *   1. the caller is signed in (their own Supabase session cookie),
 *   2. their role may verify (my_scope().can_verify),
 *   3. the submission is inside their scope (RLS on result_submissions
 *      only returns it if it is).
 * Then verify_result() does the change. It refuses to verify a result
 * that has no EC8A photo, and that refusal is passed back as-is.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, supabaseService } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data: scope } = await supabase.rpc('my_scope');
  if (!scope?.signed_in || !scope.can_verify) {
    return NextResponse.json({ error: 'Your role cannot verify results.' }, { status: 403 });
  }

  let body: { submissionId?: string; approve?: boolean; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }
  if (!body.submissionId || typeof body.approve !== 'boolean') {
    return NextResponse.json({ error: 'submissionId and approve are required.' }, { status: 400 });
  }
  const note = body.note?.trim() || null;
  if (!body.approve && !note) {
    return NextResponse.json({ error: 'Say why you are disputing this result.' }, { status: 400 });
  }

  const { data: sub } = await supabase
    .from('result_submissions')
    .select('id, is_current, verification_state')
    .eq('id', body.submissionId)
    .maybeSingle();

  if (!sub) {
    return NextResponse.json({ error: 'That result is not in your scope.' }, { status: 403 });
  }
  if (!sub.is_current) {
    return NextResponse.json(
      { error: 'This result has been replaced by a newer one. Reload the page.' },
      { status: 409 },
    );
  }

  const { error } = await supabaseService().rpc('verify_result', {
    p_submission_id: body.submissionId,
    p_verifier_id: auth.user.id,
    p_approve: body.approve,
    p_note: note,
  });

  if (error) {
    const friendly = /EC8A/i.test(error.message)
      ? 'This result has no EC8A photo, so it cannot be verified. Ask the agent to send the photo.'
      : 'The change could not be saved. Try again.';
    console.error('verify_result failed', { id: body.submissionId, err: error.message });
    return NextResponse.json({ error: friendly }, { status: 422 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * POST /api/ec8a — upload the photo of a signed Form EC8A.
 *
 * multipart/form-data with fields `puId` and `photo`. Returns { path },
 * which the agent form then sends to /api/submit as ec8aPath.
 *
 * The bucket only accepts uploads from the service role (see
 * docs/DEPLOYMENT.md), so the photo comes through here: the route checks
 * the caller may report for that unit (RLS on polling_units), then
 * stores it under the same path pattern the WhatsApp bot uses.
 *
 * The browser shrinks the photo before sending it (see AgentForm), which
 * keeps it well under Vercel's 4.5 MB request limit. The size cap here is
 * a backstop.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, supabaseService } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'The photo did not arrive. Try again.' }, { status: 400 });
  }

  const puId = Number(form.get('puId'));
  const photo = form.get('photo');
  if (!Number.isInteger(puId) || !(photo instanceof Blob)) {
    return NextResponse.json({ error: 'A polling unit and a photo are required.' }, { status: 400 });
  }

  const ext = TYPES[photo.type];
  if (!ext) return NextResponse.json({ error: 'Send the EC8A as a photo (JPEG or PNG).' }, { status: 415 });
  if (photo.size > MAX_BYTES) {
    return NextResponse.json({ error: 'The photo is too large. Take it again.' }, { status: 413 });
  }

  const { data: pu } = await supabase.from('polling_units').select('id').eq('id', puId).maybeSingle();
  if (!pu) {
    return NextResponse.json({ error: 'That polling unit is not assigned to you.' }, { status: 403 });
  }

  const path = `ec8a/${puId}/${Date.now()}.${ext}`;
  const { error } = await supabaseService()
    .storage.from('ec8a')
    .upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, upsert: false });

  if (error) {
    console.error('ec8a upload failed', { puId, err: error.message });
    return NextResponse.json({ error: 'The photo did not upload. Try again.' }, { status: 500 });
  }

  return NextResponse.json({ path });
}

-- =====================================================================
-- 90_test_data.sql — disposable demo data for the Control Room.
--
-- Loads 10 real-looking polling units (one per a spread of real wards
-- already in db/04_seed_geography.sql), one agent each, and a batch of
-- submit_result() calls that deliberately exercise every state the
-- /control dashboard renders: verified, pending, disputed (both the
-- automatic over-vote check and a manual coordinator dispute), a
-- missing-EC8A warning, incident remarks, and two units left
-- unreported so the chase list and "outstanding" numbers aren't zero.
--
-- This is NOT the real INEC register (db/05_load_polling_units.sql is)
-- and is meant to be deleted once real data starts arriving. Every row
-- this script creates is tagged so it can be found and removed cleanly:
--   - polling_units.name and agents.full_name both start 'TEST SEED — '
--   - run the matching DELETE block at the bottom of this file when done
--
-- Run this in the Supabase SQL Editor as postgres/service_role (same
-- role you used to bootstrap the first admin) — submit_result() and
-- verify_result() are SECURITY DEFINER and do their own validation, but
-- still need EXECUTE, which app_rw already has.
--
-- The verifier/submitter id below is the admin account bootstrapped
-- earlier (ogemdiobeleagu@gmail.com). Replace it if you run this
-- against a database where that account doesn't exist.
-- =====================================================================

do $$
declare
  v_admin uuid := '6be70bd3-8b30-4949-bf99-48d2fa25d70b';

  -- polling units: (lga name, ward name, pu name, registered voters)
  v_pu record;
  v_pu_id integer;
  v_agent_id uuid;
  v_sub uuid;

  v_pu1 integer; v_pu2 integer; v_pu3 integer; v_pu4 integer; v_pu5 integer;
  v_pu6 integer; v_pu7 integer; v_pu8 integer; v_pu9 integer; v_pu10 integer;
  v_ag1 uuid; v_ag2 uuid; v_ag3 uuid; v_ag4 uuid; v_ag5 uuid;
  v_ag6 uuid; v_ag7 uuid; v_ag8 uuid; v_ag9 uuid; v_ag10 uuid;
  v_sub7 uuid;
begin
  if not exists (select 1 from app_users where id = v_admin) then
    raise exception 'Admin id % not found in app_users — edit v_admin in db/90_test_data.sql first.', v_admin;
  end if;

  -- -------------------------------------------------------------
  -- 1. Polling units, one per ward, spread across all 6 LGAs.
  -- -------------------------------------------------------------
  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Edo Central School I', 470
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Akoko North-East' and w.name = 'Edo'
  returning id into v_pu1;

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Isowopo Town Hall', 410
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Akoko North-East' and w.name = 'Isowopo I'
  returning id into v_pu2;

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Arigidi Grammar School', 520
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Akoko North-West' and w.name = 'Arigidi/Iye I'
  returning id into v_pu3;

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Epinmi Primary School I', 300
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Akoko South-East' and w.name = 'Epinmi I'
  returning id into v_pu4;

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Supare Community Hall', 560
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Akoko South-West' and w.name = 'Supare I'
  returning id into v_pu5;

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Oka Central Mosque', 610
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Akoko South-West' and w.name = 'Oka I Ibaka/Sabo'
  returning id into v_pu6;

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Ifon Town Hall I', 530
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Ose' and w.name = 'Ifon I'
  returning id into v_pu7;

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Idoani Primary School', 480
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Ose' and w.name = 'Idoani I'
  returning id into v_pu8;

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Ehinogbe Civic Centre', 390
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Owo' and w.name = 'Ehinogbe'
  returning id into v_pu9;

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  select w.id, '28/' || l.inec_code || '/' || w.inec_code || '/001', '001',
         'TEST SEED — Iloro Market Square', 340
    from wards w join lgas l on l.id = w.lga_id
   where l.name = 'Owo' and w.name = 'Iloro'
  returning id into v_pu10;

  -- -------------------------------------------------------------
  -- 2. One agent + one contactable phone per unit.
  -- -------------------------------------------------------------
  insert into agents (pu_id, full_name, kind) values (v_pu1,  'TEST SEED — Agent 1',  'polling_agent') returning id into v_ag1;
  insert into agents (pu_id, full_name, kind) values (v_pu2,  'TEST SEED — Agent 2',  'polling_agent') returning id into v_ag2;
  insert into agents (pu_id, full_name, kind) values (v_pu3,  'TEST SEED — Agent 3',  'polling_agent') returning id into v_ag3;
  insert into agents (pu_id, full_name, kind) values (v_pu4,  'TEST SEED — Agent 4',  'polling_agent') returning id into v_ag4;
  insert into agents (pu_id, full_name, kind) values (v_pu5,  'TEST SEED — Agent 5',  'polling_agent') returning id into v_ag5;
  insert into agents (pu_id, full_name, kind) values (v_pu6,  'TEST SEED — Agent 6',  'polling_agent') returning id into v_ag6;
  insert into agents (pu_id, full_name, kind) values (v_pu7,  'TEST SEED — Agent 7',  'polling_agent') returning id into v_ag7;
  insert into agents (pu_id, full_name, kind) values (v_pu8,  'TEST SEED — Agent 8',  'polling_agent') returning id into v_ag8;
  insert into agents (pu_id, full_name, kind) values (v_pu9,  'TEST SEED — Agent 9',  'polling_agent') returning id into v_ag9;
  insert into agents (pu_id, full_name, kind) values (v_pu10, 'TEST SEED — Agent 10', 'polling_agent') returning id into v_ag10;

  insert into agent_phones (agent_id, phone, label, whatsapp_enabled, consent_recorded_at) values
    (v_ag1,  '+2348031000001', 'main', true, now()),
    (v_ag2,  '+2348031000002', 'main', true, now()),
    (v_ag3,  '+2348031000003', 'main', true, now()),
    (v_ag4,  '+2348031000004', 'main', true, now()),
    (v_ag5,  '+2348031000005', 'main', true, now()),
    (v_ag6,  '+2348031000006', 'main', true, now()),
    (v_ag7,  '+2348031000007', 'main', true, now()),
    (v_ag8,  '+2348031000008', 'main', false, null),   -- no WhatsApp consent on file yet
    (v_ag9,  '+2348031000009', 'main', true, now()),
    (v_ag10, '+2348031000010', 'main', true, now());

  -- -------------------------------------------------------------
  -- 3. Results. PU8 and PU9 are deliberately left unreported.
  -- -------------------------------------------------------------

  -- PU1 — clean, will be verified below. (registered 470: 190+130+80+15=415 valid + 10 rejected = 425, under.)
  v_sub := submit_result(v_pu1, v_ag1,
    '{"APC":190,"PDP":130,"LP":80,"ADC":15}'::jsonb,
    10, 440, 'test-seed/ec8a/pu1.jpg', null, 'web', v_admin);
  perform verify_result(v_sub, v_admin, true);

  -- PU2 — clean, left pending, carries a remark. (registered 410: 70+60+230+15=375 valid + 8 rejected = 383, under.)
  perform submit_result(v_pu2, v_ag2,
    '{"APC":70,"PDP":60,"LP":230,"ADC":15}'::jsonb,
    8, 400, 'test-seed/ec8a/pu2.jpg',
    'Accreditation ran about 40 minutes late; voting extended to compensate.',
    'web', v_admin);

  -- PU3 — submitted with no EC8A photo -> MISSING_EC8A warning flag.
  perform submit_result(v_pu3, v_ag3,
    '{"APC":130,"PDP":140,"LP":60}'::jsonb,
    5, 340, null, null, 'web', v_admin);

  -- PU4 — deliberate over-vote (registered_voters=300, total+rejected=380).
  -- accredited is set above the valid-vote total so only OVER_VOTE fires,
  -- not EXCEEDS_ACCREDITED too -> one clean critical flag, verification_state=disputed.
  perform submit_result(v_pu4, v_ag4,
    '{"APC":200,"PDP":150,"LP":10}'::jsonb,
    20, 365, 'test-seed/ec8a/pu4.jpg', null, 'web', v_admin);

  -- PU5 — clean, will be verified below.
  v_sub := submit_result(v_pu5, v_ag5,
    '{"APC":90,"PDP":220,"LP":40}'::jsonb,
    6, 365, 'test-seed/ec8a/pu5.jpg', null, 'web', v_admin);
  perform verify_result(v_sub, v_admin, true);

  -- PU6 — clean with a remark, will be verified below.
  v_sub := submit_result(v_pu6, v_ag6,
    '{"APC":150,"PDP":60,"ADC":95}'::jsonb,
    9, 320, 'test-seed/ec8a/pu6.jpg',
    'Brief disturbance around 10am; resolved by security, voting continued without incident.',
    'web', v_admin);
  perform verify_result(v_sub, v_admin, true);

  -- PU7 — clean on its face, but a coordinator manually disputes it
  -- -> MANUAL_DISPUTE critical flag, verification_state=disputed.
  v_sub7 := submit_result(v_pu7, v_ag7,
    '{"APC":60,"PDP":300,"LP":10}'::jsonb,
    4, 380, 'test-seed/ec8a/pu7.jpg', null, 'web', v_admin);
  perform verify_result(v_sub7, v_admin, false,
    'Figures queried by ward collation — PDP total looks inflated against the carbon copy. Re-checking the original EC8A.');

  -- PU10 — clean, left pending (no verify call at all).
  perform submit_result(v_pu10, v_ag10,
    '{"APC":40,"LP":35,"PDP":30}'::jsonb,
    3, 115, 'test-seed/ec8a/pu10.jpg', null, 'web', v_admin);

  raise notice 'Test data loaded: 10 polling units, 8 reported (3 verified, 3 pending, 2 disputed), 2 outstanding.';
end $$;

-- =====================================================================
-- CLEANUP — run this block (uncomment) to remove everything this file
-- created, once the real INEC register is ready to take over.
-- =====================================================================
-- do $$
-- declare v_pu_ids integer[];
-- begin
--   select array_agg(id) into v_pu_ids from polling_units where name like 'TEST SEED — %';
--   delete from flags where pu_id = any(v_pu_ids);
--   delete from submission_party_votes where submission_id in
--     (select id from result_submissions where pu_id = any(v_pu_ids));
--   delete from result_submissions where pu_id = any(v_pu_ids);
--   delete from agent_phones where agent_id in
--     (select id from agents where full_name like 'TEST SEED — %');
--   delete from agents where full_name like 'TEST SEED — %';
--   delete from polling_units where id = any(v_pu_ids);
-- end $$;

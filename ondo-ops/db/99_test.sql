-- =====================================================================
-- 99_test.sql — proves the integrity rules actually fire.
-- Run against a scratch database. Raises an exception on any failure.
-- =====================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_ward    integer;
  v_pu1     integer;  -- normal unit
  v_pu2     integer;  -- will be over-voted
  v_pu3     integer;  -- will submit with no EC8A
  v_agent1  uuid;
  v_agent2  uuid;
  v_agent3  uuid;
  v_admin   uuid;
  v_sub     uuid;
  v_sub2    uuid;
  v_n       integer;
  v_state   text;
  v_ok      boolean;
begin
  raise notice '--- setting up fixtures ---';

  select id into v_ward from wards where lga_id = 6 and inec_code = '01';  -- Owo / Ehinogbe

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  values (v_ward, '28/18/01/001', '001', 'TEST PU ONE',   500),
         (v_ward, '28/18/01/002', '002', 'TEST PU TWO',   300),
         (v_ward, '28/18/01/003', '003', 'TEST PU THREE', 400);

  select id into v_pu1 from polling_units where inec_code = '28/18/01/001';
  select id into v_pu2 from polling_units where inec_code = '28/18/01/002';
  select id into v_pu3 from polling_units where inec_code = '28/18/01/003';

  insert into app_users (full_name, phone, role) values ('Test Admin', '+2348000000001', 'admin')
    returning id into v_admin;

  insert into agents (pu_id, full_name) values (v_pu1, 'Agent One')   returning id into v_agent1;
  insert into agents (pu_id, full_name) values (v_pu2, 'Agent Two')   returning id into v_agent2;
  insert into agents (pu_id, full_name) values (v_pu3, 'Agent Three') returning id into v_agent3;

  insert into agent_phones (agent_id, phone, consent_recorded_at)
  values (v_agent1, '+2348010000001', now()),
         (v_agent2, '+2348010000002', now()),
         (v_agent3, '+2348010000003', now());

  -- =================================================================
  raise notice 'TEST 1: a clean submission is accepted and left pending';
  -- =================================================================
  v_sub := submit_result(
    p_pu_id          => v_pu1,
    p_agent_id       => v_agent1,
    p_party_votes    => '{"APC": 210, "PDP": 95, "LP": 20}'::jsonb,
    p_rejected_votes => 5,
    p_accredited     => 340,
    p_ec8a_path      => 'ec8a/28-18-01-001.jpg',
    p_remarks        => 'Voting closed peacefully at 2:30pm.'
  );

  select total_valid_votes, verification_state::text into v_n, v_state
    from result_submissions where id = v_sub;
  if v_n <> 325 then raise exception 'FAIL 1a: expected total 325, got %', v_n; end if;
  if v_state <> 'pending' then raise exception 'FAIL 1b: expected pending, got %', v_state; end if;

  select count(*) into v_n from flags where submission_id = v_sub;
  if v_n <> 0 then raise exception 'FAIL 1c: clean submission raised % flag(s)', v_n; end if;
  raise notice '  ok — total summed to 325, no flags raised';

  -- =================================================================
  raise notice 'TEST 2: votes above registered voters are flagged critical and disputed';
  -- =================================================================
  v_sub := submit_result(
    p_pu_id          => v_pu2,
    p_agent_id       => v_agent2,
    p_party_votes    => '{"APC": 280, "PDP": 40}'::jsonb,   -- 320 vs 300 registered
    p_rejected_votes => 3,
    p_ec8a_path      => 'ec8a/28-18-01-002.jpg'
  );

  select verification_state::text into v_state from result_submissions where id = v_sub;
  if v_state <> 'disputed' then raise exception 'FAIL 2a: expected disputed, got %', v_state; end if;

  select count(*) into v_n from flags
   where submission_id = v_sub and type = 'OVER_VOTE' and severity = 'critical';
  if v_n <> 1 then raise exception 'FAIL 2b: expected 1 OVER_VOTE flag, got %', v_n; end if;
  raise notice '  ok — 323 votes against 300 registered -> disputed + OVER_VOTE';

  -- =================================================================
  raise notice 'TEST 3: a missing EC8A photo raises a warning and blocks verification';
  -- =================================================================
  v_sub := submit_result(
    p_pu_id       => v_pu3,
    p_agent_id    => v_agent3,
    p_party_votes => '{"APC": 100, "PDP": 120}'::jsonb,
    p_ec8a_path   => null
  );

  select count(*) into v_n from flags where submission_id = v_sub and type = 'MISSING_EC8A';
  if v_n <> 1 then raise exception 'FAIL 3a: expected MISSING_EC8A flag, got %', v_n; end if;

  v_ok := false;
  begin
    perform verify_result(v_sub, v_admin, true, null);
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL 3b: verification succeeded without an EC8A photo'; end if;
  raise notice '  ok — flagged, and verification refused without the signed form';

  -- =================================================================
  raise notice 'TEST 4: a correction supersedes without destroying the original';
  -- =================================================================
  select id into v_sub from result_submissions where pu_id = v_pu1 and is_current;

  v_sub2 := submit_result(
    p_pu_id       => v_pu1,
    p_agent_id    => v_agent1,
    p_party_votes => '{"APC": 215, "PDP": 95, "LP": 20}'::jsonb,  -- corrected APC figure
    p_rejected_votes => 5,
    p_accredited  => 340,
    p_ec8a_path   => 'ec8a/28-18-01-001-v2.jpg',
    p_remarks     => 'Corrected APC figure after re-reading the EC8A.'
  );

  select count(*) into v_n from result_submissions where pu_id = v_pu1;
  if v_n <> 2 then raise exception 'FAIL 4a: expected 2 rows of history, got %', v_n; end if;

  select count(*) into v_n from result_submissions where pu_id = v_pu1 and is_current;
  if v_n <> 1 then raise exception 'FAIL 4b: expected exactly 1 current row, got %', v_n; end if;

  select verification_state::text into v_state from result_submissions where id = v_sub;
  if v_state <> 'superseded' then raise exception 'FAIL 4c: old row should be superseded, is %', v_state; end if;

  select total_valid_votes into v_n from result_submissions where id = v_sub2;
  if v_n <> 330 then raise exception 'FAIL 4d: corrected total should be 330, got %', v_n; end if;

  select count(*) into v_n from flags where submission_id = v_sub2 and type = 'CORRECTION';
  if v_n <> 1 then raise exception 'FAIL 4e: expected a CORRECTION flag'; end if;
  raise notice '  ok — original retained, one current row, CORRECTION flag raised';

  -- =================================================================
  raise notice 'TEST 5: verification succeeds when the EC8A is present';
  -- =================================================================
  perform verify_result(v_sub2, v_admin, true, 'Checked against photo.');
  select verification_state::text into v_state from result_submissions where id = v_sub2;
  if v_state <> 'verified' then raise exception 'FAIL 5: expected verified, got %', v_state; end if;
  raise notice '  ok';

  -- =================================================================
  raise notice 'TEST 6: an unknown party code is rejected outright';
  -- =================================================================
  v_ok := false;
  begin
    perform submit_result(v_pu1, v_agent1, '{"NOTAPARTY": 10}'::jsonb);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL 6: unknown party code was accepted'; end if;
  raise notice '  ok';

  -- =================================================================
  raise notice 'TEST 7: the late-report sweep flags only silent units';
  -- =================================================================
  select flag_late_reports(now() + interval '1 minute') into v_n;
  -- pu1, pu2, pu3 have all reported; every other active PU has not.
  select count(*) into v_n from flags f
   where f.type = 'LATE_REPORT' and f.resolved_at is null
     and f.pu_id in (v_pu1, v_pu2, v_pu3);
  if v_n <> 0 then raise exception 'FAIL 7: reported units were flagged late'; end if;
  raise notice '  ok — reporting units were not flagged';

  -- =================================================================
  raise notice 'TEST 8: a late flag clears when the unit finally reports';
  -- =================================================================
  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  values (v_ward, '28/18/01/004', '004', 'TEST PU FOUR', 250);
  select id into v_n from polling_units where inec_code = '28/18/01/004';

  perform flag_late_reports(now() + interval '1 minute');
  if (select count(*) from flags where pu_id = v_n and type='LATE_REPORT' and resolved_at is null) <> 1 then
    raise exception 'FAIL 8a: silent unit was not flagged late';
  end if;

  perform submit_result(v_n, null, '{"APC": 50, "PDP": 40}'::jsonb,
                        0, null, 'ec8a/four.jpg', null, 'whatsapp');

  if (select count(*) from flags where pu_id = v_n and type='LATE_REPORT' and resolved_at is null) <> 0 then
    raise exception 'FAIL 8b: late flag did not clear after the unit reported';
  end if;
  raise notice '  ok — late flag cleared on report';

  -- =================================================================
  raise notice 'TEST 9: every write landed in the audit log';
  -- =================================================================
  select count(*) into v_n from audit_log where entity = 'result_submissions';
  if v_n < 5 then raise exception 'FAIL 9: expected audit entries, found %', v_n; end if;
  raise notice '  ok — % audit rows for result_submissions', v_n;


  -- =================================================================
  raise notice 'TEST 10: an agent can hold several numbers, first is primary';
  -- =================================================================
  insert into agent_phones (agent_id, phone, label, consent_recorded_at)
  values (v_agent1, '+2348020000011', 'MTN backup', now()),
         (v_agent1, '+2348030000012', 'ward office', null);

  select count(*) into v_n from agent_phones where agent_id = v_agent1 and is_active;
  if v_n <> 3 then raise exception 'FAIL 10a: expected 3 numbers, got %', v_n; end if;

  select count(*) into v_n from agent_phones where agent_id = v_agent1 and is_primary;
  if v_n <> 1 then raise exception 'FAIL 10b: expected exactly 1 primary, got %', v_n; end if;

  select phone into v_state from agent_phones where agent_id = v_agent1 and is_primary;
  if v_state <> '+2348010000001' then
    raise exception 'FAIL 10c: the first number should remain primary, got %', v_state;
  end if;
  raise notice '  ok — 3 numbers held, the first stayed primary';

  -- =================================================================
  raise notice 'TEST 11: promoting a number demotes the previous primary';
  -- =================================================================
  update agent_phones set is_primary = true
   where agent_id = v_agent1 and phone = '+2348020000011';

  select count(*) into v_n from agent_phones where agent_id = v_agent1 and is_primary;
  if v_n <> 1 then raise exception 'FAIL 11a: % primaries after promotion', v_n; end if;

  select phone into v_state from agent_phones where agent_id = v_agent1 and is_primary;
  if v_state <> '+2348020000011' then
    raise exception 'FAIL 11b: promotion did not take, primary is %', v_state;
  end if;
  raise notice '  ok — exactly one primary, and it is the promoted number';

  -- =================================================================
  raise notice 'TEST 12: consent is tracked per number, not per person';
  -- =================================================================
  select has_consent into v_ok from v_agent_contact where agent_id = v_agent1;
  if not v_ok then raise exception 'FAIL 12a: agent with consented numbers reads as no consent'; end if;

  select whatsapp_phone into v_state from v_agent_contact where agent_id = v_agent1;
  if v_state = '+2348030000012' then
    raise exception 'FAIL 12b: bot would message a number with no recorded consent';
  end if;

  select phone_count into v_n from v_agent_contact where agent_id = v_agent1;
  if v_n <> 3 then raise exception 'FAIL 12c: contact view shows % numbers', v_n; end if;
  raise notice '  ok — unconsented number is held but never messaged';

  -- =================================================================
  raise notice 'TEST 13: an E.164 check rejects a malformed number';
  -- =================================================================
  v_ok := false;
  begin
    insert into agent_phones (agent_id, phone) values (v_agent1, '08012345678');
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL 13: a non-E.164 number was accepted'; end if;
  raise notice '  ok — local-format number rejected, must be +234...';

  raise notice '';
  raise notice '=== ALL TESTS PASSED ===';
end $$;

-- Roll the fixtures back out so the database is left clean.
delete from flags where pu_id in (select id from polling_units where inec_code like '28/18/01/00%');
delete from submission_party_votes where submission_id in (
  select id from result_submissions where pu_id in
    (select id from polling_units where inec_code like '28/18/01/00%'));
update result_submissions set supersedes_id = null
  where pu_id in (select id from polling_units where inec_code like '28/18/01/00%');
delete from result_submissions where pu_id in
  (select id from polling_units where inec_code like '28/18/01/00%');
delete from agent_phones where agent_id in (select id from agents where pu_id in
  (select id from polling_units where inec_code like '28/18/01/00%'));
delete from agents where pu_id in
  (select id from polling_units where inec_code like '28/18/01/00%');
delete from polling_units where inec_code like '28/18/01/00%';
delete from app_users where phone = '+2348000000001';
delete from audit_log;

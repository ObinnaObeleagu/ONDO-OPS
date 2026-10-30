-- =====================================================================
-- 98_test_access.sql — proves the portal boundaries hold.
--
-- This is the test behind the claim "each role sees only its own
-- section, yet everything feeds one control room". It signs in as each
-- role in turn, as a non-superuser so row-level security is actually
-- enforced, and checks what they can and cannot reach.
--
-- Run against a scratch database after 01–05.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- A login-less role that the app would connect as. Superusers bypass
-- RLS, so the test must not run as one.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'test_app') then
    create role test_app;
  end if;
end $$;
grant app_rw to test_app;

-- ---------------------------------------------------------------------
-- Fixtures: two wards in two different LGAs.
-- ---------------------------------------------------------------------
do $$
declare
  w_owo   integer;
  w_owo2  integer;
  w_ose   integer;
  pu_a    integer; pu_b integer; pu_c integer;
  ag_a    uuid;
  u_agent uuid; u_ward uuid; u_lga uuid; u_admin uuid; u_obs uuid;
begin
  select id into w_owo  from wards where lga_id = 6 and inec_code = '01';  -- Owo / Ehinogbe
  select id into w_owo2 from wards where lga_id = 6 and inec_code = '02';  -- Owo / Igboroko I
  select id into w_ose  from wards where lga_id = 5 and inec_code = '01';  -- Ose / Afo

  insert into polling_units (ward_id, inec_code, unit_number, name, registered_voters)
  values (w_owo,  'ACC/001', '001', 'ACCESS TEST A', 400),
         (w_owo2, 'ACC/002', '001', 'ACCESS TEST B', 400),
         (w_ose,  'ACC/003', '001', 'ACCESS TEST C', 400);

  select id into pu_a from polling_units where inec_code = 'ACC/001';
  select id into pu_b from polling_units where inec_code = 'ACC/002';
  select id into pu_c from polling_units where inec_code = 'ACC/003';

  insert into app_users (full_name, phone, role, ward_id, lga_id) values
    ('Test Agent',       '+2349000000001', 'agent',            null,  null)  returning id into u_agent;
  insert into app_users (full_name, phone, role, ward_id) values
    ('Test Ward Coord',  '+2349000000002', 'ward_coordinator', w_owo) returning id into u_ward;
  insert into app_users (full_name, phone, role, lga_id) values
    ('Test LGA Coord',   '+2349000000003', 'lga_coordinator',  6)     returning id into u_lga;
  insert into app_users (full_name, phone, role) values
    ('Test Admin',       '+2349000000004', 'admin')                   returning id into u_admin;
  insert into app_users (full_name, phone, role) values
    ('Test Observer',    '+2349000000005', 'observer')                returning id into u_obs;

  insert into agents (pu_id, user_id, full_name) values (pu_a, u_agent, 'Test Agent')
    returning id into ag_a;
  insert into agent_phones (agent_id, phone, consent_recorded_at)
    values (ag_a, '+2349000000001', now());

  -- A result at each unit, so there is something to see or not see.
  perform submit_result(pu_a, ag_a, '{"APC":100,"PDP":80}'::jsonb, 2, 190, 'ec8a/a.jpg', 'From the agent.');
  perform submit_result(pu_b, null, '{"APC":120,"PDP":60}'::jsonb, 1, 185, 'ec8a/b.jpg', null);
  perform submit_result(pu_c, null, '{"APC":90,"PDP":110}'::jsonb, 0, 200, 'ec8a/c.jpg', null);

  -- Stash the ids for the checks below.
  create temp table _ids on commit preserve rows as
    select u_agent u_agent, u_ward u_ward, u_lga u_lga, u_admin u_admin, u_obs u_obs,
           pu_a pu_a, pu_b pu_b, pu_c pu_c;
end $$;

-- ---------------------------------------------------------------------
-- Now act as the application role, so policies apply.
-- ---------------------------------------------------------------------
do $$
declare
  ids       record;
  v_pus     integer;
  v_results integer;
  v_phones  integer;
  v_scope   jsonb;
  v_ok      boolean;
begin
  select * into ids from _ids;

  -- ============ AGENT ============
  perform set_config('app.user_id', ids.u_agent::text, true);
  set local role test_app;

  select count(*) into v_pus from polling_units;
  if v_pus <> 1 then raise exception 'FAIL A1: agent sees % polling units, expected 1', v_pus; end if;

  select count(*) into v_results from result_submissions;
  if v_results <> 1 then raise exception 'FAIL A2: agent sees % results, expected only their own', v_results; end if;

  select count(*) into v_phones from agent_phones;
  if v_phones <> 1 then raise exception 'FAIL A3: agent sees % phone numbers, expected 1', v_phones; end if;

  v_scope := my_scope();
  if v_scope->>'portal' <> 'agent' then raise exception 'FAIL A4: agent routed to %', v_scope->>'portal'; end if;
  if (v_scope->>'can_verify')::boolean then raise exception 'FAIL A5: agent granted verify rights'; end if;

  reset role;
  raise notice 'agent            — 1 unit, 1 result, 1 phone, portal "agent", cannot verify   ok';

  -- ============ WARD COORDINATOR ============
  perform set_config('app.user_id', ids.u_ward::text, true);
  set local role test_app;

  select count(*) into v_pus from polling_units;
  if v_pus <> 1 then raise exception 'FAIL W1: ward coord sees % units, expected their ward only', v_pus; end if;

  select count(*) into v_results from result_submissions;
  if v_results <> 1 then raise exception 'FAIL W2: ward coord sees % results', v_results; end if;

  -- must NOT see the neighbouring ward in the same LGA
  select count(*) into v_pus from polling_units where id = ids.pu_b;
  if v_pus <> 0 then raise exception 'FAIL W3: ward coord can see a neighbouring ward'; end if;

  v_scope := my_scope();
  if v_scope->>'portal' <> 'ward' then raise exception 'FAIL W4: ward coord routed to %', v_scope->>'portal'; end if;
  if not (v_scope->>'can_verify')::boolean then raise exception 'FAIL W5: ward coord cannot verify'; end if;

  reset role;
  raise notice 'ward coordinator — own ward only, neighbouring ward hidden, can verify        ok';

  -- ============ LGA COORDINATOR ============
  perform set_config('app.user_id', ids.u_lga::text, true);
  set local role test_app;

  select count(*) into v_pus from polling_units;
  if v_pus <> 2 then raise exception 'FAIL L1: LGA coord sees % units, expected 2 across their LGA', v_pus; end if;

  -- must NOT see the other LGA
  select count(*) into v_pus from polling_units where id = ids.pu_c;
  if v_pus <> 0 then raise exception 'FAIL L2: LGA coord can see another LGA'; end if;

  v_scope := my_scope();
  if v_scope->>'portal' <> 'lga' then raise exception 'FAIL L3: LGA coord routed to %', v_scope->>'portal'; end if;

  reset role;
  raise notice 'LGA coordinator  — both wards in their LGA, other LGA hidden                  ok';

  -- ============ ADMIN / CONTROL ROOM ============
  perform set_config('app.user_id', ids.u_admin::text, true);
  set local role test_app;

  select count(*) into v_pus from polling_units where inec_code like 'ACC/%';
  if v_pus <> 3 then raise exception 'FAIL C1: control room sees % of the 3 test units', v_pus; end if;

  -- every submission, whichever portal produced it, is visible here
  select count(*) into v_results from result_submissions
   where pu_id in (ids.pu_a, ids.pu_b, ids.pu_c);
  if v_results <> 3 then raise exception 'FAIL C2: control room sees % of 3 results', v_results; end if;

  v_scope := my_scope();
  if v_scope->>'portal' <> 'control' then raise exception 'FAIL C3: admin routed to %', v_scope->>'portal'; end if;
  if not (v_scope->>'can_manage')::boolean then raise exception 'FAIL C4: admin cannot manage'; end if;

  reset role;
  raise notice 'control room     — all 3 units and all 3 results, from every portal            ok';

  -- ============ OBSERVER ============
  perform set_config('app.user_id', ids.u_obs::text, true);
  set local role test_app;

  select count(*) into v_pus from polling_units where inec_code like 'ACC/%';
  if v_pus <> 3 then raise exception 'FAIL O1: observer sees % of 3 units', v_pus; end if;

  v_scope := my_scope();
  if (v_scope->>'can_verify')::boolean then raise exception 'FAIL O2: observer granted verify rights'; end if;
  if not (v_scope->>'read_only')::boolean then raise exception 'FAIL O3: observer not marked read-only'; end if;

  reset role;
  raise notice 'observer         — sees everything, may change nothing                        ok';

  -- ============ NOBODY MAY DELETE A RESULT ============
  perform set_config('app.user_id', ids.u_admin::text, true);
  set local role test_app;
  v_ok := false;
  begin
    delete from result_submissions where pu_id = ids.pu_a;
    -- RLS with no DELETE policy silently removes nothing rather than erroring
    if not found then v_ok := true; end if;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;

  if not v_ok then raise exception 'FAIL D1: an admin deleted a result'; end if;
  if (select count(*) from result_submissions where pu_id = ids.pu_a) = 0 then
    raise exception 'FAIL D2: the result actually disappeared';
  end if;
  raise notice 'delete attempt   — refused even for an admin; history is immutable            ok';

  raise notice '';
  raise notice '=== ACCESS MODEL VERIFIED ===';
end $$;

-- ---------------------------------------------------------------------
-- Clean up
-- ---------------------------------------------------------------------
delete from flags where pu_id in (select id from polling_units where inec_code like 'ACC/%');
delete from submission_party_votes where submission_id in (
  select id from result_submissions where pu_id in
    (select id from polling_units where inec_code like 'ACC/%'));
update result_submissions set supersedes_id = null
  where pu_id in (select id from polling_units where inec_code like 'ACC/%');
delete from result_submissions where pu_id in
  (select id from polling_units where inec_code like 'ACC/%');
delete from agent_phones where agent_id in (select id from agents where pu_id in
  (select id from polling_units where inec_code like 'ACC/%'));
delete from agents where pu_id in (select id from polling_units where inec_code like 'ACC/%');
delete from polling_units where inec_code like 'ACC/%';
delete from app_users where phone like '+23490000000%';
delete from audit_log;
drop table if exists _ids;

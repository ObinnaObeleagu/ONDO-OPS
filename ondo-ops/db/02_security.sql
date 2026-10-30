-- =====================================================================
-- 02_security.sql — row-level security
--
-- Principle: least privilege. An agent can only ever see and touch their
-- own polling unit. A ward coordinator sees their ward. An LGA
-- coordinator sees their LGA. Only admins see the whole district.
--
-- Agents' phone numbers are personal data under the Nigeria Data
-- Protection Act 2023, so the agents table is scoped the same way.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Scope helpers. STABLE + security definer so policies can call them
-- without the caller needing rights on app_users.
-- ---------------------------------------------------------------------

create or replace function current_role_of()
returns user_role
language sql
stable
security definer
as $$
  select role from app_users where id = app_current_user_id() and is_active;
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(current_role_of() = 'admin', false);
$$;

create or replace function can_read_all()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(current_role_of() in ('admin','observer'), false);
$$;

-- Every polling unit the current user is entitled to see.
create or replace function visible_pu_ids()
returns table (pu_id integer)
language sql
stable
security definer
as $$
  with me as (
    select u.id, u.role, u.lga_id, u.ward_id
      from app_users u
     where u.id = app_current_user_id() and u.is_active
  )
  select pu.id
    from polling_units pu
    join wards w on w.id = pu.ward_id
    cross join me
   where
        (me.role in ('admin','observer'))
     or (me.role = 'lga_coordinator'  and w.lga_id = me.lga_id)
     or (me.role = 'ward_coordinator' and pu.ward_id = me.ward_id)
     or (me.role = 'agent' and exists (
           select 1 from agents a
            where a.user_id = me.id and a.pu_id = pu.id and a.is_active));
$$;

-- ---------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------
alter table lgas                   enable row level security;
alter table wards                  enable row level security;
alter table polling_units          enable row level security;
alter table parties                enable row level security;
alter table app_users              enable row level security;
alter table agents                 enable row level security;
alter table result_submissions     enable row level security;
alter table submission_party_votes enable row level security;
alter table flags                  enable row level security;
alter table audit_log              enable row level security;

-- ---------------------------------------------------------------------
-- Reference data: readable by any signed-in user, writable by admins.
-- (Knowing the list of wards is not sensitive; knowing who the agents
-- are, and what they reported, is.)
-- ---------------------------------------------------------------------
create policy lgas_read   on lgas    for select using (app_current_user_id() is not null);
create policy lgas_write  on lgas    for all    using (is_admin()) with check (is_admin());

create policy wards_read  on wards   for select using (app_current_user_id() is not null);
create policy wards_write on wards   for all    using (is_admin()) with check (is_admin());

create policy parties_read  on parties for select using (app_current_user_id() is not null);
create policy parties_write on parties for all    using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- Polling units: scoped to what the user covers.
-- ---------------------------------------------------------------------
create policy pu_read on polling_units
  for select using (id in (select pu_id from visible_pu_ids()));

create policy pu_write on polling_units
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- Users: you can always read yourself. Coordinators read users in their
-- scope. Only admins create or change users.
-- ---------------------------------------------------------------------
create policy users_read_self on app_users
  for select using (id = app_current_user_id());

create policy users_read_scope on app_users
  for select using (
    can_read_all()
    or (current_role_of() = 'lga_coordinator'
        and lga_id = (select lga_id from app_users where id = app_current_user_id()))
    or (current_role_of() = 'ward_coordinator'
        and ward_id = (select ward_id from app_users where id = app_current_user_id()))
  );

create policy users_write on app_users
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- Agents: personal data. Visible only within the reader's scope.
-- ---------------------------------------------------------------------
create policy agents_read on agents
  for select using (pu_id in (select pu_id from visible_pu_ids()));

create policy agents_write on agents
  for all
  using (is_admin() or (current_role_of() in ('ward_coordinator','lga_coordinator')
                        and pu_id in (select pu_id from visible_pu_ids())))
  with check (is_admin() or (current_role_of() in ('ward_coordinator','lga_coordinator')
                        and pu_id in (select pu_id from visible_pu_ids())));

-- Phone numbers inherit the scope of the agent they belong to.
alter table agent_phones enable row level security;

create policy agent_phones_read on agent_phones
  for select using (
    agent_id in (select id from agents where pu_id in (select pu_id from visible_pu_ids()))
  );

create policy agent_phones_write on agent_phones
  for all
  using (
    is_admin() or (current_role_of() in ('ward_coordinator','lga_coordinator')
      and agent_id in (select id from agents where pu_id in (select pu_id from visible_pu_ids())))
  )
  with check (
    is_admin() or (current_role_of() in ('ward_coordinator','lga_coordinator')
      and agent_id in (select id from agents where pu_id in (select pu_id from visible_pu_ids())))
  );

-- ---------------------------------------------------------------------
-- Result submissions.
-- Reading: anything inside your scope.
-- Writing: inserts go through submit_result() (security definer), so no
--   direct INSERT policy is granted to agents.
-- Updating: only coordinators and admins, and only inside their scope.
--   Nobody may DELETE — corrections create a new row instead.
-- ---------------------------------------------------------------------
create policy rs_read on result_submissions
  for select using (pu_id in (select pu_id from visible_pu_ids()));

create policy rs_update on result_submissions
  for update
  using (
    current_role_of() in ('admin','ward_coordinator','lga_coordinator')
    and pu_id in (select pu_id from visible_pu_ids())
  )
  with check (
    current_role_of() in ('admin','ward_coordinator','lga_coordinator')
    and pu_id in (select pu_id from visible_pu_ids())
  );

-- deliberately no DELETE policy on result_submissions

create policy spv_read on submission_party_votes
  for select using (
    submission_id in (
      select id from result_submissions where pu_id in (select pu_id from visible_pu_ids())
    )
  );

-- ---------------------------------------------------------------------
-- Flags: readable in scope; resolvable by coordinators and admins.
-- ---------------------------------------------------------------------
create policy flags_read on flags
  for select using (pu_id in (select pu_id from visible_pu_ids()));

create policy flags_update on flags
  for update
  using (current_role_of() in ('admin','ward_coordinator','lga_coordinator')
         and pu_id in (select pu_id from visible_pu_ids()))
  with check (current_role_of() in ('admin','ward_coordinator','lga_coordinator')
         and pu_id in (select pu_id from visible_pu_ids()));

create policy flags_insert on flags
  for insert
  with check (current_role_of() in ('admin','ward_coordinator','lga_coordinator')
         and pu_id in (select pu_id from visible_pu_ids()));

-- ---------------------------------------------------------------------
-- Audit log: admins read it, nobody edits it. Writes come from the
-- security-definer trigger, which bypasses RLS.
-- ---------------------------------------------------------------------
create policy audit_read on audit_log
  for select using (is_admin());

-- =====================================================================
-- PORTAL SCOPE
--
-- One call the app makes right after sign-in. It answers three
-- questions at once: who is this, what may they see, and which portal
-- do they land on. The app routes on `portal`; it does not decide
-- access for itself, because the policies above already have.
-- =====================================================================
create or replace function my_scope()
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  u record;
  v_portal text;
  v_pu_count integer;
  v_agent_pu integer;
begin
  select * into u from app_users where id = app_current_user_id() and is_active;

  if u is null then
    return jsonb_build_object('signed_in', false);
  end if;

  select count(*) into v_pu_count from visible_pu_ids();

  v_portal := case u.role
    when 'agent'            then 'agent'
    when 'ward_coordinator' then 'ward'
    when 'lga_coordinator'  then 'lga'
    when 'admin'            then 'control'
    when 'observer'         then 'control'
  end;

  if u.role = 'agent' then
    select a.pu_id into v_agent_pu
      from agents a where a.user_id = u.id and a.is_active
      order by a.created_at limit 1;
  end if;

  return jsonb_build_object(
    'signed_in',   true,
    'user_id',     u.id,
    'full_name',   u.full_name,
    'role',        u.role,
    'portal',      v_portal,
    'lga_id',      u.lga_id,
    'ward_id',     u.ward_id,
    'pu_id',       v_agent_pu,
    'pu_count',    v_pu_count,
    'can_verify',  u.role in ('admin','ward_coordinator','lga_coordinator'),
    'can_manage',  u.role = 'admin',
    'read_only',   u.role = 'observer'
  );
end;
$$;

comment on function my_scope is
  'Returns the signed-in user''s role, scope and landing portal. The app routes on this; '
  'row-level security still enforces the boundary regardless of what the app does with it.';

-- ---------------------------------------------------------------------
-- Application role grants.
-- `app_rw` is the role the API connects as. It gets no direct write on
-- result_submissions: submissions must go through submit_result().
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw nologin;
  end if;
end $$;

grant usage on schema public to app_rw;
grant select on lgas, wards, polling_units, parties, app_users, agents,
                result_submissions, submission_party_votes, flags to app_rw;
grant insert, update on agents, agent_phones, flags to app_rw;
grant select on agent_phones to app_rw;
grant delete on agent_phones to app_rw;
grant update on result_submissions to app_rw;
grant update, insert on polling_units, app_users to app_rw;
grant select on audit_log to app_rw;
grant execute on function submit_result(integer, uuid, jsonb, integer, integer, text, text, text, uuid) to app_rw;
grant execute on function verify_result(uuid, uuid, boolean, text) to app_rw;
grant execute on function flag_late_reports(timestamptz) to app_rw;
grant execute on function my_scope() to app_rw;
grant usage, select on all sequences in schema public to app_rw;

-- Service role for scheduled jobs (late-report sweep, exports, backups).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_jobs') then
    create role app_jobs nologin;
  end if;
end $$;
grant usage on schema public to app_jobs;
grant select on all tables in schema public to app_jobs;
grant execute on function flag_late_reports(timestamptz) to app_jobs;

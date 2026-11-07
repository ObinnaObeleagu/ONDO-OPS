-- =====================================================================
-- Election Control Room — Ops Dashboard
-- Ondo North Senatorial District
-- 01_schema.sql — core data model, integrity checks, audit trail
--
-- Target: PostgreSQL 15+ (written for Supabase, runs on plain Postgres)
-- Load order: 01_schema.sql -> 02_security.sql -> 03_views.sql -> 04_seed_*.sql
-- =====================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive text

-- ---------------------------------------------------------------------
-- Portability shim: resolves the current user id.
-- On Supabase this returns auth.uid(). Locally it reads the
-- `app.user_id` session setting so the same policies can be tested.
-- ---------------------------------------------------------------------
create or replace function app_current_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  v uuid;
begin
  begin
    execute 'select auth.uid()' into v;
    if v is not null then
      return v;
    end if;
  exception when others then
    v := null;
  end;

  begin
    v := nullif(current_setting('app.user_id', true), '')::uuid;
  exception when others then
    v := null;
  end;

  return v;
end;
$$;

-- =====================================================================
-- 1. ELECTORAL GEOGRAPHY
-- =====================================================================

create table lgas (
  id            smallint primary key,
  inec_code     text not null unique,            -- e.g. '18' for Owo
  name          text not null unique,
  created_at    timestamptz not null default now()
);
comment on table lgas is 'The 6 LGAs of Ondo North senatorial district.';

create table wards (
  id            serial primary key,
  lga_id        smallint not null references lgas(id) on delete restrict,
  inec_code     text not null,                   -- 2-digit ward code within the LGA
  name          text not null,
  name_verified boolean not null default true,   -- false = name not yet confirmed against INEC register
  created_at    timestamptz not null default now(),
  unique (lga_id, inec_code)
);
comment on column wards.name_verified is
  'FALSE where the ward name could not be confirmed from an official INEC source and must be verified before go-live.';

create table polling_units (
  id                   serial primary key,
  ward_id              integer not null references wards(id) on delete restrict,
  inec_code            text not null unique,     -- full delimitation code, e.g. '28/18/01/004'
  unit_number          text not null,            -- 3-digit unit number within the ward
  name                 text not null,
  location_description text,
  registered_voters    integer not null check (registered_voters >= 0),
  latitude             numeric(9,6),
  longitude            numeric(9,6),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (ward_id, unit_number)
);
comment on column polling_units.registered_voters is
  'From the official INEC register. The over-vote check measures submitted votes against this number.';

create index on polling_units (ward_id);

-- =====================================================================
-- 2. PARTIES ON THE BALLOT
-- =====================================================================

create table parties (
  id          smallserial primary key,
  code        text not null unique,              -- 'APC', 'PDP', ...
  name        text not null,
  colour      text,                              -- hex for light mode charts
  colour_dark text,                              -- hex stepped for the dark surface
  is_tracked  boolean not null default true,     -- false hides minor parties from headline views
  sort_order  smallint not null default 100
);

-- =====================================================================
-- 3. PEOPLE AND ROLES
-- =====================================================================

create type user_role as enum (
  'agent',              -- polling agent, one polling unit
  'ward_coordinator',   -- all PUs in one ward
  'lga_coordinator',    -- all wards in one LGA
  'admin',              -- full district, read + verify + manage
  'observer'            -- full district, read only
);

-- Mirrors auth.users on Supabase. Holds the scope that drives row-level security.
create table app_users (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  phone           text not null unique,          -- E.164, e.g. +2348012345678
  email           citext unique,
  role            user_role not null,
  lga_id          smallint references lgas(id),
  ward_id         integer references wards(id),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  -- scope must match the role
  constraint scope_matches_role check (
    (role = 'ward_coordinator' and ward_id is not null)
    or (role = 'lga_coordinator' and lga_id is not null)
    or (role in ('agent','admin','observer'))
  )
);

create type agent_kind as enum ('polling_agent', 'collation_agent');

create table agents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references app_users(id) on delete set null,
  pu_id               integer not null references polling_units(id) on delete restrict,
  full_name           text not null,
  kind                agent_kind not null default 'polling_agent',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

create index on agents (pu_id);

-- ---------------------------------------------------------------------
-- An agent may reach us from more than one number: a main line and a
-- backup on a different network, a spouse's handset, a phone that holds
-- the WhatsApp account while calls come from another. Each number is
-- its own row, with its own NDPA consent, because consent is given for
-- a specific number.
-- ---------------------------------------------------------------------
create table agent_phones (
  id                  uuid primary key default gen_random_uuid(),
  agent_id            uuid not null references agents(id) on delete cascade,
  phone               text not null,             -- E.164, e.g. +2348012345678
  label               text,                      -- 'main', 'MTN backup', 'ward office'
  is_primary          boolean not null default false,
  whatsapp_enabled    boolean not null default true,
  -- NDPA 2023: consent to hold THIS number. NULL blocks messaging to it.
  consent_recorded_at timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  constraint phone_is_e164 check (phone ~ '^\+[1-9]\d{7,14}$'),
  unique (agent_id, phone)
);

comment on table agent_phones is
  'One row per contact number for an agent. Consent is recorded per number, not per person, '
  'because that is what the Nigeria Data Protection Act 2023 asks for.';

create index on agent_phones (phone) where is_active;
create index on agent_phones (agent_id);

-- At most one primary number per agent.
create unique index one_primary_phone_per_agent
  on agent_phones (agent_id) where is_primary;

-- The first number added for an agent becomes the primary automatically,
-- so a row can never end up with no reachable default.
create or replace function fn_first_phone_is_primary()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from agent_phones
                  where agent_id = new.agent_id and is_primary and id <> new.id) then
    new.is_primary := true;
  end if;
  return new;
end $$;

create trigger first_phone_is_primary
  before insert on agent_phones
  for each row execute function fn_first_phone_is_primary();

-- Promoting a number demotes the previous primary rather than failing on
-- the unique index.
create or replace function fn_single_primary_phone()
returns trigger language plpgsql as $$
begin
  if new.is_primary then
    update agent_phones set is_primary = false
     where agent_id = new.agent_id and id <> new.id and is_primary;
  end if;
  return new;
end $$;

create trigger single_primary_phone
  before update of is_primary on agent_phones
  for each row when (new.is_primary) execute function fn_single_primary_phone();

-- =====================================================================
-- 4. RESULT SUBMISSIONS
--    Append-only. A correction is a NEW row; the old row is retained
--    with is_current = false. Nothing is ever overwritten.
-- =====================================================================

create type verification_state as enum (
  'pending',    -- submitted, not yet checked by a coordinator
  'verified',   -- coordinator confirmed against the EC8A photo
  'disputed',   -- failed an automatic check or was rejected by a coordinator
  'superseded'  -- replaced by a later submission
);

create table result_submissions (
  id                 uuid primary key default gen_random_uuid(),
  pu_id              integer not null references polling_units(id) on delete restrict,
  agent_id           uuid references agents(id) on delete set null,
  submitted_by       uuid references app_users(id) on delete set null,
  channel            text not null default 'web' check (channel in ('web','whatsapp','sms','manual')),

  accredited_voters  integer check (accredited_voters >= 0),
  total_valid_votes  integer not null check (total_valid_votes >= 0),
  rejected_votes     integer not null default 0 check (rejected_votes >= 0),

  ec8a_photo_path    text,                       -- object-storage path to the signed Form EC8A
  remarks            text check (char_length(remarks) <= 1000),

  verification_state verification_state not null default 'pending',
  verified_by        uuid references app_users(id) on delete set null,
  verified_at        timestamptz,
  is_current         boolean not null default true,

  submitted_at       timestamptz not null default now(),
  supersedes_id      uuid references result_submissions(id),

  constraint verified_needs_verifier check (
    (verification_state <> 'verified') or (verified_by is not null and verified_at is not null)
  )
);

create index on result_submissions (pu_id) where is_current;
create index on result_submissions (verification_state) where is_current;
create index on result_submissions (submitted_at desc);

-- Only one current submission per polling unit.
create unique index one_current_submission_per_pu
  on result_submissions (pu_id) where is_current;

create table submission_party_votes (
  submission_id uuid not null references result_submissions(id) on delete cascade,
  party_id      smallint not null references parties(id) on delete restrict,
  votes         integer not null check (votes >= 0),
  primary key (submission_id, party_id)
);

-- =====================================================================
-- 5. AUTOMATIC CHECKS — flags raised by the system, not by people
-- =====================================================================

create type flag_type as enum (
  'OVER_VOTE',        -- votes cast exceed registered voters at that PU
  'EXCEEDS_ACCREDITED', -- valid votes exceed accredited voters
  'MISSING_EC8A',     -- no photo of the signed result sheet
  'LATE_REPORT',      -- PU had not reported by the deadline
  'TOTAL_MISMATCH',   -- party votes do not sum to the declared valid total
  'CORRECTION',       -- a later submission replaced an earlier one
  'MANUAL_DISPUTE'    -- a coordinator raised it by hand
);

create type flag_severity as enum ('info', 'warning', 'critical');

create table flags (
  id            bigserial primary key,
  pu_id         integer not null references polling_units(id) on delete cascade,
  submission_id uuid references result_submissions(id) on delete cascade,
  type          flag_type not null,
  severity      flag_severity not null,
  detail        text not null,
  resolved_at   timestamptz,
  resolved_by   uuid references app_users(id) on delete set null,
  resolution_note text,
  created_at    timestamptz not null default now()
);

create index on flags (pu_id);
create index on flags (type) where resolved_at is null;
create index on flags (created_at desc);

-- =====================================================================
-- 6. AUDIT LOG — who did what, when. Append only.
-- =====================================================================

create table audit_log (
  id          bigserial primary key,
  actor_id    uuid,                   -- app_users.id, not FK-enforced so deletes can't erase history
  actor_label text,
  action      text not null,          -- INSERT | UPDATE | DELETE | VERIFY | DISPUTE | LOGIN ...
  entity      text not null,          -- table or domain object
  entity_id   text,
  before_data jsonb,
  after_data  jsonb,
  at          timestamptz not null default now()
);

create index on audit_log (entity, entity_id);
create index on audit_log (at desc);

create or replace function fn_audit()
returns trigger
language plpgsql
security definer
as $$
declare
  v_actor uuid := app_current_user_id();
  v_label text;
  v_id    text;
begin
  select full_name into v_label from app_users where id = v_actor;

  if tg_op = 'DELETE' then
    v_id := coalesce(old.id::text, null);
    insert into audit_log(actor_id, actor_label, action, entity, entity_id, before_data)
    values (v_actor, v_label, tg_op, tg_table_name, v_id, to_jsonb(old));
    return old;
  else
    v_id := coalesce(new.id::text, null);
    insert into audit_log(actor_id, actor_label, action, entity, entity_id, before_data, after_data)
    values (v_actor, v_label, tg_op, tg_table_name, v_id,
            case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
            to_jsonb(new));
    return new;
  end if;
end;
$$;

create trigger audit_result_submissions
  after insert or update or delete on result_submissions
  for each row execute function fn_audit();

create trigger audit_polling_units
  after insert or update or delete on polling_units
  for each row execute function fn_audit();

create trigger audit_agents
  after insert or update or delete on agents
  for each row execute function fn_audit();

create trigger audit_agent_phones
  after insert or update or delete on agent_phones
  for each row execute function fn_audit();

create trigger audit_app_users
  after insert or update or delete on app_users
  for each row execute function fn_audit();

-- =====================================================================
-- 7. SUBMISSION PIPELINE
--    One transactional entry point. The API and the WhatsApp bot both
--    call submit_result(); neither writes to the tables directly.
-- =====================================================================

create or replace function submit_result(
  p_pu_id            integer,
  p_agent_id         uuid,
  p_party_votes      jsonb,          -- {"APC": 120, "PDP": 95, ...}
  p_rejected_votes   integer default 0,
  p_accredited       integer default null,
  p_ec8a_path        text default null,
  p_remarks          text default null,
  p_channel          text default 'web',
  p_submitted_by     uuid default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_submission_id uuid;
  v_prev_id       uuid;
  v_total         integer := 0;
  v_registered    integer;
  v_party_id      smallint;
  v_code          text;
  v_votes         integer;
  v_pu_label      text;
begin
  select pu.registered_voters, pu.name || ' (' || pu.inec_code || ')'
    into v_registered, v_pu_label
    from polling_units pu where pu.id = p_pu_id and pu.is_active;

  if v_registered is null then
    raise exception 'Unknown or inactive polling unit: %', p_pu_id
      using errcode = 'foreign_key_violation';
  end if;

  if p_party_votes is null or jsonb_typeof(p_party_votes) <> 'object' then
    raise exception 'party_votes must be a JSON object of {party_code: votes}';
  end if;

  -- Validate every party code before writing anything.
  for v_code, v_votes in select key, value::text::integer from jsonb_each(p_party_votes)
  loop
    if v_votes < 0 then
      raise exception 'Negative vote count for party %', v_code;
    end if;
    select id into v_party_id from parties where code = upper(v_code);
    if v_party_id is null then
      raise exception 'Unknown party code: %', v_code;
    end if;
    v_total := v_total + v_votes;
  end loop;

  -- Retire the previous current submission (kept, never deleted).
  select id into v_prev_id
    from result_submissions
   where pu_id = p_pu_id and is_current;

  if v_prev_id is not null then
    update result_submissions
       set is_current = false,
           verification_state = 'superseded'
     where id = v_prev_id;
  end if;

  insert into result_submissions (
    pu_id, agent_id, submitted_by, channel,
    accredited_voters, total_valid_votes, rejected_votes,
    ec8a_photo_path, remarks, supersedes_id
  ) values (
    p_pu_id, p_agent_id, p_submitted_by, p_channel,
    p_accredited, v_total, coalesce(p_rejected_votes, 0),
    p_ec8a_path, p_remarks, v_prev_id
  ) returning id into v_submission_id;

  insert into submission_party_votes (submission_id, party_id, votes)
  select v_submission_id, p.id, (e.value::text)::integer
    from jsonb_each(p_party_votes) e
    join parties p on p.code = upper(e.key);

  -- ---- automatic checks -------------------------------------------
  if (v_total + coalesce(p_rejected_votes,0)) > v_registered then
    insert into flags (pu_id, submission_id, type, severity, detail)
    values (p_pu_id, v_submission_id, 'OVER_VOTE', 'critical',
            format('%s: %s votes cast against %s registered voters.',
                   v_pu_label, v_total + coalesce(p_rejected_votes,0), v_registered));
    update result_submissions set verification_state = 'disputed' where id = v_submission_id;
  end if;

  if p_accredited is not null and v_total > p_accredited then
    insert into flags (pu_id, submission_id, type, severity, detail)
    values (p_pu_id, v_submission_id, 'EXCEEDS_ACCREDITED', 'critical',
            format('%s: %s valid votes against %s accredited voters.',
                   v_pu_label, v_total, p_accredited));
    update result_submissions set verification_state = 'disputed' where id = v_submission_id;
  end if;

  if p_ec8a_path is null or btrim(p_ec8a_path) = '' then
    insert into flags (pu_id, submission_id, type, severity, detail)
    values (p_pu_id, v_submission_id, 'MISSING_EC8A', 'warning',
            format('%s: submitted without a photo of the signed Form EC8A.', v_pu_label));
  end if;

  if v_prev_id is not null then
    insert into flags (pu_id, submission_id, type, severity, detail)
    values (p_pu_id, v_submission_id, 'CORRECTION', 'warning',
            format('%s: figures replaced by a later submission. Earlier record retained.', v_pu_label));
  end if;

  -- A submission clears any outstanding late-report flag for this PU.
  update flags
     set resolved_at = now(),
         resolution_note = 'Polling unit reported.'
   where pu_id = p_pu_id and type = 'LATE_REPORT' and resolved_at is null;

  return v_submission_id;
end;
$$;

comment on function submit_result is
  'Single transactional entry point for result submission. Validates, supersedes any prior '
  'submission, writes party votes, and raises automatic flags. Never overwrites history.';

-- ---------------------------------------------------------------------
-- Verification. A result cannot be verified without the EC8A photo.
-- ---------------------------------------------------------------------
create or replace function verify_result(
  p_submission_id uuid,
  p_verifier_id   uuid,
  p_approve       boolean,
  p_note          text default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_photo text;
  v_pu    integer;
begin
  select ec8a_photo_path, pu_id into v_photo, v_pu
    from result_submissions where id = p_submission_id and is_current;

  if v_pu is null then
    raise exception 'No current submission with id %', p_submission_id;
  end if;

  if p_approve and (v_photo is null or btrim(v_photo) = '') then
    raise exception 'Cannot verify without a photo of the signed Form EC8A.'
      using errcode = 'check_violation';
  end if;

  update result_submissions
     set verification_state = (case when p_approve then 'verified' else 'disputed' end)::verification_state,
         verified_by = p_verifier_id,
         verified_at = now()
   where id = p_submission_id;

  if not p_approve then
    insert into flags (pu_id, submission_id, type, severity, detail)
    values (v_pu, p_submission_id, 'MANUAL_DISPUTE', 'critical',
            coalesce(p_note, 'Disputed by a coordinator.'));
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, after_data)
  values (p_verifier_id,
          case when p_approve then 'VERIFY' else 'DISPUTE' end,
          'result_submissions', p_submission_id::text,
          jsonb_build_object('note', p_note));
end;
$$;

-- ---------------------------------------------------------------------
-- Late-report sweep. Run on a schedule (pg_cron / Supabase scheduled
-- function) once the reporting deadline has passed.
-- ---------------------------------------------------------------------
create or replace function flag_late_reports(p_deadline timestamptz)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with unreported as (
    select pu.id, pu.name, pu.inec_code
      from polling_units pu
     where pu.is_active
       and not exists (
         select 1 from result_submissions rs
          where rs.pu_id = pu.id and rs.is_current
            and rs.submitted_at <= p_deadline
       )
       and not exists (
         select 1 from flags f
          where f.pu_id = pu.id and f.type = 'LATE_REPORT' and f.resolved_at is null
       )
  )
  insert into flags (pu_id, type, severity, detail)
  select id, 'LATE_REPORT', 'warning',
         format('%s (%s) had not reported by %s.', name, inec_code,
                to_char(p_deadline, 'DD Mon HH24:MI'))
    from unreported;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- keep polling_units.updated_at honest
create or replace function fn_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger touch_polling_units
  before update on polling_units
  for each row execute function fn_touch_updated_at();

-- =====================================================================
-- 03_views.sql — reporting views that drive the dashboard
--
-- All views are security_invoker, so row-level security still applies:
-- a ward coordinator querying v_ward_coverage sees only their ward.
-- =====================================================================

-- ---------------------------------------------------------------------
-- One row per agent, flattening their contact numbers.
--   primary_phone  — the number to ring first
--   all_phones     — every active number, primary first
--   whatsapp_phone — the number the bot will answer on
--   has_consent    — at least one number may lawfully be contacted
-- ---------------------------------------------------------------------
create or replace view v_agent_contact
with (security_invoker = true) as
select
  a.id        as agent_id,
  a.pu_id,
  a.full_name,
  a.kind,
  a.is_active,
  (select p.phone from agent_phones p
    where p.agent_id = a.id and p.is_active
    order by p.is_primary desc, p.created_at
    limit 1)  as primary_phone,
  (select array_agg(p.phone order by p.is_primary desc, p.created_at)
     from agent_phones p where p.agent_id = a.id and p.is_active
  )           as all_phones,
  (select count(*) from agent_phones p where p.agent_id = a.id and p.is_active
  )           as phone_count,
  (select p.phone from agent_phones p
    where p.agent_id = a.id and p.is_active and p.whatsapp_enabled
      and p.consent_recorded_at is not null
    order by p.is_primary desc, p.created_at
    limit 1)  as whatsapp_phone,
  exists (select 1 from agent_phones p
           where p.agent_id = a.id and p.is_active
             and p.consent_recorded_at is not null
  )           as has_consent
from agents a;

comment on view v_agent_contact is
  'Flattens agent_phones so callers do not have to join it. has_consent is true when at '
  'least one active number carries recorded NDPA consent.';

-- ---------------------------------------------------------------------
-- Current result per polling unit, with ward and LGA attached.
-- ---------------------------------------------------------------------
create or replace view v_pu_current
with (security_invoker = true) as
select
  pu.id                      as pu_id,
  pu.inec_code,
  pu.name                    as pu_name,
  pu.registered_voters,
  w.id                       as ward_id,
  w.name                     as ward_name,
  l.id                       as lga_id,
  l.name                     as lga_name,
  rs.id                      as submission_id,
  rs.total_valid_votes,
  rs.rejected_votes,
  rs.accredited_voters,
  rs.verification_state,
  rs.ec8a_photo_path is not null and btrim(rs.ec8a_photo_path) <> '' as has_ec8a,
  rs.remarks,
  rs.submitted_at,
  rs.channel,
  a.full_name                as agent_name,
  ac.primary_phone           as agent_phone,
  ac.all_phones              as agent_phones,
  case
    when rs.id is null then 'not_reported'
    else rs.verification_state::text
  end                        as status,
  case
    when rs.id is not null and pu.registered_voters > 0
      then round(100.0 * (rs.total_valid_votes + rs.rejected_votes) / pu.registered_voters, 1)
  end                        as turnout_pct
from polling_units pu
join wards w on w.id = pu.ward_id
join lgas  l on l.id = w.lga_id
left join result_submissions rs on rs.pu_id = pu.id and rs.is_current
left join agents a on a.id = rs.agent_id
left join v_agent_contact ac on ac.agent_id = a.id
where pu.is_active;

comment on view v_pu_current is
  'One row per active polling unit with its current result, or nulls if it has not reported.';

-- ---------------------------------------------------------------------
-- Ward-level coverage and progress.
-- ---------------------------------------------------------------------
create or replace view v_ward_coverage
with (security_invoker = true) as
select
  w.id                                    as ward_id,
  w.name                                  as ward_name,
  w.inec_code                             as ward_code,
  l.id                                    as lga_id,
  l.name                                  as lga_name,
  count(pu.id)                            as total_pus,
  count(rs.id)                            as reported_pus,
  count(pu.id) - count(rs.id)             as outstanding_pus,
  case when count(pu.id) = 0 then 0
       else round(100.0 * count(rs.id) / count(pu.id), 1) end as reported_pct,
  count(*) filter (where rs.verification_state = 'verified')  as verified_pus,
  count(*) filter (where rs.verification_state = 'disputed')  as disputed_pus,
  coalesce(sum(pu.registered_voters), 0)                      as registered_voters,
  coalesce(sum(rs.total_valid_votes), 0)                      as valid_votes,
  coalesce(sum(rs.rejected_votes), 0)                         as rejected_votes,
  max(rs.submitted_at)                                        as last_report_at
from wards w
join lgas l on l.id = w.lga_id
left join polling_units pu on pu.ward_id = w.id and pu.is_active
left join result_submissions rs on rs.pu_id = pu.id and rs.is_current
group by w.id, w.name, w.inec_code, l.id, l.name;

-- ---------------------------------------------------------------------
-- LGA-level rollup.
-- ---------------------------------------------------------------------
create or replace view v_lga_coverage
with (security_invoker = true) as
select
  l.id                                    as lga_id,
  l.name                                  as lga_name,
  l.inec_code                             as lga_code,
  count(distinct w.id)                    as total_wards,
  count(pu.id)                            as total_pus,
  count(rs.id)                            as reported_pus,
  count(pu.id) - count(rs.id)             as outstanding_pus,
  case when count(pu.id) = 0 then 0
       else round(100.0 * count(rs.id) / count(pu.id), 1) end as reported_pct,
  count(*) filter (where rs.verification_state = 'verified') as verified_pus,
  count(*) filter (where rs.verification_state = 'disputed') as disputed_pus,
  coalesce(sum(pu.registered_voters), 0)  as registered_voters,
  coalesce(sum(rs.total_valid_votes), 0)  as valid_votes,
  coalesce(sum(rs.rejected_votes), 0)     as rejected_votes,
  max(rs.submitted_at)                    as last_report_at
from lgas l
left join wards w on w.lga_id = l.id
left join polling_units pu on pu.ward_id = w.id and pu.is_active
left join result_submissions rs on rs.pu_id = pu.id and rs.is_current
group by l.id, l.name, l.inec_code;

-- ---------------------------------------------------------------------
-- District headline numbers.
-- ---------------------------------------------------------------------
create or replace view v_district_summary
with (security_invoker = true) as
select
  count(pu.id)                                                as total_pus,
  count(rs.id)                                                as reported_pus,
  count(pu.id) - count(rs.id)                                 as outstanding_pus,
  case when count(pu.id) = 0 then 0
       else round(100.0 * count(rs.id) / count(pu.id), 1) end as reported_pct,
  count(*) filter (where rs.verification_state = 'verified')  as verified_pus,
  count(*) filter (where rs.verification_state = 'disputed')  as disputed_pus,
  count(*) filter (where rs.verification_state = 'pending')   as pending_pus,
  coalesce(sum(pu.registered_voters), 0)                      as registered_voters,
  coalesce(sum(rs.total_valid_votes), 0)                      as valid_votes,
  coalesce(sum(rs.rejected_votes), 0)                         as rejected_votes,
  case when coalesce(sum(pu.registered_voters),0) = 0 then null
       else round(100.0 * (coalesce(sum(rs.total_valid_votes),0)
                         + coalesce(sum(rs.rejected_votes),0))
                  / sum(pu.registered_voters), 1) end         as turnout_pct_of_reported
from polling_units pu
left join result_submissions rs on rs.pu_id = pu.id and rs.is_current
where pu.is_active;

-- ---------------------------------------------------------------------
-- Running party totals across everything reported so far.
-- ---------------------------------------------------------------------
create or replace view v_party_totals
with (security_invoker = true) as
select
  p.id       as party_id,
  p.code     as party_code,
  p.name     as party_name,
  p.colour,
  coalesce(sum(spv.votes), 0) as votes,
  count(distinct rs.pu_id)    as pus_counted
from parties p
left join submission_party_votes spv on spv.party_id = p.id
left join result_submissions rs on rs.id = spv.submission_id and rs.is_current
where p.is_tracked
group by p.id, p.code, p.name, p.colour, p.sort_order
order by coalesce(sum(spv.votes), 0) desc, p.sort_order;

-- ---------------------------------------------------------------------
-- Party totals broken down by LGA — for the "where are we strong"
-- question the control room will ask all night.
-- ---------------------------------------------------------------------
create or replace view v_party_totals_by_lga
with (security_invoker = true) as
select
  l.id   as lga_id,
  l.name as lga_name,
  p.code as party_code,
  p.name as party_name,
  p.colour,
  coalesce(sum(spv.votes), 0) as votes
from lgas l
join wards w on w.lga_id = l.id
join polling_units pu on pu.ward_id = w.id and pu.is_active
join result_submissions rs on rs.pu_id = pu.id and rs.is_current
join submission_party_votes spv on spv.submission_id = rs.id
join parties p on p.id = spv.party_id and p.is_tracked
group by l.id, l.name, p.code, p.name, p.colour;

-- ---------------------------------------------------------------------
-- Open alerts, newest first, with the location attached.
-- ---------------------------------------------------------------------
create or replace view v_open_alerts
with (security_invoker = true) as
select
  f.id,
  f.type,
  f.severity,
  f.detail,
  f.created_at,
  pu.id        as pu_id,
  pu.name      as pu_name,
  pu.inec_code,
  w.name       as ward_name,
  l.name       as lga_name,
  a.full_name     as agent_name,
  ac.primary_phone as agent_phone,
  ac.all_phones    as agent_phones
from flags f
join polling_units pu on pu.id = f.pu_id
join wards w on w.id = pu.ward_id
join lgas  l on l.id = w.lga_id
left join result_submissions rs on rs.id = f.submission_id
left join agents a on a.id = rs.agent_id
left join v_agent_contact ac on ac.agent_id = a.id
where f.resolved_at is null
order by
  case f.severity when 'critical' then 0 when 'warning' then 1 else 2 end,
  f.created_at desc;

-- ---------------------------------------------------------------------
-- Incident remarks written by agents — the qualitative feed the
-- control room reads alongside the numbers.
-- ---------------------------------------------------------------------
create or replace view v_incident_remarks
with (security_invoker = true) as
select
  rs.id          as submission_id,
  rs.submitted_at,
  rs.remarks,
  rs.channel,
  pu.id          as pu_id,
  pu.name        as pu_name,
  pu.inec_code,
  w.name         as ward_name,
  l.name         as lga_name,
  a.full_name     as agent_name,
  ac.primary_phone as agent_phone,
  rs.verification_state
from result_submissions rs
join polling_units pu on pu.id = rs.pu_id
join wards w on w.id = pu.ward_id
join lgas  l on l.id = w.lga_id
left join agents a on a.id = rs.agent_id
left join v_agent_contact ac on ac.agent_id = a.id
where rs.remarks is not null
  and btrim(rs.remarks) <> ''
order by rs.submitted_at desc;

-- ---------------------------------------------------------------------
-- Units that have not reported — the chase list coordinators work from.
-- ---------------------------------------------------------------------
create or replace view v_outstanding_pus
with (security_invoker = true) as
select
  pu.id        as pu_id,
  pu.inec_code,
  pu.name      as pu_name,
  pu.registered_voters,
  w.id         as ward_id,
  w.name       as ward_name,
  l.id         as lga_id,
  l.name       as lga_name,
  a.full_name      as agent_name,
  ac.primary_phone as agent_phone,
  ac.all_phones    as agent_phones,
  ac.whatsapp_phone,
  coalesce(ac.has_consent, false) as contactable
from polling_units pu
join wards w on w.id = pu.ward_id
join lgas  l on l.id = w.lga_id
left join agents a on a.pu_id = pu.id and a.is_active
left join v_agent_contact ac on ac.agent_id = a.id
where pu.is_active
  and not exists (
    select 1 from result_submissions rs where rs.pu_id = pu.id and rs.is_current
  )
order by l.name, w.name, pu.inec_code;

-- ---------------------------------------------------------------------
-- Export view: one flat row per PU for CSV/Excel download.
-- ---------------------------------------------------------------------
create or replace view v_export_results
with (security_invoker = true) as
select
  l.name                as lga,
  w.name                as ward,
  pu.inec_code          as pu_code,
  pu.name               as pu_name,
  pu.registered_voters,
  rs.accredited_voters,
  rs.total_valid_votes,
  rs.rejected_votes,
  rs.verification_state,
  (rs.ec8a_photo_path is not null) as has_ec8a,
  rs.submitted_at,
  a.full_name           as agent_name,
  rs.remarks,
  (
    select jsonb_object_agg(p.code, spv.votes)
      from submission_party_votes spv
      join parties p on p.id = spv.party_id
     where spv.submission_id = rs.id
  )                     as party_votes
from polling_units pu
join wards w on w.id = pu.ward_id
join lgas  l on l.id = w.lga_id
left join result_submissions rs on rs.pu_id = pu.id and rs.is_current
left join agents a on a.id = rs.agent_id
where pu.is_active
order by l.name, w.name, pu.inec_code;

grant select on v_agent_contact, v_pu_current, v_ward_coverage, v_lga_coverage, v_district_summary,
                v_party_totals, v_party_totals_by_lga, v_open_alerts,
                v_incident_remarks, v_outstanding_pus, v_export_results
  to app_rw, app_jobs;

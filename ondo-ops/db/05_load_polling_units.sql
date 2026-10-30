-- =====================================================================
-- 05_load_polling_units.sql
--
-- Loads the official polling-unit register. Feed it the cleaned CSV
-- produced by import_pu_data.py (columns: lga, ward, inec_pu_code,
-- pu_name, registered_voters, latitude, longitude, status).
--
--   \copy pu_staging(lga,ward,inec_pu_code,pu_name,registered_voters,latitude,longitude,status) \
--       from 'polling_units_seed.csv' with (format csv, header true)
--   select load_polling_units();
--
-- The loader matches on ward NAME within LGA name, reports anything it
-- could not match, and never silently drops a row.
-- =====================================================================

create table if not exists pu_staging (
  lga               text,
  ward              text,
  inec_pu_code      text,
  pu_name           text,
  registered_voters text,
  latitude          text,
  longitude         text,
  status            text
);

create or replace function norm_name(p text)
returns text
language sql
immutable
as $$
  -- lowercase, collapse whitespace, strip punctuation so 'Idoani I' and
  -- 'IDOANI  1' match. Roman numerals I/II/III are normalised to digits.
  select regexp_replace(
           regexp_replace(
             regexp_replace(lower(btrim(coalesce(p,''))), '\s+', ' ', 'g'),
             '[^a-z0-9 /]', '', 'g'),
           '\m(iii|ii|i)\M',
           '', 'g')
$$;

create or replace function load_polling_units()
returns table (loaded integer, skipped integer, problems text[])
language plpgsql
as $$
declare
  v_loaded   integer := 0;
  v_skipped  integer := 0;
  v_problems text[] := '{}';
  r          record;
  v_ward_id  integer;
  v_unit_no  text;
begin
  for r in select * from pu_staging loop
    -- Resolve the ward: exact name match first, then normalised.
    select w.id into v_ward_id
      from wards w
      join lgas l on l.id = w.lga_id
     where lower(btrim(l.name)) = lower(btrim(r.lga))
       and lower(btrim(w.name)) = lower(btrim(r.ward))
     limit 1;

    if v_ward_id is null then
      select w.id into v_ward_id
        from wards w
        join lgas l on l.id = w.lga_id
       where norm_name(l.name) = norm_name(r.lga)
         and norm_name(w.name) = norm_name(r.ward)
       limit 1;
    end if;

    if v_ward_id is null then
      v_skipped := v_skipped + 1;
      v_problems := v_problems ||
        format('No ward match: LGA="%s" ward="%s" PU="%s"', r.lga, r.ward, r.pu_name);
      continue;
    end if;

    if r.registered_voters is null or btrim(r.registered_voters) = ''
       or r.registered_voters !~ '^\d+$' then
      v_skipped := v_skipped + 1;
      v_problems := v_problems ||
        format('Bad registered_voters "%s" for PU "%s"', r.registered_voters, r.pu_name);
      continue;
    end if;

    -- Unit number = last segment of the delimitation code, else a counter.
    v_unit_no := nullif(regexp_replace(coalesce(r.inec_pu_code,''), '^.*[/\-]', ''), '');
    if v_unit_no is null or v_unit_no !~ '^\d+$' then
      select lpad((coalesce(max(unit_number::integer), 0) + 1)::text, 3, '0')
        into v_unit_no
        from polling_units where ward_id = v_ward_id and unit_number ~ '^\d+$';
      v_unit_no := coalesce(v_unit_no, '001');
    end if;

    insert into polling_units (
      ward_id, inec_code, unit_number, name, registered_voters, latitude, longitude
    ) values (
      v_ward_id,
      coalesce(nullif(btrim(r.inec_pu_code), ''),
               format('TMP/%s/%s', v_ward_id, v_unit_no)),
      lpad(v_unit_no, 3, '0'),
      btrim(r.pu_name),
      r.registered_voters::integer,
      nullif(btrim(coalesce(r.latitude,'')), '')::numeric,
      nullif(btrim(coalesce(r.longitude,'')), '')::numeric
    )
    on conflict (inec_code) do update
      set name = excluded.name,
          registered_voters = excluded.registered_voters,
          ward_id = excluded.ward_id;

    v_loaded := v_loaded + 1;
  end loop;

  return query select v_loaded, v_skipped, v_problems;
end;
$$;

comment on function load_polling_units is
  'Loads pu_staging into polling_units. Returns counts plus a list of rows it could not place, '
  'so nothing is dropped without being reported.';

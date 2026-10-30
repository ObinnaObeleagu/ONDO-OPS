-- =====================================================================
-- 04_seed_geography.sql
-- Ondo North Senatorial District: 6 LGAs, 72 wards.
--
-- Ward names and codes are from INEC's 2015 Directory of Polling Units
-- and INEC's 2024 CVR / PVC registers. Two Ose wards (09 and 12) could
-- not be confirmed from a public INEC source; they are loaded with
-- name_verified = false and MUST be checked against the current INEC
-- ward register before go-live.
--
-- Polling units are NOT seeded here. Load them from the official
-- current INEC register via 05_load_polling_units.sql.
-- =====================================================================

insert into lgas (id, inec_code, name) values
  (1, '01', 'Akoko North-East'),
  (2, '02', 'Akoko North-West'),
  (3, '03', 'Akoko South-East'),
  (4, '04', 'Akoko South-West'),
  (5, '17', 'Ose'),
  (6, '18', 'Owo')
on conflict (id) do nothing;

-- ---- Akoko North-East (13 wards) ------------------------------------
insert into wards (lga_id, inec_code, name) values
  (1, '01', 'Edo'),
  (1, '02', 'Ekan'),
  (1, '03', 'Ikado I'),
  (1, '04', 'Ikado II'),
  (1, '05', 'Ilepa I'),
  (1, '06', 'Ilepa II'),
  (1, '07', 'Isowopo I'),
  (1, '08', 'Isowopo II'),
  (1, '09', 'Iyometa I'),
  (1, '10', 'Iyometa II'),
  (1, '11', 'Oorun I'),
  (1, '12', 'Oorun II'),
  (1, '13', 'Oyinmo')
on conflict do nothing;

-- ---- Akoko North-West (10 wards) ------------------------------------
insert into wards (lga_id, inec_code, name) values
  (2, '01', 'Arigidi/Iye I'),
  (2, '02', 'Arigidi II'),
  (2, '03', 'Okeagbe'),
  (2, '04', 'Oyin/Oge'),
  (2, '05', 'Ajowa/Igasi/Eriti/Gedegede'),
  (2, '06', 'Ogbagi'),
  (2, '07', 'Oke-Irun/Surulere'),
  (2, '08', 'Odo-Irun/Oyinmo'),
  (2, '09', 'Ese/Afin'),
  (2, '10', 'Erusu/Karamu/Ibaramu')
on conflict do nothing;

-- ---- Akoko South-East (11 wards) ------------------------------------
insert into wards (lga_id, inec_code, name) values
  (3, '01', 'Epinmi I'),
  (3, '02', 'Epinmi II'),
  (3, '03', 'Ifira'),
  (3, '04', 'Ipe I'),
  (3, '05', 'Ipe II'),
  (3, '06', 'Ipesi'),
  (3, '07', 'Isua I'),
  (3, '08', 'Isua II'),
  (3, '09', 'Isua III'),
  (3, '10', 'Isua IV'),
  (3, '11', 'Sosan')
on conflict do nothing;

-- ---- Akoko South-West (15 wards) ------------------------------------
insert into wards (lga_id, inec_code, name) values
  (4, '01', 'Oka I Ibaka/Sabo'),
  (4, '02', 'Oka II A Ikanmu'),
  (4, '03', 'Oka II B Okia/Korowa/Simerin/Uba'),
  (4, '04', 'Oka III A Agba'),
  (4, '05', 'Oka III B Owase/Ikese/Iwonrin/Ebinrin/Idorin'),
  (4, '06', 'Oka IV/Owake/Ebo/Ayegunle'),
  (4, '07', 'Oka V A Owalusin/Ayepe'),
  (4, '08', 'Oka V B Oka Odo/Okela/Bolorunduro'),
  (4, '09', 'Ikun'),
  (4, '10', 'Supare I'),
  (4, '11', 'Supare II'),
  (4, '12', 'Akungba I'),
  (4, '13', 'Akungba II'),
  (4, '14', 'Oba I'),
  (4, '15', 'Oba II')
on conflict do nothing;

-- ---- Ose (12 wards) -------------------------------------------------
insert into wards (lga_id, inec_code, name, name_verified) values
  (5, '01', 'Afo',             true),
  (5, '02', 'Idoani I',        true),
  (5, '03', 'Idoani II',       true),
  (5, '04', 'Idogun',          true),
  (5, '05', 'Ifon I',          true),
  (5, '06', 'Ifon II',         true),
  (5, '07', 'Ijagba',          true),
  (5, '08', 'Ikaro/Elegbeka',  true),
  (5, '09', 'UNVERIFIED — ward 09', false),
  (5, '10', 'Imoru/Arimogija', true),
  (5, '11', 'Okeluse',         true),
  (5, '12', 'UNVERIFIED — ward 12', false)
on conflict do nothing;

-- ---- Owo (11 wards) -------------------------------------------------
insert into wards (lga_id, inec_code, name) values
  (6, '01', 'Ehinogbe'),
  (6, '02', 'Igboroko I'),
  (6, '03', 'Igboroko II'),
  (6, '04', 'Ijebu I'),
  (6, '05', 'Ijebu II'),
  (6, '06', 'Iloro'),
  (6, '07', 'Ipele'),
  (6, '08', 'Isaipen'),
  (6, '09', 'Isuada/Ipenmen/Idasan/Obasooto'),
  (6, '10', 'Iyare'),
  (6, '11', 'Uso/Emure Ile')
on conflict do nothing;

-- =====================================================================
-- Parties on the ballot.
-- Colours are brand-adjacent but validated for colour-vision deficiency:
-- the raw party hexes failed CVD separation (LP and ADC were indistinguishable),
-- so each party is mapped to the nearest hue that passes in both light and dark.
-- Untracked minor parties share a neutral grey and fold into 'Other' on charts.
-- Trim this list to the parties actually fielding a candidate.
-- =====================================================================
insert into parties (code, name, colour, colour_dark, is_tracked, sort_order) values
  ('APC',  'All Progressives Congress',       '#008300', '#008300', true, 1),
  ('PDP',  'Peoples Democratic Party',        '#e34948', '#e66767', true, 2),
  ('LP',   'Labour Party',                    '#2a78d6', '#3987e5', true, 3),
  ('ADC',  'African Democratic Congress',     '#eb6834', '#d95926', true, 4),
  ('NNPP', 'New Nigeria Peoples Party',       '#6250d6', '#9085e9', true, 5),
  ('SDP',  'Social Democratic Party',         '#1baf7a', '#199e70', true, 6),
  ('APGA', 'All Progressives Grand Alliance', '#eda100', '#c98500', true, 7),
  ('YPP',  'Young Progressives Party',        '#e87ba4', '#d55181', true, 8),
  ('ZLP',  'Zenith Labour Party',             '#898781', '#898781', false, 20),
  ('ADP',  'Action Democratic Party',         '#898781', '#898781', false, 21),
  ('AA',   'Action Alliance',                 '#898781', '#898781', false, 22),
  ('AAC',  'African Action Congress',         '#898781', '#898781', false, 23),
  ('APM',  'Allied Peoples Movement',         '#898781', '#898781', false, 24),
  ('APP',  'Action Peoples Party',            '#898781', '#898781', false, 25),
  ('BP',   'Boot Party',                      '#898781', '#898781', false, 26),
  ('NRM',  'National Rescue Movement',        '#898781', '#898781', false, 27),
  ('PRP',  'Peoples Redemption Party',        '#898781', '#898781', false, 28),
  ('A',    'Accord',                          '#898781', '#898781', false, 29)
on conflict (code) do nothing;

-- =====================================================================
-- Sanity check: the district must come to 72 wards.
-- =====================================================================
do $$
declare
  v_wards int;
  v_unverified int;
begin
  select count(*) into v_wards from wards;
  select count(*) into v_unverified from wards where not name_verified;

  if v_wards <> 72 then
    raise warning 'Expected 72 wards in Ondo North, found %.', v_wards;
  else
    raise notice 'Ward seed OK: 72 wards across 6 LGAs.';
  end if;

  if v_unverified > 0 then
    raise warning '% ward name(s) still unverified — confirm against the INEC register before go-live.', v_unverified;
  end if;
end $$;

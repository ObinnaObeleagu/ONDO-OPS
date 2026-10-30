# Election Control Room — Ondo North Senatorial District

Polling-unit result collection and monitoring for 6 LGAs, 72 wards, and the
polling units within them.

Agents submit results from their phones (web or WhatsApp). Coordinators chase
the units that have gone quiet and verify what comes in against the signed
Form EC8A. The control room sees coverage, running totals, and every automatic
alert the system raises.

---

## What is here

```
db/      PostgreSQL schema, security policies, views, seed data, tests
app/     API route handlers, validation, WhatsApp webhook, portal routing
proto/   Interactive prototype of all four screens (self-contained HTML)
docs/    Architecture, security, access control, backups, review checklist
```

Start with `docs/ARCHITECTURE.md` for how the four portals work off one
database, and `docs/SECURITY.md` for access control and the pre-election
checklist.

### Status

| Piece | State |
|---|---|
| Data model, integrity checks, audit trail | **Built and tested** against PostgreSQL 16 — 9/9 tests pass |
| Row-level security for all five roles | **Built and tested** — 6/6 access checks pass |
| Portal routing (agent / ward / LGA / control) | **Built** — `my_scope()` + middleware |
| Multiple phone numbers per agent, consent per number | **Built and tested** |
| Dashboard views (coverage, alerts, remarks, exports) | **Built** |
| Ondo North geography: 6 LGAs, 72 wards | **Seeded and verified** |
| Validation layer | **Built and tested** — 21/21 tests pass |
| Web submission API | **Built** — needs a Supabase project to run against |
| WhatsApp bot | **Built** — needs Meta Cloud API credentials |
| Four screens | **Prototype built and reviewed** |
| Polling unit register | **Not loaded** — see below |

### The one thing still missing

The polling unit register. Ward-level geography is in place, but the
individual polling units — their official codes, names and registered-voter
counts — must come from the current INEC register. The 2015 directory
undercounts: INEC added 924 units across Ondo State in 2023.

Load it with `db/05_load_polling_units.sql`, which takes the cleaned CSV from
the import toolkit, matches each row to a ward, and reports anything it could
not place rather than dropping it silently.

---

## Setting it up

```bash
createdb ondo_ops
psql -d ondo_ops -v ON_ERROR_STOP=1 -f db/01_schema.sql
psql -d ondo_ops -v ON_ERROR_STOP=1 -f db/02_security.sql
psql -d ondo_ops -v ON_ERROR_STOP=1 -f db/03_views.sql
psql -d ondo_ops -v ON_ERROR_STOP=1 -f db/04_seed_geography.sql
psql -d ondo_ops -v ON_ERROR_STOP=1 -f db/05_load_polling_units.sql

# prove the integrity rules actually fire
psql -d ondo_ops -v ON_ERROR_STOP=1 -f db/99_test.sql
```

The seed warns if the ward count is not 72, and warns about the two Ose ward
names that are not yet confirmed against INEC.

Then load the polling units:

```sql
\copy pu_staging(lga,ward,inec_pu_code,pu_name,registered_voters,latitude,longitude,status) \
    from 'polling_units_seed.csv' with (format csv, header true)
select * from load_polling_units();
```

### Environment

```
SUPABASE_URL=                     NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=        NEXT_PUBLIC_SUPABASE_ANON_KEY=
WHATSAPP_TOKEN=                   WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=            WHATSAPP_APP_SECRET=
```

---

## How a result travels

1. An agent submits from the web form or over WhatsApp.
2. Both paths call **`submit_result()`**, one transaction. Nothing writes to
   the results table directly.
3. It validates the party codes, sums the votes, retires any earlier
   submission for that unit (keeping it), writes the new one, and raises
   automatic flags.
4. The agent gets a reference number, and is told immediately if a check fired.
5. A ward coordinator checks the figures against the EC8A photo and verifies
   or disputes. **Verification is refused without a photo.**
6. The control room sees the result in coverage, running totals and alerts.

A correction repeats the whole path. The earlier submission is marked
`superseded` and kept. Nothing is ever deleted, and every write is in the
audit log.

---

## The automatic checks

| Check | What it catches |
|---|---|
| Over-vote | more votes cast than registered voters at that unit |
| Exceeds accredited | valid votes above the BVAS accreditation figure |
| Missing EC8A | a result with no photo of the signed form |
| Total mismatch | party votes not summing to the declared total |
| Late report | a unit silent past the deadline (clears when it reports) |
| Correction | figures replaced after the fact |
| Unknown party | a party code not on the ballot — rejected outright |

---

## Tests

```bash
psql -d ondo_ops -f db/99_test.sql        # 13 integrity tests
psql -d ondo_ops -f db/98_test_access.sql #  6 access-control checks
cd app/lib && tsx validation.test.ts      # 21 validation tests
```

All three suites create their own fixtures and clean up after themselves.

`99_test.sql` covers the over-vote path, the EC8A rule, correction history,
the late sweep, the audit trail, rejection of unknown parties, and the
multi-phone rules (primary promotion, per-number consent, E.164 format).

`98_test_access.sql` signs in as each of the five roles **as a non-superuser,
so row-level security actually applies**, and checks that each sees only its
own scope while every submission still reaches the control room.

---

## Agents with more than one number

Numbers live in `agent_phones`, one row each. An agent can hold a main line,
a backup on another network, and a ward office phone. Consent is recorded
**per number**, because that is what the NDPA asks for — an agent may consent
to their work line and not a shared handset, and the WhatsApp bot will not
message a number whose consent is missing. The first number added becomes
primary automatically; promoting another demotes it.

`v_agent_contact` flattens this for screens that just want the number to ring.

---

## Reading the dashboard honestly

- Totals are **what has been submitted**, not a projection and not an official
  result. INEC's figures are the official ones.
- A disputed unit is one where the arithmetic does not work. That is a reason
  to telephone the agent, not evidence of fraud.
- Coverage below 100% means the totals will still move. The dashboard says so
  on its face, deliberately.

See `docs/SECURITY.md` for access control, NDPA obligations, backups and the
pre-election review checklist.

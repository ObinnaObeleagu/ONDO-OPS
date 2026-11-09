# Election Control Room — Ondo North Senatorial District

Polling-unit result collection and monitoring for 6 LGAs, 72 wards, and the
polling units within them.

Agents submit results from their phones (web or WhatsApp). Coordinators chase
the units that have gone quiet and verify what comes in against the signed
Form EC8A. The control room sees coverage, running totals, and every automatic
alert the system raises.

---

## What is here

Your GitHub repository holds one folder, `ondo-ops/`, and Vercel's **Root
Directory** setting points at it. So every path in this README starts inside
`ondo-ops/`: `app/ward/page.tsx` means `ondo-ops/app/ward/page.tsx` on GitHub.

```
ondo-ops/
├── middleware.ts            ← must sit HERE, next to package.json — not inside app/
├── package.json  tsconfig.json  next.config.js  .gitignore  README.md
├── app/                     the website (Next.js)
├── components/              pieces shared by the pages
├── lib/                     helpers: Supabase, formatting, scope, types
├── db/                      database: run in Supabase's SQL Editor
├── docs/                    deployment, architecture, security, field guide
├── proto/                   the original clickable prototype (reference only)
├── import_pu_data.py        run on your computer: cleans the INEC register
├── import_people.py         run on your computer: adds agents/coordinators
└── people_template.xlsx     the sheet import_people.py reads
```

### Every file and what it does

**The pages** (`app/`) — deployed by Vercel

| File | What it is |
|---|---|
| `app/layout.tsx` | Wraps every page; loads the styles and sets light/dark mode before the page appears |
| `app/globals.css` | All styling: colours, light and dark themes, tables, charts, phone layout |
| `app/page.tsx` | The home address `/` — sends people to their own portal |
| `app/login/page.tsx`, `app/login/LoginForm.tsx` | Sign-in (SMS code or email + password) |
| `app/control/page.tsx` | **Control room**: district totals, alerts, remarks, every LGA |
| `app/lga/page.tsx` | **LGA portal**: ward progress, LGA vote totals, chase list |
| `app/ward/page.tsx` | **Ward portal**: every unit, EC8A photos, verify / dispute |
| `app/agent/page.tsx` | **Agent portal**: works out which unit is being reported |
| `app/agent/AgentForm.tsx` | The result form on the agent's phone, with photo upload |
| `app/api/submit/route.ts` | Receives a result and calls `submit_result()` |
| `app/api/verify/route.ts` | Verify or dispute a result (coordinators) |
| `app/api/ec8a/route.ts` | Receives the EC8A photo and stores it privately |
| `app/api/whatsapp/route.ts` | The WhatsApp bot |
| `app/lib/validation.ts` (+ `.test.ts`) | Checks the figures before they reach the database |

**Shared pieces** (`components/`, `lib/`) — deployed by Vercel

| File | What it is |
|---|---|
| `components/PortalHeader.tsx` | Top bar: title, links between portals, who's signed in, theme, sign out |
| `components/Charts.tsx` | Progress bars, the status bar, party vote bars, status chips |
| `components/ScopePicker.tsx` | The LGA / ward / unit dropdowns |
| `components/VerifyActions.tsx` | The Verify and Dispute buttons |
| `components/ThemeToggle.tsx`, `components/SignOutButton.tsx` | Light/dark switch; sign out |
| `lib/supabase/server.ts`, `lib/supabase/client.ts` | Connections to Supabase |
| `lib/scope.ts` | Asks the database who is signed in and what they cover |
| `lib/portals.ts` | Which portal links each role sees (mirrors `middleware.ts`) |
| `lib/types.ts`, `lib/format.ts` | Data shapes; number and time formatting |
| `middleware.ts` | Sends each signed-in person to their own portal and keeps them there |

**The database** (`db/`) — run by hand in Supabase → SQL Editor, never deployed

| File | When to run it | Safe to run twice? |
|---|---|---|
| `01_schema.sql` | Once, at setup | **No** — fails with "already exists" |
| `02_security.sql` | Once, at setup | **No** |
| `03_views.sql` | At setup, and again whenever it changes | Yes |
| `04_seed_geography.sql` | At setup (6 LGAs, 72 wards, parties) | Yes |
| `05_load_polling_units.sql` | At setup, and again whenever it changes; then used to load the register | Yes |
| `90_test_data.sql` | Optional: demo data so the dashboards aren't empty. Remove it before real data (cleanup block at the bottom of the file) | No — run once |
| `98_test_access.sql`, `99_test.sql` | To prove the database works; they clean up after themselves | Yes |

**On your computer only** — never deployed, never uploaded with real data

| File | What it is |
|---|---|
| `import_pu_data.py` | Cleans the raw INEC register into the CSV `05_load_polling_units.sql` loads |
| `import_people.py` + `people_template.xlsx` | Adds and updates agents and coordinators in bulk |
| `.env.local` | Your Supabase URL and service key for the two scripts. **Never commit it** (`.gitignore` blocks it) |

The guides:

- **`docs/DEPLOYMENT.md`** — Supabase + Vercel + WhatsApp, start to a live
  URL. Start here to actually run this.
- `docs/FIELD-GUIDE.md` — how each role uses the system on the day, the
  escalation ladder, the election-day timeline. Build agent training from
  this.
- `docs/ARCHITECTURE.md` — how four portals work off one database.
- `docs/SECURITY.md` — access control, NDPA, backups, pre-election checklist.

### Status

| Piece | State |
|---|---|
| Data model, integrity checks, audit trail | **Built and tested** against PostgreSQL 16 — 13/13 tests pass |
| Row-level security for all five roles | **Built and tested** — 6/6 access checks pass |
| Portal routing (agent / ward / LGA / control) | **Built** — `my_scope()` + middleware |
| Multiple phone numbers per agent, consent per number | **Built and tested** |
| Dashboard views (coverage, alerts, remarks, exports) | **Built** |
| Ondo North geography: 6 LGAs, 72 wards | **Seeded and verified** |
| Validation layer | **Built and tested** — 21/21 tests pass |
| Login page (phone OTP + email/password) | **Built — `npx next build` passes clean** |
| Web submission API | **Built** — needs a Supabase project to run against |
| WhatsApp bot | **Built** — needs Meta Cloud API credentials, see `docs/DEPLOYMENT.md` |
| Four portals — `/agent`, `/ward`, `/lga`, `/control` | **Built** on live, RLS-scoped data; light/dark mode; checked per role in a browser |
| Verify / dispute, EC8A photo upload | **Built** — `/api/verify`, `/api/ec8a` |
| Adding agents and coordinators in bulk | **Built** — `people_template.xlsx` + `import_people.py` |
| Polling unit register | **Not loaded** — see below |

### The one thing still missing

The polling unit register. Ward-level geography is in place, but the
individual polling units — their official codes, names and registered-voter
counts — must come from the current INEC register. The 2015 directory
undercounts: INEC added 924 units across Ondo State in 2023.

When the INEC file arrives:

```bash
python3 import_pu_data.py the_inec_file.xlsx --dry-run   # what it found, nothing written
python3 import_pu_data.py the_inec_file.xlsx -o polling_units_seed.csv
```

It keeps only Ondo North's 6 LGAs, cleans the voter counts, and reports every
row it drops. Then load `polling_units_seed.csv` with
`db/05_load_polling_units.sql` (see "Setting it up" below). That matches each
unit to its ward and lists anything it couldn't place instead of dropping it.
If you loaded the demo data, remove it first using the cleanup block at the
bottom of `db/90_test_data.sql`.

---

## Updating the live system

An update has up to three parts. Do them in this order, skipping any that
don't apply.

### 1. Update the website files

Updates come as a zip whose contents already sit inside an `ondo-ops/`
folder, so the files land in the right place on their own.

**On your computer** (if you have the repository cloned):

1. Unzip it in the folder that **contains** `ondo-ops/`, not inside
   `ondo-ops/`. Say yes to replacing existing files.
2. Commit and push to `master` (the branch Vercel deploys as Production).

**On GitHub's website** (no clone needed):

1. Unzip on your computer first.
2. In the repository, click **Add file → Upload files** and drag in the
   unzipped `ondo-ops` folder. GitHub keeps the folders inside it.
3. Commit directly to `master`.
4. Open a couple of the changed files on GitHub and check the path at the top
   reads `ondo-ops/...`. If you see `ondo-ops/ondo-ops/...`, the folder was
   dragged one level too deep.

Vercel starts a new deployment by itself. In Vercel → **Deployments**, check
the newest one shows your commit and finishes as **Ready**. If it fails, the
build log names the file and line.

**Check these every time.** Each has caused a "it still doesn't work" before:

- `middleware.ts` is at `ondo-ops/middleware.ts`, **not**
  `ondo-ops/app/middleware.ts`. Inside `app/`, Next.js ignores it and nobody
  gets routed to their portal.
- Nothing ended up at the top of the repository instead of inside `ondo-ops/`.
  Vercel only builds `ondo-ops/`, so a file outside it is never deployed.
- New folders (`app/lga/`, `app/ward/`, `app/agent/`, `components/`) are
  folders, with `page.tsx` inside them, not files with those names.

### 2. Update the database (only if the update includes `db/` files)

Open Supabase → **SQL Editor**, paste in the whole file, and run it. Only
re-run the files the update says changed, and check the table above: never
re-run `01` or `02`.

If it reports `permission denied for schema public`, the SQL Editor's role
picker has been left on `authenticated`. Switch it back to `postgres` and run
the file again.

### 3. Re-run the local scripts (only if they changed)

`import_pu_data.py` and `import_people.py` run from your own copy of
`ondo-ops/`. Replace them there and run them as described in their sections.
They need Python 3 with `pandas` and `openpyxl`
(`pip install pandas openpyxl`).

### After any update

1. Sign in as an admin. You should land on `/control`.
2. Click through **LGA**, **Ward** and **Submit result** in the top bar.
3. Switch light/dark mode once.
4. If a page shows the 404 screen or keeps sending you back to sign-in,
   recheck the three paths listed in step 1.

---

## Change log

Newest first. **Action** says what has to be done on the live system for each
change.

**7 Nov 2026 — adding people in bulk**
- New: `import_people.py`, `people_template.xlsx`.
- Changed: `.gitignore` (blocks filled-in sheets, results files and Python caches), `README.md`.
- Action: copy the files in. No deployment or database change needed.
  `import_people.py` runs on your computer.

**7 Nov 2026 — agent, ward and LGA portals**
- New: `app/agent/page.tsx`, `app/agent/AgentForm.tsx`, `app/ward/page.tsx`,
  `app/lga/page.tsx`, `app/api/verify/route.ts`, `app/api/ec8a/route.ts`,
  `components/PortalHeader.tsx`, `components/Charts.tsx`,
  `components/ScopePicker.tsx`, `components/VerifyActions.tsx`, `lib/scope.ts`,
  `lib/portals.ts`.
- Changed: `middleware.ts` (fix: it was blocking `/api/submit`, so web results
  could never be saved), `app/control/page.tsx`, `app/globals.css`,
  `lib/types.ts`, `lib/format.ts`.
- Action: deploy (step 1). No database change.

**7 Nov 2026 — light/dark mode and the polling-unit import**
- New: `components/ThemeToggle.tsx`, `import_pu_data.py`.
- Changed: `app/layout.tsx`, `app/control/page.tsx`, `app/globals.css`,
  `db/05_load_polling_units.sql` (fix: "Ikado I" and "Ikado II" were treated
  as the same ward, so units could land in the wrong ward).
- Action: deploy, **and re-run `db/05_load_polling_units.sql` once** in the
  SQL Editor.

**7 Nov 2026 — control room and demo data**
- New: `app/control/page.tsx`, `app/globals.css`, `components/SignOutButton.tsx`,
  `lib/format.ts`, `lib/types.ts`, `db/90_test_data.sql`.
- Changed: `app/layout.tsx`.
- Action: deploy. Optionally run `db/90_test_data.sql` to see the dashboards
  with data, and remove it before real data arrives.

**Earlier fixes from the first deployment**
- `middleware.ts` moved from `app/` to the project root. `app/page.tsx` made
  dynamic, so Vercel no longer serves a stale cached redirect.
  `app/login/LoginForm.tsx` no longer hangs on "Signing in…".
- `db/02_security.sql`: no more endless recursion in the `app_users` policy,
  and the `authenticated` role now has `app_rw`'s permissions. If a page says
  `permission denied for view ...`, run `grant app_rw to authenticated;` in
  the SQL Editor.

---

## Adding agents and coordinators

Fill in `people_template.xlsx` (one row per person; the first sheet explains
each column), then, from this folder:

```bash
python3 import_people.py people.xlsx --dry-run   # checks every row, changes nothing
python3 import_people.py people.xlsx             # does it
```

It reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`.
For each person it creates their sign-in account if needed, sets their role
and LGA or ward, and links agents to their polling unit with their numbers
and NDPA consent. Run it again whenever the sheet changes: existing people
are updated, never duplicated, and nobody is deleted (set `active` to `no`).

`people_results.csv` reports every row, plus temporary passwords for anyone
given an email. Hand those out privately and delete the file. Agents need the
polling-unit register loaded first, because they're matched by INEC code.

---

## Setting it up

For a full guide to getting this onto a URL with Supabase, Vercel and a
working WhatsApp bot, see **`docs/DEPLOYMENT.md`**. Locally:

```bash
npm install
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

Where each of these comes from, and how to wire up the WhatsApp side
specifically, is in `docs/DEPLOYMENT.md`.

```bash
npx next build    # confirms the app actually compiles before you deploy
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

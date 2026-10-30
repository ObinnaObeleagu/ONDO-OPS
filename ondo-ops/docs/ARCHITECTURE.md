# How the separate portals feed one control room

The short answer: **they are not separate systems.** There is one database
and one set of tables. A "portal" is a set of screens over that same data,
and what each person sees is decided by the database itself, not by which
page they opened.

Nothing is synced, copied, forwarded or merged. There is nothing to break on
election night, because there is no pipeline between the portals and the
dashboard — they are reading and writing the same rows.

```
   AGENT                WARD COORD           LGA COORD           CONTROL ROOM
   /agent               /ward                /lga                /control
   one unit             one ward             one LGA             whole district
      |                     |                    |                     |
      |  submit_result()    |  verify_result()   |  verify_result()    |  read
      |                     |                    |                     |
      +---------------------+--------------------+---------------------+
                                     |
                      +--------------v--------------+
                      |   ONE POSTGRES DATABASE     |
                      |                             |
                      |  polling_units              |
                      |  agents / agent_phones      |
                      |  result_submissions   <-- append only
                      |  flags                <-- automatic checks
                      |  audit_log            <-- every write
                      |                             |
                      |  ROW-LEVEL SECURITY decides |
                      |  which rows each role sees  |
                      +--------------+--------------+
                                     |
                      views: v_ward_coverage, v_lga_coverage,
                             v_district_summary, v_open_alerts, ...
```

---

## 1. One table, four views of it

When an agent in Ehinogbe submits a result, the row lands in
`result_submissions`. That same row is immediately:

- the agent's own confirmation screen,
- an item in their ward coordinator's "to verify" list,
- one unit counted in their LGA coordinator's ward progress bar,
- part of the district total on the control room dashboard,
- and, if it failed a check, a line in the alerts feed.

No job runs to make that happen. There is one row; each portal queries it
with a different filter.

## 2. The filter is in the database, not the app

Every scoped table has row-level security policies (`db/02_security.sql`).
They resolve through one function:

```sql
visible_pu_ids()   -- every polling unit the signed-in user may see
```

| Role | What `visible_pu_ids()` returns |
|---|---|
| `agent` | the unit(s) they are assigned to |
| `ward_coordinator` | every unit in their ward |
| `lga_coordinator` | every unit in their LGA |
| `admin` / `observer` | every unit in the district |

Because the filter lives in the database, `select * from result_submissions`
returns different rows depending on who is asking. A ward coordinator running
that query gets their ward. An agent gets one row. This holds no matter how
the query arrives — the web app, a mobile client, a direct database
connection with that user's credentials, or a page they were not supposed to
open.

**This is the security boundary.** The routing in `app/middleware.ts` is a
convenience that sends people to the right starting page; it is not what
protects the data. Delete the middleware and the data is still protected.

Verified by `db/98_test_access.sql`, which signs in as each role in turn and
checks the boundaries:

```
agent            — 1 unit, 1 result, 1 phone, portal "agent", cannot verify   ok
ward coordinator — own ward only, neighbouring ward hidden, can verify        ok
LGA coordinator  — both wards in their LGA, other LGA hidden                  ok
control room     — all 3 units and all 3 results, from every portal           ok
observer         — sees everything, may change nothing                        ok
delete attempt   — refused even for an admin; history is immutable            ok
```

Note the fourth line. Three results were filed from three different portals,
and the control room sees all three without anything being forwarded to it.

## 3. Where each person lands

Right after sign-in the app makes one call:

```sql
select my_scope();
```

which returns the user's role, their scope, and the portal they belong in:

```json
{
  "signed_in": true,
  "full_name": "Bisola Oyedeji",
  "role": "ward_coordinator",
  "portal": "ward",
  "ward_id": 62,
  "pu_count": 12,
  "can_verify": true,
  "can_manage": false,
  "read_only": false
}
```

`app/middleware.ts` routes on `portal`:

| Role | Lands on | May also open |
|---|---|---|
| Agent | `/agent` | — |
| Ward coordinator | `/ward` | `/agent` (they may file a result themselves) |
| LGA coordinator | `/lga` | `/ward` (drill into any ward they cover) |
| Admin | `/control` | all of them |
| Observer | `/control` | — |

Someone who types a URL they are not entitled to is redirected to their own
portal. If they somehow reached the page anyway, it would render empty of
anything outside their scope, because the queries behind it return nothing
else.

## 4. Writes go through one door

Agents never write to `result_submissions` directly. The web form and the
WhatsApp bot both call the same function:

```sql
submit_result(pu_id, agent_id, party_votes, rejected, accredited,
              ec8a_path, remarks, channel, submitted_by)
```

It validates the party codes, sums the votes, retires any earlier submission
for that unit (keeping it), writes the new one, and raises the automatic
flags. The application database role has **no INSERT grant** on
`result_submissions` at all, so there is no second path that could skip the
checks.

The consequence: a result submitted over WhatsApp at 14:20 and one typed into
the web form at 14:21 are validated identically and appear on the dashboard
identically. `channel` records which door it came through, and that is the
only difference.

## 5. What the control room adds

The dashboard is not a separate store. It is a set of views
(`db/03_views.sql`) aggregating the same tables:

| View | Answers |
|---|---|
| `v_district_summary` | how much of the district has reported |
| `v_lga_coverage` / `v_ward_coverage` | progress by LGA and by ward |
| `v_party_totals` | running vote totals |
| `v_open_alerts` | what needs a phone call right now |
| `v_incident_remarks` | what agents wrote alongside their figures |
| `v_outstanding_pus` | the chase list of silent units |
| `v_export_results` | one flat row per unit for CSV or PDF |

Every view is `security_invoker`, so RLS still applies. A ward coordinator
querying `v_ward_coverage` gets one row — their own ward. The control room
gets all 72. Same view, same definition.

---

## Agents with more than one phone number

Numbers live in `agent_phones`, one row each, not in a column on `agents`:

| Column | Why it exists |
|---|---|
| `phone` | E.164, format-checked (`+234…`) |
| `label` | "main", "backup (other network)", "ward office" |
| `is_primary` | the number to ring first; exactly one per agent, enforced |
| `whatsapp_enabled` | which handset holds the WhatsApp account |
| `consent_recorded_at` | **NDPA consent, per number** |

Why a table rather than a second column or an array:

- **Consent is given for a number, not for a person.** An agent can consent
  to their work line and not their spouse's handset. Only a table can record
  that, and the bot checks it before sending anything.
- A number can be added or retired without touching the agent's record, and
  the change is captured in the audit log.
- The WhatsApp bot resolves an inbound number by lookup. If an agent messages
  from their backup line, it still finds them.
- If one number maps to an agent covering more than one unit, the bot asks
  which unit rather than guessing — a result filed against the wrong unit is
  worse than one extra question.

The first number added becomes primary automatically, so an agent can never
end up with no default. Promoting another number demotes the previous one
rather than failing.

`v_agent_contact` flattens all this for the screens that just want "the
number to call":

```sql
select full_name, primary_phone, all_phones, whatsapp_phone, has_consent
  from v_agent_contact where pu_id = 412;
```

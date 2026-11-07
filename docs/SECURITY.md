# Security, access control, backups and pre-election review
Election Control Room — Ondo North Senatorial District

This document covers who can see what, how the data is protected, what is
backed up, and the checks to run before election day. It is written to be
handed to a reviewer, not only to a developer.

---

## 1. Who can see what

Access is enforced in the database itself through row-level security
(`db/02_security.sql`), not in application code. If someone bypasses the web
app and queries the database with a user's credentials, they still see only
what that user is entitled to see.

| Role | Polling units | Agent phone numbers | Results | Can verify | Can manage users |
|---|---|---|---|---|---|
| **Agent** | their own unit only | their own record | their own unit | no | no |
| **Ward coordinator** | their ward | their ward | their ward | their ward | no |
| **LGA coordinator** | their LGA | their LGA | their LGA | their LGA | no |
| **Admin** | whole district | whole district | whole district | yes | yes |
| **Observer** | whole district | whole district | whole district | no | no |

Notes:

- Ward and LGA names are readable by any signed-in user. Knowing that
  "Ehinogbe" is a ward is not sensitive; knowing who the agent there is, and
  what they reported, is.
- **Nobody can delete a result.** There is no `DELETE` policy on
  `result_submissions`. A correction writes a new row and marks the old one
  `superseded`.
- The audit log is readable only by admins and is not writable by anyone
  through the application. Entries are written by a database trigger.

### Two database roles, not one

- `app_rw` — what the web app connects as. It can read within policy and
  update flags and agents, but it **cannot insert a result directly**. Results
  only enter through the `submit_result()` function, so every submission
  passes the same validation and raises the same automatic flags.
- `app_jobs` — read-only, plus the late-report sweep. Used by scheduled jobs
  and exports.

---

## 2. The automatic checks

These run inside the database on every submission, so they cannot be skipped
by a client that forgets to call them. All are covered by the test suite in
`db/99_test.sql`.

| Check | Trigger | Effect |
|---|---|---|
| **Over-vote** | votes cast exceed registered voters at that unit | result marked `disputed`, `critical` alert raised |
| **Exceeds accredited** | valid votes exceed accredited voters | result marked `disputed`, `critical` alert |
| **Missing EC8A** | no photo of the signed form | `warning` alert; **verification is refused** until a photo exists |
| **Correction** | a later submission replaces an earlier one | `warning` alert; original row retained |
| **Late report** | unit silent past the deadline | `warning` alert; clears automatically when the unit reports |
| **Unknown party** | a party code not on the ballot | submission rejected outright |

The EC8A rule is the important one. `verify_result()` raises an exception if
anyone tries to approve a result with no photo attached, whatever the
interface says.

---

## 3. Personal data (Nigeria Data Protection Act 2023)

Agents' names and phone numbers are personal data. The obligations:

1. **Consent must be recorded before use.** `agents.consent_recorded_at` holds
   the timestamp. The WhatsApp handler refuses to message an agent whose
   consent is not recorded, and tells them to contact their coordinator.
2. **Access is limited to need.** Phone numbers are visible only inside the
   reader's scope (see the table above). An agent in Owo cannot see agents in
   Ose.
3. **Check whether registration with the NDPC is required** for this
   processing. That is a question for the campaign's lawyer, not a technical
   setting. Raise it before you collect a single number.
4. **Retention.** Agree a date after which agent contact details are deleted —
   typically once petitions close. Results and the audit log are kept; personal
   contact details need not be.

Voters' personal data is **not** in this system. The only voter-level figure
stored is the registered-voter count per unit, which is public INEC data.

---

## 4. Evidence and integrity

- Figures are accepted **only from the signed Form EC8A**. Anything else is
  unverified by definition.
- Every submission stores the EC8A photo path. Photos live in private object
  storage; no public bucket, no public URLs.
- Nothing is overwritten. `result_submissions` is append-only; corrections
  create a new row with `supersedes_id` pointing at the one replaced.
- Every write to results, units, agents and users lands in `audit_log` with
  who, what, before, after, and when.
- Verification requires a named human: `verified_by` and `verified_at` are
  enforced by a check constraint.

---

## 5. Backups

| What | How often | Retained | Where |
|---|---|---|---|
| Full database snapshot | daily | 30 days | managed provider backups |
| Point-in-time recovery (WAL) | continuous | 7 days | managed provider |
| **Election-day snapshot** | **every 15 minutes, polls open → collation complete** | 90 days | separate region/account |
| EC8A photo storage | daily | 90 days | object-storage versioning on |
| CSV export of all results | hourly on election day | indefinitely | campaign's own storage |

Election-day specifics:

- Raise snapshot frequency to 15 minutes from the morning of the poll. Do this
  the day before, not on the day.
- The hourly CSV export is the fallback that does not depend on the platform
  being up. Someone in the control room should hold a copy on a laptop.
- **Test a restore before election day.** A backup nobody has restored is a
  hope, not a backup. Restore into a scratch database, run `db/99_test.sql`
  against it, confirm the row counts match.

---

## 6. Operational security

- **Accounts**: one person, one account. No shared logins, especially not for
  the admin role. Phone-based one-time codes for agents; email plus a strong
  password for coordinators and admins.
- **Two-factor authentication required for admin and LGA coordinator roles.**
- **Least privilege**: the number of admins should be small enough to name out
  loud. Everyone else is a coordinator or an observer.
- **Offboarding**: set `is_active = false` rather than deleting. The audit
  trail must keep resolving to a real person.
- **Secrets**: database credentials, the WhatsApp token and the app secret live
  in the host's environment configuration, never in the repository. Rotate the
  WhatsApp token after the election.
- **Webhook authenticity**: the WhatsApp webhook verifies Meta's
  `x-hub-signature-256` HMAC on every request and rejects anything that fails.
- **Rate limiting** on the submission endpoint, keyed by agent, to blunt an
  attempt to flood the system with fake submissions.

---

## 7. Pre-election review checklist

Work through this with someone who did not build the system.

**Data**
- [ ] Polling unit register loaded from the current official INEC list, not the 2015 directory
- [ ] The two unverified Ose ward names (codes 09 and 12) confirmed and corrected
- [ ] Registered-voter figure checked against INEC for a random sample of 20 units
- [ ] Ward and unit counts reconciled with the INEC totals for the district

**Access**
- [ ] Every account's role and scope confirmed against a written list
- [ ] An agent account tested: can see only their own unit, cannot see another ward
- [ ] A ward coordinator tested: cannot see a neighbouring ward
- [ ] Two-factor enabled on every admin account
- [ ] Departed staff deactivated

**Integrity**
- [ ] `db/99_test.sql` passes against the production schema
- [ ] Over-vote check confirmed with a deliberate test submission in a scratch unit
- [ ] Verification confirmed to fail without an EC8A photo
- [ ] Audit log confirmed to be recording, and readable only by admins

**Resilience**
- [ ] A restore from backup performed and verified this month
- [ ] Election-day snapshot schedule in place
- [ ] Hourly CSV export tested end to end
- [ ] Someone named as on-call, with a phone that will be answered
- [ ] Fallback agreed in writing for a total platform outage (which numbers to call, who records on paper)

**People**
- [ ] Agents trained, and a mock reporting drill run across at least one full LGA
- [ ] Coordinators know how to verify and how to dispute
- [ ] Consent recorded for every agent phone number
- [ ] Legal sign-off on NDPA obligations

---

## 8. What this system does not do

Stated plainly, so nobody assumes otherwise:

- It is **not** an official result. INEC's figures are the official figures.
  This is the campaign's own parallel record, useful for spotting
  discrepancies and for supporting a petition.
- It does **not** project or call a race. The dashboard shows what has been
  submitted and nothing more.
- It does **not** verify that a photographed EC8A is genuine. A human
  coordinator makes that judgement.
- It cannot prevent a wrong figure being entered. It can make a wrong figure
  visible, attributable and correctable, which is the realistic goal.

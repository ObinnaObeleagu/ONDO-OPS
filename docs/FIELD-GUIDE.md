# Field guide — how each role uses the portal

Ondo North Senatorial District, Election Control Room.

Four roles, four sections of the same system. Each person signs in and lands
on their own section automatically — nobody has to find the right page or be
told a URL.

---

# 1. THE POLLING AGENT

**Portal:** `/agent` · **Sees:** their own polling unit only ·
**Device:** their phone

An agent has one job in this system: get the figures off the signed Form EC8A
and into the portal, with a photograph, before they leave the polling unit.

## Signing in

They enter their phone number and receive a one-time code by SMS. There is no
password. An agent standing in the sun at 3pm with a crowd behind them should
not be recovering a forgotten password.

Any of their registered numbers works. If they lose their main line and
message from a backup, the system still recognises them.

## What they see

One screen, already filled in with:

- their polling unit name and INEC code
- the registered voter count for that unit
- their own name

Nothing to choose, nothing to search for. If the unit shown is wrong, that is
a setup error and they should call their ward coordinator before entering
anything.

## Filing the result

In order, copying from the signed EC8A:

1. **Accredited voters** — the BVAS figure.
2. **Votes for each party** — one box per party on the ballot.
3. **Rejected ballots.**
4. **Photograph of the signed EC8A** — required. Submit stays switched off
   until a photo is attached.
5. **Remarks** — incidents, delays, disputes. Blank if nothing happened.

As they type, a running total shows underneath, with the registered figure
beside it. **If the total goes above the registered voters, a red warning
appears before they submit**, telling them to check against the form. They
are still allowed to send it — sometimes the form really does say that — but
it will be flagged and their coordinator will call.

They press Submit and get a **reference number**. That is their receipt.

## If they got something wrong

They file again. The corrected figures replace the old ones on the dashboard,
the original is kept, and the correction is flagged so a coordinator looks at
it. Nothing is ever deleted, and no agent can delete anything.

## On WhatsApp instead

An agent on a weak connection messages the campaign's WhatsApp number and the
bot asks the same questions one at a time:

> Hello Bisola. You are reporting for **Ehinogbe Town Hall 1**. Registered
> voters: 394. Is that correct? Reply **YES**.

Then accredited voters, each party in turn, rejected ballots, the EC8A photo,
remarks, and a summary to confirm before sending. The result that lands in the
control room is identical to one filed on the web — the system only records
which door it came through.

The bot will not message a number unless consent for that number has been
recorded. If an agent is not getting messages, that is the first thing to
check.

## What an agent cannot do

See another polling unit. See another agent's phone number. Verify their own
result. Delete anything.

---

# 2. THE WARD COORDINATOR

**Portal:** `/ward` · **Sees:** every unit in their ward ·
**Device:** phone or laptop

A ward coordinator has two jobs on election night: **chase** the units that
have gone quiet, and **verify** the results that come in.

## Signing in

Email and password, plus two-factor. They land on their ward.

## The screen

Top of the page, four numbers: reported out of total, how many are waiting to
be verified, how many are disputed, and the vote total so far. Below that, a
progress bar for the ward, then every polling unit in a table.

## Job one — chasing

Units that have not reported are marked **Not reported**, with the agent's
name and **every number on file for them** — main line, backup, ward office —
each tagged for WhatsApp and for whether consent is recorded. A Call button
per usable number, and a WhatsApp button.

The order to work in: start with units that have been silent longest. After
the reporting deadline the system raises a **Late report** flag on each silent
unit automatically, and clears it the moment they file.

## Job two — verifying

A result arriving sits as **Pending**. The coordinator opens it, puts the
typed figures beside the photographed EC8A, and either:

- **Verify** — the figures match the form. The unit turns green.
- **Dispute** — they do not, or the form looks wrong. It turns red and goes
  straight to the control room's alerts.

**Verify is switched off where no EC8A photo was sent.** The button is greyed,
and the database refuses the operation even if someone works around the
screen. Chase the photo first.

A result that failed an automatic check arrives already marked **Disputed**.
That is not an accusation — it means the arithmetic does not work. Ring the
agent and find out which figure is wrong.

## What a ward coordinator cannot do

See a neighbouring ward, even in the same LGA. Delete a result. Create or
change user accounts.

---

# 3. THE LGA COORDINATOR

**Portal:** `/lga` · **Sees:** every ward and unit in their LGA ·
**Device:** laptop, usually at a desk

A ward coordinator watches units. An LGA coordinator watches **wards** — and
the thing they are looking for is a pattern rather than a single gap.

## The screen

Four numbers for the LGA, then a bar per ward showing how much of it has
reported, then vote totals for the LGA, then a chase list covering every
outstanding unit across all their wards.

## What they are actually looking for

One silent unit is an agent problem — the ward coordinator handles it.
**A whole ward sitting at 20% when its neighbours are at 80% is a different
problem**: a ward coordinator who is not working, collation being held up, or
something happening on the ground. That is the LGA coordinator's call to make,
and the ward bars are arranged so it is visible at a glance.

## Stepping in

An LGA coordinator can open any ward in their LGA (`/ward`) and verify results
directly. That matters when a ward coordinator's phone dies or they are stuck
at a collation centre — the work does not stop.

They also hold the **Send reminder to all** action across their chase list,
for a push to every outstanding unit at once rather than one call at a time.

## What an LGA coordinator cannot do

See another LGA. Delete a result. Manage user accounts.

---

# 4. THE CONTROL ROOM

**Portal:** `/control` · **Sees:** the whole district

Admins and observers. Observers see everything and can change nothing — that
is the role for a lawyer, a party agent, or anyone watching who should not be
touching the data.

The control room's job is triage: work the **Alerts** panel top to bottom.
Critical first, each one a phone call. Over-votes before missing photos,
missing photos before silent units.

The running vote totals are **not a projection**. They are the sum of what has
been submitted, and the dashboard says so on its face.

Exports (CSV and PDF) run from here. Take one every hour on election night and
keep a copy off the platform.

---

# The escalation ladder

```
  Agent          -> can't file, figures look wrong, trouble at the unit
     |
  Ward coord     -> agent unreachable, result disputed, EC8A missing
     |
  LGA coord      -> a whole ward silent, ward coordinator unreachable
     |
  Control room   -> anything district-wide, legal, or press-facing
```

Each level handles its own before passing up. An agent should not be ringing
the control room about one missing figure, and the control room should not be
chasing individual units.

---

# Election-day timeline

| Time | Agent | Ward coordinator | LGA coordinator | Control room |
|---|---|---|---|---|
| Before 08:00 | Sign in, confirm the unit shown is theirs | Confirm every agent has signed in | Check ward coordinators are on | Confirm all portals reachable |
| 08:30 | File a remark if materials are late | Chase agents who have not signed in | Watch for wards with no activity | Watch alerts |
| Midday | — | Spot-check remarks | — | Watch alerts |
| Close of poll | Stay for the count | Prepare to receive | — | Raise snapshot frequency |
| Counting | File result + EC8A photo | Verify as results arrive | Watch ward progress | Triage alerts |
| +2 hours | — | Chase every outstanding unit | Escalate lagging wards | First full export |
| Collation | Hold the signed EC8A | Resolve disputes | Confirm LGA complete | Hourly exports, reconcile against INEC |

---

# Training notes

Run a **mock reporting drill** across at least one full LGA before election
day. Three things to rehearse, because they are what actually goes wrong:

1. **Taking a readable photo of the EC8A.** Most failures are a blurred or
   half-cropped form, not a refusal to send one.
2. **The over-vote warning.** Agents should know what it means and that they
   may still submit — otherwise they will edit figures to make the warning go
   away, which is the opposite of what anyone wants.
3. **Filing a correction.** Agents need to know that sending again is normal
   and safe, so a mistake is corrected rather than hidden.

Confirm consent is recorded for every agent number before the drill, or the
WhatsApp half will silently not work.

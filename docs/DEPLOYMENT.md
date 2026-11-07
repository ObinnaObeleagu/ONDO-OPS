# Deployment guide — Supabase + Vercel + WhatsApp

Takes the system from this repository to a live URL with a working agent
login and a working WhatsApp bot. Written as a sequence — each section
depends on the one before it.

**Time:** about 90 minutes the first time, mostly waiting on Meta's app
review queue. **You'll need:** a Supabase account, a Vercel account, a
Meta Business account, and a WhatsApp number that is not already active in
the regular WhatsApp or WhatsApp Business consumer app (the Cloud API
takes the number over).

---

## 1. Create the Supabase project

1. [supabase.com](https://supabase.com) → **New project**. Pick a region
   close to Nigeria — **Europe (London)** has the lowest latency of the
   standard regions; the US regions add a noticeable delay to every page
   load on election night.
2. Set a strong database password and **save it somewhere other than your
   memory** — you'll need it once, for the migration step below, and
   Supabase does not show it again.
3. Wait for provisioning (2–3 minutes).

### Run the migrations, in order

In the Supabase dashboard: **SQL Editor → New query**. Paste and run each
file from `db/`, **in this exact order** — later files depend on tables and
functions the earlier ones create:

```
01_schema.sql
02_security.sql
03_views.sql
04_seed_geography.sql
```

Each should finish with no red error output. `04_seed_geography.sql` ends
with two `NOTICE` lines — one confirming 72 wards, one warning that two Ose
ward names are unverified. That second warning is expected; see
`docs/ARCHITECTURE.md` for which wards.

Then load the polling-unit register once you have it (see the main
`README.md` for `05_load_polling_units.sql` and the CSV format it expects).
Until then the app runs with wards but no polling units — fine for testing
login and the dashboard shell, not for taking real submissions.

### Prove it migrated correctly

Still in the SQL Editor, paste and run `db/99_test.sql`. It should end:

```
NOTICE:  === ALL TESTS PASSED ===
```

Then `db/98_test_access.sql`:

```
NOTICE:  === ACCESS MODEL VERIFIED ===
```

If either fails, stop here — do not deploy an app against a database that
failed its own integrity tests. The failure message names which check broke.

### Create the EC8A photo bucket

**Storage → New bucket**:

- Name: `ec8a`
- **Public: off.** These photos are evidence; nobody gets a link to them
  without going through the app's own access checks.

**Storage → Policies** on the `ec8a` bucket — add:

```sql
-- Uploads: only the service role (the API route and the WhatsApp
-- handler both use it), never a browser directly.
create policy "service role uploads ec8a"
  on storage.objects for insert
  with check (bucket_id = 'ec8a' and auth.role() = 'service_role');

-- Reads: scoped the same way result_submissions is — a coordinator can
-- open a photo only for a polling unit inside their own scope.
create policy "scoped ec8a reads"
  on storage.objects for select
  using (
    bucket_id = 'ec8a'
    and exists (
      select 1 from result_submissions rs
      where rs.ec8a_photo_path = storage.objects.name
        and rs.pu_id in (select pu_id from visible_pu_ids())
    )
  );
```

### Turn on phone sign-in

**Authentication → Providers → Phone** → enable it, and connect an SMS
provider (Supabase's dashboard links Twilio, MessageBird, and Vonage — any
works; Twilio is the most documented). This is what sends the one-time code
agents sign in with.

**Authentication → Providers → Email** is on by default — that covers
coordinator and admin sign-in.

### Create the first admin account

Nobody exists in `app_users` yet, so nobody can sign in to anything beyond
the login page itself.

**Authentication → Users → Add user** — create yourself with an email and
password. Copy the UUID Supabase assigns.

Back in the **SQL Editor**:

```sql
insert into app_users (id, full_name, phone, role)
values ('<the UUID you copied>', 'Your Name', '+234XXXXXXXXXX', 'admin');
```

Sign in at `/login` with that email and password once the app is deployed,
and you land on `/control`. From there, create the rest of the coordinators
and agents the same way — or build a small admin screen over `app_users`
and `agents` once the core flow is proven out; the schema and RLS already
support it (`agents_write`, `users_write` policies).

### Collect your keys

**Project Settings → API** — you'll need, for the next step:

| Value | Where it's used |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` — **never** put this in a `NEXT_PUBLIC_*` variable; it bypasses every row-level security policy in the database |

---

## 2. Deploy to Vercel

### Push the repository

```bash
git init
git add .
git commit -m "Ondo North ops dashboard — initial build"
git branch -M main
git remote add origin <your repo URL>
git push -u origin main
```

### Import it

[vercel.com/new](https://vercel.com/new) → **Import** your repository.
Vercel detects Next.js automatically — leave the build settings as given.

### Environment variables

**Project Settings → Environment Variables**, all four scopes
(Production / Preview / Development unless noted):

```
NEXT_PUBLIC_SUPABASE_URL          = <Project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY     = <anon public key>
SUPABASE_URL                      = <Project URL>
SUPABASE_SERVICE_ROLE_KEY         = <service_role key>     # Production only — see note below

WHATSAPP_TOKEN                    = (added in section 3)
WHATSAPP_PHONE_NUMBER_ID          = (added in section 3)
WHATSAPP_VERIFY_TOKEN             = (added in section 3)
WHATSAPP_APP_SECRET               = (added in section 3)
```

**Restrict `SUPABASE_SERVICE_ROLE_KEY` to the Production environment only.**
A Preview deployment is built from whatever branch opened the pull request;
you don't want a feature-branch build carrying a key that bypasses every
access policy in the database.

### Deploy

**Deploy**. First build takes 1–2 minutes. You'll get a `*.vercel.app` URL —
visit it, confirm `/login` renders, and sign in with the admin account you
created above.

### A real domain (recommended before election day)

**Project Settings → Domains** → add the campaign's domain, follow the DNS
steps Vercel shows. Do this early — DNS propagation and certificate
issuance can take a few hours, and you do not want to be doing it the
morning of the poll.

---

## 3. Connect the WhatsApp bot

This is the fiddly part, mostly because Meta's setup has several screens
with similar names. Follow in order.

### 3.1 Create the Meta app

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps
   → Create App** → type **Business** → name it (e.g. "Ondo North Ops").
2. On the app dashboard, find **WhatsApp** in the product list → **Set up**.
   This creates a **test WhatsApp Business Account** and a **test phone
   number** automatically — you can send and receive real messages with the
   test number immediately, before any review.

### 3.2 Get the IDs you need

**WhatsApp → API Setup** in the left sidebar shows:

- **Phone number ID** — this is `WHATSAPP_PHONE_NUMBER_ID`, not the phone
  number itself.
- **Temporary access token** — valid 24 hours, fine for testing today, not
  for production. Permanent token is section 3.4.
- **WhatsApp Business Account ID** — note it, used later if you add a
  second number.

### 3.3 Send a test message

Still on **API Setup**, there's a **Send messages** panel with a `curl`
command pre-filled with your token and phone number ID. Add your own phone
as a recipient (you must add it under **To**, verified by a code Meta sends
you, since the app is still in development mode) and send the sample
message. If that arrives on your phone, the number is live.

### 3.4 Create a permanent token

The temporary token expires in 24 hours — not usable for a deployed app.

1. [business.facebook.com/settings](https://business.facebook.com/settings)
   → **Users → System Users → Add**. Name it something like
   `ondo-ops-whatsapp-bot`, role **Admin**.
2. **Add Assets** on that system user → **Apps** → select the app you
   created → give it **Full control**.
3. **Generate New Token** on the system user → select the app → select the
   `whatsapp_business_messaging` and `whatsapp_business_management`
   permissions → **Generate**.
4. Copy the token immediately — Meta shows it once. This is
   `WHATSAPP_TOKEN`. It does not expire on its own; store it like any other
   production secret.

### 3.5 Set the webhook

Your deployed app already has the endpoint — `app/api/whatsapp/route.ts`
handles both the verification handshake (`GET`) and incoming messages
(`POST`), with Meta's HMAC signature checked on every inbound request.

1. Pick a `WHATSAPP_VERIFY_TOKEN` yourself — any string you make up, used
   only to prove to Meta that the webhook URL belongs to you. Example:
   generate one with `openssl rand -hex 20`.
2. Add it to Vercel's environment variables (section 2) and **redeploy**
   so it takes effect.
3. Back in the Meta app: **WhatsApp → Configuration → Webhook → Edit**.
   - **Callback URL:** `https://<your-domain>/api/whatsapp`
   - **Verify token:** the string from step 1
   - **Verify and save.** Meta calls your `GET` handler immediately; it
     should go green. If it fails, the usual cause is the token not
     matching, or the deploy with the new env var not finished yet —
     redeploy and retry.
4. **Manage** (next to the webhook) → subscribe to the **`messages`**
   field. This is what makes Meta actually forward incoming agent messages
   to your endpoint, rather than just letting the webhook sit configured
   and silent.

### 3.6 Get the App Secret

`app/api/whatsapp/route.ts` verifies every inbound webhook call against
Meta's `x-hub-signature-256` header before acting on it — this is what
stops someone else from posting fake "agent submissions" straight to your
endpoint.

**App Settings → Basic** → **App Secret** → **Show**. This is
`WHATSAPP_APP_SECRET`. Add it to Vercel, redeploy.

### 3.7 Test end to end

From your own phone (added as a test recipient in 3.3), message the test
WhatsApp number. You should get the bot's opening message — but only if
that number exists in `agent_phones` with `consent_recorded_at` set:

```sql
-- in Supabase's SQL editor, for your own test run
insert into agents (pu_id, full_name)
values (1, 'Test Agent') returning id;
-- use the returned id below

insert into agent_phones (agent_id, phone, consent_recorded_at)
values ('<id from above>', '+234<your number>', now());
```

Message the bot. Walk through a full submission — accredited voters, each
party, rejected ballots, the EC8A photo, remarks, confirm. Check in
Supabase that `result_submissions` got a new row and `flags` picked up
anything it should have (try an over-vote on purpose, to see the warning
in the chat).

### 3.8 Move from test to live

The test number only reaches numbers you've explicitly added and verified.
To message any agent's real number:

1. **WhatsApp → Overview** → either **upgrade the test number** or **add
   a real number** you control (a dedicated SIM for the campaign is the
   usual choice — this number cannot also run personal WhatsApp).
2. Verify the number by SMS or voice code, through the same screen.
3. **App Review** → request `whatsapp_business_messaging` for **live**
   mode, not just the development access you've been testing with. Meta
   typically turns this around within a day for a straightforward
   business-messaging use case; add a line in the review notes that this
   is for election results reporting between a campaign and its own
   polling agents.
4. Once approved, switch the app from **Development** to **Live** in the
   top bar of the app dashboard.

### 3.9 The 24-hour window — read this before relying on reminders

WhatsApp Business rules: once an agent messages the bot, you can reply
freely for **24 hours**. Outside that window, your side can only send a
**pre-approved message template** — free-form text is rejected.

This matters for one specific feature: the **"Send reminder to all"**
button a ward or LGA coordinator uses to chase silent units. If an agent
has not messaged in over 24 hours, a plain reminder text will fail to
send.

Before election day, submit a template for approval — **WhatsApp Manager →
Message Templates → Create Template**, category **Utility**:

```
Template name: reporting_reminder
Category: Utility
Body: Hello {{1}}, please report your result for {{2}} as soon as
      possible. Reply to this message to begin, or call your ward
      coordinator.
```

Approval is usually same-day. Once approved, the reminder feature sends
this template to anyone outside the 24-hour window, and plain text to
anyone inside it. Submit this with time to spare — do not discover the
24-hour rule on election night.

---

## 4. Post-deploy checklist

Before handing this to anyone:

- [ ] `db/99_test.sql` and `db/98_test_access.sql` both pass against the
      **production** Supabase project, not just a local one
- [ ] `/login` loads, both tabs work
- [ ] Admin account signs in and lands on `/control`
- [ ] A test agent account (phone OTP) signs in and lands on `/agent`
- [ ] WhatsApp webhook shows green in Meta's dashboard
- [ ] A WhatsApp test submission appears in `result_submissions`
- [ ] The over-vote warning fires on a deliberate test submission, in both
      the web form and WhatsApp
- [ ] EC8A photo appears in the `ec8a` Storage bucket, and `verify_result()`
      refuses to verify a submission with none
- [ ] `reporting_reminder` template submitted for approval (section 3.9)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` confirmed **not** set on Preview
      deployments
- [ ] Custom domain attached and certificate issued

Then work through `docs/SECURITY.md`'s pre-election review checklist, which
covers backups, the polling-unit register, and account access — this
document only gets the system running, not ready for election day.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Webhook verification fails (red, not green) | `WHATSAPP_VERIFY_TOKEN` in Vercel doesn't match what you entered in Meta, or the redeploy carrying the new env var hasn't finished |
| Webhook is green but no messages arrive | Forgot to subscribe to the `messages` field (step 3.5.4) |
| Bot says "this number is not registered" | The sending number isn't in `agent_phones`, or it's there with `is_active = false` |
| Bot goes silent after the greeting | `consent_recorded_at` is `null` for that number — check NDPA consent is recorded |
| Build fails on Vercel with a Suspense error | You edited `app/login` — any client component reading `useSearchParams()` needs the `<Suspense>` wrapper `app/login/page.tsx` already has around `LoginForm` |
| `/control` or `/ward` loads empty for an admin | `app_users` has no row for that Supabase auth user, or `my_scope()` wasn't granted to `app_rw` — re-run the relevant grant in `db/02_security.sql` |
| A coordinator sees another ward's data | Stop and treat this as a security incident, not a bug report — re-run `db/98_test_access.sql` against production immediately and do not resume use until it passes |

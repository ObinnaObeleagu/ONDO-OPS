#!/usr/bin/env python3
"""
import_people.py — add or update agents and coordinators in bulk from a
spreadsheet (people_template.xlsx, or a CSV with the same columns).

For each row it:
  1. creates the person's Supabase sign-in account if they don't have one
     (found by phone number, then by email),
  2. creates or updates their app_users row (role, LGA, ward) using that
     account's id, which is what makes my_scope() and row-level security
     recognise them,
  3. for agents: links them to the agents record at their polling unit
     (creating it if needed) and records their phone numbers, with NDPA
     consent per number.

Safe to run again whenever the sheet changes: people already set up are
updated, not duplicated. Nobody is ever deleted. To take someone off,
set their `active` column to "no".

ALWAYS run a dry run first. It checks every row against the database and
reports what would happen, without changing anything:

    python3 import_people.py people.xlsx --dry-run
    python3 import_people.py people.xlsx

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, either set in your
terminal or in a .env.local file in this folder (see --env-file). The
service-role key can do anything in your database: run this from your own
computer only, never from a shared machine, and never commit the key.

Results go to people_results.csv: one line per row with what happened.
People given an email but no existing account get a temporary password
in that file. Hand each one out privately, then DELETE the file.
People with only a phone number sign in with a code sent by SMS, which
needs the SMS provider set up (docs/DEPLOYMENT.md, "Turn on phone sign-in").
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import secrets
import string
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import pandas as pd

ROLES = {"agent", "ward_coordinator", "lga_coordinator", "admin", "observer"}
ROLE_ALIASES = {
    "polling agent": "agent", "pu agent": "agent", "agent": "agent",
    "ward coordinator": "ward_coordinator", "ward coord": "ward_coordinator",
    "lga coordinator": "lga_coordinator", "lga coord": "lga_coordinator",
    "admin": "admin", "administrator": "admin",
    "observer": "observer",
}
TRUTHY = {"yes", "y", "true", "1", "x", "✓"}
FALSY = {"no", "n", "false", "0"}


# ---------------------------------------------------------------------
# Normalisation — same rules as norm_name() in db/05_load_polling_units.sql
# so 'AKOKO NORTH EAST' / 'Akoko North-East' and 'IKADO 2' / 'Ikado II'
# match the same way they do when polling units are loaded.
# ---------------------------------------------------------------------
def norm_name(s) -> str:
    s = re.sub(r"[^a-z0-9]", " ", str(s or "").lower())
    s = re.sub(r"\s+", " ", s)
    for roman, digit in (("iv", "4"), ("iii", "3"), ("ii", "2"), ("i", "1")):
        s = re.sub(rf"\b{roman}\b", digit, s)
    return re.sub(r"\s+", " ", s).strip()


def norm_phone(raw) -> str | None:
    """Nigerian numbers in any common form -> E.164 (+234...). None if it can't be read."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip()
    if s.endswith(".0"):            # Excel turned the number into a float
        s = s[:-2]
    plus = s.startswith("+")
    d = re.sub(r"\D", "", s)
    if not d:
        return None
    if plus:
        e164 = "+" + d
    elif d.startswith("234"):
        e164 = "+" + d
    elif d.startswith("0") and len(d) == 11:
        e164 = "+234" + d[1:]
    elif len(d) == 10 and d[0] in "789":     # leading 0 lost in Excel
        e164 = "+234" + d
    else:
        return None
    return e164 if re.fullmatch(r"\+[1-9]\d{7,14}", e164) else None


def cell(row, col) -> str:
    v = row.get(col)
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()


def yes_no(v: str, default: bool) -> bool | None:
    v = v.strip().lower()
    if not v:
        return default
    if v in TRUTHY:
        return True
    if v in FALSY:
        return False
    return None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def temp_password() -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        p = "".join(secrets.choice(alphabet) for _ in range(12))
        if any(c.isdigit() for c in p) and any(c.isupper() for c in p) and any(c.islower() for c in p):
            return p


# ---------------------------------------------------------------------
# Supabase, over plain HTTPS (no extra packages needed).
# ---------------------------------------------------------------------
class SupabaseError(Exception):
    pass


class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key

    def _req(self, method: str, path: str, body=None, prefer: str | None = None):
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            try:
                j = json.loads(detail)
                detail = j.get("msg") or j.get("message") or j.get("error_description") or detail
            except ValueError:
                pass
            raise SupabaseError(f"{method} {path.split('?')[0]} -> {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            raise SupabaseError(f"Could not reach {self.url}: {e.reason}") from None

    # REST (PostgREST). The service key bypasses row-level security.
    def select_all(self, table: str, select: str, filters: str = "") -> list[dict]:
        rows, offset, page = [], 0, 1000      # Supabase caps a response at 1000 rows
        while True:
            q = f"/rest/v1/{table}?select={urllib.parse.quote(select, safe='(),*')}&limit={page}&offset={offset}"
            if filters:
                q += "&" + filters
            batch = self._req("GET", q) or []
            rows += batch
            if len(batch) < page:
                return rows
            offset += page

    def insert(self, table: str, row: dict) -> dict:
        return self._req("POST", f"/rest/v1/{table}", [row], prefer="return=representation")[0]

    def update(self, table: str, where: str, patch: dict) -> list[dict]:
        return self._req("PATCH", f"/rest/v1/{table}?{where}", patch, prefer="return=representation") or []

    # Auth admin API.
    def auth_users(self) -> list[dict]:
        users, page = [], 1
        while True:
            r = self._req("GET", f"/auth/v1/admin/users?page={page}&per_page=1000") or {}
            batch = r.get("users", []) if isinstance(r, dict) else []
            users += batch
            if len(batch) < 1000:
                return users
            page += 1

    def create_auth_user(self, phone: str, email: str | None, password: str | None) -> dict:
        body = {"phone": phone, "phone_confirm": True}
        if email:
            body.update({"email": email, "email_confirm": True})
        if password:
            body["password"] = password
        r = self._req("POST", "/auth/v1/admin/users", body)
        return r.get("user", r) if isinstance(r, dict) else r


def load_env_file(path: str):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# ---------------------------------------------------------------------
# Reading and checking the sheet
# ---------------------------------------------------------------------
COLUMNS = ["full_name", "phone", "email", "role", "lga", "ward", "pu_code", "other_phones", "consent", "active"]


def read_sheet(path: str) -> pd.DataFrame:
    if path.lower().endswith((".xlsx", ".xls")):
        df = pd.read_excel(path, sheet_name="People", dtype=str)
    else:
        df = pd.read_csv(path, dtype=str, keep_default_na=False)
    df.columns = [re.sub(r"\s+", "_", str(c).strip().lower()).replace("*", "") for c in df.columns]
    missing = [c for c in ("full_name", "phone", "role") if c not in df.columns]
    if missing:
        sys.exit(f"The sheet is missing these columns: {', '.join(missing)}. Start from people_template.xlsx.")
    for c in COLUMNS:
        if c not in df.columns:
            df[c] = ""
    # drop fully empty rows (Excel leaves plenty)
    return df[df[["full_name", "phone", "role"]].fillna("").apply(lambda r: any(str(x).strip() for x in r), axis=1)]


class Geo:
    def __init__(self, sb: Supabase):
        self.lgas = sb.select_all("lgas", "id,name")
        self.wards = sb.select_all("wards", "id,name,lga_id")
        self.pus = {p["inec_code"].strip(): p for p in sb.select_all("polling_units", "id,inec_code,name,ward_id,is_active")}
        self.lga_by_norm = {norm_name(l["name"]): l for l in self.lgas}

    def lga(self, name: str):
        return self.lga_by_norm.get(norm_name(name))

    def ward(self, lga_name: str, ward_name: str):
        l = self.lga(lga_name)
        if not l:
            return None, f'LGA "{lga_name}" is not one of the 6 Ondo North LGAs'
        hits = [w for w in self.wards if w["lga_id"] == l["id"] and norm_name(w["name"]) == norm_name(ward_name)]
        if len(hits) == 1:
            return hits[0], None
        if not hits:
            return None, f'no ward "{ward_name}" in {l["name"]}'
        return None, f'"{ward_name}" matches more than one ward in {l["name"]} — use the exact name'


def check_rows(df: pd.DataFrame, geo: Geo):
    """Returns a list of dicts: the cleaned row plus `errors` and `notes`."""
    out = []
    for i, (_, r) in enumerate(df.iterrows(), start=2):    # row 1 is the header in Excel
        e, notes = [], []
        name = cell(r, "full_name")
        phone_raw = cell(r, "phone")
        phone = norm_phone(phone_raw)
        email = cell(r, "email").lower() or None
        role_raw = cell(r, "role").lower().replace("-", " ").replace("_", " ")
        role = ROLE_ALIASES.get(role_raw) or (role_raw.replace(" ", "_") if role_raw.replace(" ", "_") in ROLES else None)
        consent = yes_no(cell(r, "consent"), default=False)
        active = yes_no(cell(r, "active"), default=True)

        if not name:
            e.append("full_name is empty")
        if not phone:
            e.append(f'phone "{phone_raw}" is not a valid Nigerian number')
        if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            e.append(f'email "{email}" does not look right')
        if not role:
            e.append(f'role "{cell(r, "role")}" must be one of: agent, ward_coordinator, lga_coordinator, admin, observer')
        if consent is None:
            e.append('consent must be "yes" or "no"')
        if active is None:
            e.append('active must be "yes" or "no"')

        lga_id = ward_id = pu = None
        if role == "lga_coordinator":
            l = geo.lga(cell(r, "lga"))
            if not cell(r, "lga"):
                e.append("an LGA coordinator needs an lga")
            elif not l:
                e.append(f'LGA "{cell(r, "lga")}" is not one of the 6 Ondo North LGAs')
            else:
                lga_id = l["id"]
        if role == "ward_coordinator":
            if not cell(r, "lga") or not cell(r, "ward"):
                e.append("a ward coordinator needs both lga and ward")
            else:
                w, err = geo.ward(cell(r, "lga"), cell(r, "ward"))
                if err:
                    e.append(err)
                else:
                    ward_id, lga_id = w["id"], w["lga_id"]
        if role == "agent":
            code = cell(r, "pu_code")
            if not code:
                e.append("an agent needs pu_code (their polling unit's INEC code, e.g. 28/18/01/004)")
            elif code not in geo.pus:
                e.append(f'no polling unit with code "{code}" — has the register been loaded?')
            else:
                pu = geo.pus[code]
                if not pu["is_active"]:
                    e.append(f'polling unit {code} is marked inactive')

        others = []
        for raw in re.split(r"[;,/]", cell(r, "other_phones")):
            if not raw.strip():
                continue
            p = norm_phone(raw)
            if not p:
                e.append(f'other phone "{raw.strip()}" is not a valid Nigerian number')
            elif p != phone and p not in others:
                others.append(p)
        if others and role != "agent":
            notes.append("other_phones are only recorded for agents; ignored")

        out.append(dict(row=i, full_name=name, phone=phone, email=email, role=role, lga_id=lga_id,
                        ward_id=ward_id, pu=pu, other_phones=others, consent=bool(consent), active=bool(active),
                        errors=e, notes=notes))

    # The same phone or email twice in the sheet means two people would share one login.
    for key in ("phone", "email"):
        seen: dict[str, int] = {}
        for p in out:
            v = p[key]
            if not v:
                continue
            if v in seen:
                p["errors"].append(f"same {key} as row {seen[v]}")
                first = next(x for x in out if x["row"] == seen[v])
                if f"same {key} as row {p['row']}" not in first["errors"]:
                    first["errors"].append(f"same {key} as row {p['row']}")
            else:
                seen[v] = p["row"]
    return out


# ---------------------------------------------------------------------
# Applying it
# ---------------------------------------------------------------------
def apply_person(sb: Supabase, p: dict, auth_by_phone: dict, auth_by_email: dict,
                 users_by_id: dict, users_by_phone: dict, dry: bool) -> tuple[str, str, str]:
    """Returns (status, detail, temp_password)."""
    details, pw = [], ""

    # 1. sign-in account
    acct = auth_by_phone.get(p["phone"]) or (auth_by_email.get(p["email"]) if p["email"] else None)
    if acct and p["email"] and acct.get("email") and acct["email"].lower() != p["email"]:
        return "error", f'phone is already used by the account for {acct["email"]}', ""
    if acct:
        uid = acct["id"]
    elif dry:
        uid = None
        details.append("would create sign-in account" + (" with temporary password" if p["email"] else " (SMS code login)"))
    else:
        pw = temp_password() if p["email"] else ""
        acct = sb.create_auth_user(p["phone"], p["email"], pw or None)
        uid = acct["id"]
        auth_by_phone[p["phone"]] = acct
        details.append("created sign-in account")

    # 2. app_users row
    want = {"full_name": p["full_name"], "phone": p["phone"], "email": p["email"], "role": p["role"],
            "lga_id": p["lga_id"], "ward_id": p["ward_id"], "is_active": p["active"]}
    clash = users_by_phone.get(p["phone"])
    if clash and clash["id"] != uid and uid is not None:
        return "error", "an app_users row already has this phone but belongs to a different sign-in account — fix it by hand", ""
    existing = users_by_id.get(uid) if uid else clash
    status = "unchanged"
    if existing:
        changes = {k: v for k, v in want.items() if existing.get(k) != v}
        if changes:
            status = "updated"
            details.append("changed " + ", ".join(sorted(changes)))
            if not dry:
                sb.update("app_users", f"id=eq.{existing['id']}", changes)
                existing.update(changes)
    else:
        status = "created"
        if not dry:
            row = sb.insert("app_users", {"id": uid, **want})
            users_by_id[uid] = row
            users_by_phone[p["phone"]] = row
        details.append("added to app_users")

    # 3. agents: link to the polling unit, record phones
    if p["role"] == "agent" and p["pu"]:
        pu = p["pu"]
        agents = sb.select_all("agents", "id,pu_id,full_name,user_id,is_active,agent_phones(id,phone,consent_recorded_at)",
                               f"pu_id=eq.{pu['id']}")
        mine = [a for a in agents if uid and a["user_id"] == uid]
        by_phone = [a for a in agents if any(ph["phone"] == p["phone"] for ph in a["agent_phones"])]
        by_name = [a for a in agents if not a["user_id"] and norm_name(a["full_name"]) == norm_name(p["full_name"])]
        agent = (mine or by_phone or by_name or [None])[0]
        if agent and agent["user_id"] and uid and agent["user_id"] != uid:
            return "error", f'polling unit {pu["inec_code"]} already has this phone on another person\'s agent record', ""

        if not agent:
            if status == "unchanged":
                status = "updated"
            details.append(f'new agent record at {pu["inec_code"]}')
            if not dry:
                agent = sb.insert("agents", {"pu_id": pu["id"], "full_name": p["full_name"], "user_id": uid,
                                             "is_active": p["active"]})
                agent["agent_phones"] = []
        else:
            patch = {k: v for k, v in {"user_id": uid, "full_name": p["full_name"], "is_active": p["active"]}.items()
                     if agent.get(k) != v and not (k == "user_id" and uid is None)}
            if patch:
                if status == "unchanged":
                    status = "updated"
                details.append(f'agent record at {pu["inec_code"]}: ' + ", ".join(sorted(patch)))
                if not dry:
                    sb.update("agents", f"id=eq.{agent['id']}", patch)

        # Moved to a different unit: the old agent record is kept (it is
        # history) but no longer linked to this person's login.
        if uid:
            for old in sb.select_all("agents", "id,pu_id,user_id,is_active", f"user_id=eq.{uid}&is_active=eq.true"):
                if old["pu_id"] != pu["id"]:
                    details.append("unlinked from their previous polling unit")
                    if status == "unchanged":
                        status = "updated"
                    if not dry:
                        sb.update("agents", f"id=eq.{old['id']}", {"is_active": False})

        # Phones. Consent is only ever ADDED here, never removed or
        # re-dated: the recorded date is the evidence the NDPA asks for.
        have = {ph["phone"]: ph for ph in (agent or {}).get("agent_phones", [])}
        for n, ph in enumerate([p["phone"], *p["other_phones"]]):
            if ph not in have:
                if status == "unchanged":
                    status = "updated"
                details.append(f"added phone {ph}" + (" (primary)" if n == 0 else ""))
                if not dry and agent:
                    row = {"agent_id": agent["id"], "phone": ph, "label": "main" if n == 0 else "other",
                           "whatsapp_enabled": True}
                    if p["consent"]:
                        row["consent_recorded_at"] = now_iso()
                    sb.insert("agent_phones", row)
            elif p["consent"] and not have[ph]["consent_recorded_at"]:
                if status == "unchanged":
                    status = "updated"
                details.append(f"recorded consent for {ph}")
                if not dry:
                    sb.update("agent_phones", f"id=eq.{have[ph]['id']}", {"consent_recorded_at": now_iso()})
        if not p["consent"]:
            details.append("no consent recorded — WhatsApp messages to this agent are blocked")

    if dry and status in ("created", "updated"):
        status = "would be " + status
    return status, "; ".join(details + p["notes"]), pw


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet", help="people_template.xlsx filled in (or a CSV with the same columns)")
    ap.add_argument("--dry-run", action="store_true", help="check everything and report, change nothing")
    ap.add_argument("--env-file", default=".env.local", help="file holding SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    ap.add_argument("-o", "--output", default="people_results.csv")
    args = ap.parse_args()

    load_env_file(args.env_file)
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in your terminal or in .env.local).")
    sb = Supabase(url, key)

    df = read_sheet(args.sheet)
    print(f"Read {len(df)} people from {args.sheet}")
    try:
        geo = Geo(sb)
        people = check_rows(df, geo)
        auth = sb.auth_users()
        users = sb.select_all("app_users", "id,full_name,phone,email,role,lga_id,ward_id,is_active")
    except SupabaseError as e:
        sys.exit(f"Could not read from Supabase: {e}")
    if not geo.pus and any(p["role"] == "agent" for p in people):
        print("warning: no polling units are loaded yet, so no agent can be linked. Load the register first.")

    auth_by_phone = {norm_phone(a["phone"]): a for a in auth if a.get("phone")}
    auth_by_email = {a["email"].lower(): a for a in auth if a.get("email")}
    users_by_id = {u["id"]: u for u in users}
    users_by_phone = {u["phone"]: u for u in users}

    results = []
    for p in people:
        if p["errors"]:
            results.append((p, "error", "; ".join(p["errors"]), ""))
            continue
        try:
            status, detail, pw = apply_person(sb, p, auth_by_phone, auth_by_email, users_by_id, users_by_phone, args.dry_run)
        except SupabaseError as e:
            status, detail, pw = "error", str(e), ""
        results.append((p, status, detail, pw))

    with open(args.output, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["sheet_row", "full_name", "phone", "role", "status", "detail", "temporary_password"])
        for p, status, detail, pw in results:
            w.writerow([p["row"], p["full_name"], p["phone"] or "", p["role"] or "", status, detail, pw])

    counts: dict[str, int] = {}
    for _, s, _, _ in results:
        counts[s] = counts.get(s, 0) + 1
    print("\n" + ("DRY RUN — nothing was changed.\n" if args.dry_run else ""))
    for s in sorted(counts):
        print(f"  {counts[s]:>4}  {s}")
    errors = [(p, d) for p, s, d, _ in results if s == "error"]
    if errors:
        print(f"\n{len(errors)} row(s) need fixing in the sheet:")
        for p, d in errors[:25]:
            print(f"  row {p['row']} ({p['full_name'] or '?'}): {d}")
        if len(errors) > 25:
            print(f"  … and {len(errors) - 25} more — see {args.output}")
    print(f"\nFull results: {args.output}")
    if any(pw for *_, pw in results):
        print("It contains TEMPORARY PASSWORDS. Hand each one out privately, then delete the file.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

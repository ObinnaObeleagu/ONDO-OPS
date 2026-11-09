#!/usr/bin/env python3
"""
import_pu_data.py — clean a raw INEC polling-unit register into the
exact shape db/05_load_polling_units.sql expects.

INEC exports (CSV or Excel) are never consistent — header names vary
release to release, LGA names carry different punctuation, the sheet
usually covers an entire state rather than one senatorial district,
and registered-voter counts often arrive with thousands separators.
This script normalises all of that into one clean CSV with exactly
these columns, matching the pu_staging table:

    lga, ward, inec_pu_code, pu_name, registered_voters, latitude, longitude, status

It does NOT try to match ward names to the database — that fuzzy
matching already lives in load_polling_units() (db/05_load_polling_units.sql),
which reports anything it can't place rather than dropping it silently.
This script's only job is turning whatever INEC gives us into a clean,
consistent CSV that loader can read.

Usage:
    python3 import_pu_data.py raw_register.xlsx -o polling_units_seed.csv
    python3 import_pu_data.py raw_register.csv  -o polling_units_seed.csv --dry-run

If the input's headers don't match any of the known variants below,
rerun with --show-headers to see exactly what the file contains, then
pass --map to override (see --help).

Then, in the Supabase SQL Editor:
    \\copy pu_staging(lga,ward,inec_pu_code,pu_name,registered_voters,latitude,longitude,status) \\
        from 'polling_units_seed.csv' with (format csv, header true)
    select * from load_polling_units();
"""

from __future__ import annotations

import argparse
import json
import re
import sys

import pandas as pd

# ---------------------------------------------------------------------
# The 6 LGAs of Ondo North senatorial district. Every other LGA in a
# statewide register gets filtered out. Matching is done on the same
# normalised form as db/05_load_polling_units.sql's norm_name(), so
# "Akoko North-East" / "AKOKO NORTH EAST" / "Akoko North East LGA"
# all resolve to the same thing.
# ---------------------------------------------------------------------
TARGET_LGAS = [
    "Akoko North-East",
    "Akoko North-West",
    "Akoko South-East",
    "Akoko South-West",
    "Ose",
    "Owo",
]

# Candidate header names (normalised: lowercase, non-alphanumeric
# stripped to single spaces) that map to each canonical output column.
# Add to these lists if a register comes in with a header not covered.
HEADER_CANDIDATES: dict[str, list[str]] = {
    "lga": ["lga", "l g a", "local government", "local government area"],
    "ward": ["ward", "ra", "registration area", "regn area", "reg area", "ward name"],
    "inec_pu_code": [
        "pu code", "polling unit code", "delimitation", "inec pu code",
        "code", "pu_code", "delim", "pucode",
    ],
    "pu_name": ["pu name", "polling unit name", "name", "pu_name", "pu"],
    "registered_voters": [
        "registered voters", "no of registered voters",
        "number of registered voters", "reg voters", "voters",
        "regd voters", "total registered voters",
    ],
    "latitude": ["latitude", "lat"],
    "longitude": ["longitude", "long", "lng", "lon"],
    "status": ["status"],
}

REQUIRED_FIELDS = ["lga", "ward", "pu_name", "registered_voters"]
OUTPUT_COLUMNS = [
    "lga", "ward", "inec_pu_code", "pu_name",
    "registered_voters", "latitude", "longitude", "status",
]


def norm(s: str) -> str:
    """Same normalisation family as the SQL-side norm_name(): lowercase,
    strip punctuation, collapse whitespace. Used for both header and
    LGA-name matching so behaviour here mirrors the loader's own logic."""
    s = str(s).strip().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def build_header_map(columns: list[str], override: dict[str, str] | None) -> dict[str, str]:
    """Returns {raw_column_name: canonical_field} for every column we can place."""
    mapping: dict[str, str] = {}
    if override:
        # override is {canonical_field: raw_column_name}
        for canonical, raw in override.items():
            if raw in columns:
                mapping[raw] = canonical
            else:
                print(f"warning: --map gave column {raw!r} for {canonical!r}, "
                      f"but that column isn't in the file.", file=sys.stderr)

    normalised_lookup = {norm(c): c for c in columns}
    for canonical, candidates in HEADER_CANDIDATES.items():
        if canonical in mapping.values():
            continue  # already placed by an override
        for cand in candidates:
            if cand in normalised_lookup:
                mapping[normalised_lookup[cand]] = canonical
                break
    return mapping


def clean_registered_voters(v) -> int | None:
    if pd.isna(v):
        return None
    s = str(v).strip().replace(",", "").replace(" ", "")
    if not re.fullmatch(r"\d+", s):
        return None
    return int(s)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", help="Raw INEC register (.csv or .xlsx)")
    parser.add_argument("-o", "--output", default="polling_units_seed.csv",
                         help="Cleaned CSV to write (default: polling_units_seed.csv)")
    parser.add_argument("--sheet", default=0, help="Sheet name/index for .xlsx input (default: first sheet)")
    parser.add_argument("--show-headers", action="store_true",
                         help="Print the raw column headers found and exit, without processing.")
    parser.add_argument("--map", type=str, default=None,
                         help='JSON override for columns the auto-detector misses, e.g. '
                              '\'{"lga": "State LGA", "registered_voters": "PVC Collected"}\'')
    parser.add_argument("--dry-run", action="store_true",
                         help="Print the summary but don't write the output CSV.")
    args = parser.parse_args()

    if args.input.lower().endswith((".xlsx", ".xls")):
        df = pd.read_excel(args.input, sheet_name=args.sheet, dtype=str)
    else:
        df = pd.read_csv(args.input, dtype=str, keep_default_na=False, na_values=[""])

    df.columns = [str(c).strip() for c in df.columns]

    if args.show_headers:
        print("Columns found in", args.input, ":")
        for c in df.columns:
            print(" -", repr(c))
        return 0

    override = json.loads(args.map) if args.map else None
    header_map = build_header_map(list(df.columns), override)

    missing = [f for f in REQUIRED_FIELDS if f not in header_map.values()]
    if missing:
        print(f"Could not auto-detect a column for: {', '.join(missing)}.", file=sys.stderr)
        print("Run with --show-headers to see the actual column names in this file,", file=sys.stderr)
        print("then rerun with --map, e.g.:", file=sys.stderr)
        print('  --map \'{"lga": "YOUR COLUMN NAME", "ward": "YOUR COLUMN NAME"}\'', file=sys.stderr)
        return 1

    out = pd.DataFrame()
    for raw_col, canonical in header_map.items():
        out[canonical] = df[raw_col]
    for col in OUTPUT_COLUMNS:
        if col not in out.columns:
            out[col] = None

    total_rows = len(out)

    # Filter to Ondo North's 6 LGAs only — the source is usually statewide.
    target_norm = {norm(x) for x in TARGET_LGAS}
    out["_lga_norm"] = out["lga"].map(norm)
    kept = out[out["_lga_norm"].isin(target_norm)].copy()
    dropped_other_lga = total_rows - len(kept)

    # Clean registered_voters; drop rows where it can't be parsed as an integer.
    kept["registered_voters"] = kept["registered_voters"].map(clean_registered_voters)
    bad_voters = kept["registered_voters"].isna().sum()
    kept = kept[kept["registered_voters"].notna()]
    kept["registered_voters"] = kept["registered_voters"].astype(int)

    # Trim whitespace on text fields.
    for col in ["lga", "ward", "inec_pu_code", "pu_name", "status"]:
        kept[col] = kept[col].astype(str).str.strip() if col in kept else None

    kept = kept[OUTPUT_COLUMNS]

    print(f"Read {total_rows} rows from {args.input}")
    print(f"  {dropped_other_lga} dropped — outside Ondo North's 6 LGAs")
    print(f"  {bad_voters} dropped — unparseable registered_voters")
    print(f"  {len(kept)} rows kept")
    print()
    print("Per-LGA counts in the cleaned file:")
    print(kept["lga"].value_counts().to_string())
    for want in TARGET_LGAS:
        if norm(want) not in {norm(x) for x in kept["lga"].unique()}:
            print(f"  warning: no rows at all matched LGA {want!r} — check the source file "
                  f"has this LGA, or that its name doesn't need adding to TARGET_LGAS matching.",
                  file=sys.stderr)

    if args.dry_run:
        print("\n--dry-run set, not writing output.")
        return 0

    kept.to_csv(args.output, index=False)
    print(f"\nWrote {len(kept)} rows to {args.output}")
    print("\nNext: in the Supabase SQL Editor —")
    print("  \\copy pu_staging(lga,ward,inec_pu_code,pu_name,registered_voters,latitude,longitude,status) \\")
    print(f"      from '{args.output}' with (format csv, header true)")
    print("  select * from load_polling_units();")
    print("\nCheck the `problems` column of that result for anything it couldn't place —")
    print("nothing is silently dropped at that stage either.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Refresh direction display text without truncating official raw fields."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    args = parser.parse_args()

    database = args.database.resolve()
    connection = sqlite3.connect(database)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        before = connection.execute(
            "SELECT COUNT(*) FROM research_directions "
            "WHERE trim(COALESCE(raw_text, '')) <> '' AND COALESCE(display_text, '') <> raw_text"
        ).fetchone()[0]
        connection.execute(
            "UPDATE research_directions SET display_text = raw_text "
            "WHERE trim(COALESCE(raw_text, '')) <> ''"
        )
        connection.commit()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
        payload = {
            "database": str(database),
            "updated_rows": before,
            "raw_direction_rows": connection.execute(
                "SELECT COUNT(*) FROM research_directions "
                "WHERE trim(COALESCE(raw_text, '')) <> ''"
            ).fetchone()[0],
            "integrity": integrity,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

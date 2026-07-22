#!/usr/bin/env python3
"""Local, read-only HTTP server for the mathematics faculty dataset."""

from __future__ import annotations

import argparse
import contextlib
import errno
import json
import math
import mimetypes
import os
import socket
import sqlite3
import sys
import threading
import traceback
import webbrowser
from dataclasses import dataclass
from email.utils import formatdate, parsedate_to_datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, Sequence
from urllib.parse import parse_qs, quote, unquote_to_bytes, urlsplit


APP_VERSION = "2.1.0-data-20260722"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8766
MAX_PAGE_SIZE = 100
REGISTRY_FILENAME = "全国学校完成状态_2026-07-18.json"
REPORT_SUFFIX = "_数学学科师资统计_round54-org-repaired-final_2026-07-18.html"
EXPORT_SUFFIX = "_数学学科师资统计_round54-org-repaired-final_2026-07-18.xlsx"
TEACHER_REPORT_SUFFIX = "_教师报告_round54-org-repaired-final_2026-07-18.html"
GRADE_ORDER = ("A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-")

# Promoted release names are kept in one place so the launcher and static
# reports cannot silently fall back to an older report snapshot.
REPORT_SUFFIX = "_数学学科师资统计_promoted-final_2026-07-19.html"
TEACHER_REPORT_SUFFIX = "_教师报告_promoted-final_2026-07-19.html"


def console_message(message: str, *, error: bool = False, flush: bool = False) -> None:
    stream = sys.stderr if error else sys.stdout
    if stream is None:
        return
    try:
        print(message, file=stream, flush=flush)
    except (AttributeError, OSError):
        pass


class APIError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = dict(details) if details else None


@dataclass(frozen=True)
class AppConfig:
    project_root: Path
    database: Path
    registry: Path
    static_root: Path
    config_path: Path
    evidence_root: Path | None


def _unique_paths(paths: Iterable[Path]) -> list[Path]:
    result: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        resolved = path.expanduser().resolve()
        key = str(resolved).casefold()
        if key not in seen:
            seen.add(key)
            result.append(resolved)
    return result


def _runtime_project_candidates() -> list[Path]:
    cwd = Path.cwd()
    source_root = Path(__file__).resolve().parent.parent
    candidates: list[Path] = []
    if getattr(sys, "frozen", False):
        executable_dir = Path(sys.executable).resolve().parent
        candidates.extend((executable_dir.parent, cwd, executable_dir, cwd.parent))
    else:
        candidates.extend((source_root, cwd, cwd.parent))
    return _unique_paths(candidates)


def resolve_static_root() -> Path:
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        return (Path(bundle_root) / "static").resolve()
    return (Path(__file__).resolve().parent / "static").resolve()


def resolve_project_root(
    project_root: str | Path | None = None,
    database: str | Path | None = None,
) -> Path:
    if project_root is not None:
        return Path(project_root).expanduser().resolve()

    candidates = _runtime_project_candidates()
    for candidate in candidates:
        if (candidate / "data" / "math_faculty.db").is_file():
            return candidate

    if database is not None:
        supplied = Path(database).expanduser()
        database_candidates = [supplied] if supplied.is_absolute() else [Path.cwd() / supplied]
        database_candidates.extend(candidate / supplied for candidate in candidates if not supplied.is_absolute())
        for candidate in _unique_paths(database_candidates):
            if candidate.is_file() and candidate.parent.name.casefold() == "data":
                return candidate.parent.parent.resolve()

    searched = ", ".join(str(path) for path in candidates)
    raise FileNotFoundError(
        "未找到包含 data/math_faculty.db 的项目根目录；"
        f"已检查：{searched}。可使用 --project-root 显式指定。"
    )


def _read_evidence_root(
    project_root: Path,
    override: str | Path | None = None,
) -> Path | None:
    configured: str | Path | None = override
    if configured is None:
        config_path = project_root / "config" / "app-config.json"
        if config_path.is_file():
            with config_path.open("r", encoding="utf-8-sig") as handle:
                payload = json.load(handle)
            if not isinstance(payload, dict):
                raise ValueError(f"应用配置结构无效：{config_path}")
            configured = payload.get("evidence_root")
    if configured is None or not str(configured).strip():
        return None
    evidence_root = Path(configured).expanduser()
    if not evidence_root.is_absolute():
        evidence_root = project_root / evidence_root
    evidence_root = evidence_root.resolve()
    if not evidence_root.is_dir():
        raise FileNotFoundError(f"静态证据包目录不存在：{evidence_root}")
    return evidence_root


def build_config(
    project_root: str | Path | None = None,
    database: str | Path | None = None,
    static_root: str | Path | None = None,
    evidence_root: str | Path | None = None,
) -> AppConfig:
    root = resolve_project_root(project_root, database)
    if database is None:
        database_path = root / "data" / "math_faculty.db"
    else:
        supplied = Path(database).expanduser()
        database_path = supplied if supplied.is_absolute() else root / supplied
    database_path = database_path.resolve()
    registry_path = (root / "data" / "exports" / REGISTRY_FILENAME).resolve()
    static_path = Path(static_root).resolve() if static_root is not None else resolve_static_root()
    configured_evidence_root = _read_evidence_root(root, evidence_root)
    config_path = (root / "config" / "app-config.json").resolve()

    if not database_path.is_file():
        raise FileNotFoundError(f"数据库不存在：{database_path}")
    if not registry_path.is_file():
        raise FileNotFoundError(f"最终完成注册表不存在：{registry_path}")
    return AppConfig(root, database_path, registry_path, static_path, config_path, configured_evidence_root)


def _read_registry(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as handle:
        registry = json.load(handle)
    if not isinstance(registry, dict) or not isinstance(registry.get("schools"), list):
        raise ValueError(f"最终完成注册表结构无效：{path}")
    return registry


def _like_pattern(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _archive_url(archive_path: str | None, evidence_root: Path | None = None) -> str | None:
    if not archive_path or evidence_root is None:
        return None
    normalized = archive_path.replace("\\", "/").lstrip("./")
    without_evidence_prefix = normalized.removeprefix("evidence/")
    without_data_evidence_prefix = normalized.removeprefix("data/evidence/")
    candidates = (
        evidence_root / normalized,
        evidence_root / without_evidence_prefix,
        evidence_root / without_data_evidence_prefix,
        evidence_root / "html" / normalized,
        evidence_root / "html" / without_evidence_prefix,
        evidence_root / "html" / without_data_evidence_prefix,
    )
    for candidate in candidates:
        try:
            relative = candidate.relative_to(evidence_root)
        except ValueError:
            continue
        if candidate.is_file() or candidate.resolve().is_file():
            return "/local-evidence/" + quote(relative.as_posix(), safe="/")
    return None


def _report_url(school_name: str) -> str:
    return "/reports/" + quote(school_name + REPORT_SUFFIX)


def _teacher_report_url(school_name: str) -> str:
    return "/reports/" + quote(school_name + TEACHER_REPORT_SUFFIX)


def _export_url(school_name: str) -> str:
    return "/data/exports/" + quote(school_name + EXPORT_SUFFIX)


def _page_values(query: Mapping[str, list[str]]) -> tuple[int, int]:
    page = _positive_int(_query_value(query, "page", "1"), "page")
    page_size = _positive_int(_query_value(query, "page_size", "20"), "page_size")
    if page_size > MAX_PAGE_SIZE:
        raise APIError(
            HTTPStatus.BAD_REQUEST,
            "invalid_parameter",
            f"page_size 不能超过 {MAX_PAGE_SIZE}",
            {"parameter": "page_size", "maximum": MAX_PAGE_SIZE},
        )
    return page, page_size


def _positive_int(value: str, name: str) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise APIError(
            HTTPStatus.BAD_REQUEST,
            "invalid_parameter",
            f"{name} 必须是正整数",
            {"parameter": name},
        ) from exc
    if result < 1:
        raise APIError(
            HTTPStatus.BAD_REQUEST,
            "invalid_parameter",
            f"{name} 必须是正整数",
            {"parameter": name},
        )
    return result


def _query_value(query: Mapping[str, list[str]], name: str, default: str = "") -> str:
    values = query.get(name)
    if not values:
        return default
    return values[-1].strip()


def _pagination(total: int, page: int, page_size: int, items: list[dict[str, Any]]) -> dict[str, Any]:
    pages = math.ceil(total / page_size) if total else 0
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
        "has_previous": page > 1 and total > 0,
        "has_next": page < pages,
        "items": items,
    }


SCHOOL_METRICS_CTE = """
WITH appointment_stats AS (
    SELECT school_id,
           COUNT(*) AS appointment_count,
           COUNT(DISTINCT person_id) AS unique_person_count
    FROM appointments
    WHERE included = 1 AND active_on_snapshot = 1 AND full_time = 1
    GROUP BY school_id
), unit_stats AS (
    SELECT school_id, COUNT(*) AS unit_count
    FROM units
    WHERE included = 1
    GROUP BY school_id
), multi_stats AS (
    SELECT school_id, COUNT(*) AS multi_affiliation_person_count
    FROM (
        SELECT school_id, person_id
        FROM appointments
        WHERE included = 1 AND active_on_snapshot = 1 AND full_time = 1
        GROUP BY school_id, person_id
        HAVING COUNT(*) > 1
    ) grouped_people
    GROUP BY school_id
), direction_stats AS (
    SELECT a.school_id,
           COUNT(*) AS primary_direction_count,
           SUM(CASE WHEN rd.level1_code <> 'M0' THEN 1 ELSE 0 END) AS published_direction_count
    FROM research_directions rd
    JOIN appointments a ON a.appointment_id = rd.appointment_id
    WHERE rd.is_primary = 1
      AND a.included = 1 AND a.active_on_snapshot = 1 AND a.full_time = 1
    GROUP BY a.school_id
), person_schools AS (
    SELECT DISTINCT school_id, person_id
    FROM appointments
    WHERE included = 1 AND active_on_snapshot = 1 AND full_time = 1
), talent_stats AS (
    SELECT ps.school_id,
           COUNT(t.talent_id) AS talent_record_count,
           COUNT(DISTINCT t.person_id) AS talent_holder_count
    FROM person_schools ps
    JOIN talent_titles t ON t.person_id = ps.person_id
    GROUP BY ps.school_id
), issue_stats AS (
    SELECT school_id, COUNT(*) AS issue_count,
           SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_issue_count
    FROM issues
    WHERE school_id IS NOT NULL
    GROUP BY school_id
)
"""


SCHOOL_METRICS_SELECT = """
SELECT s.school_id, s.school_name, s.historical_name,
       s.evaluation_grade AS grade, s.evaluation_grade,
       s.official_order, s.current_domain, s.status AS database_status,
       appointment_stats.appointment_count,
       appointment_stats.unique_person_count,
       COALESCE(unit_stats.unit_count, 0) AS unit_count,
       COALESCE(multi_stats.multi_affiliation_person_count, 0) AS multi_affiliation_person_count,
       COALESCE(direction_stats.primary_direction_count, 0) AS primary_direction_count,
       COALESCE(direction_stats.published_direction_count, 0) AS published_direction_count,
       COALESCE(talent_stats.talent_record_count, 0) AS talent_record_count,
       COALESCE(talent_stats.talent_holder_count, 0) AS talent_holder_count,
       COALESCE(issue_stats.issue_count, 0) AS issue_count,
       COALESCE(issue_stats.open_issue_count, 0) AS open_issue_count
FROM schools s
JOIN appointment_stats ON appointment_stats.school_id = s.school_id
LEFT JOIN unit_stats ON unit_stats.school_id = s.school_id
LEFT JOIN multi_stats ON multi_stats.school_id = s.school_id
LEFT JOIN direction_stats ON direction_stats.school_id = s.school_id
LEFT JOIN talent_stats ON talent_stats.school_id = s.school_id
LEFT JOIN issue_stats ON issue_stats.school_id = s.school_id
"""


SCHOOL_SORTS = {
    "": "s.official_order ASC",
    "order": "s.official_order ASC",
    "official_order": "s.official_order ASC",
    "name": "s.school_name COLLATE NOCASE ASC, s.official_order ASC",
    "name_asc": "s.school_name COLLATE NOCASE ASC, s.official_order ASC",
    "name_desc": "s.school_name COLLATE NOCASE DESC, s.official_order ASC",
    "grade": "s.official_order ASC",
    "grade_asc": "s.official_order ASC",
    "grade_desc": "s.official_order DESC",
    "appointments": "appointment_stats.appointment_count DESC, s.official_order ASC",
    "appointments_desc": "appointment_stats.appointment_count DESC, s.official_order ASC",
    "appointments_asc": "appointment_stats.appointment_count ASC, s.official_order ASC",
    "appointment_count": "appointment_stats.appointment_count DESC, s.official_order ASC",
    "people": "appointment_stats.unique_person_count DESC, s.official_order ASC",
    "people_desc": "appointment_stats.unique_person_count DESC, s.official_order ASC",
    "people_asc": "appointment_stats.unique_person_count ASC, s.official_order ASC",
    "unique_person_count": "appointment_stats.unique_person_count DESC, s.official_order ASC",
    "talents": "COALESCE(talent_stats.talent_record_count, 0) DESC, s.official_order ASC",
    "talents_desc": "COALESCE(talent_stats.talent_record_count, 0) DESC, s.official_order ASC",
    "talents_asc": "COALESCE(talent_stats.talent_record_count, 0) ASC, s.official_order ASC",
    "talent_record_count": "COALESCE(talent_stats.talent_record_count, 0) DESC, s.official_order ASC",
    "directions": "COALESCE(direction_stats.published_direction_count, 0) DESC, s.official_order ASC",
    "directions_desc": "COALESCE(direction_stats.published_direction_count, 0) DESC, s.official_order ASC",
    "directions_asc": "COALESCE(direction_stats.published_direction_count, 0) ASC, s.official_order ASC",
    "published_direction_count": "COALESCE(direction_stats.published_direction_count, 0) DESC, s.official_order ASC",
}


class DataStore:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.registry = _read_registry(config.registry)
        self.registry_by_school = {
            row["school_id"]: row
            for row in self.registry["schools"]
            if isinstance(row, dict) and row.get("school_id")
        }
        self._verify_database()

    @contextlib.contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        uri = self.config.database.as_uri() + "?mode=ro"
        connection = sqlite3.connect(uri, uri=True, timeout=10.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only = ON")
        try:
            yield connection
        finally:
            connection.close()

    def _verify_database(self) -> None:
        with self.connect() as connection:
            query_only = connection.execute("PRAGMA query_only").fetchone()[0]
            integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
            if query_only != 1 or integrity != "ok":
                raise RuntimeError("数据库只读检查或完整性检查失败")

    @staticmethod
    def _rows(cursor: sqlite3.Cursor) -> list[dict[str, Any]]:
        return [dict(row) for row in cursor]

    def _archive_url(self, archive_path: str | None) -> str | None:
        return _archive_url(archive_path, self.config.evidence_root)

    def _enrich_school(self, row: Mapping[str, Any]) -> dict[str, Any]:
        result = dict(row)
        registry_row = self.registry_by_school.get(str(result["school_id"]), {})
        result.update(
            {
                "completion_status": registry_row.get("completion_status", result.get("database_status")),
                "strict_complete": bool(registry_row.get("strict_complete", False)),
                "completion_reason": registry_row.get("completion_reason"),
                "coverage_stage_status": registry_row.get("coverage_stage_status"),
                "export_status": registry_row.get("export_status"),
                "report_url": _report_url(str(result["school_name"])),
                "teacher_report_url": _teacher_report_url(str(result["school_name"])),
                "export_url": _export_url(str(result["school_name"])),
            }
        )
        result["status"] = result["completion_status"]
        return result

    def health(self) -> dict[str, Any]:
        with self.connect() as connection:
            query_only = connection.execute("PRAGMA query_only").fetchone()[0]
            appointment_count = connection.execute(
                "SELECT COUNT(*) FROM appointments "
                "WHERE included = 1 AND active_on_snapshot = 1 AND full_time = 1"
            ).fetchone()[0]
        return {
            "status": "ok",
            "ok": True,
            "service": "数学学科师资统计",
            "version": APP_VERSION,
            "database": "ready",
            "read_only": query_only == 1,
            "evidence_mode": "external-configured" if self.config.evidence_root else "official-default",
            "snapshot_date": self.registry.get("snapshot_date"),
            "school_count": self.registry.get("included_school_count"),
            "appointment_count": appointment_count,
        }

    def summary(self) -> dict[str, Any]:
        with self.connect() as connection:
            totals_row = dict(
                connection.execute(
                    """
                    SELECT COUNT(*) AS appointment_count,
                           COUNT(DISTINCT person_id) AS unique_person_count
                    FROM appointments
                    WHERE included = 1 AND active_on_snapshot = 1 AND full_time = 1
                    """
                ).fetchone()
            )
            multi_count = connection.execute(
                """
                SELECT COUNT(*) FROM (
                    SELECT school_id, person_id
                    FROM appointments
                    WHERE included = 1 AND active_on_snapshot = 1 AND full_time = 1
                    GROUP BY school_id, person_id HAVING COUNT(*) > 1
                ) grouped_people
                """
            ).fetchone()[0]
            talent_totals = dict(
                connection.execute(
                    "SELECT COUNT(*) AS talent_record_count, "
                    "COUNT(DISTINCT person_id) AS talent_holder_count FROM talent_titles"
                ).fetchone()
            )
            talent_rows = self._rows(
                connection.execute(
                    """
                    SELECT tx.code, tx.category_name, tx.description,
                           COUNT(t.talent_id) AS record_count,
                           COUNT(DISTINCT t.person_id) AS holder_count
                    FROM talent_taxonomy tx
                    LEFT JOIN talent_titles t ON t.code = tx.code
                    GROUP BY tx.code, tx.category_name, tx.description
                    ORDER BY tx.code
                    """
                )
            )
            for row in talent_rows:
                if row["code"] == "T1":
                    row["description"] = "中国科学院院士、中国工程院院士"
            direction_rows = self._rows(
                connection.execute(
                    """
                    SELECT tx.code, tx.category_name, tx.description,
                           COUNT(rd.direction_id) AS count
                    FROM direction_taxonomy tx
                    LEFT JOIN research_directions rd
                      ON rd.level1_code = tx.code AND rd.is_primary = 1
                    GROUP BY tx.code, tx.category_name, tx.description
                    ORDER BY tx.code
                    """
                )
            )
            grade_rows = self._rows(
                connection.execute(
                    """
                    SELECT s.evaluation_grade AS grade,
                           COUNT(DISTINCT s.school_id) AS school_count,
                           COUNT(a.appointment_id) AS appointment_count,
                           COUNT(DISTINCT a.person_id) AS unique_person_count
                    FROM schools s
                    JOIN appointments a ON a.school_id = s.school_id
                    WHERE a.included = 1 AND a.active_on_snapshot = 1 AND a.full_time = 1
                    GROUP BY s.evaluation_grade
                    """
                )
            )
            grade_directions = self._rows(
                connection.execute(
                    """
                    SELECT s.evaluation_grade AS grade, rd.level1_code AS code, COUNT(*) AS count
                    FROM research_directions rd
                    JOIN appointments a ON a.appointment_id = rd.appointment_id
                    JOIN schools s ON s.school_id = a.school_id
                    WHERE rd.is_primary = 1
                      AND a.included = 1 AND a.active_on_snapshot = 1 AND a.full_time = 1
                    GROUP BY s.evaluation_grade, rd.level1_code
                    """
                )
            )
            grade_talents = self._rows(
                connection.execute(
                    """
                    WITH person_schools AS (
                        SELECT DISTINCT school_id, person_id
                        FROM appointments
                        WHERE included = 1 AND active_on_snapshot = 1 AND full_time = 1
                    )
                    SELECT s.evaluation_grade AS grade, t.code, COUNT(*) AS record_count,
                           COUNT(DISTINCT t.person_id) AS holder_count
                    FROM person_schools ps
                    JOIN schools s ON s.school_id = ps.school_id
                    JOIN talent_titles t ON t.person_id = ps.person_id
                    GROUP BY s.evaluation_grade, t.code
                    """
                )
            )
        totals = {
            "school_count": int(self.registry.get("included_school_count", 0)),
            "strict_complete_school_count": int(self.registry.get("strict_complete_school_count", 0)),
            "limited_school_count": int(self.registry.get("partial_school_count", 0)),
            "partial_public_roster_limit_school_count": int(self.registry.get("partial_school_count", 0)),
            "appointment_count": totals_row["appointment_count"],
            "unique_person_count": totals_row["unique_person_count"],
            "multi_affiliation_person_count": multi_count,
            **talent_totals,
        }
        grade_by_name = {row["grade"]: row for row in grade_rows}
        direction_by_grade: dict[str, dict[str, int]] = {grade: {} for grade in GRADE_ORDER}
        talent_by_grade: dict[str, dict[str, dict[str, int]]] = {grade: {} for grade in GRADE_ORDER}
        for row in grade_directions:
            direction_by_grade[row["grade"]][row["code"]] = row["count"]
        for row in grade_talents:
            talent_by_grade[row["grade"]][row["code"]] = {
                "record_count": row["record_count"],
                "holder_count": row["holder_count"],
            }
        grade_summary: list[dict[str, Any]] = []
        for grade in GRADE_ORDER:
            row = dict(
                grade_by_name.get(
                    grade,
                    {"grade": grade, "school_count": 0, "appointment_count": 0, "unique_person_count": 0},
                )
            )
            row["directions"] = {code: direction_by_grade[grade].get(code, 0) for code in (f"M{i}" for i in range(9))}
            row["talents"] = {
                code: talent_by_grade[grade].get(code, {"record_count": 0, "holder_count": 0})
                for code in (f"T{i}" for i in range(1, 5))
            }
            grade_summary.append(row)

        public_direction_count = sum(
            row["count"] for row in direction_rows if row["code"] != "M0"
        )
        totals["published_direction_count"] = public_direction_count
        totals["direction_public_rate"] = (
            public_direction_count / totals["appointment_count"]
            if totals["appointment_count"]
            else 0
        )
        totals.update(
            {
                "person_count": totals["unique_person_count"],
                "school_unique_people_sum": totals["unique_person_count"],
                "national_unique_people": totals["unique_person_count"],
                "multi_affiliation_people": totals["multi_affiliation_person_count"],
                "talent_records": totals["talent_record_count"],
                "talent_holders": totals["talent_holder_count"],
                "direction_publication_rate": totals["direction_public_rate"],
                "direction_counts": {row["code"]: row["count"] for row in direction_rows},
                "talent_counts": {row["code"]: row["record_count"] for row in talent_rows},
            }
        )

        payload: dict[str, Any] = {
            "snapshot_date": self.registry.get("snapshot_date"),
            "generated_on": self.registry.get("generated_on"),
            "totals": totals,
            **totals,
            "completion_status_counts": {
                "complete": totals["strict_complete_school_count"],
                "partial_public_roster_limit": totals["limited_school_count"],
            },
            "talent_tiers": talent_rows,
            "talent_summary": {row["code"]: row for row in talent_rows},
            "directions": direction_rows,
            "m_distribution": direction_rows,
            "direction_distribution": direction_rows,
            "direction_summary": {row["code"]: row for row in direction_rows},
            "t_distribution": talent_rows,
            "talent_distribution": talent_rows,
            "grade_summary": grade_summary,
            "grades": grade_summary,
        }
        return payload

    def options(self) -> dict[str, Any]:
        with self.connect() as connection:
            schools = self._rows(
                connection.execute(
                    """
                    SELECT s.school_id, s.school_name, s.evaluation_grade AS grade,
                           s.official_order, s.status AS database_status
                    FROM schools s
                    WHERE EXISTS (
                        SELECT 1 FROM appointments a
                        WHERE a.school_id = s.school_id
                          AND a.included = 1 AND a.active_on_snapshot = 1 AND a.full_time = 1
                    )
                    ORDER BY s.official_order
                    """
                )
            )
            units = self._rows(
                connection.execute(
                    """
                    SELECT u.unit_id, u.unit_name, u.school_id, s.school_name,
                           u.unit_level, u.scope_mode
                    FROM units u
                    JOIN schools s ON s.school_id = u.school_id
                    WHERE u.included = 1
                      AND EXISTS (SELECT 1 FROM appointments a WHERE a.unit_id = u.unit_id)
                    ORDER BY s.official_order, u.unit_name
                    """
                )
            )
            directions = self._rows(
                connection.execute("SELECT code, category_name, description FROM direction_taxonomy ORDER BY code")
            )
            talents = self._rows(
                connection.execute("SELECT code, category_name, description FROM talent_taxonomy ORDER BY code")
            )
        for school in schools:
            registry_row = self.registry_by_school.get(school["school_id"], {})
            school["completion_status"] = registry_row.get("completion_status", school["database_status"])
            school["status"] = school["completion_status"]
        statuses = [
            {"value": "complete", "label": "严格完成", "count": self.registry.get("strict_complete_school_count", 0)},
            {
                "value": "partial_public_roster_limit",
                "label": "公开名册受限",
                "count": self.registry.get("partial_school_count", 0),
            },
        ]
        grades = [{"value": grade, "label": grade} for grade in GRADE_ORDER]
        return {
            "schools": schools,
            "grades": grades,
            "grade_values": list(GRADE_ORDER),
            "completion_statuses": statuses,
            "statuses": statuses,
            "units": units,
            "departments": units,
            "directions": directions,
            "talent_tiers": talents,
            "talents": talents,
        }

    def schools(self, query: Mapping[str, list[str]]) -> dict[str, Any]:
        q = _query_value(query, "q")
        grade = _query_value(query, "grade")
        status = _query_value(query, "status")
        sort = _query_value(query, "sort")
        if grade and grade not in GRADE_ORDER:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_parameter", "grade 不是有效等级", {"parameter": "grade"})
        status_map = {
            "complete": "completed",
            "completed": "completed",
            "strict_complete": "completed",
            "partial": "partial",
            "limited": "partial",
            "partial_public_roster_limit": "partial",
        }
        if status and status not in status_map:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_parameter", "status 不是有效完成状态", {"parameter": "status"})
        if sort not in SCHOOL_SORTS:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_parameter", "sort 不是有效排序方式", {"parameter": "sort"})

        clauses: list[str] = []
        parameters: list[Any] = []
        if q:
            clauses.append(
                "(s.school_name LIKE ? ESCAPE '\\' OR COALESCE(s.historical_name, '') LIKE ? ESCAPE '\\' "
                "OR s.school_id LIKE ? ESCAPE '\\')"
            )
            pattern = _like_pattern(q)
            parameters.extend((pattern, pattern, pattern))
        if grade:
            clauses.append("s.evaluation_grade = ?")
            parameters.append(grade)
        sql = SCHOOL_METRICS_CTE + SCHOOL_METRICS_SELECT
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY " + SCHOOL_SORTS[sort]
        with self.connect() as connection:
            rows = self._rows(connection.execute(sql, parameters))
        items = [self._enrich_school(row) for row in rows]
        if status:
            registry_status = "complete" if status_map[status] == "completed" else "partial_public_roster_limit"
            items = [item for item in items if item.get("completion_status") == registry_status]
        return {"total": len(items), "items": items, "schools": items}

    def _school_metrics(self, school_ids: Sequence[str]) -> list[dict[str, Any]]:
        if not school_ids:
            return []
        placeholders = ",".join("?" for _ in school_ids)
        sql = (
            SCHOOL_METRICS_CTE
            + SCHOOL_METRICS_SELECT
            + f" WHERE s.school_id IN ({placeholders}) ORDER BY s.official_order"
        )
        with self.connect() as connection:
            rows = self._rows(connection.execute(sql, list(school_ids)))
        return [self._enrich_school(row) for row in rows]

    def issues(self, query: Mapping[str, list[str]]) -> dict[str, Any]:
        status = _query_value(query, "status", "")
        severity = _query_value(query, "severity", "")
        keyword = _query_value(query, "q", "")
        clauses = ["1 = 1"]
        values: list[Any] = []
        if status:
            clauses.append("i.status = ?")
            values.append(status)
        if severity:
            clauses.append("i.severity = ?")
            values.append(severity)
        if keyword:
            pattern = _like_pattern(keyword)
            clauses.append("(s.school_name LIKE ? ESCAPE '\\' OR i.issue_type LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR p.name_cn LIKE ? ESCAPE '\\')")
            values.extend([pattern, pattern, pattern, pattern])
        with self.connect() as connection:
            rows = self._rows(
                connection.execute(
                    f"""
                    SELECT i.issue_id, i.school_id, s.school_name, s.official_order AS school_order,
                           i.unit_id, u.unit_name,
                           i.person_id, p.name_cn AS person_name, i.issue_type, i.severity,
                           i.description, i.status, i.resolution, i.created_at, i.updated_at
                    FROM issues i
                    JOIN schools s ON s.school_id = i.school_id
                    LEFT JOIN units u ON u.unit_id = i.unit_id
                    LEFT JOIN persons p ON p.person_id = i.person_id
                    WHERE {' AND '.join(clauses)}
                    ORDER BY s.official_order,
                             CASE i.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                             i.issue_id
                    LIMIT 2000
                    """,
                    values,
                )
            )
            partial_school_rows = self._rows(
                connection.execute(
                    """
                    SELECT 'SCHOOL-COMPLETION-' || s.school_id AS issue_id,
                           s.school_id, s.school_name, s.official_order AS school_order,
                           NULL AS unit_id, NULL AS unit_name,
                           NULL AS person_id, NULL AS person_name,
                           'partial_public_roster_limit' AS issue_type,
                           'medium' AS severity,
                           '官方公开名册不能覆盖全部当前数学教师。' AS description,
                           'open' AS status, NULL AS resolution,
                           NULL AS created_at, NULL AS updated_at
                    FROM schools s
                    WHERE s.status = 'partial'
                      AND NOT EXISTS (
                          SELECT 1 FROM issues i
                          WHERE i.school_id = s.school_id
                            AND i.issue_type = 'partial_public_roster_limit'
                      )
                    """
                )
            )
        partial_school_ids = {
            school_id
            for school_id, registry_row in self.registry_by_school.items()
            if registry_row.get("completion_status") == "partial_public_roster_limit"
        }
        partial_school_rows = [
            row for row in partial_school_rows
            if row.get("school_id") in partial_school_ids
        ]
        if keyword:
            pattern = keyword.casefold()
            partial_school_rows = [
                row for row in partial_school_rows
                if pattern in " ".join(
                    str(row.get(key) or "")
                    for key in ("school_name", "issue_type", "description")
                ).casefold()
            ]
        if status and status != "open":
            partial_school_rows = []
        if severity and severity != "medium":
            partial_school_rows = []
        rows.extend(partial_school_rows)
        severity_order = {"high": 1, "medium": 2, "low": 3}
        def issue_sort_key(row: dict[str, Any]) -> tuple[int, int, str]:
            try:
                school_order = int(row.get("school_order"))
            except (TypeError, ValueError):
                school_order = 2_147_483_647
            return (
                school_order,
                severity_order.get(str(row.get("severity") or "low"), 4),
                str(row.get("issue_id") or ""),
            )

        rows.sort(key=issue_sort_key)
        rows = rows[:2000]
        return {"items": rows, "count": len(rows), "filters": {"status": status, "severity": severity, "q": keyword}}

    def school_detail(self, school_id: str) -> dict[str, Any]:
        schools = self._school_metrics([school_id])
        if not schools:
            raise APIError(HTTPStatus.NOT_FOUND, "school_not_found", "学校不存在或未纳入统计")
        school = schools[0]
        with self.connect() as connection:
            units = self._rows(
                connection.execute(
                    """
                    SELECT u.unit_id, u.unit_name, u.unit_level, u.scope_mode,
                           u.inclusion_basis, u.official_url, u.status,
                           u.primary_source_id, src.url AS source_url,
                           src.archive_path AS source_archive_path,
                           COUNT(a.appointment_id) AS appointment_count,
                           COUNT(DISTINCT a.person_id) AS unique_person_count
                    FROM units u
                    LEFT JOIN appointments a
                      ON a.unit_id = u.unit_id
                     AND a.included = 1 AND a.active_on_snapshot = 1 AND a.full_time = 1
                    LEFT JOIN sources src ON src.source_id = u.primary_source_id
                    WHERE u.school_id = ? AND u.included = 1
                    GROUP BY u.unit_id
                    ORDER BY u.unit_name
                    """,
                    (school_id,),
                )
            )
            related_units = self._rows(
                connection.execute(
                    """
                    SELECT r.related_id, r.school_id, r.unit_name, r.treatment,
                           r.official_url, r.verification_status, r.note,
                           r.source_id, src.url AS source_url,
                           src.archive_path AS source_archive_path
                    FROM related_unit_notes r
                    LEFT JOIN sources src ON src.source_id = r.source_id
                    WHERE r.school_id = ?
                    ORDER BY CASE r.treatment
                        WHEN 'included_separately' THEN 1
                        WHEN 'context_only' THEN 2
                        WHEN 'deferred' THEN 3
                        ELSE 4 END,
                        r.unit_name
                    """,
                    (school_id,),
                )
            )
            unit_directions = self._rows(
                connection.execute(
                    """
                    SELECT a.unit_id, rd.level1_code AS code, COUNT(*) AS count
                    FROM research_directions rd
                    JOIN appointments a ON a.appointment_id = rd.appointment_id
                    WHERE a.school_id = ? AND rd.is_primary = 1
                    GROUP BY a.unit_id, rd.level1_code
                    """,
                    (school_id,),
                )
            )
            directions = self._rows(
                connection.execute(
                    """
                    SELECT tx.code, tx.category_name, tx.description,
                           COUNT(rd.direction_id) AS count
                    FROM direction_taxonomy tx
                    LEFT JOIN research_directions rd
                      ON rd.level1_code = tx.code AND rd.is_primary = 1
                     AND EXISTS (
                         SELECT 1 FROM appointments a
                         WHERE a.appointment_id = rd.appointment_id AND a.school_id = ?
                     )
                    GROUP BY tx.code, tx.category_name, tx.description
                    ORDER BY tx.code
                    """,
                    (school_id,),
                )
            )
            talents = self._rows(
                connection.execute(
                    """
                    WITH school_people AS (
                        SELECT DISTINCT person_id FROM appointments
                        WHERE school_id = ? AND included = 1
                    )
                    SELECT tx.code, tx.category_name, tx.description,
                           COUNT(t.talent_id) AS record_count,
                           COUNT(DISTINCT t.person_id) AS holder_count
                    FROM talent_taxonomy tx
                    LEFT JOIN talent_titles t
                      ON t.code = tx.code
                     AND EXISTS (SELECT 1 FROM school_people sp WHERE sp.person_id = t.person_id)
                    GROUP BY tx.code, tx.category_name, tx.description
                    ORDER BY tx.code
                    """,
                    (school_id,),
                )
            )
            international_honors = self._rows(
                connection.execute(
                    """
                    WITH school_people AS (
                        SELECT DISTINCT person_id FROM appointments
                        WHERE school_id = ? AND included = 1 AND active_on_snapshot = 1 AND full_time = 1
                    )
                    SELECT h.honor_normalized AS honor, COUNT(*) AS record_count,
                           COUNT(DISTINCT h.person_id) AS holder_count
                    FROM international_honors h
                    JOIN school_people sp ON sp.person_id = h.person_id
                    GROUP BY h.honor_normalized
                    ORDER BY h.honor_normalized
                    """,
                    (school_id,),
                )
            )
            issues = self._rows(
                connection.execute(
                    """
                    SELECT i.issue_id, i.issue_type, i.severity, i.description,
                           i.status, i.resolution, i.unit_id, u.unit_name,
                           i.person_id, p.name_cn AS person_name,
                           i.created_at, i.updated_at
                    FROM issues i
                    LEFT JOIN units u ON u.unit_id = i.unit_id
                    LEFT JOIN persons p ON p.person_id = i.person_id
                    WHERE i.school_id = ?
                    ORDER BY CASE i.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                             i.issue_id
                    """,
                    (school_id,),
                )
            )
        direction_by_unit: dict[str, dict[str, int]] = {}
        for row in unit_directions:
            direction_by_unit.setdefault(row["unit_id"], {})[row["code"]] = row["count"]
        for unit in units:
            unit["direction_counts"] = {
                f"M{i}": direction_by_unit.get(unit["unit_id"], {}).get(f"M{i}", 0) for i in range(9)
            }
            unit["source_archive_url"] = self._archive_url(unit.pop("source_archive_path", None))
        for related in related_units:
            related["source_archive_url"] = self._archive_url(related.pop("source_archive_path", None))
        return {
            "school": school,
            "units": units,
            "departments": units,
            "related_units": related_units,
            "related_unit_notes": related_units,
            "direction_distribution": directions,
            "directions": directions,
            "talent_distribution": talents,
            "talents": talents,
            "issues": issues,
            "report_url": school["report_url"],
            "teacher_report_url": school["teacher_report_url"],
            "export_url": school["export_url"],
        }

    def faculty(self, query: Mapping[str, list[str]]) -> dict[str, Any]:
        q = _query_value(query, "q")
        school_id = _query_value(query, "school_id")
        unit_id = _query_value(query, "unit_id")
        direction = _query_value(query, "direction")
        talent = _query_value(query, "talent")
        page, page_size = _page_values(query)
        if direction and direction not in {f"M{i}" for i in range(9)}:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_parameter", "direction 不是有效方向代码")
        if talent and talent not in {f"T{i}" for i in range(1, 5)}:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_parameter", "talent 不是有效人才层级")

        clauses = ["a.included = 1", "a.active_on_snapshot = 1", "a.full_time = 1"]
        parameters: list[Any] = []
        if q:
            pattern = _like_pattern(q)
            clauses.append(
                "(p.name_cn LIKE ? ESCAPE '\\' OR COALESCE(p.name_en, '') LIKE ? ESCAPE '\\' "
                "OR COALESCE(p.aliases, '') LIKE ? ESCAPE '\\')"
            )
            parameters.extend((pattern, pattern, pattern))
        if school_id:
            clauses.append("a.school_id = ?")
            parameters.append(school_id)
        if unit_id:
            clauses.append("a.unit_id = ?")
            parameters.append(unit_id)
        if direction:
            clauses.append(
                "EXISTS (SELECT 1 FROM research_directions fd "
                "WHERE fd.appointment_id = a.appointment_id AND fd.level1_code = ?)"
            )
            parameters.append(direction)
        if talent:
            clauses.append(
                "EXISTS (SELECT 1 FROM talent_titles ft WHERE ft.person_id = a.person_id AND ft.code = ?)"
            )
            parameters.append(talent)
        where_sql = " AND ".join(clauses)
        offset = (page - 1) * page_size
        with self.connect() as connection:
            total = connection.execute(
                "SELECT COUNT(*) FROM appointments a JOIN persons p ON p.person_id = a.person_id WHERE " + where_sql,
                parameters,
            ).fetchone()[0]
            items = self._rows(
                connection.execute(
                    """
                    SELECT a.appointment_id, a.person_id, p.name_cn, p.name_en, p.aliases,
                           a.school_id, s.school_name, s.evaluation_grade AS grade,
                           a.unit_id, u.unit_name, a.subunit_raw, a.roster_category,
                           a.roster_order, a.title_raw, a.title_normalized,
                           a.position_series, a.administrative_role, a.profile_url,
                           a.verified_on, a.confidence, a.primary_source_id,
                           src.url AS source_url, src.archive_path AS source_archive_path,
                           profile_src.archive_path AS profile_archive_path
                    FROM appointments a
                    JOIN persons p ON p.person_id = a.person_id
                    JOIN schools s ON s.school_id = a.school_id
                    JOIN units u ON u.unit_id = a.unit_id
                    LEFT JOIN sources src ON src.source_id = a.primary_source_id
                    LEFT JOIN (
                        SELECT url, MIN(archive_path) AS archive_path
                        FROM sources
                        WHERE url IS NOT NULL AND trim(url) <> ''
                        GROUP BY url
                    ) profile_src ON profile_src.url = a.profile_url
                    WHERE """
                    + where_sql
                    + " ORDER BY s.official_order, u.unit_name, COALESCE(a.roster_order, 2147483647), p.name_cn "
                    "LIMIT ? OFFSET ?",
                    [*parameters, page_size, offset],
                )
            )
            self._attach_faculty_relations(connection, items)
        payload = _pagination(total, page, page_size, items)
        payload["faculty"] = items
        return payload

    def _attach_faculty_relations(
        self, connection: sqlite3.Connection, items: list[dict[str, Any]]
    ) -> None:
        if not items:
            return
        appointment_ids = list(dict.fromkeys(item["appointment_id"] for item in items))
        person_ids = list(dict.fromkeys(item["person_id"] for item in items))
        appointment_placeholders = ",".join("?" for _ in appointment_ids)
        person_placeholders = ",".join("?" for _ in person_ids)
        directions = self._rows(
            connection.execute(
                f"""
                SELECT rd.direction_id, rd.appointment_id, rd.raw_text,
                       rd.level1_code AS code, tx.category_name,
                       rd.level2_label, rd.display_text, rd.notes, rd.msc_code, rd.is_primary,
                       rd.evidence_type, rd.confidence, rd.primary_source_id,
                       src.url AS source_url, src.archive_path AS source_archive_path
                FROM research_directions rd
                JOIN direction_taxonomy tx ON tx.code = rd.level1_code
                LEFT JOIN sources src ON src.source_id = rd.primary_source_id
                WHERE rd.appointment_id IN ({appointment_placeholders})
                ORDER BY rd.appointment_id, rd.is_primary DESC, rd.direction_id
                """,
                appointment_ids,
            )
        )
        talents = self._rows(
            connection.execute(
                f"""
                SELECT t.talent_id, t.person_id, t.code, tx.category_name,
                       t.title_raw, t.title_normalized, t.subtype, t.selection_year,
                       t.award_status, t.verification_status, t.primary_source_id,
                       src.url AS source_url, src.archive_path AS source_archive_path
                FROM talent_titles t
                JOIN talent_taxonomy tx ON tx.code = t.code
                LEFT JOIN sources src ON src.source_id = t.primary_source_id
                WHERE t.person_id IN ({person_placeholders})
                ORDER BY t.person_id, t.code, t.selection_year
                """,
                person_ids,
            )
        )
        international_honors = self._rows(
            connection.execute(
                f"""
                SELECT h.honor_id, h.person_id, h.code, h.honor_raw, h.honor_normalized,
                       h.honor_type, h.verification_status, h.primary_source_id,
                       src.url AS source_url, src.archive_path AS source_archive_path
                FROM international_honors h
                LEFT JOIN sources src ON src.source_id = h.primary_source_id
                WHERE h.person_id IN ({person_placeholders})
                ORDER BY h.person_id, h.honor_normalized
                """,
                person_ids,
            )
        )
        affiliations = self._rows(
            connection.execute(
                f"""
                SELECT a.person_id, a.school_id, a.unit_id, u.unit_name
                FROM appointments a JOIN units u ON u.unit_id = a.unit_id
                WHERE a.person_id IN ({person_placeholders})
                  AND a.included = 1 AND a.active_on_snapshot = 1 AND a.full_time = 1
                ORDER BY u.unit_name
                """,
                person_ids,
            )
        )
        directions_by_appointment: dict[str, list[dict[str, Any]]] = {}
        talents_by_person: dict[str, list[dict[str, Any]]] = {}
        honors_by_person: dict[str, list[dict[str, Any]]] = {}
        units_by_person_school: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in directions:
            row["is_primary"] = bool(row["is_primary"])
            row["source_archive_url"] = self._archive_url(row.pop("source_archive_path", None))
            directions_by_appointment.setdefault(row["appointment_id"], []).append(row)
        for row in talents:
            row["source_archive_url"] = self._archive_url(row.pop("source_archive_path", None))
            talents_by_person.setdefault(row["person_id"], []).append(row)
        for row in international_honors:
            row["source_archive_url"] = self._archive_url(row.pop("source_archive_path", None))
            honors_by_person.setdefault(row["person_id"], []).append(row)
        for row in affiliations:
            key = (row["person_id"], row["school_id"])
            units_by_person_school.setdefault(key, []).append(
                {"unit_id": row["unit_id"], "unit_name": row["unit_name"]}
            )
        for item in items:
            item["school"] = {
                "school_id": item["school_id"],
                "school_name": item["school_name"],
                "grade": item["grade"],
            }
            item["unit"] = {"unit_id": item["unit_id"], "unit_name": item["unit_name"]}
            item["current_units"] = units_by_person_school.get((item["person_id"], item["school_id"]), [])
            item["units"] = item["current_units"]
            item["appointment_count"] = len(item["current_units"])
            item["directions"] = directions_by_appointment.get(item["appointment_id"], [])
            item["primary_direction"] = next(
                (row for row in item["directions"] if row["is_primary"]), None
            )
            item["talents"] = talents_by_person.get(item["person_id"], [])
            item["direction_codes"] = list(dict.fromkeys(row["code"] for row in item["directions"]))
            item["talent_codes"] = list(dict.fromkeys(row["code"] for row in item["talents"]))
            item["source_archive_url"] = self._archive_url(item.pop("source_archive_path", None))
            item["profile_archive_url"] = self._archive_url(item.pop("profile_archive_path", None))

    def person_detail(self, person_id: str, school_id: str = "") -> dict[str, Any]:
        with self.connect() as connection:
            person_row = connection.execute("SELECT * FROM persons WHERE person_id = ?", (person_id,)).fetchone()
            if person_row is None:
                raise APIError(HTTPStatus.NOT_FOUND, "person_not_found", "人员不存在")
            clauses = [
                "a.person_id = ?",
                "a.included = 1",
                "a.active_on_snapshot = 1",
                "a.full_time = 1",
            ]
            parameters: list[Any] = [person_id]
            if school_id:
                clauses.append("a.school_id = ?")
                parameters.append(school_id)
            appointments = self._rows(
                connection.execute(
                    """
                    SELECT a.appointment_id, a.school_id, s.school_name,
                           s.evaluation_grade AS grade, a.unit_id, u.unit_name,
                           a.subunit_raw, a.roster_category, a.roster_order,
                           a.title_raw, a.title_normalized, a.position_series,
                           a.administrative_role, a.profile_url, a.verified_on,
                           a.confidence, a.primary_source_id,
                           src.url AS source_url, src.archive_path AS source_archive_path,
                           profile_src.archive_path AS profile_archive_path
                    FROM appointments a
                    JOIN schools s ON s.school_id = a.school_id
                    JOIN units u ON u.unit_id = a.unit_id
                    LEFT JOIN sources src ON src.source_id = a.primary_source_id
                    LEFT JOIN (
                        SELECT url, MIN(archive_path) AS archive_path
                        FROM sources
                        WHERE url IS NOT NULL AND trim(url) <> ''
                        GROUP BY url
                    ) profile_src ON profile_src.url = a.profile_url
                    WHERE """
                    + " AND ".join(clauses)
                    + " ORDER BY s.official_order, u.unit_name",
                    parameters,
                )
            )
            for appointment in appointments:
                appointment["source_archive_url"] = self._archive_url(appointment.pop("source_archive_path", None))
                appointment["profile_archive_url"] = self._archive_url(appointment.pop("profile_archive_path", None))
            if not appointments:
                raise APIError(
                    HTTPStatus.NOT_FOUND,
                    "person_school_not_found" if school_id else "person_not_in_scope",
                    "该人员在指定学校没有纳入统计的任职" if school_id else "该人员没有纳入统计的任职",
                )
            appointment_ids = [row["appointment_id"] for row in appointments]
            placeholders = ",".join("?" for _ in appointment_ids)
            directions = self._rows(
                connection.execute(
                    f"""
                    SELECT rd.direction_id, rd.appointment_id, rd.raw_text,
                           rd.level1_code AS code, tx.category_name,
                           rd.level2_label, rd.display_text, rd.notes, rd.msc_code, rd.is_primary,
                           rd.evidence_type, rd.confidence, rd.classification_reason,
                           rd.taxonomy_version, rd.primary_source_id,
                           src.url AS source_url, src.archive_path AS source_archive_path
                    FROM research_directions rd
                    JOIN direction_taxonomy tx ON tx.code = rd.level1_code
                    LEFT JOIN sources src ON src.source_id = rd.primary_source_id
                    WHERE rd.appointment_id IN ({placeholders})
                    ORDER BY rd.appointment_id, rd.is_primary DESC, rd.direction_id
                    """,
                    appointment_ids,
                )
            )
            talents = self._rows(
                connection.execute(
                    """
                    SELECT t.talent_id, t.code, tx.category_name, t.title_raw,
                           t.title_normalized, t.subtype, t.selection_year,
                           t.award_status, t.verification_status, t.primary_source_id,
                           src.url AS source_url, src.archive_path AS source_archive_path
                    FROM talent_titles t
                    JOIN talent_taxonomy tx ON tx.code = t.code
                    LEFT JOIN sources src ON src.source_id = t.primary_source_id
                    WHERE t.person_id = ?
                    ORDER BY t.code, t.selection_year, t.talent_id
                    """,
                    (person_id,),
                )
            )
            international_honors = self._rows(
                connection.execute(
                    """
                    SELECT h.honor_id, h.person_id, h.code, h.honor_raw, h.honor_normalized,
                           h.honor_type, h.verification_status, h.primary_source_id,
                           src.url AS source_url, src.archive_path AS source_archive_path
                    FROM international_honors h
                    LEFT JOIN sources src ON src.source_id = h.primary_source_id
                    WHERE h.person_id = ?
                    ORDER BY h.honor_normalized, h.honor_id
                    """,
                    (person_id,),
                )
            )
            record_ids = [*appointment_ids]
            record_ids.extend(row["direction_id"] for row in directions)
            record_ids.extend(row["talent_id"] for row in talents)
            record_ids.extend(row["honor_id"] for row in international_honors)
            source_links: list[dict[str, Any]] = []
            if record_ids:
                record_placeholders = ",".join("?" for _ in record_ids)
                source_links = self._rows(
                    connection.execute(
                        f"""
                        SELECT sl.record_type, sl.record_id, sl.source_id,
                               sl.support_type, sl.note
                        FROM source_links sl
                        WHERE sl.record_id IN ({record_placeholders})
                        ORDER BY sl.link_id
                        """,
                        record_ids,
                    )
                )
            source_ids = {
                row["primary_source_id"]
                for row in [*appointments, *directions, *talents, *international_honors]
                if row.get("primary_source_id")
            }
            source_ids.update(row["source_id"] for row in source_links)
            sources: list[dict[str, Any]] = []
            if source_ids:
                source_placeholders = ",".join("?" for _ in source_ids)
                sources = self._rows(
                    connection.execute(
                        f"""
                        SELECT source_id, url, page_title, publisher, source_level,
                               source_type, accessed_on, access_state,
                               restricted_reason, archive_path, content_hash
                        FROM sources WHERE source_id IN ({source_placeholders})
                        ORDER BY source_level, source_id
                        """,
                        sorted(source_ids),
                    )
                )
            links_by_source: dict[str, list[dict[str, Any]]] = {}
            for link in source_links:
                links_by_source.setdefault(link["source_id"], []).append(
                    {
                        "record_type": link["record_type"],
                        "record_id": link["record_id"],
                        "support_type": link["support_type"],
                        "note": link["note"],
                    }
                )
            for source in sources:
                source["archive_url"] = self._archive_url(source.pop("archive_path", None))
                source["record_links"] = links_by_source.get(source["source_id"], [])

        directions_by_appointment: dict[str, list[dict[str, Any]]] = {}
        for direction in directions:
            direction["is_primary"] = bool(direction["is_primary"])
            direction["source_archive_url"] = self._archive_url(direction.pop("source_archive_path", None))
            directions_by_appointment.setdefault(direction["appointment_id"], []).append(direction)
        for talent in talents:
            talent["source_archive_url"] = self._archive_url(talent.pop("source_archive_path", None))
        for honor in international_honors:
            honor["source_archive_url"] = self._archive_url(honor.pop("source_archive_path", None))
        for appointment in appointments:
            appointment["directions"] = directions_by_appointment.get(appointment["appointment_id"], [])
            appointment["primary_direction"] = next(
                (row for row in appointment["directions"] if row["is_primary"]), None
            )
        person = dict(person_row)
        units = [
            {
                "school_id": row["school_id"],
                "school_name": row["school_name"],
                "unit_id": row["unit_id"],
                "unit_name": row["unit_name"],
            }
            for row in appointments
        ]
        school_values = list(
            {
                row["school_id"]: {
                    "school_id": row["school_id"],
                    "school_name": row["school_name"],
                    "grade": row["grade"],
                }
                for row in appointments
            }.values()
        )
        return {
            "person": person,
            **person,
            "school": school_values[0] if len(school_values) == 1 else None,
            "schools": school_values,
            "appointments": appointments,
            "units": units,
            "directions": directions,
            "talents": talents,
            "sources": sources,
        }

    def talents(self, query: Mapping[str, list[str]]) -> dict[str, Any]:
        q = _query_value(query, "q")
        school_id = _query_value(query, "school_id")
        tier = _query_value(query, "tier")
        page, page_size = _page_values(query)
        if tier and tier not in {f"T{i}" for i in range(1, 5)}:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_parameter", "tier 不是有效人才层级")
        clauses = [
            "EXISTS (SELECT 1 FROM appointments scope_a WHERE scope_a.person_id = t.person_id "
            "AND scope_a.included = 1 AND scope_a.active_on_snapshot = 1 AND scope_a.full_time = 1)"
        ]
        parameters: list[Any] = []
        if q:
            pattern = _like_pattern(q)
            clauses.append(
                "(p.name_cn LIKE ? ESCAPE '\\' OR COALESCE(p.name_en, '') LIKE ? ESCAPE '\\' "
                "OR t.title_raw LIKE ? ESCAPE '\\' OR t.title_normalized LIKE ? ESCAPE '\\' "
                "OR COALESCE(t.subtype, '') LIKE ? ESCAPE '\\' "
                "OR EXISTS ("
                "SELECT 1 FROM appointments search_a JOIN schools search_s ON search_s.school_id = search_a.school_id "
                "WHERE search_a.person_id = t.person_id AND search_s.school_name LIKE ? ESCAPE '\\'"
                "))"
            )
            parameters.extend((pattern, pattern, pattern, pattern, pattern, pattern))
        if school_id:
            clauses.append(
                "EXISTS (SELECT 1 FROM appointments school_a WHERE school_a.person_id = t.person_id "
                "AND school_a.school_id = ? AND school_a.included = 1)"
            )
            parameters.append(school_id)
        if tier:
            clauses.append("t.code = ?")
            parameters.append(tier)
        where_sql = " AND ".join(clauses)
        offset = (page - 1) * page_size
        with self.connect() as connection:
            total = connection.execute(
                "SELECT COUNT(*) FROM talent_titles t JOIN persons p ON p.person_id = t.person_id WHERE " + where_sql,
                parameters,
            ).fetchone()[0]
            items = self._rows(
                connection.execute(
                    """
                    SELECT t.talent_id, t.person_id, p.name_cn, p.name_en,
                           t.code, tx.category_name, t.title_raw, t.title_normalized,
                           t.subtype, t.selection_year, t.award_status,
                           t.verification_status, t.primary_source_id,
                           src.url AS source_url, src.page_title AS source_title,
                           src.archive_path AS source_archive_path
                    FROM talent_titles t
                    JOIN persons p ON p.person_id = t.person_id
                    JOIN talent_taxonomy tx ON tx.code = t.code
                    LEFT JOIN sources src ON src.source_id = t.primary_source_id
                    WHERE """
                    + where_sql
                    + " ORDER BY t.code, p.name_cn, t.selection_year, t.talent_id LIMIT ? OFFSET ?",
                    [*parameters, page_size, offset],
                )
            )
            if items:
                person_ids = list(dict.fromkeys(row["person_id"] for row in items))
                placeholders = ",".join("?" for _ in person_ids)
                affiliation_parameters: list[Any] = list(person_ids)
                school_clause = ""
                if school_id:
                    school_clause = " AND a.school_id = ?"
                    affiliation_parameters.append(school_id)
                affiliations = self._rows(
                    connection.execute(
                        f"""
                        SELECT DISTINCT a.person_id, a.school_id, s.school_name,
                               s.evaluation_grade AS grade, a.unit_id, u.unit_name
                        FROM appointments a
                        JOIN schools s ON s.school_id = a.school_id
                        JOIN units u ON u.unit_id = a.unit_id
                        WHERE a.person_id IN ({placeholders})
                          AND a.included = 1 AND a.active_on_snapshot = 1 AND a.full_time = 1
                          {school_clause}
                        ORDER BY s.official_order, u.unit_name
                        """,
                        affiliation_parameters,
                    )
                )
            else:
                affiliations = []
        affiliations_by_person: dict[str, list[dict[str, Any]]] = {}
        for row in affiliations:
            affiliations_by_person.setdefault(row["person_id"], []).append(row)
        for item in items:
            item["affiliations"] = affiliations_by_person.get(item["person_id"], [])
            item["schools"] = list(
                {
                    row["school_id"]: {
                        "school_id": row["school_id"],
                        "school_name": row["school_name"],
                        "grade": row["grade"],
                    }
                    for row in item["affiliations"]
                }.values()
            )
            item["school"] = item["schools"][0] if len(item["schools"]) == 1 else None
            item["source_archive_url"] = self._archive_url(item.pop("source_archive_path", None))
        payload = _pagination(total, page, page_size, items)
        payload["talents"] = items
        return payload

    def compare(self, school_ids_value: str) -> dict[str, Any]:
        school_ids = list(dict.fromkeys(part.strip() for part in school_ids_value.split(",") if part.strip()))
        if not school_ids:
            raise APIError(
                HTTPStatus.BAD_REQUEST,
                "missing_parameter",
                "school_ids 至少需要一个学校 ID",
                {"parameter": "school_ids"},
            )
        if len(school_ids) > 4:
            raise APIError(
                HTTPStatus.BAD_REQUEST,
                "too_many_schools",
                "校际对比最多支持 4 所学校",
                {"maximum": 4},
            )
        schools = self._school_metrics(school_ids)
        school_by_id = {row["school_id"]: row for row in schools}
        missing = [school_id for school_id in school_ids if school_id not in school_by_id]
        if missing:
            raise APIError(
                HTTPStatus.NOT_FOUND,
                "school_not_found",
                "部分学校不存在或未纳入统计",
                {"school_ids": missing},
            )
        placeholders = ",".join("?" for _ in school_ids)
        with self.connect() as connection:
            direction_rows = self._rows(
                connection.execute(
                    f"""
                    SELECT a.school_id, rd.level1_code AS code, COUNT(*) AS count
                    FROM research_directions rd
                    JOIN appointments a ON a.appointment_id = rd.appointment_id
                    WHERE rd.is_primary = 1 AND a.school_id IN ({placeholders})
                    GROUP BY a.school_id, rd.level1_code
                    """,
                    school_ids,
                )
            )
            talent_rows = self._rows(
                connection.execute(
                    f"""
                    WITH person_schools AS (
                        SELECT DISTINCT school_id, person_id FROM appointments
                        WHERE school_id IN ({placeholders}) AND included = 1
                    )
                    SELECT ps.school_id, t.code, COUNT(*) AS record_count,
                           COUNT(DISTINCT t.person_id) AS holder_count
                    FROM person_schools ps JOIN talent_titles t ON t.person_id = ps.person_id
                    GROUP BY ps.school_id, t.code
                    """,
                    school_ids,
                )
            )
        directions: dict[str, dict[str, int]] = {school_id: {} for school_id in school_ids}
        talents: dict[str, dict[str, dict[str, int]]] = {school_id: {} for school_id in school_ids}
        for row in direction_rows:
            directions[row["school_id"]][row["code"]] = row["count"]
        for row in talent_rows:
            talents[row["school_id"]][row["code"]] = {
                "record_count": row["record_count"],
                "holder_count": row["holder_count"],
            }
        ordered: list[dict[str, Any]] = []
        for school_id in school_ids:
            school = school_by_id[school_id]
            school["directions"] = {f"M{i}": directions[school_id].get(f"M{i}", 0) for i in range(9)}
            school["talents"] = {
                f"T{i}": talents[school_id].get(f"T{i}", {"record_count": 0, "holder_count": 0})
                for i in range(1, 5)
            }
            ordered.append(school)
        return {
            "school_ids": school_ids,
            "count": len(ordered),
            "maximum": 4,
            "schools": ordered,
            "direction_codes": [f"M{i}" for i in range(9)],
            "talent_tiers": [f"T{i}" for i in range(1, 5)],
        }


class FacultyHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    # SO_REUSEADDR permits duplicate active binds on Windows, which would hide
    # an occupied port instead of advancing to the next one.
    allow_reuse_address = False

    def __init__(self, server_address: tuple[str, int], config: AppConfig) -> None:
        self.config = config
        self.store = DataStore(config)
        super().__init__(server_address, FacultyRequestHandler)

    def set_evidence_root(self, evidence_root: Path | None) -> None:
        self.config = AppConfig(
            self.config.project_root,
            self.config.database,
            self.config.registry,
            self.config.static_root,
            self.config.config_path,
            evidence_root,
        )
        self.store.config = self.config


class FacultyRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MathFacultyLocal/1.0"

    @property
    def app_server(self) -> FacultyHTTPServer:
        return self.server  # type: ignore[return-value]

    def log_message(self, message: str, *args: Any) -> None:
        stream = sys.stderr
        if stream is None:
            return
        try:
            stream.write("[%s] %s\n" % (self.log_date_time_string(), message % args))
        except (AttributeError, OSError):
            pass

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch(head_only=False)

    def do_HEAD(self) -> None:  # noqa: N802
        self._dispatch(head_only=True)

    def do_POST(self) -> None:  # noqa: N802
        try:
            self._dispatch_post()
        except APIError as exc:
            payload: dict[str, Any] = {"error": {"code": exc.code, "message": exc.message}}
            if exc.details is not None:
                payload["error"]["details"] = exc.details
            self._send_json(exc.status, payload, head_only=False, cache_control="no-store")
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            traceback.print_exc()
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": {"code": "internal_error", "message": "服务配置写入失败"}},
                head_only=False,
                cache_control="no-store",
            )

    def do_PUT(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_PATCH(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_DELETE(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_TRACE(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_CONNECT(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def _method_not_allowed(self) -> None:
        self._send_json(
            HTTPStatus.METHOD_NOT_ALLOWED,
            {"error": {"code": "method_not_allowed", "message": "仅允许 GET 和 HEAD 请求"}},
            head_only=self.command == "HEAD",
            cache_control="no-store",
            extra_headers={"Allow": "GET, HEAD"},
        )

    def _dispatch_post(self) -> None:
        split = urlsplit(self.path)
        try:
            path = unquote_to_bytes(split.path).decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_path", "URL 路径不是有效 UTF-8") from exc
        if path != "/api/config/evidence-root":
            self._method_not_allowed()
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_body", "请求体长度无效") from exc
        if content_length < 0 or content_length > 8192:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_body", "请求体过大")
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8")) if content_length else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_json", "请求体不是有效 JSON") from exc
        if not isinstance(payload, dict):
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_json", "请求体必须是 JSON 对象")
        requested = payload.get("evidence_root", "")
        if not isinstance(requested, str):
            raise APIError(HTTPStatus.BAD_REQUEST, "invalid_parameter", "evidence_root 必须是字符串")
        evidence_root = _read_evidence_root(self.app_server.config.project_root, requested)
        config_path = self.app_server.config.config_path
        config = {}
        if config_path.is_file():
            with config_path.open("r", encoding="utf-8-sig") as handle:
                existing = json.load(handle)
            if isinstance(existing, dict):
                config = existing
        config["evidence_root"] = str(evidence_root) if evidence_root else ""
        config["evidence_mode"] = "external-configured" if evidence_root else "official-default"
        config_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = config_path.with_name(config_path.name + ".tmp")
        with temp_path.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(config, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_path, config_path)
        self.app_server.set_evidence_root(evidence_root)
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "evidence_mode": "external-configured" if evidence_root else "official-default",
                "evidence_root": str(evidence_root) if evidence_root else None,
            },
            head_only=False,
            cache_control="no-store",
        )

    def _dispatch(self, head_only: bool) -> None:
        try:
            split = urlsplit(self.path)
            try:
                path = unquote_to_bytes(split.path).decode("utf-8", errors="strict")
            except UnicodeDecodeError as exc:
                raise APIError(HTTPStatus.BAD_REQUEST, "invalid_path", "URL 路径不是有效 UTF-8") from exc
            if "\x00" in path or "\\" in path:
                raise APIError(HTTPStatus.BAD_REQUEST, "invalid_path", "URL 路径包含非法字符")
            try:
                query = parse_qs(split.query, keep_blank_values=True, max_num_fields=50)
            except ValueError as exc:
                raise APIError(HTTPStatus.BAD_REQUEST, "invalid_query", "查询参数无效") from exc
            if path == "/api" or path.startswith("/api/"):
                self._dispatch_api(path.rstrip("/") or "/api", query, head_only)
            else:
                self._serve_static(path, head_only)
        except APIError as exc:
            payload: dict[str, Any] = {"error": {"code": exc.code, "message": exc.message}}
            if exc.details is not None:
                payload["error"]["details"] = exc.details
            self._send_json(exc.status, payload, head_only=head_only, cache_control="no-store")
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            traceback.print_exc()
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": {"code": "internal_error", "message": "服务器处理请求时发生错误"}},
                head_only=head_only,
                cache_control="no-store",
            )

    def _dispatch_api(
        self, path: str, query: Mapping[str, list[str]], head_only: bool
    ) -> None:
        store = self.app_server.store
        cache_control = "private, max-age=60"
        if path == "/api/health":
            payload = store.health()
            cache_control = "no-store"
        elif path == "/api/config":
            payload = {
                "evidence_mode": "external-configured" if self.app_server.config.evidence_root else "official-default",
                "evidence_root": str(self.app_server.config.evidence_root)
                if self.app_server.config.evidence_root
                else None,
                "config_path": str(self.app_server.config.config_path),
            }
            cache_control = "no-store"
        elif path == "/api/summary":
            payload = store.summary()
            cache_control = "private, max-age=300"
        elif path == "/api/options":
            payload = store.options()
            cache_control = "private, max-age=300"
        elif path == "/api/schools":
            payload = store.schools(query)
        elif path == "/api/issues":
            payload = store.issues(query)
        elif path.startswith("/api/schools/") and path.count("/") == 3:
            payload = store.school_detail(path.rsplit("/", 1)[-1])
        elif path == "/api/faculty":
            payload = store.faculty(query)
        elif path.startswith("/api/people/") and path.count("/") == 3:
            payload = store.person_detail(
                path.rsplit("/", 1)[-1], _query_value(query, "school_id")
            )
        elif path == "/api/talents":
            payload = store.talents(query)
        elif path == "/api/compare":
            payload = store.compare(_query_value(query, "school_ids"))
        else:
            raise APIError(HTTPStatus.NOT_FOUND, "endpoint_not_found", "API 路径不存在")
        self._send_json(
            HTTPStatus.OK,
            payload,
            head_only=head_only,
            cache_control=cache_control,
        )

    def _serve_static(self, path: str, head_only: bool) -> None:
        config = self.app_server.config
        mappings = [
            ("/static", config.static_root, True),
            ("/data/exports", config.project_root / "data" / "exports", False),
            ("/data/evidence", config.project_root / "data" / "evidence", False),
            ("/reports", config.project_root / "reports", False),
            ("/evidence", config.project_root / "evidence", False),
        ]
        if config.evidence_root is not None:
            mappings.append(("/local-evidence", config.evidence_root, False))
        root = config.static_root
        relative = path.lstrip("/")
        allow_index = True
        cache_control = "public, max-age=3600"
        for prefix, mapped_root, mapped_index in mappings:
            if path == prefix or path.startswith(prefix + "/"):
                root = mapped_root
                relative = path[len(prefix) :].lstrip("/")
                allow_index = mapped_index
                cache_control = "private, max-age=60"
                break
        if path == "/":
            relative = "index.html"
            cache_control = "no-cache"
        parts = [part for part in relative.split("/") if part]
        if any(part in {".", ".."} or ":" in part for part in parts):
            raise APIError(HTTPStatus.FORBIDDEN, "path_forbidden", "禁止访问该路径")
        root_resolved = root.resolve()
        candidate = root.joinpath(*parts)
        allowed_roots = [root_resolved]
        for depth in range(1, len(parts) + 1):
            link_candidate = root.joinpath(*parts[:depth])
            try:
                if os.path.islink(link_candidate) or (
                    hasattr(link_candidate, "is_junction") and link_candidate.is_junction()
                ):
                    allowed_roots.append(link_candidate.resolve())
            except OSError:
                continue

        def is_allowed(path: Path) -> bool:
            return any(path == allowed or path.is_relative_to(allowed) for allowed in allowed_roots)

        try:
            candidate_resolved = candidate.resolve()
            if not is_allowed(candidate_resolved):
                raise ValueError("resolved path escapes configured root")
        except (OSError, ValueError) as exc:
            raise APIError(HTTPStatus.FORBIDDEN, "path_forbidden", "禁止访问该路径") from exc
        if candidate_resolved.is_dir() and allow_index:
            candidate_resolved = (candidate_resolved / "index.html").resolve()
            if not is_allowed(candidate_resolved):
                exc = ValueError("resolved index path escapes configured root")
                raise APIError(HTTPStatus.FORBIDDEN, "path_forbidden", "禁止访问该路径") from exc
        if not candidate_resolved.is_file():
            raise APIError(HTTPStatus.NOT_FOUND, "file_not_found", "文件不存在")
        self._send_file(candidate_resolved, head_only, cache_control)

    def _send_file(self, path: Path, head_only: bool, cache_control: str) -> None:
        stat = path.stat()
        etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        if self.headers.get("If-None-Match") == etag or self._not_modified_since(stat.st_mtime):
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache_control)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        content_type = _content_type(path)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("Last-Modified", formatdate(stat.st_mtime, usegmt=True))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if head_only:
            return
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def _not_modified_since(self, modified_time: float) -> bool:
        value = self.headers.get("If-Modified-Since")
        if not value or self.headers.get("If-None-Match"):
            return False
        try:
            parsed = parsedate_to_datetime(value)
            return int(modified_time) <= int(parsed.timestamp())
        except (TypeError, ValueError, OverflowError):
            return False

    def _send_json(
        self,
        status: int,
        payload: Mapping[str, Any],
        *,
        head_only: bool,
        cache_control: str,
        extra_headers: Mapping[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.end_headers()
        if not head_only:
            self.wfile.write(body)


def _content_type(path: Path) -> str:
    suffix = path.suffix.casefold()
    explicit = {
        ".html": "text/html; charset=utf-8",
        ".htm": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".svg": "image/svg+xml",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".woff2": "font/woff2",
    }
    if suffix in explicit:
        return explicit[suffix]
    guessed, _ = mimetypes.guess_type(path.name)
    if not guessed:
        return "application/octet-stream"
    if guessed.startswith("text/"):
        return guessed + "; charset=utf-8"
    return guessed


def _server_class(host: str) -> type[FacultyHTTPServer]:
    if ":" not in host:
        return FacultyHTTPServer

    class IPv6FacultyHTTPServer(FacultyHTTPServer):
        address_family = socket.AF_INET6

    return IPv6FacultyHTTPServer


def create_server(
    config: AppConfig,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
) -> FacultyHTTPServer:
    if not 0 <= port <= 65535:
        raise ValueError("端口必须在 0 到 65535 之间")
    server_type = _server_class(host)
    candidates = [0] if port == 0 else range(port, 65536)
    bind_errors = {errno.EADDRINUSE, errno.EACCES, 10013, 10048}
    last_error: OSError | None = None
    for candidate in candidates:
        try:
            return server_type((host, candidate), config)
        except OSError as exc:
            last_error = exc
            if exc.errno not in bind_errors or port == 0:
                raise
    raise OSError(f"从端口 {port} 起没有可用端口") from last_error


def _browser_url(host: str, port: int) -> str:
    display_host = "127.0.0.1" if host in {"", "0.0.0.0", "::"} else host
    if ":" in display_host and not display_host.startswith("["):
        display_host = f"[{display_host}]"
    return f"http://{display_host}:{port}/"


def _open_external_browser(url: str) -> None:
    try:
        webbrowser.open(url, new=2)
    except Exception as exc:
        console_message(f"无法自动打开系统浏览器：{exc}", error=True)


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="数学学科师资统计离线查询 App")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"监听地址（默认 {DEFAULT_HOST}）")
    parser.add_argument("--port", default=DEFAULT_PORT, type=int, help=f"起始端口（默认 {DEFAULT_PORT}）")
    parser.add_argument("--database", help="SQLite 数据库路径；相对路径以项目根目录为基准")
    parser.add_argument("--project-root", help="项目根目录")
    parser.add_argument("--evidence-root", help="外部静态证据包根目录；为空时只使用官网地址")
    parser.add_argument("--no-browser", action="store_true", help="启动时不打开系统默认浏览器")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        config = build_config(args.project_root, args.database, evidence_root=args.evidence_root)
        server = create_server(config, args.host, args.port)
    except (OSError, ValueError, sqlite3.Error) as exc:
        console_message(f"启动失败：{exc}", error=True)
        return 2
    actual_port = int(server.server_address[1])
    url = _browser_url(args.host, actual_port)
    console_message("数学学科师资统计离线查询 App 已启动")
    console_message(f"URL: {url}")
    console_message(f"数据库（只读）: {config.database}")
    console_message(
        "证据模式："
        + (f"外部静态证据包（{config.evidence_root}）" if config.evidence_root else "官网原始地址")
    )
    if actual_port != args.port and args.port != 0:
        console_message(f"端口 {args.port} 已占用，已自动改用 {actual_port}")
    console_message("按 Ctrl+C 停止服务。", flush=True)
    if not args.no_browser:
        timer = threading.Timer(0.25, _open_external_browser, args=(url,))
        timer.daemon = True
        timer.start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        console_message("\n正在停止服务...", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

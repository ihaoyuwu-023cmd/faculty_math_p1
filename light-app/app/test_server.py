#!/usr/bin/env python3
"""Integration tests for the local read-only HTTP server."""

from __future__ import annotations

import hashlib
import http.client
import json
import socket
import sqlite3
import sys
import threading
import unittest
from pathlib import Path
from urllib.parse import quote


APP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = APP_DIR.parent
sys.path.insert(0, str(APP_DIR))

import server  # noqa: E402


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ServerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = server.build_config(project_root=PROJECT_ROOT)
        cls.database_hash_before = sha256(cls.config.database)
        cls.httpd = server.create_server(cls.config, "127.0.0.1", 0)
        cls.port = int(cls.httpd.server_address[1])
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        status, _, payload = cls.request_json("/api/health")
        if status != 200 or payload.get("status") != "ok":
            raise RuntimeError("临时测试服务器未正常启动")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        database_hash_after = sha256(cls.config.database)
        if database_hash_after != cls.database_hash_before:
            raise AssertionError(
                "测试前后数据库 SHA-256 发生变化："
                f"{cls.database_hash_before} -> {database_hash_after}"
            )

    @classmethod
    def request(
        cls, path: str, method: str = "GET", headers: dict[str, str] | None = None
    ) -> tuple[int, http.client.HTTPMessage, bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=15)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            body = response.read()
            return response.status, response.headers, body
        finally:
            connection.close()

    @classmethod
    def request_json(
        cls, path: str, method: str = "GET"
    ) -> tuple[int, http.client.HTTPMessage, dict]:
        status, headers, body = cls.request(path, method=method)
        payload = json.loads(body.decode("utf-8")) if body else {}
        return status, headers, payload

    def test_01_health_head_and_method_restriction(self) -> None:
        status, headers, payload = self.request_json("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["read_only"])
        self.assertEqual(payload["school_count"], 127)
        self.assertEqual(payload["appointment_count"], 11361)
        self.assertEqual(headers.get_content_type(), "application/json")
        self.assertEqual(headers.get_content_charset(), "utf-8")
        self.assertEqual(headers["Cache-Control"], "no-store")

        status, headers, body = self.request("/api/health", method="HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertGreater(int(headers["Content-Length"]), 0)

        status, headers, payload = self.request_json("/api/health", method="POST")
        self.assertEqual(status, 405)
        self.assertEqual(headers["Allow"], "GET, HEAD")
        self.assertEqual(payload["error"]["code"], "method_not_allowed")

    def test_02_summary_key_totals_and_distributions(self) -> None:
        status, _, payload = self.request_json("/api/summary")
        self.assertEqual(status, 200)
        expected = {
            "school_count": 127,
            "strict_complete_school_count": 126,
            "limited_school_count": 1,
            "appointment_count": 11361,
            "unique_person_count": 11253,
            "multi_affiliation_person_count": 108,
            "talent_record_count": 280,
            "talent_holder_count": 228,
        }
        for key, value in expected.items():
            self.assertEqual(payload[key], value, key)
            self.assertEqual(payload["totals"][key], value, key)
        self.assertEqual(set(payload["talent_summary"]), {"T1", "T2", "T3", "T4"})
        self.assertEqual(sum(row["record_count"] for row in payload["talent_tiers"]), 280)
        self.assertEqual(payload["international_honor_record_count"], 10)
        self.assertEqual(payload["international_honor_holder_count"], 5)
        self.assertEqual(set(payload["direction_summary"]), {f"M{i}" for i in range(9)})
        self.assertEqual(sum(row["count"] for row in payload["directions"]), 11361)
        self.assertEqual(sum(row["count"] for row in payload["m_distribution"]), 11361)
        self.assertEqual(sum(row["school_count"] for row in payload["grade_summary"]), 127)
        self.assertEqual(sum(row["appointment_count"] for row in payload["grade_summary"]), 11361)

    def test_03_options_and_school_filters(self) -> None:
        status, _, options = self.request_json("/api/options")
        self.assertEqual(status, 200)
        self.assertEqual(len(options["schools"]), 127)
        self.assertEqual(options["grade_values"], list(server.GRADE_ORDER))
        self.assertEqual({row["code"] for row in options["directions"]}, {f"M{i}" for i in range(9)})
        self.assertEqual({row["code"] for row in options["talent_tiers"]}, {f"T{i}" for i in range(1, 5)})
        self.assertGreaterEqual(len(options["units"]), 127)

        path = "/api/schools?q=" + quote("北京大学") + "&grade=A%2B"
        status, _, schools = self.request_json(path)
        self.assertEqual(status, 200)
        self.assertEqual(schools["total"], 1)
        self.assertEqual(schools["items"][0]["school_id"], "SCH-10001")

        status, _, limited = self.request_json(
            "/api/schools?status=partial_public_roster_limit"
        )
        self.assertEqual(status, 200)
        self.assertEqual(limited["total"], 1)
        self.assertEqual(limited["items"][0]["school_id"], "SCH-10079")

        status, _, sorted_schools = self.request_json("/api/schools?sort=appointments_desc")
        self.assertEqual(status, 200)
        counts = [row["appointment_count"] for row in sorted_schools["items"]]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_04_faculty_filtering_and_pagination(self) -> None:
        status, _, first_page = self.request_json(
            "/api/faculty?school_id=SCH-10001&page=1&page_size=5"
        )
        self.assertEqual(status, 200)
        self.assertEqual(first_page["total"], 144)
        self.assertEqual(len(first_page["items"]), 5)
        self.assertTrue(first_page["has_next"])
        self.assertTrue(all(row["school_id"] == "SCH-10001" for row in first_page["items"]))
        self.assertTrue(all(row["primary_direction"] for row in first_page["items"]))

        status, _, second_page = self.request_json(
            "/api/faculty?school_id=SCH-10001&page=2&page_size=5"
        )
        self.assertEqual(status, 200)
        self.assertNotEqual(
            {row["appointment_id"] for row in first_page["items"]},
            {row["appointment_id"] for row in second_page["items"]},
        )

        status, _, m0 = self.request_json("/api/faculty?direction=M0&page_size=3")
        self.assertEqual(status, 200)
        self.assertEqual(m0["total"], 2010)
        self.assertTrue(all("M0" in row["direction_codes"] for row in m0["items"]))

        status, _, t1 = self.request_json("/api/faculty?talent=T1&page_size=3")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(t1["total"], 20)
        self.assertTrue(all("T1" in row["talent_codes"] for row in t1["items"]))

        status, _, error = self.request_json("/api/faculty?page_size=101")
        self.assertEqual(status, 400)
        self.assertEqual(error["error"]["code"], "invalid_parameter")

    def test_05_school_detail(self) -> None:
        status, _, payload = self.request_json("/api/schools/SCH-10001")
        self.assertEqual(status, 200)
        self.assertEqual(payload["school"]["school_name"], "北京大学")
        self.assertEqual(payload["school"]["appointment_count"], 144)
        self.assertEqual(len(payload["units"]), 2)
        self.assertEqual(sum(row["count"] for row in payload["direction_distribution"]), 144)
        self.assertEqual(sum(row["record_count"] for row in payload["talent_distribution"]), 44)
        self.assertTrue(payload["report_url"].startswith("/reports/"))
        self.assertTrue(payload["teacher_report_url"].startswith("/reports/"))
        status, headers, body = self.request(payload["teacher_report_url"])
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "text/html")
        self.assertIn("教师报告".encode("utf-8"), body)
        self.assertGreaterEqual(len(payload["issues"]), 1)

        status, _, zhongbei = self.request_json("/api/schools/SCH-10110")
        self.assertEqual(status, 200)
        self.assertTrue(zhongbei["teacher_report_url"].endswith(quote("中北大学_教师报告_promoted-final_2026-07-19.html")))
        status, headers, body = self.request(zhongbei["teacher_report_url"])
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "text/html")
        self.assertIn("研究方向由主页信息总结".encode("utf-8"), body)

        status, _, tsinghua = self.request_json("/api/schools/SCH-10003")
        self.assertEqual(status, 200)
        self.assertEqual(tsinghua["school"]["appointment_count"], 164)
        self.assertTrue(any(row["unit_name"] == "清华大学求真书院" for row in tsinghua["related_units"]))
        self.assertGreaterEqual(sum(row["record_count"] for row in tsinghua["international_honors"]), 9)

        status, _, qiu = self.request_json("/api/faculty?school_id=SCH-10003&talent=T6&page_size=100")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(qiu["total"], 4)
        self.assertTrue(any(row["person_id"] == "P-10003-FFA2408BBC4F" for row in qiu["items"]))

        status, _, error = self.request_json("/api/schools/SCH-NOT-FOUND")
        self.assertEqual(status, 404)
        self.assertEqual(error["error"]["code"], "school_not_found")

    def test_06_person_detail_all_school_units_and_sources(self) -> None:
        person_id = "P-10001-01C0B949B68A"
        status, _, payload = self.request_json(
            f"/api/people/{person_id}?school_id=SCH-10001"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["name_cn"], "刘保平")
        self.assertEqual(len(payload["appointments"]), 2)
        self.assertEqual(len(payload["units"]), 2)
        self.assertEqual({row["unit_id"] for row in payload["units"]}, {
            "UNIT-10001-MATH",
            "UNIT-10001-BICMR",
        })
        self.assertGreaterEqual(len(payload["directions"]), 2)
        self.assertGreaterEqual(len(payload["sources"]), 1)

        status, _, error = self.request_json(
            f"/api/people/{person_id}?school_id=SCH-10246"
        )
        self.assertEqual(status, 404)
        self.assertEqual(error["error"]["code"], "person_school_not_found")

    def test_07_talents_filtering_and_pagination(self) -> None:
        status, _, payload = self.request_json("/api/talents?tier=T1&page=1&page_size=7")
        self.assertEqual(status, 200)
        self.assertEqual(payload["total"], 22)
        self.assertEqual(len(payload["items"]), 7)
        self.assertTrue(all(row["code"] == "T1" for row in payload["items"]))
        self.assertTrue(all(row["schools"] for row in payload["items"]))
        self.assertTrue(all(row["source_url"] for row in payload["items"]))

        status, _, school_payload = self.request_json(
            "/api/talents?school_id=SCH-10001&tier=T1&page_size=100"
        )
        self.assertEqual(status, 200)
        self.assertEqual(school_payload["total"], 5)
        self.assertTrue(
            all(row["school"]["school_id"] == "SCH-10001" for row in school_payload["items"])
        )

        status, _, school_search = self.request_json(
            "/api/talents?q=" + quote("北京大学") + "&page_size=100"
        )
        self.assertEqual(status, 200)
        self.assertEqual(school_search["total"], 44)

    def test_08_school_comparison_and_limit(self) -> None:
        ids = "SCH-10001,SCH-10246,SCH-10422"
        status, _, payload = self.request_json("/api/compare?school_ids=" + ids)
        self.assertEqual(status, 200)
        self.assertEqual(payload["school_ids"], ids.split(","))
        self.assertEqual([row["school_id"] for row in payload["schools"]], ids.split(","))
        self.assertTrue(all(set(row["directions"]) == {f"M{i}" for i in range(9)} for row in payload["schools"]))
        self.assertTrue(all(set(row["talents"]) == {f"T{i}" for i in range(1, 5)} for row in payload["schools"]))

        too_many = "SCH-10001,SCH-10246,SCH-10422,SCH-10003,SCH-10027"
        status, _, error = self.request_json("/api/compare?school_ids=" + too_many)
        self.assertEqual(status, 400)
        self.assertEqual(error["error"]["code"], "too_many_schools")

    def test_09_static_files_mime_head_and_path_safety(self) -> None:
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "text/html")
        self.assertIn(b"<!doctype html>", body.lower())

        status, headers, body = self.request("/static/styles.css")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "text/css")
        self.assertGreater(len(body), 1000)

        status, _, body = self.request("/static/app.js")
        self.assertEqual(status, 200)
        self.assertIn(b"function pieChart", body)

        report = quote("全国数学学科师资统计_总览_2026-07-18.html")
        status, headers, body = self.request("/reports/" + report)
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "text/html")
        self.assertGreater(len(body), 1000)

        export = quote("全国学校完成状态_2026-07-18.json")
        status, headers, body = self.request("/data/exports/" + export, method="HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_type(), "application/json")
        self.assertEqual(body, b"")
        self.assertGreater(int(headers["Content-Length"]), 1000)

        for unsafe_path in (
            "/reports/%2e%2e/data/math_faculty.db",
            "/data/exports/%2E%2E/%2E%2E/data/math_faculty.db",
            "/static/%2e%2e/server.py",
            "/static/C%3A/Windows/win.ini",
        ):
            status, _, payload = self.request_json(unsafe_path)
            self.assertEqual(status, 403, unsafe_path)
            self.assertEqual(payload["error"]["code"], "path_forbidden")

        status, _, payload = self.request_json("/data/math_faculty.db")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "file_not_found")

    def test_10_port_fallback_and_database_write_rejection(self) -> None:
        blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        blocker.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        occupied_port = int(blocker.getsockname()[1])
        fallback = None
        try:
            fallback = server.create_server(self.config, "127.0.0.1", occupied_port)
            self.assertGreater(int(fallback.server_address[1]), occupied_port)
        finally:
            if fallback is not None:
                fallback.server_close()
            blocker.close()

        with self.httpd.store.connect() as connection:
            self.assertEqual(connection.execute("PRAGMA query_only").fetchone()[0], 1)
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute("CREATE TABLE forbidden_write(value TEXT)")

    def test_99_database_file_hash_still_matches(self) -> None:
        self.assertEqual(sha256(self.config.database), self.database_hash_before)


if __name__ == "__main__":
    unittest.main(verbosity=2)

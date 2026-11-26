"""
be/tests/test_audit_log_paging.py
GET /api/audit-log pages and filters in the database instead of returning the whole table (audit 2026-11, M-5).
"""
from models_db import AuditLogDB


def _seed(n, action="test.paging", target_type="thing"):
    from db import get_db_context
    with get_db_context() as db:
        for i in range(n):
            db.add(AuditLogDB(timestamp=f"2026-11-26 10:00:{i % 60:02d}", actor_email=f"u{i % 3}@hrflow.test",
                              action=action, target_type=target_type, target_id=str(i), details=f"row {i}"))
        db.commit()


def test_default_page_is_capped_newest_first_with_a_total(app_client, admin_cookies):
    _seed(250)
    res = app_client.get("/api/audit-log", params={"action": "test.paging"}, cookies=admin_cookies)
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 200
    assert int(res.headers["X-Total-Count"]) == 250
    ids = [r["id"] for r in rows]
    assert ids == sorted(ids, reverse=True)
    assert rows[0]["target_id"] == "249"


def test_offset_and_limit_walk_the_pages(app_client, admin_cookies):
    _seed(30)
    first = app_client.get("/api/audit-log", params={"action": "test.paging", "limit": 20}, cookies=admin_cookies).json()
    second = app_client.get("/api/audit-log", params={"action": "test.paging", "limit": 20, "offset": 20},
                            cookies=admin_cookies).json()
    assert len(first) == 20 and len(second) == 10
    assert not {r["id"] for r in first} & {r["id"] for r in second}


def test_filters_by_record_and_actor(app_client, admin_cookies):
    _seed(9)
    one = app_client.get("/api/audit-log", params={"target_type": "thing", "target_id": "4"}, cookies=admin_cookies)
    assert [r["details"] for r in one.json()] == ["row 4"] and one.headers["X-Total-Count"] == "1"
    by_actor = app_client.get("/api/audit-log", params={"action": "test.paging", "actor_email": "U1@hrflow.test"},
                              cookies=admin_cookies).json()
    assert {r["target_id"] for r in by_actor} == {"1", "4", "7"}


def test_limit_is_bounded(app_client, admin_cookies):
    assert app_client.get("/api/audit-log", params={"limit": 5000}, cookies=admin_cookies).status_code == 422
    assert app_client.get("/api/audit-log", params={"limit": 0}, cookies=admin_cookies).status_code == 422

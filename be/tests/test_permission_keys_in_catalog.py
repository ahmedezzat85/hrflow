"""
be/tests/test_permission_keys_in_catalog.py
Every permission key the code checks must exist in core/permission_catalog.py (audit 2026-11, finding M-2).

require_permission / require_any_permission / permission_scope assert this at import time, but plain membership
checks ("finance.x.read" in perms), item.permission fields and actor.can(...) did not: a key missing from the catalog
can never be granted to a role, so such a check silently holds only for super admins.
"""
import os
import re

from core.permission_catalog import all_keys
from test_finance_attention_queue import db_session, seeded_attention_db  # noqa: F401  (fixtures)

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = r"""["']((?:hr|finance|self|system|analytics)\.[a-z_]+(?:\.[a-z_]+)+)["']"""
CHECKS = [
    re.compile(KEY + r"\s+(?:not\s+)?in\s+[\w.]*(?:perm|permissions|perms)\w*"),  # "key" in user_perms
    re.compile(r"\bpermission\s*=\s*" + KEY),                                       # permission="key"
    re.compile(r"\.can\(\s*" + KEY),                                                # actor.can("key")
    re.compile(r"\bhas_permission\(\s*[\w.]*\s*,?\s*" + KEY),
]


def _checked_keys():
    found = {}
    for root, dirs, files in os.walk(BE_DIR):
        dirs[:] = [d for d in dirs if d not in ("tests", "migrations", "scripts", "__pycache__", ".venv")]
        for name in files:
            if not name.endswith(".py"):
                continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8") as f:
                for n, line in enumerate(f, 1):
                    for rx in CHECKS:
                        for m in rx.finditer(line):
                            found.setdefault(m.group(1), []).append(f"{os.path.relpath(path, BE_DIR)}:{n}")
    return found


def test_every_checked_permission_key_is_in_the_catalog():
    catalog = set(all_keys())
    checked = _checked_keys()
    assert checked, "the scan found no permission checks at all; the patterns are out of date"
    missing = {k: v for k, v in checked.items() if k not in catalog}
    assert not missing, f"permission keys checked in code but missing from the catalog: {missing}"


def test_an_account_reader_sees_cheque_transfer_and_statement_items(app_client, seeded_attention_db):
    from db import get_db_context
    from finance.services.attention_service import AttentionQueueService

    with get_db_context() as db:
        queue = AttentionQueueService(db).get_attention_queue(
            current_user={"email": "reader@hrflow.test", "is_super_admin": False},
            user_permissions={"finance.report.read", "finance.account.read"},
        )
    types = {i.type for i in queue.items}
    assert {"bounced_cheque", "unreconciled_statement"} <= types
    for it in queue.items:
        assert it.permission in all_keys()

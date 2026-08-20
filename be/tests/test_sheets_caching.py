"""
tests/test_sheets_caching.py
Unit tests for SheetsClient in-memory TTL caching, cache invalidation,
batch row updates, and quota resilience fallback.
"""
from unittest.mock import MagicMock, patch
import pytest

from config import Config
from sheets_client import SheetsClient, _is_quota_error


@pytest.fixture
def mock_sheets_client():
    """Creates a SheetsClient instance with mocked Google Sheets dependencies."""
    with patch.object(SheetsClient, "_connect"):
        client = SheetsClient()
        client._cache = {}
        client._worksheets = {}
        client._headers = {}
        return client


def test_is_quota_error():
    assert _is_quota_error(Exception("Quota exceeded for quota metric 'Read requests'"))
    assert _is_quota_error(Exception("429 RESOURCE_EXHAUSTED: rate limit exceeded"))
    assert not _is_quota_error(Exception("WorksheetNotFound"))
    assert not _is_quota_error(ValueError("Invalid row id"))


def test_get_all_records_hits_cache(mock_sheets_client):
    mock_ws = MagicMock()
    mock_ws.get_all_records.return_value = [{"id": 1, "name": "Alice"}]
    mock_sheets_client._worksheets["Employees"] = mock_ws

    # 1. First call fetches from Google Sheets
    records1 = mock_sheets_client.get_all_records("Employees")
    assert records1 == [{"id": 1, "name": "Alice"}]
    assert mock_ws.get_all_records.call_count == 1

    # 2. Second call within TTL hits cache (0 network requests)
    records2 = mock_sheets_client.get_all_records("Employees")
    assert records2 == [{"id": 1, "name": "Alice"}]
    assert mock_ws.get_all_records.call_count == 1

    # 3. Caller mutating returned records does not corrupt cache
    records2[0]["name"] = "Hacked"
    records3 = mock_sheets_client.get_all_records("Employees")
    assert records3 == [{"id": 1, "name": "Alice"}]


def test_force_refresh_bypasses_cache(mock_sheets_client):
    mock_ws = MagicMock()
    mock_ws.get_all_records.return_value = [{"id": 1, "name": "Alice"}]
    mock_sheets_client._worksheets["Employees"] = mock_ws

    mock_sheets_client.get_all_records("Employees")
    assert mock_ws.get_all_records.call_count == 1

    # force_refresh=True should make network call
    mock_sheets_client.get_all_records("Employees", force_refresh=True)
    assert mock_ws.get_all_records.call_count == 2


def test_append_row_invalidates_cache(mock_sheets_client):
    mock_ws = MagicMock()
    mock_ws.get_all_records.return_value = [{"id": 1, "name": "Alice"}]
    mock_sheets_client._worksheets["Employees"] = mock_ws
    mock_sheets_client._headers["Employees"] = ["id", "name"]

    mock_sheets_client.get_all_records("Employees")
    assert "Employees" in mock_sheets_client._cache

    mock_sheets_client.append_row("Employees", {"id": 2, "name": "Bob"})
    assert "Employees" not in mock_sheets_client._cache
    mock_ws.append_row.assert_called_once()


def test_update_row_by_match_batches_cells_and_invalidates_cache(mock_sheets_client):
    mock_ws = MagicMock()
    mock_ws.col_values.return_value = ["id", "1", "2"]
    mock_sheets_client._worksheets["Employees"] = mock_ws
    mock_sheets_client._headers["Employees"] = ["id", "name", "role", "salary"]

    mock_sheets_client._cache["Employees"] = {"records": [{"id": 1}], "timestamp": 9999999999}

    res = mock_sheets_client.update_row_by_match("Employees", "id", 1, {"name": "Alice Updated", "salary": 75000})
    assert res is True
    assert "Employees" not in mock_sheets_client._cache
    # update_cells should be called once with 2 Cell objects (batching)
    assert mock_ws.update_cells.call_count == 1
    cells = mock_ws.update_cells.call_args[0][0]
    assert len(cells) == 2


def test_delete_row_by_match_invalidates_cache(mock_sheets_client):
    mock_ws = MagicMock()
    mock_ws.col_values.return_value = ["id", "1", "2"]
    mock_sheets_client._worksheets["Employees"] = mock_ws
    mock_sheets_client._headers["Employees"] = ["id", "name"]

    mock_sheets_client._cache["Employees"] = {"records": [{"id": 1}], "timestamp": 9999999999}

    res = mock_sheets_client.delete_row_by_match("Employees", "id", 1)
    assert res is True
    assert "Employees" not in mock_sheets_client._cache
    mock_ws.delete_rows.assert_called_once_with(2)


def test_quota_fallback_serves_stale_cache_on_error(mock_sheets_client):
    mock_ws = MagicMock()
    # First call succeeds
    mock_ws.get_all_records.return_value = [{"id": 1, "name": "Alice"}]
    mock_sheets_client._worksheets["Employees"] = mock_ws

    records = mock_sheets_client.get_all_records("Employees")
    assert records == [{"id": 1, "name": "Alice"}]

    # Invalidate timestamp so cache is expired
    mock_sheets_client._cache["Employees"]["timestamp"] = 0

    # Next call encounters Google Sheets 429 Quota Exceeded error
    mock_ws.get_all_records.side_effect = Exception("429 RESOURCE_EXHAUSTED: Quota exceeded for read requests")

    # Should gracefully return the stale cache instead of crashing!
    fallback_records = mock_sheets_client.get_all_records("Employees")
    assert fallback_records == [{"id": 1, "name": "Alice"}]

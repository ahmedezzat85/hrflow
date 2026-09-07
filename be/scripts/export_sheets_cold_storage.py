"""
be/scripts/export_sheets_cold_storage.py
Exports a full, timestamped cold-storage backup of all Google Sheets tables
to JSON and CSV artifacts prior to retiring Sheets as the system of record.

Usage:
    python scripts/export_sheets_cold_storage.py [--output-dir PATH] [--dry-run]
"""
import sys
import os
import json
import csv
import argparse
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sheets_client
from config import Config

SHEET_TABS = [
    "Employees",
    "EmployeeBankAccounts",
    "EmployeeNotes",
    "EmployeeDocuments",
    "CompanyDocuments",
    "InsuranceCategories",
    "InsuranceClaims",
    "Requests",
    "VacationHistory",
    "Invoices",
    "AuditLog",
]


def export_cold_storage(
    client=None,
    output_dir: str = None,
    dry_run: bool = False,
) -> dict:
    """
    Dumps all Google Sheets tabs to JSON and CSV in a timestamped folder.
    Returns export statistics and manifest dictionary.
    """
    client = client or sheets_client.get_client()
    now_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    if not output_dir:
        base_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "storage",
            "cold_storage",
        )
        output_dir = os.path.join(base_dir, f"sheets_backup_{now_str}")

    stats = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "spreadsheet_id": Config.SPREADSHEET_ID,
        "output_directory": output_dir,
        "dry_run": dry_run,
        "tabs": {},
        "total_records": 0,
    }

    if not dry_run:
        os.makedirs(output_dir, exist_ok=True)

    for tab in SHEET_TABS:
        try:
            records = client.get_all_records(tab)
        except Exception as e:
            records = []
            stats["tabs"][tab] = {"count": 0, "error": str(e)}
            continue

        count = len(records)
        stats["tabs"][tab] = {"count": count}
        stats["total_records"] += count

        if not dry_run and records:
            # 1. Export JSON
            json_file = os.path.join(output_dir, f"{tab}.json")
            with open(json_file, "w", encoding="utf-8") as f:
                json.dump(records, f, indent=2, default=str)

            # 2. Export CSV
            csv_file = os.path.join(output_dir, f"{tab}.csv")
            fieldnames = list(records[0].keys())
            with open(csv_file, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                for row in records:
                    writer.writerow(row)

    if not dry_run:
        manifest_file = os.path.join(output_dir, "manifest.json")
        with open(manifest_file, "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2)

    return stats


def main():
    parser = argparse.ArgumentParser(description="Export Google Sheets data for cold storage.")
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Destination directory for exported JSON/CSV files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate export and report row counts without writing files to disk",
    )
    args = parser.parse_args()

    mode_label = "[DRY-RUN] " if args.dry_run else ""
    print(f"Starting {mode_label}Google Sheets Cold-Storage Export...")
    results = export_cold_storage(output_dir=args.output_dir, dry_run=args.dry_run)

    print(f"\nCold-storage export finished. Total records: {results['total_records']}")
    if not args.dry_run:
        print(f"Artifacts saved to: {results['output_directory']}")
    print("\nTab Breakdown:")
    for tab, info in results["tabs"].items():
        err = f" (Error: {info['error']})" if "error" in info else ""
        print(f"  - {tab}: {info['count']} records{err}")


if __name__ == "__main__":
    main()

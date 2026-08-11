"""
seed_data.py
Run this ONCE after setting up your Google Sheet + credentials to populate
it with the base reference data HRFlow needs (insurance categories, etc.).

This script intentionally contains NO demo/sample employees, salary
history, or insurance claims. Add real employees through the Admin >
Employees screen once the app is running (this also creates their Users
row so they can sign in with Google Workspace).
"""
from sheets_client import get_client


def seed():
    client = get_client()

    insurance_categories = [
        {"id": 1, "name": "Dental", "annual_limit": 10000},
        {"id": 2, "name": "Optics", "annual_limit": 5000},
        {"id": 3, "name": "Surgery", "annual_limit": 150000},
        {"id": 4, "name": "Outpatient Care", "annual_limit": 20000},
        {"id": 5, "name": "Medicine", "annual_limit": 12000},
        {"id": 6, "name": "Physiotherapy Sessions", "annual_limit": 8000},
    ]
    for c in insurance_categories:
        client.append_row("InsuranceCategories", c)

    print("Insurance categories seeded successfully.")
    print("Add your real employees from the Admin > Employees screen in the app.")


if __name__ == "__main__":
    seed()

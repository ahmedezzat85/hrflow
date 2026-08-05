"""
seed_data.py
Run this ONCE after setting up your Google Sheet + credentials to populate it
with demo data. Since login is Google Sign-In only, there are no passwords -
just make sure the emails below match real Google Workspace accounts you can
actually sign into for testing (or swap them for your own test accounts).

Usage:
    python seed_data.py
"""
from sheets_client import get_client

def seed():
    client = get_client()

    employees = [
        {"id":1,"name":"Ahmed Ezzat","email":"ahmed.ezzat@hrflow.com",
         "role":"employee","dept":"Product","job_role":"Product Engineer","salary":42000,"join_date":"2022-03-14",
         "status":"Active","vac_total":21,"vac_used":7,"next_raise":"2027-03-14"},
        {"id":2,"name":"Laila Hassan","email":"laila.hassan@hrflow.com",
         "role":"employee","dept":"Design","job_role":"UX Designer","salary":31000,"join_date":"2021-07-01",
         "status":"Active","vac_total":21,"vac_used":12,"next_raise":"2026-09-01"},
        {"id":3,"name":"Omar Khaled","email":"omar.khaled@hrflow.com",
         "role":"employee","dept":"Engineering","job_role":"Backend Developer","salary":38000,"join_date":"2020-11-20",
         "status":"On Leave","vac_total":24,"vac_used":18,"next_raise":"2026-08-20"},
        {"id":4,"name":"Ahmed Ezzat","email":"ahmed.ezzat@voyancve.health",
         "role":"admin","dept":"HR","job_role":"HR Administrator","salary":50000,"join_date":"2019-01-15",
         "status":"Active","vac_total":24,"vac_used":3,"next_raise":"2027-01-15"},
    ]
    for e in employees:
        client.append_row("Employees", e)
        client.append_row("Users", {
            "email": e["email"], "role": e["role"], "employee_id": e["id"],
        })

    salary_history = [
        {"id":1,"employee_id":1,"date":"2023-03-14","previous_salary":31000,"new_salary":34500,"pct_change":"+11.3%","reason":"Annual performance raise","applied_by":"admin@hrflow.com"},
        {"id":2,"employee_id":1,"date":"2024-03-14","previous_salary":34500,"new_salary":37800,"pct_change":"+9.6%","reason":"Annual performance raise","applied_by":"admin@hrflow.com"},
        {"id":3,"employee_id":1,"date":"2025-03-14","previous_salary":37800,"new_salary":39900,"pct_change":"+5.6%","reason":"Cost of living adjustment","applied_by":"admin@hrflow.com"},
        {"id":4,"employee_id":1,"date":"2026-03-14","previous_salary":39900,"new_salary":42000,"pct_change":"+5.3%","reason":"Annual performance raise","applied_by":"admin@hrflow.com"},
    ]
    for s in salary_history:
        client.append_row("SalaryHistory", s)

    print("Seed data written successfully. Check your Google Sheet tabs.")
    print("IMPORTANT: replace the demo emails above with real Google Workspace")
    print("addresses in your organization before testing Sign-In With Google.")

if __name__ == "__main__":
    seed()

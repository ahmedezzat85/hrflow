"""
seed_data.py
Run this ONCE after setting up your Google Sheet + credentials to populate it with demo data.
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
        client.append_row("Users", {"email": e["email"], "role": e["role"], "employee_id": e["id"]})

    salary_history = [
        {"id":1,"employee_id":1,"date":"2023-03-14","previous_salary":31000,"new_salary":34500,"pct_change":"+11.3%","reason":"Annual performance raise","applied_by":"admin@hrflow.com"},
        {"id":2,"employee_id":1,"date":"2024-03-14","previous_salary":34500,"new_salary":37800,"pct_change":"+9.6%","reason":"Annual performance raise","applied_by":"admin@hrflow.com"},
        {"id":3,"employee_id":1,"date":"2025-03-14","previous_salary":37800,"new_salary":39900,"pct_change":"+5.6%","reason":"Cost of living adjustment","applied_by":"admin@hrflow.com"},
        {"id":4,"employee_id":1,"date":"2026-03-14","previous_salary":39900,"new_salary":42000,"pct_change":"+5.3%","reason":"Annual performance raise","applied_by":"admin@hrflow.com"},
    ]
    for s in salary_history:
        client.append_row("SalaryHistory", s)

    insurance_categories = [
        {"id":1,"name":"Dental","annual_limit":10000},
        {"id":2,"name":"Optics","annual_limit":5000},
        {"id":3,"name":"Surgery","annual_limit":150000},
        {"id":4,"name":"Outpatient Care","annual_limit":20000},
        {"id":5,"name":"Medicine","annual_limit":12000},
        {"id":6,"name":"Physiotherapy Sessions","annual_limit":8000},
    ]
    for c in insurance_categories:
        client.append_row("InsuranceCategories", c)

    insurance_claims = [
        {"id":1,"employee_id":1,"employee_name":"Ahmed Ezzat","category":"Dental","provider":"Cairo Dental Center","amount":3500,"date":"2026-04-10","status":"Approved","document_url":""},
        {"id":2,"employee_id":1,"employee_name":"Ahmed Ezzat","category":"Optics","provider":"Magrabi Optical","amount":1200,"date":"2026-05-02","status":"Approved","document_url":""},
        {"id":3,"employee_id":2,"employee_name":"Laila Hassan","category":"Physiotherapy Sessions","provider":"CairoPhysio Clinic","amount":6200,"date":"2026-06-18","status":"Approved","document_url":""},
        {"id":4,"employee_id":2,"employee_name":"Laila Hassan","category":"Medicine","provider":"19011 Pharmacy","amount":950,"date":"2026-07-22","status":"Pending","document_url":""},
    ]
    for ic in insurance_claims:
        client.append_row("InsuranceClaims", ic)

    print("Seed data written successfully. Check your Google Sheet tabs.")
    print("IMPORTANT: replace the demo emails above with real Google Workspace")
    print("addresses in your organization before testing Sign-In With Google.")

if __name__ == "__main__":
    seed()

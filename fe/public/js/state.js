let employees = [];
let requests = [];
let allVacationHistory = [];

// An employee is on leave today if their status says so or an approved
// vacation record covers today's date (status is not updated automatically).
function isOnLeaveToday(emp) {
  if (emp.status === 'On Leave') return true;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return allVacationHistory.some(v =>
    String(v.employee_id) === String(emp.id) && v.status === 'Approved' &&
    String(v.start_date).slice(0, 10) <= today && today <= String(v.end_date || v.start_date).slice(0, 10));
}
let insuranceClaims = [];
let empVacationHistory = [];
let empInsuranceHistory = [];
let currentLoggedInEmployee = null;
let allSalaryHistory = [];
let insuranceCategories = [];
let insuranceConsumption = [];
let currentEditCategoryId = null;
let currentEditId = null, currentDeleteId = null, currentPortal = 'admin';
let employeeDocuments = [];
let currentDetailEmployeeId = null;
let docSelectedFile = null;
let bcDocSelectedFile = null;
let dochubSelectedFile = null;
let companyDocuments = [];
window._charts = {};

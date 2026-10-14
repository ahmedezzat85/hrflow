/**
 * parity-map.js — Visual & computed style mapping per slice for restyle-v3 parity testing.
 * Maps elements in restyle-v3 mocks (docs/finance-module/mocks/restyle-v3/<Mock>.html)
 * to live app DOM elements under ?mock=admin or ?mock=employee.
 */

export const DEFAULT_PARITY_PROPS = [
  'fontSize',
  'fontWeight',
  'color',
  'backgroundColor',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderRadius',
  'borderTopWidth',
  'borderColor',
  'height',
  'width',
  'gap',
  'textAlign'
];

const showAdminSection = async (page, sectionId, readySelector = sectionId) => {
  await page.evaluate((id) => {
    if (typeof showSection === 'function') showSection(id, 'admin');
  }, sectionId);
  await page.locator(readySelector).first().waitFor({ state: 'visible' });
};

export const PARITY_MAP = {
  'S1.1': [
    {
      name: 'Raise dialog shell',
      mockFile: 'Dlg-Raise.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'div[role="dialog"]',
      appContainerSelector: '#raiseModal .modal',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof openModal === 'function') openModal('raiseModal');
          else document.getElementById('raiseModal').classList.add('active');
        });
        await page.locator('#raiseModal .modal').waitFor({ state: 'visible' });
      },
      teardown: async (page) => {
        await page.evaluate(() => {
          if (typeof closeModal === 'function') closeModal('raiseModal');
          else document.getElementById('raiseModal').classList.remove('active');
        });
      },
      pairs: [
        { name: 'dialog panel', mockSelector: 'div[role="dialog"]', appSelector: '#raiseModal .modal', props: ['borderRadius', 'backgroundColor', 'width'] },
        { name: 'dialog header', mockSelector: 'div[role="dialog"] > div:first-child', appSelector: '#raiseModal .modal-head', props: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] },
        { name: 'dialog header icon tile', mockSelector: 'div[role="dialog"] > div:first-child > span:first-child', appSelector: '#raiseModal .modal-head-icon', props: ['width', 'height', 'borderRadius'] },
        { name: 'dialog title', mockSelector: '#dTitle', appSelector: '#raiseModal .modal-head h3, #raiseModal #raiseModalTitle, #raiseModal .modal-title', props: ['fontSize', 'fontWeight'] },
        { name: 'dialog footer', mockSelector: 'div[role="dialog"] > div:last-child', appSelector: '#raiseModal .modal-foot', props: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] }
      ]
    },
    {
      name: 'Confirm delete dialog shell',
      mockFile: 'Dlg-Confirm.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'div[role="dialog"], div[role="alertdialog"]',
      appContainerSelector: '#confirmModal .modal',
      keptLabels: ['Remove Marcus Vance?', 'Remove employee?'],
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof openModal === 'function') openModal('confirmModal');
          else document.getElementById('confirmModal').classList.add('active');
        });
        await page.locator('#confirmModal .modal').waitFor({ state: 'visible' });
      },
      teardown: async (page) => {
        await page.evaluate(() => {
          if (typeof closeModal === 'function') closeModal('confirmModal');
          else document.getElementById('confirmModal').classList.remove('active');
        });
      },
      pairs: [
        { name: 'dialog panel', mockSelector: 'div[role="dialog"], div[role="alertdialog"]', appSelector: '#confirmModal .modal', props: ['borderRadius', 'backgroundColor', 'width'] },
        { name: 'dialog header', mockSelector: 'div[role="alertdialog"] > div:first-child, div[role="dialog"] > div:first-child', appSelector: '#confirmModal .modal-head', props: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] },
        { name: 'dialog header icon tile', mockSelector: 'div[role="alertdialog"] > div:first-child > span:first-child, div[role="dialog"] > div:first-child > span:first-child', appSelector: '#confirmModal .modal-head-icon', props: ['width', 'height', 'borderRadius'] },
        { name: 'dialog title', mockSelector: '#dTitle', appSelector: '#confirmModal .modal-head h3, #confirmModal #confirmModalTitle', props: ['fontSize', 'fontWeight'] },
        { name: 'dialog footer', mockSelector: 'div[role="alertdialog"] > div:last-child, div[role="dialog"] > div:last-child', appSelector: '#confirmModal .modal-foot', props: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] }
      ]
    }
  ],

  'S1.2': [
    {
      name: 'Area colors: Raise (green), Confirm (danger), Employee (blue)',
      mockFile: 'Dlg-Raise.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof openModal === 'function') openModal('raiseModal');
          else document.getElementById('raiseModal').classList.add('active');
        });
        await page.locator('#raiseModal .modal').waitFor({ state: 'visible' });
      },
      teardown: async (page) => {
        await page.evaluate(() => {
          if (typeof closeModal === 'function') closeModal('raiseModal');
          else document.getElementById('raiseModal').classList.remove('active');
        });
      },
      pairs: [
        { name: 'raise icon tile green', mockSelector: 'div[role="dialog"] > div:first-child > span:first-child', appSelector: '#raiseModal .modal-head-icon', props: ['backgroundColor', 'color'] }
      ]
    }
  ],

  'S1.3': [
    {
      name: 'Table and card primitives',
      mockFile: 'HR-Employees.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-employees',
      setup: async (page) => showAdminSection(page, 'a-employees', '#a-employees table'),
      pairs: [
        { name: 'table header cells', mockSelector: 'table thead th:first-child', appSelector: '#a-employees table thead th:first-child', props: ['fontSize', 'fontWeight', 'paddingTop', 'paddingBottom'] },
        { name: 'table body first cell', mockSelector: 'table tbody tr:first-child td:first-child', appSelector: '#employeesTableBody tr:first-child td:first-child', props: ['fontSize', 'paddingTop', 'paddingBottom', 'paddingLeft', 'borderColor'] },
        { name: 'employees table shell', mockSelector: 'main > div:last-child', appSelector: '#a-employees .card:has(table)', props: ['backgroundColor', 'borderRadius', 'borderColor'] }
      ]
    }
  ],

  'S1.4': [
    {
      name: 'Shared pills and stat tiles',
      mockFile: 'HR-Salary.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-salary',
      setup: async (page) => showAdminSection(page, 'a-salary', '#a-salary .hv-stat-tile'),
      pairs: [
        { name: 'stat tile', mockSelector: 'main > div:first-child > div:first-child', appSelector: '#a-salary .hv-stat-tile:first-child', props: ['borderRadius', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] },
        { name: 'stat value', mockSelector: 'main > div:first-child > div:first-child div:nth-child(2)', appSelector: '#a-salary .hv-stat-tile:first-child .hv-stat-value', props: ['fontSize', 'fontWeight', 'color'] }
      ]
    }
  ],

  'S2.1': [
    {
      name: 'Rail badge numeric count',
      mockFile: 'Nav-Variants.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'nav[aria-label="Modules"]',
      appContainerSelector: '#admin-module-rail',
      pairs: [
        { name: 'rail badge dot', mockSelector: 'nav[aria-label="Modules"] span[style*="border-radius: 999px"]', appSelector: '#hrRailDot', props: ['height', 'borderRadius'] }
      ]
    }
  ],

  'S2.2': [
    {
      name: 'Collapse control',
      mockFile: 'HR-Dashboard.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'nav[aria-label="HR pages"]',
      appContainerSelector: '#adminNavPanel',
      pairs: [
        { name: 'collapse button', mockSelector: 'button:has-text("Collapse")', appSelector: '#adminSidebarCollapseBtn', props: ['fontSize', 'fontWeight', 'borderRadius', 'height'] }
      ]
    }
  ],

  'S2.3': [
    {
      name: 'Top bar layout and titles',
      mockFile: 'HR-Dashboard.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'header',
      appContainerSelector: '.topbar',
      pairs: [
        { name: 'top bar container', mockSelector: 'header', appSelector: '.topbar', props: ['height', 'paddingLeft', 'paddingRight', 'backgroundColor', 'borderColor'] },
        { name: 'top bar title', mockSelector: 'header span:first-child span:nth-child(2)', appSelector: '#adminPageTitle', props: ['fontSize', 'fontWeight', 'color'] }
      ]
    }
  ],

  'S2.4': [
    {
      name: 'Sidebar nav labels and group titles',
      mockFile: 'HR-Dashboard.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'nav[aria-label="HR pages"]',
      appContainerSelector: '#adminNavPanel',
      keptLabels: ['Benefits & records'],
      pairs: [
        { name: 'sidebar panel', mockSelector: 'nav[aria-label="HR pages"]', appSelector: '#adminNavPanel', props: ['width', 'paddingTop', 'paddingLeft', 'paddingRight', 'backgroundColor', 'borderColor'] },
        { name: 'active dashboard item', mockSelector: 'nav[aria-label="HR pages"] a[aria-current="page"]', appSelector: '#nav-admin-dashboard', props: ['height', 'borderRadius', 'fontSize', 'fontWeight', 'color', 'backgroundColor'] }
      ]
    }
  ],

  'S3.1': [
    {
      name: 'HR dashboard page',
      mockFile: 'HR-Dashboard.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-dashboard',
      setup: async (page) => showAdminSection(page, 'a-dashboard', '#a-dashboard .hero-stats'),
      keptLabels: ['Benefits & records'],
      pairs: [
        { name: 'dashboard hero headcount', mockSelector: 'main a[href="HR-Employees.html"]', appSelector: '#a-dashboard .hero-stats .hero-card:first-child' },
        { name: 'requests chart card', mockSelector: 'main > div:nth-of-type(2) > div:first-child', appSelector: '#a-dashboard .dash-chart-card:first-child' },
        { name: 'waiting requests table', mockSelector: 'table', appSelector: '#a-dashboard .card:has(#dashPendingBody) table', props: ['fontSize', 'backgroundColor', 'borderRadius', 'borderColor'] }
      ]
    }
  ],

  'S3.2': [
    {
      name: 'Employees list',
      mockFile: 'HR-Employees.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-employees',
      setup: async (page) => showAdminSection(page, 'a-employees', '#a-employees table'),
      pairs: [
        { name: 'employees table shell', mockSelector: 'main > div:last-child', appSelector: '#a-employees .card:has(table)' },
        { name: 'employee header', mockSelector: 'table th:first-child', appSelector: '#a-employees table th:first-child' },
        { name: 'first employee cell', mockSelector: 'table tbody tr:first-child td:first-child', appSelector: '#employeesTableBody tr:first-child td:first-child' }
      ]
    }
  ],

  'S3.3': [
    {
      name: 'Employee detail profile',
      mockFile: 'HR-EmployeeDetail.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-employee-detail',
      setup: async (page) => {
        await page.waitForFunction(() => window.Router && typeof viewProfile === 'function' && typeof employees !== 'undefined' && employees.length > 0);
        const empId = await page.evaluate(() => String(employees[0].id));
        await page.evaluate(async (id) => { await viewProfile(id); }, empId);
        await page.locator('#detailProfileHead .esc-head').waitFor({ state: 'visible' });
      },
      pairs: [
        { name: 'profile header card', mockSelector: 'main > section:first-child', appSelector: '#a-employee-detail .emp-summary-card' },
        { name: 'profile identity heading', mockSelector: 'main > section:first-child h1', appSelector: '#detailProfileHead h4' },
        { name: 'compensation card', mockSelector: 'main > div:last-child > div:first-child > section:first-child', appSelector: '#employeeCompensationCard' },
        { name: 'details card', mockSelector: 'main > div:last-child > div:last-child > section:first-child', appSelector: '#a-employee-detail .ed-side-card:first-child' },
        { name: 'bank account card', mockSelector: 'main > div:last-child > div:last-child > section:nth-child(2)', appSelector: '#bankAccountCard' }
      ]
    }
  ],

  'S3.4': [
    {
      name: 'Requests list & tabs',
      mockFile: 'HR-Requests.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-requests',
      setup: async (page) => showAdminSection(page, 'a-requests', '#a-requests table'),
      pairs: [
        { name: 'requests table shell', mockSelector: 'main > div:last-child', appSelector: '#a-requests .card:has(table)' },
        { name: 'requests tabs', mockSelector: 'main > div:first-child', appSelector: '#a-requests .tabs' },
        { name: 'request status pill', mockSelector: 'table tbody tr:first-child td:nth-last-child(2) span', appSelector: '#a-requests tbody tr:first-child td:nth-last-child(2) .status' }
      ]
    }
  ],

  'S3.5': [
    {
      name: 'Salary and raises page',
      mockFile: 'HR-Salary.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-salary',
      setup: async (page) => showAdminSection(page, 'a-salary', '#a-salary table'),
      pairs: [
        { name: 'salary stats grid', mockSelector: 'main > div:first-child', appSelector: '#a-salary .hv-stat-grid' },
        { name: 'salary table shell', mockSelector: 'main > section:first-of-type', appSelector: '#a-salary .card:has(#salaryTableBody)' },
        { name: 'raise history shell', mockSelector: 'main > section:nth-of-type(2)', appSelector: '#a-salary .card:has(#raiseHistoryBody)' }
      ]
    }
  ],

  'S3.6': [
    {
      name: 'Salary payment docs page',
      mockFile: 'HR-SalaryDocs.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-invoices',
      setup: async (page) => {
        await showAdminSection(page, 'a-invoices', '#a-invoices');
        await page.evaluate(async () => {
          if (typeof previewInvoiceEligibility === 'function') await previewInvoiceEligibility();
        });
        await page.locator('#invoiceResultsBody tr').first().waitFor({ state: 'visible' });
      },
      pairs: [
        { name: 'salary docs results table', mockSelector: 'main > section:first-of-type', appSelector: '#a-invoices .card:has(#invoiceResultsBody)' },
        { name: 'filter pill all', mockSelector: 'div[role="group"] button:first-child', appSelector: '#invFilterAllBtn', props: ['height', 'borderRadius', 'fontWeight'] },
        { name: 'generate action button', mockSelector: 'table tbody tr:first-child td:last-child a', appSelector: '#invoiceResultsBody tr:first-child td:last-child .btn', props: ['height', 'borderRadius', 'fontWeight'] }
      ]
    }
  ],

  'S3.7': [
    {
      name: 'Vacations balances and usage',
      mockFile: 'HR-Vacations.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-vacations',
      setup: async (page) => showAdminSection(page, 'a-vacations', '#a-vacations table'),
      pairs: [
        { name: 'vacation stat tile', mockSelector: 'main > div:first-child > div:first-child', appSelector: '#a-vacations .hv-stat-tile:first-child' },
        { name: 'vacations balance shell', mockSelector: 'main > section', appSelector: '#a-vacations .card:has(table)' },
        { name: 'usage progress', mockSelector: 'table tbody tr:first-child td:last-child span span', appSelector: '#a-vacations tbody tr:first-child .vac-usage-fill', props: ['height', 'borderRadius', 'backgroundColor'] }
      ]
    }
  ],

  'S3.8': [
    {
      name: 'Medical insurance page',
      mockFile: 'HR-Insurance.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-insurance',
      setup: async (page) => showAdminSection(page, 'a-insurance', '#a-insurance table'),
      pairs: [
        { name: 'insurance stat tile', mockSelector: 'main > div:first-child > div:first-child', appSelector: '#a-insurance .hv-stat-tile:first-child' },
        { name: 'limits card', mockSelector: 'main > div:nth-of-type(2) > section:first-child', appSelector: '#a-insurance .card:has(#insuranceUsageList)' },
        { name: 'insurance claims shell', mockSelector: 'main > section:last-child', appSelector: '#a-insurance .card:has(table)' }
      ]
    }
  ],

  'S3.9': [
    {
      name: 'Document hub page',
      mockFile: 'HR-Documents.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'main',
      appContainerSelector: '#a-dochub',
      setup: async (page) => {
        await showAdminSection(page, 'a-dochub', '#a-dochub');
        await page.evaluate(() => {
          if (typeof renderCompanyDocumentsAdmin === 'function') renderCompanyDocumentsAdmin();
        });
        await page.locator('#a-dochub table').waitFor({ state: 'visible' });
      },
      pairs: [
        { name: 'document filters', mockSelector: 'main > div:first-child', appSelector: '#a-dochub .filter-bar' },
        { name: 'document hub table shell', mockSelector: 'main > div:last-child', appSelector: '#a-dochub .card:has(table)' },
        { name: 'document first cell', mockSelector: 'table tbody tr:first-child td:first-child', appSelector: '#a-dochub tbody tr:first-child td:first-child' }
      ]
    }
  ]
};

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
      // Issue 1 (owner decision 2026-10-19): the app keeps 13.5px table text and its own border tones,
      // the View button stays removed, and the search box is an input placeholder (not a text label).
      keptLabels: ['Search employees', 'View'],
      setup: async (page) => showAdminSection(page, 'a-employees', '#a-employees table'),
      pairs: [
        { name: 'table header cells', mockSelector: 'table thead th:first-child', appSelector: '#a-employees table thead th:first-child', props: ['fontSize', 'fontWeight', 'paddingTop', 'paddingBottom'] },
        { name: 'table body first cell', mockSelector: 'table tbody tr:first-child td:first-child', appSelector: '#employeesTableBody tr:first-child td:first-child', props: ['fontSize', 'paddingTop', 'paddingBottom', 'paddingLeft', 'borderColor'], accepted: { light: { fontSize: '13.5px', borderColor: 'rgb(22, 36, 94) rgb(22, 36, 94) rgba(32, 86, 232, 0.1)' }, dark: { fontSize: '13.5px', borderColor: 'rgb(233, 238, 255) rgb(233, 238, 255) rgb(38, 57, 111)' } } },
        { name: 'employees table shell', mockSelector: 'main > div:last-child', appSelector: '#a-employees .card:has(table)', props: ['backgroundColor', 'borderRadius', 'borderColor'], accepted: { light: { borderColor: 'rgba(32, 86, 232, 0.12)' } } }
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
      // 'Actions' is the screen-reader-only title of the last column; the search box is an input placeholder.
      keptLabels: ['Search employees', 'Actions'],
      setup: async (page) => showAdminSection(page, 'a-salary', '#a-salary .hv-stat-tile'),
      pairs: [
        { name: 'stat tile', mockSelector: 'main > div:first-child > div:first-child', appSelector: '#a-salary .hv-stat-tile:first-child', props: ['borderRadius', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] },
        { name: 'stat value', mockSelector: 'main > div:first-child > div:first-child span:nth-child(2)', appSelector: '#a-salary .hv-stat-tile:first-child .hv-stat-value', props: ['fontSize', 'fontWeight', 'color'] }
      ]
    }
  ],

  'S2.1': [
    {
      name: 'Rail badge numeric count',
      mockFile: 'Nav-Variants.html',
      appRoute: '/?mock=admin',
      mockContainerSelector: 'nav[aria-label="Modules"]',
      appContainerSelector: '#adminSidebar nav.rail',
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
      // Issue 4 (owner decision 2026-10-19): no visible sidebar search box (Ctrl K opens the palette); the panel also holds the module title
      keptLabels: ['Search Ctrl K', 'HR'],
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
      // Issue 5 (owner decision 2026-10-19): the dashboard top bar stays as is ('General Dashboard', no icon tile or breadcrumb)
      keptLabels: ['General Dashboard'],
      pairs: [
        { name: 'top bar container', mockSelector: 'header', appSelector: '.topbar', props: ['height', 'paddingLeft', 'paddingRight', 'backgroundColor', 'borderColor'], accepted: { light: { borderColor: 'rgb(20, 30, 48) rgb(20, 30, 48) rgba(32, 86, 232, 0.12)' }, dark: { borderColor: /rgb\(38, 57, 111\)$/ } } },
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
      keptLabels: ['Benefits & records', 'Search Ctrl K', 'HR'],
      pairs: [
        { name: 'sidebar panel', mockSelector: 'nav[aria-label="HR pages"]', appSelector: '#adminNavPanel', props: ['width', 'backgroundColor', 'borderColor'], accepted: { light: { borderColor: /rgba\(32, 86, 232, 0\.12\)/ }, dark: { borderColor: /rgb\(38, 57, 111\)/ } } },
        { name: 'sidebar panel padding', mockSelector: 'nav[aria-label="HR pages"]', appSelector: '#adminNavPanel .panel-inner', props: ['paddingTop', 'paddingLeft', 'paddingRight'] },
        { name: 'active dashboard item', mockSelector: 'nav[aria-label="HR pages"] a[aria-current="page"]', appSelector: '#adminNavPanel a.nav-item.active[data-page="a-dashboard"]', props: ['height', 'borderRadius', 'fontSize', 'fontWeight', 'color', 'backgroundColor'] }
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
      // The mock makes each hero card one link; the app keeps a card with an inner link, so the card texts are not collected as labels
      keptLabels: ['Benefits & records', 'Active headcount 4 1 more on leave Employees ›', 'Pending approvals 3 2 leave · 1 claim Review ›', 'Open claims 1 EGP 180 waiting Insurance ›'],
      pairs: [
        { name: 'dashboard hero headcount', mockSelector: 'main a[href="HR-Employees.html"][style*="linear-gradient"]', appSelector: '#a-dashboard .hero-stats .hero-card:first-child' },
        { name: 'requests chart card', mockSelector: 'main > div[style*="2fr 1fr"] > section:first-child', appSelector: '#a-dashboard .grid.g-2-1 > .card:first-child' },
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
      // Same owner decision as issue 1 (S1.3): the View button stays removed, the search box is a placeholder
      keptLabels: ['Search employees', 'View'],
      setup: async (page) => showAdminSection(page, 'a-employees', '#a-employees table'),
      pairs: [
        { name: 'employees table shell', mockSelector: 'main > div:last-child', appSelector: '#a-employees .card:has(table)', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(32, 86, 232, 0.12)', height: '378px' }, dark: { fontSize: '16px', height: '378px' } } },
        { name: 'employee header', mockSelector: 'table th:first-child', appSelector: '#a-employees table th:first-child', accepted: { light: { backgroundColor: 'rgb(255, 255, 255)', borderColor: 'rgb(32, 86, 232) rgb(32, 86, 232) rgba(32, 86, 232, 0.16)', width: '299px' }, dark: { borderColor: /rgb\(38, 57, 111\)$/, width: '299px' } } },
        { name: 'first employee cell', mockSelector: 'table tbody tr:first-child td:first-child', appSelector: '#employeesTableBody tr:first-child td:first-child', accepted: { light: { fontSize: '13.5px', fontWeight: '600', color: 'rgb(22, 36, 94)', borderColor: 'rgb(22, 36, 94) rgb(22, 36, 94) rgba(32, 86, 232, 0.1)', width: '299px', gap: '10px' }, dark: { fontSize: '13.5px', fontWeight: '600', borderColor: /rgb\(38, 57, 111\)$/, width: '299px', gap: '10px' } } }
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
      // Issue 9 (owner decision 2026-10-19): Notes and Medical insurance cards are kept features; 'Payroll runs' link is not in the app
      keptLabels: ['Medical insurance consumption', 'Notes and performance tracking', 'Date', 'Category', 'Note', 'Add Note', 'Payroll runs'],
      setup: async (page) => {
        await page.waitForFunction(() => window.Router && typeof viewProfile === 'function' && typeof employees !== 'undefined' && employees.length > 0);
        const empId = await page.evaluate(() => String(employees[0].id));
        await page.evaluate(async (id) => { await viewProfile(id); }, empId);
        await page.locator('#detailProfileHead .esc-head').waitFor({ state: 'visible' });
      },
      pairs: [
        { name: 'profile header card', mockSelector: 'main > section:first-child', appSelector: '#a-employee-detail .emp-summary-card', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(30, 60, 140, 0.08)', height: '169px' }, dark: { fontSize: '16px', height: '169px' } } },
        { name: 'profile identity heading', mockSelector: 'main > section:first-child h1', appSelector: '#detailProfileHead h4', accepted: { light: { height: '26px' }, dark: { height: '26px' } } },
        { name: 'compensation card', mockSelector: 'main > div:last-child > div:first-child > section:first-child', appSelector: '#employeeCompensationCard', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(30, 60, 140, 0.08)', height: '187px', width: '690px' }, dark: { fontSize: '16px', height: '187px', width: '690px' } } },
        { name: 'details card', mockSelector: 'main > div:last-child > div:last-child > section:first-child', appSelector: '#detailMetaCard', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(30, 60, 140, 0.08)', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', height: '191px', width: '380px' }, dark: { fontSize: '16px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', height: '191px', width: '380px' } } },
        { name: 'bank account card', mockSelector: 'main > div:last-child > div:last-child > section:nth-child(2)', appSelector: '#bankAccountCard', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', height: '137px', width: '380px' }, dark: { fontSize: '16px', borderColor: /^rgba\(214, 116, 43, 0\.4\)$/, height: '137px', width: '380px' } } }
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
      // Issue 10 (owner decision 2026-10-19): the tab counts follow the data; the search box is an input placeholder; Reject is the icon button's text
      keptLabels: ['Work from home 3', 'Work from home 1', 'Search requests', 'Reject'],
      setup: async (page) => showAdminSection(page, 'a-requests', '#a-requests table'),
      pairs: [
        { name: 'requests table shell', mockSelector: 'main > div:last-child', appSelector: '#a-requests .card:has(table)', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(32, 86, 232, 0.12)', height: '551px' }, dark: { fontSize: '16px', height: '551px' } } },
        { name: 'requests tabs', mockSelector: 'main > div:first-child', appSelector: '#a-requests .hv-tabbar', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgb(20, 30, 48) rgb(20, 30, 48) rgba(30, 60, 140, 0.08)' }, dark: { fontSize: '16px', borderColor: /rgb\(38, 57, 111\)$/ } } },
        { name: 'request status pill', mockSelector: 'table tbody tr:first-child td:nth-last-child(2) span', appSelector: '#a-requests tbody tr:first-child td:nth-last-child(2) span', accepted: { light: { color: 'rgb(143, 74, 0)', backgroundColor: 'rgba(224, 125, 16, 0.12)', borderTopWidth: '1px', borderColor: 'rgba(0, 0, 0, 0)', height: '25px', width: '85px' }, dark: { borderTopWidth: '1px', borderColor: 'rgba(0, 0, 0, 0)', height: '25px', width: '85px' } } }
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
      // Issue 11 (owner decision 2026-10-19): the app keeps its logic and wording; the column title 'Actions' is screen-reader only
      keptLabels: ['Search employees', 'Actions'],
      setup: async (page) => showAdminSection(page, 'a-salary', '#a-salary table'),
      pairs: [
        { name: 'salary stats grid', mockSelector: 'main > div:first-child', appSelector: '#a-salary .hv-grid-4', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgb(20, 30, 48)', height: '102px' }, dark: { fontSize: '16px', height: '102px' } } },
        { name: 'salary table shell', mockSelector: 'main > section:first-of-type', appSelector: '#a-salary .card:has(#salaryTableBody)', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(32, 86, 232, 0.12)', height: '392px' }, dark: { fontSize: '16px', height: '392px' } } },
        { name: 'raise history shell', mockSelector: 'main > section:nth-of-type(2)', appSelector: '#a-salary .card:has(#companyRaiseHistoryBody)', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(32, 86, 232, 0.12)', height: '218px' }, dark: { fontSize: '16px', height: '218px' } } }
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
      // Issue 12 (owner decision 2026-10-19): the app keeps its grouped Generated docs table (Name / Doc # / Expand All, Preview); the mock's flat list with Download is not built
      keptLabels: ['Download', 'Action', 'Amount', 'Doc #', 'Document', 'Expand All', 'INV-2026-001', 'Name', 'October 2026', 'Preview'],
      setup: async (page) => {
        await showAdminSection(page, 'a-invoices', '#a-invoices');
        await page.evaluate(async () => {
          if (typeof previewInvoiceEligibility === 'function') await previewInvoiceEligibility();
        });
        await page.locator('#invoiceResultsBody tr').first().waitFor({ state: 'visible' });
      },
      pairs: [
        { name: 'salary docs results table', mockSelector: 'main > section:first-of-type', appSelector: '#a-invoices .card:has(#invoiceResultsBody)', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(32, 86, 232, 0.12)', height: '405px' }, dark: { fontSize: '16px', height: '405px' } } },
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
      // Issue 13 (owner decision 2026-10-19): bare eye icon and bold Remaining applied; the search box is an input placeholder
      keptLabels: ['Search employees'],
      setup: async (page) => showAdminSection(page, 'a-vacations', '#a-vacations table'),
      pairs: [
        { name: 'vacation stat tile', mockSelector: 'main > div:first-child > div:first-child', appSelector: '#a-vacations .hv-stat-tile:first-child', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(30, 60, 140, 0.08)', height: '100px' }, dark: { fontSize: '16px', height: '100px' } } },
        { name: 'vacations balance shell', mockSelector: 'main > section', appSelector: '#a-vacations .card:has(table)', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(32, 86, 232, 0.12)' }, dark: { fontSize: '16px' } } },
        { name: 'usage progress', mockSelector: 'table tbody tr:first-child td:nth-child(5) > span > span > span', appSelector: '#a-vacations tbody tr:first-child td:nth-child(5) > div > div > div', props: ['height', 'borderRadius', 'backgroundColor'], accepted: { light: { backgroundColor: 'rgb(15, 157, 140)' } } }
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
      // Issue 14 (owner decision 2026-10-19): the app keeps the Category / Annual limit header row and its dash in the claim rows
      keptLabels: ['Annual limit'],
      setup: async (page) => showAdminSection(page, 'a-insurance', '#a-insurance table'),
      pairs: [
        { name: 'insurance stat tile', mockSelector: 'main > div:first-child > div:first-child', appSelector: '#a-insurance .hv-stat-tile:first-child', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(30, 60, 140, 0.08)', height: '102px' }, dark: { fontSize: '16px', height: '102px' } } },
        { name: 'limits card', mockSelector: 'main > div:nth-of-type(2) > section:first-child', appSelector: '#a-insurance .card:has(#adminInsuranceCategoryHighlights)', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderRadius: '18px', borderColor: 'rgba(30, 60, 140, 0.08)', height: '238px', gap: 'normal' }, dark: { fontSize: '16px', borderRadius: '18px', height: '238px', gap: 'normal' } } },
        { name: 'insurance claims shell', mockSelector: 'main > section:last-child', appSelector: '#a-insurance .card:has(#insuranceTableBody)', accepted: { light: { fontSize: '16px', color: 'rgb(20, 30, 48)', borderColor: 'rgba(32, 86, 232, 0.12)', height: '251px' }, dark: { fontSize: '16px', height: '251px' } } }
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

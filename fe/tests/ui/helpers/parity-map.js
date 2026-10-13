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
      },
      teardown: async (page) => {
        await page.evaluate(() => {
          if (typeof closeModal === 'function') closeModal('raiseModal');
          else document.getElementById('raiseModal').classList.remove('active');
        });
      },
      pairs: [
        {
          name: 'dialog panel',
          mockSelector: 'div[role="dialog"]',
          appSelector: '#raiseModal .modal',
          props: ['borderRadius', 'backgroundColor', 'width']
        },
        {
          name: 'dialog header',
          mockSelector: 'div[role="dialog"] > div:first-child',
          appSelector: '#raiseModal .modal-head',
          props: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']
        },
        {
          name: 'dialog header icon tile',
          mockSelector: 'div[role="dialog"] > div:first-child > span:first-child',
          appSelector: '#raiseModal .modal-head-icon',
          props: ['width', 'height', 'borderRadius']
        },
        {
          name: 'dialog title',
          mockSelector: '#dTitle',
          appSelector: '#raiseModal .modal-head h3, #raiseModal #raiseModalTitle, #raiseModal .modal-title',
          props: ['fontSize', 'fontWeight']
        },
        {
          name: 'dialog footer',
          mockSelector: 'div[role="dialog"] > div:last-child',
          appSelector: '#raiseModal .modal-foot',
          props: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']
        }
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
      },
      teardown: async (page) => {
        await page.evaluate(() => {
          if (typeof closeModal === 'function') closeModal('confirmModal');
          else document.getElementById('confirmModal').classList.remove('active');
        });
      },
      pairs: [
        {
          name: 'dialog panel',
          mockSelector: 'div[role="dialog"], div[role="alertdialog"]',
          appSelector: '#confirmModal .modal',
          props: ['borderRadius', 'backgroundColor', 'width']
        },
        {
          name: 'dialog header',
          mockSelector: 'div[role="alertdialog"] > div:first-child, div[role="dialog"] > div:first-child',
          appSelector: '#confirmModal .modal-head',
          props: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']
        },
        {
          name: 'dialog header icon tile',
          mockSelector: 'div[role="alertdialog"] > div:first-child > span:first-child, div[role="dialog"] > div:first-child > span:first-child',
          appSelector: '#confirmModal .modal-head-icon',
          props: ['width', 'height', 'borderRadius']
        },
        {
          name: 'dialog title',
          mockSelector: '#dTitle',
          appSelector: '#confirmModal .modal-head h3, #confirmModal #confirmModalTitle',
          props: ['fontSize', 'fontWeight']
        },
        {
          name: 'dialog footer',
          mockSelector: 'div[role="alertdialog"] > div:last-child, div[role="dialog"] > div:last-child',
          appSelector: '#confirmModal .modal-foot',
          props: ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']
        }
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
      },
      teardown: async (page) => {
        await page.evaluate(() => {
          if (typeof closeModal === 'function') closeModal('raiseModal');
          else document.getElementById('raiseModal').classList.remove('active');
        });
      },
      pairs: [
        {
          name: 'raise icon tile green',
          mockSelector: 'div[role="dialog"] > div:first-child > span:first-child',
          appSelector: '#raiseModal .modal-head-icon',
          props: ['backgroundColor', 'color']
        }
      ]
    }
  ],

  'S1.3': [
    {
      name: 'Table and card primitives',
      mockFile: 'HR-Employees.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof showSection === 'function') showSection('a-employees', 'admin');
        });
      },
      pairs: [
        {
          name: 'table header cells',
          mockSelector: 'table thead th:first-child',
          appSelector: '#a-employees table thead th:first-child',
          props: ['fontSize', 'fontWeight', 'paddingTop', 'paddingBottom']
        },
        {
          name: 'table body row height',
          mockSelector: 'table tbody tr:first-child',
          appSelector: '#employeesTableBody tr:first-child',
          props: ['paddingTop', 'paddingBottom']
        }
      ]
    }
  ],

  'S1.4': [
    {
      name: 'Shared pills and stat tiles',
      mockFile: 'HR-Salary.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof showSection === 'function') showSection('a-salary', 'admin');
        });
      },
      pairs: [
        {
          name: 'stat tile',
          mockSelector: 'div[style*="grid-template-columns"] > div:first-child',
          appSelector: '#a-salary .hv-stat-tile:first-child',
          props: ['borderRadius', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']
        }
      ]
    }
  ],

  'S2.1': [
    {
      name: 'Rail badge numeric count',
      mockFile: 'Nav-Variants.html',
      appRoute: '/?mock=admin',
      pairs: [
        {
          name: 'rail badge dot',
          mockSelector: 'nav[aria-label="Modules"] span[style*="border-radius: 999px"]',
          appSelector: '#hrRailDot',
          props: ['height', 'borderRadius']
        }
      ]
    }
  ],

  'S2.2': [
    {
      name: 'Collapse control',
      mockFile: 'HR-Dashboard.html',
      appRoute: '/?mock=admin',
      pairs: [
        {
          name: 'collapse button',
          mockSelector: 'button[style*="Collapse"], button:has-text("Collapse")',
          appSelector: '#adminSidebarCollapseBtn',
          props: ['fontSize', 'fontWeight', 'borderRadius']
        }
      ]
    }
  ],

  'S2.3': [
    {
      name: 'Top bar layout and titles',
      mockFile: 'HR-Dashboard.html',
      appRoute: '/?mock=admin',
      pairs: [
        {
          name: 'top bar container',
          mockSelector: 'header',
          appSelector: '.topbar',
          props: ['height']
        }
      ]
    }
  ],

  'S2.4': [
    {
      name: 'Sidebar nav labels and group titles',
      mockFile: 'HR-Dashboard.html',
      appRoute: '/?mock=admin',
      pairs: [
        {
          name: 'sidebar panel',
          mockSelector: 'nav[aria-label="HR pages"]',
          appSelector: '#adminNavPanel',
          props: ['width']
        }
      ]
    }
  ],

  'S3.1': [
    {
      name: 'HR dashboard page',
      mockFile: 'HR-Dashboard.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof showSection === 'function') showSection('a-dashboard', 'admin');
        });
      },
      keptLabels: ['Benefits & records'],
      pairs: [
        {
          name: 'dashboard hero headcount',
          mockSelector: 'main a[href="HR-Employees.html"]',
          appSelector: '#a-dashboard .hero-stats .hero-card:first-child',
          props: ['borderRadius', 'paddingTop', 'paddingBottom']
        },
        {
          name: 'waiting requests table',
          mockSelector: 'table',
          appSelector: '#a-dashboard .card:has(#dashPendingBody) table',
          props: ['borderRadius']
        }
      ]
    }
  ],

  'S3.2': [
    {
      name: 'Employees list',
      mockFile: 'HR-Employees.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof showSection === 'function') showSection('a-employees', 'admin');
        });
      },
      pairs: [
        {
          name: 'employees table',
          mockSelector: 'table',
          appSelector: '#a-employees table',
          props: ['borderRadius']
        }
      ]
    }
  ],

  'S3.3': [
    {
      name: 'Employee detail profile',
      mockFile: 'HR-EmployeeDetail.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          const empId = (window.employees && window.employees[0]) ? window.employees[0].id : '1';
          if (typeof viewProfile === 'function') viewProfile(empId);
          else if (typeof showSection === 'function') showSection('a-employee-detail', 'admin', [empId]);
        });
      },
      pairs: [
        {
          name: 'profile header card',
          mockSelector: 'main > section:first-child',
          appSelector: '#a-employee-detail .emp-summary-card',
          props: ['borderRadius']
        }
      ]
    }
  ],

  'S3.4': [
    {
      name: 'Requests list & tabs',
      mockFile: 'HR-Requests.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof showSection === 'function') showSection('a-requests', 'admin');
        });
      },
      pairs: [
        {
          name: 'requests table',
          mockSelector: 'table',
          appSelector: '#a-requests table',
          props: ['borderRadius']
        }
      ]
    }
  ],

  'S3.5': [
    {
      name: 'Salary and raises page',
      mockFile: 'HR-Salary.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof showSection === 'function') showSection('a-salary', 'admin');
        });
      },
      pairs: [
        {
          name: 'salary table',
          mockSelector: 'table',
          appSelector: '#a-salary table',
          props: ['borderRadius']
        }
      ]
    }
  ],

  'S3.6': [
    {
      name: 'Salary payment docs page',
      mockFile: 'HR-SalaryDocs.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof showSection === 'function') showSection('a-invoices', 'admin');
        });
      },
      pairs: [
        {
          name: 'salary docs results table',
          mockSelector: 'table',
          appSelector: '#a-invoices table',
          props: ['borderRadius']
        }
      ]
    }
  ],

  'S3.7': [
    {
      name: 'Vacations balances and usage',
      mockFile: 'HR-Vacations.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof showSection === 'function') showSection('a-vacations', 'admin');
        });
      },
      pairs: [
        {
          name: 'vacations balance table',
          mockSelector: 'table',
          appSelector: '#a-vacations table',
          props: ['borderRadius']
        }
      ]
    }
  ],

  'S3.8': [
    {
      name: 'Medical insurance page',
      mockFile: 'HR-Insurance.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          if (typeof showSection === 'function') showSection('a-insurance', 'admin');
        });
      },
      pairs: [
        {
          name: 'insurance claims table',
          mockSelector: 'table',
          appSelector: '#a-insurance table',
          props: ['borderRadius']
        }
      ]
    }
  ],

  'S3.9': [
    {
      name: 'Document hub page',
      mockFile: 'HR-Documents.html',
      appRoute: '/?mock=admin',
      setup: async (page) => {
        await page.evaluate(() => {
          showSection('a-dochub', 'admin');
          if (typeof renderCompanyDocumentsAdmin === 'function') renderCompanyDocumentsAdmin();
        });
      },
      pairs: [
        {
          name: 'document hub table',
          mockSelector: 'table',
          appSelector: '#a-dochub table',
          props: ['borderRadius']
        }
      ]
    }
  ]
};

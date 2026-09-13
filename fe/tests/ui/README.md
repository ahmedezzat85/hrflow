# HRFlow Frontend UI Test Suite

This directory contains automated, maintainable Playwright UI tests for HRFlow, mirroring the structure and reliability of backend pytest suites.

## How to Run Tests Locally

From the `fe/` directory:

```bash
# Run all UI tests headlessly (uses local system Chrome)
npm test

# Run a specific test file
npx playwright test tests/ui/finance.spec.js

# Run tests in interactive UI mode
npm run test:ui

# Run with headed browser window
npx playwright test --headed
```

From repository root:

```bash
npm --prefix fe test
```

## Structure

- `playwright.config.js`: Central configuration (port 8080 dev server integration, headless Chrome channel).
- `sanity.spec.js`: Smoke test verifying application bootstrap and admin navigation under mock mode.
- `finance.spec.js`: Test cases for Finance modules (Overview layout, Sales Invoices toolbar and modal, Vendor Bills tabs & filter dropdown, Bank Accounts modals, dark/light theme toggle).

## Adding New Test Cases

When introducing UI features or fixes:
1. Add new test specs or test cases under `fe/tests/ui/` **before** verification.
2. Rely on persistent, deterministic locators (IDs, data-attributes, semantic role buttons).
3. Do not rewrite test scenarios on every run; reuse and extend this test suite.

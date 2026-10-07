import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
  await page.waitForFunction(() => typeof showSection === 'function' && window.FinanceForm && window.withSubmitLock);
}

test.describe('U5 forms and feedback', () => {
  test('saving an empty Add Employee form shows inline errors and a summary (no toast-only validation)', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => { showSection('a-employees', 'admin'); openEmployeeModal(); });
    await expect(page.locator('#employeeModal')).toBeVisible();
    await page.locator('#employeeModal .btn-fill').first().click();
    await expect(page.locator('#employeeModal .form-error-summary')).toBeVisible();
    await expect(page.locator('#fEmpName')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#fEmpEmail')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#employeeModal .field-error-msg')).toHaveCount(2);
    // errors clear as the user edits the field
    await page.fill('#fEmpName', 'Laila Hassan');
    await expect(page.locator('#fEmpName')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('no native confirm(), prompt() or alert() remains in the frontend scripts', async () => {
    const dir = path.resolve('public/js');
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/(^|[^.\w])(confirm|prompt|alert)\(/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test('a toast shows markup as literal text; errors are alerts with a close button and persist', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => toast('<b>x</b>'));
    const ok = page.locator('#toastWrap .toast').last();
    await expect(ok).toContainText('<b>x</b>');
    await expect(ok.locator('b')).toHaveCount(0);
    await expect(ok).toHaveAttribute('role', 'status');

    await page.evaluate(() => toast('<i>bad</i>', 'fa-solid fa-triangle-exclamation'));
    const err = page.locator('#toastWrap .toast-error').last();
    await expect(err).toHaveAttribute('role', 'alert');
    await expect(err).toContainText('<i>bad</i>');
    await page.waitForTimeout(3600);
    await expect(err).toBeVisible();
    await err.locator('.toast-close').click();
    await expect(err).toHaveCount(0);
  });

  test('empty-state helper escapes its message', async ({ page }) => {
    await openAdmin(page);
    const html = await page.evaluate(() => getEmptyStateHtml('<img src=x onerror=1>'));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('withSubmitLock sends one request when Save is double-clicked', async ({ page }) => {
    await openAdmin(page);
    const calls = await page.evaluate(async () => {
      const btn = document.createElement('button');
      btn.id = 'lockProbe';
      btn.textContent = 'Save';
      document.body.appendChild(btn);
      let n = 0;
      btn.addEventListener('click', () => withSubmitLock(btn, () => new Promise((r) => { n += 1; setTimeout(r, 200); })));
      btn.click(); btn.click();
      await new Promise((r) => setTimeout(r, 400));
      const out = { n, disabledAfter: btn.disabled };
      btn.remove();
      return out;
    });
    expect(calls.n).toBe(1);
    expect(calls.disabledAfter).toBe(false);
    const wrapped = await page.evaluate(() => ['saveBillPayment', 'saveInvoicePayment', 'saveBillApproval', 'saveBillSchedule', 'saveVendorPaymentInstruction', 'submitSaveReportView', 'submitScheduleReport']
      .map((n) => [n, typeof window[n] === 'function' ? window[n].toString().includes('withSubmitLock') : false]));
    for (const [name, ok] of wrapped) expect(ok, name).toBe(true);
  });

  test('document Preview works for a name with quotes and apostrophes', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => { showSection('a-employees', 'admin'); });
    const received = await page.evaluate(() => {
      window.__previewArgs = null;
      window.previewEmployeeDocument = (id, name, type) => { window.__previewArgs = [id, name, type]; };
      renderEmployeeDocuments([{ id: 7, name: `O'Brien "scan".pdf`, file_type: 'pdf', created_at: '2026-01-01', size: 10 }]);
      const btn = document.querySelector('#detailDocumentsBody [data-action="preview-employee-doc"]');
      btn.click();
      return window.__previewArgs;
    });
    expect(received).toEqual([7, `O'Brien "scan".pdf`, 'pdf']);
  });

  test('dropzones are keyboard-operable buttons', async ({ page }) => {
    await openAdmin(page);
    const zones = await page.evaluate(() => [...document.querySelectorAll('.doc-drop-zone')].map((z) => [z.getAttribute('role'), z.getAttribute('tabindex')]));
    expect(zones.length).toBeGreaterThan(0);
    for (const [role, tab] of zones) { expect(role).toBe('button'); expect(tab).toBe('0'); }
  });

  test('every field in the changed HR/System modals has an accessible name', async ({ page }) => {
    await openAdmin(page);
    const missing = await page.evaluate(() => {
      const ids = ['employeeModal', 'raiseModal', 'compensationPlanModal', 'bankAccountModal', 'behalfVacationModal', 'behalfClaimModal', 'categoryModal', 'externalUserModal'];
      const out = [];
      for (const id of ids) {
        const root = document.getElementById(id);
        if (!root) { out.push(`${id}: missing`); continue; }
        root.querySelectorAll('input, select, textarea').forEach((el) => {
          if (['hidden', 'file', 'checkbox', 'radio'].includes(el.type)) return;
          const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
            || (el.id && root.querySelector(`label[for="${el.id}"]`));
          if (!named) out.push(`${id}#${el.id || el.name || el.type}`);
        });
      }
      return out;
    });
    expect(missing).toEqual([]);
  });
});

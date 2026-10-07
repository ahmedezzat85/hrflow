import { test, expect } from '@playwright/test';

// R4 Login page: two columns, new copy, quiet help line, Google button container untouched.

async function openLogin(page, theme, size) {
  await page.setViewportSize(size);
  await page.route('**/api/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-screen')).toBeVisible({ timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

test.describe('R4 login page', () => {
  test('copy: new heading, no retired strings, new title', async ({ page }) => {
    await openLogin(page, 'dark', { width: 1440, height: 900 });
    await expect(page.locator('#login-screen h1')).toHaveText('People, finance and payroll operations in one place.');
    await expect(page.locator('.login-scope-name')).toHaveText(['HR', 'Finance', 'Payroll']);
    await expect(page.locator('.login-form-head h2')).toHaveText('Sign in');
    await expect(page.locator('.login-form-head p')).toHaveText('Use your Voyance Health Google account.');
    const text = await page.locator('#login-screen').innerText();
    for (const gone of ['beautifully simplified', 'Real-time Approvals', 'HR workspace']) expect(text).not.toContain(gone);
    await expect(page.locator('.visual-stats')).toHaveCount(0);
    await expect(page).toHaveTitle('HRFlow | Voyance Health');
  });

  test('Google sign-in container and error slot are unchanged', async ({ page }) => {
    await openLogin(page, 'light', { width: 1440, height: 900 });
    const g = page.locator('#googleSignInButton');
    await expect(g).toHaveAttribute('style', 'display:flex; justify-content:center; margin-top:28px;');
    await expect(page.locator('#loginErr')).toHaveCount(1);
    await expect(page.locator('#loginThemeToggle')).toHaveCount(1);
    // Order in the right column: logo, heading, Google button, notice slot, help line.
    const order = await page.evaluate(() => [...document.querySelector('.login-form-inner').children]
      .map((c) => c.id || c.className));
    expect(order).toEqual(['login-form-head', 'loginErr', 'googleSignInButton', 'loginNotice', 'login-help']);
  });

  for (const theme of ['light', 'dark']) {
    test(`all page text reaches 4.5:1 contrast (${theme})`, async ({ page }) => {
      await openLogin(page, theme, { width: 1440, height: 900 });
      const failures = await page.evaluate(() => {
        const parse = (c) => c.match(/[\d.]+/g).map(Number);
        const lum = ([r, g, b]) => {
          const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const bgOf = (el) => {
          for (let e = el; e; e = e.parentElement) {
            const c = parse(getComputedStyle(e).backgroundColor);
            if (c.length < 4 || c[3] > 0.99) return c.slice(0, 3);
          }
          return [255, 255, 255];
        };
        const bad = [];
        // The notice slot is hidden until a session expires; show it so it is measured too.
        document.getElementById('loginNotice').hidden = false;
        document.querySelectorAll('#login-screen *').forEach((el) => {
          if (el.closest('#googleSignInButton') || el.offsetParent === null) return;
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own) return;
          const fg = parse(getComputedStyle(el).color).slice(0, 3);
          const [l1, l2] = [lum(fg), lum(bgOf(el))].sort((a, b) => b - a);
          const ratio = (l1 + 0.05) / (l2 + 0.05);
          if (ratio < 4.5) bad.push(`${el.className || el.tagName}: ${ratio.toFixed(2)}`);
        });
        return bad;
      });
      expect(failures).toEqual([]);
    });
  }

  test('on a phone the columns stack and the whole page can be reached', async ({ page }) => {
    await openLogin(page, 'light', { width: 390, height: 844 });
    const layout = await page.evaluate(() => {
      const v = document.querySelector('.login-visual').getBoundingClientRect();
      const f = document.querySelector('.login-form-wrap').getBoundingClientRect();
      const s = document.getElementById('login-screen');
      return { stacked: f.top >= v.bottom - 1, scrolls: s.scrollHeight > s.clientHeight, noHScroll: s.scrollWidth <= s.clientWidth };
    });
    expect(layout).toEqual({ stacked: true, scrolls: true, noHScroll: true });
    await page.locator('.login-help').scrollIntoViewIfNeeded();
    await expect(page.locator('.login-help')).toBeInViewport();
  });
});

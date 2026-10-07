import { test, expect } from '@playwright/test';

// Login page (Brand Panel): blue brand panel + form on desktop; on tablet and phone the blue becomes the page and
// the form sits in one card with the white logo top-centre. Google draws its own button; we only choose theme and width.

async function openLogin(page, theme, size) {
  await page.setViewportSize(size);
  await page.route('**/api/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.route('**/accounts.google.com/**', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login-screen')).toBeVisible({ timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

test.describe('login page', () => {
  test('copy: heading, scopes, welcome text, no retired strings, title', async ({ page }) => {
    await openLogin(page, 'dark', { width: 1440, height: 900 });
    await expect(page.locator('#login-screen h1')).toHaveText('People, finance and payroll operations in one place.');
    await expect(page.locator('.login-scope-name')).toHaveText(['HR', 'Finance', 'Payroll']);
    await expect(page.locator('.login-form-head h2')).toHaveText('Welcome back');
    await expect(page.locator('.login-form-head p')).toHaveText('Sign in with your Voyance Health Google account.');
    const text = await page.locator('#login-screen').innerText();
    for (const gone of ['beautifully simplified', 'Real-time Approvals', 'HR workspace', 'Internal platform of Voyance Health']) expect(text).not.toContain(gone);
    await expect(page.locator('.visual-stats')).toHaveCount(0);
    await expect(page).toHaveTitle('HRFlow | Voyance Health');
  });

  test('Google sign-in container, error slot and theme toggle keep their ids and order', async ({ page }) => {
    await openLogin(page, 'light', { width: 1440, height: 900 });
    await expect(page.locator('#googleSignInButton')).toHaveCount(1);
    await expect(page.locator('#loginErr')).toHaveCount(1);
    await expect(page.locator('#loginThemeToggle')).toHaveCount(1);
    // Order in the form column: heading block, error slot, Google button, notice slot, help line.
    const order = await page.evaluate(() => [...document.querySelector('.login-form-inner').children]
      .map((c) => c.id || c.className));
    expect(order).toEqual(['login-form-head', 'loginErr', 'googleSignInButton', 'loginNotice', 'login-help']);
  });

  test('the Voyance logo is white on the brand blue and the heart is the sidebar icon', async ({ page }) => {
    await openLogin(page, 'light', { width: 1440, height: 900 });
    await expect(page.locator('.login-visual .login-logo')).toBeVisible();
    await expect(page.locator('.login-visual .login-logo')).toHaveCSS('filter', /invert/);
    await expect(page.locator('.login-visual .login-brand i')).toHaveClass(/fa-heart-pulse/);
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
        const blend = (fg, bg) => {
          const a = fg.length > 3 ? fg[3] : 1;
          return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
        };
        // The brand panel paints a gradient, so measure against its lightest stop (the worst case for white text).
        const panelLightest = [42, 93, 240];
        const bgOf = (el) => {
          if (el.closest('.login-visual')) return panelLightest;
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
          const bg = bgOf(el);
          const fg = blend(parse(getComputedStyle(el).color), bg);
          const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
          const ratio = (l1 + 0.05) / (l2 + 0.05);
          if (ratio < 4.5) bad.push(`${el.className || el.tagName}: ${ratio.toFixed(2)}`);
        });
        return bad;
      });
      expect(failures).toEqual([]);
    });
  }

  for (const [name, size] of [['tablet', { width: 820, height: 1100 }], ['phone', { width: 390, height: 844 }]]) {
    test(`on a ${name} the brand panel is replaced by a blue page with one card and a top-centre logo`, async ({ page }) => {
      await openLogin(page, 'light', size);
      await expect(page.locator('.login-visual')).toBeHidden();
      await expect(page.locator('.login-mobile-logo')).toBeVisible();
      const layout = await page.evaluate(() => {
        const s = document.getElementById('login-screen');
        const logo = document.querySelector('.login-mobile-logo').getBoundingClientRect();
        const card = document.querySelector('.login-form-inner').getBoundingClientRect();
        const centre = logo.left + logo.width / 2;
        return {
          logoCentred: Math.abs(centre - window.innerWidth / 2) <= 2,
          logoAboveCard: logo.bottom <= card.top,
          cardInside: card.left >= 0 && card.right <= window.innerWidth,
          noHScroll: s.scrollWidth <= s.clientWidth,
        };
      });
      expect(layout).toEqual({ logoCentred: true, logoAboveCard: true, cardInside: true, noHScroll: true });
      await page.locator('.login-help').scrollIntoViewIfNeeded();
      await expect(page.locator('.login-help')).toBeInViewport();
    });
  }

  test('Google button uses the outline theme in both themes and follows the container width', async ({ page }) => {
    // Stand-in for Google Identity Services: record how the button is asked to be drawn.
    await page.addInitScript(() => {
      window.__gis = { init: 0, renders: [] };
      window.google = { accounts: { id: {
        initialize: () => { window.__gis.init += 1; },
        renderButton: (el, opts) => { window.__gis.renders.push(opts); el.innerHTML = '<div id="gis-stub" style="height:40px"></div>'; },
      } } };
    });
    await openLogin(page, 'light', { width: 1440, height: 900 });
    await expect.poll(() => page.evaluate(() => window.__gis.renders.length)).toBeGreaterThan(0);
    const first = await page.evaluate(() => window.__gis.renders.at(-1));
    expect(first).toMatchObject({ theme: 'outline', type: 'standard', size: 'large', shape: 'rectangular', text: 'signin_with', logo_alignment: 'left' });
    expect(first.width).toBeGreaterThanOrEqual(200);
    expect(first.width).toBeLessThanOrEqual(400);

    // The dark card keeps the white outline button: filled_black has no visible edge on it.
    await page.locator('#loginThemeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await page.evaluate(() => window.__gis.renders.at(-1))).theme).toBe('outline');
    expect(await page.evaluate(() => window.__gis.init)).toBe(1);
  });
});

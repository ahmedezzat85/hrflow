import { test, expect } from '@playwright/test';

// Top bar, account menu and theme control (docs/ui-design/topbar-account-menu-implementation-plan.md)
const PORTALS = [
  { key: 'admin', mock: 'admin', app: '#admin-app', title: '#adminPageTitle', p: 'admin' },
];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

async function open(page, portal, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`/?mock=${portal.mock}`);
  await expect(page.locator(portal.title)).toBeVisible({ timeout: 15000 });
}

for (const portal of PORTALS) {
  for (const vp of VIEWPORTS) {
    test.describe(`${portal.key} top bar @ ${vp.name}`, () => {
      test.beforeEach(async ({ page }) => {
        await open(page, portal, vp);
      });

      test('AC-1/2/3: compact height, title only, ellipsis title', async ({ page }) => {
        const topbar = page.locator(`${portal.app} .topbar`);
        const h = (await topbar.boundingBox()).height;
        if (vp.width >= 769) {
          expect(h).toBeGreaterThanOrEqual(54);
          expect(h).toBeLessThanOrEqual(58);
        }
        await expect(topbar.locator('.sub')).toHaveCount(0);
        await expect(topbar.locator('h1')).toHaveCount(1);
        const style = await page.locator(portal.title).evaluate(el => {
          const s = getComputedStyle(el);
          return { fw: s.fontWeight, fs: s.fontSize, to: s.textOverflow, ws: s.whiteSpace };
        });
        expect(style.fw).toBe('600');
        expect(style.fs).toBe(vp.width >= 769 ? '19px' : '17px');
        expect(style.to).toBe('ellipsis');
        expect(style.ws).toBe('nowrap');
      });

      test('AC-4: avatar shows non-bold initials; menu header shows name and role', async ({ page }) => {
        const trigger = page.locator(`#${portal.p}AccountBtn`);
        await expect(trigger).toBeVisible();
        const initials = trigger.locator('.account-avatar__initials');
        await expect(initials).toHaveText(/^[A-Z]{1,2}$/);
        expect(Number(await initials.evaluate(el => getComputedStyle(el).fontWeight))).toBeLessThan(600);
        await trigger.click();
        const panel = page.locator(`#${portal.p}AccountPanel`);
        await expect(panel).toBeVisible();
        await expect(panel.locator(`#${portal.p}UserName`)).not.toHaveText('--');
        await expect(panel.locator(`#${portal.p}UserRole`)).not.toHaveText('--');
        await expect(panel.locator('.account-avatar--lg')).toBeVisible();
      });

      test('AC-5: opens by click; Escape and outside click close; aria-expanded in sync', async ({ page }) => {
        const trigger = page.locator(`#${portal.p}AccountBtn`);
        const panel = page.locator(`#${portal.p}AccountPanel`);
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(panel).toBeHidden();
        await trigger.click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(panel).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(trigger).toBeFocused();

        await trigger.click();
        await expect(panel).toBeVisible();
        await page.locator(portal.title).click();
        await expect(panel).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        // Keyboard operable
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(panel).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(panel.locator('[data-theme-choice="light"]')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
      });

      test('AC-6: Light/Dark control switches theme, reflects aria-pressed, persists', async ({ page }) => {
        const trigger = page.locator(`#${portal.p}AccountBtn`);
        const panel = page.locator(`#${portal.p}AccountPanel`);
        await expect(page.locator(`${portal.app} .topbar #${portal.p}ThemeToggle`)).toHaveCount(0);
        await trigger.click();
        await panel.locator('[data-theme-choice="dark"]').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await expect(panel.locator('[data-theme-choice="dark"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(panel.locator('[data-theme-choice="light"]')).toHaveAttribute('aria-pressed', 'false');
        expect(await page.evaluate(() => localStorage.getItem('hrflow-theme'))).toBe('dark');

        await page.reload();
        await expect(page.locator(portal.title)).toBeVisible({ timeout: 15000 });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.locator(`#${portal.p}AccountBtn`).click();
        await expect(page.locator(`#${portal.p}AccountPanel [data-theme-choice="dark"]`)).toHaveAttribute('aria-pressed', 'true');
        await page.locator(`#${portal.p}AccountPanel [data-theme-choice="light"]`).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      });

      test('AC-9: no horizontal overflow; touch targets >= 44px on phone', async ({ page }) => {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflow).toBe(false);
        if (vp.width <= 768) {
          for (const sel of [`#${portal.p}AccountBtn`, `${portal.app} .topbar .hamburger`]) {
            const box = await page.locator(sel).boundingBox();
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
        }
      });

      test('AC-10: Sign out returns to the login screen without console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.locator(`#${portal.p}AccountBtn`).click();
        await page.locator(`#${portal.p}SignOutBtn`).click();
        await expect(page.locator('#login-screen')).toBeVisible();
        await expect(page.locator(`#${portal.p}AccountPanel`)).toBeHidden();
        await expect(page.locator('#loginThemeToggle')).toBeVisible();
        expect(errors).toEqual([]);
      });
    });
  }
}

test.describe('admin account menu: phone-only Export item', () => {
  test('Export data lives in the menu at 390px and in the bar at 1440px', async ({ page }) => {
    await open(page, PORTALS[0], VIEWPORTS[1]);
    await expect(page.locator('#adminExportBtn')).toBeHidden();
    await page.locator('#adminAccountBtn').click();
    await expect(page.locator('#adminAccountExportBtn')).toBeVisible();
    await page.locator('#adminAccountExportBtn').click();
    await expect(page.locator('#adminAccountPanel')).toBeHidden();

    await open(page, PORTALS[0], VIEWPORTS[0]);
    await expect(page.locator('#adminExportBtn')).toBeVisible();
    await page.locator('#adminAccountBtn').click();
    await expect(page.locator('#adminAccountExportBtn')).toBeHidden();
  });
});

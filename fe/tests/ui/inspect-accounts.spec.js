import { test, expect } from '@playwright/test';

test.describe('Inspect Bank Accounts UI Overflow', () => {
  for (const width of [1440, 1280, 1024, 768, 390]) {
    test(`Inspect overflow at width ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
      if (width < 900) {
        await page.click('#admin-app .hamburger');
      }
      await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
      await page.waitForTimeout(600);

      const report = await page.evaluate(() => {
        const pageEl = document.getElementById('a-finance-accounts');
        const list = [];
        function scan(el) {
          if (!el || el.offsetParent === null) return;
          if (el.scrollWidth > el.clientWidth + 1) {
            list.push({
              tag: el.tagName,
              id: el.id,
              class: el.className,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              diff: el.scrollWidth - el.clientWidth,
            });
          }
          for (const child of el.children) scan(child);
        }
        scan(pageEl);
        return {
          windowInnerWidth: window.innerWidth,
          bodyScrollWidth: document.body.scrollWidth,
          hasBodyOverflow: document.body.scrollWidth > window.innerWidth,
          elements: list,
        };
      });

      console.log(`\n=== WIDTH ${width} ===`);
      console.log(`Body overflow: ${report.hasBodyOverflow} (scrollWidth: ${report.bodyScrollWidth}, innerWidth: ${report.windowInnerWidth})`);
      console.log(`Overflowing elements (${report.elements.length}):`);
      for (const el of report.elements) {
        console.log(` - <${el.tag} id="${el.id}" class="${el.class}"> scrollWidth=${el.scrollWidth} > clientWidth=${el.clientWidth} (+${el.diff}px)`);
      }
    });
  }
});

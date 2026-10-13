import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { PARITY_MAP, DEFAULT_PARITY_PROPS } from './helpers/parity-map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOCKS_DIR = path.resolve(__dirname, '../../../docs/finance-module/mocks/restyle-v3');

/**
 * Normalizes CSS color values (e.g., rgb to hex or comparing rgba strings)
 */
function normalizeColor(val) {
  if (!val) return '';
  return val.replace(/\s+/g, '').toLowerCase();
}

/**
 * Normalizes dimension strings (e.g. "36px" vs 36)
 */
function normalizeDimension(val) {
  if (!val) return '';
  const num = parseFloat(val);
  return isNaN(num) ? val : `${Math.round(num)}px`;
}

/**
 * Stitches mock and app screenshots side-by-side into a single PNG in os.tmpdir()
 */
async function saveSideBySideScreenshot(page, mockBuffer, appBuffer, filename) {
  const mockBase64 = mockBuffer.toString('base64');
  const appBase64 = appBuffer.toString('base64');

  const stitchedBase64 = await page.evaluate(
    async ({ mockB64, appB64 }) => {
      const loadImg = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = 'data:image/png;base64,' + b64;
        });

      const [imgMock, imgApp] = await Promise.all([loadImg(mockB64), loadImg(appB64)]);
      const canvas = document.createElement('canvas');
      canvas.width = imgMock.width + imgApp.width;
      canvas.height = Math.max(imgMock.height, imgApp.height);
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgMock, 0, 0);
      ctx.drawImage(imgApp, imgMock.width, 0);

      // Dividing guideline
      ctx.strokeStyle = '#2056e8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(imgMock.width, 0);
      ctx.lineTo(imgMock.width, canvas.height);
      ctx.stroke();

      return canvas.toDataURL('image/png').split(',')[1];
    },
    { mockB64: mockBase64, appB64: appBase64 }
  );

  const outPath = path.join(os.tmpdir(), filename);
  await fs.promises.writeFile(outPath, Buffer.from(stitchedBase64, 'base64'));
  console.log(`[PARITY SCREENSHOT] Side-by-side image saved to: ${outPath}`);
  return outPath;
}

for (const [sliceId, screenConfigs] of Object.entries(PARITY_MAP)) {
  test.describe(`Design parity loop: ${sliceId}`, () => {
    for (const config of screenConfigs) {
      for (const theme of ['light', 'dark']) {
        test(`${sliceId} - ${config.name} in ${theme} theme`, async ({ browser }) => {
          const viewport = { width: 1440, height: 900 };
          const mockContext = await browser.newContext({ viewport });
          const appContext = await browser.newContext({ viewport });

          const mockPage = await mockContext.newPage();
          const appPage = await appContext.newPage();

          // Load Mock HTML via file URL
          const mockPath = path.join(MOCKS_DIR, config.mockFile);
          expect(fs.existsSync(mockPath)).toBeTruthy();
          await mockPage.goto(pathToFileURL(mockPath).href, { waitUntil: 'load' });

          // Load App
          await appPage.goto(config.appRoute, { waitUntil: 'domcontentloaded' });
          await expect(appPage.locator('#adminSidebar, #empSidebar').first()).toBeAttached({ timeout: 15000 });
          await appPage.evaluate((th) => {
            if (typeof applyTheme === 'function') applyTheme(th);
            else document.documentElement.setAttribute('data-theme', th);
          }, theme);

          if (config.setup) {
            await config.setup(appPage);
          }

          // Evaluate computed styles for each mapped pair
          const failures = [];
          for (const pair of config.pairs) {
            const propsToCompare = pair.props || DEFAULT_PARITY_PROPS;

            const mockExists = (await mockPage.locator(pair.mockSelector).count()) > 0;
            const appExists = (await appPage.locator(pair.appSelector).count()) > 0;

            if (!mockExists || !appExists) {
              failures.push({
                element: pair.name,
                prop: 'existence',
                mockValue: mockExists ? 'present' : 'missing',
                appValue: appExists ? 'present' : 'missing'
              });
              continue;
            }

            const mockStyles = await mockPage.locator(pair.mockSelector).first().evaluate((el, props) => {
              const cs = window.getComputedStyle(el);
              const out = {};
              props.forEach((p) => {
                out[p] = cs[p] || cs.getPropertyValue(p);
              });
              return out;
            }, propsToCompare);

            const appStyles = await appPage.locator(pair.appSelector).first().evaluate((el, props) => {
              const cs = window.getComputedStyle(el);
              const out = {};
              props.forEach((p) => {
                out[p] = cs[p] || cs.getPropertyValue(p);
              });
              return out;
            }, propsToCompare);

            for (const prop of propsToCompare) {
              const mockVal = mockStyles[prop] || '';
              const appVal = appStyles[prop] || '';

              if (theme === 'dark' && (prop === 'color' || prop === 'backgroundColor' || prop === 'borderColor')) {
                // In dark mode, verify it uses navy/theme tokens and does not leak forbidden near-black values
                const forbidden = ['rgb(15, 17, 23)', 'rgb(23, 26, 36)', 'rgb(29, 33, 48)', 'rgb(42, 46, 61)', 'rgb(35, 39, 58)'];
                if (forbidden.includes(appVal)) {
                  failures.push({
                    element: pair.name,
                    prop,
                    mockValue: 'navy-token-dark',
                    appValue: `${appVal} (FORBIDDEN near-black)`
                  });
                }
                continue;
              }

              // Normalizing comparison for light mode
              const isDimension = prop.includes('width') || prop.includes('height') || prop.includes('padding') || prop.includes('gap') || prop.includes('radius') || prop.includes('size');
              const isColor = prop === 'color' || prop === 'backgroundColor' || prop === 'borderColor';

              let match = false;
              if (isDimension) {
                match = normalizeDimension(mockVal) === normalizeDimension(appVal);
              } else if (isColor) {
                match = normalizeColor(mockVal) === normalizeColor(appVal);
              } else {
                match = String(mockVal).trim() === String(appVal).trim();
              }

              if (!match) {
                failures.push({
                  element: pair.name,
                  prop,
                  mockValue: mockVal,
                  appValue: appVal
                });
              }
            }
          }

          // Text inventory check on mapped regions
          if (config.mockContainerSelector && config.appContainerSelector) {
            const hasMockContainer = (await mockPage.locator(config.mockContainerSelector).count()) > 0;
            const hasAppContainer = (await appPage.locator(config.appContainerSelector).count()) > 0;
            if (hasMockContainer && hasAppContainer) {
              const cleanText = (node) => {
                const clone = node.cloneNode(true);
                clone.querySelectorAll('select, input, textarea, svg, script, style').forEach((c) => c.remove());
                return clone.textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
              };

              const mockTexts = await mockPage.locator(config.mockContainerSelector).first().evaluate((el) => {
                const clean = (node) => {
                  const clone = node.cloneNode(true);
                  clone.querySelectorAll('select, input, textarea, svg, script, style').forEach((c) => c.remove());
                  return clone.textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
                };
                return Array.from(el.querySelectorAll('h1, h2, h3, h4, th, label, button, .modal-title, .modal-subtitle'))
                  .map(clean)
                  .filter(Boolean);
              });

              const appTexts = await appPage.locator(config.appContainerSelector).first().evaluate((el) => {
                const clean = (node) => {
                  const clone = node.cloneNode(true);
                  clone.querySelectorAll('select, input, textarea, svg, script, style').forEach((c) => c.remove());
                  return clone.textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
                };
                return Array.from(el.querySelectorAll('h1, h2, h3, h4, th, label, button, .modal-title, .modal-subtitle'))
                  .map(clean)
                  .filter(Boolean);
              });

              const kept = config.keptLabels || [];
              // Filter out numbers/dates/currency and known mock person names
              const isData = (t) => /^(\$|EGP|\d|\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b)/.test(t) || /Marcus Vance|Sarah Connor|John Doe|Alex Rivera|Elena Rostova/i.test(t);

              for (const mt of mockTexts) {
                if (!mt || isData(mt) || kept.includes(mt)) continue;
                const found = appTexts.some((at) => at.toLowerCase() === mt.toLowerCase());
                if (!found) {
                  failures.push({
                    element: 'Text label',
                    prop: 'textContent',
                    mockValue: mt,
                    appValue: 'missing in app'
                  });
                }
              }
            }
          }

          // Capture side-by-side screenshot to OS temp
          const mockShot = await mockPage.screenshot({ fullPage: false });
          const appShot = await appPage.screenshot({ fullPage: false });
          const shotName = `parity-${sliceId}-${config.mockFile.replace('.html', '')}-${theme}.png`;
          await saveSideBySideScreenshot(appPage, mockShot, appShot, shotName);

          if (config.teardown) {
            await config.teardown(appPage);
          }

          await mockContext.close();
          await appContext.close();

          if (failures.length > 0) {
            console.error(`\n[PARITY FAILURE] ${sliceId} - ${config.name} (${theme}):`);
            console.table(failures);
          }

          expect(failures, `Visual & text parity failures for ${sliceId} in ${theme}`).toHaveLength(0);
        });
      }
    }
  });
}

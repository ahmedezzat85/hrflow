import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { PARITY_MAP, DEFAULT_PARITY_PROPS } from './helpers/parity-map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOCKS_DIR = path.resolve(__dirname, '../../../docs/finance-module/mocks/restyle-v3');

const DARK_TOKEN_NAMES = [
  '--bg', '--surface', '--surface2', '--border', '--border2',
  '--text', '--text2', '--text3', '--ink-strong', '--ink-body', '--ink-label', '--ink-muted', '--ink-faint',
  '--fv-canvas', '--fv-surface', '--fv-surface-soft', '--fv-dialog-foot', '--fv-line', '--fv-line-strong',
  '--fv-line-row', '--fv-input-border', '--fv-outline', '--brand', '--brand-ink', '--brand-text',
  '--brand-tint', '--brand-wash', '--fv-on-brand', '--fv-on-brand-wash', '--fv-scrim',
  '--success', '--success-soft', '--warning', '--warning-soft', '--danger', '--danger-soft',
  '--info', '--info-soft', '--purple', '--purple-soft', '--rail-bg', '--rail-border', '--rail-idle',
  '--rail-active-bg', '--rail-active-color', '--id-blue', '--id-blue-ink', '--id-orange', '--id-orange-ink',
  '--id-teal', '--id-teal-ink', '--id-violet', '--id-violet-ink', '--id-green', '--id-green-ink',
  '--id-pink', '--id-pink-ink', '--id-sky', '--id-sky-ink', '--id-ochre', '--id-ochre-ink',
  '--fv-area-green-bg', '--fv-area-green-ink', '--fv-area-blue-bg', '--fv-area-blue-ink',
  '--fv-area-teal-bg', '--fv-area-teal-ink', '--fv-area-ochre-bg', '--fv-area-ochre-ink',
  '--fv-area-pink-bg', '--fv-area-pink-ink', '--fv-area-violet-bg', '--fv-area-violet-ink',
  '--fv-area-orange-bg', '--fv-area-orange-ink', '--fv-area-danger-bg', '--fv-area-danger-ink'
];

function normalizeColor(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function normalizeDimension(value) {
  return String(value || '').trim().toLowerCase();
}

function isDataText(text) {
  return /^(\$|EGP|\d|\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b)/.test(text)
    || /Marcus Vance|Sarah Connor|John Doe|Alex Rivera|Elena Rostova/i.test(text);
}

async function resolvedDarkTokenColors(page) {
  return page.evaluate((names) => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const colors = names.map((name) => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color.replace(/\s+/g, '').toLowerCase();
    });
    probe.remove();
    return Array.from(new Set(colors.filter(Boolean)));
  }, DARK_TOKEN_NAMES);
}

async function collectVisibleLabels(locator) {
  return locator.first().evaluate((root) => {
    const clean = (node) => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll('svg, script, style').forEach((child) => child.remove());
      if (node.matches('label')) {
        clone.querySelectorAll('input, select, textarea').forEach((control) => control.remove());
      }
      clone.querySelectorAll('*').forEach((el) => el.after(' '));
      return clone.textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    };
    const visible = (node) => node.getClientRects().length > 0;
    return Array.from(root.querySelectorAll('h1, h2, h3, h4, th, label, button, a, .modal-title, .modal-subtitle, option:checked'))
      .filter(visible)
      .map(clean)
      .filter(Boolean);
  });
}

async function saveSideBySideScreenshot(page, mockBuffer, appBuffer, filename) {
  const mockBase64 = mockBuffer.toString('base64');
  const appBase64 = appBuffer.toString('base64');

  const stitchedBase64 = await page.evaluate(
    async ({ mockB64, appB64 }) => {
      const loadImg = (b64) => new Promise((resolve, reject) => {
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

          const mockPath = path.join(MOCKS_DIR, config.mockFile);
          expect(fs.existsSync(mockPath)).toBeTruthy();
          await mockPage.goto(pathToFileURL(mockPath).href, { waitUntil: 'load' });

          await appPage.goto(config.appRoute, { waitUntil: 'domcontentloaded' });
          const mockRole = new URL(config.appRoute, 'http://localhost').searchParams.get('mock');
          const appRoot = mockRole === 'employee' ? appPage.locator('#employee-app') : appPage.locator('#admin-app');
          await expect(appRoot, 'mock session must show the requested portal, not the login screen').toBeVisible({ timeout: 15000 });
          await expect(appPage.locator('#login-screen'), 'login must be hidden during parity checks').toBeHidden();
          await appPage.evaluate((selectedTheme) => {
            if (typeof applyTheme === 'function') applyTheme(selectedTheme);
            else document.documentElement.setAttribute('data-theme', selectedTheme);
          }, theme);

          if (config.setup) await config.setup(appPage);

          const failures = [];
          const allowedDarkColors = theme === 'dark' ? await resolvedDarkTokenColors(appPage) : [];

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

            const mockStyles = await mockPage.locator(pair.mockSelector).first().evaluate((element, props) => {
              const style = getComputedStyle(element);
              return Object.fromEntries(props.map((prop) => [prop, style[prop] || style.getPropertyValue(prop)]));
            }, propsToCompare);
            const appStyles = await appPage.locator(pair.appSelector).first().evaluate((element, props) => {
              const style = getComputedStyle(element);
              return Object.fromEntries(props.map((prop) => [prop, style[prop] || style.getPropertyValue(prop)]));
            }, propsToCompare);

            for (const prop of propsToCompare) {
              const mockValue = mockStyles[prop] || '';
              const appValue = appStyles[prop] || '';

              if (theme === 'dark' && ['color', 'backgroundColor', 'borderColor'].includes(prop)) {
                const normalizedApp = normalizeColor(appValue);
                const transparentMatch = normalizeColor(mockValue) === 'rgba(0,0,0,0)' && normalizedApp === 'rgba(0,0,0,0)';
                if (!transparentMatch && !allowedDarkColors.includes(normalizedApp)) {
                  failures.push({ element: pair.name, prop, mockValue: 'approved navy/theme token', appValue });
                }
                continue;
              }

              const isDimension = /width|height|padding|gap|radius|size/i.test(prop);
              const isColor = ['color', 'backgroundColor', 'borderColor'].includes(prop);
              const normalizedMock = isDimension ? normalizeDimension(mockValue) : (isColor ? normalizeColor(mockValue) : String(mockValue).trim());
              const normalizedApp = isDimension ? normalizeDimension(appValue) : (isColor ? normalizeColor(appValue) : String(appValue).trim());
              if (normalizedMock !== normalizedApp) {
                failures.push({ element: pair.name, prop, mockValue, appValue });
              }
            }
          }

          if (config.mockContainerSelector || config.appContainerSelector) {
            const mockContainer = config.mockContainerSelector && mockPage.locator(config.mockContainerSelector);
            const appContainer = config.appContainerSelector && appPage.locator(config.appContainerSelector);
            const hasMockContainer = !!mockContainer && (await mockContainer.count()) > 0;
            const hasAppContainer = !!appContainer && (await appContainer.count()) > 0;

            if (!hasMockContainer || !hasAppContainer) {
              failures.push({
                element: 'Text inventory region',
                prop: 'existence',
                mockValue: hasMockContainer ? 'present' : 'missing',
                appValue: hasAppContainer ? 'present' : 'missing'
              });
            } else {
              const mockTexts = await collectVisibleLabels(mockContainer);
              const appTexts = await collectVisibleLabels(appContainer);
              const kept = (config.keptLabels || []).map((label) => label.toLowerCase());
              const unexplained = (label) => !isDataText(label) && !kept.includes(label.toLowerCase());

              for (const mockText of mockTexts.filter(unexplained)) {
                if (!appTexts.some((appText) => appText.toLowerCase() === mockText.toLowerCase())) {
                  failures.push({ element: 'Text label', prop: 'textContent', mockValue: mockText, appValue: 'missing in app' });
                }
              }
              for (const appText of appTexts.filter(unexplained)) {
                if (!mockTexts.some((mockText) => mockText.toLowerCase() === appText.toLowerCase())) {
                  failures.push({ element: 'Text label', prop: 'textContent', mockValue: 'not present in mock or kept table', appValue: appText });
                }
              }
            }
          }

          const mockShot = await mockPage.screenshot({ fullPage: false });
          const appShot = await appPage.screenshot({ fullPage: false });
          const shotName = `parity-${sliceId}-${config.mockFile.replace('.html', '')}-${theme}.png`;
          await saveSideBySideScreenshot(appPage, mockShot, appShot, shotName);

          if (config.teardown) await config.teardown(appPage);
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

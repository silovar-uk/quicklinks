import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const LOCAL_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://silovar-uk.github.io/quicklinks/';
const OUT_DIR = process.env.VISUAL_QA_DIR || 'visual-qa';

await fs.mkdir(OUT_DIR, { recursive: true });

const results = {
  commit: process.env.GITHUB_SHA || 'local',
  generatedAt: new Date().toISOString(),
  local: {},
  production: {},
};

function attachDiagnostics(page, bucket) {
  bucket.consoleErrors = [];
  bucket.pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') bucket.consoleErrors.push(msg.text());
  });
  page.on('pageerror', error => bucket.pageErrors.push(String(error?.stack || error)));
}

async function waitForApp(page) {
  await page.waitForSelector('.brand-title', { state: 'visible', timeout: 15000 });
  await page.waitForSelector('#fabBtn', { state: 'visible', timeout: 15000 });
}

async function openAddModal(page) {
  await page.locator('#fabBtn').click();
  await page.waitForSelector('#quickUrlModal.open', { state: 'visible', timeout: 8000 });
  await page.waitForSelector('#quickUrlInput', { state: 'visible', timeout: 5000 });
  await page.waitForSelector('#quickUrlProjectSelect', { state: 'visible', timeout: 5000 });
  await page.waitForSelector('#quickProjectSort', { state: 'visible', timeout: 5000 });
}

async function runViewport(browser, baseUrl, prefix, viewport, reducedMotion = 'no-preference') {
  const bucket = {
    url: baseUrl,
    viewport,
    reducedMotion,
    status: 'running',
    checks: {},
  };
  attachDiagnostics(null, bucket);
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  bucket.consoleErrors = [];
  bucket.pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') bucket.consoleErrors.push(msg.text());
  });
  page.on('pageerror', error => bucket.pageErrors.push(String(error?.stack || error)));

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);

    bucket.checks.brand = await page.locator('.brand-title').innerText();
    bucket.checks.search = await page.locator('#globalSearch').count() === 1;
    bucket.checks.fab = await page.locator('#fabBtn').count() === 1;

    await page.screenshot({ path: `${OUT_DIR}/${prefix}-home.png`, fullPage: true });

    await openAddModal(page);
    bucket.checks.addModal = true;
    bucket.checks.projectSort = await page.locator('#quickProjectSort').count() === 1;
    bucket.checks.projectSortOptions = await page.locator('#quickProjectSort option').allTextContents();
    await page.screenshot({ path: `${OUT_DIR}/${prefix}-add-link.png`, fullPage: true });

    bucket.status = bucket.pageErrors.length ? 'failed' : 'passed';
  } catch (error) {
    bucket.status = 'failed';
    bucket.error = String(error?.stack || error);
    try {
      await page.screenshot({ path: `${OUT_DIR}/${prefix}-failure.png`, fullPage: true });
    } catch {}
  } finally {
    await context.close();
  }
  return bucket;
}

async function runProduction(browser) {
  const attempts = 6;
  let last = null;
  for (let i = 1; i <= attempts; i += 1) {
    last = await runViewport(browser, PRODUCTION_URL, 'production-mobile', { width: 390, height: 844 });
    if (last.status === 'passed') return last;
    if (i < attempts) await new Promise(resolve => setTimeout(resolve, 10000));
  }
  return last;
}

const browser = await chromium.launch({ headless: true });
try {
  results.local.desktop = await runViewport(browser, LOCAL_URL, 'local-desktop', { width: 1440, height: 1000 });
  results.local.mobile = await runViewport(browser, LOCAL_URL, 'local-mobile', { width: 390, height: 844 });
  results.local.mobileReducedMotion = await runViewport(browser, LOCAL_URL, 'local-mobile-reduced-motion', { width: 390, height: 844 }, 'reduce');

  if (process.env.RUN_PRODUCTION_QA === '1') {
    results.production.mobile = await runProduction(browser);
  } else {
    results.production.skipped = true;
  }
} finally {
  await browser.close();
}

await fs.writeFile(`${OUT_DIR}/qa-result.json`, JSON.stringify(results, null, 2));

const localRuns = Object.values(results.local);
const localFailed = localRuns.some(run => run?.status !== 'passed');
const pageErrors = localRuns.flatMap(run => run?.pageErrors || []);

console.log(JSON.stringify(results, null, 2));
if (localFailed || pageErrors.length) process.exitCode = 1;

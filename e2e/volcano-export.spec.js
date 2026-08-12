// e2e/volcano-export.spec.js
// Flexible gene export: the Gene Volcano Plot must offer DE / Upregulated /
// Downregulated / All genes, and exporting must produce a CSV download.
//
// Needs a COMPLETED expression-input analysis session:
//   E2E_BASE_URL=http://localhost:18000 \
//   E2E_VIZ_PATH=/analysis/visualization/<sessionId>?analysisId=<analysisId> \
//   npx playwright test e2e/volcano-export.spec.js
// Without E2E_VIZ_PATH the spec is skipped (no session to render).

const { test, expect } = require('@playwright/test');

const VIZ_PATH = process.env.E2E_VIZ_PATH;

test.describe('Gene Volcano Plot export', () => {
  test.skip(!VIZ_PATH, 'Set E2E_VIZ_PATH to a completed expression-input session to run this spec.');

  test('Export dropdown offers DE / Up / Down / All', async ({ page }) => {
    await page.goto(VIZ_PATH);

    // Open the Gene Volcano Plot tab/panel.
    const geneVolcano = page.getByText(/Gene Volcano Plot/i).first();
    await expect(geneVolcano).toBeVisible();
    await geneVolcano.click().catch(() => {});

    // The export control is a dropdown button labelled "Export genes".
    const exportBtn = page.getByRole('button', { name: /export genes/i }).first();
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // All four modes must be present in the menu.
    await expect(page.getByText(/Export DE genes/i).first()).toBeVisible();
    await expect(page.getByText(/Upregulated only/i).first()).toBeVisible();
    await expect(page.getByText(/Downregulated only/i).first()).toBeVisible();
    await expect(page.getByText(/Export all genes/i).first()).toBeVisible();
  });

  test('Exporting all genes downloads a CSV', async ({ page }) => {
    await page.goto(VIZ_PATH);

    const geneVolcano = page.getByText(/Gene Volcano Plot/i).first();
    await geneVolcano.click().catch(() => {});

    const exportBtn = page.getByRole('button', { name: /export genes/i }).first();
    await exportBtn.click();

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByText(/Export all genes/i).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);

    // The CSV must carry both the raw Gene ID and a separate Symbol column,
    // with at least one non-empty symbol value.
    const fs = require('fs');
    const path = await download.path();
    const content = fs.readFileSync(path, 'utf8').replace(/^﻿/, '');
    const [header, ...rows] = content.split('\n');
    expect(header).toMatch(/Gene ID/);
    expect(header).toMatch(/Symbol/);
    const symbolIdx = header.split(',').indexOf('Symbol');
    const someSymbol = rows.some(r => (r.split(',')[symbolIdx] || '').trim().length > 0);
    expect(someSymbol).toBe(true);
  });
});

// e2e/missing-input-reupload.spec.js
// After a redeploy/auto-purge removes a session's uploaded data file, clicking "Run Analysis"
// on Step 5 must show a friendly "re-upload" banner (NOT a raw R error), and the
// "Re-upload data" button must route back to the Data Input step.
//
// Needs a session sitting on Step 5 whose uploaded expression file has been removed from the
// server's .data/tmp-upload (simulate by deleting the file, or point at a session restored
// from a DB-only backup). Point this at one:
//   E2E_BASE_URL=http://localhost:3000 \
//   E2E_MISSING_FILE_PATH=/analysis/session/<sessionId>/<analysisId> \
//   npx playwright test e2e/missing-input-reupload.spec.js
// Skipped unless E2E_MISSING_FILE_PATH is set.

const { test, expect } = require('@playwright/test');

const RUN_PATH = process.env.E2E_MISSING_FILE_PATH;

test.describe('Missing uploaded file → re-upload prompt', () => {
  test.skip(!RUN_PATH, 'Set E2E_MISSING_FILE_PATH to a Step-5 session whose upload file was removed.');

  test('Run shows a re-upload banner instead of a raw R error, and routes back to Data Input', async ({ page }) => {
    await page.goto(RUN_PATH);

    const runBtn = page.getByRole('button', { name: /run analysis/i }).first();
    await expect(runBtn).toBeVisible();
    await runBtn.click();

    // The friendly banner must appear; the opaque R connection error must NOT.
    await expect(page.getByText(/no longer available|re-upload your data/i).first()).toBeVisible();
    await expect(page.getByText(/cannot open the connection/i)).toHaveCount(0);

    // "Re-upload data" returns to the Data Input step where the upload control lives.
    const reupload = page.getByRole('button', { name: /re-upload data/i }).first();
    await expect(reupload).toBeVisible();
    await reupload.click();

    await expect(
      page.getByRole('button', { name: /upload expression file/i }).first()
    ).toBeVisible();
  });
});

// e2e/upload-filename.spec.js
// Bug 3: re-uploading a file on the data-input step must update the displayed
// file name immediately (no page reload).
//
// Needs an editable session sitting on the expression data-input step. Point at one:
//   E2E_BASE_URL=http://localhost:3000 \
//   E2E_UPLOAD_PATH=/analysis/session/<sessionId>/<analysisId> \
//   npx playwright test e2e/upload-filename.spec.js
// Skipped unless E2E_UPLOAD_PATH is set.

const { test, expect } = require('@playwright/test');

const UPLOAD_PATH = process.env.E2E_UPLOAD_PATH;

const csv = (name) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from('Gene,S1,S2\nG1,1,2\nG2,3,4\n'),
});

test.describe('Re-upload updates file name (Bug 3)', () => {
  test.skip(!UPLOAD_PATH, 'Set E2E_UPLOAD_PATH to an editable data-input session to run this spec.');

  test('uploading a second expression file updates the displayed name without reload', async ({ page }) => {
    await page.goto(UPLOAD_PATH);

    const uploadBtn = page.getByRole('button', { name: /upload expression file/i });
    await expect(uploadBtn).toBeVisible();

    // First upload.
    const chooser1 = page.waitForEvent('filechooser');
    await uploadBtn.click();
    await (await chooser1).setFiles(csv('first_expression.csv'));
    await expect(page.getByText('first_expression.csv')).toBeVisible();

    // Second upload — the name must switch WITHOUT a reload.
    const chooser2 = page.waitForEvent('filechooser');
    await uploadBtn.click();
    await (await chooser2).setFiles(csv('second_expression.csv'));
    await expect(page.getByText('second_expression.csv')).toBeVisible();
    await expect(page.getByText('first_expression.csv')).toHaveCount(0);
  });
});

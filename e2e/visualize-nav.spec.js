// e2e/visualize-nav.spec.js
// "Visualize Results" must open the analysis the user came from, not always the
// first one. Navigating with ?analysisId=<id> should activate that analysis tab.
//
// Needs a COMPLETED session with multiple analyses, plus the id of a NON-FIRST
// analysis and its 1-based tab position:
//   E2E_BASE_URL=http://localhost:18000 \
//   E2E_SESSION_ID=<sessionId> \
//   E2E_ANALYSIS_ID=<thirdAnalysisId> \
//   E2E_ANALYSIS_TAB_NAME="<analysis 3 name>" \
//   npx playwright test e2e/visualize-nav.spec.js
// Skipped unless E2E_SESSION_ID and E2E_ANALYSIS_ID are set.

const { test, expect } = require('@playwright/test');

const SESSION_ID = process.env.E2E_SESSION_ID;
const ANALYSIS_ID = process.env.E2E_ANALYSIS_ID;
const ANALYSIS_TAB_NAME = process.env.E2E_ANALYSIS_TAB_NAME;

test.describe('Visualize navigation carries the selected analysis', () => {
  test.skip(!SESSION_ID || !ANALYSIS_ID, 'Set E2E_SESSION_ID and E2E_ANALYSIS_ID to run this spec.');

  test('opening with ?analysisId activates that analysis tab', async ({ page }) => {
    await page.goto(`/analysis/visualization/${SESSION_ID}?analysisId=${ANALYSIS_ID}`);

    // The page renders Ant Design tabs; the selected tab carries aria-selected="true".
    // If a tab name was provided, assert that specific tab is the active one.
    if (ANALYSIS_TAB_NAME) {
      const activeTab = page.locator('[role="tab"][aria-selected="true"]').first();
      await expect(activeTab).toContainText(ANALYSIS_TAB_NAME);
    } else {
      // Otherwise at least assert the page rendered an active tab (smoke).
      await expect(page.locator('[role="tab"][aria-selected="true"]').first()).toBeVisible();
    }
  });
});

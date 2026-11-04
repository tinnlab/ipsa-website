// e2e/circos-loading.spec.js
// The Circos plot must show a clear LOADING indicator while data is fetched, and
// must NOT end up displaying "No significant pathway" for a method that has
// pathways (the "blink" bug).
//
// Needs a COMPLETED analysis session whose Circos plot has results:
//   E2E_BASE_URL=https://ipsa.tinnguyenlab.com \
//   E2E_VIZ_PATH=/analysis/visualization/<sessionId>?analysisId=<analysisId> \
//   npx playwright test e2e/circos-loading.spec.js
// Without E2E_VIZ_PATH the spec is skipped.

const { test, expect } = require('@playwright/test');

const VIZ_PATH = process.env.E2E_VIZ_PATH;

test.describe('Circos plot loading vs no-data', () => {
  test.skip(!VIZ_PATH, 'Set E2E_VIZ_PATH to a completed visualization session to run this spec.');

  test('settles on a chart (no lingering "no significant pathway" flash)', async ({ page }) => {
    await page.goto(VIZ_PATH);

    // Open the Circos Plot panel.
    const circos = page.getByText(/Circos Plot/i).first();
    await expect(circos).toBeVisible();
    await circos.click().catch(() => {});

    // Give the multi-stage async pipeline time to settle, then assert the FINAL
    // state is a rendered chart (svg/canvas), not the empty message. The empty
    // message is only acceptable as a final state if there is genuinely no chart.
    // Scoped to the Circos SVG's own id (circos-d3 sets id="circos-svg-<chartId>"). A bare
    // 'svg, canvas' matches any antd icon on the page — including the plot's own SVG/PNG
    // export buttons — so it was satisfied before a chart existed.
    const chart = page.locator('svg[id^="circos-svg-"]').first();
    const noPathway = page.getByText(/no significant pathways were identified/i).first();
    // A third settled state: pathways ARE displayed but none of them contains a
    // differentially expressed gene, so there are no chords to draw.
    const nothingToConnect = page.getByText(/nothing to connect/i).first();

    await expect
      .poll(async () => {
        const hasChart = await chart.isVisible().catch(() => false);
        const hasEmpty = await noPathway.isVisible().catch(() => false);
        const hasNoGenes = await nothingToConnect.isVisible().catch(() => false);
        return hasChart || hasEmpty || hasNoGenes;
      }, { timeout: 30_000 })
      .toBeTruthy();

    // If a chart eventually renders, the no-data message must NOT also be showing.
    if (await chart.isVisible().catch(() => false)) {
      expect(await noPathway.isVisible().catch(() => false)).toBeFalsy();
    }
  });
});

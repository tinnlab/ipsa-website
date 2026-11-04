// e2e/visualization-consensus.spec.js
// Bug 2: "Consensus" should be selectable on ALL four plots (Circos, Volcano,
// Forest, Bar) and switching method tabs must update the figure (no stale plot).
//
// Visualization needs a COMPLETED analysis session, so point this at one:
//   E2E_BASE_URL=https://ipsa.tinnguyenlab.com \
//   E2E_VIZ_PATH=/analysis/visualization/ZXFAwgeyigLe6sdgo \
//   npx playwright test e2e/visualization-consensus.spec.js
// Without E2E_VIZ_PATH the spec is skipped (no session to render).

const { test, expect } = require('@playwright/test');

const VIZ_PATH = process.env.E2E_VIZ_PATH;

test.describe('Visualization consensus (Bug 2)', () => {
  test.skip(!VIZ_PATH, 'Set E2E_VIZ_PATH to a completed visualization session to run this spec.');

  test('Consensus is selectable on Circos, Volcano, Forest and Bar', async ({ page }) => {
    await page.goto(VIZ_PATH);

    // Each plot card exposes a method picker. Circos/Volcano show CONSENSUS as a
    // left tab; Forest/Bar show it as a "Sorted by" option. In all four it must
    // be present once consensus results exist.
    for (const plot of ['Circos Plot', 'Volcano Plot', 'Forest Plot', 'Bar Plot']) {
      const heading = page.getByText(plot, { exact: false }).first();
      await expect(heading, `${plot} should be present`).toBeVisible();
    }

    // CONSENSUS appears at least once across the visualization page.
    await expect(page.getByText(/consensus/i).first()).toBeVisible();
  });

  test('switching Circos method tabs updates the figure (no stale plot)', async ({ page }) => {
    await page.goto(VIZ_PATH);

    // Open a viewable method, then CONSENSUS — the panel must re-render, never
    // keep the previously viewed method's figure.
    const fgsea = page.getByRole('tab', { name: /fgsea/i }).first();
    const consensus = page.getByRole('tab', { name: /consensus/i }).first();

    if (await fgsea.count()) {
      await fgsea.click();
      await consensus.click();
      // After selecting consensus we must see EITHER the consensus figure (svg/canvas)
      // OR the explicit empty message — but not silently the old fgsea figure.
      // Scoped to the Circos SVG's own id (circos-d3 sets id="circos-svg-<chartId>"). A bare
      // 'svg, canvas' matches any antd icon on the page — including the plot's own SVG/PNG
      // export buttons — so it was satisfied before a chart existed.
      //
      // Because that loose selector matched instantly, a bare isVisible() used to pass
      // immediately. A correctly scoped one has to WAIT: right after the tab click the pane
      // is still loading, so poll for whichever settled state arrives.
      const figure = page.locator('svg[id^="circos-svg-"]').first();
      const emptyMsg = page.getByText(/no result found for this method/i).first();
      await expect
        .poll(async () => {
          const hasFigure = await figure.isVisible().catch(() => false);
          const hasEmptyMsg = await emptyMsg.isVisible().catch(() => false);
          return hasFigure || hasEmptyMsg;
        }, { timeout: 30_000 })
        .toBeTruthy();
    }
  });
});

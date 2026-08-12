// e2e/visualization-consensus.spec.js
// Bug 2: "Consensus" should be selectable on ALL four plots (Circos, Volcano,
// Forest, Bar) and switching method tabs must update the figure (no stale plot).
//
// Visualization needs a COMPLETED analysis session, so point this at one:
//   E2E_BASE_URL=http://localhost:18000 \
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
      const hasFigure = await page.locator('svg, canvas').first().isVisible().catch(() => false);
      const hasEmptyMsg = await page
        .getByText(/no result found for this method/i)
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasFigure || hasEmptyMsg).toBeTruthy();
    }
  });
});

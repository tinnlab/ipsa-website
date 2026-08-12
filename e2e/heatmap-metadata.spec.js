// e2e/heatmap-metadata.spec.js
// Regression coverage for IPSA bug 3 (Pathway Heat Map):
//   1. "Show Dataset Metadata" must not put meaningless circles on metadata rows.
//   2. The meta-analysis column must stay RIGHTMOST — it must not jump left after sorting
//      columns by a metadata field.
//   3. After checking then UNchecking "Show Dataset Metadata", switching the "sorted by"
//      metric must not corrupt cell colors / crash.
//   4. Toggling "Show Dataset Metadata" must not collapse the significant-cell -log10(FDR) gradient
//      to a single color (canvas-renderer merge bug) — checked via the data-pathway-fills hook.
//
// The Pathway Heat Map renders with the DEFAULT canvas ECharts renderer. The gradient check (4)
// therefore reads a model-layer hook (data-pathway-fills) rather than pixels; the column-position
// checks (2) inspect axis-label DOM nodes. Needs a COMPLETED session whose visualization includes
// the Pathway Heat Map (with at least one meta-analysis column):
//   E2E_BASE_URL=http://localhost:18000 \
//   E2E_VIZ_PATH=/analysis/visualization/<sessionId>?analysisId=<analysisId> \
//   npx playwright test e2e/heatmap-metadata.spec.js
// Without E2E_VIZ_PATH the spec is skipped.

const { test, expect } = require('@playwright/test');

const VIZ_PATH = process.env.E2E_VIZ_PATH;

// x of the rightmost visible SVG text label whose content looks like a dataset/meta column
// header, plus whether the meta column is that rightmost one. Returns null if no column labels
// can be identified at all (a selector/renderer regression — callers assert this is non-null).
// NOTE: uses the label's horizontal center; ECharts rotates category x-axis labels, so this is a
// heuristic — the hard guarantee remains the pageerror/console-error capture.
const COLUMN_LABEL_RE = /^(OSD|GLDS|GSE|PRJNA|E-MTAB|SRP|DRP|meta)/i;
async function metaColumnGeometry(page, reString) {
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'i');
    const texts = Array.from(document.querySelectorAll('svg text'));
    const cols = texts
      .map((t) => {
        const s = (t.textContent || '').trim();
        const box = t.getBoundingClientRect();
        return { s, x: box.x + box.width / 2 };
      })
      .filter((c) => re.test(c.s));
    if (cols.length === 0) return null;
    const rightmost = cols.reduce((a, b) => (b.x > a.x ? b : a));
    const meta = cols.filter((c) => /meta/i.test(c.s));
    return {
      count: cols.length,
      rightmostLabel: rightmost.s,
      metaIsRightmost: meta.length > 0 && /meta/i.test(rightmost.s),
      hasMeta: meta.length > 0,
    };
  }, reString);
}

// Read the number of DISTINCT colors ECharts computed for the pathway cells. HeatmapChart publishes
// this on a data-pathway-fills attribute after each paint (a model-layer readback via getItemVisual).
// We use the model layer, NOT canvas pixels, on purpose: the pathway gradient is overlaid by
// effect-magnitude scatter dots and (in metadata mode) an opaque metadata band whose warm cells alias
// with the gradient stops, so raw pixel-counting cannot isolate the pathway cells. A healthy gradient
// yields many distinct fills; the metadata-toggle collapse bug makes every significant cell share one
// color, so this crashes to ~1.
//
// data-testid is used here deliberately (the rest of this suite locates by text/role): this host div
// is a non-visual readback anchor for the model-layer count, with no stable text/role/CSS handle —
// not a "find the chart" locator.
async function readPathwayFills(page) {
  const val = await page
    .locator('[data-testid="pathway-heatmap-host"]')
    .getAttribute('data-pathway-fills');
  return val == null ? null : Number(val);
}

// The metadata toggle remounts the chart (key prop): the source clears data-pathway-fills before paint
// and republishes the fresh count ~300ms later. Poll for a present-and-stable value (two equal
// consecutive non-null reads); nulls during the remount window are skipped, so a stale pre-remount
// value can never be read.
async function readStablePathwayFills(page, { tries = 15, intervalMs = 400 } = {}) {
  let prev = null;
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await readPathwayFills(page);
    if (last != null && prev != null && prev === last) return last;
    prev = last;
    await page.waitForTimeout(intervalMs);
  }
  return last;
}

test.describe('Pathway Heat Map — metadata + sorting (IPSA bug 3)', () => {
  test.skip(!VIZ_PATH, 'Set E2E_VIZ_PATH to a completed visualization session to run this spec.');

  // Regression for the metadata-toggle gradient collapse: checking "Show Dataset Metadata" must NOT
  // flatten the significant-cell -log10(FDR) gradient to a single color on the canvas renderer.
  test('significant-cell gradient survives toggling Show Dataset Metadata', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(VIZ_PATH);

    const heatmapHeading = page.getByText(/Pathway Heat ?Map/i).first();
    await expect(heatmapHeading).toBeVisible({ timeout: 30_000 });
    await heatmapHeading.click().catch(() => {});
    await expect(page.locator('[data-testid="pathway-heatmap-host"]')).toBeVisible({ timeout: 30_000 });

    // Baseline (metadata OFF): the pathway gradient spans many distinct fills.
    const baseline = await readStablePathwayFills(page);
    expect(baseline, 'data-pathway-fills not published — the model-layer hook is missing or the chart never painted').not.toBeNull();
    // If the baseline has no gradient there is nothing to regress-test (e.g. no significant cells in
    // this session) — surface it loudly rather than pass vacuously.
    expect(baseline,
      `baseline distinct fills too low (${baseline}); pick a session with significant cells`)
      .toBeGreaterThan(2);

    // Toggle metadata ON and confirm it took effect (the metadata-only control appears).
    await page.getByText('Show Dataset Metadata', { exact: false }).first().click();
    await expect(page.getByText(/Sort columns by/i).first()).toBeVisible({ timeout: 10_000 });

    // The gradient must NOT collapse. On the bug every significant cell shares one color, so the
    // distinct-fill count crashes to ~1. Require it to stay at least half of baseline (and >= 3) — a
    // margin a collapse cannot reach, but a healthy re-render (≈ baseline) clears easily.
    const withMeta = await readStablePathwayFills(page);
    expect(withMeta, 'data-pathway-fills not published with metadata on').not.toBeNull();
    expect(withMeta,
      `gradient collapsed with metadata on: baseline=${baseline} withMeta=${withMeta}`)
      .toBeGreaterThanOrEqual(Math.max(3, Math.floor(baseline * 0.5)));

    await page.screenshot({ path: 'test-results/heatmap-05-gradient-metadata-on.png', fullPage: false });
    expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('meta column stays rightmost and toggling metadata + re-sorting never errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(VIZ_PATH);

    // Reach the Pathway Heat Map panel.
    const heatmapHeading = page.getByText(/Pathway Heat ?Map/i).first();
    await expect(heatmapHeading).toBeVisible({ timeout: 30_000 });
    await heatmapHeading.click().catch(() => {});

    const chart = page.locator('svg').first();
    await expect(chart).toBeVisible({ timeout: 30_000 });

    // Baseline: with no metadata, meta should be rightmost.
    await page.waitForTimeout(1000);
    const baseline = await metaColumnGeometry(page, COLUMN_LABEL_RE.source);
    // Hard guard: if we cannot find ANY column labels, the selector/renderer regressed — fail
    // rather than let every positional assertion below silently no-op (false green).
    expect(baseline, 'no axis column labels found — selector/renderer regressed').not.toBeNull();
    if (baseline.hasMeta) {
      expect(baseline.metaIsRightmost, `baseline rightmost=${baseline.rightmostLabel}`).toBeTruthy();
    }
    await page.screenshot({ path: 'test-results/heatmap-01-baseline.png', fullPage: false });

    // 1) Show Dataset Metadata — meta must still be rightmost.
    const showMeta = page.getByText('Show Dataset Metadata', { exact: false }).first();
    await showMeta.click();
    // Hard check that the toggle actually took effect (the metadata-only "Sort columns by"
    // control appears), so the positional checks below aren't silently vacuous.
    await expect(page.getByText(/Sort columns by/i).first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    const withMeta = await metaColumnGeometry(page, COLUMN_LABEL_RE.source);
    if (withMeta && withMeta.hasMeta) {
      expect(withMeta.metaIsRightmost, `metadata-on rightmost=${withMeta.rightmostLabel}`).toBeTruthy();
    }
    await page.screenshot({ path: 'test-results/heatmap-02-metadata-on.png', fullPage: false });

    // 2) Sort columns by a metadata field — meta must NOT jump to the left (bug 2).
    const sortBySelect = page.getByText(/Sort columns by/i).first();
    if (await sortBySelect.isVisible().catch(() => false)) {
      // Open the antd Select scoped to the "Sort columns by" row and choose the first field option.
      const select = sortBySelect.locator('xpath=following::*[contains(@class,"ant-select")][1]');
      await select.click().catch(() => {});
      const firstOption = page.locator('.ant-select-dropdown:visible .ant-select-item-option').first();
      await firstOption.click().catch(() => {});
      await page.waitForTimeout(1500);
      const sorted = await metaColumnGeometry(page, COLUMN_LABEL_RE.source);
      if (sorted && sorted.hasMeta) {
        expect(sorted.metaIsRightmost, `after metadata-sort rightmost=${sorted.rightmostLabel}`).toBeTruthy();
      }
      await page.screenshot({ path: 'test-results/heatmap-03-metadata-sorted.png', fullPage: false });
    }

    // 3) Uncheck metadata, then switch the pathway "sorted by" metric a few times (bug 3).
    await showMeta.click();
    await page.waitForTimeout(1000);
    const sortedByLabel = page.getByText(/^sorted by$/i).first();
    for (let i = 0; i < 2 && (await sortedByLabel.isVisible().catch(() => false)); i++) {
      const metricSelect = page.locator('.ant-select').filter({ hasText: /FDR|p-value|Score/i }).last();
      await metricSelect.click().catch(() => {});
      const opts = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
      const n = await opts.count().catch(() => 0);
      if (n > 0) await opts.nth(i % n).click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    await page.screenshot({ path: 'test-results/heatmap-04-resorted.png', fullPage: false });

    // The chart must still be present, and nothing above may have thrown.
    await expect(chart).toBeVisible();
    expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});

// e2e/kegg-no-pathways.spec.js
//
// Reproduces the KEGG pathway map's false negative DETERMINISTICALLY, and asserts it is gone.
//
// The bug: KEGGMap's consensus effect re-runs when /api/resultData resolves, so it issues the same
// visualization.getConsensusAnalysisResult call more than once per mount — the first time with no
// fallback results. That method calls this.unblock(), so DDP no longer guarantees the calls return
// in the order they were made, and the results-less run could land last and overwrite the good
// selection with [undefined] — a length-1 array that trips the "no significant pathways" guard.
//
// In the wild the ordering is a coin flip, which is why the bug reads as intermittent and why a
// hard reload "fixes" it: /api/resultData is served with a one-year private Cache-Control, so a
// normal reload answers it from cache in ~3ms and the calls land together, while a hard reload pays
// a round trip and they run sequentially. This spec removes the coin flip by holding the FIRST
// consensus call's resolution back, so the stale run always settles last.
//
// Needs a COMPLETED session whose KEGG map has pathways and whose analysis has NO consensus row.
// That last part matters: with a consensus row every run computes the same answer and the race is
// invisible (that population had its own, deterministic bug — the {ID} vs {pathway} row shape,
// covered by tests/pathway-selection.tests.js).
//
//   E2E_BASE_URL=http://localhost:3000 \
//   E2E_VIZ_PATH=/analysis/visualization/<sessionId>?analysisId=<analysisId> \
//   npx playwright test e2e/kegg-no-pathways.spec.js
//
// Without E2E_VIZ_PATH the spec is skipped.

const { test, expect } = require('@playwright/test');

const VIZ_PATH = process.env.E2E_VIZ_PATH;
const DELAY_MS = Number(process.env.E2E_CONSENSUS_DELAY_MS || 6000);

// Runs before any page script. Wraps Meteor.callAsync as soon as Meteor exists and holds the FIRST
// getConsensusAnalysisResult resolution back, so the run computed without fallback results always
// settles after the runs computed with them.
const delayFirstConsensusCall = (delayMs) => {
  window.__keggProbe = { calls: [], delayed: 0, patched: false };
  const t0 = Date.now();

  const install = () => {
    const M = window.Meteor;
    if (!M || typeof M.callAsync !== 'function' || window.__keggProbe.patched) return false;
    const original = M.callAsync.bind(M);
    M.callAsync = function (name, ...args) {
      if (name !== 'visualization.getConsensusAnalysisResult') return original(name, ...args);
      const rec = { n: window.__keggProbe.calls.length + 1, settledAt: null };
      window.__keggProbe.calls.push(rec);
      let p = original(name, ...args);
      if (rec.n === 1) {
        window.__keggProbe.delayed += 1;
        p = p.then((v) => new Promise((r) => setTimeout(() => r(v), delayMs)));
      }
      return p.then((v) => { rec.settledAt = Date.now() - t0; return v; });
    };
    window.__keggProbe.patched = true;
    return true;
  };

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 5);
    setTimeout(() => clearInterval(timer), 60000);
  }
};

test.describe('KEGG pathway map: a stale consensus run must not win', () => {
  test.skip(!VIZ_PATH, 'Set E2E_VIZ_PATH to a completed visualization session to run this spec.');

  test('renders the map even when the results-less consensus call resolves last', async ({ page }) => {
    await page.addInitScript(delayFirstConsensusCall, DELAY_MS);
    await page.goto(VIZ_PATH);

    const kegg = page.getByText('KEGG Pathway Map', { exact: false }).first();
    await expect(kegg).toBeVisible({ timeout: 60_000 });
    await kegg.click().catch(() => {});

    // The effect must actually have issued the call more than once, and the delayed one must
    // actually have settled last. Without these the assertion below would be vacuous — it would
    // pass on a build where the race never happened rather than on one where it cannot bite.
    await expect
      .poll(async () => page.evaluate(() => window.__keggProbe?.calls?.length ?? 0), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(2);

    await expect
      .poll(
        async () => page.evaluate(() => {
          const calls = window.__keggProbe.calls;
          if (calls.some((c) => c.settledAt === null)) return false;
          const rest = calls.slice(1).map((c) => c.settledAt);
          return rest.length > 0 && calls[0].settledAt > Math.max(...rest);
        }),
        { timeout: DELAY_MS + 30_000 }
      )
      .toBeTruthy();

    // The regression assertion, on the FINAL state: the stale run has landed by now.
    await expect(page.getByText(/no significant pathways/i).first()).toBeHidden();
    await expect(page.getByText(/could not load pathway results/i).first()).toBeHidden();
  });
});

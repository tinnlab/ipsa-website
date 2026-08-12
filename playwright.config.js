// playwright.config.js
// E2E config for the IPSA website. Tests assume the app is already running at baseURL.
// Launch the app in stub mode first so the chatbot replies deterministically without an LLM:
//   CHAT_TEST_STUB=1 meteor run --settings ./config/settings.json
// then run:  npx playwright test

const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

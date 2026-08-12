// e2e/chat.spec.js
// Drives the IPSA Assistant chat widget end-to-end. Run the app in stub mode so replies are
// deterministic and offline:  CHAT_TEST_STUB=1 meteor run --settings ./config/settings.json

const { test, expect } = require('@playwright/test');

// The stubbed reply returned by chat.processMessage when CHAT_TEST_STUB is set.
const STUB_REPLY_FRAGMENT = 'IPSA supports';

test.describe('IPSA Assistant chat widget', () => {
  test('opens, answers, and keeps multi-turn history', async ({ page }) => {
    await page.goto('/');

    // Floating robot avatar is visible when the chat is closed.
    const avatar = page.locator('.anticon-robot').first();
    await expect(avatar).toBeVisible();

    // Open the panel.
    await avatar.click();
    await expect(page.getByText("Welcome to IPSA's chat!")).toBeVisible();

    const input = page.getByPlaceholder('Type your message...');
    const send = page.getByRole('button').filter({ has: page.locator('.anticon-send') });

    // First turn.
    await input.fill('What analysis methods does IPSA support?');
    await send.click();
    await expect(page.getByText('What analysis methods does IPSA support?')).toBeVisible();
    await expect(page.getByText(STUB_REPLY_FRAGMENT).first()).toBeVisible();

    // Second turn — prior turns must remain in the transcript.
    await input.fill('Which one needs an expression matrix?');
    await send.click();
    await expect(page.getByText('Which one needs an expression matrix?')).toBeVisible();
    // The first user message is still present (multi-turn history preserved in the UI).
    await expect(page.getByText('What analysis methods does IPSA support?')).toBeVisible();
    // Two bot replies now.
    await expect(page.getByText(STUB_REPLY_FRAGMENT)).toHaveCount(2);
  });
});

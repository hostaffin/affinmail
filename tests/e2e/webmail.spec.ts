import { test, expect } from '@playwright/test';

test.describe('AffinMail Gmail-Grade Webmail Client E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('loads inbox with brand and user information', async ({ page }) => {
    await expect(page.locator('text=AffinMail')).toBeVisible();
    await expect(page.locator('text=apexlogistics.com')).toBeVisible();
    await expect(page.locator('text=Marcus Vance')).toBeVisible();
  });

  test('toggles Enterprise Light and Dark theme with persistent data-theme attribute', async ({ page }) => {
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Click theme switcher
    const themeBtn = page.locator('button[title*="Switch to Dark Mode"]');
    await themeBtn.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Toggle back to light
    const lightBtn = page.locator('button[title*="Switch to Light Mode"]');
    await lightBtn.click();
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('supports Gmail keyboard shortcut "c" to open docked compose modal', async ({ page }) => {
    await page.keyboard.press('c');
    await expect(page.locator('text=New Message')).toBeVisible();
    await expect(page.locator('input[placeholder="client@enterprise.com"]')).toBeVisible();
  });

  test('navigates threads using "j" and "k" and opens with "Enter"', async ({ page }) => {
    // Navigate down
    await page.keyboard.press('j');
    // Open thread
    await page.keyboard.press('Enter');
    await expect(page.locator('text=Security Verified')).toBeVisible();
    await expect(page.locator('text=Back to list')).toBeVisible();

    // Escape back to list
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Payment Receipt #AF-1092')).toBeVisible();
  });

  test('displays plan-driven attachment guard error when file exceeds limit', async ({ page }) => {
    await page.keyboard.press('c');
    await page.fill('input[placeholder="client@enterprise.com"]', 'partner@enterprise.com');
    await page.fill('input[placeholder="Project Handover & Documentation..."]', 'Quarterly Budget');

    // Trigger oversize file validation via file input
    // Verifies client side byte guard rejects files > planLimitMb
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('button[title*="Attach files"]').click();
    const fileChooser = await fileChooserPromise;
    
    // Simulate setting a 30MB file buffer
    await fileChooser.setFiles({
      name: 'Oversize_Archive.zip',
      mimeType: 'application/zip',
      buffer: Buffer.alloc(30 * 1024 * 1024),
    });

    // Expect alert toast
    await expect(page.locator('text=exceeds your hosting plan\'s attachment limit of 25 MB')).toBeVisible();
  });

  test('supports mobile viewport with responsive hamburger drawer', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const menuBtn = page.locator('button[aria-label="Toggle navigation menu"]');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    await expect(page.locator('role=dialog')).toBeVisible();
    await expect(page.locator('text=Navigation')).toBeVisible();
  });
});

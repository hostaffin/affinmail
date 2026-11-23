import { expect, test } from '@playwright/test';

/**
 * AffinMail webmail SPA E2E.
 *
 * Runs against the production build served by `vite preview` on
 * http://127.0.0.1:4173 with `/jmap` proxied to local Stalwart.
 * No mock data names: assertions match text rendered by webmail/src/App.tsx,
 * components/Login.tsx and components/HeaderBar.tsx.
 *
 * Login flows are opt-in via AM_TEST_USER / AM_TEST_PASS and are skipped when
 * those env vars are absent, so the spec passes on a bare box.
 */

const TEST_USER = process.env.AM_TEST_USER;
const TEST_PASS = process.env.AM_TEST_PASS;

test.describe('AffinMail webmail shell', () => {
  test('serves the built SPA with AffinMail branding', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();

    await expect(page.getByText(/Affin/i).first()).toBeVisible();
    // Login.tsx heading + subtitle (unauthenticated default view).
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Use your AffinMail address and password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('shows a validation error when submitting an empty form', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email and password are required.')).toBeVisible();
  });

  test('theme toggle switches cached preference once signed in', async ({ page }) => {
    test.skip(!TEST_USER || !TEST_PASS, 'AM_TEST_USER/AM_TEST_PASS not set');

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.fill('input[type="email"]', TEST_USER!);
    await page.fill('input[type="password"]', TEST_PASS!);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // HeaderBar only renders after auth; its theme button title is
    // `Switch to ${theme === 'light' ? 'Dark' : 'Light'} mode`.
    const toDark = page.getByTitle('Switch to Dark mode');
    await expect(toDark).toBeVisible({ timeout: 15_000 });
    await toDark.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const toLight = page.getByTitle('Switch to Light mode');
    await expect(toLight).toBeVisible();
    await toLight.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('compose button opens the compose sheet after login', async ({ page }) => {
    test.skip(!TEST_USER || !TEST_PASS, 'AM_TEST_USER/AM_TEST_PASS not set');

    await page.goto('/');
    await page.fill('input[type="email"]', TEST_USER!);
    await page.fill('input[type="password"]', TEST_PASS!);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // NavigationSidebar compose control (aria-label="Compose") — click the
    // visible one (icon form when collapsed, pill form when expanded).
    const compose = page.getByRole('button', { name: 'Compose' }).first();
    await expect(compose).toBeVisible({ timeout: 15_000 });
    await compose.click();

    // DockedComposeModal renders a Subject field and its own close control.
    await expect(page.getByPlaceholder('Subject')).toBeVisible();
  });
});

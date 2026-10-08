import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const owner = () => JSON.parse(readFileSync('test-results/.e2e-owner.json', 'utf8')) as { email: string; password: string };

async function login(page: Page) {
  const { email, password } = owner();
  await page.goto('/login');
  await page.getByLabel('ایمیل').fill(email);
  await page.getByLabel('رمز عبور').fill(password);
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
}

test.describe('access control', () => {
  test('signed-out visitors are redirected and APIs refuse', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    expect((await request.get('/api/tasks')).status()).toBe(401);
    expect((await request.get('/api/export')).status()).toBe(401);
    // no public sign-up: there is no route that creates accounts
    expect((await request.post('/api/auth/register', { data: {} })).status()).toBe(404);
  });

  test('state-changing requests from another origin are rejected', async ({ request }) => {
    const r = await request.post('/api/tasks', { headers: { origin: 'https://evil.example' }, data: { title: 'x' } });
    expect(r.status()).toBe(403);
  });

  test('wrong password is rejected', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('ایمیل').fill(owner().email);
    await page.getByLabel('رمز عبور').fill('not-the-password');
    await page.getByRole('button', { name: 'ورود' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'درست نیست' })).toBeVisible();
  });
});

test('login → quick capture → shows in Today → complete', async ({ page }, info) => {
  await login(page);
  const title = `خرید نان ${info.project.name}`;
  await page.getByRole('button', { name: 'ثبت سریع' }).click();
  await page.getByRole('dialog').locator('textarea').fill(`امروز ساعت ۱۱:۵۰ شب ${title}`);
  await page.getByRole('button', { name: 'ادامه' }).click();
  const dialog = page.getByRole('dialog', { name: 'بررسی و ثبت' });
  await expect(dialog.getByLabel('عنوان')).toHaveValue(title);
  await dialog.getByRole('button', { name: 'ثبت', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const row = page.locator('li', { has: page.getByRole('link', { name: title }) }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('۲۳:۵۰');
  await page.screenshot({ path: `test-results/today-${info.project.name}.png`, fullPage: true });

  await row.getByRole('button', { name: 'انجام شد' }).click();
  await expect(row.getByRole('button', { name: 'برگرداندن به انجام‌نشده' })).toBeVisible();
  // persisted: still done after reload
  await page.reload();
  await expect(page.locator('li', { has: page.getByRole('link', { name: title }) }).first().getByRole('button', { name: 'برگرداندن به انجام‌نشده' })).toBeVisible();
});

test('deadline capture with inferred year and renewal', async ({ page }, info) => {
  await login(page);
  await page.getByRole('button', { name: 'ثبت سریع' }).click();
  await page.getByRole('dialog').locator('textarea').fill(`بیمه موتور ${info.project.name} دوازده آبان تموم می‌شه؛ یه هفته قبل یادم بنداز`);
  await page.getByRole('button', { name: 'ادامه' }).click();
  const dialog = page.getByRole('dialog', { name: 'بررسی و ثبت' });
  await expect(dialog).toContainText('سال گفته نشده بود');
  await dialog.getByRole('button', { name: 'ثبت', exact: true }).click();
  await page.goto('/dates');
  const card = page.locator('li', { hasText: `بیمه موتور ${info.project.name}` });
  await expect(card).toContainText('آبان');
  await card.getByRole('button', { name: /تمدید شد/ }).click();
  await page.getByRole('button', { name: 'ثبت تمدید' }).click();
  await expect(card).toContainText('سابقهٔ تمدید');
  await page.screenshot({ path: `test-results/dates-${info.project.name}.png`, fullPage: true });
});

test('pages have no horizontal overflow on this viewport', async ({ page }) => {
  await login(page);
  for (const path of ['/', '/tasks', '/dates', '/settings', '/tasks/new']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});

test('PWA basics: manifest and service worker', async ({ page, request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m).toMatchObject({ display: 'standalone', dir: 'rtl', start_url: '/' });
  expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  const sw = await request.get('/sw.js');
  expect(sw.headers()['content-type']).toContain('javascript');
  expect(await sw.text()).toContain("url.pathname.startsWith('/api/')");
  await page.goto('/login');
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(registered).toBe(true);
});

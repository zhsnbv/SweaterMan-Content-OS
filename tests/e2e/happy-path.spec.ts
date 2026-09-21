import { test, expect, type Page } from '@playwright/test';

/**
 * Browser happy path for the three flows the brief calls out:
 * week generation, card edit, report upload.
 *
 * Runs against the deterministic provider and the local store
 * (see playwright.config.ts) so it needs no credentials.
 */

async function resetWorkspace(page: Page) {
  await page.request.post('/api/demo', { data: { action: 'clear' } });
  await page.request.post('/api/demo', { data: { action: 'seed' } });
}

test.beforeEach(async ({ page }) => {
  await resetWorkspace(page);
});

test('week generation puts cards on the calendar', async ({ page }) => {
  await page.request.post('/api/demo', { data: { action: 'clear' } });
  await page.goto('/week');

  await expect(page.getByText('На эту неделю ничего не запланировано')).toBeVisible();

  // Nothing to plan from yet, so seed production data first.
  await page.getByRole('button', { name: /Загрузить demo-данные/ }).click();
  await expect(page.getByText(/Backstage V027/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /Generate \/ Update week/ }).click();

  // The copilot opens with the plan it produced. Scope to the drawer: the
  // success toast carries the same sentence.
  const copilot = page.getByRole('dialog');
  await expect(copilot.getByText(/собрана:/)).toBeVisible({ timeout: 30_000 });
  await expect(copilot.getByText('create_week_plan')).toBeVisible();

  await page.keyboard.press('Escape');

  // Cards are on the board, across more than one day.
  const cards = page.locator('[class*="cursor-pointer"]').filter({ hasText: /V027|Тест темы/ });
  expect(await cards.count()).toBeGreaterThan(2);
});

test('a card edit changes only that card and records a revision', async ({ page }) => {
  await page.goto('/week');
  const card = page.getByText(/Что не вошло в V027/).first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  const otherTitle = await page.getByText(/Backstage V027/).first().innerText();
  await card.click();

  await expect(page.getByRole('dialog')).toBeVisible();
  const chat = page.getByPlaceholder('Скажите, что изменить в этой карточке…');
  await chat.fill('Это долго делать. Сделай версию максимум на 10 минут работы');
  await page.getByRole('dialog').getByRole('button').last().click();

  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(/Изменил только CU-/)).toBeVisible({ timeout: 30_000 });
  // The reply and the card's own "AI reasoning" both mention the effort drop.
  await expect(drawer.getByText(/effort → XS/).first()).toBeVisible();

  // Revision recorded and restorable.
  await page.getByRole('button', { name: /^Activity/ }).click();
  await expect(page.getByRole('button', { name: 'Restore' }).first()).toBeVisible();

  // The neighbouring card is untouched.
  await page.keyboard.press('Escape');
  await expect(page.getByText(otherTitle.split('\n')[0])).toBeVisible();
});

test('publishing then confirming a report completes the 24h window', async ({ page }) => {
  await page.goto('/week');
  await page.getByText(/Что не вошло в V027/).first().click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /^Platforms/ }).click();
  await page.getByPlaceholder('https://… ссылка на публикацию').first().fill('https://example.com/p/1');
  await page.getByRole('button', { name: 'Published', exact: true }).click();
  await expect(page.getByText(/24h report due|Published ✓/).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /^Analytics/ }).click();
  await page.getByRole('button', { name: /24h/ }).first().click();

  // Step 1: extraction (no screenshot → nothing invented).
  await page.getByRole('button', { name: /Извлечь метрики/ }).click();
  await expect(page.getByText(/впишите показатели вручную/)).toBeVisible({ timeout: 30_000 });

  // Step 2: the user supplies the number and confirms.
  await page.getByPlaceholder('NA').first().fill('12345');
  await page.getByRole('button', { name: /Подтвердить и сохранить/ }).click();

  await expect(page.getByText('✅ Report added')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('confirmed')).toBeVisible();
  await expect(page.getByText(/Sample size = 1/)).toBeVisible();
});

test('a weekly review is produced and shown on Insights', async ({ page }) => {
  await page.goto('/insights');
  await page.getByRole('button', { name: /Review previous week/ }).click();
  await expect(page.getByText(/Review .* готов|Weekly reviews ещё не делались/)).toBeVisible({
    timeout: 30_000,
  });
});

test('context page shows the persistent memory layers', async ({ page }) => {
  await page.goto('/context');
  await expect(page.getByText('A · Immutable')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('B · Operational')).toBeVisible();
  await expect(page.getByText('C · Learnings')).toBeVisible();
  await expect(page.getByText('D · Weekly data')).toBeVisible();
  await expect(page.getByRole('heading', { name: /MASTER CONTEXT/ })).toBeVisible();
});

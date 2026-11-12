import { test, expect } from '@playwright/test';
import { seedFirstRun } from './firstRunSeed';

// Keep the first-boot interstitials from opening - their backdrops would
// swallow the first click. The seed also clears any persisted
// artifact.frame-play-delay, so this test gets the default 1s pause it assumes.
test.beforeEach(async ({ page }) => {
  await seedFirstRun(page);
});

test('the Play button steps through the frames and disables on the last one', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.frame-timeline')).toBeVisible();

  // Three frames total (each [+] duplicates the last and switches to it), then
  // go back to the first.
  const add = page.locator('.frame-timeline-add');
  await add.click();
  await add.click();
  await page.locator('.frame-timeline-card').first().click();
  await expect(page.locator('.frame-timeline-card[aria-current="true"]')).toHaveAttribute('data-idx', '0');

  const play = page.locator('.frame-timeline-play');
  await expect(play).toBeEnabled();
  await play.click();

  // Two ~0.3s transitions + the 1s default pause between them: give it room.
  await expect(page.locator('.frame-timeline-card[aria-current="true"]'))
    .toHaveAttribute('data-idx', '2', { timeout: 10_000 });
  await expect(play).toBeDisabled();
});

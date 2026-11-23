import { test, expect } from '@playwright/test';
import { TEXT_MODELS } from '../src/app/models.js';
import { MODEL_USAGE, modelEvidence, modelCoverage } from '../src/app/model-capabilities.js';
for (const width of [1440, 390])
  test(`${width}px 모델 선택에 지원 범위·실측 기록·제약을 표시`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?model=off');
    await page.waitForFunction(() => window.__roomggu?.ready());
    await page.evaluate(() => window.__roomggu.store.openTool('ai'));
    for (const m of Object.values(TEXT_MODELS)) {
      const card = page.locator(`[data-model=${m.key}]`);
      await expect(card).toContainText(MODEL_USAGE[m.key]);
      await expect(card).toContainText(modelEvidence(m.key));
      await expect(card).toContainText(modelCoverage(m.key));
      await expect(card).toHaveAttribute('aria-describedby', `model-cap-${m.key}`);
    }
    await expect(page.locator('.model-evidence-context')).toContainText('같은 6문장');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });

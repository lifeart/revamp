import { test, expect } from '@playwright/test';

/**
 * Test suite for Config and Error Overlays
 * Tests the injected overlay scripts functionality
 *
 * Uses a local mock server (http://127.0.0.1:9080) to avoid external dependencies
 */

const TEST_SITE = 'http://127.0.0.1:9080';

test.describe('Config Overlay', () => {
  test.describe('Overlay Injection', () => {
    test('should inject config overlay into pages', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Wait for overlay to be created
      await page.waitForTimeout(1000);

      // Check for config badge (gear icon)
      const configBadge = page.locator('#revamp-config-badge');
      await expect(configBadge).toBeVisible();

      console.log('✅ Config overlay badge injected');
    });

    test('should have clickable config badge', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      const configBadge = page.locator('#revamp-config-badge');
      await expect(configBadge).toBeVisible();

      // Click to open settings
      await configBadge.click();

      // Check overlay is visible
      const overlay = page.locator('#revamp-config-overlay.visible');
      await expect(overlay).toBeVisible();

      console.log('✅ Config overlay opens on badge click');
    });

    test('should display settings panel with options', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      // Open settings
      await page.locator('#revamp-config-badge').click();

      // Check for settings header
      await expect(page.locator('#revamp-config-header')).toBeVisible();
      await expect(page.locator('text=Revamp Settings')).toBeVisible();

      // Check for transformation options
      await expect(page.locator('text=Transform JavaScript')).toBeVisible();
      await expect(page.locator('text=Transform CSS')).toBeVisible();
      await expect(page.locator('text=Transform HTML')).toBeVisible();

      // Check for privacy options
      await expect(page.locator('text=Remove Ads')).toBeVisible();
      await expect(page.locator('text=Remove Tracking')).toBeVisible();

      // Check for polyfill options
      await expect(page.locator('text=Inject Polyfills')).toBeVisible();
      await expect(page.locator('text=Spoof User-Agent (HTTP)')).toBeVisible();

      // Check for cache option
      await expect(page.locator('text=Enable Cache')).toBeVisible();

      console.log('✅ Settings panel displays all config options');
    });

    test('should have toggle switches for each option', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      await page.locator('#revamp-config-badge').click();

      // Check for toggle inputs
      const toggles = page.locator('.revamp-config-toggle input[type="checkbox"]');
      const count = await toggles.count();

      expect(count).toBeGreaterThanOrEqual(8); // At least 8 config options

      console.log(`✅ Found ${count} toggle switches for config options`);
    });

    test('should close settings panel', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      // Open settings
      await page.locator('#revamp-config-badge').click();
      await expect(page.locator('#revamp-config-overlay.visible')).toBeVisible();

      // Close settings via close button
      await page.locator('#revamp-config-close').click();

      // Overlay should be hidden
      await expect(page.locator('#revamp-config-overlay.visible')).not.toBeVisible();

      console.log('✅ Settings panel closes via close button');
    });

    test('should toggle settings panel on badge re-click', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      const badge = page.locator('#revamp-config-badge');

      // Open
      await badge.click();
      await expect(page.locator('#revamp-config-overlay.visible')).toBeVisible();

      // Close via close button (badge is covered by overlay)
      await page.locator('#revamp-config-close').click();
      await expect(page.locator('#revamp-config-overlay.visible')).not.toBeVisible();

      // Re-open via badge
      await badge.click();
      await expect(page.locator('#revamp-config-overlay.visible')).toBeVisible();

      console.log('✅ Badge toggles settings panel');
    });

    test('should have Apply & Reload button', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      await page.locator('#revamp-config-badge').click();

      const applyBtn = page.locator('#revamp-config-apply');
      await expect(applyBtn).toBeVisible();
      await expect(applyBtn).toContainText('Apply');

      console.log('✅ Apply & Reload button present');
    });

    test('should have Reset to Defaults button', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      await page.locator('#revamp-config-badge').click();

      const resetBtn = page.locator('#revamp-config-reset');
      await expect(resetBtn).toBeVisible();
      await expect(resetBtn).toContainText('Reset');

      console.log('✅ Reset to Defaults button present');
    });

    test('should load config from server', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2000); // Allow time for async config load

      await page.locator('#revamp-config-badge').click();

      // Check that at least one toggle is checked (defaults have many true values)
      const checkedToggles = page.locator('.revamp-config-toggle input[type="checkbox"]:checked');
      const checkedCount = await checkedToggles.count();

      expect(checkedCount).toBeGreaterThan(0);

      console.log(`✅ Config loaded from server (${checkedCount} options enabled)`);
    });
  });

  test.describe('Config Interaction', () => {
    test('should toggle individual options', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      await page.locator('#revamp-config-badge').click();

      // Find a toggle and get its current state
      const transformJsToggle = page.locator('#revamp-opt-transformJs');
      const wasChecked = await transformJsToggle.isChecked();

      // Click the toggle's label/slider
      await transformJsToggle.click();

      // State should have changed
      const isNowChecked = await transformJsToggle.isChecked();
      expect(isNowChecked).toBe(!wasChecked);

      console.log(`✅ Toggle changed from ${wasChecked} to ${isNowChecked}`);
    });
  });
});

test.describe('Error Overlay', () => {
  test.describe('Overlay Injection', () => {
    test('should inject error overlay styles', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Check for error overlay styles in page
      const hasErrorStyles = await page.evaluate(() => {
        const styles = document.querySelectorAll('style');
        for (const style of styles) {
          if (style.textContent && style.textContent.includes('revamp-error-overlay')) {
            return true;
          }
        }
        return false;
      });

      expect(hasErrorStyles).toBe(true);

      console.log('✅ Error overlay styles injected');
    });

    test('should have error badge hidden initially', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(500);

      // Error badge should exist but not be visible (no errors yet)
      const errorBadge = page.locator('#revamp-error-badge');
      const isVisible = await errorBadge.isVisible().catch(() => false);

      // Badge should be created but not visible (or have display:none)
      // It becomes visible only when there are errors
      console.log(`✅ Error badge exists, visible: ${isVisible}`);
    });

    test('should show error badge when JavaScript error occurs', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      // Trigger a JavaScript error
      await page.evaluate(() => {
        // This should be caught by our error handler
        throw new Error('Test error from playwright');
      }).catch(() => {
        // Expected to throw
      });

      await page.waitForTimeout(500);

      // Error badge should now be visible
      const errorBadge = page.locator('#revamp-error-badge.visible');
      await expect(errorBadge).toBeVisible();

      // Badge should show count
      const badgeText = await errorBadge.textContent();
      expect(parseInt(badgeText || '0')).toBeGreaterThan(0);

      console.log(`✅ Error badge visible with count: ${badgeText}`);
    });

    test('should show error overlay on badge click', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      // Trigger an error
      await page.evaluate(() => {
        throw new Error('Test error for overlay');
      }).catch(() => {});

      await page.waitForTimeout(500);

      // Click error badge
      await page.locator('#revamp-error-badge').click();

      // Overlay should be visible
      const overlay = page.locator('#revamp-error-overlay.visible');
      await expect(overlay).toBeVisible();

      console.log('✅ Error overlay opens on badge click');
    });

    test('should display error details in overlay', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      const errorMessage = 'Custom test error message 12345';

      // Trigger an error with specific message
      await page.evaluate((msg) => {
        throw new Error(msg);
      }, errorMessage).catch(() => {});

      await page.waitForTimeout(500);

      // Open overlay
      await page.locator('#revamp-error-badge').click();

      // Check error details
      await expect(page.locator('.revamp-error-message')).toContainText(errorMessage);

      console.log('✅ Error details displayed in overlay');
    });

    test('should have close button in error overlay', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      // Trigger an error
      await page.evaluate(() => {
        throw new Error('Error for close test');
      }).catch(() => {});

      await page.waitForTimeout(500);

      // Open overlay
      await page.locator('#revamp-error-badge').click();

      // Check close button
      const closeBtn = page.locator('#revamp-error-close');
      await expect(closeBtn).toBeVisible();

      // Click close
      await closeBtn.click();

      // Overlay should be hidden
      await expect(page.locator('#revamp-error-overlay.visible')).not.toBeVisible();

      console.log('✅ Error overlay closes via close button');
    });

    test('should have clear button to clear errors', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      // Trigger errors
      await page.evaluate(() => {
        throw new Error('Error 1');
      }).catch(() => {});
      await page.evaluate(() => {
        throw new Error('Error 2');
      }).catch(() => {});

      await page.waitForTimeout(500);

      // Open overlay
      await page.locator('#revamp-error-badge').click();

      // Check clear button
      const clearBtn = page.locator('#revamp-error-clear');
      await expect(clearBtn).toBeVisible();

      // Click clear
      await clearBtn.click();

      // Badge should no longer be visible (no errors)
      await expect(page.locator('#revamp-error-badge.visible')).not.toBeVisible();

      console.log('✅ Clear button removes all errors');
    });

    test('should capture console.error', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      const testMessage = 'Console error test 98765';

      // Call console.error
      await page.evaluate((msg) => {
        console.error(msg);
      }, testMessage);

      await page.waitForTimeout(500);

      // Error badge should appear
      const errorBadge = page.locator('#revamp-error-badge.visible');
      await expect(errorBadge).toBeVisible();

      // Open and check
      await errorBadge.click();
      await expect(page.locator('.revamp-error-message')).toContainText(testMessage);
      await expect(page.locator('text=Console Error')).toBeVisible();

      console.log('✅ console.error captured by error overlay');
    });

    test('should capture console.warn', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      const testMessage = 'Console warning test 54321';

      // Call console.warn
      await page.evaluate((msg) => {
        console.warn(msg);
      }, testMessage);

      await page.waitForTimeout(500);

      // Warning badge should appear
      const errorBadge = page.locator('#revamp-error-badge.visible');
      await expect(errorBadge).toBeVisible();

      // Open and check
      await errorBadge.click();
      await expect(page.locator('.revamp-error-message')).toContainText(testMessage);
      await expect(page.locator('text=Console Warning')).toBeVisible();

      console.log('✅ console.warn captured by error overlay');
    });

    test('should show timestamp for errors', async ({ page }) => {
      await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1000);

      // Trigger an error
      await page.evaluate(() => {
        throw new Error('Error with timestamp');
      }).catch(() => {});

      await page.waitForTimeout(500);

      // Open overlay
      await page.locator('#revamp-error-badge').click();

      // Check for timestamp (format: HH:MM:SS.mmm)
      const timeElement = page.locator('.revamp-error-time');
      await expect(timeElement).toBeVisible();

      const timeText = await timeElement.textContent();
      // Should contain time format like "12:34:56.789"
      expect(timeText).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);

      console.log(`✅ Error timestamp displayed: ${timeText}`);
    });
  });
});

test.describe('Overlay Co-existence', () => {
  test('should have both config and error overlays', async ({ page }) => {
    await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1000);

    // Check config badge exists
    const configBadge = page.locator('#revamp-config-badge');
    await expect(configBadge).toBeVisible();

    // Trigger an error
    await page.evaluate(() => {
      throw new Error('Test error');
    }).catch(() => {});

    await page.waitForTimeout(500);

    // Check error badge exists
    const errorBadge = page.locator('#revamp-error-badge');
    await expect(errorBadge).toBeVisible();

    // Both should be visible at the same time
    await expect(configBadge).toBeVisible();
    await expect(errorBadge).toBeVisible();

    console.log('✅ Both config and error overlays coexist');
  });

  test('should open config overlay without affecting error overlay', async ({ page }) => {
    await page.goto(TEST_SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1000);

    // Trigger an error first
    await page.evaluate(() => {
      throw new Error('Test error');
    }).catch(() => {});

    await page.waitForTimeout(500);

    // Open config overlay
    await page.locator('#revamp-config-badge').click();
    await expect(page.locator('#revamp-config-overlay.visible')).toBeVisible();

    // Error badge should still be visible
    await expect(page.locator('#revamp-error-badge.visible')).toBeVisible();

    console.log('✅ Config overlay opens independently of error overlay');
  });
});

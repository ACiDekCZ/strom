import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * Per-tree research keys in localStorage go with their tree: at a delete, and
 * at start for trees deleted before that cleanup existed.
 */
test('research keys of trees no longer here are dropped at start; those of present trees stay', async ({ page }) => {
    await openApp(page);
    const kept = await page.evaluate(() => {
        const id = window.Strom.TreeManager.getActiveTreeId()!;
        localStorage.setItem(`strom-research-auto:${id}`, '{"toldRefused":["no-ids"]}');
        localStorage.setItem('strom-research-auto:tree_1791036418657_lxkng', '{"toldRefused":["x"]}');
        localStorage.setItem('strom-research-base-fp:tree_1791027656321_jwyae', 'v2-1-2-3');
        localStorage.setItem('strom-research-written:tree_1791027656321_jwyae', '{}');
        localStorage.setItem('strom-research-auto-intro-seen', '1');
        return id;
    });
    await page.reload();
    await page.waitForFunction(() => !!window.Strom?.TreeManager?.getActiveTreeId());
    const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-research-')).sort());
    expect(keys).toContain(`strom-research-auto:${kept}`);
    expect(keys).toContain('strom-research-auto-intro-seen');
    expect(keys.filter(k => /lxkng|jwyae/.test(k))).toEqual([]);
});

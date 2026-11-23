import { test, expect } from '@playwright/test';
import { openApp, seedTree, reloadApp } from './helpers.js';

/**
 * One research, one tree for trees tied before that rule (package 134 point
 * 13): an older copy still tied to the original's research (`copy: true`) is
 * taken off it at the next start, once — its data untouched, the original
 * keeping the research — and its first opening says so once, with how the
 * research takes back what the copy sent there.
 */

const R = '7a1d3c5e-2b4f-4a6c-8e0d-1f3b5d7e9a2c';
const COPY = 'Habrovi – kopie z jara (zkouška)';

test('an older copy tied to the original\'s research: taken off it at the next start, said once at its opening', async ({ page }) => {
    await openApp(page);
    await seedTree(page, { j: { firstName: 'Jaroslav', lastName: 'Habr' } }, 'Habrovi');
    const origId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    await seedTree(page, { j: { firstName: 'Jaroslav', lastName: 'Habr' } }, COPY);
    const copyId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    // As an older app left them: both tied to one research, the copy marked so, its send after it was made.
    await page.evaluate(async ({ origId, copyId, R }) => {
        const tm = window.Strom.TreeManager;
        const syncedAt = new Date().toISOString();
        tm.setResearchLink(origId, { id: R, fingerprint: 'fp0', syncedAt, sendMode: 'auto' });
        tm.setResearchLink(copyId, {
            id: R, fingerprint: 'fp0', syncedAt, sendMode: 'auto', copy: true,
            sent: { fingerprint: 'fp1', at: new Date(Date.now() + 60_000).toISOString(), changes: 3, head: '', state: 'written', intake: 'in-1' },
        });
        delete (tm as unknown as { index: { researchTiesRepaired?: string } }).index.researchTiesRepaired;
        tm.setActiveTree(copyId);
        await tm.flush();
    }, { origId, copyId, R });

    await reloadApp(page);
    const notice = page.locator('#research-detached-modal');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`The tree “${COPY}” was a copy tied to the research of the tree “Habrovi”.`);
    await expect(notice).toContainText('Before that, the copy sent changes to that research');
    await expect(notice.locator('.research-detached-cmd')).toHaveText('strom sync undo I…');
    await expect(notice.locator('.research-detached-sent .research-open-mark')).toBeVisible();

    const metas = await page.evaluate(({ origId, copyId }) => ({
        orig: window.Strom.TreeManager.getTreeMetadata(origId),
        copy: window.Strom.TreeManager.getTreeMetadata(copyId),
    }), { origId, copyId });
    expect(metas.copy.research).toBeUndefined();
    expect(metas.copy.copyOf).toEqual({ treeId: origId, name: 'Habrovi' });
    expect(metas.copy.researchDetached?.link.copy).toBe(true);
    expect(metas.orig.research?.id).toBe(R);
    expect(metas.copy.personCount).toBe(1);

    await notice.locator('[data-dismiss]').click();
    await expect(notice).toBeHidden();
    // Once: not at the next start, not at the next opening.
    await reloadApp(page);
    await page.evaluate((id) => window.Strom.UI.switchToTree(id), origId);
    await page.evaluate((id) => window.Strom.UI.switchToTree(id), copyId);
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(COPY);
    await expect(notice).toBeHidden();
    expect(await page.evaluate(() => window.Strom.TreeManager.getTreeMetadata(window.Strom.TreeManager.getActiveTreeId()!).research)).toBeUndefined();
});

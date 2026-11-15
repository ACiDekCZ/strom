import { test, expect, Page } from '@playwright/test';
import { seedSetting } from './helpers.js';
import { fakeBridge, openResearch, openResearchMenu, poll, block, editJan, FakeBridge } from './research-bridge.js';

/**
 * Changes the research did not take, named (spec 095 K3.4, mock-ups 4a–4f):
 * a research with `sync.notWritten.codes` that took nothing of a send but
 * named its changes is "The research did not take 3 changes · Show", never
 * "nothing new"; "What was written" lists each as "person · fact · source"
 * with its reason by the code ("not taken" for a code without a text); the
 * block of the send says it too. A send with nothing to name is "nothing new"
 * as before; a research without the feature as before. Invented data.
 */

const CODES = 'sync.notWritten.codes';
const DESKTOP = { width: 1440, height: 900 };

/** Took nothing: a citation kept (an older app), a main citation not set (skipped), a code the app does not know. */
const NOT_TAKEN = {
    ok: true, inbox: false, changes: 0, applied: 0, intake: 'R20261115101500123-a1b2',
    notWritten: [
        { kind: 'fact.uncite', person: 'P0003', fact: 'BIRT', source: 'S0001', why: 'report', code: 'cite.olderApp', params: { person: 'P0003', fact: 'BIRT', event: 'E0001', source: 'S0001' } },
        { kind: 'fact.edit', person: 'P0003', fact: 'DEAT', code: 'some.futureCode', params: { person: 'P0003', fact: 'DEAT' } },
    ],
    skipped: [{ n: 1, kind: 'fact.main', why: 'not cited', code: 'main.notCarried', params: { family: 'F0001', fact: 'MARR', source: 'S0001' } }],
};

async function sendAnswered(page: Page, body: unknown, features: string[]): Promise<FakeBridge> {
    await openResearch(page);
    const b = await fakeBridge(page, { features, syncReply: { status: 200, body } });
    await poll(page);
    await editJan(page, 'Kolín');
    await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
    await expect.poll(() => b.posts.length).toBe(1);
    return b;
}

const panel = (page: Page) => page.locator('#research-changes-panel');
const rows = (page: Page) => panel(page).locator('.research-changes-row.is-not-written');

test.describe('changes the research did not take, named', () => {
    test.use({ viewport: DESKTOP });

    test('took nothing, three named: "did not take 3 changes · Show", the list with three rows, the block', { tag: '@smoke' }, async ({ page }) => {
        await sendAnswered(page, NOT_TAKEN, [CODES, 'sync.removed']);
        const toast = page.locator('.toast');
        await expect(toast).toContainText('The research did not take 3 changes. They stay here in the app.');
        await expect(toast).not.toContainText('nothing new');
        await expect(toast.getByRole('button', { name: 'Show' })).toBeVisible();
        await toast.getByRole('button', { name: 'Show' }).click();

        await expect(panel(page).locator('.research-changes-section.is-warn')).toHaveText('Not written · 3');
        await expect(rows(page)).toHaveCount(3);
        const line = (i: number) => rows(page).nth(i).locator('.research-changes-line');
        const why = (i: number) => rows(page).nth(i).locator('.research-changes-why');
        await expect(line(0)).toHaveText('Jan Fíšek·Birth·Oddací matrika Čapkov');
        await expect(why(0)).toHaveText('citation kept in the research: this version of the app does not send removals yet');
        await expect(line(1)).toHaveText('Jan Fíšek·Death');
        await expect(why(1)).toHaveText('not taken');
        // The skipped main citation, by the research's family: the couple, the man first.
        await expect(line(2)).toHaveText('Josef Fíšek and Anna Svobodová·Marriage·Oddací matrika Čapkov');
        await expect(why(2)).toHaveText('main citation not set: the research did not take this citation');
        // No research mark on any of it; the person opens here.
        await expect(panel(page).locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await rows(page).nth(1).locator('button[data-person]').click();
        await expect(panel(page)).toHaveCount(0);

        // The block of the send: "The research did not take 3 changes".
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'notWritten');
        await expect(block(page)).toContainText('The research did not take 3 changes');
        await expect(block(page)).not.toContainText('Written 0');
    });

    test('a source in a row opens its viewer', async ({ page }) => {
        await sendAnswered(page, NOT_TAKEN, [CODES]);
        await page.evaluate(() => window.Strom.UI.showResearchChanges('written'));
        await rows(page).nth(0).locator('button[data-source]').click();
        await expect(page.locator('#source-viewer-modal')).toHaveClass(/active/);
    });

    test('took nothing and named nothing: "nothing new" as before', async ({ page }) => {
        await sendAnswered(page, { ok: true, inbox: false, changes: 0, applied: 0, intake: 'R20261115101500123-a1b3' }, [CODES]);
        await expect(page.locator('.toast')).toHaveText(/The research took nothing new from this send\./);
        await openResearchMenu(page);
        await expect(block(page)).not.toHaveAttribute('data-state', 'notWritten');
    });

    test('a research without the feature: as before (no codes, "nothing new", the old reasons)', async ({ page }) => {
        await sendAnswered(page, NOT_TAKEN, ['sync.removed']);
        // Today's last word on such a send: the skipped change's toast (it follows "nothing new").
        await expect(page.locator('.toast')).toHaveText(/skipped 1 change/);
        await page.evaluate(() => window.Strom.UI.showResearchChanges('written'));
        // Today's rows: Jan once by the first item, the second as his too, the skipped one not listed.
        await expect(rows(page)).toHaveCount(2);
        await expect(rows(page).locator('.research-changes-why')).toHaveText([
            'removed here only: the research noted the removal but deletes nothing by itself; it can be deleted in the research',
            'The research gave no reason.',
        ]);
        await expect(panel(page).locator('[data-kind="coded"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await openResearchMenu(page);
        await expect(block(page)).toContainText('Written 0, not written 2');
    });
});

for (const v of [
    { name: 'phone 390', size: { width: 390, height: 844 } },
    { name: 'phone sideways 844', size: { width: 844, height: 390 } },
    { name: 'tablet 1024', size: { width: 1024, height: 768 } },
    { name: 'desktop 1440', size: { width: 1440, height: 900 } },
]) {
    for (const dark of [false, true]) {
        test(`German, ${v.name}${dark ? ', dark' : ''}: the toast, the list and the block fit`, async ({ page }) => {
            await page.setViewportSize(v.size);
            if (dark) await page.emulateMedia({ colorScheme: 'dark' });
            await seedSetting(page, 'language', 'de');
            await sendAnswered(page, NOT_TAKEN, [CODES]);
            const toast = page.locator('.toast');
            await expect(toast).toContainText('Die Forschung hat 3 Änderungen nicht übernommen. Die Änderungen bleiben hier in der App.');
            const tb = (await toast.boundingBox())!;
            expect(tb.x).toBeGreaterThanOrEqual(0);
            expect(tb.x + tb.width).toBeLessThanOrEqual(v.size.width);
            await page.evaluate(() => window.Strom.UI.showResearchChanges('written'));
            await expect(rows(page)).toHaveCount(3);
            await expect(rows(page).nth(1).locator('.research-changes-why')).toHaveText('nicht übernommen');
            const pb = (await panel(page).boundingBox())!;
            expect(pb.x).toBeGreaterThanOrEqual(0);
            expect(pb.x + pb.width).toBeLessThanOrEqual(v.size.width);
            for (let i = 0; i < 3; i++) {
                const row = (await rows(page).nth(i).boundingBox())!;
                expect(row.x + row.width).toBeLessThanOrEqual(pb.x + pb.width + 0.5);
                // Nothing in the row runs past it.
                const spill = await rows(page).nth(i).evaluate(el => [...el.querySelectorAll('*')].some(c => {
                    const r = c.getBoundingClientRect(), o = el.getBoundingClientRect();
                    return r.width > 0 && (r.right > o.right + 0.5 || r.left < o.left - 0.5);
                }));
                expect(spill).toBe(false);
            }
            // The reason is legible: its colour differs from the row's background.
            const [fg, bg] = await rows(page).nth(0).evaluate(el => [getComputedStyle(el.querySelector('.research-changes-why')!).color, getComputedStyle(el).backgroundColor]);
            expect(fg).not.toBe(bg);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
            await page.keyboard.press('Escape');
            await openResearchMenu(page);
            await expect(block(page)).toContainText('3 Änderungen nicht übernommen');
            const bb = (await block(page).boundingBox())!;
            expect(bb.x + bb.width).toBeLessThanOrEqual(v.size.width);
        });
    }
}

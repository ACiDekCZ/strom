import { test, expect, Page } from '@playwright/test';
import { NEW_HEAD, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * "Load the research version?" (data protection 3.2): every value here the
 * research's version changes or removes, one row each, what it adds, the
 * backup — and, when the tree only loads from the research, said in amber
 * that these values go ("Load and overwrite", or open it as a copy).
 */

const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const dialog = (page: Page) => page.locator('#research-load-modal');
const head = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);

/** Values here the research's version does not have: three people, ten values. */
async function editMany(page: Page): Promise<void> {
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const by = (n: string) => (Object.values(dm.getData().persons) as any[]).find(p => p.firstName === n);
        dm.updatePerson(by('Jan').id, { birthPlace: 'Kolín', deathPlace: 'Brno', deathDate: '1932', notes: 'kovář', deathCause: 'tyfus' });
        dm.updatePerson(by('Josef').id, { birthPlace: 'Lipany', deathPlace: 'Chlumec', notes: 'sedlák' });
        dm.updatePerson(by('Anna').id, { birthPlace: 'Hořice', deathPlace: 'Jičín' });
    });
}

test.describe('loading the research version', () => {
    test('only loading: the values here that go, 8 rows then "and N more" (expand, hide), the amber box, Load and overwrite', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: ACCEPTS });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.setResearchSendMode(window.Strom.TreeManager.getActiveTreeId()!, 'off'));
        await editMany(page);
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD, ['1 OCCU tesař']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText('Load the research version?');
        await expect(dialog(page).locator('.research-load-warn')).toHaveText('Changes from this tree are not sent to the research. These values here will be overwritten by the research version.');
        await expect(dialog(page).locator('thead')).toContainText('Person · 3');
        await expect(dialog(page).locator('thead')).toContainText('here → from research');
        const rows = dialog(page).locator('tbody tr');
        await expect(rows).toHaveCount(10);
        await expect(dialog(page).locator('tbody tr:visible')).toHaveCount(8);
        // A row: the person on its first row only, the fact, the value here struck through → none there.
        const jan = dialog(page).locator('tbody tr', { hasText: 'Birth · Place' }).filter({ hasText: 'Kolín' });
        await expect(jan.locator('.research-load-here')).toHaveText('Kolín');
        await expect(jan.locator('.research-load-there')).toHaveText('–');
        const more = dialog(page).locator('#research-load-more');
        await expect(more).toHaveText('and 2 more');
        await more.click();
        await expect(dialog(page).locator('tbody tr:visible')).toHaveCount(10);
        await expect(more).toHaveText('Hide');
        await more.click();
        await expect(dialog(page).locator('tbody tr:visible')).toHaveCount(8);
        await expect(dialog(page).locator('.research-load-added')).toHaveText('Added from the research: 1 fact');
        await expect(dialog(page).locator('.research-load-backup')).toHaveText('A backup is saved before loading; it can be restored.');
        await expect(dialog(page).getByRole('button', { name: 'Open as copy' })).toBeVisible();
        await dialog(page).getByRole('button', { name: 'Load and overwrite' }).click();
        await expect.poll(() => head(page)).toBe(NEW_HEAD);
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Jan').birthPlace ?? '')).toBe('');
    });

    test('Cancel and Escape load nothing; a tree unchanged since: Load, nothing overwritten', async ({ page }) => {
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: ACCEPTS });
        await poll(page);
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD, ['1 BIRT', '2 PLAC Praha', '1 OCCU tesař']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('.research-load-warn')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        expect(await head(page)).not.toBe(NEW_HEAD);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        expect(await head(page)).not.toBe(NEW_HEAD);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await expect(dialog(page).getByRole('button', { name: 'Open as copy' })).toHaveCount(0);
        await dialog(page).locator('#research-load-ok').click();
        await expect.poll(() => head(page)).toBe(NEW_HEAD);
    });

    test('a married surname the research\'s version has and the tree here not: a row "– → Novák", not an added fact', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: ACCEPTS });
        await poll(page);
        bridge.head = NEW_HEAD;
        // Jan's record (the last before the family) gets the married NAME.
        bridge.treeGed = researchGed(NEW_HEAD, ['1 NAME Jan /Novák/', '2 TYPE married']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await expect(dialog(page)).toBeVisible();
        const row = dialog(page).locator('tbody tr', { hasText: 'Married surname' });
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('Jan Fíšek');
        await expect(row.locator('.research-load-here')).toHaveText('–');
        await expect(row.locator('.research-load-there')).toHaveText('Novák');
        await expect(dialog(page).locator('.research-load-added')).toHaveCount(0);
        await dialog(page).locator('#research-load-ok').click();
        await expect.poll(() => head(page)).toBe(NEW_HEAD);
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Jan').marriedSurname)).toBe('Novák');
    });

    test('a married surname suggestion hidden here stays hidden after the research\'s version loads (K3.1)', async ({ page }) => {
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: ACCEPTS });
        await poll(page);
        const anna = () => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Anna').dismissedMarriedSuggestion);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const id = (Object.values(dm.getData().persons) as any[]).find(p => p.firstName === 'Anna').id;
            dm.updatePerson(id, { dismissedMarriedSuggestion: 'Nováková' });
        });
        expect(await anna()).toBe('Nováková');
        // Nothing to send: hiding it leaves the tree in step with the research.
        await expect(page.locator('#research-menu-btn')).toHaveAttribute('aria-label', 'Research');
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD, ['1 OCCU tesař']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await dialog(page).locator('#research-load-ok').click();
        await expect.poll(() => head(page)).toBe(NEW_HEAD);
        expect(await anna()).toBe('Nováková');
    });
});

test.describe('loading the research version: surname-variant groups', () => {
    const withGroups = (ged: string, groups: string[]) =>
        ged.replace('1 NOTE Fíškovi', ['1 NOTE Fíškovi', '1 NOTE Strom surname-variant groups', ...groups.map(g => `2 CONT ${g}`)].join('\n'));
    const groups = (page: Page) => page.evaluate(() => window.Strom.DataManager.getData().surnameVariants ?? null);

    test('a version without the groups keeps those of the tree; a version with groups brings its own', async ({ page }) => {
        await page.clock.install();
        await openResearch(page, { ged: withGroups(researchGed(), ['Fíšek | Fyšek']) });
        const bridge = await fakeBridge(page, { accepts: ACCEPTS });
        await poll(page);
        expect(await groups(page)).toEqual([['Fíšek', 'Fyšek']]);
        // A research that does not read the groups' NOTE sends its version without it.
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD, ['1 OCCU tesař']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await dialog(page).locator('#research-load-ok').click();
        await expect.poll(() => head(page)).toBe(NEW_HEAD);
        expect(await groups(page)).toEqual([['Fíšek', 'Fyšek']]);
        // Kept, the tree is still in step with the research: nothing waits to be sent.
        await expect(page.locator('#research-menu-btn')).toHaveAttribute('aria-label', 'Research');
        // A version with groups is the research's word.
        const third = 'a1b2c3d4e5f6';
        bridge.head = third;
        bridge.treeGed = withGroups(researchGed(third, ['1 OCCU tesař']), ['Fíšek | Fyšek | Fischek', 'Kmínková | Kminkowa']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await dialog(page).locator('#research-load-ok').click();
        await expect.poll(() => head(page)).toBe(third);
        expect(await groups(page)).toEqual([['Fíšek', 'Fyšek', 'Fischek'], ['Kmínková', 'Kminkowa']]);
    });
});

test.describe('loading the research version: a note line by line', () => {
    const HERE_NOTE = 'Kovář v Smrkově.\n\nOženil se 1865 v Čapkově.';
    for (const width of [1440, 390]) {
        test(`${width} px: the research only added a paragraph – the note here not struck through, only the new paragraph marked`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.clock.install();
            await openResearch(page);
            const bridge = await fakeBridge(page, { accepts: ACCEPTS });
            await poll(page);
            await page.evaluate(() => window.Strom.UI.setResearchSendMode(window.Strom.TreeManager.getActiveTreeId()!, 'off'));
            await page.evaluate((note) => {
                const dm = window.Strom.DataManager;
                const jan = (Object.values(dm.getData().persons) as any[]).find(p => p.firstName === 'Jan');
                dm.updatePerson(jan.id, { notes: note });
            }, HERE_NOTE);
            bridge.head = NEW_HEAD;
            bridge.treeGed = researchGed(NEW_HEAD, ['1 NOTE Kovář v Smrkově.', '2 CONT', '2 CONT Oženil se 1865 v Čapkově.', '2 CONT', '2 CONT Křest v matrice Smrkov, fol. 12.']);
            await poll(page);
            await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
            await expect(dialog(page)).toBeVisible();
            const row = dialog(page).locator('tbody tr', { hasText: 'Note' });
            await expect(row).toHaveCount(1);
            const note = row.locator('.research-load-note');
            await expect(note).toBeVisible();
            // Nothing of the text here struck through: its lines kept as they are.
            await expect(row.locator('.research-load-here')).toHaveCount(0);
            await expect(note.locator('del')).toHaveCount(0);
            await expect(note.locator('.research-load-line--same').filter({ hasText: 'Kovář v Smrkově.' })).toHaveCount(1);
            await expect(note.locator('.research-load-line--same').filter({ hasText: 'Oženil se 1865 v Čapkově.' })).toHaveCount(1);
            expect(await note.locator('.research-load-line--same').first().evaluate(e => getComputedStyle(e).textDecorationLine)).toBe('none');
            // Only the new paragraph marked new.
            const added = note.locator('ins');
            await expect(added.filter({ hasText: /\S/ })).toHaveText(['Křest v matrice Smrkov, fol. 12.']);
            expect(await added.last().evaluate(e => getComputedStyle(e).fontWeight)).toBe('600');
            // Within the dialog.
            expect(await dialog(page).locator('.modal').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
            await dialog(page).locator('#research-load-ok').click();
            await expect.poll(() => head(page)).toBe(NEW_HEAD);
            expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Jan').notes))
                .toBe(`${HERE_NOTE}\n\nKřest v matrice Smrkov, fol. 12.`);
        });
    }

    test('a changed line: the old one struck through, the new one marked, the rest kept', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: ACCEPTS });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.setResearchSendMode(window.Strom.TreeManager.getActiveTreeId()!, 'off'));
        await page.evaluate((note) => {
            const dm = window.Strom.DataManager;
            const jan = (Object.values(dm.getData().persons) as any[]).find(p => p.firstName === 'Jan');
            dm.updatePerson(jan.id, { notes: note });
        }, HERE_NOTE);
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD, ['1 NOTE Kovář a sedlák v Smrkově.', '2 CONT', '2 CONT Oženil se 1865 v Čapkově.']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        const note = dialog(page).locator('tbody tr', { hasText: 'Note' }).locator('.research-load-note');
        await expect(note.locator('del')).toHaveText(['Kovář v Smrkově.']);
        await expect(note.locator('ins')).toHaveText(['Kovář a sedlák v Smrkově.']);
        await expect(note.locator('.research-load-line--same').filter({ hasText: 'Oženil se 1865 v Čapkově.' })).toHaveCount(1);
        expect(await note.locator('del').evaluate(e => getComputedStyle(e).textDecorationLine)).toBe('line-through');
    });
});

import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card, focusViaSearch } from './helpers.js';

/**
 * A child with one known parent, made either way in the app: "Add child"
 * (a "?" for the other parent) and "Add parent" with one parent. Both are
 * the same family: drawn in the family view under that parent, the other
 * parent added later takes the "?" place (one family), and a GEDCOM or JSON
 * there and back keeps it — no nameless person, nothing doubled.
 */

const persons = (page: Page) => page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons)
    .map((p: any) => ({ name: p.firstName, placeholder: p.isPlaceholder, parents: p.parentIds.length })));
const unionCount = (page: Page) => page.evaluate(() => Object.keys(window.Strom.DataManager.getData().partnerships).length);
const parentsOf = (page: Page, first: string) => page.evaluate((first) => {
    const d = window.Strom.DataManager.getData();
    const p = (Object.values(d.persons) as any[]).find(x => x.firstName === first);
    return p.parentIds.map((id: string) => d.persons[id as never].isPlaceholder ? '?' : d.persons[id as never].firstName).sort();
}, first);

test.describe('a child with one known parent', () => {
    test('"Add parent" with the father only: drawn as his child in the family view; the mother added later takes the "?" place', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Ida', 'Berg', 'female');
        await addRelation(page, 'Ida', 'parent', 'Ole', 'Berg');
        expect(await parentsOf(page, 'Ida')).toEqual(['?', 'Ole']);
        expect(await unionCount(page)).toBe(1);
        // From the father: Ida drawn below him.
        await focusViaSearch(page, 'Ole');
        await expect(card(page, 'Ida')).toBeVisible();
        // The mother later, from Ida: one family, no "?" left.
        await focusViaSearch(page, 'Ida');
        await addRelation(page, 'Ida', 'parent', 'Marta', 'Berg', 'female');
        expect(await parentsOf(page, 'Ida')).toEqual(['Marta', 'Ole']);
        expect(await unionCount(page)).toBe(1);
        expect((await persons(page)).filter(p => p.placeholder)).toHaveLength(0);
    });

    test('"Add child" to one person: the "?" family; the other parent added later from the child takes its place', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Ole', 'Berg', 'male');
        await addRelation(page, 'Ole', 'child', 'Ida', 'Berg', 'female');
        expect(await parentsOf(page, 'Ida')).toEqual(['?', 'Ole']);
        await focusViaSearch(page, 'Ida');
        // "Add parent" is offered although Ida has two parents: one is only the "?".
        await addRelation(page, 'Ida', 'parent', 'Marta', 'Berg', 'female');
        expect(await parentsOf(page, 'Ida')).toEqual(['Marta', 'Ole']);
        expect(await unionCount(page)).toBe(1);
        expect((await persons(page)).filter(p => p.placeholder)).toHaveLength(0);
    });

    test('GEDCOM and JSON there and back, both ways: no nameless person, the same families, the child still drawn under its parent', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Ole', 'Berg', 'male');
        await addRelation(page, 'Ole', 'child', 'Ida', 'Berg', 'female');
        await focusViaSearch(page, 'Ida');
        await addRelation(page, 'Ida', 'sibling', 'Kari', 'Berg', 'female');
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const nils = dm.createPerson({ firstName: 'Nils', lastName: 'Berg', gender: 'male' });
            const anna = dm.createPerson({ firstName: 'Anna', lastName: 'Berg', gender: 'female' });
            dm.addParentChild(anna.id, nils.id);
            dm.ensureSingleParentFamilies();
        });
        const shape = async () => ({
            real: (await persons(page)).filter(p => !p.placeholder).map(p => p.name).sort(),
            standIns: (await persons(page)).filter(p => p.placeholder).length,
            unions: await unionCount(page),
            ida: await parentsOf(page, 'Ida'), kari: await parentsOf(page, 'Kari'), nils: await parentsOf(page, 'Nils'),
        });
        const before = await shape();
        expect(before).toMatchObject({ standIns: 2, unions: 2, ida: ['?', 'Ole'], nils: ['?', 'Anna'] });

        // GEDCOM: exported, read back as a new tree.
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.evaluate(() => window.Strom.UI.exportTargetTreeGedcom());
        const pwd = page.locator('#export-password-modal');
        await pwd.locator('#export-privacy-mode').selectOption('full');
        const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
        const fs = await import('node:fs');
        const text = fs.readFileSync(await download.path(), 'utf8');
        expect(text).not.toContain('1 NAME //');
        expect(text.split(/\r?\n/).filter(l => / INDI$/.test(l))).toHaveLength(5);
        await page.locator('#gedcom-input').setInputFiles(await download.path());
        const result = page.locator('#gedcom-result-modal');
        await expect(result).toBeVisible();
        await result.locator('#gedcom-new-tree-btn').click();
        const dialog = page.locator('#import-tree-modal');
        await dialog.locator('#import-tree-name').fill('Back from GEDCOM');
        await dialog.getByRole('button', { name: 'Import' }).click();
        await expect(dialog).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.name)).toBe('Back from GEDCOM');
        expect(await shape()).toEqual(before);
        // Drawn as Ole's children (the tree opens on him).
        await page.evaluate(() => {
            const d = window.Strom.DataManager.getData();
            const ole = (Object.values(d.persons) as any[]).find(p => p.firstName === 'Ole');
            (window.Strom as any).TreeRenderer?.setFocus?.(ole.id);
        });
        await expect(card(page, 'Ole')).toBeVisible();
        await expect(card(page, 'Ida')).toBeVisible();
        await expect(card(page, 'Kari')).toBeVisible();

        // JSON: the stored tree read back as it was stored.
        const json = await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData()));
        await page.evaluate(async (json) => {
            await window.Strom.DataManager.importAsNewTree(JSON.parse(json), 'Back from JSON');
            window.Strom.UI.updateTreeSwitcher();
        }, json);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.name)).toBe('Back from JSON');
        expect(await shape()).toEqual(before);
    });
});

test.describe('a child with one known parent and the research', () => {
    test('what goes to the research has no "?" person; its version back has one "?" for the family, the tie kept', async ({ page }) => {
        const { openResearch, fakeBridge, poll, researchGed, acceptLoad } = await import('./research-bridge.js');
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        await poll(page);
        await addRelation(page, 'Jan', 'child', 'Ida', 'Víšková', 'female');
        expect(await parentsOf(page, 'Ida')).toEqual(['?', 'Jan']);
        const head = 'ab12cd34ef56';
        bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0060' } };
        bridge.onWrite = () => ({ head, ged: researchGed(head) });
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(1);
        const sent = bridge.posts[0];
        expect(sent).not.toContain('1 NAME //');
        expect(sent).toMatch(/0 @F\d+@ FAM\n1 HUSB @I\d+@\n1 CHIL @I\d+@\n0 /);
        // The research's version with the child and its one-parent family.
        bridge.head = 'cd34ef56ab12';
        bridge.treeGed = researchGed('cd34ef56ab12', ['1 FAMS @F0002@', '0 @P0004@ INDI', '1 NAME Ida /Víšková/', '1 SEX F', '1 REFN P0004', '2 TYPE strom-research', '1 FAMC @F0002@',
            '0 @F0002@ FAM', '1 HUSB @P0003@', '1 CHIL @P0004@']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await acceptLoad(page);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('cd34ef56ab12');
        expect(await parentsOf(page, 'Ida')).toEqual(['?', 'Jan']);
        expect((await persons(page)).filter(p => p.placeholder)).toHaveLength(1);
        expect(await unionCount(page)).toBe(2);
    });
});

import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Citations of the birth and the death on their own (Person.birthSourceIds /
 * deathSourceIds): the "Source" rows under those fields in the person editor,
 * the "Supports" choice when citing from the person's sources, citing from
 * the tree-health walk, and the source viewer naming the fact.
 */

async function tree(page: Page, persons: Record<string, Record<string, unknown>>, advanced = false): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async ({ persons, advanced }) => {
        window.Strom.SettingsManager.setAdvancedFields(advanced);
        const full: Record<string, unknown> = {};
        for (const [id, p] of Object.entries(persons)) {
            full[id] = { id, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p };
        }
        await window.Strom.DataManager.importAsNewTree({
            persons: full, partnerships: {},
            sources: { s1: { id: 's1', title: 'Matrika N Lipany 1840–1870' }, s2: { id: 's2', title: 'Sčítání 1880' } },
        } as never, 'Citace');
    }, { persons, advanced });
}

const person = (page: Page, id: string) => page.evaluate((pid) => window.Strom.DataManager.getPerson(pid as never), id);

test.describe('birth and death citations', () => {
    test('a birth cited on its own shows under the birth even with advanced fields off', { tag: '@smoke' }, async ({ page }) => {
        await tree(page, { j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865', birthSourceIds: ['s1'] } });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('j' as never));
        const birth = page.locator('#birth-sources-group');
        await expect(birth).toBeVisible();
        await expect(birth.locator('.source-chip')).toContainText('Matrika N Lipany');
        // The person as a whole cites nothing: that section stays hidden.
        await expect(page.locator('#person-sources-section')).toBeHidden();
        // A living person: no death row.
        await expect(page.locator('#death-sources-group')).toBeHidden();
    });

    test('"+ source" under the birth cites the birth: two stripes without a death', async ({ page }) => {
        await tree(page, { j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865' } }, true);
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('j' as never));
        await page.locator('#birth-sources-group .fact-cite-btn').click();
        const picker = page.locator('#source-picker-modal');
        await expect(picker).toBeVisible();
        // A fixed context: no "Supports" choice here.
        await expect(picker.locator('#source-picker-fact')).toBeHidden();
        await picker.locator('.source-picker-item', { hasText: 'Matrika' }).click();
        expect((await person(page, 'j'))?.birthSourceIds).toEqual(['s1']);
        await expect(page.locator('#birth-sources-group .source-chip')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(card(page, 'Jan').locator(':scope > .card-state .st-ev i')).toHaveCount(2);
    });

    test('"Another page" of a book in the picker: a new source with its title, archive, link, note and quality — its own page, cited there; nothing else copied', async ({ page }) => {
        await tree(page, { j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865', deathDate: '1932', birthSourceIds: ['s1'] } }, true);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            dm.updateSource('s1', { repository: 'SOA Zámrsk', url: 'https://example.org/kniha', note: 'Kniha N\nMatrika N, fol. 12 / Zapsáno: 1865', quality: 3,
                reference: 'fol. 12', transcript: 'Anno 1865', refn: 'S0001' } as never);
        });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('j' as never));
        await page.locator('#death-sources-group .fact-cite-btn').click();
        const picker = page.locator('#source-picker-modal');
        await picker.locator('.source-picker-row', { hasText: 'Matrika' }).getByRole('button', { name: 'Another page' }).click();
        const editor = page.locator('#source-editor-modal');
        await expect(editor).toBeVisible();
        await expect(editor.locator('#input-source-title')).toHaveValue('Matrika N Lipany 1840–1870');
        await expect(editor.locator('#input-source-repository')).toHaveValue('SOA Zámrsk');
        await expect(editor.locator('#input-source-reference')).toHaveValue('');
        await expect(editor.locator('#input-source-reference')).toBeFocused();
        await expect(editor.locator('#input-source-transcript')).toHaveValue('');
        await editor.locator('#input-source-reference').fill('fol. 99');
        await editor.getByRole('button', { name: 'Save' }).click();
        await expect(editor).toBeHidden();
        const j = await person(page, 'j');
        expect(j?.deathSourceIds).toHaveLength(1);
        expect(j?.birthSourceIds).toEqual(['s1']);
        const page2 = await page.evaluate((id) => window.Strom.DataManager.getData().sources![id], j!.deathSourceIds![0]);
        expect(page2).toMatchObject({ title: 'Matrika N Lipany 1840–1870', repository: 'SOA Zámrsk', url: 'https://example.org/kniha',
            note: 'Kniha N', quality: 3, reference: 'fol. 99' });
        expect(page2.transcript ?? '').toBe('');
        expect(page2.refn).toBeUndefined();
        expect(page2.excerpts ?? []).toEqual([]);
    });

    test('V-D: "Another page" keeps the book of the reference (the page left to type, the cursor at its end), not the entry\'s recording date', async ({ page }) => {
        await tree(page, { j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865', deathDate: '1932', birthSourceIds: ['s1'] } }, true);
        await page.evaluate(() => {
            window.Strom.DataManager.updateSource('s1', { note: 'Farní úřad Voss\nZapsáno: 20 MAR 1825', reference: 'Voss, Ministerialbok 1820–1835, s. 112' } as never);
        });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('j' as never));
        await page.locator('#death-sources-group .fact-cite-btn').click();
        await page.locator('#source-picker-modal .source-picker-row', { hasText: 'Matrika' }).getByRole('button', { name: 'Another page' }).click();
        const ref = page.locator('#source-editor-modal #input-source-reference');
        await expect(ref).toHaveValue('Voss, Ministerialbok 1820–1835, s. ');
        await expect(ref).toBeFocused();
        expect(await ref.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe('Voss, Ministerialbok 1820–1835, s. '.length);
        await page.keyboard.type('113');
        await page.locator('#source-editor-modal').getByRole('button', { name: 'Save' }).click();
        const j = await person(page, 'j');
        const page2 = await page.evaluate((id) => window.Strom.DataManager.getData().sources![id], j!.deathSourceIds![0]);
        expect(page2).toMatchObject({ reference: 'Voss, Ministerialbok 1820–1835, s. 113', note: 'Farní úřad Voss' });
    });

    test('"Another page" of an entry titled after another person: the title made from what is cited, not that person\'s', async ({ page }) => {
        await tree(page, {
            j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865', deathDate: '1932' },
            o: { firstName: 'Ota', lastName: 'Hora', birthDate: '1915', birthSourceIds: ['s3'] },
        }, true);
        await page.evaluate(() => {
            window.Strom.DataManager.getData().sources!['s3' as never] = { id: 's3', title: 'Baptism of Ota Hora 1915', reference: 'fol. 15' } as never;
        });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('j' as never));
        await page.locator('#birth-sources-group .fact-cite-btn').click();
        await page.locator('#source-picker-modal .source-picker-row', { hasText: 'Ota Hora' }).getByRole('button', { name: 'Another page' }).click();
        const title = page.locator('#source-editor-modal #input-source-title');
        await expect(title).not.toHaveValue(/Ota Hora/);
        await expect(title).toHaveValue(/Jan Víšek/);
    });

    test('× on the death chip takes the citation off the death only', async ({ page }) => {
        await tree(page, { j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865', deathDate: '1932', sourceIds: ['s1'], deathSourceIds: ['s1'] } });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('j' as never));
        const death = page.locator('#death-sources-group');
        await expect(death).toBeVisible();
        await death.locator('.source-chip-remove').click();
        const j = await person(page, 'j');
        expect(j?.deathSourceIds).toBeUndefined();
        expect(j?.sourceIds).toEqual(['s1']);
    });

    test('citing from the person\'s sources asks what it supports; no death for the living', async ({ page }) => {
        await tree(page, { j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865' } });
        await page.evaluate(() => window.Strom.UI.showPersonSourcesDialog('j' as never));
        await page.locator('#person-sources-cite').click();
        const fact = page.locator('#source-picker-fact');
        await expect(fact).toBeVisible();
        // The birth has no source yet: it is the one picked first.
        await expect(fact.locator('.segment-btn')).toHaveText(['Person', 'Birth']);
        await expect(fact.locator('.segment-btn.active')).toHaveText('Birth');
        await fact.locator('.segment-btn', { hasText: 'Person' }).click();
        await page.locator('#source-picker-modal .source-picker-item', { hasText: 'Sčítání' }).click();
        const j = await person(page, 'j');
        expect(j?.sourceIds).toEqual(['s2']);
        expect(j?.birthSourceIds).toBeUndefined();
        // The dialog lists it on the person; the birth row appears once cited.
        await expect(page.locator('#person-sources-modal')).toContainText('Sčítání 1880');
    });

    test('a dead person with the birth cited: the choice starts on the person and offers the death', async ({ page }) => {
        await tree(page, { j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865', deathDate: '1932', birthSourceIds: ['s1'] } });
        await page.evaluate(() => window.Strom.UI.showPersonSourcesDialog('j' as never));
        await page.locator('#person-sources-cite').click();
        const fact = page.locator('#source-picker-fact');
        await expect(fact.locator('.segment-btn')).toHaveText(['Person', 'Birth', 'Death']);
        await expect(fact.locator('.segment-btn.active')).toHaveText('Person');
        // Birth already cites s1: switching there leaves it out of the list.
        await fact.locator('.segment-btn', { hasText: 'Birth' }).click();
        await expect(page.locator('#source-picker-modal .source-picker-item', { hasText: 'Matrika' })).toHaveCount(0);
    });

    test('tree health: going through births without a source, Cite takes the person off the list', async ({ page }) => {
        await tree(page, {
            j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865', sourceIds: ['s2'] },
            a: { firstName: 'Anna', lastName: 'Víšková', gender: 'female', birthDate: '1870', sourceIds: ['s2'] },
        });
        await page.evaluate(() => window.Strom.UI.showTreeHealthDialog(window.Strom.DataManager.getCurrentTreeId()));
        await page.locator('[data-evidence="birthNoSource"]').click();
        const pill = page.locator('#evidence-pill');
        await expect(pill).toContainText('· 2');
        await expect(pill.locator('.evidence-pill-cite')).toHaveCount(0);
        await pill.locator('.evidence-pill-next').click();
        await pill.locator('.evidence-pill-cite').click();
        await page.locator('#source-picker-modal .source-picker-item', { hasText: 'Matrika' }).click();
        await expect(pill).toContainText('Births without a source · 1');
        const cited = await page.evaluate(() => ['j', 'a'].filter(id => window.Strom.DataManager.getPerson(id as never)?.birthSourceIds?.length));
        expect(cited).toHaveLength(1);
    });

    test('the source viewer names the fact with its year', async ({ page }) => {
        await tree(page, { j: { firstName: 'Jan', lastName: 'Víšek', birthDate: '1865', birthSourceIds: ['s1'] } });
        await page.evaluate(() => window.Strom.UI.showSourceViewer('s1', null));
        await expect(page.locator('#source-viewer-modal .viewer-cites')).toContainText('Jan Víšek — Birth (1865)');
    });
});

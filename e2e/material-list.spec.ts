/**
 * Material for a list of people (spec 137 §6–§7) against a stub of the
 * research: "Concerns" offered by `media.list` (from a source only with
 * `media.list.source`), the list sent once before the files (`PUT lists/<ref>`)
 * with each file's `X-Strom-List-Ref` and `X-Strom-Person` (≤ 50 people: all;
 * over 50: the dialog person), a lost list (`404 media.no-list`) sent again,
 * a refused list keeping the dialog open, files waiting with the list, the
 * keyboard and the phone's bottom sheet. Invented data only.
 */

import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, researchGed, HEAD } from './research-bridge.js';

const DESKTOP = { width: 1440, height: 900 };
const AVATAR = 'e2e/fixtures/avatar.png';
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true, tasks: 'open' } };
const LISTS = ['media.list'];
const SOURCE_LISTS = ['media.list', 'media.list.source'];

/** A person the research does not know yet (no research number), and `big` more people it knows (P0100…). */
function ged(big = 0): string {
    const extra = ['0 @I0900@ INDI', '1 NAME Karel /Bezčíselný/', '1 SEX M'];
    for (let i = 0; i < big; i++) {
        extra.push(`0 @P${100 + i}@ INDI`, `1 NAME Testo${i} /Vymyšlený/`, '1 SEX M', `1 REFN P${String(100 + i).padStart(4, '0')}`, '2 TYPE strom-research');
    }
    return researchGed(HEAD, extra);
}

/** A fixed list of the people with these first names (or every person but Jan, with `all`). */
async function makeList(page: Page, name: string, firstNames: string[] | 'all'): Promise<void> {
    await page.evaluate(({ name, firstNames }) => {
        const dm = window.Strom.DataManager;
        const persons = Object.values(dm.getData().persons) as { id: string; firstName: string }[];
        const ids = persons.filter(p => firstNames === 'all' ? p.firstName !== 'Jan' : firstNames.includes(p.firstName)).map(p => p.id);
        dm.createPersonList({ name, dynamic: false, personIds: ids as never });
    }, { name, firstNames });
}

async function openForJan(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
}

async function openForSource(page: Page): Promise<void> {
    await page.evaluate(() => {
        const src = Object.values(window.Strom.DataManager.getData().sources ?? {}).find((s: any) => s.refn === 'S0001') as any;
        (window.Strom.UI as any).showMaterialDialog({ sourceId: src.id });
    });
}

async function chooseList(page: Page, name: string): Promise<void> {
    await page.locator('#material-concern').click();
    await page.locator('#material-concern-menu .material-concern-opt', { hasText: name }).click();
    await expect(page.locator('#material-concern-menu')).toHaveCount(0);
}

test.describe('material for a list of people', () => {
    test.use({ viewport: DESKTOP });

    test('a research without media.list: no "Concerns", the files go to the person', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: ['media.links'] });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Sčítání 1921', ['Josef', 'Anna']);
        await poll(page);
        await openForJan(page);
        await expect(page.locator('#material-modal .material-drop')).toBeVisible();
        await expect(page.locator('#material-concern')).toHaveCount(0);
        await page.locator('#material-input').setInputFiles(AVATAR);
        await page.getByRole('button', { name: 'Send 1 file' }).click();
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        expect(b.mediaPuts[0].headers['x-strom-list-ref']).toBeUndefined();
        expect(b.listPuts ?? []).toEqual([]);
    });

    test('up to 50 people: the list goes first, each file names it and every known person', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: LISTS });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Sčítání 1921', ['Josef', 'Anna', 'Karel']);
        await poll(page);
        await openForJan(page);
        const dialog = page.locator('#material-modal');
        await expect(dialog.locator('#material-concern')).toContainText('Jan Fíšek');
        // The field is the first of the form.
        await expect(dialog.locator('.modal-content > :first-child')).toHaveClass(/material-concern-wrap/);
        await page.locator('#material-concern').click();
        const menu = page.locator('#material-concern-menu');
        await expect(menu.locator('.material-concern-group')).toHaveText(['Person', 'List of people']);
        await expect(menu.locator('.material-concern-opt', { hasText: 'Sčítání 1921' })).toContainText('3 people');
        await menu.locator('.material-concern-opt', { hasText: 'Sčítání 1921' }).click();
        await expect(dialog.locator('.audit-log-subtitle')).toHaveText('List Sčítání 1921 · 3 people');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        const box = dialog.locator('.material-box');
        await expect(box).toContainText('with every person on the list (3)');
        await expect(box).toContainText('People on the list the research does not know yet (1)');
        await expect(dialog.locator('.material-attach .confirm-check-hint b')).toHaveText('Jan Fíšek');
        await dialog.locator('#material-attach').check();
        await expect(box.locator('b')).toHaveText('Jan Fíšek');
        await dialog.locator('#material-attach').uncheck();
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast')).toContainText('Sent to the research: 1 file for the list “Sčítání 1921” (3 people)');
        expect(b.listPuts).toHaveLength(1);
        const put = b.listPuts![0];
        expect(put.ref).toMatch(/^L[0-9a-f]{24}$/);
        expect(put.body).toMatchObject({ name: 'Sčítání 1921', kind: 'fixed', persons: ['P0003', 'P0001', 'P0002'], missing: 1 });
        expect(typeof put.body.at).toBe('string');
        expect(b.mediaPuts).toHaveLength(1);
        expect(b.mediaPuts[0].headers['x-strom-list-ref']).toBe(put.ref);
        expect(b.mediaPuts[0].headers['x-strom-person']).toBe('P0003,P0001,P0002');
    });

    test('over 50 people: the whole list, each file names only the dialog person', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: LISTS });
        await openResearch(page, { media: true, ged: ged(52) });
        await makeList(page, 'Všichni Vymyšlení', 'all');
        await poll(page);
        await openForJan(page);
        await chooseList(page, 'Všichni Vymyšlení');
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await expect(dialog.locator('.material-box')).toContainText('with the list (55 people)');
        await expect(dialog.locator('.material-box')).toContainText('The list has more than 50 people');
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        expect((b.listPuts![0].body.persons as string[])).toHaveLength(55);
        expect(b.listPuts![0].body.missing).toBe(1);
        expect(b.mediaPuts[0].headers['x-strom-person']).toBe('P0003');
        expect(b.mediaPuts[0].headers['x-strom-list-ref']).toBe(b.listPuts![0].ref);
    });

    test('the bridge lost the list (404 media.no-list): the list again, the file once more', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: LISTS, listLostOnce: true });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Sčítání 1921', ['Josef', 'Anna']);
        await poll(page);
        await openForJan(page);
        await chooseList(page, 'Sčítání 1921');
        await page.locator('#material-input').setInputFiles(AVATAR);
        await page.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast')).toContainText('for the list “Sčítání 1921”');
        expect(b.listPuts).toHaveLength(2);
        expect(b.mediaPuts).toHaveLength(2);
        expect(b.mediaPuts[1].headers['x-strom-list-ref']).toBe(b.listPuts![1].ref);
    });

    test('a list the research refuses: no file goes, the dialog stays open', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: LISTS, listPutStatus: 413 });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Sčítání 1921', ['Josef', 'Anna']);
        await poll(page);
        await openForJan(page);
        await chooseList(page, 'Sčítání 1921');
        await page.locator('#material-input').setInputFiles(AVATAR);
        await page.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast')).toContainText('The list could not be sent to the research; the files stay in the dialog.');
        await expect(page.locator('#material-modal .material-item')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Send 1 file' })).toBeEnabled();
        expect(b.listPuts).toHaveLength(1);
        expect(b.mediaPuts).toHaveLength(0);
    });

    test('a list the research knows nobody of: offered, the files go to the person alone', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: LISTS });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Neznámí', ['Karel']);
        await poll(page);
        await openForJan(page);
        await page.locator('#material-concern').click();
        await expect(page.locator('#material-concern-menu .material-concern-opt', { hasText: 'Neznámí' })).toContainText('the research does not know these people yet');
        await page.locator('#material-concern-menu .material-concern-opt', { hasText: 'Neznámí' }).click();
        await page.locator('#material-input').setInputFiles(AVATAR);
        await expect(page.locator('#material-modal .material-box')).toContainText('People on the list the research does not know yet (1)');
        await page.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast')).toContainText('Sent to the research: 1 file for Jan Fíšek');
        expect(b.listPuts ?? []).toEqual([]);
        expect(b.mediaPuts[0].headers['x-strom-person']).toBe('P0003');
        expect(b.mediaPuts[0].headers['x-strom-list-ref']).toBeUndefined();
    });

    test('from a source: "Concerns" only with media.list.source', async ({ page }) => {
        await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: LISTS });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Sčítání 1921', ['Josef', 'Anna']);
        await poll(page);
        await openForSource(page);
        await expect(page.locator('#material-modal .material-drop')).toBeVisible();
        await expect(page.locator('#material-concern')).toHaveCount(0);
    });

    test('from a source with media.list.source: the source and the list in each file', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: SOURCE_LISTS });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Sčítání 1921', ['Josef', 'Anna']);
        await poll(page);
        await openForSource(page);
        const dialog = page.locator('#material-modal');
        await expect(dialog.locator('#material-concern')).toContainText('Source only');
        await page.locator('#material-concern').click();
        await expect(page.locator('#material-concern-menu .material-concern-group')).toHaveText(['Source', 'List of people']);
        await page.locator('#material-concern-menu .material-concern-opt', { hasText: 'Sčítání 1921' }).click();
        await expect(dialog.locator('.audit-log-subtitle')).toHaveText('for the source Oddací matrika Čapkov · List Sčítání 1921 · 2 people');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await expect(dialog.locator('.material-box')).toContainText('with the source and every person on the list (2)');
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        expect(b.listPuts![0].body.persons).toEqual(['P0001', 'P0002']);
        const h = b.mediaPuts[0].headers;
        expect(h['x-strom-source']).toBe('S0001');
        expect(h['x-strom-list-ref']).toBe(b.listPuts![0].ref);
    });

    test('the research not running: the files wait with the list, which goes first later', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: LISTS });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Sčítání 1921', ['Josef', 'Anna']);
        await poll(page);
        await openForJan(page);
        await chooseList(page, 'Sčítání 1921');
        b.down = true;
        await page.evaluate(() => (window.Strom.UI as any).researchBridgeUp = () => false);
        await page.locator('#material-input').setInputFiles(AVATAR);
        await page.getByRole('button', { name: 'Send when the research runs' }).click();
        await expect(page.locator('.toast')).toContainText('1 file waits in this browser');
        expect(b.listPuts ?? []).toEqual([]);
        b.down = false;
        await page.evaluate(() => { delete (window.Strom.UI as any).researchBridgeUp; });
        await poll(page);
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        expect(b.listPuts).toHaveLength(1);
        expect(b.mediaPuts[0].headers['x-strom-list-ref']).toBe(b.listPuts![0].ref);
        expect(b.mediaPuts[0].headers['x-strom-person']).toBe('P0003,P0001,P0002');
    });

    test('keyboard: ↓ opens, ↓ moves, Enter chooses; Esc closes the menu, not the dialog', async ({ page }) => {
        await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: LISTS });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Sčítání 1921', ['Josef', 'Anna']);
        await poll(page);
        await openForJan(page);
        const field = page.locator('#material-concern');
        await field.focus();
        await page.keyboard.press('ArrowDown');
        await expect(field).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(page.locator('#material-concern-menu')).toHaveCount(0);
        await expect(page.locator('#material-modal')).toHaveCount(1);
        await expect(field).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await expect(page.locator('#material-concern')).toContainText('Sčítání 1921');
        await expect(page.locator('#material-concern')).toBeFocused();
    });
});

test.describe('material for a list in a phone-wide window', () => {
    // Material is offered on a computer: a window as narrow as a phone gets the phone's bottom sheet.
    test.use({ viewport: { width: 390, height: 844 } });

    test('the menu is a bottom sheet; × closes it', async ({ page }) => {
        await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: LISTS });
        await openResearch(page, { media: true, ged: ged() });
        await makeList(page, 'Sčítání 1921', ['Josef', 'Anna']);
        await poll(page);
        await openForJan(page);
        await page.locator('#material-concern').click();
        const sheet = page.locator('#material-concern-menu.is-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.material-concern-title')).toHaveText('Concerns');
        const box = await sheet.boundingBox();
        expect(Math.round(box!.y + box!.height)).toBe(844);
        await sheet.locator('.material-concern-x').click();
        await expect(page.locator('#material-concern-menu')).toHaveCount(0);
        await expect(page.locator('#material-modal')).toHaveCount(1);
    });
});

import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCurrentStep } from './helpers.js';

/**
 * Step 3 of the import guide, Whom to add (spec 134 §5, K4.1–K4.5): the
 * variants tick the new people, unticking a person others link to the tree
 * through asks first (5a) and the toast can undo it (5b), the living can be
 * left out, and a list of thousands draws only the rows near the view (13h).
 * The tree Modřínovi (e2e/fixtures/modrinovi.json) gets a file made here:
 * Kvido Modřín (joined) with his parents and grandfather, a son with a wife
 * and three children (the youngest living), and one Jilm with no way to the
 * tree. Invented people.
 */

interface Indi { id: string; name: string; sex: 'M' | 'F'; born: number; died?: number; place?: string }
interface Fam { id: string; husb?: string; wife?: string; kids: string[] }

function ged(indis: Indi[], fams: Fam[]): string {
    const lines = ['0 HEAD', '1 SOUR FICTIVE', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'];
    for (const p of indis) {
        lines.push(`0 @${p.id}@ INDI`, `1 NAME ${p.name}`, `1 SEX ${p.sex}`, '1 BIRT', `2 DATE ${p.born}`);
        if (p.place) lines.push(`2 PLAC ${p.place}`);
        if (p.died) lines.push('1 DEAT', `2 DATE ${p.died}`);
        for (const f of fams) {
            if (f.husb === p.id || f.wife === p.id) lines.push(`1 FAMS @${f.id}@`);
            if (f.kids.includes(p.id)) lines.push(`1 FAMC @${f.id}@`);
        }
    }
    for (const f of fams) {
        lines.push(`0 @${f.id}@ FAM`);
        if (f.husb) lines.push(`1 HUSB @${f.husb}@`);
        if (f.wife) lines.push(`1 WIFE @${f.wife}@`);
        for (const k of f.kids) lines.push(`1 CHIL @${k}@`);
    }
    lines.push('0 TRLR');
    return lines.join('\n') + '\n';
}

const KVIDO: Indi = { id: 'I1', name: 'Kvido /Modřín/', sex: 'M', born: 1921, place: 'Křemenná' };

/** The file of the examples: 10 people, Kvido joined, 9 new (8 linked, 1 not). */
function familyGed(): string {
    return ged([
        KVIDO,
        { id: 'I2', name: 'Budivoj /Modřín/', sex: 'M', born: 1890, died: 1950, place: 'Mechová' },
        { id: 'I3', name: 'Eulálie /Modřínová/', sex: 'F', born: 1894, died: 1960 },
        { id: 'I4', name: 'Bonifác /Modřín/', sex: 'M', born: 1860, died: 1920 },
        { id: 'I5', name: 'Zbyhněv /Modřín/', sex: 'M', born: 1955, died: 2010 },
        { id: 'I6', name: 'Libuna /Jilmová/', sex: 'F', born: 1957, died: 2015 },
        { id: 'I7', name: 'Hostivít /Modřín/', sex: 'M', born: 1980, died: 2001 },
        { id: 'I8', name: 'Dobroslava /Modřínová/', sex: 'F', born: 1983, died: 2020 },
        { id: 'I9', name: 'Velemír /Modřín/', sex: 'M', born: 1987 },
        { id: 'I10', name: 'Ludiše /Jilmová/', sex: 'F', born: 1900, died: 1970 },
    ], [
        { id: 'F1', husb: 'I2', wife: 'I3', kids: ['I1'] },
        { id: 'F2', husb: 'I4', kids: ['I2'] },
        { id: 'F3', husb: 'I1', kids: ['I5'] },
        { id: 'F4', husb: 'I5', wife: 'I6', kids: ['I7', 'I8', 'I9'] },
    ]);
}

/** Kvido and 3 000 new children of his (one family, so one group of 3 000). */
function bigGed(): string {
    const names = ['Budivoj', 'Hostivít', 'Velemír', 'Zbyhněv', 'Bonifác'];
    const kids: Indi[] = [];
    for (let i = 0; i < 3000; i++) kids.push({ id: `K${i}`, name: `${names[i % names.length]} /Modřín/`, sex: 'M', born: 1940 + (i % 40), died: 1990 + (i % 30) });
    return ged([KVIDO, ...kids], [{ id: 'F1', husb: 'I1', kids: kids.map(k => k.id) }]);
}

/** The tree Modřínovi open, the file read into the guide, on to step 3. */
async function toStep3(page: Page, file: string): Promise<Locator> {
    await page.clock.setFixedTime(new Date('2026-05-04T10:00:00Z'));
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    await page.locator('#gedcom-input').setInputFiles({ name: 'rodokmen-jilmovi.ged', mimeType: 'text/plain', buffer: Buffer.from(file, 'utf-8') });
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    await expect(wizard.locator('#merge-counts [data-count="joined"] .merge-stat-value')).toHaveText('1');
    // A pair left to decide (a new child like the tree's own one) goes as new.
    const rest = wizard.getByRole('button', { name: /^Add as new \(\d+\)$/ });
    if (await rest.count()) await rest.click();
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '3');
    return wizard;
}

const count = (wizard: Locator): Locator => wizard.locator('#merge-step-body .merge-s3-count');
/** A person's row, by the name (a row also names the next person on its way to the tree). */
const row = (wizard: Locator, name: string): Locator => wizard.locator('.merge-s3-list .merge-s3-row').filter({ has: wizard.page().locator('.merge-s3-name', { hasText: name }) });

/** The plan's four counts add up to the file's people. */
async function sumIsWhole(wizard: Locator, total: number): Promise<void> {
    const counts = await wizard.locator('#merge-counts .merge-stat .merge-stat-value').allTextContents();
    expect(counts.map(c => Number(c.replace(/\D/g, ''))).reduce((a, b) => a + b, 0)).toBe(total);
}

test('unticking a person others link through asks first: their names, Leave out 5 people, the sum stays whole, Undo brings them back', async ({ page }) => {
    const wizard = await toStep3(page, familyGed());
    await expect(count(wizard)).toHaveText('9 of 9 new selected');
    await expect(wizard.locator('#merge-progress .merge-step[data-step="3"] .merge-step-sub')).toHaveText('all new');
    // The linked new in their tab, the one with no way to the tree in the groups' tab.
    await expect(wizard.locator('#merge-s3-tab-linked .cnt')).toHaveText('8');
    await expect(wizard.locator('#merge-s3-tab-groups .cnt')).toHaveText('1');
    await expect(row(wizard, 'Hostivít')).toContainText('1980–2001');

    await row(wizard, 'Zbyhněv').locator('input[type="checkbox"]').click(); // asks first: the box stays ticked until the answer
    const dialog = page.locator('#merge-s3-unlink');
    await expect(dialog.getByRole('dialog')).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText('Untick Zbyhněv Modřín?');
    await expect(dialog.locator('.merge-s3-unlink-text')).toContainText('4 more people are linked to the tree through Zbyhněv Modřín (1955–2010)');
    await expect(dialog.locator('.merge-s3-unlink-text')).toContainText('and 1 more');
    await dialog.locator('.merge-s3-show').click();
    await expect(dialog.locator('.merge-s3-unlink-names li')).toHaveCount(4);
    await expect(dialog.locator('input[value="all"]')).toBeChecked();
    await expect(dialog.locator('input[value="q"]')).toHaveCount(1);
    await expect(dialog.locator('.merge-s3-unlink-go')).toHaveText('Leave out 5 people');
    await dialog.locator('.merge-s3-unlink-go').click();
    await expect(dialog).toHaveCount(0);

    await expect(count(wizard)).toHaveText('4 of 9 new selected');
    await expect(row(wizard, 'Zbyhněv').locator('input')).not.toBeChecked();
    await expect(row(wizard, 'Libuna').locator('input')).not.toBeChecked();
    await expect(wizard.locator('#merge-counts [data-count="skipped"] .merge-stat-value')).toHaveText('5');
    await sumIsWhole(wizard, 10);
    const toast = page.locator('.toast').filter({ hasText: '5 people left out (Zbyhněv Modřín and the branch)' });
    await expect(toast).toBeVisible();
    await toast.locator('.toast-action').filter({ hasText: 'Undo' }).click();
    await expect(count(wizard)).toHaveText('9 of 9 new selected');
    await expect(row(wizard, 'Libuna').locator('input')).toBeChecked();
    await sumIsWhole(wizard, 10);
});

test('Leave out living (1) takes the living one out; Ancestors of… selects the 3 ancestors; By hand ticks nobody, Select all everybody', async ({ page }) => {
    const wizard = await toStep3(page, familyGed());
    const living = wizard.locator('.merge-s3-living');
    await expect(living).toHaveText('Leave out living (1)');
    await expect(row(wizard, 'Velemír').locator('.merge-s3-living-tag')).toBeVisible();
    await living.locator('input').check();
    await expect(count(wizard)).toHaveText('8 of 9 new selected');
    await expect(row(wizard, 'Velemír').locator('input')).toBeDisabled();
    await sumIsWhole(wizard, 10);
    await living.locator('input').uncheck();
    await expect(count(wizard)).toHaveText('9 of 9 new selected');

    await wizard.locator('.merge-s3-variants [data-v="ancestors"]').click();
    const pick = page.locator('#merge-s3-pick');
    await expect(pick.locator('h2')).toHaveText('Ancestors of a person');
    await pick.locator('.merge-s3-pick-q').fill('kvido');
    await pick.locator('.merge-s3-pick-list [role="option"]').filter({ hasText: 'Kvido' }).click();
    await pick.locator('[data-gen="all"]').click();
    await expect(pick.locator('.merge-s3-pick-sentence')).toHaveText('Selects 3 ancestors of Kvido Modřín not in the tree. The other new people are unticked.');
    await pick.locator('.merge-s3-pick-go').click();
    await expect(pick).toHaveCount(0);
    await expect(count(wizard)).toHaveText('3 of 9 new selected');
    await expect(wizard.locator('.merge-s3-variants [data-v="ancestors"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(wizard.locator('#merge-progress .merge-step[data-step="3"] .merge-step-sub')).toHaveText('ancestors of Kvido Modřín');
    await expect(row(wizard, 'Bonifác').locator('input')).toBeChecked();
    await expect(row(wizard, 'Zbyhněv').locator('input')).not.toBeChecked();
    await sumIsWhole(wizard, 10);

    await wizard.locator('.merge-s3-variants [data-v="manual"]').click();
    await expect(count(wizard)).toHaveText('0 of 9 new selected');
    await wizard.locator('.merge-s3-all [data-act="all"]').click();
    // Select all ticks the list's people (the linked new); the unlinked one waits in its tab.
    await expect(count(wizard)).toHaveText('8 of 9 new selected');
    await sumIsWhole(wizard, 10);
});

test('a group sent to the unlinked groups can be added unlinked, so the guide goes on', async ({ page }) => {
    const wizard = await toStep3(page, familyGed());
    await row(wizard, 'Zbyhněv').locator('input[type="checkbox"]').click();
    const dialog = page.locator('#merge-s3-unlink');
    await dialog.locator('input[value="loose"]').check();
    await expect(dialog.locator('.merge-s3-unlink-go')).toHaveText('Leave out 1 person');
    await dialog.locator('.merge-s3-unlink-go').click();
    await expect(wizard.locator('.merge-s3-undecided')).toBeVisible();
    await expect(wizard.locator('#merge-next')).toBeDisabled();

    await wizard.locator('#merge-s3-tab-groups').click();
    const groups = wizard.locator('#merge-s3-groups .merge-s3-grow');
    const n = await groups.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await groups.nth(i).locator('[data-decide="loose"]').click();
    await expect(wizard.locator('.merge-s3-undecided')).toBeHidden();
    await expect(wizard.locator('#merge-next')).toBeEnabled();
    await expect(count(wizard)).toHaveText('8 of 9 new selected');
    await sumIsWhole(wizard, 10);
});

test('by keys: Tab reaches a person\'s checkbox, Space unticks it and ticks it again', async ({ page }) => {
    const wizard = await toStep3(page, familyGed());
    const box = row(wizard, 'Hostivít').locator('input[type="checkbox"]');
    await wizard.locator('.merge-s3-search').focus();
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await box.evaluate(el => el === document.activeElement);
    }
    expect(reached, 'Tab reaches the checkbox').toBe(true);
    await page.keyboard.press(' ');
    await expect(count(wizard)).toHaveText('8 of 9 new selected');
    await expect(box).toBeFocused();
    await page.keyboard.press(' ');
    await expect(count(wizard)).toHaveText('9 of 9 new selected');
});

test('3 000 new people: the group starts closed, opened it draws at most 100 rows, scrolled to the end the last ones', async ({ page }) => {
    test.slow();
    const wizard = await toStep3(page, bigGed());
    await expect(count(wizard)).toHaveText('3,000 of 3,000 new selected');
    const list = wizard.locator('.merge-s3-list');
    await expect(list.locator('.merge-s3-gh')).toHaveCount(1);
    await expect(list.locator('.merge-s3-row')).toHaveCount(0);
    await list.locator('.merge-s3-caret').click();
    await expect(list.locator('.merge-s3-row').first()).toBeVisible();
    expect(await list.locator('li[role="option"]').count()).toBeLessThanOrEqual(100);
    await wizard.locator('.merge-s3-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    // Scrolled to the end: the spacer above holds the rows not drawn, none is left below.
    await expect.poll(() => list.locator('.vlist-pad').last().evaluate(el => (el as HTMLElement).style.height)).toBe('0px');
    expect(parseFloat(await list.locator('.vlist-pad').first().evaluate(el => (el as HTMLElement).style.height))).toBeGreaterThan(30_000);
    expect(await list.locator('li[role="option"]').count()).toBeLessThanOrEqual(100);
});

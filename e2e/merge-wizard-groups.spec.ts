import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCurrentStep, mergeWrite } from './helpers.js';

/**
 * The unlinked groups of step 3 (spec 134 §6, K4.4): a group of new people
 * with no way to the tree holds the guide up until it is decided; it can be
 * linked through one of its people to a person of the tree, added unlinked,
 * kept as a separate tree, or left out; when nothing of the import is joined
 * (6f) the tab explains it and offers its three ways.
 * The tree Modřínovi (e2e/fixtures/modrinovi.json) gets a file made here:
 * Kvido Modřín (joined), the Jilm family of three with no way to the tree,
 * and Ludiše Jilmová alone. Invented people.
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

const JILMS: Indi[] = [
    { id: 'J1', name: 'Radhost /Jilm/', sex: 'M', born: 1860, died: 1930, place: 'Křemenná' },
    { id: 'J2', name: 'Milohlava /Jilmová/', sex: 'F', born: 1865, died: 1935, place: 'Křemenná' },
    { id: 'J3', name: 'Božetěch /Jilm/', sex: 'M', born: 1890, died: 1960, place: 'Mechová' },
];
const JILM_FAM: Fam = { id: 'F9', husb: 'J1', wife: 'J2', kids: ['J3'] };
const LUDISE: Indi = { id: 'J4', name: 'Ludiše /Jilmová/', sex: 'F', born: 1900, died: 1970 };

/** Kvido (joined), the Jilm family (3) and Ludiše alone: 5 people, 2 groups. */
function groupsGed(): string {
    return ged([{ id: 'I1', name: 'Kvido /Modřín/', sex: 'M', born: 1921, place: 'Křemenná' }, ...JILMS, LUDISE], [JILM_FAM]);
}

/** The tree Modřínovi open, the file read into the guide and compared. */
async function compared(page: Page, file: string): Promise<Locator> {
    await page.clock.setFixedTime(new Date('2026-05-04T10:00:00Z'));
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    await page.locator('#gedcom-input').setInputFiles({ name: 'rodokmen-jilmovi.ged', mimeType: 'text/plain', buffer: Buffer.from(file, 'utf-8') });
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    return wizard;
}

/** On to step 3 and its unlinked groups' tab. */
async function toGroups(page: Page, file: string): Promise<Locator> {
    const wizard = await compared(page, file);
    await expect(wizard.locator('#merge-counts [data-count="joined"] .merge-stat-value')).toHaveText('1');
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '3');
    await wizard.locator('#merge-s3-tab-groups').click();
    return wizard;
}

const groupRow = (wizard: Locator, title: RegExp | string): Locator =>
    wizard.locator('#merge-s3-groups .merge-s3-grow').filter({ has: wizard.page().locator('.merge-s3-gname', { hasText: title }) });

async function sumIsWhole(wizard: Locator, total: number): Promise<void> {
    const counts = await wizard.locator('#merge-counts .merge-stat .merge-stat-value').allTextContents();
    expect(counts.map(c => Number(c.replace(/\D/g, ''))).reduce((a, b) => a + b, 0)).toBe(total);
}

const stat = (wizard: Locator, kind: string): Locator => wizard.locator(`#merge-counts [data-count="${kind}"] .merge-stat-value`);

/** Write into a new tree "Modřínovi + rodokmen-jilmovi" (step 5) and switch to it. */
async function writeAndSwitch(page: Page, wizard: Locator): Promise<void> {
    await mergeWrite(wizard);
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    await wizard.locator('.merge-s6-act[data-act="show"]').click();
    await expect(wizard).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
        const S = window.Strom.TreeManager;
        return S.getTrees().find((t: { id: string }) => t.id === S.getActiveTreeId())?.name;
    })).toBe('Modřínovi + rodokmen-jilmovi');
}

test('an undecided group holds the guide: Continue is disabled with the reason until each group is decided', async ({ page }) => {
    const wizard = await toGroups(page, groupsGed());
    await expect(wizard.locator('#merge-s3-tab-groups .cnt')).toHaveText('2');
    await expect(wizard.locator('.merge-s3-undecided')).toHaveText('2 undecided');
    await expect(wizard.locator('#merge-next')).toBeDisabled();
    await expect(wizard.locator('#merge-next-why')).toHaveText('Undecided groups: 2 (4 people)');
    await expect(stat(wizard, 'pending')).toHaveText('4');
    await sumIsWhole(wizard, 5);

    const family = groupRow(wizard, /^Jilm/);
    await expect(family.locator('.merge-s3-gtag')).toHaveText('undecided');
    await expect(family.locator('.merge-s3-gwho')).toContainText('Radhost Jilm, Milohlava Jilmová, Božetěch Jilm');
    await expect(family.locator('[data-decide]')).toHaveCount(4);
    const singles = groupRow(wizard, 'Individuals');
    // The individuals: a list to untick and one decision of two (6e).
    await expect(singles.locator('[data-decide]')).toHaveCount(2);
    await expect(singles.locator('.merge-s3-gsingles input[data-single]')).toHaveCount(1);

    await family.locator('[data-decide="loose"]').click();
    await expect(family.locator('.merge-s3-gresult')).toContainText('Added unlinked: 3 people');
    await expect(wizard.locator('#merge-next-why')).toHaveText('Undecided groups: 1 (1 person)');
    await singles.locator('[data-decide="skip"]').click();
    await expect(wizard.locator('.merge-s3-undecided')).toBeHidden();
    await expect(wizard.locator('#merge-next')).toBeEnabled();
    await expect(stat(wizard, 'added')).toHaveText('3');
    await expect(stat(wizard, 'skipped')).toHaveText('1');
    await sumIsWhole(wizard, 5);

    // Change shows the choices again; the ticked groups are decided at once.
    await family.locator('[data-gchange]').click();
    await expect(family.locator('[data-decide="loose"]')).toHaveAttribute('aria-checked', 'true');
    await family.locator('[data-gtick]').check();
    await singles.locator('[data-gtick]').check();
    await expect(wizard.locator('.merge-s3-gbulk-l')).toHaveText('Ticked (2):');
    await wizard.locator('.merge-s3-gbulk [data-bulk="skip"]').click();
    await expect(stat(wizard, 'skipped')).toHaveText('4');
    await sumIsWhole(wizard, 5);
});

test('Link to a person…: the group\'s person as a parent of the tree\'s person, 3 people linked, the sum whole and the link written', async ({ page }) => {
    const wizard = await toGroups(page, groupsGed());
    const family = groupRow(wizard, /^Jilm/);
    await family.locator('[data-decide="connect"]').click();
    const dialog = page.locator('#merge-connect-modal');
    await expect(dialog.locator('h2')).toHaveText(/^Link the group Jilm/);
    await dialog.locator('.merge-connect-from').selectOption({ label: 'Radhost Jilm (1860–1930)' });
    await expect(dialog.locator('[data-rel="parent"]')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('.merge-connect-go')).toBeDisabled();
    await dialog.locator('.merge-connect-q').fill('Florent');
    await dialog.locator('.merge-connect-list [role="option"]').filter({ hasText: 'Florentýna' }).click();
    await expect(dialog.locator('.merge-connect-sentence')).toHaveText('After linking, 3 people of the group are added with the link Radhost → Florentýna.');
    await expect(dialog.locator('.merge-connect-go')).toHaveText('Link 3 people');
    await dialog.locator('.merge-connect-go').click();
    await expect(dialog).toHaveCount(0);

    await expect(family.locator('.merge-s3-gresult')).toContainText('Radhost Jilm (1860–1930) – parent of Florentýna Modřínová');
    await groupRow(wizard, 'Individuals').locator('[data-decide="skip"]').click();
    await expect(wizard.locator('#merge-next')).toBeEnabled();
    await expect(stat(wizard, 'joined')).toHaveText('1');
    await expect(stat(wizard, 'added')).toHaveText('3');
    await expect(stat(wizard, 'skipped')).toHaveText('1');
    await expect(stat(wizard, 'pending')).toHaveText('0');
    await sumIsWhole(wizard, 5);

    await writeAndSwitch(page, wizard);
    const linked = await page.evaluate(() => {
        const d = window.Strom.DataManager.getData();
        const ps = Object.values(d.persons) as Array<{ id: string; firstName: string; parentIds: string[] }>;
        const flor = ps.find(p => p.firstName === 'Florentýna');
        const rad = ps.find(p => p.firstName === 'Radhost');
        return { linked: !!flor && !!rad && flor.parentIds.includes(rad.id), ludise: ps.some(p => p.firstName === 'Ludiše') };
    });
    expect(linked).toEqual({ linked: true, ludise: false });
});

test('Separate tree: after the write a new tree "{target} – {group}" holds the group\'s people, no question about separate families follows', async ({ page }) => {
    const wizard = await toGroups(page, groupsGed());
    const family = groupRow(wizard, /^Jilm/);
    const title = (await family.locator('.merge-s3-gname').textContent())!;
    await family.locator('[data-decide="own-tree"]').click();
    await expect(family.locator('.merge-s3-gresult')).toContainText(`After writing, a tree of its own: Modřínovi – ${title}`);
    await groupRow(wizard, 'Individuals').locator('[data-decide="loose"]').click();
    await expect(wizard.locator('#merge-next')).toBeEnabled();
    await sumIsWhole(wizard, 5);

    await writeAndSwitch(page, wizard);
    const own = await page.evaluate(async (name) => {
        const t = window.Strom.TreeManager.getTrees().find((x: { name: string }) => x.name === name);
        if (!t) return null;
        const d = await window.Strom.TreeManager.getTreeData(t.id);
        return d ? (Object.values(d.persons) as Array<{ firstName: string; isPlaceholder?: boolean }>).filter(p => !p.isPlaceholder).map(p => p.firstName).sort() : [];
    }, `Modřínovi – ${title}`);
    expect(own).toEqual(['Božetěch', 'Milohlava', 'Radhost']);
    await expect(page.locator('.import-next-row--split')).toHaveCount(0);
});

test('nothing in the import is linked (6f): the explanation and its three ways, Add unlinked lets the guide on', async ({ page }) => {
    const wizard = await compared(page, ged([...JILMS, LUDISE], [JILM_FAM]));
    await expect(stat(wizard, 'joined')).toHaveText('0');
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '3');
    // The groups' tab comes first: nobody is linked.
    const panel = wizard.locator('#merge-s3-groups');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.merge-s3-nolink-t')).toHaveText('Nothing in the import is linked to the tree Modřínovi');
    await expect(panel.locator('.merge-s3-nolink .merge-s3-glead')).toContainText('so 4 people have no path');
    await expect(panel.locator('[data-nl]')).toHaveText(['Link to a person…', 'New tree', 'Add unlinked']);
    await expect(wizard.locator('#merge-next')).toBeDisabled();
    await panel.locator('[data-nl="loose"]').click();
    await expect(wizard.locator('#merge-next')).toBeEnabled();
    await expect(stat(wizard, 'added')).toHaveText('4');
    await sumIsWhole(wizard, 4);
});

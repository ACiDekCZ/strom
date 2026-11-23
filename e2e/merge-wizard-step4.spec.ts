import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, createFirstPerson, mergeCompare, mergeCount, mergeCurrentStep, mergeJoinPending, mergePickValue, mergeSetScope, mergeToStep4, mergeWriteAndSwitch } from './helpers.js';
import { unnamedControls } from './a11y.js';

/**
 * Step 4 of the import guide, Who is right (spec 134 §7, 7a–7e): the rule
 * for the whole merge as tiles with their counts, a rule by kind of detail,
 * By person with where each result comes from, a protected value changed
 * one by one through its dialog (7c), the conflicts of relations decided on
 * their own (7d; a loop only kept), and scope a) without conflicts skipping
 * the step with a sentence (7e). The tree of the Modřín family is loaded
 * here, the import (a file of the Jilm family) is made here: the same
 * people born in Mechová instead of Křemenná, some dates more precise,
 * Ctiboh with other parents, and Hostivít as Velemír's father (a loop).
 * Invented people.
 */

type P = {
    id: string; firstName: string; lastName: string; gender: 'male' | 'female'; birthDate: string; birthPlace?: string;
    birthStatus?: string; deathDate?: string; deathPlace?: string;
    partnerships?: string[]; parentIds?: string[]; childIds?: string[];
};

/** The tree: Velemír's birth is proven (a bulk rule never overwrites it). */
function modrinTree() {
    const kids = ['koj', 'bud', 'zby', 'dob', 'hos'];
    const persons: P[] = [
        { id: 'bon', firstName: 'Bonifác', lastName: 'Modřín', gender: 'male', birthDate: '1820', childIds: ['vel'] },
        { id: 'vel', firstName: 'Velemír', lastName: 'Modřín', gender: 'male', birthDate: '1850', birthPlace: 'Křemenná', birthStatus: 'proven', deathDate: '1910', deathPlace: 'Křemenná', parentIds: ['bon'], partnerships: ['u1'], childIds: kids },
        { id: 'eul', firstName: 'Eulálie', lastName: 'Modřínová', gender: 'female', birthDate: '1855', birthPlace: 'Křemenná', partnerships: ['u1'], childIds: kids },
        { id: 'koj', firstName: 'Kojata', lastName: 'Modřín', gender: 'male', birthDate: '1878', birthPlace: 'Křemenná', parentIds: ['vel', 'eul'] },
        { id: 'bud', firstName: 'Budivoj', lastName: 'Modřín', gender: 'male', birthDate: '1880', birthPlace: 'Křemenná', parentIds: ['vel', 'eul'], partnerships: ['u2'], childIds: ['kvi'] },
        { id: 'zby', firstName: 'Zbyhněv', lastName: 'Modřín', gender: 'male', birthDate: '1882', birthPlace: 'Křemenná', parentIds: ['vel', 'eul'] },
        { id: 'dob', firstName: 'Dobroslava', lastName: 'Modřínová', gender: 'female', birthDate: '1884', birthPlace: 'Křemenná', parentIds: ['vel', 'eul'] },
        { id: 'hos', firstName: 'Hostivít', lastName: 'Modřín', gender: 'male', birthDate: '1886', birthPlace: 'Křemenná', parentIds: ['vel', 'eul'] },
        { id: 'lib', firstName: 'Libuna', lastName: 'Modřínová', gender: 'female', birthDate: '1885', partnerships: ['u2'], childIds: ['kvi'] },
        { id: 'kvi', firstName: 'Ctiboh', lastName: 'Modřín', gender: 'male', birthDate: '1910', birthPlace: 'Křemenná', parentIds: ['bud', 'lib'] },
    ];
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, { isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p }])),
        partnerships: {
            u1: { id: 'u1', person1Id: 'vel', person2Id: 'eul', status: 'married', startDate: '1876', childIds: kids },
            u2: { id: 'u2', person1Id: 'bud', person2Id: 'lib', status: 'married', startDate: '1908', childIds: ['kvi'] },
        },
    };
}

interface Indi { id: string; name: string; sex: 'M' | 'F'; born: string; place?: string; died?: string; deathPlace?: string }
interface Fam { id: string; husb?: string; wife?: string; kids: string[] }

function ged(indis: Indi[], fams: Fam[]): string {
    const lines = ['0 HEAD', '1 SOUR FICTIVE', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'];
    for (const p of indis) {
        lines.push(`0 @${p.id}@ INDI`, `1 NAME ${p.name}`, `1 SEX ${p.sex}`, '1 BIRT', `2 DATE ${p.born}`);
        if (p.place) lines.push(`2 PLAC ${p.place}`);
        if (p.died) lines.push('1 DEAT', `2 DATE ${p.died}`);
        if (p.deathPlace) lines.push(`2 PLAC ${p.deathPlace}`);
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

/** The import: everyone born in Mechová, Velemír and Kojata on a day, Ctiboh a child of Radhost and Mstislava, Hostivít Velemír's father. */
function jilmGed(): string {
    return ged([
        { id: 'I1', name: 'Velemír /Modřín/', sex: 'M', born: '12 MAR 1850', place: 'Mechová', died: '1910', deathPlace: 'Mechová' },
        { id: 'I2', name: 'Eulálie /Modřínová/', sex: 'F', born: '1855', place: 'Mechová' },
        { id: 'I3', name: 'Kojata /Modřín/', sex: 'M', born: '3 MAY 1878', place: 'Mechová' },
        { id: 'I4', name: 'Budivoj /Modřín/', sex: 'M', born: '1880', place: 'Mechová' },
        { id: 'I5', name: 'Zbyhněv /Modřín/', sex: 'M', born: '1882', place: 'Mechová' },
        { id: 'I6', name: 'Dobroslava /Modřínová/', sex: 'F', born: '1884', place: 'Mechová' },
        { id: 'I7', name: 'Hostivít /Modřín/', sex: 'M', born: '1886', place: 'Mechová' },
        { id: 'I8', name: 'Libuna /Modřínová/', sex: 'F', born: '1885' },
        { id: 'I9', name: 'Ctiboh /Modřín/', sex: 'M', born: '1910', place: 'Mechová' },
        { id: 'I10', name: 'Radhost /Jilm/', sex: 'M', born: '1870' },
        { id: 'I11', name: 'Mstislava /Jilmová/', sex: 'F', born: '1872' },
    ], [
        { id: 'F1', husb: 'I1', wife: 'I2', kids: ['I3', 'I4', 'I5', 'I6'] },
        { id: 'F2', husb: 'I4', wife: 'I8', kids: [] },
        { id: 'F3', husb: 'I10', wife: 'I11', kids: ['I9'] },
        { id: 'F4', husb: 'I7', kids: ['I1'] },
    ]);
}

/** The tree loaded, the file read into the guide and compared; every pair of a person of the tree joined. */
async function compared(page: Page, tree: unknown, file: string): Promise<Locator> {
    await page.clock.setFixedTime(new Date('2026-05-04T10:00:00Z'));
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await page.evaluate((data) => {
        window.Strom.DataManager.loadStromData(data as never);
        window.Strom.TreeRenderer.render();
    }, tree);
    await page.evaluate(() => window.Strom.UI.startGedcomImportPlain());
    await page.locator('#gedcom-input').setInputFiles({ name: 'rodokmen-jilmovi.ged', mimeType: 'text/plain', buffer: Buffer.from(file, 'utf-8') });
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    return wizard;
}

type Data = { persons: Record<string, P & { parentIds: string[] }> };

async function activeData(page: Page): Promise<Data> {
    return await page.evaluate(async () => {
        const TM = window.Strom.TreeManager;
        return (await TM.getTreeData(TM.getActiveTreeId()!))!;
    }) as unknown as Data;
}

const byName = (d: Data, first: string) => Object.values(d.persons).find(p => p.firstName === first)!;
const tile = (wizard: Locator, rule: string): Locator => wizard.locator(`.merge-s4-tile[data-rule="${rule}"]`);
const row = (wizard: Locator, person: string, field: string): Locator => wizard.locator(`.merge-s4-row[data-person="${person}"][data-field="${field}"]`);

test('step 4: the rule tiles, a kind\'s rule, By person with where each result comes from, a protected value one by one and the conflicts of relations reach the write', async ({ page }) => {
    const wizard = await compared(page, modrinTree(), jilmGed());
    // Hostivít is Velemír's father in the import: pairs to confirm by hand.
    await mergeJoinPending(wizard);
    await mergeSetScope(page, 'c');
    await mergeToStep4(wizard);

    // 7a: My tree wins by default; The import wins says what changes and that two protected details do not.
    await expect(tile(wizard, 'mine')).toHaveAttribute('aria-checked', 'true');
    await expect(tile(wizard, 'import').locator('.merge-s4-tile-n')).toHaveText(/^\d+ changes?, 2 protected not$/);
    await expect(wizard.locator('.merge-s4-prot')).toContainText('Protected from bulk rules: 2 details');
    await tile(wizard, 'import').click();
    await expect(tile(wizard, 'import')).toHaveAttribute('aria-checked', 'true');
    await expect(tile(wizard, 'mine')).toHaveAttribute('aria-checked', 'false');

    // By kind: Birth → More precise.
    const birth = wizard.locator('.merge-s4-krow[data-kind="birth"]');
    await expect(birth).toHaveCSS('min-height', '30px');
    await birth.locator('select').selectOption('precise');
    await expect(wizard.locator('.merge-s4-krow[data-kind="birth"] .merge-s4-from')).toHaveText('own rule');
    await expect(wizard.locator('.merge-s4-krow[data-kind="places"] .merge-s4-from')).toHaveText('← whole merge: The import wins');

    // By person: where each result comes from.
    await wizard.locator('#merge-s4-tab-persons').click();
    await expect(row(wizard, 'koj', 'birthDate').locator('.merge-s4-res-from')).toHaveText('← Birth: More precise, if not contradicting');
    await expect(row(wizard, 'koj', 'birthPlace').locator('.merge-s4-res-from')).toHaveText('← whole merge: The import wins');
    await expect(row(wizard, 'koj', 'birthPlace').locator('.merge-s4-res-v')).toHaveText('Mechová');
    await expect(row(wizard, 'vel', 'birthPlace').locator('.merge-s4-res-from')).toHaveText('protected – proven');

    // 7c: Velemír's proven birthplace from the import, one by one through the dialog.
    await row(wizard, 'vel', 'birthPlace').locator('.merge-s4-v[data-pick="import"]').click();
    const dialog = page.locator('#merge-s4-prot');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText('Overwrite a documented detail?');
    await expect(dialog.getByRole('button', { name: 'Keep Křemenná' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Use Mechová' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(wizard, 'vel', 'birthPlace').locator('.merge-s4-res-v')).toHaveText('Mechová');
    await expect(row(wizard, 'vel', 'birthPlace').locator('.merge-s4-res-from')).toHaveText('chosen for this value');
    await expect(row(wizard, 'vel', 'birthDate').locator('.merge-s4-res-from')).toHaveText('protected – proven');

    // 7d: Ctiboh's other parents from the import; the loop can only be kept.
    await wizard.locator('#merge-s4-tab-rels').click();
    const parents = wizard.locator('.merge-s4-rel[data-rel-kind="parents"]').filter({ hasText: 'Ctiboh' });
    // Each side with the years, the import's persons new to the tree marked so (N1 of part B's check):
    // parents of the same names stay told apart.
    await expect(parents).toContainText('Budivoj Modřín (* 1880) + Libuna Modřínová (* 1885)');
    await expect(parents).toContainText('Radhost Jilm (* 1870, new) + Mstislava Jilmová (* 1872, new)');
    // The choice keeps its own width (7d), not the row's (N2).
    const widths = await parents.evaluate(el => ({
        row: el.getBoundingClientRect().width,
        seg: el.querySelector('.sel-seg')!.getBoundingClientRect().width,
    }));
    expect(widths.seg).toBeLessThan(widths.row * 0.75);
    await parents.getByRole('radio', { name: 'From the import' }).click();
    await expect(wizard.locator('.merge-s4-rel[data-rel-kind="parents"]').filter({ hasText: 'Ctiboh' }).getByRole('radio', { name: 'From the import' })).toHaveAttribute('aria-checked', 'true');
    const loop = wizard.locator('.merge-s4-rel[data-rel-kind="loop"]');
    await expect(loop).toHaveCount(1);
    await expect(loop.getByRole('radio')).toHaveCount(1);
    await expect(loop.getByRole('radio')).toHaveText('Keep mine');
    await expect(loop.locator('.merge-s4-loop')).toHaveText('A loop is never written.');

    await mergeWriteAndSwitch(page, wizard);
    const d = await activeData(page);
    expect(byName(d, 'Velemír').birthPlace).toBe('Mechová');
    expect(byName(d, 'Velemír').birthDate).toBe('1850');
    expect(byName(d, 'Velemír').deathPlace).toBe('Mechová');
    expect(byName(d, 'Kojata').birthDate).toBe('1878-05-03');
    expect(byName(d, 'Eulálie').birthPlace).toBe('Mechová');
    const ctiboh = byName(d, 'Ctiboh');
    expect(ctiboh.parentIds.map(id => d.persons[id].firstName).sort()).toEqual(['Mstislava', 'Radhost']);
    // The loop is not written: Hostivít is not Velemír's parent (the "?" is the tree's own stand-in beside Bonifác).
    expect(byName(d, 'Velemír').parentIds.map(id => d.persons[id].firstName).sort()).toEqual(['?', 'Bonifác']);
});

test('step 4 by a click on a value: the chosen value wins over the rule, a second click gives it back', async ({ page }) => {
    const wizard = await compared(page, modrinTree(), jilmGed());
    await mergeJoinPending(wizard);
    await mergeSetScope(page, 'c');
    await mergeToStep4(wizard);
    await mergePickValue(wizard, 'zby', 'birthPlace', 'import');
    await expect(row(wizard, 'zby', 'birthPlace').locator('.merge-s4-res-v')).toHaveText('Mechová');
    await wizard.locator('.merge-s4-phead').getByRole('radio', { name: /^Only exceptions/ }).click();
    await expect(wizard.locator('.merge-s4-person')).toHaveCount(1);
    await expect(wizard.locator('.merge-s4-person')).toHaveAttribute('data-person', 'zby');
    await row(wizard, 'zby', 'birthPlace').locator('.merge-s4-v[data-pick="import"]').click();
    // No exception is left: the filter shows no one; All shows the rule's result again.
    await expect(wizard.locator('.merge-s4-person')).toHaveCount(0);
    await wizard.locator('.merge-s4-phead').getByRole('radio', { name: 'All', exact: true }).click();
    await expect(row(wizard, 'zby', 'birthPlace').locator('.merge-s4-res-v')).toHaveText('stays Křemenná');
});

test('scope a) without conflicts of relations skips step 4 and says why; the differences can be read', async ({ page }) => {
    const tree = {
        persons: {
            vel: { id: 'vel', isPlaceholder: false, firstName: 'Velemír', lastName: 'Modřín', gender: 'male', birthDate: '1850', birthPlace: 'Křemenná', partnerships: ['u1'], parentIds: [], childIds: [] },
            eul: { id: 'eul', isPlaceholder: false, firstName: 'Eulálie', lastName: 'Modřínová', gender: 'female', birthDate: '1855', birthPlace: 'Křemenná', partnerships: ['u1'], parentIds: [], childIds: [] },
        },
        partnerships: { u1: { id: 'u1', person1Id: 'vel', person2Id: 'eul', status: 'married', childIds: [] } },
    };
    const file = ged([
        { id: 'I1', name: 'Velemír /Modřín/', sex: 'M', born: '1850', place: 'Mechová' },
        { id: 'I2', name: 'Eulálie /Modřínová/', sex: 'F', born: '1855', place: 'Mechová' },
        { id: 'I3', name: 'Kojata /Modřín/', sex: 'M', born: '1878' },
    ], [{ id: 'F1', husb: 'I1', wife: 'I2', kids: ['I3'] }]);
    const wizard = await compared(page, tree, file);
    await expect(mergeCount(wizard, 'joined')).toHaveText('2');

    const step4 = wizard.locator('#merge-progress button.merge-step[data-step="4"]');
    await expect(step4).toHaveClass(/is-skipped/);
    await expect(step4).toContainText('skipped · scope a)');
    await step4.click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '4');
    const body = wizard.locator('.merge-s4.is-skipped');
    await expect(body.locator('.merge-s4-skip-t')).toHaveText('Step 4 is skipped');
    await expect(body).toContainText('2 differences of joined people do not change.');
    await expect(body).toContainText('There are no relationship conflicts.');
    await body.getByRole('button', { name: 'Show the differences' }).click();
    await expect(body.locator('.merge-s4-diffs > li')).toHaveCount(2);
    await expect(wizard.locator('.merge-s4-tile')).toHaveCount(0);
    // On from here goes to step 5.
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '5');
});

test('step 4 on a phone: every control named for a page reader, the primary button on the screen, the protected detail\'s dialog keeps the focus and Esc closes only it', async ({ page }) => {
    const wizard = await compared(page, modrinTree(), jilmGed());
    await mergeJoinPending(wizard);
    await mergeSetScope(page, 'c');
    await mergeToStep4(wizard);
    // The pairs joined at the desk's width; step 4 on a phone held upright.
    await page.setViewportSize({ width: 390, height: 844 });
    const next = wizard.locator('#merge-next');
    const unnamed = async (where: string): Promise<void> => {
        expect.soft((await unnamedControls(page)).map(u => `[${u.role}] "${u.name}" ${u.html}`), where).toEqual([]);
    };
    await expect(next).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await unnamed('by kind');
    await wizard.locator('#merge-s4-tab-persons').click();
    await expect(next).toBeInViewport();
    await unnamed('by person');
    await wizard.locator('#merge-s4-tab-rels').click();
    await expect(next).toBeInViewport();
    await unnamed('relations');

    await wizard.locator('#merge-s4-tab-persons').click();
    await row(wizard, 'vel', 'birthPlace').locator('.merge-s4-v[data-pick="import"]').click();
    const dialog = page.locator('#merge-s4-prot');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(wizard).toBeVisible();
    // Nothing chosen: the tree's documented value stays.
    await expect(row(wizard, 'vel', 'birthPlace').locator('.merge-s4-res-v')).toHaveText('stays Křemenná');
});

import { test, expect, Page, TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import {
    openApp, createFirstPerson, card, cardAction, importJsonAsNewTree, focusViaSearch,
} from './helpers.js';

/**
 * Security & privacy regressions (review 2026-09-22, K1–K4): markup in data
 * coming from a foreign file must never execute, the HTML export must carry
 * only the exported tree (no rendered page of another tree), `</script>` in a
 * note must not break out of the embedded data, living-person privacy must
 * strip every detail field, and CSV cells must not start a formula.
 */

// ---- payloads ----
const IMG = '<img src=x onerror="window.__xss=1">';
const SVG = '<svg onload="window.__xss=1">';
const EVIL_ID = "x');window.__xss=1;//";
const ATTR = 'x" autofocus onfocus="window.__xss=1';
const SCRIPT_NOTE = '</script><script>window.__xss=1</script>';

/** Birthday `days` from today as a full date in `year` (local calendar). */
function birthdayInDays(year: number, days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

/** A tree whose every text field (and one id) carries an injection payload. */
function xssTree(): object {
    return {
        version: 6,
        persons: {
            [EVIL_ID]: {
                id: EVIL_ID,
                firstName: `Ada${IMG}`,
                lastName: 'Evilson',
                gender: 'female',
                birthDate: birthdayInDays(1950, 3),
                birthPlace: `Town${IMG}`,
                notes: SCRIPT_NOTE,
                isPlaceholder: false,
                partnerships: ['u_evil'],
                parentIds: [],
                childIds: ['p_cyd'],
            },
            p_bob: {
                id: 'p_bob',
                firstName: `Bob${SVG}`,
                lastName: 'Evilson',
                gender: 'male',
                birthDate: '1948',
                isPlaceholder: false,
                partnerships: ['u_evil'],
                parentIds: [],
                childIds: ['p_cyd'],
            },
            p_cyd: {
                id: 'p_cyd',
                firstName: 'Cyd',
                lastName: `Evil${IMG}`,
                gender: 'male',
                birthDate: '1975',
                isPlaceholder: false,
                partnerships: [],
                parentIds: [EVIL_ID, 'p_bob'],
                childIds: [],
            },
        },
        partnerships: {
            u_evil: {
                id: 'u_evil',
                person1Id: 'p_bob',
                person2Id: EVIL_ID,
                status: 'married',
                startDate: '1970',
                startPlace: ATTR,
                note: SCRIPT_NOTE,
                childIds: ['p_cyd'],
            },
        },
    };
}

/** Record every JS dialog (alert/confirm/prompt) the page raises. */
function trackDialogs(page: Page): string[] {
    const fired: string[] = [];
    page.on('dialog', (d) => {
        fired.push(`${d.type()}: ${d.message()}`);
        void d.dismiss();
    });
    return fired;
}

async function expectNoXss(page: Page, fired: string[]): Promise<void> {
    // Give any injected handler (img onerror, onfocus) a chance to run first.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
    expect(fired).toEqual([]);
}

function writeJson(testInfo: TestInfo, name: string, data: object): string {
    const p = testInfo.outputPath(name);
    writeFileSync(p, JSON.stringify(data, null, 2));
    return p;
}

async function downloadFrom(page: Page, click: () => Promise<void>): Promise<string> {
    const [download] = await Promise.all([page.waitForEvent('download'), click()]);
    return (await download.path())!;
}

/** Confirm the export-password dialog without a password in the given privacy mode. */
async function confirmPlainExport(page: Page, privacy: 'full' | 'initials' | 'minimal' | 'anonymous'): Promise<string> {
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption(privacy);
    return downloadFrom(page, () => pwd.getByRole('button', { name: 'Export without encryption' }).click());
}

// ---------------------------------------------------------------------------

test('XSS: markup and a quote-breaking id in an imported JSON stay inert text in every view', async ({ page }, testInfo) => {
    const fired = trackDialogs(page);
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    const file = writeJson(testInfo, 'xss.json', xssTree());
    await importJsonAsNewTree(page, file, 'Evil import');
    await expect(card(page, 'Ada')).toBeVisible();
    await expectNoXss(page, fired);

    // The id survived the import unchanged (no id rewriting hides the test).
    const ids = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons));
    expect(ids).toContain(EVIL_ID);

    // Card: the literal name text is shown, no <img> element was created.
    await expect(card(page, 'Ada').locator('.name-text')).toContainText('<img');
    await expect(page.locator('#tree-canvas img[src="x"], #tree-canvas svg[onload]')).toHaveCount(0);

    // Card tooltip (hover summary) shows the place literally.
    await card(page, 'Ada').hover();
    await expect(card(page, 'Ada').locator('.card-tooltip')).toContainText(`Town${IMG}`);
    await expectNoXss(page, fired);

    // Person edit dialog: the inputs carry the raw strings as values.
    await cardAction(page, 'Ada', 'edit');
    const modal = page.locator('#person-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#input-firstname')).toHaveValue(`Ada${IMG}`);
    await expect(modal.locator('#input-birthplace')).toHaveValue(`Town${IMG}`);
    await expect(modal.locator('#input-notes')).toHaveValue(SCRIPT_NOTE);
    await expectNoXss(page, fired);

    // Relationships panel (from the edit dialog): partner name as text, the
    // attribute-breaking wedding place as the input's value, note in textarea.
    await modal.locator('#link-relationships').click();
    const panel = page.locator('#relationships-modal');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(`Bob${SVG}`);
    await expect(panel.locator('.partnership-note').first()).toHaveValue(SCRIPT_NOTE);
    const placeInputs = panel.locator('input');
    const values = await placeInputs.evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value));
    expect(values).toContain(ATTR);
    await expect(panel.locator('[onfocus]')).toHaveCount(0);
    await expectNoXss(page, fired);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // Anniversaries: the upcoming birthday row shows the literal name and a
    // click (id with a quote) focuses the person instead of running code.
    await page.evaluate(() => window.Strom.UI.showAnniversariesDialog());
    const ann = page.locator('#anniversaries-modal');
    await expect(ann).toBeVisible();
    const row = ann.locator('.anniversary-row', { hasText: 'Ada' });
    await expect(row).toContainText(`Ada${IMG}`);
    await page.keyboard.press('Escape');
    await expect(ann).toBeHidden();
    await focusViaSearch(page, 'Cyd');
    await page.evaluate(() => window.Strom.UI.showAnniversariesDialog());
    await row.click();
    await expect(ann).toBeHidden();
    await expect(card(page, 'Ada')).toHaveClass(/focused/);
    await expectNoXss(page, fired);

    // Kinship calculator: both names are text.
    await cardAction(page, 'Ada', 'relationship');
    const kin = page.locator('#kinship-modal');
    await expect(kin).toBeVisible();
    await kin.locator('.person-picker-input').fill('Cyd');
    await kin.locator('.person-picker-item', { hasText: 'Cyd' }).first().click();
    await expect(kin.locator('#kinship-result')).toBeVisible();
    await expect(kin).toContainText(`Ada${IMG}`);
    await expect(kin.locator('img[src="x"]')).toHaveCount(0);
    await expectNoXss(page, fired);
    await page.keyboard.press('Escape');
    await expect(kin).toBeHidden();

    // Archives dialog: the name/place are text.
    await cardAction(page, 'Ada', 'archives');
    const arch = page.locator('#archives-modal');
    await expect(arch).toBeVisible();
    await expect(arch.locator('img[src="x"]')).toHaveCount(0);
    await expectNoXss(page, fired);
    await page.keyboard.press('Escape');
    await expect(arch).toBeHidden();
});

test('XSS: the tree-merge compare preview of a foreign file renders names as text', async ({ page }, testInfo) => {
    const fired = trackDialogs(page);
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    // The same foreign file imported twice: one copy is the merge target, the
    // other the incoming tree, so every person is a match with a compare view.
    const file = writeJson(testInfo, 'xss.json', xssTree());
    await importJsonAsNewTree(page, file, 'Evil A');
    await importJsonAsNewTree(page, file, 'Evil B');
    await expectNoXss(page, fired);

    const [aId, bId] = await page.evaluate(() => {
        const trees = window.Strom.TreeManager.getTrees() as { id: string; name: string }[];
        return [trees.find((t) => t.name === 'Evil A')?.id, trees.find((t) => t.name === 'Evil B')?.id];
    });
    await page.evaluate((id) => window.Strom.UI.showMergeTreesDialog(id), aId);
    const pick = page.locator('#merge-trees-modal');
    await expect(pick).toBeVisible();
    await page.evaluate((id) => window.Strom.UI.selectMergeTarget(id), bId);
    await pick.locator('#merge-trees-btn').click();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-match-list .merge-item').first()).toBeVisible();
    await expect(wizard.locator('#merge-match-list')).toContainText(`Ada${IMG}`);
    await expect(wizard.locator('img[src="x"], svg[onload]')).toHaveCount(0);
    await expectNoXss(page, fired);

    // Open the side-by-side compare preview for Ada's match.
    const adaItem = wizard.locator('#merge-match-list .merge-item', { hasText: 'Ada' }).first();
    await adaItem.locator('.merge-btn-preview[data-action="compare"]').click();
    const compare = page.locator('.tree-compare-overlay');
    await expect(compare).toBeVisible();
    await expect(compare).toContainText('Ada<img');
    await expect(compare.locator('img[src="x"], svg[onload]')).toHaveCount(0);
    await expectNoXss(page, fired);
});

test('XSS: markup in GEDCOM names and places stays text', async ({ page }, testInfo) => {
    const fired = trackDialogs(page);
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    const ged = [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI',
        `1 NAME Gil${IMG} /Marker${SVG}/`,
        '1 SEX M',
        '1 BIRT', '2 DATE 1901', `2 PLAC Village${IMG}`,
        '1 DEAT', '2 DATE 1970',
        `1 NOTE ${SCRIPT_NOTE}`,
        '1 FAMS @F1@',
        '0 @I2@ INDI',
        `1 NAME Hana /Marker/`,
        '1 SEX F',
        '1 DEAT', '2 DATE 1980',
        '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '1 MARR', '2 DATE 1925', `2 PLAC ${ATTR}`,
        '0 TRLR', '',
    ].join('\n');
    const gedPath = testInfo.outputPath('xss.ged');
    writeFileSync(gedPath, ged);

    await page.locator('#gedcom-input').setInputFiles(gedPath);
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await expect(page.locator('#gedcom-stat-persons')).toHaveText('2');
    await expect(result.locator('img[src="x"], svg[onload]')).toHaveCount(0);
    await result.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    await expect(card(page, 'Gil')).toBeVisible();
    await expect(card(page, 'Gil').locator('.name-text')).toContainText('<img');
    await expect(page.locator('#tree-canvas img[src="x"], #tree-canvas svg[onload]')).toHaveCount(0);
    await expect(card(page, 'Gil').locator('.card-tooltip')).toContainText(`Village${IMG}`);
    await expectNoXss(page, fired);

    await cardAction(page, 'Gil', 'edit');
    const modal = page.locator('#person-modal');
    await expect(modal.locator('#input-firstname')).toHaveValue(`Gil${IMG}`);
    await modal.locator('#link-relationships').click();
    const panel = page.locator('#relationships-modal');
    await expect(panel).toBeVisible();
    const values = await panel.locator('input').evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value));
    expect(values).toContain(ATTR);
    await expect(panel.locator('[onfocus]')).toHaveCount(0);
    await expectNoXss(page, fired);
});

// ---------------------------------------------------------------------------

/** Persons of two unrelated trees; A's names must never reach B's export. */
const TREE_A = ['Quintus', 'Ottilie', 'Barnaby'];

async function buildTwoTrees(page: Page, bNote?: string): Promise<{ aId: string; bId: string }> {
    return page.evaluate(({ aNames, note }) => {
        const TM = window.Strom.TreeManager;
        const mk = (id: string, firstName: string, lastName: string, extra: object = {}) => ({
            id, firstName, lastName, gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], birthDate: '1990', ...extra,
        });
        const aId = TM.createTree('Tree A');
        const aPersons: Record<string, object> = {};
        // One connected family (couple + child) so all of it is rendered.
        aPersons.a0 = mk('a0', aNames[0], 'Zephyrfield', { birthDate: '1960', partnerships: ['ua'], childIds: ['a2'] });
        aPersons.a1 = mk('a1', aNames[1], 'Zephyrfield', { birthDate: '1962', gender: 'female', partnerships: ['ua'], childIds: ['a2'] });
        aPersons.a2 = mk('a2', aNames[2], 'Zephyrfield', { parentIds: ['a0', 'a1'] });
        TM.saveTreeData(aId, {
            persons: aPersons,
            partnerships: { ua: { id: 'ua', person1Id: 'a0', person2Id: 'a1', status: 'married', childIds: ['a2'] } },
        });
        const bId = TM.createTree('Tree B');
        TM.saveTreeData(bId, {
            persons: {
                b0: mk('b0', 'Wilhelmina', 'Brookhaven', note ? { notes: note, birthDate: '1900', deathDate: '1970' } : {}),
            },
            partnerships: {},
        });
        return { aId, bId };
    }, { aNames: TREE_A, note: bNote });
}

async function switchToTree(page: Page, name: string, firstName: string): Promise<void> {
    await page.locator('.tree-switcher-btn').click();
    await page.locator('.tree-switcher-item', { hasText: name }).first().click();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(name);
    await expect(card(page, firstName)).toBeVisible();
}

/** Export tree `treeName` as a standalone app from the tree manager row menu. */
async function exportAppFromManager(page: Page, treeName: string, privacy: 'full' | 'anonymous'): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();
    const row = manager.locator('.tree-manager-item', { hasText: treeName }).first();
    await row.locator('.tree-row-menu-btn').click();
    await row.locator('.tree-row-menu-item', { hasText: 'Export' }).click();
    const exportModal = page.locator('#export-modal');
    await expect(exportModal).toBeVisible();
    await exportModal.locator('.menu-option[onclick*="exportTargetTreeApp"]').click();
    return confirmPlainExport(page, privacy);
}

for (const privacy of ['anonymous', 'full'] as const) {
    test(`HTML export of tree B (${privacy}) carries none of the on-screen tree A`, async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Seed', 'Person');
        await buildTwoTrees(page);
        await switchToTree(page, 'Tree A', 'Quintus');
        // Tree A is rendered on screen (cards in the DOM).
        for (const n of TREE_A) await expect(card(page, n)).toBeAttached();

        const html = readFileSync(await exportAppFromManager(page, 'Tree B', privacy), 'utf-8');
        for (const n of TREE_A) expect(html).not.toContain(n);
        expect(html).not.toContain('Zephyrfield');
        if (privacy === 'full') expect(html).toContain('Wilhelmina');
    });
}

test('HTML export: a </script> note cannot break out of the embedded data', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await buildTwoTrees(page, `Died ${SCRIPT_NOTE} $' $& end`);
    await switchToTree(page, 'Tree A', 'Quintus');

    const exported = await exportAppFromManager(page, 'Tree B', 'full');
    const html = readFileSync(exported, 'utf-8');
    expect(html).not.toContain(SCRIPT_NOTE);
    const out = testInfo.outputPath('b.html');
    writeFileSync(out, html);

    const fired = trackDialogs(page);
    await page.goto(pathToFileURL(out).href);
    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await expect(card(page, 'Wilhelmina')).toBeVisible();
    for (const n of TREE_A) await expect(card(page, n)).toHaveCount(0);
    await expectNoXss(page, fired);
    // The note round-trips byte-for-byte into the loaded data.
    const note = await page.evaluate(() =>
        (window.Strom.DataManager.getAllPersons() as { firstName: string; notes?: string }[])
            .find((p) => p.firstName === 'Wilhelmina')?.notes);
    expect(note).toBe(`Died ${SCRIPT_NOTE} $' $& end`);
});

// ---------------------------------------------------------------------------

/** A living grandchild generation under a deceased couple, all detail-rich. */
function privacyTree(): object {
    return {
        version: 6,
        persons: {
            p_old: {
                id: 'p_old', firstName: 'Ambrose', lastName: 'Oakridge', gender: 'male',
                birthDate: '1935', deathDate: '2010', isPlaceholder: false,
                nameVariants: ['Ambrosius Eichrucken'], notes: 'Deceased note kept',
                partnerships: ['u_old'], parentIds: [], childIds: ['p_liv'],
            },
            p_oldw: {
                id: 'p_oldw', firstName: 'Beatrix', lastName: 'Oakridge', gender: 'female',
                birthDate: '1938', deathDate: '2012', isPlaceholder: false,
                partnerships: ['u_old'], parentIds: [], childIds: ['p_liv'],
            },
            p_liv: {
                id: 'p_liv', firstName: 'Livia', lastName: 'Oakridge', gender: 'female',
                birthDate: '1965-04-02', birthPlace: 'Livingtown', isPlaceholder: false,
                nameVariants: ['Liviana Secretvariant'], notes: 'Living secret note',
                partnerships: ['u_liv'], parentIds: ['p_old', 'p_oldw'], childIds: [],
            },
            p_livh: {
                id: 'p_livh', firstName: 'Lucius', lastName: 'Marrowby', gender: 'male',
                birthDate: '1963', isPlaceholder: false,
                partnerships: ['u_liv'], parentIds: [], childIds: [],
            },
        },
        partnerships: {
            u_old: {
                id: 'u_old', person1Id: 'p_old', person2Id: 'p_oldw', status: 'married',
                startDate: '1958-06-11', startPlace: 'Oldchapel',
                participants: [{ id: 'w_old', role: 'witness', name: 'Cornelius Oldwitness' }],
                note: 'Old wedding note kept',
                childIds: ['p_liv'],
            },
            u_liv: {
                id: 'u_liv', person1Id: 'p_livh', person2Id: 'p_liv', status: 'married',
                startDate: '1994-08-22', startPlace: 'Secretchapel',
                participants: [{ id: 'w_liv', role: 'witness', name: 'Theodora Hiddenwitness' }],
                note: 'Living wedding secret note',
                childIds: [],
            },
        },
    };
}

for (const privacy of ['initials', 'anonymous'] as const) {
    test(`GEDCOM export (${privacy}) drops living details, keeps the deceased`, async ({ page }, testInfo) => {
        await openApp(page);
        await createFirstPerson(page, 'Seed', 'Person');
        await importJsonAsNewTree(page, writeJson(testInfo, 'privacy.json', privacyTree()), 'Privacy');
        await expect(card(page, 'Livia')).toBeVisible();

        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.locator('#export-modal .menu-option[onclick*="exportTargetTreeGedcom"]').click();
        const ged = readFileSync(await confirmPlainExport(page, privacy), 'utf-8');

        // Living person and her marriage: no variant, note, date, place, witness.
        for (const secret of [
            'Liviana', 'Secretvariant', 'Living secret note', 'Livingtown', 'APR 1965',
            '22 AUG 1994', 'AUG 1994', 'Secretchapel', 'Theodora', 'Hiddenwitness', 'Living wedding secret note',
        ]) {
            expect(ged, `leaked "${secret}"`).not.toContain(secret);
        }
        if (privacy === 'anonymous') {
            expect(ged).not.toContain('Livia');
            expect(ged).not.toContain('Lucius');
            // Anonymous drops the wedding year too ('initials' keeps the
            // year, mirroring the birth year it keeps on the person).
            expect(ged).not.toContain('1994');
        }

        // Deceased ancestors keep their data.
        for (const kept of [
            'Ambrose', 'Ambrosius Eichrucken', 'Deceased note kept', '1935', '2010',
            'Oldchapel', '11 JUN 1958', 'Cornelius Oldwitness', 'Old wedding note kept',
        ]) {
            expect(ged, `lost "${kept}"`).toContain(kept);
        }
    });
}

test('CSV export neutralizes a formula-looking name', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, '=cmd|calc', 'Formula', { birthDate: '1900' });
    await expect(card(page, '=cmd')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.locator('#export-modal .menu-option[onclick*="exportTargetTreeCsv"]').click();
    const csv = readFileSync(await confirmPlainExport(page, 'full'), 'utf-8');
    expect(csv).toContain("'=cmd|calc");
    expect(csv).not.toMatch(/(^|;|")=cmd/m);
});

import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp } from './helpers.js';

/**
 * The GEDCOM export of spec 066 §4–§5: what the file is for ("Back to
 * {prog}" or "To share with others") and the footer warning when a choice
 * leaves sources out. Invented data.
 */

/**
 * A deceased man (a photo, a birth citation with a research origin and a
 * person citation), a living couple (the husband cites two sources, the
 * marriage one), loaded from "Ancestral Quill" when `withImport`.
 */
async function seedTree(page: Page, opts: { sources?: boolean; withImport?: boolean; ids?: boolean; pages?: boolean } = {}): Promise<void> {
    const sources = opts.sources ?? true;
    const withImport = opts.withImport ?? true;
    const ids = opts.ids ?? false;
    const pages = opts.pages ?? false;
    await page.evaluate(async ({ sources, withImport, ids, pages }) => {
        const cite = (ids: string[]) => (sources ? ids : undefined);
        const persons = {
            d1: {
                id: 'd1', firstName: 'Quorvel', lastName: 'Harrowfield', gender: 'male', isPlaceholder: false,
                birthDate: '1850-03-01', deathDate: '1920-11-02',
                birthSourceIds: cite(['s1']), sourceIds: cite(['s2']),
                photo: 'data:image/jpeg;base64,' + 'Q'.repeat(4000),
                researchOrigins: sources ? { birth: { kind: 'research', sourceIds: ['s1'] } } : undefined,
                partnerships: [], parentIds: [], childIds: ['l1'],
            },
            l1: {
                id: 'l1', firstName: 'Tobiah', lastName: 'Harrowfield', gender: 'male', isPlaceholder: false,
                birthDate: '1980-05-05', sourceIds: cite(['s2', 's3']),
                partnerships: ['u1'], parentIds: ['d1'], childIds: [],
            },
            l2: {
                id: 'l2', firstName: 'Mirabeth', lastName: 'Thornquist', gender: 'female', isPlaceholder: false,
                birthDate: '1982', partnerships: ['u1'], parentIds: [], childIds: [],
            },
        };
        const partnerships = {
            u1: { id: 'u1', person1Id: 'l1', person2Id: 'l2', status: 'married', startDate: '2008-06-14', sourceIds: cite(['s4']), childIds: [] },
        };
        const data: Record<string, unknown> = { persons, partnerships };
        if (sources) {
            data.sources = {
                s1: { id: 's1', title: 'Baptisms Harrowmoor 1840-1860', reference: 'p. 41' },
                s2: { id: 's2', title: 'Census Harrowmoor 1900' },
                s3: { id: 's3', title: 'Guild roll of coopers' },
                s4: { id: 's4', title: 'Civil marriages Thornby 2008' },
            };
        }
        if (withImport) data.imports = [{ id: 'I1', program: 'Ancestral Quill', at: '2026-10-01T10:00:00Z', file: 'harrowfield.ged' }];
        if (sources && withImport && pages) {
            // One record of the loaded file cited at two pages: two entries here, one record back.
            const book = (data.sources as Record<string, Record<string, unknown>>);
            const record = { importId: 'I1', originalIds: [{ from: 'I1', xref: 'S500001' }] };
            Object.assign(book.s1, record);
            book.s5 = { id: 's5', title: 'Baptisms Harrowmoor 1840-1860', reference: 'p. 44', ...record };
            Object.assign(persons.l2, { birthSourceIds: ['s5'] });
        }
        if (withImport && ids) {
            // Their records in the loaded file (spec 066 K3.2); I-7 is no GEDCOM 5.5.1 xref.
            Object.assign(persons.d1, { importId: 'I1', originalIds: [{ from: 'I1', xref: 'I500001', ids: [{ tag: '_UID', value: 'AB12CD34EF56AB12CD34EF56AB12CD34' }, { tag: 'RIN', value: '17' }] }] });
            Object.assign(persons.l2, { importId: 'I1', originalIds: [{ from: 'I1', xref: 'I-7' }] });
            Object.assign(partnerships.u1, { importId: 'I1', originalIds: [{ from: 'I1', xref: 'F500001' }] });
        }
        await window.Strom.DataManager.importAsNewTree(data as never, 'Harrowfield');
        await window.Strom.TreeRenderer.setFocus('d1' as never);
    }, { sources, withImport, ids, pages });
}

async function openGedcomExport(page: Page, preset?: 'back') {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate((p) => window.Strom.UI.exportTargetTreeGedcom(p ? { preset: p } : undefined), preset);
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    return pwd;
}

async function download(page: Page): Promise<string> {
    const [file] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#export-password-modal #export-submit-btn').click(),
    ]);
    return readFileSync(await file.path(), 'utf-8');
}

/** The level-0 records of a GEDCOM file. */
function records(ged: string): string[] {
    return ged.replace(/\r\n/g, '\n').split(/\n(?=0 )/);
}

test('the default GEDCOM export is "To share": privacy and content as before, the living protected', async ({ page }) => {
    await openApp(page);
    await seedTree(page);
    const pwd = await openGedcomExport(page);

    const purpose = pwd.locator('#export-gedcom-purpose');
    await expect(purpose).toBeVisible();
    await expect(pwd.locator('#export-purpose-share')).toBeChecked();
    await expect(pwd.locator('#export-purpose-back-title')).toHaveText('Back to Ancestral Quill');
    // The purpose stands above the privacy choice.
    const purposeBox = await purpose.boundingBox();
    const privacyBox = await pwd.locator('#export-privacy-section').boundingBox();
    expect(purposeBox!.y).toBeLessThan(privacyBox!.y);
    await expect(pwd.locator('#export-privacy-mode')).toHaveValue('initials');
    await expect(pwd.locator('#export-content-section')).toBeVisible();
    await expect(pwd.locator('#export-back-section')).toBeHidden();

    const ged = await download(page);
    // The living are protected, the deceased keeps his sources, no research note.
    expect(ged).not.toContain('Tobiah');
    expect(ged).toContain('Quorvel');
    expect(ged).toContain('Baptisms Harrowmoor 1840-1860');
    expect(ged).not.toContain('Guild roll of coopers');
    expect(ged).not.toContain('Strom research');
});

test('another export shows no purpose choice', async ({ page }) => {
    await openApp(page);
    await seedTree(page);
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeJSON());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await expect(pwd.locator('#export-gedcom-purpose')).toBeHidden();
    await expect(pwd.locator('#export-sources-warning')).toBeEmpty();
});

test('"Back": every source and citation of the deceased and the living, no media, a note on the research\'s fact', async ({ page }) => {
    await openApp(page);
    await seedTree(page);
    const pwd = await openGedcomExport(page);
    await pwd.locator('label:has(#export-purpose-back)').click();
    await expect(pwd.locator('#export-purpose-back')).toBeChecked();

    // Privacy and content give way to the summary.
    await expect(pwd.locator('#export-privacy-section')).toBeHidden();
    await expect(pwd.locator('#export-content-section')).toBeHidden();
    const summary = pwd.locator('#export-back-summary');
    await expect(summary).toContainText('Full data of everyone, living people included');
    await expect(summary).toContainText('Sources and citations (4 sources, 5 citations)');
    await expect(summary).toContainText('Without photos and attachments');
    await expect(pwd.locator('#export-back-mark')).toBeChecked();
    await expect(pwd.locator('#export-back-mark-sub')).toContainText('Derived by the Strom research (per: Baptisms Harrowmoor 1840-1860, p. 41)');
    await expect(pwd.locator('#export-back-living-text')).toHaveText('The file contains data of 2 living people. It belongs only in one\'s own program.');
    await expect(pwd.locator('#export-back-size')).toContainText(/Estimated size:/);
    await expect(pwd.locator('#export-sources-warning')).toBeEmpty();

    const ged = await download(page);
    expect(ged).not.toContain('data:');
    for (const name of ['Quorvel', 'Tobiah', 'Mirabeth']) expect(ged).toContain(name);
    const all = records(ged);
    expect(all.filter(r => /^0 @S\d+@ SOUR/.test(r))).toHaveLength(4);
    const deceased = all.find(r => r.includes('Quorvel'))!;
    const living = all.find(r => r.includes('Tobiah'))!;
    expect(deceased).toMatch(/1 BIRT[\s\S]*2 SOUR @S\d+@/);
    expect((living.match(/^1 SOUR @S\d+@$/gm) ?? []).length).toBe(2);
    expect(all.find(r => /^0 @F\d+@ FAM/.test(r) && r.includes('MARR'))).toMatch(/SOUR @S\d+@/);
    expect(deceased).toContain('2 NOTE Derived by the Strom research (per: Baptisms Harrowmoor 1840-1860, p. 41)');
    expect((ged.match(/Derived by the Strom research/g) ?? []).length).toBe(1);
});

test('"Back" counts a record cited at several pages once, as the file writes it', async ({ page }) => {
    await openApp(page);
    await seedTree(page, { pages: true });
    const pwd = await openGedcomExport(page, 'back');
    // Five entries in the tree, two of them one record of the loaded file.
    await expect(pwd.locator('#export-back-summary')).toContainText('Sources and citations (4 sources, 6 citations)');
    const all = records(await download(page));
    expect(all.filter(r => /^0 @[^@]+@ SOUR/.test(r))).toHaveLength(4);
    expect(all.find(r => r.includes('Mirabeth'))).toMatch(/1 BIRT[\s\S]*2 SOUR @S500001@\n3 PAGE p\. 44/);
});

test('"Back" gives the program\'s records their own xrefs and ids again; one it cannot use goes as REFN', async ({ page }) => {
    await openApp(page);
    await seedTree(page, { ids: true });
    const pwd = await openGedcomExport(page, 'back');
    await expect(pwd.locator('#export-purpose-back')).toBeChecked();
    const ged = await download(page);
    const all = records(ged);
    const deceased = all.find(r => r.includes('Quorvel'))!;
    expect(deceased).toMatch(/^0 @I500001@ INDI$/m);
    expect(deceased).toContain('1 _UID AB12CD34EF56AB12CD34EF56AB12CD34');
    expect(deceased).toContain('1 RIN 17');
    const wife = all.find(r => r.includes('Mirabeth'))!;
    expect(wife).not.toMatch(/^0 @I-7@/m);
    expect(wife).toContain('1 REFN I-7\n2 TYPE Ancestral Quill xref');
    const family = all.find(r => /^0 @F500001@ FAM$/m.test(r))!;
    expect(family).toBeTruthy();
    expect(family).toMatch(/^1 WIFE @I\d+@$/m);
    const xrefs = all.map(r => r.split(' ')[1]).filter(x => x?.startsWith('@'));
    expect(new Set(xrefs).size).toBe(xrefs.length);
});

test('"Back" without the mark writes no note; "To share" brings the choices back', async ({ page }) => {
    await openApp(page);
    await seedTree(page);
    const pwd = await openGedcomExport(page, 'back');
    await pwd.locator('#export-back-mark').uncheck();
    await pwd.locator('label:has(#export-purpose-share)').click();
    await expect(pwd.locator('#export-privacy-section')).toBeVisible();
    await expect(pwd.locator('#export-content-section')).toBeVisible();
    await expect(pwd.locator('#export-privacy-mode')).toHaveValue('initials');
    await pwd.locator('label:has(#export-purpose-back)').click();
    const ged = await download(page);
    expect(ged).toContain('Tobiah');
    expect(ged).not.toContain('Strom research');
});

test('{ preset: "back" } opens with "Back" chosen; without an import the program is generic', async ({ page }) => {
    await openApp(page);
    await seedTree(page, { withImport: false });
    const pwd = await openGedcomExport(page, 'back');
    await expect(pwd.locator('#export-purpose-back')).toBeChecked();
    await expect(pwd.locator('#export-purpose-back-title')).toHaveText('Back to another program');
    await expect(pwd.locator('#export-back-section')).toBeVisible();
    await expect(pwd.locator('#export-privacy-section')).toBeHidden();
});

test('"Skeleton only" warns of the lost sources; "Keep sources" brings them back', async ({ page }) => {
    await openApp(page);
    await seedTree(page);
    const pwd = await openGedcomExport(page);
    const warning = pwd.locator('#export-sources-warning');
    await expect(warning).toHaveAttribute('role', 'status');
    await expect(warning).toHaveAttribute('aria-live', 'polite');

    await pwd.locator('.content-preset[data-preset="skeleton"]').click();
    await expect(warning).toHaveClass(/is-loss/);
    await expect(warning).toContainText('The file will be without 4 sources and 5 citations.');
    await warning.getByRole('button', { name: 'Keep sources' }).click();

    await expect(pwd.locator('#export-content-sources')).toBeChecked();
    await expect(warning).not.toHaveClass(/is-loss/);
    await expect(warning.getByRole('button')).toHaveCount(0);
    // The skeleton with sources is no preset any more.
    await expect(pwd.locator('.content-preset.active')).toHaveCount(0);
    // Initials still: the quiet sentence of the living's citations.
    await expect(warning).toHaveClass(/is-living/);
});

test('a privacy mode with sources: a quiet sentence of the living\'s citations, none under Full data', async ({ page }) => {
    await openApp(page);
    await seedTree(page);
    const pwd = await openGedcomExport(page);
    const warning = pwd.locator('#export-sources-warning');
    await expect(warning).toHaveClass(/is-living/);
    await expect(warning).toHaveText('For 2 living people, 3 citations are left out. The deceased keep their sources.');
    await expect(warning.getByRole('button')).toHaveCount(0);
    await pwd.locator('#export-privacy-mode').selectOption('full');
    await expect(warning).toBeEmpty();
    await pwd.locator('#export-privacy-mode').selectOption('anonymous');
    await expect(warning).toHaveClass(/is-living/);
});

test('a tree without sources: no warning, whatever the choice', async ({ page }) => {
    await openApp(page);
    await seedTree(page, { sources: false });
    const pwd = await openGedcomExport(page);
    const warning = pwd.locator('#export-sources-warning');
    await expect(warning).toBeEmpty();
    await pwd.locator('.content-preset[data-preset="skeleton"]').click();
    await expect(pwd.locator('#export-content-sources')).not.toBeChecked();
    await expect(warning).toBeEmpty();
    // "Back" says the tree has none yet and offers no research mark.
    await pwd.locator('label:has(#export-purpose-back)').click();
    await expect(pwd.locator('#export-back-summary')).toContainText('Sources and citations (the tree has none yet)');
    await expect(pwd.locator('#export-back-mark-row')).toBeHidden();
});

test('phone 390: the GEDCOM dialog fills the screen, the two buttons side by side', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openApp(page);
    await seedTree(page);
    const pwd = await openGedcomExport(page);
    const modal = pwd.locator('.modal');
    const box = (await modal.boundingBox())!;
    // Initials: the quiet warning stands in the footer too.
    await expect(pwd.locator('#export-sources-warning')).toHaveClass(/is-living/);
    expect(box.height).toBeGreaterThanOrEqual(778);
    expect(box.width).toBeGreaterThanOrEqual(388);
    const cancel = (await pwd.locator('.export-buttons > button[data-dismiss]').boundingBox())!;
    const submit = (await pwd.locator('#export-submit-btn').boundingBox())!;
    expect(Math.abs(cancel.y - submit.y)).toBeLessThan(2);
    expect(cancel.x).toBeLessThan(submit.x);
    const warn = (await pwd.locator('#export-sources-warning').boundingBox())!;
    expect(warn.y + warn.height).toBeLessThanOrEqual(submit.y + 1);
    expect(cancel.height).toBeGreaterThanOrEqual(44);
    expect(submit.height).toBeGreaterThanOrEqual(44);
    // No horizontal overflow of the dialog.
    const overflow = await modal.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    // The warning with "Keep sources" fits the footer without pushing the dialog wider.
    await pwd.locator('#export-content-edit').click();
    await pwd.locator('.content-preset[data-preset="skeleton"]').click();
    await expect(pwd.locator('.export-keep-sources')).toBeVisible();
    expect(await modal.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

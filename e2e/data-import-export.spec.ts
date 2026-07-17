import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import {
    openApp, createFirstPerson, card, cardAction, addRelation, fillPerson,
    exportTreeJson, importJsonAsNewTree, focusViaSearch,
} from './helpers.js';

/** Build a small couple-with-child tree: Jan + Marie, child Petr. */
async function buildFamily(page: Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
}

function personCount(page: Page): Promise<number> {
    return page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length);
}

test('JSON round-trip: export a 3-person tree, re-import it as a new tree', async ({ page }) => {
    await openApp(page);
    await buildFamily(page);

    const jsonPath = await exportTreeJson(page);
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    expect(Object.keys(data.persons)).toHaveLength(3);
    expect(Object.keys(data.partnerships)).toHaveLength(1);

    await importJsonAsNewTree(page, jsonPath, 'Roundtrip');
    // The imported tree is now active; all three persons and the child link survive.
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Roundtrip');
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();
    await expect(card(page, 'Petr')).toBeVisible();
    expect(await personCount(page)).toBe(3);
});

test('JSON import carries rich fields: photo, note and a life event survive the real file path', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    // Import through the actual <input type=file> the user drives, as a new tree.
    await importJsonAsNewTree(page, 'e2e/fixtures/rich-person.json', 'Rich');
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Rich');
    await expect(card(page, 'Bohumil')).toBeVisible();

    // The rich content that a hand-built importer used to drop is all present.
    const rich = await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()
            .find((x: { firstName: string }) => x.firstName === 'Bohumil') as {
                notes?: string; photo?: string;
                events?: { type: string; participants?: { name?: string }[] }[];
            } | undefined;
        return {
            hasNote: !!p?.notes && p.notes.length > 0,
            hasPhoto: !!p?.photo && p.photo.startsWith('data:image'),
            eventType: p?.events?.[0]?.type,
            godparent: p?.events?.[0]?.participants?.[0]?.name,
        };
    });
    expect(rich.hasNote).toBe(true);
    expect(rich.hasPhoto).toBe(true);
    expect(rich.eventType).toBe('baptism');
    expect(rich.godparent).toBe('Josef Kmotr');
});

test('importing as a new tree leaves the existing tree untouched', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Solo', 'Original'); // unique name (fixtures use "Jan")
    const originalTree = (await page.locator('.tree-switcher-btn .tree-name').textContent())?.trim() || '';

    await importJsonAsNewTree(page, 'e2e/fixtures/family-basic.json', 'Imported');
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Imported');
    await expect(card(page, 'Jan')).toBeVisible();   // Jan Fixture
    await expect(card(page, 'Petr')).toBeVisible();  // Petr Fixture

    // The original tree is still there with its person intact.
    await page.locator('.tree-switcher-btn').click();
    await page.locator('.tree-switcher-item', { hasText: originalTree }).first().click();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(originalTree);
    await expect(card(page, 'Solo')).toBeVisible();
    await expect.poll(() => personCount(page)).toBe(1);
});

test('GEDCOM export and re-import through the UI preserves names and relations', async ({ page }) => {
    await openApp(page);
    await buildFamily(page);

    // Export as GEDCOM (passwordless dialog).
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeGedcom());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    // Keep full names (persons without a birth date default to "living").
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [gedDownload] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    const gedPath = await gedDownload.path();
    const ged = readFileSync(gedPath, 'utf-8');
    expect(ged).toContain('0 @I1@ INDI');
    expect(ged).toContain('Jan /Novak/');

    // Import it back as a new tree.
    await page.locator('#gedcom-input').setInputFiles(gedPath);
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await expect(page.locator('#gedcom-stat-persons')).toHaveText('3');
    await result.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.locator('#import-tree-name').fill('From GEDCOM');
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();
    await expect(card(page, 'Petr')).toBeVisible();
});

test('focus export writes only the focused branch, not other families', async ({ page }) => {
    await openApp(page);
    await buildFamily(page); // connected family: Jan + Marie + Petr

    // A second, unrelated family in the same tree (disconnected component).
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, 'Standalone', 'Other');
    expect(await personCount(page)).toBe(4);

    // Focus the first family; the unrelated person is not in the visible set.
    await cardAction(page, 'Jan', 'focus');
    await page.evaluate(() => window.Strom.UI.exportFocusedJSON());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    const data = JSON.parse(readFileSync(await download.path(), 'utf-8'));
    const names = Object.values(data.persons).map((p: { firstName: string }) => p.firstName);
    expect(names).toContain('Jan');
    expect(names).not.toContain('Standalone');
    expect(Object.keys(data.persons).length).toBeLessThan(4);
});

test('invalid JSON import shows a readable error and keeps existing data', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#file-input').setInputFiles('e2e/fixtures/broken.json');
    const validation = page.locator('#validation-modal');
    await expect(validation).toBeVisible();
    // The app did not crash and the original person is still present.
    await expect(card(page, 'Jan')).toBeVisible();
    expect(await personCount(page)).toBe(1);
});

test('garbage GEDCOM import does not crash the app', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/broken.ged');
    // A lenient parser yields an empty result dialog (0 persons) rather than an
    // error; either way the app stays alive and the existing tree is untouched.
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await expect(page.locator('#gedcom-stat-persons')).toHaveText('0');
    await page.evaluate(() => window.Strom.UI.closeGedcomResultDialog());
    await expect(card(page, 'Jan')).toBeVisible();
    expect(await personCount(page)).toBe(1);
});

test('demo tree can be exported and re-imported with the same person count', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();
    const demoCount = await personCount(page);
    expect(demoCount).toBeGreaterThan(3);

    const jsonPath = await exportTreeJson(page);
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    expect(Object.keys(data.persons)).toHaveLength(demoCount);

    await importJsonAsNewTree(page, jsonPath, 'Demo Copy');
    expect(await personCount(page)).toBe(demoCount);
});

test('encrypted JSON import: wrong password shows an error, retry with the right one imports', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Tajny', 'Novak');

    // Export the tree as an encrypted JSON.
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeJSON());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-password-input').fill('correct-horse');
    await pwd.locator('#export-password-confirm').fill('correct-horse');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.locator('#export-with-password-btn').click(),
    ]);
    const filePath = await download.path();

    // Importing it prompts for the password.
    await page.locator('#file-input').setInputFiles(filePath);
    const prompt = page.locator('#password-prompt-modal');
    await expect(prompt).toBeVisible();

    // Wrong password: an error appears and the prompt stays alive for a retry.
    await prompt.locator('#password-prompt-input').fill('nope');
    await prompt.locator('button[type="submit"]').click();
    await expect(prompt.locator('#password-prompt-error')).toBeVisible();

    // Right password on the SAME prompt completes the import.
    await prompt.locator('#password-prompt-input').fill('correct-horse');
    await prompt.locator('button[type="submit"]').click();
    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#import-tree-name').fill('Decrypted');
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Decrypted');
    await expect(card(page, 'Tajny')).toBeVisible();
});

test('CSV export downloads a localized person table', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeCsv());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const path = await download.path();
    const text = readFileSync(path!, 'utf-8');
    expect(text).toContain('First name;Last name');
    expect(text).toContain('Jan;Novak');
});

test('GEDCOM import: rich summary + bulk media attach by file name', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/media-refs.ged');

    const dialog = page.locator('#gedcom-result-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#gedcom-stat-persons')).toHaveText('2');
    // External media offer is visible and names the count.
    const mediaRow = dialog.locator('#gedcom-media-row');
    await expect(mediaRow).toBeVisible();
    await expect(mediaRow).toContainText('2');

    // Attach the folder contents — one file matches by basename.
    await page.locator('#gedcom-media-input').setInputFiles('e2e/fixtures/avatar.png');
    await expect(page.locator('.toast')).toContainText('1');
    // One ref remains (missing-photo.jpg), the row stays with count 1.
    await expect(mediaRow).toContainText('1');
    // Photos tile appears.
    await expect(dialog.locator('#gedcom-stat-photos')).toHaveText('1');

    // Import as new tree: the photo really lands on Jan.
    await dialog.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();
    const hasPhoto = await page.evaluate(() => {
        const jan = window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Jan');
        return !!jan?.photo && jan.photo.startsWith('data:image');
    });
    expect(hasPhoto).toBe(true);
});

test('GEDCOM import: photos referenced by URL download directly (MyHeritage)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    // Serve the CDN URL from the test fixture.
    await page.route('https://cdn.mh-test.example/**', route =>
        route.fulfill({ path: 'e2e/fixtures/avatar.png', contentType: 'image/png' }));

    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/mh-style.ged');
    const dialog = page.locator('#gedcom-result-modal');
    await expect(dialog).toBeVisible();

    const downloadBtn = dialog.locator('#gedcom-media-download');
    await expect(downloadBtn).toBeVisible();
    await downloadBtn.click();
    await expect(page.locator('.toast')).toContainText('1');
    await expect(dialog.locator('#gedcom-stat-photos')).toHaveText('1');
    // All refs resolved — the media row disappears.
    await expect(dialog.locator('#gedcom-media-row')).toBeHidden();
});

test('plain GEDCOM import clears stale manager intent; new-tree opens naming dialog', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Emil', 'Visek');
    await page.route('https://cdn.mh-test.example/**', route =>
        route.fulfill({ path: 'e2e/fixtures/avatar.png', contentType: 'image/png' }));

    // Leave a STALE manager flag from an earlier (abandoned) manager import.
    await page.evaluate(() => { (window.Strom.UI as unknown as { importFromTreeManager: boolean }).importFromTreeManager = true; });

    // Plain path: the main "Import GEDCOM" entry clears that stale intent.
    await page.evaluate(() => window.Strom.UI.startGedcomImportPlain());
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/mh-style.ged');
    const dialog = page.locator('#gedcom-result-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#gedcom-media-download').click();
    await expect(page.locator('.toast')).toContainText('1');

    await dialog.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await expect(dialog).toBeHidden();
});

test('make a tree from the current view creates a separate tree of the shown people', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    const treesBefore = await page.evaluate(() => window.Strom.TreeManager.getTrees().length);
    const shown = await page.evaluate(() => window.Strom.TreeRenderer.getVisiblePersonIds().size);

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.locator('#make-tree-from-view-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    // Name is pre-filled from the focus person.
    await expect(importDialog.locator('#import-tree-name')).toHaveValue(/Henry VIII/);
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    // A new tree exists and it is now active; it has at most the shown people.
    const treesAfter = await page.evaluate(() => window.Strom.TreeManager.getTrees().length);
    expect(treesAfter).toBe(treesBefore + 1);
    const count = await page.evaluate(() =>
        Object.keys(window.Strom.DataManager.getData().persons).length);
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(shown + 2);   // + possible glue partners
});

test('focus slice (New Tree from focus) is self-consistent — no dangling refs', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    // Focus a mid-tree person so some parents/children are off-screen.
    await focusViaSearch(page, 'Henry VIII');

    const consistent = await page.evaluate(() => {
        const data = window.Strom.TreeRenderer.getFocusedData();
        if (!data) return { ok: false, reason: 'no data' };
        const ids = new Set(Object.keys(data.persons));
        for (const p of Object.values(data.persons) as any[]) {
            for (const pid of p.parentIds) if (!ids.has(pid)) return { ok: false, reason: 'dangling parent ' + pid };
            for (const cid of p.childIds) if (!ids.has(cid)) return { ok: false, reason: 'dangling child ' + cid };
        }
        for (const u of Object.values(data.partnerships) as any[]) {
            if (!ids.has(u.person1Id) || !ids.has(u.person2Id)) return { ok: false, reason: 'dangling partner' };
            for (const c of u.childIds) if (!ids.has(c)) return { ok: false, reason: 'dangling union child' };
        }
        return { ok: true };
    });
    expect(consistent.ok, consistent.reason).toBe(true);
});

test('post-import health check offers a review when the data has issues (M6)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    const bad = {
        version: 5,
        persons: { p1: { id: 'p1', firstName: 'Jan', lastName: 'Novak', gender: 'male',
            isPlaceholder: false, parentIds: [], childIds: [], partnerships: [],
            birthDate: '1950', deathDate: '1940' } },
        partnerships: {},
    };
    await page.evaluate((data) => {
        const dt = new DataTransfer();
        const file = new File([JSON.stringify(data)], 'bad.json', { type: 'application/json' });
        dt.items.add(file);
        const input = document.getElementById('file-input') as HTMLInputElement;
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, bad);
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import' }).click();

    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(/checked the imported data|zkontrolovali/i);
    await confirm.locator('#confirm-ok-btn').click();
    await expect(page.locator('#tree-validation-modal')).toBeVisible();
    await expect(page.locator('#tree-validation-modal')).toContainText(/Death date is before birth|before birth/i);
});

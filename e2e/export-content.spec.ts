import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, createFirstPerson } from './helpers.js';

/** Give the first (and only) person a sizeable inline photo. */
async function giveFirstPersonAPhoto(page: Page): Promise<void> {
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        window.Strom.DataManager.updatePerson(p.id, { photo: 'data:image/jpeg;base64,' + 'A'.repeat(4000) });
    });
}

/** Open the JSON export dialog (which surfaces the Content section). */
async function openJsonExportDialog(page: Page) {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeJSON());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    return pwd;
}

test('export dialog shows the Content section: four checkboxes on by default, three presets, live estimate', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });

    const pwd = await openJsonExportDialog(page);
    const section = pwd.locator('#export-content-section');
    await expect(section).toBeVisible();

    // Four checkboxes, all ticked.
    for (const id of ['photos', 'attachments', 'notes', 'sources']) {
        await expect(pwd.locator(`#export-content-${id}`)).toBeChecked();
    }
    // Three presets, with "Complete archive" highlighted (matches all-on).
    await expect(pwd.locator('.content-preset')).toHaveCount(3);
    await expect(pwd.locator('.content-preset[data-preset="complete"]')).toHaveClass(/active/);

    // A live size estimate is shown.
    await expect(pwd.locator('#export-content-size')).toContainText(/Estimated size:/);
});

test('"Small file to send" produces a JSON without photos but with the persons', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });
    await giveFirstPersonAPhoto(page);

    const pwd = await openJsonExportDialog(page);
    await pwd.locator('#export-privacy-mode').selectOption('full');

    // Apply the "small file" preset: photos + attachments off, text kept.
    await pwd.locator('.content-preset[data-preset="small"]').click();
    await expect(pwd.locator('#export-content-photos')).not.toBeChecked();
    await expect(pwd.locator('#export-content-notes')).toBeChecked();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.locator('#export-submit-btn').click(),
    ]);
    const data = JSON.parse(readFileSync(await download.path(), 'utf-8'));

    // Persons survive; no person carries a photo.
    expect(Object.keys(data.persons).length).toBe(1);
    const withPhoto = Object.values(data.persons).filter((p: { photo?: string }) => p.photo);
    expect(withPhoto).toHaveLength(0);
    // Names (structure) are intact.
    expect(Object.values(data.persons).map((p: { firstName: string }) => p.firstName)).toContain('Jan');
});

test('size estimate shrinks when photos are unchecked', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });
    await giveFirstPersonAPhoto(page);

    const pwd = await openJsonExportDialog(page);
    const sizeEl = pwd.locator('#export-content-size');
    const before = (await sizeEl.textContent())?.trim();

    // Unchecking photos drops the largest component; the estimate must change.
    await pwd.locator('#export-content-photos').uncheck();
    const after = (await sizeEl.textContent())?.trim();

    expect(after).not.toBe(before);
    // Custom mix: no preset stays highlighted.
    await expect(pwd.locator('.content-preset.active')).toHaveCount(0);
});

/**
 * Any privacy mode but Full data leaves out every source, citation and
 * attachment, the deceased's too (audit 017 c-D4). The dialog says so under
 * the privacy choice and in Content, the two checkboxes stop looking
 * included, and the estimate is sized on what the file really carries.
 */
test.describe('export with privacy of living people: sources and attachments', () => {
    /** A deceased man with a scan attached and a cited source, as its own tree. */
    async function seedTreeWithSources(page: Page): Promise<void> {
        await page.evaluate(async () => {
            const scan = 'data:image/jpeg;base64,' + 'B'.repeat(60000);
            const persons = {
                p1: {
                    id: 'p1', firstName: 'Jan', lastName: 'Novak', gender: 'male', isPlaceholder: false,
                    birthDate: '1850', deathDate: '1920', partnerships: [], parentIds: [], childIds: [], sourceIds: ['src1'],
                    attachments: [{ id: 'att1', name: 'matrika.jpg', mimeType: 'image/jpeg', dataUrl: scan, sizeBytes: 45000, sourceId: 'src1' }],
                },
            };
            const sources = { src1: { id: 'src1', title: 'Baptism of Jan 1850', reference: 'fol. 12', transcript: 'Johann, ehelicher Sohn '.repeat(40) } };
            await window.Strom.DataManager.importAsNewTree({ persons, partnerships: {}, sources } as never, 'Novak');
            await window.Strom.TreeRenderer.setFocus('p1' as never);
        });
    }

    async function openGedcomExport(page: Page) {
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.evaluate(() => window.Strom.UI.exportTargetTreeGedcom());
        const pwd = page.locator('#export-password-modal');
        await expect(pwd).toBeVisible();
        return pwd;
    }

    test('GEDCOM with the default privacy: the note shows, the two checkboxes are inert, the estimate leaves them out', async ({ page }) => {
        await openApp(page);
        await seedTreeWithSources(page);
        const pwd = await openGedcomExport(page);
        const privacy = pwd.locator('#export-privacy-mode');
        const note = pwd.locator('#export-privacy-drops');
        const contentNote = pwd.locator('#export-content-privacy-note');
        const size = pwd.locator('#export-content-size');

        // Default: initials + birth year.
        await expect(privacy).toHaveValue('initials');
        await expect(note).toBeVisible();
        await expect(note).toHaveText('With any choice other than “Full data”, sources, citations and attachments are not exported, not even for deceased people.');
        await expect(contentNote).toBeVisible();
        await expect(contentNote).toHaveText('Attachments and sources are left out by the chosen privacy of living people.');
        await expect(pwd.locator('#export-content-attachments')).toBeDisabled();
        await expect(pwd.locator('#export-content-sources')).toBeDisabled();
        // Photos and notes are not touched by the note.
        await expect(pwd.locator('#export-content-photos')).toBeEnabled();
        await expect(pwd.locator('#export-content-notes')).toBeEnabled();
        const withPrivacy = (await size.textContent())?.trim();

        // Full data: no note, the checkboxes take part again, the estimate grows by the scan.
        await privacy.selectOption('full');
        await expect(note).toBeHidden();
        await expect(contentNote).toBeHidden();
        await expect(pwd.locator('#export-content-attachments')).toBeEnabled();
        await expect(pwd.locator('#export-content-attachments')).toBeChecked();
        await expect(pwd.locator('#export-content-sources')).toBeEnabled();
        await expect(pwd.locator('#export-content-sources')).toBeChecked();
        const full = (await size.textContent())?.trim();
        expect(full).not.toBe(withPrivacy);
        const bytes = (t?: string): number => {
            const m = /([\d.]+)\s*(B|KB|MB)/.exec(t ?? '');
            return m ? parseFloat(m[1]) * ({ B: 1, KB: 1024, MB: 1024 * 1024 } as Record<string, number>)[m[2]] : NaN;
        };
        expect(bytes(full) - bytes(withPrivacy)).toBeGreaterThan(40 * 1024);

        // Back to a privacy mode: the same as at the start.
        await privacy.selectOption('anonymous');
        await expect(note).toBeVisible();
        await expect(size).toHaveText(withPrivacy!);
    });

    test('a tree without sources or attachments: no note under a privacy mode', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });
        const pwd = await openGedcomExport(page);
        await expect(pwd.locator('#export-privacy-mode')).toHaveValue('initials');
        await expect(pwd.locator('#export-content-section')).toBeVisible();
        await expect(pwd.locator('#export-privacy-drops')).toBeHidden();
        await expect(pwd.locator('#export-content-privacy-note')).toBeHidden();
        await expect(pwd.locator('#export-content-attachments')).toBeEnabled();
        await expect(pwd.locator('#export-content-sources')).toBeEnabled();
    });
});

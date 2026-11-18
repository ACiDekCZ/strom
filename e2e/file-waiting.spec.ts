import { test, expect, type Page } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

function personCount(page: Page): Promise<number> {
    return page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length);
}

/**
 * Files and the waiting buttons (§9, 2g, 9a–9c): nothing shows while the system's dialog is open; a file chosen
 * is read as its row's working state with its name; a file that cannot be read is said at the row with "Choose
 * another file" (no alert); a choice called off gives the button back at once; a backup is saved while its
 * dialog stays, then a toast names the file; "Save as" first, the state after it.
 */

const GED = [
    '0 HEAD', '1 CHAR UTF-8', '1 GEDC', '2 VERS 5.5.1',
    '0 @I1@ INDI', '1 NAME Ota /Rybízek/', '1 SEX M', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Hedvika /Brzobohatá/', '1 SEX F', '1 FAMS @F1@',
    '0 @I3@ INDI', '1 NAME Vilém /Rybízek/', '1 SEX M', '1 FAMC @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@',
    '0 TRLR', '',
].join('\n');

/** Reading a chosen file takes a while (a large file), so its working state can be seen. */
async function slowFileReads(page: Page, ms = 700): Promise<void> {
    await page.addInitScript((delay: number) => {
        const slow = <K extends 'arrayBuffer' | 'text'>(k: K): void => {
            const orig = Blob.prototype[k] as () => Promise<unknown>;
            (Blob.prototype as unknown as Record<string, unknown>)[k] = function (this: Blob) {
                return new Promise(r => setTimeout(r, delay)).then(() => orig.call(this));
            };
        };
        slow('arrayBuffer');
        slow('text');
    }, ms);
}

async function openImport(page: Page) {
    await page.evaluate(() => window.Strom.UI.showImportDialog());
    const modal = page.locator('#import-modal');
    await expect(modal).toHaveClass(/active/);
    return modal;
}

test.describe('import from a file (9a)', () => {
    test('GEDCOM: the dialog stays, its row says "Loading <name>…", then the summary', async ({ page }) => {
        await slowFileReads(page);
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        const modal = await openImport(page);
        const row = modal.locator('.menu-option', { hasText: 'Import GEDCOM' });
        const chooser = page.waitForEvent('filechooser');
        await row.click();
        // The system's dialog: nothing shown at the row.
        await expect(row).not.toHaveAttribute('aria-busy', 'true');
        await (await chooser).setFiles({ name: 'rodina-rybizek.ged', mimeType: 'text/plain', buffer: Buffer.from(GED) });
        await expect(modal).toHaveClass(/active/);
        await expect(row.locator('.option-busy')).toContainText('Loading rodina-rybizek.ged…');
        await expect(page.locator('#gedcom-result-modal')).toBeVisible();
        await expect(page.locator('#gedcom-stat-persons')).toHaveText('3');
        await expect(modal).not.toHaveClass(/active/);
    });

    test('a file that is not GEDCOM: the sentence at its row with "Choose another file", no alert, the tree untouched', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        const modal = await openImport(page);
        const row = modal.locator('.menu-option', { hasText: 'Import GEDCOM' });
        let chooser = page.waitForEvent('filechooser');
        await row.click();
        await (await chooser).setFiles('e2e/fixtures/broken.ged');
        const msg = modal.locator('.busy-msg');
        await expect(msg).toContainText('The file cannot be read: it is neither GEDCOM nor a Strom backup.');
        await expect(modal).toHaveClass(/active/);
        await expect(page.locator('#alert-modal')).toHaveCount(0);
        await expect(page.locator('#gedcom-result-modal')).toBeHidden();
        // "Choose another file" opens the system's dialog again; a good file goes on.
        chooser = page.waitForEvent('filechooser');
        await msg.getByRole('button', { name: 'Choose another file' }).click();
        await (await chooser).setFiles({ name: 'rodina-rybizek.ged', mimeType: 'text/plain', buffer: Buffer.from(GED) });
        await expect(page.locator('#gedcom-stat-persons')).toHaveText('3');
        await page.evaluate(() => window.Strom.UI.closeGedcomResultDialog());
        await expect(card(page, 'Jan')).toBeVisible();
        expect(await personCount(page)).toBe(1);
    });

    test('a choice called off leaves the dialog as it was, its row free at once', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        const modal = await openImport(page);
        const row = modal.locator('.menu-option', { hasText: 'Import JSON' });
        let chooser = page.waitForEvent('filechooser');
        await row.click();
        await chooser;
        await page.locator('#file-input').dispatchEvent('cancel');
        await expect(modal).toHaveClass(/active/);
        // A second press opens the dialog again (not swallowed by the guard).
        chooser = page.waitForEvent('filechooser', { timeout: 3000 });
        await row.click();
        await chooser;
    });
});

test.describe('saving a backup (2g, 9b)', () => {
    test('the dialog stays while the file is made: "Saving…", what goes in above the footer, then a toast with its name', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Ota', 'Rybízek');
        await page.evaluate(() => {
            const dm = window.Strom.DataManager as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
            const orig = dm.exportTreeJSON.bind(dm);
            dm.exportTreeJSON = (...a: unknown[]) => new Promise(r => setTimeout(r, 900)).then(() => orig(...a));
        });
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.evaluate(() => window.Strom.UI.exportTargetTreeJSON());
        const pwd = page.locator('#export-password-modal');
        await expect(pwd).toBeVisible();
        const submit = pwd.locator('#export-submit-btn');
        const download = page.waitForEvent('download');
        await submit.click();
        await expect(submit).toHaveAttribute('aria-busy', 'true');
        await expect(submit).toContainText('Saving…');
        await expect(pwd.locator('.busy-step')).toContainText('Saving the backup… 1 person');
        await expect(pwd).toBeVisible();
        const file = (await download).suggestedFilename();
        await expect(pwd).toBeHidden();
        await expect(page.locator('.toast:not(.toast--progress)')).toContainText(`Backup saved: ${file}`);
    });

    test('Save to file: nothing shown while "Save as" is open, the writing after it at the row, then the dialog goes', async ({ page }) => {
        await page.addInitScript(() => {
            const w = window as unknown as Record<string, unknown>;
            w.__written = null;
            const handle = {
                name: 'rodina.json', kind: 'file',
                async createWritable() {
                    return {
                        async write(d: string) { await new Promise(r => setTimeout(r, 900)); w.__written = d; },
                        async close() {},
                    };
                },
                async queryPermission() { return 'granted'; },
                async requestPermission() { return 'granted'; },
            };
            w.showSaveFilePicker = () => new Promise(r => { w.__answerPick = () => r(handle); });
            w.isSecureContext = true;
        });
        await openApp(page);
        await createFirstPerson(page, 'Ota', 'Rybízek');
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        const modal = page.locator('#export-modal');
        const row = modal.locator('.menu-option.fsa-only.active-tree-only');
        await row.click();
        await page.waitForFunction(() => typeof (window as unknown as Record<string, unknown>).__answerPick === 'function');
        // "Save as" is open: no state, the dialog stays.
        await page.waitForTimeout(300);
        await expect(row).not.toHaveAttribute('aria-busy', 'true');
        await expect(row.locator('.option-busy')).toHaveCount(0);
        await expect(modal).toHaveClass(/active/);
        await page.evaluate(() => ((window as unknown as Record<string, () => void>).__answerPick)());
        await expect(row.locator('.option-busy')).toContainText('Saving…');
        await expect(modal).not.toHaveClass(/active/);
        await expect(page.locator('.toast:not(.toast--progress)')).toContainText('Saved to rodina.json');
        expect(await page.evaluate(() => (window as unknown as Record<string, string>).__written)).toContain('Rybízek');
    });
});

test.describe('photos of a GEDCOM import', () => {
    test('Download photos from the internet: the button working with "Downloading photos… k/n", its own label again after', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Seed', 'Person');
        await page.route('https://cdn.mh-test.example/**', async route => {
            await new Promise(r => setTimeout(r, 900));
            await route.fulfill({ path: 'e2e/fixtures/avatar.png', contentType: 'image/png' });
        });
        await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/mh-style.ged');
        const dialog = page.locator('#gedcom-result-modal');
        const btn = dialog.locator('#gedcom-media-download');
        await btn.click();
        await expect(btn).toHaveAttribute('aria-busy', 'true');
        await expect(btn).toContainText('Downloading photos… 1/1');
        await expect(btn.locator('.busy-spin')).toBeVisible();
        await expect(dialog.locator('#gedcom-stat-photos')).toHaveText('1');
        await expect(btn).not.toHaveAttribute('aria-busy', 'true');
    });
});

test.describe('a large GEDCOM read in parts (C52, §8)', () => {
    test('the row says the people found so far while the file is read, the page takes its frames, then the summary', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        const modal = await openImport(page);
        const row = modal.locator('.menu-option', { hasText: 'Import GEDCOM' });
        await page.evaluate(() => {
            const w = window as unknown as { __ged: { steps: string[]; frames: number } };
            w.__ged = { steps: [], frames: 0 };
            new MutationObserver(() => {
                for (const el of document.querySelectorAll('#import-modal .option-busy')) {
                    const t = el.textContent ?? '';
                    if (t && !w.__ged.steps.includes(t)) w.__ged.steps.push(t);
                }
            }).observe(document.getElementById('import-modal')!, { subtree: true, childList: true, characterData: true });
            const tick = (): void => { w.__ged.frames++; requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
        });
        const lines = ['0 HEAD', '1 CHAR UTF-8', '1 GEDC', '2 VERS 5.5.1'];
        // Large enough that the reading lasts past the state's 120 ms on a fast computer.
        const n = 80000;
        for (let i = 1; i <= n; i++) {
            lines.push(`0 @I${i}@ INDI`, `1 NAME Ota${i} /Rybízek${i % 89}/`, `1 SEX ${i % 2 ? 'M' : 'F'}`,
                '1 BIRT', `2 DATE ${1 + i % 28} MAR ${1700 + i % 300}`, `2 PLAC Brno ${i % 30}`, `1 FAMS @F${Math.ceil(i / 2)}@`);
        }
        for (let f = 1; f <= n / 2; f++) lines.push(`0 @F${f}@ FAM`, `1 HUSB @I${2 * f - 1}@`, `1 WIFE @I${2 * f}@`);
        lines.push('0 TRLR', '');
        const chooser = page.waitForEvent('filechooser');
        await row.click();
        const framesBefore = await page.evaluate(() => (window as unknown as { __ged: { frames: number } }).__ged.frames);
        await (await chooser).setFiles({ name: 'rybizkovi-velky.ged', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) });
        await expect(page.locator('#gedcom-result-modal')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#gedcom-stat-persons')).toHaveText(String(n));
        const ged = await page.evaluate(() => (window as unknown as { __ged: { steps: string[]; frames: number } }).__ged);
        const counts = ged.steps.map(t => /^Loading rybizkovi-velky\.ged… ([\d,]+) people$/.exec(t)?.[1]).filter(Boolean)
            .map(c => Number(c!.replace(/,/g, '')));
        // People found so far (fewer than all) said while reading: the page was let go between the parts.
        expect(counts.some(c => c > 0 && c < n), ged.steps.join(' | ')).toBe(true);
        expect(ged.frames - framesBefore).toBeGreaterThan(2);
    });
});

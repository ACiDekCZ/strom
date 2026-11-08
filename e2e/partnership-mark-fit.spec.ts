import { test, expect, Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * The reliability pill at the wedding and the divorce in the relationships
 * panel stays in its label's column: it never reaches under the date field
 * beside it (the label column grows with the pill, the rows of one couple
 * share it). Checked with the widest pills (from a family tree of another
 * program, a research's "probable") in Czech, German and Polish, on a phone,
 * a tablet and a desktop. Invented data.
 */

const LANGS = ['cs', 'de', 'pl'] as const;

function ged(testInfo: TestInfo, research: boolean): string {
    const lines = [
        '0 HEAD', ...(research ? ['1 SOUR STROM_RESEARCH'] : ['1 SOUR FTM', '2 NAME Family Tree Maker', '2 VERS 24.0']),
        '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Bonifác /Kvapilík/', '1 SEX M', '1 BIRT', '2 DATE 1850', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Zdeslava /Kvapilíková/', '1 SEX F', '1 BIRT', '2 DATE 1852', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '1 MARR', '2 DATE 8 APR 1905', ...(research ? ['2 _STROM_STATUS probable'] : []),
        '1 DIV', '2 DATE 3 MAR 1911', ...(research ? ['2 _STROM_STATUS probable'] : []),
        '0 TRLR', '',
    ];
    const p = testInfo.outputPath(research ? 'kvapilik-research.ged' : 'kvapilik.ged');
    writeFileSync(p, lines.join('\n'));
    return p;
}

async function importFromProgram(page: Page, testInfo: TestInfo): Promise<void> {
    await page.locator('#gedcom-input').setInputFiles(ged(testInfo, false));
    await page.locator('#gedcom-result-modal #gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await importDialog.locator('#import-tree-name').fill('Kvapilík');
    await importDialog.getByRole('button', { name: 'Import' }).click();
    const next = page.locator('#import-next-card');
    await expect(next).toBeVisible();
    await next.locator('.import-next-close').click();
    await expect(next).toHaveCount(0);
    await expect(card(page, 'Bonifác')).toBeVisible();
}

async function dropResearchFile(page: Page, testInfo: TestInfo): Promise<void> {
    const content = (await import('fs')).readFileSync(ged(testInfo, true), 'utf8');
    const dataTransfer = await page.evaluateHandle((c) => {
        const dt = new DataTransfer();
        dt.items.add(new File([c], 'kvapilik.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
    await expect(card(page, 'Bonifác')).toBeVisible();
}

/** Each language: the panel opened again, every pill at the wedding and the divorce clear of its row's date field. */
async function expectPillsClear(page: Page, width: number, step: string): Promise<void> {
    for (const lang of LANGS) {
        await page.evaluate(() => window.Strom.UI.closeModal?.('relationships-modal'));
        await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
        await page.evaluate(() => {
            const p = window.Strom.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Bonifác')!;
            window.Strom.UI.showRelationshipsPanel(p.id);
        });
        const modal = page.locator('#relationships-modal');
        await expect(modal).toBeVisible();
        for (const [row, date] of [['.pg-label-start', '.partnership-start-date'], ['.pg-label-end', '.partnership-end-date']] as const) {
            const pill = modal.locator(`${row} .fact-status`);
            await expect(pill).toHaveAttribute('data-fact-status', step);
            const field = modal.locator(`.partnership-grid ${date}`);
            await expect(field).toBeVisible();
            const a = (await pill.boundingBox())!;
            const b = (await field.boundingBox())!;
            const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
            const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
            expect(overlapX * overlapY, `${lang} ${width}px ${row}: pill under the date field`).toBe(0);
            // The pill keeps its word: on screen and in its accessible name.
            const word = (await pill.locator('.fs-text').innerText()).trim();
            expect(word.length).toBeGreaterThan(0);
            expect(await pill.getAttribute('aria-label')).toContain(word);
        }
        // Nothing in the couple's grid runs past its edge.
        const over = await modal.locator('.partnership-grid').evaluate((g) => {
            const r = g.getBoundingClientRect();
            const out = [...g.querySelectorAll<HTMLElement>('.pg-row > *')]
                .filter(el => el.offsetParent && el.getBoundingClientRect().right > r.right + 0.5);
            return { scroll: g.scrollWidth - g.clientWidth, out: out.length };
        });
        expect(over, `${lang} ${width}px: overflow`).toEqual({ scroll: 0, out: 0 });
    }
}

for (const [width, height] of [[390, 844], [1024, 768], [1440, 900]] as const) {
    test.describe(`the wedding's and the divorce's pill at ${width} px`, () => {
        test.use({ viewport: { width, height } });

        test('from a family tree of another program', async ({ page }, testInfo) => {
            await openApp(page);
            await importFromProgram(page, testInfo);
            await expectPillsClear(page, width, 'import');
        });

        test('a research\'s "probable"', async ({ page }, testInfo) => {
            await openApp(page);
            await dropResearchFile(page, testInfo);
            await expectPillsClear(page, width, 'probable');
        });
    });
}

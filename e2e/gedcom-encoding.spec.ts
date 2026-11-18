import { test, expect } from '@playwright/test';
import { join } from 'path';
import { openApp, createFirstPerson, waitForPersist } from './helpers.js';

/**
 * GEDCOM files from Czech and Polish Windows programs ("1 CHAR ANSI" in
 * Windows-1250): the import summary reads them with the right letters, says
 * how the encoding was settled, shows a sample of names and lets another
 * encoding re-read the file. Fixtures: test/gedcom-encoding/ (fictional names).
 */

const fixture = (name: string): string => join(process.cwd(), 'test', 'gedcom-encoding', name);

test('ANSI file in Windows-1250: right names, sample, and another encoding re-reads it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await waitForPersist(page, 'Seed');

    await page.locator('#gedcom-input').setInputFiles(fixture('ansi-czech.ged'));
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    const row = result.locator('#gedcom-encoding-row');
    await expect(row).toBeVisible();
    const select = row.locator('#gedcom-encoding-select');
    await expect(select).toHaveValue('windows-1250');
    await expect(row.locator('#gedcom-encoding-names')).toContainText('Vojtěch Dvořák');
    await expect(row.locator('#gedcom-encoding-how')).toContainText('ANSI');

    // Western page: the same bytes turn into è/ø — visible in the sample.
    await select.selectOption('windows-1252');
    await expect(row.locator('#gedcom-encoding-names')).toContainText('Vojtìch Dvoøák');
    await expect(select).toHaveValue('windows-1252');
    await expect(result.locator('#gedcom-stat-persons')).toHaveText('5');

    // Back to Central Europe and into a new tree: the stored names are right.
    await select.selectOption('windows-1250');
    await expect(row.locator('#gedcom-encoding-names')).toContainText('Řehoř Kučera');
    await result.locator('#gedcom-new-tree-btn').click();
    const confirm = page.locator('#import-tree-modal');
    await expect(confirm).toBeVisible();
    await confirm.locator('button.primary').first().click();
    await expect.poll(() => page.evaluate(async () => {
        const out: string[] = [];
        for (const t of window.Strom.TreeManager.getTrees()) {
            const data = await window.Strom.TreeManager.getTreeData(t.id);
            for (const p of Object.values(data?.persons ?? {}) as Array<{ firstName: string; lastName: string }>) {
                out.push(`${p.firstName} ${p.lastName}`);
            }
        }
        return out.sort();
    })).toEqual(['Ludmila Šťastná', 'Matěj Vlček', 'Seed Person', 'Vojtěch Dvořák', 'Zdeňka Pokorná', 'Řehoř Kučera'].sort());
});

test('a UTF-8 file has no encoding row', async ({ page }) => {
    await openApp(page);
    await page.locator('#gedcom-input').setInputFiles(fixture('ansi-utf8-czech.ged'));
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await expect(result.locator('#gedcom-stat-persons')).toHaveText('5');
    await expect(result.locator('#gedcom-encoding-row')).toBeHidden();
});

/** A large ANSI file (invented names, è = č in Windows-1250): `n` people in pairs, each pair a couple. */
function largeAnsiGed(n: number): Buffer {
    const out = ['0 HEAD', '1 CHAR ANSI', '1 GEDC', '2 VERS 5.5.1'];
    for (let i = 1; i <= n; i++) {
        out.push(`0 @I${i}@ INDI`, `1 NAME Kvido${i} /Ku\u00e8era${i % 97}/`, `1 SEX ${i % 2 ? 'M' : 'F'}`,
            '1 BIRT', `2 DATE ${1 + i % 28} JAN ${1700 + i % 300}`, `2 PLAC Hradec ${i % 40}`, `1 FAMS @F${Math.ceil(i / 2)}@`);
    }
    for (let f = 1; f <= n / 2; f++) out.push(`0 @F${f}@ FAM`, `1 HUSB @I${2 * f - 1}@`, `1 WIFE @I${2 * f}@`);
    out.push('0 TRLR', '');
    return Buffer.from(out.join('\r\n'), 'latin1');
}

test('another encoding of a large file is read again in parts: the choice locked, the people found under it (C53, §8)', async ({ page }) => {
    await openApp(page);
    await page.locator('#gedcom-input').setInputFiles({ name: 'pernikari.ged', mimeType: 'text/plain', buffer: largeAnsiGed(80000) });
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible({ timeout: 30_000 });
    const select = result.locator('#gedcom-encoding-select');
    await expect(select).toBeVisible();
    // What the row says while the file is read again, and whether the page took frames meanwhile.
    await page.evaluate(() => {
        const w = window as unknown as { __enc: { steps: string[]; busy: boolean; frames: number } };
        w.__enc = { steps: [], busy: false, frames: 0 };
        const sel = document.getElementById('gedcom-encoding-select')!;
        new MutationObserver(() => {
            if (sel.getAttribute('aria-busy') === 'true') w.__enc.busy = true;
            for (const el of document.querySelectorAll('#gedcom-result-modal .busy-step')) {
                const t = el.textContent ?? '';
                if (t && !w.__enc.steps.includes(t)) w.__enc.steps.push(t);
            }
        }).observe(document.getElementById('gedcom-result-modal')!, { subtree: true, childList: true, characterData: true, attributes: true });
        const tick = (): void => { w.__enc.frames++; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    });
    const framesBefore = await page.evaluate(() => (window as unknown as { __enc: { frames: number } }).__enc.frames);
    await select.selectOption('windows-1252');
    await expect(select).toHaveValue('windows-1252');
    await expect(select).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
    await expect(result.locator('#gedcom-stat-persons')).toHaveText('80000');
    const enc = await page.evaluate(() => (window as unknown as { __enc: { steps: string[]; busy: boolean; frames: number } }).__enc);
    expect(enc.busy).toBe(true);
    // The people found so far, more than once: the page was let go between the parts.
    const counts = enc.steps.map(t => /^Loading pernikari\.ged… ([\d,]+) people$/.exec(t)?.[1]).filter(Boolean)
        .map(c => Number(c!.replace(/,/g, '')));
    expect(counts.some(c => c > 0 && c < 80000), enc.steps.join(' | ')).toBe(true);
    expect(enc.frames - framesBefore).toBeGreaterThan(2);
    // The step is gone with the reading.
    await expect(result.locator('.busy-step')).toHaveCount(0);
});

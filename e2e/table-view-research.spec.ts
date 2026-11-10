import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, seedTree, card, type SeedPerson } from './helpers.js';

/**
 * The research in the Table view (spec 073 §16.1, §16.2, 16zg, 16zm): a
 * research tree offers the Research group, hidden by default (the table looks
 * as it does without research); "all" in the Columns panel shows its default
 * set and the view is changed; the cells and their sorting; the research ids
 * of unions and sources; a tree without research has no such group and an
 * archive has no waiting, tasks or agent; ≠ on the cells of a conflict's
 * fact and the legend's block Research (§16.3). Invented data
 * (e2e/fixtures/research-table.ged).
 */

const GED = readFileSync('e2e/fixtures/research-table.ged', 'utf8');
/** The same research as an archive (its file says so). */
const ARCHIVE_GED = GED.replace('1 _STROM_ASOF 2026-11-10\n', '1 _STROM_ASOF 2026-11-10\n1 _STROM_LINKS send open live app setup\n1 _STROM_MODE archive\n');

/**
 * Marks (§16.3, 16f, 16h): Vendelín has two dated marriages and two open
 * conflicts of his marriage, one fitting his marriage of 1845, one fitting
 * none (it stands on Partner); Marie's conflict of her birth stays.
 */
const MARKS_GED = (() => {
    const at = GED.indexOf('0 @I2@ INDI\n');
    const fams = GED.indexOf('1 FAMS @F0004@\n', at) + '1 FAMS @F0004@\n'.length;
    const vendelin = '1 FAMS @F0005@\n'
        + '1 _STROM_CONFLICT X0002\n2 TYPE MARR\n2 TITL Rok sňatku Vendelína\n2 STAT open\n2 VAL 1845\n2 VAL 1846\n3 SOUR @S0014@\n'
        + '1 _STROM_CONFLICT X0003\n2 TYPE MARR\n2 TITL Sňatek Vendelína v Rebarborově\n2 STAT open\n2 VAL 1850\n2 VAL 1851\n3 SOUR @S0014@\n';
    let ged = GED.slice(0, fams) + vendelin + GED.slice(fams);
    ged = ged.replace('0 @I10@ INDI\n', '0 @I10@ INDI\n1 FAMS @F0005@\n');
    ged = ged.replace('1 WIFE @I12@\n', '1 WIFE @I12@\n1 MARR\n2 DATE 1845\n2 PLAC Rebarborov\n');
    return ged.replace('0 TRLR', '0 @F0005@ FAM\n1 HUSB @I2@\n1 WIFE @I10@\n1 MARR\n2 DATE 1862\n1 REFN F0005\n0 TRLR');
})();

const OVERVIEW = ['name', 'bDate', 'bPlace', 'dDate', 'dAge', 'partner', 'wDate', 'wAge', 'nFind', 'comp'];
const RESEARCH_DEFAULT = ['rSum', 'rWait', 'rConf', 'rHyp', 'rAgent'];

const PLAIN: Record<string, SeedPerson> = {
    a: { firstName: 'Orvin', lastName: 'Kvelden', partners: ['b'] },
    b: { firstName: 'Tamsa', lastName: 'Morastin', gender: 'female', partners: ['a'] },
    c: { firstName: 'Belko', lastName: 'Kvelden', parents: ['a', 'b'] },
};

async function dropGed(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'tree-strom.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

/** The research tree open, then the table (on fixed time, after the fixture's date). */
async function openResearchTable(page: Page, ged = GED): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-11-10T12:00:00Z'));
    await openApp(page);
    await dropGed(page, ged);
    await expect(card(page, 'Karel')).toBeVisible();
    await openTable(page);
}

async function openTable(page: Page): Promise<void> {
    await page.locator('#view-mode-table').click();
    await expect(page.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
}

const head = (page: Page, col: string) => page.locator(`#table-container .tv-headrow [data-col="${col}"]`);
const changed = (page: Page) => page.locator('#table-container .tv-view-changed');

async function headOrder(page: Page): Promise<string[]> {
    return page.locator('#table-container .tv-headrow .tv-headcell').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? `band:${(el as HTMLElement).dataset.band}`));
}

/** A column's cell texts, top to bottom, of the rows of one kind (p: people, u: unions, s: sources). */
async function columnTexts(page: Page, col: string, prefix = 'p:'): Promise<string[]> {
    const index = await head(page, col).getAttribute('aria-colindex');
    expect(index).not.toBeNull();
    return page.locator('#table-container .tv-body .tv-row').evaluateAll((els, { index, prefix }) => els
        .filter(el => ((el as HTMLElement).dataset.key ?? '').startsWith(prefix) && !((el as HTMLElement).dataset.key ?? '').includes('#'))
        .map(el => (el.querySelector(`[aria-colindex="${index}"]`) as HTMLElement | null)?.innerText.trim() ?? ''), { index, prefix });
}

async function openPanel(page: Page) {
    await page.locator('#table-container .tv-cols-btn').click();
    const panel = page.getByRole('dialog', { name: 'Columns' });
    await expect(panel).toBeVisible();
    return panel;
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a research tree: the Research group hidden by default; "all" shows its default set, the view is changed; sorting', async ({ page }) => {
        await openResearchTable(page);
        expect(await page.evaluate(() => !!window.Strom.TreeManager.getActiveTreeMetadata()?.research)).toBe(true);
        // The default view as without research.
        expect(await headOrder(page)).toEqual(OVERVIEW);
        await expect(changed(page)).toBeHidden();
        await expect(page.locator('#table-container .tv-status-res')).toBeHidden();

        const panel = await openPanel(page);
        const group = panel.locator('.tv-cp-group[data-group="research"]');
        await expect(group).toHaveCount(1);
        // After Reliability and research, before Checks.
        const groups = await panel.locator('.tv-cp-group').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.group));
        expect(groups.indexOf('research')).toBe(groups.indexOf('rel') + 1);
        expect(groups.indexOf('checks')).toBe(groups.indexOf('research') + 1);
        await group.locator('.tv-cp-gtoggle').click();
        await expect(group.getByRole('checkbox', { name: 'Line', exact: true })).not.toBeChecked();
        await expect(group.locator('.tv-cp-gall')).toHaveAttribute('aria-pressed', 'false');
        await group.getByRole('button', { name: 'All columns: Research' }).click();
        await expect(group.locator('.tv-cp-gall')).toHaveAttribute('aria-pressed', 'true');
        // The default set only, after the relations, before the checks.
        expect(await headOrder(page)).toEqual([...OVERVIEW.slice(0, -2), ...RESEARCH_DEFAULT, ...OVERVIEW.slice(-2)]);
        await expect(group.getByRole('checkbox', { name: 'Line', exact: true })).not.toBeChecked();
        await expect(changed(page)).toHaveText('● changed');
        await page.keyboard.press('Escape');

        // Not followed: the agent column is live-only, its cells "–".
        await expect(head(page, 'rAgent').locator('.tv-live-tag')).toHaveText('live');
        await expect(head(page, 'rAgent')).toHaveAttribute('aria-label', 'Agent (Only while following the research)');
        expect(new Set(await columnTexts(page, 'rAgent'))).toEqual(new Set(['–']));
        await expect(head(page, 'rWait').locator('.tv-live-tag')).toHaveCount(0);
        // The coverage row says nothing about the research's signals.
        const covIndex = await head(page, 'rSum').getAttribute('aria-colindex');
        await expect(page.locator(`#table-container .tv-covrow [aria-colindex="${covIndex}"]`)).toHaveText('–');

        // Conflicts: Marie's open conflict of her birth.
        const conf = await columnTexts(page, 'rConf');
        expect(conf.filter(t => t !== '')).toHaveLength(1);
        expect(conf.find(t => t !== '')).toMatch(/^≠\s*1/);
        // Sorted by Conflicts, descending: the one with a conflict first.
        await head(page, 'rConf').click();
        await head(page, 'rConf').click();
        await expect(head(page, 'rConf')).toHaveAttribute('aria-sort', 'descending');
        expect((await columnTexts(page, 'rConf'))[0]).toMatch(/^≠\s*1/);
        expect((await columnTexts(page, 'name'))[0]).toContain('Marie');

        // Line on its own: G0001 for Karel.
        const again = await openPanel(page);
        await again.locator('.tv-cp-q').fill('Line');
        await again.getByRole('checkbox', { name: 'Line', exact: true }).check();
        await page.keyboard.press('Escape');
        await expect(head(page, 'rLine')).toHaveCount(1);
        const names = await columnTexts(page, 'name');
        const lines = await columnTexts(page, 'rLine');
        expect(lines[names.findIndex(n => n.includes('Karel'))]).toContain('G0001');
    });

    test('unions and sources: the research ids, the union\'s line, the source\'s image', async ({ page }) => {
        await openResearchTable(page);
        await page.locator('#table-container .tv-rowtype [data-rowtype="unions"]').click();
        await expect(page.locator('#table-container')).toHaveAttribute('data-rowtype', 'unions');
        // Hidden by default; offered in the panel.
        await expect(head(page, 'uResearchId')).toHaveCount(0);
        const panel = await openPanel(page);
        await panel.locator('.tv-cp-q').fill('Research ID');
        await panel.getByRole('checkbox', { name: 'Research ID', exact: true }).check();
        await panel.locator('.tv-cp-q').fill('');
        const group = panel.locator('.tv-cp-group[data-group="research"]');
        await group.locator('.tv-cp-gtoggle').click();
        await group.getByRole('button', { name: 'All columns: Research' }).click();
        await page.keyboard.press('Escape');
        expect((await headOrder(page)).slice(0, 3)).toEqual(['p1', 'p2', 'uResearchId']);
        for (const col of ['rLine', 'rAgent', 'rConf']) await expect(head(page, col)).toHaveCount(1);
        expect((await columnTexts(page, 'uResearchId', 'u:')).sort()).toEqual(['F0001', 'F0002', 'F0003', 'F0004']);

        // Sources: the research id after the title, the image in the Research group.
        await page.locator('#table-container .tv-rowtype [data-rowtype="sources"]').click();
        await expect(page.locator('#table-container')).toHaveAttribute('data-rowtype', 'sources');
        await expect(head(page, 'srcResearchId')).toHaveCount(0);
        const sp = await openPanel(page);
        await sp.locator('.tv-cp-q').fill('Research ID');
        await sp.getByRole('checkbox', { name: 'Research ID', exact: true }).check();
        await sp.locator('.tv-cp-q').fill('Image');
        await sp.getByRole('checkbox', { name: 'Image', exact: true }).check();
        await page.keyboard.press('Escape');
        expect((await headOrder(page)).slice(0, 2)).toEqual(['srcTitle', 'srcResearchId']);
        await expect(head(page, 'srcImage')).toHaveCount(1);
        expect(await columnTexts(page, 'srcResearchId', 's:')).toEqual(['S0014']);
    });
});

test.describe('marks and the legend (§16.3)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    /** A person's id by the research's id. */
    const idOf = (page: Page, refn: string) => page.evaluate(r => window.Strom.DataManager.getAllPersons().find(p => p.refn === r)!.id, refn);
    /** A line's cell of a column (the line's key: p:<id>, p:<id>#u1). */
    async function cellAt(page: Page, key: string, col: string) {
        const index = await head(page, col).getAttribute('aria-colindex');
        return page.locator(`#table-container .tv-body .tv-row[data-key="${key}"] [aria-colindex="${index}"]`);
    }

    test('≠ on the birth, on the marriage’s union and on Partner; before the value, no tint; a click opens the conflict', async ({ page }) => {
        await openResearchTable(page, MARKS_GED);
        // The default view, as without research, but for ≠.
        expect(await headOrder(page)).toEqual(OVERVIEW);
        await expect(changed(page)).toBeHidden();

        // Marie's birth: ≠ before the year, named for a screen reader, the cell without a tint.
        const marie = `p:${await idOf(page, 'P0006')}`;
        const birth = await cellAt(page, marie, 'bDate');
        const mark = birth.locator('.tv-conf');
        await expect(mark).toHaveText('≠');
        await expect(mark).toHaveAttribute('aria-label', '1853, sources disagree: birth');
        expect(await birth.evaluate(el => (el.firstElementChild as HTMLElement).classList.contains('tv-conf'))).toBe(true);
        await expect(birth).toHaveClass(/has-conf/);
        await expect(birth).not.toHaveClass(/tv-cell--(error|warning)/);
        expect(await birth.evaluate(el => getComputedStyle(el).backgroundColor))
            .toBe(await (await cellAt(page, marie, 'bPlace')).evaluate(el => getComputedStyle(el).backgroundColor));
        // The rim: the card's amber circle with a ring in the surface's colour.
        expect(await mark.evaluate(el => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 1\.5px.*0px 0px 0px 2\.5px/);
        // The other cells of Marie and the rows without a conflict carry none.
        await expect((await cellAt(page, marie, 'bPlace')).locator('.tv-conf')).toHaveCount(0);
        await expect((await cellAt(page, `p:${await idOf(page, 'P0001')}`, 'bDate')).locator('.tv-conf')).toHaveCount(0);

        // Vendelín (two unions, expanded): the conflict that fits 1845 on that sub-row's marriage date,
        // the one that fits no union on Partner of his row ("2 unions").
        const vendelin = `p:${await idOf(page, 'P0002')}`;
        await expect(page.locator(`#table-container .tv-row[data-key="${vendelin}#u2"]`)).toBeVisible();
        await expect((await cellAt(page, `${vendelin}#u1`, 'wDate')).locator('.tv-conf')).toHaveAttribute('aria-label', '1845, sources disagree: marriage');
        await expect((await cellAt(page, `${vendelin}#u2`, 'wDate')).locator('.tv-conf')).toHaveCount(0);
        await expect((await cellAt(page, `${vendelin}#u1`, 'partner')).locator('.tv-conf')).toHaveCount(0);
        const partner = await cellAt(page, vendelin, 'partner');
        await expect(partner).toContainText('2 unions');
        await expect(partner.locator('.tv-conf')).toHaveAttribute('aria-label', '2 unions, sources disagree: marriage');
        // Collapsed: the union's ≠ joins Partner's, which stays where it was.
        await page.locator(`#table-container .tv-row[data-key="${vendelin}"] .tv-toggle`).click();
        await expect(page.locator(`#table-container .tv-row[data-key="${vendelin}#u1"]`)).toHaveCount(0);
        await expect((await cellAt(page, vendelin, 'partner')).locator('.tv-conf')).toHaveCount(1);

        // The Unions table: the marriage's ≠ on that union's row.
        await page.locator('#table-container .tv-rowtype [data-rowtype="unions"]').click();
        await expect(page.locator('#table-container')).toHaveAttribute('data-rowtype', 'unions');
        const unionId = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().partnerships).find(u => u.researchId === 'F0004')!.id);
        await expect((await cellAt(page, `u:${unionId}`, 'wDate')).locator('.tv-conf')).toHaveCount(1);
        await page.locator('#table-container .tv-rowtype [data-rowtype="persons"]').click();

        // A click on ≠: the conflict opens (the person's research dialog until the table's own bubble).
        await (await cellAt(page, marie, 'bDate')).locator('.tv-conf').click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
    });

    test('the legend ends with the block Research in a research tree only', async ({ page }) => {
        await openResearchTable(page);
        await page.locator('#table-container .tv-legend-btn').click();
        const legend = page.locator('.tv-bubble--legend');
        await expect(legend).toBeVisible();
        // The rows as before, then the block: six research marks and the sentence under them.
        await expect(legend.locator('.tv-leg-row:not(.tv-leg-row--res)')).toHaveCount(9);
        await expect(legend.locator('.tv-leg-head')).toHaveText('Research');
        await expect(legend.locator('.tv-leg-row--res .tv-leg-name')).toHaveText(['waiting', 'waiting on others', 'conflict', 'question', 'agent', 'done']);
        await expect(legend.locator('.tv-leg-note')).toHaveText('A circle with a rim means research. The research’s ! and ? stand only in the Research columns; a fact’s cell carries only ≠.');
        const order = await legend.locator('.tv-leg-row, .tv-leg-head, .tv-leg-note').evaluateAll(els => els.map(el => el.className));
        expect(order.slice(0, 9).every(c => c === 'tv-leg-row')).toBe(true);
        expect(order[order.length - 1]).toBe('tv-leg-note');
        await page.keyboard.press('Escape');

        // A tree without research: the legend as before.
        await openApp(page);
        await seedTree(page, PLAIN, 'Kvelden', 'a');
        await openTable(page);
        await page.locator('#table-container .tv-legend-btn').click();
        await expect(legend).toBeVisible();
        await expect(legend.locator('.tv-leg-row')).toHaveCount(9);
        await expect(legend.locator('.tv-leg-head, .tv-leg-row--res, .tv-leg-note')).toHaveCount(0);
    });
});

test.describe('trees without the research (§16.1)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a tree without research: no Research group; the new person columns are offered, hidden', async ({ page }) => {
        await openApp(page);
        await seedTree(page, PLAIN, 'Kvelden', 'a');
        await openTable(page);
        expect(await headOrder(page)).toEqual(OVERVIEW);
        const panel = await openPanel(page);
        await expect(panel.locator('.tv-cp-group[data-group="research"]')).toHaveCount(0);
        await panel.locator('.tv-cp-q').fill('Agent');
        await expect(panel.locator('.tv-cp-item')).toHaveCount(0);
        for (const name of ['Open question', '⇄ In another tree', 'Person status']) {
            await panel.locator('.tv-cp-q').fill(name);
            await expect(panel.getByRole('checkbox', { name, exact: true })).not.toBeChecked();
        }
    });

    test('an archive: no waiting, tasks or agent', async ({ page }) => {
        await openResearchTable(page, ARCHIVE_GED);
        expect(await page.evaluate(() => window.Strom.UI.activeResearchArchive())).toBe(true);
        expect(await headOrder(page)).toEqual(OVERVIEW);
        const panel = await openPanel(page);
        const group = panel.locator('.tv-cp-group[data-group="research"]');
        await group.locator('.tv-cp-gtoggle').click();
        const cols = await group.locator('.tv-cp-item').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col));
        expect(cols).toContain('rSum');
        expect(cols).toContain('rLine');
        for (const id of ['rWait', 'rTasks', 'rAgent']) expect(cols).not.toContain(id);
        await group.getByRole('button', { name: 'All columns: Research' }).click();
        await page.keyboard.press('Escape');
        expect(await headOrder(page)).toEqual([...OVERVIEW.slice(0, -2), 'rSum', 'rConf', 'rHyp', ...OVERVIEW.slice(-2)]);
    });
});

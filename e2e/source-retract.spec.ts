import { test, expect, Page } from '@playwright/test';
import {
    BRIDGE, HEAD, MATERIAL_FEATURES, UUID, fakeBridge, fakeMaterial, fakeSourceRetract, materialFile, poll, FakeBridge, FakeMaterial, FakeSourceRetract,
} from './research-bridge.js';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';

/**
 * Deleting a source of a followed tree (spec 117 §1–§3): the Sources window
 * of a tree followed from its research only reads; a trash per row (a ⋯ with
 * its sheet on touch) opens "Delete source?", which asks the research first
 * what rests on the source (`POST /source/retract {dryRun}`) and deletes only
 * with the confirmation of that list. Once deleted the tree is loaded again
 * (the source gone) and a toast offers Undo (`POST /source/restore`). A list
 * changed meanwhile is shown again and asked again; the research's refusals
 * are said in the dialog. While the research does not run the trash is at
 * rest and says why; without the gate the window does not open for a
 * followed tree at all. Invented data only.
 */

const TITLE = 'Matrika narozených Chlumy 1860–1870';

const GED = (head = HEAD): string => [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 20 NOV 2026',
    `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Fíškovi',
    '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
    '1 BIRT', '2 DATE 1840', '2 SOUR @S0042@', '2 SOUR @S0001@',
    '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
    '1 BIRT', '2 DATE 3 FEB 1865', '2 PLAC Chlumy', '2 SOUR @S0042@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 @S0001@ SOUR', '1 TITL Oddací matrika Čapkov', '1 REFN S0001',
    '0 @S0042@ SOUR', `1 TITL ${TITLE}`, '1 REFN S0042',
    '0 TRLR',
].join('\n');

/** What deleting S0042 takes with it, as the research lists it. */
const IMPACT = {
    id: 'S0042', title: TITLE,
    counts: { names: 0, events: 2, families: 0, stories: 1 },
    cites: [
        { owner: 'P0001', fact: 'BIRT', others: 1, locator: 'fol. 12' },
        { owner: 'P0003', fact: 'BIRT', others: 0, locator: 'fol. 41', main: true },
    ],
    stories: [{ owner: 'P0003', inText: true }],
    bare: [{ owner: 'P0003', fact: 'BIRT' }],
    lowered: [{ owner: 'P0001', fact: 'BIRT', from: 'proven', to: 'probable' }],
    conflicts: [],
    tasks: [{ id: 'T0012', state: 'open', becomes: 'dropped' }, { id: 'T0013', state: 'doing', becomes: 'narrowed' }],
    files: ['I0007'], images: 2, more: {},
};
/** The list once the research changed meanwhile: a third citation. */
const IMPACT_CHANGED = {
    ...IMPACT, counts: { ...IMPACT.counts, events: 3 },
    cites: [...IMPACT.cites, { owner: 'P0002', fact: 'BIRT', others: 0, locator: 'fol. 13' }],
};

const FEATURES = ['source.retract'];

/** The research followed from its bridge (`?live=`), the tree locked meanwhile; the bridge's status asked once. */
async function follow(page: Page, opts: { features?: string[]; size?: { width: number; height: number }; impact?: Record<string, unknown>; material?: FakeMaterial } = {}): Promise<{ bridge: FakeBridge; sr: FakeSourceRetract }> {
    await page.setViewportSize(opts.size ?? { width: 1280, height: 900 });
    await page.addInitScript(() => {
        // The bridge's events: the hello is the status (the routed fetch); nothing else comes.
        class FakeEventSource {
            url: string;
            readyState = 1;
            onerror: ((e: Event) => void) | null = null;
            private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
            constructor(url: string) {
                this.url = url;
                void fetch(url.replace(/\/events(\?.*)?$/, '/status')).then(r => r.json()).then(st => this.emit('hello', st));
            }
            addEventListener(type: string, fn: (e: MessageEvent) => void): void { (this.listeners[type] ??= []).push(fn); }
            removeEventListener(): void { /* not needed */ }
            close(): void { this.readyState = 2; }
            emit(type: string, data: unknown): void {
                for (const fn of this.listeners[type] ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
            }
        }
        Object.defineProperty(window, 'EventSource', { value: FakeEventSource, configurable: true, writable: true });
    });
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await seedSetting(page, 'fileCopyReminders', false);
    await seedSetting(page, 'onThisDay', false);
    const sr = fakeSourceRetract({ impacts: { S0042: opts.impact ?? IMPACT } });
    const bridge = await fakeBridge(page, {
        features: opts.features ?? FEATURES,
        treeGed: GED(),
        sourceRetract: sr,
        ...(opts.material ? { material: opts.material } : {}),
        // The research's queue names one of the tasks; the other one only by its id.
        statusExtra: { queue: [{ id: 'T0012', text: 'Narození Jana 1865', state: 'next' }] },
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect.poll(() => page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources ?? {}).some(s => s.refn === 'S0042'))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.Strom.DataManager.isLiveFollowing() && window.Strom.DataManager.isTreeLocked())).toBe(true);
    await poll(page);
    return { bridge, sr };
}

const sourcesModal = (page: Page) => page.locator('#sources-modal');
const row = (page: Page, title: string) => page.locator('#sources-list .source-row').filter({ hasText: title });
const dialog = (page: Page) => page.locator('.mdlg--source');
const go = (page: Page) => dialog(page).locator('.mdlg-foot-acts .is-danger');
const toast = (page: Page) => page.locator('.toast[data-kind="source-retract"]');
const hasSource = (page: Page, refn: string) => page.evaluate(r => Object.values(window.Strom.DataManager.getData().sources ?? {}).some(s => s.refn === r), refn);

async function openSources(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    await expect(sourcesModal(page)).toHaveClass(/active/);
}

/** The dialog opened from the trash of the source's row, its list read. */
async function openDialog(page: Page): Promise<void> {
    await openSources(page);
    await row(page, TITLE).locator('.source-delete-btn').click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('[data-retract-sum]')).toBeVisible();
}

test.describe('deleting a source of a followed tree (spec 117 §1–§3)', () => {
    test('the Sources window only reads: no pencil, no Add; the trash opens the dialog with the research\'s counts', async ({ page }) => {
        const { sr } = await follow(page);
        await openSources(page);
        await expect(page.locator('#sources-list .source-edit-btn')).toHaveCount(0);
        await expect(page.locator('#sources-modal .sources-footer .primary')).toBeHidden();
        const trash = row(page, TITLE).locator('.source-delete-btn');
        await expect(trash).toHaveAttribute('aria-label', 'Delete source');
        await expect(trash).not.toHaveAttribute('aria-disabled', 'true');
        // Through the bridge: no mark.
        await expect(row(page, TITLE).locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        // Opening the window asks nothing.
        expect(sr.asks).toEqual([]);

        await trash.click();
        const d = dialog(page);
        await expect(d.locator('.mdlg-title')).toHaveText('Delete source?');
        await expect(d.locator('.mdlg-sub')).toContainText(TITLE);
        await expect(d.locator('.mdlg-sub-id')).toHaveText('· S0042');
        await expect(d.locator('.mdlg-src-sum-line')).toHaveText('It is cited 2 times on facts and in 1 story.');
        await expect(d.locator('.mdlg-src-sum-parts')).toHaveText('events 2 · stories 1');
        // The one warning: the facts left without a source.
        await expect(d.locator('.mdlg-warn')).toHaveCount(1);
        await expect(d.locator('.mdlg-warn')).toHaveText('1 fact is left without a source. The facts stay, only without a citation.');
        // The rows: the main citation first, its place faint; the one without another source said so.
        const cites = d.locator('[data-retract-row="cites"] .mv-use-item');
        await expect(cites).toHaveCount(2);
        await expect(cites.nth(0)).toContainText('Jan Fíšek');
        await expect(cites.nth(0).locator('.person-source-main')).toHaveAttribute('role', 'img');
        await expect(cites.nth(0).locator('.is-bare')).toHaveText('left without a source');
        await expect(cites.nth(1)).toContainText('has another source too');
        await expect(d.locator('[data-retract-row="lowered"] .mv-use-text')).toHaveText('1 fact becomes less certain');
        await expect(d.locator('[data-retract-row="stories"]')).toContainText('The source’s code in a story text stays');
        // Tasks: the name where the research's queue says it, else the id.
        const tasks = d.locator('[data-retract-row="tasks"] [data-task]');
        await expect(tasks).toHaveText(['Narození Jana 1865', 'T0013']);
        await expect(d.locator('[data-retract-row="tasks"]')).toContainText('an agent is working on it right now');
        await expect(d.locator('[data-retract-row="files"] .mv-use-files')).toHaveText('I0007');
        await expect(d.locator('.mdlg-src-list .mdlg-note').last()).toHaveText('Deleting can be undone right away with Undo, later restored in the research.');
        await expect(go(page)).toHaveText('Delete source');
        await expect(go(page)).toBeEnabled();
        await expect(go(page).locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        expect(sr.asks).toEqual([{ on: 'dry', body: { sources: ['S0042'], dryRun: true } }]);
    });

    test('deleting: busy while the research writes, the source gone from the tree, the toast\'s Undo puts it back', async ({ page }) => {
        const { bridge, sr } = await follow(page);
        await openDialog(page);
        let release!: () => void;
        sr.hold = new Promise<void>(res => { release = res; });
        await go(page).click();
        await expect(dialog(page)).toContainText('Deleting in the research…');
        release();
        sr.hold = null;
        await expect(dialog(page)).toHaveCount(0);
        expect(sr.asks.map(a => a.on)).toEqual(['dry', 'retract']);
        expect(sr.asks[1].body).toEqual({ sources: ['S0042'], confirm: 'c1-S0042' });
        // The research's new version loaded: the source and its citations gone, the window redrawn.
        await expect.poll(() => hasSource(page, 'S0042')).toBe(false);
        await expect(row(page, TITLE)).toHaveCount(0);
        await expect(row(page, 'Oddací matrika Čapkov')).toHaveCount(1);
        const head = bridge.head;
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(head);

        await expect(toast(page)).toContainText(`Source ${TITLE} deleted in the research.`);
        await toast(page).locator('.toast-action').click();
        await expect(toast(page)).toContainText(`Source ${TITLE} is back with its citations.`);
        expect(sr.asks.map(a => a.on)).toEqual(['dry', 'retract', 'restore']);
        expect(sr.asks[2].body).toEqual({ sources: ['S0042'] });
        await expect.poll(() => hasSource(page, 'S0042')).toBe(true);
        await expect(row(page, TITLE)).toHaveCount(1);
    });

    test('Undo: back without a citation whose fact is gone; the research not answering', async ({ page }) => {
        const { bridge, sr } = await follow(page);
        await openDialog(page);
        await go(page).click();
        await expect(toast(page)).toContainText('deleted in the research');
        sr.skipped = [{ source: 'S0042', owner: 'P0003', fact: 'BIRT', why: 'gone' }, { source: 'S0042', owner: 'P0001', fact: 'BIRT', why: 'already' }];
        await toast(page).locator('.toast-action').click();
        await expect(toast(page)).toContainText('The source is back; 1 citation could not be returned (the fact changed meanwhile).');

        // Once more, the research gone meanwhile: said, no Try again.
        await expect.poll(() => hasSource(page, 'S0042')).toBe(true);
        await page.evaluate(() => {
            document.querySelectorAll('.toast').forEach(t => t.remove());
            document.querySelectorAll('.mdlg-overlay').forEach(o => o.remove());
        });
        await row(page, TITLE).locator('.source-delete-btn').click();
        await expect(go(page)).toBeEnabled();
        await go(page).click();
        await expect(toast(page)).toContainText('deleted in the research');
        sr.replies.push({ on: 'restore', status: 0, abort: true });
        await toast(page).locator('.toast-action').click();
        await expect(toast(page)).toContainText('Undo is not possible now, the research does not answer.', { timeout: 15_000 });
        await expect(toast(page).locator('.toast-action')).toHaveCount(0);
        void bridge;
    });

    test('changed meanwhile (409): the new list said above, asked again with a new confirmation', async ({ page }) => {
        const { sr } = await follow(page);
        await openDialog(page);
        sr.replies.push({ on: 'retract', status: 409, body: { error: 'Changed.', code: 'source.retract-changed', impacts: [IMPACT_CHANGED] } });
        sr.impacts.S0042 = IMPACT_CHANGED;
        await go(page).click();
        await expect(dialog(page).locator('.mdlg-changed')).toHaveText('What refers to the source has changed meanwhile. The list below is new; the deletion needs to be confirmed again.');
        await expect(dialog(page).locator('.mdlg-src-sum-line')).toHaveText('It is cited 3 times on facts and in 1 story.');
        await expect(go(page)).toBeEnabled();
        expect(sr.asks.map(a => a.on)).toEqual(['dry', 'retract', 'dry']);
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        expect(sr.asks[3]).toEqual({ on: 'retract', body: { sources: ['S0042'], confirm: 'c2-S0042' } });
        await expect.poll(() => hasSource(page, 'S0042')).toBe(false);
    });

    test('a failed write (500): said, Try again sends the same confirmation', async ({ page }) => {
        const { sr } = await follow(page);
        await openDialog(page);
        const err = dialog(page).locator('.mdlg > .mdlg-error, .mdlg-error').first();

        // 500: said, sent again with the same confirmation.
        sr.replies.push({ on: 'retract', status: 500, body: { error: 'Failed.', code: 'source.failed' } });
        await go(page).click();
        await expect(err).toContainText('Writing to the research failed.');
        await expect(go(page)).toBeVisible();
        await err.locator('button').click();
        await expect(dialog(page)).toHaveCount(0);
        expect(sr.asks.filter(a => a.on === 'retract').map(a => a.body.confirm)).toEqual(['c1-S0042', 'c1-S0042']);
        await expect.poll(() => hasSource(page, 'S0042')).toBe(false);
    });

    test('refusals: 404 source.unknown and 403 source.readonly take the danger button away', async ({ page }) => {
        const { sr } = await follow(page);
        await openDialog(page);
        const err = dialog(page).locator('.mdlg-error');
        sr.replies.push({ on: 'retract', status: 404, body: { error: 'No such source.', code: 'source.unknown', params: { id: 'S0042' } } });
        await go(page).click();
        await expect(err).toContainText('The source is no longer in the research. The tree is loaded again.');
        await expect(err.locator('button')).toHaveText('Reload');
        await expect(go(page)).toBeHidden();
        await expect(dialog(page).locator('.mdlg-foot-acts button').first()).toHaveText('Close');
        await err.locator('button').click();
        await expect(dialog(page)).toHaveCount(0);

        await row(page, TITLE).locator('.source-delete-btn').click();
        await expect(go(page)).toBeEnabled();
        sr.replies.push({ on: 'retract', status: 403, body: { error: 'Read-only.', code: 'source.readonly' } });
        await go(page).click();
        await expect(dialog(page).locator('.mdlg-error')).toHaveText('The research is read-only; the source cannot be deleted here.');
        await expect(go(page)).toBeHidden();
        expect(await hasSource(page, 'S0042')).toBe(true);
    });

    test('the preview failing: nothing can be deleted, Try again asks it again', async ({ page }) => {
        const { sr } = await follow(page);
        sr.replies.push({ on: 'dry', status: 500, body: { error: 'Failed.', code: 'source.failed' } });
        await openSources(page);
        await row(page, TITLE).locator('.source-delete-btn').click();
        await expect(dialog(page)).toContainText('What refers to the source could not be checked in the research, so nothing can be deleted now.');
        await expect(go(page)).toBeDisabled();
        await dialog(page).locator('.mdlg-error button').click();
        await expect(dialog(page).locator('[data-retract-sum]')).toBeVisible();
        await expect(go(page)).toBeEnabled();
    });

    test('made of a family tree file: its files row says so, as the research\'s list of Materials with them says it (R.fileTree)', async ({ page }) => {
        const material = fakeMaterial({
            files: [materialFile(7, { name: 'chlumy-1990.ged', mime: 'text/plain', bytes: 40_000, kind: 'tree', state: 'processed' })],
            batches: [], people: {},
        });
        await follow(page, {
            features: [...FEATURES, ...MATERIAL_FEATURES, 'material.delete', 'material.trees'],
            impact: { ...IMPACT, input: 'I0007' },
            material,
        });
        // The list of Materials read once (with the family tree files), then the dialog.
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await expect(page.locator('#materials-modal .mw-canvas .mw-tile')).toHaveCount(1);
        expect(material.asks.some(q => q.split('&').includes('trees=1'))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.locator('#materials-modal.active')).toHaveCount(0);
        await openDialog(page);
        const files = dialog(page).locator('[data-retract-row="files"]');
        await expect(files).toContainText('I0007');
        await expect(files).toContainText('The family tree file the source was made from. The file itself can be deleted in Materials.');
    });

    test('made of a file that is no family tree file: no such sentence', async ({ page }) => {
        await follow(page, { impact: { ...IMPACT, input: 'I0007' } });
        await openDialog(page);
        await expect(dialog(page).locator('[data-retract-row="files"]')).toContainText('I0007');
        await expect(dialog(page).locator('[data-retract-row="files"]')).not.toContainText('The family tree file the source was made from.');
    });

    test('the research not running: the trash at rest says why and does nothing', async ({ page }) => {
        const { bridge, sr } = await follow(page);
        bridge.down = true;
        await poll(page);
        await openSources(page);
        const trash = row(page, TITLE).locator('.source-delete-btn');
        await expect(trash).toHaveAttribute('aria-disabled', 'true');
        await expect(trash).toHaveAttribute('title', 'Deleting a source works while the research runs.');
        // Never `disabled`: it can be focused and read; a click does nothing.
        await expect(trash).not.toHaveAttribute('disabled', /.*/);
        await trash.click({ force: true });
        await expect(dialog(page)).toHaveCount(0);
        expect(sr.asks).toEqual([]);
    });

    test('without the gate: the Sources window of a followed tree does not open', async ({ page }) => {
        await follow(page, { features: [] });
        expect(await page.evaluate(() => window.Strom.UI.isSourcesMenuOffered())).toBe(false);
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        await expect(sourcesModal(page)).not.toHaveClass(/active/);
    });

    test('phone width (390 × 844): ⋯ per row opens its sheet; the dialog comes up from the bottom', async ({ page }) => {
        // Opened wide (a phone has no bridge), then narrowed, as on the research's computer.
        const { sr } = await follow(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await openSources(page);
        const more = row(page, TITLE).locator('.source-more-btn');
        await expect(more).toBeVisible();
        await expect(row(page, TITLE).locator('.source-delete-btn')).toHaveCount(0);
        const box = (await more.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        await more.click();
        await expect(page.locator('#source-sheet-open')).toHaveText('Open source');
        await expect(page.locator('#source-sheet-delete')).toContainText('Delete source…');
        await page.locator('#source-sheet-delete').click();
        await expect(dialog(page).locator('[data-retract-sum]')).toBeVisible();
        const d = (await dialog(page).boundingBox())!;
        expect(Math.round(d.width)).toBe(390);
        expect(Math.abs(d.y + d.height - 844)).toBeLessThanOrEqual(1);
        const wide = await dialog(page).evaluate(el => [...el.querySelectorAll<HTMLElement>('*')]
            .filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5).map(e => e.className));
        expect(wide).toEqual([]);
        expect(sr.asks.map(a => a.on)).toEqual(['dry']);
    });

    test('phone width, the research not running: the sheet\'s Delete at rest with why', async ({ page }) => {
        const { bridge, sr } = await follow(page);
        await page.setViewportSize({ width: 390, height: 844 });
        bridge.down = true;
        await poll(page);
        await openSources(page);
        await row(page, TITLE).locator('.source-more-btn').click();
        const del = page.locator('#source-sheet-delete');
        await expect(del).toHaveAttribute('aria-disabled', 'true');
        await expect(del.locator('.bottom-sheet-why')).toHaveText('Deleting a source works while the research runs.');
        await del.dispatchEvent('click');
        await expect(dialog(page)).toHaveCount(0);
        expect(sr.asks).toEqual([]);
    });
});

test.describe('touch at tablet width (spec 117 §10)', () => {
    test.use({ hasTouch: true, isMobile: false });

    test('a coarse pointer at 820 px: ⋯ per row (44 px), its sheet deletes; the dialog 560 px wide', async ({ page }) => {
        await follow(page, { size: { width: 820, height: 1180 } });
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
        await openSources(page);
        const more = row(page, TITLE).locator('.source-more-btn');
        await expect(more).toBeVisible();
        expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await more.click();
        await page.locator('#source-sheet-delete').click();
        await expect(dialog(page).locator('[data-retract-sum]')).toBeVisible();
        expect(Math.round((await dialog(page).boundingBox())!.width)).toBe(560);
    });
});

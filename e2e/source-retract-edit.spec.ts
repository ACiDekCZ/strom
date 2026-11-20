import { test, expect, Page } from '@playwright/test';
import { HEAD, UUID, fakeBridge, fakeSourceRetract, openResearch, poll, FakeBridge, FakeSourceRetract } from './research-bridge.js';

/**
 * Deleting a source in edit mode (spec 117 §4): a tree tied to its research
 * but not followed deletes the source here (Undo works) and says so to the
 * research with the next write (`1 _STROM_SOURCE_DELETED S…` after
 * `_STROM_HEAD`); the research retracts it then (`retracted` of its answer)
 * or says why not. With the gate and its bridge the dialog shows the
 * research's list; without the bridge, today's confirmation says what comes;
 * an older research keeps the source. "What will be sent" and "What was
 * written" name the deleted source, and a source retracted there can be
 * restored from the app. Invented data only.
 */

const TITLE = 'Matrika narozených Chlumy 1860–1870';
const OTHER = 'Oddací matrika Čapkov';

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 20 NOV 2026',
    `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Fíškovi',
    '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
    '1 BIRT', '2 DATE 1840', '2 SOUR @S0042@', '2 SOUR @S0001@',
    '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
    '1 BIRT', '2 DATE 3 FEB 1865', '2 PLAC Chlumy', '2 SOUR @S0042@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 @S0001@ SOUR', `1 TITL ${OTHER}`, '1 REFN S0001',
    '0 @S0042@ SOUR', `1 TITL ${TITLE}`, '1 REFN S0042',
    '0 TRLR',
].join('\n');

const IMPACT = {
    id: 'S0042', title: TITLE,
    counts: { names: 0, events: 2, families: 0, stories: 0 },
    cites: [{ owner: 'P0001', fact: 'BIRT', others: 1 }, { owner: 'P0003', fact: 'BIRT', others: 0 }],
    stories: [], bare: [{ owner: 'P0003', fact: 'BIRT' }], lowered: [], conflicts: [], tasks: [], files: [], images: 0, more: {},
};

const GATE = ['source.retract', 'sync.notWritten.codes'];

/** The research's tree opened for editing (not followed), its bridge answering with `features`. */
async function researchTree(page: Page, features: string[], reply: Record<string, unknown> = {}): Promise<{ bridge: FakeBridge; sr: FakeSourceRetract }> {
    await page.clock.install({ time: new Date('2026-11-20T10:30:00Z') });
    await openResearch(page, { ged: GED });
    const sr = fakeSourceRetract({ impacts: { S0042: IMPACT } });
    const bridge = await fakeBridge(page, { features, sourceRetract: sr, treeGed: GED,
        accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null },
        syncReply: { status: 200, body: { ok: true, inbox: false, changes: 2, applied: 2, input: 'I0042', ...reply } } });
    await poll(page);
    return { bridge, sr };
}

const sourcesModal = (page: Page) => page.locator('#sources-modal');
const row = (page: Page, title: string) => page.locator('#sources-list .source-row').filter({ hasText: title });
const dialog = (page: Page) => page.locator('.mdlg--source');
const go = (page: Page) => dialog(page).locator('.mdlg-foot-acts .is-danger');
const confirmModal = (page: Page) => page.locator('#confirmation-modal');
const panel = (page: Page) => page.locator('#research-changes-panel');
const hasSource = (page: Page, refn: string) => page.evaluate(r => Object.values(window.Strom.DataManager.getData().sources ?? {}).some(s => s.refn === r), refn);
const deleted = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.deletedSources ?? null);

async function trash(page: Page, title = TITLE): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    await expect(sourcesModal(page)).toHaveClass(/active/);
    await row(page, title).locator('.source-delete-btn').click();
}

async function closeSources(page: Page): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(sourcesModal(page)).not.toHaveClass(/active/);
}

async function send(page: Page, bridge: FakeBridge, n: number): Promise<string> {
    await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
    await expect.poll(() => bridge.posts.length).toBe(n);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).toBe('written');
    return bridge.posts[n - 1];
}

test.describe('deleting a source in edit mode (spec 117 §4)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the gate and its bridge: the research\'s list, deleted here without the bridge, Undo; a source back is never said deleted', async ({ page }) => {
        const { bridge, sr } = await researchTree(page, GATE);
        await trash(page);
        const d = dialog(page);
        await expect(d).toBeVisible();
        await expect(d.locator('.mdlg-title')).toHaveText('Delete source?');
        await expect(d.locator('[data-retract-sum]')).toBeVisible();
        await expect(d.locator('.mdlg-src-sum-line')).toHaveText('It is cited 2 times on facts and in 0 stories.');
        await expect(d.locator('.mdlg-src-list .mdlg-note').last())
            .toHaveText('The research retracts the source with the next write of changes. The Undo button brings it back.');
        await expect(go(page)).toBeEnabled();
        await expect(go(page).locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        await go(page).click();
        await expect(d).toHaveCount(0);
        // Deleted here: the research was only asked for its list.
        expect(sr.asks.map(a => a.on)).toEqual(['dry']);
        await expect.poll(() => hasSource(page, 'S0042')).toBe(false);
        await expect(row(page, TITLE)).toHaveCount(0);
        expect(await deleted(page)).toEqual(['S0042']);

        // Undo: the source back; the send does not say it deleted, and forgets it.
        await page.evaluate(() => window.Strom.DataManager.undo());
        await expect.poll(() => hasSource(page, 'S0042')).toBe(true);
        await closeSources(page);
        await page.evaluate(() => window.Strom.DataManager.updatePerson(
            Object.values(window.Strom.DataManager.getData().persons).find(p => p.firstName === 'Jan')!.id, { birthPlace: 'Praha' }));
        const body = await send(page, bridge, 1);
        expect(body).not.toContain('_STROM_SOURCE_DELETED');
        expect(await deleted(page)).toBeNull();
    });

    test('the next write says it deleted (after _STROM_HEAD); "What will be sent" and "What was written" name the deleted source', async ({ page }) => {
        const { bridge } = await researchTree(page, GATE, { retracted: ['S0042'] });
        await trash(page);
        await expect(dialog(page).locator('[data-retract-sum]')).toBeVisible();
        await go(page).click();
        await expect.poll(() => hasSource(page, 'S0042')).toBe(false);
        await closeSources(page);

        await page.evaluate(() => window.Strom.UI.showResearchChanges('send'));
        const willSend = panel(page).locator('[data-kind="source"][data-retract="S0042"]');
        await expect(willSend.locator('.research-changes-type')).toHaveText('Deleted source');
        await expect(willSend.locator('.research-changes-name.is-deleted')).toHaveText(TITLE);
        await expect(willSend.locator('.research-changes-kinds')).toHaveCount(0);
        await page.keyboard.press('Escape');

        const body = await send(page, bridge, 1);
        const lines = body.split(/\r?\n/);
        expect(lines[lines.indexOf(`1 _STROM_HEAD ${HEAD}`) + 1]).toBe('1 _STROM_SOURCE_DELETED S0042');
        expect(lines.filter(l => l.includes('_STROM_SOURCE_DELETED'))).toHaveLength(1);
        // Retracted by the write: no longer remembered.
        await expect.poll(() => deleted(page)).toBeNull();

        await page.evaluate(() => window.Strom.UI.showResearchChanges('written'));
        const written = panel(page).locator('[data-kind="source"]').filter({ hasText: TITLE });
        await expect(written.locator('.research-changes-icon.is-check')).toHaveCount(1);
        await expect(written.locator('.research-changes-type')).toHaveText('Deleted source');
        await expect(written.locator('.research-changes-name.is-deleted')).toHaveText(TITLE);
        await expect(written.locator('.research-changes-kinds')).toHaveText('source retracted in the research');
    });

    test('the gate without its bridge: today\'s confirmation says the research retracts it with the next write; remembered', async ({ page }) => {
        const { bridge, sr } = await researchTree(page, GATE);
        bridge.down = true;
        await poll(page);
        await trash(page);
        const m = confirmModal(page);
        await expect(m).toBeVisible();
        await expect(m.locator('#confirm-message')).toHaveText(
            'It is cited in 2 places; those citations are removed too. The research retracts the source with the next write of changes. The Undo button brings it back.');
        await m.locator('#confirm-ok-btn').click();
        await expect.poll(() => hasSource(page, 'S0042')).toBe(false);
        expect(await deleted(page)).toEqual(['S0042']);
        expect(sr.asks).toEqual([]);
    });

    test('an older research without the gate: the sentence says it keeps the source; nothing said to it', async ({ page }) => {
        const { bridge } = await researchTree(page, ['sync.notWritten.codes']);
        await trash(page);
        const m = confirmModal(page);
        await expect(m.locator('#confirm-message')).toHaveText(
            'It is cited in 2 places; those citations are removed too. The research keeps the source; it comes back with the next load. The Undo button brings it back.');
        await m.locator('#confirm-ok-btn').click();
        await expect.poll(() => hasSource(page, 'S0042')).toBe(false);
        expect(await deleted(page)).toBeNull();
        await closeSources(page);
        const body = await send(page, bridge, 1);
        expect(body).not.toContain('_STROM_SOURCE_DELETED');
    });

    test('not retracted and retracted there: their reasons; Restore through the bridge, without it said after the reason', async ({ page }) => {
        const { bridge, sr } = await researchTree(page, GATE, {
            changes: 3, applied: 1,
            notWritten: [
                { kind: 'source.retract', source: 'S0042', why: 'report', code: 'source.retract-skipped', params: { source: 'S0042', why: 'stillCited' } },
                { kind: 'source.new', source: 'S0001', why: 'report', code: 'source.retracted', params: { source: 'S0001' } },
            ],
        });
        await trash(page);
        await expect(dialog(page).locator('[data-retract-sum]')).toBeVisible();
        await go(page).click();
        await expect.poll(() => hasSource(page, 'S0042')).toBe(false);
        await closeSources(page);
        await send(page, bridge, 1);
        // Not retracted: still said deleted with the next write.
        expect(await deleted(page)).toEqual(['S0042']);

        await page.evaluate(() => window.Strom.UI.showResearchChanges('written'));
        const skipped = panel(page).locator('.is-not-written[data-code="source.retract-skipped"]');
        await expect(skipped.locator('.research-changes-type')).toHaveText('source');
        await expect(skipped.locator('.research-changes-name.is-deleted')).toHaveText(TITLE);
        await expect(skipped.locator('.research-changes-why')).toHaveText('source not retracted: it is still cited in the tree');
        await expect(skipped.locator('[data-restore-source]')).toHaveCount(0);
        // Not also listed as written.
        await expect(panel(page).locator('.research-changes-row:not(.is-not-written)').filter({ hasText: TITLE })).toHaveCount(0);

        const retracted = panel(page).locator('.is-not-written[data-code="source.retracted"]');
        await expect(retracted.locator('.research-changes-name')).toHaveText(OTHER);
        await expect(retracted.locator('.research-changes-why')).toHaveText('the source is retracted in the research; a citation of it is not written');
        const restore = retracted.locator('button.link-button[data-restore-source="S0001"]');
        await expect(restore).toHaveText('Restore the source in the research');
        // Through the bridge: no mark.
        await expect(retracted.locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        sr.replies.push({ on: 'restore', status: 200, body: { restored: ['S0001'], citations: 1, skipped: [], head: 'abcdef1234567', parent: HEAD } });
        await restore.click();
        await expect(page.locator('.toast').filter({ hasText: `Source ${OTHER} is back with its citations.` })).toBeVisible();
        await expect(restore).toHaveCount(0);
        expect(sr.asks.filter(a => a.on === 'restore').map(a => a.body)).toEqual([{ sources: ['S0001'] }]);

        // The bridge not running: said after the reason, no action.
        await page.keyboard.press('Escape');
        bridge.down = true;
        await poll(page);
        await page.evaluate(() => window.Strom.UI.showResearchChanges('written'));
        await expect(retracted.locator('.research-changes-why'))
            .toHaveText('the source is retracted in the research; a citation of it is not written · the source can be restored in the research');
        await expect(retracted.locator('[data-restore-source]')).toHaveCount(0);
    });
});

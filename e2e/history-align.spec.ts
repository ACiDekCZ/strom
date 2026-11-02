import { test, expect, Page, Locator } from '@playwright/test';
import {
    fakeBridge, fakeHistoryR1, fakeAlign, historyGed, openResearch, poll, links,
    HISTORY_R1_FEATURES, FAKE_KINDS, UUID, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * Aligning found history with the kinds searched (spec 035 §1, §3, §4, §5):
 * the preview dialog (#history-align-modal) from Settings, from the sentence
 * of a kind switched off and from the manager; its blocks (hidden, shown
 * again, to be searched, being searched, shared catalogues), nothing to align,
 * the terminal's variant, Align with its toast and Undo, a busy research, a
 * preview changed meanwhile; the manager's "What the research searches" box,
 * the "searching kinds" lines and the Hidden tab's group of events hidden by
 * aligning with Show again; the states without the features. Invented data
 * (fakeHistoryR1): economy and disaster are not searched for this tree.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment', 'history-kinds', 'history-align'];
const ALIGN_FEATURES = [...HISTORY_R1_FEATURES, 'experiments.split', 'experiments.pace', 'history.kinds', 'history.align'];
const SEARCHED = FAKE_KINDS.filter(k => k !== 'economy' && k !== 'disaster');
/** An earlier alignment that hid the war of 1866 (war is searched again: shown again). */
const EARLIER = '20261101100000-00000a';

async function setup(page: Page, opts: {
    history?: Partial<FakeHistory>; features?: string[]; kinds?: string[]; width?: number; height?: number; earlier?: boolean;
} = {}): Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 800 });
    const history = fakeHistoryR1({
        split: { regions: true, places: true },
        pace: 'sometimes',
        kinds: { kinds: opts.kinds ?? [...SEARCHED], own: true, def: [...FAKE_KINDS] },
        align: fakeAlign(),
        ...opts.history,
    });
    if (opts.earlier !== false) {
        history.payload.hidden.push({ event: 'E1', tree: true, by: 'align', align: EARLIER, at: '2026-11-01T10:00:00Z' });
    }
    const ged = historyGed();
    const bridge = await fakeBridge(page, { features: opts.features ?? ALIGN_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await page.evaluate(() => { try { sessionStorage.removeItem('strom.historyKindsOpen'); } catch { /* none */ } });
    await poll(page);
    return { bridge, history };
}

const dialog = (page: Page) => page.locator('#history-align-modal');
const block = (page: Page, cls: string) => dialog(page).locator(`.hal-block.${cls}`);
const go = (page: Page) => dialog(page).locator('[data-hal="go"]');
const toast = (page: Page, text: string | RegExp) => page.locator('.toast', { hasText: text });
const manager = (page: Page) => page.locator('#history-modal');

async function openAlign(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openHistoryAlign());
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('.hal-loading')).toHaveCount(0);
}

/** Settings with the kinds of history open (the alignment's link is inside). */
async function openSettingsKinds(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('#history-kinds .history-kinds-toggle').click();
    await expect(page.locator('#history-kinds-search')).toBeVisible();
}

async function openManager(page: Page, opts: { tab?: string } = {}): Promise<void> {
    await page.evaluate((o) => (window.Strom.UI as unknown as { openHistoryManage(o: object): void }).openHistoryManage(o), opts);
    await expect(manager(page)).toBeVisible();
    await expect(page.locator('#history-manage-state .hm-state-text')).not.toHaveText('Loading history…');
}

/** A preview of every block: hidden, shown again, five to be searched, a session at work, shared catalogues. */
function fullPreview(plan = '0123456789abcdef'): Record<string, unknown> {
    return {
        kinds: SEARCHED, plan,
        hide: { general: { n: 3, kinds: { economy: 2, disaster: 1 } }, local: { n: 1, kinds: { disaster: 1 } } },
        show: { n: 1, kinds: { war: 1 } },
        backfill: [
            { region: 'cz-capkov', label: 'Čapkovsko', kinds: ['law'], years: ['1850–1900'] },
            { place: 'L0001', label: 'Čapkov', kinds: ['law', 'census'] },
            { place: 'L0003', label: 'Kutná Hora', kinds: ['law'] },
            { place: 'L0002', label: 'Brno', kinds: ['law'] },
            { place: 'L0004', label: 'Opava', kinds: ['law'] },
        ],
        sessions: 4, pace: 'sometimes',
        busy: [{ id: 'cz-moravia', label: 'Moravia' }],
        shared: { n: 2, kinds: { economy: 2 } },
    };
}

/** Only searching to add: the terminal's variant (6c). */
function fillPreview(): Record<string, unknown> {
    return {
        kinds: FAKE_KINDS, plan: 'fedcba9876543210',
        hide: { general: { n: 0, kinds: {} }, local: { n: 0, kinds: {} } },
        show: { n: 0, kinds: {} },
        backfill: [{ region: 'cz-capkov', label: 'Čapkovsko', kinds: ['economy', 'disaster'] }],
        sessions: 1, pace: 'sometimes', busy: [], shared: { n: 0, kinds: {} },
    };
}

/** The kinds of a block's chips, in order. */
const kindsOf = (l: Locator) => l.locator('.hal-chip').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.kind));

/** No horizontal overflow in an element (its content fits its width). */
const fits = (l: Locator) => l.evaluate(el => el.scrollWidth <= el.clientWidth + 1);

test.describe('Kinds of history: aligning', () => {
    test('from Settings: hidden and shown again, the origins, the dialog rules; Close and Escape', async ({ page }) => {
        await setup(page);
        await openSettingsKinds(page);
        const link = page.locator('#history-align-link');
        await expect(link).toBeVisible();
        await link.click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('#hal-title')).toHaveText('Align history with the settings');
        // Hidden in this tree: E2 economy (regional history) and E4 disaster (local).
        const hide = block(page, 'is-hide');
        await expect(hide.locator('.hal-head')).toContainText('Hidden in this tree');
        await expect(hide.locator('.hal-total')).toHaveText('2');
        await expect(hide.locator('.hal-origin.is-region .hal-origin-n')).toHaveText('1');
        await expect(hide.locator('.hal-origin.is-local .hal-origin-n')).toHaveText('1');
        await expect(hide.locator('.hal-chip')).toHaveCount(2);
        expect(await kindsOf(hide)).toEqual(['economy', 'disaster']);
        await expect(hide.locator('.hal-note')).toContainText('Nothing is deleted.');
        // Shown again: the war hidden by an earlier alignment.
        await expect(block(page, 'is-show').locator('.hal-total')).toHaveText('1');
        await expect(block(page, 'is-show').locator('.hal-chip[data-kind="war"]')).toBeVisible();
        await expect(block(page, 'is-fill')).toHaveCount(0);
        // The rules of a dialog: info kind, Close right before the single primary, the focus on Close.
        await expect(dialog(page).locator('.modal')).toHaveAttribute('data-dialog-kind', 'info');
        const buttons = dialog(page).locator('.hal-foot .buttons > button');
        await expect(buttons).toHaveCount(2);
        await expect(buttons.nth(0)).toHaveAttribute('data-dismiss', '');
        await expect(buttons.nth(1)).toHaveClass(/primary/);
        await expect(buttons.nth(1)).toHaveText('Align');
        await expect(dialog(page).locator('.primary')).toHaveCount(1);
        await buttons.nth(0).click();
        await expect(dialog(page)).toHaveCount(0);
        // The badge of Settings comes from the same preview.
        await expect(page.locator('#history-align-link .history-align-badge')).toHaveText('2 to hide');
        await link.click();
        await expect(dialog(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('#settings-modal')).toBeVisible();
    });

    test('from the sentence of a kind switched off, with the kind in the preview', async ({ page }) => {
        const { history } = await setup(page, { kinds: [...FAKE_KINDS], earlier: false });
        await openSettingsKinds(page);
        await page.locator('[data-search-kind="economy"]').click();
        await page.locator('#confirm-ok-btn').click();
        await expect.poll(() => history.kindsWrites?.length ?? 0).toBe(1);
        const off = page.locator('.history-kinds-off [data-hk-action="align"]');
        await expect(off).toBeVisible();
        await off.click();
        await expect(dialog(page)).toBeVisible();
        await expect.poll(() => kindsOf(block(page, 'is-hide'))).toEqual(['economy']);
        await expect(block(page, 'is-show')).toHaveCount(0);
    });

    test('every block: to be searched (more/less), being searched, shared catalogues and their link', async ({ page }) => {
        const { history } = await setup(page);
        history.align!.previewReply = { status: 200, body: fullPreview() };
        await openAlign(page);
        await expect(block(page, 'is-hide').locator('.hal-total')).toHaveText('4');
        const fill = block(page, 'is-fill');
        await expect(fill.locator('.hal-head')).toContainText('To be searched');
        await expect(fill.locator('.hal-total')).toHaveText('1 region · 4 places');
        await expect(fill.locator('.hal-fill-row .hal-fill-label')).toHaveText(['Čapkovsko', 'Čapkov', 'Kutná Hora']);
        await expect(fill.locator('.hal-fill-row').first().locator('.hal-fill-years')).toHaveText('1850–1900');
        await expect(fill.locator('.hal-fill-row').nth(1).locator('.hal-fill-kind')).toHaveCount(2);
        const more = fill.locator('[data-hal="more"]');
        await expect(more).toHaveText('and 2 more');
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await more.click();
        await expect(fill.locator('.hal-fill-row')).toHaveCount(5);
        await expect(fill.locator('[data-hal="more"]')).toHaveText('Show less');
        await expect(fill.locator('[data-hal="more"]')).toBeFocused();
        await expect(fill).toContainText('About 4 research sessions');
        await expect(fill).toContainText("The research's terminal window completes the confirmation.");
        await expect(block(page, 'is-busy')).toContainText('Moravia will be aligned once its search finishes.');
        const shared = block(page, 'is-shared');
        await expect(shared).toContainText('2 events (economy) are no longer searched by any tree on this computer.');
        // Hiding is there: the primary is Align, not the terminal.
        await expect(go(page)).toBeVisible();
        await shared.locator('[data-hal="shared"]').click();
        await expect(dialog(page)).toHaveCount(0);
        expect(await links(page)).toContain(`strom-research://history-align?tree=${UUID}&prune=1`);
    });

    test('nothing to align: a check, only Close', async ({ page }) => {
        await setup(page, { kinds: [...FAKE_KINDS], earlier: false });
        await openAlign(page);
        await expect(block(page, 'is-nothing')).toContainText('Found history matches the settings.');
        await expect(block(page, 'is-nothing')).toContainText('Nothing will be hidden, shown or searched.');
        await expect(dialog(page).locator('.hal-foot .buttons > button')).toHaveCount(1);
        await expect(dialog(page).locator('.primary')).toHaveCount(0);
    });

    test('only searching to add: the terminal confirms (6c)', async ({ page }) => {
        const { history } = await setup(page, { earlier: false });
        history.align!.previewReply = { status: 200, body: fillPreview() };
        await openAlign(page);
        await expect(go(page)).toHaveCount(0);
        const terminal = dialog(page).locator('[data-hal="terminal"]');
        await expect(terminal).toHaveClass(/primary/);
        // The terminal asks; nothing of an agent: the mark, no AI.
        await expect(terminal.locator('.research-open-mark')).toHaveCount(1);
        await expect(terminal.locator('.research-ai-badge')).toHaveCount(0);
        await expect(dialog(page).locator('.hal-terminal-note')).toHaveText("The research's terminal window completes the confirmation. The preview is the same as there.");
        // The terminal's sentence once, above the buttons; the ↻ block keeps its cost sentence.
        await expect(dialog(page).getByText('terminal window completes the confirmation')).toHaveCount(1);
        await expect(block(page, 'is-fill').locator('.hal-note')).toHaveCount(1);
        await terminal.click();
        await expect(dialog(page)).toHaveCount(0);
        expect(await links(page)).toContain(`strom-research://history-align?tree=${UUID}`);
        expect(history.align!.posts).toEqual([]);
    });

    test('a 403 of the research turns Align into the terminal', async ({ page }) => {
        const { history } = await setup(page);
        const link = `strom-research://history-align?tree=${UUID}`;
        history.align!.reply = { status: 403, body: { error: 'terminal', code: 'history.align.link', text: 'terminal', link } };
        await openAlign(page);
        await go(page).click();
        const terminal = dialog(page).locator('[data-hal="terminal"]');
        await expect(terminal).toBeVisible();
        await expect(terminal).toBeFocused();
        await expect(dialog(page).locator('.hal-terminal-note')).toBeVisible();
        await expect(dialog(page).getByText('terminal window completes the confirmation')).toHaveCount(1);
        await terminal.click();
        expect(await links(page)).toContain(link);
    });

    test('Align: written at once, a toast with Undo; Undo takes it back', async ({ page }) => {
        const { history } = await setup(page);
        await openSettingsKinds(page);
        await page.locator('#history-align-link').click();
        await expect(go(page)).toBeVisible();
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        expect(history.align!.posts).toHaveLength(1);
        expect(history.align!.posts[0]).toMatchObject({ hide: true, backfill: true });
        expect(String(history.align!.posts[0].plan)).toMatch(/^[0-9a-f]{16}$/);
        const done = toast(page, 'Hidden: 2 events. Shown again: 1 event.');
        await expect(done).toBeVisible();
        // E2 and E4 hidden by the alignment, E1 shown again.
        expect(history.payload.hidden.filter(x => x.by === 'align').map(x => x.event).sort()).toEqual(['E2', 'E4']);
        // The badge is gone.
        await expect(page.locator('#history-align-link .history-align-badge')).toHaveCount(0);
        await done.locator('button', { hasText: 'Undo' }).click();
        await expect(toast(page, 'The alignment is undone.')).toBeVisible();
        expect(history.align!.undos).toEqual([{ undo: '20261102125010-000001' }]);
        expect(history.payload.hidden.filter(x => x.by === 'align')).toEqual([]);
    });

    test('a busy research: the sentence above the buttons with Try again', async ({ page }) => {
        const { history } = await setup(page);
        history.align!.reply = { status: 503, body: { error: 'busy', code: 'research.busy', text: 'busy' } };
        await openAlign(page);
        await go(page).click();
        const err = dialog(page).locator('.hal-err');
        await expect(err).toContainText('The research is busy. It will work again shortly.');
        await expect(err.locator('[data-hal="retry"]')).toBeFocused();
        delete history.align!.reply;
        await err.locator('[data-hal="retry"]').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(toast(page, 'Hidden: 2 events.')).toBeVisible();
    });

    test('changed meanwhile: a new preview with its banner, then Align', async ({ page }) => {
        const { history } = await setup(page, { earlier: false });
        await openAlign(page);
        await expect(block(page, 'is-hide').locator('.hal-total')).toHaveText('2');
        // Meanwhile war is no longer searched either.
        history.kinds!.kinds = SEARCHED.filter(k => k !== 'war');
        await go(page).click();
        await expect(dialog(page).locator('.hal-changed')).toHaveText('Something changed in the meantime; the preview is up to date.');
        await expect(block(page, 'is-hide').locator('.hal-total')).toHaveText('3');
        await expect(block(page, 'is-hide').locator('.hal-chip[data-kind="war"]')).toBeVisible();
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(toast(page, 'Hidden: 3 events.')).toBeVisible();
        expect(history.align!.posts).toHaveLength(2);
    });

    test('Align with searching to add opens the terminal by the answer\'s link', async ({ page }) => {
        const { history } = await setup(page);
        const link = `strom-research://history-align?tree=${UUID}`;
        history.align!.reply = {
            status: 200,
            body: { done: { hidden: 2, shown: 0, tasks: 0 }, undo: '20261102125010-0000ff',
                backfill: { code: 'history.align.link', said: 'terminal', text: 'terminal', link, n: 1, sessions: 1, pace: 'sometimes' } },
        };
        await openAlign(page);
        await go(page).click();
        await expect(toast(page, "Hidden: 2 events. The search continues after confirmation in the research's terminal window.")).toBeVisible();
        expect(await links(page)).toContain(link);
    });
});

test.describe('Kinds of history: the manager', () => {
    test('What the research searches: the box, its kinds and the way to align', async ({ page }) => {
        const { history } = await setup(page);
        await openManager(page);
        const box = manager(page).locator('#hm-kinds');
        await expect(box.locator('.hm-kinds-title')).toHaveText('What the research searches');
        await expect(box.locator('.hm-kinds-sum')).toHaveText('7 of 9 kinds searched');
        await expect(box.locator('.hm-kinds-toggle')).toHaveAttribute('aria-expanded', 'false');
        await expect(box.locator('.hm-kinds-grid')).toHaveCount(0);
        await box.locator('.hm-kinds-toggle').click();
        await expect(box.locator('.hm-kinds-toggle')).toHaveAttribute('aria-expanded', 'true');
        await expect(box.locator('.hm-kinds-note')).toContainText('The same options as in Settings');
        await expect(box.locator('.hm-kind-row')).toHaveCount(9);
        await expect(box.locator('[data-search-kind][data-state="off"]')).toHaveCount(2);
        // Three columns on a desktop.
        const cols = await box.locator('.hm-kinds-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        expect(cols).toBe(3);
        // The same switch as in Settings: a kind switched off is written after its confirmation (1102).
        await box.locator('[data-search-kind="state"]').click();
        await expect(page.locator('#confirmation-modal.active #confirm-message')).toContainText('would hide 1 found event of this kind');
        await page.locator('#confirm-cancel-btn').click();
        await expect(box.locator('[data-search-kind="state"]')).toHaveAttribute('data-state', 'on');
        expect(history.kindsWrites ?? []).toEqual([]);
        await expect(manager(page)).toBeVisible();
        await box.locator('[data-search-kind="state"]').click();
        await page.locator('#confirm-ok-btn').click();
        await expect.poll(() => history.kindsWrites).toEqual([{ kinds: SEARCHED.filter(k => k !== 'state'), scope: 'tree' }]);
        await expect(box.locator('[data-search-kind="state"]')).toHaveAttribute('data-state', 'off');
        await expect(box.locator('.history-align-badge')).toHaveText('3 to hide');
        await box.locator('[data-hm="align"]').click();
        await expect(dialog(page)).toBeVisible();
        await expect(block(page, 'is-hide').locator('.hal-total')).toHaveText('3');
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(manager(page)).toBeVisible();
    });

    test('searching kinds: the line on a region, a place and the detail', async ({ page }) => {
        const history = fakeHistoryR1();
        history.payload.regions!['cz-bohemia'].kindsFill = { kinds: ['law', 'census'], state: 'queued' };
        history.payload.places['Kutná Hora'].kindsFill = { kinds: ['economy'], state: 'running' };
        await setup(page, { history: { payload: history.payload } });
        await openManager(page);
        const bohemia = manager(page).locator('.hm-region[data-key="cz-bohemia"]');
        await expect(bohemia.locator('.hm-r-fill')).toHaveText('searching kinds: census, law · queued');
        await expect(bohemia.locator('.hm-r-fill')).toHaveClass(/is-queued/);
        await page.locator('#hm-tab-places').click();
        // Kutná Hora stands also among the suggested places: its row in All.
        const kh = manager(page).locator('.hm-place[data-place="Kutná Hora"][data-group="all"]');
        await expect(kh.locator('.hm-p-fill')).toHaveText('searching kinds: economy · searching');
        await expect(kh.locator('.hm-p-fill')).toHaveClass(/is-running/);
        await page.locator('#hm-tab-regions').click();
        await manager(page).locator('.hm-region[data-key="cz-bohemia"]').click();
        await expect(manager(page).locator('.hm-detail-fill')).toHaveText('searching kinds: census, law · queued');
    });

    test('Hidden: the group of events hidden by aligning, by kind; Show again by the alignment\'s undo', async ({ page }) => {
        const { history } = await setup(page);
        await openManager(page, { tab: 'hidden' });
        const group = manager(page).locator('.hm-align-group');
        await expect(group.locator('.hm-group-title')).toHaveText('Hidden by aligning with the settings');
        const row = group.locator('.hm-align-kind[data-kind="war"]');
        await expect(row.locator('.hm-h-text')).toHaveText('War · 1');
        await expect(row.locator('.hm-h-meta')).toHaveText('regional history 1 · local 0');
        await expect(group.locator('.hm-align-note')).toContainText('Show again returns the events to the person card.');
        // The hidings by hand follow, as before (the align one is not among them).
        const hand = manager(page).locator('.hm-hand-group');
        await expect(hand.locator('.hm-group-title')).toHaveText('Hidden by hand');
        await expect(hand.locator('.hm-row.hm-hidden .hm-h-text')).toHaveText(['Vienna stock exchange crash.']);
        await row.locator('[data-hm="showAgainKind"]').click();
        await expect(toast(page, 'Events of the kind war are visible again in this tree.')).toBeVisible();
        expect(history.align!.undos).toEqual([{ undo: EARLIER }]);
        await expect(group.locator('.hm-align-empty')).toHaveText('Nothing hidden by aligning.');
        await expect(hand.locator('.hm-row.hm-hidden')).toHaveCount(1);
    });

    test('Hidden: Show again without one alignment shows each event; Undo hides them again', async ({ page }) => {
        const { history } = await setup(page, { earlier: false });
        history.payload.hidden.push(
            { event: 'E2', tree: true, by: 'align', align: '20261101100000-0000b1', at: '2026-11-01T10:00:00Z' },
            { event: 'E4', tree: true, by: 'align', align: '20261101100000-0000b1', at: '2026-11-01T10:00:00Z' },
        );
        await openManager(page, { tab: 'hidden' });
        // That alignment hid two kinds: economy is shown event by event.
        const row = manager(page).locator('.hm-align-kind[data-kind="economy"]');
        await expect(row.locator('.hm-h-meta')).toHaveText('regional history 1 · local 0');
        await expect(manager(page).locator('.hm-align-kind[data-kind="disaster"] .hm-h-meta')).toHaveText('regional history 0 · local 1');
        await row.locator('[data-hm="showAgainKind"]').click();
        const shown = toast(page, 'Events of the kind economy are visible again in this tree.');
        await expect(shown).toBeVisible();
        expect(history.align!.undos).toEqual([]);
        expect(history.hides).toEqual([expect.objectContaining({ event: 'E2', tree: true, do: 'show' })]);
        await expect(manager(page).locator('.hm-align-kind')).toHaveCount(1);
        await shown.locator('button', { hasText: 'Undo' }).click();
        await expect.poll(() => history.hides.length).toBe(2);
        expect(history.hides[1]).toEqual(expect.objectContaining({ event: 'E2', tree: true }));
        expect(history.hides[1].do).toBeUndefined();
    });
});

test.describe('Kinds of history: without the features', () => {
    test('without history.align: no way to align in the manager, no group in Hidden', async ({ page }) => {
        await setup(page, { features: ALIGN_FEATURES.filter(f => f !== 'history.align'), earlier: false });
        await openManager(page);
        await expect(manager(page).locator('#hm-kinds')).toBeVisible();
        await expect(manager(page).locator('#hm-kinds [data-hm="align"]')).toHaveCount(0);
        await page.locator('#hm-tab-hidden').click();
        await expect(manager(page).locator('.hm-align-group')).toHaveCount(0);
        await expect(manager(page).locator('.hm-hand-group')).toHaveCount(0);
        await expect(manager(page).locator('.hm-row.hm-hidden')).toHaveCount(1);
    });

    test('without history.kinds: no box in the manager', async ({ page }) => {
        await setup(page, { features: ALIGN_FEATURES.filter(f => f !== 'history.kinds' && f !== 'history.align'), earlier: false });
        await openManager(page);
        await expect(manager(page).locator('#hm-kinds')).toHaveCount(0);
    });

    test('a research not running: a toast instead of the dialog', async ({ page }) => {
        const { bridge } = await setup(page);
        await openSettingsKinds(page);
        await expect(page.locator('#history-align-link')).toBeVisible();
        bridge.down = true;
        await poll(page);
        await page.evaluate(() => window.Strom.UI.openHistoryAlign());
        await expect(dialog(page)).toHaveCount(0);
        await expect(toast(page, "The research isn't running.")).toBeVisible();
    });
});

test.describe('Kinds of history: narrow windows', () => {
    test('German on a phone: a bottom sheet, primary on top, nothing overflows', async ({ page }) => {
        const { history } = await setup(page, { width: 360, height: 740 });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        history.align!.previewReply = { status: 200, body: fullPreview() };
        await openAlign(page);
        const modal = dialog(page).locator('.hal-modal');
        await dialog(page).locator('[data-hal="more"]').click();
        expect(await fits(modal)).toBe(true);
        expect(await fits(dialog(page).locator('.hal-body'))).toBe(true);
        const box = await modal.boundingBox();
        expect(box!.y + box!.height).toBeGreaterThan(735);
        expect(box!.height).toBeLessThanOrEqual(740 * 0.9 + 1);
        const [close, primary] = [dialog(page).locator('[data-dismiss]'), go(page)];
        const cb = await close.boundingBox();
        const pb = await primary.boundingBox();
        expect(pb!.y).toBeLessThan(cb!.y);
        expect(pb!.height).toBeGreaterThanOrEqual(44);
        expect(Math.abs(pb!.width - cb!.width)).toBeLessThan(2);
        await page.keyboard.press('Escape');
        await openManager(page);
        await manager(page).locator('#hm-kinds .hm-kinds-toggle').click();
        const kinds = manager(page).locator('#hm-kinds');
        await expect(kinds.locator('.hm-kind-row')).toHaveCount(9);
        expect(await fits(kinds)).toBe(true);
        const cols = await kinds.locator('.hm-kinds-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        expect(cols).toBe(1);
    });

    test('a phone held sideways: the sheet from the top, scrolling as a whole', async ({ page }) => {
        const { history } = await setup(page, { width: 844, height: 390 });
        history.align!.previewReply = { status: 200, body: fullPreview() };
        await openAlign(page);
        const modal = dialog(page).locator('.hal-modal');
        const box = await modal.boundingBox();
        expect(box!.y).toBeLessThanOrEqual(9);
        expect(box!.width).toBeLessThanOrEqual(601);
        expect(await fits(modal)).toBe(true);
        expect(await modal.evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto')).toBe(true);
    });
});

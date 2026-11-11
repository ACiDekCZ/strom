import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, links, UUID, HEAD, NEW_HEAD, FakeBridge } from './research-bridge.js';

/**
 * A hypothesis decided from the app, once the research confirms it (spec
 * 074, DEV §4, §8): "Choose" waits for a new version of the research; a
 * version that leaves the hypothesis as it was keeps the wait; one that holds
 * the decision (with the family links written, K1.5) loads quietly — the
 * notice with "Show", the "?" edge gone, the card decided — or through the
 * Load dialog with the decision first and "in the app" when it brings more
 * ("Later": the card says it was decided, with "Load"). Decided otherwise:
 * the card's line, no notice. After ten minutes the wait reads "Not
 * confirmed by the research yet". The pinned bubble of the "?" edge has
 * "Choose" too, waits in place and closes once decided. Invented people only.
 */

const FEATURES = ['hypothesis.decide.link', 'hypothesis.links'];
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'hypothesis'];
const QUESTION = 'Rodiče Jana Ořechovského: Hostivít a Vavřena, nebo Bořivoj Zálesák?';
const T0 = new Date('2026-11-11T09:30:00Z');

/** The research's tree: Jan without parents, his "?" edge named by H0051 (A: Hostivít and Vavřena, B: Bořivoj). */
function ged(opts: { head?: string; decided?: { variant: string; by?: string }; abandoned?: boolean; birth?: string } = {}): string {
    const d = opts.decided;
    const linked = d && (d.variant === 'A' || d.variant === 'B');
    const hypo = d ? ['2 STAT decided', '2 _PICK Y', `2 _CHOSEN ${d.variant}`, ...(d.by ? [`2 _BY ${d.by}`] : []), '2 DECI rozhodnuto v aplikaci Strom', '2 _AT 2026-11-11']
        : opts.abandoned ? ['2 STAT abandoned', '2 _PICK Y', '2 _BY app', '2 _AT 2026-11-11']
        : ['2 STAT open', '2 _PICK Y', '2 _PROP B', '3 DECI Zápis 1861 jmenuje Bořivoje.', '3 _AT 2026-11-09'];
    const edge = d || opts.abandoned ? [] : [
        '1 _STROM_EDGE parents', '2 _SCOPE in', '2 _END named', '2 _NEXT decide',
        '2 _HYPO H0051', '3 _JOIN P0001', '3 _JOIN P0002', '3 _JOIN P0004', '3 _VAR A', '3 _VAR B',
    ];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 11 NOV 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${opts.head ?? HEAD}`, '1 _STROM_LINKS send open live app setup hypothesis', '1 CHAR UTF-8', '1 NOTE Ořechovští',
        '0 @P0003@ INDI', '1 NAME Jan /Ořechovský/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research',
        ...(opts.birth ? ['1 BIRT', `2 DATE ${opts.birth}`] : []),
        ...(linked ? [`1 FAMC @F000${d!.variant === 'A' ? 1 : 2}@`] : []),
        ...edge,
        '1 _STROM_HYPO H0051', `2 TITL ${QUESTION}`, ...hypo,
        '2 _VAR A', '3 TITL Syn Hostivíta a Vavřeny', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0001@', '4 _PAR @P0002@',
        '2 _VAR B', '3 TITL Syn Bořivoje Zálesáka', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0004@',
        '0 @P0001@ INDI', '1 NAME Hostivít /Ořechovský/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Vavřena /Cvrkalová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0004@ INDI', '1 NAME Bořivoj /Zálesák/', '1 SEX M', '1 REFN P0004', '2 TYPE strom-research', ...(linked && d!.variant === 'B' ? ['1 FAMS @F0002@'] : []),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', ...(linked && d!.variant === 'A' ? ['1 CHIL @P0003@'] : []),
        ...(linked && d!.variant === 'B' ? ['0 @F0002@ FAM', '1 HUSB @P0004@', '1 CHIL @P0003@'] : []),
        '0 TRLR',
    ].join('\n');
}

async function setup(page: Page, opts: { width?: number; dialog?: boolean } = {}): Promise<FakeBridge> {
    await page.clock.install({ time: T0 });
    await page.setViewportSize({ width: opts.width ?? 1440, height: 900 });
    await page.addInitScript((announced) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
    }, LINKS);
    const b = await fakeBridge(page, { features: FEATURES, treeGed: ged(), links: LINKS });
    await openResearch(page, { ged: ged() });
    await poll(page);
    await page.evaluate(() => {
        const S = window.Strom;
        S.TreeRenderer.setFocus(S.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0003')!.id);
    });
    if (opts.dialog !== false) await openCard(page);
    return b;
}

async function openCard(page: Page): Promise<void> {
    const id = await idOf(page, 'P0003');
    await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'research-knows'), id);
    await expect(page.locator('#person-research-modal')).toBeVisible();
}

const idOf = (page: Page, refn: string) => page.evaluate((r) => window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === r)!.id, refn);
const card = (page: Page) => page.locator('#person-research-modal .person-research-hypo[data-hypo="H0051"]');
const row = (page: Page, v: string) => card(page).locator(`.person-research-variant[data-variant="${v}"]`);
const toast = (page: Page) => page.locator('.toast');
const opened = async (page: Page): Promise<string[]> => (await links(page)).filter(u => u.startsWith('strom-research://hypothesis'));
const stub = (page: Page) => page.locator('.person-card .research-edge.edge-named');
const parentsOf = (page: Page) => page.evaluate(() => {
    const S = window.Strom;
    const jan = S.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0003')!;
    return (jan.parentIds ?? []).map((id: string) => S.DataManager.getPerson(id as never)?.refn).sort();
});

/** The research writes a version (its head moves) and the app asks its bridge (`dialog`: not awaited, a dialog will hold it). */
async function write(page: Page, b: FakeBridge, head: string, text: string, dialog = false): Promise<void> {
    b.head = head;
    b.treeGed = text;
    if (dialog) await page.evaluate(() => { void window.Strom.UI.pollResearchBridge(); });
    else await poll(page);
}

test.describe('A hypothesis decided from the app: the research confirms it', () => {
    test('Choose waits through a version without the decision; the decision with its links loads quietly, said with Show', async ({ page }) => {
        const b = await setup(page);
        await row(page, 'B').locator('.prv-pick').click();
        expect(await opened(page)).toEqual([`strom-research://hypothesis?tree=${UUID}&id=H0051&do=decide&variant=B`]);
        await expect(row(page, 'B').locator('.prv-wait')).toBeVisible();

        // A version of the research that leaves H0051 as it was: still waiting.
        await write(page, b, 'aaaa1111bbbb', ged({ head: 'aaaa1111bbbb' }));
        await expect(row(page, 'B').locator('.prv-wait')).toBeVisible();
        expect(await parentsOf(page)).toEqual([]);

        // Decided for B, Jan linked to Bořivoj in the same version: loaded quietly, no Load dialog.
        await write(page, b, NEW_HEAD, ged({ head: NEW_HEAD, decided: { variant: 'B', by: 'app' } }));
        await expect(toast(page)).toContainText('Hypothesis H0051 decided: B');
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        expect(await parentsOf(page)).toEqual(['P0004']);
        // The card decided, the wait gone; no "?" edge left.
        await expect(card(page).locator('.prv-wait')).toHaveCount(0);
        await expect(row(page, 'B').locator('.prv-tag')).toBeVisible();
        await expect(stub(page)).toHaveCount(0);
        await expect(page.locator('#person-research-modal #research-edge-section')).toHaveCount(0);
        // "Show" opens the card of the hypothesis.
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
        await toast(page).getByRole('button', { name: 'Show' }).click();
        await expect(card(page)).toBeVisible();
    });

    test('decided otherwise in the research: the card says so, no notice; Stop waiting forgets the wait', async ({ page }) => {
        const b = await setup(page);
        await row(page, 'B').locator('.prv-pick').click();
        await write(page, b, NEW_HEAD, ged({ head: NEW_HEAD, decided: { variant: 'A', by: 'agent' } }));
        await expect(card(page).locator('.prh-decided-note')).toHaveText('Already decided in the research: A (decided by the agent)');
        await expect(card(page).locator('.prv-wait')).toHaveCount(0);
        await expect(toast(page).filter({ hasText: 'H0051' })).toHaveCount(0);
        expect(await parentsOf(page)).toEqual(['P0001', 'P0002']);
    });

    test('after ten minutes the wait reads "Not confirmed by the research yet"; Stop waiting brings the choices back', async ({ page }) => {
        await setup(page);
        await row(page, 'A').locator('.prv-pick').click();
        const wait = row(page, 'A').locator('.prv-wait');
        await expect(wait).toHaveAttribute('data-wait-phase', 'waiting');
        await page.clock.fastForward(9 * 60_000);
        await expect(wait).toHaveAttribute('data-wait-phase', 'waiting');
        await page.clock.fastForward(61_000);
        await expect(wait).toHaveAttribute('data-wait-phase', 'long');
        await expect(wait.locator('.prv-wait-title')).toHaveText('Not confirmed by the research yet');
        await wait.locator('.prv-wait-stop').click();
        await expect(card(page).locator('.prv-wait')).toHaveCount(0);
        await expect(card(page).locator('.prv-pick:not([disabled])')).toHaveCount(2);
    });

    test('a version with more changes: the Load dialog with the decision first, "in the app"; Later leaves the card with Load', async ({ page }) => {
        const b = await setup(page);
        await row(page, 'B').locator('.prv-pick').click();
        await write(page, b, NEW_HEAD, ged({ head: NEW_HEAD, decided: { variant: 'B', by: 'app' }, birth: '3 MAR 1862' }), true);
        const dialog = page.locator('#research-load-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.research-load-intro')).toHaveText('Hypothesis H0051 decided: B. The research\'s version has other changes too. A backup is saved first.');
        await expect(dialog.locator('thead th').first()).toHaveText('Person · 1');
        const first = dialog.locator('tbody tr').first();
        await expect(first).toHaveClass(/research-load-hypo/);
        await expect(first.locator('.research-load-field')).toContainText('H0051 decided for B');
        await expect(first.locator('.research-load-inapp')).toHaveText('in the app');
        await dialog.locator('#research-load-cancel').click();
        await expect(dialog).toHaveCount(0);
        expect(await parentsOf(page)).toEqual([]);
        await expect(card(page).locator('.prv-wait')).toHaveCount(0);
        await expect(card(page).locator('.prh-decided-note')).toContainText('Already decided in the research: B (decided in the app)');
        await expect(card(page).locator('.prh-decided-load')).toHaveText('Load');
    });

    test('the pinned bubble of the "?" edge: Choose at each version, the proposal as a tag, the wait in place; closed once decided', async ({ page }) => {
        const b = await setup(page, { dialog: false });
        await stub(page).first().click();
        const bubble = page.locator('#research-edge-bubble.is-pinned');
        await expect(bubble).toBeVisible();
        await expect(bubble.locator('.reb-pick')).toHaveCount(2);
        await expect(bubble.locator('.reb-variant[data-variant="B"] .reb-proposal-tag')).toHaveText('proposed by the agent');
        await expect(bubble.locator('.reb-variant[data-variant="A"] .reb-proposal-tag')).toHaveCount(0);
        await expect(bubble.locator('.reb-more')).toHaveText('More in What the research knows');
        await bubble.locator('.reb-variant[data-variant="A"] .reb-pick').click();
        expect(await opened(page)).toEqual([`strom-research://hypothesis?tree=${UUID}&id=H0051&do=decide&variant=A`]);
        // Still pinned, the wait at A, every Choose switched off; Open again asks once more.
        await expect(bubble.locator('.reb-variant[data-variant="A"] .reb-wait')).toBeVisible();
        await expect(bubble.locator('.reb-pick:not([disabled])')).toHaveCount(0);
        await expect(bubble.locator('.reb-wait-again')).toBeFocused();
        await bubble.locator('.reb-wait-again').click();
        expect((await opened(page)).length).toBe(2);
        // The research decides A with the links: the bubble closes, the keyboard on Jan's card.
        await write(page, b, NEW_HEAD, ged({ head: NEW_HEAD, decided: { variant: 'A', by: 'app' } }));
        await expect(toast(page)).toContainText('Hypothesis H0051 decided: A');
        await expect(page.locator('#research-edge-bubble')).toHaveCount(0);
        expect(await parentsOf(page)).toEqual(['P0001', 'P0002']);
        const jan = await idOf(page, 'P0003');
        await expect(page.locator(`.person-card[data-id="${jan}"]`)).toBeFocused();
    });

    test('the bubble on a phone: Show and Choose side by side, 44 px; Stop waiting in the bubble', async ({ page }) => {
        await setup(page, { dialog: false, width: 390 });
        await stub(page).first().click();
        const bubble = page.locator('#research-edge-bubble.is-pinned');
        await expect(bubble).toBeVisible();
        const rowA = bubble.locator('.reb-variant[data-variant="A"]');
        const show = rowA.locator('.reb-show');
        const choose = rowA.locator('.reb-pick');
        const [s, c] = [await show.boundingBox(), await choose.boundingBox()];
        expect(s && c).toBeTruthy();
        expect(Math.abs(s!.y - c!.y)).toBeLessThan(2);
        expect(s!.height).toBeGreaterThanOrEqual(44);
        expect(c!.height).toBeGreaterThanOrEqual(44);
        expect(await bubble.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await choose.click();
        await expect(rowA.locator('.reb-wait')).toBeVisible();
        await bubble.locator('.reb-wait-stop').click();
        await expect(bubble.locator('.reb-wait')).toHaveCount(0);
        await expect(bubble.locator('.reb-pick:not([disabled])')).toHaveCount(2);
    });
});

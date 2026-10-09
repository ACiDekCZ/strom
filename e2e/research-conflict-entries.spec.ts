import { test, expect, Page, Route } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { BRIDGE, UUID, HEAD, NEW_HEAD, FakeBridge, fakeBridge, dropFile, poll, openResearchMenu, block } from './research-bridge.js';

/**
 * The ways to a conflict decidable in the app (DEV §6): the panel by the edit
 * form's field ("conflict ›": decide from it, the form's unsaved edits saved
 * first, the field following the value loaded after Take, Esc and × giving
 * the keyboard back; on a phone a bottom sheet), the Research menu's "Show"
 * for the one conflict the write left (the dialog at its card, lit up a
 * moment), the overview's row (the dialog at the card; a conflict decided
 * leaves the list at once) and the card's ≠ (the dialog at the first open
 * conflict). Against a bridge answered by page.route. Invented data only.
 */

const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'conflict'];

interface Version {
    head?: string;
    janBirth?: string;
    janState?: 'open' | 'decided';
    janDeath?: string;
    /** Jan's conflict as one of the sources (no side said): never decided here. */
    sources?: boolean;
    /** The links the research announces (default: with `conflict`). */
    links?: string[];
}

/** A research file: Josef and Anna, their son Jan with a conflict of his edit about his birth date. */
function ged(v: Version = {}): string {
    const state = v.janState ?? 'open';
    const conflict = v.sources
        ? ['1 _STROM_CONFLICT X0007', '2 TYPE BIRT', `2 STAT ${state}`, '2 VAL 3 FEB 1865', '3 SOUR @S0001@', '2 VAL 1865']
        : ['1 _STROM_CONFLICT X0007', '2 TYPE BIRT', `2 STAT ${state}`, '2 _STROM_TAKE Y',
            '2 VAL 3 FEB 1865', '3 SOUR @S0001@', '3 _STROM_SIDE research', '2 VAL 1865', '3 _STROM_SIDE user',
            ...(state === 'decided' ? ['2 DECI 1865'] : [])];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 9 OCT 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${v.head ?? HEAD}`, `1 _STROM_LINKS ${(v.links ?? LINKS).join(' ')}`, '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
        '1 BIRT', `2 DATE ${v.janBirth ?? '1865'}`, '2 PLAC Chlumy',
        '1 DEAT', `2 DATE ${v.janDeath ?? '1932'}`,
        ...conflict,
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 @S0001@ SOUR', '1 TITL Oddací matrika Čáslav', '1 PAGE fol. 41', '1 REFN S0001', '1 TEXT Josef Víšek a Anna', '1 _STROM_READ research',
        '0 TRLR',
    ].join('\n');
}

interface Reply { status: number; body?: unknown; then?: Version }
interface DecideRoute { asks: { id: string; body: unknown }[]; replies: Reply[] }

async function decideRoute(page: Page, bridge: FakeBridge | null): Promise<DecideRoute> {
    const d: DecideRoute = { asks: [], replies: [] };
    await page.route(`${BRIDGE}/conflict/**`, async (route: Route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': '*' } });
        d.asks.push({ id: decodeURIComponent(new URL(req.url()).pathname.split('/').pop() ?? ''), body: JSON.parse(req.postData() ?? 'null') });
        const reply = d.replies.shift() ?? { status: 500, body: { error: 'no reply queued' } };
        if (reply.then && bridge) {
            bridge.head = reply.then.head ?? NEW_HEAD;
            bridge.treeGed = ged(reply.then);
        }
        return route.fulfill({ status: reply.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(reply.body ?? {}) });
    });
    return d;
}

/**
 * The research opened from its file (`opened`), its bridge serving `serving` (default: the same version);
 * `features`: what its bridge says it can do (none: decided by a link into the research); `bridge: false`: it does
 * not answer here (no link announced either: not on this device).
 */
async function setup(page: Page, opened: Version = {}, serving?: Version, opts: { bridge?: boolean; features?: string[] } = {}): Promise<{ bridge: FakeBridge; decide: DecideRoute; treeId: string }> {
    await page.clock.install();
    await openApp(page);
    await page.evaluate(() => {
        // Opening links in the system is not testable: recorded instead.
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
    });
    await dropFile(page, 'tree-strom.ged', ged(opened));
    await expect(card(page, 'Jan')).toBeVisible();
    const treeId = await page.evaluate(({ uuid, base }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts: { sync: { auto: 'off' }, sources: true, verified: true } }));
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        tm.patchResearchLink(id, { sendMode: 'manual' });
        localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify({ ...JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}'), modeAsked: true, skipPreview: true }));
        return id;
    }, { uuid: UUID, base: BRIDGE });
    if (opts.bridge === false) return { bridge: null as unknown as FakeBridge, decide: await decideRoute(page, null), treeId };
    const bridge = await fakeBridge(page, { treeGed: ged(serving ?? opened), head: serving?.head ?? opened.head ?? HEAD, links: opened.links ?? LINKS, features: opts.features ?? ['conflict.decide'] });
    await poll(page);
    const decide = await decideRoute(page, bridge);
    return { bridge, decide, treeId };
}

const KEEP_200: Reply = { status: 200, body: { decided: 'X0007', take: 'user', head: NEW_HEAD }, then: { head: NEW_HEAD, janState: 'decided' } };
const TAKE_200 = (then: Version): Reply => ({ status: 200, body: { decided: 'X0007', take: 'research', head: NEW_HEAD }, then: { head: NEW_HEAD, janState: 'decided', ...then } });

async function editJan(page: Page): Promise<void> {
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Jan')!;
        window.Strom.UI.runPersonMenuAction(p.id, 'edit');
    });
    await expect(page.locator('#person-modal')).toBeVisible();
}

/** An edit of another person: the tree is no longer what the research had (nothing loads quietly after Keep). */
const editJosef = (page: Page) => page.evaluate(() => {
    const dm = window.Strom.DataManager;
    dm.updatePerson(dm.getAllPersons().find(p => p.firstName === 'Josef')!.id, { birthPlace: 'Praha' });
});

const tag = (page: Page) => page.locator('#person-modal label[for="input-birthdate"] .pm-conflict-tag');
const panel = (page: Page) => page.locator('#prc-panel');
const choice = (page: Page, which: 'user' | 'research') => panel(page).locator(`.prc-panel-row[data-side="${which}"] .prc-panel-choice`);
const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');
const cardOf = (page: Page) => page.locator('#person-research-modal [data-conflict-card="X0007"]');

test.describe('the panel by the edit form\'s field', () => {
    test.use({ locale: 'en-US' });
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

    test('"conflict ›" opens the panel by the field: the sides, short choices, the keyboard on Keep; Esc and × give it back to the tag', async ({ page }) => {
        await setup(page);
        await editJan(page);
        await expect(tag(page)).toHaveAttribute('aria-haspopup', 'dialog');
        await expect(tag(page)).toHaveAttribute('aria-label', 'Conflict · Birth');
        await tag(page).click();
        const p = panel(page);
        await expect(p).toBeVisible();
        await expect(p).toHaveAttribute('role', 'dialog');
        await expect(tag(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(p.locator('.prc-panel-title')).toHaveText('Conflict · Birth');
        await expect(p.locator('.prc-panel-row[data-side="user"] .prc-panel-value')).toHaveText('1865');
        await expect(p.locator('.prc-panel-row[data-side="research"] .prc-panel-source')).toHaveText('Oddací matrika Čáslav');
        await expect(choice(page, 'user')).toHaveText('Keep');
        await expect(choice(page, 'user')).toHaveAttribute('aria-label', 'Keep the value from the app');
        await expect(choice(page, 'research')).toHaveText('Take');
        await expect(choice(page, 'research')).toHaveAttribute('aria-label', "Take the research's value");
        await expect(p.locator('#prc-panel-note-user')).toHaveText("The research writes the value from the app; the record's value stays in its history with the reason.");
        await expect(p.locator('#prc-panel-note-research')).toHaveText("The value here changes to the research's. A backup is saved first.");
        await expect(p.locator('.prc-panel-more')).toHaveText('More in What the research knows ›');
        await expect(choice(page, 'user')).toBeFocused();

        // Tab stays inside.
        for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('#prc-panel'))).toBe(true);

        // Inside the window, under the field, its arrow at the tag.
        const box = (await p.boundingBox())!;
        const field = (await page.locator('#input-birthdate').boundingBox())!;
        const t = (await tag(page).boundingBox())!;
        expect(box.y).toBeGreaterThan(field.y + field.height);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1280);
        expect(box.y + box.height).toBeLessThanOrEqual(900);
        expect(box.width).toBeLessThanOrEqual(400);
        const arrow = (await p.locator('.prc-panel-arrow').boundingBox())!;
        expect(Math.abs(arrow.x + arrow.width / 2 - (t.x + t.width / 2))).toBeLessThan(4);

        // Esc: the panel goes, the form stays, the keyboard on the tag.
        await page.keyboard.press('Escape');
        await expect(p).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(tag(page)).toBeFocused();
        await expect(tag(page)).toHaveAttribute('aria-expanded', 'false');
        // ×: the same.
        await tag(page).click();
        await p.locator('.prc-panel-close').click();
        await expect(p).toHaveCount(0);
        await expect(tag(page)).toBeFocused();
        // "More in What the research knows ›": the dialog at the card.
        await tag(page).click();
        await p.locator('.prc-panel-more').click();
        await expect(p).toHaveCount(0);
        await expect(cardOf(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
        await expect(tag(page)).toBeFocused();
    });

    test('keep from the panel: deciding, then the panel and the tag gone, the keyboard on the field, nothing of the form changed', async ({ page }) => {
        const { decide } = await setup(page);
        await editJosef(page);
        await editJan(page);
        await tag(page).click();
        decide.replies.push(KEEP_200);
        await choice(page, 'user').click();
        await expect(panel(page)).toHaveCount(0);
        await expect(tag(page)).toHaveCount(0);
        expect(await activeId(page)).toBe('input-birthdate');
        await expect(page.locator('.toast')).toHaveText('Conflict decided: 1865');
        await expect(page.locator('#input-birthdate')).toHaveValue('1865');
        expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(false);
        expect(decide.asks).toEqual([{ id: 'X0007', body: { do: 'decide', take: 'user' } }]);
    });

    test('the form with unsaved edits: the choices wait, "The person\'s edit is saved first, then the decision."; saved, they are on', async ({ page }) => {
        const { decide } = await setup(page);
        await editJan(page);
        await page.locator('#input-birthplace').fill('Kolín');
        await tag(page).click();
        await expect(panel(page).locator('.prc-notice--warn .prc-notice-text')).toHaveText("The person's edit is saved first, then the decision.");
        await expect(choice(page, 'user')).toBeDisabled();
        await expect(choice(page, 'research')).toBeDisabled();
        await expect(panel(page).locator('.prc-panel-note')).toHaveCount(0);
        await expect(panel(page)).toHaveAttribute('data-state', 'saveFirst');
        // The keyboard on the close button (no choice is on).
        await expect(panel(page).locator('.prc-panel-close')).toBeFocused();
        await page.keyboard.press('Escape');
        expect(decide.asks).toHaveLength(0);
        // Saved: opened again, the choices are on.
        await page.locator('#btn-save').click();
        await expect(page.locator('#person-modal')).toBeHidden();
        await editJan(page);
        await tag(page).click();
        await expect(choice(page, 'user')).toBeEnabled();
        await expect(panel(page).locator('.prc-notice--warn')).toHaveCount(0);
    });

    for (const how of ['quiet', 'asked'] as const) {
        test(`take from the panel (${how === 'quiet' ? 'only this value differs' : 'the research has more: the Load dialog'}): the field shows the value loaded, the form has nothing unsaved`, async ({ page }) => {
            const more = how === 'asked' ? { janDeath: '1933' } : {};
            const { decide } = await setup(page, {}, { janBirth: '3 FEB 1865', ...more });
            await editJan(page);
            await expect(page.locator('#input-birthdate')).toHaveValue('1865');
            await tag(page).click();
            decide.replies.push(TAKE_200({ janBirth: '3 FEB 1865', ...more }));
            await choice(page, 'research').click();
            if (how === 'asked') {
                await expect(page.locator('#research-load-modal')).toBeVisible();
                await page.locator('#research-load-modal #research-load-ok').click();
            }
            await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.birthDate)).toBe('1865-02-03');
            await expect(page.locator('#input-birthdate')).not.toHaveValue('1865');
            const shown = await page.locator('#input-birthdate').inputValue();
            if (how === 'asked') await expect(page.locator('#input-deathdate')).toHaveValue('1933');
            await expect(tag(page)).toHaveCount(0);
            expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(false);
            // As the form shows it opened afresh.
            await page.locator('#person-modal').getByRole('button', { name: 'Cancel' }).click();
            await expect(page.locator('#person-modal')).toBeHidden();
            await editJan(page);
            await expect(page.locator('#input-birthdate')).toHaveValue(shown);
        });
    }

    test('take decided from the dialog above a form with unsaved edits: the field loaded follows, what was typed elsewhere stays', async ({ page }) => {
        const { decide } = await setup(page, {}, { janBirth: '3 FEB 1865' });
        await editJan(page);
        await page.locator('#input-birthplace').fill('Kolín');
        await tag(page).click();
        await panel(page).locator('.prc-panel-more').click();
        decide.replies.push(TAKE_200({ janBirth: '3 FEB 1865' }));
        await cardOf(page).locator('.prc-side[data-side="research"] .prc-choice').click();
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.birthDate)).toBe('1865-02-03');
        await expect(page.locator('#input-birthdate')).not.toHaveValue('1865');
        await expect(page.locator('#input-birthplace')).toHaveValue('Kolín');
        expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(true);
    });

    test('an error with the panel open: said in the panel with "Try again" (no notice), the same side asked again', async ({ page }) => {
        const { decide } = await setup(page);
        await editJosef(page);
        await editJan(page);
        await tag(page).click();
        decide.replies.push({ status: 423, body: { code: 'locked' } });
        await choice(page, 'user').click();
        await expect(panel(page).locator('.prc-notice--error .prc-notice-text')).toHaveText('The tree in the research is locked by another session; the decision did not go through.');
        await expect(panel(page)).toHaveAttribute('data-state', 'error');
        await expect(page.locator('.toast').filter({ hasText: 'could not be decided' })).toHaveCount(0);
        decide.replies.push(KEEP_200);
        await panel(page).locator('.prc-notice-action').click();
        await expect(panel(page)).toHaveCount(0);
        expect(decide.asks.map(a => a.body)).toEqual([{ do: 'decide', take: 'user' }, { do: 'decide', take: 'user' }]);
    });

    test('without the bridge\'s decision: the choices are links into the research (↗), taking a side', async ({ page }) => {
        const { decide } = await setup(page, {}, undefined, { features: [] });
        await editJan(page);
        await tag(page).click();
        await expect(panel(page)).toHaveAttribute('data-state', 'link');
        await expect(choice(page, 'research')).toHaveText('Take ↗');
        await expect(choice(page, 'research')).toHaveAttribute('aria-label', "Take the research's value ↗");
        await expect(panel(page).locator('.prc-link-note')).toHaveText('Opens the research; it only asks to confirm.');
        await choice(page, 'research').click();
        const opened = await page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links);
        expect(opened).toHaveLength(1);
        expect(opened[0]).toContain('id=X0007');
        expect(opened[0]).toContain('take=research');
        expect(decide.asks).toHaveLength(0);
    });

    test('not on this device: the sides without choices, "Decided on the computer with the research."', async ({ page }) => {
        await setup(page, { links: ['send', 'open', 'live', 'app', 'setup'] }, undefined, { bridge: false });
        await editJan(page);
        await tag(page).click();
        await expect(panel(page)).toHaveAttribute('data-state', 'none');
        await expect(panel(page).locator('.prc-notice--info .prc-notice-text')).toHaveText('Decided on the computer with the research.');
        await expect(panel(page).locator('.prc-panel-choice')).toHaveCount(0);
        await expect(panel(page).locator('.prc-panel-close')).toBeFocused();
    });

    test('a conflict of the sources: its tag opens the dialog, no panel', async ({ page }) => {
        await setup(page, { sources: true });
        await editJan(page);
        await expect(tag(page)).not.toHaveAttribute('aria-haspopup', 'dialog');
        await tag(page).click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await expect(panel(page)).toHaveCount(0);
    });
});

test.describe('the panel on a phone: a bottom sheet', () => {
    test.use({ locale: 'en-US' });

    test('phone (360 px): the rows one under the other, the choices 44 px across the width; Keep decides, the sheet goes', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        const { decide } = await setup(page);
        await editJosef(page);
        await editJan(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toHaveClass(/prc-panel--sheet/);
        await expect(page.locator('.prc-panel-overlay')).toHaveClass(/active/);
        const row = (await p.locator('.prc-panel-row[data-side="user"]').boundingBox())!;
        const keep = (await choice(page, 'user').boundingBox())!;
        expect(keep.height).toBeGreaterThanOrEqual(44);
        expect(keep.width).toBeGreaterThan(row.width - 30);
        // Under the value, not beside it.
        const value = (await p.locator('.prc-panel-row[data-side="user"] .prc-panel-value').boundingBox())!;
        expect(keep.y).toBeGreaterThan(value.y + value.height - 1);
        const sheet = (await p.boundingBox())!;
        expect(sheet.y + sheet.height).toBeLessThanOrEqual(740 + 1);
        expect((await p.locator('.prc-panel-close').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(choice(page, 'user')).toBeFocused();
        decide.replies.push(KEEP_200);
        await choice(page, 'user').click();
        await expect(page.locator('.prc-panel-overlay')).toHaveCount(0);
        await expect(tag(page)).toHaveCount(0);
    });

    test('phone (360 px): a tap on the backdrop closes the sheet, the form stays', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await setup(page);
        await editJan(page);
        await tag(page).click();
        await expect(page.locator('.prc-panel-overlay')).toHaveClass(/active/);
        await page.mouse.click(180, 10);
        await expect(page.locator('.prc-panel-overlay')).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
    });

    test('phone held sideways: a sheet inside the window, value and choice side by side, the choices 44 px', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        await setup(page);
        await editJan(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toHaveClass(/prc-panel--sheet/);
        await expect(page.locator('.prc-panel-overlay')).toHaveClass(/active/);
        const keep = (await choice(page, 'user').boundingBox())!;
        const value = (await p.locator('.prc-panel-row[data-side="user"] .prc-panel-value').boundingBox())!;
        expect(keep.height).toBeGreaterThanOrEqual(44);
        expect(keep.x).toBeGreaterThan(value.x + value.width);
        const sheet = (await p.boundingBox())!;
        expect(sheet.y).toBeGreaterThanOrEqual(0);
        expect(sheet.y + sheet.height).toBeLessThanOrEqual(390 + 1);
        await page.keyboard.press('Escape');
        await expect(page.locator('.prc-panel-overlay')).toHaveCount(0);
        await expect(tag(page)).toBeFocused();
    });

    test('dark theme: the panel in the dark surface', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setup(page);
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await editJan(page);
        await tag(page).click();
        const surface = await page.evaluate(() => {
            const probe = document.createElement('span');
            probe.style.background = 'var(--surface)';
            document.body.appendChild(probe);
            const v = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return v;
        });
        expect(await panel(page).evaluate(el => getComputedStyle(el).backgroundColor)).toBe(surface);
    });
});

test.describe('the Research menu, the ≠ and the dialog at the card', () => {
    test.use({ locale: 'en-US' });
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

    /** The tree as sent and written, its write left this conflict; the research moved on since. */
    async function writtenWithConflict(page: Page, bridge: FakeBridge, treeId: string, v: Version = {}): Promise<void> {
        await editJosef(page);
        await page.evaluate(id => {
            const tm = window.Strom.TreeManager;
            const link = tm.getTreeMetadata(id)!.research!;
            const fp = window.Strom.UI.researchSyncFingerprints(id, link).current;
            const at = new Date().toISOString();
            tm.patchResearchLink(id, { sent: { fingerprint: fp, at, closedAt: at, changes: 1, head: link.head ?? '', state: 'written', conflicts: 1, intake: 'R1' } });
            const st = JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}');
            st.lastWritten = { at, changes: 1, conflicts: 1, conflictIds: ['X0007'], fingerprint: fp, intake: 'R1' };
            localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify(st));
        }, treeId);
        bridge.head = 'cccc2222dddd';
        bridge.treeGed = ged({ ...v, head: 'cccc2222dddd', janDeath: '1933' });
        await poll(page);
        expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('writtenConflicts');
    }

    test('one conflict decidable here: "Show" with whom and what above it — the dialog at the card, the keyboard on Keep, lit up 1.5 s', async ({ page }) => {
        const { bridge, treeId } = await setup(page);
        await writtenWithConflict(page, bridge, treeId);
        await openResearchMenu(page);
        await expect(block(page).locator('.research-sync-lead')).toHaveText('Jan Víšek · Birth');
        const show = block(page).locator('[data-action="showConflict"]');
        await expect(show).toHaveText('Show');
        await expect(show).toHaveClass(/research-sync-btn/);
        await expect(block(page).locator('[data-action="decideInResearch"], [data-action="showConflicts"]')).toHaveCount(0);
        await expect(block(page).locator('[data-action="loadNewer"]')).toBeVisible();
        await show.click();
        const c = cardOf(page);
        await expect(c).toBeVisible();
        await expect(c).toHaveClass(/prc--highlight/);
        await expect(c.locator('.prc-side[data-side="user"] .prc-choice')).toBeFocused();
        expect(await c.evaluate(el => getComputedStyle(el).outlineColor)).toBe(await page.evaluate(() => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--primary)';
            document.body.appendChild(probe);
            const v = getComputedStyle(probe).color;
            probe.remove();
            return v;
        }));
        await page.clock.fastForward(1600);
        await expect(c).not.toHaveClass(/prc--highlight/);
    });

    test('written, the research did not move on: "Show" too', async ({ page }) => {
        const { treeId } = await setup(page);
        await editJosef(page);
        await page.evaluate(id => {
            const tm = window.Strom.TreeManager;
            const link = tm.getTreeMetadata(id)!.research!;
            const fp = window.Strom.UI.researchSyncFingerprints(id, link).current;
            const at = new Date().toISOString();
            tm.patchResearchLink(id, { sent: { fingerprint: fp, at, closedAt: at, changes: 1, head: link.head ?? '', state: 'written', conflicts: 1, intake: 'R1' } });
            const st = JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}');
            st.lastWritten = { at, changes: 1, conflicts: 1, conflictIds: ['X0007'], fingerprint: fp, intake: 'R1' };
            localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify(st));
        }, treeId);
        await poll(page);
        expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('written');
        await openResearchMenu(page);
        await expect(block(page).locator('.research-sync-lead')).toHaveText('Jan Víšek · Birth');
        await block(page).locator('[data-action="showConflict"]').click();
        await expect(cardOf(page)).toHaveClass(/prc--highlight/);
    });

    test('reduced motion: the light comes and goes without a fade', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const { bridge, treeId } = await setup(page);
        await writtenWithConflict(page, bridge, treeId);
        await openResearchMenu(page);
        await block(page).locator('[data-action="showConflict"]').click();
        const c = cardOf(page);
        await expect(c).toHaveClass(/prc--highlight/);
        await page.clock.fastForward(1600);
        await expect(c).not.toHaveClass(/prc--highlight/);
        expect(await c.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
    });

    test('a conflict of the sources: the menu keeps "Decide in the research ↗", no "Show"', async ({ page }) => {
        const { bridge, treeId } = await setup(page, { sources: true });
        await writtenWithConflict(page, bridge, treeId, { sources: true });
        await openResearchMenu(page);
        await expect(block(page).locator('[data-action="showConflict"]')).toHaveCount(0);
        await expect(block(page).locator('.research-sync-lead')).toHaveCount(0);
        await expect(block(page).locator('[data-action="decideInResearch"]')).toBeVisible();
    });

    test('the card\'s ≠: the dialog at the first open conflict, the keyboard on its first choice', async ({ page }) => {
        await setup(page);
        const badge = card(page, 'Jan').locator('.card-signal');
        await expect(badge).toHaveText('≠');
        await badge.click();
        await expect(cardOf(page)).toHaveClass(/prc--highlight/);
        await expect(cardOf(page).locator('.prc-side[data-side="user"] .prc-choice')).toBeFocused();
    });
});

test.describe('the overview while following', () => {
    test.use({ locale: 'en-US' });

    test('a conflict\'s row opens the dialog at its card; decided there, the row leaves the list at once', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const { bridge, decide } = await setup(page);
        // Following live; the research's events stay quiet.
        await page.route(`${BRIDGE}/events`, () => new Promise<void>(() => { /* never answers */ }));
        await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
        await expect(page.locator('#live-panel')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        const knows = ov.locator('.live-section__head').filter({ has: page.locator('.live-section__title', { hasText: 'What the research knows' }) });
        await expect(knows.locator('.live-section__sum')).toHaveText('1 conflict');
        if (await knows.getAttribute('aria-expanded') === 'false') await knows.click();
        const row = ov.locator('.research-overview__knows-row.is-conflict');
        await expect(row).toHaveCount(1);
        await row.click();
        await expect(cardOf(page)).toHaveClass(/prc--highlight/);
        await expect(cardOf(page).locator('.prc-side[data-side="user"] .prc-choice')).toBeFocused();
        // Its new version not said: nothing loads — the list follows the decision alone (its status no longer
        // answering: nothing else draws the overview again meanwhile).
        bridge.statusHang = true;
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user' } });
        await cardOf(page).locator('.prc-side[data-side="user"] .prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'kept');
        await expect(ov.locator('.research-overview__knows-row.is-conflict')).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.research!.conflicts![0].status)).toBe('open');
    });
});

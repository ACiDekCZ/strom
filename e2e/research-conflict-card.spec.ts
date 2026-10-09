import { test, expect, Page } from '@playwright/test';
import { UUID, FakeBridge, links } from './research-bridge.js';
import { DecideRoute, setupConflict, openKnows, cardOf, side, boxes, partBoxes, token } from './research-conflict.js';

/**
 * A conflict made by an edit in the app, decided by a side in "What the
 * research knows": the two sides with their choices, and every state of the
 * card against a bridge answered by page.route — deciding, kept, taken,
 * decided elsewhere, gone, the errors with "Try again", sending first; by a
 * link without the bridge's conflict.decide; not on this device. A conflict
 * of the sources keeps its table and says why there is no choice.
 * Invented data only.
 */

/** Jan: born 1865 here; the research has 3 FEB 1865 from its register — a conflict of his edit — and a conflict of two sources about his death. */
async function setup(page: Page, opts: { features?: string[] | null; linkList?: string[] } = {}): Promise<{ bridge: FakeBridge | null; decide: DecideRoute }> {
    const { bridge, decide } = await setupConflict(page, {
        opened: { sourcesDeath: true, ...(opts.linkList ? { links: opts.linkList } : {}) },
        ...(opts.features ? { features: opts.features } : {}),
        bridge: opts.features !== null,
    });
    return { bridge: opts.features === null ? null : bridge, decide };
}

test.describe('a conflict decided by a side in the app', () => {
    test.use({ locale: 'en-US' });

    test('the two sides side by side, each its choice and sentence; the links quieter under the line; a conflict of the sources keeps its table', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setup(page);
        await openKnows(page);
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'open');
        await expect(c.locator('.person-research-open-tag')).toHaveText('Open');
        // From the app first (also for a reader), then in the research.
        await expect(c.locator('.prc-side-label')).toHaveText(['From the app', 'In the research']);
        await expect(side(page, 'user').locator('.prc-value')).toHaveText('1865');
        await expect(side(page, 'user').locator('.prc-meta')).toHaveText('edit in the app');
        await expect(side(page, 'research').locator('.prc-value')).toHaveText(/^(?!3 FEB).*1865$/);
        await expect(side(page, 'research').locator('.prc-source')).toHaveText('Oddací matrika Čáslav');
        const keep = side(page, 'user').locator('.prc-choice');
        const take = side(page, 'research').locator('.prc-choice');
        await expect(keep).toHaveText('Keep the value from the app');
        await expect(take).toHaveText("Take the research's value");
        await expect(keep).toBeEnabled();
        await expect(take).toBeEnabled();
        await expect(keep).toHaveAttribute('aria-describedby', 'prc-note-X0007-user');
        await expect(page.locator('#prc-note-X0007-user')).toHaveText("The research writes the value from the app; the record's value stays in its history with the reason.");
        await expect(page.locator('#prc-note-X0007-research')).toHaveText("The value here changes to the research's. A backup is saved first.");
        // Side by side on a computer.
        const [a, b] = await boxes(c.locator('.prc-side'));
        expect(Math.abs(a.y - b.y)).toBeLessThan(1);
        expect(b.x).toBeGreaterThan(a.x + a.width);
        await expect(c.locator('.prc-links [data-do="decide"]')).toHaveText('Decide in the research ↗');
        await expect(c.locator('.prc-links [data-do="agent"]')).toBeVisible();
        expect(await c.locator('.prc-links').evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('solid');

        // The conflict of two sources: today's table and why there is no choice.
        const other = page.locator('#person-research-modal .person-research-conflict:not([data-conflict-card])');
        await expect(other.locator('tbody td:first-child')).toHaveText(['1931', '1932']);
        await expect(other.locator('.person-research-sources-only')).toHaveText('The sources disagree here; this is decided in the research.');
        await expect(other.locator('.prc-choice')).toHaveCount(0);
    });

    test('keep: deciding (the other choice off, a second click asks nothing), then kept — the tree unchanged', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page);
        await openKnows(page);
        let release!: () => void;
        decide.hold = new Promise<void>(r => { release = r; });
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user', head: 'abc1234', written: 'E0102', person: 'P0003' } });
        const before = await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons));
        await side(page, 'user').locator('.prc-choice').click();
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'busy');
        await expect(c.locator('.prc-tag--busy')).toHaveText('Deciding');
        const keep = side(page, 'user').locator('.prc-choice');
        await expect(keep).toHaveAttribute('aria-busy', 'true');
        await expect(keep).toHaveText('Deciding in the research…');
        await expect(side(page, 'research').locator('.prc-choice')).toBeDisabled();
        await expect(c.locator('.prc-links')).toHaveCount(0);
        await keep.click({ force: true });
        await keep.dblclick({ force: true });
        expect(decide.asks).toEqual([{ id: 'X0007', body: { do: 'decide', take: 'user' } }]);
        release();
        await expect(c).toHaveAttribute('data-state', 'kept');
        await expect(c.locator('.prc-tag--done')).toHaveText('Decided');
        await expect(c.locator('.prc-decided-row')).toHaveText(/Valid\s*1865\s*from the app/);
        await expect(c.locator('.prc-decided-line')).toHaveText(/^Decided in the app .+, \d{1,2}:\d{2}( [AP]M)?\. The research wrote the value from the app; .*1865 from the record stays in its history with the reason\.$/);
        await expect(c.locator('.prc-choice, .prc-links')).toHaveCount(0);
        expect(decide.asks).toHaveLength(1);
        expect(await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons))).toBe(before);
        // The keyboard stayed in the card.
        expect(await page.evaluate(() => document.activeElement?.closest('[data-conflict-card]')?.getAttribute('data-conflict-card'))).toBe('X0007');
    });

    test('take: decided for the research\'s value — the decided block with its source (its version loads: research-conflict-decide-load.spec.ts)', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page);
        await openKnows(page);
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'research', head: 'abc1234', written: '', person: 'P0003' } });
        await side(page, 'research').locator('.prc-choice').click();
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'taken');
        await expect(c.locator('.prc-decided-row')).toHaveText(/Valid\s*.*1865\s*in the research · Oddací matrika Čáslav/);
        expect(decide.asks).toEqual([{ id: 'X0007', body: { do: 'decide', take: 'research' } }]);
    });

    test('errors: busy, locked, no answer — the error row; "Try again" asks the same side; the choices stay on', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page);
        await openKnows(page);
        const c = cardOf(page);
        decide.replies.push({ status: 409, body: { error: 'busy', code: 'busy' } });
        await side(page, 'research').locator('.prc-choice').click();
        await expect(c).toHaveAttribute('data-state', 'error');
        await expect(c.locator('.prc-notice--error .prc-notice-text')).toHaveText('The research is writing a send right now; the decision did not go through.');
        await expect(side(page, 'user').locator('.prc-choice')).toBeEnabled();
        await expect(side(page, 'research').locator('.prc-choice')).toBeEnabled();
        await expect(c.locator('.prc-links')).toBeVisible();

        decide.replies.push({ status: 423, body: { error: 'locked', code: 'locked' } });
        await c.locator('.prc-notice-action').click();
        await expect(c.locator('.prc-notice--error .prc-notice-text')).toHaveText('The tree in the research is locked by another session; the decision did not go through.');

        decide.replies.push({ status: 0, abort: true });
        await c.locator('.prc-notice-action').click();
        await expect(c.locator('.prc-notice--error .prc-notice-text')).toHaveText('The research did not answer; the decision did not go through.');
        await expect(c.locator('.prc-notice-action')).toHaveText('Try again');
        expect(decide.asks.map(a => a.body)).toEqual([
            { do: 'decide', take: 'research' }, { do: 'decide', take: 'research' }, { do: 'decide', take: 'research' },
        ]);
    });

    test('decided elsewhere meanwhile (409 conflict.decided): said, with the decision', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page);
        await openKnows(page);
        const c = cardOf(page);
        decide.replies.push({ status: 409, body: { error: 'decided', code: 'conflict.decided', resolution: '3 FEB 1865 (S0001)', take: 'research' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(c).toHaveAttribute('data-state', 'elsewhere');
        await expect(c.locator('.prc-notice--info')).toHaveText('Already decided in the research: 3 FEB 1865 (S0001)');
        await expect(c.locator('.prc-tag--done')).toHaveText('Decided');
        await expect(c.locator('.prc-decided-row')).toHaveText(/Valid\s*.*1865\s*in the research · Oddací matrika Čáslav/);
        await expect(c.locator('.prc-choice')).toHaveCount(0);
    });

    test('gone (404 conflict.none): the card goes, the rest of the dialog stays', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page);
        await openKnows(page);
        const c = cardOf(page);
        decide.replies.push({ status: 404, body: { error: 'none', code: 'conflict.none' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(c).toHaveCount(0);
        // The rest of the dialog stays.
        await expect(page.locator('#person-research-modal .person-research-sources-only')).toBeVisible();
    });

    test('sending first: the birth date edited after the send — the choices off, the value now and what the research has; "Send" sends', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { bridge, decide } = await setup(page);
        // The tree as the research had it is kept (read once; the dialog follows when it is).
        await page.evaluate(() => window.Strom.UI.researchChangesReady());
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = dm.getAllPersons().find(p => p.firstName === 'Jan')!;
            dm.updatePerson(jan.id, { birthDate: '1866' });
        });
        await openKnows(page);
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'sendFirst');
        await expect(c.locator('.prc-notice--warn .prc-notice-text')).toHaveText('The value here changed after it was sent. Sending comes first, then the decision.');
        await expect(side(page, 'user').locator('.prc-value')).toHaveText('1866');
        await expect(side(page, 'user').locator('.prc-meta')).toHaveText(/^edited .+, not sent$/);
        await expect(side(page, 'user').locator('.prc-knows')).toHaveText('the research has 1865');
        await expect(side(page, 'user').locator('.prc-choice')).toBeDisabled();
        await expect(side(page, 'research').locator('.prc-choice')).toBeDisabled();
        await expect(c.locator('.prc-note')).toHaveCount(0);
        await expect(c.locator('.prc-links')).toBeVisible();
        await c.locator('.prc-notice-action').click();
        await expect.poll(() => bridge!.posts.length).toBe(1);
        expect(bridge!.posts[0]).toContain('1866');
        expect(decide.asks).toHaveLength(0);

        // Back at the value as sent: the choices are on again.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = dm.getAllPersons().find(p => p.firstName === 'Jan')!;
            dm.updatePerson(jan.id, { birthDate: '1865' });
            window.Strom.UI.refreshResearchSyncUi();
        });
        await expect(c).toHaveAttribute('data-state', 'open');
        await expect(side(page, 'user').locator('.prc-choice')).toBeEnabled();
    });

    test('no bridge deciding (an older research): the choices are links with ↗ and a note; the card stays', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page, { features: [] });
        await openKnows(page);
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'link');
        await expect(side(page, 'user').locator('.prc-choice')).toHaveText('Keep the value from the app ↗');
        await expect(side(page, 'research').locator('.prc-choice')).toHaveText("Take the research's value ↗");
        await expect(c.locator('.prc-link-note')).toHaveText('Opens the research; it only asks to confirm.');
        await side(page, 'user').locator('.prc-choice').click();
        await side(page, 'research').locator('.prc-choice').click();
        expect(await links(page)).toEqual([
            `strom-research://conflict?tree=${UUID}&id=X0007&do=decide&take=user`,
            `strom-research://conflict?tree=${UUID}&id=X0007&do=decide&take=research`,
        ]);
        await expect(c).toHaveAttribute('data-state', 'link');
        expect(decide.asks).toHaveLength(0);
    });

    test('not on this device (no bridge, no link): the sides without choices, "Decided on the computer with the research."', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setup(page, { features: null, linkList: ['send', 'open', 'live', 'app', 'setup'] });
        await openKnows(page);
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'none');
        await expect(c.locator('.prc-notice--info')).toHaveText('Decided on the computer with the research.');
        await expect(c.locator('.prc-side-label')).toHaveText(['From the app', 'In the research']);
        await expect(c.locator('.prc-choice, .prc-note, .prc-links')).toHaveCount(0);
    });

    test('dark theme: the decided tag and the error row in the dark tokens', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page);
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await openKnows(page);
        decide.replies.push({ status: 423, body: { code: 'locked' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(cardOf(page).locator('.prc-notice--error')).toBeVisible();
        expect(await cardOf(page).locator('.prc-notice--error').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--danger-soft'));
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user', head: '' } });
        await cardOf(page).locator('.prc-notice-action').click();
        await expect(cardOf(page).locator('.prc-tag--done')).toBeVisible();
        expect(await cardOf(page).locator('.prc-tag--done').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--primary-soft'));
    });
});

test.describe('the card drawn once', () => {
    test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

    test('drawn again with nothing changed, the card stays the same node: the keyboard and a reader stay where they were', async ({ page }) => {
        await setup(page);
        // The dialog drawn and, before anything else happens, its cards drawn again from the data now (what the
        // research's version read for the sentence under Take does a moment after opening, as the status poll does).
        const same = await page.evaluate(() => {
            const ui = window.Strom.UI;
            ui.runPersonMenuAction(window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id, 'research-knows');
            const first = document.querySelector('[data-conflict-card="X0007"]');
            first?.querySelector<HTMLElement>('.prc-side[data-side="research"] .prc-choice')?.focus();
            ui.refreshResearchConflictCards();
            ui.refreshResearchConflictCards('X0007');
            return !!first && document.querySelector('[data-conflict-card="X0007"]') === first;
        });
        expect(same).toBe(true);
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'open');
        await expect(c.locator('.prc-side[data-side="research"] .prc-choice')).toBeFocused();
        // A change of its state draws it anew.
        await c.evaluate(el => { (el as HTMLElement & { __mark?: boolean }).__mark = true; });
        await page.evaluate(() => window.Strom.UI.setResearchConflictCardState('X0007', { kind: 'error', take: 'user', error: 'locked' }));
        await expect(c).toHaveAttribute('data-state', 'error');
        expect(await c.evaluate(el => !!(el as HTMLElement & { __mark?: boolean }).__mark)).toBe(false);
    });
});

test.describe('a conflict decided by a side: phones and tablets', () => {
    test.use({ locale: 'en-US' });

    // The sides and their parts are read in one go (boxes): the card is drawn again once the
    // research's version is read for the sentence under Take, and two separate reads could straddle it.
    test('phone (360 px) with the bridge: the sides one under the other, 44 px choices', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await setup(page);
        await openKnows(page);
        const [a, b] = await boxes(cardOf(page).locator('.prc-side'));
        expect(b.y).toBeGreaterThan(a.y + a.height - 1);
        for (const box of await boxes(cardOf(page).locator('.prc-choice'))) {
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.x + box.width).toBeLessThanOrEqual(360);
        }
    });

    test('phone held sideways (844 × 390): the sides side by side', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        await setup(page);
        await openKnows(page);
        const [a, b] = await boxes(cardOf(page).locator('.prc-side'));
        expect(Math.abs(a.y - b.y)).toBeLessThan(1);
        expect(b.x).toBeGreaterThan(a.x + a.width);
    });

    test.describe('a touch phone', () => {
        test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

        test('no research here: the sides as a compact table, the notice under them, no links', async ({ page }) => {
            await setup(page, { features: null });
            await openKnows(page);
            const c = cardOf(page);
            await expect(c).toHaveAttribute('data-state', 'none');
            await expect(c.locator('.prc-choice, .prc-links, [data-conflict]')).toHaveCount(0);
            const [sides, notice, label, value] = await partBoxes(c, ['.prc-sides', '.prc-notice', '.prc-side[data-side="user"] .prc-side-label', '.prc-side[data-side="user"] .prc-value']);
            expect(notice.y).toBeGreaterThanOrEqual(sides.y + sides.height - 1);
            // Label and value on one row.
            expect(value.x).toBeGreaterThan(label.x + label.width);
        });
    });

    test.describe('a touch tablet', () => {
        test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

        test('not the research\'s computer: the sides still side by side, without choices or links', async ({ page }) => {
            await setup(page);
            await openKnows(page);
            const c = cardOf(page);
            await expect(c).toHaveAttribute('data-state', 'none');
            await expect(c.locator('.prc-notice--info')).toHaveText('Decided on the computer with the research.');
            const [a, b] = await boxes(c.locator('.prc-side'));
            expect(Math.abs(a.y - b.y)).toBeLessThan(1);
            // Over 640 px the notice stays above the sides.
            const [notice] = await boxes(c.locator('.prc-notice'));
            expect(notice.y).toBeLessThan(a.y);
            await expect(c.locator('.prc-choice, .prc-links')).toHaveCount(0);
        });
    });
});

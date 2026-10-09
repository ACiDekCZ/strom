import { test, expect, Page } from '@playwright/test';
import { NEW_HEAD } from './research-bridge.js';
import {
    Reply, Version, conflictOf, setupConflict, openKnows, openEdit, editJosef, cardOf, side, tag, panel, choice, partBoxes, overflowing, lowContrast,
} from './research-conflict.js';

/**
 * A conflict of an edit whose one side is empty: Jan's title before the name
 * deleted in the app (2 VAL with no text, 3 _STROM_SIDE user) while the
 * research's register has "MUDr.". Still decidable by a side: the empty side
 * shows a muted "(empty)" in the card, the panel and the phone's sheet;
 * Keep leaves the app as it is, Take brings the research's title; sending
 * comes first only when the field moved since the send (empty as sent is
 * no move). Invented data only.
 */

const deleted = (state: 'open' | 'decided' = 'open') => conflictOf('X0013', 'NPFX', 'MUDr.', '', undefined, state);
/** The research's file: Jan without a title (as the app sent him), the conflict about it. */
const OPENED: Version = { noBirthConflict: true, janConflicts: deleted() };
const reply = (take: 'user' | 'research', then: Version): Reply =>
    ({ status: 200, body: { decided: 'X0013', take, head: NEW_HEAD }, then: { head: NEW_HEAD, noBirthConflict: true, ...then } });

const janTitle = (page: Page) => page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.titleBefore ?? '');
const userValue = (page: Page) => side(page, 'user', 'X0013').locator('.prc-value');

test.describe('a value deleted on one side: still decidable', () => {
    test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

    test('the card: the app\'s side "(empty)", muted; Keep decides it, nothing changes here', async ({ page }) => {
        const { decide } = await setupConflict(page, { opened: OPENED });
        await editJosef(page);
        await openKnows(page);
        const c = cardOf(page, 'X0013');
        await expect(c).toHaveAttribute('data-state', 'open');
        await expect(userValue(page)).toHaveText('(empty)');
        await expect(userValue(page).locator('.prc-empty')).toHaveText('(empty)');
        expect(await userValue(page).locator('.prc-empty').evaluate(el => getComputedStyle(el).fontWeight)).toBe('400');
        await expect(side(page, 'research', 'X0013').locator('.prc-value')).toHaveText('MUDr.');
        await expect(side(page, 'user', 'X0013').locator('.prc-choice')).toBeEnabled();
        decide.replies.push(reply('user', { janConflicts: deleted('decided') }));
        await side(page, 'user', 'X0013').locator('.prc-choice').click();
        await expect(c).toHaveAttribute('data-state', 'kept');
        await expect(c.locator('.prc-decided-row .prc-value')).toHaveText('(empty)');
        await expect(page.locator('.toast').filter({ hasText: 'Conflict decided' })).toHaveText('Conflict decided: (empty)');
        expect(decide.asks).toEqual([{ id: 'X0013', body: { do: 'decide', take: 'user' } }]);
        expect(await janTitle(page)).toBe('');
    });

    test('the panel (at the given name, the titles folded away): "(empty)"; Take brings the research\'s title into the field', async ({ page }) => {
        const { decide } = await setupConflict(page, { opened: OPENED });
        await openEdit(page);
        const t = tag(page, 'input-firstname');
        await expect(t).toHaveAttribute('aria-label', 'Conflict · Title before name');
        await t.click();
        const p = panel(page);
        await expect(p.locator('.prc-panel-row[data-side="user"] .prc-panel-value .prc-empty')).toHaveText('(empty)');
        await expect(p.locator('.prc-panel-row[data-side="research"] .prc-panel-value')).toHaveText('MUDr.');
        decide.replies.push(reply('research', { janTitles: { npfx: 'MUDr.' }, janConflicts: deleted('decided') }));
        await choice(page, 'research').click();
        await expect.poll(() => janTitle(page)).toBe('MUDr.');
        await expect(p).toHaveCount(0);
        await expect(t).toHaveCount(0);
        await expect(page.locator('#input-title-before')).toHaveValue('MUDr.');
        expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(false);
        await expect(page.locator('.toast').filter({ hasText: 'Conflict decided' })).toHaveText('Conflict decided: MUDr.');
        expect(decide.asks).toEqual([{ id: 'X0013', body: { do: 'decide', take: 'research' } }]);
    });

    test('sending first: the field empty as sent is no move; a title typed after the send is, and deleted again it is not', async ({ page }) => {
        await setupConflict(page, { opened: OPENED });
        await page.evaluate(() => window.Strom.UI.researchChangesReady());
        await openKnows(page);
        const c = cardOf(page, 'X0013');
        await expect(c).toHaveAttribute('data-state', 'open');
        const setTitle = (v: string) => page.evaluate(v => {
            const dm = window.Strom.DataManager;
            dm.updatePerson(dm.getAllPersons().find(p => p.firstName === 'Jan')!.id, { titleBefore: v });
            window.Strom.UI.refreshResearchSyncUi();
        }, v);
        await setTitle('Ing.');
        await expect(c).toHaveAttribute('data-state', 'sendFirst');
        await expect(userValue(page)).toHaveText('Ing.');
        await expect(side(page, 'user', 'X0013').locator('.prc-knows')).toHaveText('the research has (empty)');
        await expect(side(page, 'user', 'X0013').locator('.prc-choice')).toBeDisabled();
        await setTitle('');
        await expect(c).toHaveAttribute('data-state', 'open');
        await expect(userValue(page).locator('.prc-empty')).toHaveText('(empty)');
        await expect(side(page, 'user', 'X0013').locator('.prc-choice')).toBeEnabled();
    });
});

test.describe('a value deleted on one side: a German phone', () => {
    test.use({ locale: 'de-DE', viewport: { width: 360, height: 740 } });

    test('phone (360 px): the card and the sheet show "(leer)" muted, nothing cut, the choices 44 px', async ({ page }) => {
        await setupConflict(page, { opened: OPENED });
        await openKnows(page);
        await expect(userValue(page).locator('.prc-empty')).toHaveText('(leer)');
        expect(await overflowing(cardOf(page, 'X0013'))).toEqual([]);
        await page.locator('#person-research-close').click();
        await openEdit(page);
        await tag(page, 'input-firstname').click();
        const p = panel(page);
        await expect(p).toHaveClass(/prc-panel--sheet/);
        await expect(p.locator('.prc-panel-row[data-side="user"] .prc-empty')).toHaveText('(leer)');
        expect(await overflowing(p)).toEqual([]);
        for (const b of await partBoxes(p, ['.prc-panel-row[data-side="user"] .prc-panel-choice', '.prc-panel-row[data-side="research"] .prc-panel-choice'])) {
            expect(b.height).toBeGreaterThanOrEqual(44);
        }
    });
});

test.describe('a value deleted on one side: both themes', () => {
    test.use({ locale: 'en-US' });

    for (const theme of ['dark', 'light'] as const) {
        test(`${theme} theme: "(empty)" readable in the card and the panel`, async ({ page }) => {
            await page.setViewportSize({ width: 1280, height: 900 });
            await setupConflict(page, { opened: OPENED });
            await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
            await openKnows(page);
            await expect(userValue(page).locator('.prc-empty')).toBeVisible();
            expect(await lowContrast(cardOf(page, 'X0013'))).toEqual([]);
            await page.locator('#person-research-close').click();
            await openEdit(page);
            await tag(page, 'input-firstname').click();
            await expect(panel(page).locator('.prc-empty')).toBeVisible();
            expect(await lowContrast(panel(page))).toEqual([]);
        });
    }
});

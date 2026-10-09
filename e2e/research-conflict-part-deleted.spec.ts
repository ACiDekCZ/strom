import { test, expect, Page } from '@playwright/test';
import { NEW_HEAD } from './research-bridge.js';
import {
    Reply, Version, conflictOf, setupConflict, openKnows, openEdit, cardOf, side, tag, panel, choice,
} from './research-conflict.js';

/**
 * A part of a documented fact deleted in the app, the fact itself kept: the
 * research opens a conflict decidable by a side whose app side is what is
 * left of the fact ("Lipnice" against "23. 10. 1865, Lipnice"), empty only
 * when nothing is left. Jan's death date deleted (its place kept), its place
 * deleted (the date kept), the couple's wedding date, Jan's occupation. Both
 * sides readable in the card and the panel; Keep leaves the app as it is;
 * Take brings the deleted part back with the research's version, quietly
 * (it is the decided value, not another change), into an open edit form too;
 * sending comes first when any part of the fact moved since the send.
 * Invented data only.
 */

const DATE_GONE = (state: 'open' | 'decided' = 'open') => conflictOf('X0011', 'DEAT', '23. 10. 1865, Lipnice', 'Lipnice', undefined, state);
const PLACE_GONE = (state: 'open' | 'decided' = 'open') => conflictOf('X0012', 'DEAT', '23. 10. 1865, Lipnice', '23. 10. 1865', undefined, state);
const WEDDING_GONE = (state: 'open' | 'decided' = 'open') => conflictOf('X0009', 'MARR', '12. 2. 1840, Lipnice', 'Lipnice', undefined, state);
const OCCU_GONE = (state: 'open' | 'decided' = 'open') => conflictOf('X0014', 'OCCU', 'weaver, 1865', '1865', undefined, state);
const OCCU_ALL_GONE = (state: 'open' | 'decided' = 'open') => conflictOf('X0015', 'OCCU', 'weaver', '', undefined, state);

/** The research's file as the app sent Jan: his death without its date, the place kept; the conflict about it. */
const DATE_OPENED: Version = { noBirthConflict: true, janDeath: '', janDeathPlace: 'Lipnice', janConflicts: DATE_GONE() };
const reply = (id: string, take: 'user' | 'research', then: Version, family?: string): Reply =>
    ({ status: 200, body: { decided: id, take, head: NEW_HEAD, ...(family ? { family } : {}) }, then: { head: NEW_HEAD, noBirthConflict: true, ...then } });

const jan = (page: Page) => page.evaluate(() => {
    const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Jan')!;
    return { deathDate: p.deathDate ?? '', deathPlace: p.deathPlace ?? '', occupation: (p.events ?? []).filter(e => e.type === 'occupation').map(e => [e.note ?? '', e.date ?? '']) };
});
const wedding = (page: Page) => page.evaluate(() => {
    const u = Object.values(window.Strom.DataManager.getData().partnerships)[0];
    return { date: u.startDate ?? '', place: u.startPlace ?? '' };
});
const value = (page: Page, which: 'user' | 'research', id: string) => side(page, which, id).locator('.prc-value');
const toast = (page: Page) => page.locator('.toast').filter({ hasText: 'Conflict decided' });
const setJan = (page: Page, over: Record<string, string>) => page.evaluate(over => {
    const dm = window.Strom.DataManager;
    dm.updatePerson(dm.getAllPersons().find(p => p.firstName === 'Jan')!.id, over);
    window.Strom.UI.refreshResearchSyncUi();
}, over);

test.describe('a part of a documented fact deleted in the app', () => {
    test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

    test('the death date deleted, the place kept: both sides readable; Keep decides it and nothing changes here', async ({ page }) => {
        const { decide } = await setupConflict(page, { opened: DATE_OPENED });
        await openKnows(page);
        const c = cardOf(page, 'X0011');
        await expect(c).toHaveAttribute('data-state', 'open');
        await expect(value(page, 'user', 'X0011')).toHaveText('Lipnice');
        await expect(value(page, 'research', 'X0011')).toHaveText('23. 10. 1865, Lipnice');
        await expect(side(page, 'user', 'X0011').locator('.prc-choice')).toBeEnabled();
        await expect(side(page, 'research', 'X0011').locator('.prc-choice')).toBeEnabled();
        decide.replies.push(reply('X0011', 'user', { janDeath: '', janDeathPlace: 'Lipnice', janConflicts: DATE_GONE('decided') }));
        await side(page, 'user', 'X0011').locator('.prc-choice').click();
        await expect(c).toHaveAttribute('data-state', 'kept');
        await expect(toast(page)).toHaveText('Conflict decided: Lipnice');
        expect(decide.asks).toEqual([{ id: 'X0011', body: { do: 'decide', take: 'user' } }]);
        expect(await jan(page)).toMatchObject({ deathDate: '', deathPlace: 'Lipnice' });
    });

    test('the death date deleted: Take brings the date back quietly (the decided value, no Load dialog); the card says what was here', async ({ page }) => {
        const { decide } = await setupConflict(page, { opened: DATE_OPENED });
        await openKnows(page);
        decide.replies.push(reply('X0011', 'research', { janDeath: '23 OCT 1865', janDeathPlace: 'Lipnice', janConflicts: DATE_GONE('decided') }));
        await side(page, 'research', 'X0011').locator('.prc-choice').click();
        await expect.poll(() => jan(page)).toMatchObject({ deathDate: '1865-10-23', deathPlace: 'Lipnice' });
        await expect(toast(page)).toHaveText('Conflict decided: 23. 10. 1865, Lipnice');
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        const c = cardOf(page, 'X0011');
        await expect(c).toHaveAttribute('data-state', 'taken');
        await expect(c.locator('.prc-decided-line')).toHaveText(/^The value here changed from Lipnice\. /);
        expect(decide.asks).toEqual([{ id: 'X0011', body: { do: 'decide', take: 'research' } }]);
    });

    test('sending first over the whole fact: the deleted date typed again after the send asks to send first; deleted again it does not', async ({ page }) => {
        await setupConflict(page, { opened: DATE_OPENED });
        await page.evaluate(() => window.Strom.UI.researchChangesReady());
        await openKnows(page);
        const c = cardOf(page, 'X0011');
        await expect(c).toHaveAttribute('data-state', 'open');
        await setJan(page, { deathDate: '1865-10-23' });
        await expect(c).toHaveAttribute('data-state', 'sendFirst');
        await expect(side(page, 'user', 'X0011').locator('.prc-choice')).toBeDisabled();
        // The value here now: the whole fact, as the research says its side.
        await expect(value(page, 'user', 'X0011')).toHaveText(/1865.*, Lipnice$/);
        await expect(side(page, 'user', 'X0011').locator('.prc-knows')).toHaveText('the research has Lipnice');
        await setJan(page, { deathDate: '' });
        await expect(c).toHaveAttribute('data-state', 'open');
        await expect(value(page, 'user', 'X0011')).toHaveText('Lipnice');
        await expect(side(page, 'user', 'X0011').locator('.prc-choice')).toBeEnabled();
    });

    test('the edit form: "conflict ›" at the death date (the part deleted); Take in the panel brings the date into the open form', async ({ page }) => {
        const { decide } = await setupConflict(page, { opened: DATE_OPENED });
        await openEdit(page);
        await expect(tag(page, 'input-deathplace')).toHaveCount(0);
        const t = tag(page, 'input-deathdate');
        await t.click();
        const p = panel(page);
        await expect(p.locator('.prc-panel-row[data-side="user"] .prc-panel-value')).toHaveText('Lipnice');
        await expect(p.locator('.prc-panel-row[data-side="research"] .prc-panel-value')).toHaveText('23. 10. 1865, Lipnice');
        decide.replies.push(reply('X0011', 'research', { janDeath: '23 OCT 1865', janDeathPlace: 'Lipnice', janConflicts: DATE_GONE('decided') }));
        await choice(page, 'research').click();
        await expect.poll(() => jan(page)).toMatchObject({ deathDate: '1865-10-23' });
        await expect(p).toHaveCount(0);
        await expect(t).toHaveCount(0);
        await expect(page.locator('#input-deathdate')).toHaveValue(/1865/);
        await expect(page.locator('#input-deathplace')).toHaveValue('Lipnice');
        expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(false);
    });

    test('the death place deleted, the date kept: the tag at the place; Take brings the place back quietly', async ({ page }) => {
        const opened: Version = { noBirthConflict: true, janDeath: '23 OCT 1865', janConflicts: PLACE_GONE() };
        const { decide } = await setupConflict(page, { opened });
        await openEdit(page);
        await expect(tag(page, 'input-deathdate')).toHaveCount(0);
        await expect(tag(page, 'input-deathplace')).toBeVisible();
        await page.locator('#person-modal .pm-header .close-btn').click();
        await openKnows(page);
        await expect(value(page, 'user', 'X0012')).toHaveText('23. 10. 1865');
        await expect(value(page, 'research', 'X0012')).toHaveText('23. 10. 1865, Lipnice');
        decide.replies.push(reply('X0012', 'research', { janDeath: '23 OCT 1865', janDeathPlace: 'Lipnice', janConflicts: PLACE_GONE('decided') }));
        await side(page, 'research', 'X0012').locator('.prc-choice').click();
        await expect.poll(() => jan(page)).toMatchObject({ deathDate: '1865-10-23', deathPlace: 'Lipnice' });
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        await expect(toast(page)).toHaveText('Conflict decided: 23. 10. 1865, Lipnice');
    });

    test('the couple\'s wedding date deleted, the place kept: decidable at both partners; Take brings the date back quietly', async ({ page }) => {
        const opened: Version = { noBirthConflict: true, weddingPlace: 'Lipnice', familyConflicts: WEDDING_GONE() };
        const { decide } = await setupConflict(page, { opened });
        await openKnows(page, 'Josef');
        await expect(value(page, 'user', 'X0009')).toHaveText('Lipnice');
        await expect(value(page, 'research', 'X0009')).toHaveText('12. 2. 1840, Lipnice');
        await expect(side(page, 'research', 'X0009').locator('.prc-choice')).toBeEnabled();
        await page.locator('#person-research-close').click();
        await openKnows(page, 'Anna');
        await expect(cardOf(page, 'X0009')).toHaveAttribute('data-state', 'open');
        decide.replies.push(reply('X0009', 'research', { wedding: '12 FEB 1840', weddingPlace: 'Lipnice', familyConflicts: WEDDING_GONE('decided') }, 'F0001'));
        await side(page, 'research', 'X0009').locator('.prc-choice').click();
        await expect.poll(() => wedding(page)).toEqual({ date: '1840-02-12', place: 'Lipnice' });
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        await expect(toast(page)).toHaveText('Conflict decided: 12. 2. 1840, Lipnice');
    });

    test('an occupation\'s value deleted, its date kept: decidable; Take brings the occupation back quietly', async ({ page }) => {
        const opened: Version = { noBirthConflict: true, janFacts: ['1 OCCU', '2 DATE 1865'], janConflicts: OCCU_GONE() };
        const { decide } = await setupConflict(page, { opened });
        expect((await jan(page)).occupation).toEqual([['', '1865']]);
        await openKnows(page);
        await expect(value(page, 'user', 'X0014')).toHaveText('1865');
        await expect(value(page, 'research', 'X0014')).toHaveText('weaver, 1865');
        await expect(side(page, 'research', 'X0014').locator('.prc-choice')).toBeEnabled();
        decide.replies.push(reply('X0014', 'research', { janFacts: ['1 OCCU weaver', '2 DATE 1865'], janConflicts: OCCU_GONE('decided') }));
        await side(page, 'research', 'X0014').locator('.prc-choice').click();
        await expect.poll(async () => (await jan(page)).occupation).toEqual([['weaver', '1865']]);
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        await expect(toast(page)).toHaveText('Conflict decided: weaver, 1865');
    });

    test('an occupation with nothing left: the app\'s side "(empty)"; Keep decides it and nothing changes here', async ({ page }) => {
        const opened: Version = { noBirthConflict: true, janConflicts: OCCU_ALL_GONE() };
        const { decide } = await setupConflict(page, { opened });
        const before = await jan(page);
        await openKnows(page);
        await expect(value(page, 'user', 'X0015').locator('.prc-empty')).toHaveText('(empty)');
        await expect(value(page, 'research', 'X0015')).toHaveText('weaver');
        decide.replies.push(reply('X0015', 'user', { janConflicts: OCCU_ALL_GONE('decided') }));
        await side(page, 'user', 'X0015').locator('.prc-choice').click();
        await expect(cardOf(page, 'X0015')).toHaveAttribute('data-state', 'kept');
        await expect(toast(page)).toHaveText('Conflict decided: (empty)');
        expect(await jan(page)).toEqual(before);
    });
});

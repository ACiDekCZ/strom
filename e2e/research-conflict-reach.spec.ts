import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';
import { BRIDGE, openResearchMenu, block } from './research-bridge.js';
import {
    TAKE_200, setupConflict, openKnows, openEdit, cardOf, side, tag, panel, choice, activeId, token, partBoxes, overflowing, lowContrast,
    writtenWithConflict,
} from './research-conflict.js';

/**
 * A conflict decidable by a side for everyone: the German and Czech texts
 * fitting a 360 px phone (the card, the sheet, the popover, the Research
 * menu's line), every state of the card and the panel readable in the dark
 * theme and in the light one, the reading order and the descriptions of the
 * choices, the keyboard alone through the panel and the card, and the ways to
 * the card on a phone and a tablet ("Show" in the narrow window's More sheet,
 * the overview's row, the ≠ from the touch sheet). Invented data only.
 */

const VALUES = { user: '1865', research: '3. 2. 1865', source: 'Oddací matrika Čáslav' };
/** The card's states set directly (how each comes about: research-conflict-card / -decide-load specs). */
const STATES: [string, unknown][] = [
    ['open', null],
    ['busy', { kind: 'busy', take: 'research' }],
    ['error', { kind: 'error', take: 'user', error: 'locked' }],
    ['noEdit', { kind: 'error', take: 'user', error: 'noEdit' }],
    ['kept', { kind: 'kept', at: Date.UTC(2026, 9, 9, 12, 30), values: VALUES }],
    ['elsewhere', { kind: 'elsewhere', resolution: '3 FEB 1865 (S0001)', take: 'research', values: VALUES }],
    ['takenPending', { kind: 'takenPending', values: VALUES }],
];
/** The panel shows only the undecided ones (decided, it closes). */
const PANEL_STATES = STATES.filter(([name]) => ['open', 'busy', 'error', 'noEdit'].includes(name));

async function setState(page: Page, state: unknown): Promise<void> {
    await page.evaluate(s => window.Strom.UI.setResearchConflictCardState('X0007', s as never), state);
}

/** Jan's birth date edited after the send: sending comes first. */
async function editedAfterSend(page: Page): Promise<void> {
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.updatePerson(dm.getAllPersons().find(p => p.firstName === 'Jan')!.id, { birthDate: '1866' });
        window.Strom.UI.refreshResearchSyncUi();
    });
}

/** The research's version brings one more change: the sentence under Take is its longest. */
const MORE = { janBirth: '3 FEB 1865', janDeath: '1933' };
/** The sentence under Take once the research's version is read ("… 1 more change …" in every language). */
const longNote = (page: Page, id: string) => expect(page.locator(id)).toContainText('1');

for (const locale of ['de-DE', 'cs-CZ']) {
    test.describe(`${locale}: the texts fit a 360 px phone`, () => {
        test.use({ locale, viewport: { width: 360, height: 740 } });

        test('the card in every state: nothing cut, nothing wider than the window', async ({ page }) => {
            await setupConflict(page, { serving: MORE });
            await page.evaluate(() => window.Strom.UI.researchChangesReady());
            await openKnows(page);
            await longNote(page, '#prc-note-X0007-research');
            for (const [name, state] of STATES) {
                await setState(page, state);
                await expect(cardOf(page)).toHaveAttribute('data-state', name);
                expect(await overflowing(cardOf(page)), name).toEqual([]);
            }
            await setState(page, null);
            await editedAfterSend(page);
            await expect(cardOf(page)).toHaveAttribute('data-state', 'sendFirst');
            expect(await overflowing(cardOf(page)), 'sendFirst').toEqual([]);
        });

        test('the sheet in every state: nothing cut, the choices 44 px', async ({ page }) => {
            await setupConflict(page, { serving: MORE });
            await openEdit(page);
            await tag(page).click();
            await expect(panel(page)).toHaveClass(/prc-panel--sheet/);
            await longNote(page, '#prc-panel-note-research');
            for (const [name, state] of PANEL_STATES) {
                await setState(page, state);
                await expect(panel(page)).toHaveAttribute('data-state', name);
                expect(await overflowing(panel(page)), name).toEqual([]);
                for (const b of await partBoxes(panel(page), ['.prc-panel-row[data-side="user"] .prc-panel-choice', '.prc-panel-row[data-side="research"] .prc-panel-choice'])) {
                    expect(b.height).toBeGreaterThanOrEqual(44);
                }
            }
            await setState(page, null);
            await page.keyboard.press('Escape');
            await page.locator('#input-birthplace').fill('Kolín');
            await tag(page).click();
            await expect(panel(page)).toHaveAttribute('data-state', 'saveFirst');
            expect(await overflowing(panel(page)), 'saveFirst').toEqual([]);
        });

        test('by a link: the card\'s and the sheet\'s longer choices fit', async ({ page }) => {
            await setupConflict(page, { features: [] });
            await openKnows(page);
            await expect(cardOf(page)).toHaveAttribute('data-state', 'link');
            expect(await overflowing(cardOf(page))).toEqual([]);
            await page.locator('#person-research-close').click();
            await openEdit(page);
            await tag(page).click();
            await expect(panel(page)).toHaveAttribute('data-state', 'link');
            expect(await overflowing(panel(page))).toEqual([]);
        });

        test('the Research menu\'s line over "Show" (the More sheet): whom and what, whole, "Show" inside the window', async ({ page }) => {
            const { bridge, treeId } = await setupConflict(page);
            await writtenWithConflict(page, bridge, treeId);
            await openResearchMenu(page);
            const lead = block(page).locator('.research-sync-lead');
            await expect(lead).toBeVisible();
            await expect(lead).toHaveText(/^Jan Víšek · \S+/);
            expect(await overflowing(lead)).toEqual([]);
            const [b, l, show] = await partBoxes(block(page), [':scope', '.research-sync-lead', '[data-action="showConflict"]']);
            expect(l.x + l.width).toBeLessThanOrEqual(Math.min(360, b.x + b.width) + 0.5);
            expect(show.x).toBeGreaterThanOrEqual(0);
            expect(show.x + show.width).toBeLessThanOrEqual(360);
        });
    });

    test.describe(`${locale}: the popover on a tablet`, () => {
        test.use({ locale, viewport: { width: 820, height: 1180 } });

        test('every state fits the popover (400 px at most)', async ({ page }) => {
            await setupConflict(page, { serving: MORE });
            await openEdit(page);
            await tag(page).click();
            await expect(panel(page)).not.toHaveClass(/prc-panel--sheet/);
            await longNote(page, '#prc-panel-note-research');
            for (const [name, state] of PANEL_STATES) {
                await setState(page, state);
                await expect(panel(page)).toHaveAttribute('data-state', name);
                expect(await overflowing(panel(page)), name).toEqual([]);
            }
        });
    });
}

for (const theme of ['dark', 'light'] as const) {
    test.describe(`${theme} theme: every state readable`, () => {
        test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

        const dressed = async (page: Page) => page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);

        test('the card: open, deciding, an error, decided, decided elsewhere, waiting for its load, sending first', async ({ page }) => {
            await setupConflict(page);
            await dressed(page);
            await page.evaluate(() => window.Strom.UI.researchChangesReady());
            await openKnows(page);
            const c = cardOf(page);
            for (const [name, state] of STATES) {
                await setState(page, state);
                await expect(c).toHaveAttribute('data-state', name);
                expect(await lowContrast(c), name).toEqual([]);
            }
            if (theme === 'dark') {
                // In the dark tokens, not the light ones.
                await setState(page, { kind: 'busy', take: 'research' });
                expect(await c.locator('.prc-tag--busy').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--dir-icon-bg'));
                expect(await side(page, 'research').locator('.prc-choice').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--primary-soft'));
                await setState(page, { kind: 'takenPending', values: VALUES });
                expect(await c.locator('.prc-notice--info').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--info-soft'));
                await setState(page, null);
                expect(await side(page, 'user').locator('.prc-choice').evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await token(page, '--primary', 'color'));
            }
            await setState(page, null);
            await editedAfterSend(page);
            await expect(c).toHaveAttribute('data-state', 'sendFirst');
            expect(await lowContrast(c), 'sendFirst').toEqual([]);
            if (theme === 'dark') {
                expect(await c.locator('.prc-notice--warn').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--warning-soft'));
                expect(await c.locator('.prc-knows').evaluate(el => getComputedStyle(el).color)).toBe(await token(page, '--warning-text', 'color'));
            }
        });

        test('by a link: the card and the panel', async ({ page }) => {
            await setupConflict(page, { features: [] });
            await dressed(page);
            await openKnows(page);
            await expect(cardOf(page)).toHaveAttribute('data-state', 'link');
            expect(await lowContrast(cardOf(page)), 'card').toEqual([]);
            await page.locator('#person-research-close').click();
            await openEdit(page);
            await tag(page).click();
            await expect(panel(page)).toHaveAttribute('data-state', 'link');
            expect(await lowContrast(panel(page)), 'panel').toEqual([]);
        });

        test('not on this device: the card and the panel', async ({ page }) => {
            await setupConflict(page, { bridge: false, opened: { links: ['send', 'open', 'live', 'app', 'setup'] } });
            await dressed(page);
            await openKnows(page);
            await expect(cardOf(page)).toHaveAttribute('data-state', 'none');
            expect(await lowContrast(cardOf(page)), 'card').toEqual([]);
            if (theme === 'dark') expect(await cardOf(page).locator('.prc-notice--info').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--info-soft'));
            await page.locator('#person-research-close').click();
            await openEdit(page);
            await tag(page).click();
            await expect(panel(page)).toHaveAttribute('data-state', 'none');
            expect(await lowContrast(panel(page)), 'panel').toEqual([]);
        });

        test('the panel: open, deciding, an error, saving first, sending first', async ({ page }) => {
            await setupConflict(page);
            await dressed(page);
            await page.evaluate(() => window.Strom.UI.researchChangesReady());
            await openEdit(page);
            await tag(page).click();
            const p = panel(page);
            for (const [name, state] of PANEL_STATES) {
                await setState(page, state);
                await expect(p).toHaveAttribute('data-state', name);
                expect(await lowContrast(p), name).toEqual([]);
            }
            await setState(page, null);
            await page.keyboard.press('Escape');
            await page.locator('#person-modal').getByRole('button', { name: 'Cancel' }).click();
            await editedAfterSend(page);
            await openEdit(page);
            await tag(page).click();
            await expect(p).toHaveAttribute('data-state', 'sendFirst');
            expect(await lowContrast(p), 'sendFirst').toEqual([]);
            await page.keyboard.press('Escape');
            await page.locator('#input-birthplace').fill('Kolín');
            await tag(page).click();
            await expect(p).toHaveAttribute('data-state', 'saveFirst');
            expect(await lowContrast(p), 'saveFirst').toEqual([]);
            if (theme === 'dark') expect(await p.locator('.prc-notice--warn').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--warning-soft'));
        });

        test('the light on the card opened at: the outline in --primary, seen against the dialog (3:1)', async ({ page }) => {
            await setupConflict(page, { clock: true });
            await dressed(page);
            await card(page, 'Jan').locator('.card-signal').click();
            const c = cardOf(page);
            await expect(c).toHaveClass(/prc--highlight/);
            expect(await c.evaluate(el => getComputedStyle(el).outlineColor)).toBe(await token(page, '--primary', 'color'));
            const ratio = await c.evaluate(el => {
                const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
                const lum = (c: number[]) => {
                    const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
                };
                let bg: Element | null = el.parentElement;
                while (bg && (parse(getComputedStyle(bg).backgroundColor)[3] ?? 1) === 0) bg = bg.parentElement;
                const a = lum(parse(getComputedStyle(el).outlineColor));
                const b = lum(parse(getComputedStyle(bg!).backgroundColor));
                return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            });
            expect(ratio).toBeGreaterThanOrEqual(3);
        });
    });
}

test.describe('a reader and the keyboard', () => {
    test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

    test('the panel is read in order: its title, the app\'s side with its choice and sentence, the research\'s with its source, choice and sentence, then "More…"', async ({ page }) => {
        await setupConflict(page);
        await openEdit(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toHaveAttribute('aria-labelledby', 'prc-panel-title');
        await expect(p).toMatchAriaSnapshot(`
            - dialog "Conflict · Birth":
              - heading "Conflict · Birth" [level=3]
              - button "Close": ×
              - text: From the app 1865
              - button "Keep the value from the app": Keep
              - paragraph: The research writes the value from the app; the record's value stays in its history with the reason.
              - text: /^In the research \\S*1865$/
              - button "Oddací matrika Čáslav"
              - button "Take the research's value": Take
              - paragraph: The value here changes to the research's. A backup is saved first.
              - button "More in What the research knows ›"
        `);
        // Each choice described by its sentence, in the panel.
        for (const which of ['user', 'research'] as const) {
            const described = await choice(page, which).getAttribute('aria-describedby');
            expect(described).toBe(`prc-panel-note-${which}`);
            await expect(p.locator(`#${described}`)).toHaveCount(1);
        }
        await expect(choice(page, 'user')).toHaveAccessibleDescription("The research writes the value from the app; the record's value stays in its history with the reason.");
        await expect(choice(page, 'research')).toHaveAccessibleDescription("The value here changes to the research's. A backup is saved first.");
    });

    test('the card is read in order, the sides one after the other; each choice described by its sentence', async ({ page }) => {
        await setupConflict(page);
        await openKnows(page);
        const c = cardOf(page);
        await expect(c).toMatchAriaSnapshot(`
            - text: Birth Open From the app 1865 edit in the app
            - button "Keep the value from the app"
            - paragraph: The research writes the value from the app; the record's value stays in its history with the reason.
            - text: /^In the research \\S*1865$/
            - button "Oddací matrika Čáslav"
            - button "Take the research's value"
            - paragraph: The value here changes to the research's. A backup is saved first.
            - button "Decide in the research ↗"
            - button "Leave it to the agent, AI, opens in the research": Leave it to the agent ↗
        `);
        await expect(side(page, 'user').locator('.prc-choice')).toHaveAccessibleDescription("The research writes the value from the app; the record's value stays in its history with the reason.");
        await expect(side(page, 'research').locator('.prc-choice')).toHaveAccessibleDescription("The value here changes to the research's. A backup is saved first.");
    });

    test('the keyboard alone through the panel: Enter on the tag, Tab around and back, Enter on Take — the field shows the value loaded', async ({ page }) => {
        const { decide } = await setupConflict(page, { serving: { janBirth: '3 FEB 1865' } });
        await openEdit(page);
        await tag(page).focus();
        await page.keyboard.press('Enter');
        await expect(panel(page)).toBeVisible();
        await expect(choice(page, 'user')).toBeFocused();
        const at = () => page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            return el?.closest('#prc-panel') ? (el.dataset.focus ?? '?') : `outside:${el?.id || el?.className}`;
        });
        const forward: string[] = [];
        for (let i = 0; i < 5; i++) {
            await page.keyboard.press('Tab');
            forward.push(await at());
        }
        expect(forward).toEqual(['source', 'choice-research', 'more', 'close', 'choice-user']);
        const back: string[] = [];
        for (let i = 0; i < 3; i++) {
            await page.keyboard.press('Shift+Tab');
            back.push(await at());
        }
        expect(back).toEqual(['close', 'more', 'choice-research']);
        decide.replies.push(TAKE_200({ janBirth: '3 FEB 1865' }));
        await page.keyboard.press('Enter');
        await expect(panel(page)).toHaveCount(0);
        await expect(page.locator('#input-birthdate')).not.toHaveValue('1865');
        expect(await activeId(page)).toBe('input-birthdate');
        expect(decide.asks).toEqual([{ id: 'X0007', body: { do: 'decide', take: 'research' } }]);
    });

    test('the keyboard alone through the card: Tab from Keep to the links, Space on Keep; the keyboard stays in the card, Esc closes', async ({ page }) => {
        const { decide } = await setupConflict(page);
        await page.evaluate(() => window.Strom.UI.openCardSignal(window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id, 'conflict'));
        const c = cardOf(page);
        await expect(side(page, 'user').locator('.prc-choice')).toBeFocused();
        const at = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.focus ?? '');
        const forward: string[] = [];
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press('Tab');
            forward.push(await at());
        }
        expect(forward).toEqual(['source', 'choice-research', 'link-decide', 'link-agent']);
        for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Tab');
        await expect(side(page, 'user').locator('.prc-choice')).toBeFocused();
        let release!: () => void;
        decide.hold = new Promise<void>(r => { release = r; });
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user' } });
        await page.keyboard.press('Space');
        await expect(c).toHaveAttribute('data-state', 'busy');
        await expect(side(page, 'user').locator('.prc-choice')).toBeFocused();
        release();
        await expect(c).toHaveAttribute('data-state', 'kept');
        expect(await page.evaluate(() => document.activeElement?.closest('[data-conflict-card]')?.getAttribute('data-conflict-card'))).toBe('X0007');
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
    });
});

test.describe('the ways to the card on a phone and a tablet', () => {
    test.use({ locale: 'en-US' });

    test('"Show" in the narrow window\'s More sheet: the dialog at the card, lit up', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        const { bridge, treeId } = await setupConflict(page, { clock: true });
        await writtenWithConflict(page, bridge, treeId);
        await openResearchMenu(page);
        await expect(block(page).locator('.research-sync-lead')).toHaveText('Jan Víšek · Birth');
        await block(page).locator('[data-action="showConflict"]').click();
        await expect(cardOf(page)).toHaveClass(/prc--highlight/);
        await expect(side(page, 'user').locator('.prc-choice')).toBeFocused();
        expect(await page.evaluate(() => window.Strom.UI.isResearchMenuOpen())).toBe(false);
    });

    for (const vp of [{ name: 'a tablet (overlay)', width: 820, height: 1180 }, { name: 'a phone (sheet)', width: 360, height: 740 }]) {
        test(`the overview's row on ${vp.name}: the dialog at the card, lit up`, async ({ page }) => {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await setupConflict(page, { clock: true });
            await page.route(`${BRIDGE}/events`, () => new Promise<void>(() => { /* never answers */ }));
            await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
            await page.evaluate(() => window.Strom.UI.openResearchOverview());
            const ov = page.locator('#research-overview');
            await expect(ov).toBeVisible();
            const knows = ov.locator('.live-section__head').filter({ has: page.locator('.live-section__title', { hasText: 'What the research knows' }) });
            if (await knows.getAttribute('aria-expanded') === 'false') await knows.click();
            const row = ov.locator('.research-overview__knows-row.is-conflict');
            await expect(row).toHaveCount(1);
            await row.click();
            await expect(cardOf(page)).toHaveClass(/prc--highlight/);
            await expect(side(page, 'user').locator('.prc-choice')).toBeFocused();
            // The dialog on top of the overview, the card in the window.
            const [cb] = await partBoxes(cardOf(page), [':scope']);
            expect(cb.x).toBeGreaterThanOrEqual(0);
            expect(cb.x + cb.width).toBeLessThanOrEqual(vp.width);
            const top = await cardOf(page).evaluate(el => {
                const r = el.getBoundingClientRect();
                return !!document.elementFromPoint(r.x + r.width / 2, r.y + 10)?.closest('[data-conflict-card]');
            });
            expect(top).toBe(true);
        });
    }

    test.describe('a touch phone', () => {
        test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

        test('the ≠ from the person sheet: the dialog at the card (not on this device), lit up', async ({ page }) => {
            await setupConflict(page, { clock: true });
            await card(page, 'Jan').tap();
            const sheet = page.locator('.bottom-sheet-overlay.active .bottom-sheet-person');
            await expect(sheet).toBeVisible();
            const signal = sheet.locator('.menu-signal-conflict');
            await expect(signal).toBeVisible();
            await signal.tap();
            await expect(cardOf(page)).toHaveClass(/prc--highlight/);
            await expect(cardOf(page)).toHaveAttribute('data-state', 'none');
            await expect(page.locator('.bottom-sheet-overlay.active')).toHaveCount(0);
        });
    });
});

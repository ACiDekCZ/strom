import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * The source viewer's citation bar and the removal toasts (spec 095 §2,
 * §3): opened from a fact's chip the viewer says where the citation stands
 * and why the first is first; "Mark as main" puts the ★ on the chip with a
 * toast and its Undo standing over the viewer; "Unmark main"; the only
 * citation without "Mark"; a locked person without buttons; a research that
 * says nothing about citations (no Mark, a note, the long sentence once);
 * removing from the bar and from a chip (the main one too) and Undo putting
 * it back with its ★; a shared event's toast; the bar and the toast at a
 * phone, a tablet, a desktop and a phone held sideways in German, light and
 * dark. Invented data.
 */

const SHOTS = process.env.STROM_SHOTS_DIR;

interface Opts {
    main?: boolean; locked?: boolean; research?: boolean; lang?: string; dark?: boolean;
    size?: { width: number; height: number };
}

async function tree(page: Page, opts: Opts = {}): Promise<void> {
    if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize(opts.size ?? { width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async ({ main, locked, research, lang }) => {
        const S = window.Strom;
        if (lang) S.UI.setLanguage(lang as never);
        S.SettingsManager.setAdvancedFields(true);
        const base = { gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };
        await S.DataManager.importAsNewTree({
            persons: {
                r: {
                    ...base, id: 'r', firstName: 'Dobromil', lastName: 'Ostružník',
                    birthDate: '1871-03-04', birthPlace: 'Vrbovec', deathDate: '1931-05-02',
                    // The list's own order: the census, the death record, the birth record.
                    birthSourceIds: ['s1', 's3', 's2'], deathSourceIds: ['s3'],
                    events: [{ id: 'ev_r', type: 'census', date: '1880', sourceIds: ['s1'], shareId: 'SHC1' }],
                    ...(main ? { citationMain: { birthSourceIds: 's3' } } : {}),
                    ...(locked ? { isLocked: true } : {}),
                },
                h: {
                    ...base, id: 'h', firstName: 'Libuna', lastName: 'Ostružníková', gender: 'female',
                    events: [{ id: 'ev_h', type: 'census', date: '1880', sourceIds: ['s1'], shareId: 'SHC1' }],
                },
            },
            partnerships: {},
            sources: {
                s1: { id: 's1', title: 'Sčítání lidu Vrbovec 1880', quality: 2 },
                s2: { id: 's2', title: 'Matrika N Vrbovec 1860–1890', quality: 3, events: ['BIRT'], recordDate: '1871-03-06' },
                s3: { id: 's3', title: 'Matrika Z Vrbovec 1900–1930', quality: 3, events: ['DEAT'] },
            },
        } as never, 'Ostružník');
        if (research) {
            // Linked to a research whose bridge has said nothing (an older one): no main citation, removals not taken.
            S.TreeManager.setResearchLink(S.DataManager.getCurrentTreeId()!,
                { id: '6f1c2a40-0b7e-4f5e-9a3d-2c41e8b7d901', fingerprint: '', syncedAt: new Date().toISOString() } as never);
        }
    }, { main: !!opts.main, locked: !!opts.locked, research: !!opts.research, lang: opts.lang });
}

const viewer = (page: Page) => page.locator('#source-viewer-modal');
const bar = (page: Page) => page.locator('#source-viewer-body .viewer-cite');
const pill = (page: Page) => page.locator('body > .undo-toast.show');
const birthChips = (page: Page) => page.locator('#birth-sources-group .source-chip');

async function openFromBirthChip(page: Page, title: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showEditPersonModal('r' as never));
    await birthChips(page).filter({ hasText: title }).locator('.source-chip-open').click();
    await expect(viewer(page)).toHaveClass(/active/);
}

const birth = (page: Page) => page.evaluate(() => {
    const p = window.Strom.DataManager.getPerson('r' as never)!;
    return { ids: p.birthSourceIds, main: (p as { citationMain?: Record<string, string> }).citationMain?.birthSourceIds };
});

test.describe('the citation bar in the source viewer', () => {
    test('the first citation says why; Mark as main: ★ on the chip, the toast over the viewer, Undo', { tag: '@smoke' }, async ({ page }) => {
        await tree(page);
        await openFromBirthChip(page, 'Matrika N');
        await expect(bar(page).locator('.viewer-cite-what')).toHaveText('Birth · Dobromil Ostružník');
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('1 of 3 citations · first because: the birth record, original');
        await page.locator('#source-viewer-modal .close-btn').first().click();

        await birthChips(page).filter({ hasText: 'Matrika Z' }).locator('.source-chip-open').click();
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('2 of 3 citations');
        const mark = bar(page).locator('.viewer-cite-main');
        await expect(mark).toHaveText('☆︎ Mark as main');
        await mark.click();
        await expect(bar(page)).toHaveClass(/is-main/);
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('★︎ Main citation for the birth');
        await expect(bar(page).locator('.viewer-cite-main')).toHaveText('Unmark main');
        await expect(bar(page).locator('.viewer-cite-main')).toBeFocused();
        expect(await birth(page)).toEqual({ ids: ['s1', 's3', 's2'], main: 's3' });
        // The chips behind: the main citation first, with its ★.
        await expect(birthChips(page).first()).toHaveClass(/is-main/);
        await expect(birthChips(page).first()).toContainText('Matrika Z');
        // The toast stands over the viewer, and its Undo takes a click there.
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Main citation for the birth: Matrika Z Vrbovec 1900–1930');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/2c-main-marked-1440.png` });
        await pill(page).locator('.undo-toast-btn').click();
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('2 of 3 citations');
        expect((await birth(page)).main).toBeUndefined();
        await expect(birthChips(page).first()).toContainText('Matrika N');
        // One history entry: nothing more to undo.
        expect(await page.evaluate(() => window.Strom.DataManager.canUndo())).toBe(false);
    });

    test('Unmark main: the order is automatic again, its toast; the focus on Mark as main', async ({ page }) => {
        await tree(page, { main: true });
        await openFromBirthChip(page, 'Matrika Z');
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('★︎ Main citation for the birth');
        await bar(page).locator('.viewer-cite-main').click();
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('2 of 3 citations');
        await expect(bar(page).locator('.viewer-cite-main')).toBeFocused();
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Main citation for the birth unmarked; the order is automatic again');
        expect((await birth(page)).main).toBeUndefined();
        // Ctrl+Z once the dialogs are closed: the mark back.
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
        await page.keyboard.press('ControlOrMeta+z');
        expect((await birth(page)).main).toBe('s3');
    });

    test('the only citation: no Mark as main; a locked person: the place, no buttons', async ({ page }) => {
        await tree(page);
        await page.evaluate(() => window.Strom.UI.showSourceViewer('s3', { personId: 'r' as never, fact: 'death' }));
        await expect(bar(page).locator('.viewer-cite-what')).toHaveText('Death · Dobromil Ostružník');
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('The only citation for the death');
        await expect(bar(page).locator('.viewer-cite-main')).toHaveCount(0);
        await expect(bar(page).locator('.viewer-cite-remove')).toHaveText('Remove citation');

        await tree(page, { main: true, locked: true });
        await page.evaluate(() => window.Strom.UI.showSourceViewer('s3', { personId: 'r' as never, fact: 'birth' }));
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('★︎ Main citation for the birth');
        await expect(bar(page).locator('button')).toHaveCount(0);
    });

    test('a research that says nothing of citations: no Mark, no ★, the note; the long sentence once, then the short tail', async ({ page }) => {
        await tree(page, { main: true, research: true });
        await page.evaluate(() => window.Strom.UI.showSourceViewer('s3', { personId: 'r' as never, fact: 'birth' }));
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('1 of 3 citations');
        await expect(bar(page).locator('.viewer-cite-main')).toHaveCount(0);
        await expect(bar(page)).not.toContainText('★');
        await expect(bar(page).locator('.viewer-cite-note')).toHaveText('The research does not take removals yet.');

        await bar(page).locator('.viewer-cite-remove').click();
        const toast = pill(page);
        await expect(toast).toHaveClass(/undo-toast-roomy/);
        await expect(toast.locator('.undo-toast-msg')).toHaveText(
            'Citation removed from the birth: Matrika Z Vrbovec 1900–1930 · the source staysThe research will not take this removal; the citation comes back when its version is loaded.');
        await expect(toast.locator('.undo-toast-note')).toBeVisible();
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/3d-older-research-first-1440.png` });

        await page.evaluate(() => window.Strom.UI.showSourceViewer('s1', { personId: 'r' as never, fact: 'birth' }));
        await bar(page).locator('.viewer-cite-remove').click();
        await expect(pill(page).locator('.undo-toast-msg'))
            .toHaveText('Citation removed from the birth: Sčítání lidu Vrbovec 1880 · the source stays · not taken by the research');
        await expect(pill(page).locator('.undo-toast-note')).toHaveCount(0);
    });

    test('Remove from the bar: "Unlinked …", the focus on the bar; Undo: the citation back in its place with ★', async ({ page }) => {
        await tree(page, { main: true });
        await openFromBirthChip(page, 'Matrika Z');
        await bar(page).locator('.viewer-cite-remove').click();
        await expect(bar(page)).toHaveClass(/is-gone/);
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('Unlinked from the birth · the source stays in the catalog');
        await expect(bar(page).locator('button')).toHaveCount(0);
        await expect(bar(page).locator('.viewer-cite-text')).toBeFocused();
        await expect(viewer(page)).toHaveClass(/active/);
        expect(await birth(page)).toEqual({ ids: ['s1', 's2'], main: undefined });
        await expect(birthChips(page)).toHaveCount(2);
        await expect(pill(page).locator('.undo-toast-msg'))
            .toHaveText('Citation removed from the birth, no longer main: Matrika Z Vrbovec 1900–1930 · the source stays');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/3g-removed-1440.png` });

        await pill(page).locator('.undo-toast-btn').click();
        await expect(bar(page)).toHaveClass(/is-main/);
        await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('★︎ Main citation for the birth');
        expect(await birth(page)).toEqual({ ids: ['s1', 's3', 's2'], main: 's3' });
        await expect(birthChips(page).first()).toHaveClass(/is-main/);
    });

    test('× on the main citation\'s chip: no question, its toast over the editor; a shared event: "for all 2 people"', async ({ page }) => {
        await tree(page, { main: true });
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('r' as never));
        const chip = birthChips(page).filter({ hasText: 'Matrika Z' });
        await expect(chip.locator('.source-chip-remove')).toHaveAttribute('aria-label', 'Remove citation');
        await chip.locator('.source-chip-remove').click();
        await expect(page.locator('#confirmation-modal.active')).toHaveCount(0);
        await expect(pill(page).locator('.undo-toast-msg'))
            .toHaveText('Citation removed from the birth, no longer main: Matrika Z Vrbovec 1900–1930 · the source stays');
        expect(await birth(page)).toEqual({ ids: ['s1', 's2'], main: undefined });
        await pill(page).locator('.undo-toast-btn').click();
        expect(await birth(page)).toEqual({ ids: ['s1', 's3', 's2'], main: 's3' });
        await expect(birthChips(page).first()).toHaveClass(/is-main/);

        await page.evaluate(() => window.Strom.UI.showSourceViewer('s1', { personId: 'r' as never, eventId: 'ev_r' }));
        await expect(bar(page).locator('.viewer-cite-what')).toHaveText('Census · Dobromil Ostružník');
        await bar(page).locator('.viewer-cite-remove').click();
        await expect(pill(page).locator('.undo-toast-msg'))
            .toHaveText('Citation removed from the census for all 2 people: Sčítání lidu Vrbovec 1880 · the source stays');
        const left = await page.evaluate(() => ['r', 'h'].map(id => window.Strom.DataManager.getPerson(id as never)!.events![0].sourceIds));
        expect(left).toEqual([undefined, undefined]);
    });
});

/** Nothing wider than the screen, the bar's parts inside it and apart. */
async function fits(page: Page, width: number): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const box = (await bar(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    const over = await bar(page).evaluate(el => [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))]
        .filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').length);
    expect(over).toBe(0);
    const parts = bar(page).locator('.viewer-cite-text, .viewer-cite-acts button, .viewer-cite-note');
    const boxes = [];
    for (let i = 0; i < await parts.count(); i++) boxes.push((await parts.nth(i).boundingBox())!);
    for (const b of boxes) expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const apart = a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
        expect(apart).toBe(true);
    }
}

const SIZES = [
    { name: 'phone', size: { width: 390, height: 844 }, touch: true },
    { name: 'sideways', size: { width: 844, height: 390 }, touch: true },
    { name: 'tablet', size: { width: 1024, height: 768 }, touch: true },
    { name: 'desktop', size: { width: 1440, height: 900 }, touch: false },
];

for (const s of SIZES) {
    for (const dark of [false, true]) {
        test.describe(`the bar in German, ${s.name}${dark ? ', dark' : ''}`, () => {
            test.use({ hasTouch: s.touch, isMobile: s.touch && s.size.width < 1024 });
            test('the buttons and the note fit, 44 px to tap on touch, the toast whole', async ({ page }) => {
                await tree(page, { lang: 'de', size: s.size, dark, research: true });
                await openFromBirthChip(page, 'Matrika Z');
                await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('2. von 3 Zitaten');
                // A research that has said nothing: no "Mark"; the remove button and its note.
                await expect(bar(page).locator('.viewer-cite-note')).toHaveText('Die Forschung übernimmt Entfernungen noch nicht.');
                await fits(page, s.size.width);
                if (s.touch) {
                    const btn = (await bar(page).locator('.viewer-cite-remove').boundingBox())!;
                    expect(btn.height).toBeGreaterThanOrEqual(44);
                }
                if (SHOTS) await page.screenshot({ path: `${SHOTS}/2e-de-${s.name}${dark ? '-dark' : ''}.png` });
                await page.locator('#source-viewer-modal .close-btn').first().click();
                if (s.size.width <= 1024) {
                    const x = (await birthChips(page).first().locator('.source-chip-remove').boundingBox())!;
                    expect(x.width).toBeGreaterThanOrEqual(44);
                    expect(x.height).toBeGreaterThanOrEqual(44);
                }
                await birthChips(page).first().locator('.source-chip-remove').click();
                const toast = pill(page);
                await expect(toast.locator('.undo-toast-note'))
                    .toHaveText('Die Forschung übernimmt dieses Entfernen nicht; beim Laden ihrer Version kommt das Zitat zurück.');
                const t = (await toast.boundingBox())!;
                expect(t.x).toBeGreaterThanOrEqual(0);
                expect(t.x + t.width).toBeLessThanOrEqual(s.size.width);
                // Never cut to "…".
                expect(await toast.locator('.undo-toast-msg').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
                if (SHOTS) await page.screenshot({ path: `${SHOTS}/3d-de-${s.name}${dark ? '-dark' : ''}.png` });
            });

            test('Mark as main across the bar\'s width, the main state', async ({ page }) => {
                await tree(page, { lang: 'de', size: s.size, dark });
                await openFromBirthChip(page, 'Sčítání');
                const mark = bar(page).locator('.viewer-cite-main');
                await expect(mark).toHaveText('☆︎ Als Hauptzitat markieren');
                await fits(page, s.size.width);
                if (s.touch) expect((await mark.boundingBox())!.height).toBeGreaterThanOrEqual(44);
                if (s.size.width <= 640 || s.size.height <= 500) {
                    // Under the text, the main button the bar's whole row (with the remove link beside or under it).
                    const text = (await bar(page).locator('.viewer-cite-text').boundingBox())!;
                    const m = (await mark.boundingBox())!;
                    expect(m.y).toBeGreaterThanOrEqual(text.y + text.height - 0.5);
                }
                if (SHOTS) await page.screenshot({ path: `${SHOTS}/2b-de-${s.name}${dark ? '-dark' : ''}.png` });
                await mark.click();
                await expect(bar(page).locator('.viewer-cite-pos')).toHaveText('★︎ Hauptzitat (Geburt)');
                await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Hauptzitat (Geburt): Sčítání lidu Vrbovec 1880');
                await fits(page, s.size.width);
                if (SHOTS) await page.screenshot({ path: `${SHOTS}/2c-de-${s.name}${dark ? '-dark' : ''}.png` });
            });
        });
    }
}

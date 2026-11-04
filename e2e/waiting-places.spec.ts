import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakePlaces, openResearch, poll, researchGed, touchScreenNow, HEAD, FakeBridge } from './research-bridge.js';

/**
 * The research's questions about places in "Awaiting action" (spec 034 §9):
 * the group "Places" opens its own window with one card per question; "It
 * is A", Keep, Yes and Don't know answer through the bridge
 * (`POST /places/answer`) with Undo in the toast (`POST /places/undo`);
 * "Accept all suggested" and "By area" ask the research what would change
 * (`dry`) before one bulk step; a conflict placed by hand stays out of it;
 * a question changed meanwhile refreshes the list; without `places.undo`
 * the toast has no Undo, without `places.answer` everything stays as before;
 * "Answer in Waiting ›" in Places opens the place's card; a phone upright
 * and sideways. Invented places and people (the Brindak family).
 */

/** The tree's place key (placeKey): no accents, lowercase, dots and commas as spaces. */
const key = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();

/** One person of the research with a birth and a death (year, place). */
function person(id: string, first: string, birth: [number, string], death: [number, string]): string[] {
    return [
        `0 @${id}@ INDI`, `1 NAME ${first} /Brindak/`, '1 SEX M', `1 REFN ${id}`, '2 TYPE strom-research',
        '1 BIRT', `2 DATE ${birth[0]}`, `2 PLAC ${birth[1]}`,
        '1 DEAT', `2 DATE ${death[0]}`, `2 PLAC ${death[1]}`,
    ];
}

const GED = researchGed(HEAD, [
    ...person('P0004', 'Zorbin', [1860, 'H. Lhota'], [1878, 'Lhotínek']),
    ...person('P0005', 'Quilla', [1865, 'Lhotov'], [1875, 'Jinov']),
    ...person('P0006', 'Yarek', [1870, 'Lhota 16'], [1880, 'Lhota']),
]);

const ALL = ['places.identify', 'places.answer', 'places.undo', 'waiting.groups'];
const AT = '2026-11-01T10:00:00Z';

/**
 * The research's questions, in its order: where H. Lhota is (two candidates in
 * two districts), where Lhotínek is, Lhotov placed by hand against a
 * suggestion, Jinov from the research against a suggestion, and Lhota 16
 * written as a house of Lhota.
 */
function questions(): Record<string, unknown>[] {
    const q = (id: string, what: string, rest: Record<string, unknown>): Record<string, unknown> =>
        ({ id, kind: 'place', place: id, what, at: AT, section: 'decide', ...rest });
    return [
        q('L0012', 'Where is H. Lhota?', {
            question: 'propose', forms: ['H. Lhota'],
            candidates: [
                {
                    id: 'c1', name: 'Horní Lhota', district: 'Lhotov District', country: 'Czechia', lat: 49.59, lon: 15.38,
                    why: 'The parish of Lhotov names the farm.', source: { title: 'Parish register Lhotov 1850–1880', url: 'https://example.org/lhotov' },
                },
                { id: 'c2', name: 'Horní Lhota', district: 'Jinov District', country: 'Czechia', lat: 50.28, lon: 16.85, why: 'A village of the same name.' },
            ],
        }),
        q('L0013', 'Where is Lhotínek?', {
            question: 'propose', forms: ['Lhotínek'],
            candidates: [{ id: 'c1', name: 'Lhotínek', district: 'Jinov District', country: 'Czechia', lat: 49.631, lon: 15.461 }],
        }),
        q('L0020', 'Lhotov: a location against a suggestion', {
            question: 'conflict', forms: ['Lhotov'], current: { lat: 49.57, lon: 15.36, label: 'Lhotov' }, by: 'person',
            candidates: [{ id: 'c1', name: 'Lhotov', district: 'Lhotov District', country: 'Czechia', lat: 49.9, lon: 15.8 }],
        }),
        q('L0021', 'Jinov: a location against a suggestion', {
            question: 'conflict', forms: ['Jinov'], current: { lat: 50.31, lon: 16.91, label: 'Jinov' }, by: 'research',
            candidates: [{ id: 'c1', name: 'Jinov', district: 'Jinov District', country: 'Czechia', lat: 49.65, lon: 15.5, why: 'The family lived near Lhota.' }],
        }),
        q('L0030', 'Lhota 16: a house of Lhota?', {
            question: 'form', forms: ['Lhota 16'], change: { from: { place: 'Lhota 16' }, to: { place: 'Lhota', house: '16' }, facts: 1 },
        }),
    ];
}

/** The research's places: H. Lhota and Lhotínek wait for an answer. */
function placesReply(): Record<string, unknown> {
    return {
        rev: 'p1',
        places: {
            L0012: { name: 'H. Lhota', state: 'proposed', forms: ['H. Lhota'], waiting: 'L0012' },
            L0013: { name: 'Lhotínek', state: 'proposed', forms: ['Lhotínek'], waiting: 'L0013' },
        },
        forms: {},
        queue: { queued: 0, running: 0 },
        counts: { offMap: 2, placed: 4, proposed: 2, unlocated: 0 },
    };
}

/** The tree's own locations: Lhota and Lhotínek, Lhotov by hand, Jinov from the map. */
async function setGeos(page: Page): Promise<void> {
    await page.evaluate(() => {
        const S = window.Strom;
        S.DataManager.getData().places = {
            lhota: { lat: 49.6, lon: 15.4, label: 'Lhota' },
            lhotinek: { lat: 49.63, lon: 15.46, label: 'Lhotínek' },
            lhotov: { lat: 49.57, lon: 15.36, label: 'Lhotov, Lhotov District, Czechia', origin: 'hand' },
            jinov: { lat: 50.3, lon: 16.9, label: 'Jinov' },
        };
        S.TreeRenderer.render();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast').forEach(t => t.remove());
    });
}

/** The research tree, its bridge announcing `features`, its questions read. */
/** `strom`: the research's version (from 1.26.0-beta.7 it takes Don't know for a conflict and a form too). */
async function research(page: Page, features: string[] = ALL, waiting = questions(), strom = '1.26.0-beta.7'): Promise<FakeBridge> {
    const b = await fakeBridge(page, { features, treeGed: GED, places: fakePlaces({ reply: placesReply() }), waiting, strom });
    await openResearch(page, { ged: GED });
    await poll(page);
    await setGeos(page);
    return b;
}

const win = (page: Page): Locator => page.locator('#waiting-places-modal');
const cardOf = (page: Page, id: string): Locator => win(page).locator(`.waiting-place[data-place="${id}"]`);
const cards = (page: Page): Promise<string[]> => win(page).locator('.waiting-place').evaluateAll(cs => cs.map(c => (c as HTMLElement).dataset.place ?? ''));
const toast = (page: Page): Locator => page.locator('.toast');
const openWin = async (page: Page, place?: string): Promise<void> => {
    await page.evaluate((p) => window.Strom.UI.showWaitingPlaces(p), place);
    await expect(win(page)).toBeVisible();
};

/** Nothing wider than the screen: the window's content, the page and every visible element of the cards. */
async function noSideScroll(page: Page): Promise<void> {
    const box = await page.evaluate(() => {
        const content = document.querySelector('#waiting-places-modal .modal-content') as HTMLElement;
        const over = Math.max(0, ...[...document.querySelectorAll<HTMLElement>('#waiting-places-modal .waiting-places-body *')]
            .filter(el => el.offsetParent !== null)
            .map(el => el.getBoundingClientRect().right - window.innerWidth));
        return {
            content: content.scrollWidth - content.clientWidth,
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            over,
        };
    });
    expect(box.content).toBeLessThanOrEqual(0);
    expect(box.page).toBeLessThanOrEqual(0);
    expect(box.over).toBeLessThanOrEqual(1);
}

/** Every visible button of the window is at least 44 px tall (a touch screen). */
async function touchTargets(page: Page): Promise<void> {
    const small = await win(page).locator('.waiting-places-body button, .buttons button').evaluateAll(bs => bs
        .filter(b => (b as HTMLElement).offsetParent !== null && !b.classList.contains('place-mini-pin'))
        .map(b => ({ text: b.textContent?.trim() ?? '', h: b.getBoundingClientRect().height }))
        .filter(b => b.h < 44));
    expect(small).toEqual([]);
}

test.describe('questions about places in Awaiting action', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Answer in the small panel opens the card; It is A answers, the toast\'s Undo brings the question back', async ({ page }) => {
        const b = await research(page);
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        const panel = page.locator('#live-panel');
        const answer = panel.locator('.live-waiting-answer[data-action="place"]');
        await expect(answer).toHaveCount(5);
        await answer.first().click();
        await expect(win(page)).toBeVisible();
        await expect(cardOf(page, 'L0012')).toHaveClass(/is-focus/);

        // The group's head: its count, the bulk steps and the areas.
        await expect(win(page).locator('.waiting-places-count')).toHaveText('5 questions');
        await expect(win(page).locator('.waiting-places-accept')).toHaveText('Accept all suggested (3)');
        await expect(win(page).locator('.waiting-places-keep')).toHaveText('Keep all (2)');
        await expect(win(page).locator('.waiting-places-area')).toHaveText(['Jinov District · 2', 'Lhotov District · 1']);
        expect(await cards(page)).toEqual(['L0012', 'L0013', 'L0020', 'L0021', 'L0030']);
        await expect(win(page).locator('.waiting-place-kind')).toHaveText(['Where is', 'Where is', 'Location conflict', 'Location conflict', 'Entry suggestion']);

        // The question about H. Lhota: its people and forms, A and B with district, why and source, a small map.
        const c = cardOf(page, 'L0012');
        await expect(c.locator('.waiting-place-title')).toHaveText('Where is H. Lhota?');
        await expect(c.locator('.waiting-place-sub')).toHaveText('1 person, 1860 · H. Lhota');
        await expect(c.locator('.waiting-place-cand-name')).toHaveText(['Horní Lhota', 'Horní Lhota']);
        await expect(c.locator('.waiting-place-cand-where')).toHaveText(['Lhotov District · Czechia', 'Jinov District · Czechia']);
        await expect(c.locator('.waiting-place-cand-why').first()).toHaveText('The parish of Lhotov names the farm.');
        await expect(c.locator('a.waiting-place-cand-src')).toHaveAttribute('href', 'https://example.org/lhotov');
        await expect(c.locator('.waiting-place-pick')).toHaveText(['It is A', 'It is B']);
        await expect(c.locator('.waiting-place-choice')).toHaveText(['None of them', 'Don’t know']);
        await expect(c.locator('.waiting-place-mapbox')).toBeVisible();
        await expect(c.locator('.place-mini-pin')).toHaveCount(2);
        // A row picks its point on the map.
        await c.locator('.waiting-place-cand[data-cand="c2"] .waiting-place-cand-name').click();
        await expect(c.locator('.waiting-place-cand[data-cand="c2"]')).toHaveClass(/is-selected/);
        await expect(c.locator('.place-mini-pin[data-cand="c2"]')).toHaveClass(/is-selected/);

        await c.getByRole('button', { name: 'It is A: Horní Lhota' }).click();
        await expect.poll(() => b.places!.answers).toEqual([{ place: 'L0012', take: 'c1' }]);
        await expect(cardOf(page, 'L0012')).toHaveCount(0);
        await expect(toast(page)).toContainText('H. Lhota = Horní Lhota (Lhotov District). 1 fact gets the location.');
        await expect(win(page).locator('.waiting-places-count')).toHaveText('4 questions');

        await toast(page).getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => b.places!.undos).toEqual([{ undo: 'U1' }]);
        await expect(toast(page)).toContainText('Undone.');
        await expect(cardOf(page, 'L0012')).toBeVisible();
        await expect(win(page).locator('.waiting-places-count')).toHaveText('5 questions');
    });

    test('a conflict: Keep; a written place: Yes; a suggestion: Don\'t know — each with its toast', async ({ page }) => {
        const b = await research(page);
        await openWin(page);

        // Lhotov placed by hand, Jinov from the research: each says who gave its location now.
        await expect(cardOf(page, 'L0020').locator('.waiting-place-cand.is-current')).toContainText('Now: Lhotov');
        // Where it is now and how far from the suggestion: the geocoder's name without the place's own, else the coordinates.
        await expect(cardOf(page, 'L0020').locator('.waiting-place-cand.is-current .waiting-place-cand-where'))
            .toHaveText(['Lhotov District, Czechia · 48 km from the suggestion', 'Placed by hand']);
        const j = cardOf(page, 'L0021');
        await expect(j.locator('.waiting-place-cand.is-current .waiting-place-cand-where'))
            .toHaveText(['50.3100, 16.9100 · 125 km from the suggestion', 'From the research']);
        await expect(j.locator('.waiting-place-cand[data-cand="c1"] .waiting-place-cand-name')).toHaveText('Suggested: Jinov');
        await expect(j.locator('.waiting-place-pick')).toHaveCount(0);
        await expect(j.locator('.waiting-place-choice')).toHaveText(['Move to Jinov (Jinov District)', 'Keep', 'Don’t know']);
        await j.getByRole('button', { name: 'Keep', exact: true }).click();
        await expect.poll(() => b.places!.answers.at(-1)).toEqual({ place: 'L0021', take: 'keep' });
        await expect(toast(page)).toContainText('Location kept.');
        await expect(cardOf(page, 'L0021')).toHaveCount(0);

        const f = cardOf(page, 'L0030');
        await expect(f.locator('.waiting-place-chip')).toHaveText(['Lhota 16']);
        await expect(f.locator('.waiting-place-explain')).toHaveText('Yes: 1 fact changes from “Lhota 16” to “Lhota, house 16”. No: the entry stays as it is. The source’s transcript does not change either way.');
        await expect(f.locator('.waiting-place-choice')).toHaveText(['Yes', 'No', 'Don’t know']);
        await f.getByRole('button', { name: 'Yes' }).click();
        await expect.poll(() => b.places!.answers.at(-1)).toEqual({ place: 'L0030', take: 'yes' });
        await expect(toast(page)).toContainText('Entry changed to “Lhota, house 16” (1 fact).');

        await cardOf(page, 'L0013').getByRole('button', { name: 'Don’t know' }).click();
        await expect.poll(() => b.places!.answers.at(-1)).toEqual({ place: 'L0013', take: 'unknown' });
        await expect(toast(page)).toContainText('Noted: not known. The place stays off the map.');
        await expect.poll(() => cards(page)).toEqual(['L0012', 'L0020']);
        expect(b.places!.answers).toHaveLength(3);
    });

    test('an older research (before 1.26.0-beta.7): no Don\'t know for a conflict and a written place, a suggestion keeps it', async ({ page }) => {
        await research(page, ALL, questions(), '1.26.0-beta.6');
        await openWin(page);
        await expect(cardOf(page, 'L0021').locator('.waiting-place-choice')).toHaveText(['Move to Jinov (Jinov District)', 'Keep']);
        await expect(cardOf(page, 'L0030').locator('.waiting-place-choice')).toHaveText(['Yes', 'No']);
        await expect(cardOf(page, 'L0013').locator('.waiting-place-choice')).toHaveText(['None of them', 'Don’t know']);
    });

    test('Accept all suggested: the preview with the research\'s counts, one step, one toast, one Undo; a hand-placed conflict stays out', async ({ page }) => {
        const b = await research(page);
        await openWin(page);
        await win(page).locator('.waiting-places-accept').click();
        const pv = win(page).locator('.waiting-places-preview');
        await expect(pv).toBeVisible();
        // The research is asked first what would change (Lhotov, placed by hand, is not among them).
        await expect.poll(() => b.places!.answers).toEqual([{ places: ['L0012', 'L0013', 'L0021'], take: 'first', dry: true }]);
        await expect(pv.locator('.waiting-places-preview-title')).toHaveText('Accept 3 suggested places');
        await expect(pv.locator('li')).toHaveText([
            'Always the first candidate (A); each place keeps its reasoning in Places.',
            '3 places go on the map; the location changes in 9 facts (2 people).',
            'Locations placed by hand (1) stay as they are: those only one by one or with Keep all.',
            'One Undo reverts the whole bulk step.',
        ]);
        expect(await cards(page)).toHaveLength(5);

        await pv.getByRole('button', { name: 'Accept 3' }).click();
        await expect.poll(() => b.places!.answers.at(-1)).toEqual({ places: ['L0012', 'L0013', 'L0021'], take: 'first' });
        await expect(pv).toHaveCount(0);
        await expect.poll(() => cards(page)).toEqual(['L0020', 'L0030']);
        await expect(toast(page)).toHaveCount(1);
        await expect(toast(page)).toContainText('Accepted 3 places, location in 9 facts.');
        await expect(win(page).locator('.waiting-places-accept')).toHaveCount(0);

        await toast(page).getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => b.places!.undos).toEqual([{ undo: 'U1' }]);
        await expect.poll(() => cards(page)).toHaveLength(5);
        await expect(win(page).locator('.waiting-places-accept')).toHaveText('Accept all suggested (3)');
    });

    test('By area: the chip previews only its area\'s suggestions and accepts only them; Escape closes the preview first', async ({ page }) => {
        const b = await research(page);
        await openWin(page);
        const chip = win(page).locator('.waiting-places-area', { hasText: 'Jinov District' });
        await chip.click();
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        const pv = win(page).locator('.waiting-places-preview');
        await expect(pv.locator('.waiting-places-preview-title')).toHaveText('Accept suggested in Jinov District (2)');
        await expect.poll(() => b.places!.answers).toEqual([{ places: ['L0013', 'L0021'], take: 'first', dry: true }]);
        await expect(pv.locator('li')).toHaveText([
            'Always the first candidate (A); each place keeps its reasoning in Places.',
            '2 places go on the map; the location changes in 6 facts (2 people).',
            'One Undo reverts the whole bulk step.',
        ]);

        // Escape: the preview goes, the window stays.
        await page.keyboard.press('Escape');
        await expect(pv).toHaveCount(0);
        await expect(win(page)).toBeVisible();

        await chip.click();
        await pv.getByRole('button', { name: 'Accept 2' }).click();
        await expect.poll(() => b.places!.answers.at(-1)).toEqual({ places: ['L0013', 'L0021'], take: 'first' });
        await expect.poll(() => cards(page)).toEqual(['L0012', 'L0020', 'L0030']);
        await expect(toast(page)).toContainText('Accepted 2 places, location in 6 facts.');
        // One area left: no chips.
        await expect(win(page).locator('.waiting-places-area')).toHaveCount(0);
        await expect(win(page).locator('.waiting-places-accept')).toHaveText('Accept all suggested (1)');
    });

    test('a question changed meanwhile (409 places.changed): a toast, the list read again, the card stays', async ({ page }) => {
        const b = await research(page);
        await openWin(page);
        b.places!.answerReply = (body) => {
            if (body.place !== 'L0012') return null;
            // Meanwhile the research answered Lhotínek itself.
            b.waiting = (b.waiting ?? []).filter(w => (w as { id: string }).id !== 'L0013');
            return { status: 409, body: { error: 'The place changed.', code: 'places.changed' } };
        };
        await cardOf(page, 'L0012').getByRole('button', { name: 'It is A: Horní Lhota' }).click();
        await expect(toast(page)).toContainText('The question changed meanwhile; Awaiting action is refreshed.');
        await expect.poll(() => cards(page)).toEqual(['L0012', 'L0020', 'L0021', 'L0030']);
        await expect(cardOf(page, 'L0012').getByRole('button', { name: 'It is A: Horní Lhota' })).toBeEnabled();
    });

    test('the answer\'s place shows in Places at once', async ({ page }) => {
        const b = await research(page);
        const p = b.places!;
        p.answerReply = (body) => {
            if (body.place !== 'L0012') return null;
            const place = {
                name: 'Horní Lhota', district: 'Lhotov District', country: 'CZ', coords: { lat: 49.59, lon: 15.38 },
                state: 'identified', by: 'research', at: '2026-11-02', forms: ['H. Lhota'],
            };
            b.waiting = (b.waiting ?? []).filter(w => (w as { id: string }).id !== 'L0012');
            p.reply = { ...p.reply, rev: 'p2', places: { ...(p.reply.places as Record<string, unknown>), L0012: place } };
            return { status: 200, body: { ok: true, place: { id: 'L0012', ...place }, undo: 'U1' } };
        };
        await openWin(page);
        await cardOf(page, 'L0012').getByRole('button', { name: 'It is A: Horní Lhota' }).click();
        await expect(toast(page)).toContainText('H. Lhota = Horní Lhota');
        await page.evaluate(() => { window.Strom.UI.closeWaitingPlaces(); window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'); });
        const row = page.locator(`#places-modal .place-row[data-key="${key('H. Lhota')}"]`);
        await expect(row).toHaveAttribute('data-state', 'placed');
        await expect(row.locator('.place-origin[data-origin="research"]')).toBeVisible();
    });

    test('a bridge without places.undo: the toast has no Undo, the preview no Undo line', async ({ page }) => {
        const b = await research(page, ['places.identify', 'places.answer', 'waiting.groups']);
        await openWin(page);
        await cardOf(page, 'L0013').getByRole('button', { name: 'It is A: Lhotínek' }).click();
        await expect.poll(() => b.places!.answers).toEqual([{ place: 'L0013', take: 'c1' }]);
        await expect(toast(page)).toContainText('Lhotínek = Lhotínek (Jinov District).');
        await expect(toast(page).getByRole('button', { name: 'Undo' })).toHaveCount(0);
        await win(page).locator('.waiting-places-accept').click();
        await expect(win(page).locator('.waiting-places-preview li').nth(1)).toContainText('places go on the map');
        await expect(win(page).locator('.waiting-places-preview')).not.toContainText('One Undo');
        expect(b.places!.undos).toEqual([]);
    });

    test('a bridge without places.answer: the items as before, no Answer, Answer in Waiting opens the panel', async ({ page }) => {
        const b = await research(page, ['places.identify', 'waiting.groups']);
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        const panel = page.locator('#live-panel');
        await expect(panel).toContainText('Where is H. Lhota?');
        await expect(panel.locator('.live-waiting-answer[data-action="place"]')).toHaveCount(0);

        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        const row = page.locator(`#places-modal .place-row[data-key="${key('H. Lhota')}"]`);
        await expect(row).toHaveAttribute('data-state', 'confirm');
        await row.locator('.place-answer').click();
        await expect(page.locator('#places-modal')).toHaveCount(0);
        await expect(win(page)).toHaveCount(0);
        await expect(panel).toBeVisible();
        expect(b.places!.answers).toEqual([]);
    });

    test('Answer in Waiting › in Places opens the window at that place\'s card', async ({ page }) => {
        await research(page);
        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        const row = page.locator(`#places-modal .place-row[data-key="${key('Lhotínek')}"]`);
        await expect(row).toHaveAttribute('data-state', 'confirm');
        await expect(row.locator('.place-answer')).toHaveText('Answer in Waiting ›');
        await row.locator('.place-answer').click();
        await expect(page.locator('#places-modal')).toHaveCount(0);
        await expect(win(page)).toBeVisible();
        const c = cardOf(page, 'L0013');
        await expect(c).toHaveClass(/is-focus/);
        await expect(c).toBeInViewport();
        await expect(cardOf(page, 'L0012')).not.toHaveClass(/is-focus/);
    });
});

/**
 * A conflict's small map shows its two points, not every place of the family
 * (Jinov, 120 km off, is no dot at Lhotov's); the location now and a
 * suggestion on the same spot stand side by side, both in the map.
 */
for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`${size.width}: a conflict's small map is its two points, both seen, the location now never under the letter`, async ({ page }) => {
        await page.setViewportSize(size);
        const same = questions().map(q => q.id === 'L0021'
            ? { ...q, candidates: [{ id: 'c1', name: 'Jinov', district: 'Jinov District', country: 'Czechia', lat: 50.31, lon: 16.91 }] } : q);
        await research(page, ALL, same);
        await openWin(page);
        const pins = async (id: string) => cardOf(page, id).locator('.waiting-place-map').evaluate((map) => {
            const box = map.getBoundingClientRect();
            const at = [...map.querySelectorAll<HTMLElement>('.place-mini-pin')].map(p => {
                const r = p.getBoundingClientRect();
                return { cand: p.dataset.cand, x: r.left + r.width / 2, y: r.top + r.height / 2, inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5 };
            });
            const dots = [...map.querySelectorAll<HTMLElement>('.place-mini-dot')].map(d => d.title);
            return { at, dots, apart: at.length === 2 ? Math.hypot(at[0]!.x - at[1]!.x, at[0]!.y - at[1]!.y) : 0 };
        });
        const l = cardOf(page, 'L0020');
        await l.scrollIntoViewIfNeeded();
        await expect.poll(async () => (await pins('L0020')).at.map(p => [p.cand, p.inside])).toEqual([['now', true], ['c1', true]]);
        const lhotov = await pins('L0020');
        expect(lhotov.dots).not.toContain('Jinov');
        expect(lhotov.apart).toBeGreaterThan(22);
        const j = cardOf(page, 'L0021');
        await j.scrollIntoViewIfNeeded();
        await expect(j.locator('.waiting-place-now-where')).toHaveText('50.3100, 16.9100 · Less than 1 km from the suggestion');
        await expect.poll(async () => (await pins('L0021')).at.map(p => [p.cand, p.inside])).toEqual([['now', true], ['c1', true]]);
        expect((await pins('L0021')).apart).toBeGreaterThanOrEqual(22);
        await noSideScroll(page);
    });
}

/** A phone upright: the map above the candidates; sideways: behind Show on the map. Nothing wider than the screen, 44 px targets. */
for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`a phone at ${size.width}×${size.height}: no horizontal scroll, the map ${size.width < size.height ? 'above the list' : 'behind Show on the map'}, 44 px targets`, async ({ page }) => {
        await page.setViewportSize(size);
        const b = await research(page);
        await touchScreenNow(page);
        await openWin(page);
        const c = cardOf(page, 'L0012');
        await expect(c.locator('.waiting-place-pick')).toHaveText(['It is A', 'It is B']);
        const mapbox = c.locator('.waiting-place-mapbox');
        const toggle = c.locator('.waiting-place-maptoggle');
        if (size.width < size.height) {
            await expect(mapbox).toBeVisible();
            await expect(toggle).toBeHidden();
            const mapY = (await mapbox.boundingBox())!.y;
            const listY = (await c.locator('.waiting-place-cands').boundingBox())!.y;
            expect(mapY).toBeLessThan(listY);
        } else {
            await expect(mapbox).toBeHidden();
            await expect(toggle).toHaveText('⌖ Show on the map');
            await toggle.click();
            await expect(c.locator('.waiting-place-mapbox')).toBeVisible();
            await expect(c.locator('.waiting-place-maptoggle')).toHaveText('⌖ Hide the map');
            await expect(c.locator('.waiting-place-maptoggle')).toHaveAttribute('aria-expanded', 'true');
        }
        await noSideScroll(page);
        await touchTargets(page);

        // The bulk preview fits too.
        await win(page).locator('.waiting-places-accept').click();
        await expect(win(page).locator('.waiting-places-preview li').nth(1)).toContainText('places go on the map');
        await noSideScroll(page);
        await touchTargets(page);
        await win(page).locator('.waiting-places-preview').getByRole('button', { name: 'Accept 3' }).click();
        await expect.poll(() => b.places!.answers.at(-1)).toEqual({ places: ['L0012', 'L0013', 'L0021'], take: 'first' });
        await expect.poll(() => cards(page)).toEqual(['L0020', 'L0030']);
    });
}

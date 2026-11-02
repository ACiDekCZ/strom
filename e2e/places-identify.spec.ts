import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, seedTree } from './helpers.js';
import { fakeBridge, fakePlaces, openResearch, poll, researchGed, HEAD, FakeBridge, FakePlaces } from './research-bridge.js';

/**
 * Place identification in the Places dialog (spec 034 §1–§3, §5): each
 * place's state from the research's `GET /places` and the app's own check,
 * the summary with its state chips, ◆ Look up for a row (Undo takes it out
 * of the queue again), a selection, "Look up all not on the map" after its
 * preview, a refusal of the bridge, "Why here", "Keep" on a Check mark, and
 * no ◆ step without the research here or on a phone. Invented places and
 * people (the Brindak family).
 */

const L1 = 'L0001';
const L2 = 'L0002';

/** The tree's place key (placeKey): no accents, lowercase, dots and commas as spaces. */
const key = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();

/** One person of the research with a birth and a death (year, place). */
function person(id: string, first: string, birth: [number, string], death?: [number, string]): string[] {
    return [
        `0 @${id}@ INDI`, `1 NAME ${first} /Brindak/`, '1 SEX M', `1 REFN ${id}`, '2 TYPE strom-research',
        '1 BIRT', `2 DATE ${birth[0]}`, `2 PLAC ${birth[1]}`,
        ...(death ? ['1 DEAT', `2 DATE ${death[0]}`, `2 PLAC ${death[1]}`] : []),
    ];
}

/**
 * The Brindak family around 1860–1885: Lhota, Lhotínek and Lhotov close
 * together (Lhotov placed by hand), Jinov far away (the app's check marks it),
 * Horní Lhota and three houses of Lhoták without a location, H. Lhota queued in
 * the research, Łotów not identified by it.
 */
const GED = researchGed(HEAD, [
    ...person('P0004', 'Zorbin', [1860, 'Lhota'], [1878, 'Lhotínek']),
    ...person('P0005', 'Quilla', [1865, 'Lhotov'], [1875, 'Jinov']),
    ...person('P0006', 'Yarek', [1870, 'Horní Lhota'], [1880, 'Łotów']),
    ...person('P0007', 'Orvel', [1868, 'H. Lhota'], [1885, 'Lhoták čp. 3']),
    ...person('P0008', 'Myrtan', [1872, 'Lhoták čp. 5'], [1890, 'Lhoták čp. 7']),
]);

const LHOTA = { lat: 49.6, lon: 15.4 };

/** The research's places: Lhota identified by it (with a former name), Łotów not identified, H. Lhota queued. */
function placesReply(): Record<string, unknown> {
    return {
        rev: 'p1',
        places: {
            [L1]: {
                name: 'Lhota', names: [{ name: 'Lhotau', lang: 'de', to: 1945 }], country: 'CZ', district: 'Jinov',
                coords: LHOTA, state: 'identified', by: 'research', at: '2026-10-20',
                why: 'The parish of Lhota keeps the records of the family.',
                source: { title: 'Parish register Lhota 1850–1890', url: 'https://example.org/lhota' },
                forms: ['Lhota'], facts: 1, persons: 1,
            },
            [L2]: { name: 'Łotów', state: 'unlocated', unlocated: 'Three villages of this name in the region.', needs: 'The parish of the record.', forms: ['Łotów'] },
        },
        forms: { 'H. Lhota': { state: 'queued' } },
        queue: { queued: 1, running: 0 },
        counts: { offMap: 5, placed: 4, proposed: 0, unlocated: 1 },
    };
}

/**
 * A bridge that keeps the queue as the research does: queued forms come back
 * as `queued` in the next `/places`, cancelled ones go.
 */
function livePlaces(): FakePlaces {
    const p = fakePlaces({ reply: placesReply() });
    p.identifyReply = (body) => {
        const forms = (p.reply.forms ?? {}) as Record<string, unknown>;
        const asked = Array.isArray(body.forms) ? body.forms as string[] : [];
        if (body.do === 'cancel') {
            for (const f of asked) delete forms[f];
            p.reply = { ...p.reply, rev: `p${p.identify.length + 1}`, forms };
            return { status: 200, body: { ok: true, queued: 0, cancelled: asked.length, skipped: [] } };
        }
        const offMap = ['Horní Lhota', 'Lhoták čp. 3', 'Lhoták čp. 5', 'Lhoták čp. 7', 'Łotów'];
        const take = body.all === 'offmap' ? offMap : asked;
        for (const f of take) if (f !== 'Łotów') forms[f] = { state: 'queued' };
        p.reply = { ...p.reply, rev: `p${p.identify.length + 1}`, forms };
        return { status: 200, body: { ok: true, queued: take.length, skipped: [] } };
    };
    return p;
}

/** The research tree with its places, the bridge announcing place identification (or not: `features`). */
async function research(page: Page, opts: { features?: string[] } = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, {
        features: opts.features ?? ['places.identify'],
        treeGed: GED,
        places: livePlaces(),
    });
    await openResearch(page, { ged: GED });
    await poll(page);
    await setGeos(page);
    return b;
}

/** The tree's own locations: Lhota as the research has it, Lhotov by hand, Lhotínek and Jinov from the map. */
async function setGeos(page: Page): Promise<void> {
    await page.evaluate(({ lhota }) => {
        const S = window.Strom;
        S.DataManager.getData().places = {
            lhota: { ...lhota, label: 'Lhota' },
            lhotinek: { lat: 49.63, lon: 15.46, label: 'Lhotínek' },
            lhotov: { lat: 49.57, lon: 15.36, label: 'Lhotov', origin: 'hand' },
            jinov: { lat: 50.3, lon: 16.9, label: 'Jinov' },
        };
        S.TreeRenderer.render();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast').forEach(t => t.remove());
    }, { lhota: LHOTA });
}

const modal = (page: Page): Locator => page.locator('#places-modal');
const row = (page: Page, name: string): Locator => modal(page).locator(`.place-row[data-key="${key(name)}"]`);
const chip = (page: Page, f: string): Locator => modal(page).locator(`.places-chip[data-filter="${f}"]`);
const toast = (page: Page): Locator => page.locator('.toast');
const shownKeys = (page: Page): Promise<string[]> => page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#places-modal .place-row[data-key]')]
        .filter(r => r.offsetParent !== null).map(r => r.dataset.key ?? ''));
const open = (page: Page): Promise<void> => page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));

/** The dialog open with the research's places read. */
async function openLive(page: Page, b: FakeBridge): Promise<void> {
    await open(page);
    await expect(modal(page)).toBeVisible();
    await expect.poll(() => b.places!.reads).toBeGreaterThan(0);
    await expect(row(page, 'Łotów')).toHaveAttribute('data-state', 'undet');
}

test.describe('place identification in the Places dialog', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the states from the research and the app\'s check: badges, the summary with its counts, a chip filters and lets go', async ({ page }) => {
        const b = await research(page);
        await openLive(page, b);

        await expect(row(page, 'Lhota')).toHaveAttribute('data-state', 'placed');
        await expect(row(page, 'Lhota').locator('.place-origin[data-origin="research"]')).toContainText('Identified by the research');
        await expect(row(page, 'Lhota').locator('.place-pin-label')).toContainText('Lhota, Jinov District, Czechia');
        await expect(row(page, 'Lhotínek').locator('.place-origin[data-origin="map"]')).toBeVisible();
        await expect(row(page, 'Lhotov').locator('.place-origin[data-origin="hand"]')).toHaveText(/Placed by hand/);
        await expect(row(page, 'H. Lhota')).toHaveAttribute('data-state', 'queued');
        await expect(row(page, 'H. Lhota').locator('.place-state')).toContainText('Queued in the research');
        await expect(row(page, 'Łotów').locator('.place-state')).toContainText('Not identified');
        await expect(row(page, 'Łotów').locator('.place-pin-text')).toHaveText('Three villages of this name in the region.');
        // The app's own check: Jinov lies far from the family's other places.
        await expect(row(page, 'Jinov')).toHaveAttribute('data-state', 'check');
        await expect(row(page, 'Jinov')).toHaveClass(/is-check/);
        await expect(row(page, 'Jinov').locator('.place-pin-text')).toHaveText(/^\d+ km from the other places of the Brindak family in 1860–1878\.$/);
        await expect(row(page, 'Horní Lhota')).toHaveAttribute('data-state', 'none');

        // By state: Check first, then not identified, without a location, queued, placed.
        expect(await shownKeys(page)).toEqual(['jinov', 'łotow', 'horni lhota', 'h lhota', 'lhota', 'lhotinek', 'lhotov']);

        // The summary: all places, the chips with their counts (none for "To confirm").
        await expect(modal(page).locator('.places-total')).toHaveText('10 places');
        const counts = await modal(page).locator('.places-chip').evaluateAll(cs => cs.map(c =>
            [(c as HTMLElement).dataset.filter, c.querySelector('.places-chip-n')?.textContent]));
        expect(counts).toEqual([['map', '4'], ['check', '1'], ['undet', '1'], ['research', '1'], ['none', '4']]);

        // A chip: only its places, the context line says what it means; again: the whole list.
        await chip(page, 'check').click();
        await expect(chip(page, 'check')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => shownKeys(page)).toEqual(['jinov']);
        await expect(modal(page).locator('.places-context')).toHaveAttribute('data-context', 'check');
        await chip(page, 'check').click();
        await expect(chip(page, 'check')).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => shownKeys(page)).toHaveLength(7);
        // Without a chip the line says the queue (H. Lhota waits in it), with Run now.
        await expect(modal(page).locator('.places-context')).toHaveAttribute('data-context', 'queue');

        // "No location": the houses of Lhoták open in their group.
        await chip(page, 'none').click();
        await expect.poll(() => shownKeys(page)).toEqual(['horni lhota', 'lhotak cp 3', 'lhotak cp 5', 'lhotak cp 7']);
        await expect(modal(page).locator('.places-context')).toHaveAttribute('data-context', 'none');
        // Another chip takes its place.
        await chip(page, 'research').click();
        await expect(chip(page, 'none')).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => shownKeys(page)).toEqual(['h lhota']);
        await expect(modal(page).locator('.places-context')).toHaveAttribute('data-context', 'queue');
    });

    test('◆ Look up on a row: queued with a toast; Undo takes it out of the queue again', async ({ page }) => {
        const b = await research(page);
        await openLive(page, b);
        const r = row(page, 'Horní Lhota');
        await r.locator('.place-look').click();
        await expect.poll(() => b.places!.identify).toEqual([{ do: 'queue', forms: ['Horní Lhota'] }]);
        await expect(r).toHaveAttribute('data-state', 'queued');
        await expect(r.locator('.place-state')).toContainText('Queued in the research');
        await expect(r.locator('.place-unqueue')).toBeVisible();
        await expect(toast(page)).toContainText('1 place queued for the research.');
        // The queue line over the list counts both queued places.
        await expect(modal(page).locator('.places-context')).toHaveAttribute('data-context', 'queue');
        await expect(modal(page).locator('.places-context-text')).toHaveText('2 places queued in the research. They run with the next research run.');

        await toast(page).getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => b.places!.identify.at(-1)).toEqual({ do: 'cancel', forms: ['Horní Lhota'] });
        await expect(toast(page)).toContainText('Removed from the queue.');
        await expect(r).toHaveAttribute('data-state', 'none');
        await expect(r.locator('.place-look')).toBeVisible();
    });

    test('a selection: two places, a group head (mixed, then whole); Look up selected sends their texts', async ({ page }) => {
        const b = await research(page);
        await openLive(page, b);
        const select = modal(page).locator('.places-select-btn');
        await select.click();
        await expect(select).toHaveAttribute('aria-pressed', 'true');
        await expect(select).toHaveText('Done');
        const bar = modal(page).locator('.places-selbar');
        await expect(bar).toBeVisible();
        await expect(modal(page).locator('.places-footer')).toBeHidden();

        await row(page, 'Łotów').locator('.place-select').click();
        await row(page, 'Jinov').locator('.place-select').click();
        await expect(bar.locator('.places-selbar-count')).toHaveText('2 selected');
        await expect(bar.locator('.places-selbar-look')).toHaveText('Look up selected (2)');
        // Jinov has a location: it can be checked too; Łotów cannot.
        await expect(bar.locator('.places-selbar-check')).toHaveText('Check selected (1)');

        // One house of Lhoták: its group's head is mixed; the head takes the whole group.
        const group = modal(page).locator(`.place-group[data-town="${key('Lhoták')}"]`);
        await group.locator('.place-caret').first().click();
        await row(page, 'Lhoták čp. 3').locator('.place-select').click();
        const head = group.locator('.place-group-title .place-select');
        await expect(head).toHaveAttribute('aria-checked', 'mixed');
        await head.click();
        await expect(head).toHaveAttribute('aria-checked', 'true');
        await expect(row(page, 'Lhoták čp. 5').locator('.place-select')).toHaveAttribute('aria-checked', 'true');
        await expect(bar.locator('.places-selbar-count')).toHaveText('5 selected');
        await expect(bar.locator('.places-selbar-look')).toHaveText('Look up selected (5)');

        await bar.locator('.places-selbar-look').click();
        await expect.poll(() => b.places!.identify).toHaveLength(1);
        const sent = b.places!.identify[0];
        expect(sent.do).toBe('queue');
        expect([...(sent.forms as string[])].sort()).toEqual(['Jinov', 'Lhoták čp. 3', 'Lhoták čp. 5', 'Lhoták čp. 7', 'Łotów'].sort());
        expect(sent.check).toBeUndefined();
        await expect(toast(page)).toContainText('5 places queued for the research.');
        // The selection ends; the footer is back.
        await expect(select).toHaveAttribute('aria-pressed', 'false');
        await expect(bar).toBeHidden();
        await expect(row(page, 'Lhoták čp. 5')).toHaveAttribute('data-state', 'queued');
    });

    test('⋯ Look up all not on the map: the preview first, then Queue', async ({ page }) => {
        const b = await research(page);
        await openLive(page, b);
        await modal(page).locator('.places-more-btn').click();
        const menu = modal(page).locator('.places-more');
        await expect(menu).toBeVisible();
        const look = menu.locator('[data-bulk="look"]');
        await expect(look.locator('.places-more-title')).toHaveText('Look up all not on the map (5)');
        await expect(menu.locator('[data-bulk="check"] .places-more-title')).toHaveText('Check all locations (4)');
        await look.click();
        await expect(menu).toBeHidden();

        const preview = modal(page).locator('.places-bulk[data-bulk="look"]');
        await expect(preview.locator('.places-bulk-head')).toHaveText('Look up 5 places not on the map in the research');
        await expect(preview.locator('.places-bulk-line > span:last-child')).toHaveText([
            'Queued: 4 without location, 1 not identified, again.',
            'Skipped: 1 already in the research.',
        ]);
        await expect(preview.locator('.places-bulk-note')).toContainText('Nothing runs or costs anything now.');
        // Nothing is sent before Queue.
        expect(b.places!.identify).toEqual([]);
        await preview.locator('.places-bulk-go').click();
        await expect.poll(() => b.places!.identify).toEqual([{ do: 'queue', all: 'offmap' }]);
        await expect(toast(page)).toContainText('5 places queued for the research.');
        await expect(modal(page).locator('.places-bulk')).toHaveCount(0);
        await expect(row(page, 'Horní Lhota')).toHaveAttribute('data-state', 'queued');
    });

    test('the bridge refuses (503 busy): a toast says why, the place stays as it was', async ({ page }) => {
        const b = await research(page);
        b.places!.identifyReply = () => ({ status: 503, body: { error: 'The research is busy.', code: 'research.busy' } });
        await openLive(page, b);
        const r = row(page, 'Horní Lhota');
        await r.locator('.place-look').click();
        await expect.poll(() => b.places!.identify).toHaveLength(1);
        await expect(toast(page)).toContainText('Cannot queue now: the research is busy.');
        await expect(r).toHaveAttribute('data-state', 'none');
        await expect(r.locator('.place-look')).toBeVisible();
    });

    test('Why here: today, earlier, who, why and the source of a place the research identified', async ({ page }) => {
        const b = await research(page);
        await openLive(page, b);
        const r = row(page, 'Lhota');
        const toggle = r.locator('.place-why-toggle');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(toggle).toHaveText('Hide');
        const why = r.locator('.place-why');
        await expect(why).toBeVisible();
        await expect(why.locator('.place-why-k')).toHaveText(['Today', 'Earlier', 'Who', 'Why', 'Source']);
        await expect(why.locator('[data-kind="today"]')).toHaveText('Lhota, Jinov District, Czechia');
        await expect(why.locator('[data-kind="before"]')).toHaveText('Lhotau (until 1945)');
        await expect(why.locator('[data-kind="who"] .place-origin[data-origin="research"]')).toBeVisible();
        await expect(why.locator('[data-kind="why"]')).toHaveText('The parish of Lhota keeps the records of the family.');
        await expect(why.locator('[data-kind="source"]')).toContainText('Parish register Lhota 1850–1890');
        await expect(why.locator('[data-kind="source"] a')).toHaveAttribute('href', 'https://example.org/lhota');
        // Closed again.
        await toggle.click();
        await expect(why).toBeHidden();
        await expect(toggle).toHaveText('Why here ▾');
    });

    test('Keep on a row marked Check: the mark goes, the location stays; Undo brings the mark back', async ({ page }) => {
        const b = await research(page);
        await openLive(page, b);
        const r = row(page, 'Jinov');
        await expect(r.locator('.place-keep')).toHaveText('Keep');
        await r.locator('.place-keep').click();
        await expect(r).toHaveAttribute('data-state', 'placed');
        await expect(r).not.toHaveClass(/is-check/);
        await expect(chip(page, 'check')).toHaveCount(0);
        const geo = await page.evaluate(() => window.Strom.DataManager.getData().places?.jinov);
        expect(geo).toMatchObject({ lat: 50.3, lon: 16.9, label: 'Jinov' });
        expect(typeof geo?.keptAt).toBe('string');

        await page.evaluate(() => window.Strom.UI.performUndo());
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getData().places?.jinov?.keptAt)).toBeUndefined();
        await expect(row(page, 'Jinov')).toHaveAttribute('data-state', 'check');
        await expect(chip(page, 'check').locator('.places-chip-n')).toHaveText('1');
    });

    test('a research without place identification: the states, but no ◆ step, Select or ⋯', async ({ page }) => {
        const b = await research(page, { features: [] });
        await open(page);
        await expect(modal(page)).toBeVisible();
        await expect(row(page, 'Jinov')).toHaveAttribute('data-state', 'check');
        await expect(row(page, 'Horní Lhota')).toHaveAttribute('data-state', 'none');
        await expect(modal(page).locator('.is-research')).toHaveCount(0);
        await expect(modal(page).locator('.places-select-btn, .places-more-btn, .place-select')).toHaveCount(0);
        expect(b.places!.reads).toBe(0);
        // "No location": the research cannot look them up yet, it says so.
        await chip(page, 'none').click();
        await expect(modal(page).locator('.places-context')).toHaveAttribute('data-context', 'old');
    });
});

test('a tree without a research: no ◆ step, Select or ⋯; the app\'s check still marks', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await seedTree(page, {
        a: { firstName: 'Zorbin', lastName: 'Brindak', birthDate: '1860', birthPlace: 'Lhota', deathDate: '1878', deathPlace: 'Lhotínek' },
        b: { firstName: 'Quilla', lastName: 'Brindak', birthDate: '1865', birthPlace: 'Lhotov', deathDate: '1875', deathPlace: 'Jinov' },
        c: { firstName: 'Yarek', lastName: 'Brindak', birthDate: '1870', birthPlace: 'Horní Lhota' },
    } as never, 'Brindak');
    await setGeos(page);
    await open(page);
    await expect(modal(page)).toBeVisible();
    await expect(row(page, 'Jinov')).toHaveAttribute('data-state', 'check');
    await expect(row(page, 'Horní Lhota').locator('.place-find')).toBeVisible();
    await expect(modal(page).locator('.is-research')).toHaveCount(0);
    await expect(modal(page).locator('.places-select-btn, .places-more-btn, .place-select')).toHaveCount(0);
    // Without a research only the app's own chips.
    expect(await modal(page).locator('.places-chip').evaluateAll(cs => cs.map(c => (c as HTMLElement).dataset.filter)))
        .toEqual(['map', 'check', 'none']);
    await expect(modal(page).locator('.places-intro')).not.toContainText('the research');
});

/** A phone, upright and sideways: the research is on the computer; no ◆ step, nothing wider than the screen. */
for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`a phone at ${size.width}×${size.height}: no ◆ step, no horizontal scroll`, async ({ page }) => {
        await page.setViewportSize(size);
        const b = await research(page);
        await open(page);
        await expect(modal(page)).toBeVisible();
        await expect(row(page, 'Jinov')).toHaveAttribute('data-state', 'check');
        await expect(modal(page).locator('.places-context')).toHaveAttribute('data-context', 'phone');
        await expect(modal(page).locator('.is-research')).toHaveCount(0);
        await expect(modal(page).locator('.places-select-btn, .places-more-btn, .place-select')).toHaveCount(0);
        expect(b.places!.identify).toEqual([]);
        // Why here opens inside the row.
        await row(page, 'Lhota').locator('.place-why-toggle').click();
        await expect(row(page, 'Lhota').locator('.place-why')).toBeVisible();
        const box = await page.evaluate(() => {
            const content = document.querySelector('#places-modal .modal-content') as HTMLElement;
            const rows = [...document.querySelectorAll<HTMLElement>('#places-modal .place-row[data-key]')].filter(r => r.offsetParent !== null);
            const over = Math.max(0, ...rows.flatMap(r => [...r.querySelectorAll<HTMLElement>('*')])
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
        expect(box.over).toBeLessThanOrEqual(0);
    });
}

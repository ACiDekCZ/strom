import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedTree, cardBoxesMatchLayout } from './helpers.js';
import { syntheticTree } from '../src/__tests__/helpers/synthetic-tree';
import { calibrationWorkload, machineFactor, normalizedMs } from '../src/__tests__/helpers/perf-budget';

/**
 * Settings → Person card → Photo on the card (spec 096 §1–§6): the size and
 * shape, Small + Circle by default (the card as it always was), the preview
 * with a stand-in photo, the Normal card with a medium or large photo in the
 * tree (only cards with a photo taller), the cards of details with the photo
 * in their header, a view without a photo kept small, the Compact card
 * without the choice, the widths of a phone, a tablet and a desktop, and the
 * drawing of a large tree against a calibrated budget. Invented people.
 */

/** A photo (a 1 × 1 PNG data URI), so no file is needed. */
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function tree(page: Page, withPhoto = true): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        p1: { firstName: 'Florimund', lastName: 'Pfefferkorn', partners: ['p2'], ...(withPhoto ? { photo: PHOTO } : {}) },
        p2: { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female' },
        p3: { firstName: 'Kasimir', lastName: 'Pfefferkorn', parents: ['p1', 'p2'] },
    }, 'Pfefferkorn', 'p3');
    await page.evaluate(() => document.fonts.ready);
}

async function openSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(page.locator('#settings-modal')).toBeVisible();
}

const photoRow = (page: Page) => page.locator('#card-photo-settings');
const sizeBtn = (page: Page, name: string) => photoRow(page).locator('.card-look-photo-size').getByRole('button', { name, exact: true });
const shapeBtn = (page: Page, name: string) => photoRow(page).locator('.card-look-photo-shape').getByRole('button', { name, exact: true });
const box = async (page: Page, firstName: string) => {
    const b = await card(page, firstName).evaluate(el => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }));
    return [b.w, b.h];
};

test('the row sits between the card types and the preview; Small + Circle by default, the card as before', async ({ page }) => {
    await tree(page);
    await openSettings(page);
    const ids = await page.locator('#settings-modal .settings-group-body > .settings-row').evaluateAll(rows => rows.map(r => r.id));
    expect(ids.indexOf('card-photo-settings')).toBe(ids.indexOf('card-type-settings') + 1);
    expect(ids.indexOf('card-preview-settings')).toBe(ids.indexOf('card-photo-settings') + 1);
    await expect(photoRow(page).locator('.card-photo-title')).toHaveText('Photo on the card');
    await expect(photoRow(page).locator('.card-look-photo-size')).toHaveAccessibleName('Size');
    await expect(photoRow(page).locator('.card-look-photo-shape')).toHaveAccessibleName('Shape');
    await expect(photoRow(page).locator('[aria-pressed="true"]')).toHaveText(['Small', 'Circle']);
    await expect(photoRow(page).locator('.card-photo-note')).toContainText('People without a photo keep small initials.');
    // The preview as it always was: the initials, 188 × 64.
    await expect(page.locator('#card-preview-settings .card-preview-size')).toHaveText('card 188 × 64 px');
    await expect(page.locator('#card-preview-settings .avatar-initials')).toHaveText('JV');
    await expect(page.locator('body')).toHaveAttribute('data-card-photo', 'small');
    expect(await box(page, 'Florimund')).toEqual([188, 64]);
    expect(await box(page, 'Kasimir')).toEqual([188, 64]);
});

test('a large photo: the card with a photo 236 × 96, the others 236 × 64; stored, kept after a reload', async ({ page }) => {
    await tree(page);
    await openSettings(page);
    await sizeBtn(page, 'Large').click();
    await expect(sizeBtn(page, 'Large')).toHaveAttribute('aria-pressed', 'true');
    await expect(sizeBtn(page, 'Large')).toBeFocused();
    // The preview: the stand-in photo in the large box.
    await expect(page.locator('#card-preview-settings .card-preview-size')).toHaveText('card 236 × 96 px');
    await expect(page.locator('#card-preview-settings .preview-card.has-photo .card-avatar img')).toHaveCount(1);
    await expect(page.locator('body')).toHaveAttribute('data-card-photo', 'large');
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    expect(await box(page, 'Florimund')).toEqual([236, 96]);
    expect(await box(page, 'Kasimir')).toEqual([236, 64]);
    const avatar = await card(page, 'Florimund').locator('.card-avatar').evaluate(el => (el as HTMLElement).offsetWidth);
    expect(avatar).toBe(80);
    // Beside the initials of a card without a photo: 34px, as before.
    expect(await card(page, 'Kasimir').locator('.card-avatar').evaluate(el => (el as HTMLElement).offsetWidth)).toBe(34);
    // The name of the large card at the height of the name beside it (D13): both centred on
    // y = 32 within 2px (the large card's name on two rows, the other's on one). Neither is
    // the focus, whose border is wider; in CSS px whatever the zoom.
    const nameMiddle = (n: string) => card(page, n).locator('.name-text').evaluate(el => {
        const c = el.closest<HTMLElement>('.person-card')!;
        const r = c.getBoundingClientRect();
        const t = el.getBoundingClientRect();
        return ((t.top + t.bottom) / 2 - r.top) * c.offsetHeight / r.height;
    });
    expect(Math.abs(await nameMiddle('Florimund') - 32)).toBeLessThanOrEqual(2);
    expect(Math.abs(await nameMiddle('Florimund') - await nameMiddle('Quirinella'))).toBeLessThanOrEqual(2);
    // Nothing spills over (once the names are fitted to the wider column).
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .name-text, #tree-canvas .meta-text')]
        .filter(el => el.scrollWidth > el.clientWidth + 0.5).map(el => el.textContent))).toEqual([]);

    await shapeBtn(page, 'Rounded square').click();
    await expect(page.locator('body')).toHaveAttribute('data-card-photo-shape', 'rounded');
    await expect(card(page, 'Florimund').locator('.card-avatar')).toHaveCSS('border-radius', '12px');
    await expect(card(page, 'Kasimir').locator('.card-avatar')).toHaveCSS('border-radius', '5px');
    expect(await page.evaluate(() => window.Strom.SettingsManager.getCardPhoto())).toEqual({ size: 'large', shape: 'rounded' });

    await page.reload();
    await expect(card(page, 'Florimund')).toBeVisible();
    await expect.poll(() => box(page, 'Florimund')).toEqual([236, 96]);
});

test('a medium photo: every card 200 wide, none taller', async ({ page }) => {
    await tree(page);
    await openSettings(page);
    await sizeBtn(page, 'Medium').click();
    await expect(page.locator('#card-preview-settings .card-preview-size')).toHaveText('card 200 × 64 px');
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    expect(await box(page, 'Florimund')).toEqual([200, 64]);
    expect(await box(page, 'Kasimir')).toEqual([200, 64]);
    expect(await card(page, 'Florimund').locator('.card-avatar').evaluate(el => (el as HTMLElement).offsetWidth)).toBe(48);
});

test('a view without a photo keeps the small card (D3); the Compact card has the choice off', async ({ page }) => {
    await tree(page, false);
    await openSettings(page);
    await sizeBtn(page, 'Large').click();
    await expect(page.locator('#card-preview-settings .card-preview-size')).toHaveText('card 236 × 96 px');
    await expect(page.locator('body')).toHaveAttribute('data-card-photo', 'small');
    expect(await box(page, 'Florimund')).toEqual([188, 64]);

    await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
    await expect(photoRow(page)).toHaveClass(/is-off/);
    await expect(photoRow(page).locator('.card-photo-note')).toHaveText('The Compact card has no photo.');
    await expect(photoRow(page).locator('button:disabled')).toHaveCount(5);
    await expect(photoRow(page).locator('.card-look-photo-size')).toHaveAttribute('aria-disabled', 'true');
    // The choice is kept.
    await expect(photoRow(page).locator('[aria-pressed="true"]')).toHaveText(['Large', 'Circle']);
});

/** The geometry of a card of details: its box, the avatar, the header, where its lines start and its name's top (CSS px). */
async function fieldCard(page: Page, firstName: string) {
    return card(page, firstName).evaluate(el => {
        const c = el as HTMLElement;
        const r = c.getBoundingClientRect();
        const k = c.offsetHeight / r.height;
        const at = (sel: string) => {
            const e = c.querySelector<HTMLElement>(sel);
            // From the inside of the card's border (src/card-width.ts counts from there).
            return e ? (e.getBoundingClientRect().top - r.top) * k - c.clientTop : null;
        };
        return {
            w: c.offsetWidth, h: c.offsetHeight,
            avatar: c.querySelector<HTMLElement>('.card-avatar')!.offsetWidth,
            head: c.querySelector<HTMLElement>('.card-head')!.offsetHeight,
            lines: at('.card-lines'), name: at('.name-text'),
        };
    });
}

/** Nothing spills over on the drawn cards: names, dates, lines (scrollWidth ≤ clientWidth). */
const spilled = (page: Page) => page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#tree-canvas .name-text, #tree-canvas .meta-text, #tree-canvas .card-line')]
        .filter(el => el.scrollWidth > el.clientWidth + 0.5).map(el => el.textContent));

/** Pairs of drawn cards whose boxes overlap. */
const overlaps = (page: Page) => page.evaluate(() => {
    const rects = [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')].map(c => c.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) n++;
    }
    return n;
});

test('the Detailed card with a large photo: 72px in the header, the lines from 88px, the name where it stands beside the initials', async ({ page }) => {
    await tree(page);
    await page.evaluate(() => {
        window.Strom.SettingsManager.setCardPhoto({ size: 'large', shape: 'circle' });
        window.Strom.UI.setCardDensity('detailed');
    });
    await expect(page.locator('body')).toHaveAttribute('data-card-photo', 'large');
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    const photo = await fieldCard(page, 'Florimund');
    const initials = await fieldCard(page, 'Kasimir');
    expect(photo.avatar).toBe(72);
    expect(photo.head).toBe(72);
    expect(photo.lines).toBeCloseTo(88, 0);
    // Without a photo: the 30px initials, its own lines from 46px (the height "equal": one view height).
    expect(initials.avatar).toBe(30);
    expect(initials.lines).toBeCloseTo(46, 0);
    expect(photo.w).toBe(initials.w);
    // The name at the same height on either card (D13).
    expect(Math.abs(photo.name! - initials.name!)).toBeLessThanOrEqual(1);
    expect(await spilled(page)).toEqual([]);
    expect(await overlaps(page)).toBe(0);
    // The outputs draw the photo as the screen does (spec 096 P2): the image export's card box is the screen's.
    const poster = await page.evaluate(() => window.Strom.TreeRenderer.getPosterCardBox());
    expect(poster).toEqual(await page.evaluate(() => window.Strom.TreeRenderer.getCardBox()));
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getPosterCardPhoto().size)).toBe('large');
    await page.evaluate(() => window.Strom.SettingsManager.setCardPhoto({ size: 'small', shape: 'circle' }));
    await page.evaluate(() => window.Strom.TreeRenderer.render());
    await expect(page.locator('body')).toHaveAttribute('data-card-photo', 'small');
    // Back to the small photo: the image export's card shorter again.
    const small = await page.evaluate(() => window.Strom.TreeRenderer.getPosterCardBox());
    expect(small.cardHeight).toBeLessThan(poster.cardHeight);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getPosterCardPhoto().size)).toBe('small');
    expect((await fieldCard(page, 'Florimund')).avatar).toBe(30);
    expect((await fieldCard(page, 'Florimund')).lines).toBeCloseTo(46, 0);
});

test('Custom, one row a detail, height "equal": every card 98 + 17n with a large photo, 70 + 17n with a medium one', async ({ page }) => {
    await tree(page);
    await page.evaluate(() => {
        const s = window.Strom.SettingsManager;
        s.setCardFields({ ...s.getCardFields(), lines: 1, height: 'view', years: true, on: ['birth', 'death'] });
        s.setCardPhoto({ size: 'large', shape: 'rounded' });
        window.Strom.UI.setCardDensity('custom');
    });
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    const n = 2;
    const photo = await fieldCard(page, 'Florimund');
    const initials = await fieldCard(page, 'Kasimir');
    // The pills' 12px room below when a card of the view has one.
    expect([98 + 17 * n, 98 + 17 * n + 12]).toContain(photo.h);
    expect(initials.h).toBe(photo.h);
    expect(photo.avatar).toBe(72);
    await expect(card(page, 'Florimund').locator('.card-avatar')).toHaveCSS('border-radius', '10px');
    await expect(card(page, 'Kasimir').locator('.card-avatar')).toHaveCSS('border-radius', '4px');
    expect(await spilled(page)).toEqual([]);

    await page.evaluate(() => window.Strom.SettingsManager.setCardPhoto({ size: 'medium', shape: 'circle' }));
    await page.evaluate(() => window.Strom.TreeRenderer.render());
    await expect.poll(() => fieldCard(page, 'Florimund').then(c => c.avatar)).toBe(44);
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    const medium = await fieldCard(page, 'Florimund');
    expect([70 + 17 * n, 70 + 17 * n + 12]).toContain(medium.h);
    expect(medium.head).toBe(44);
    expect(medium.lines).toBeCloseTo(60, 0);
    expect((await fieldCard(page, 'Kasimir')).h).toBe(medium.h);
    expect(await overlaps(page)).toBe(0);
});

test('the Register card (height by content) with a large photo: only the card with a photo taller', async ({ page }) => {
    await tree(page);
    await page.evaluate(() => window.Strom.UI.setCardDensity('register'));
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    const before = await fieldCard(page, 'Kasimir');
    await page.evaluate(() => window.Strom.SettingsManager.setCardPhoto({ size: 'large', shape: 'circle' }));
    await page.evaluate(() => window.Strom.TreeRenderer.render());
    await expect.poll(() => fieldCard(page, 'Florimund').then(c => c.avatar)).toBe(72);
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    const photo = await fieldCard(page, 'Florimund');
    expect(photo.head).toBeGreaterThanOrEqual(72);
    expect(photo.lines).toBeGreaterThanOrEqual(88 - 0.5);
    // The card without a photo keeps its own height (its width may follow the wider view).
    expect((await fieldCard(page, 'Kasimir')).h).toBe(before.h);
    expect(await spilled(page)).toEqual([]);
    expect(await overlaps(page)).toBe(0);
});

/**
 * The calibration of the large tree's drawing (as e2e/tree-overview.spec.ts
 * K1.5, src/__tests__/helpers/perf-budget.ts): rounds of the script workload
 * and the best time of the whole calibration (script + DOM) on the reference
 * machine at rest. The budgets are in ms on that machine (normalized).
 */
const PERF_CALIBRATION_ROUNDS = 16;
const PERF_CALIBRATION_REFERENCE_MS = 155;
/**
 * The drawing of the tree (about 480 cards of a 5 000-person tree) with a
 * large photo on the reference machine at rest (normalized ms): about 350 ms
 * there with any photo size (15 Nov 2026), so the budget catches a drawing
 * three times slower.
 */
const PERF_BUDGET_MS = 1000;

test('a large tree with a medium and a large photo draws within the budget of the small one (spec 096 §6, perf)', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    // A third of the people with a photo (one src for all: as many images as before, D9).
    const { data } = syntheticTree({ persons: 5000, seed: 11 });
    let i = 0;
    for (const p of Object.values(data.persons)) if (!p.isPlaceholder && i++ % 3 === 0) p.photo = PHOTO;
    // The focus: the founder with the most descendants, so the view draws hundreds of cards.
    const children = new Map<string, string[]>();
    for (const u of Object.values(data.partnerships)) {
        for (const pid of [u.person1Id, u.person2Id]) children.set(pid, [...(children.get(pid) ?? []), ...u.childIds]);
    }
    const descendants = (id: string): number => {
        const seen = new Set<string>();
        const stack = [...(children.get(id) ?? [])];
        while (stack.length) {
            const c = stack.pop()!;
            if (seen.has(c)) continue;
            seen.add(c);
            stack.push(...(children.get(c) ?? []));
        }
        return seen.size;
    };
    const founders = Object.values(data.persons).filter(p => p.parentIds.length === 0 && !p.isPlaceholder);
    const rootId = founders.map(p => ({ id: p.id, n: descendants(p.id) })).sort((a, b) => b.n - a.n)[0].id;
    const cards = await page.evaluate(async ({ data, rootId }) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Syntetický');
        S.TreeRenderer.setFocus(rootId);
        S.TreeRenderer.setFocusDepth(2, 6);
        await S.TreeRenderer.renderAsync();
        return document.querySelectorAll('#tree-canvas .person-card').length;
    }, { data, rootId });
    expect(cards).toBeGreaterThan(300);
    const calibrate = async (): Promise<number> => {
        const script = await page.evaluate(([fn, rounds]) => {
            const w = window as unknown as { __calibration?: (r: number) => number };
            w.__calibration ??= new Function(`return (${fn})`)() as (r: number) => number;
            const t = performance.now();
            w.__calibration(rounds);
            return performance.now() - t;
        }, [calibrationWorkload.toString(), PERF_CALIBRATION_ROUNDS] as const);
        const dom = await page.evaluate(() => {
            const t = performance.now();
            const box = document.createElement('div');
            box.style.cssText = 'position:absolute;left:0;top:0;width:1200px;visibility:hidden';
            for (let i = 0; i < 2000; i++) {
                const el = document.createElement('div');
                el.className = 'tov-card';
                el.style.cssText = 'display:inline-block;width:110px;padding:4px;margin:2px;border:1px solid';
                el.textContent = `Calibration ${i} · ${1700 + (i % 300)}`;
                box.appendChild(el);
            }
            document.body.appendChild(box);
            let h = 0;
            for (let i = 0; i < 2000; i += 100) h += (box.children[i] as HTMLElement).offsetTop;
            box.remove();
            return h >= 0 ? performance.now() - t : 0;
        });
        return script + dom;
    };
    /** One drawing of the tree after the photo's size changed, to the frame laid out. */
    const draw = (size: 'small' | 'medium' | 'large') => page.evaluate(async (size) => {
        const S = window.Strom;
        S.SettingsManager.setCardPhoto({ size, shape: 'circle' });
        const t0 = performance.now();
        await S.TreeRenderer.renderAsync();
        void document.body.offsetHeight;
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        return performance.now() - t0;
    }, size);
    for (const size of ['small', 'medium', 'large'] as const) await draw(size); // warm-up (JIT)
    await calibrate();
    const best: Record<string, number> = { small: Infinity, medium: Infinity, large: Infinity };
    const log: string[] = [];
    for (let round = 0; round < 3; round++) {
        for (const size of ['small', 'medium', 'large'] as const) {
            // Away from the size first, so each drawing is a change of size.
            await page.evaluate((s) => window.Strom.SettingsManager.setCardPhoto({ size: s, shape: 'circle' }), size === 'small' ? 'large' : 'small');
            await page.evaluate(() => window.Strom.TreeRenderer.renderAsync());
            const cal = await calibrate();
            const ms = await draw(size);
            const n = normalizedMs(ms, cal, PERF_CALIBRATION_REFERENCE_MS);
            best[size] = Math.min(best[size], n);
            log.push(`${size} ${ms.toFixed(0)} (×${machineFactor(cal, PERF_CALIBRATION_REFERENCE_MS).toFixed(2)})`);
        }
    }
    console.log(`[card-photo perf] ${cards} cards: ${log.join(' / ')}; best normalized small ${best.small.toFixed(0)}, medium ${
        best.medium.toFixed(0)}, large ${best.large.toFixed(0)} ms`);
    // The drawing with a medium or large photo costs at most half as much again as with the small one
    // (no new images, effects or elements; the wider view is laid out once more), and stays within
    // the budget of the reference machine.
    expect(best.medium).toBeLessThan(best.small * 1.5 + 50);
    expect(best.large).toBeLessThan(best.small * 1.5 + 50);
    expect(best.large).toBeLessThan(PERF_BUDGET_MS);
});

/** The tree of the width checks: a long name with a photo beside short ones, photos on two generations. */
async function wideTree(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        p1: { firstName: 'Florimund', lastName: 'Pfefferkorn', partners: ['p2'], photo: PHOTO, birthDate: '1871-03-04', deathDate: '1939-11-20' },
        p2: { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female', birthDate: '1875' },
        p3: { firstName: 'Kasimir', lastName: 'Pfefferkorn', parents: ['p1', 'p2'], birthDate: '1899-01-12' },
        p4: { firstName: 'Zebedäus Fridolinus', lastName: 'Quackenbusch-Pfefferkorn', parents: ['p1', 'p2'], photo: PHOTO, birthDate: '1902' },
        p5: { firstName: 'Hyacintha', lastName: 'Pfefferkornová', gender: 'female', parents: ['p1', 'p2'], photo: PHOTO },
    }, 'Pfefferkorn', 'p3');
    await page.evaluate(() => document.fonts.ready);
}

for (const width of [390, 1024, 1440]) {
    test(`${width} px: every card type with a medium and a large photo, nothing spills over, no cards overlap`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await wideTree(page);
        for (const density of ['normal', 'detailed', 'register', 'custom'] as const) {
            for (const [size, shape] of [['medium', 'circle'], ['large', 'rounded']] as const) {
                await page.evaluate(({ density, size, shape }) => {
                    window.Strom.SettingsManager.setCardPhoto({ size, shape });
                    window.Strom.UI.setCardDensity(density);
                    window.Strom.TreeRenderer.render();
                }, { density, size, shape });
                const label = `${density} ${size}`;
                await expect(page.locator('body'), label).toHaveAttribute('data-card-photo', size);
                await expect.poll(() => cardBoxesMatchLayout(page), label).toBe(true);
                await expect.poll(() => spilled(page), label).toEqual([]);
                expect(await overlaps(page), label).toBe(0);
                const avatar = await card(page, 'Hyacintha').locator('.card-avatar').evaluate(el => (el as HTMLElement).offsetWidth);
                expect(avatar, label).toBe(density === 'normal' ? (size === 'large' ? 80 : 48) : (size === 'large' ? 72 : 44));
            }
        }
    });
}

for (const [w, h, name] of [[390, 844, '390 px'], [844, 390, 'held sideways']] as const) test.describe(`Settings on a phone, ${name} (touch)`, () => {
    test.use({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });

    test(`${name}: the labels above the segments, the segments across, a thumb high; in German too`, async ({ page }) => {
        await tree(page);
        for (const lang of ['en', 'de'] as const) {
            await page.evaluate((lang) => window.Strom.UI.setLanguage(lang as never), lang);
            await openSettings(page);
            const row = photoRow(page);
            await row.scrollIntoViewIfNeeded();
            const segments = row.locator('.card-look-segment');
            const labels = row.locator('.card-look-label');
            for (let i = 0; i < 2; i++) {
                const l = (await labels.nth(i).boundingBox())!;
                const s = (await segments.nth(i).boundingBox())!;
                expect(l.y + l.height, lang).toBeLessThanOrEqual(s.y + 0.5);
                expect(Math.abs(l.x - s.x), lang).toBeLessThanOrEqual(1);
            }
            const grid = (await row.locator('.card-photo-grid').boundingBox())!;
            for (let i = 0; i < 2; i++) expect((await segments.nth(i).boundingBox())!.width, lang).toBeGreaterThanOrEqual(grid.width - 1);
            for (const h of await row.locator('.segment-btn').evaluateAll(bs => bs.map(b => (b as HTMLElement).offsetHeight))) {
                expect(h, lang).toBeGreaterThanOrEqual(44);
            }
            // Nothing wider than the row, no text cut.
            expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth), lang).toBe(true);
            expect(await row.locator('.segment-btn').evaluateAll(bs => bs.filter(b => b.scrollWidth > b.clientWidth + 0.5).length), lang).toBe(0);
            await page.keyboard.press('Escape');
            await expect(page.locator('#settings-modal')).toBeHidden();
        }
    });
});

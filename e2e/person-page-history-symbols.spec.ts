import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { fakeBridge, fakeHistoryR1, historyGed, openResearch, poll, HISTORY_R1_FEATURES, FakeHistory } from './research-bridge.js';

/**
 * History symbols on the person page (DEV symboly-dejin, round 3 §10): a
 * history row's circle on the line carries the kind's symbol in the origin's
 * colour with the origin (◇ ▲ ■) small at its corner (10c), the person's own
 * rows the person card's glyphs, the life chart the kind's symbol with the
 * origin small under it (G3), a legend row of the kinds present, and the text
 * column exactly as wide as without history (1440 and 390). Invented data
 * (fakeHistoryR1): Jan lived in Čapkov 1860–1910.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];

/** fakeHistoryR1 (war 1866, state 1867, a local fire 1880) + an epidemic, an event of the place, a census and an emigration. */
function pageHistory(): FakeHistory {
    const h = fakeHistoryR1();
    const capkov = { key: 'Čapkov', id: 'L0001', name: { cs: 'Čapkov', en: 'Čapkov', de: 'Čapkov' } };
    const bohemia = { id: 'cz-bohemia', name: { cs: 'Čechy', en: 'Bohemia', de: 'Böhmen' } };
    (h.payload.events as Record<string, unknown>[]).push(
        { id: 'E6', from: 1866, kind: 'epidemic', scope: 'region', region: bohemia,
            text: { cs: 'Cholera po válce.', en: 'Cholera after the war.', de: 'Cholera nach dem Krieg.' },
            source: { title: 'Invented chronicle', url: 'https://example.org/cholera-1866', checked: '2026-10-01' } },
        { id: 'E5', from: 1885, kind: 'economy', scope: 'place', place: capkov,
            text: { cs: 'Otevřen cukrovar u Čapkovi.', en: 'A sugar factory opened near Čapkov.', de: 'Eine Zuckerfabrik bei Čapkov eröffnet.' },
            source: { title: 'Invented town chronicle', url: 'https://example.org/sugar-1885', checked: '2026-10-01' } },
        { id: 'E7', from: 1890, kind: 'census', scope: 'region', region: bohemia,
            text: { cs: 'Sčítání lidu.', en: 'A census.', de: 'Eine Volkszählung.' },
            source: { title: 'Invented encyclopedia', url: 'https://example.org/census-1890', checked: '2026-10-01' } },
        { id: 'E8', from: 1898, kind: 'emigration', scope: 'place', place: capkov,
            text: { cs: 'Vystěhování do Nebrasky.', en: 'Emigration to Nebraska.', de: 'Auswanderung nach Nebraska.' },
            source: { title: 'Invented town chronicle', url: 'https://example.org/nebraska-1898', checked: '2026-10-01' } },
    );
    const place = h.payload.places['Čapkov'] as Record<string, unknown>;
    place.events = [...(place.events as string[]), 'E6', 'E5', 'E7', 'E8'];
    place.history = 'done';
    place.at = '2026-10-26T10:00:00Z';
    return h;
}

const win = (page: Page) => page.locator('#person-page-modal');

async function openPage(page: Page, width: number, height: number): Promise<void> {
    await page.setViewportSize({ width, height });
    const history = pageHistory();
    const ged = historyGed();
    await fakeBridge(page, { features: HISTORY_R1_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await page.evaluate(() => window.Strom.SettingsManager.setOnThisDay(false));
    await poll(page);
    await expect.poll(() => history.reads).toBeGreaterThan(0);
    const jan = await page.evaluate(() =>
        (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);
    await page.evaluate((id) => window.Strom.UI.showPersonPage(id as never), jan);
    await expect(win(page).locator('h1')).toContainText('Jan');
    await expect(win(page).locator('#pp-sec-timeline .pp-row--hist').first()).toBeVisible();
}

/** The own rows' text column and heights (the history rows hidden or not, these must not move). */
async function ownRows(page: Page): Promise<{ x: number; w: number; h: number }[]> {
    return win(page).locator('#pp-sec-timeline .pp-row--own').evaluateAll(rows => rows.map(r => {
        const t = r.querySelector('.pp-t')!.getBoundingClientRect();
        return { x: Math.round(t.left * 10) / 10, w: Math.round(t.width * 10) / 10, h: Math.round(r.getBoundingClientRect().height) };
    }));
}

for (const vp of [{ name: 'desktop 1440', width: 1440, height: 900 }, { name: 'phone 390', width: 390, height: 844 }]) {
    test(`person page, ${vp.name}: the kind's symbol in each history circle, the origin at its corner; the text column as wide as without history`, async ({ page }) => {
        await openPage(page, vp.width, vp.height);
        const w = win(page);
        const tl = w.locator('#pp-sec-timeline');

        // Every history row: the kind's SVG in the circle, its origin's class, the corner mark; no ◇ ▲ ■ text.
        const rows = tl.locator('.pp-row--hist');
        const n = await rows.count();
        expect(n).toBeGreaterThanOrEqual(7);
        const marks = await rows.evaluateAll(els => els.map(r => {
            const mk = r.querySelector('.pp-m .pp-mk')!;
            const box = mk.getBoundingClientRect();
            const sym = mk.querySelector(':scope > svg')?.getBoundingClientRect();
            return {
                title: mk.getAttribute('title'), dy: sym ? Math.round(sym.top - box.top) : -1,
                cls: mk.className, svg: mk.querySelectorAll(':scope > svg').length, corner: mk.querySelectorAll('.pp-mk-o').length,
                text: (mk.textContent ?? '').trim(), hidden: mk.getAttribute('aria-hidden'), w: Math.round(box.width), h: Math.round(box.height),
            };
        }));
        for (const m of marks) {
            expect(m.cls).toMatch(/^pp-mk pp-mk-h is-(region|place|local)$/);
            expect(m.svg).toBe(1);
            expect(m.corner).toBe(1);
            expect(m.text).toBe('');
            expect(m.hidden).toBe('true');
            expect([m.w, m.h]).toEqual([24, 24]);
            // Optical centring (Kolo 4 point 5): the 14 px symbol 5 px down the circle, war and state 1 px lower.
            expect(m.dy).toBe(m.title === 'war' || m.title === 'state and borders' ? 6 : 5);
        }
        for (const o of ['region', 'place', 'local']) expect(marks.some(m => m.cls.endsWith(`is-${o}`))).toBe(true);
        // The symbol takes the origin's text colour; the corner draws the origin's shape.
        const colors = await tl.evaluate(() => {
            const probe = (v: string) => { const s = document.createElement('span'); s.style.color = v; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; };
            const of = (o: string) => {
                const mk = document.querySelector(`#pp-sec-timeline .pp-mk-h.is-${o}`)!;
                const before = getComputedStyle(mk.querySelector('.pp-mk-o')!, '::before');
                return { color: getComputedStyle(mk).color, bb: before.borderBottomColor, bg: before.backgroundColor };
            };
            return {
                region: of('region'), place: of('place'), local: of('local'),
                histText: probe('var(--hist-text)'), placeText: probe('var(--hist-place-text)'), localText: probe('var(--hist-local-text)'),
                histPlace: probe('var(--hist-place)'), histLocal: probe('var(--hist-local)'),
            };
        });
        expect(colors.region.color).toBe(colors.histText);
        expect(colors.place.color).toBe(colors.placeText);
        expect(colors.local.color).toBe(colors.localText);
        expect(colors.place.bb).toBe(colors.histPlace);
        expect(colors.local.bg).toBe(colors.histLocal);

        // The person's own rows: the card's glyphs (SVG), no Unicode marks in the text.
        const own = await tl.locator('.pp-row--own .pp-mk').evaluateAll(els => els.map(el => ({ svg: el.querySelectorAll('svg').length, text: (el.textContent ?? '').trim() })));
        expect(own.length).toBeGreaterThanOrEqual(2);
        for (const o of own) expect(o).toEqual({ svg: 1, text: '' });

        // The text column: history rows share it; hiding the history leaves the own rows exactly as they were.
        const withHist = await ownRows(page);
        const histT = (await rows.first().locator('.pp-t').boundingBox())!;
        expect(Math.round(histT.x * 10) / 10).toBe(withHist[0].x);
        expect(Math.round(histT.width * 10) / 10).toBe(withHist[0].w);
        await w.locator('[data-pp-switch="history"]').click();
        await expect(rows.first()).toBeHidden();
        expect(await ownRows(page)).toEqual(withHist);
        await w.locator('[data-pp-switch="history"]').click();
        await expect(rows.first()).toBeVisible();

        // The legend: the origins row unchanged, under it only the kinds present, in the kinds' order.
        await expect(tl.locator('.pp-legend:not(.pp-chart-legend) .pp-hm')).toHaveCount(3);
        const kinds = tl.locator('.pp-legend-kinds > span');
        await expect(kinds).toHaveText(['war', 'epidemic', 'census', 'state and borders', 'emigration', 'economy', 'disaster']);
        await expect(tl.locator('.pp-legend-kinds .pp-lk svg')).toHaveCount(7);

        // The life chart: the kind's symbol and the small origin mark under it; the glyph's accessible name.
        const glyphs = w.locator('.pp-chart .pp-ch-hm');
        expect(await glyphs.count()).toBeGreaterThan(0);
        const g = await glyphs.evaluateAll(els => els.map(a => ({
            svg: a.querySelectorAll('.pp-ch-hg > svg').length,
            hg: a.querySelector('.pp-ch-hg')!.className, ho: a.querySelector('.pp-ch-ho')!.className,
            aria: a.getAttribute('aria-label') ?? '', text: (a.querySelector('.pp-ch-hg')!.textContent ?? '').trim(),
            size: Math.round(a.querySelector('.pp-ch-hg > svg')!.getBoundingClientRect().width),
        })));
        for (const x of g) {
            expect(x.svg).toBe(1);
            expect(x.hg).toMatch(/^pp-ch-hg is-(region|place|local)$/);
            expect(x.ho).toMatch(/^pp-ch-ho is-(region|place|local)$/);
            expect(x.aria).toMatch(/^\d{4}(–\d{4})?: [a-z ,]+$/);
            expect(x.text).toBe('');
            expect(x.size).toBe(vp.width < 641 ? 12 : 13);
        }
        expect(g.some(x => x.aria === '1866: war, epidemic' || x.aria.startsWith('1866–'))).toBe(true);
        // The phone's chart has no labels.
        if (vp.width < 641) await expect(w.locator('.pp-chart .pp-ch-hl')).toHaveCount(0);

        // Nothing wider than the column.
        expect(await w.locator('.pp-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
}

test('person page file: the symbols inline in currentColor, the kinds legend, nothing loaded', async ({ page, browser }) => {
    await openPage(page, 1280, 800);
    const w = win(page);
    await w.locator('.pp-save').click();
    const dlg = page.locator('#person-page-export-modal');
    const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
    const html = readFileSync(await download.path(), 'utf-8');
    expect(html).toMatch(/<span class="pp-mk pp-mk-h is-region" style="--dy:1px" title="war" aria-hidden="true"><svg class="hist-kind-svg"[^>]*stroke="currentColor"/);
    expect(html).toContain('<p class="pp-legend-kinds">');
    expect(html).toContain('--hist-place-text: #245868');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const requests: string[] = [];
    await ctx.route('**/*', (route) => { requests.push(route.request().url()); return route.abort(); });
    const file = await ctx.newPage();
    await file.setContent(html, { waitUntil: 'load' });
    await expect(file.locator('.pp-row--hist .pp-mk-h svg').first()).toBeVisible();
    // The file's tokens: the place's symbol takes --hist-place-text (not the circle's inherited colour).
    expect(await file.locator('.pp-mk-h.is-place').first().evaluate(el => getComputedStyle(el).color)).toBe('rgb(36, 88, 104)');
    await expect(file.locator('.pp-legend-kinds > span')).toHaveCount(7);
    expect(requests).toEqual([]);
    await ctx.close();
});

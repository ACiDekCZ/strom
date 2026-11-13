import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, personModal } from './helpers.js';

/**
 * How shared events look where several meet (spec 085 §2, findings A-N3 and
 * A-N4): the family timeline's labels never lie over a mark or another
 * label; the person dialog's "with …" line on a touch phone reads as one
 * line of text (each comma right after its name, one baseline) while every
 * name keeps a 44 px touch target; a role of its own in the event editor
 * looks like the role lists beside it and ends in "…" when it is longer.
 * German at 1440/1024/390, light and dark, with long names. Invented data,
 * a fixed clock.
 */

/**
 * Three generations: the census of 1921 at Sudivoj's household and his
 * mother Kunhuta (a role of her own), the emigration of 1925 of two of his
 * children, the residence of 1930 of his son's young family.
 */
async function family(page: Page, opts: { width: number; height?: number }): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-11-13T10:30:00Z'));
    await page.setViewportSize({ width: opts.width, height: opts.height ?? (opts.width <= 640 ? 844 : 900) });
    await openApp(page);
    await page.evaluate(async () => {
        const p = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                p_drahomil: p('p_drahomil', 'Drahomil Vojtěch', 'Hurdálek', 'male', { birthDate: '1848', deathDate: '1914', partnerships: ['u0'], childIds: ['p_sudivoj'] }),
                p_kunhuta: p('p_kunhuta', 'Kunhuta Eufrozína', 'Hurdálková', 'female', { birthDate: '1852', deathDate: '1931', partnerships: ['u0'], childIds: ['p_sudivoj'] }),
                p_sudivoj: p('p_sudivoj', 'Sudivoj Bonifác Drahoslav', 'Hurdálek-Smyšlenický', 'male', {
                    birthDate: '1879', deathDate: '1950', partnerships: ['u1'], parentIds: ['p_drahomil', 'p_kunhuta'],
                    childIds: ['p_bohuchval', 'p_zbyhnev', 'p_ctislava'],
                    events: [{ id: 'ev_cen', type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', address: 'č. 14', age: '42' }] }),
                p_radegunda: p('p_radegunda', 'Radegunda Ctibora Dobroslava', 'Hurdálková-Smyšlenická', 'female', {
                    birthDate: '1883', deathDate: '1955', partnerships: ['u1'], childIds: ['p_bohuchval', 'p_zbyhnev', 'p_ctislava'] }),
                p_bohuchval: p('p_bohuchval', 'Bohuchval', 'Hurdálek', 'male', {
                    birthDate: '1906', deathDate: '1980', parentIds: ['p_sudivoj', 'p_radegunda'], partnerships: ['u2'], childIds: ['p_velemir'],
                    events: [{ id: 'ev_res', type: 'residence', date: '1930', place: 'Praha' }] }),
                p_zbyhnev: p('p_zbyhnev', 'Zbyhněv', 'Hurdálek', 'male', { birthDate: '1910', deathDate: '1985', parentIds: ['p_sudivoj', 'p_radegunda'] }),
                p_ctislava: p('p_ctislava', 'Ctislava', 'Hurdálková', 'female', {
                    birthDate: '1912', deathDate: '1990', parentIds: ['p_sudivoj', 'p_radegunda'],
                    events: [{ id: 'ev_emi', type: 'emigration', date: '1925-04', place: 'Hamburg' }] }),
                p_bozetecha: p('p_bozetecha', 'Božetěcha', 'Hurdálková', 'female', { birthDate: '1909', partnerships: ['u2'], childIds: ['p_velemir'] }),
                p_velemir: p('p_velemir', 'Velemír', 'Hurdálek', 'male', { birthDate: '1932', parentIds: ['p_bohuchval', 'p_bozetecha'] }),
            },
            partnerships: {
                u0: { id: 'u0', person1Id: 'p_drahomil', person2Id: 'p_kunhuta', childIds: ['p_sudivoj'], status: 'married' },
                u1: { id: 'u1', person1Id: 'p_sudivoj', person2Id: 'p_radegunda', childIds: ['p_bohuchval', 'p_zbyhnev', 'p_ctislava'], status: 'married' },
                u2: { id: 'u2', person1Id: 'p_bohuchval', person2Id: 'p_bozetecha', childIds: ['p_velemir'], status: 'married' },
            },
        } as never, 'Rodokmen Hurdálků ze Smyšlenic 1879');
        const dm = window.Strom.DataManager;
        const ok = [
            dm.saveSharedEvent('p_sudivoj' as never, 'ev_cen', {
                common: {},
                own: new Map([['p_kunhuta', { age: '69', shareRole: 'švadlena a pradlena, vdova po hospodáři' }], ['p_radegunda', { age: '38' }],
                    ['p_bohuchval', { age: '15' }], ['p_zbyhnev', { age: '11' }], ['p_ctislava', { age: '9' }]]) as never,
                add: ['p_kunhuta', 'p_radegunda', 'p_bohuchval', 'p_zbyhnev', 'p_ctislava'] as never,
            }),
            dm.saveSharedEvent('p_bohuchval' as never, 'ev_res', { common: {}, own: new Map() as never, add: ['p_bozetecha', 'p_velemir'] as never }),
            dm.saveSharedEvent('p_ctislava' as never, 'ev_emi', { common: {}, own: new Map() as never, add: ['p_zbyhnev'] as never }),
        ];
        if (ok.some(x => !x)) throw new Error('not shared');
    });
}

/** The timeline's labels against its marks, links and each other: the pairs that overlap (more than half a pixel). */
async function labelClashes(page: Page): Promise<string[]> {
    return page.locator('#timeline-container').evaluate(root => {
        type B = { l: number; t: number; r: number; b: number; what: string };
        const box = (el: Element, what: string, grow = 0): B => {
            const r = el.getBoundingClientRect();
            return { l: r.left - grow, t: r.top, r: r.right + grow, b: r.bottom, what };
        };
        const labels = [...root.querySelectorAll('.tl-shared-label')].map(el => box(el, `label "${el.textContent}"`));
        const marks = [...root.querySelectorAll('.tl-shared')].flatMap(g => {
            const name = g.querySelector('title')?.textContent?.split(':')[0] ?? '?';
            return [...g.querySelectorAll('.tl-shared-mark')].map(el => box(el, `mark of ${name}`))
                .concat([...g.querySelectorAll('.tl-shared-link')].map(el => box(el, `link of ${name}`, 1)));
        });
        const hit = (a: B, b: B) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
        const out: string[] = [];
        labels.forEach((a, i) => {
            for (const m of marks) if (hit(a, m)) out.push(`${a.what} over ${m.what}`);
            labels.slice(i + 1).forEach(b => { if (hit(a, b)) out.push(`${a.what} over ${b.what}`); });
        });
        return out;
    });
}

async function openTimeline(page: Page): Promise<Locator> {
    await page.evaluate(() => {
        window.Strom.TreeRenderer.setFocus('p_drahomil' as never);
        window.Strom.TreeRenderer.setViewMode('timeline');
    });
    const tl = page.locator('#timeline-container');
    await expect(tl.locator('.tl-shared')).toHaveCount(3);
    return tl;
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('the family timeline: labels of shared events beside each other (A-N3)', () => {
    for (const width of [1440, 1024, 390]) {
        test(`${width}: no label over a mark or another label, every label there`, async ({ page }) => {
            await family(page, { width });
            const tl = await openTimeline(page);
            const labels = tl.locator('.tl-shared-label');
            await expect(labels).toHaveCount(3);
            // Each label whole, or cut with "…" only where nothing longer fits (the tooltip keeps the whole).
            const texts = await labels.allTextContents();
            for (const [t, whole] of [[texts.find(x => x.startsWith('Cen')), 'Census 1921'], [texts.find(x => x.startsWith('Emi')), 'Emigration 1925'], [texts.find(x => x.startsWith('Res')), 'Residence 1930']] as const) {
                expect(t, whole).toBeTruthy();
                if (width !== 390) expect(t).toBe(whole);
                else expect(t === whole || (t!.endsWith('…') && whole.startsWith(t!.slice(0, -1)))).toBe(true);
            }
            await expect(tl.locator('.tl-shared-tip title').first()).toHaveText(/^Census 1921: /);
            expect(await labelClashes(page)).toEqual([]);
            // Each label stays beside its own mark.
            const apart = await tl.evaluate(root => [...root.querySelectorAll('.tl-shared')].map(g => {
                const m = [...g.querySelectorAll('.tl-shared-mark')].map(el => el.getBoundingClientRect());
                const t = g.querySelector('.tl-shared-label')!.getBoundingClientRect();
                const l = Math.min(...m.map(r => r.left)), r = Math.max(...m.map(r => r.right));
                return Math.max(0, t.left - r, l - t.right);
            }));
            for (const d of apart) expect(d).toBeLessThanOrEqual(31);
            expect(await noOverflow(page)).toBe(0);
        });
    }

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark: no clash, no overflow`, async ({ page }) => {
            await family(page, { width });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                const tl = await openTimeline(page);
                await expect(tl.locator('.tl-shared-label')).toHaveCount(3);
                expect(await labelClashes(page)).toEqual([]);
                expect(await noOverflow(page)).toBe(0);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/S4-osa-de-${width}-${scheme}.png` });
            }
        });
    }
});

/** The "with …" line's pieces: "with", each name with its comma, "and N more" (rects of their glyphs). */
async function lineGeometry(line: Locator) {
    return line.evaluate(el => {
        const rectOf = (node: Node, from = 0, to?: number) => {
            const r = document.createRange();
            r.setStart(node, from);
            r.setEnd(node, to ?? (node.textContent ?? '').length);
            const b = r.getBoundingClientRect();
            return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
        };
        const text = el.querySelector('.shared-line-text')!;
        const lead = rectOf(text.firstChild!, 0, (text.firstChild!.textContent ?? '').trimEnd().length);
        const items = [...el.querySelectorAll('.shared-line-item')].map(item => {
            const button = item.querySelector('.shared-line-name')!;
            const name = rectOf(button.firstChild!);
            const comma = button.nextSibling ? rectOf(button.nextSibling) : null;
            const before = getComputedStyle(item, '::before');
            return { name, comma, hit: before.content === 'none' ? 0 : parseFloat(before.height) || 0, text: button.textContent };
        });
        const moreEl = el.querySelector('.shared-line-more');
        const more = moreEl ? rectOf(moreEl.firstChild!) : null;
        return { lead, items, more };
    });
}

test.describe('the "with" line on a touch phone: one line of text, 44 px targets (A-N4)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    for (const lang of ['en', 'de'] as const) {
        test(`${lang}: each comma right after its name, one baseline, a tap beside a name opens that person`, async ({ page }) => {
            await family(page, { width: 390 });
            if (lang === 'de') await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await page.evaluate(() => window.Strom.UI.showEditPersonModal('p_zbyhnev' as never));
            const modal = personModal(page);
            const line = modal.locator('#events-list .event-row', { hasText: /Census|Volkszählung/ }).locator('.shared-line');
            await expect(line).toHaveText(lang === 'en'
                ? 'with Kunhuta Eufrozína, Sudivoj Bonifác Drahoslav and 3 more'
                : 'mit Kunhuta Eufrozína, Sudivoj Bonifác Drahoslav und 3 weitere');
            await line.scrollIntoViewIfNeeded();
            const g = await lineGeometry(line);
            expect(g.items).toHaveLength(2);
            const first = g.items[0];
            // The comma right after the name, on its baseline.
            expect(first.comma).not.toBeNull();
            expect(first.comma!.left - first.name.right).toBeLessThanOrEqual(1);
            expect(first.comma!.left - first.name.right).toBeGreaterThanOrEqual(-1);
            expect(Math.abs(first.comma!.bottom - first.name.bottom)).toBeLessThanOrEqual(2);
            // "with" and the first name on one baseline; the next line's name a line of text below, not a button's height.
            expect(Math.abs(g.lead.bottom - first.name.bottom)).toBeLessThanOrEqual(2);
            for (const it of g.items) expect(it.hit).toBeGreaterThanOrEqual(44);
            const lineH = await line.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
            for (let k = 1; k < g.items.length; k++) {
                const dy = g.items[k].name.bottom - g.items[k - 1].name.bottom;
                expect(dy === 0 || Math.abs(dy - lineH) <= 2, `name ${k} ${dy}px below`).toBe(true);
            }
            if (g.more) {
                const last = g.items[g.items.length - 1].name;
                expect(g.more.bottom - last.bottom === 0 || Math.abs(g.more.bottom - last.bottom) <= 2 || Math.abs(g.more.bottom - last.bottom - lineH) <= 2).toBe(true);
            }
            if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/S4-spolu-${lang}-390.png` });
            // A tap 18 px above the first name (its 44 px target, outside the glyphs) opens that person, not the editor.
            await page.touchscreen.tap((first.name.left + first.name.right) / 2, (first.name.top + first.name.bottom) / 2 - 18);
            await expect(page.locator('#event-editor-modal')).not.toHaveClass(/active/);
            await expect(page.locator('#pm-name')).toContainText('Kunhuta');
        });
    }
});

test.describe('a role of its own in the event editor (A-N4)', () => {
    async function roleCells(page: Page) {
        const ed = page.locator('#event-editor-modal');
        await expect(ed).toHaveClass(/active/);
        const input = ed.locator('.sw-role-input');
        await expect(input).toHaveCount(1);
        await input.scrollIntoViewIfNeeded();
        return ed.evaluate(el => {
            const pick = (x: Element) => {
                const cs = getComputedStyle(x);
                const r = x.getBoundingClientRect();
                return { h: r.height, w: r.width, border: cs.border, radius: cs.borderRadius, font: cs.font, color: cs.color, bg: cs.backgroundColor, to: cs.textOverflow, sw: (x as HTMLElement).scrollWidth, cw: (x as HTMLElement).clientWidth };
            };
            const input = el.querySelector<HTMLInputElement>('.sw-role-input')!;
            const back = el.querySelector('.sw-role-back')!.getBoundingClientRect();
            const ir = input.getBoundingClientRect();
            return {
                input: pick(input), select: pick(el.querySelector('.sw-role-select')!), title: input.title, value: input.value,
                padRight: parseFloat(getComputedStyle(input).paddingRight), backInside: back.left >= ir.left && back.right <= ir.right && back.top >= ir.top - 0.5 && back.bottom <= ir.bottom + 0.5,
                backW: back.width, backCentre: (back.top + back.bottom) / 2 - (ir.top + ir.bottom) / 2,
            };
        });
    }

    for (const width of [1440, 1024, 390]) {
        test(`${width}: like the role lists beside it, "…" with the whole role in its title`, async ({ browser }) => {
            const touch = width === 390;
            const ctx = await browser.newContext({ viewport: { width, height: touch ? 844 : 900 }, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
            const page = await ctx.newPage();
            await family(page, { width });
            await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_sudivoj' as never, 'ev_cen'));
            const c = await roleCells(page);
            expect(c.value).toBe('švadlena a pradlena, vdova po hospodáři');
            expect(c.input.to).toBe('ellipsis');
            expect(c.title).toBe('švadlena a pradlena, vdova po hospodáři');
            expect(c.input.sw).toBeGreaterThan(c.input.cw);
            for (const k of ['h', 'w', 'border', 'radius', 'font', 'color', 'bg'] as const) expect(c.input[k], k).toBe(c.select[k]);
            // The chevron back to the list inside the field, centred, the text kept clear of it.
            expect(c.backInside).toBe(true);
            expect(Math.abs(c.backCentre)).toBeLessThanOrEqual(1);
            expect(c.padRight).toBeGreaterThanOrEqual(c.backW + 2);
            // Typing keeps the title whole.
            await page.locator('#event-editor-modal .sw-role-input').fill('teta');
            await expect(page.locator('#event-editor-modal .sw-role-input')).toHaveAttribute('title', 'teta');
            await ctx.close();
        });
    }

    for (const width of [1440, 1024, 390]) {
        test(`German at ${width}, light and dark: no overflow`, async ({ browser }) => {
            const touch = width === 390;
            const ctx = await browser.newContext({ viewport: { width, height: touch ? 844 : 900 }, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
            const page = await ctx.newPage();
            await family(page, { width });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await page.evaluate(() => window.Strom.UI.openEventEditorFor('p_sudivoj' as never, 'ev_cen'));
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                const c = await roleCells(page);
                expect(c.input.h).toBe(c.select.h);
                const over = await page.locator('#event-editor-modal').evaluate(el => {
                    const content = el.querySelector('.modal-content') as HTMLElement;
                    return Math.max(content.scrollWidth - content.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth);
                });
                expect(over).toBe(0);
                if (process.env.SNIMKY_DIR) await page.screenshot({ path: `${process.env.SNIMKY_DIR}/S4-role-de-${width}-${scheme}.png` });
            }
            await ctx.close();
        });
    }
});

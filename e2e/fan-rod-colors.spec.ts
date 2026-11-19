import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, seedTree, SeedPerson } from './helpers.js';

/**
 * The fan in family-line colours (spec 114 §4, §5): the legend in parts by
 * side with "Other", its rows choose the tree's family line (spec 039), the
 * mouse previews a line, the outline is a layer over all sectors.
 */

/** Fictional surnames: a new one for each woman's line (her father's line). */
const SURNAMES = ['Arvenko', 'Belmudr', 'Corvanek', 'Dresslin', 'Elvatch', 'Fornmeyr', 'Gallowik', 'Hestrand',
    'Ivoldt', 'Jarnwick', 'Kestrup', 'Lormacht', 'Mirvald', 'Norrgast', 'Ospreyk', 'Pellandt'];

/**
 * Four rings of ancestors (Ahnentafel 1–31): a father keeps the child's
 * surname, a mother brings her own. The father's side has lines of 5, 3, 2, 2
 * sectors, the mother's 4, 3, 2, 2, and eight lines are drawn once (each in
 * its colour, under "Other"; K1.7).
 */
function ancestors(): Record<string, SeedPerson> {
    const surname = new Map<number, string>();
    let next = 0;
    const people: Record<string, SeedPerson> = {};
    for (let n = 1; n <= 31; n++) {
        surname.set(n, n === 1 || n % 2 === 1 ? SURNAMES[next++] : surname.get(n / 2)!);
        people[`a${n}`] = {
            firstName: n === 1 ? 'Centrus' : `Anc${n}`, lastName: surname.get(n)!,
            gender: n === 1 || n % 2 === 0 ? 'male' : 'female',
            ...(n < 16 ? { parents: [`a${2 * n}`, `a${2 * n + 1}`] } : {}),
            ...(n > 1 && n % 2 === 0 ? { partners: [`a${n + 1}`] } : {}),
        };
    }
    return people;
}

async function openRodFan(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, ancestors(), 'Fan lines', 'a1');
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
    await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
    await expect(page.locator('.fan-focus')).toContainText('Centrus');
    await page.locator('#fan-toolbar [data-fan-color="rod"]').click();
    await expect(page.locator('#fan-toolbar [data-fan-color="rod"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#fan-legend-items .fan-legend-rods')).toBeVisible();
}

/** The people of the highlighted sectors and the outlines of the layer over them. */
function highlight(page: Page): Promise<{ hit: string[]; edges: number; dim: number; preview: boolean }> {
    return page.evaluate(() => {
        const chart = document.getElementById('fan-chart')!;
        const hit = [...chart.querySelectorAll<SVGGElement>('[data-fan-person].evidence-hit')];
        return {
            hit: [...new Set(hit.map(g => g.dataset.fanPerson!))],
            edges: chart.querySelectorAll('.fan-hl-layer .fan-hl-edge').length,
            dim: chart.querySelectorAll('[data-fan-person].evidence-dim').length,
            preview: chart.classList.contains('fan-rod-preview'),
        };
    });
}

/** The drawn people of a family line (as the fan's assignment knows it). */
function rodPeople(page: Page, rod: string): Promise<string[]> {
    return page.evaluate((id) => {
        const fan = window.Strom.TreeRenderer.getFanView()!;
        const a = fan.getRodAssignment()!;
        const people = new Set<string>();
        for (const g of document.querySelectorAll<SVGGElement>('#fan-chart [data-fan-person]')) {
            const pid = g.dataset.fanPerson!;
            if (a.index.rodByPerson.get(pid) === id) people.add(pid);
        }
        return [...people];
    }, rod);
}

test('fan family lines: the legend in parts by side, its rows are buttons in one tab stop (spec 114 §4)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRodFan(page);
    const items = page.locator('#fan-legend-items');
    const groups = items.locator('.fan-legend-group');
    await expect(groups).toHaveText(["Father's side", "Mother's side"]);
    // Each side's lines by count; the grey ones under "Other".
    const counts = () => page.evaluate(() => [...document.querySelectorAll('#fan-legend-items .fan-legend-rods > *')]
        .map(e => e.classList.contains('fan-legend-group') ? '|' : e.querySelector('.fan-legend-who')?.textContent ?? '').join(' '));
    expect(await counts()).toBe('| 5× 3× 2× 2× | 4× 3× 2× 2× 8×');
    // The centre's line first, with "· centre".
    const first = items.locator('button[data-fan-rod]').first();
    await expect(first.locator('.fan-legend-centre')).toHaveText('· centre');
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(first).toHaveAttribute('aria-label', /^Highlight the .+ family line, \d+ (person|people) in the fan, the centre person's line$/);
    await expect(items.locator('.fan-legend-rods')).toHaveAttribute('role', 'group');
    await expect(items.locator('.fan-legend-rods')).toHaveAttribute('aria-label', 'Family lines in the fan');

    // The counts: the parts, "Other" and no line add up to the drawn people (the centre included).
    const sums = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('#fan-legend-items .fan-legend-rods > :is(button[data-fan-rod]:not(.fan-legend-sub), .fan-legend-other, .fan-legend-norod:not(.fan-legend-sub))')];
        const n = rows.reduce((s, r) => s + parseInt(r.querySelector('.fan-legend-who')?.textContent ?? '0', 10), 0);
        const drawn = document.querySelectorAll('#fan-chart [data-fan-person]').length;
        return { n, drawn };
    });
    expect(sums.n).toBe(sums.drawn);

    // One tab stop: the first row; ↓ moves, End goes to the last.
    const rows = items.locator('.fan-legend-rods > button');
    await expect(items.locator('.fan-legend-rods > button[tabindex="0"]')).toHaveCount(1);
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(rows.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    // Enter presses the row (the line chosen), the focus stays on it.
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(first).toBeFocused();
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-pressed', 'false');
});

test('fan family lines: "Other" expands the smaller lines, in colour, kept on the device (spec 114 §4, K1.7)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRodFan(page);
    // No sector grey: every line has a colour (K1.7), every person here has a line.
    const fills = await page.evaluate(() => [...document.querySelectorAll<SVGPathElement>('#fan-chart [data-fan-person] .fan-fill')]
        .map(p => getComputedStyle(p).fill));
    expect(fills.length).toBe(30);
    expect(fills.filter(f => f === 'rgb(220, 215, 204)')).toEqual([]);
    expect(new Set(fills).size).toBeGreaterThan(12);
    const other = page.locator('#fan-legend-items .fan-legend-other');
    // Its swatch shows the colours of its first lines, not grey.
    const sw = await other.locator('.fan-sw').evaluate(e => getComputedStyle(e).backgroundImage);
    expect(sw).not.toContain('rgb(220, 215, 204)');
    await expect(other).toBeVisible();
    await expect(other).toHaveAttribute('aria-expanded', 'false');
    await expect(other.locator('.fan-legend-label')).toHaveText('Other · 8 lines');
    await expect(other.locator('.fan-legend-who')).toHaveText('8×');
    await expect(page.locator('#fan-legend-items .fan-legend-sub')).toHaveCount(0);
    await other.click();
    await expect(other).toHaveAttribute('aria-expanded', 'true');
    const n = parseInt((await other.locator('.fan-legend-label').textContent())!.replace(/\D+/g, ''), 10);
    await expect(page.locator('#fan-legend-items button.fan-legend-sub[data-fan-rod]')).toHaveCount(n);
    await expect(other).toBeFocused();
    // Each smaller line with its own colour; neighbours in the fan never share one.
    const subs = await page.locator('#fan-legend-items button.fan-legend-sub[data-fan-rod] .fan-sw').evaluateAll(es => es.map(e => getComputedStyle(e).backgroundImage));
    for (const b of subs) expect(b).not.toContain('rgb(220, 215, 204)');
    // A low window: the long legend scrolls inside its card and stops under the top-left row of pills (⌂).
    await page.setViewportSize({ width: 1440, height: 520 });
    await expect.poll(() => page.evaluate(() => {
        const box = (sel: string) => {
            const el = document.querySelector<HTMLElement>(sel);
            const r = el?.getBoundingClientRect();
            return r && r.width > 0 && getComputedStyle(el!).display !== 'none' ? r : null;
        };
        const legend = box('#fan-legend')!, stage = box('#fan-legend')!.top - box('.fan-stage')!.top;
        const home = box('#fan-home-pill');
        return { underPills: stage >= 55, clearOfHome: !home || home.bottom <= legend.top, scrolls: legend.height < document.querySelector('#fan-legend')!.scrollHeight };
    })).toEqual({ underPills: true, clearOfHome: true, scrolls: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    // A smaller line can be highlighted from the expanded list.
    const small = page.locator('#fan-legend-items button.fan-legend-sub[data-fan-rod]').first();
    await small.click();
    await expect(small).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#evidence-pill')).toBeVisible();
    // Closed, "Other" marks the chosen smaller line.
    await other.click();
    await expect(other).toHaveClass(/is-selected/);
    await page.reload();
    await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
    await expect(page.locator('#fan-legend-items .fan-legend-other')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#fan-legend-items .fan-legend-other').click();
    await page.reload();
    await expect(page.locator('#fan-legend-items .fan-legend-other')).toHaveAttribute('aria-expanded', 'true');
});

test('fan family lines: a row chooses the tree\'s line, a second press or Escape clears it (spec 114 §5)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRodFan(page);
    const row = page.locator('#fan-legend-items button[data-fan-rod]').nth(1);
    const rod = (await row.getAttribute('data-fan-rod'))!;
    const people = await rodPeople(page, rod);
    expect(people.length).toBeGreaterThan(1);

    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#evidence-pill')).toBeVisible();
    await expect.poll(async () => (await highlight(page)).hit.sort()).toEqual([...people].sort());
    let h = await highlight(page);
    const sectors = await page.locator('#fan-chart [data-fan-person].evidence-hit').count();
    expect(h.edges).toBe(sectors);
    expect(h.dim).toBeGreaterThan(0);
    expect(h.preview).toBe(false);
    // The outline is a layer over the sectors, not a stroke of the sector itself.
    expect(await page.evaluate(() => {
        const svg = document.querySelector('#fan-chart svg.fan-svg')!;
        const layer = svg.querySelector('.fan-hl-layer')!;
        const edge = layer.querySelector('.fan-hl-edge')!;
        const cs = getComputedStyle(edge);
        const last = [...svg.querySelectorAll('[data-fan-person]')].pop()!;
        return { after: !!(last.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING), dash: cs.strokeDasharray, w: cs.strokeWidth, fill: cs.fill };
    })).toEqual({ after: true, dash: '5px, 3px', w: '2px', fill: 'none' });
    // The tree's chosen line (spec 039): the Family view shows it too.
    expect(await page.evaluate(() => window.Strom.UI.selectedRod())).toBe(rod);

    // A second press: the whole tree.
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#evidence-pill')).toHaveCount(0);
    h = await highlight(page);
    expect(h).toEqual({ hit: [], edges: 0, dim: 0, preview: false });

    // Escape clears it too.
    await row.click();
    await expect(page.locator('#evidence-pill')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#evidence-pill')).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    expect((await highlight(page)).edges).toBe(0);

    // Another row moves the choice.
    await row.click();
    const third = page.locator('#fan-legend-items button[data-fan-rod]').nth(2);
    await third.click();
    await expect(third).toHaveAttribute('aria-pressed', 'true');
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#fan-legend-items button[aria-pressed="true"]')).toHaveCount(1);
});

test('fan family lines: the mouse previews a line without the pill; the highlight and the colours stay when the fan re-centres (spec 114 §5)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRodFan(page);
    const rows = page.locator('#fan-legend-items button[data-fan-rod]');
    const second = rows.nth(1);
    await second.hover();
    await expect.poll(async () => (await highlight(page)).preview).toBe(true);
    let h = await highlight(page);
    expect(h.hit.length).toBeGreaterThan(0);
    expect(h.edges).toBeGreaterThan(0);
    await expect(page.locator('#evidence-pill')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.UI.selectedRod())).toBeNull();
    // The others dimmed less than when highlighted.
    const dimOpacity = () => page.evaluate(() => getComputedStyle(document.querySelector('#fan-chart [data-fan-person].evidence-dim')!).opacity);
    expect(await dimOpacity()).toBe('0.62');
    // Away from the legend: the preview ends.
    await page.mouse.move(700, 120);
    await expect.poll(async () => (await highlight(page)).preview).toBe(false);
    expect(await highlight(page)).toEqual({ hit: [], edges: 0, dim: 0, preview: false });

    // The centre's line chosen; the fan re-centres on a member drawn: it stays highlighted, the colours stay.
    const first = rows.first();
    const rod = (await first.getAttribute('data-fan-rod'))!;
    await first.click();
    await expect(page.locator('#evidence-pill')).toBeVisible();
    await page.mouse.move(700, 120);
    await expect.poll(dimOpacity).toBe('0.45');
    const fills = () => page.evaluate(() => {
        const out: Record<string, string> = {};
        for (const g of document.querySelectorAll<SVGGElement>('#fan-chart [data-fan-person]')) {
            const fill = g.querySelector('.fan-fill');
            if (fill && !(g.dataset.fanPerson! in out)) out[g.dataset.fanPerson!] = getComputedStyle(fill).fill;
        }
        return out;
    });
    const before = await fills();
    const father = await page.evaluate(() => {
        const g = document.querySelector<SVGGElement>('#fan-chart [data-fan-ahnentafel="2"][data-fan-person]');
        return g?.dataset.fanPerson ?? null;
    });
    expect(father).not.toBeNull();
    await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), father);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(father);
    await expect.poll(async () => (await highlight(page)).edges).toBeGreaterThan(0);
    const after = await fills();
    const stayed = Object.keys(after).filter(id => id in before);
    expect(stayed.length).toBeGreaterThan(1);
    for (const id of stayed) expect(after[id], id).toBe(before[id]);
    h = await highlight(page);
    expect(h.hit.sort()).toEqual((await rodPeople(page, rod)).sort());
    await expect(page.locator(`#fan-legend-items button[data-fan-rod="${rod}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#evidence-pill')).toBeVisible();
});

/** A screen point inside a person's sector. */
async function sectorPoint(page: Page, pid: string): Promise<{ x: number; y: number }> {
    const p = await page.evaluate((id) => {
        const g = document.querySelector<SVGGElement>(`#fan-chart [data-fan-person="${id}"]`);
        if (!g) return null;
        const r = g.getBoundingClientRect();
        for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
            const x = r.left + r.width * j / 10, y = r.top + r.height * i / 10;
            if (g.contains(document.elementFromPoint(x, y))) return { x, y };
        }
        return null;
    }, pid);
    expect(p).not.toBeNull();
    return p!;
}

test('fan family lines: a sector\'s menu highlights its line and clears it (spec 114 §5)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRodFan(page);
    const at = await sectorPoint(page, 'a6');
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const item = page.locator('.fan-menu [data-fan-menu="rod"]');
    await expect(item).toHaveText('Highlight the Belmudr family line');
    await item.click();
    await expect(page.locator('#evidence-pill')).toBeVisible();
    const row = page.locator('#fan-legend-items button[data-fan-rod]', { hasText: 'Belmudr' });
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(item).toHaveText('Clear the family line highlight');
    await item.click();
    await expect(page.locator('#evidence-pill')).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-pressed', 'false');
});

/** The fan in family-line colours on a touch screen (the colours behind the chip on a phone, a dropdown on a tablet). */
async function openRodFanTouch(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, ancestors(), 'Fan lines', 'a1');
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
    await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
    await page.evaluate(() => window.Strom.TreeRenderer.setFanColorMode('rod'));
    await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFanColorMode())).toBe('rod');
}

for (const theme of ['light', 'dark'] as const) {
    test.describe(`phone 390 (${theme})`, () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

        test(`fan family lines: a tap in the sheet highlights the line, closes the sheet, the chip names the line (spec 114 §6, ${theme})`, async ({ page }) => {
            await openRodFanTouch(page);
            if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
            const chip = page.locator('#fan-legend-chip');
            await expect(chip).toBeVisible();
            await expect(chip).toHaveAttribute('aria-label', 'Colours: Family lines');
            await expect(chip.locator('.fan-chip-dot')).toHaveCount(3);
            await chip.tap();
            const sheet = page.locator('#fan-sheet');
            await expect(sheet).toBeVisible();
            // The legend in parts by side in the sheet; its rows are 34px.
            await expect(sheet.locator('.fan-legend-group')).toHaveText(["Father's side", "Mother's side"]);
            // Scrolled (a low phone), a side's heading sticks to the sheet's top edge (no rows showing above it).
            await page.setViewportSize({ width: 390, height: 480 });
            await sheet.locator('.fan-legend-other').tap();
            await expect(sheet.locator('.fan-legend-other')).toHaveAttribute('aria-expanded', 'true');
            await page.locator('.fan-sheet-panel').evaluate(e => { e.scrollTop = e.scrollHeight; });
            await expect.poll(() => page.evaluate(() => {
                const panel = document.querySelector('.fan-sheet-panel')!.getBoundingClientRect();
                const h = document.querySelectorAll('#fan-sheet .fan-legend-group')[1].getBoundingClientRect();
                return Math.abs(h.top - panel.top) <= 2;
            })).toBe(true);
            await sheet.locator('.fan-legend-other').tap();
            await expect(sheet.locator('.fan-legend-other')).toHaveAttribute('aria-expanded', 'false');
            await page.locator('.fan-sheet-panel').evaluate(e => { e.scrollTop = 0; });
            await page.setViewportSize({ width: 390, height: 844 });
            const row = sheet.locator('button[data-fan-rod]').nth(1);
            expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(34);
            const name = (await row.locator('.fan-legend-label').textContent())!.trim();
            const rod = (await row.getAttribute('data-fan-rod'))!;

            await row.tap();
            await expect(sheet).toBeHidden();
            await expect(page.locator('#evidence-pill')).toBeVisible();
            await expect.poll(async () => (await highlight(page)).hit.sort()).toEqual((await rodPeople(page, rod)).sort());
            // The chip: the line's swatch and name, no × of its own (the pill has it), above right of the pill.
            await expect(chip.locator('.fan-chip-label')).toHaveText(name);
            await expect(chip.locator('.fan-sw')).toHaveCount(1);
            await expect(chip.locator('.fan-chip-dot')).toHaveCount(0);
            await expect(chip).toHaveAttribute('aria-label', `Colours: Family lines, ${name} family line highlighted`);
            await expect(chip).not.toContainText('×');
            const swatch = await chip.locator('.fan-sw').evaluate(e => getComputedStyle(e).backgroundImage);
            const rowSwatch = await page.locator(`#fan-sheet-items button[data-fan-rod="${rod}"] .fan-sw`).evaluate(e => getComputedStyle(e).backgroundImage);
            expect(swatch).toBe(rowSwatch);
            const c = (await chip.boundingBox())!, p = (await page.locator('#evidence-pill').boundingBox())!;
            expect(c.y + c.height).toBeLessThanOrEqual(p.y);
            // Held sideways the pill stands at the top: the chip keeps the bottom left, clear of it.
            await page.setViewportSize({ width: 844, height: 390 });
            await expect.poll(async () => {
                const a = (await chip.boundingBox())!, b = (await page.locator('#evidence-pill').boundingBox())!;
                const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
                return { apart, bottom: a.y + a.height > 390 / 2, inside: a.y + a.height <= 390 };
            }).toEqual({ apart: true, bottom: true, inside: true });
            await page.setViewportSize({ width: 390, height: 844 });
            // No sideways scroll on the phone.
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

            // The chip opens the sheet again; the same row taps the highlight away and closes it.
            await chip.tap();
            await expect(sheet).toBeVisible();
            await expect(sheet.locator(`button[data-fan-rod="${rod}"]`)).toHaveAttribute('aria-pressed', 'true');
            await sheet.locator(`button[data-fan-rod="${rod}"]`).tap();
            await expect(sheet).toBeHidden();
            await expect(page.locator('#evidence-pill')).toHaveCount(0);
            await expect(chip).toHaveAttribute('aria-label', 'Colours: Family lines');
            await expect(chip.locator('.fan-sw')).toHaveCount(0);
            expect((await highlight(page)).edges).toBe(0);

            // The pill's × ends it too, and the chip goes back to its dots.
            await chip.tap();
            await sheet.locator('button[data-fan-rod]').first().tap();
            await expect(page.locator('#evidence-pill')).toBeVisible();
            await expect(chip.locator('.fan-sw')).toHaveCount(1);
            await page.locator('#evidence-pill .evidence-pill-close').tap();
            await expect(page.locator('#evidence-pill')).toHaveCount(0);
            await expect(chip.locator('.fan-chip-dot')).toHaveCount(3);
        });
    });
}

test.describe('tablet 1024', () => {
    test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

    test('fan family lines: the legend card\'s rows are 34px controls; a tap highlights (spec 114 §6)', async ({ page }) => {
        await openRodFanTouch(page);
        const items = page.locator('#fan-legend-items');
        if (!(await items.isVisible())) await page.locator('#fan-legend-head').tap();
        await expect(items.locator('.fan-legend-rods')).toBeVisible();
        const rows = items.locator('.fan-legend-rods > button');
        for (const h of await rows.evaluateAll(es => es.map(e => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(34);
        await rows.nth(1).tap();
        await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#evidence-pill')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});

test('fan family lines: print and the poster carry the highlight (spec 114 §7)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRodFan(page);
    const row = page.locator('#fan-legend-items button[data-fan-rod]').nth(1);
    const name = (await row.locator('.fan-legend-label').textContent())!.trim();
    await row.click();
    await expect(page.locator('#evidence-pill')).toBeVisible();
    await page.mouse.move(700, 120);

    // Paper: the dimmed sectors at full opacity, their fills lighter hexes; the outline copper.
    const look = () => page.evaluate(() => {
        const dim = document.querySelector('#fan-chart [data-fan-person].evidence-dim')!;
        const edge = document.querySelector('#fan-chart .fan-hl-edge');
        return {
            opacity: getComputedStyle(dim).opacity,
            fill: getComputedStyle(dim.querySelector('.fan-fill')!).fill,
            edge: edge ? getComputedStyle(edge).stroke : null,
        };
    });
    const screen = await look();
    expect(screen.opacity).toBe('0.45');
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.emulateMedia({ media: 'print' });
    await expect.poll(async () => (await look()).edge).toBe('rgb(138, 85, 40)');
    const paper = await look();
    expect(paper.opacity).toBe('1');
    expect(paper.fill).not.toBe(screen.fill);
    // The legend flows in lines as on the poster (not one tall column), the sides' headings not sticky;
    // the highlight's pill and ⌂ are the screen's and stay off the paper.
    expect(await page.evaluate(() => ({
        rods: getComputedStyle(document.querySelector('#fan-legend .fan-legend-rods')!).display,
        heading: getComputedStyle(document.querySelector('#fan-legend .fan-legend-group')!).position,
        pill: getComputedStyle(document.getElementById('evidence-pill')!).display,
        home: getComputedStyle(document.getElementById('fan-home-pill')!).display,
    }))).toEqual({ rods: 'flex', heading: 'static', pill: 'none', home: 'none' });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(async () => (await look()).opacity).toBe('0.45');

    // The poster: the outline layer and the line in the subtitle.
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        poster.locator('.menu-option', { hasText: 'SVG' }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    expect(svg).toContain('class="fan-hl-layer"');
    expect(svg).toContain(`${name} family line highlighted`);
    expect(svg).toContain('class="fan-poster-strong"');
    expect(svg).toContain(">Father's side</text>");
});

/**
 * The sectors of the highlighted line under the highlight's pill (sampled on a
 * 6px grid over its rectangle; elementsFromPoint sees through the pill).
 */
function hitUnderPill(page: Page): Promise<number> {
    return page.evaluate(() => {
        const pill = document.getElementById('evidence-pill')!.getBoundingClientRect();
        let n = 0;
        for (let y = pill.top + 1; y < pill.bottom; y += 6) {
            for (let x = pill.left + 1; x < pill.right; x += 6) {
                if (document.elementsFromPoint(x, y).some(e => e.closest('#fan-chart [data-fan-person].evidence-hit'))) n++;
            }
        }
        return n;
    });
}

/** The line of the sector at the top of the drawn fan, beside its middle (where the pill stands). */
function topRod(page: Page): Promise<string> {
    return page.evaluate(() => {
        const chart = document.getElementById('fan-chart')!;
        const sectors = [...chart.querySelectorAll<SVGGElement>('[data-fan-person]')].map(g => ({ g, r: g.getBoundingClientRect() }));
        const top = Math.min(...sectors.map(s => s.r.top));
        const mid = chart.getBoundingClientRect().left + chart.getBoundingClientRect().width / 2;
        const el = document.elementFromPoint(mid + 12, top + 6)?.closest<SVGGElement>('[data-fan-person]');
        const a = window.Strom.TreeRenderer.getFanView()!.getRodAssignment()!;
        return a.index.rodByPerson.get(el!.dataset.fanPerson!)!;
    });
}

for (const vp of [
    { name: 'desktop 1568×729', width: 1568, height: 729, touch: false },
    { name: 'phone sideways 844×390', width: 844, height: 390, touch: true },
    { name: 'phone 390×844', width: 390, height: 844, touch: true },
]) {
    test.describe(vp.name, () => {
        test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch });

        test(`fan family lines: the highlight's pill covers none of the line's sectors; the whole fan keeps clear of it (spec 114 §6, ${vp.name})`, async ({ page }) => {
            await openRodFanTouch(page);
            // The standalone file's banner (as in the finding): the pill stands lower, over the fan's top ring.
            await page.evaluate(() => {
                document.body.classList.add('embedded-mode');
                document.getElementById('embedded-mode-banner')!.classList.add('visible');
            });
            await page.evaluate(() => { window.Strom.TreeRenderer.setFanShape('half'); window.Strom.TreeRenderer.setFanGenerations(4); });
            await expect(page.locator('#fan-chart svg.fan-svg')).toHaveAttribute('data-fan-shape', 'half');
            const before = await page.locator('#fan-chart svg.fan-svg').getAttribute('viewBox');
            const rod = await topRod(page);
            await page.evaluate((id) => window.Strom.UI.selectRodFromFan(id), rod);
            await expect(page.locator('#evidence-pill')).toBeVisible();
            await expect.poll(async () => (await highlight(page)).hit.length).toBeGreaterThan(1);
            await expect.poll(() => hitUnderPill(page)).toBe(0);
            // No sector at all under the pill: the whole fan stands beside it.
            expect(await page.evaluate(() => {
                const p = document.getElementById('evidence-pill')!.getBoundingClientRect();
                return [...document.querySelectorAll('#fan-chart [data-fan-person], #fan-chart .fan-focus-disc')]
                    .flatMap(g => [...g.querySelectorAll('path, circle')])
                    .filter(e => { const r = e.getBoundingClientRect(); return r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top; }).length;
            })).toBe(0);
            // The highlight ends: the whole fan as before.
            await page.evaluate(() => window.Strom.UI.selectRodFromFan(null));
            await expect(page.locator('#evidence-pill')).toHaveCount(0);
            await expect.poll(() => page.locator('#fan-chart svg.fan-svg').getAttribute('viewBox')).toBe(before);
        });
    });
}

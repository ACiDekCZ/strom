import { test, expect, Page } from '@playwright/test';
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
 * sectors, the mother's 4, 3, 2, 2, and eight lines are drawn once (grey,
 * under "Other").
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

test('fan family lines: "Other" expands the grey lines, kept on the device (spec 114 §4)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRodFan(page);
    const other = page.locator('#fan-legend-items .fan-legend-other');
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
    // A grey line can be highlighted from the expanded list.
    const grey = page.locator('#fan-legend-items button.fan-legend-sub[data-fan-rod]').first();
    await grey.click();
    await expect(grey).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#evidence-pill')).toBeVisible();
    // Closed, "Other" marks the chosen grey line.
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

import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * What a card shows at a glance: the evidence stripes and the story's folded
 * corner at the card's bottom-right corner, one action badge on the avatar's
 * corner (waiting for you ! > conflict ≠ > question ?), the tooltip rows, the
 * aria-label, densities and far zoom, Settings → "Show on card", the person
 * menu leading with the signal, and the Evidence mode in tree health.
 * Invented data only.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 3f2a9c1e5b7d',
        '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @S12@ SOUR', '1 TITL Křestní matrika Chlumy 1865', '1 REFN S0012',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 DEAT', '2 DATE 1900',
        '1 REFN P0001', '1 FAMS @F0001@',
        '1 _STORY', '2 STAT hotovo', '2 TEXT Josef hospodařil na čp. 12.',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0012@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '2 SOUR @S12@', '1 DEAT', '2 DATE 1932', '2 SOUR @S12@',
        '1 REFN P0012', '1 FAMC @F0001@',
        '1 _STORY', '2 STAT navrh', '2 TEXT Jan se narodil v Chlumech.',
        '1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 VAL 3 FEB 1865', '3 SOUR @S12@', '2 VAL 1866',
        '1 _STROM_HYPO', '2 TITL Otec: Josef, nebo Jan Víšek?',
        '0 @P0013@ INDI', '1 NAME Eva /Víšková/', '1 SEX F', '1 BIRT', '2 DATE 1868', '1 REFN P0013', '1 FAMC @F0001@',
        '1 _STROM_CONFLICT X0010', '2 TYPE DEAT', '2 STAT open', '2 VAL 1930', '2 VAL 1931',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
        '0 TRLR',
    ].join('\n');
}

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'tree-strom.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

/** The research tree; the research last said a task about Eva waits (before the app starts). */
async function setup(page: Page, width = 1440): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((uuid) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({
            items: [{ id: 'T0004', what: 'Uložte snímek oddací matriky', at: '', person: 'P0013' }],
            at: new Date(Date.now() - 3600_000).toISOString(),
        }));
    }, UUID);
    await openApp(page);
    await dropFile(page, researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
}

/** A plain tree from JSON (no research). */
async function plainTree(page: Page, persons: Record<string, Record<string, unknown>>, sources: Record<string, unknown> = {}): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async ({ persons, sources }) => {
        const full: Record<string, unknown> = {};
        for (const [id, p] of Object.entries(persons)) {
            full[id] = { id, gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p };
        }
        await window.Strom.DataManager.importAsNewTree({ persons: full, partnerships: {}, sources }, 'Karty');
    }, { persons, sources });
}

test.describe('card signals', () => {
    test('status icons, badges by priority, tooltip and aria-label', async ({ page }) => {
        await setup(page);
        // Stripes in the card's corner, the story as the folded corner itself.
        // Josef: nothing cited (no evidence stripe), a finished story.
        // Jan: birth and death cited (two stripes), a draft story (paler fold).
        await expect(card(page, 'Josef').locator(':scope > .card-state')).toHaveCount(0);
        await expect(card(page, 'Josef').locator(':scope > .card-story')).not.toHaveClass(/draft/);
        await expect(card(page, 'Jan').locator(':scope > .card-state .st-ev i')).toHaveCount(2);
        await expect(card(page, 'Jan').locator(':scope > .card-story')).toHaveClass(/draft/);
        // The fold covers the card's corner; the stripes move left of it.
        const fold = await card(page, 'Jan').evaluate((el) => {
            const c = el.getBoundingClientRect();
            const foldEl = el.querySelector<HTMLElement>(':scope > .card-story')!;
            const stEl = el.querySelector<HTMLElement>(':scope > .card-state')!;
            const f = foldEl.getBoundingClientRect();
            const st = stEl.getBoundingClientRect();
            return { right: f.right - c.right, bottom: f.bottom - c.bottom, size: foldEl.offsetWidth, stripesRight: getComputedStyle(stEl).right, stripesClear: st.right <= f.left + 4 };
        });
        expect(fold).toMatchObject({ right: 0, bottom: 0, size: 14, stripesRight: '18px', stripesClear: true });
        await expect(card(page, 'Anna').locator(':scope > .card-story')).toHaveCount(0);
        // The year text itself is unchanged by the stripes.
        await expect(card(page, 'Jan').locator('.birth-date')).toHaveText('1865 – 1932');

        // Jan: an open conflict (≠). Eva: a conflict AND a waiting task — waiting wins (!).
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveText('≠');
        await expect(card(page, 'Eva').locator('.card-signal')).toHaveText('!');
        await expect(card(page, 'Josef').locator('.card-signal')).toHaveCount(0);
        await expect(card(page, 'Eva').locator('.card-signal')).toHaveAttribute('aria-label', 'Waiting for an answer: Uložte snímek oddací matriky');

        await expect(card(page, 'Jan')).toHaveAttribute('aria-label', 'Jan Víšek, documented by sources, story in draft, conflicting sources');
        const tt = card(page, 'Jan').locator('.card-tooltip .tt-signals');
        await expect(tt.locator('.tt-ev')).toHaveText('1 source · birth documented');
        await expect(tt.locator('.tt-story')).toHaveText('Story (draft)');
        await expect(tt.locator('.tt-action')).toHaveText(['1 conflict · 1 hypothesis']);
        await expect(card(page, 'Eva').locator('.card-tooltip .tt-action')).toHaveText(['Waiting for an answer: Uložte snímek oddací matriky', '1 conflict']);
    });

    test('the badge opens what it signals, not the card menu', async ({ page }) => {
        await setup(page);
        await card(page, 'Jan').locator('.card-signal').click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await expect(page.locator('.context-menu')).toHaveCount(0);
    });

    test('the stripes sit in the bottom-right corner in every density, over no text', async ({ page }) => {
        await setup(page);
        for (const density of ['compact', 'normal', 'detailed']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), density);
            const jan = card(page, 'Jan');
            await expect(jan.locator(':scope > .card-state')).toBeVisible();
            const box = (await jan.boundingBox())!;
            const stripes = (await jan.locator(':scope > .card-state').boundingBox())!;
            expect(box.x + box.width - (stripes.x + stripes.width)).toBeGreaterThan(4);
            expect(box.y + box.height - (stripes.y + stripes.height)).toBeGreaterThan(3);
            // No text line of the card runs under them.
            for (const sel of ['.name-text', '.birth-date', '.card-place']) {
                const t = jan.locator(sel);
                if (await t.count() === 0 || !(await t.isVisible())) continue;
                const r = (await t.boundingBox())!;
                const overlaps = r.x < stripes.x + stripes.width && stripes.x < r.x + r.width
                    && r.y < stripes.y + stripes.height && stripes.y < r.y + r.height;
                expect(overlaps, `${density}: ${sel} under the stripes`).toBe(false);
            }
        }
        // Decoration only: a click there is a click on the card.
        await expect(card(page, 'Jan').locator(':scope > .card-state')).toHaveCSS('pointer-events', 'none');
    });

    test('the ⇄ other-trees pill: the stripes rise above it, the text keeps clear', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        // The same documented Jan in two trees: his card carries the ⇄ pill.
        await page.evaluate(async () => {
            const jan = { id: 'j', firstName: 'Jan', lastName: 'Novák', gender: 'male', birthDate: '1900', birthPlace: 'Lipany u Prahy a okolí',
                birthSourceIds: ['s1'], isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };
            const sources = { s1: { id: 's1', title: 'Křest' } };
            await window.Strom.DataManager.importAsNewTree({ persons: { j: jan }, partnerships: {}, sources } as never, 'Strom A');
            await window.Strom.DataManager.importAsNewTree({ persons: { j: jan }, partnerships: {}, sources } as never, 'Strom B');
            window.Strom.TreeRenderer.render();
        });
        const jan = card(page, 'Jan');
        const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
            a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        for (const density of ['normal', 'compact', 'detailed']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), density);
            await expect(jan.locator('.cross-tree-badge')).toBeVisible();
            await expect(jan).toHaveClass(/has-edge-br/);
            const stripes = jan.locator(':scope > .card-state');
            await expect(stripes).toHaveCSS('bottom', '14px');
            const sBox = (await stripes.boundingBox())!;
            const pill = (await jan.locator('.cross-tree-badge').boundingBox())!;
            expect(overlap(sBox, pill), `${density}: stripes under the pill`).toBe(false);
            // The last text line (the name in compact) ends before the stripes.
            const last = jan.locator('.card-body > :last-child');
            await expect(last).toHaveCSS('margin-right', '34px');
            // Text lines clip at their own box: no box reaches under the stripes.
            for (const sel of ['.name', '.birth-date', '.card-place']) {
                const t = jan.locator(sel);
                if (await t.count() === 0 || !(await t.isVisible())) continue;
                expect(overlap((await t.boundingBox())!, sBox), `${density}: ${sel} under the stripes`).toBe(false);
            }
        }
        // Without the pill: no class, the stripes back at the bottom.
        await page.evaluate(() => window.Strom.UI.toggleCrossTreeBadges(false));
        await expect(jan.locator('.cross-tree-badge')).toHaveCount(0);
        await expect(jan).not.toHaveClass(/has-edge-br/);
        await expect(jan.locator(':scope > .card-state')).toHaveCSS('bottom', '6px');
    });

    test('the desktop person menu leads with the signal', async ({ page }) => {
        await setup(page);
        await card(page, 'Jan').locator('.name').click();
        const block = page.locator('.context-menu .menu-signal');
        await expect(block).toContainText('1 conflict · 1 hypothesis');
        await expect(block).toContainText('What the research knows ›');
        await block.click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
    });

    test('compact: a dot on the card corner; far zoom: dots only', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
        await expect(card(page, 'Jan').locator('.card-signal-dot')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.setCardDensity('normal'));
        await expect(card(page, 'Jan').locator('.card-signal')).toBeVisible();
        await expect(card(page, 'Jan').locator('.card-signal-dot')).toBeHidden();

        // Zoom out step by step (each step is animated) until below 55 %.
        await expect.poll(async () => {
            await page.evaluate(() => window.Strom.ZoomPan.zoomOut());
            await page.waitForTimeout(260);
            return page.evaluate(() => window.Strom.ZoomPan.getScale());
        }, { timeout: 10000 }).toBeLessThan(0.55);
        await expect(page.locator('#tree-canvas')).toHaveClass(/zoom-far/);
        await expect(card(page, 'Jan').locator('.card-signal')).toBeHidden();
        await expect(card(page, 'Jan').locator(':scope > .card-state')).toBeHidden();
        await expect(card(page, 'Jan').locator(':scope > .card-story')).toBeHidden();
        await expect(card(page, 'Jan').locator('.card-signal-dot')).toBeVisible();
    });

    test('printing the page: no stripes, fold or badge', async ({ page }) => {
        await setup(page);
        await expect(card(page, 'Jan').locator(':scope > .card-story')).toBeVisible();
        await page.emulateMedia({ media: 'print' });
        for (const sel of [':scope > .card-state', ':scope > .card-story', '.card-signal']) {
            await expect(card(page, 'Jan').locator(sel)).toBeHidden();
        }
    });

    test('Settings: switching a signal off hides it on the card, the tooltip keeps it', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#card-signals-settings');
        // One preview for the density and the signals, under the density select.
        const preview = page.locator('#card-preview-settings .card-signals-preview');
        await expect(preview.locator('.person-card')).toBeVisible();
        await expect(preview.locator('.name-text')).toHaveText('Jan Vlk');
        // A research tree: "Waiting for an answer" is offered; the agent only with the research connected here.
        await expect(settings.locator('input[data-signal="waiting"]')).toHaveCount(1);
        await expect(settings.locator('input[data-signal="agent"]')).toHaveCount(0);
        await settings.locator('input[data-signal="conflict"]').uncheck();
        await settings.locator('input[data-signal="evidence"]').uncheck();
        await expect(preview.locator('.st-ev')).toHaveCount(0);
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        await expect(card(page, 'Jan').locator(':scope > .card-state .st-ev')).toHaveCount(0);
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-ev')).toHaveCount(1);
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-action')).toHaveText(['1 conflict · 1 hypothesis']);
        // Eva still shows the waiting task.
        await expect(card(page, 'Eva').locator('.card-signal')).toHaveText('!');
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-card-signals') ?? '{}'))).toMatchObject({ conflict: false, evidence: false });
    });

    test('a tree without any source shows no evidence; a question gets the ? badge', async ({ page }) => {
        await plainTree(page, {
            a: { firstName: 'Marie', lastName: 'Dvořáková', birthDate: '1901', question: 'Kde se narodila?' },
        });
        await expect(card(page, 'Marie')).toBeVisible();
        await expect(card(page, 'Marie').locator('.st-ev')).toHaveCount(0);
        await expect(card(page, 'Marie').locator('.card-tooltip .tt-ev')).toHaveCount(0);
        await expect(card(page, 'Marie').locator('.card-signal')).toHaveText('?');
        await expect(card(page, 'Marie').locator('.card-tooltip .tt-action')).toHaveText(['Question: Kde se narodila?']);
    });

    test('the name keeps its whole row; the stripes stay inside the card', async ({ page }) => {
        await plainTree(page, {
            k: {
                firstName: 'Kateřina', lastName: 'Výšková', birthDate: '1842', deathDate: '1901',
                birthPlace: 'Chlumy u Třeboně, okres Jindřichův Hradec', sourceIds: ['s1'],
                story: { text: 'Kateřina vedla hospodu.', status: 'draft' },
            },
        }, { s1: { id: 's1', title: 'Matrika' } });
        const k = card(page, 'Kateřina');
        await expect(k.locator(':scope > .card-state .st-ev')).toBeVisible();
        await expect(k.locator(':scope > .card-story.draft')).toBeVisible();
        const clipped = await k.locator('.name-text').evaluate(el => el.scrollWidth > el.clientWidth + 0.5);
        expect(clipped).toBe(false);
        // The card keeps its width (the focused card is drawn a little larger).
        expect(await k.evaluate(el => (el as HTMLElement).offsetWidth)).toBe(188);
        const box = await k.boundingBox();
        // The stripes stay inside the card.
        const icons = await k.locator(':scope > .card-state').boundingBox();
        expect(icons!.x + icons!.width).toBeLessThanOrEqual(box!.x + box!.width);
    });

    test('Evidence in tree: every card framed by its level, counts switch to a group', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showTreeHealthDialog(window.Strom.DataManager.getCurrentTreeId()));
        await page.locator('[data-evidence="levels"]').click();
        await expect(card(page, 'Jan')).toHaveClass(/evl-full/);
        await expect(card(page, 'Josef')).toHaveClass(/evl-none/);
        await expect(page.locator('.person-card.evidence-dim')).toHaveCount(0);
        const pill = page.locator('#evidence-pill');
        await expect(pill.locator('.evidence-pill-level')).toHaveText(['● 1', '◐ 0', '○ 3']);
        await pill.locator('.evidence-pill-level-none').click();
        await expect(card(page, 'Josef')).toHaveClass(/evidence-hit/);
        await expect(card(page, 'Jan')).toHaveClass(/evidence-dim/);
        await expect(pill.locator('.evidence-pill-level-none')).toHaveAttribute('aria-pressed', 'true');
        await expect(pill.locator('.evidence-pill-next')).toBeVisible();
        await pill.locator('.evidence-pill-level-none').click();
        await expect(card(page, 'Jan')).toHaveClass(/evl-full/);
        await page.keyboard.press('Escape');
        await expect(pill).toHaveCount(0);
        await expect(page.locator('.person-card.evl-full')).toHaveCount(0);
    });

    test('phone: the person menu leads with the status line and the signal', async ({ page }) => {
        await setup(page, 360);
        await card(page, 'Jan').locator('.name').click();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet.locator('.menu-person-state')).toHaveText('documented by sources · story (draft)');
        await expect(sheet.locator('.menu-signal')).toContainText('1 conflict');
    });
});

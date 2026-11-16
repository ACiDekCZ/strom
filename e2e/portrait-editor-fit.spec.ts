/**
 * The portrait editor with long names in German (spec 107 §9, §10e–10h): the
 * step tabs stay inside the head and cut a long name with "…", Keep and
 * Replace take at most two lines, the preview card shows a long name whole on
 * rows like the tree's Normal card (T40), and on a phone held sideways the
 * panel needs no scrolling.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, seedSetting } from './helpers.js';

const PID = 'u_ad_mx';
const editor = (page: Page) => page.locator('.pe-overlay');

/**
 * Adalbertine-Wilhelmine Quellbrunnhoferin (41 characters) and
 * Maximilian-Theodor Quellbrunnhofer, both with a portrait, and the couple's
 * photo. Invented names.
 */
async function seed(page: Page): Promise<void> {
    await seedSetting(page, 'language', 'de');
    await openApp(page);
    const img = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 800;
        const x = c.getContext('2d')!;
        x.fillStyle = '#c0392b'; x.fillRect(0, 0, 600, 800);
        x.fillStyle = '#2980b9'; x.fillRect(600, 0, 600, 800);
        const p = document.createElement('canvas');
        p.width = 64; p.height = 64;
        const y = p.getContext('2d')!;
        y.fillStyle = '#27ae60'; y.fillRect(0, 0, 64, 64);
        return { photo: c.toDataURL('image/jpeg', 0.8), portrait: p.toDataURL('image/jpeg', 0.8) };
    });
    await seedTree(page, {
        ad: { firstName: 'Adalbertine-Wilhelmine', lastName: 'Quellbrunnhoferin', gender: 'female', birthDate: '1901', deathDate: '1979', partners: ['mx'], photo: img.portrait },
        mx: { firstName: 'Maximilian-Theodor', lastName: 'Quellbrunnhofer', gender: 'male', birthDate: '1898', deathDate: '1970', photo: img.portrait },
    }, 'Quellbrunnhofer', 'ad');
    await page.evaluate(([pid, url]) => {
        window.Strom.DataManager.updatePartnership(pid as never, { photo: url, photoOriginalName: 'hochzeit.jpg' });
    }, [PID, img.photo]);
}

async function openTwoSteps(page: Page): Promise<void> {
    await page.evaluate((pid) => { void window.Strom.UI.makeUnionPortraits(pid as never); }, PID);
    await expect(editor(page).locator('.pe-tile').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
}

/** The step tabs inside the head, apart from each other and from ×; each long name cut with "…". */
async function expectStepsFit(page: Page): Promise<void> {
    const r = await page.evaluate(() => {
        const head = document.querySelector('.pe-overlay .pe-head')!.getBoundingClientRect();
        const steps = [...document.querySelectorAll<HTMLElement>('.pe-overlay .pe-step')].map(e => e.getBoundingClientRect());
        const close = document.querySelector('.pe-overlay .pe-close')!.getBoundingClientRect();
        const names = [...document.querySelectorAll<HTMLElement>('.pe-overlay .pe-step-name')].map(e => ({
            cut: e.scrollWidth > e.clientWidth + 1,
            ellipsis: getComputedStyle(e).textOverflow === 'ellipsis',
            insideTab: e.getBoundingClientRect().right <= e.closest('.pe-step')!.getBoundingClientRect().right + 1,
        }));
        return { head: { left: head.left, right: head.right }, steps: steps.map(s => ({ left: s.left, right: s.right })), close: { left: close.left }, names };
    });
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0].left).toBeGreaterThanOrEqual(r.head.left - 1);
    expect(r.steps[0].right).toBeLessThanOrEqual(r.steps[1].left + 1);
    expect(r.steps[1].right).toBeLessThanOrEqual(r.close.left + 1);
    for (const n of r.names) {
        expect(n.insideTab).toBe(true);
        if (n.cut) expect(n.ellipsis).toBe(true);
    }
    // The 41-character name does not fit a tab at this width: it is cut with "…".
    expect(r.names[1].cut).toBe(true);
}

/** Keep and Replace: title and line under it at most two lines each, and nothing cut off by the two-line limit. */
async function expectTilesTwoLines(page: Page): Promise<void> {
    const texts = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.pe-overlay .pe-tile-title, .pe-overlay .pe-tile-sub')]
        .map(e => ({
            lines: (() => {
                // Rows the text runs on: the distinct tops of its line boxes.
                const range = document.createRange();
                range.selectNodeContents(e);
                return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size;
            })(),
            clipped: e.scrollHeight > e.clientHeight + 1,
        })));
    expect(texts.length).toBe(4);
    for (const t of texts) {
        expect(t.lines).toBeLessThanOrEqual(2);
        expect(t.clipped).toBe(false);
    }
}

test.describe('portrait editor with long German names (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the step tabs fit the head and cut a long name with …', async ({ page }) => {
        await seed(page);
        await openTwoSteps(page);
        await expectStepsFit(page);
        await expectTilesTwoLines(page);
    });

    test('the large preview card shows the 41-character name whole on rows', async ({ page }) => {
        await seedSetting(page, 'cardPhoto', { size: 'large', shape: 'circle' });
        await seed(page);
        await openTwoSteps(page);
        // Step 2 is Adalbertine-Wilhelmine.
        await editor(page).locator('.pe-tile[data-keep="1"]').click();
        await editor(page).locator('.pe-primary').click();
        await expect(editor(page).locator('.pe-card-box .name-text')).toHaveText('Adalbertine-Wilhelmine Quellbrunnhoferin');
        await page.evaluate(() => document.fonts.ready);
        const name = await editor(page).locator('.pe-card-box .name-text').evaluate((e) => {
            const card = e.closest('.person-card')!.getBoundingClientRect();
            const r = e.getBoundingClientRect();
            return {
                cut: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1,
                ellipsis: getComputedStyle(e).textOverflow === 'ellipsis' && getComputedStyle(e).whiteSpace === 'nowrap',
                rows: (() => {
                    const range = document.createRange();
                    range.selectNodeContents(e);
                    return new Set([...range.getClientRects()].map(x => Math.round(x.top))).size;
                })(),
                inside: r.bottom <= card.bottom + 1 && r.right <= card.right + 1,
            };
        });
        expect(name.ellipsis).toBe(false);
        expect(name.cut).toBe(false);
        expect(name.rows).toBeGreaterThanOrEqual(2);
        expect(name.inside).toBe(true);
    });
});

test.describe('portrait editor with long German names (tablet)', () => {
    test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

    test('touch tabs do not overlap; Keep and Replace take at most two lines', async ({ page }) => {
        await seed(page);
        await openTwoSteps(page);
        await expectStepsFit(page);
        await expectTilesTwoLines(page);
    });
});

test.describe('portrait editor with long German names (phone sideways)', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('the panel needs no scrolling and the tiles stay within two lines', async ({ page }) => {
        await seed(page);
        await openTwoSteps(page);
        await expect(editor(page).locator('.pe-dialog[data-layout="land"]')).toHaveCount(1);
        const panel = await editor(page).locator('.pe-panel').evaluate(e => ({ sh: e.scrollHeight, ch: e.clientHeight }));
        expect(panel.sh).toBeLessThanOrEqual(panel.ch + 1);
        await expectTilesTwoLines(page);
    });
});

import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The research edge: above the cards where the tree ends, what Strom Research
 * knows (GEDCOM _STROM_EDGE / _STROM_ISLAND). Stub shape and colour, the
 * dashed line of undocumented parents, the bubble, the "Above the person"
 * section, the keyboard, the modes in Settings → Tree, zoom, and a family
 * outside the tree. Invented data only.
 */

const UUID = '5d1e7a20-3c4b-4f6a-8e9d-1a2b3c4d5e6f';

function researchGed(asOf = '2026-09-20'): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', `1 _STROM_TREE ${UUID}`, `1 _STROM_ASOF ${asOf}`, '1 CHAR UTF-8', '1 NOTE Novákovi',
        // Josef: parents unknown, not searched yet, first in the queue; a possible link to Matouš.
        '0 @P0001@ INDI', '1 NAME Josef /Novák/', '1 SEX M', '1 BIRT', '2 DATE 1790', '2 PLAC Lhota', '1 REFN P0001', '1 FAMS @F0001@',
        '1 _STROM_HYPO H0001', '2 TITL Byl Matouš otcem Josefa?',
        '1 _STROM_EDGE parents', '2 _SCOPE in', '2 _RESEARCH G0001', '2 _GEN 3', '2 _END unsearched', '2 _NEXT queued',
        '2 _EST 1790', '3 PLAC Lhota', '2 DATE FROM 1787 TO 1793',
        '2 _BOOK B0001', '3 TITL Lhota, births 1784–1830', '3 DATE FROM 1784 TO 1830', '3 _ACCESS online-free',
        '2 _COVERED FROM 1787 TO 1789',
        '2 _TASK T0002', '3 _LEVEL link', '3 STAT open', '3 TITL Josef’s baptism: father Matouš?', '3 _POS 1',
        '2 _SEARCHES 4', '2 _SESSIONS 2', '3 _COST 1.50',
        '2 _HYPO H0001', '3 _JOIN P0005', '3 _ISLAND 2', '3 _HELD 1', '3 _TEST T0002',
        // Anna: searched everywhere, it is the user's call.
        '0 @P0002@ INDI', '1 NAME Anna /Dvořáková/', '1 SEX F', '1 BIRT', '2 DATE 1795', '1 REFN P0002', '1 FAMS @F0001@',
        '1 _STROM_EDGE parents', '2 _SCOPE in', '2 _END not-found', '2 _NEXT decide',
        // Jan: both parents in the tree, no record documents them.
        '0 @P0012@ INDI', '1 NAME Jan /Novák/', '1 SEX M', '1 BIRT', '2 DATE 1820', '1 REFN P0012', '1 FAMC @F0001@', '1 FAMS @F0002@',
        '1 _STROM_EDGE proof', '2 _SCOPE in', '2 _NEXT none',
        // Marie: married in, no parents, nothing from the research: nothing drawn.
        '0 @P0014@ INDI', '1 NAME Marie /Černá/', '1 SEX F', '1 REFN P0014', '1 FAMS @F0002@',
        // Matouš and Dorota: a family nothing links to the tree yet.
        '0 @P0005@ INDI', '1 NAME Matouš /Novák/', '1 SEX M', '1 REFN P0005', '1 FAMS @F0009@',
        '1 _STROM_ISLAND 2', '2 _HYPO H0001', '3 _JOIN P0001', '2 _HELD 1',
        '0 @P0006@ INDI', '1 NAME Dorota /Nováková/', '1 SEX F', '1 REFN P0006', '1 FAMS @F0009@',
        '1 _STROM_ISLAND 2', '2 _HYPO H0001', '3 _JOIN P0001', '2 _HELD 1',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@',
        '0 @F0002@ FAM', '1 HUSB @P0012@', '1 WIFE @P0014@',
        '0 @F0009@ FAM', '1 HUSB @P0005@', '1 WIFE @P0006@',
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

async function setup(page: Page, asOf?: string): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await dropFile(page, researchGed(asOf));
    await expect(card(page, 'Jan')).toBeVisible();
    await page.evaluate(() => {
        const jan = window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!;
        window.Strom.TreeRenderer.setFocus(jan.id);
        window.Strom.ZoomPan.reset();
    });
    await expect(card(page, 'Josef')).toBeVisible();
}

const stub = (page: Page, name: string) => card(page, name).locator('.research-edge');

async function setMode(page: Page, label: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const host = page.locator('#research-edge-settings');
    await expect(host).toBeVisible();
    await host.locator('label.settings-radio', { hasText: label }).click();
    await page.evaluate(() => window.Strom.UI.closeSettingsDialog());
}

test.describe('research edge', () => {
    test('stub shape and colour, proof line, nothing on a married-in card', async ({ page }) => {
        await setup(page);
        await expect(stub(page, 'Josef')).toHaveClass(/edge-open/);
        await expect(stub(page, 'Josef')).toHaveClass(/tone-searching/);
        await expect(stub(page, 'Josef')).toHaveClass(/side-center/);
        await expect(stub(page, 'Josef')).toHaveAttribute('aria-label', 'Parents: Not searched yet. In the queue as no. 1');
        await expect(stub(page, 'Anna')).toHaveClass(/edge-closed/);
        await expect(stub(page, 'Anna')).toHaveClass(/tone-yours/);
        await expect(stub(page, 'Jan')).toHaveClass(/edge-kind-proof/);
        await expect(page.locator('#tree-lines line.edge-proof-drop')).toHaveCount(1);
        await expect(stub(page, 'Marie')).toHaveCount(0);
        // The stub sits above the card's top edge, over its middle.
        const geo = await card(page, 'Josef').evaluate((el) => {
            const c = el.getBoundingClientRect();
            const s = el.querySelector('.research-edge')!.getBoundingClientRect();
            return { bottom: s.bottom - c.top, center: s.left + s.width / 2 - (c.left + c.width / 2) };
        });
        expect(Math.abs(geo.bottom)).toBeLessThan(1.5);
        expect(Math.abs(geo.center)).toBeLessThan(1.5);
        // Family outside the tree not drawn: "+ family · 2" at the stub's end; it goes there.
        const pill = page.locator('.edge-link-pill--family');
        await expect(pill).toHaveText('+ family · 2');
        await pill.click();
        await expect(card(page, 'Matouš')).toHaveClass(/research-island/);
        await expect(card(page, 'Matouš').locator('.island-caption')).toHaveText('outside the tree · family of 2 · 1 task waiting');
    });

    test('hover shows the bubble, a click opens "Above the person"', async ({ page }) => {
        await setup(page);
        await stub(page, 'Josef').hover();
        const bubble = page.locator('#research-edge-bubble');
        await expect(bubble).toBeVisible();
        await expect(bubble.locator('.reb-end')).toHaveText('Not searched yet');
        await expect(bubble.locator('.reb-next')).toHaveText('In the queue as no. 1');
        await expect(bubble.locator('.reb-facts')).toHaveText('Baptism 1787–1793 · Lhota, births 1784–1830 · free online');
        await expect(bubble.locator('.reb-hypo')).toContainText('Matouš Novák');
        // Not the card's hover card meanwhile.
        await expect(card(page, 'Josef').locator('.card-tooltip')).toBeHidden();
        await stub(page, 'Josef').click();
        await expect(bubble).toHaveCount(0);
        const section = page.locator('#person-research-modal #research-edge-section');
        await expect(section).toBeVisible();
        await expect(section.locator('summary')).toBeFocused();
        await expect(section.locator('.rep-end')).toHaveText('Not searched yet');
        await expect(section.locator('.rep-tl-seg.seg-covered')).toHaveCount(1);
        await expect(section.locator('.rep-tasks li')).toHaveCount(1);
        await expect(section.locator('.rep-work')).toHaveText('4 searches · 2 sessions · $1.50');
        // The research's word is from 20 Sep: older than today, so "as of".
        await expect(section.locator('.rep-asof')).toBeVisible();
        // No person menu opened by the click.
        await expect(page.locator('.context-menu.active, .context-menu.visible')).toHaveCount(0);
    });

    test('keyboard: the stub is a button in the card', async ({ page }) => {
        await setup(page);
        await stub(page, 'Anna').focus();
        await expect(stub(page, 'Anna')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('#person-research-modal #research-edge-section .rep-end')).toHaveText('Searched, not found');
        await expect(page.locator('#research-edge-section .rep-next')).toHaveText('Strom has nothing more to suggest. It is your call.');
    });

    test('"as of" only when the research wrote it before today', async ({ page }) => {
        const d = new Date();
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        await setup(page, today);
        await stub(page, 'Josef').click();
        await expect(page.locator('#research-edge-section')).toBeVisible();
        await expect(page.locator('#research-edge-section .rep-asof')).toHaveCount(0);
    });

    test('modes in Settings → Tree: for you, off, all', async ({ page }) => {
        await setup(page);
        await setMode(page, 'For you');
        await expect(stub(page, 'Anna')).toBeVisible();
        await expect(stub(page, 'Josef')).toHaveCount(0);
        await expect(stub(page, 'Jan')).toHaveCount(0);
        await expect(page.locator('.edge-link-pill')).toHaveCount(0);
        await setMode(page, 'Off');
        await expect(page.locator('.research-edge')).toHaveCount(0);
        await setMode(page, 'All');
        await expect(stub(page, 'Josef')).toBeVisible();
        await expect(page.locator('.edge-link-pill--family')).toHaveCount(1);
    });

    test('zoom: words from 100 %, a stretch of the top edge below 60 %', async ({ page }) => {
        await setup(page);
        const label = stub(page, 'Josef').locator('.research-edge-label');
        await expect(label).toBeVisible();
        await expect(label).toHaveText('not searched');
        await page.evaluate(() => window.Strom.ZoomPan.zoomOut());
        await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeLessThan(0.99);
        await expect(label).toBeHidden();
        await expect(stub(page, 'Josef').locator('.research-edge-line')).toHaveCSS('width', '2px');
        // Step out one animated step at a time until below 60 %.
        for (let i = 0; i < 6; i++) {
            const before = await page.evaluate(() => window.Strom.ZoomPan.getScale());
            if (before < 0.6) break;
            await page.evaluate(() => window.Strom.ZoomPan.zoomOut());
            await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeLessThan(before - 0.01);
            await page.waitForTimeout(250);
        }
        expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeLessThan(0.6);
        await expect(stub(page, 'Josef').locator('.research-edge-line')).toHaveCSS('width', '76px');
    });

    test('a tree not from the research has no setting', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(async () => {
            await window.Strom.DataManager.importAsNewTree({
                persons: { p1: { id: 'p1', firstName: 'Eva', lastName: 'X', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } },
                partnerships: {},
            }, 'Plain');
        });
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#research-edge-settings')).toBeHidden();
    });
});

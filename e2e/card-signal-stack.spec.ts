import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * A card with two or three action signals: a click on its stack of badges
 * opens a small menu of what to open (by mouse, keyboard and a tablet's
 * finger at the stack, a bottom sheet on a phone); a press outside closes it
 * and goes nowhere; Esc, a choice, a zoom, a resize or a new drawing close
 * it; it fits into the window at the right and bottom edges. A card with
 * one signal keeps its badge and its click. The stack's look, bubble, dots,
 * far zoom and print are in card-signals.spec.ts. Invented data only.
 */

const UUID = '6b1d4e20-3c8a-4f7e-9a25-7d0c1e9b4f38';

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 7c1e9a3b5d2f',
        '1 CHAR UTF-8', '1 NOTE Fíškovi',
        '0 @S12@ SOUR', '1 TITL Křestní matrika Chlumy 1865', '1 REFN S0012',
        '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 DEAT', '2 DATE 1900',
        '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0012@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '2 SOUR @S12@', '1 DEAT', '2 DATE 1932',
        '1 REFN P0012', '1 FAMC @F0001@',
        '1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 VAL 3 FEB 1865', '3 SOUR @S12@', '2 VAL 1866',
        '0 @P0013@ INDI', '1 NAME Eva /Fíšková/', '1 SEX F', '1 BIRT', '2 DATE 1868', '1 REFN P0013', '1 FAMC @F0001@',
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

/** A fixed clock, away from midnight UTC: the remembered Waiting is an hour old. */
const NOW = new Date('2026-06-15T10:30:00Z');

/** The research tree; the research last said a task about Eva waits (before the app starts). */
async function seedWaiting(page: Page): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await page.addInitScript(({ uuid, at }) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({
            items: [{ id: 'T0004', what: 'Uložte snímek oddací matriky', at: '', person: 'P0013' }],
            at,
        }));
    }, { uuid: UUID, at: new Date(NOW.getTime() - 3600_000).toISOString() });
}

async function setup(page: Page, width = 1440, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    await seedWaiting(page);
    await openApp(page);
    await dropFile(page, researchGed());
    await expect(card(page, 'Eva')).toBeVisible();
}

/** Eva's stack, centred in the window first (the tree settled). */
async function evaStack(page: Page): Promise<Locator> {
    const eva = card(page, 'Eva');
    await eva.evaluate(el => window.Strom.ZoomPan.centerOnPerson((el as HTMLElement).dataset.id as never));
    await expect(page.locator('#tree-canvas')).not.toHaveClass(/is-moving/);
    return eva.locator('.card-signal-stack');
}

/** Pan the tree so the stack's centre stands at (x, y) in the window. */
async function moveStackTo(page: Page, stack: Locator, x: number, y: number): Promise<void> {
    const b = (await stack.boundingBox())!;
    await page.evaluate(({ dx, dy }) => {
        const zoom = window.Strom.ZoomPan;
        const s = zoom.getScale();
        zoom.shiftWorld(-dx / s, -dy / s);
    }, { dx: x - (b.x + b.width / 2), dy: y - (b.y + b.height / 2) });
}

/** Record calls of a UI method (it still runs). */
async function spyOn(page: Page, method: string): Promise<void> {
    await page.evaluate((m) => {
        const ui = window.Strom.UI;
        const calls: unknown[][] = [];
        (window as any)[`__calls_${m}`] = calls;
        const orig = ui[m].bind(ui);
        ui[m] = (...args: unknown[]) => { calls.push(args); return orig(...args); };
    }, method);
}

const callsOf = (page: Page, method: string): Promise<number> =>
    page.evaluate((m) => ((window as any)[`__calls_${m}`] as unknown[][]).length, method);

const MENU = '.card-signals-menu';

/** The menu's box once its open animation (a slight scale) has ended. */
async function boxOf(menu: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    await menu.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    return (await menu.boundingBox())!;
}

test.describe('the stack of badges: what to open', () => {
    test('desktop: a click opens the menu at the stack — header, two choices, the line of what waits; a choice runs it', async ({ page }) => {
        await setup(page);
        const stack = await evaStack(page);
        await expect(stack).toHaveClass(/\bn2\b/);
        await stack.click();
        const menu = page.locator(MENU);
        await expect(menu).toBeVisible();
        await expect(menu).toHaveAttribute('role', 'menu');
        await expect(menu).toHaveAttribute('aria-label', 'Eva Fíšková: what waits');
        await expect(page.locator('.person-menu')).toHaveCount(0);
        await expect(menu.locator('.csm-head .cmh-name')).toHaveText('Eva Fíšková');
        await expect(menu.locator('.csm-head .csm-years')).toHaveText(/1868/);
        const items = menu.locator('[role="menuitem"]');
        await expect(items).toHaveCount(2);
        await expect(items.nth(0)).toHaveAttribute('data-action', 'signal-waiting');
        await expect(items.nth(0)).toHaveAttribute('tabindex', '-1');
        await expect(items.nth(0).locator('.menu-act-sub')).toHaveText('Uložte snímek oddací matriky');
        await expect(items.nth(0).locator('.menu-act-text')).toHaveText('Answer · 1 waitingUložte snímek oddací matriky');
        await expect(items.nth(1)).toHaveAttribute('data-action', 'signal-knows');
        await expect(items.nth(1).locator('.menu-act-text')).toHaveText('What the research knows · 1 conflict ›');
        // No research mark on a choice, no fact check, no other tree.
        await expect(menu.locator('.research-open-mark, .research-ai-badge, [data-action^="signal-verify"], [data-action="cross-tree"]')).toHaveCount(0);
        // Rows of a mouse menu; the stack open above the card's bubble, its own bubble hidden.
        for (const h of await items.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(37.5);
        await expect(stack).toHaveAttribute('aria-expanded', 'true');
        await expect(stack).toHaveClass(/\bis-open\b/);
        await expect(card(page, 'Eva').locator('.mt-stack')).toBeHidden();
        // Under the stack, its left edge at the stack's.
        const sb = (await stack.boundingBox())!;
        const mb = await boxOf(menu);
        // (The card under the mouse grows by 3 %: a px or two between the stack then and now.)
        expect(Math.abs(mb.x - sb.x)).toBeLessThanOrEqual(4);
        expect(mb.y).toBeGreaterThanOrEqual(sb.y + sb.height + 5);
        expect(mb.width).toBeGreaterThanOrEqual(240);
        expect(mb.width).toBeLessThanOrEqual(320);

        await items.nth(1).click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await expect(menu).toHaveCount(0);
        await expect(stack).toHaveAttribute('aria-expanded', 'false');
        await page.keyboard.press('Escape');

        // "Answer": what the card's ! does.
        await spyOn(page, 'answerPersonWaiting');
        await stack.click();
        await menu.locator('[data-action="signal-waiting"]').click();
        await expect(menu).toHaveCount(0);
        expect(await callsOf(page, 'answerPersonWaiting')).toBe(1);
    });

    test('one signal keeps its badge and its click; three signals stack three, the menu still two choices', async ({ page }) => {
        await setup(page);
        const jan = card(page, 'Jan');
        await expect(jan.locator('.card-signal-stack')).toHaveCount(0);
        await expect(jan.locator('.card-signal')).toHaveAttribute('data-mark', 'badge');
        await jan.locator('.card-signal').click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await expect(page.locator(`${MENU}, .context-menu`)).toHaveCount(0);
        await page.keyboard.press('Escape');

        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const eva = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Eva') as any;
            dm.updatePerson(eva.id, { question: 'Kde se Eva vdala?' } as never);
            window.Strom.TreeRenderer.render();
        });
        const stack = await evaStack(page);
        await expect(stack).toHaveClass(/\bn3\b/);
        await expect(stack.locator('.cs-coin')).toHaveCount(3);
        await stack.click();
        await expect(page.locator(MENU).locator('.menu-act-text')).toHaveText([
            'Answer · 1 waitingUložte snímek oddací matriky',
            'What the research knows · 1 conflict, 1 question ›',
        ]);
    });

    test('a click outside closes the menu and goes nowhere; a second click on the stack closes it; Esc too', async ({ page }) => {
        await setup(page);
        const stack = await evaStack(page);
        const menu = page.locator(MENU);
        await stack.click();
        await expect(menu).toBeVisible();
        // On another card: the menu goes, the card's menu does not open.
        await card(page, 'Josef').locator('.name').click();
        await expect(menu).toHaveCount(0);
        await expect(page.locator('.context-menu, .bottom-sheet-person')).toHaveCount(0);
        await expect(stack).toHaveAttribute('aria-expanded', 'false');
        // The next click is the card's again.
        await card(page, 'Josef').locator('.name').click();
        await expect(page.locator('.person-menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.person-menu')).toHaveCount(0);

        await stack.click();
        await expect(menu).toBeVisible();
        await stack.click();
        await expect(menu).toHaveCount(0);
        await expect(page.locator('.person-menu')).toHaveCount(0);

        await stack.click();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(stack).toBeFocused();
    });

    test('a zoom, a pan, a resize or a new drawing of the tree close the menu; it does not follow the card', async ({ page }) => {
        await setup(page);
        const stack = await evaStack(page);
        const menu = page.locator(MENU);
        await stack.click();
        await page.evaluate(() => window.Strom.ZoomPan.shiftWorld(20, 0));
        await expect(menu).toHaveCount(0);

        await stack.click();
        await page.mouse.move(700, 400);
        await page.mouse.wheel(0, 120);
        await expect(menu).toHaveCount(0);

        await expect(page.locator('#tree-canvas')).not.toHaveClass(/is-moving/);
        const again = await evaStack(page);
        await again.click();
        await page.setViewportSize({ width: 1400, height: 900 });
        await expect(menu).toHaveCount(0);

        await again.click();
        await expect(menu).toBeVisible();
        await page.evaluate(() => window.Strom.TreeRenderer.render());
        await expect(menu).toHaveCount(0);
    });

    test('keyboard: Enter, Space or ↓ on the stack open it at the first choice; arrows go round, Home / End; Esc back to the stack; Tab past it', async ({ page }) => {
        await setup(page);
        const stack = await evaStack(page);
        const menu = page.locator(MENU);
        const items = menu.locator('[role="menuitem"]');
        await stack.focus();
        await page.keyboard.press('Enter');
        await expect(menu).toBeVisible();
        await expect(items.nth(0)).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(1)).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(0)).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(items.nth(1)).toBeFocused();
        await page.keyboard.press('Home');
        await expect(items.nth(0)).toBeFocused();
        await page.keyboard.press('End');
        await expect(items.nth(1)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(stack).toBeFocused();
        await expect(stack).toHaveAttribute('aria-expanded', 'false');

        await page.keyboard.press('ArrowDown');
        await expect(items.nth(0)).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(menu).toHaveCount(0);
        await expect(stack).not.toBeFocused();
        await expect(page.locator('.context-menu')).toHaveCount(0);

        await stack.focus();
        await page.keyboard.press(' ');
        await expect(items.nth(0)).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(menu).toHaveCount(0);
        await expect(page.locator('#person-research-modal')).toBeVisible();
    });

    test('the menu opens with the menus’ fade, without it when motion is reduced', async ({ page }) => {
        await setup(page);
        const stack = await evaStack(page);
        const menu = page.locator(MENU);
        // (The suite runs with motion reduced.)
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await stack.click();
        await expect(menu).toHaveCSS('animation-name', 'fadeIn');
        await page.keyboard.press('Escape');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await stack.click();
        await expect(menu).toHaveCSS('animation-name', 'none');
    });

    test('at the right and the bottom edge the menu stays in the window', async ({ page }) => {
        await setup(page);
        const stack = await evaStack(page);
        const menu = page.locator(MENU);
        const vw = 1440;
        const vh = 900;

        await moveStackTo(page, stack, vw - 120, 300);
        await stack.click();
        let sb = (await stack.boundingBox())!;
        let mb = await boxOf(menu);
        // No room on the right: its right edge at the stack's.
        expect(mb.x + mb.width).toBeLessThanOrEqual(vw - 8 + 0.5);
        expect(Math.abs(mb.x + mb.width - (sb.x + sb.width))).toBeLessThanOrEqual(4);
        expect(mb.y).toBeGreaterThan(sb.y + sb.height);
        await page.keyboard.press('Escape');

        await moveStackTo(page, stack, 500, vh - 60);
        await stack.click();
        sb = (await stack.boundingBox())!;
        mb = await boxOf(menu);
        // No room below: above the stack.
        expect(mb.y + mb.height).toBeLessThanOrEqual(sb.y - 5);
        expect(mb.y).toBeGreaterThanOrEqual(8);
        // (The card under the mouse grows by 3 %: a px or two between the stack then and now.)
        expect(Math.abs(mb.x - sb.x)).toBeLessThanOrEqual(4);
    });
});

test.describe('the stack of badges by touch', () => {
    test('phone 390: a tap opens a bottom sheet with the choices alone, 48px rows; a tap beside closes it and goes nowhere; a swipe down too', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' });
        const page = await context.newPage();
        await seedWaiting(page);
        await openApp(page);
        await dropFile(page, researchGed());
        const stack = await evaStack(page);
        const tapStack = async () => {
            const b = (await stack.locator('.cs-front').boundingBox())!;
            await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        };
        await tapStack();
        const sheet = page.locator('.card-signals-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveAttribute('aria-label', 'Eva Fíšková: what waits');
        await expect(page.locator('#status-tip')).toBeHidden();
        await expect(sheet.locator('.sheet-tiles, .menu-chip')).toHaveCount(0);
        await expect(sheet.locator('.bottom-sheet-menu-title')).toHaveText('Eva Fíšková');
        const items = sheet.locator('[role="menuitem"]');
        await expect(items).toHaveCount(2);
        await expect(items.nth(0)).toHaveAttribute('data-action', 'signal-waiting-list');
        await expect(items.nth(0).locator('.menu-act-text')).toHaveText('Waiting · 1 ›Uložte snímek oddací matriky');
        await page.waitForTimeout(300);
        for (const h of await items.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(47.5);
        const box = (await sheet.boundingBox())!;
        expect(box.y + box.height).toBeCloseTo(844, 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        // A tap on the darkened tree: the sheet goes, nothing else opens.
        await page.locator('.bottom-sheet-overlay').click({ position: { x: 20, y: 20 } });
        await expect(sheet).toHaveCount(0);
        await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
        await expect(stack).toHaveAttribute('aria-expanded', 'false');

        // A swipe down closes it.
        await tapStack();
        await expect(sheet).toBeVisible();
        await sheet.evaluate((el) => {
            const at = (y: number) => [new Touch({ identifier: 1, target: el, clientX: 200, clientY: y })];
            el.dispatchEvent(new TouchEvent('touchstart', { touches: at(600), changedTouches: at(600), bubbles: true }));
            el.dispatchEvent(new TouchEvent('touchmove', { touches: at(720), changedTouches: at(720), bubbles: true }));
            el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: at(720), bubbles: true }));
        });
        await expect(sheet).toHaveCount(0);

        // A choice runs it.
        await tapStack();
        await sheet.locator('[data-action="signal-knows"]').tap();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await expect(sheet).toHaveCount(0);
        await context.close();
    });

    test('tablet 1024: a tap opens the menu at the stack with 44px rows; a tap beside closes it and goes nowhere', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true, locale: 'en-US' });
        const page = await context.newPage();
        await seedWaiting(page);
        await openApp(page);
        await dropFile(page, researchGed());
        const stack = await evaStack(page);
        const b = (await stack.locator('.cs-front').boundingBox())!;
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        const menu = page.locator(`${MENU}.is-touch`);
        await expect(menu).toBeVisible();
        await expect(page.locator('#status-tip')).toBeHidden();
        await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
        const items = menu.locator('[role="menuitem"]');
        await expect(items.nth(0)).toHaveAttribute('data-action', 'signal-waiting-list');
        for (const h of await items.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(43.5);
        const mb = await boxOf(menu);
        expect(mb.x).toBeGreaterThanOrEqual(8);
        expect(mb.x + mb.width).toBeLessThanOrEqual(1024 - 8 + 0.5);
        expect(mb.y + mb.height).toBeLessThanOrEqual(768 - 8 + 0.5);
        // A tap on Josef's card: the menu goes, his sheet does not open.
        const josef = (await card(page, 'Josef').locator('.name').boundingBox())!;
        await page.touchscreen.tap(josef.x + josef.width / 2, josef.y + josef.height / 2);
        await expect(menu).toHaveCount(0);
        await page.waitForTimeout(300);
        await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
        await context.close();
    });
});

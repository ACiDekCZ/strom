import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, focusViaSearch, seedTree, type SeedPerson } from './helpers.js';

function canvasTransform(page: Page): Promise<string> {
    return page.locator('#tree-canvas').evaluate((el) => (el as HTMLElement).style.transform);
}

/** Current zoom scale (zoom is animated, so assertions must poll this). */
function scale(page: Page): Promise<number> {
    return page.evaluate(() => window.Strom.ZoomPan.getScale());
}

/** Wait until the zoom animation stops (two identical reads ~100ms apart). */
function waitZoomSettled(page: Page): Promise<unknown> {
    return page.waitForFunction(() => new Promise<boolean>((resolve) => {
        const a = window.Strom.ZoomPan.getScale();
        setTimeout(() => resolve(window.Strom.ZoomPan.getScale() === a), 100);
    }));
}

test('keyboard: Ctrl+F focuses search, +/0 zoom, Esc closes a modal', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Ctrl+F focuses the toolbar search input.
    const searchInput = page.locator('#toolbar-search-picker .person-picker-input');
    await page.keyboard.press('Control+f');
    await expect(searchInput).toBeFocused();

    // Blur the input so single-key zoom shortcuts are active (they are ignored
    // while a text field holds focus). Click an empty corner so the click does
    // not land on the centred card (which would open the context menu).
    await searchInput.blur();
    await page.locator('#tree-container').click({ position: { x: 8, y: 8 } });
    await expect(searchInput).not.toBeFocused();
    const base = await scale(page);
    await page.keyboard.press('+');
    await expect.poll(() => scale(page)).toBeGreaterThan(base);
    // reset() does not cancel the in-flight zoom animation, so wait for it to
    // fully settle before pressing 0, otherwise the animation clobbers the reset.
    await waitZoomSettled(page);
    await expect(searchInput).not.toBeFocused();
    await page.keyboard.press('0'); // reset to scale 1
    await expect.poll(() => scale(page)).toBe(1);

    // Esc closes an open modal.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await expect(page.locator('#person-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#person-modal')).toBeHidden();
});

test('zoom controls and mouse wheel change the zoom level', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const base = await scale(page);
    await page.locator('.zoom-controls button').first().click(); // zoom in
    await expect.poll(() => scale(page)).toBeGreaterThan(base);

    // Mouse wheel over the canvas also changes the zoom.
    const afterButton = await scale(page);
    await page.locator('#tree-container').hover();
    await page.mouse.wheel(0, -200);
    await expect.poll(() => scale(page)).not.toBe(afterButton);
});

test('dragging the canvas pans the tree', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const before = await canvasTransform(page);
    const box = await page.locator('#tree-container').boundingBox();
    if (!box) throw new Error('no tree container');
    // Drag from an empty area of the canvas.
    await page.mouse.move(box.x + box.width - 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 160, box.y + 160, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => canvasTransform(page)).not.toBe(before);
});

test('a drag that starts on a card pans the canvas past a few pixels and opens no menu; a short one stays a click (T38)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const menu = page.locator('.context-menu');
    const box = (await card(page, 'Jan').boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

    // A drag from the card: the canvas follows, the release opens nothing.
    const pan = () => page.evaluate(() => window.Strom.ZoomPan.getTransform() as { tx: number; ty: number });
    const before = await pan();
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 120, cy + 90, { steps: 10 });
    await page.mouse.up();
    // The canvas moved with the pointer from where the press began.
    const after = await pan();
    expect(after.tx - before.tx).toBeCloseTo(-120, 0);
    expect(after.ty - before.ty).toBeCloseTo(90, 0);
    const panned = await canvasTransform(page);
    await page.waitForTimeout(150);
    await expect(menu).toHaveCount(0);

    // Moving less than the threshold: still the card's click, the canvas stays.
    const moved = (await card(page, 'Jan').boundingBox())!;
    const mx = moved.x + moved.width / 2, my = moved.y + moved.height / 2;
    await page.mouse.move(mx, my);
    await page.mouse.down();
    await page.mouse.move(mx + 5, my + 3, { steps: 3 });
    await page.mouse.up();
    await expect(menu.first()).toBeVisible();
    expect(await canvasTransform(page)).toBe(panned);
});

test('the canvas is a compositor layer only while it zooms, never for a pan, and pans in whole pixels (sharp cards) (T01, 1112)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const willChange = () => page.locator('#tree-canvas').evaluate((el) => getComputedStyle(el).willChange);

    // At rest: no layer hint (a kept layer is scaled, not redrawn — blurry cards).
    await expect.poll(willChange).toBe('auto');

    // Dragging only moves the canvas, as the minimap does: no hint while the
    // mouse is down and moving, none after (a layer made the cards flicker, 1112).
    const box = (await page.locator('#tree-container').boundingBox())!;
    const before = await canvasTransform(page);
    await page.mouse.move(box.x + box.width - 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 120, box.y + 120, { steps: 4 });
    expect(await canvasTransform(page)).not.toBe(before);
    expect(await willChange()).toBe('auto');
    await page.mouse.up();
    expect(await willChange()).toBe('auto');

    // Wheel zoom has no end event: on while wheeling, off once it is quiet.
    const whileWheeling = await page.evaluate(([x, y]) => {
        const container = document.getElementById('tree-container')!;
        container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        return getComputedStyle(document.getElementById('tree-canvas')!).willChange;
    }, [box.x + box.width - 40, box.y + 40]);
    expect(whileWheeling).toBe('transform');
    await expect.poll(willChange).toBe('auto');

    // A fractional pan is written as whole pixels.
    await page.evaluate(() => window.Strom.ZoomPan.centerOnWorldPoint(100.37, 50.61));
    const t = await canvasTransform(page);
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(t);
    expect(m, t).not.toBeNull();
    expect(Number.isInteger(Number(m![1])) && Number.isInteger(Number(m![2])), t).toBe(true);
});

/**
 * A family of three generations, every couple with three children: enough
 * cards on screen at 45 % for the generation labels to show over them.
 */
function threeGenerations(): Record<string, SeedPerson> {
    const people: Record<string, SeedPerson> = {
        a: { firstName: 'Hostivít', lastName: 'Kvapil', gender: 'male', partners: ['b'] },
        b: { firstName: 'Zdeslava', lastName: 'Kvapilová', gender: 'female', partners: ['a'] },
    };
    for (let i = 0; i < 3; i++) {
        const child = `c${i}`, spouse = `s${i}`;
        people[child] = { firstName: `Radegast${i}`, lastName: 'Kvapil', gender: 'male', parents: ['a', 'b'], partners: [spouse] };
        people[spouse] = { firstName: `Dobromila${i}`, lastName: 'Ctiborová', gender: 'female', partners: [child] };
        for (let k = 0; k < 3; k++) {
            people[`g${i}${k}`] = { firstName: `Velemír${i}${k}`, lastName: 'Kvapil', gender: k % 2 ? 'female' : 'male', parents: [child, spouse] };
        }
    }
    return people;
}

test('a pan zoomed out to 45 % gives nothing in the canvas a layer of its own (no flicker, 1112)', async ({ page }) => {
    // The flicker: the canvas as a layer of its own while panned forced what
    // it holds into layers (the lines; on a large tree the generation labels
    // and every card over them), which came and went as the pan went on.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await seedTree(page, threeGenerations(), 'Kvapil', 'a');
    await page.evaluate(() => {
        const z = window.Strom.ZoomPan;
        const c = z.viewCenterWorld();
        z.zoomAroundWorldPoint(c.x, c.y, 0.45, 0, (t: number) => t);
    });
    await expect(page.locator('#tree-canvas')).toHaveClass(/zoom-far/);
    await expect(page.locator('#tree-canvas')).not.toHaveClass(/zoom-tiny/);
    await expect(page.locator('#gen-labels .gen-label:visible').first()).toBeVisible();

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('DOM.getDocument', { depth: 0 });
    let layers: { layerId: string; backendNodeId?: number }[] = [];
    cdp.on('LayerTree.layerTreeDidChange', (e) => { if (e.layers) layers = e.layers; });
    await cdp.send('LayerTree.enable');
    /** What inside the canvas (lines, labels, cards) has a layer of its own. */
    const ownLayers = async (): Promise<string[]> => {
        const out: string[] = [];
        for (const l of layers) {
            if (!l.backendNodeId) continue;
            const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: l.backendNodeId });
            if (!object.objectId) continue;
            const { result } = await cdp.send('Runtime.callFunctionOn', {
                objectId: object.objectId,
                returnByValue: true,
                functionDeclaration: 'function () { const c = document.getElementById("tree-canvas"); return this !== c && c.contains(this) ? (this.id || String(this.className?.baseVal ?? this.className)) : ""; }',
            });
            if (result.value) out.push(result.value as string);
        }
        return out;
    };

    // Grab the canvas where no card is and pan across the tree.
    const start = await page.evaluate(() => {
        const box = document.getElementById('tree-container')!.getBoundingClientRect();
        for (let y = box.top + box.height * 0.3; y < box.bottom - 40; y += 11) {
            for (let x = box.left + box.width * 0.3; x < box.right - 40; x += 13) {
                const el = document.elementFromPoint(x, y);
                if (el && !el.closest('.person-card, button, .minimap, .zoom-controls, .focus-controls') && el.closest('#tree-container')) return { x, y };
            }
        }
        return null;
    });
    expect(start).not.toBeNull();
    await page.mouse.move(start!.x, start!.y);
    await page.mouse.down();
    const seen = new Set<string>();
    for (let i = 1; i <= 8; i++) {
        await page.mouse.move(start!.x + i * 15, start!.y + i * 4);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        for (const l of await ownLayers()) seen.add(l);
    }
    await page.mouse.up();
    expect([...seen]).toEqual([]);
    await cdp.detach();
});

test('expanded mode: a multi-marriage person shows all partners inline', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();

    // Erik married twice; focusing him lays out both wives inline.
    await focusViaSearch(page, 'Erik');
    await expect(card(page, 'Laura')).toBeVisible();
    await expect(card(page, 'Rosa')).toBeVisible();
    // More than a single couple is on screen.
    expect(await page.locator('.person-card').count()).toBeGreaterThan(4);

    // Refocusing another person re-lays-out the tree around the new focus.
    await focusViaSearch(page, 'Sofia');
    await expect(card(page, 'Sofia')).toHaveClass(/focused/);
});

test('Escape closes dialogs that are not on the dialog stack (book, sources)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    await expect(page.locator('#book-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#book-modal')).toBeHidden();

    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    await expect(page.locator('#sources-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sources-modal')).toBeHidden();
    // Nothing resurrected.
    await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
});

test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the filter sheet keeps the zoom buttons (under its backdrop) and its own foot in view', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await expect(page.locator('.zoom-controls')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.toggleSearchFilters());
        await expect(page.locator('.zoom-controls')).toBeVisible();
        await expect(page.locator('#search-filters .search-filters-sheet-foot button').last()).toBeInViewport();
        await page.keyboard.press('Escape');   // closes the panel first
        await expect(page.locator('#search-filters')).toBeHidden();
        await expect(page.locator('.zoom-controls')).toBeVisible();
    });
});

test('focus back/forward buttons walk history in both directions', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    const back = page.locator('#focus-back-btn');
    const fwd = page.locator('#focus-forward-btn');
    await expect(back).toBeHidden();
    await expect(fwd).toBeHidden();

    const focusName = () => page.evaluate(() =>
        window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId())?.firstName ?? null);

    // Johan → Peter → (directly) Maria.
    await focusViaSearch(page, 'Peter');
    await expect(back).toBeVisible();
    await expect(fwd).toBeHidden();               // no forward yet
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Maria');
        if (p) window.Strom.TreeRenderer.setFocus(p.id);
    });
    await expect.poll(focusName).toBe('Maria');

    // Back to Peter: forward becomes available.
    await back.click();
    await expect.poll(focusName).toBe('Peter');
    await expect(fwd).toBeVisible();
    // Forward returns to Maria.
    await fwd.click();
    await expect.poll(focusName).toBe('Maria');
    await expect(fwd).toBeHidden();               // at the tip again

    // A NEW navigation after going back clears forward.
    await back.click();                            // → Peter
    await expect(fwd).toBeVisible();
    await focusViaSearch(page, 'Johan');       // new branch
    await expect(fwd).toBeHidden();
});



test('the very first navigation counts the default focus (back works after one step)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    // Fresh tree: no history yet.
    await expect(page.locator('#focus-back-btn')).toBeHidden();
    const defaultFocus = await page.evaluate(() =>
        window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId())?.firstName);

    // ONE navigation must already enable back (the default must be counted).
    await focusViaSearch(page, 'Peter');
    await expect(page.locator('#focus-back-btn')).toBeVisible();
    // Back returns to the default person.
    await page.locator('#focus-back-btn').click();
    await expect.poll(() => page.evaluate(() =>
        window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId())?.firstName)).toBe(defaultFocus);
});

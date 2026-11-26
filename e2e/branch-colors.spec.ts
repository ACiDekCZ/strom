import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Branch colours: a settings toggle adds a coloured stripe class to cards
 * (relative to the focus) and shows a legend; turning it off removes both.
 */
test('branch colours toggle adds card classes and a legend', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    // Colours default ON, the legend box defaults OFF (opt-in in settings).
    const legend = page.locator('#branch-legend');
    await expect(legend).toBeHidden();
    await page.evaluate(() => window.Strom.UI.toggleBranchLegend(true));
    await expect(legend).toBeVisible();
    // At least one card now carries a branch class (Johan has descendants/ancestors).
    await expect.poll(() =>
        page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').count()
    ).toBeGreaterThan(0);

    // Dark-mode smoke: stripes and legend still render under the dark theme.
    await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(legend).toBeVisible();
    await expect(page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').first()).toBeVisible();
    await page.evaluate(() => window.Strom.SettingsManager.setTheme('system'));

    // No shape (and no tint) → stripes and legend gone.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('input[name="branch-marker"][value="none"]').check();
    await expect(legend).toBeHidden();
    await expect.poll(() =>
        page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').count()
    ).toBe(0);

    // A shape again → they come back.
    await page.locator('input[name="branch-marker"][value="arc"]').check();
    await expect(legend).toBeVisible();
});

/** Settings > Tree view (spec 112, R1): five shapes with previews, the tint beside every one ("no shape" too) and remembered. */
test('the lineage markers\' settings: shapes, previews, the tint with no shape (spec 112)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const group = page.locator('#branch-marker-setting');
    await expect(group.locator('legend .settings-name')).toHaveText('Lineage markers');
    const opts = group.locator('.branch-marker-opt');
    await expect(opts.locator('.bm-name')).toHaveText(['Arc', 'Letter tag', 'Stripe', 'Corner', 'No shape']);
    await expect(group.locator('.bm-default')).toHaveCount(1);
    await expect(opts.first().locator('.bm-default')).toHaveText('default');
    // The default: the arc, chosen as a "Linka" selection (filled).
    const arc = group.locator('input[value="arc"]');
    await expect(arc).toBeChecked();
    const fill = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sel-fill').trim());
    const rowBg = await opts.first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(rowBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(fill).not.toBe('');
    // Each shape's preview draws the shape with the cards' rules; No shape's card has none.
    const preview = (v: string) => group.locator(`.branch-marker-opt:has(input[value="${v}"]) .bm-card`);
    expect(await preview('tag').evaluate(el => getComputedStyle(el, '::after').content)).toBe('"P"');
    expect(await preview('stripe').evaluate(el => getComputedStyle(el, '::before').width)).toBe('3px');
    expect(await preview('none').evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
    // No preview is a card of the tree.
    await expect(group.locator('.person-card')).toHaveCount(0);

    // The tint stays enabled and checked with No shape (Milan 19 Nov 2026): the cards are only tinted.
    const tint = page.locator('#branch-tint-toggle');
    await expect(tint).toBeEnabled();
    await tint.check();
    await expect(page.locator('body')).toHaveAttribute('data-branch-tint', '');
    await group.locator('input[value="none"]').check();
    await expect(tint).toBeEnabled();
    await expect(tint).toBeChecked();
    await expect(page.locator('#branch-tint-row')).toHaveCSS('opacity', '1');
    await expect(page.locator('body')).toHaveAttribute('data-branch-tint', '');
    // No shape's preview shows the tint while it is on.
    const tintOf = await preview('none').evaluate(el => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--branch-paternal-tint)';
        document.body.appendChild(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { got: getComputedStyle(el).backgroundColor, want };
    });
    expect(tintOf.got).toBe(tintOf.want);
    await group.locator('input[value="corner"]').check();
    await expect(page.locator('body')).toHaveAttribute('data-branch-marker', 'corner');
    await expect(tint).toBeEnabled();
    await expect(tint).toBeChecked();
    // Kept over a reload.
    await page.reload();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-branch-marker', 'corner');
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(page.locator('#branch-marker-setting input[value="corner"]')).toBeChecked();
    await expect(page.locator('#branch-tint-toggle')).toBeChecked();
});

/** The legend's lineage part (spec 112 §3): the signs in the chosen shape and the "no marker" line. */
test('the legend draws the lines\' signs in the chosen shape (spec 112)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.toggleBranchLegend(true));
    const legend = page.locator('#branch-legend');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.branch-legend-label')).toHaveText(['Paternal', 'Maternal', 'Descendants']);
    await expect(legend.locator('.branch-legend-none')).toHaveText('No marker: focused person, partners, siblings, cousins');
    const shapes = () => legend.locator('.branch-swatch').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.shape));
    expect(await shapes()).toEqual(['arc', 'arc', 'arc']);
    await page.evaluate(() => window.Strom.UI.setBranchMarker('tag'));
    expect(await shapes()).toEqual(['tag', 'tag', 'tag']);
    // The tag's letters as on the cards.
    expect(await legend.locator('.branch-swatch > i').evaluateAll(els => els.map(e => getComputedStyle(e, '::before').content)))
        .toEqual(['"P"', '"M"', '"D"']);
    // The tint: 4px of the line's tint around the sign.
    await page.evaluate(() => window.Strom.UI.setBranchTint(true));
    await expect(legend.locator('.branch-swatch').first()).toHaveCSS('padding-top', '4px');
    // Nothing of the legend overflows its panel.
    const fits = await page.locator('#tree-legend').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
    // No shape + tint: the signs are the tint's 16px squares; without the tint no lineage legend.
    await page.evaluate(() => window.Strom.UI.setBranchMarker('none'));
    await expect(legend).toBeVisible();
    expect(await shapes()).toEqual(['none', 'none', 'none']);
    const sq = legend.locator('.branch-swatch > i').first();
    await expect(sq).toHaveCSS('width', '16px');
    await expect(sq).toHaveCSS('height', '16px');
    // Each square is framed in its line's colour, its fill the line's tint, in both themes;
    // in the dark one the three tints stay apart from each other (spec 112, 19 Nov 2026).
    const squares = () => legend.locator('.branch-swatch > i').evaluateAll(els => els.map(e => {
        const line = (e.parentElement as HTMLElement).dataset.line;
        const probe = document.createElement('span');
        probe.style.color = `var(--branch-${line})`;
        probe.style.background = `var(--branch-${line}-tint)`;
        document.body.appendChild(probe);
        const want = { border: getComputedStyle(probe).color, fill: getComputedStyle(probe).backgroundColor };
        probe.remove();
        const cs = getComputedStyle(e);
        return { want, border: cs.borderTopColor, fill: cs.backgroundColor };
    }));
    for (const theme of ['light', 'dark'] as const) {
        await page.evaluate(t => window.Strom.SettingsManager.setTheme(t), theme);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const got = await squares();
        for (const s of got) expect({ border: s.border, fill: s.fill }).toEqual(s.want);
        expect(new Set(got.map(s => s.fill)).size).toBe(3);
    }
    await page.evaluate(() => window.Strom.SettingsManager.setTheme('system'));
    await page.evaluate(() => window.Strom.UI.setBranchTint(false));
    await expect(legend).toBeHidden();
});

test('the legend can be hidden separately while stripes stay on', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    const legend = page.locator('#branch-legend');
    await expect(legend).toBeHidden();   // default OFF
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('#branch-legend-toggle').check();
    await expect(legend).toBeVisible();
    await page.locator('#branch-legend-toggle').uncheck();
    await expect(legend).toBeHidden();
    // Stripes stay on throughout.
    await expect(page.locator('.person-card.branch-descendant').first()).toBeVisible();
});

test('the branch stripe follows the card\'s rounded corners, also on the focused card (T06)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    const striped = page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant');
    await expect.poll(() => striped.count()).toBeGreaterThan(0);

    // The stripe layer is the card's own border box with the card's rounding
    // (painted only on its left 4px), not a 4px bar whose corners the browser
    // shrinks to a different curve.
    const shapes = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>(
            '.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant'));
        const plain = cards.find(c => !c.classList.contains('focused'))!;
        // The focus card has no branch of its own: give a striped card the
        // focused look (2px border) to check that case too.
        const other = cards.find(c => c !== plain)!;
        other.classList.add('focused');
        const out = [plain, other].map(c => {
            const cs = getComputedStyle(c);
            const st = getComputedStyle(c, '::before');
            return {
                focused: c.classList.contains('focused'),
                radius: [st.borderTopLeftRadius, st.borderBottomLeftRadius].join(' ') === [cs.borderTopLeftRadius, cs.borderBottomLeftRadius].join(' '),
                // Border box: the stripe starts at the card's outer edge.
                left: parseFloat(st.left) === -parseFloat(cs.borderLeftWidth),
                width: Math.abs(parseFloat(st.width) - c.offsetWidth) < 0.01,
                height: Math.abs(parseFloat(st.height) - c.offsetHeight) < 0.01,
            };
        });
        other.classList.remove('focused');
        return out;
    });
    expect(shapes.length).toBe(2);
    for (const s of shapes) expect(s, s.focused ? 'focused card' : 'card').toMatchObject({ radius: true, left: true, width: true, height: true });
});

/** Lineage markers (spec 112): the chosen shape on <body>, the tag's letter, the tint, the words for a screen reader. */
test('the marker shape, the tint and the lineage words follow the setting (spec 112)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    const marked = page.locator('#tree-canvas .person-card.branch-descendant').first();
    await expect(marked).toBeVisible();
    // Default: the arc, no tint.
    await expect(page.locator('body')).toHaveAttribute('data-branch-marker', 'arc');
    await expect(page.locator('body')).not.toHaveAttribute('data-branch-tint', /.*/);

    // The letter tag: the descendants' letter from the strings, over the left edge.
    await page.evaluate(() => window.Strom.UI.setBranchMarker('tag'));
    await expect(page.locator('body')).toHaveAttribute('data-branch-marker', 'tag');
    const tag = await marked.evaluate(el => {
        const st = getComputedStyle(el, '::after');
        return { content: st.content, left: st.left };
    });
    expect(tag).toEqual({ content: '"D"', left: '-8px' });

    // The stripe: a 4px bar inside the left edge; the corner: an outline triangle for descendants.
    await page.evaluate(() => window.Strom.UI.setBranchMarker('stripe'));
    expect(await marked.evaluate(el => {
        const st = getComputedStyle(el, '::before');
        return { width: st.width, left: st.left, top: st.top };
    })).toEqual({ width: '4px', left: '2px', top: '10px' });
    await page.evaluate(() => window.Strom.UI.setBranchMarker('corner'));
    expect(await marked.evaluate(el => {
        const st = getComputedStyle(el, '::before');
        return { width: st.width, hole: st.clipPath.startsWith('path(evenodd') };
    })).toEqual({ width: '16px', hole: true });
    await page.evaluate(() => window.Strom.UI.setBranchMarker('tag'));

    // The tint: the card's ground in the lineage's tint token.
    await page.evaluate(() => window.Strom.UI.setBranchTint(true));
    await expect(page.locator('body')).toHaveAttribute('data-branch-tint', '');
    const bg = await marked.evaluate(el => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--branch-descendant-tint)';
        document.body.appendChild(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { got: getComputedStyle(el).backgroundColor, want };
    });
    expect(bg.got).toBe(bg.want);

    // The lineage in words (pseudo-elements are not read): a hidden text the card is described by.
    const words = await marked.evaluate(el => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent);
    expect(words).toBe('descendant');

    // No shape + tint: the cards keep their line classes and the tint, without a marker (Milan 19 Nov 2026).
    await page.evaluate(() => window.Strom.UI.setBranchMarker('none'));
    await expect(page.locator('body')).not.toHaveAttribute('data-branch-marker', /.*/);
    await expect(page.locator('body')).toHaveAttribute('data-branch-tint', '');
    const tinted = page.locator('#tree-canvas .person-card.branch-descendant').first();
    await expect(tinted).toBeVisible();
    expect(await tinted.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(bg.want);
    expect(await tinted.evaluate(el => [getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content]))
        .toEqual(['none', 'none']);
    // No shape without the tint: no marking at all.
    await page.evaluate(() => window.Strom.UI.setBranchTint(false));
    await expect(page.locator('body')).not.toHaveAttribute('data-branch-tint', /.*/);
    await expect.poll(() => page.locator('#tree-canvas .person-card.branch-descendant').count()).toBe(0);
    await page.evaluate(() => { window.Strom.UI.setBranchMarker('corner'); window.Strom.UI.setBranchTint(true); });
    await expect(page.locator('body')).toHaveAttribute('data-branch-tint', '');
});

/** The Timeline's sign before the name and the Table's Lineage column follow the marker setting (spec 112 §3). */
test('the Timeline and the Table show the lineage sign in the chosen shape (spec 112)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    // Timeline: the legend's sign before the names of the marked people; the focus has an empty slot.
    await page.locator('#view-mode-timeline').click();
    await expect(page.locator('.timeline-bar').first()).toBeVisible();
    const signs = page.locator('#timeline-container .tl-name .branch-sign');
    await expect.poll(() => signs.count()).toBeGreaterThan(0);
    await expect(signs.first()).toHaveAttribute('data-shape', 'arc');
    const focusSlot = page.locator('#timeline-container .timeline-bar.focused .branch-sign-slot');
    await expect(focusSlot).toHaveCount(1);
    await expect(focusSlot.locator('.branch-sign')).toHaveCount(0);
    // The tint never reaches the sign; the life bar keeps the sex's colour.
    await page.evaluate(() => { window.Strom.UI.setBranchMarker('tag'); window.Strom.UI.setBranchTint(true); });
    await expect(signs.first()).toHaveAttribute('data-shape', 'tag');
    expect(await signs.first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const fills = await page.locator('.tl-bar-rect').evaluateAll(els => [...new Set(els.map(el => el.getAttribute('fill')))]);
    expect(fills.every(f => /^var\(--(male|female|unknown)\)$/.test(f ?? ''))).toBe(true);
    // No shape: no sign to draw (the tint never reaches the Timeline).
    await page.evaluate(() => window.Strom.UI.setBranchMarker('none'));
    await expect(page.locator('#timeline-container .branch-sign-slot')).toHaveCount(0);

    // Table: the Lineage column is hidden by default and offered in the Columns panel.
    await page.evaluate(() => window.Strom.UI.setBranchMarker('stripe'));
    await page.locator('#view-mode-table').click();
    await expect(page.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
    await expect(page.locator('#table-container .tv-headrow [data-col="lineage"]')).toHaveCount(0);
    await page.locator('#table-container .tv-cols-btn').click();
    const panel = page.getByRole('dialog', { name: 'Columns' });
    await page.locator('.tv-cp-q').fill('Lineage');
    await panel.getByRole('checkbox', { name: 'Lineage', exact: true }).check();
    await expect(page.locator('#table-container .tv-headrow [data-col="lineage"]')).toHaveCount(1);
    await panel.getByRole('button', { name: 'Done' }).click();
    const cells = page.locator('#table-container .tv-body .tv-lineage');
    await expect.poll(() => cells.count()).toBeGreaterThan(0);
    await expect(cells.first().locator('.branch-sign')).toHaveAttribute('data-shape', 'stripe');
    await expect(cells.first().locator('.tv-cell-text')).toHaveText(/^(Paternal|Maternal|Paternal and maternal|Descendant)$/);
});

/** The poster draws the chosen marker and tint (spec 112 §3); the print has one grey frame and the print colours (R6). */
test('the poster and the print carry the lineage markers (spec 112)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => { window.Strom.UI.setBranchMarker('tag'); window.Strom.UI.setBranchTint(true); });

    // The poster's SVG: the letter tags in the P2 colours, the tinted ground.
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        poster.locator('.menu-option', { hasText: 'SVG' }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    expect(svg).toMatch(/<g class="branch-mark" data-shape="tag" data-branch="descendant"><rect [^>]*fill="#8a6400"[^>]*\/><text [^>]*>D<\/text>/);
    expect(svg).toContain('fill="#f3eedf"');
    expect(svg).not.toContain('class="branch-stripe"');
    await page.keyboard.press('Escape');
    await expect(poster).toBeHidden();

    // The print: one grey 2px frame whatever the sex, no tint, the markers in the print colours.
    await page.emulateMedia({ media: 'print' });
    const frame = (el: Element) => { const st = getComputedStyle(el); return `${st.borderTopWidth} ${st.borderTopColor}`; };
    const male = page.locator('#tree-canvas .person-card.male:not(.placeholder)').first();
    const female = page.locator('#tree-canvas .person-card.female:not(.placeholder)').first();
    expect(await male.evaluate(frame)).toBe('2px rgb(153, 153, 153)');
    expect(await female.evaluate(frame)).toBe('2px rgb(153, 153, 153)');
    const marked = page.locator('#tree-canvas .person-card.branch-descendant').first();
    expect(await marked.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    expect(await marked.evaluate(el => getComputedStyle(el, '::after').backgroundColor)).toBe('rgb(110, 79, 0)');
    // The arc starts at the 2px frame's outer edge.
    await page.evaluate(() => window.Strom.UI.setBranchMarker('arc'));
    expect(await marked.evaluate(el => getComputedStyle(el, '::before').top)).toBe('-2px');
    await page.emulateMedia({ media: 'screen' });
    expect(await marked.evaluate(el => getComputedStyle(el, '::before').top)).toBe('-1px');
});

/**
 * The legend pill and back / forward share the bottom-left corner: on every width the pill stays where it
 * was and the buttons stand above it (on a phone since spec 082 K1.2, T44; on a desktop and a tablet since
 * T54 H1 — before, the pill was lifted above them, T32).
 */
for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'tablet', width: 820, height: 1180 }, { name: 'phone', width: 390, height: 844 }]) {
    test.describe(`legend and back on ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });
        test(`the legend never covers back / forward (${vp.name})`, async ({ page }) => {
            const phone = vp.name === 'phone';
            await openApp(page);
            await page.getByRole('button', { name: 'Try the small sample' }).click();
            await expect(card(page, 'Johan')).toBeVisible();
            await page.evaluate(() => window.Strom.UI.toggleBranchLegend(true));
            const legend = page.locator('#tree-legend');
            await expect(legend).toBeVisible();
            const before = (await legend.boundingBox())!;
            await page.evaluate(() => {
                const S = window.Strom;
                const ids = Object.keys(S.DataManager.getData().persons);
                S.TreeRenderer.setFocus(ids[5] as never);
            });
            const back = page.locator('#focus-back-btn');
            await expect(back).toBeVisible();
            /** The button and the legend apart, in the order of the viewport. */
            const apart = async (nav: typeof back): Promise<void> => {
                await expect.poll(async () => {
                    const b = (await nav.boundingBox())!;
                    const l = (await legend.boundingBox())!;
                    return b.y + b.height <= l.y;
                }).toBe(true);
            };
            await apart(back);
            const l = (await legend.boundingBox())!;
            // The legend stays where it was.
            expect(Math.round(l.x)).toBe(Math.round(before.x));
            expect(Math.round(l.y)).toBe(Math.round(before.y));
            if (phone) {
                // At the bottom edge: just above the bottom bar.
                const bar = (await page.locator('#bottom-bar').boundingBox())!;
                expect(bar.y - (l.y + l.height)).toBeLessThanOrEqual(16);
            }
            // Back to the first focus: forward alone keeps the same order.
            await page.evaluate(() => window.Strom.TreeRenderer.goBack());
            const fwd = page.locator('#focus-forward-btn');
            await expect(fwd).toBeVisible();
            await apart(fwd);
        });
    });
}

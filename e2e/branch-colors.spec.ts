import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Branch colours: a settings toggle adds a coloured stripe class to cards
 * (relative to the focus) and shows a legend; turning it off removes both.
 */
test('branch colours toggle adds card classes and a legend', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
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

    // Off → stripes and legend gone.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('input[name="branch-marker"][value="off"]').check();
    await expect(legend).toBeHidden();
    await expect.poll(() =>
        page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').count()
    ).toBe(0);

    // A shape again → they come back.
    await page.locator('input[name="branch-marker"][value="arc"]').check();
    await expect(legend).toBeVisible();
});

/** Settings > Tree view (spec 112, R1): five shapes with previews, the tint disabled while off and remembered. */
test('the lineage markers\' settings: shapes, previews, the tint under off (spec 112)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const group = page.locator('#branch-marker-setting');
    await expect(group.locator('legend .settings-name')).toHaveText('Lineage markers');
    const opts = group.locator('.branch-marker-opt');
    await expect(opts.locator('.bm-name')).toHaveText(['Arc', 'Letter tag', 'Stripe', 'Corner', 'Off']);
    await expect(group.locator('.bm-default')).toHaveCount(1);
    await expect(opts.first().locator('.bm-default')).toHaveText('default');
    // The default: the arc, chosen as a "Linka" selection (filled).
    const arc = group.locator('input[value="arc"]');
    await expect(arc).toBeChecked();
    const fill = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sel-fill').trim());
    const rowBg = await opts.first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(rowBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(fill).not.toBe('');
    // Each shape's preview draws the shape with the cards' rules; Off's card has none.
    const preview = (v: string) => group.locator(`.branch-marker-opt:has(input[value="${v}"]) .bm-card`);
    expect(await preview('tag').evaluate(el => getComputedStyle(el, '::after').content)).toBe('"P"');
    expect(await preview('stripe').evaluate(el => getComputedStyle(el, '::before').width)).toBe('3px');
    expect(await preview('off').evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
    // No preview is a card of the tree.
    await expect(group.locator('.person-card')).toHaveCount(0);

    // The tint: on, then Off disables it (shown unchecked), a shape brings it back checked.
    const tint = page.locator('#branch-tint-toggle');
    await expect(tint).toBeEnabled();
    await tint.check();
    await expect(page.locator('body')).toHaveAttribute('data-branch-tint', '');
    await group.locator('input[value="off"]').check();
    await expect(tint).toBeDisabled();
    await expect(tint).not.toBeChecked();
    await expect(page.locator('#branch-tint-row')).toHaveCSS('opacity', '0.5');
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
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
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
});

test('the legend can be hidden separately while stripes stay on', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
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
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
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
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
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

    // Off: no shape, no tint (the tint stays chosen for later), no marked cards.
    await page.evaluate(() => window.Strom.UI.setBranchMarker('off'));
    await expect(page.locator('body')).not.toHaveAttribute('data-branch-marker', /.*/);
    await expect(page.locator('body')).not.toHaveAttribute('data-branch-tint', /.*/);
    await expect.poll(() => page.locator('#tree-canvas .person-card.branch-descendant').count()).toBe(0);
    await page.evaluate(() => window.Strom.UI.setBranchMarker('corner'));
    await expect(page.locator('body')).toHaveAttribute('data-branch-tint', '');
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
            await page.getByRole('button', { name: 'Try a sample tree' }).click();
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

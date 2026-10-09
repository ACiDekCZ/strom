import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Linked in the view only, the card's menu and detail and "What research
 * knows": a ghost's own block in its menu (its state, Unlink, what research
 * knows about the link), "Show as linked…" after Focus (one version at once,
 * more in a second level — on a phone the sheet's second page), "Unlink the
 * shown parents / partner"; the hypotheses with their versions and switches
 * (a radio group that can have none), opened at the hypothesis from the
 * line's label; the Add dialog's notes and "Link the shown" (a real link, by
 * hand: one undo step), the relationship calculator (real links only), the
 * person's detail, the delete confirmation and the descendants of a ghost.
 * Invented data only (e2e/fixtures/research-hypothesis-links.ged).
 */

const GED = readFileSync('e2e/fixtures/research-hypothesis-links.ged', 'utf-8');

/** The same tree without anything a variant would connect: the feature does not show. */
const GED_PLAIN = GED.split('\n').filter(l => !/^3 _LINK\b|^4 _(PERS|FAM|PAR) |^3 _VAR |^2 _VAR /.test(l)).join('\n');

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'research-hypothesis-links.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

async function setup(page: Page, ged = GED): Promise<void> {
    await openApp(page);
    await dropFile(page, ged);
    await expect(card(page, 'Karel').first()).toBeVisible();
}

const idOf = (page: Page, refn: string) => page.evaluate((r) => window.Strom.DataManager.getAllPersons().find(p => p.refn === r)!.id, refn);

type Rec = { hypo: string; variant: string; kind: string; anchor: string; island: string[]; on?: boolean };
const B: Rec = { hypo: 'H0022', variant: 'B', kind: 'child', anchor: 'P0010', island: ['P0125', 'P0126'] };
const C: Rec = { hypo: 'H0022', variant: 'C', kind: 'child', anchor: 'P0010', island: ['P0130'] };
const MARTIN: Rec = { hypo: 'H0024', variant: 'A', kind: 'partners', anchor: 'P0011', island: ['P0140'] };

/** Store records and focus `focus` (Karel), which draws them. */
async function store(page: Page, records: Rec[], focus = 'P0001'): Promise<void> {
    await page.evaluate(({ records, focus }) => {
        const S = window.Strom;
        const treeId = S.DataManager.getCurrentTreeId()!;
        const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)!.id;
        const links = records.map((r, i) => ({
            hypo: r.hypo, variant: r.variant, kind: r.kind, anchorId: byRefn(r.anchor),
            islandIds: r.island.map(byRefn), on: r.on ?? true, addedAt: i + 1,
        }));
        localStorage.setItem(`strom-view-links:${treeId}`, JSON.stringify(links));
        S.TreeRenderer.setFocus(byRefn(focus));
    }, { records, focus });
}

async function focusOn(page: Page, refn: string): Promise<void> {
    await page.evaluate((r) => {
        const S = window.Strom;
        S.TreeRenderer.setFocus(S.DataManager.getAllPersons().find(p => p.refn === r)!.id);
    }, refn);
}

/** The stored records. */
async function records(page: Page): Promise<Array<{ hypo: string; variant: string; on: boolean }>> {
    return page.evaluate(() => {
        const treeId = window.Strom.DataManager.getCurrentTreeId()!;
        const raw = JSON.parse(localStorage.getItem(`strom-view-links:${treeId}`) ?? '[]') as Array<{ hypo: string; variant: string; on: boolean }>;
        return raw.map(r => ({ hypo: r.hypo, variant: r.variant, on: r.on }));
    });
}

const treeState = (page: Page) => page.evaluate(() => ({
    data: JSON.stringify(window.Strom.DataManager.getData()),
    undo: window.Strom.DataManager.canUndo(),
}));

const menu = (page: Page) => page.locator('.context-menu.person-menu');
const ghosts = (page: Page) => page.locator('.person-card.view-ghost');
/** The visible rows of the desktop menu, in order (captions included). */
const menuRows = (m: Locator) => m.locator(':scope > .context-menu-item, :scope > .menu-caption, :scope > .menu-chip-grid')
    .evaluateAll(els => els.map(e => e.classList.contains('menu-chip-grid') ? '[add]' : (e.textContent ?? '').replace('›', '').trim()));

async function openResearchDialog(page: Page, refn: string): Promise<Locator> {
    const id = await idOf(page, refn);
    await page.evaluate((id) => window.Strom.UI.showPersonResearchDialog(id as never), id);
    const dialog = page.locator('#person-research-modal');
    await expect(dialog).toBeVisible();
    return dialog;
}

/**
 * The person's sheet once it stands in place: it slides up in the frame after
 * it is added (`.active`), and rects taken before then are off screen — or one
 * before and one after, which made the order checks below fail at random.
 */
async function settledSheet(page: Page): Promise<Locator> {
    const sheet = page.locator('.bottom-sheet-overlay.active .bottom-sheet-person');
    await expect(sheet).toBeVisible();
    await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    return sheet;
}

const hypo = (dialog: Locator, id: string) => dialog.locator(`.person-research-hypo[data-hypo="${id}"]`);
const variant = (dialog: Locator, h: string, v: string) => hypo(dialog, h).locator(`.person-research-variant[data-variant="${v}"]`);

test.describe('linked in the view only: the card’s menu (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a ghost: its state on top (not an action), Unlink, what research knows, a line, then the usual rows', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await expect(ghosts(page)).toHaveCount(5);
        await card(page, 'Jakub').click();
        const m = menu(page);
        await expect(m).toBeVisible();
        const rows = await menuRows(m);
        expect(rows.slice(0, 5)).toEqual(['Linked in the view only · H0022 B', 'Unlink', 'What research knows about the link', 'Focus', 'Edit']);
        const caption = m.locator('.menu-caption');
        await expect(caption).toHaveAttribute('aria-disabled', 'true');
        await expect(caption.locator('.view-link-icon')).toHaveCount(1);
        await expect(caption).not.toHaveAttribute('data-action', /./);
        await expect(m.locator('.context-menu-item').first()).toHaveClass(/is-strong/);
        await expect(m.locator('.context-menu-item').first()).toHaveCSS('font-weight', '500');
        // A divider between the ghost's block and the usual rows.
        const dividerAfter = await m.locator('[data-action="view-link-about:H0022"] + .context-menu-divider').count();
        expect(dividerAfter).toBe(1);
        // The keyboard never lands on the state line.
        await page.keyboard.press('ArrowDown');
        await expect(m.locator('.menu-caption')).not.toBeFocused();

        // Unlink: the family goes, the row stays off, the notice offers to undo; the tree unchanged.
        const before = await treeState(page);
        await m.locator('[data-action="view-link-unlink:H0022"]').click();
        await expect(ghosts(page)).toHaveCount(0);
        await expect(page.locator('.toast')).toContainText('Unlinked');
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: false }]);
        expect(await treeState(page)).toEqual(before);
    });

    test('a ghost: "What research knows about the link" opens the person’s research at the hypothesis, its version unfolded', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await card(page, 'Marie').click();
        await menu(page).locator('[data-action="view-link-about:H0022"]').click();
        const dialog = page.locator('#person-research-modal');
        await expect(dialog.locator('.person-research-modal')).toHaveAttribute('data-open-hypo', 'H0022');
        await expect(dialog.locator('.audit-log-subtitle')).toContainText('Václav Horák');
        const h = hypo(dialog, 'H0022');
        await expect(h).toHaveAttribute('open', '');
        await expect(h.locator('summary')).toBeFocused();
        await expect(variant(dialog, 'H0022', 'B')).toHaveClass(/is-expanded/);
        await expect(variant(dialog, 'H0022', 'B').locator('.prv-title')).toHaveAttribute('aria-expanded', 'true');
        await expect(h).toBeInViewport();
        await page.locator('#person-research-close').click();

        // From the keyboard: the card's menu, the row, Enter; Esc closes the dialog and the card has the keyboard again.
        await card(page, 'Marie').focus();
        await page.keyboard.press('Enter');
        await menu(page).locator('[data-action="view-link-about:H0022"]').focus();
        await page.keyboard.press('Enter');
        await expect(dialog.locator('.person-research-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog.locator('.person-research-modal')).toHaveCount(0);
        await expect(card(page, 'Marie')).toBeFocused();
    });

    test('a person with versions to show: "Show as linked…" after Focus, a second level with a heading and the versions', async ({ page }) => {
        await setup(page);
        await card(page, 'Václav').click();
        const m = menu(page);
        const rows = await menuRows(m);
        expect(rows.indexOf('Show as linked…')).toBe(rows.indexOf('Focus') + 1);
        const row = m.locator('[data-menu="view-link-show-menu"]');
        await expect(row).toHaveAttribute('aria-haspopup', 'menu');
        await row.click();
        const sub = page.locator('.context-submenu');
        await expect(sub).toBeVisible();
        await expect(sub.locator('.menu-section-header')).toHaveText('H0022 · Odkud pocházel Václav Horák, ženich z roku 1857?');
        const items = sub.locator('.context-menu-item');
        await expect(items).toHaveCount(2);
        await expect(items.nth(0).locator('.menu-item-label')).toHaveText(/^Version B/);
        await expect(items.nth(0).locator('.menu-item-note')).toHaveText(/^syn Jakuba Horáka a Marie Pokorné .*… · \+ 5$/);
        await expect(items.nth(1).locator('.menu-item-note')).toHaveText('z Nové Vsi, syn Jana Horáka · + 1');
        // The keyboard: the first version has it; Esc closes only the second level.
        await expect(items.nth(0)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(sub).toHaveCount(0);
        await expect(row).toBeFocused();
        await page.keyboard.press('Enter');
        await page.locator('.context-submenu [data-action="view-link-show:H0022:C"]').click();
        await expect(page.locator('.person-card.view-ghost[data-view-variant="C"]')).toHaveCount(1);
        await expect(page.locator('.toast')).toContainText('Shown as linked: parent of Václav Horák (H0022, version C)');
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'C', on: true }]);

        // Shown: "Unlink the shown parent" after Focus, no "Show as linked…".
        await card(page, 'Václav').click();
        const after = await menuRows(menu(page));
        expect(after[after.indexOf('Focus') + 1]).toBe('Unlink the shown parent');
        expect(after).not.toContain('Show as linked…');
        await menu(page).locator('[data-action="view-link-unlink:H0022"]').click();
        await expect(ghosts(page)).toHaveCount(0);
    });

    test('two shown parents: "Unlink the shown parents"', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await card(page, 'Václav').click();
        const rows = await menuRows(menu(page));
        expect(rows[rows.indexOf('Focus') + 1]).toBe('Unlink the shown parents');
    });

    test('one version: "Show as linked" at once, no second level; then "Unlink the shown partner"', async ({ page }) => {
        await setup(page);
        await card(page, 'Rozálie').click();
        const m = menu(page);
        const rows = await menuRows(m);
        expect(rows[rows.indexOf('Focus') + 1]).toBe('Show as linked');
        await expect(m.locator('[data-menu="view-link-show-menu"]')).toHaveCount(0);
        await m.locator('[data-action="view-link-show:H0024:A"]').click();
        await expect(card(page, 'Martin')).toHaveClass(/view-ghost/);
        await card(page, 'Rozálie').click();
        const shown = await menuRows(menu(page));
        expect(shown[shown.indexOf('Focus') + 1]).toBe('Unlink the shown partner');
    });

    test('a tree without what variants would connect: no row of the view links', async ({ page }) => {
        await setup(page, GED_PLAIN);
        await focusOn(page, 'P0010');
        await card(page, 'Václav').click();
        await expect(menu(page)).toBeVisible();
        await expect(menu(page).locator('[data-action^="view-link"], [data-menu^="view-link"], .menu-caption')).toHaveCount(0);
    });

    test('views that never draw the links (fan) offer no "Show as linked"', async ({ page }) => {
        await setup(page);
        const vaclav = await idOf(page, 'P0010');
        const actions = await page.evaluate((id) => {
            const S = window.Strom;
            S.TreeRenderer.presetViewMode('fan');
            return S.UI.getPersonMenuActions(id as never).map(a => a.action);
        }, vaclav);
        expect(actions.some(a => a.startsWith('view-link'))).toBe(false);
    });

    test('"Show descendants" on a ghost: the Descendants view draws the link as a ghost', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await card(page, 'Jakub').click();
        await menu(page).locator('[data-action="descendants"]').click();
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('descendants');
        await expect(card(page, 'Jakub')).toHaveClass(/view-ghost/);
        await expect(card(page, 'Karel')).toBeVisible();
        await expect(card(page, 'Karel')).not.toHaveClass(/view-ghost/);
        await expect(page.locator('#tree-lines [data-view="virtual"]')).not.toHaveCount(0);
    });

    test('"Delete…" on a ghost: the confirmation says the shown link will no longer hold', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        const jakub = await idOf(page, 'P0125');
        await page.evaluate((id) => { void window.Strom.UI.confirmDelete(id as never); }, jakub);
        const msg = page.locator('#confirm-message');
        await expect(msg).toContainText('The shown link H0022 B will then no longer be valid.');
        await page.locator('#confirm-cancel-btn, #confirmation-modal .secondary').first().click();
        // A real person the view links do not stand on: no such line.
        const karel = await idOf(page, 'P0001');
        await page.evaluate((id) => { void window.Strom.UI.confirmDelete(id as never); }, karel);
        await expect(msg).toBeVisible();
        await expect(msg).not.toContainText('shown link');
    });
});

test.describe('linked in the view only: the Add dialog, the relationship, the detail (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Add → Parents: the note and "Link the shown" — a real link by hand, one undo step; the record is then real', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await card(page, 'Václav').click();
        await menu(page).locator('[data-action="parent"]').click();
        const note = page.locator('#rel-view-link-note');
        await expect(note).toBeVisible();
        await expect(note.locator('.rel-view-link-note__text')).toHaveText('The shown parents are in the view only.');
        const link = note.locator('.rel-view-link-note__link');
        await expect(link).toHaveText('Link the shown: Jakub Horák and Marie Pokorná');
        expect(await page.evaluate(() => window.Strom.DataManager.canUndo())).toBe(false);

        await link.click();
        await expect(page.locator('#relation-modal')).not.toHaveClass(/active/);
        const ids = { vaclav: await idOf(page, 'P0010'), jakub: await idOf(page, 'P0125'), marie: await idOf(page, 'P0126') };
        const parents = await page.evaluate((id) => window.Strom.DataManager.getPerson(id as never)!.parentIds, ids.vaclav);
        expect([...parents].sort()).toEqual([ids.jakub, ids.marie].sort());
        // Linked for real: no ghost, the record kept (now real), and the normal undo path.
        await expect(ghosts(page)).toHaveCount(0);
        await expect(card(page, 'Jakub')).toBeVisible();
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: true }]);
        const state = await page.evaluate(async () => {
            const S = window.Strom;
            const changes = await S.UI.researchChangesReady();
            return { undo: S.DataManager.canUndo(), changes: changes?.map(c => S.DataManager.getPerson(c.personId as never)?.refn ?? '?') ?? null };
        });
        expect(state.undo).toBe(true);
        // Not sent to the research yet: the person whose parents changed, as any change by hand.
        expect(state.changes).toEqual(['P0010']);
        // One undo step takes both back: the shown family is drawn again.
        await page.evaluate(() => window.Strom.UI.performUndo());
        await expect(ghosts(page)).toHaveCount(5);
        expect(await page.evaluate((id) => window.Strom.DataManager.getPerson(id as never)!.parentIds.length, ids.vaclav)).toBe(0);
    });

    test('Add → Sibling: the note; the sibling never joins the shown parents', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await card(page, 'Václav').click();
        await menu(page).locator('[data-action="sibling"]').click();
        const note = page.locator('#rel-view-link-note');
        await expect(note).toBeVisible();
        await expect(note).toHaveText('The sibling is not attached to the shown parents.');
        await expect(note.locator('button')).toHaveCount(0);
        await page.locator('#rel-firstname').fill('Petr');
        await page.locator('#rel-submit-btn').click();
        const result = await page.evaluate(() => {
            const S = window.Strom;
            const petr = S.DataManager.getAllPersons().find(p => p.firstName === 'Petr')!;
            const island = S.DataManager.getAllPersons().filter(p => p.refn === 'P0125' || p.refn === 'P0126').map(p => p.id);
            return { parents: petr.parentIds.length, island: petr.parentIds.some(id => island.includes(id)) };
        });
        expect(result.island).toBe(false);
        // Other dialogs say nothing of it: Add → Parents of a person with no shown parents.
        await card(page, 'Karel').click();
        await menu(page).locator('[data-action="partner"]').click();
        await expect(note).toBeHidden();
    });

    test('Find relationship: real links only; a path only the view makes is said apart', async ({ page }) => {
        await setup(page);
        const pick = async (from: string, to: string): Promise<Locator> => {
            const id = await idOf(page, from);
            await page.evaluate((id) => window.Strom.UI.showRelationshipCalculator(id as never), id);
            const modal = page.locator('#kinship-modal');
            await modal.locator('.person-picker-input').fill(to);
            await modal.locator('.person-picker-item', { hasText: to }).first().click();
            return modal.locator('#kinship-result');
        };
        // Nothing shown: no relation at all.
        let result = await pick('P0001', 'Jakub');
        await expect(result).toHaveText('No relationship found (within the tracked tree).');
        await page.keyboard.press('Escape');

        await store(page, [B]);
        result = await pick('P0001', 'Jakub');
        await expect(result.locator('.kinship-no-real')).toHaveText('No real connection found.');
        await expect(result.locator('.kinship-view-only')).toHaveText('View only: grandfather (H0022 B)');
        await expect(result.locator('.kinship-view-only .view-link-icon')).toHaveCount(1);
        await expect(page.locator('#kinship-highlight')).toBeHidden();
        await page.keyboard.press('Escape');
        // A real relation says nothing of the view.
        result = await pick('P0001', 'Rozálie');
        await expect(result.locator('.kinship-term')).toHaveText('mother');
        await expect(result.locator('.kinship-view-only')).toHaveCount(0);
    });

    test('the detail: Family stays real; quiet rows say what the view shows, with Unlink; a ghost’s state row', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        const open = async (refn: string) => {
            const id = await idOf(page, refn);
            await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id as never, 'edit'), id);
            await expect(page.locator('#person-modal')).toHaveClass(/active/);
            return page.locator('#pm-view-links');
        };
        let rows = await open('P0010');
        await expect(rows).toBeVisible();
        await expect(rows.locator('.pm-view-link-row')).toHaveCount(1);
        await expect(rows.locator('.pm-view-link-text')).toHaveText('View only: parents Jakub Horák and Marie Pokorná · H0022 B');
        // The Family section's summary counts the real links only.
        await expect(page.locator('#pm-sum-relations')).not.toContainText('Jakub');
        await page.keyboard.press('Escape');

        rows = await open('P0125');
        await expect(rows.locator('.pm-view-link-state')).toHaveText('Linked in the view only (H0022, version B)');
        await expect(rows.locator('.pm-view-link-state .view-link-icon')).toHaveCount(1);
        await expect(rows.locator('.pm-view-link-text')).toHaveText('View only: son Václav Horák · H0022 B');
        await rows.locator('.pm-view-link-unlink').click();
        await expect(ghosts(page)).toHaveCount(0);
        await expect(rows).toBeHidden();
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: false }]);
        await page.keyboard.press('Escape');

        // A person the view does not touch: nothing.
        rows = await open('P0001');
        await expect(rows).toBeHidden();
    });
});

test.describe('linked in the view only: What research knows → Hypotheses', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the hypothesis: its question, "id · state · versions", the versions with what each would bring; switches only where it can be shown', async ({ page }) => {
        await setup(page);
        const dialog = await openResearchDialog(page, 'P0010');
        const h = hypo(dialog, 'H0022');
        await expect(h).toHaveAttribute('open', '');
        await expect(h.locator('.person-research-hypo-title')).toHaveText('Odkud pocházel Václav Horák, ženich z roku 1857?');
        await expect(h.locator('.person-research-hypo-title')).toHaveCSS('font-size', '15px');
        await expect(h.locator('.person-research-hypo-title')).toHaveCSS('font-weight', '600');
        // The note only listed the versions: it adds nothing to the line.
        await expect(h.locator('.person-research-hypo-meta')).toHaveText('H0022 · open · 3 versions');
        await expect(variant(dialog, 'H0022', 'A').locator('.prv-meta')).toHaveText('link not recorded yet');
        await expect(variant(dialog, 'H0022', 'A').locator('.view-link-switch')).toHaveCount(0);
        await expect(variant(dialog, 'H0022', 'B').locator('.prv-meta')).toHaveText('+ 5 people');
        await expect(variant(dialog, 'H0022', 'C').locator('.prv-meta')).toHaveText('+ 1 person');
        const sw = variant(dialog, 'H0022', 'B').locator('.view-link-switch');
        await expect(sw).toHaveAttribute('role', 'switch');
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        await expect(sw).toHaveAccessibleName('Show version B as linked');
        await expect(sw.locator('.view-link-switch__label')).toHaveText('Show');
        // The phase 2 row is there, empty and not drawn.
        await expect(h.locator('.person-research-hypo-actions')).toHaveCount(1);
        await expect(h.locator('.person-research-hypo-actions')).toBeHidden();
        // The edge's "Above the person" links to it.
        await h.locator('summary').click();
        await expect(h).not.toHaveAttribute('open', '');
        await dialog.locator('.rep-hypo-go[data-hypo="H0022"]').click();
        await expect(h).toHaveAttribute('open', '');
        await expect(h.locator('summary')).toBeFocused();
    });

    for (const theme of ['light', 'dark'] as const) {
        test(`the switches: a radio group that can have none; the shown one tinted with "shown · + 5 people · Find" (${theme})`, async ({ page }) => {
            await setup(page);
            if (theme === 'dark') {
                await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
                await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
            }
            const before = await treeState(page);
            const dialog = await openResearchDialog(page, 'P0010');
            const b = variant(dialog, 'H0022', 'B');
            const c = variant(dialog, 'H0022', 'C');
            await b.locator('.view-link-switch').click();
            await expect(ghosts(page)).toHaveCount(5);
            await expect(b).toHaveClass(/is-shown/);
            await expect(b.locator('.view-link-switch')).toHaveAttribute('aria-checked', 'true');
            await expect(b.locator('.view-link-switch')).toBeFocused();
            await expect(b.locator('.prv-meta')).toHaveText('shown · + 5 people · Find');
            await expect(b.locator('.prv-meta .view-link-icon')).toHaveCount(1);
            const tint = await page.evaluate(() => {
                const el = document.createElement('div');
                el.style.background = 'color-mix(in srgb, var(--ghost-bg) 70%, var(--surface))';
                document.body.appendChild(el);
                const c = getComputedStyle(el).backgroundColor;
                el.remove();
                return c;
            });
            await expect(b).toHaveCSS('background-color', tint);
            const primary = await page.evaluate(() => {
                const el = document.createElement('div');
                el.style.background = 'var(--primary)';
                document.body.appendChild(el);
                const c = getComputedStyle(el).backgroundColor;
                el.remove();
                return c;
            });
            await expect(b.locator('.view-link-switch__track')).toHaveCSS('background-color', primary);

            // C on: B goes off, one record.
            await c.locator('.view-link-switch').click();
            await expect(page.locator('.person-card.view-ghost[data-view-variant="C"]')).toHaveCount(1);
            await expect(b.locator('.view-link-switch')).toHaveAttribute('aria-checked', 'false');
            await expect(c.locator('.view-link-switch')).toHaveAttribute('aria-checked', 'true');
            expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'C', on: true }]);
            // C off (the keyboard, Space): nothing shown.
            await c.locator('.view-link-switch').focus();
            await page.keyboard.press('Space');
            await expect(ghosts(page)).toHaveCount(0);
            await expect(c.locator('.view-link-switch')).toHaveAttribute('aria-checked', 'false');
            expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'C', on: false }]);
            // Never a change of the tree.
            expect(await treeState(page)).toEqual(before);
        });
    }

    test('"Find" closes the dialog and brings the person and the family into view', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await focusOn(page, 'P0013');
        await expect(card(page, 'Jakub')).toHaveCount(0);
        const dialog = await openResearchDialog(page, 'P0010');
        await variant(dialog, 'H0022', 'B').locator('.prv-find').click();
        await expect(dialog).toHaveCount(0);
        await expect(card(page, 'Jakub')).toBeInViewport();
        await expect(card(page, 'Václav')).toBeInViewport();
    });

    test('text only, decided and abandoned hypotheses: their state, no switch', async ({ page }) => {
        await setup(page);
        let dialog = await openResearchDialog(page, 'P0001');
        const same = hypo(dialog, 'H0025');
        await expect(same.locator('.person-research-hypo-meta')).toHaveText('H0025 · open · 2 versions');
        await expect(same.locator('.prv-meta')).toHaveText(['Text only, cannot be shown.', 'Text only, cannot be shown.']);
        await expect(same.locator('.view-link-switch')).toHaveCount(0);
        const abandoned = hypo(dialog, 'H0027');
        await expect(abandoned).not.toHaveAttribute('open', '');
        await expect(abandoned.locator('.person-research-hypo-meta')).toHaveText('H0027 · abandoned · 1 version');
        await expect(abandoned.locator('.view-link-switch')).toHaveCount(0);
        await page.keyboard.press('Escape');

        dialog = await openResearchDialog(page, 'P0011');
        const decided = hypo(dialog, 'H0026');
        await expect(decided).not.toHaveAttribute('open', '');
        await expect(decided.locator('.person-research-hypo-meta')).toHaveText('H0026 · decided for B · 2 versions');
        await decided.locator('summary').click();
        await expect(variant(dialog, 'H0026', 'B')).toHaveClass(/is-chosen/);
        await expect(variant(dialog, 'H0026', 'B').locator('.prv-meta')).toHaveText(/^chosen · /);
        await expect(decided.locator('.view-link-switch')).toHaveCount(0);
        // The open one beside it (H0024: partners) has its switch.
        await expect(variant(dialog, 'H0024', 'A').locator('.view-link-switch')).toHaveCount(1);
    });

    test('the card’s signal counts open hypotheses only (decided and abandoned no longer)', async ({ page }) => {
        await setup(page);
        // Rozálie: H0024 open, H0026 decided; Karel: H0025 open, H0027 abandoned.
        await expect(card(page, 'Rozálie').locator('.card-tooltip .tt-action')).toHaveText('1 hypothesis');
        await expect(card(page, 'Karel').locator('.card-tooltip .tt-action')).toHaveText('1 hypothesis');
    });
});

test.describe('linked in the view only: a phone (touch)', () => {
    test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

    test('a ghost’s sheet: its state, Unlink and what research knows above the tiles, 44px rows', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await card(page, 'Jakub').tap();
        const sheet = await settledSheet(page);
        const head = sheet.locator('.sheet-view-link-head');
        await expect(head.locator('.bottom-sheet-caption')).toHaveText('Linked in the view only · H0022 B');
        await expect(head.locator('.bottom-sheet-item')).toHaveText(['Unlink', 'What research knows about the link']);
        // Above the tiles.
        const headBox = (await head.boundingBox())!;
        const tiles = (await sheet.locator('.sheet-tiles').boundingBox())!;
        expect(headBox.y + headBox.height).toBeLessThanOrEqual(tiles.y);
        for (const box of await head.locator('.bottom-sheet-item').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) {
            expect(box).toBeGreaterThanOrEqual(44);
        }
        await head.locator('[data-action="view-link-unlink:H0022"]').tap();
        await expect(ghosts(page)).toHaveCount(0);
        await expect(sheet).toHaveCount(0);
    });

    test('"Show as linked…" under the tiles opens the sheet’s second page with Back, a heading and the versions', async ({ page }) => {
        await setup(page);
        await focusOn(page, 'P0010');
        await card(page, 'Václav').tap();
        const sheet = await settledSheet(page);
        const row = sheet.locator('.sheet-page-root [data-menu="view-link-show-menu"]');
        await expect(row).toBeVisible();
        // Right under the tiles (where Focus is), before "Add".
        const tiles = (await sheet.locator('.sheet-tiles').boundingBox())!;
        const add = (await sheet.locator('.sheet-chip-grid').boundingBox())!;
        const box = (await row.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(tiles.y + tiles.height - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(add.y);
        await row.tap();
        const sub = sheet.locator('.sheet-page-sub');
        await expect(sub).toBeVisible();
        await expect(sub.locator('.sheet-subhead-title')).toHaveText('Show as linked…');
        await expect(sub.locator('.bottom-sheet-section')).toHaveText('H0022 · Odkud pocházel Václav Horák, ženich z roku 1857?');
        await expect(sub.locator('.bottom-sheet-item .menu-item-label')).toHaveText([/^Version B/, /^Version C/]);
        // Back to the first page.
        await sub.locator('.sheet-back').tap();
        await expect(sheet.locator('.sheet-page-root')).toBeVisible();
        await row.tap();
        await sub.locator('[data-action="view-link-show:H0022:B"]').tap();
        await expect(ghosts(page)).toHaveCount(5);
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: true }]);
    });

    test('the hypotheses’ switches are 44px targets', async ({ page }) => {
        await setup(page);
        const dialog = await openResearchDialog(page, 'P0010');
        const sw = variant(dialog, 'H0022', 'B').locator('.view-link-switch');
        expect((await sw.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(sw.locator('.view-link-switch__track')).toHaveCSS('width', '44px');
        await sw.tap();
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await expect(ghosts(page)).toHaveCount(5);
    });
});

for (const [name, viewport] of [
    ['a phone', { width: 360, height: 740 }],
    ['a phone held sideways', { width: 740, height: 360 }],
    ['a tablet', { width: 820, height: 1000 }],
] as const) {
    test.describe(`the card's sheet over a notice: ${name} (touch)`, () => {
        test.use({ viewport, hasTouch: true, isMobile: true });

        test('the notice of the opened research never shows through the sheet, sliding or not', async ({ page }) => {
            await setup(page);
            const toast = page.locator('.toast.show');
            await expect(toast).toContainText('Opened the research');
            // With motion: only the backdrop fades, the sheet is opaque in every frame.
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            const frames = page.evaluate(() => new Promise<string[]>(resolve => {
                const seen: string[] = [];
                const t0 = performance.now();
                const tick = (): void => {
                    const sheet = document.querySelector<HTMLElement>('.bottom-sheet-person');
                    if (sheet) {
                        for (let el: HTMLElement | null = sheet; el; el = el.parentElement) {
                            const o = getComputedStyle(el).opacity;
                            if (o !== '1') seen.push(`${el.className}: ${o}`);
                        }
                    }
                    if (performance.now() - t0 < 600) requestAnimationFrame(tick); else resolve(seen);
                };
                requestAnimationFrame(tick);
            }));
            await card(page, 'Karel').first().tap();
            expect(await frames).toEqual([]);
            await page.locator('.bottom-sheet-overlay').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
            // Settled: the sheet is on top where the notice is.
            const box = (await toast.boundingBox())!;
            const top = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.bottom-sheet-overlay'), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
            expect(top).toBe(true);
            await page.locator('.bottom-sheet-overlay').click({ position: { x: 5, y: 5 } });
            await expect(page.locator('.bottom-sheet-overlay')).toHaveCount(0);
            // Reduced motion: the sheet stands in place in the frame it opens, no slide.
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await card(page, 'Karel').first().tap();
            const sheet = page.locator('.bottom-sheet-overlay.active .bottom-sheet-person');
            await expect(sheet).toBeVisible();
            expect(await sheet.evaluate(el => [getComputedStyle(el).transitionDuration, getComputedStyle(el.parentElement!).transitionDuration])).toEqual(['0s', '0s']);
        });
    });
}

test.describe('linked in the view only: a phone held sideways and a tablet', () => {
    test('sideways: the sheet’s second page reaches the versions', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, locale: 'en-US', reducedMotion: 'reduce' });
        const page = await context.newPage();
        await setup(page);
        await focusOn(page, 'P0010');
        await card(page, 'Václav').tap();
        await page.locator('.bottom-sheet-person [data-menu="view-link-show-menu"]').tap();
        const item = page.locator('.bottom-sheet-person .sheet-page-sub [data-action="view-link-show:H0022:C"]');
        await item.scrollIntoViewIfNeeded();
        await expect(item).toBeInViewport();
        await item.tap();
        await expect(page.locator('.person-card.view-ghost[data-view-variant="C"]')).toHaveCount(1);
        await context.close();
    });

    test('a tablet: the person’s sheet carries the ghost’s block', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 820, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
        const page = await context.newPage();
        await setup(page);
        await store(page, [MARTIN]);
        await card(page, 'Martin').click();
        await expect(page.locator('.bottom-sheet-person .bottom-sheet-caption')).toHaveText('Linked in the view only · H0024 A');
        await context.close();
    });
});

test.describe('linked in the view only: Czech texts', () => {
    test.use({ viewport: { width: 1440, height: 900 }, locale: 'cs-CZ' });

    test('cs: the ghost’s block and the hypothesis line', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await card(page, 'Jakub').click();
        const rows = await menuRows(menu(page));
        expect(rows.slice(0, 3)).toEqual(['Připojeno jen v zobrazení · H0022 B', 'Odpojit', 'Co ví výzkum o vazbě']);
        await page.keyboard.press('Escape');
        const dialog = await openResearchDialog(page, 'P0010');
        await expect(hypo(dialog, 'H0022').locator('.person-research-hypo-meta')).toHaveText('H0022 · otevřená · 3 verze');
        await expect(variant(dialog, 'H0022', 'B').locator('.prv-meta')).toHaveText('ukázáno · + 5 lidí · Najít');
    });
});

import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Linked in the view only, the first actions: the `named` stub (two hollow
 * circles, "named · 3 options") and its bubble — pointing shows it without
 * actions, a click pins it with ×, its versions and "Show as linked"; the
 * "+ family" pill's menu (show it linked, or go to it); the family's own
 * button in its view ("Show linked to the tree"); the notices after showing,
 * moving and unlinking, and the confirmation before unlinking what others
 * hang on. Never a change of the tree. Invented data only
 * (e2e/fixtures/research-hypothesis-links.ged).
 */

const GED = readFileSync('e2e/fixtures/research-hypothesis-links.ged', 'utf-8');

/**
 * The same file with Václav's edge an ordinary one (not searched) that joins
 * the family of Jakub by variant B: the "+ family · 5" pill at its stub.
 */
const GED_PILL = GED.replace(/2 _END named\n/, '2 _END unsearched\n')
    .replace(/3 _JOIN P0126\n3 _JOIN P0125\n3 _JOIN P0127\n3 _JOIN P0128\n3 _JOIN P0129\n3 _JOIN P0130\n3 _VAR B\n3 _VAR C\n/, '3 _JOIN P0125\n3 _VAR B\n');

/**
 * The same file with what variants claim that the tree records already
 * (3 _INTREE): H0022 A and B say Václav and Rozálie are a couple (B beside
 * its link to Jakub's family), H0025 B says Karel is their son.
 */
const GED_INTREE = readFileSync('e2e/fixtures/research-hypothesis-intree.ged', 'utf-8');

/** Ludmila's edge points at Václav (in the view): the curve "possible link · H0099" with its pill. */
const GED_CURVE = GED.replace('1 SEX F\n1 REFN P0013\n2 TYPE strom-research\n1 FAMS @F0002@\n',
    '1 SEX F\n1 REFN P0013\n2 TYPE strom-research\n1 FAMS @F0002@\n1 _STROM_EDGE parents\n2 _SCOPE in\n2 _END unsearched\n2 _NEXT none\n2 _HYPO H0099\n3 _JOIN P0010\n');

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
const CHAINED: Rec = { hypo: 'H0030', variant: 'A', kind: 'child', anchor: 'P0128', island: ['P0150'] };
const ANTONIN: Rec = { hypo: 'H0028', variant: 'A', kind: 'child', anchor: 'P0012', island: ['P0125', 'P0126'] };

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

/** The stored records, people as the research's numbers. */
async function records(page: Page): Promise<Array<{ hypo: string; variant: string; on: boolean; anchor: string }>> {
    return page.evaluate(() => {
        const S = window.Strom;
        const treeId = S.DataManager.getCurrentTreeId()!;
        const raw = JSON.parse(localStorage.getItem(`strom-view-links:${treeId}`) ?? '[]') as Array<{ hypo: string; variant: string; on: boolean; anchorId: string }>;
        return raw.map(r => ({ hypo: r.hypo, variant: r.variant, on: r.on, anchor: S.DataManager.getPerson(r.anchorId as never)?.refn ?? '?' }));
    });
}

/** What would show a change of the tree: its data, the undo stack. */
const treeState = (page: Page) => page.evaluate(() => ({
    data: JSON.stringify(window.Strom.DataManager.getData()),
    undo: window.Strom.DataManager.canUndo(),
}));

/** The tree's version as the tree list keeps it, and what the research link says (unsent changes or not). */
const treeVersion = (page: Page) => page.evaluate(() => {
    const S = window.Strom;
    const meta = S.TreeManager.getTreeMetadata(S.TreeManager.getActiveTreeId()!)!;
    const sync = S.UI.currentResearchSyncState();
    return { modified: meta.lastModifiedAt, persons: meta.personCount, sync: sync.kind, core: sync.core };
});

/** Every one of these cards lies inside the tree's window. */
async function allInView(page: Page, cards: Locator): Promise<boolean> {
    const box = (await page.locator('#tree-container').boundingBox())!;
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
        const b = (await cards.nth(i).boundingBox())!;
        if (b.x < box.x - 1 || b.y < box.y - 1 || b.x + b.width > box.x + box.width + 1 || b.y + b.height > box.y + box.height + 1) return false;
    }
    return n > 0;
}

async function token(page: Page, name: string): Promise<string> {
    return page.evaluate((n) => {
        const el = document.createElement('div');
        el.style.color = `var(${n})`;
        document.body.appendChild(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
    }, name);
}

const bubble = (page: Page) => page.locator('#research-edge-bubble');
const stubOf = (page: Page, name = 'Václav') => card(page, name).locator('.research-edge');

test.describe('linked in the view only: the named stub and its bubble', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    for (const theme of ['light', 'dark'] as const) {
        test(`the stub: open, two hollow circles, "named · 3 options", no "+ family" (${theme})`, async ({ page }) => {
            await setup(page);
            if (theme === 'dark') {
                await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
                await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
            }
            const stub = stubOf(page);
            await expect(stub).toHaveClass(/edge-named/);
            await expect(stub).toHaveClass(/edge-open/);
            await expect(stub).toHaveClass(/tone-yours/);
            await expect(stub).toHaveAttribute('aria-haspopup', 'dialog');
            await expect(stub.locator('.research-edge-label')).toHaveText('named · 3 options');
            const accent = await token(page, '--accent');
            const bg = await token(page, '--bg');
            const dots = await stub.locator('.research-edge-dots').evaluate((el) => {
                const s = (p: string) => getComputedStyle(el, p);
                const line = el.parentElement!.getBoundingClientRect();
                const a = s('::before'), b = s('::after');
                return {
                    w: a.width, h: a.height, ring: a.boxShadow, fill: a.backgroundColor,
                    gap: getComputedStyle(el).columnGap, w2: b.width, bottomAboveLine: line.top - el.getBoundingClientRect().bottom,
                    centre: el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2 - (line.left + line.width / 2),
                };
            });
            expect(dots).toMatchObject({ w: '8px', h: '8px', w2: '8px', ring: `${accent} 0px 0px 0px 1.5px inset`, fill: bg, gap: '6px' });
            expect(dots.bottomAboveLine).toBeGreaterThan(0);
            expect(Math.abs(dots.centre)).toBeLessThan(1);
            await expect(stub).toHaveCSS('color', accent);
            await expect(stub.locator('.research-edge-label')).toHaveCSS('color', await token(page, '--edge-label-yours'));
            // One stub per person: no "+ family" pill, no curve at Václav.
            const vaclav = await idOf(page, 'P0010');
            await expect(page.locator(`.edge-link-pill[data-edge-person="${vaclav}"]`)).toHaveCount(0);
        });
    }

    test('pointing shows the bubble without actions or ×', async ({ page }) => {
        await setup(page);
        await stubOf(page).hover();
        const b = bubble(page);
        await expect(b).toBeVisible();
        await expect(b).toHaveAttribute('role', 'tooltip');
        await expect(b.locator('.reb-end')).toHaveText('Parents named, not linked');
        await expect(b.locator('.reb-next')).toContainText('A decision is needed');
        await expect(b.locator('.reb-question')).toHaveText('H0022 · Odkud pocházel Václav Horák, ženich z roku 1857?');
        const rows = b.locator('.reb-variant');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0).locator('.reb-variant-meta')).toHaveText('link not recorded yet');
        await expect(rows.nth(1).locator('.reb-variant-meta')).toHaveText('+ 5 people');
        await expect(rows.nth(2).locator('.reb-variant-meta')).toHaveText('+ 1 person');
        await expect(b.locator('.reb-variant-btn')).toHaveCount(0);
        await expect(b.locator('.reb-close')).toHaveCount(0);
        await expect(b.locator('.reb-more')).toHaveText('More in the person’s research');
        // Away: gone.
        await page.mouse.move(5, 450);
        await expect(b).toHaveCount(0);
    });

    test('a version the tree records already (_INTREE): "The tree records this already", no button; still one of the 3 options', async ({ page }) => {
        await setup(page, GED_INTREE);
        await expect(stubOf(page).locator('.research-edge-label')).toHaveText('named · 3 options');
        await stubOf(page).hover();
        const rows = bubble(page).locator('.reb-variant');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0).locator('.reb-variant-meta')).toHaveText('The tree records this already');
        // B links Václav to Jakub's family beside what the tree records: it stays a version to show
        await expect(rows.nth(1).locator('.reb-variant-meta')).toHaveText('+ 5 people');
        await expect(rows.nth(2).locator('.reb-variant-meta')).toHaveText('+ 1 person');
        await page.mouse.move(5, 450);
        await expect(bubble(page)).toHaveCount(0);
        await stubOf(page).click();
        const b = bubble(page);
        await expect(b).toHaveClass(/is-pinned/);
        await expect(b.locator('.reb-variant[data-variant="A"] .reb-variant-btn')).toHaveCount(0);
        await expect(b.locator('.reb-variant[data-variant="B"] .reb-show')).toHaveText('Show as linked');
        await expect(b.locator('.reb-variant[data-variant="C"] .reb-show')).toHaveText('Show as linked');
        await page.keyboard.press('Escape');
        // Czech and German
        for (const [lang, text] of [['cs', 'Tak to strom už vede'], ['de', 'So steht es schon im Stammbaum']] as const) {
            await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
            await stubOf(page).hover();
            await expect(bubble(page).locator('.reb-variant[data-variant="A"] .reb-variant-meta')).toHaveText(text);
            await page.mouse.move(5, 450);
            await expect(bubble(page)).toHaveCount(0);
        }
    });

    test('a click pins it: ×, the keyboard on the first action and kept inside, Esc closes and gives it back', async ({ page }) => {
        await setup(page);
        const stub = stubOf(page);
        await stub.click();
        const b = bubble(page);
        await expect(b).toHaveAttribute('role', 'dialog');
        await expect(page.getByRole('dialog', { name: 'Parents named, not linked' })).toHaveCount(1);
        await expect(b).toHaveClass(/is-pinned/);
        await expect(b.locator('.reb-close')).toHaveAttribute('aria-label', 'Close');
        await expect(stub).toHaveAttribute('aria-expanded', 'true');
        // A, no link: no button; B and C: "Show as linked".
        await expect(b.locator('.reb-variant[data-variant="A"] .reb-variant-btn')).toHaveCount(0);
        await expect(b.locator('.reb-variant[data-variant="B"] .reb-show')).toHaveText('Show as linked');
        await expect(b.locator('.reb-variant[data-variant="C"] .reb-show')).toHaveText('Show as linked');
        await expect(b).toHaveCSS('width', '420px');
        await expect(b.locator('.reb-variant[data-variant="B"] .reb-show')).toBeFocused();
        // Tab goes round inside: B, C, More, ×, B…
        for (let i = 0; i < 6; i++) {
            await page.keyboard.press('Tab');
            expect(await b.evaluate((el) => el.contains(document.activeElement))).toBe(true);
        }
        await page.keyboard.press('Shift+Tab');
        expect(await b.evaluate((el) => el.contains(document.activeElement))).toBe(true);
        // Pointing elsewhere does not close a pinned bubble.
        await page.mouse.move(5, 450);
        await page.waitForTimeout(300);
        await expect(b).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(b).toHaveCount(0);
        await expect(stub).toBeFocused();
        await expect(stub).toHaveAttribute('aria-expanded', 'false');

        // Enter on the stub pins it again; × closes; a click outside closes.
        await page.keyboard.press('Enter');
        await expect(bubble(page)).toHaveClass(/is-pinned/);
        await bubble(page).locator('.reb-close').click();
        await expect(bubble(page)).toHaveCount(0);
        await stub.click();
        await expect(bubble(page)).toHaveClass(/is-pinned/);
        const bb = (await bubble(page).boundingBox())!;
        await page.mouse.click(Math.min(1420, bb.x + bb.width + 60), bb.y + bb.height + 40);
        await expect(bubble(page)).toHaveCount(0);
    });

    test('"More in the person’s research" opens the person’s research at the hypothesis', async ({ page }) => {
        await setup(page);
        await stubOf(page).click();
        await bubble(page).locator('.reb-more').click();
        const dialog = page.locator('#person-research-modal .person-research-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('data-open-hypo', 'H0022');
        await expect(bubble(page)).toHaveCount(0);
        await page.locator('#person-research-close').click();

        // The keyboard's way: Enter on the stub, Tab to "More", Enter; Esc closes the dialog and the stub has the keyboard again.
        await stubOf(page).focus();
        await page.keyboard.press('Enter');
        await bubble(page).locator('.reb-more').focus();
        await page.keyboard.press('Enter');
        await expect(dialog).toBeVisible();
        await expect(bubble(page)).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(stubOf(page)).toBeFocused();
        await expect(bubble(page)).toHaveCount(0);
    });

    test('"Show as linked" at B: five ghosts, the hollow line and its label, the stub gone, a notice, both in view — and no change of the tree', async ({ page }) => {
        await setup(page);
        const before = await treeState(page);
        const version = await treeVersion(page);
        expect(version.core).not.toMatch(/unsent/i);
        await stubOf(page).click();
        await bubble(page).locator('.reb-variant[data-variant="B"] .reb-show').click();

        await expect(page.locator('.person-card.view-ghost')).toHaveCount(5);
        await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0022"][data-view-variant="B"]')).toHaveCount(5);
        await expect(page.locator('#tree-lines path.view-virtual-outer[data-view-hypo="H0022"]')).not.toHaveCount(0);
        const label = page.locator('.view-link-label[data-view-hypo="H0022"]');
        await expect(label).toHaveText('unproven · H0022 B');
        await expect(label).toBeFocused();
        await expect(stubOf(page)).toHaveCount(0);
        await expect(bubble(page)).toHaveCount(0);
        const toast = page.locator('.toast');
        await expect(toast).toContainText('Shown as linked: parents of Václav Horák (H0022, version B). Unproven.');
        await expect(toast.locator('.toast-action')).toHaveText('Unlink');
        await expect(toast).toHaveAttribute('role', 'status');
        // The view shows Václav and the whole family.
        await expect.poll(() => allInView(page, page.locator('.person-card.view-ghost, .person-card:has(.name-text:text("Václav"))'))).toBe(true);
        // One record, on.
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: true, anchor: 'P0010' }]);
        // Not a change of the tree: the same data (no unsent change, the same version), nothing to undo.
        const after = await treeState(page);
        expect(after.data).toBe(before.data);
        expect(after.undo).toBe(before.undo);
        expect(after.undo).toBe(false);
        expect(await treeVersion(page)).toEqual(version);

        // The notice's "Unlink": the family goes, the stub is back, "Unlinked" offers to undo.
        await toast.locator('.toast-action').click();
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(0);
        await expect(stubOf(page)).toHaveCount(1);
        await expect(page.locator('.toast')).toContainText('Unlinked');
        await expect(page.locator('.toast .toast-action')).toHaveText('Undo');
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: false, anchor: 'P0010' }]);
        await page.locator('.toast .toast-action').click();
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(5);
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: true, anchor: 'P0010' }]);
        expect((await treeState(page)).data).toBe(before.data);
        expect(await page.evaluate(() => window.Strom.DataManager.canUndo())).toBe(false);
    });

    test('the notice’s action is reached with the keyboard and the notice waits while it has it', async ({ page }) => {
        await setup(page);
        await stubOf(page).click();
        await bubble(page).locator('.reb-variant[data-variant="B"] .reb-show').click();
        const action = page.locator('.toast .toast-action');
        await expect(action).toHaveText('Unlink');
        await action.focus();
        await page.waitForTimeout(6500);
        await expect(action).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(0);
    });

    test('while shown and the stub drawn (Descendants of Václav): "Shown" · "Unlink", the other "Show instead of B"; C after B keeps one record', async ({ page }) => {
        await setup(page);
        await store(page, [B], 'P0010');
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('descendants'));
        await expect(card(page, 'Karel')).toBeVisible();
        const stub = stubOf(page);
        await expect(stub).toHaveCount(1);
        await stub.click();
        const b = bubble(page);
        await expect(b.locator('.reb-variant[data-variant="B"]')).toHaveClass(/is-shown/);
        await expect(b.locator('.reb-variant[data-variant="B"] .reb-variant-shown')).toHaveText('Shown');
        await expect(b.locator('.reb-variant[data-variant="B"] .reb-unlink')).toHaveText('Unlink');
        await expect(b.locator('.reb-variant[data-variant="C"] .reb-show')).toHaveText('Show instead of B');
        await b.locator('.reb-variant[data-variant="C"] .reb-show').click();
        await expect(page.locator('.toast')).toContainText('Shown as linked: parent of Václav Horák (H0022, version C). Unproven.');
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'C', on: true, anchor: 'P0010' }]);

        // Unlink from the bubble: off, the row stays.
        await stub.click();
        await bubble(page).locator('.reb-variant[data-variant="C"] .reb-unlink').click();
        await expect(page.locator('.toast')).toContainText('Unlinked');
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'C', on: false, anchor: 'P0010' }]);
    });

    test('a family wanted by another hypothesis moves; the notice says where and offers to undo', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(5);
        const choice = await page.evaluate(() => {
            const S = window.Strom;
            const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)!.id;
            return { hypo: 'H0028', variant: 'A', kind: 'child' as const, anchorId: byRefn('P0012'), islandIds: [byRefn('P0125'), byRefn('P0126')] };
        });
        await page.evaluate((c) => window.Strom.UI.viewLinkShow(c as never), choice);
        const toast = page.locator('.toast');
        await expect(toast).toContainText('The Horák family is now shown at Antonín Dvořáček (H0028, version A).');
        await expect(toast.locator('.toast-action')).toHaveText('Undo');
        expect(await records(page)).toEqual([{ hypo: 'H0028', variant: 'A', on: true, anchor: 'P0012' }]);
        // At Antonín (Karel's grandfather) the family stands a generation higher: the four of it the view reaches.
        for (const name of ['Jakub', 'Marie', 'Tomáš', 'Anna']) await expect(card(page, name)).toHaveAttribute('data-view-hypo', 'H0028');
        await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0022"]')).toHaveCount(0);
        await toast.locator('.toast-action').click();
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: true, anchor: 'P0010' }]);
        await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0022"]')).toHaveCount(5);
        expect(ANTONIN.hypo).toBe('H0028');
    });

    test('unlinking what another hangs on asks first; Esc and Cancel keep both, Unlink switches both off', async ({ page }) => {
        await setup(page);
        await store(page, [CHAINED]);
        await stubOf(page).click();
        await bubble(page).locator('.reb-variant[data-variant="B"] .reb-show').click();
        await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0030"]')).toHaveCount(1);
        await page.locator('.toast .toast-action').click();

        const pop = page.getByRole('alertdialog');
        await expect(pop).toHaveAccessibleName('Unlink parents of Václav Horák?');
        await expect(pop.locator('.view-link-chain__body')).toHaveText('Also unlinks 1 that builds on it (parent of Tomáš Horák, H0030 A).');
        await expect(pop.getByRole('button', { name: 'Unlink' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        expect((await records(page)).map(r => r.on)).toEqual([true, true]);

        void page.evaluate(() => window.Strom.UI.viewLinkUnlink('H0022'));
        await expect(pop).toBeVisible();
        await pop.getByRole('button', { name: 'Cancel' }).click();
        expect((await records(page)).map(r => r.on)).toEqual([true, true]);
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(6);

        void page.evaluate(() => window.Strom.UI.viewLinkUnlink('H0022'));
        await pop.getByRole('button', { name: 'Unlink' }).click();
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(0);
        expect(await records(page)).toEqual([
            { hypo: 'H0030', variant: 'A', on: false, anchor: 'P0128' },
            { hypo: 'H0022', variant: 'B', on: false, anchor: 'P0010' },
        ]);
        await expect(page.locator('.toast')).toContainText('Unlinked');
    });
});

test.describe('linked in the view only: "+ family" and the curve’s pill', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('"+ family · 5": a menu of two — show it linked, or go to the family (as before)', async ({ page }) => {
        expect(GED_PILL).not.toContain('_END named');
        expect(GED_PILL).toContain('2 _HYPO H0022\n3 _JOIN P0125\n3 _VAR B\n3 _ISLAND 5');
        await setup(page, GED_PILL);
        const vaclav = await idOf(page, 'P0010');
        const pill = page.locator(`.edge-link-pill--family[data-edge-person="${vaclav}"]`);
        await expect(pill).toHaveText('+ family · 5');
        await expect(pill).toHaveAttribute('aria-haspopup', 'menu');
        await expect(stubOf(page)).not.toHaveClass(/edge-named/);
        await pill.click();
        const menu = page.getByRole('menu', { name: 'Family outside the tree at Václav Horák' });
        await expect(menu).toBeVisible();
        await expect(pill).toHaveAttribute('aria-expanded', 'true');
        const items = menu.getByRole('menuitem');
        await expect(items).toHaveCount(2);
        await expect(items.nth(0).locator('.view-link-menu__label')).toHaveText('Show as linked');
        await expect(items.nth(0).locator('.view-link-menu__hint')).toHaveText('H0022 B · Jakub Horák and Marie Pokorná, + 5 people');
        await expect(items.nth(1).locator('.view-link-menu__label')).toHaveText('Go to the family');
        await expect(items.nth(1).locator('.view-link-menu__hint')).toHaveText('Back with ↩ or Alt+←');
        // Arrows move, Esc closes and gives the keyboard back.
        await expect(items.nth(0)).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(1)).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(0)).toBeFocused();
        await page.keyboard.press('End');
        await expect(items.nth(1)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(pill).toBeFocused();
        await expect(pill).toHaveAttribute('aria-expanded', 'false');

        // Enter opens it; "Go to the family" goes there, as the pill did before.
        await page.keyboard.press('Enter');
        await expect(items.nth(0)).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        const jakub = await idOf(page, 'P0125');
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(jakub);
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(0);
        expect(await records(page)).toEqual([]);
    });

    test('"Show as linked" from the menu shows the family; while shown elsewhere in the view the first item is "Unlink"', async ({ page }) => {
        await setup(page, GED_PILL);
        const vaclav = await idOf(page, 'P0010');
        await page.locator(`.edge-link-pill--family[data-edge-person="${vaclav}"]`).click();
        await page.getByRole('menuitem', { name: /Show as linked/ }).click();
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(5);
        await expect(page.locator('.toast')).toContainText('Shown as linked: parents of Václav Horák (H0022, version B). Unproven.');
        // The pill steps aside while the family is shown.
        await expect(page.locator(`.edge-link-pill[data-edge-person="${vaclav}"]`)).toHaveCount(0);
        // The menu of a pill whose family is shown (opened by the module, as the list will): "Unlink" first.
        const pill = await page.evaluate((id) => {
            const el = document.createElement('button');
            el.id = 'probe-pill';
            el.style.cssText = 'position:fixed;left:600px;top:500px';
            document.body.appendChild(el);
            const S = window.Strom;
            const join = S.DataManager.getAllPersons().find(p => p.refn === 'P0125')!.id;
            S.UI.openViewLinkFamilyMenu(el, id as never, join, 'H0022');
            return true;
        }, vaclav);
        expect(pill).toBe(true);
        const items = page.getByRole('menuitem');
        await expect(items).toHaveCount(2);
        await expect(items.nth(0).locator('.view-link-menu__label')).toHaveText('Unlink');
        await expect(items.nth(0).locator('.view-link-menu__hint')).toHaveText('H0022 B · parents of Václav Horák');
        await items.nth(0).click();
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(0);
        await expect(page.locator(`.edge-link-pill--family[data-edge-person="${vaclav}"]`)).toHaveCount(1);
    });

    test('pointing at "+ family" shows the edge’s bubble', async ({ page }) => {
        await setup(page, GED_PILL);
        const vaclav = await idOf(page, 'P0010');
        await page.locator(`.edge-link-pill--family[data-edge-person="${vaclav}"]`).hover();
        await expect(bubble(page)).toHaveAttribute('role', 'tooltip');
        await expect(bubble(page).locator('.reb-end')).toHaveText('Not searched yet');
    });

    test('the curve’s pill "possible link · H0099" opens the same menu', async ({ page }) => {
        await setup(page, GED_CURVE);
        const ludmila = await idOf(page, 'P0013');
        const pill = page.locator(`.edge-link-pill--link[data-edge-person="${ludmila}"]`);
        await expect(pill).toHaveText('possible link · H0099');
        await pill.click();
        const items = page.getByRole('menu').getByRole('menuitem');
        await expect(items).toHaveCount(1);
        await expect(items.nth(0).locator('.view-link-menu__label')).toHaveText('Go to the family');
        await items.nth(0).click();
        const vaclav = await idOf(page, 'P0010');
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(vaclav);
    });

    test('a tree without what variants would connect: "+ family" goes straight to the family, the curve’s pill is a label', async ({ page }) => {
        // No variant links anywhere: the feature is not there.
        const plain = GED_PILL.split('\n').filter(l => !/^3 _LINK\b|^4 _(PERS|FAM|PAR) |^3 _VAR /.test(l)).join('\n');
        await setup(page, plain);
        expect(await page.evaluate(() => window.Strom.TreeRenderer.viewLinksOffered())).toBe(false);
        const vaclav = await idOf(page, 'P0010');
        const pill = page.locator(`.edge-link-pill--family[data-edge-person="${vaclav}"]`);
        await expect(pill).not.toHaveAttribute('aria-haspopup', 'menu');
        await pill.click();
        await expect(page.getByRole('menu')).toHaveCount(0);
        const jakub = await idOf(page, 'P0125');
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(jakub);
        await expect(page.locator('.view-link-island')).toHaveCount(0);
    });
});

test.describe('linked in the view only: the family’s own button', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('one button under the top couple; its versions in a menu; back in the tree with the ghosts', async ({ page }) => {
        await setup(page);
        await store(page, [], 'P0125');
        const wrap = page.locator('.view-link-island');
        await expect(wrap).toHaveCount(1);
        const btn = wrap.getByRole('button', { name: 'Show linked to the tree' });
        await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
        await expect(btn.locator('.view-link-icon--12')).toHaveCount(1);
        await expect(wrap.locator('.view-link-island-sub')).toHaveText('H0022 B · H0028 A');
        await expect(btn).toHaveCSS('height', '32px');
        // Under the caption of Tomáš and Anna (the top couple), centred under them.
        const [t, a, w, cap] = await Promise.all([
            card(page, 'Tomáš').boundingBox(), card(page, 'Anna').boundingBox(), btn.boundingBox(),
            card(page, 'Tomáš').locator('.island-caption').boundingBox(),
        ]);
        expect(Math.abs((w!.x + w!.width / 2) - ((t!.x + a!.x + a!.width) / 2))).toBeLessThan(2);
        expect(w!.y).toBeGreaterThan(cap!.y + cap!.height);

        await btn.click();
        const items = page.getByRole('menu', { name: 'Versions to show' }).getByRole('menuitem');
        await expect(items).toHaveCount(2);
        await expect(items.nth(0).locator('.view-link-menu__label')).toHaveText('H0022 B · Václav Horák');
        await expect(items.nth(0).locator('.view-link-menu__hint')).toContainText('+ 5 people');
        await expect(items.nth(1).locator('.view-link-menu__label')).toHaveText('H0028 A · Antonín Dvořáček');
        await items.nth(0).click();
        // Back where the tree was (Karel), the family linked to Václav.
        const karel = await idOf(page, 'P0001');
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(karel);
        await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0022"]')).toHaveCount(5);
        await expect(page.locator('.toast')).toContainText('Shown as linked: parents of Václav Horák (H0022, version B). Unproven.');
        await expect.poll(() => allInView(page, page.locator('.person-card.view-ghost, .person-card:has(.name-text:text("Václav"))'))).toBe(true);
        // The family's view again: it stands linked, no button.
        await store(page, [B], 'P0125');
        await expect(page.locator('.person-card.view-ghost')).not.toHaveCount(0);
        await expect(page.locator('.view-link-island')).toHaveCount(0);
    });

    test('one version: the button shows it at once (no history: at the person it links to)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const S = window.Strom;
            S.TreeRenderer.setFocus(S.DataManager.getAllPersons().find(p => p.refn === 'P0130')!.id);
            S.TreeRenderer.resetFocusHistory();
        });
        const wrap = page.locator('.view-link-island');
        await expect(wrap).toHaveCount(1);
        await expect(wrap.locator('.view-link-island-sub')).toHaveText('H0022 C · to Václav Horák (1818)');
        await expect(wrap.getByRole('button')).not.toHaveAttribute('aria-haspopup', 'menu');
        await wrap.getByRole('button', { name: 'Show linked to the tree' }).click();
        const vaclav = await idOf(page, 'P0010');
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(vaclav);
        await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0022"][data-view-variant="C"]')).toHaveCount(1);
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'C', on: true, anchor: 'P0010' }]);
        expect(C.variant).toBe('C');
    });
});

test.describe('linked in the view only: a phone (touch)', () => {
    test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

    test('the first tap pins the bubble: the screen less 24, buttons of 44 under the text', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const S = window.Strom;
            S.TreeRenderer.setFocus(S.DataManager.getAllPersons().find(p => p.refn === 'P0010')!.id);
        });
        const stub = stubOf(page);
        await expect(stub).toHaveCSS('height', '44px');
        await stub.tap();
        const b = bubble(page);
        await expect(b).toHaveClass(/is-pinned/);
        const box = (await b.boundingBox())!;
        expect(box.width).toBe(336);
        expect(box.x).toBe(12);
        const btn = b.locator('.reb-variant[data-variant="B"] .reb-show');
        await expect(btn).toHaveCSS('height', '44px');
        const title = (await b.locator('.reb-variant[data-variant="B"] .reb-variant-text').boundingBox())!;
        expect((await btn.boundingBox())!.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
        const close = (await b.locator('.reb-close').boundingBox())!;
        expect(close.width).toBeGreaterThanOrEqual(44);
        expect(close.height).toBeGreaterThanOrEqual(44);
        expect(box.y + box.height).toBeLessThanOrEqual(740);
        await btn.tap();
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(5);
    });

    test('"+ family" menu rows and the family’s button are 44px targets', async ({ page }) => {
        await setup(page, GED_PILL);
        await page.evaluate(() => {
            const S = window.Strom;
            S.TreeRenderer.setFocus(S.DataManager.getAllPersons().find(p => p.refn === 'P0010')!.id);
        });
        const vaclav = await idOf(page, 'P0010');
        const pill = page.locator(`.edge-link-pill--family[data-edge-person="${vaclav}"]`);
        expect(await pill.evaluate((el) => parseFloat(getComputedStyle(el, '::before').height))).toBe(44);
        await pill.tap();
        const items = page.getByRole('menuitem');
        await expect(items).toHaveCount(2);
        for (let i = 0; i < 2; i++) expect((await items.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await items.nth(1).tap();
        const btn = page.locator('.view-link-island-btn');
        await expect(btn).toHaveCount(1);
        expect(await btn.evaluate((el) => parseFloat(getComputedStyle(el, '::before').height))).toBe(44);
    });
});

test.describe('linked in the view only: a phone held sideways', () => {
    test.use({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true });

    test('the pinned bubble stays inside the window', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const S = window.Strom;
            S.TreeRenderer.setFocus(S.DataManager.getAllPersons().find(p => p.refn === 'P0010')!.id);
        });
        await stubOf(page).tap();
        await expect(bubble(page)).toHaveClass(/is-pinned/);
        const box = (await bubble(page).boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(360);
        expect(box.x + box.width).toBeLessThanOrEqual(740);
    });
});

test.describe('linked in the view only: a tablet', () => {
    test.use({ viewport: { width: 820, height: 1000 } });

    test('the pinned bubble is 420 wide', async ({ page }) => {
        await setup(page);
        await stubOf(page).click();
        await expect(bubble(page)).toHaveClass(/is-pinned/);
        await expect(bubble(page)).toHaveCSS('width', '420px');
    });
});

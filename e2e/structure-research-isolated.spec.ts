import { test, expect, type Page } from '@playwright/test';
import { fakeBridge, links, openResearch, poll, researchGed, BRIDGE, HEAD } from './research-bridge.js';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';

/**
 * Research isolated per tree in Manage trees (spec 139 §11.2, K5.2, K5.7):
 * a copy of a research tree says "copy of the tree … · no research" with the
 * switch "Research on" off where the research runs here — a click does not
 * turn it, it asks for the copy's own research; the tree followed live says
 * "◎ Followed live", that writing to it is paused, and End following; it
 * keeps Change structure…, where only "Add from a file to this tree…" waits
 * for the following to end. The bridge is answered by page.route
 * (research-bridge.ts). Invented families only.
 */

const DESKTOP = { width: 1440, height: 900 };
test.use({ viewport: DESKTOP });

const manager = (page: Page) => page.locator('#tree-manager-modal');
const row = (page: Page, id: string) => manager(page).locator(`.tree-manager-item[data-tree-id="${id}"]`);

test('a copy of a research tree: its row says it has no research, its switch is off and asks for a research of its own', async ({ page }) => {
    await openResearch(page);
    // The research here offers a new research (`new` announced): the copy's switch shows.
    await fakeBridge(page, { links: ['send', 'open', 'live', 'app', 'setup', 'new'] });
    await poll(page);
    const ownerId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    const copyId = await page.evaluate((id) => window.Strom.TreeManager.duplicateTree(id, 'Fíškovi (kopie)'), ownerId);
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());

    const copy = row(page, copyId);
    await expect(copy.locator('.tree-manager-item-origin')).toHaveAttribute('data-origin', 'copy');
    await expect(copy.locator('.tree-manager-item-origin-text')).toHaveText('copy of the tree “Fíškovi” · no research');
    const sw = copy.locator('.tree-manager-copy-research');
    await expect(sw).toBeVisible();
    await expect(sw).toHaveAttribute('role', 'switch');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(sw).toContainText('Research on');
    // The owner names its research (its own switch is the bridge's).
    await expect(row(page, ownerId).locator('.tree-manager-item-origin')).toHaveAttribute('data-origin', 'research');
    await expect(row(page, ownerId).locator('.tree-manager-copy-research')).toHaveCount(0);

    // The switch asks for the copy's own research (§11.4): the dialog, its folder named after the copy.
    await sw.click();
    const dialog = page.locator('#copy-research-modal');
    await expect(dialog.getByRole('heading')).toHaveText('Research for a copy of a tree');
    await expect(dialog.locator('#copy-research-folder')).toHaveValue('Fíškovi (kopie)');
    // A research that does not say where it makes researches (no `treesRoot`): the name alone, as before.
    await expect(dialog.locator('.copy-research-root')).toHaveCount(0);
    await expect(dialog.locator('.copy-research-stays')).toContainText('Fíškovi');
    await expect(dialog.locator('.buttons .primary')).toContainText('Start a new research');
    await expect(dialog.locator('.buttons .primary .research-open-mark')).toHaveCount(1);
    await expect(dialog.locator('.copy-research-takeover')).toHaveText('Take over the research of “Fíškovi”…');
    // Cancel changes nothing: still off, still a copy without research, nothing launched.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    const meta = await page.evaluate((id) => window.Strom.TreeManager.getTreeMetadata(id), copyId);
    expect(meta.research).toBeUndefined();
    expect(meta.copyOf).toEqual({ treeId: ownerId, name: 'Fíškovi' });
    expect((await links(page)).filter(l => l.startsWith('strom-research://new'))).toEqual([]);

    // ⋯ › Research of the copy: "Turn on research…" with the research terminal's mark, the same dialog.
    const turnOn = await page.evaluate(async (id) => {
        const ui = window.Strom.UI as unknown as { treeActionGroups(id: string, source: string): Promise<{ key: string; rows: { key: string; label: string; research?: boolean; run(): void }[] }[]> };
        const rows = (await ui.treeActionGroups(id, 'more')).find(g => g.key === 'research')?.rows ?? [];
        rows[0]?.run();
        return rows.map(r => ({ key: r.key, label: r.label, research: !!r.research }));
    }, copyId);
    expect(turnOn).toEqual([{ key: 'researchCopy', label: 'Turn on research…', research: true }]);
    await expect(dialog.getByRole('heading')).toHaveText('Research for a copy of a tree');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Start a new research: the research's set-up, the folder's name on its link (K5.4).
    await sw.click();
    await dialog.locator('#copy-research-folder').fill('Fíškovi – druhá větev');
    await dialog.locator('.buttons .primary').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await links(page)).filter(l => l.startsWith('strom-research://new')))
        .toEqual([expect.stringMatching(new RegExp(`^strom-research://new\\?app=[A-Za-z0-9_-]+(&browser=[a-z]+)?&name=${encodeURIComponent('Fíškovi – druhá větev').replace(/[()]/g, '\\$&')}$`))]);
});

/** Where the research makes researches on this computer (`/status.treesRoot`), long enough to be cut on a phone. */
const TREES_ROOT = '/Users/jana.novakova/Documents/Rodinný archiv a výzkumy předků/Strom výzkum';

for (const [label, viewport, lang] of [
    ['desktop', DESKTOP, 'en'],
    ['phone 390', { width: 390, height: 844 }, 'de'],
    ['phone sideways 844×390', { width: 844, height: 390 }, 'de'],
] as const) {
    test(`${label}: the bridge says where researches are made — the folder field shows it as a fixed prefix, cut from the left, the link names only the new research (§11.4)`, async ({ page }) => {
        await page.setViewportSize(viewport);
        if (lang !== 'en') await seedSetting(page, 'language', lang);
        await openResearch(page);
        await fakeBridge(page, { links: ['send', 'open', 'live', 'app', 'setup', 'new'], statusExtra: { treesRoot: TREES_ROOT + '/' } });
        await poll(page);
        const ownerId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
        const name = 'Pětiokovi – druhá větev rodu z Dolní Mokřiny u Brdovic';
        const copyId = await page.evaluate(([id, n]) => window.Strom.TreeManager.duplicateTree(id, n), [ownerId, name] as const);
        await page.evaluate((id) => window.Strom.UI.showCopyResearchDialog(id), copyId);

        const dialog = page.locator('#copy-research-modal');
        const root = dialog.locator('.copy-research-root');
        const field = dialog.locator('#copy-research-folder');
        // The prefix: the root with its separator (the trailing one said by the bridge dropped), whole in its title.
        await expect(root).toHaveText(TREES_ROOT + '/');
        await expect(root).toHaveAttribute('title', TREES_ROOT + '/');
        await expect(field).toHaveValue(name);
        await expect(field).toHaveAttribute('aria-describedby', 'copy-research-root');
        // Not editable: a click on it edits the name.
        await root.click();
        await expect(field).toBeFocused();
        // One line, inside the dialog: the prefix is cut, the field keeps its room, nothing overflows.
        const box = await page.evaluate(() => {
            const d = document.querySelector('#copy-research-modal .modal-content') as HTMLElement;
            const path = document.querySelector('#copy-research-modal .copy-research-path') as HTMLElement;
            const r = document.querySelector('#copy-research-modal .copy-research-root') as HTMLElement;
            const f = document.querySelector('#copy-research-folder') as HTMLElement;
            const pr = path.getBoundingClientRect(), rr = r.getBoundingClientRect(), fr = f.getBoundingClientRect();
            return {
                dialogOverflow: d.scrollWidth - d.clientWidth, pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
                rootCut: r.scrollWidth > r.clientWidth, sameLine: Math.abs((rr.top + rr.bottom) / 2 - (fr.top + fr.bottom) / 2) < 2,
                inside: rr.left >= pr.left - 0.5 && fr.right <= pr.right + 0.5 && rr.right <= fr.left + 0.5, fieldWidth: fr.width,
            };
        });
        expect(box.dialogOverflow).toBeLessThanOrEqual(0);
        expect(box.pageOverflow).toBeLessThanOrEqual(0);
        expect(box.sameLine).toBe(true);
        expect(box.inside).toBe(true);
        expect(box.fieldWidth).toBeGreaterThan(90);
        if (viewport.width < 600) expect(box.rootCut).toBe(true);
        // The link names the new research only, never the root.
        await field.fill('Fíškovi – druhá větev');
        await dialog.locator('.buttons .primary').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await links(page)).filter(l => l.startsWith('strom-research://new')))
            .toEqual([expect.stringMatching(new RegExp(`&name=${encodeURIComponent('Fíškovi – druhá větev')}$`))]);
    });
}

test('a copy takes over the original\'s research only behind a warning: then the copy owns it, the original has none', async ({ page }) => {
    await openResearch(page);
    await fakeBridge(page, { links: ['send', 'open', 'live', 'app', 'setup', 'new'] });
    await poll(page);
    const ownerId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    const researchId = await page.evaluate((id) => window.Strom.TreeManager.getTreeMetadata(id)!.research!.id, ownerId);
    const copyId = await page.evaluate((id) => window.Strom.TreeManager.duplicateTree(id, 'Fíškovi (kopie)'), ownerId);
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await row(page, copyId).locator('.tree-manager-copy-research').click();
    const dialog = page.locator('#copy-research-modal');
    await dialog.locator('.copy-research-takeover').click();
    await expect(dialog).toHaveCount(0);

    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Take over the research of “Fíškovi”?');
    const ok = confirm.locator('#confirm-ok-btn');
    await expect(ok).toHaveText('Take over research');
    await expect(ok).toHaveClass(/is-danger/);
    // Taking over happens in the app alone: no research mark on the button.
    await expect(ok.locator('.research-open-mark')).toHaveCount(0);
    await ok.click();

    await expect.poll(() => page.evaluate((id) => window.Strom.TreeManager.getTreeMetadata(id)?.research?.id ?? null, copyId)).toBe(researchId);
    const [owner, copy] = await page.evaluate(([o, c]) => [window.Strom.TreeManager.getTreeMetadata(o), window.Strom.TreeManager.getTreeMetadata(c)], [ownerId, copyId]);
    expect(owner.research).toBeUndefined();
    expect(copy.copyOf).toBeUndefined();
    expect(await page.evaluate((id) => window.Strom.TreeManager.canSendToResearch(id), copyId)).toBe(true);
    expect((await links(page)).filter(l => l.startsWith('strom-research://new'))).toEqual([]);
});

/** The research followed from its bridge (`?live=`): the tree is read-only meanwhile. */
async function followLive(page: Page): Promise<string> {
    await page.addInitScript(() => {
        // The bridge's events: the hello is the status (the routed fetch); nothing else comes.
        class FakeEventSource {
            url: string;
            readyState = 1;
            onerror: ((e: Event) => void) | null = null;
            private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
            constructor(url: string) {
                this.url = url;
                void fetch(url.replace(/\/events(\?.*)?$/, '/status')).then(r => r.json()).then(st => this.emit('hello', st));
            }
            addEventListener(type: string, fn: (e: MessageEvent) => void): void { (this.listeners[type] ??= []).push(fn); }
            removeEventListener(): void { /* not needed */ }
            close(): void { this.readyState = 2; }
            emit(type: string, data: unknown): void {
                for (const fn of this.listeners[type] ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
            }
        }
        Object.defineProperty(window, 'EventSource', { value: FakeEventSource, configurable: true, writable: true });
    });
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await seedSetting(page, 'fileCopyReminders', false);
    await seedSetting(page, 'onThisDay', false);
    await fakeBridge(page, { treeGed: researchGed(HEAD) });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect.poll(() => page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(true);
    return page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
}

test('the tree followed live: "◎ Followed live" with End following in its row; Change structure… stays, only adding a file waits', async ({ page }) => {
    const id = await followLive(page);
    // Another tree: joining into it is possible while this one is followed.
    await page.evaluate(() => window.Strom.TreeManager.createTree('Jesenští'));
    const rid = await page.evaluate((id) => window.Strom.TreeManager.getTreeMetadata(id)!.research!.id, id);

    // The tree's own menu (Actions) has Change structure… while it is followed.
    const keys = await page.evaluate(async (id) => {
        const groups = await (window.Strom.UI as unknown as {
            treeActionGroups(id: string, source: string): Promise<Array<{ rows: Array<{ key: string }> }>>;
        }).treeActionGroups(id, 'actions');
        return groups.flatMap(g => g.rows.map(r => r.key));
    }, id);
    expect(keys).toContain('structure');
    expect(keys).not.toContain('rename');

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const item = row(page, id);
    const origin = item.locator('.tree-manager-item-origin');
    await expect(origin).toHaveAttribute('data-followed', '1');
    await expect(origin.locator('.tree-manager-item-followed')).toHaveText('◎ Followed live');
    await expect(origin.locator('.tree-manager-item-origin-text')).toHaveText(`Research ${rid.slice(0, 8)} · writing to the tree is paused`);
    await expect(origin.locator('.tree-manager-stop-follow')).toHaveText('End following');
    // Only that tree: the other row says nothing of following.
    await expect(manager(page).locator('.tree-manager-item-followed')).toHaveCount(1);

    // Change structure… in its row; in the dialog only what writes into this tree ("From another tree into this
    // tree…", "Add from a file to this tree…") is greyed, with End following.
    await item.locator('[data-row-action="structure"]').click();
    const dialog = page.locator('#structure-modal');
    await expect(dialog).toBeVisible();
    const option = (key: string) => dialog.locator(`.menu-option[data-action="${key}"]`);
    for (const key of ['from', 'file']) {
        await expect(option(key)).toHaveAttribute('aria-disabled', 'true');
        await expect(dialog.locator(`#structure-why-${key}`)).toContainText('End following');
    }
    for (const key of ['select', 'copy', 'families', 'into']) await expect(option(key)).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // End following in the row: the tree is written to again, the row says its research as any.
    await expect(manager(page)).toBeVisible();
    await row(page, id).locator('.tree-manager-stop-follow').click();
    await expect.poll(() => page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(false);
    await expect(row(page, id).locator('.tree-manager-item-origin')).not.toHaveAttribute('data-followed', '1');
    await expect(row(page, id).locator('.tree-manager-item-origin-text')).toHaveText(`Research ${rid.slice(0, 8)}`);
    await expect(manager(page).locator('.tree-manager-item-followed')).toHaveCount(0);
});

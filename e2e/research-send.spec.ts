import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, card } from './helpers.js';

/**
 * Sending the user's changes back to Strom Research (?send=): the app finds
 * the tree(s) tied to the research, asks, and POSTs one faithful GEDCOM that
 * names the research and the version it came from. The bridge (status, sync)
 * is answered by page.route; the app accepts nothing but 127.0.0.1.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const HEAD = '3f2a9c1e5b7d';
const BRIDGE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 27 SEP 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 TRLR',
    ].join('\n');
}

async function dropFile(page: Page, name: string, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle(({ name, content }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], name, { type: 'text/plain' }));
        return dt;
    }, { name, content });
    await page.dispatchEvent('#tree-container', 'dragenter', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'dragover', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'drop', { dataTransfer });
}

/** Open the research in the app (a tied tree), optionally change it. */
async function openResearch(page: Page, edit: boolean): Promise<void> {
    await openApp(page);
    await dropFile(page, 'tree-strom.ged', researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
    if (edit) {
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { birthDate: '1850-03-14' });
        });
    }
}

/** A fake bridge: /status names the research, /sync records what it got. */
async function bridge(page: Page, reply: { status?: number; body?: unknown } = {}): Promise<{ posts: { body: string; type: string }[]; cancels: string[] }> {
    const posts: { body: string; type: string }[] = [];
    const cancels: string[] = [];
    await page.route(`${BRIDGE}/**`, async (route) => {
        const url = new URL(route.request().url()).pathname;
        if (url.endsWith('/status')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                body: JSON.stringify({ tree: UUID, name: 'Víškovi', head: HEAD }) });
        }
        if (url.endsWith('/sync') && route.request().method() === 'POST') {
            posts.push({ body: route.request().postData() ?? '', type: route.request().headers()['content-type'] ?? '' });
            return route.fulfill({ status: reply.status ?? 200, headers: { ...cors, 'content-type': 'application/json' },
                body: JSON.stringify(reply.body ?? { ok: true, input: 'I0042', changes: 1 }) });
        }
        if (url.endsWith('/cancel') && route.request().method() === 'POST') {
            const reason = JSON.parse(route.request().postData() ?? '{}').reason as string;
            cancels.push(reason);
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                body: JSON.stringify({ ok: true, reason }) });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    return { posts, cancels };
}

const send = (page: Page) => page.evaluate((b) => window.Strom.UI.sendChangesToResearch(b), BRIDGE);
const dialog = (page: Page) => page.locator('#confirmation-modal');

test.describe('send changes back to the research', () => {
    test('the header _STROM_HEAD is kept; one tied tree → confirm → one POST of a faithful GEDCOM', { tag: '@smoke' }, async ({ page }) => {
        await openResearch(page, true);
        const meta = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata());
        expect(meta.research.head).toBe(HEAD);
        const { posts, cancels } = await bridge(page);

        const done = send(page);
        await expect(dialog(page)).toContainText('Send the changes of the tree “Víškovi” to the research “Víškovi”?');
        expect(posts).toHaveLength(0);   // nothing goes before the confirmation
        await dialog(page).getByRole('button', { name: 'Send' }).click();
        await expect(dialog(page)).toContainText('Sent. Confirm the changes in the research');
        await dialog(page).getByRole('button', { name: 'OK' }).click();
        await done;

        expect(posts).toHaveLength(1);
        expect(posts[0].type).toContain('text/plain');
        const ged = posts[0].body;
        expect(ged).toContain(`1 _STROM_TREE ${UUID}`);
        expect(ged).toContain(`1 _STROM_HEAD ${HEAD}`);
        expect(ged).not.toContain('SOUR STROM_RESEARCH');
        expect(ged).toMatch(/1 REFN P0003\r?\n2 TYPE strom-research/);
        expect(ged).toContain('14 MAR 1850');
        await page.waitForTimeout(100);
        expect(cancels).toEqual([]);   // a sent tree cancels nothing
    });

    test('cancel sends nothing; an unchanged tree has nothing to send — both tell the bridge why', async ({ page }) => {
        await openResearch(page, false);
        const { posts, cancels } = await bridge(page);
        const done = send(page);
        await expect(dialog(page)).toContainText('has not changed since it was last loaded from the research');
        await dialog(page).getByRole('button', { name: 'OK' }).click();
        await done;
        expect(posts).toHaveLength(0);
        await expect.poll(() => cancels).toEqual(['unchanged']);

        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { birthPlace: 'Praha' });
        });
        const again = send(page);
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        await again;
        expect(posts).toHaveLength(0);
        await expect.poll(() => cancels).toEqual(['unchanged', 'cancelled']);
    });

    test('several tied trees: the user picks one (the open tree suggested); only that one is sent', async ({ page }) => {
        await openResearch(page, true);
        const firstId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
        await page.evaluate((id) => window.Strom.TreeManager.duplicateTree(id, 'Víškovi – pokus'), firstId);
        const trees = await page.evaluate(() => window.Strom.TreeManager.getTrees());
        expect(trees.find((t: any) => t.name === 'Víškovi – pokus').research.copy).toBe(true);
        const { posts } = await bridge(page);

        const done = send(page);
        await expect(dialog(page)).toContainText('Several trees in the app come from the research');
        const buttons = dialog(page).locator('#confirm-buttons button');
        await expect(buttons.last()).toContainText('Víškovi (changed');   // the open tree, primary
        await dialog(page).getByRole('button', { name: /Víškovi – pokus/ }).click();
        await expect(dialog(page)).toContainText('the tree “Víškovi – pokus”');
        // The tree being sent is the one on screen behind the dialog.
        await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Víškovi – pokus');
        await dialog(page).getByRole('button', { name: 'Send' }).click();
        await dialog(page).getByRole('button', { name: 'OK' }).click();
        await done;
        expect(posts).toHaveLength(1);
    });

    test('no tree of this research; a refusal shows the reason; a foreign address is refused', async ({ page }) => {
        await openApp(page);
        const { cancels } = await bridge(page);
        const done = send(page);
        await expect(dialog(page)).toContainText('The research “Víškovi” is not in the app');
        await dialog(page).getByRole('button', { name: 'OK' }).click();
        await done;
        await expect.poll(() => cancels).toEqual(['no-tree']);

        await page.unrouteAll();
        await openResearch(page, true);
        await bridge(page, { status: 409, body: { error: 'Výzkum mezitím změnil jiný agent' } });
        const refused = send(page);
        await dialog(page).getByRole('button', { name: 'Send' }).click();
        await expect(dialog(page)).toContainText('The research did not accept the changes: Výzkum mezitím změnil jiný agent');
        await dialog(page).getByRole('button', { name: 'OK' }).click();
        await refused;

        let requested = false;
        await page.route('**/evil.com/**', (route) => { requested = true; return route.abort(); });
        await page.evaluate(() => window.Strom.UI.sendChangesToResearch('https://evil.com/steal'));
        await expect(page.locator('.toast')).toContainText('on this computer');
        expect(requested).toBe(false);
    });

    test('?send= in the address starts it and leaves the address clean', async ({ page }) => {
        await openResearch(page, true);
        const { posts } = await bridge(page);
        await page.goto(`/strom.html?send=${encodeURIComponent(BRIDGE)}`);
        await expect(dialog(page)).toContainText('Send the changes of the tree “Víškovi”');
        expect(page.url()).not.toContain('send=');
        await dialog(page).getByRole('button', { name: 'Send' }).click();
        await expect(dialog(page)).toContainText('Sent.');
        expect(posts).toHaveLength(1);
    });

    /** A stand-in for the installed app's launchQueue: launches are fed by the test. */
    const fakeLaunchQueue = () => {
        const w = window as unknown as { __launch: (p: unknown) => void };
        const pending: unknown[] = [];
        let consumer: ((p: unknown) => void) | null = null;
        // Chrome's own window.launchQueue is a read-only accessor: redefine it.
        Object.defineProperty(window, 'launchQueue', { configurable: true, value: {
            setConsumer(c: (p: unknown) => void) { consumer = c; pending.splice(0).forEach(p => c(p)); },
        } });
        w.__launch = (p: unknown) => { if (consumer) consumer(p); else pending.push(p); };
    };

    test('the installed app already open: a later launch with ?send= is taken over by that window', async ({ page }) => {
        await page.addInitScript(fakeLaunchQueue);
        await openResearch(page, true);
        const { posts } = await bridge(page);
        // Chrome brings the open window forward and hands it the address.
        await page.evaluate((b) => (window as unknown as { __launch: (p: unknown) => void })
            .__launch({ targetURL: `${location.origin}/strom.html?send=${encodeURIComponent(b)}`, files: [] }), BRIDGE);
        await expect(dialog(page)).toContainText('Send the changes of the tree “Víškovi”');
        await dialog(page).getByRole('button', { name: 'Send' }).click();
        await expect(dialog(page)).toContainText('Sent.');
        expect(posts).toHaveLength(1);
    });

    test('the launch that started the page is not handled twice', async ({ page }) => {
        await openResearch(page, true);
        let statusCalls = 0;
        const { posts } = await bridge(page);
        page.on('request', (r) => { if (new URL(r.url()).pathname.endsWith('/status')) statusCalls++; });
        const target = `/strom.html?send=${encodeURIComponent(BRIDGE)}`;
        await page.addInitScript((t) => {
            Object.defineProperty(window, 'launchQueue', { configurable: true, value: {
                setConsumer(c: (p: unknown) => void) { c({ targetURL: location.origin + t, files: [] }); },
            } });
        }, target);
        await page.goto(target);
        await expect(dialog(page)).toContainText('Send the changes of the tree “Víškovi”');
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        await page.waitForTimeout(500);
        expect(statusCalls).toBe(1);
        await expect(dialog(page)).toBeHidden();
        expect(posts).toHaveLength(0);
    });

    test('exports of a tied tree name the research — only when faithful; JSON import ties it again', async ({ page }) => {
        await openResearch(page, true);
        // Faithful JSON ("Save to file": everything, as is).
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.evaluate(() => window.Strom.UI.saveTreeCopy()),
        ]);
        const json = JSON.parse(readFileSync(await download.path(), 'utf-8'));
        expect(json.research).toEqual({ id: UUID, head: HEAD });
        // A redacted export does not.
        const [redacted] = await Promise.all([
            page.waitForEvent('download'),
            page.evaluate(() => window.Strom.DataManager.exportTreeJSON(window.Strom.TreeManager.getActiveTreeId(), null, 'initials', false)),
        ]);
        expect(JSON.parse(readFileSync(await redacted.path(), 'utf-8')).research).toBeUndefined();

        // Importing the faithful file makes a tree tied as a copy (the original still takes updates).
        await page.locator('#file-input').setInputFiles({ name: 'back.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
        const imp = page.locator('#import-tree-modal');
        await imp.locator('#import-tree-name').fill('Z jiného počítače');
        await imp.getByRole('button', { name: 'Import' }).click();
        await expect(imp).toBeHidden();
        const tied = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata().research);
        expect(tied).toMatchObject({ id: UUID, head: HEAD, copy: true });
        // Stored tree data never carries the field.
        const stored = await page.evaluate(() => (window.Strom.DataManager.getData() as any).research);
        expect(stored).toBeUndefined();
    });

    test('a newer export over an edited tree: Cancel in "Changed in the app" leaves the tree and its version as they were', async ({ page }) => {
        await openResearch(page, true);
        const before = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata().research);
        await dropFile(page, 'tree-strom.ged', researchGed().replace(`_STROM_HEAD ${HEAD}`, '_STROM_HEAD 9a8b7c6d5e4f'));
        await expect(dialog(page)).toContainText('Changed in the app');
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog(page)).toBeHidden();
        const after = await page.evaluate(() => ({
            research: window.Strom.TreeManager.getActiveTreeMetadata().research,
            trees: window.Strom.TreeManager.getTrees().length,
            born: (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any).birthDate,
        }));
        expect(after).toEqual({ research: before, trees: 1, born: '1850-03-14' });
    });

    test('the tree menu explains the way back and offers the GEDCOM', async ({ page }) => {
        await openResearch(page, true);
        const id = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
        const done = page.evaluate((i) => window.Strom.UI.showSendToResearchHelp(i), id);
        await expect(dialog(page)).toContainText('“Add to the research” → “Take in edits from the Strom app or another family tree (.ged, .json)” → “Straight from the Strom app”');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            dialog(page).getByRole('button', { name: 'Export GEDCOM' }).click(),
        ]);
        await done;
        const ged = readFileSync(await download.path(), 'utf-8');
        expect(ged).toContain(`1 _STROM_HEAD ${HEAD}`);
    });
});

test.describe('where the tree menu offers it', () => {
    test('a computer: in the tree manager of a tied tree', async ({ page }) => {
        await openResearch(page, false);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        await expect(page.locator('#tree-manager-modal')).toContainText('Send changes to the research');
    });

    test('a computer: Actions → Research of a tied tree (nothing announced: Send + What is it), not of another tree', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openResearch(page, false);
        await page.locator('.actions-menu-btn').click();
        // "Research" replaces "Ancestor research" for this tree.
        await expect(page.locator('#research-menu-row')).toBeHidden();
        await page.locator('#actions-research-row').click();
        const items = page.locator('#actions-research-submenu .tree-switcher-action');
        await expect(items).toHaveText(['Send changes', 'What is Strom Research']);
        await expect(page.locator('#actions-research-submenu .research-submenu-note')).toHaveCount(0);
        await items.first().click();
        // No research links announced here: the way back is explained.
        await expect(dialog(page)).toContainText('Add to the research');
        await dialog(page).getByRole('button', { name: 'Close' }).click();
        // The "Tree:" submenu no longer carries it.
        await page.locator('.actions-menu-btn').click();
        await page.locator('#actions-tree-row').click();
        await expect(page.locator('#actions-tree-submenu')).not.toContainText('Send changes');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        await page.evaluate(async () => {
            const id = await window.Strom.TreeManager.createTree('Jiny strom');
            await window.Strom.UI.switchToTree(id);
        });
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#actions-research-row')).toBeHidden();
        await expect(page.locator('#research-menu-row')).toBeVisible();
    });

    test('a phone (touch): not offered — the research cannot run there', async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await openResearch(page, false);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        await expect(page.locator('#tree-manager-modal')).toBeVisible();
        await expect(page.locator('#tree-manager-modal')).not.toContainText('Send changes to the research');
        await ctx.close();
    });
});

import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * The other research trees on this computer (spec 011, U4a): their bridges
 * are asked for their status (one at a time, about once a minute — here every
 * second through `__OTHER_RESEARCH_MS`), the switcher marks each tree (running
 * with its directions, waiting, not running; a copy nothing), the closed
 * switcher carries one dot for the other trees, the research panel names the
 * other trees where an agent works or something waits ("Elsewhere": one row,
 * or "Other trees: N" that unfolds), a row opens that tree, a bridge that does
 * not answer is "not running", and a browser that keeps the page from the
 * research programs says so once at the switcher's foot. Invented families only.
 */

const NOVAK = '6a1d2c3e-4f50-4a61-8b72-9c83d4e5f601';
const DVORAK = '7b2e3d4f-5061-4b72-9c83-ad94e5f60712';
const SVOBODA = '8c3f4e50-6172-4c83-ad94-be05f6071823';
const HORAK = '9d405f61-7283-4d94-be05-cf1607182934';
const B_NOVAK = 'http://127.0.0.1:5991/11111111111111111111111111111111';
const B_DVORAK = 'http://127.0.0.1:5992/22222222222222222222222222222222';
const B_SVOBODA = 'http://127.0.0.1:5993/33333333333333333333333333333333';
const B_HORAK = 'http://127.0.0.1:5994/44444444444444444444444444444444';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['open', 'chat', 'task', 'live'];

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const item = (id: string) => ({ id, what: `Dopis ${id}`, on: 'odpověď matriky', at: ago(86_400_000) });
const worker = (research: string, task: string) => ({ who: 'agent-matriky', since: ago(9 * 60_000), task, research });

/** What a bridge answers: a status, or no answer at all. */
type Answer = { working?: unknown[]; waiting?: unknown[] } | 'down';

function status(id: string, name: string, a: Exclude<Answer, 'down'>) {
    return { tree: { id, name }, head: 'h1', persons: 3, working: a.working ?? [], waiting: a.waiting ?? [], queue: [], links: LINKS };
}

/** Fake bridges by address; `answers` can change during a test. */
async function bridges(page: Page, answers: Record<string, { id: string; name: string; answer: () => Answer }>): Promise<void> {
    for (const [base, b] of Object.entries(answers)) {
        await page.route(`${base}/**`, async (route) => {
            const a = b.answer();
            if (a === 'down') return route.abort('connectionrefused');
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/status')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status(b.id, b.name, a)) });
            }
            return route.fulfill({ status: 404, headers: cors, body: '' });
        });
    }
}

async function fastRounds(page: Page, o: { denied?: boolean } = {}): Promise<void> {
    await page.addInitScript((denied) => {
        (globalThis as { __OTHER_RESEARCH_MS?: unknown }).__OTHER_RESEARCH_MS = { first: 50, every: 800, fresh: 0, timeout: 600 };
        if (!denied) return;
        const perms = navigator.permissions;
        const orig = perms?.query?.bind(perms);
        Object.defineProperty(navigator, 'permissions', {
            configurable: true,
            value: {
                query: (d: { name: string }) => ['local-network-access', 'loopback-network', 'local-network'].includes(d.name)
                    ? Promise.resolve({ state: 'denied', onchange: null })
                    : orig ? orig(d as PermissionDescriptor) : Promise.reject(new TypeError('no')),
            },
        });
    }, !!o.denied);
}

interface TreeDef { name: string; id: string; base?: string; copy?: boolean; lastWaiting?: number }

/** Research trees as the research left them (its bridge's address kept on this computer). */
async function addTrees(page: Page, defs: TreeDef[]): Promise<Record<string, string>> {
    return page.evaluate((list) => {
        const out: Record<string, string> = {};
        const tm = window.Strom.TreeManager as unknown as {
            createTree(name: string): string; setResearchLink(id: string, link: unknown): void;
        };
        for (const d of list) {
            const t = tm.createTree(d.name);
            tm.setResearchLink(t, { id: d.id, fingerprint: 'fp0', syncedAt: new Date().toISOString(), ...(d.copy ? { copy: true } : {}) });
            if (d.base) localStorage.setItem(`strom-research-bridge:${d.id}`, JSON.stringify({ base: d.base }));
            if (d.lastWaiting) {
                const items = Array.from({ length: d.lastWaiting }, (_, i) => ({ id: `T${i}`, what: `Dopis ${i}`, on: 'odpověď', at: new Date().toISOString() }));
                localStorage.setItem(`strom-research-waiting:${d.id}`, JSON.stringify({ items, at: new Date(Date.now() - 3 * 3_600_000).toISOString() }));
            }
            out[d.name] = t;
        }
        window.Strom.UI.updateTreeSwitcher();
        return out;
    }, defs);
}

/** Novákovi: two directions at work, one item waiting; Dvořákovi: nobody at work, three waiting; Svobodovi: not answering; a copy of the Nováks. */
async function family(page: Page): Promise<Record<string, string>> {
    await bridges(page, {
        [B_NOVAK]: { id: NOVAK, name: 'Kolín 1840–1910', answer: () => ({ working: [worker('G0001', 'Křest Josefa Nováka 1842'), worker('G0002', 'Sňatek 1903')], waiting: [item('T1')] }) },
        [B_DVORAK]: { id: DVORAK, name: 'Morava', answer: () => ({ waiting: [item('T1'), item('T2'), item('T3')] }) },
        [B_SVOBODA]: { id: SVOBODA, name: 'Svobodovi', answer: () => 'down' },
    });
    return addTrees(page, [
        { name: 'Novákovi z Kolína', id: NOVAK, base: B_NOVAK },
        { name: 'Dvořákovi (Morava)', id: DVORAK, base: B_DVORAK },
        { name: 'Novákovi z Kolína (kopie)', id: NOVAK, copy: true },
        { name: 'Svobodovi', id: SVOBODA, base: B_SVOBODA, lastWaiting: 2 },
    ]);
}

/** Every other bridge asked once (the round runs in the background). */
async function settled(page: Page, ids: string[] = [NOVAK, DVORAK, SVOBODA]): Promise<void> {
    await expect.poll(() => page.evaluate((list) => {
        const ui = window.Strom.UI as unknown as { researchAnswerOf(id: string): unknown };
        return list.every(id => !!ui.researchAnswerOf(id));
    }, ids)).toBe(true);
}

const row = (page: Page, name: string) => page.locator('#tree-switcher-dropdown .tree-switcher-item', { has: page.locator('.tree-item-name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });

test.describe('other research trees', () => {
    test('the switcher marks each tree; the closed switcher has one dot for the others', { tag: '@smoke' }, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await fastRounds(page);
        await openApp(page);
        await family(page);
        await page.locator('.tree-switcher-btn').click();
        const dropdown = page.locator('#tree-switcher-dropdown');
        await expect(dropdown).toHaveClass(/with-research/);
        const novak = row(page, 'Novákovi z Kolína');
        await expect(novak.locator('.tree-item-badges')).toHaveAttribute('aria-label', 'Research running, 2 directions at work. 1 item waiting.');
        await expect(novak.locator('.rs-mark--running')).toHaveText('2 directions');
        await expect(novak.locator('.rs-mark--waiting')).toHaveText('1 waiting');
        const dvorak = row(page, 'Dvořákovi (Morava)');
        await expect(dvorak.locator('.rs-mark--waiting')).toHaveText('3 waiting');
        await expect(dvorak.locator('.rs-mark--running')).toHaveCount(0);
        await expect(dvorak).toHaveAttribute('title', 'Research connected, nobody at work. 3 items waiting.');
        // Not answering: "not running"; what waited last only on hover (not as a count).
        const svoboda = row(page, 'Svobodovi');
        await expect(svoboda.locator('.rs-mark--off')).toHaveText('not running');
        await expect(svoboda.locator('.rs-mark--waiting')).toHaveCount(0);
        await expect(svoboda).toHaveAttribute('title', /^Research not running right now\. Last time 2 items were waiting \(3 hr\. ago\)\. Reconnects when the tree is opened from the research \(strom app in the terminal\)\.$/);
        // A copy: no tie to the bridge, no mark.
        await expect(row(page, 'Novákovi z Kolína (kopie)').locator('.tree-item-badges')).toHaveCount(0);
        await expect(dropdown.locator('[data-research-blocked]')).toBeHidden();

        // Closed: amber (something waits elsewhere), said in the button's name.
        await page.locator('.tree-switcher-btn').click();
        await expect(dropdown).not.toHaveClass(/active/);
        const dot = page.locator('.tree-switcher-btn .tree-switcher-dot');
        await expect(dot).toHaveAttribute('data-kind', 'waiting');
        const name = await page.locator('#current-tree-name').textContent();
        await expect(page.locator('.tree-switcher-btn')).toHaveAttribute('aria-label', `Tree: ${name}. 4 items waiting in another tree.`);
    });

    test('Elsewhere in the research panel: one other tree as a row that opens it', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await fastRounds(page);
        await openApp(page);
        const ids = await family(page);
        await settled(page);
        await page.evaluate((id) => window.Strom.UI.switchToTree(id), ids['Dvořákovi (Morava)']);
        await expect(page.locator('#current-tree-name')).toHaveText('Dvořákovi (Morava)');
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        const panel = page.locator('#live-panel.idle');
        await expect(panel).toBeVisible();
        // Its own bridge answers, nobody works: edits go by the Send button (a new tie's default).
        await expect(panel.locator('.live-panel-state')).toHaveText('Research connected, nobody at work right now. Edits go to it when Send is clicked.');
        const strip = panel.locator('.rs-elsewhere');
        await expect(strip.locator('.rs-elsewhere__row')).toHaveCount(1);
        const other = strip.locator('.rs-elsewhere__row');
        await expect(other.locator('.rs-elsewhere__label')).toHaveText('Elsewhere');
        await expect(other.locator('.rs-elsewhere__name')).toHaveText('Novákovi z Kolína');
        await expect(other.locator('.rs-marks')).toHaveText('2 directions1 waiting');
        await expect(other).toHaveAttribute('aria-label', 'Also running in another tree: Novákovi z Kolína, 2 directions, 1 waiting. Selecting it switches there.');
        // Not running and the copy are not named.
        await expect(strip).not.toContainText('Svobodovi');
        // The closed switcher: something waits elsewhere (the Nováks).
        await expect(page.locator('.tree-switcher-btn .tree-switcher-dot')).toHaveAttribute('data-kind', 'waiting');
        await other.click();
        await expect(page.locator('#current-tree-name')).toHaveText('Novákovi z Kolína');
    });

    test('a tree whose bridge does not answer: its panel says it is not running; two other trees as a summary that unfolds', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await fastRounds(page);
        await openApp(page);
        const ids = await family(page);
        await settled(page);
        await page.evaluate((id) => window.Strom.UI.switchToTree(id), ids['Svobodovi']);
        await expect(page.locator('#current-tree-name')).toHaveText('Svobodovi');
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        const panel = page.locator('#live-panel.idle');
        await expect(panel).toHaveClass(/is-off/);
        await expect(panel.locator('.live-panel-state')).toHaveText('Research not running right now. The tree can be edited; edits are sent once the research reconnects.');
        await expect(panel.locator('.rs-off-hint')).toContainText('Last time 2 items were waiting');
        await expect(panel.locator('.rs-off-hint code')).toHaveText('strom app');
        await expect(panel.locator('.live-panel-heading-waiting')).toHaveCount(0);
        // Two other trees: "Other trees: 2", folded; waiting first, then by name.
        const sum = panel.locator('.rs-elsewhere__sum');
        await expect(sum).toContainText('Other trees: 2');
        await expect(sum).toHaveAttribute('aria-expanded', 'false');
        await expect(sum.locator('.rs-dot')).toHaveClass(/rs-dot--waiting/);
        await expect(panel.locator('.rs-elsewhere__rows')).toBeHidden();
        await sum.click();
        await expect(sum).toHaveAttribute('aria-expanded', 'true');
        await expect(panel.locator('.rs-elsewhere__rows .rs-elsewhere__name')).toHaveText(['Dvořákovi (Morava)', 'Novákovi z Kolína']);
        expect(await page.evaluate(() => localStorage.getItem('strom-other-trees-open'))).toBe('1');
        await panel.locator('.rs-elsewhere__rows .rs-elsewhere__row').first().click();
        await expect(page.locator('#current-tree-name')).toHaveText('Dvořákovi (Morava)');
    });

    test('phone width: the sheet "Trees" has the marks on a second line, not running with how it reconnects', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await fastRounds(page);
        await openApp(page);
        await family(page);
        // Marks known before the sheet is opened (asked in the background).
        await expect.poll(() => page.evaluate(() => {
            const ui = window.Strom.UI as unknown as { researchElsewhere(): unknown[] };
            return ui.researchElsewhere().length;
        })).toBe(2);
        await page.locator('.tree-switcher-btn').click();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        const sheetRow = (name: string) => sheet.locator('.bottom-sheet-item[data-tree-id]', { hasText: name });
        await expect(sheetRow('Dvořákovi').locator('.rs-marks--sheet')).toHaveText('3 waiting');
        await expect(sheetRow('Svobodovi').locator('.rs-marks--sheet')).toHaveText('not running · reconnect: strom app');
        await expect(sheetRow('Novákovi z Kolína').first().locator('.rs-marks--sheet')).toHaveAttribute('aria-label', 'Research running, 2 directions at work. 1 item waiting.');
        await expect(sheet.locator('.bottom-sheet-item[data-tree-id]', { hasText: 'kopie' }).locator('.rs-mark')).toHaveCount(0);
        const box = await sheetRow('Svobodovi').boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(52);
        await expect(sheet.locator('#tree-sheet-research-blocked')).toBeHidden();
        await sheetRow('Dvořákovi').click();
        await expect(page.locator('#current-tree-name')).toHaveText('Dvořákovi (Morava)');
    });

    test('the browser keeps the page from the research programs: no marks, no dot, one sentence at the foot', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await fastRounds(page, { denied: true });
        await openApp(page);
        await addTrees(page, [
            { name: 'Novákovi z Kolína', id: NOVAK, base: B_NOVAK },
            { name: 'Dvořákovi (Morava)', id: DVORAK, base: B_DVORAK },
        ]);
        // Every address refused by the browser itself (a TypeError, the permission denied).
        for (const base of [B_NOVAK, B_DVORAK]) await page.route(`${base}/**`, route => route.abort('failed'));
        await page.locator('.tree-switcher-btn').click();
        const dropdown = page.locator('#tree-switcher-dropdown');
        const blocked = dropdown.locator('[data-research-blocked]');
        await expect(blocked).toBeVisible();
        await expect(blocked).toContainText('Research status not visible: the browser has not allowed access to programs on this computer.');
        await expect(blocked.locator('button')).toHaveText('How to allow ↗');
        await expect(dropdown.locator('.tree-item-badges')).toHaveCount(0);
        await expect(dropdown.locator('.rs-mark--off')).toHaveCount(0);
        // Above "Manage trees…".
        const order = await dropdown.evaluate((d) => [...d.children].map(c => c.className));
        expect(order.indexOf('tree-switcher-blocked')).toBe(order.indexOf('tree-switcher-divider') - 1);
        await page.locator('.tree-switcher-btn').click();
        await expect(page.locator('.tree-switcher-btn .tree-switcher-dot')).toHaveCount(0);
        // "How to allow ↗": today's hint on the browser's permission.
        await page.locator('.tree-switcher-btn').click();
        await blocked.locator('button').click();
        await expect(page.locator('#research-connect-failed')).toBeVisible();
    });

    test('followed live: the live mark, "Other trees" under the head, the folded panel\'s chip, the overview\'s Now', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await fastRounds(page);
        await page.addInitScript((links) => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        }, LINKS);
        const GED = [
            '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${HORAK}`, '1 CHAR UTF-8', '1 NOTE Horákovi',
            '0 @P0001@ INDI', '1 NAME Josef /Horák/', '1 SEX M', '1 REFN P0001',
            '0 TRLR',
        ].join('\n');
        const live = () => status(HORAK, 'Horákovi', { working: [worker('G0001', 'Křest'), worker('G0002', 'Sňatek')] });
        await page.route(`${B_HORAK}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(live()) });
            if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
            if (path.endsWith('/events')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(live())}\n\n` });
            return route.fulfill({ status: 404, headers: cors, body: '' });
        });
        await page.goto(`/strom.html?live=${encodeURIComponent(B_HORAK)}`);
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        await family(page);
        // The open tree followed live: "live · 2 directions".
        await page.locator('.tree-switcher-btn').click();
        await expect(row(page, 'Horákovi').locator('.rs-mark--live .rs-full')).toHaveText('live · 2 directions');
        await expect(row(page, 'Horákovi').locator('.tree-item-badges')).toHaveAttribute('aria-label', 'Research followed live. 2 directions at work.');
        await page.locator('.tree-switcher-btn').click();
        // Under the head: "Other trees: 2".
        await expect(panel.locator('.rs-elsewhere__sum')).toContainText('Other trees: 2');
        // Folded: one chip "+2 trees" that unfolds the panel with the trees shown.
        await panel.locator('.live-panel-toggle').click();
        await expect(panel).toHaveClass(/collapsed/);
        const chip = panel.locator('.live-panel-head .rs-elsewhere-chip');
        await expect(chip).toHaveText('+2 trees');
        await chip.click();
        await expect(panel).not.toHaveClass(/collapsed/);
        await expect(panel.locator('.rs-elsewhere__rows')).toBeVisible();
        // The overview: the same first in Now.
        await panel.locator('.live-panel-expand').click();
        const overview = page.locator('#research-overview');
        await expect(overview.locator('.rs-elsewhere--overview .rs-elsewhere__sum')).toContainText('Other trees: 2');
    });

    // A long followed name and another tree waiting: folded, the chip and the buttons stay inside the panel.
    for (const [lang, width, chipText] of [['cs', 1024, '+1 strom'], ['de', 1440, '+1 Stammbaum'], ['en', 1024, '+1 tree']] as const) {
        test(`folded with a long name (${lang} ${width}): the chip and the buttons stay inside the panel`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await fastRounds(page);
            await page.addInitScript((links) => {
                if (sessionStorage.getItem('seeded')) return;
                sessionStorage.setItem('seeded', '1');
                localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
            }, LINKS);
            const NAME = 'Novákovi a Svobodovi z Kolína';
            const GED = [
                '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${HORAK}`, '1 CHAR UTF-8', `1 NOTE ${NAME}`,
                '0 @P0001@ INDI', '1 NAME Josef /Horák/', '1 SEX M', '1 REFN P0001',
                '0 TRLR',
            ].join('\n');
            const live = () => status(HORAK, NAME, { working: [worker('G0001', 'Křest')] });
            await page.route(`${B_HORAK}/**`, async (route) => {
                const path = new URL(route.request().url()).pathname;
                if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(live()) });
                if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
                if (path.endsWith('/events')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(live())}\n\n` });
                return route.fulfill({ status: 404, headers: cors, body: '' });
            });
            await page.goto(`/strom.html?live=${encodeURIComponent(B_HORAK)}`);
            const panel = page.locator('#live-panel');
            await expect(panel).toBeVisible();
            await bridges(page, { [B_DVORAK]: { id: DVORAK, name: 'Morava', answer: () => ({ waiting: [item('T1')] }) } });
            await addTrees(page, [{ name: 'Dvořákovi (Morava)', id: DVORAK, base: B_DVORAK }]);
            await settled(page, [DVORAK]);
            await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
            await panel.locator('.live-panel-toggle').click();
            await expect(panel).toHaveClass(/collapsed/);
            const chip = panel.locator('.live-panel-head .rs-elsewhere-chip');
            await expect(chip).toHaveText(chipText);
            const box = (await panel.boundingBox())!;
            for (const part of [chip, panel.locator('.live-follow-btn'), panel.locator('.live-panel-expand'), panel.locator('.live-panel-action')]) {
                const b = (await part.boundingBox())!;
                expect(b.x).toBeGreaterThanOrEqual(box.x);
                expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
            }
        });
    }
});

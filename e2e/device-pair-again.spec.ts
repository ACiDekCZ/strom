import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';

/**
 * A device paired again through the fake gateway (spec 094 U11), the research
 * with two trees: a tree held here already opens as it is (never downloaded
 * again, no question hidden under the start screen — it stood on "Opening the
 * research…" for good); the tree the pairing's answer names (`tree`, the
 * window that made the code) opens; a new code naming none, with two trees,
 * asks the chooser (an earlier choice never outweighs a new code). "Opening…"
 * with nothing to be seen for a minute says so with Try again and Cancel.
 * Invented data only (the Pýchavkovi of Mlýnky, the Hrotkovi of Hrotov, the
 * computer Pracovna). `STROM_SHOTS_DIR` set: screenshots go there.
 */

const PYCH = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const HROT = '7b2e3d4f-5c6a-4b7c-9d8e-0f1a2b3c4d5e';
const NAMES: Record<string, string> = { [PYCH]: 'Pýchavkovi z Mlýnků', [HROT]: 'Hrotkovi z Hrotova' };
const SURNAME: Record<string, string> = { [PYCH]: 'Pýchavka', [HROT]: 'Hrotek' };
const HEAD = '3c7a9e1f05b2';

function ged(tree: string): string {
    const s = SURNAME[tree];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 25 NOV 2026', `1 _STROM_TREE ${tree}`, `1 _STROM_HEAD ${HEAD}`,
        '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8',
        '0 @P0001@ INDI', `1 NAME Jan /${s}/`, '1 SEX M', '1 BIRT', '2 DATE 1851', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Marie /Bedlová/', '1 SEX F', '1 BIRT', '2 DATE 1855', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0003@ INDI', `1 NAME Josef /${s}/`, '1 SEX M', '1 BIRT', '2 DATE 1880', '1 REFN P0003', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 TRLR',
    ].join('\n');
}

/** The research behind the gateway: its trees, each tree.ged asked counted by tree; `hold`: the next tree.ged waits for it. */
function research(gw: FakeGateway, trees: string[], o: { hold?: Promise<void> } = {}): Record<string, number> {
    gw.trees = trees.map(id => ({ id, name: NAMES[id], archive: false }));
    gw.computer = { name: '127.0.0.1', label: 'Pracovna' };
    const asked: Record<string, number> = {};
    let hold = o.hold;
    gw.onTunnel = async (req, device): Promise<TunnelReply | undefined> => {
        const tree = String(req.tree ?? '');
        if (req.p === 'status') {
            return {
                s: 200,
                body: {
                    ok: true, features: ['device.gateway', 'ged.stale', 'ged.etag'],
                    tree: { id: tree, name: NAMES[tree] }, head: HEAD,
                    persons: 3, working: [], waiting: [], queue: [], links: [],
                    accepts: { mode: 'research', sync: { auto: 'off' } },
                    device: { id: device.id, name: device.name, kind: device.kind, actions: ['device.rename', 'device.unpair'] },
                },
            };
        }
        if (req.p === 'tree.ged') {
            asked[tree] = (asked[tree] ?? 0) + 1;
            if (hold) {
                const h = hold;
                hold = undefined;
                await h;
            }
            return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: ged(tree) };
        }
        return undefined;
    };
    return asked;
}

async function seeds(page: Page): Promise<void> {
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await page.addInitScript(() => {
        try {
            localStorage.setItem('strom-tour-offered', '1');
            localStorage.setItem('strom-device-home-line', 'hidden');
        } catch { /* none */ }
    });
}

async function shot(page: Page, name: string): Promise<void> {
    const dir = process.env.STROM_SHOTS_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${name}.png`) });
}

const boot = (page: Page) => page.locator('#device-boot');
const treeName = (page: Page) => page.locator('#current-tree-name');

/** The tree open, the start screen gone, no question left anywhere (none hidden under the start screen). */
async function expectOpen(page: Page, tree: string): Promise<void> {
    await expect(page.locator('.person-card', { hasText: `Josef ${SURNAME[tree]}` }).first()).toBeVisible({ timeout: 20000 });
    await expect(boot(page)).toHaveCount(0);
    await expect(treeName(page)).toHaveText(NAMES[tree]);
    await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
}

/** The device paired the first time with both trees: the chooser, the Pýchavkovi chosen, opened. */
async function holdPychavkovi(page: Page): Promise<void> {
    await page.goto(gw.pairCode().url);
    await expect(boot(page)).toHaveAttribute('data-state', 'trees', { timeout: 20000 });
    await boot(page).locator('.device-tree-row', { hasText: NAMES[PYCH] }).click();
    await expectOpen(page, PYCH);
}

let gw: FakeGateway;
test.beforeEach(async () => {
    gw = await startDeviceGateway();
});
test.afterEach(async () => {
    await gw.close();
});

test.describe('en', () => {
    test.use({ locale: 'en-US' });

    test('paired again, the tree held here opens as it is: never downloaded again, no question hidden under the start screen', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        const asked = research(gw, [PYCH]);
        await page.goto(gw.pairCode().url);
        await expectOpen(page, PYCH);
        expect(asked[PYCH]).toBe(1);
        // A new code (the computer's QR code again): the same tree, held here.
        await page.goto(gw.pairCode().url);
        await expectOpen(page, PYCH);
        expect(asked[PYCH], 'the tree held here downloaded again').toBe(1);
    });

    test('the pairing names the tree of the window that made the code: that tree opens, not the one chosen before', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        const asked = research(gw, [PYCH, HROT]);
        await holdPychavkovi(page);
        await page.goto(gw.pairCode(undefined, HROT).url);
        await expectOpen(page, HROT);
        expect(asked).toEqual({ [PYCH]: 1, [HROT]: 1 });
        const p = await page.evaluate(() => (window as unknown as { __stromDevice: { pairing(): Promise<{ treeId: string | null }> } }).__stromDevice.pairing());
        expect(p.treeId).toBe(HROT);
        expect(await page.evaluate(() => localStorage.getItem('strom-device-tree'))).toBe(HROT);
        // Opened again (no code): the tree the pairing named.
        await page.reload();
        await expectOpen(page, HROT);
    });

    test('a new code naming no tree, two trees: the chooser, never the earlier choice; the held tree chosen opens as it is', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        const asked = research(gw, [PYCH, HROT]);
        await holdPychavkovi(page);
        await page.goto(gw.pairCode().url);
        await expect(boot(page)).toHaveAttribute('data-state', 'trees', { timeout: 20000 });
        await expect(boot(page).locator('.device-tree-row')).toHaveCount(2);
        // A question asked while the start screen stands is over it, never under it.
        const over = await page.evaluate(() => {
            const m = document.getElementById('confirmation-modal');
            m?.classList.add('active');
            const btn = m?.querySelector('button');
            const r = btn?.getBoundingClientRect();
            const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
            m?.classList.remove('active');
            return !!btn && !!hit && !hit.closest('#device-boot') && !!hit.closest('#confirmation-modal');
        });
        expect(over, 'a dialog over the start screen').toBe(true);
        await shot(page, 'pair-again-chooser-390');
        await boot(page).locator('.device-tree-row', { hasText: NAMES[PYCH] }).click();
        await expectOpen(page, PYCH);
        expect(asked).toEqual({ [PYCH]: 1 });
    });

    test('"Opening…" with nothing to be seen for a minute says so: Try again opens the tree, Cancel goes to the chooser', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        await page.clock.install();
        const asked = research(gw, [PYCH], { hold: new Promise<void>(() => undefined) });
        await page.goto(gw.pairCode().url);
        const load = page.locator('.toast[data-kind="tree-load"]');
        await expect(load).toBeVisible({ timeout: 20000 });
        // The download's progress lost from sight (a hang with nothing shown): "Opening…" alone stands.
        await load.evaluate(el => el.remove());
        await expect(boot(page)).toHaveAttribute('data-state', 'opening');
        await page.clock.fastForward(2_000);
        await page.clock.fastForward(30_000);
        await expect(boot(page)).toHaveAttribute('data-state', 'opening');
        await page.clock.fastForward(31_000);
        await expect(boot(page)).toHaveAttribute('data-state', 'openStuck');
        await expect(boot(page)).toContainText('The research is not opening.');
        await expect(boot(page).getByRole('button', { name: 'Cancel' })).toBeVisible();
        await shot(page, 'open-stuck-390');
        await boot(page).getByRole('button', { name: 'Try again' }).click();
        await expectOpen(page, PYCH);
        expect(asked[PYCH]).toBe(2);
    });

    test('"Opening…" too long: Cancel goes to the chooser of the research\'s trees', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        await page.clock.install();
        research(gw, [PYCH], { hold: new Promise<void>(() => undefined) });
        await page.goto(gw.pairCode().url);
        const load = page.locator('.toast[data-kind="tree-load"]');
        await expect(load).toBeVisible({ timeout: 20000 });
        await load.evaluate(el => el.remove());
        await page.clock.fastForward(2_000);
        await page.clock.fastForward(61_000);
        await expect(boot(page)).toHaveAttribute('data-state', 'openStuck');
        await boot(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(boot(page)).toHaveAttribute('data-state', 'trees');
        await expect(page.locator('.toast[data-kind="tree-load"]')).toHaveCount(0);
        await boot(page).locator('.device-tree-row').first().click();
        await expectOpen(page, PYCH);
    });
});

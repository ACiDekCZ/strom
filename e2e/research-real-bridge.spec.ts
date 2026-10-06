import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './helpers.js';

/**
 * A hand-over against a real research bridge, not a mock: a research
 * release installed by its own install.sh into a folder of its own (own HOME,
 * config and installation, STROM_ISOLATED), waiting for the app's tree, its
 * bridge started — by the research's script (STROM_E2E_ADOPT_BRIDGE,
 * `adopt-bridge.sh <release folder> <token>`, one line of JSON out).
 *
 * STROM_E2E_RELEASES: the release folders (install.sh, strom-app.tar.gz…),
 * separated by the path delimiter. Not set (CI): skipped. What each bridge
 * says in /status.features decides what is expected: `adopt.empty` takes a
 * tree with nobody in it, an older one is told cancelled (C1). Invented data.
 */

const SCRIPT = process.env.STROM_E2E_ADOPT_BRIDGE ?? '';
const RELEASES = (process.env.STROM_E2E_RELEASES ?? '').split(path.delimiter).filter(Boolean);

interface Research { version: string; url: string; root: string; dir: string; stop: string }

/** A research of `release` waiting for the app's tree with `token`, its bridge running. */
function waitingResearch(release: string, token: string): Research {
    const out = execFileSync('sh', [SCRIPT, release, token, 'Empty test'], { encoding: 'utf8', timeout: 170_000 });
    return JSON.parse(out.trim().split('\n').pop()!) as Research;
}

test.describe('a hand-over against a real research bridge', () => {
    // Nothing given (CI): one skipped test, so a run of this file alone still finds a test.
    if (!SCRIPT || RELEASES.length === 0) {
        test('C1: installed from the welcome screen, against real bridges', () => {
            test.skip(true, 'STROM_E2E_ADOPT_BRIDGE / STROM_E2E_RELEASES not set');
        });
        return;
    }

    for (const release of RELEASES) {
        test(`C1: installed from the welcome screen (no tree yet), by what the bridge says (${path.basename(release)})`, async ({ page }) => {
            test.setTimeout(240_000);
            await page.setViewportSize({ width: 1280, height: 900 });
            await openApp(page);
            await expect(page.locator('#empty-state')).toBeVisible();
            const token = 'R'.repeat(43);
            // The installation's record, as the Install step leaves it on the welcome screen (no tree).
            await page.evaluate((t) => {
                const now = Date.now();
                localStorage.setItem('strom-install', JSON.stringify({ token: t, treeId: null, os: 'mac',
                    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 24 * 3600 * 1000).toISOString() }));
            }, token);
            const research = waitingResearch(release, token);
            try {
                const status = await (await fetch(`${research.url}/status`)).json() as { features?: string[] };
                const takesEmpty = !!status.features?.includes('adopt.empty');
                await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: b })), research.url);
                if (takesEmpty) {
                    // Handed over as it is: the research stays empty, linked to the new tree; "ready" says so.
                    await page.locator('#research-adopt-confirm').click();
                    await expect(page.locator('#research-ready-modal')).toContainText('The tree is empty for now');
                    const linked = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.id ?? null);
                    const after = await (await fetch(`${research.url}/status`)).json() as { tree?: { id?: string }; persons?: number };
                    expect(linked).toBe(after.tree?.id);
                    expect(after.persons ?? 0).toBe(0);
                } else {
                    // An older research: not offered, told cancelled, said how it starts; the installation is over.
                    await expect(page.getByText('The research is installed. The tree has nobody in it yet')).toBeVisible();
                    await expect(page.locator('#research-adopt-modal')).toHaveCount(0);
                    expect(await page.evaluate(() => localStorage.getItem('strom-install'))).toBeNull();
                    // The research was told: nothing comes (its waiting terminal ends on it).
                    const told = (): string | null => {
                        const dir = path.join(research.root, '.strom', 'sync');
                        const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^nothing-\d+\.json$/.test(n)).sort().pop() : undefined;
                        return f ? (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { reason: string }).reason : null;
                    };
                    await expect.poll(told).toBe('cancelled');
                }
            } finally {
                try { execFileSync('sh', ['-c', research.stop], { timeout: 30_000 }); } catch { /* ends by itself */ }
                fs.rmSync(research.dir, { recursive: true, force: true });
            }
        });
    }
});

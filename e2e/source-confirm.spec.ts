import { test, expect, Page } from '@playwright/test';
import { acceptLoad, BRIDGE, dropFile, fakeBridge, openResearch, poll, researchGed, FakeBridge, FakeSourcesConfirm } from './research-bridge.js';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';

/**
 * Confirming the research's transcript in the source viewer (spec 022 U3):
 * "Confirm transcription" at the end of the "read by" line of a source the
 * research read (`_STROM_READ research` + `_TXT`), "Undo confirmation" on a
 * confirmed one (`both` + `_CONF`) — only while the bridge says
 * `sources.confirm`. The click sends `POST /sources/confirm {source, txt,
 * confirm}` and the line says the answer at once; the research's next file
 * brings the same. A wording changed meanwhile (409 `confirm.changed`) is
 * said under the line and nothing is sent again. Opening the viewer sends
 * nothing (K1.6). Following the research (`?live=`, the tree locked
 * meanwhile) offers it the same: it goes to the research, the tree in the
 * app is not changed. Invented people only (the bridge's own fixture).
 */

const TXT = '0a1b2c3d4e5f6a7b';
const NEW_TXT = 'f0e1d2c3b4a59687';

function ged(read: string, conf?: string, txt = TXT): string {
    return researchGed().replace('1 _STROM_READ research',
        [`1 _STROM_READ ${read}`, ...(conf ? [`2 _CONF ${conf}`] : []), `2 _TXT ${txt}`].join('\n'));
}

async function setup(page: Page, opts: { features?: string[]; read?: string; conf?: string; research?: FakeSourcesConfirm['sources'][string]; reply?: FakeSourcesConfirm['reply'] } = {}): Promise<FakeBridge> {
    const read = opts.read ?? 'research';
    const file = ged(read, opts.conf);
    const bridge = await fakeBridge(page, {
        features: opts.features ?? ['sources.confirm'],
        treeGed: file,
        sourcesConfirm: { writes: [], sources: { S0001: opts.research ?? { read, ...(opts.conf ? { conf: opts.conf } : {}), txt: TXT } }, ...(opts.reply ? { reply: opts.reply } : {}) },
    });
    await openResearch(page, { ged: file });
    await poll(page);
    return bridge;
}

async function view(page: Page): Promise<void> {
    const id = await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().sources).find((s: any) => s.refn === 'S0001') as any).id);
    await page.evaluate((id) => window.Strom.UI.showSourceViewer(id, null), id);
    await expect(page.locator('#source-viewer-modal')).toBeVisible();
}

/** The research's file taken in again (the viewer closed first, as a person would). */
async function takeFile(page: Page, file: string): Promise<void> {
    if (await page.locator('#source-viewer-modal').isVisible()) {
        await page.locator('#source-viewer-modal').locator('.close-btn').click();
        await expect(page.locator('#source-viewer-modal')).toBeHidden();
    }
    await dropFile(page, 'tree-strom.ged', file);
    // "Nothing here will be overwritten": the app wrote nothing of its own into the tree.
    await expect(page.locator('#research-load-modal')).toContainText('Nothing here will be overwritten.');
    await acceptLoad(page);
    await expect(page.locator('#research-load-modal')).toBeHidden();
}

/** The research followed from its bridge (`?live=`): the tree in the app locked meanwhile. */
async function follow(page: Page, read: string, conf?: string): Promise<FakeBridge> {
    const file = ged(read, conf);
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
    const bridge = await fakeBridge(page, {
        features: ['sources.confirm'],
        treeGed: file,
        sourcesConfirm: { writes: [], sources: { S0001: { read, ...(conf ? { conf } : {}), txt: TXT } } },
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect.poll(() => page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources ?? {}).some((s: any) => s.refn === 'S0001'))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.Strom.DataManager.isLiveFollowing() && window.Strom.DataManager.isTreeLocked())).toBe(true);
    return bridge;
}

const line = (page: Page) => page.locator('#source-viewer-modal .viewer-read-by');
const button = (page: Page) => page.locator('#source-viewer-confirm');
const note = (page: Page) => page.locator('#source-viewer-confirm-note');
const posts = (bridge: FakeBridge) => (bridge.seen ?? []).filter(s => s === 'POST /sources/confirm');
const source = (page: Page) => page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources).find((s: any) => s.refn === 'S0001') as any);

test.describe('Confirming the research\'s transcript in the source viewer', () => {
    test('confirm: the exact body, the line says it at once, the research\'s next file brings the same', async ({ page }) => {
        const bridge = await setup(page);
        await view(page);
        await expect(line(page)).toHaveText('Transcription read by the research');
        await expect(button(page)).toHaveText('Confirm transcription');
        await expect(button(page)).toHaveAttribute('title', 'The transcription matches the record. It will also count as read in the app.');
        // No mark: the action stays in the app and goes through the bridge.
        await expect(button(page).locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        // Opening the viewer sends nothing (K1.6).
        expect(posts(bridge)).toEqual([]);

        await button(page).click();
        await expect.poll(() => bridge.sourcesConfirm!.writes).toEqual([{ source: 'S0001', txt: TXT, confirm: true }]);
        await expect(line(page)).toHaveText('Transcription read by the research and confirmed in the app on 6 Nov 2026');
        await expect(button(page)).toHaveText('Undo confirmation');
        await expect(note(page)).toHaveCount(0);
        // Nothing written into the tree by the app: the research's file brings it (and the tree has no changes of its own).
        expect((await source(page)).readConfirmed).toBeUndefined();
        expect(await page.evaluate(() => {
            const ctx = window.Strom.UI.researchSyncLink()!;
            return window.Strom.UI.researchSyncFingerprints(ctx.treeId, ctx.link).matchesBase;
        })).toBe(true);

        await poll(page);
        await takeFile(page, bridge.treeGed);
        await expect.poll(async () => (await source(page)).readConfirmed).toBe('2026-11-06');
        expect((await source(page)).readBy).toBe('both');
        expect((await source(page)).readMark).toBe(TXT);
        await view(page);
        await expect(line(page)).toHaveText('Transcription read by the research and confirmed in the app on 6 Nov 2026');
        await expect(button(page)).toHaveText('Undo confirmation');
        expect(posts(bridge)).toHaveLength(1);
    });

    test('undo: the confirmation taken back with one click, no dialog', async ({ page }) => {
        const bridge = await setup(page, { read: 'both', conf: '2026-11-02' });
        await view(page);
        await expect(line(page)).toHaveText('Transcription read by the research and confirmed in the app on 2 Nov 2026');
        await expect(button(page)).toHaveText('Undo confirmation');
        await button(page).click();
        await expect.poll(() => bridge.sourcesConfirm!.writes).toEqual([{ source: 'S0001', txt: TXT, confirm: false }]);
        await expect(line(page)).toHaveText('Transcription read by the research');
        await expect(button(page)).toHaveText('Confirm transcription');
    });

    test('the wording changed meanwhile: said under the line, nothing sent again, the new wording offered once it arrives', async ({ page }) => {
        const bridge = await setup(page, { research: { read: 'research', txt: NEW_TXT } });
        await view(page);
        await button(page).click();
        await expect(note(page)).toHaveText('The transcription changed in the research meanwhile. The new wording can be confirmed once it arrives.');
        await expect(button(page)).toHaveCount(0);
        await expect(line(page)).toHaveText('Transcription read by the research');
        // The bridge coming again redraws the line: still no button, nothing sent.
        await poll(page);
        await expect(button(page)).toHaveCount(0);
        expect(bridge.sourcesConfirm!.writes).toHaveLength(1);

        // The research's file with the new wording: the action is back for it.
        bridge.treeGed = ged('research', undefined, NEW_TXT).replace('1 TEXT Josef Fíšek a Anna', '1 TEXT Josef Fíšek a Anna z Čapkova');
        await takeFile(page, bridge.treeGed);
        await expect.poll(async () => (await source(page)).readMark).toBe(NEW_TXT);
        await view(page);
        await expect(note(page)).toHaveCount(0);
        await button(page).click();
        await expect.poll(() => bridge.sourcesConfirm!.writes.at(-1)).toEqual({ source: 'S0001', txt: NEW_TXT, confirm: true });
        await expect(line(page)).toContainText('confirmed in the app on 6 Nov 2026');
    });

    test('busy: said under the line, the action stays', async ({ page }) => {
        const bridge = await setup(page, { reply: { status: 503, body: { error: 'Busy.', code: 'research.busy', text: 'Busy.' } } });
        await view(page);
        await button(page).click();
        await expect(note(page)).toHaveText('The research is busy. It will work again shortly.');
        await expect(button(page)).toBeEnabled();
        expect(bridge.sourcesConfirm!.writes).toHaveLength(1);
        await expect(line(page)).toHaveText('Transcription read by the research');
    });

    test('the bridge not running: the action at rest with its sentence, back when it runs', async ({ page }) => {
        const bridge = await setup(page);
        await view(page);
        await expect(button(page)).toBeVisible();
        bridge.down = true;
        await poll(page);
        await expect(button(page)).toHaveCount(0);
        await expect(note(page)).toHaveText('Confirming is possible while the research is running.');
        await expect(line(page)).toHaveText('Transcription read by the research');
        bridge.down = false;
        await poll(page);
        await expect(button(page)).toHaveText('Confirm transcription');
        await expect(note(page)).toHaveCount(0);
    });

    test('an older research (no sources.confirm), the user\'s own reading, no mark of the wording: no action', async ({ page }) => {
        const bridge = await setup(page, { features: ['hypotheses.decide'] });
        await view(page);
        await expect(line(page)).toHaveText('Transcription read by the research');
        await expect(button(page)).toHaveCount(0);
        await expect(note(page)).toHaveCount(0);
        expect(posts(bridge)).toEqual([]);

        // `both` without _CONF (read another way) and `user`: as before, nothing to confirm or undo.
        bridge.features = ['sources.confirm'];
        for (const [file, expected, text] of [
            [ged('both'), `both|${TXT}`, 'Transcription read in the app and by the research'],
            [ged('user'), `user|${TXT}`, 'Transcription read in the app'],
            [researchGed(), 'research|', 'Transcription read by the research'],
        ]) {
            bridge.treeGed = file;
            await takeFile(page, file);
            await expect.poll(async () => { const s = await source(page); return `${s.readBy}|${s.readMark ?? ''}`; }).toBe(expected);
            await poll(page);
            await view(page);
            await expect(line(page)).toHaveText(text);
            await expect(button(page)).toHaveCount(0);
        }
        expect(posts(bridge)).toEqual([]);
    });

    test('following the research (?live=, the tree locked): confirm and undo offered and sent, the tree not changed by the app', async ({ page }) => {
        const bridge = await follow(page, 'research');
        await view(page);
        await expect(line(page)).toHaveText('Transcription read by the research');
        await expect(button(page)).toHaveText('Confirm transcription');
        expect(posts(bridge)).toEqual([]);
        await button(page).click();
        await expect.poll(() => bridge.sourcesConfirm!.writes).toEqual([{ source: 'S0001', txt: TXT, confirm: true }]);
        await expect(line(page)).toHaveText('Transcription read by the research and confirmed in the app on 6 Nov 2026');
        await expect(note(page)).toHaveCount(0);
        // Still following, the tree as the research's file has it.
        expect(await page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(true);
        expect((await source(page)).readConfirmed).toBeUndefined();

        // "Undo confirmation" the same way.
        await expect(button(page)).toHaveText('Undo confirmation');
        await button(page).click();
        await expect.poll(() => bridge.sourcesConfirm!.writes.at(-1)).toEqual({ source: 'S0001', txt: TXT, confirm: false });
        await expect(line(page)).toHaveText('Transcription read by the research');
        await expect(button(page)).toHaveText('Confirm transcription');
    });

    test('following the research: a confirmed transcription offers its undo', async ({ page }) => {
        const bridge = await follow(page, 'both', '2026-11-02');
        await view(page);
        await expect(line(page)).toHaveText('Transcription read by the research and confirmed in the app on 2 Nov 2026');
        await button(page).click();
        await expect.poll(() => bridge.sourcesConfirm!.writes).toEqual([{ source: 'S0001', txt: TXT, confirm: false }]);
        await expect(line(page)).toHaveText('Transcription read by the research');
    });
});

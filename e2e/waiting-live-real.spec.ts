import { test, expect, type Page, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { openApp } from './helpers.js';

/**
 * Waiting for images and the answer from the app against a real research
 * bridge, not a mock (spec 048 U6: K1.3, K2.1, K2.2, point 8): a task waiting
 * for images 57–58 of a book of an archive, another one waiting for image 63
 * of the same book (one item gets no heading) and a task waiting for a
 * website without a book, in a research of a sandbox of its own.
 *
 * - the archive's place: its name, its website, the images it misses;
 * - the images' state ("images 57–58", none in the book's frame); a file
 *   numbered 60 while the app's status is behind the research's is refused by
 *   the bridge (409 image-unwanted), the numbers it asks for said; 57 sent → "1 of 2", 58 sent → the task woken, the item gone; the
 *   research has both images handed to the task by the app;
 * - the website's task answered in the overview → gone; the research keeps
 *   the answer as given in the app (`givenIn: "app"`).
 *
 * STROM_E2E_WAITING: a JSON file `{ url, images, other, web, show, touch }` —
 * the bridge's secret address, the three task IDs, a shell command that prints
 * `strom task show <id> --json` of the sandbox's research (`{task}` stands for
 * the ID) and one that adds a place to it (`{place}`: a commit, so the bridge
 * says something changed and the app asks for the status). Each run needs a fresh sandbox (the tasks are used up). Not set
 * (CI): skipped. Invented data only.
 */

interface WaitingBridge { url: string; images: string; other: string; web: string; show: string; touch: string }

const FILE = process.env.STROM_E2E_WAITING ?? '';
const BRIDGE: WaitingBridge | null = FILE ? JSON.parse(fs.readFileSync(FILE, 'utf8')) as WaitingBridge : null;

interface ShownTask {
    task: { state: string; answers?: Array<{ by: string; answer?: string; givenIn?: string }>; files?: Array<{ by?: string }> };
}

function show(bridge: WaitingBridge, id: string): ShownTask {
    const out = execFileSync('zsh', ['-c', bridge.show.replace('{task}', id)], { encoding: 'utf8', timeout: 60_000 });
    return JSON.parse(out) as ShownTask;
}

/** A commit in the research that has nothing to do with what waits: the app hears a change and asks for the status. */
function touch(bridge: WaitingBridge, place: string): void {
    execFileSync('zsh', ['-c', bridge.touch.replace('{place}', `'${place}'`)], { encoding: 'utf8', timeout: 60_000 });
}

/** A small JPEG of its own content (another sha256 for each label), drawn by the browser. */
async function jpeg(page: Page, name: string, label: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
    const b64 = await page.evaluate((text) => {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 200;
        const g = c.getContext('2d')!;
        g.fillStyle = '#f4efe2';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#3a2f1c';
        g.font = '28px serif';
        g.fillText(text, 20, 100);
        return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    }, label);
    return { name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

/**
 * A status (full, light or its waiting part) as an older research would have
 * said it: task `id` asks for image `n` too. The light status's rev of the
 * waiting part changes with it, so the app reads that part again (and once
 * more when the real one comes back).
 */
function staleWant(body: Record<string, unknown>, id: string, n: number): Record<string, unknown> {
    const parts = body.parts as Record<string, unknown> | undefined;
    if (parts && typeof parts.waiting === 'string') parts.waiting = `${parts.waiting}x`;
    if (body.part === 'waiting' && typeof body.rev === 'string') body.rev = `${body.rev}x`;
    for (const w of (Array.isArray(body.waiting) ? body.waiting : []) as Array<Record<string, unknown>>) {
        const inbox = w.inbox as { want?: number; missing?: number[]; images?: string } | undefined;
        if (w.id !== id || !inbox) continue;
        w.inbox = { ...inbox, want: (inbox.want ?? 0) + 1, missing: [...(inbox.missing ?? []), n], images: `${inbox.images}, ${n}` };
    }
    return body;
}

function groupHead(page: Page, name: string): Locator {
    return page.locator('#research-overview .research-overview__waiting-grouphead')
        .filter({ has: page.locator('.research-overview__group-title', { hasText: name }) });
}

/** An item's detail opened; its group unfolded when it has a heading (two items and more). */
async function openItem(page: Page, group: string, id: string): Promise<Locator> {
    const head = groupHead(page, group).locator('.research-overview__waiting-group');
    if (await head.count() && await head.getAttribute('aria-expanded') === 'false') await head.click();
    const item = page.locator(`#research-overview .research-overview__waiting-item[data-id="${id}"]`);
    if (!(await item.locator('.research-overview__waiting-detail').isVisible())) await item.locator('.research-overview__waiting-row').click();
    await expect(item.locator('.research-overview__waiting-detail')).toBeVisible();
    return item;
}

test.describe('waiting for images and the answer against a real research bridge', () => {
    if (!BRIDGE) {
        test('images of a book and an answer to a website, through a real bridge', () => {
            test.skip(true, 'STROM_E2E_WAITING not set');
        });
        return;
    }
    const bridge = BRIDGE;

    test('images of a book and an answer to a website, through a real bridge', async ({ page }) => {
        test.setTimeout(240_000);
        const status = await (await fetch(`${bridge.url}/status`)).json() as {
            tree: { id: string }; features?: string[]; accepts?: { media?: { taskImages?: boolean } };
            waiting?: Array<{ id: string; group?: { key: string; name: string; kind: string; url?: string }; inbox?: { missing?: number[] } }>;
        };
        // The bridge of ee95ada3 says what the app needs.
        expect(status.features).toContain('waiting.answer');
        expect(status.accepts?.media?.taskImages).toBe(true);
        const group = status.waiting?.find(w => w.id === bridge.images)?.group;
        expect(group?.kind).toBe('archive');
        expect(status.waiting?.find(w => w.id === bridge.other)?.group?.key).toBe(group?.key);

        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate((b) => window.Strom.UI.openExternalRequest(new URLSearchParams({ live: b })), bridge.url);
        await expect.poll(() => page.evaluate((rid) => window.Strom.UI.researchBridgeAnswer(rid)?.up ?? null, status.tree.id), { timeout: 60_000 }).toBe(true);
        await page.locator('#live-panel .live-panel-expand').click();
        await expect(page.locator('#research-overview')).toBeVisible();

        // The archive's place: its name and its website.
        const head = groupHead(page, group!.name);
        await expect(head).toHaveCount(1);
        if (group!.url) await expect(head.locator('a.research-overview__waiting-archiveweb')).toHaveAttribute('href', group!.url);
        await expect(head.locator('.research-overview__group-missing')).toHaveText('3 images missing');

        // Images: none yet, the row says which are needed, the book's frame its numbers.
        let item = await openItem(page, group!.name, bridge.images);
        await expect(item.locator('.waiting-images__text')).toHaveText('images 57–58');
        await expect(item.locator('.img-dot')).toHaveCount(2);
        await expect(item.locator('.img-dot.is-on')).toHaveCount(0);
        await expect(item.locator('.wait-book__slot')).toHaveText(['○ 57 · missing', '○ 58 · missing']);
        await expect(item.locator('.wait-book__state')).toHaveText('No image yet – images 57–58 missing.');

        // A number the task does not ask for. The app checks the numbers it knows before sending; the
        // bridge's own refusal comes when the app's list is behind the research's (here: an older
        // status that also asked for 60). The numbers said are the bridge's.
        await page.route(`${bridge.url}/status**`, async (route) => {
            const res = await route.fetch();
            const body = await res.json() as Record<string, unknown>;
            await route.fulfill({ response: res, json: staleWant(body, bridge.images, 60) });
        });
        touch(bridge, 'Hradec nad Moravicí');
        await expect(item.locator('.img-dot')).toHaveCount(3, { timeout: 30_000 });
        await item.locator('.waiting-actions [data-action="images"]').click();
        let area = item.locator('.waiting-upload');
        await area.locator('.waiting-upload__input').setInputFiles([await jpeg(page, 'kniha-0060.jpg', 'snímek 60')]);
        await expect(area.locator('.waiting-upload__file .waiting-upload__num')).toHaveValue('60');
        await area.locator('.waiting-upload__send').click();
        const file = area.locator('.waiting-upload__file');
        await expect(file.locator('.waiting-upload__msg.is-warn')).toHaveText('The task asks for images 57–58.');
        await page.unroute(`${bridge.url}/status**`);
        expect(show(bridge, bridge.images).task.files ?? []).toHaveLength(0);

        // Another number chosen for it: 57 saved, the task keeps waiting, "1 of 2".
        const again = file.locator('.waiting-upload__again');
        await again.locator('.waiting-upload__num').selectOption('57');
        await again.locator('.waiting-upload__retry').click();
        await expect(area).toHaveCount(0);
        await expect(item.locator('.waiting-images-result')).toContainText('1 of 2 images saved – image 58 missing.');
        await expect(item.locator('.waiting-images__text')).toHaveText('1 of 2 images');
        expect(show(bridge, bridge.images).task.state).toBe('waiting');

        // The last one: the task woken, the item gone.
        item = await openItem(page, group!.name, bridge.images);
        await item.locator('.waiting-actions [data-action="images"]').click();
        area = item.locator('.waiting-upload');
        await area.locator('.waiting-upload__input').setInputFiles([await jpeg(page, 'kniha-0058.jpg', 'snímek 58')]);
        await expect(area.locator('.waiting-upload__file .waiting-upload__num')).toHaveValue('58');
        await area.locator('.waiting-upload__send').click();
        await expect(page.locator('.toast', { hasText: 'All images saved, the task is back in the queue.' })).toBeVisible();
        await expect(page.locator(`#research-overview .research-overview__waiting-item[data-id="${bridge.images}"]`)).toHaveCount(0);
        const woken = show(bridge, bridge.images).task;
        expect(woken.state).not.toBe('waiting');
        expect((woken.files ?? []).filter(f => f.by === 'app')).toHaveLength(2);

        // The website's task (no book): answered in the overview, gone; the research has it as given in the app.
        const webGroup = status.waiting?.find(w => w.id === bridge.web)?.group?.name ?? '';
        const web = await openItem(page, webGroup, bridge.web);
        await expect(web.locator('.waiting-actions [data-action="images"]')).toHaveCount(0);
        await web.locator('.waiting-actions [data-action="answer"]').click();
        const form = web.locator('.waiting-answer');
        const text = 'Seznam knih oddaných 1880–1890 na stránce není, je tam jen kontakt na faru.';
        await form.locator('textarea').fill(text);
        await form.locator('.waiting-answer__send').click();
        await expect(page.locator(`#research-overview .research-overview__waiting-item[data-id="${bridge.web}"]`)).toHaveCount(0);
        const answered = show(bridge, bridge.web).task;
        expect(answered.state).not.toBe('waiting');
        expect(answered.answers?.at(-1)).toMatchObject({ by: 'person', answer: text, givenIn: 'app' });
    });
});

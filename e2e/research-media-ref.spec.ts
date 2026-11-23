import { test, expect, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HEAD, fakeBridge, openResearch, poll, researchGed, FakeBridge } from './research-bridge.js';

/**
 * Pictures the research holds go by reference (spec 133 phase 1), the whole
 * way in the browser: a research-tied tree, a bridge that says
 * `sync.mediaRef` + `media.known` (answered by page.route). A new portrait
 * crop goes with its data, the research's other pictures as `_STROM_DATA
 * <sha>`; a refusal `sync.media-ref-unknown` sends the same tree once more
 * with every picture's data, nothing told. A material file with a note the
 * app sends back unchanged keeps its NOTE, by reference and with its data.
 * Invented data.
 */

const fixture = (name: string) => readFileSync(`e2e/fixtures/${name}`).toString('base64');
const PORTRAIT = `data:image/png;base64,${fixture('avatar.png')}`;
const LETTER = `data:image/png;base64,${fixture('asymmetric.png')}`;
const LETTER_NOTE = 'Dopis od tety Ludmily\nz Lhoty 1924 – psáno v zimě';
const MEDIA_REF = ['sync.mediaRef', 'media.known'];

/** Jan with his portrait and a letter of the family's material with its note. */
const GED = researchGed(HEAD, [
    '1 OBJE', `2 FILE ${PORTRAIT}`, '2 FORM png', '2 TITL jan.png', '2 _STROM_KIND photo',
    '1 OBJE', `2 FILE ${LETTER}`, '2 FORM png', '2 TITL dopis.png', '2 NOTE Dopis od tety Ludmily', '3 CONT z Lhoty 1924 – psáno v zimě',
]);

const shaOf = (url: string): string => createHash('sha256').update(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')).digest('hex');
const payload = (url: string): string => url.slice(url.indexOf(',') + 1);
/** A send with its long values joined back (FILE and NOTE are cut with CONC). */
const joined = (body: string): string => body.replace(/\n\d+ CONC /g, '');

async function jan(page: Page): Promise<{ id: string; photo: string | null; media: { dataUrl: string; name: string; note: string | null }[] }> {
    // The tree in memory holds its pictures as references to the image pool: read them back whole.
    return page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find(x => x.firstName === 'Jan')!;
        return window.Strom.Images.expandedData({ id: p.id as string, photo: p.photo ?? null, media: dm.personMedia(p.id).map(a => ({ dataUrl: a.dataUrl, name: a.name, note: a.note ?? null })) });
    });
}

/** The OBJE of a send whose TITL is `title`: its lines, the level of its OBJE taken off. */
function objeOf(body: string, title: string): string[] {
    const lines = body.split('\n');
    const at = lines.findIndex(l => / TITL /.test(l) && l.endsWith(` TITL ${title}`));
    expect(at).toBeGreaterThan(-1);
    let start = at;
    while (start > 0 && !/^\d+ OBJE/.test(lines[start])) start--;
    const level = Number(lines[start].split(' ')[0]);
    let end = start + 1;
    while (end < lines.length && Number(lines[end].split(' ')[0]) > level) end++;
    return lines.slice(start + 1, end).map(l => `${Number(l.split(' ')[0]) - level} ${l.slice(l.indexOf(' ') + 1)}`);
}

/** The NOTE of an OBJE's lines as text (CONT a new line, CONC joined). */
function noteOf(lines: string[]): string | null {
    const at = lines.findIndex(l => l.startsWith('1 NOTE '));
    if (at < 0) return null;
    let text = lines[at].slice('1 NOTE '.length);
    for (const l of lines.slice(at + 1)) {
        if (l.startsWith('2 CONT ')) text += `\n${l.slice(7)}`;
        else if (l === '2 CONT') text += '\n';
        else if (l.startsWith('2 CONC ')) text += l.slice(7);
        else break;
    }
    return text;
}

/** The research's tree opened here, Jan's portrait and letter held by the research; its bridge said once. */
async function tied(page: Page, features: string[], init: Partial<FakeBridge> = {}): Promise<{ bridge: FakeBridge; before: Awaited<ReturnType<typeof jan>>; letterSha: string }> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page, { ged: GED });
    const before = await jan(page);
    expect(before.photo).toBeTruthy();
    expect(before.media.map(m => [m.name, m.note])).toEqual([['dopis.png', LETTER_NOTE]]);
    const letterSha = shaOf(before.media[0].dataUrl);
    const bridge = await fakeBridge(page, {
        features, mediaKnown: new Map([[shaOf(before.photo!), 'I0001'], [letterSha, 'I0002']]),
        accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null }, ...init,
    });
    await poll(page);
    return { bridge, before, letterSha };
}

test('a new portrait crop: the research\'s pictures go by reference; refused as unknown, the tree goes once more with every picture\'s data, nothing said', async ({ page }) => {
    const said: string[] = [];
    page.on('console', m => { if (m.type() === 'info' && m.text().startsWith('Research send')) said.push(m.text()); });
    const { bridge, before, letterSha } = await tied(page, MEDIA_REF);

    // The portrait cut again on the person page (⋯ Edit portrait crop): new bytes the research does not have.
    await page.evaluate((id) => window.Strom.UI.showPersonPage(id as never), before.id);
    const pp = page.locator('#person-page-modal');
    await pp.locator('.pp-more').click();
    await pp.locator('[data-pp-menu="crop"]').click();
    await expect(page.locator('.pe-overlay')).toBeVisible();
    await page.keyboard.press('+');
    await page.keyboard.press('Enter');
    await expect(page.locator('.pe-overlay')).toHaveCount(0);
    const after = await jan(page);
    expect(after.photo).not.toBe(before.photo);
    await page.keyboard.press('Escape');
    await expect(pp).toHaveCount(0);

    // The research no longer finds the letter (taken off there meanwhile): refused once, then the usual answer.
    bridge.syncReplies = [{ status: 409, body: { ok: false, error: '1 file by reference not here', code: 'sync.media-ref-unknown', shas: [letterSha] } }];
    await page.locator('#research-sync-send').click();
    await expect.poll(() => bridge.posts.length).toBe(2);
    const [byRef, withData] = bridge.posts.map(joined);
    // Asked what it holds: the new portrait and the letter.
    expect(new Set(bridge.knownAsks?.flat())).toEqual(new Set([shaOf(after.photo!), letterSha]));
    // First: the letter by its hash, none of its data; the new portrait (not held there) with its data.
    expect(byRef).toContain(`_STROM_DATA ${letterSha}`);
    expect(byRef).not.toContain(payload(before.media[0].dataUrl));
    expect(byRef).toContain(payload(after.photo!));
    expect(byRef).not.toContain(payload(before.photo!));
    // Then the same tree once more, every picture with its data.
    expect(withData).not.toContain('_STROM_DATA');
    expect(withData).toContain(payload(before.media[0].dataUrl));
    expect(withData).toContain(payload(after.photo!));
    // Ended as any send by hand: its one toast, nothing of the refusal told; the second answer is the one kept.
    const toast = page.locator('.toast');
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText('Sent to the research, 6 changes.');
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).toBe('pending');
    await expect(page.locator('#research-sync-send')).toHaveCount(0);
    expect(said.filter(t => t.startsWith('Research send {'))).toHaveLength(2);
    expect(said.filter(t => t.startsWith('Research send: a picture by reference not found there'))).toHaveLength(1);
    // No loop: nothing more goes.
    await poll(page);
    await poll(page);
    expect(bridge.posts).toHaveLength(2);
});

for (const way of ['by reference', 'with its data'] as const) {
    test(`nothing changed: the material file's note goes back ${way}, the same NOTE; the research's 0 changes leave it`, async ({ page }) => {
        // A research that keeps the app's files: the tree goes once even as its version (spec 108 K2.7), unchanged.
        const { bridge, before, letterSha } = await tied(page, way === 'by reference' ? ['media.app', ...MEDIA_REF] : ['media.app'], {
            syncReply: { status: 200, body: { ok: true, inbox: false, changes: 0, applied: 0 } },
        });
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect.poll(() => bridge.posts.length).toBe(1);
        const letter = objeOf(bridge.posts[0], 'dopis.png');
        expect(noteOf(letter)).toBe(LETTER_NOTE);
        const body = joined(bridge.posts[0]);
        if (way === 'by reference') {
            expect(letter).toContain(`1 _STROM_DATA ${letterSha}`);
            expect(body).toContain(`_STROM_DATA ${shaOf(before.photo!)}`);
            expect(body).not.toContain(payload(before.media[0].dataUrl));
            expect(body).not.toContain(payload(before.photo!));
        } else {
            expect(body).not.toContain('_STROM_DATA');
            expect(body).toContain(payload(before.media[0].dataUrl));
        }
        await expect(page.locator('.toast')).toContainText('The research took nothing new from this send.');
        await poll(page);
        expect((await jan(page)).media.map(m => m.note)).toEqual([LETTER_NOTE]);
        expect(bridge.posts).toHaveLength(1);
    });
}

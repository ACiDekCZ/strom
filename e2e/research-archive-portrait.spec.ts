import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';
import { BRIDGE, FakeBridge, HEAD, UUID, acceptLoad, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * The portraits, the originals they were cut from and the couple's photo
 * (spec 107) in a tree tied to a Strom archive (spec 002) or a research: the
 * archive keeps none of the app's images and its file (`/tree.ged`) carries no
 * OBJE, so each update brings the tree without them. The app carries them over
 * (carryOverMedia): the portrait, the attachment it was cut from, the couple's
 * photo and the links between them (photoSource) stay as they were. What was
 * removed in the app stays removed: an update never brings back a portrait, an
 * attachment or a couple's photo, nor a portrait's link to its original.
 * A mocked bridge, invented data, a fixed clock.
 */

const NOW = new Date('2026-11-16T10:00:00Z');
const ARCHIVE = { mode: 'archive', sync: { auto: 'mirror' }, sources: true, verified: true, media: null };
const RESEARCH = { sync: { auto: 'off' }, sources: true, verified: true, media: null };

type Mode = 'archive' | 'research';

/** The research's file: no OBJE anywhere (it keeps none of the app's images); `jan`: Jan's lines it holds. */
function ged(mode: Mode, head: string, jan: string[] = []): string {
    const text = researchGed(head, jan);
    return mode === 'archive'
        ? text.replace('1 _STROM_LINKS send open live app setup', '1 _STROM_LINKS send open live app setup\n1 _STROM_MODE archive\n1 _STROM_ASOF 2026-11-16')
        : text;
}

interface Tie { b: FakeBridge; mode: Mode; jan: string[]; writes: number }

/**
 * The tree tied to an archive or a research that writes what the app sends at
 * once (an archive mirrors, spec 002), the tree set to send by itself. Its
 * version after a write is the same file under a new head: it took nothing of
 * the images.
 */
async function openTied(page: Page, mode: Mode): Promise<Tie> {
    await page.clock.install({ time: NOW });
    await openResearch(page, { auto: true, ged: ged(mode, HEAD) });
    const accepts = mode === 'archive' ? ARCHIVE : RESEARCH;
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
        localStorage.setItem('strom-research-auto-intro-seen', '1');
    }, { uuid: UUID, base: BRIDGE, accepts });
    const tie: Tie = { b: null as unknown as FakeBridge, mode, jan: [], writes: 0 };
    tie.b = await fakeBridge(page, {
        accepts, treeGed: ged(mode, HEAD),
        syncReply: { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042' } },
        onWrite: () => {
            const head = `${mode === 'archive' ? 'a' : 'b'}${String(++tie.writes).padStart(11, '0')}`;
            return { head, ged: ged(mode, head, tie.jan) };
        },
    });
    await poll(page);
    expect(await page.evaluate(() => window.Strom.UI.activeResearchArchive())).toBe(mode === 'archive');
    return tie;
}

const head = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head ?? '');

/**
 * An update from the archive / research as the app does it: its changes go
 * first (written at once; a research asks first, "Send, then load"), then the
 * version loads; a version that moved on by itself is loaded with "Load the
 * research version?" accepted.
 */
async function update(page: Page, tie: Tie): Promise<void> {
    await poll(page);
    const before = await head(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await expect.poll(async () => {
        // A research that sends by hand first: "There are changes the research doesn't have" → Send, then load.
        const sendFirst = page.locator('.modal-overlay.active').getByRole('button', { name: 'Send, then load' });
        if (await sendFirst.isVisible()) {
            // The images are said to stay, none to be removed.
            await expect(page.locator('.modal-overlay.active').last()).toContainText('Photos, attachments and excerpts added in the app stay with their people and sources.');
            await sendFirst.click();
        }
        const ask = page.locator('#research-load-modal #research-load-ok');
        if (await ask.isVisible()) await acceptLoad(page);
        return head(page);
    }).not.toBe(before);
    expect(await head(page)).toBe(tie.b.head);
    // Nothing asked about images that would go, no other question left open.
    await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
    await expect(page.locator('#research-load-modal')).toHaveCount(0);
}

/** The archive moved on by itself (another of its trees, a change made there): Jan's lines, a new head. */
function archiveMovesOn(tie: Tie, jan: string[]): void {
    tie.jan = jan;
    tie.b.head = `c${String(++tie.writes).padStart(11, '0')}`;
    tie.b.treeGed = ged(tie.mode, tie.b.head, jan);
}

/** Jan's portrait cut from his attachment; the couple's photo of Josef and Anna and both their portraits cut from it. */
async function addImages(page: Page): Promise<void> {
    await page.evaluate(() => {
        const jpeg = (w: number, h: number, color: string): string => {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const x = c.getContext('2d')!;
            x.fillStyle = color; x.fillRect(0, 0, w, h);
            x.fillStyle = '#f4efe6'; x.fillRect(w / 4, h / 4, w / 2, h / 2);
            return c.toDataURL('image/jpeg', 0.8);
        };
        const dm = window.Strom.DataManager;
        const people = Object.values(dm.getData().persons) as any[];
        const by = (name: string) => people.find(p => p.firstName === name);
        const jan = by('Jan'), josef = by('Josef'), anna = by('Anna');
        const union = Object.values(dm.getData().partnerships).find((u: any) =>
            [u.person1Id, u.person2Id].includes(josef.id) && [u.person1Id, u.person2Id].includes(anna.id)) as any;
        const scan = jpeg(900, 600, '#8a6d3b');
        const att = dm.addAttachment(jan.id, { name: 'jan-1890.jpg', mimeType: 'image/jpeg', dataUrl: scan, sizeBytes: Math.round(scan.length * 0.75) })!;
        dm.updatePerson(jan.id, { photo: jpeg(256, 256, '#5b4a2f'), photoSource: { attachmentId: att.id, region: { x: 150 / 900, y: 0, w: 600 / 900, h: 1 } } });
        dm.updatePartnership(union.id, { photo: jpeg(1200, 800, '#2f4b5b'), photoOriginalName: 'svatba-1924.jpg', photoDate: '1924' });
        dm.updatePerson(josef.id, { photo: jpeg(256, 256, '#3b5b2f'), photoSource: { partnershipId: union.id, region: { x: 0, y: 0, w: 0.5, h: 0.75 } } });
        dm.updatePerson(anna.id, { photo: jpeg(256, 256, '#6b2f4b'), photoSource: { partnershipId: union.id, region: { x: 0.5, y: 0.25, w: 0.5, h: 0.75 }, angle: 1.5 } });
    });
}

/** The images of the three people and the couple, as the tree holds them now. */
const images = (page: Page) => page.evaluate(() => {
    const d = window.Strom.DataManager.getData();
    const people = Object.values(d.persons) as any[];
    const person = (name: string) => {
        const p = people.find(x => x.firstName === name);
        return { id: p.id, photo: p.photo ?? null, source: p.photoSource ?? null,
            attachments: (p.attachments ?? []).map((a: any) => ({ id: a.id, name: a.name, dataUrl: a.dataUrl })) };
    };
    const unions = Object.values(d.partnerships).map((u: any) => ({ id: u.id, photo: u.photo ?? null, name: u.photoOriginalName ?? null, date: u.photoDate ?? null }));
    return { jan: person('Jan'), josef: person('Josef'), anna: person('Anna'), unions };
});

const birthPlace = (page: Page) => page.evaluate(() =>
    (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any).birthPlace ?? null);

for (const mode of ['archive', 'research'] as const) {
    test.describe(`the portraits, their originals and the couple's photo in a tree tied to ${mode === 'archive' ? 'a Strom archive' : 'a research'}`, () => {
        test.use({ viewport: { width: 1280, height: 860 } });

        test('they survive every update: written there and loaded back, a version that moved on there, a reload', async ({ page }) => {
            const tie = await openTied(page, mode);
            await addImages(page);
            const made = await images(page);
            expect(made.jan.source?.attachmentId).toBe(made.jan.attachments[0].id);
            expect(made.unions).toHaveLength(1);
            expect(made.josef.source?.partnershipId).toBe(made.unions[0].id);
            expect(made.anna.source?.partnershipId).toBe(made.unions[0].id);

            // The images count as changes: they go first, the version written there (without them) loads.
            await update(page, tie);
            expect(tie.b.posts.length).toBeGreaterThan(0);
            expect(tie.b.treeGed).not.toContain('OBJE');
            expect(await images(page)).toEqual(made);

            // The archive moved on by itself (no OBJE either): its change comes, the images stay.
            archiveMovesOn(tie, ['1 BIRT', '2 DATE 1890', '2 PLAC Chlumy']);
            await update(page, tie);
            expect(await birthPlace(page)).toBe('Chlumy');
            expect(await images(page)).toEqual(made);
            if (mode === 'archive') {
                expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.mode)).toBe('archive');
            }

            // Kept with the tree: the same after a reload (the links to the originals checked on load).
            await page.reload();
            await expect(card(page, 'Jan')).toBeVisible();
            expect(await images(page)).toEqual(made);
        });

        test('what was removed in the app stays removed: no update brings it back, nor a portrait\'s link to its original', async ({ page }) => {
            const tie = await openTied(page, mode);
            await addImages(page);
            await update(page, tie);
            const made = await images(page);

            // Anna's portrait removed, the attachment Jan's portrait was cut from deleted, the couple's photo removed.
            await page.evaluate(({ anna, jan, att, union }) => {
                const dm = window.Strom.DataManager;
                dm.updatePerson(anna as never, { photo: '' });
                dm.removeAttachment(jan as never, att);
                dm.updatePartnership(union as never, { photo: '' });
            }, { anna: made.anna.id, jan: made.jan.id, att: made.jan.attachments[0].id, union: made.unions[0].id });
            const removed = {
                jan: { ...made.jan, source: null, attachments: [] },
                josef: { ...made.josef, source: null },
                anna: { ...made.anna, photo: null, source: null },
                unions: [{ id: made.unions[0].id, photo: null, name: null, date: null }],
            };
            // The portraits cut from them stay, without their originals.
            expect(await images(page)).toEqual(removed);

            // The removals go there and its version loads: nothing comes back.
            await update(page, tie);
            expect(await images(page)).toEqual(removed);

            // A version that moved on there by itself, then a reload: still nothing back.
            archiveMovesOn(tie, ['1 BIRT', '2 PLAC Chlumy']);
            await update(page, tie);
            expect(await birthPlace(page)).toBe('Chlumy');
            expect(await images(page)).toEqual(removed);
            await page.reload();
            await expect(card(page, 'Jan')).toBeVisible();
            expect(await images(page)).toEqual(removed);
        });
    });
}

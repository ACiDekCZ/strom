import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, materialSha, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE, HEAD,
    FakeBridge, FakeMaterial, FakeMaterialFile,
} from './research-bridge.js';
import { openApp, seedTree, cardAction, personModal, seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';

/**
 * The tree's own writes on files (spec 102 §4, §9, §12h): "Link to…" (a
 * person or several, an event, a union, a source; ←/→ switch the target,
 * Enter links, P in the viewer), one undo step with a toast; material
 * outside the tree linked with its working copy from the bridge (off while
 * the research is stopped); "Remove from the tree…" with its warnings
 * (without an archive the file is deleted); the same file added twice; the
 * sentences of deleting a person or a source; the person menu's Materials.
 * Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const AVATAR = 'e2e/fixtures/avatar.png';

const win = (page: Page) => page.locator('#materials-modal');
const tile = (page: Page, text: string) => win(page).locator('.mw-canvas .mw-tile', { hasText: text });
const viewer = (page: Page) => page.locator('#attachment-overlay');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const act = (page: Page, id: string) => panel(page).locator(`.mv-act[data-action="${id}"]`);
const uses = (page: Page) => panel(page).locator('.mv-uses');
const links = (page: Page) => uses(page).locator('.mv-use-link').allTextContents();
const pill = (page: Page) => page.locator('body > .undo-toast.show');
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg');
const seg = (page: Page, target: string) => dialog(page).locator(`.mdlg-seg [data-target="${target}"]`);
const go = (page: Page) => dialog(page).locator('.mdlg-foot .mdlg-btn.is-primary');

async function tree(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        p1: { firstName: 'Florimund', lastName: 'Pfefferkorn', partners: ['p2'] },
        p2: { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female' },
        p3: { firstName: 'Kasimir', lastName: 'Pfefferkorn', parents: ['p1', 'p2'], birthDate: '1925' },
    }, 'Pfefferkorn', 'p3');
}

/** Kasimir's letter (only at him) and the register "Matrika Quellbach". */
async function letter(page: Page): Promise<string> {
    return page.evaluate(({ px }) => {
        const dm = window.Strom.DataManager;
        dm.addSource({ title: 'Matrika Quellbach' } as never);
        return dm.addAttachment('p3' as never, { name: 'dopis.png', mimeType: 'image/png', dataUrl: px, sizeBytes: 70 } as never)!.id as string;
    }, { px: PX });
}

async function view(page: Page, text: string): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    await tile(page, text).click();
    await expect(viewer(page)).toHaveClass(/active/);
    await expect(uses(page)).toBeVisible();
}

const placesOf = (page: Page, id: string) => page.evaluate((id) => JSON.stringify(window.Strom.DataManager.getMedia(id)?.places ?? []), id).then(s => JSON.parse(s) as Record<string, string>[]);
const mediaCount = (page: Page) => page.evaluate(() => Object.keys(window.Strom.DataManager.getData().media ?? {}).length);

test.describe('Link to… in a tree without a research', () => {
    test.use({ viewport: DESKTOP });

    test('P opens it; people already on the file are fixed; two people linked with one Undo', async ({ page }) => {
        await tree(page);
        const id = await letter(page);
        await view(page, 'dopis.png');
        await expect(act(page, 'attach')).toHaveText('Link to…');
        await page.keyboard.press('p');
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('dopis.png');
        await expect(dialog(page).locator('.mdlg-sub')).toHaveText('dopis.png · in the tree');
        await expect(seg(page, 'person')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog(page).locator('.ppm-row', { hasText: 'Kasimir' })).toHaveClass(/is-fixed/);
        await expect(go(page)).toBeDisabled();
        await dialog(page).locator('.ppm-row', { hasText: 'Florimund' }).click();
        await dialog(page).locator('.ppm-row', { hasText: 'Quirinella' }).click();
        await expect(go(page)).toHaveText('Link (2 people)');
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Linked to Florimund Pfefferkorn and Quirinella Pfefferkornová.');
        expect((await placesOf(page, id)).map(p => p.personId)).toEqual(['p3', 'p1', 'p2']);
        await expect.poll(() => links(page)).toEqual(['Kasimir Pfefferkorn', 'Florimund Pfefferkorn', 'Quirinella Pfefferkornová']);
        await pill(page).locator('.undo-toast-btn').click();
        await expect.poll(async () => (await placesOf(page, id)).length).toBe(1);
    });

    test('an event: ←/→ switch the target, the file\'s person is the start, Enter links to their birth', async ({ page }) => {
        await tree(page);
        const id = await letter(page);
        await view(page, 'dopis.png');
        await act(page, 'attach').click();
        await seg(page, 'person').focus();
        await page.keyboard.press('ArrowRight');
        await expect(seg(page, 'event')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog(page).locator('.mdlg-attach-whoname')).toHaveText('Events of Kasimir Pfefferkorn');
        const birth = dialog(page).locator('.mdlg-radio').first();
        await birth.locator('input').check();
        await expect(go(page)).toBeEnabled();
        await page.keyboard.press('Enter');
        await expect(dialog(page)).toHaveCount(0);
        await expect(pill(page).locator('.undo-toast-msg')).toContainText('Linked to the event');
        expect(await placesOf(page, id)).toContainEqual({ personId: 'p3', fact: 'birth' });
    });

    test('a union: a person without one says so; another person\'s union with the sentence about its photo', async ({ page }) => {
        await tree(page);
        const id = await letter(page);
        await view(page, 'dopis.png');
        await act(page, 'attach').click();
        await seg(page, 'couple').click();
        await expect(dialog(page).locator('.mdlg-attach-pane')).toContainText('This person has no union in the tree.');
        await expect(dialog(page).locator('.mdlg-note')).toHaveText('The file is linked as an attachment of the union. The union’s photo is changed at the union (Use as union photo).');
        await dialog(page).locator('.mdlg-attach-change').click();
        await dialog(page).locator('.person-picker-input').fill('Florimund');
        await dialog(page).locator('.person-picker-item', { hasText: 'Florimund' }).click();
        await expect(dialog(page).locator('.mdlg-attach-whoname')).toHaveText('Unions of Florimund Pfefferkorn');
        await dialog(page).locator('.mdlg-radio input').first().check();
        await go(page).click();
        await expect(pill(page).locator('.undo-toast-msg')).toContainText('Linked to the union');
        expect((await placesOf(page, id)).some(p => !!p.partnershipId)).toBe(true);
    });

    test('a source: searched, the evidence sentence, linked', async ({ page }) => {
        await tree(page);
        const id = await letter(page);
        await view(page, 'dopis.png');
        await act(page, 'attach').click();
        await seg(page, 'source').click();
        await expect(dialog(page).locator('.mdlg-note')).toHaveText('The file becomes the source’s evidence.');
        await dialog(page).locator('.mdlg-attach-search').fill('Quellbach');
        await dialog(page).locator('.mdlg-radio', { hasText: 'Matrika Quellbach' }).locator('input').check();
        await go(page).click();
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText(/^Linked to the source .*Matrika Quellbach/);
        expect((await placesOf(page, id)).some(p => !!p.sourceId)).toBe(true);
        await expect.poll(() => links(page)).toContain('Matrika Quellbach');
    });

    test('a phone: the dialog is a sheet from the bottom, the segment over the whole width', async ({ page }) => {
        await page.setViewportSize(PHONE);
        await tree(page);
        await letter(page);
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await tile(page, 'dopis.png').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await act(page, 'attach').click();
        const box = (await dialog(page).boundingBox())!;
        expect(Math.round(box.y + box.height)).toBe(PHONE.height);
        expect(Math.round(box.width)).toBe(PHONE.width);
        const segBox = (await dialog(page).locator('.mdlg-seg').boundingBox())!;
        expect(segBox.width).toBeGreaterThan(PHONE.width - 40);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});

test.describe('Remove from the tree without an archive', () => {
    test.use({ viewport: DESKTOP });

    test('the warning names the source\'s evidence, the excerpt and the portrait; the file is deleted with Undo', async ({ page }) => {
        await tree(page);
        const id = await page.evaluate(({ px }) => {
            const dm = window.Strom.DataManager;
            const data = dm.getData();
            const att = dm.addAttachment('p3' as never, { name: 'svatba.png', mimeType: 'image/png', dataUrl: px, sizeBytes: 70 } as never)!;
            const source = dm.addSource({ title: 'Matrika Quellbach' } as never)!;
            dm.addMediaPlace(att.id, { sourceId: source.id } as never);
            (data.persons as Record<string, { photoSource?: unknown }>).p3.photoSource = { attachmentId: att.id, x: 0, y: 0, w: 1, h: 1 };
            (data.sources as Record<string, { excerpts?: unknown[] }>)[source.id].excerpts = [
                { id: 'x1', dataUrl: px, width: 1, height: 1, sizeBytes: 70, fromAttachmentId: att.id },
            ];
            return att.id as string;
        }, { px: PX });
        await view(page, 'svatba.png');
        await expect(act(page, 'hide')).toHaveCount(0);
        await act(page, 'removeFromTree').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Delete the file from the tree?');
        await expect(dialog(page).locator('.mdlg-text').first()).toHaveText('svatba.png is removed from every place in the tree (2) and deleted.');
        await expect(dialog(page).locator('.mdlg-warn-row')).toHaveCount(3);
        await expect(dialog(page).locator('.mdlg-warn-row[data-use="source"]')).toContainText('The source stays without evidence.');
        await expect(dialog(page).locator('.mdlg-warn-row[data-use="excerpt"]')).toContainText('The excerpt stays.');
        await expect(dialog(page).locator('.mdlg-warn-row[data-use="portrait"]')).toContainText('The portrait stays; its crop can no longer be changed.');
        await expect(dialog(page).locator('input[name="mdlg-rm-reason"]')).toHaveCount(0);
        await dialog(page).getByRole('button', { name: 'Delete the file' }).click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect.poll(() => page.evaluate((id) => !!window.Strom.DataManager.getMedia(id), id)).toBe(false);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Deleted: svatba.png.');
        await pill(page).locator('.undo-toast-btn').click();
        await expect.poll(async () => (await placesOf(page, id)).length).toBe(2);
    });
});

test.describe('The same file added twice without an archive', () => {
    test.use({ viewport: DESKTOP });

    async function addAvatar(page: Page, first: string): Promise<void> {
        await cardAction(page, first, 'edit');
        const modal = personModal(page);
        await modal.locator('#input-attachment').setInputFiles(AVATAR);
    }

    test('Link here too (the default) links the file; Add as a new file adds a copy; Cancel nothing', async ({ page }) => {
        await tree(page);
        await addAvatar(page, 'Kasimir');
        await expect(personModal(page).locator('#attachments-list .attachment-row')).toHaveCount(1);
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        await expect.poll(() => mediaCount(page)).toBe(1);

        await addAvatar(page, 'Florimund');
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('The file is already in the tree');
        await expect(dialog(page).locator('.mdlg-text')).toHaveText('The same file is linked to Kasimir Pfefferkorn. Link it here too?');
        await expect(dialog(page).getByRole('button', { name: 'Link here too' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(dialog(page)).toHaveCount(0);
        await expect(personModal(page).locator('#attachments-list .attachment-row')).toHaveCount(1);
        expect(await mediaCount(page)).toBe(1);
        const only = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().media ?? {})[0]);
        expect((await placesOf(page, only)).map(p => p.personId)).toEqual(['p3', 'p1']);

        // Once more at Quirinella: Cancel adds nothing, Add as a new file a second record.
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        await addAvatar(page, 'Quirinella');
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(personModal(page).locator('#attachments-list .attachment-row')).toHaveCount(0);
        await personModal(page).locator('#input-attachment').setInputFiles(AVATAR);
        await dialog(page).locator('.mdlg-dup-new').click();
        await expect(personModal(page).locator('#attachments-list .attachment-row')).toHaveCount(1);
        expect(await mediaCount(page)).toBe(2);
    });
});

test.describe('Deleting a person or a source', () => {
    test.use({ viewport: DESKTOP });

    test('the person\'s confirmation names the files that stay and those that go; the source\'s its evidence used elsewhere', async ({ page }) => {
        await tree(page);
        await page.evaluate(({ px }) => {
            const dm = window.Strom.DataManager;
            const file = (name: string) => ({ name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70 });
            const shared = dm.addAttachment('p3' as never, file('svatba.png') as never)!;
            dm.addMediaPlace(shared.id, { personId: 'p1' as never });
            const source = dm.addSource({ title: 'Matrika Quellbach' } as never)!;
            dm.addMediaPlace(shared.id, { sourceId: source.id } as never);
            dm.addAttachment('p3' as never, file('dopis.png') as never);
            dm.addAttachment('p3' as never, file('foto.png') as never);
        }, { px: PX });
        await cardAction(page, 'Kasimir', 'delete');
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toHaveClass(/active/);
        await expect(confirm.locator('#confirm-message')).toContainText('1 linked file stays in Materials, only without the link to this person.');
        await expect(confirm.locator('#confirm-message')).toContainText('2 files that are only with this person are deleted with them.');
        await confirm.getByRole('button', { name: 'Cancel' }).click();

        const sourceId = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().sources ?? {})[0]);
        await page.evaluate((id) => void (window.Strom.UI as unknown as { deleteSource(id: string): Promise<void> }).deleteSource(id), sourceId);
        await expect(confirm).toHaveClass(/active/);
        await expect(confirm.locator('#confirm-message')).toContainText('The evidence files (1) stay in Materials, only without the link to this source.');
        await confirm.getByRole('button', { name: 'Cancel' }).click();
    });
});

// ==================== BESIDE AN ARCHIVE ====================

const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };

async function research(page: Page, files: FakeMaterialFile[]): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({ files, batches: [], people: PEOPLE });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: MATERIAL_FEATURES, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    return { bridge, material };
}

const treeRecordOf = (page: Page, sha: string) => page.evaluate((sha) => {
    const att = (Object.values(window.Strom.DataManager.getData().media ?? {}) as { original?: { sha256: string }; places: unknown[]; dataUrl: string; mimeType: string }[])
        .find(a => a.original?.sha256 === sha);
    // A copy stored with the tree is held as its pool reference (spec 135).
    return att ? { places: att.places.length, mime: att.mimeType, copy: att.dataUrl.startsWith('data:image/') || att.dataUrl.startsWith('\u0000sm:') } : null;
}, sha);

test.describe('Link to… beside an archive', () => {
    test.use({ viewport: DESKTOP });

    test('material only in the archive: from the empty "Where used", linked with a working copy from the bridge; the research is not written', async ({ page }) => {
        const sha = materialSha('I0001');
        const { material } = await research(page, [materialFile(1, { title: 'Křest' })]);
        await view(page, 'Křest');
        const none = uses(page).locator('.mv-uses-none');
        await expect(none).toHaveText('Not in the tree yet. Link to…');
        await none.locator('.mv-uses-attach').click();
        await expect(dialog(page).locator('.mdlg-sub')).toHaveText('scan-1.jpg · only in the archive');
        await expect(dialog(page).locator('.mdlg-attach-arch')).toHaveText('The file is only in the research so far. Linked, it is also in the tree: in exports, the book and on the phone.');
        await dialog(page).locator('.ppm-row', { hasText: 'Jan Fíšek' }).click();
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Linked to Jan Fíšek.');
        await expect.poll(() => treeRecordOf(page, sha)).toEqual({ places: 1, mime: 'image/jpeg', copy: true });
        expect(material.assigns).toHaveLength(0);
        await expect.poll(() => links(page)).toEqual(['Jan Fíšek']);
        // A file in the tree: Remove from the tree…, no Hide.
        await expect(act(page, 'removeFromTree')).toBeVisible();
        await expect(act(page, 'hide')).toHaveCount(0);
    });

    test('a person without a REFN can be linked, with the sentence; the research stopped: Link to… is off for material outside the tree', async ({ page }) => {
        const { bridge } = await research(page, [materialFile(1, { title: 'Křest' })]);
        await page.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Petr', lastName: 'Nový', gender: 'male' }));
        await view(page, 'Křest');
        await act(page, 'attach').click();
        await dialog(page).locator('.ppm-search').fill('Petr');
        const petr = dialog(page).locator('.ppm-row', { hasText: 'Petr Nový' });
        await expect(petr).not.toHaveClass(/is-blocked/);
        await petr.click();
        await expect(dialog(page).locator('.mdlg-note')).toHaveText('The research knows this person after the next tree save. The link is written with it.');
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(viewer(page)).not.toHaveClass(/active/);

        bridge.down = true;
        await poll(page);
        await tile(page, 'Křest').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(act(page, 'attach')).toHaveAttribute('aria-disabled', 'true');
        await act(page, 'attach').click({ force: true });
        await expect(dialog(page)).toHaveCount(0);
    });

    test('the person menu\'s Materials opens the window filtered to the person', async ({ page }) => {
        await research(page, [materialFile(1, { persons: ['P0003'], title: 'Křest' }), materialFile(2, { title: 'Jiný' })]);
        await cardAction(page, 'Jan', 'materials');
        await expect(win(page)).toBeVisible();
        await expect(tile(page, 'Křest')).toBeVisible();
        await expect(tile(page, 'Jiný')).toHaveCount(0);
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
    });

    test('the same original added at another person is linked without asking', async ({ page }) => {
        const sha = materialSha('I0001');
        await research(page, [materialFile(1, { persons: ['P0003'] })]);
        const anna = await page.evaluate(({ px, sha }) => {
            const dm = window.Strom.DataManager;
            const persons = Object.values(dm.getData().persons) as { id: string; firstName: string }[];
            const jan = persons.find(p => p.firstName === 'Jan')!.id;
            dm.addAttachment(jan as never, { name: 'scan-1.jpg', mimeType: 'image/png', dataUrl: px, sizeBytes: 70,
                original: { sha256: sha, name: 'scan-1.jpg', mimeType: 'image/jpeg', bytes: 400_001 } } as never);
            return persons.find(p => p.firstName === 'Anna')!.id;
        }, { px: PX, sha });
        const answer = await page.evaluate(({ anna, sha }) => (window.Strom.UI as unknown as {
            sameFileTwice(id: string, f: unknown): Promise<string | null>;
        }).sameFileTwice(anna, { original: { sha256: sha } }), { anna, sha });
        expect(answer).toBe('linked');
        await expect(dialog(page)).toHaveCount(0);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('The file was already in the tree; linked here too.');
        await expect.poll(() => treeRecordOf(page, sha)).toMatchObject({ places: 2 });
    });
});

// ==================== A TREE FOLLOWED LIVE, A BUSY BRIDGE (1122 F) ====================

/** A fourth person of the research (invented). */
const KORDULA = ['0 @P0004@ INDI', '1 NAME Kordula /Fíšková/', '1 SEX F', '1 REFN P0004', '2 TYPE strom-research'];
const FOUR = ['Josef Fíšek', 'Anna Svobodová', 'Jan Fíšek', 'Kordula Fíšková'];

/** The research followed from its bridge (`?live=`): the tree is read-only meanwhile. */
async function followLive(page: Page, material: FakeMaterial): Promise<FakeBridge> {
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
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: MATERIAL_FEATURES, material, treeGed: researchGed(HEAD, KORDULA) });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect.poll(() => page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(true);
    await poll(page);
    return bridge;
}

async function pickFour(page: Page): Promise<void> {
    for (const name of FOUR) await dialog(page).locator('.ppm-row', { hasText: name }).click();
    await expect(go(page)).toHaveText('Link (4 people)');
}

const LINKED_FOUR = 'Linked to Josef Fíšek, Anna Svobodová, Jan Fíšek and Kordula Fíšková.';

test.describe('Link to… never ends without a word (1122 F)', () => {
    test.use({ viewport: DESKTOP });

    test('a tree followed live: a file only in the archive to four people says the tree is read-only; End following, then it links', async ({ page }) => {
        const sha = materialSha('I0001');
        const material = fakeMaterial({ files: [materialFile(1, { title: 'U stolu' })], batches: [], people: { ...PEOPLE, P0004: 'Kordula Fíšková' } });
        const bridge = await followLive(page, material);
        await view(page, 'U stolu');
        await act(page, 'attach').click();
        await expect(dialog(page).locator('.mdlg-sub')).toHaveText('scan-1.jpg · only in the archive');
        await pickFour(page);
        // Said at once, the choice kept: the button waits for the end of following.
        const followed = dialog(page).locator('.mdlg-attach-followed');
        await expect(followed).toContainText('The tree is followed live and is read-only. Linking is possible after following ends; the choice stays.');
        await expect(go(page)).toBeDisabled();
        await followed.getByRole('button', { name: 'End following' }).click();
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(false);
        await expect(followed).toBeHidden();
        await expect(go(page)).toHaveText('Link (4 people)');
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText(LINKED_FOUR);
        await expect.poll(() => treeRecordOf(page, sha)).toEqual({ places: 4, mime: 'image/jpeg', copy: true });
        expect(bridge.seen).toContain(`GET /media/${sha}`);
    });

    test('following that starts or ends while the dialog is open is said at once; a person locked meanwhile: the click says nothing was linked', async ({ page }) => {
        const sha = materialSha('I0001');
        await research(page, [materialFile(1, { title: 'U stolu' })]);
        await view(page, 'U stolu');
        await act(page, 'attach').click();
        await dialog(page).locator('.ppm-row', { hasText: 'Jan Fíšek' }).click();
        const followed = dialog(page).locator('.mdlg-attach-followed');
        await expect(followed).toBeHidden();
        await expect(go(page)).toBeEnabled();
        await page.evaluate(() => window.Strom.DataManager.setLiveTree(window.Strom.DataManager.getCurrentTreeId()));
        await expect(followed).toBeVisible();
        await expect(go(page)).toBeDisabled();
        await page.evaluate(() => window.Strom.DataManager.setLiveTree(null));
        await expect(followed).toBeHidden();
        await expect(go(page)).toBeEnabled();
        // Jan locked meanwhile: nothing can be written, and the click says so; the button stays usable.
        await page.evaluate(() => {
            const jan = (Object.values(window.Strom.DataManager.getData().persons) as { firstName: string; isLocked?: boolean }[]).find(p => p.firstName === 'Jan')!;
            jan.isLocked = true;
        });
        await go(page).click();
        await expect(dialog(page).locator('.mdlg-error')).toHaveText('Nothing was linked: the tree or the chosen people are locked.');
        await expect(go(page)).toBeEnabled();
        expect(await treeRecordOf(page, sha)).toBeNull();
    });

    test('a busy bridge (503 with retry): said in the dialog with Try again, which links once it is free', async ({ page }) => {
        const sha = materialSha('I0001');
        await research(page, [materialFile(1, { title: 'U stolu' })]);
        let busy = true;
        let asks = 0;
        await page.route(`${BRIDGE}/media/${sha}?**`, async (route) => {
            // The file itself (`?file=1`); its previews go on as they are.
            if (new URL(route.request().url()).searchParams.get('file') !== '1') return route.fallback();
            asks++;
            if (!busy) return route.fallback();
            return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
                body: JSON.stringify({ error: 'busy', code: 'research.busy', text: 'busy', retry: 2 }) });
        });
        await view(page, 'U stolu');
        await act(page, 'attach').click();
        await dialog(page).locator('.ppm-row', { hasText: 'Jan Fíšek' }).click();
        // The viewer may read the file for itself: only the dialog's reads are counted.
        const before = asks;
        await go(page).click();
        const error = dialog(page).locator('.mdlg-error');
        await expect(error).toContainText('The research is busy; nothing changed.');
        await expect(go(page)).toBeEnabled();
        expect(await mediaCount(page)).toBe(0);
        busy = false;
        await error.getByRole('button', { name: 'Try again' }).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Linked to Jan Fíšek.');
        await expect.poll(() => treeRecordOf(page, sha)).toEqual({ places: 1, mime: 'image/jpeg', copy: true });
        expect(asks - before).toBe(2);
    });

    test('a failed read (500 material.failed): said in the dialog; the next click asks again', async ({ page }) => {
        const sha = materialSha('I0001');
        await research(page, [materialFile(1, { title: 'U stolu' })]);
        let fail = true;
        let asks = 0;
        await page.route(`${BRIDGE}/media/${sha}?**`, async (route) => {
            // The file itself (`?file=1`); its previews go on as they are.
            if (new URL(route.request().url()).searchParams.get('file') !== '1') return route.fallback();
            asks++;
            if (!fail) return route.fallback();
            return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
                body: JSON.stringify({ error: 'failed', code: 'material.failed', text: 'exit 1' }) });
        });
        await view(page, 'U stolu');
        await act(page, 'attach').click();
        await dialog(page).locator('.ppm-row', { hasText: 'Jan Fíšek' }).click();
        const before = asks;
        await go(page).click();
        await expect(dialog(page).locator('.mdlg-error')).toContainText('The file could not be read from the archive. Nothing was linked.');
        await expect(go(page)).toBeEnabled();
        fail = false;
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Linked to Jan Fíšek.');
        expect(asks - before).toBe(2);
    });
});

// ==================== A TREE FOLLOWED LIVE: LINK TO… OFFERED AS ANYWHERE (1123) ====================

/** Jan's file of the tree in a followed tree (put there for a moment without following; invented). */
async function janTreeFile(page: Page, name: string): Promise<string> {
    return page.evaluate(({ px, name }) => {
        const dm = window.Strom.DataManager;
        const followed = dm.getLiveTreeId();
        const jan = (Object.values(dm.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id;
        dm.setLiveTree(null);
        const id = dm.addAttachment(jan as never, { name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70 } as never)!.id as string;
        dm.setLiveTree(followed);
        return id;
    }, { px: PX, name });
}

async function janModal(page: Page): Promise<void> {
    await page.evaluate(() => {
        const jan = (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id;
        const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
        ui.pushDialog('person-modal');
        ui.showEditPersonModal(jan);
    });
    await expect(page.locator('#person-modal')).toBeVisible();
}

const sectionRow = (page: Page, text: string) => page.locator('#materials-section .material-row:not(.is-skeleton)', { hasText: text });
const itemMenu = (page: Page) => page.locator('#materials-item-menu');

test.describe('Link to… in a tree followed live, as in any tree (1123)', () => {
    test.use({ viewport: DESKTOP });

    test('the person\'s Materials ⋯ offers it for a file of the tree; the dialog says the tree is read-only, End following, then it links', async ({ page }) => {
        const material = fakeMaterial({ files: [], batches: [], people: { ...PEOPLE, P0004: 'Kordula Fíšková' } });
        await followLive(page, material);
        const id = await janTreeFile(page, 'pohlednice.png');
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(true);
        await janModal(page);
        await sectionRow(page, 'pohlednice.png').locator('.material-more').click();
        await expect(itemMenu(page)).toBeVisible();
        await expect(itemMenu(page).locator('[data-action="attach"]')).toHaveText('Link to…');
        // Only Link to… comes back: the other writes of the tree stay hidden while it is followed.
        await expect(itemMenu(page).locator('[data-action="removeFromTree"], [data-action="makeSource"]')).toHaveCount(0);
        await itemMenu(page).locator('[data-action="attach"]').click();
        await expect(dialog(page).locator('.mdlg-sub')).toHaveText('pohlednice.png · in the tree');
        const followed = dialog(page).locator('.mdlg-attach-followed');
        await expect(followed).toContainText('The tree is followed live and is read-only.');
        await dialog(page).locator('.ppm-row', { hasText: 'Anna Svobodová' }).click();
        await expect(go(page)).toBeDisabled();
        await followed.getByRole('button', { name: 'End following' }).click();
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(false);
        await expect(followed).toBeHidden();
        await expect(go(page)).toBeEnabled();
        await go(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Linked to Anna Svobodová.');
        expect(await placesOf(page, id)).toHaveLength(2);
    });

    test('the viewer of a file of the tree offers it (P too), not Create a source… nor Remove from the tree…', async ({ page }) => {
        const material = fakeMaterial({ files: [], batches: [], people: { ...PEOPLE, P0004: 'Kordula Fíšková' } });
        await followLive(page, material);
        await janTreeFile(page, 'pohlednice.png');
        await view(page, 'pohlednice.png');
        await expect(act(page, 'attach')).toHaveText('Link to…');
        await expect(act(page, 'makeSource')).toHaveCount(0);
        await expect(act(page, 'removeFromTree')).toHaveCount(0);
        await page.keyboard.press('p');
        await expect(dialog(page).locator('.mdlg-attach-followed')).toBeVisible();
        await expect(dialog(page).locator('.mdlg-attach-followed').getByRole('button', { name: 'End following' })).toBeVisible();
    });

    test('a locked person still hides it; without following the menu is as before', async ({ page }) => {
        const material = fakeMaterial({ files: [], batches: [], people: { ...PEOPLE, P0004: 'Kordula Fíšková' } });
        await followLive(page, material);
        await janTreeFile(page, 'pohlednice.png');
        await page.evaluate(() => {
            const jan = (Object.values(window.Strom.DataManager.getData().persons) as { firstName: string; isLocked?: boolean }[]).find(p => p.firstName === 'Jan')!;
            jan.isLocked = true;
        });
        await janModal(page);
        await sectionRow(page, 'pohlednice.png').locator('.material-more').click();
        await expect(itemMenu(page)).toBeVisible();
        await expect(itemMenu(page).locator('[data-action="attach"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(itemMenu(page)).toHaveCount(0);
        // Unlocked and not followed: Link to… and Remove from the tree…, as always.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = (Object.values(dm.getData().persons) as { firstName: string; isLocked?: boolean }[]).find(p => p.firstName === 'Jan')!;
            jan.isLocked = false;
            dm.setLiveTree(null);
        });
        await sectionRow(page, 'pohlednice.png').locator('.material-more').click();
        await expect(itemMenu(page).locator('[data-action="attach"]')).toHaveText('Link to…');
        await expect(itemMenu(page).locator('[data-action="removeFromTree"]')).toBeVisible();
    });
});

test.describe('The selection in a tree without an archive (spec 102 §8, O1)', () => {
    test.use({ viewport: DESKTOP });

    /** Three files: a photo at Florimund and Quirinella, a letter at Florimund, a letter at Kasimir. */
    async function three(page: Page): Promise<void> {
        await page.evaluate((px) => {
            const dm = window.Strom.DataManager;
            const add = (pid: string, title: string) => {
                const a = dm.addAttachment(pid as never, { name: `${title}.png`, mimeType: 'image/png', dataUrl: px, sizeBytes: 70 } as never)!;
                dm.setMediaDetails(a.id, { title });
                return a.id as string;
            };
            const photo = add('p1', 'Photo Q');
            dm.addMediaPlace(photo, { personId: 'p2' as never });
            add('p1', 'Letter F');
            add('p3', 'Letter K');
        }, PX);
    }

    async function select(page: Page, titles: string[]): Promise<void> {
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await expect(win(page)).toBeVisible();
        await win(page).locator('[data-mw="select"]').click();
        for (const t of titles) await tile(page, t).first().click();
        await win(page).locator('[data-mw="sel-more"]').click();
    }

    test('Remove from the tree… deletes every selected file in one step, the warning says so; one Undo brings them all back', async ({ page }) => {
        await tree(page);
        await three(page);
        expect(await mediaCount(page)).toBe(3);
        await select(page, ['Photo Q', 'Letter F', 'Letter K']);
        // Hide… is the research's: not offered without one.
        await expect(page.locator('.mw-pop-selMenu [data-action="sel-hide"]')).toHaveCount(0);
        await page.locator('.mw-pop-selMenu [data-action="sel-remove"]').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Delete the files from the tree?');
        await expect(dialog(page).locator('.mdlg-text').first()).toHaveText('3 files are removed from every place in the tree (4) and deleted.');
        await expect(dialog(page).locator('.mdlg-rm-app')).toBeVisible();
        await dialog(page).getByRole('button', { name: 'Delete the files' }).click();
        await expect.poll(() => mediaCount(page)).toBe(0);
        await expect(pill(page).locator('.undo-toast-msg')).toHaveText('Deleted: 3 files.');
        await expect(win(page).locator('.mw-selbar')).toBeHidden();
        await pill(page).locator('.undo-toast-btn').click();
        await expect.poll(() => mediaCount(page)).toBe(3);
    });

    test('Remove from the tree… of files that are evidence of one source: the warning names the source once, in the plural', async ({ page }) => {
        await tree(page);
        await three(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const source = dm.addSource({ title: 'Matrika Quellbach' } as never)!;
            for (const a of Object.values(dm.getData().media ?? {}) as { id: string; title?: string }[]) {
                if (a.title === 'Letter F' || a.title === 'Letter K') dm.addMediaPlace(a.id, { sourceId: source.id } as never);
            }
        });
        await select(page, ['Letter F', 'Letter K']);
        await page.locator('.mw-pop-selMenu [data-action="sel-remove"]').click();
        await expect(dialog(page).locator('.mdlg-warn-title')).toHaveText('The files are referred to by');
        await expect(dialog(page).locator('.mdlg-warn-row')).toHaveCount(1);
        await expect(dialog(page).locator('.mdlg-warn-row[data-use="source"]')).toContainText('Matrika Quellbach');
        await expect(dialog(page).locator('.mdlg-rm-app')).toHaveText('The files are not stored anywhere else. Only Undo or a backup (Export all) brings them back.');
    });

    test('Remove a person… takes the chosen person off the selected files in one step; a file left without a place goes, said first', async ({ page }) => {
        await tree(page);
        await three(page);
        await select(page, ['Photo Q', 'Letter F']);
        await page.locator('.mw-pop-selMenu [data-action="sel-remove-person"]').click();
        await expect(dialog(page).locator('.mdlg-title')).toHaveText('Remove a person from the files');
        // The person on the most files first.
        await expect(dialog(page).locator('.mdlg-radio')).toHaveText(['Florimund Pfefferkorn (2)', 'Quirinella Pfefferkornová (1)']);
        await expect(dialog(page).locator('.mdlg-rm-app')).toHaveText('1 file has no other place in the tree and is deleted.');
        await dialog(page).locator('.mdlg-radio', { hasText: 'Quirinella' }).locator('input').check();
        await expect(dialog(page).locator('.mdlg-rm-app')).toBeHidden();
        await dialog(page).locator('.mdlg-radio', { hasText: 'Florimund' }).locator('input').check();
        await dialog(page).getByRole('button', { name: 'Remove the person' }).click();
        // The photo stays at Quirinella; the letter, only Florimund's, is gone.
        await expect.poll(() => mediaCount(page)).toBe(2);
        const left = await page.evaluate(() => JSON.stringify(Object.values(window.Strom.DataManager.getData().media ?? {})
            .map(a => [(a as { title?: string }).title, (a as { places: { personId?: string }[] }).places.map(p => p.personId)])));
        expect(JSON.parse(left)).toEqual(expect.arrayContaining([['Photo Q', ['p2']], ['Letter K', ['p3']]]));
        await expect(pill(page).locator('.undo-toast-msg')).toContainText('Florimund Pfefferkorn');
        await pill(page).locator('.undo-toast-btn').click();
        await expect.poll(() => mediaCount(page)).toBe(3);
        await expect.poll(() => page.evaluate(() => Object.values(window.Strom.DataManager.getData().media ?? {})
            .find(a => (a as { title?: string }).title === 'Photo Q')?.places.length)).toBe(2);
    });
});

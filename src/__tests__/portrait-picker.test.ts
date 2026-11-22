/**
 * "Portrait from a photo" picker (spec 107): what "Choose photo" opens, the
 * popover and the sheet, a photo chosen in the person dialog and on the
 * person page, and the research's pictures while its bridge comes and goes
 * (§4). On a small DOM of the tests (the picker's markup parsed by a tiny
 * parser below). Invented data (the Novák family).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
    waiting: new Set<string>(),
    queue: { setEnv: () => {}, want: () => {}, urlOf: () => null, isWaiting: () => false },
}));

vi.mock('../ui/portrait-editor.js', () => ({ openPortraitEditor: vi.fn() }));
vi.mock('../material-thumbs.js', async (orig) => ({ ...(await orig<object>()), materialThumbs: () => h.queue }));
vi.mock('../ui/materials-ui.js', async (orig) => ({
    ...(await orig<object>()),
    materialImageWait: (item: { attachment?: { id: string } }) => (item.attachment && h.waiting.has(item.attachment.id) ? 'loading' : 'none'),
}));

import { installMiniDom } from './helpers/mini-dom.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { Attachment, PersonId, StromData, TreeId } from '../types.js';
import { MaterialCaps, MaterialFile, MaterialList, personMaterials } from '../materials.js';
import { setLanguage, strings } from '../strings.js';
import { openPortraitEditor } from '../ui/portrait-editor.js';
import { portraitActionsMethods } from '../ui/portrait-actions-ui.js';
import { portraitPickerMethods, portraitPickerHtml } from '../ui/portrait-picker-ui.js';
import { bottomSheetMethods } from '../ui/bottom-sheet.js';
import { personModalMethods } from '../ui/person-modal.js';
import { personPageMethods } from '../ui/person-page-ui.js';
import { openPhotoModel } from '../ui/person-photo-model.js';

const TREE = 'portrait-picker-tree' as TreeId;
const sha = (n: number) => n.toString(16).padStart(64, '0');

// ---- A tiny HTML parser for the small DOM (the picker's own markup only) ----

type El = HTMLElement & { attrs: Map<string, string> };
const VOID = new Set(['img', 'br', 'input', 'path', 'circle', 'line', 'rect', 'polyline']);
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function parseInto(parent: HTMLElement, html: string): void {
    const stack: HTMLElement[] = [parent];
    const re = /<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
        const top = stack[stack.length - 1];
        if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
        if (m[5] !== undefined) { top.appendChild(document.createTextNode(decode(m[5]))); continue; }
        const el = document.createElement(m[2]);
        for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) el.setAttribute(a[1], decode(a[2] ?? ''));
        top.appendChild(el);
        if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
    }
}

let mini: ReturnType<typeof installMiniDom>;
let coarse = false;
let narrow = false;

function installDom(): void {
    mini = installMiniDom();
    const proto = Object.getPrototypeOf(document.createElement('div'));
    Object.defineProperty(proto, 'innerHTML', {
        configurable: true,
        get() { return ''; },
        set(this: HTMLElement, v: string) { this.replaceChildren(); parseInto(this, v); },
    });
    proto.insertAdjacentHTML = function (this: HTMLElement, _where: string, v: string) { parseInto(this, v); };
    proto.focus = function (this: HTMLElement) { (document as unknown as { activeElement: unknown }).activeElement = this; };
    proto.contains = function (this: Node, n: Node | null) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; };
    proto.getBoundingClientRect = () => ({ left: 300, right: 420, top: 200, bottom: 232, width: 120, height: 32 });
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 372 });
    Object.defineProperty(proto, 'offsetHeight', { configurable: true, get: () => 320 });
    const mm = (q: string) => ({ matches: (coarse && q.includes('coarse')) || (narrow && q.includes('max-width')) });
    const win = Object.assign(new EventTarget(), { matchMedia: mm, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 });
    const g = globalThis as Record<string, unknown>;
    g.window = win;
    g.matchMedia = mm;
    g.requestAnimationFrame = () => 0;
    g.getComputedStyle = () => ({ gridTemplateColumns: '100px 100px 100px' });
}

// ---- The tree and the research ----

function att(id: string, init: Partial<Attachment> = {}): Omit<Attachment, 'id' | 'places'> {
    return { name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${id.toUpperCase()}`, sizeBytes: 10, ...init };
}

function file(n: number, title: string, at: string): MaterialFile {
    return { id: `I${String(n).padStart(4, '0')}`, name: `scan-${n}.jpg`, title, sha: sha(n), mime: 'image/jpeg', persons: ['P0001'], at } as MaterialFile;
}

const LIST: MaterialList = {
    files: [
        file(1, 'Výlet na Pálavu, 1956', '2026-02-01T10:00:00Z'),
        file(2, 'Křtiny Marie, 1926', '2026-01-20T10:00:00Z'),
        file(3, 'Jan na vojně, 1918', '2026-01-05T10:00:00Z'),
    ],
    batches: [], people: {}, fetchedAt: 1,
};

function caps(init: Partial<MaterialCaps> = {}): MaterialCaps {
    return {
        list: true, assign: true, thumb: true, bridgeUp: true, links: false, edit: false, uses: false, sort: false,
        sortRun: false, sourceOf: false, left: false, sameAs: false, delete: false, ...init,
    } as MaterialCaps;
}

let jan: PersonId;
let svatba: string;
let jan50: string;
let ctx: { treeId: string; researchId: string; base: string | null; env: { onComputer: boolean; linked: boolean; bridgeUp: boolean }; caps: MaterialCaps; agent: boolean } | null;
type Ui = Record<string, unknown> & typeof portraitActionsMethods & typeof portraitPickerMethods & {
    currentId: PersonId | null; bottomSheet: HTMLElement | null; pendingPortrait: unknown;
    photoModel: { value: string | null };
    materialWorkingCopy: ReturnType<typeof vi.fn>; showAlert: ReturnType<typeof vi.fn>; portraitIntoPersonModal: ReturnType<typeof vi.fn>;
};
let ui: Ui;

function setBridge(up: boolean, init: Partial<MaterialCaps> = {}): void {
    ctx = {
        treeId: TREE, researchId: 'r1', base: 'http://127.0.0.1:9', agent: true,
        env: { onComputer: !coarse, linked: true, bridgeUp: up },
        caps: caps({ bridgeUp: up, ...init }),
    };
}

function makeUi(): Ui {
    const self = {
        ...bottomSheetMethods, ...portraitActionsMethods, ...portraitPickerMethods,
        currentId: null, bottomSheet: null, bottomSheetOnClose: null, bottomSheetTrigger: null, pendingPortrait: null,
        photoModel: { value: null },
        materialsContext: () => ctx,
        // As the section: the research's list only with a research that lists them, on a computer.
        personMaterialItems: (id: PersonId) => {
            const p = DataManager.getPerson(id)!;
            return personMaterials({ refn: p.refn, attachments: DataManager.personMedia(id) }, ctx?.caps.list && ctx.env.onComputer ? LIST : null);
        },
        pendingPortraitFor: () => null,
        materialWorkingCopy: vi.fn(),
        showAlert: vi.fn(),
        showToast: vi.fn(),
        portraitIntoPersonModal: vi.fn(async () => {}),
        dropImageWait: () => {},
        researchStartUrl: () => 'strom://start',
        researchSyncActionMark: () => 'terminal',
        researchSyncAction: vi.fn(),
        researchNoteMenuWrittenSeen: () => {},
        exportReminderClosed: () => {},
        closeResearchTrialNote: () => {},
    };
    return self as unknown as Ui;
}

function anchorButton(): HTMLElement {
    const b = document.createElement('button');
    b.id = 'photo-choose-btn';
    document.body.appendChild(b);
    return b;
}

const popover = () => document.getElementById('portrait-pick');
const tiles = (root: ParentNode | null = document.body) => Array.from((root as HTMLElement).querySelectorAll('.portrait-pick-tile')) as El[];
const tileOf = (title: string) => tiles().find(t => t.querySelector('.portrait-pick-cap')?.textContent === title)!;
const click = (el: Element) => ui.portraitPickerClick({ target: el } as unknown as MouseEvent);

beforeEach(() => {
    setLanguage('cs');
    coarse = false;
    narrow = false;
    h.waiting.clear();
    installDom();
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
    dm.data = { persons: {}, partnerships: {} };
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
    jan = DataManager.createPerson({ firstName: 'Jan', lastName: 'Novák', gender: 'male' }).id;
    DataManager.updatePerson(jan, { refn: 'P0001' });
    const marie = DataManager.createPerson({ firstName: 'Marie', lastName: 'Nováková', gender: 'female' }).id;
    svatba = DataManager.addAttachment(jan, { ...att('svatba', { title: 'Svatba 1924' }), addedAt: '2026-01-10T10:00:00Z' } as Omit<Attachment, 'id' | 'places'>)!.id;
    DataManager.addMediaPlace(svatba, { personId: marie });
    jan50 = DataManager.addAttachment(jan, { ...att('jan50', { title: 'Jan Novák, 1950' }), addedAt: '2026-03-01T10:00:00Z' } as Omit<Attachment, 'id' | 'places'>)!.id;
    DataManager.updatePerson(jan, { photo: 'data:image/jpeg;base64,PORTRAIT', photoSource: { attachmentId: jan50, region: { x: 0.2, y: 0.1, w: 0.4, h: 0.4 } } });
    UndoManager.clear();
    setBridge(false);
    ui = makeUi();
    vi.mocked(openPortraitEditor).mockReset();
});

afterEach(() => {
    ui?.closePortraitPicker(false);
    mini.uninstall();
    const g = globalThis as Record<string, unknown>;
    delete g.matchMedia;
    delete g.requestAnimationFrame;
    delete g.getComputedStyle;
    setLanguage('en');
    vi.restoreAllMocks();
});

describe('Choose photo', () => {
    it('a person without photos gets the file picker straight away', () => {
        const solo = DataManager.createPerson({ firstName: 'Karel', lastName: 'Novák', gender: 'male' }).id;
        const input = document.createElement('input');
        input.id = 'input-photo';
        const picked = vi.fn();
        (input as unknown as { click: () => void }).click = picked;
        document.body.appendChild(input);
        ui.openPortraitPicker(solo, anchorButton(), { where: 'dialog' });
        expect(picked).toHaveBeenCalledOnce();
        expect(popover()).toBeNull();
        expect(ui.portraitPickerOpen()).toBe(false);
    });

    it('with a mouse over 1024 px: a popover, newest first, the Portrait tag on the photo the portrait is cut from', () => {
        const anchor = anchorButton();
        ui.openPortraitPicker(jan, anchor, { where: 'dialog' });
        const pop = popover()!;
        expect(pop.getAttribute('role')).toBe('dialog');
        expect(pop.getAttribute('aria-label')).toBe('Portrét z fotky');
        expect(anchor.getAttribute('aria-expanded')).toBe('true');
        expect(tiles().map(t => t.querySelector('.portrait-pick-cap')?.textContent)).toEqual(['Jan Novák, 1950', 'Svatba 1924']);
        expect(tileOf('Jan Novák, 1950').querySelector('.portrait-pick-tag')?.textContent).toBe('Portrét');
        expect(tileOf('Jan Novák, 1950').getAttribute('aria-label')).toBe('Jan Novák, 1950, Portrét');
        expect(tileOf('Svatba 1924').getAttribute('aria-label')).toBe('Svatba 1924, a 1 další');
        expect(tileOf('Svatba 1924').getAttribute('title')).toBe('Na fotce také: Marie Nováková');
        expect(pop.querySelector('[data-pick-act="file"]')?.textContent).toBe('Z počítače…');
        // Placed under its button, the focus on the first photo.
        expect(pop.style.top).toBe('236px');
        expect(document.activeElement).toBe(tiles()[0]);
    });

    it('Escape closes it and gives the focus back; its button again closes it', () => {
        const anchor = anchorButton();
        ui.openPortraitPicker(jan, anchor, { where: 'dialog' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(popover()).toBeNull();
        expect(document.activeElement).toBe(anchor);
        expect(anchor.hasAttribute('aria-expanded')).toBe(false);
        ui.openPortraitPicker(jan, anchor, { where: 'dialog' });
        ui.openPortraitPicker(jan, anchor, { where: 'dialog' });
        expect(popover()).toBeNull();
    });

    it('on touch: a sheet with the name as its title and "From this device…"', () => {
        coarse = true;
        setBridge(false);
        ui.openPortraitPicker(jan, anchorButton(), { where: 'page' });
        expect(popover()).toBeNull();
        const sheet = document.querySelector('.portrait-pick-sheet')!;
        expect(sheet.querySelector('.bottom-sheet-menu-title')?.textContent).toContain('Jan');
        expect(tiles(sheet)).toHaveLength(2);
        expect(sheet.querySelector('[data-pick-act="file"]')?.textContent).toBe('Ze zařízení…');
        ui.closePortraitPicker(false);
        expect(document.querySelector('.portrait-pick-sheet')).toBeNull();
    });

    it('arrows move between the photos', () => {
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        const [first, second] = tiles();
        ui.portraitPickerKeydown({ key: 'ArrowRight', target: first, preventDefault: () => {} } as unknown as KeyboardEvent);
        expect(document.activeElement).toBe(second);
        expect(second.getAttribute('tabindex')).toBe('0');
        expect(first.getAttribute('tabindex')).toBe('-1');
    });
});

describe('a photo chosen', () => {
    it("of the tree, in the open dialog: the editor's portrait waits for Save at the dialog, nothing written", async () => {
        const modal = document.createElement('div');
        modal.id = 'person-modal';
        modal.className = 'active';
        document.body.appendChild(modal);
        ui.currentId = jan;
        ui.photoModel.value = 'data:image/jpeg;base64,PORTRAIT';
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        click(tileOf('Svatba 1924'));
        await vi.waitFor(() => expect(ui.portraitIntoPersonModal).toHaveBeenCalled());
        expect(ui.portraitIntoPersonModal).toHaveBeenCalledWith(expect.objectContaining({ source: 'data:image/jpeg;base64,SVATBA', origin: { attachmentId: svatba }, replace: true }));
        // Not the photo the portrait is cut from: the editor starts by itself.
        expect(ui.portraitIntoPersonModal.mock.calls[0][0]).not.toHaveProperty('initial');
        expect(popover()).toBeNull();
        expect(UndoManager.canUndo()).toBe(false);
    });

    it("the portrait's own photo starts the editor at its crop", async () => {
        const modal = document.createElement('div');
        modal.id = 'person-modal';
        modal.className = 'active';
        document.body.appendChild(modal);
        ui.currentId = jan;
        ui.photoModel.value = 'data:image/jpeg;base64,PORTRAIT';
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        click(tileOf('Jan Novák, 1950'));
        await vi.waitFor(() => expect(ui.portraitIntoPersonModal).toHaveBeenCalled());
        expect(ui.portraitIntoPersonModal.mock.calls[0][0].initial).toEqual({ region: { x: 0.2, y: 0.1, w: 0.4, h: 0.4 } });
    });

    it('on the person page: written at once, one undo step naming the photo', async () => {
        vi.mocked(openPortraitEditor).mockResolvedValue({ steps: [{ photo: 'data:image/jpeg;base64,NEW', crop: { region: { x: 0, y: 0, w: 0.5, h: 0.5 } } }] } as never);
        ui.openPortraitPicker(jan, anchorButton(), { where: 'page' });
        click(tileOf('Svatba 1924'));
        await vi.waitFor(() => expect(DataManager.getPerson(jan)!.photo).toBe('data:image/jpeg;base64,NEW'));
        expect(DataManager.getPerson(jan)!.photoSource).toMatchObject({ attachmentId: svatba, region: { x: 0, y: 0, w: 0.5, h: 0.5 } });
        DataManager.undo();
        expect(DataManager.getPerson(jan)!.photo).toBe('data:image/jpeg;base64,PORTRAIT');
        expect(UndoManager.canUndo()).toBe(false);
    });
});

describe('portraitPickerModel', () => {
    it('only pictures a portrait can be cut from: no PDF, TIFF, original-only, hidden or family tree file; a file the sorting found is in', () => {
        DataManager.addAttachment(jan, att('list', { name: 'list.pdf', mimeType: 'application/pdf' }));
        DataManager.addAttachment(jan, att('orig', { originalOnly: true, dataUrl: '' }));
        const extra: MaterialFile[] = [
            { ...file(4, 'Sken.tif', '2026-01-01T00:00:00Z'), mime: 'image/tiff', name: 'scan-4.tif' },
            { ...file(5, 'Skrytá', '2026-01-01T00:00:00Z'), hidden: {} },
            { ...file(6, 'Rodokmen', '2026-01-01T00:00:00Z'), tree: true },
            { ...file(7, 'Rodina před domem, 1935', '2026-01-02T00:00:00Z'), persons: [], sorted: { persons: ['P0001'] } },
        ];
        LIST.files.push(...extra);
        try {
            setBridge(true);
            const titles = ui.portraitPickerModel(jan).shown.map(c => c.title);
            expect(titles).toEqual(['Jan Novák, 1950', 'Výlet na Pálavu, 1956', 'Křtiny Marie, 1926', 'Svatba 1924', 'Jan na vojně, 1918', 'Rodina před domem, 1935']);
        } finally {
            LIST.files.splice(3);
        }
    });

    it('a person who may not be edited: nothing opens', () => {
        vi.spyOn(DataManager, 'isPersonLocked').mockReturnValue(true);
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        expect(popover()).toBeNull();
    });

    it('bridge down and only research photos: the picker opens with the sentence alone', () => {
        const karel = DataManager.createPerson({ firstName: 'Karel', lastName: 'Novák', gender: 'male' }).id;
        DataManager.updatePerson(karel, { refn: 'P0001' });
        DataManager.updatePerson(jan, { refn: 'P0002' });
        ui.openPortraitPicker(karel, anchorButton(), { where: 'dialog' });
        expect(tiles()).toHaveLength(0);
        expect(popover()!.querySelector('.portrait-pick-note')?.textContent).toContain('(3)');
    });
});

describe('the research and its bridge (§4)', () => {
    it('bridge down: the tree photos and the sentence with the count and Start research', () => {
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        expect(tiles()).toHaveLength(2);
        const note = popover()!.querySelector('.portrait-pick-note')!;
        expect(note.getAttribute('role')).toBe('note');
        expect(note.textContent).toContain('Fotky z výzkumu (3) jsou dostupné, když výzkum běží.');
        const start = note.querySelector('[data-pick-act="start"]')!;
        // The label with the terminal mark of its group (the research opens its terminal).
        expect(start.textContent).toBe('Spustit výzkum, otevře se ve výzkumu');
        expect(start.querySelector('.research-open-mark')).not.toBeNull();
        click(note.querySelector('[data-pick-act="start"]')!);
        expect(ui.researchSyncAction).toHaveBeenCalledWith('startResearch');
    });

    it('bridge up: all five photos by date, no sentence; the bridge going away while open redraws', () => {
        setBridge(true);
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        expect(tiles().map(t => t.querySelector('.portrait-pick-cap')?.textContent)).toEqual([
            'Jan Novák, 1950', 'Výlet na Pálavu, 1956', 'Křtiny Marie, 1926', 'Svatba 1924', 'Jan na vojně, 1918',
        ]);
        expect(popover()!.querySelector('.portrait-pick-note')).toBeNull();
        setBridge(false);
        ui.renderPortraitPicker();
        expect(tiles()).toHaveLength(2);
        expect(popover()!.querySelector('.portrait-pick-note')?.textContent).toContain('(3)');
        setBridge(true);
        ui.renderPortraitPicker();
        expect(tiles()).toHaveLength(5);
    });

    it('an older research (no list) or touch: the tree photos only, no sentence', () => {
        setBridge(true, { list: false });
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        expect(tiles()).toHaveLength(2);
        expect(popover()!.querySelector('.portrait-pick-note')).toBeNull();
        ui.closePortraitPicker(false);
        coarse = true;
        setBridge(true);
        ui.openPortraitPicker(jan, anchorButton(), { where: 'page' });
        expect(tiles()).toHaveLength(2);
        expect(document.querySelector('.portrait-pick-note')).toBeNull();
    });

    it("a research picture: the picker stays open while it comes; not come, it says so with Try again", async () => {
        setBridge(true);
        let answer: (v: unknown) => void = () => {};
        ui.materialWorkingCopy.mockImplementation(() => new Promise(r => { answer = r; }));
        const useLink = vi.fn(async () => {});
        (ui as Record<string, unknown>).useMaterialLink = useLink;
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        click(tileOf('Výlet na Pálavu, 1956'));
        expect(tileOf('Výlet na Pálavu, 1956').getAttribute('aria-busy')).toBe('true');
        expect(popover()!.querySelector('.portrait-pick-status')?.textContent).toContain('Načítá se fotka z výzkumu…');
        answer(null);
        await vi.waitFor(() => expect(popover()!.querySelector('.portrait-pick-status.is-err')).not.toBeNull());
        expect(popover()!.querySelector('.portrait-pick-status.is-err')?.textContent).toContain('Fotku se nepodařilo načíst.');
        expect(tileOf('Výlet na Pálavu, 1956').querySelector('.portrait-pick-img.is-failed')).not.toBeNull();
        expect(ui.showAlert).not.toHaveBeenCalled();
        expect(vi.mocked(openPortraitEditor)).not.toHaveBeenCalled();
        // Try again: asked again, and this time it comes.
        const record = { name: 'scan-1.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,PALAVA', sizeBytes: 9 };
        ui.materialWorkingCopy.mockResolvedValue(record);
        click(popover()!.querySelector('[data-pick-act="retry"]')!);
        await vi.waitFor(() => expect(useLink).toHaveBeenCalled());
        expect(ui.materialWorkingCopy).toHaveBeenCalledTimes(2);
        expect(useLink).toHaveBeenCalledWith(jan, { record }, {});
        expect(popover()).toBeNull();
    });

    it('another photo chosen meanwhile drops the first answer', async () => {
        setBridge(true);
        const answers: Array<(v: unknown) => void> = [];
        ui.materialWorkingCopy.mockImplementation(() => new Promise(r => { answers.push(r); }));
        const useLink = vi.fn(async () => {});
        (ui as Record<string, unknown>).useMaterialLink = useLink;
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        click(tileOf('Výlet na Pálavu, 1956'));
        click(tileOf('Křtiny Marie, 1926'));
        answers[0]({ name: 'a.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,A', sizeBytes: 1 });
        await Promise.resolve();
        await Promise.resolve();
        expect(useLink).not.toHaveBeenCalled();
        expect(tileOf('Křtiny Marie, 1926').getAttribute('aria-busy')).toBe('true');
        answers[1]({ name: 'b.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,B', sizeBytes: 1 });
        await vi.waitFor(() => expect(useLink).toHaveBeenCalledOnce());
        expect((useLink.mock.calls[0] as unknown[])[1]).toEqual({ record: expect.objectContaining({ dataUrl: 'data:image/jpeg;base64,B' }) });
    });

    it('a busy tile whose bridge went away did not come', () => {
        setBridge(true);
        ui.materialWorkingCopy.mockImplementation(() => new Promise(() => {}));
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        click(tileOf('Výlet na Pálavu, 1956'));
        setBridge(false);
        ui.renderPortraitPicker();
        expect(popover()!.querySelector('.portrait-pick-status.is-err')).not.toBeNull();
        expect(tiles()).toHaveLength(2);
    });

    it("a tree file still on its way: shown waiting, its click opens nothing", async () => {
        h.waiting.add(svatba);
        ui.openPortraitPicker(jan, anchorButton(), { where: 'dialog' });
        const tile = tileOf('Svatba 1924');
        expect(tile.getAttribute('aria-disabled')).toBe('true');
        expect(tile.classList.contains('is-waiting')).toBe(true);
        expect(tile.querySelector('[data-img-state="loading"]')).not.toBeNull();
        click(tile);
        await ui.pickPortraitCandidate(jan, tile.dataset.key!);
        expect(ui.portraitIntoPersonModal).not.toHaveBeenCalled();
        expect(vi.mocked(openPortraitEditor)).not.toHaveBeenCalled();
        expect(popover()).not.toBeNull();
        // It came: the tile can be chosen.
        h.waiting.clear();
        window.dispatchEvent(new Event('strom:images-arrived'));
        expect(tileOf('Svatba 1924').getAttribute('aria-disabled')).toBeNull();
    });
});

describe('portraitPickerHtml', () => {
    it('in English: From the computer…, the count in the header', () => {
        setLanguage('en');
        const html = portraitPickerHtml({ sheet: false, touch: false, model: { shown: [], researchOnly: 2 }, busy: null, failed: null, start: null });
        expect(html).toContain('Portrait from a photo');
        expect(html).toContain('From the computer…');
        expect(html).toContain('Photos from the research (2) are available while the research runs.');
        expect(html).not.toContain('data-pick-act="start"');
        expect(strings.portrait.others(3)).toBe('and 3 more');
    });
});

// ---- "Portrait from a photo…" at a person without a portrait (§2) ----

/** The person dialog's header and photo section, as index.html has them. */
function dialogHeader(context = 'Upravit osobu'): { avatar: HTMLButtonElement; link: HTMLElement; sep: HTMLElement; row: HTMLElement; preview: HTMLElement } {
    const modal = document.createElement('div');
    modal.id = 'person-modal';
    modal.className = 'active';
    const avatar = document.createElement('button') as HTMLButtonElement;
    avatar.id = 'pm-avatar';
    (avatar as unknown as { disabled: boolean }).disabled = true;
    const row = document.createElement('div');
    const ctxEl = document.createElement('span');
    ctxEl.id = 'modal-title';
    ctxEl.textContent = context;
    const sep = document.createElement('span');
    sep.id = 'pm-portrait-sep';
    sep.hidden = true;
    const link = document.createElement('button');
    link.id = 'pm-portrait-link';
    link.hidden = true;
    row.append(ctxEl, sep, link);
    const preview = document.createElement('div');
    preview.id = 'photo-preview';
    modal.append(avatar, row, preview);
    document.body.appendChild(modal);
    return { avatar, link, sep, row, preview };
}

describe('Portrait from a photo… (§2)', () => {
    const offer = () => personModalMethods.updatePortraitOffer.call(ui as never);
    const offerUi = () => Object.assign(ui, {
        choosePersonPhoto: (a: HTMLElement) => personModalMethods.choosePersonPhoto.call(ui as never, a),
    });

    it('a person without a portrait with a JPEG at them: the link, the header circle and the empty preview open the picker', () => {
        const karel = DataManager.createPerson({ firstName: 'Karel', lastName: 'Novák', gender: 'male' }).id;
        DataManager.addAttachment(karel, att('pole', { title: 'Na poli, 1931' }) as Omit<Attachment, 'id' | 'places'>);
        const el = dialogHeader();
        offerUi();
        ui.currentId = karel;
        ui.photoModel = openPhotoModel(karel, undefined) as never;
        offer();
        expect(el.link.hidden).toBe(false);
        expect(el.sep.hidden).toBe(false);
        expect(el.avatar.disabled).toBe(false);
        expect(el.avatar.getAttribute('aria-label')).toBe('Portrét z fotky…');
        expect(el.avatar.getAttribute('aria-hidden')).toBeNull();
        expect(el.preview.classList.contains('is-pick')).toBe(true);
        expect(el.preview.getAttribute('role')).toBe('button');
        expect(el.preview.getAttribute('aria-label')).toBe('Vybrat fotku');
        // Enter on the preview: the picker under it.
        personModalMethods.photoPreviewPick.call(ui as never, { currentTarget: el.preview, key: 'Enter', preventDefault: () => {} } as unknown as Event);
        expect(ui.portraitPickerOpen(karel)).toBe(true);
        expect(el.preview.getAttribute('aria-expanded')).toBe('true');
    });

    it('a person with a portrait: nothing; Remove brings the link (photos at them)', () => {
        const el = dialogHeader();
        offerUi();
        Object.assign(ui, {
            showPhotoModel: () => personModalMethods.updatePortraitOffer.call(ui as never),
            renderAttachmentsList: () => {},
        });
        ui.currentId = jan;
        ui.photoModel = openPhotoModel(jan, DataManager.getPerson(jan)!.photo) as never;
        offer();
        expect(el.link.hidden).toBe(true);
        expect(el.sep.hidden).toBe(true);
        expect(el.avatar.disabled).toBe(true);
        expect(el.avatar.getAttribute('aria-hidden')).toBe('true');
        personModalMethods.removePersonPhoto.call(ui as never);
        expect(el.link.hidden).toBe(false);
        expect(el.avatar.disabled).toBe(false);
    });

    it('without a context line the link stands alone (no separator)', () => {
        DataManager.updatePerson(jan, { photo: undefined, photoSource: undefined });
        const el = dialogHeader('');
        ui.currentId = jan;
        ui.photoModel = openPhotoModel(jan, undefined) as never;
        offer();
        expect(el.link.hidden).toBe(false);
        expect(el.sep.hidden).toBe(true);
        expect(el.row.hidden).toBe(false);
    });

    it('only a PDF: nothing; only research photos with the bridge down: nothing', () => {
        const karel = DataManager.createPerson({ firstName: 'Karel', lastName: 'Novák', gender: 'male' }).id;
        DataManager.addAttachment(karel, att('dopis', { name: 'dopis.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,AA' }) as Omit<Attachment, 'id' | 'places'>);
        const el = dialogHeader();
        ui.currentId = karel;
        ui.photoModel = openPhotoModel(karel, undefined) as never;
        offer();
        expect(el.link.hidden).toBe(true);
        expect(el.avatar.disabled).toBe(true);
        expect(el.preview.classList.contains('is-pick')).toBe(false);

        // Karel named in the research's three pictures, the bridge down: the picker would show only the sentence.
        DataManager.updatePerson(jan, { refn: 'P0009' });
        DataManager.updatePerson(karel, { refn: 'P0001' });
        expect(ui.portraitPickerModel(karel)).toMatchObject({ shown: [], researchOnly: 3 });
        offer();
        expect(el.link.hidden).toBe(true);
        // The bridge up: they can be offered.
        setBridge(true);
        offer();
        expect(el.link.hidden).toBe(false);
    });

    it("the person page: the initials and the link only for a person without a portrait who has photos; Change portrait… only with a portrait", () => {
        const page = (id: PersonId) => personPageMethods.personPagePortraitPick.call(ui as never, id);
        const change = (id: PersonId) => personPageMethods.personPageCanChangePortrait.call(ui as never, id);
        expect(page(jan)).toBe(false);
        expect(change(jan)).toBe(true);
        const karel = DataManager.createPerson({ firstName: 'Karel', lastName: 'Novák', gender: 'male' }).id;
        expect(page(karel)).toBe(false);
        expect(change(karel)).toBe(false);
        DataManager.addAttachment(karel, att('pole') as Omit<Attachment, 'id' | 'places'>);
        expect(page(karel)).toBe(true);
        expect(change(karel)).toBe(false);
        vi.spyOn(DataManager, 'isPersonLocked').mockReturnValue(true);
        expect(page(karel)).toBe(false);
        expect(change(jan)).toBe(false);
    });
});

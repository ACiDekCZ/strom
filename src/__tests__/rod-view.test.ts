/**
 * The family line chosen in the tree view (spec 039 §0, §3, §4.4): one state,
 * remembered per tree, covered by another highlighted group and back when
 * that one ends, let go when the line is gone; the focus moves only when no
 * member is drawn. Fictional trees only: every name below is invented.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildLineages, rodOf, RodId, LineageIndex } from '../lineage.js';
import { rodFocusTarget } from '../rod-focus.js';
import { rodPickerHtml, rodPickerItems, rodPickerSmallItems } from '../rod-picker.js';
import { StromData, PersonId, Person, Partnership, PartnershipId } from '../types.js';
import { DataManager } from '../data.js';
import { SettingsManager } from '../settings.js';
import { TreeRenderer } from '../renderer.js';
import { evidenceUiMethods } from '../ui/evidence-ui.js';
import {
    clearRodSelection, getSelectedRod, onRodSelectionChange, resetRodView, rodBack, rodViewDataChanged, setRodSelection, setRodViewHost,
} from '../ui/rod-view.js';

type Sex = 'male' | 'female';
interface Spec { first: string; last: string; sex: Sex; born?: string; parents?: string[] }

function tree(people: Record<string, Spec>, unions: [string, string, string, string[]][]): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: id as PersonId, firstName: s.first, lastName: s.last, gender: s.sex, isPlaceholder: false,
            partnerships: [], parentIds: (s.parents ?? []) as PersonId[], childIds: [], birthDate: s.born,
        } as Person;
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, a, b, kids] of unions) {
        partnerships[uid] = { id: uid as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' };
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
    }
    return { version: 13, persons, partnerships } as StromData;
}

// The Brumlák line (Hostivít's) and the Trnkavec family Radoslava married into.
const brumlak = (): StromData => tree({
    hostivit: { first: 'Hostivít', last: 'Brumlák', sex: 'male', born: '1800' },
    dobromila: { first: 'Dobromila', last: 'Čmeldová', sex: 'female', born: '1803' },
    borivoj: { first: 'Bořivoj', last: 'Brumlák', sex: 'male', born: '1830', parents: ['hostivit', 'dobromila'] },
    radoslava: { first: 'Radoslava', last: 'Brumláková', sex: 'female', born: '1832', parents: ['hostivit', 'dobromila'] },
    lubomira: { first: 'Lubomíra', last: 'Kopýtková', sex: 'female', born: '1834' },
    spytihnev: { first: 'Spytihněv', last: 'Trnkavec', sex: 'male', born: '1828' },
    bozetech: { first: 'Božetěch', last: 'Brumlák', sex: 'male', born: '1860', parents: ['borivoj', 'lubomira'] },
    bolemir: { first: 'Bolemír', last: 'Trnkavec', sex: 'male', born: '1858', parents: ['spytihnev', 'radoslava'] },
    vratislav: { first: 'Vratislav', last: 'Ořechovský', sex: 'male', born: '1900' },
}, [
    ['u1', 'hostivit', 'dobromila', ['borivoj', 'radoslava']],
    ['u2', 'borivoj', 'lubomira', ['bozetech']],
    ['u3', 'spytihnev', 'radoslava', ['bolemir']],
]);

const P = (id: string): PersonId => id as PersonId;
const rodIdOf = (idx: LineageIndex, id: string): RodId => rodOf(idx, P(id))!;

describe('the focus move of a chosen line (§4.4)', () => {
    const idx = buildLineages(brumlak());
    const rod = rodIdOf(idx, 'hostivit');

    it('a member in the drawing: the focus stays (a spouse who married in does not count)', () => {
        expect(rodFocusTarget(idx, rod, P('bolemir'), new Set([P('bolemir'), P('radoslava')]), 'family')).toBeNull();
        expect(rodFocusTarget(idx, rod, P('spytihnev'), new Set([P('spytihnev'), P('lubomira')]), 'family')).not.toBeNull();
    });

    it('none drawn: the nearest member over parents, children and partners', () => {
        expect(rodFocusTarget(idx, rod, P('bolemir'), new Set([P('bolemir'), P('spytihnev')]), 'family')).toBe(P('radoslava'));
        expect(rodFocusTarget(idx, rod, P('spytihnev'), new Set([P('spytihnev')]), 'fan')).toBe(P('radoslava'));
    });

    it('a tie: the member born first', () => {
        // Lubomíra: her husband Bořivoj (1830) and her son Božetěch (1860), one step each.
        expect(rodFocusTarget(idx, rod, P('lubomira'), new Set([P('lubomira')]), 'family')).toBe(P('borivoj'));
    });

    it('Descendants: the founder; a line not connected to the focus: the founder', () => {
        expect(rodFocusTarget(idx, rod, P('bolemir'), new Set([P('bolemir')]), 'descendants')).toBe(P('hostivit'));
        expect(rodFocusTarget(idx, rod, P('vratislav'), new Set([P('vratislav')]), 'family')).toBe(P('hostivit'));
    });
});

/** SettingsManager over a stubbed storage. */
function stubSettings(): void {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
    const sm = SettingsManager as unknown as { settings: Record<string, unknown>; load(): void };
    sm.settings = { theme: 'system', language: 'system', encryption: false, auditLog: false };
    sm.load();
}

describe('the chosen line: one state, per tree, covered and back (§0, §3)', () => {
    let treeId = 'lhota';
    let data: StromData = brumlak();
    const trees: Record<string, StromData> = {};
    let ui: typeof evidenceUiMethods & Record<string, unknown>;
    const moves: RodId[] = [];
    let rod: RodId;

    beforeEach(() => {
        stubSettings();
        vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
        vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
        trees.lhota = brumlak();
        trees.kvetov = tree({ ozren: { first: 'Ozřen', last: 'Pecivál', sex: 'male', born: '1790' } }, []);
        treeId = 'lhota';
        data = trees.lhota;
        vi.spyOn(DataManager, 'getCurrentTreeId').mockImplementation(() => treeId as never);
        vi.spyOn(DataManager, 'getData').mockImplementation(() => data);
        vi.spyOn(DataManager, 'isLocked').mockImplementation(() => false);
        vi.spyOn(TreeRenderer, 'setEvidenceHighlight').mockImplementation(() => {});
        vi.spyOn(TreeRenderer, 'setEvidenceLevels').mockImplementation(() => {});
        resetRodView();
        moves.length = 0;
        ui = { ...evidenceUiMethods, renderEvidencePill() {}, showToast() {}, openRodPicker() {} } as never;
        setRodViewHost({
            highlightGroup: (g) => ui.highlightGroup.call(ui as never, g),
            evidenceHighlightKind: () => ui.evidenceHighlightKind.call(ui as never),
            isEvidenceHighlightOn: () => ui.isEvidenceHighlightOn.call(ui as never),
            endEvidenceHighlight: () => ui.endEvidenceHighlight.call(ui as never),
            moveFocusToRod: (id) => { moves.push(id); },
            rodViewChanged: () => {},
        });
        rod = rodIdOf(buildLineages(data), 'hostivit');
    });

    afterEach(() => {
        ui.endEvidenceHighlight.call(ui as never);
        resetRodView();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const kind = () => ui.evidenceHighlightKind.call(ui as never);
    const dismiss = () => (ui.dismissEvidenceHighlight as () => void).call(ui);

    it('set and clear: highlighted, remembered for the tree, the focus moved; clear forgets it', () => {
        const seen: (RodId | null)[] = [];
        onRodSelectionChange(id => seen.push(id));
        setRodSelection(rod, 'picker');
        expect(getSelectedRod()).toBe(rod);
        expect(kind()).toBe('rod');
        expect(SettingsManager.getRodForTree('lhota')).toBe(rod);
        expect(moves).toEqual([rod]);
        clearRodSelection();
        expect(getSelectedRod()).toBeNull();
        expect(kind()).toBeNull();
        expect(SettingsManager.getRodForTree('lhota')).toBeNull();
        expect(seen).toEqual([rod, null]);
    });

    it('a line not in the tree: no choice', () => {
        setRodSelection('nonexistent', 'picker');
        expect(getSelectedRod()).toBeNull();
        expect(kind()).toBeNull();
    });

    it('per tree: another tree brings its own; back in the first tree its line is put back without a focus move', () => {
        setRodSelection(rod, 'picker');
        moves.length = 0;
        treeId = 'kvetov';
        data = trees.kvetov;
        rodViewDataChanged();
        expect(getSelectedRod()).toBeNull();
        expect(kind()).toBeNull();
        treeId = 'lhota';
        data = trees.lhota;
        rodViewDataChanged();
        expect(getSelectedRod()).toBe(rod);
        expect(kind()).toBe('rod');
        expect(moves).toEqual([]);
    });

    it('from memory at the start, also when the tree\'s data comes after its id (locked, then read)', () => {
        SettingsManager.setRodForTree('lhota', rod);
        data = tree({}, []);
        vi.spyOn(DataManager, 'isLocked').mockImplementation(() => true);
        expect(getSelectedRod()).toBeNull();
        expect(SettingsManager.getRodForTree('lhota')).toBe(rod);
        vi.spyOn(DataManager, 'isLocked').mockImplementation(() => false);
        data = trees.lhota;
        rodViewDataChanged();
        expect(getSelectedRod()).toBe(rod);
        expect(kind()).toBe('rod');
        expect(moves).toEqual([]);
    });

    it('a line gone after a change: let go without a word, forgotten', () => {
        setRodSelection(rod, 'picker');
        const toast = vi.fn();
        ui.showToast = toast;
        // The line's people removed (another tree object, as after an undo or an import).
        data = tree({ bolemir: { first: 'Bolemír', last: 'Trnkavec', sex: 'male', born: '1858' } }, []);
        ui.refreshEvidenceHighlight.call(ui as never);
        expect(getSelectedRod()).toBeNull();
        expect(kind()).toBeNull();
        expect(SettingsManager.getRodForTree('lhota')).toBeNull();
        expect(toast).not.toHaveBeenCalled();
    });

    it('another group covers the line; its × brings the line back; × on the line forgets it', () => {
        setRodSelection(rod, 'picker');
        ui.highlightGroup.call(ui as never, {
            kind: 'lineEnds', title: (n: number) => `Line ends: ${n}`, personIds: [P('bozetech')], recount: null, cite: false,
        });
        expect(kind()).toBe('lineEnds');
        expect(getSelectedRod()).toBe(rod);
        dismiss();
        expect(kind()).toBe('rod');
        expect(getSelectedRod()).toBe(rod);
        dismiss();
        expect(kind()).toBeNull();
        expect(getSelectedRod()).toBeNull();
        expect(SettingsManager.getRodForTree('lhota')).toBeNull();
    });

    it('a line chosen while another group is shown ends that group; a restore under it waits', () => {
        ui.highlightGroup.call(ui as never, {
            kind: 'lineEnds', title: (n: number) => `${n}`, personIds: [P('bozetech')], recount: null, cite: false,
        });
        setRodSelection(rod, 'picker');
        expect(kind()).toBe('rod');
        ui.highlightGroup.call(ui as never, {
            kind: 'lineEnds', title: (n: number) => `${n}`, personIds: [P('bozetech')], recount: null, cite: false,
        });
        setRodSelection(rod, 'restore');
        expect(kind()).toBe('lineEnds');
        ui.endEvidenceHighlight.call(ui as never);
        expect(kind()).toBe('rod');
    });

    it('"Back to overview" only from the overview, in memory only', () => {
        const back = vi.fn();
        setRodSelection(rod, 'overview', { back });
        expect(rodBack()).toBe(back);
        expect(SettingsManager.getRodForTree('lhota')).toBe(rod);
        setRodSelection(rod, 'picker');
        expect(rodBack()).toBeNull();
        setRodSelection(rod, 'overview', { back });
        // Loaded again: the line from memory, without "Back to overview".
        treeId = 'kvetov';
        rodViewDataChanged();
        treeId = 'lhota';
        rodViewDataChanged();
        expect(getSelectedRod()).toBe(rod);
        expect(rodBack()).toBeNull();
    });
});

describe('the toolbar\'s choice of lines (§1.3, §1.4)', () => {
    // A large line (5 real members) and a small one.
    const data = tree({
        a: { first: 'Kvido', last: 'Hrachovec', sex: 'male', born: '1700' },
        aw: { first: 'Běla', last: 'Pšeničná', sex: 'female', born: '1702' },
        b: { first: 'Lubor', last: 'Hrachovec', sex: 'male', born: '1730', parents: ['a', 'aw'] },
        c: { first: 'Milota', last: 'Hrachovec', sex: 'male', born: '1732', parents: ['a', 'aw'] },
        d: { first: 'Radim', last: 'Hrachovec', sex: 'male', born: '1734', parents: ['a', 'aw'] },
        e: { first: 'Soběslav', last: 'Hrachovec', sex: 'male', born: '1736', parents: ['a', 'aw'] },
        f: { first: 'Jaromír', last: 'Ječmínek', sex: 'male', born: '1760' },
        fw: { first: 'Vlasta', last: 'Prosná', sex: 'female', born: '1762' },
        g: { first: 'Dalibor', last: 'Ječmínek', sex: 'male', born: '1790', parents: ['f', 'fw'] },
    }, [['u1', 'a', 'aw', ['b', 'c', 'd', 'e']], ['u2', 'f', 'fw', ['g']]]);
    const idx = buildLineages(data);
    const items = rodPickerItems(idx);
    const small = rodPickerSmallItems(idx, 'cs');
    const texts = { prefix: 'Rod', all: 'Rody', wholeTree: 'Celý strom', other: 'Další rodiny', placeholder: '…', none: '–', label: 'Zvolit rod', members: (n: number) => `${n}` };
    const html = (current: RodId | null, otherMode?: 'link' | 'expand') => rodPickerHtml({
        items, small, current, treeTitle: 'Lhota', lo: 1650, hi: 2030, texts, otherMode,
        link: (_i, inner, cls) => `<button class="${cls}">${inner}</button>`,
    });

    it('expand: "Other families" a button, the small lines under it; the whole tree current without a choice', () => {
        expect(small.length).toBeGreaterThan(0);
        const h = html(null, 'expand');
        expect(h).toContain('class="sp-rodpick-x" aria-expanded="false"');
        expect(h).toContain(`class="sp-rodpick-small" data-rod="${small[0].id}"`);
        expect(h).toMatch(/class="sp-rodpick-tree" data-rod="tree" aria-current="true"/);
    });

    it('a small line chosen: named on the button and marked in the list', () => {
        const h = html(small[0].id as RodId, 'expand');
        expect(h).toContain(`<b>${small[0].label}</b>`);
        expect(h).toContain('sp-rodpick-small is-cur');
    });

    it('link (the tree pages): unchanged, no small lines, no current whole tree', () => {
        const h = html(null);
        expect(h).not.toContain('sp-rodpick-x');
        expect(h).not.toContain('sp-rodpick-small');
        expect(h).not.toMatch(/data-rod="tree" aria-current/);
    });
});

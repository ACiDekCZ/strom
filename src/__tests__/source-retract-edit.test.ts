/**
 * Deleting a source in edit mode (spec 117 §4): which dialog the app offers,
 * the header lines `_STROM_SOURCE_DELETED` of a file for the research (only
 * with the gate, only for sources the file really lacks), the memory of them
 * forgotten after Undo and after the research's `retracted`, and the rows and
 * reasons of "What was written". Invented data.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import {
    deletedSourcesBack, deletedSourcesToSend, forgetDeletedSourcesBack, setSourceRetractLookup, sourceRetractEditModeIn,
    withoutDeletedSources, SOURCE_RETRACT_FEATURE,
} from '../source-retract.js';
import { researchHeaderLines, sanitizeSends, sanitizeSyncReply, SOURCE_DELETED_MOST } from '../research-link.js';
import { exportToGedcom } from '../ged-exporter.js';
import { createEmptyData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { diffOther, sanitizeSentOtherRow, sentOtherRows, withRetractedRows, type NotWrittenItem } from '../research-changes.js';
import { getStringsForLang, setLanguage } from '../strings.js';
import type { Source, StromData, TreeId, TreeMetadata } from '../types.js';

function withSources(...list: Partial<Source>[]): StromData {
    const data = createEmptyData();
    data.sources = Object.fromEntries(list.map((s, i) => [s.id ?? `src_${i}`, { id: s.id ?? `src_${i}`, title: `Matrika Vellmoor ${i}`, ...s } as Source]));
    return data;
}

const RID = '0f1e2d3c-4b5a-4697-8877-665544332211';
const headerOf = (ged: string) => ged.split('\n0 ')[0].split('\n');

afterEach(() => {
    vi.restoreAllMocks();
    setSourceRetractLookup(() => null);
});

describe('the header lines of a file for the research', () => {
    it('one `_STROM_SOURCE_DELETED` per id right after `_STROM_HEAD`, only research ids, each once, at most 50', () => {
        const lines = researchHeaderLines({ id: RID, head: 'a'.repeat(40), appTree: 'tree-1', deletedSources: ['S0042', 'bad', 'S0042', 'S7'] });
        expect(lines).toEqual([
            `1 _STROM_TREE ${RID}`, `1 _STROM_HEAD ${'a'.repeat(40)}`,
            '1 _STROM_SOURCE_DELETED S0042', '1 _STROM_SOURCE_DELETED S7', '1 _STROM_APP_TREE tree-1',
        ]);
        const many = Array.from({ length: 80 }, (_, i) => `S${i + 1}`);
        expect(researchHeaderLines({ id: RID, deletedSources: many }).filter(l => l.includes('_STROM_SOURCE_DELETED'))).toHaveLength(SOURCE_DELETED_MOST);
        expect(researchHeaderLines({ id: RID }).some(l => l.includes('_STROM_SOURCE_DELETED'))).toBe(false);
    });

    it('the exporter writes only the ids the file really lacks (one still in the tree, also as S42, is not said deleted)', () => {
        const data = withSources({ refn: 'S0007' }, { refn: 'S42' }, { refn: undefined });
        const ged = exportToGedcom(data, 'Vellmoor', { research: { id: RID, head: 'b'.repeat(40), deletedSources: ['S0042', 'S0007', 'S0099'] } }).content;
        const head = headerOf(ged);
        expect(head.filter(l => l.startsWith('1 _STROM_SOURCE_DELETED'))).toEqual(['1 _STROM_SOURCE_DELETED S0099']);
        expect(head.indexOf('1 _STROM_SOURCE_DELETED S0099')).toBe(head.indexOf(`1 _STROM_HEAD ${'b'.repeat(40)}`) + 1);
    });

    it('a file without remembered deletions has none, even when a research source is missing (a merge, a privacy export)', () => {
        const ged = exportToGedcom(withSources({ refn: 'S0007' }), 'Vellmoor', { research: { id: RID } }).content;
        expect(ged).not.toContain('_STROM_SOURCE_DELETED');
    });

    it('said deleted only to a research with the gate (deletedSourcesToSend)', () => {
        const link = { id: 'R-Test', deletedSources: ['S0042'] };
        expect(deletedSourcesToSend(link)).toEqual([]);
        setSourceRetractLookup(() => ({ features: ['sync.notWritten.codes'], bridgeUp: true, readOnly: false }));
        expect(deletedSourcesToSend(link)).toEqual([]);
        const asked: string[] = [];
        setSourceRetractLookup(id => { asked.push(id); return { features: [SOURCE_RETRACT_FEATURE], bridgeUp: false, readOnly: false }; });
        expect(deletedSourcesToSend(link)).toEqual(['S0042']);
        expect(asked).toEqual(['r-test']);
        expect(deletedSourcesToSend({ id: RID })).toEqual([]);
        expect(deletedSourcesToSend(undefined)).toEqual([]);
    });
});

describe('the memory of deleted sources', () => {
    it('one back in the tree (Undo) is forgotten; the research\'s S42 is the app\'s S0042', () => {
        expect(deletedSourcesBack(['S0042', 'S0007'], withSources({ refn: 'S42' }))).toEqual(['S0042']);
        expect(withoutDeletedSources(['S0042', 'S0007'], ['S42'])).toEqual(['S0007']);
        let research: Record<string, unknown> = { id: RID, fingerprint: '', syncedAt: '', deletedSources: ['S0042', 'S0007'] };
        vi.spyOn(TreeManager, 'getTreeMetadata').mockImplementation(() => ({ id: 't1', research } as unknown as TreeMetadata));
        const patch = vi.spyOn(TreeManager, 'patchResearchLink').mockImplementation((_t, p) => { research = { ...research, ...p }; });
        forgetDeletedSourcesBack('t1' as TreeId, withSources({ refn: 'S0007' }));
        expect(research.deletedSources).toEqual(['S0042']);
        forgetDeletedSourcesBack('t1' as TreeId, withSources());
        expect(patch).toHaveBeenCalledTimes(1);
    });

    it('`retracted` of a send\'s answer and of a written send in /status.sends, checked', () => {
        expect(sanitizeSyncReply({ ok: true, retracted: ['S0042', 'x', 'S0042', 7] }).retracted).toEqual(['S0042']);
        expect(sanitizeSyncReply({ ok: true }).retracted).toEqual([]);
        expect(sanitizeSyncReply(null).retracted).toEqual([]);
        const sends = sanitizeSends([
            { intake: 'R1', state: 'written', at: '2026-11-20T10:15:00Z', retracted: ['S0042'] },
            { intake: 'R2', state: 'pending', at: '2026-11-20T10:16:00Z', retracted: ['S0007'] },
            { intake: 'R3', state: 'written', at: '2026-11-20T10:17:00Z' },
        ])!;
        expect(sends.map(s => s.retracted)).toEqual([['S0042'], undefined, undefined]);
    });
});

describe('which dialog edit mode offers', () => {
    it('the research\'s list with the gate and its bridge; the plain one without the bridge; the older research\'s sentence; nothing known', () => {
        expect(sourceRetractEditModeIn({ features: [SOURCE_RETRACT_FEATURE], bridgeUp: true, readOnly: false })).toBe('preview');
        expect(sourceRetractEditModeIn({ features: [SOURCE_RETRACT_FEATURE], bridgeUp: false, readOnly: false })).toBe('plain');
        expect(sourceRetractEditModeIn({ features: [SOURCE_RETRACT_FEATURE], bridgeUp: true, readOnly: true })).toBe('plain');
        expect(sourceRetractEditModeIn({ features: ['sync.since'], bridgeUp: true, readOnly: false })).toBe('old');
        expect(sourceRetractEditModeIn({ features: null, bridgeUp: false, readOnly: false })).toBe('unknown');
        expect(sourceRetractEditModeIn(null)).toBe('unknown');
    });
});

describe('the rows of "What was written"', () => {
    it('a deleted source keeps its research id; the write\'s `retracted` marks its row', () => {
        const before = withSources({ id: 'src_a', refn: 'S0042' }, { id: 'src_b' });
        const other = diffOther(before, withSources());
        const rows = sentOtherRows(other);
        expect(rows.map(r => [r.id, r.refn])).toEqual([['src_a', 'S0042'], ['src_b', undefined]]);
        const marked = withRetractedRows(rows, ['S42']);
        expect(marked.map(r => !!r.retracted)).toEqual([true, false]);
        expect(sanitizeSentOtherRow(JSON.parse(JSON.stringify(marked[0])))).toMatchObject({ refn: 'S0042', retracted: true, deleted: true });
        expect(sanitizeSentOtherRow({ ...marked[0], refn: 'nope', retracted: 'yes' })).not.toHaveProperty('refn');
    });
});

describe('the reasons of a source not retracted', () => {
    let ui: typeof import('../ui/research-changes-ui.js');
    beforeAll(async () => { ui = await import('../ui/research-changes-ui.js'); }, 60000);
    afterEach(() => setLanguage('en'));

    const item = (code: string, params: Record<string, string> = {}): NotWrittenItem => ({ person: '', fact: '', why: 'report', code, source: 'S0042', params: { source: 'S0042', ...params } });

    it('by the research\'s `why`, in four languages; a retracted source\'s citation', () => {
        const whys = ['partial', 'stillCited', 'unknown', 'retracted', 'noHead', 'notPerson'];
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            const s = getStringsForLang(lang).sync;
            for (const why of whys) {
                const said = ui.nwReason(item('source.retract-skipped', { why }));
                expect(said, `${lang} ${why}`).toBe(s.nw[`source.retract-skipped:${why}`]);
                expect(said).not.toBe(s.nwUnknown);
            }
            expect(ui.nwReason(item('source.retracted'))).toBe(s.nw['source.retracted']);
        }
        setLanguage('cs');
        expect(ui.nwReason(item('source.retract-skipped', { why: 'stillCited' }))).toBe('pramen neodvolán: ve stromu je dál citovaný');
        // A why the app does not know: "not taken".
        expect(ui.nwReason(item('source.retract-skipped', { why: 'later' }))).toBe('nepřevzato');
    });
});

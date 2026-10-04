/**
 * Opening a research from Strom Research: header recognition, the loopback
 * allow-list for ?import-url= / ?live=, the create / update / ask decision,
 * stable person ids across updates, and the cleaning of untrusted bridge
 * messages. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { changeKind, changeAdds, sanitizeLiveLog, textKind, textPersonRefs, textWithoutRefs,
    readResearchHeader, parseLoopbackUrl, parseLiveBridge, contentFingerprint, fingerprintLike,
    decideResearchOpen, stabilizeIds, carryOverMedia, sanitizeLiveStatus, sanitizeLiveChange,
    sanitizeWorking, extractChangedRefs, personsByRefs, humanizeChange,
    isGedcomFileName, normalizeResearchId, parseEventData, isSafariBrowser,
    sanitizeResearchLinks, researchSchemeUrl, researchSourceRef, researchClip, researchPersonRef, researchTaskRef,
    researchNewUrl, researchAdoptToken, researchConflictRef, researchIntakeRef,
} from '../research-link.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import {
    isResearchHead, parseSendBridge, pickSendDefault, researchHeaderLines, sanitizeResearchField,
    sanitizeSyncReply, isFaithfulExport, readResearchHeader as readHeader, sanitizeLiveStatus as liveStatus,
} from '../research-link.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData, PersonId } from '../types.js';

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';

function researchGed(opts: { tree?: string | null; extraPerson?: boolean; name?: string } = {}): string {
    const lines = [
        '0 HEAD',
        '1 SOUR STROM_RESEARCH',
        '2 VERS 1.4.0',
        '2 NAME Strom Research',
        '1 DATE 23 SEP 2026',
    ];
    if (opts.tree !== null) lines.push(`1 _STROM_TREE ${opts.tree ?? UUID}`);
    lines.push(
        '1 CHAR UTF-8',
        `1 NOTE ${opts.name ?? 'Víškovi'}`,
        '2 CONT Rodokmen ze Strom Research',
        '0 @P0001@ INDI',
        '1 NAME Josef /Víšek/',
        '1 SEX M',
        '1 REFN P0001',
        '1 FAMS @F0001@',
        '0 @P0002@ INDI',
        '1 NAME Anna /Svobodová/',
        '1 SEX F',
        '1 REFN P0002',
        '1 FAMS @F0001@',
        '0 @P0003@ INDI',
        '1 NAME Jan /Víšek/',
        '1 SEX M',
        '1 REFN P0003',
        '1 FAMC @F0001@',
    );
    if (opts.extraPerson) {
        lines.push('0 @P0004@ INDI', '1 NAME Ludmila /Víšková/', '1 SEX F', '1 REFN P0004', '1 FAMC @F0001@');
    }
    lines.push('0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@');
    if (opts.extraPerson) lines.push('1 CHIL @P0004@');
    lines.push('0 TRLR');
    return lines.join('\n');
}

const importData = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;

describe('readResearchHeader', () => {
    it('recognises a Strom Research file with its tree UUID and name', () => {
        const h = readResearchHeader(researchGed());
        expect(h.isStromResearch).toBe(true);
        expect(h.treeId).toBe(UUID);
        expect(h.name).toBe('Víškovi');
        expect(h.date).toBe('23 SEP 2026');
    });

    it('normalises the UUID to lower case and tolerates BOM and CRLF', () => {
        const ged = '﻿' + researchGed({ tree: UUID.toUpperCase() }).replace(/\n/g, '\r\n');
        const h = readResearchHeader(ged);
        expect(h.isStromResearch).toBe(true);
        expect(h.treeId).toBe(UUID);
        expect(h.name).toBe('Víškovi');
    });

    it('_STROM_MODE archive: the research works without an agent (missing: with one)', () => {
        expect(readResearchHeader(researchGed()).mode).toBeNull();
        expect(readResearchHeader(researchGed().replace('0 HEAD', '0 HEAD\n1 _STROM_MODE archive')).mode).toBe('archive');
        expect(readResearchHeader(researchGed().replace('0 HEAD', '0 HEAD\n1 _STROM_MODE robot')).mode).toBeNull();
        // Only in a Strom Research file.
        expect(readResearchHeader(researchGed().replace('1 SOUR STROM_RESEARCH', '1 SOUR Other').replace('0 HEAD', '0 HEAD\n1 _STROM_MODE archive')).mode).toBeNull();
    });

    it('a research file without _STROM_TREE has no id (opened as a new tree)', () => {
        const h = readResearchHeader(researchGed({ tree: null }));
        expect(h.isStromResearch).toBe(true);
        expect(h.treeId).toBeNull();
    });

    it('ignores a malformed identifier', () => {
        expect(readResearchHeader(researchGed({ tree: 'not-a-uuid' })).treeId).toBeNull();
        expect(readResearchHeader(researchGed({ tree: `${UUID}x` })).treeId).toBeNull();
    });

    it('_STROM_TREE counts only together with SOUR STROM_RESEARCH', () => {
        const ged = researchGed().replace('1 SOUR STROM_RESEARCH', '1 SOUR OtherProgram');
        const h = readResearchHeader(ged);
        expect(h.isStromResearch).toBe(false);
        expect(h.treeId).toBeNull();
    });

    it('reads the name from the first NOTE line, CONC joined', () => {
        const ged = researchGed().replace('1 NOTE Víškovi', '1 NOTE Víš\n2 CONC kovi');
        expect(readResearchHeader(ged).name).toBe('Víškovi');
    });

    it('a name starting on a CONT line is taken from it', () => {
        const ged = researchGed().replace('1 NOTE Víškovi', '1 NOTE\n2 CONT Krepčíkovi');
        expect(readResearchHeader(ged).name).toBe('Krepčíkovi');
    });

    it('only the header is read — a NOTE of a record is not the name', () => {
        const ged = researchGed().replace('1 NOTE Víškovi\n2 CONT Rodokmen ze Strom Research\n', '')
            .replace('1 REFN P0001', '1 REFN P0001\n1 NOTE Not the tree name');
        expect(readResearchHeader(ged).name).toBeNull();
    });

    it('a plain GEDCOM and garbage are not research files', () => {
        expect(readResearchHeader('0 HEAD\n1 SOUR PAF\n0 TRLR').isStromResearch).toBe(false);
        expect(readResearchHeader('hello world').isStromResearch).toBe(false);
        expect(readResearchHeader('').isStromResearch).toBe(false);
    });

    it('strips control characters from the name', () => {
        const ged = researchGed({ name: 'Víš\u0007kovi <b>' });
        expect(readResearchHeader(ged).name).toBe('Víš kovi <b>');
    });
});

describe('parseLoopbackUrl — only this computer', () => {
    it.each([
        'http://127.0.0.1:8123/abc/tree-strom.ged',
        'http://localhost:8123/abc/tree-strom.ged',
        'http://LOCALHOST:9/x',
        'http://127.0.0.1/tree.ged',
    ])('accepts %s', (url) => {
        expect(parseLoopbackUrl(url)).not.toBeNull();
    });

    it.each([
        ['another host', 'http://evil.com/tree.ged'],
        ['look-alike host', 'http://127.0.0.1.evil.com:8123/tree.ged'],
        ['localhost subdomain', 'http://localhost.evil.com/tree.ged'],
        ['userinfo trick', 'http://localhost@evil.com/tree.ged'],
        ['userinfo with port', 'http://localhost:80@evil.com/tree.ged'],
        ['userinfo on loopback', 'http://user:pw@127.0.0.1:8123/tree.ged'],
        ['https', 'https://127.0.0.1:8123/tree.ged'],
        ['file', 'file:///Users/x/tree.ged'],
        ['javascript', 'javascript:alert(1)'],
        ['data', 'data:text/plain,0 HEAD'],
        ['fragment host', 'http://evil.com#@127.0.0.1/'],
        ['IPv6 loopback', 'http://[::1]:8123/tree.ged'],
        ['other private address', 'http://192.168.1.10:8123/tree.ged'],
        ['relative', '/tree.ged'],
        ['empty', ''],
    ])('refuses %s', (_label, url) => {
        expect(parseLoopbackUrl(url)).toBeNull();
    });

    it('refuses non-strings and huge values', () => {
        expect(parseLoopbackUrl(null)).toBeNull();
        expect(parseLoopbackUrl(42)).toBeNull();
        expect(parseLoopbackUrl('http://127.0.0.1/' + 'a'.repeat(3000))).toBeNull();
    });
});

describe('parseLiveBridge', () => {
    it('builds the endpoints from the bridge address', () => {
        const b = parseLiveBridge('http://127.0.0.1:5123/0123456789abcdef0123456789abcdef/');
        expect(b).toEqual({
            base: 'http://127.0.0.1:5123/0123456789abcdef0123456789abcdef',
            status: 'http://127.0.0.1:5123/0123456789abcdef0123456789abcdef/status',
            ged: 'http://127.0.0.1:5123/0123456789abcdef0123456789abcdef/tree.ged',
            events: 'http://127.0.0.1:5123/0123456789abcdef0123456789abcdef/events',
            log: 'http://127.0.0.1:5123/0123456789abcdef0123456789abcdef/log',
        });
    });

    it('drops a query and refuses non-loopback bridges', () => {
        expect(parseLiveBridge('http://localhost:5123/tok?x=1#y')?.status).toBe('http://localhost:5123/tok/status');
        expect(parseLiveBridge('https://stromapp.info/tok')).toBeNull();
        expect(parseLiveBridge('http://127.0.0.1.evil.com/tok')).toBeNull();
    });
});

describe('create / update / ask', () => {
    it('no linked tree → create', () => {
        expect(decideResearchOpen(null, null)).toBe('create');
        expect(decideResearchOpen(undefined, 'x')).toBe('create');
    });

    it('unchanged since the last import → update without asking', () => {
        const data = importData(researchGed());
        const fp = contentFingerprint(data);
        expect(decideResearchOpen({ fingerprint: fp }, contentFingerprint(structuredClone(data)))).toBe('update');
    });

    it('edited in the app → ask', () => {
        const data = importData(researchGed());
        const fp = contentFingerprint(data);
        const edited = structuredClone(data);
        const first = Object.values(edited.persons)[0];
        first.notes = 'My own note';
        expect(decideResearchOpen({ fingerprint: fp }, contentFingerprint(edited))).toBe('ask');
    });

    it('unreadable tree → ask (never overwrite blindly)', () => {
        expect(decideResearchOpen({ fingerprint: 'abc' }, null)).toBe('ask');
    });

    it('focus bookkeeping and the data version are not edits', () => {
        const data = importData(researchGed());
        const fp = contentFingerprint(data);
        const touched = structuredClone(data);
        touched.version = 999;
        touched.lastFocusPersonId = Object.keys(touched.persons)[0] as never;
        touched.lastFocusDepthUp = 7;
        expect(contentFingerprint(touched)).toBe(fp);
    });

    it('a changed image is an edit; the same image is not', () => {
        const img = (fill: string) => 'data:image/jpeg;base64,' + fill.repeat(4000);
        const data = importData(researchGed());
        const first = Object.values(data.persons)[0];
        first.photo = img('AAAA');
        const fp = contentFingerprint(data);
        const same = structuredClone(data);
        expect(contentFingerprint(same)).toBe(fp);
        const recropped = structuredClone(data);
        Object.values(recropped.persons)[0].photo = img('AAAA').slice(0, -8);
        expect(contentFingerprint(recropped)).not.toBe(fp);
        const replaced = structuredClone(data);
        Object.values(replaced.persons)[0].photo = img('BBBB');
        expect(contentFingerprint(replaced)).not.toBe(fp);
    });

    it('a link synced by an older version is compared in its own format', () => {
        const data = importData(researchGed());
        const legacyText = JSON.stringify([data.persons, data.partnerships, data.sources ?? null, data.places ?? null, data.surnameVariants ?? null]);
        const fnv = (t: string, seed: number) => { let h = seed >>> 0; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
        const legacy = `${legacyText.length.toString(36)}-${fnv(legacyText, 0x811c9dc5).toString(36)}-${fnv(legacyText, 0x01000193).toString(36)}`;
        expect(decideResearchOpen({ fingerprint: legacy }, fingerprintLike(data, legacy))).toBe('update');
        expect(fingerprintLike(data, contentFingerprint(data))).toBe(contentFingerprint(data));
        expect(contentFingerprint(data).startsWith('v2-')).toBe(true);
    });
});

describe('stabilizeIds', () => {
    it('keeps person and couple ids across re-imports (matched by REFN)', () => {
        const first = importData(researchGed());
        const second = importData(researchGed({ extraPerson: true }));
        const stable = stabilizeIds(second, first);

        const idOf = (d: StromData, refn: string) =>
            Object.values(d.persons).find(p => p.refn === refn)!.id;
        for (const refn of ['P0001', 'P0002', 'P0003']) {
            expect(idOf(stable, refn)).toBe(idOf(first, refn));
        }
        // The new person keeps its fresh id and the family links it.
        const ludmila = idOf(stable, 'P0004');
        expect(first.persons[ludmila]).toBeUndefined();
        expect(Object.keys(stable.partnerships)).toEqual(Object.keys(first.partnerships));
        const union = Object.values(stable.partnerships)[0];
        expect(union.childIds).toContain(ludmila);
        expect(union.childIds).toContain(idOf(first, 'P0003'));
        // References inside persons follow the rename.
        const jan = stable.persons[idOf(first, 'P0003')];
        expect(jan.parentIds.sort()).toEqual([idOf(first, 'P0001'), idOf(first, 'P0002')].sort());
    });

    it('re-importing the same file gives the same fingerprint after stabilising', () => {
        const first = importData(researchGed());
        const again = stabilizeIds(importData(researchGed()), first);
        expect(contentFingerprint(again)).toBe(contentFingerprint(first));
    });

    it('does not mutate its input and ignores duplicate reference numbers', () => {
        const first = importData(researchGed());
        const second = importData(researchGed());
        const before = JSON.stringify(second);
        for (const p of Object.values(first.persons)) p.refn = 'SAME';
        const out = stabilizeIds(second, first);
        expect(JSON.stringify(second)).toBe(before);
        // Nothing matched uniquely → person ids stay as imported.
        expect(Object.keys(out.persons).sort()).toEqual(Object.keys(second.persons).sort());
    });
});

describe('carryOverMedia', () => {
    const IMG = (tag: string) => `data:image/jpeg;base64,${tag}${'A'.repeat(2000)}`;
    const idOf = (d: StromData, refn: string) => Object.values(d.persons).find(p => p.refn === refn)!.id;
    /** The tree as the app holds it: the research plus a photo, an attachment and a crop added here. */
    function appTree(): StromData {
        const data = importData(researchGed({ extraPerson: true }));
        const josef = data.persons[idOf(data, 'P0001')];
        josef.photo = IMG('photo');
        josef.photoOriginalName = 'josef.jpg';
        josef.attachments = [{ id: 'att1', name: 'page.jpg', mimeType: 'image/jpeg', dataUrl: IMG('page'), sizeBytes: 2000, sourceId: 'src1' }];
        const ludmila = data.persons[idOf(data, 'P0004')];
        ludmila.photo = IMG('ludmila');
        data.sources = {
            src1: { id: 'src1', title: 'Baptism', refn: 'S0001', excerpts: [
                { id: 'exc1', dataUrl: IMG('crop'), width: 10, height: 10, sizeBytes: 2000 },
                { id: 'exc2', dataUrl: IMG('clip'), width: 10, height: 10, sizeBytes: 2000, clip: 'C1' },
            ] },
        };
        return data;
    }
    /** The next research state: no images (the research never had them). */
    function update(previous: StromData, opts: { extraPerson?: boolean; source?: boolean } = {}): StromData {
        const next = stabilizeIds(importData(researchGed({ extraPerson: opts.extraPerson ?? true })), previous);
        if (opts.source !== false) next.sources = { src1: { id: 'src1', title: 'Baptism', refn: 'S0001' } };
        return next;
    }

    it('keeps photos, attachments and the crops cut in the app', () => {
        const previous = appTree();
        const next = update(previous);
        const before = JSON.stringify(next);
        const { data, lost } = carryOverMedia(next, previous);
        expect(lost).toBe(0);
        expect(JSON.stringify(next)).toBe(before);
        const josef = data.persons[idOf(previous, 'P0001')];
        expect(josef.photo).toBe(IMG('photo'));
        expect(josef.photoOriginalName).toBe('josef.jpg');
        expect(josef.attachments).toEqual(previous.persons[josef.id].attachments);
        expect(data.persons[idOf(previous, 'P0004')].photo).toBe(IMG('ludmila'));
        // The app's crop comes back; the research's own (clip) is the research's business.
        expect(data.sources!.src1.excerpts!.map(e => e.id)).toEqual(['exc1']);
    });

    it('prefers what the research brings and never duplicates', () => {
        const previous = appTree();
        const next = update(previous);
        const josefId = idOf(previous, 'P0001');
        next.persons[josefId].photo = IMG('newer');
        next.persons[josefId].attachments = [{ id: 'other', name: 'p.jpg', mimeType: 'image/jpeg', dataUrl: IMG('page'), sizeBytes: 2000 }];
        next.sources!.src1.excerpts = [{ id: 'exc1', dataUrl: IMG('crop'), width: 10, height: 10, sizeBytes: 2000 }];
        const { data } = carryOverMedia(next, previous);
        expect(data.persons[josefId].photo).toBe(IMG('newer'));
        expect(data.persons[josefId].attachments!.map(a => a.id)).toEqual(['other']);
        expect(data.sources!.src1.excerpts!.map(e => e.id)).toEqual(['exc1']);
    });

    it('next to the research\'s own crops, only crops cut here from an attachment come back', () => {
        const previous = appTree();
        previous.sources!.src1.excerpts!.push({ id: 'exc3', dataUrl: IMG('cut'), width: 10, height: 10, sizeBytes: 2000, fromAttachmentId: 'att1' });
        const next = update(previous);
        next.sources!.src1.excerpts = [{ id: 'new', dataUrl: IMG('recrop'), width: 10, height: 10, sizeBytes: 2000 }];
        const { data, lost } = carryOverMedia(next, previous);
        expect(lost).toBe(0);
        expect(data.sources!.src1.excerpts!.map(e => e.id)).toEqual(['new', 'exc3']);
    });

    it('counts images of people and sources the research dropped and unlinks gone sources', () => {
        const previous = appTree();
        const next = update(previous, { extraPerson: false, source: false });
        const { data, lost } = carryOverMedia(next, previous);
        // Ludmila's photo and the source's own crop have nowhere to go.
        expect(lost).toBe(2);
        const att = data.persons[idOf(previous, 'P0001')].attachments![0];
        expect(att.id).toBe('att1');
        expect(att.sourceId).toBeUndefined();
    });

    it('a tree handed over from the app (no REFN, other ids) keeps its photos', () => {
        const previous = appTree();
        // The app's own ids and no research numbers yet.
        const own: StromData = { ...previous, persons: {} as StromData['persons'] };
        for (const p of Object.values(previous.persons)) {
            const id = `app_${p.id}` as PersonId;
            own.persons[id] = { ...p, id, refn: undefined };
        }
        const next = stabilizeIds(importData(researchGed({ extraPerson: true })), own);
        const { data, lost } = carryOverMedia(next, own);
        expect(lost).toBe(1); // the source's crop: the research has no such source
        const josef = data.persons[idOf(next, 'P0001')];
        expect(josef.photo).toBe(IMG('photo'));
        expect(josef.attachments![0].sourceId).toBeUndefined();
        expect(data.persons[idOf(next, 'P0004')].photo).toBe(IMG('ludmila'));
    });

    it('people with the same name and birth are never guessed', () => {
        const previous = appTree();
        const own: StromData = { ...previous, persons: {} as StromData['persons'] };
        for (const p of Object.values(previous.persons)) {
            const id = `app_${p.id}` as PersonId;
            own.persons[id] = { ...p, id, refn: undefined, firstName: 'Jan', lastName: 'Víšek', gender: 'male' };
        }
        const next = stabilizeIds(importData(researchGed({ extraPerson: true })), own);
        const { data, lost } = carryOverMedia(next, own);
        expect(lost).toBe(4);
        expect(Object.values(data.persons).some(p => p.photo)).toBe(false);
    });
});

describe('bridge messages are untrusted', () => {
    it('cleans the status and drops malformed items', () => {
        const s = sanitizeLiveStatus({
            strom: '1.0.0',
            tree: { id: UUID.toUpperCase(), name: 'Víškovi\n<img src=x onerror=alert(1)>', lang: 'cs' },
            head: 'abc123',
            persons: 580,
            families: -4,
            working: [{ who: 'agent-1', since: '2026-09-23T10:00:00Z', task: 'Matriky Lučice' }, 'junk', { since: 'x' }],
            waiting: [{ id: 'T1', what: 'Potvrďte otce', on: 'user', at: '2026-09-26T12:10:00Z' }, { id: 'T2' }],
        })!;
        expect(s.treeId).toBe(UUID);
        expect(s.name).toBe('Víškovi <img src=x onerror=alert(1)>');
        expect(s.persons).toBe(580);
        expect(s.families).toBeNull();
        expect(s.working).toEqual([{ who: 'agent-1', since: '2026-09-23T10:00:00Z', task: 'Matriky Lučice' }]);
        expect(s.waiting).toEqual([{ id: 'T1', what: 'Potvrďte otce', on: 'user', at: '2026-09-26T12:10:00Z' }]);
    });

    it('a run waiting for its gate is paused (a bad time is dropped)', () => {
        const [w, bad] = sanitizeWorking([
            { who: 'run-1', since: '2026-09-29T19:00:00Z', paused: { until: '2026-09-29T21:30:00+02:00', reason: 'Claude usage 92 %' } },
            { who: 'run-2', paused: { until: 'soon', reason: 7 } },
        ]);
        expect(w.paused).toEqual({ until: '2026-09-29T21:30:00+02:00', reason: 'Claude usage 92 %' });
        expect(bad.paused).toEqual({ until: '', reason: '' });
        expect(sanitizeWorking([{ who: 'run-3' }])[0].paused).toBeUndefined();
    });

    it('rejects non-objects and a missing tree id', () => {
        expect(sanitizeLiveStatus(null)).toBeNull();
        expect(sanitizeLiveStatus([1, 2])).toBeNull();
        expect(sanitizeLiveStatus({ tree: { id: 'nope' } })!.treeId).toBeNull();
        expect(sanitizeWorking('x')).toEqual([]);
        expect(parseEventData('{bad json')).toBeNull();
        expect(normalizeResearchId(42)).toBeNull();
    });

    it('a newer research: the text of each commit, and the commits of a change', () => {
        const [e] = sanitizeLiveLog({ entries: [{ head: 'h1', at: '2026-09-29T22:37:09+02:00', task: 'T0154 Sňatek', what: ['+S0171 source'], text: ['Záznam z pramene: Sňatek 1893', 7, ''] }] })!;
        expect(e.text).toEqual(['Záznam z pramene: Sňatek 1893']);
        // An empty text is kept empty (nothing to show), an older research has none.
        expect(sanitizeLiveLog({ entries: [{ at: '2026-09-29T22:00:00Z', what: ['x'], text: [] }] })![0].text).toEqual([]);
        expect(sanitizeLiveLog({ entries: [{ at: '2026-09-29T22:00:00Z', what: ['x'] }] })![0].text).toBeUndefined();
        const c = sanitizeLiveChange({ head: 'h2', what: ['a'], at: '2026-09-29T22:38:00Z', entries: [{ head: 'h2', at: '2026-09-29T22:38:00Z', what: ['a'], task: 'T1 x', text: ['A'] }] })!;
        expect(c.entries).toEqual([{ head: 'h2', at: '2026-09-29T22:38:00Z', what: ['a'], task: 'T1 x', text: ['A'] }]);
        expect(sanitizeLiveChange({ head: 'h3', what: ['a'], entries: 'x' })!.entries).toBeUndefined();
    });

    it('text lines: the people they name, shown without the marks, and their filter', () => {
        const line = 'Upřesněno: František Strach (*1869) [P0019] – narození: 2. 10. 1869';
        expect(textPersonRefs(line)).toEqual(['P0019']);
        expect(textWithoutRefs(line)).toBe('Upřesněno: František Strach (*1869) – narození: 2. 10. 1869');
        expect(textKind('Nové snímky: Buštěhrad 17 (obr. 16–21)', ['+M2694 image 21 of B0059'])).toBe('other');
        expect(textKind('Záznam z pramene: Sňatek', ['+S0171 source'])).toBe('sources');
        // A mixed commit: a line naming a person is about people, a story line about the story.
        const mixed = ['+S0171 source', 'E0100 BIRT 1869 ← S0171', 'P0019 _STORY draft'];
        expect(textKind(line, mixed)).toBe('persons');
        expect(textKind('Vyprávění: František Strach [P0019]', mixed)).toBe('stories');
        expect(textKind('Záznam z pramene: Sňatek', mixed)).toBe('sources');
    });

    it('a path in a line keeps its slashes, a GEDCOM surname loses them', () => {
        expect(humanizeChange('N0131 closed: T0159 · output/tree.ged, output/tree-strom.ged')).toBe('N0131 closed: T0159 · output/tree.ged, output/tree-strom.ged');
        expect(humanizeChange('+P0101 Marie /Nováková/ ← S0202')).toBe('+P0101 Marie Nováková ← S0202');
    });

    it('cleans a change and caps its lines', () => {
        const c = sanitizeLiveChange({ head: 'h2', what: ['+P0101 Marie /Nováková/ ← S0202', 7, ''], at: '2026-09-23T10:05:00Z' })!;
        expect(c.what).toEqual(['+P0101 Marie /Nováková/ ← S0202']);
        // A bulk command lists every change it saved: hundreds pass, not endless.
        const many = sanitizeLiveChange({ what: Array.from({ length: 1500 }, (_, i) => `line ${i}`) })!;
        expect(many.what.length).toBe(1000);
        expect(sanitizeLiveChange('x')).toBeNull();
    });

    it('long texts are cut', () => {
        const s = sanitizeLiveStatus({ tree: { id: UUID, name: 'x'.repeat(1000) } })!;
        expect(s.name.length).toBeLessThanOrEqual(120);
    });
});

describe('changed people', () => {
    it('finds the research numbers a change mentions', () => {
        expect(extractChangedRefs(['+P0101 Marie /Nováková/ ← S0202', '~P0003 birth date', 'no ids here, ABC12x']))
            .toEqual(['P0101', 'S0202', 'P0003']);
    });

    it('maps them to people by REFN', () => {
        const data = importData(researchGed());
        const ids = personsByRefs(data, ['P0003', 'S0202']);
        expect(ids.length).toBe(1);
        expect(data.persons[ids[0]].firstName).toBe('Jan');
        expect(personsByRefs(data, [])).toEqual([]);
    });

    it('reads a change line without GEDCOM surname slashes', () => {
        expect(humanizeChange('+P0101 Marie /Nováková/ ← S0202')).toBe('+P0101 Marie Nováková ← S0202');
    });

    it('recognises GEDCOM file names', () => {
        expect(isGedcomFileName('tree-strom.ged')).toBe(true);
        expect(isGedcomFileName('TREE.GED')).toBe(true);
        expect(isGedcomFileName('tree.json')).toBe(false);
        expect(isGedcomFileName(undefined)).toBe(false);
    });
});

describe('isSafariBrowser', () => {
    it('recognises Safari on macOS and iOS', () => {
        expect(isSafariBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe(true);
        expect(isSafariBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(true);
    });
    it('does not mistake Chromium, Edge, Firefox or Android browsers for Safari', () => {
        expect(isSafariBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe(false);
        expect(isSafariBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe(false);
        expect(isSafariBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1')).toBe(false);
        expect(isSafariBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(false);
        expect(isSafariBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36')).toBe(false);
    });
});

describe('humanizeChange with words', () => {
    const words = {
        newPerson: 'Nová osoba', newChild: 'Nové dítě', newFamily: 'Nová rodina',
        facts: { BIRT: 'narození', DEAT: 'úmrtí' } as Record<string, string>,
    };
    const names: Record<string, string> = { P0006: 'Ludmila Nováková', P0003: 'Jan Novák' };
    const nameOf = (ref: string) => names[ref] ?? null;
    it('reads the usual strom lines as sentences', () => {
        expect(humanizeChange('+P0006 Ludmila /Nováková/ · E0006 BIRT 1905 [lead]', nameOf, words))
            .toBe('Nová osoba: Ludmila Nováková · narození 1905');
        expect(humanizeChange('F0001 +child P0006', nameOf, words)).toBe('Nové dítě: Ludmila Nováková');
        expect(humanizeChange('+F0001 Josef Novák & Marie Dvořáková (1 child)', nameOf, words))
            .toBe('Nová rodina: Josef Novák & Marie Dvořáková');
        expect(humanizeChange('+P0101 Marie /Nováková/ ← S0202', nameOf, words)).toBe('Nová osoba: Marie Nováková');
    });
    it('names people in other lines and keeps unknown shapes readable', () => {
        expect(humanizeChange('~P0003 E0010 DEAT 1950 [probable]', nameOf, words)).toBe('Jan Novák úmrtí 1950');
        expect(humanizeChange('strom session start: 2 changes', nameOf, words)).toBe('strom session start: 2 changes');
        expect(humanizeChange('F0001 +child P0999', nameOf, words)).toBe('Nové dítě: P0999');
    });
});

// ==================== SENDING CHANGES BACK ====================


const RID = '0d2f8913-4f08-4c84-b1b6-91a600580e06';

describe('research version in the header (_STROM_HEAD)', () => {
    it('reads a commit id from a Strom Research file only, lower case', () => {
        const ged = `0 HEAD\n1 SOUR STROM_RESEARCH\n1 _STROM_TREE ${RID}\n1 _STROM_HEAD 3F2A9C1E\n0 TRLR`;
        expect(readHeader(ged).head).toBe('3f2a9c1e');
        expect(readHeader(ged.replace('STROM_RESEARCH', 'PAF')).head).toBeNull();
        expect(readHeader(ged.replace('3F2A9C1E', 'not a commit')).head).toBeNull();
    });

    it('accepts hex 7–64 characters', () => {
        expect(isResearchHead('abc1234')).toBe('abc1234');
        expect(isResearchHead('abc123')).toBeNull();
        expect(isResearchHead('g'.repeat(10))).toBeNull();
        expect(isResearchHead('a'.repeat(65))).toBeNull();
    });

    it('a linked export writes _STROM_TREE and _STROM_HEAD, not SOUR STROM_RESEARCH', () => {
        expect(researchHeaderLines({ id: RID.toUpperCase(), head: 'ABCDEF1' })).toEqual([`1 _STROM_TREE ${RID}`, '1 _STROM_HEAD abcdef1']);
        expect(researchHeaderLines({ id: RID })).toEqual([`1 _STROM_TREE ${RID}`]);
        expect(researchHeaderLines({ id: 'nope' })).toEqual([]);
        const data: StromData = { persons: {}, partnerships: {} } as StromData;
        const ged = exportToGedcom(data, 'T', { research: { id: RID, head: 'abcdef1' } }).content;
        expect(ged).toContain(`1 _STROM_TREE ${RID}`);
        expect(ged).toContain('1 _STROM_HEAD abcdef1');
        expect(ged).not.toContain('STROM_RESEARCH');
        expect(exportToGedcom(data, 'T').content).not.toContain('_STROM_TREE');
    });
});

describe('faithful exports only', () => {
    const all = { photos: true, attachments: true, notes: true, sources: true };
    it('whole content, living people as they are', () => {
        expect(isFaithfulExport('full', all)).toBe(true);
        expect(isFaithfulExport('initials', all)).toBe(false);
        expect(isFaithfulExport('full', { ...all, photos: false })).toBe(false);
        expect(isFaithfulExport('full', { ...all, notes: false })).toBe(false);
    });
});

describe('send bridge', () => {
    it('loopback only; status, sync and cancel endpoints', () => {
        expect(parseSendBridge('http://127.0.0.1:5000/tok/')).toEqual({
            base: 'http://127.0.0.1:5000/tok', status: 'http://127.0.0.1:5000/tok/status', sync: 'http://127.0.0.1:5000/tok/sync',
            cancel: 'http://127.0.0.1:5000/tok/cancel',
        });
        expect(parseSendBridge('https://127.0.0.1:5000/tok')).toBeNull();
        expect(parseSendBridge('http://127.0.0.1.evil.com/tok')).toBeNull();
    });

    it('status: tree as { id, name } or as the id with the name beside it', () => {
        expect(liveStatus({ tree: { id: RID, name: 'A' }, head: 'x' })).toMatchObject({ treeId: RID, name: 'A' });
        expect(liveStatus({ tree: RID.toUpperCase(), name: 'B' })).toMatchObject({ treeId: RID, name: 'B' });
        expect(liveStatus({ tree: 'nope', name: 'C' })?.treeId).toBeNull();
    });

    it('suggests the open tree, else the one changed last', () => {
        const trees = [
            { id: 'a', changedAt: '2026-09-20T10:00:00Z' },
            { id: 'b', changedAt: '2026-09-26T10:00:00Z' },
            { id: 'c', lastModifiedAt: '2026-09-22T10:00:00Z' },
        ];
        expect(pickSendDefault(trees, 'c')?.id).toBe('c');
        expect(pickSendDefault(trees, 'zzz')?.id).toBe('b');
        expect(pickSendDefault([], 'a')).toBeNull();
    });

    it('the reply and the JSON field are checked', () => {
        const none = { head: '', applied: null, pending: false, conflicts: null, conflictPersons: [], conflictIds: [], kept: null, reason: '', skipped: [], code: '', undoneSince: [], takenBack: null, notWritten: [], ids: null };
        expect(sanitizeSyncReply({ ok: true, input: 'I1', changes: 12 })).toEqual({ ok: true, changes: 12, error: '', inbox: null, intake: '', ...none });
        // Written at once: the commit it made and what of the changes was written.
        expect(sanitizeSyncReply({ ok: true, inbox: false, changes: 8, applied: 7, head: 'ABCDEF1234', input: 'I0042', intake: 'R1' }))
            .toMatchObject({ ok: true, inbox: false, changes: 8, applied: 7, head: 'abcdef1234', intake: 'R1', pending: false });
        // Still writing (202).
        expect(sanitizeSyncReply({ ok: true, inbox: false, pending: true, changes: 8, intake: 'R2' })).toMatchObject({ pending: true, head: '' });
        // Conflicts as a count or as a list naming persons.
        expect(sanitizeSyncReply({ ok: true, conflicts: 2 })).toMatchObject({ conflicts: 2, conflictPersons: [] });
        expect(sanitizeSyncReply({ ok: true, conflicts: [{ person: 'P0012' }, { person: 'bad' }, 'P0013'] }))
            .toMatchObject({ conflicts: 3, conflictPersons: ['P0012', 'P0013'] });
        // The conflicts' own ids, bare or named (finding 40: "Decide in the research" for the one it wrote).
        expect(sanitizeSyncReply({ ok: true, conflicts: ['X0002', { id: 'X0003', person: 'P0012' }, { conflict: 'X0004' }, { id: 'nope' }] }))
            .toMatchObject({ conflicts: 4, conflictIds: ['X0002', 'X0003', 'X0004'] });
        expect(sanitizeSyncReply({ ok: true, changes: 3, inbox: true }).inbox).toBe(true);
        expect(sanitizeSyncReply({ error: 'bad\u0000 thing' })).toEqual({ ok: false, changes: null, error: 'bad thing', inbox: null, intake: '', ...none });
        expect(sanitizeSyncReply('x').ok).toBe(false);
        expect(sanitizeResearchField({ id: RID, head: 'ABCDEF1' })).toEqual({ id: RID, head: 'abcdef1' });
        expect(sanitizeResearchField({ id: RID, head: 'zz' })).toEqual({ id: RID });
        expect(sanitizeResearchField({ id: 'x' })).toBeNull();
        expect(sanitizeResearchField(null)).toBeNull();
    });
});

describe('strom-research:// links', () => {
    const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';

    it('known actions only, from a list or a header value', () => {
        expect(sanitizeResearchLinks(['send', 'EXCERPT', 'rm -rf', 'send', 3])).toEqual(['send', 'excerpt']);
        expect(sanitizeResearchLinks('send  excerpt open delete')).toEqual(['send', 'excerpt', 'open']);
        expect(sanitizeResearchLinks('app chat task review research')).toEqual(['app', 'chat', 'task', 'review', 'research']);
        expect(sanitizeResearchLinks(undefined)).toEqual([]);
    });

    it('the header announces links for Strom Research files only', () => {
        const head = (sour: string) => `0 HEAD\n1 SOUR ${sour}\n1 _STROM_TREE ${UUID}\n1 _STROM_LINKS send excerpt\n0 TRLR`;
        expect(readResearchHeader(head('STROM_RESEARCH')).links).toEqual(['send', 'excerpt']);
        expect(readResearchHeader(head('OTHER')).links).toEqual([]);
    });

    it('the bridge status carries them; missing means none', () => {
        expect(sanitizeLiveStatus({ tree: UUID, links: ['excerpt'] })?.links).toEqual(['excerpt']);
        expect(sanitizeLiveStatus({ tree: UUID })?.links).toEqual([]);
    });

    it('links are built only from valid parameters', () => {
        expect(researchSchemeUrl('send', { tree: UUID.toUpperCase() })).toBe(`strom-research://send?tree=${UUID}`);
        expect(researchSchemeUrl('send', { tree: 'x&evil=1' })).toBeNull();
        expect(researchSchemeUrl('excerpt', { tree: UUID, source: 'S0042', clip: 'c3' }))
            .toBe(`strom-research://excerpt?tree=${UUID}&source=S0042&clip=c3`);
        expect(researchSchemeUrl('excerpt', { tree: UUID, source: 'S1&x=y', clip: 'c3' })).toBeNull();
        expect(researchSchemeUrl('excerpt', { tree: UUID, source: 'S0042', clip: 'c3&x=1' })).toBeNull();
        expect(researchSchemeUrl('excerpt', { tree: UUID, source: 'S0042', clip: 'x'.repeat(33) })).toBeNull();
        expect(researchClip(' ab-9 ')).toBe('ab-9');
        expect(researchSourceRef(' S7 ')).toBe('S7');
        expect(researchSourceRef('P0001')).toBeNull();
    });

    it('research actions: ids and fixed values only, each checked', () => {
        const t = `tree=${UUID}`;
        expect(researchSchemeUrl('app', { tree: UUID })).toBe(`strom-research://app?${t}`);
        expect(researchSchemeUrl('open', { tree: UUID })).toBe(`strom-research://open?${t}`);
        expect(researchSchemeUrl('chat', { tree: UUID })).toBe(`strom-research://chat?${t}`);
        expect(researchSchemeUrl('chat', { tree: UUID, person: 'P0012' })).toBe(`strom-research://chat?${t}&person=P0012`);
        expect(researchSchemeUrl('task', { tree: UUID, task: 'T0003' })).toBe(`strom-research://task?${t}&task=T0003`);
        for (const scope of ['person', 'family', 'line'] as const) {
            expect(researchSchemeUrl('review', { tree: UUID, person: 'P0012', scope }))
                .toBe(`strom-research://review?${t}&person=P0012&scope=${scope}`);
        }
        expect(researchSchemeUrl('review', { tree: UUID, person: 'P0012' })).toBe(`strom-research://review?${t}&person=P0012&scope=person`);
        expect(researchSchemeUrl('research', { tree: UUID, person: 'P0012', direction: 'ancestors' }))
            .toBe(`strom-research://research?${t}&person=P0012&direction=ancestors`);

        // Anything else: no link at all.
        expect(researchSchemeUrl('chat', { tree: UUID, person: 'Jan Novák' })).toBeNull();
        expect(researchSchemeUrl('chat', { tree: UUID, person: 'P12345678' })).toBeNull();
        expect(researchSchemeUrl('review', { tree: UUID })).toBeNull();
        expect(researchSchemeUrl('review', { tree: UUID, person: 'S0012' })).toBeNull();
        expect(researchSchemeUrl('review', { tree: UUID, person: 'P0012', scope: 'all' as never })).toBeNull();
        expect(researchSchemeUrl('research', { tree: UUID, person: 'P0012', direction: 'sideways' as never })).toBeNull();
        expect(researchSchemeUrl('task', { tree: UUID })).toBeNull();
        expect(researchSchemeUrl('task', { tree: UUID, task: 'T1&x=1' })).toBeNull();
        expect(researchSchemeUrl('task', { tree: UUID, task: 'P0003' })).toBeNull();
        expect(researchSchemeUrl('open', { tree: 'not-a-tree' })).toBeNull();
        expect(researchPersonRef(' P7 ')).toBe('P7');
        expect(researchTaskRef('T12')).toBe('T12');
    });

    it('second wave: new, task do, update, sessions, conflict, story, sync-undo, setup, descendants', () => {
        const t = `tree=${UUID}`;
        const token = 'aB3_-xYz0123456789abcdefGHIJ';
        expect(researchNewUrl(token)).toBe(`strom-research://new?app=${token}`);
        expect(researchNewUrl('short')).toBeNull();
        expect(researchNewUrl('x'.repeat(44))).toBeNull();
        expect(researchNewUrl('a'.repeat(21) + '&')).toBeNull();
        expect(researchAdoptToken('a'.repeat(22))).toBe('a'.repeat(22));
        expect(researchSchemeUrl('new', { tree: UUID })).toBeNull();

        for (const d of ['park', 'drop', 'wake'] as const) {
            expect(researchSchemeUrl('task', { tree: UUID, task: 'T0003', taskDo: d })).toBe(`strom-research://task?${t}&task=T0003&do=${d}`);
        }
        expect(researchSchemeUrl('task', { tree: UUID, task: 'T0003', taskDo: 'delete' as never })).toBeNull();
        for (const a of ['update', 'sessions', 'setup'] as const) {
            expect(researchSchemeUrl(a, { tree: UUID })).toBe(`strom-research://${a}?${t}`);
        }
        expect(researchSchemeUrl('conflict', { tree: UUID, conflict: 'X0007' })).toBe(`strom-research://conflict?${t}&id=X0007&do=decide`);
        expect(researchSchemeUrl('conflict', { tree: UUID, conflict: 'X0007', conflictDo: 'agent' })).toBe(`strom-research://conflict?${t}&id=X0007&do=agent`);
        expect(researchSchemeUrl('conflict', { tree: UUID, conflict: 'T0007' })).toBeNull();
        expect(researchSchemeUrl('conflict', { tree: UUID, conflict: 'X0007', conflictDo: 'drop' as never })).toBeNull();
        expect(researchSchemeUrl('story', { tree: UUID, person: 'P0012' })).toBe(`strom-research://story?${t}&person=P0012&do=final`);
        expect(researchSchemeUrl('story', { tree: UUID })).toBeNull();
        expect(researchSchemeUrl('sync-undo', { tree: UUID, intake: 'I0042' })).toBe(`strom-research://sync-undo?${t}&intake=I0042`);
        expect(researchSchemeUrl('sync-undo', { tree: UUID, intake: 'I42&x' })).toBeNull();
        expect(researchSchemeUrl('research', { tree: UUID, person: 'P0012', direction: 'descendants' }))
            .toBe(`strom-research://research?${t}&person=P0012&direction=descendants`);
        expect(researchConflictRef(' X1 ')).toBe('X1');
        expect(researchConflictRef('C0007')).toBeNull();
        expect(researchIntakeRef('I12345678')).toBeNull();
        expect(sanitizeResearchLinks('new update sessions conflict story sync-undo setup'))
            .toEqual(['new', 'update', 'sessions', 'conflict', 'story', 'sync-undo', 'setup']);
    });
});

describe('bridge status: queue, update, spend, last intake', () => {
    it('takes valid fields', () => {
        const s = sanitizeLiveStatus({
            tree: UUID,
            queue: [
                { id: 'T0123', text: 'Matriky Chlumy', state: 'next' },
                { id: 'T0124', text: 'Sčítání 1880', state: 'parked' },
            ],
            queueMore: 9,
            update: { version: '1.7.0' },
            spend: { month: '2026-09', sessions: 4, amount: 3.2, currency: 'USD' },
            lastIntake: { id: 'I0042', at: '2026-09-27T09:20:00Z' },
        })!;
        expect(s.queue).toEqual([
            { id: 'T0123', text: 'Matriky Chlumy', state: 'next' },
            { id: 'T0124', text: 'Sčítání 1880', state: 'parked' },
        ]);
        expect(s.queueMore).toBe(9);
        expect(s.update).toEqual({ version: '1.7.0' });
        expect(s.spend).toEqual({ month: '2026-09', sessions: 4, amount: 3.2, currency: 'USD' });
        expect(s.lastIntake).toEqual({ id: 'I0042', at: '2026-09-27T09:20:00Z' });
    });

    it('drops a bad field without losing the rest', () => {
        const s = sanitizeLiveStatus({
            tree: UUID,
            head: 'abc',
            queue: [
                { id: 'X1', text: 'bad id', state: 'next' },
                { id: 'T1', text: '', state: 'next' },
                { id: 'T2', text: 'bad state', state: 'running' },
                'junk',
                { id: 'T3', text: 'kept', state: 'next' },
                ...Array.from({ length: 30 }, (_, i) => ({ id: `T${100 + i}`, text: 'x', state: 'next' })),
            ],
            queueMore: -3,
            update: { version: '<b>1.7</b>' },
            spend: { month: '2026-09', sessions: 4, amount: 'lots', currency: 'USD' },
            lastIntake: { id: 'I0042', at: 'yesterday' },
        })!;
        expect(s.head).toBe('abc');
        expect(s.queue[0]).toEqual({ id: 'T3', text: 'kept', state: 'next' });
        expect(s.queue).toHaveLength(20);
        expect(s.queueMore).toBe(0);
        expect(s.update).toBeNull();
        expect(s.spend).toBeNull();
        expect(s.lastIntake).toBeNull();
        expect(sanitizeLiveStatus({ tree: UUID, queue: 'x', spend: [], update: 3 })).toMatchObject({ queue: [], spend: null, update: null });
    });
});

describe('research crop ids (_STROM_CLIP)', () => {
    it('are read from a source OBJE, kept, and written back', () => {
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const ged = ['0 HEAD', '1 SOUR STROM_RESEARCH', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SOUR @S1@',
            '0 @S1@ SOUR', '1 TITL Krest', '1 REFN S0042',
            '1 OBJE', '2 FORM png', '2 _STROM_KIND excerpt', '2 _STROM_CLIP c3', `2 FILE ${png}`,
            '1 OBJE', '2 FORM png', '2 _STROM_KIND excerpt', '2 _STROM_CLIP bad id!', `2 FILE ${png}`,
            '0 TRLR'].join('\n');
        const data = convertToStrom(parseGedcom(ged)).data;
        const src = Object.values(data.sources ?? {})[0];
        expect(src.excerpts?.map(e => e.clip)).toEqual(['c3', undefined]);
        const out = exportToGedcom(data, 'T').content;
        expect(out).toContain('2 _STROM_CLIP c3');
        expect(out.match(/_STROM_CLIP/g)).toHaveLength(1);
    });
});

describe('changeKind (the overview filters)', () => {
    it('sorts change lines into people, sources, stories', () => {
        expect(changeKind('+P0006 Ludmila /Nováková/ · E0006 BIRT 1905 [lead]')).toBe('persons');
        expect(changeKind('F0001 +child P0006')).toBe('persons');
        expect(changeKind('P0012 E0007 BIRT 1865 ← S0012')).toBe('persons');
        expect(changeKind('+S0031 Sčítání lidu 1880')).toBe('sources');
        expect(changeKind('P0012 _STORY navrh')).toBe('stories');
        expect(changeKind('session closed')).toBe('other');
    });

    it('person and source ids stay the only person / source markers', () => {
        expect(changeKind('SPS2026 export')).toBe('other');
        expect(changeKind('~S0031 title')).toBe('sources');
    });
});

describe('person refs in the live status (card badges, overview)', () => {
    it('keeps a valid P-ref on waiting, working and queue items, drops anything else', () => {
        const status = sanitizeLiveStatus({
            tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'X' }, head: 'h1',
            working: [{ who: 'agent', task: 'Matriky', person: 'P0012' }, { who: 'agent-2', person: 'Jan Víšek' }],
            waiting: [{ id: 'T1', what: 'Snímek', person: ' P0013 ' }, { id: 'T2', what: 'Otec', person: 'P12345678' }],
            queue: [{ id: 'T0101', text: 'Sčítání', state: 'next', person: 'P0004' }, { id: 'T0102', text: 'Kniha', state: 'next', person: 7 }],
        })!;
        expect(status.working.map(w => w.person)).toEqual(['P0012', undefined]);
        expect(status.waiting.map(w => w.person)).toEqual(['P0013', undefined]);
        expect(status.queue.map(q => q.person)).toEqual(['P0004', undefined]);
    });
});

describe('headAt in the live status', () => {
    it('keeps a time, drops anything else', () => {
        const base = { tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'X' }, head: 'h1' };
        expect(sanitizeLiveStatus({ ...base, headAt: '2026-09-29T14:36:00+02:00' })!.headAt).toBe('2026-09-29T14:36:00+02:00');
        expect(sanitizeLiveStatus({ ...base, headAt: 'yesterday' })!.headAt).toBe('');
        expect(sanitizeLiveStatus(base)!.headAt).toBe('');
    });
});

describe('the research history (/log)', () => {
    it('keeps entries with a time and lines, newest first; drops the rest', () => {
        const log = sanitizeLiveLog({ entries: [
            { head: 'a1', at: '2026-09-29T14:36:00+02:00', what: ['+P0006 Karel /Víšek/', ''], task: 'T0134 Úmrtí' },
            { head: 'a0', at: 'nope', what: ['x'] },
            { head: 'z', at: '2026-09-29T10:00:00Z', what: [] },
            'junk',
        ] })!;
        expect(log).toEqual([{ head: 'a1', at: '2026-09-29T14:36:00+02:00', what: ['+P0006 Karel /Víšek/'], task: 'T0134 Úmrtí' }]);
        expect(sanitizeLiveLog({ entries: 'no' })).toBeNull();
        expect(sanitizeLiveLog(null)).toBeNull();
    });

    it('changeAdds: a new person or source', () => {
        expect(changeAdds('+P0006 Karel /Víšek/ · E0006 BIRT 1868')).toBe('person');
        expect(changeAdds('+S0031 Sčítání lidu 1880')).toBe('source');
        expect(changeAdds('P0012 E0007 BIRT 1865 ← S0012')).toBeNull();
        expect(changeAdds('F0001 +child P0006')).toBeNull();
    });
});

describe('research directions (researches[])', () => {
    const U = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';

    it('keeps a direction with a valid id, name and state; drops wrong fields, not the direction', () => {
        const s = sanitizeLiveStatus({
            tree: { id: U, name: 'T' },
            researches: [
                { id: 'G0001', name: 'Předci: Jan', state: 'active', direction: 'ancestors', focus: 'P0012', tasks: 5, waiting: 1, working: true,
                    since: '2026-09-29T20:14:00Z', generations: [2, 4, 7], last: { at: '2026-09-29T20:00:00Z', text: 'sňatek nalezen' }, spend: { amount: 3 } },
                { id: 'G0002', name: 'Revize', state: 'paused', direction: 'sideways', focus: 'Jan', tasks: -1, reason: 'x'.repeat(300),
                    generations: Array(13).fill(1), last: { at: 'včera', text: 'nic' } },
                { id: 'X0003', name: 'Špatné id', state: 'active' },
                { id: 'G0004', name: 'Bez stavu' },
                { id: 'G0005', name: '', state: 'done' },
            ],
        })!;
        expect(s.researches).toHaveLength(2);
        expect(s.researches[0]).toEqual({
            id: 'G0001', name: 'Předci: Jan', state: 'active', direction: 'ancestors', focus: 'P0012', tasks: 5, waiting: 1, working: true,
            since: '2026-09-29T20:14:00Z', generations: [2, 4, 7], last: { at: '2026-09-29T20:00:00Z', text: 'sňatek nalezen' },
        });
        const bad = s.researches[1];
        expect(bad).toMatchObject({ id: 'G0002', name: 'Revize', state: 'paused' });
        expect(bad.direction).toBeUndefined();
        expect(bad.focus).toBeUndefined();
        expect(bad.tasks).toBeUndefined();
        expect(bad.generations).toBeUndefined();
        expect(bad.last).toBeUndefined();
        expect(bad.reason!.length).toBeLessThanOrEqual(140);
    });

    it('an older research: an empty list, and tasks without a direction', () => {
        const s = sanitizeLiveStatus({ tree: U, queue: [{ id: 'T0001', text: 'a', state: 'next', research: 'G1x' }] })!;
        expect(s.researches).toEqual([]);
        expect(s.queue[0].research).toBeUndefined();
    });

    it('tasks and runs carry their direction; a run its session', () => {
        const s = sanitizeLiveStatus({
            tree: U,
            queue: [{ id: 'T0001', text: 'a', state: 'next', research: 'G0002' }],
            waiting: [{ id: 'T0002', what: 'b', research: 'G0002' }],
            working: [{ who: 'agent', task: 'c', research: 'G0001', session: 'N0132' }, { who: 'agent', session: 'S1' }],
        })!;
        expect(s.queue[0].research).toBe('G0002');
        expect(s.waiting[0].research).toBe('G0002');
        expect(s.working[0]).toMatchObject({ research: 'G0001', session: 'N0132' });
        expect(s.working[1].session).toBeUndefined();
    });

    it('links: direction pause / done / resume, chat on a direction, finish a session', () => {
        expect(researchSchemeUrl('direction', { tree: U, research: 'G0002', directionDo: 'pause' })).toBe(`strom-research://direction?tree=${U}&id=G0002&do=pause`);
        expect(researchSchemeUrl('direction', { tree: U, research: 'G0002' })).toBeNull();
        expect(researchSchemeUrl('direction', { tree: U, research: 'P0002', directionDo: 'done' })).toBeNull();
        expect(researchSchemeUrl('chat', { tree: U, research: 'G0002' })).toBe(`strom-research://chat?tree=${U}&research=G0002`);
        expect(researchSchemeUrl('chat', { tree: U, research: 'G0002; rm' })).toBeNull();
        expect(researchSchemeUrl('finish', { tree: U, session: 'N0132' })).toBe(`strom-research://finish?tree=${U}&session=N0132`);
        expect(researchSchemeUrl('finish', { tree: U, session: 'T0132' })).toBeNull();
        expect(sanitizeResearchLinks(['direction', 'finish', 'nope'])).toEqual(['direction', 'finish']);
    });
});

describe('kinds of text lines (/log)', () => {
    it('pairs kinds with text line by line, also across an empty line', () => {
        const [e] = sanitizeLiveLog({ entries: [{
            head: 'a', at: '2026-09-30T06:00:00Z', what: ['+P0001 Jan', '+S0002 Matrika'], task: '', research: 'G0001',
            text: ['Nová osoba: Jan', '', 'Nový pramen: Matrika'], kinds: ['person', 'other', 'source'],
        }] })!;
        expect(e.text).toEqual(['Nová osoba: Jan', 'Nový pramen: Matrika']);
        expect(e.kinds).toEqual(['persons', 'sources']);
        expect(e.research).toBe('G0001');
    });

    it('ignores kinds of another length or with unknown values (guessed from what then)', () => {
        const base = { head: 'a', at: '2026-09-30T06:00:00Z', what: ['+P0001 Jan'], task: '', text: ['Nová osoba: Jan'] };
        expect(sanitizeLiveLog({ entries: [{ ...base, kinds: ['person', 'source'] }] })![0].kinds).toBeUndefined();
        expect(sanitizeLiveLog({ entries: [{ ...base, kinds: ['people'] }] })![0].kinds).toBeUndefined();
    });
});

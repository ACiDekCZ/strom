/**
 * Opening a research from Strom Research: header recognition, the loopback
 * allow-list for ?import-url= / ?live=, the create / update / ask decision,
 * stable person ids across updates, and the cleaning of untrusted bridge
 * messages. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import {
    readResearchHeader, parseLoopbackUrl, parseLiveBridge, contentFingerprint,
    decideResearchOpen, stabilizeIds, sanitizeLiveStatus, sanitizeLiveChange,
    sanitizeWorking, extractChangedRefs, personsByRefs, humanizeChange,
    isGedcomFileName, normalizeResearchId, parseEventData, isSafariBrowser,
} from '../research-link.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { StromData } from '../types.js';

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
    it('builds the three endpoints from the bridge address', () => {
        const b = parseLiveBridge('http://127.0.0.1:5123/0123456789abcdef0123456789abcdef/');
        expect(b).toEqual({
            base: 'http://127.0.0.1:5123/0123456789abcdef0123456789abcdef',
            status: 'http://127.0.0.1:5123/0123456789abcdef0123456789abcdef/status',
            ged: 'http://127.0.0.1:5123/0123456789abcdef0123456789abcdef/tree.ged',
            events: 'http://127.0.0.1:5123/0123456789abcdef0123456789abcdef/events',
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

describe('bridge messages are untrusted', () => {
    it('cleans the status and drops malformed items', () => {
        const s = sanitizeLiveStatus({
            strom: '1.0.0',
            tree: { id: UUID.toUpperCase(), name: 'Víškovi\n<img src=x onerror=alert(1)>', lang: 'cs' },
            head: 'abc123',
            persons: 580,
            families: -4,
            working: [{ who: 'agent-1', since: '2026-09-23T10:00:00Z', task: 'Matriky Lučice' }, 'junk', { since: 'x' }],
            waiting: [{ id: 'T1', what: 'Potvrďte otce', on: 'user' }, { id: 'T2' }],
        })!;
        expect(s.treeId).toBe(UUID);
        expect(s.name).toBe('Víškovi <img src=x onerror=alert(1)>');
        expect(s.persons).toBe(580);
        expect(s.families).toBeNull();
        expect(s.working).toEqual([{ who: 'agent-1', since: '2026-09-23T10:00:00Z', task: 'Matriky Lučice' }]);
        expect(s.waiting).toEqual([{ id: 'T1', what: 'Potvrďte otce', on: 'user' }]);
    });

    it('rejects non-objects and a missing tree id', () => {
        expect(sanitizeLiveStatus(null)).toBeNull();
        expect(sanitizeLiveStatus([1, 2])).toBeNull();
        expect(sanitizeLiveStatus({ tree: { id: 'nope' } })!.treeId).toBeNull();
        expect(sanitizeWorking('x')).toEqual([]);
        expect(parseEventData('{bad json')).toBeNull();
        expect(normalizeResearchId(42)).toBeNull();
    });

    it('cleans a change and caps its lines', () => {
        const c = sanitizeLiveChange({ head: 'h2', what: ['+P0101 Marie /Nováková/ ← S0202', 7, ''], at: '2026-09-23T10:05:00Z' })!;
        expect(c.what).toEqual(['+P0101 Marie /Nováková/ ← S0202']);
        const many = sanitizeLiveChange({ what: Array.from({ length: 500 }, (_, i) => `line ${i}`) })!;
        expect(many.what.length).toBe(50);
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

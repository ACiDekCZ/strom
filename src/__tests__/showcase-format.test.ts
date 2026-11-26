/**
 * The showcase file `strom-showcase` (spec 143): its header is read before
 * anything is made of it — an unknown format asks for a newer app, a damaged
 * header is broken, any other .json goes on as a backup or tree — and its
 * versions are ordered as semver. The test fixture (a made-up family of five)
 * is a showcase the app reads whole: its GEDCOM imports and names its research.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    SHOWCASE_FORMAT, parseShowcaseHeader, parseShowcaseFile, isShowcaseFile, compareSampleVersion,
    looksLikeShowcaseText, sampleMarkOf,
} from '../showcase-format.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { readResearchHeader } from '../research-link.js';

const FIXTURE = new URL('../../e2e/fixtures/showcase/strom-ukazka-cs.json', import.meta.url);
const fixtureText = () => readFileSync(FIXTURE, 'utf8');
const fixture = () => JSON.parse(fixtureText()) as Record<string, unknown>;

const header = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    kind: 'strom-showcase', format: 1, lang: 'de', exportId: 'showcase-de', sampleVersion: '3.33.0',
    asOf: '2026-11-01T09:00:00.000Z', name: 'Beispiel – Familie Weber', family: 'Weber', sizeBytes: 7340032, ...extra,
});

describe('parseShowcaseHeader', () => {
    it('a whole header: every field as the file says it', () => {
        const r = parseShowcaseHeader(header({ appVersion: '3.33.0', researchVersion: '1.38.0' }));
        expect(r).toEqual({ ok: true, header: {
            kind: 'strom-showcase', format: 1, lang: 'de', exportId: 'showcase-de', sampleVersion: '3.33.0',
            appVersion: '3.33.0', researchVersion: '1.38.0', asOf: '2026-11-01T09:00:00.000Z',
            name: 'Beispiel – Familie Weber', family: 'Weber', sizeBytes: 7340032,
        } });
    });

    it('a format above the app\'s: a newer showcase (the app updates itself); a format that is no number: broken', () => {
        expect(parseShowcaseHeader(header({ format: SHOWCASE_FORMAT + 1 }))).toEqual({ ok: false, kind: 'newerFormat' });
        expect(parseShowcaseHeader(header({ format: 99 }))).toEqual({ ok: false, kind: 'newerFormat' });
        for (const format of [0, -1, 1.5, '1', null, undefined]) {
            expect(parseShowcaseHeader(header({ format })), String(format)).toEqual({ ok: false, kind: 'broken' });
        }
    });

    it('a showcase without its export id, language, version or date: broken', () => {
        for (const field of ['exportId', 'lang', 'sampleVersion', 'asOf']) {
            expect(parseShowcaseHeader(header({ [field]: undefined })), field).toEqual({ ok: false, kind: 'broken' });
            expect(parseShowcaseHeader(header({ [field]: '' })), `${field} empty`).toEqual({ ok: false, kind: 'broken' });
        }
        expect(parseShowcaseHeader(header({ exportId: 42 }))).toEqual({ ok: false, kind: 'broken' });
        expect(parseShowcaseHeader(header({ sampleVersion: 'latest' }))).toEqual({ ok: false, kind: 'broken' });
        expect(parseShowcaseHeader(header({ asOf: 'yesterday' }))).toEqual({ ok: false, kind: 'broken' });
    });

    it('a language other than cs, en, de, pl: broken', () => {
        for (const lang of ['sk', 'EN', 'cs-CZ', 1]) {
            expect(parseShowcaseHeader(header({ lang })), String(lang)).toEqual({ ok: false, kind: 'broken' });
        }
        for (const lang of ['cs', 'en', 'de', 'pl']) expect(parseShowcaseHeader(header({ lang })).ok, lang).toBe(true);
    });

    it('no showcase kind (a backup, a tree, another file, missing kind): not a showcase, it goes on as before', () => {
        const backup = { tree_1: { name: 'Novákovi', data: { persons: {}, partnerships: {} } } };
        for (const value of [backup, { persons: {}, partnerships: {} }, header({ kind: undefined }), header({ kind: 'strom-backup' }), [], null, 'text', 3]) {
            expect(parseShowcaseHeader(value)).toEqual({ ok: false, kind: 'notShowcase' });
            expect(isShowcaseFile(value)).toBe(false);
        }
        expect(isShowcaseFile(header({ format: 'x' }))).toBe(true);
    });

    it('name, family and size are optional: missing ones are empty or not said', () => {
        const r = parseShowcaseHeader(header({ name: undefined, family: 7, sizeBytes: -3, appVersion: 'main' }));
        expect(r.ok && r.header).toMatchObject({ name: '', family: '' });
        expect(r.ok && 'sizeBytes' in r.header).toBe(false);
        expect(r.ok && 'appVersion' in r.header).toBe(false);
    });

    it('what a showcase tree keeps of its header', () => {
        const r = parseShowcaseHeader(header());
        expect(r.ok && sampleMarkOf(r.header)).toEqual({ exportId: 'showcase-de', lang: 'de', sampleVersion: '3.33.0', asOf: '2026-11-01T09:00:00.000Z' });
    });
});

describe('looksLikeShowcaseText (the first bytes of a dropped file)', () => {
    it('the header first: a showcase; anything else: not', () => {
        expect(looksLikeShowcaseText(fixtureText().slice(0, 4096))).toBe(true);
        expect(looksLikeShowcaseText('﻿{"kind":"strom-showcase","format":1')).toBe(true);
        expect(looksLikeShowcaseText('{"persons":{},"kind":"strom-showcase"}')).toBe(false);
        expect(looksLikeShowcaseText('0 HEAD\n1 SOUR STROM')).toBe(false);
    });
});

describe('parseShowcaseFile', () => {
    it('the fixture: header, a GEDCOM tree and the research it names', () => {
        const r = parseShowcaseFile(fixture());
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.file.header).toMatchObject({ lang: 'cs', exportId: 'showcase-cs', sampleVersion: '3.33.0', name: 'Ukázka – rod Horáků', family: 'Horák' });
        expect(r.file.header.sizeBytes).toBe(Buffer.byteLength(fixtureText(), 'utf8'));
        expect(r.file.research).toEqual({ id: '943fce29-c1c6-5433-8031-96ce4bbbcd8d', status: null, log: null, material: null, queue: null });
        // The research's GEDCOM as the research gives it: its UUID is the snapshot's id.
        expect(readResearchHeader(r.file.tree.text)).toMatchObject({ isStromResearch: true, treeId: r.file.research!.id });
        const { data } = convertToStrom(parseGedcom(r.file.tree.text));
        const persons = Object.values(data.persons);
        expect(persons.map(p => `${p.firstName} ${p.lastName}`).sort()).toEqual(
            ['Anna Horáková', 'Josef Horák', 'Kateřina Vlková', 'Marie Krejčí', 'Václav Horák']);
        expect(persons.find(p => p.firstName === 'Anna')?.photo).toMatch(/^data:image\/png;base64,/);
    });

    it('a showcase whose tree is missing or no GEDCOM, or whose research is of a wrong shape: broken', () => {
        const base = fixture();
        const broken = [
            { ...base, tree: undefined },
            { ...base, tree: { format: 'json', text: '{}' } },
            { ...base, tree: { format: 'ged', text: 'not a gedcom' } },
            { ...base, research: 'x' },
            { ...base, research: { id: '' } },
            { ...base, research: { id: 'r', status: [] } },
        ];
        for (const value of broken) expect(parseShowcaseFile(value)).toEqual({ ok: false, kind: 'broken' });
        // No research at all (null or missing) is a showcase still.
        expect(parseShowcaseFile({ ...base, research: null })).toMatchObject({ ok: true, file: { research: null } });
        expect(parseShowcaseFile({ ...base, research: undefined })).toMatchObject({ ok: true, file: { research: null } });
        // The header's own verdicts come first.
        expect(parseShowcaseFile({ ...base, format: 2 })).toEqual({ ok: false, kind: 'newerFormat' });
        expect(parseShowcaseFile({ persons: {} })).toEqual({ ok: false, kind: 'notShowcase' });
    });
});

describe('compareSampleVersion', () => {
    it('semver order, pre-releases below their release', () => {
        const sorted = ['3.32.0', '3.33.0-beta.1', '3.33.0-beta.2', '3.33.0-beta.10', '3.33.0-rc.1', '3.33.0', '3.33.1', '3.34.0', '4.0.0'];
        for (let i = 0; i < sorted.length - 1; i++) {
            expect(compareSampleVersion(sorted[i], sorted[i + 1]), `${sorted[i]} < ${sorted[i + 1]}`).toBeLessThan(0);
            expect(compareSampleVersion(sorted[i + 1], sorted[i]), `${sorted[i + 1]} > ${sorted[i]}`).toBeGreaterThan(0);
        }
        expect(compareSampleVersion('3.33.0', '3.33.0')).toBe(0);
    });

    it('a value that is no version is older than any version', () => {
        expect(compareSampleVersion('garbage', '0.0.1')).toBeLessThan(0);
        expect(compareSampleVersion('3.33.0', '')).toBeGreaterThan(0);
        expect(compareSampleVersion('x', 'y')).toBe(0);
    });
});

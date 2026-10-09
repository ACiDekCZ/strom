/**
 * What a variant claims that the tree records already (Strom Research, the
 * research's addition of 10 Oct 2026: 3 _INTREE child / partners / siblings
 * under 2 _VAR, each with 4 _PERS and 4 _FAM) must be read safely: nothing
 * thrown, no person, couple or relation lost or invented, everything else as
 * from the same file without those lines, and nothing of it going back out
 * in a GEDCOM. Invented data only (e2e/fixtures/research-hypothesis-intree.ged:
 * research-hypothesis-links.ged plus _INTREE lines — H0022 A and B say
 * Václav and Rozálie are a couple, F0001; H0025 B says Karel is their son).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { stabilizeIds } from '../research-link.js';
import { diffByPerson, diffValues } from '../research-changes.js';
import { validateJsonImport } from '../merge/validation.js';
import { Person, StromData } from '../types.js';

const fixture = (name: string) => readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), 'utf8');
const INTREE = fixture('research-hypothesis-intree.ged');
const LINKS = fixture('research-hypothesis-links.ged');

/** The same file without the _INTREE lines and what is under them. */
function withoutInTreeLines(text: string): string {
    const out: string[] = [];
    let skipBelow: number | null = null;
    for (const line of text.split('\n')) {
        const m = /^(\d+) (\S+)/.exec(line);
        const level = m ? Number(m[1]) : null;
        if (skipBelow !== null && level !== null && level > skipBelow) continue;
        skipBelow = null;
        if (m && m[2] === '_INTREE') { skipBelow = level; continue; }
        out.push(line);
    }
    return out.join('\n');
}

const load = (text: string) => {
    const parsed = parseGedcom(text);
    return { parsed, data: convertToStrom(parsed).data };
};

/** What only the _INTREE lines say. */
function withoutInTree(data: StromData): StromData {
    const copy = structuredClone(data);
    for (const p of Object.values(copy.persons)) {
        for (const h of p.research?.hypotheses ?? []) for (const v of h.variants ?? []) delete v.inTree;
    }
    return copy;
}

/** The data with every generated id replaced by what names the record in the file. */
function normalize(data: StromData): unknown {
    const names = new Map<string, string>();
    for (const [id, p] of Object.entries(data.persons)) names.set(id, `person:${p.refn}`);
    for (const [id, s] of Object.entries(data.sources ?? {})) names.set(id, `source:${s.refn ?? s.title}`);
    for (const [id, u] of Object.entries(data.partnerships)) {
        names.set(id, `couple:${[data.persons[u.person1Id]?.refn, data.persons[u.person2Id]?.refn].join('+')}`);
    }
    const walk = (v: unknown): unknown => {
        if (typeof v === 'string') return names.get(v) ?? v;
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [names.get(k) ?? k, walk(x)]));
        return v;
    };
    return walk(data);
}

const byRefn = (data: StromData, refn: string): Person => Object.values(data.persons).find(p => p.refn === refn)!;

describe('a research file whose variants say what the tree records already (_INTREE) is read safely', () => {
    it('the fixture carries child and partners lines, and without them it is the file of the hypothesis links', () => {
        expect(INTREE).toMatch(/\n3 _INTREE partners\n4 _PERS @P0010@\n4 _PERS @P0011@\n4 _FAM @F0001@\n3 SOUR @S0002@\n/);
        expect(INTREE).toMatch(/\n3 _LINK child\n4 _PERS @P0010@\n4 _FAM @F0042@\n3 _INTREE partners\n/);
        expect(INTREE).toMatch(/\n3 _INTREE child\n4 _PERS @P0001@\n4 _FAM @F0001@\n/);
        expect(withoutInTreeLines(INTREE)).toBe(LINKS);
    });

    it('is read without an error and drops no tag the file without them keeps', () => {
        expect(() => load(INTREE)).not.toThrow();
        expect(load(INTREE).parsed.droppedTags).toEqual(load(LINKS).parsed.droppedTags);
    });

    it('keeps exactly the people, couples, relations, sources and research of the file without them', () => {
        const now = load(INTREE).data;
        const before = load(LINKS).data;
        expect(normalize(withoutInTree(now))).toEqual(normalize(before));
        // the lines are read: only what they say differs
        expect(normalize(now)).not.toEqual(normalize(before));
    });

    it('invents no relation: the couple and the child it names were the tree\'s already, nobody else gains one', () => {
        const { data } = load(INTREE);
        expect(Object.keys(data.persons)).toHaveLength(14);
        expect(Object.keys(data.partnerships)).toHaveLength(4);
        expect(byRefn(data, 'P0010').partnerships).toHaveLength(1);
        expect(byRefn(data, 'P0010').parentIds).toEqual([]);
        expect(byRefn(data, 'P0001').parentIds.map(id => data.persons[id].refn).sort()).toEqual(['P0010', 'P0011']);
        for (const refn of ['P0130', 'P0140', 'P0141', 'P0150']) {
            const p = byRefn(data, refn);
            expect([p.parentIds, p.childIds, p.partnerships]).toEqual([[], [], []]);
        }
    });

    it('nothing of it goes back out in a GEDCOM: the export is the one of the file without them', () => {
        const opts = { research: { id: '7d3f2a10-4b6c-4e8a-9f21-5c0d8e3b1a77' } };
        const now = exportToGedcom(load(INTREE).data, 'Horákovi', opts).content;
        const before = exportToGedcom(load(LINKS).data, 'Horákovi', opts).content;
        expect(now).not.toMatch(/_INTREE|_VAR|_PERS/);
        const undated = (ged: string) => ged.replace(/^1 DATE .*\n(2 TIME .*\n)?/m, '');
        expect(undated(now)).toBe(undated(before));
    });

    it('a JSON copy is valid; a load of it over the tree without them changes nothing of the user\'s', () => {
        const { data } = load(INTREE);
        const json = JSON.stringify(data);
        expect(validateJsonImport(json).valid).toBe(true);
        expect(JSON.parse(json)).toEqual(data);
        const here = load(LINKS).data;
        const there = stabilizeIds(data, here);
        expect(Object.keys(there.persons).sort()).toEqual(Object.keys(here.persons).sort());
        expect(diffByPerson(here, there)).toEqual([]);
        expect(diffValues(here, there)).toEqual({ rows: [], addedPersons: 0, addedFacts: 0, filled: [] });
    });
});

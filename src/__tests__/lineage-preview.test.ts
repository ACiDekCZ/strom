/**
 * The sentences of the "Edit family line" preview (package 1031 §2.2), from
 * previewOverride's output, in cs / en / de. Fictional tree only.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildLineages, previewOverride, rodOf, PreviewLine } from '../lineage.js';
import { lineagePreviewTexts } from '../lineage-preview.js';
import { setLanguage } from '../strings.js';
import { Person, PersonId, StromData, STROM_DATA_VERSION } from '../types.js';

type Sex = 'male' | 'female';
const P = (id: string): PersonId => id as PersonId;

function tree(people: Record<string, { first: string; last: string; sex: Sex; born?: string; parents?: string[] }>, extra: Partial<StromData> = {}): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: P(id), firstName: s.first, lastName: s.last, gender: s.sex, isPlaceholder: false,
            partnerships: [], parentIds: (s.parents ?? []) as PersonId[], childIds: [], birthDate: s.born,
        } as Person;
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    return { version: STROM_DATA_VERSION, persons, partnerships: {}, ...extra } as StromData;
}

/** The Vrbatec line: Hroznost, his sons Ojíř and Radim, and their lines. */
const vrbatec = (extra: Partial<StromData> = {}): StromData => tree({
    hroznost: { first: 'Hroznost', last: 'Vrbatec', sex: 'male', born: '1760' },
    ojir: { first: 'Ojíř', last: 'Vrbatec', sex: 'male', born: '1790', parents: ['hroznost'] },
    radim: { first: 'Radim', last: 'Vrbatec', sex: 'male', born: '1793', parents: ['hroznost'] },
    velebor: { first: 'Velebor', last: 'Vrbatec', sex: 'male', born: '1820', parents: ['ojir'] },
    hostivit: { first: 'Hostivít', last: 'Vrbatec', sex: 'male', born: '1823', parents: ['ojir'] },
    bohuta: { first: 'Bohuta', last: 'Vrbatcová', sex: 'female', born: '1825', parents: ['ojir'] },
    vojmir: { first: 'Vojmír', last: 'Vrbatec', sex: 'male', born: '1850', parents: ['velebor'] },
    radek: { first: 'Radek', last: 'Vrbatec', sex: 'male', born: '1822', parents: ['radim'] },
    mstis: { first: 'Mstiš', last: 'Vrbatec', sex: 'male', born: '1852', parents: ['radek'] },
    dobrohost: { first: 'Dobrohost', last: 'Vrbatec', sex: 'male', born: '1855', parents: ['radek'] },
    chotebor: { first: 'Chotěbor', last: 'Vrbatec', sex: 'male', born: '1858', parents: ['radek'] },
}, extra);

const nameOf = (p: Person): string => `${p.firstName} ${p.lastName}`;

describe('lineage preview sentences', () => {
    afterEach(() => setLanguage('en'));

    it('moving the founder down: the new start, who leaves, the other line, the book', () => {
        setLanguage('cs');
        const data = vrbatec();
        const idx = buildLineages(data);
        const pv = previewOverride(data, { kind: 'founder', personId: P('ojir') }, idx);
        const texts = lineagePreviewTexts(pv.lines, data, nameOf);
        expect(texts[0]).toBe('Rod bude začínat osobou Ojíř Vrbatec (1790): 5 členů.');
        expect(texts).toContain('Linie osoby Radim Vrbatec (1793) bude samostatný rod Vrbatec (1793): 5 členů.');
        expect(texts).toContain('Hroznost Vrbatec přejde do Dalších rodin.');
        expect(texts[texts.length - 1]).toBe('V knize celého stromu zůstanou všechny osoby.');
    });

    it('a line split off: the new line and what is left, in English and German', () => {
        const data = vrbatec();
        const idx = buildLineages(data);
        const pv = previewOverride(data, { kind: 'split', personId: P('velebor') }, idx);
        setLanguage('en');
        expect(lineagePreviewTexts(pv.lines, data, nameOf)).toEqual([
            'A new family line Vrbatec (1820) will begin with Velebor Vrbatec (1820): 2 members.',
            'Velebor Vrbatec and his descendants will move to the new line. In the parents’ family he stays as a son with a link to the new line. The Vrbatec line will have 9 members.',
        ]);
        setLanguage('de');
        expect(lineagePreviewTexts(pv.lines, data, nameOf)[1]).toBe(
            'Velebor Vrbatec und seine Nachkommen wechseln in die neue Stammlinie. In der Familie der Eltern bleibt er als Sohn mit Verweis auf die neue Linie. Die Stammlinie Vrbatec hat dann 9 Mitglieder.');
    });

    it('the Czech accusative after "bude mít", a daughter split off', () => {
        setLanguage('cs');
        const data = vrbatec();
        const idx = buildLineages(data);
        const pv = previewOverride(data, { kind: 'split', personId: P('bohuta') }, idx);
        const texts = lineagePreviewTexts(pv.lines, data, nameOf);
        expect(texts.some(t => t.startsWith('Bohuta Vrbatcová a její potomci přejdou do nového rodu. V rodině rodičů zůstane jako dcera'))).toBe(true);
        expect(texts[texts.length - 1]).toMatch(/bude mít 10 členů\.$/);
    });

    it('a long list of people is cut after three names', () => {
        setLanguage('en');
        const data = vrbatec();
        const ids = ['hroznost', 'ojir', 'radim', 'velebor', 'hostivit'].map(P);
        const lines: PreviewLine[] = [
            { kind: 'toSmall', personIds: ids },
            { kind: 'toSmall', personIds: ids.slice(0, 4) },
            { kind: 'becomeRod', personIds: ids.slice(0, 2), label: 'Vrbatec (1760)' },
        ];
        expect(lineagePreviewTexts(lines, data, nameOf)).toEqual([
            'Hroznost Vrbatec, Ojíř Vrbatec, Radim Vrbatec and 2 more (5 people) will move to Other families.',
            'Hroznost Vrbatec, Ojíř Vrbatec, Radim Vrbatec and Velebor Vrbatec (4 people) will move to Other families.',
            'Hroznost Vrbatec and Ojíř Vrbatec (2 people) will be the Vrbatec (1760) family line.',
        ]);
    });

    it('forms: a merge, a split by a removed form, the group gone, a relation', () => {
        setLanguage('cs');
        const data = vrbatec({ surnameVariants: [['Vrbatec', 'Wrbatec']] });
        data.persons[P('dobrohost')].lastName = 'Wrbatec';
        const lines: PreviewLine[] = [
            { kind: 'merge', label: 'Vrbatec', otherLabel: 'Wrbatec', members: 48, otherMembers: 6 },
            { kind: 'splitByForm', label: 'Vrbatec', before: 22, after: 15, newLabel: 'Wrbatec', personId: P('dobrohost'), year: 1855, members: 7 },
            { kind: 'groupGone', forms: ['Vrbatec', 'Wrbatec'] },
            { kind: 'linkedByRelation', personId: P('dobrohost') },
            { kind: 'noChange' },
        ];
        expect(lineagePreviewTexts(lines, data, nameOf)).toEqual([
            'Spojením se rody Vrbatec a Wrbatec sloučí (48 + 6 osob). Rod Wrbatec zanikne.',
            'Rod se rozdělí: Vrbatec 22 → 15 členů, nový rod Wrbatec (od Dobrohost Wrbatec, 1855): 7 členů.',
            'Skupina tvarů Vrbatec · Wrbatec zanikne (zbyl by jen jeden tvar).',
            'Linie nespojuje tvar, ale vztah rodič–dítě.',
            'Nic se nezmění.',
        ]);
    });

    it('taking a correction back names the line as computed again', () => {
        setLanguage('de');
        const data = vrbatec({ lineageOverrides: { founders: ['velebor'] } });
        const idx = buildLineages(data);
        const rodId = rodOf(idx, P('velebor'))!;
        const pv = previewOverride(data, { kind: 'revert', rodId }, idx);
        expect(lineagePreviewTexts(pv.lines, data, nameOf)).toEqual([
            'Die Stammlinie Vrbatec ist wieder wie berechnet: 11 Mitglieder.',
            'Im Buch des ganzen Stammbaums bleiben alle Personen.',
        ]);
    });
});

/**
 * Step 1 of the import guide and the research (spec 134 §11, 11f–11h,
 * K9.5, K9.6): a target with a research keeps it, a linked source with a
 * target without one offers Swap, two linked trees say the source's link
 * and numbers do not carry over, a new tree will not be linked, another
 * linked tree with the same people is named – and with no tree linked, not
 * a word of the research. The same-people check is cheap: name, surname and
 * birth year. Invented persons only.
 */

import { describe, it, expect } from 'vitest';
import { researchHtml, treeLine } from '../merge/steps/step1-what.js';
import type { Step1Env, TargetRow } from '../merge/steps/context.js';
import { peopleKeys, sharesPeople } from '../merge/same-people.js';
import { setLanguage, strings } from '../strings.js';
import type { Person, PersonId, StromData, TreeId } from '../types.js';

function row(name: string, research: boolean): TargetRow {
    return { treeId: `tree-${name}` as TreeId, name, persons: 12, open: false, research, backup: null, block: null, why: '' };
}

function env(source: TargetRow | null, opts: { swapBlocked?: string; same?: string | null } = {}): Step1Env {
    return {
        sourceTree: () => source,
        swapBlocked: () => opts.swapBlocked ?? '',
        samePeople: () => opts.same ?? null,
    } as Partial<Step1Env> as Step1Env;
}

const RESEARCH = /research|výzkum|Forschung|badan/i;

describe('step 1 says of the research (11f–11h, K9.5)', () => {
    it('no tree linked: not a word of the research', () => {
        for (const lang of ['en', 'cs', 'de'] as const) {
            setLanguage(lang);
            expect(researchHtml(env(row('Habrovi', false)), row('Javorovi', false))).toBe('');
            expect(researchHtml(env(null), row('Javorovi', false))).toBe('');
            expect(researchHtml(env(row('Habrovi', false)), null)).toBe('');
            expect(researchHtml(env(null), null)).not.toMatch(RESEARCH);
        }
        setLanguage('en');
    });

    it('a copy as the target: it has no research, nothing is sent after the merge (spec 139 K5.2, K5.3)', () => {
        setLanguage('en');
        const copy: TargetRow = { ...row('Rodina Kalinovských (kopie)', false), copy: true, origin: strings.research.copyOf('Rodina Kalinovských') };
        const html = researchHtml(env(null), copy);
        expect(html).toContain(strings.structure.mergeNoResearch('Rodina Kalinovských (kopie)'));
        expect(html).not.toContain(strings.mergeWizard.researchKept('Rodina Kalinovských (kopie)'));
        // Its line says what it is as Manage trees does.
        expect(treeLine(copy)).toBe('12 people · copy of the tree “Rodina Kalinovských” · no research');
        expect(treeLine({ ...row('Rodina Kalinovských', true), origin: strings.structure.research('kalinovs') })).toBe('12 people · Research kalinovs');
    });

    it('a target with a research: its link stays', () => {
        setLanguage('en');
        const html = researchHtml(env(null), row('Javorovi', true));
        expect(html).toContain(strings.mergeWizard.researchKept('Javorovi'));
        expect(html).not.toContain('data-s1="swap"');
    });

    it('a linked source into a target without one: the link does not carry over, Swap offered (11g)', () => {
        setLanguage('en');
        const html = researchHtml(env(row('Habrovi', true)), row('Javorovi', false));
        expect(html).toContain(strings.mergeWizard.resSwap('Habrovi', 'Javorovi'));
        expect(html).toContain('data-s1="swap"');
        expect(html).toContain(strings.mergeWizard.resSwapBtn('Javorovi', 'Habrovi'));
        // A source that cannot be the target (locked): the sentence without the button.
        const blocked = researchHtml(env(row('Habrovi', true), { swapBlocked: 'locked' }), row('Javorovi', false));
        expect(blocked).toContain(strings.mergeWizard.resSwap('Habrovi', 'Javorovi'));
        expect(blocked).not.toContain('data-s1="swap"');
    });

    it('two linked trees: the source’s link and numbers do not carry over (11h)', () => {
        setLanguage('en');
        const html = researchHtml(env(row('Habrovi', true)), row('Javorovi', true));
        expect(html).toContain(strings.mergeWizard.researchKept('Javorovi'));
        expect(html).toContain(strings.mergeWizard.resTwo);
        expect(html).not.toContain('data-s1="swap"');
    });

    it('a new tree from a linked one: it will not be linked (11f), said once', () => {
        setLanguage('en');
        expect(researchHtml(env(row('Habrovi', true)), null)).toContain(strings.mergeWizard.resNewTree('Habrovi'));
        // The New tree's description above already says the new tree will not be linked:
        // the research's sentence only says where the research stays, in every language.
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            const W = strings.mergeWizard;
            const shown = `${W.modeNewDesc('Habrovi', 12)} ${W.resNewTree('Habrovi')}`;
            const notLinked = W.modeNewDesc('Habrovi', 12).split(/(?<=\.) /)[1];
            expect(shown.split(notLinked).length - 1, lang).toBe(1);
            expect(W.resNewTree('Habrovi').split(/\. /).length, lang).toBe(1);
        }
        setLanguage('en');
    });

    it('another linked tree with the same people is named (K9.5), into a tree or as a new one', () => {
        setLanguage('en');
        const text = strings.mergeWizard.resSamePeople('Lipovi');
        expect(researchHtml(env(null, { same: 'Lipovi' }), row('Javorovi', false))).toContain(text);
        expect(researchHtml(env(null, { same: 'Lipovi' }), null)).toContain(text);
    });

    it('names are escaped', () => {
        setLanguage('en');
        expect(researchHtml(env(row('<b>Habrovi', true)), null)).not.toContain('<b>Habrovi');
    });
});

function data(people: Array<[string, string, string | undefined]>): StromData {
    const d: StromData = { persons: {}, partnerships: {} };
    people.forEach(([first, last, birth], i) => {
        const p: Person = {
            id: `p${i}` as PersonId, firstName: first, lastName: last, gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...(birth ? { birthDate: birth } : {}),
        };
        d.persons[p.id] = p;
    });
    return d;
}

describe('the same people in another tree (K9.5 heuristic)', () => {
    const branch: Array<[string, string, string | undefined]> = [
        ['Velemír', 'Rozrazil', '1850'], ['Zbyslava', 'Rozrazilová', '12 MAR 1855'], ['Ctibor', 'Rozrazil', '1880'], ['Ludmila', 'Rozrazilová', 'ABT 1882'],
    ];

    it('keys only people with a first name, a surname and a birth year, diacritics and case aside', () => {
        const keys = peopleKeys(data([['Velemír', 'Rozrazil', '1850'], ['Ctibor', '', '1880'], ['Bořek', 'Rozrazil', undefined]]));
        expect([...keys]).toEqual(['velemir|rozrazil|1850']);
    });

    it('a branch of the other tree shares its people; a few common ancestors do not', () => {
        const other = data([...branch, ['Radim', 'Kapradin', '1900'], ['Věnceslava', 'Kapradinová', '1903'], ['Hostivít', 'Dub', '1920']]);
        expect(sharesPeople(data(branch), other)).toBe(true);
        // The same names written otherwise (no diacritics, other case) still match.
        expect(sharesPeople(data(branch.map(([f, l, b]) => [f.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase(), l, b])), other)).toBe(true);
        // Two common people of eight: not the same people.
        const mostlyOther = data([branch[0]!, branch[1]!, ['Radko', 'Javor', '1901'], ['Milota', 'Javorová', '1904'],
            ['Kazimír', 'Javor', '1930'], ['Dobroslav', 'Javor', '1932'], ['Bohuslava', 'Javorová', '1935'], ['Vojmír', 'Javor', '1960']]);
        expect(sharesPeople(mostlyOther, other)).toBe(false);
    });

    it('too few comparable people say nothing', () => {
        expect(sharesPeople(data(branch.slice(0, 2)), data(branch))).toBe(false);
        expect(sharesPeople(data(branch.map(([f, l]) => [f, l, undefined])), data(branch))).toBe(false);
    });

    it('other birth years: not the same people', () => {
        expect(sharesPeople(data(branch), data(branch.map(([f, l]) => [f, l, '1700'])))).toBe(false);
    });
});

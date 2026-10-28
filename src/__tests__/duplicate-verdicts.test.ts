/**
 * The research's verdicts on possible duplicates (spec 021 K3.1, ZADANI_DEV
 * §3): the pairs asked, the reply typed (same / merged / unsure /
 * different, none), the order inside the group, the reasons in words and
 * when the dialog asks at all (the feature).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    duplicatePairKey, issueResearchPair, judgeRequests, parseDuplicatesReply, verdictRank, verdictsMode,
    verdictLabel, verdictReasonText, type DuplicateVerdict,
} from '../duplicate-verdicts.js';
import { sanitizeQualityBridgeRecord } from '../quality-bridge.js';
import { setLanguage } from '../strings.js';
import type { Person, PersonId } from '../types.js';
import type { ValidationIssue } from '../validation.js';

const person = (id: string, extra: Partial<Person> = {}): Person => ({
    id: id as PersonId, firstName: 'Jan', lastName: 'Lhoták', gender: 'male', isPlaceholder: false,
    partnerships: [], parentIds: [], childIds: [], ...extra,
} as Person);

const dup = (a: string, b: string): ValidationIssue => ({
    type: 'possibleDuplicate', severity: 'info', message: '', personIds: [a as PersonId, b as PersonId],
} as ValidationIssue);

afterEach(() => setLanguage('en'));

describe('the pairs asked', () => {
    const persons = {
        jan1: person('jan1', { refn: 'P0012' }),
        jan2: person('jan2', { refn: 'P0340' }),
        jan3: person('jan3'),
        jan4: person('jan4', { refn: 'P0012' }),
    };

    it('both people with the research\'s REFN, in the finding\'s order', () => {
        expect(issueResearchPair(dup('jan2', 'jan1'), persons)).toEqual(['P0340', 'P0012']);
    });

    it('a person without a REFN, the same REFN twice or another finding: not asked', () => {
        expect(issueResearchPair(dup('jan1', 'jan3'), persons)).toBeNull();
        expect(issueResearchPair(dup('jan1', 'jan4'), persons)).toBeNull();
        expect(issueResearchPair({ ...dup('jan1', 'jan2'), type: 'deathBeforeBirth' }, persons)).toBeNull();
    });

    it('each pair once, by 1000 a request', () => {
        const pairs: Array<[string, string]> = [];
        for (let i = 0; i < 2500; i++) pairs.push([`P${i}`, `P${i + 10000}`]);
        pairs.push(['P10000', 'P0']);   // the first pair again, the other way round
        const chunks = judgeRequests(pairs);
        expect(chunks.map(c => c.length)).toEqual([1000, 1000, 500]);
        expect(duplicatePairKey('P2', 'P1')).toBe(duplicatePairKey('P1', 'P2'));
    });
});

describe('the reply', () => {
    it('verdicts by pair; "same" + "merged" is its own kind; unknown-person and unknown words give none', () => {
        const reply = parseDuplicatesReply({
            rev: 'e331685',
            verdicts: [
                { pair: ['P0012', 'P0340'], verdict: 'same', reason: 'same-parents', years: [1820, 1822] },
                { pair: ['P0012', 'P0511'], verdict: 'different', reason: 'parent-child' },
                { pair: ['P0100', 'P0101'], verdict: 'different', reason: 'decided', at: '2026-10-28T12:10:00Z', by: 'app' },
                { pair: ['P0200', 'P0230'], verdict: 'unsure', reason: 'close-years', years: [1801, 1803] },
                { pair: ['P0300', 'P0301'], verdict: 'same', reason: 'merged', into: 'P0300' },
                { pair: ['P0400', 'P9999'], reason: 'unknown-person' },
                { pair: ['P0500', 'P0501'], verdict: 'maybe', reason: 'x' },
                { pair: ['bad', 'P0501'], verdict: 'same', reason: 'same-events' },
                { pair: ['P0600', 'P0601'], verdict: 'unsure', reason: 'overlap', text: 'Daten überschneiden sich', task: 'T0001' },
            ],
        });
        expect(reply!.rev).toBe('e331685');
        const by = new Map(reply!.verdicts.map(v => [v.key, v.verdict]));
        expect(by.size).toBe(8);
        expect(by.get('P0012|P0340')).toEqual({ kind: 'same', reason: 'same-parents', pair: ['P0012', 'P0340'], years: [1820, 1822] });
        expect(by.get('P0012|P0511')!.kind).toBe('different');
        expect(by.get('P0100|P0101')).toMatchObject({ kind: 'different', reason: 'decided', at: '2026-10-28T12:10:00Z', by: 'app' });
        expect(by.get('P0200|P0230')!.kind).toBe('unsure');
        expect(by.get('P0300|P0301')).toMatchObject({ kind: 'merged', into: 'P0300' });
        expect(by.get('P0400|P9999')).toBeNull();
        expect(by.get('P0500|P0501')).toBeNull();
        // `task` (and `extra`) are not drawn: not even kept.
        expect(by.get('P0600|P0601')).toEqual({ kind: 'unsure', reason: 'overlap', pair: ['P0600', 'P0601'], text: 'Daten überschneiden sich' });
    });

    it('not a reply: null', () => {
        expect(parseDuplicatesReply(null)).toBeNull();
        expect(parseDuplicatesReply({ error: 'busy', code: 'research.busy' })).toBeNull();
        expect(parseDuplicatesReply([1, 2])).toBeNull();
    });
});

describe('the order and the labels', () => {
    it('same and merged first, then uncertain; two people and no verdict unranked (set aside / after)', () => {
        expect(verdictRank('same')).toBe(0);
        expect(verdictRank('merged')).toBe(0);
        expect(verdictRank('unsure')).toBe(1);
        expect(verdictRank('different')).toBeUndefined();
        const kinds = ['unsure', 'same', 'unsure', 'merged'] as const;
        const sorted = [...kinds].map((k, at) => ({ k, at }))
            .sort((a, b) => (verdictRank(a.k) ?? Infinity) - (verdictRank(b.k) ?? Infinity) || a.at - b.at).map(x => x.k);
        expect(sorted).toEqual(['same', 'merged', 'unsure', 'unsure']);
    });

    it('labels in Czech', () => {
        setLanguage('cs');
        expect(verdictLabel('same')).toBe('Pravděpodobně táž osoba');
        expect(verdictLabel('merged')).toBe('Ve výzkumu sloučeno');
        expect(verdictLabel('unsure')).toBe('Nejisté');
        expect(verdictLabel('different')).toBe('Dvě osoby');
    });
});

describe('the reasons in words', () => {
    const fmt = (d: string): string => `[${d}]`;
    const a = person('a', { birthDate: '1820', refn: 'P1' });
    const b = person('b', { refn: 'P2', events: [{ id: 'e', type: 'baptism', date: '1822' }] as Person['events'] });
    const v = (reason: string, extra: Partial<DuplicateVerdict> = {}): DuplicateVerdict =>
        ({ kind: 'different', reason, pair: ['P1', 'P2'], ...extra });

    it('Czech: same parents with the source of each year, the years in the finding\'s order', () => {
        setLanguage('cs');
        expect(verdictReasonText(v('same-parents', { kind: 'same', years: [1820, 1822] }), a, b, ['P1', 'P2'], fmt))
            .toBe('stejní rodiče, narození 1820 a křest 1822');
        // The research returned the pair the other way round: the years follow the people.
        expect(verdictReasonText(v('same-parents', { kind: 'same', pair: ['P2', 'P1'], years: [1822, 1820] }), a, b, ['P1', 'P2'], fmt))
            .toBe('stejní rodiče, narození 1820 a křest 1822');
    });

    it('Czech: the new reasons (different sex, names differ, merged) and the others', () => {
        setLanguage('cs');
        expect(verdictReasonText(v('different-sex'), a, b, ['P1', 'P2'], fmt)).toBe('jiné pohlaví');
        expect(verdictReasonText(v('names-differ', { kind: 'unsure' }), a, b, ['P1', 'P2'], fmt)).toBe('ve výzkumu se jména liší');
        expect(verdictReasonText(v('merged', { kind: 'merged' }), a, b, ['P1', 'P2'], fmt))
            .toBe('ve výzkumu už jedna osoba; strom v aplikaci je starší verze');
        expect(verdictReasonText(v('close-years', { kind: 'unsure', years: [1801, 1803] }), a, b, ['P1', 'P2'], fmt))
            .toBe('roky 1801 a 1803, nic dalšího nerozhodne');
        expect(verdictReasonText(v('years-apart', { years: [1820, 1851] }), a, b, ['P1', 'P2'], fmt)).toBe('narozeni 1820 a 1851');
        expect(verdictReasonText(v('parent-child'), a, b, ['P1', 'P2'], fmt)).toBe('otec a syn');
        expect(verdictReasonText(v('parent-child'), { ...a, gender: 'female' }, { ...b, gender: 'female' }, ['P1', 'P2'], fmt)).toBe('matka a dcera');
        expect(verdictReasonText(v('siblings'), a, b, ['P1', 'P2'], fmt)).toBe('sourozenci – druhé dítě dostalo jméno zemřelého');
        expect(verdictReasonText(v('decided', { at: '2026-10-28T12:10:00Z', by: 'app' }), a, b, ['P1', 'P2'], fmt))
            .toBe('označeno jako dvě osoby [2026-10-28]');
        expect(verdictReasonText(v('decided', { at: '2026-10-28T12:10:00Z', by: 'research' }), a, b, ['P1', 'P2'], fmt))
            .toBe('označeno ve výzkumu jako dvě osoby');
        expect(verdictReasonText(v('no-date', { kind: 'unsure' }), a, b, ['P1', 'P2'], fmt)).toBe('u jedné osoby žádné datum');
    });

    it('German and English', () => {
        setLanguage('de');
        expect(verdictReasonText(v('different-sex'), a, b, ['P1', 'P2'], fmt)).toBe('anderes Geschlecht');
        expect(verdictReasonText(v('same-parents', { kind: 'same', years: [1820, 1822] }), a, b, ['P1', 'P2'], fmt))
            .toBe('gleiche Eltern, Geburt 1820 und Taufe 1822');
        setLanguage('en');
        expect(verdictReasonText(v('names-differ', { kind: 'unsure' }), a, b, ['P1', 'P2'], fmt)).toBe('the names differ in the research');
    });

    it('a code the app does not know: the research\'s words, else nothing', () => {
        expect(verdictReasonText(v('overlap', { text: 'dates overlap' }), a, b, ['P1', 'P2'], fmt)).toBe('dates overlap');
        expect(verdictReasonText(v('overlap'), a, b, ['P1', 'P2'], fmt)).toBe('');
    });
});

describe('when the dialog asks (the feature)', () => {
    it('a running bridge that judges: asked; one that does not: nothing said', () => {
        expect(verdictsMode({ research: true, bridgeUp: true, featureNow: true, featureKnown: false })).toBe('query');
        expect(verdictsMode({ research: true, bridgeUp: true, featureNow: false, featureKnown: true })).toBe('none');
    });

    it('not running: one sentence when it judged at the last connection, else nothing', () => {
        expect(verdictsMode({ research: true, bridgeUp: false, featureNow: false, featureKnown: true })).toBe('off');
        expect(verdictsMode({ research: true, bridgeUp: false, featureNow: false, featureKnown: false })).toBe('none');
    });

    it('a tree without a research: nothing', () => {
        expect(verdictsMode({ research: false, bridgeUp: true, featureNow: true, featureKnown: true })).toBe('none');
    });

    it('the device remembers whether the research judged (the record of /quality)', () => {
        expect(sanitizeQualityBridgeRecord({ dismiss: true, judge: true, acked: [] })).toEqual({ dismiss: true, judge: true, acked: [] });
        expect(sanitizeQualityBridgeRecord({ dismiss: true, acked: [] }).judge).toBe(false);
    });
});

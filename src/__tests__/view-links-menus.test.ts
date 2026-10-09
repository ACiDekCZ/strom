/**
 * Linked in the view only, the pure parts of the card's menu, detail and
 * "What research knows": the relationship only the view's links make (the
 * calculator counts real links only), a hypothesis's state and note in
 * words, and the card's signal counting open hypotheses only. Invented data
 * (research-hypothesis-links.ged).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { loadHypothesisLinksTree } from './helpers/hypothesis-links-fixture.js';
import type { PersonId } from '../types.js';
import { ViewLink, researchHypotheses } from '../view-links.js';
import { viewOnlyRelationship } from '../view-link-kinship.js';
import { findRelationship } from '../kinship.js';
import { researchHypothesisNote, researchHypothesisState } from '../research-hypotheses.js';
import { cardSignalInfo } from '../card-signals.js';
import { unionsByPerson } from '../evidence-level.js';
import { setLanguage } from '../strings.js';

afterEach(() => setLanguage('en'));

function link(id: (refn: string) => PersonId, hypo: string, variant: string, kind: ViewLink['kind'], anchor: string, island: string[], addedAt = 1): ViewLink {
    return { hypo, variant, kind, anchorId: id(anchor), islandIds: island.map(id), on: true, addedAt };
}

describe('viewOnlyRelationship', () => {
    it('Karel and Jakub: nothing real; with H0022 B shown, the grandfather — through that link', () => {
        const { data, id } = loadHypothesisLinksTree();
        const b = link(id, 'H0022', 'B', 'child', 'P0010', ['P0125', 'P0126']);
        expect(findRelationship(data, id('P0001'), id('P0125'))).toBeNull();
        expect(viewOnlyRelationship(data, [], id('P0001'), id('P0125'))).toBeNull();
        const r = viewOnlyRelationship(data, [b], id('P0001'), id('P0125'));
        expect(r?.relation.term.en).toBe('grandfather');
        expect(r?.via).toEqual([b]);
        // The data are never changed by it.
        expect(data.persons[id('P0010')].parentIds).toEqual([]);
    });

    it('a real relationship stands alone (no view-only answer), also while a link is shown', () => {
        const { data, id } = loadHypothesisLinksTree();
        const b = link(id, 'H0022', 'B', 'child', 'P0010', ['P0125', 'P0126']);
        expect(viewOnlyRelationship(data, [b], id('P0001'), id('P0010'))).toBeNull();
        // Inside the shown family its real links answer (Jakub is Josef's father).
        expect(viewOnlyRelationship(data, [b], id('P0127'), id('P0125'))).toBeNull();
    });

    it('names only the links the path crosses: Karel and Martin through H0024, not H0022', () => {
        const { data, id } = loadHypothesisLinksTree();
        const c = link(id, 'H0022', 'C', 'child', 'P0010', ['P0130'], 1);
        const martin = link(id, 'H0024', 'A', 'partners', 'P0011', ['P0140'], 2);
        const r = viewOnlyRelationship(data, [c, martin], id('P0001'), id('P0140'));
        expect(r?.relation.term.en).toBe('stepfather');
        expect(r!.via.map(l => l.hypo)).toEqual(['H0024']);
        // Jan (C): Václav's father in the view.
        const jan = viewOnlyRelationship(data, [c, martin], id('P0010'), id('P0130'));
        expect(jan?.relation.term.en).toBe('father');
        expect(jan?.via.map(l => `${l.hypo} ${l.variant}`)).toEqual(['H0022 C']);
    });

    it('people the view does not connect either: null', () => {
        const { data, id } = loadHypothesisLinksTree();
        const b = link(id, 'H0022', 'B', 'child', 'P0010', ['P0125', 'P0126']);
        expect(viewOnlyRelationship(data, [b], id('P0001'), id('P0150'))).toBeNull();
    });
});

describe('a hypothesis in words', () => {
    it('its state: open, decided for a version, abandoned; a newer word as written; nothing said = open', () => {
        const { data } = loadHypothesisLinksTree();
        const h = researchHypotheses(data);
        expect(researchHypothesisState(h.get('H0022')!)).toBe('open');
        expect(researchHypothesisState(h.get('H0026')!)).toBe('decided for B');
        expect(researchHypothesisState(h.get('H0027')!)).toBe('abandoned');
        expect(researchHypothesisState({ title: 'x', status: 'paused' })).toBe('paused');
        expect(researchHypothesisState({ title: 'x' })).toBe('open');
        setLanguage('cs');
        expect(researchHypothesisState(h.get('H0026')!)).toBe('rozhodnutá pro B');
        expect(researchHypothesisState(h.get('H0027')!)).toBe('zrušená');
        setLanguage('de');
        expect(researchHypothesisState(h.get('H0022')!)).toBe('offen');
    });

    it('its note without the lines that only list the versions', () => {
        const { data } = loadHypothesisLinksTree();
        const h = researchHypotheses(data);
        expect(researchHypothesisNote(h.get('H0022')!)).toBe('');
        const note = 'The marriage entry of 1857 names the parents.\nB: son of Jakub\nZ: not a version letter';
        expect(researchHypothesisNote({ ...h.get('H0022')!, note })).toBe('The marriage entry of 1857 names the parents. Z: not a version letter');
        // Without versions the note stays whole.
        expect(researchHypothesisNote({ title: 'x', note: 'A: one\nB: two' })).toBe('A: one\nB: two');
    });
});

describe('the card’s signal', () => {
    it('counts open hypotheses only: a decided or abandoned one no longer', () => {
        const { data, id } = loadHypothesisLinksTree();
        const ctx = {
            data, unions: unionsByPerson(data), treeHasSources: true, research: new Map(),
            settings: { evidence: true, story: true, waiting: true, conflict: true, question: true, agent: true },
        };
        const count = (refn: string) => cardSignalInfo(data.persons[id(refn)], ctx).hypotheses;
        // Rozálie: H0024 open, H0026 decided. Karel: H0025 open, H0027 abandoned. Antonín: H0026 decided, H0028 open.
        expect(count('P0011')).toBe(1);
        expect(count('P0001')).toBe(1);
        expect(count('P0012')).toBe(1);
        expect(count('P0010')).toBe(1);
        // Ludmila: none.
        expect(count('P0013')).toBe(0);
        expect(data.persons[id('P0011')].research?.hypotheses).toHaveLength(2);
    });
});

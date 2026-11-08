import { describe, expect, it } from 'vitest';
import {
    conflictFact, proposalModel, revertAvailability, revertControls, revertOutcome, wasRowModel,
} from '../origin-was.js';
import type { ResearchConflict, ResearchFactOrigin } from '../types.js';

const conflict = (over: Partial<ResearchConflict> = {}): ResearchConflict => ({
    id: 'X0003', fact: 'BIRT', status: 'open', kind: 'import',
    values: [{ value: '1 JAN 1838', side: 'user' }, { value: '3 FEB 1838', side: 'research', sourceIds: ['S0001'] }],
    ...over,
});

describe('wasRowModel', () => {
    it('is null without an earlier value (no row, nothing guessed)', () => {
        expect(wasRowModel(undefined)).toBeNull();
        expect(wasRowModel({ kind: 'research' })).toBeNull();
        expect(wasRowModel({ kind: 'import', importId: 'I1' })).toBeNull();
    });

    it('one changed part: its value, the part a revert names, the key', () => {
        const o: ResearchFactOrigin = { kind: 'research', sourceIds: ['S0002', 'S0001'], was: { value: '1 JAN 1838', parts: ['DATE'], ref: ' E0001 ', importId: 'I1' } };
        expect(wasRowModel(o, id => id === 'S0001')).toEqual({
            values: [{ part: 'DATE', value: '1 JAN 1838' }], partsLabel: null, ref: 'E0001', part: 'DATE', accepted: false, sourceId: 'S0001',
        });
    });

    it('several parts: both values in the fact\'s order, the words for them, no part (the bridge puts back all)', () => {
        const o: ResearchFactOrigin = { kind: 'research', was: { value: 'Podhůří', parts: ['PLAC', 'DATE'], partValues: { DATE: '1 JAN 1838', PLAC: 'Podhůří' }, ref: 'E0001' } };
        const m = wasRowModel(o)!;
        expect(m.values).toEqual([{ part: 'DATE', value: '1 JAN 1838' }, { part: 'PLAC', value: 'Podhůří' }]);
        expect(m.partsLabel).toBe('datePlace');
        expect(m.part).toBeUndefined();
        expect(m.ref).toBe('E0001');
    });

    it('the name\'s two parts read "given name and surname"; other pairs name their parts', () => {
        expect(wasRowModel({ was: { value: 'Jan', parts: ['SURN', 'GIVN'], partValues: { GIVN: 'Jan', SURN: 'Fiala' } } })!.partsLabel).toBe('name');
        expect(wasRowModel({ was: { value: 'x', parts: ['VAL', 'DATE'], partValues: { VAL: 'x', DATE: '1850' } } })!.partsLabel).toBe('other');
    });

    it('no key: the row without Revert; an accepted proposal says so', () => {
        const m = wasRowModel({ kind: 'user', was: { value: 'M' } })!;
        expect(m.ref).toBeUndefined();
        expect(m.accepted).toBe(true);
        expect(m.values).toEqual([{ value: 'M' }]);
    });

    it('a part not known is left out; parts without values fall back to the whole value', () => {
        const m = wasRowModel({ was: { value: '1850', parts: ['DATE', 'BOGUS' as never] } })!;
        expect(m.values).toEqual([{ part: 'DATE', value: '1850' }]);
    });
});

describe('revertAvailability', () => {
    it('no key: no Revert at all', () => {
        expect(revertAvailability({ onComputer: true, bridge: 'live' })).toBeNull();
    });
    it('phone or tablet: the sentence instead of Revert', () => {
        expect(revertAvailability({ ref: 'E1', onComputer: false, bridge: 'live' })).toBe('phone');
        expect(revertAvailability({ ref: 'E1', onComputer: false, bridge: 'down' })).toBe('phone');
    });
    it('the bridge answers: Revert; it does not: Revert off', () => {
        expect(revertAvailability({ ref: 'E1', onComputer: true, bridge: 'live' })).toBe('revert');
        expect(revertAvailability({ ref: 'E1', onComputer: true, bridge: 'down' })).toBe('noBridge');
    });
});

describe('revertOutcome', () => {
    it('written: the row goes, with the notice', () => {
        expect(revertOutcome({ kind: 'ok', head: 'a', parent: 'b' })).toEqual({ state: { kind: 'done' }, toast: 'reverted' });
    });
    it('nothing to put back (409): the row goes, "already reverted"', () => {
        expect(revertOutcome({ kind: 'nothing', reason: '' })).toEqual({ state: { kind: 'done' }, toast: 'already' });
    });
    it('the refusals stay under the row', () => {
        expect(revertOutcome({ kind: 'writeHeld', computer: 'Notebook', reason: '' }).state).toEqual({ kind: 'held', computer: 'Notebook' });
        expect(revertOutcome({ kind: 'writeHeld', reason: '' }).state).toEqual({ kind: 'held' });
        expect(revertOutcome({ kind: 'busy', reason: '' }).state).toEqual({ kind: 'busy' });
        expect(revertOutcome({ kind: 'unknown', reason: '' }).state).toEqual({ kind: 'gone' });
        expect(revertOutcome({ kind: 'noBridge' }).state).toEqual({ kind: 'noBridge' });
        expect(revertOutcome({ kind: 'error', status: 500, code: 'x', reason: '' })).toEqual({ state: { kind: 'error' }, toast: null });
    });
});

describe('revertControls', () => {
    it('idle: Revert; while posting: the dot; done: nothing', () => {
        expect(revertControls('revert')).toEqual({ revert: 'button', note: null, retry: false });
        expect(revertControls('revert', { kind: 'reverting' }).revert).toBe('live');
        expect(revertControls('revert', { kind: 'done' })).toEqual({ revert: 'none', note: null, retry: false });
    });
    it('403 held: Revert stays with the sentence; 503: no Revert, Try again; 404: no Revert', () => {
        expect(revertControls('revert', { kind: 'held', computer: 'PC' })).toEqual({ revert: 'button', note: { kind: 'held', computer: 'PC' }, retry: false });
        expect(revertControls('revert', { kind: 'busy' })).toEqual({ revert: 'none', note: { kind: 'busy' }, retry: true });
        expect(revertControls('revert', { kind: 'gone' })).toEqual({ revert: 'none', note: { kind: 'gone' }, retry: false });
    });
    it('no bridge: Revert off with its sentence; phone: only the sentence; no key: nothing', () => {
        expect(revertControls('noBridge')).toEqual({ revert: 'disabled', note: { kind: 'noBridge' }, retry: false });
        expect(revertControls('revert', { kind: 'noBridge' }).revert).toBe('disabled');
        expect(revertControls('phone')).toEqual({ revert: 'none', note: { kind: 'phone' }, retry: false });
        expect(revertControls(null, { kind: 'busy' })).toEqual({ revert: 'none', note: null, retry: false });
    });
});

describe('conflictFact', () => {
    const typeOf = (tag: string) => (tag === 'OCCU' ? 'occupation' : tag === 'BAPM' ? 'baptism' : null);
    it('birth, death, name, sex by their tags', () => {
        expect(conflictFact({ fact: 'BIRT' }, {}, typeOf)).toBe('birth');
        expect(conflictFact({ fact: 'deat' }, {}, typeOf)).toBe('death');
        expect(conflictFact({ fact: 'NAME' }, {}, typeOf)).toBe('name');
        expect(conflictFact({ fact: 'SEX' }, {}, typeOf)).toBe('sex');
    });
    it('an event only when the person has exactly one of its type', () => {
        const one = { events: [{ id: 'e1', type: 'occupation' }] } as never;
        const two = { events: [{ id: 'e1', type: 'occupation' }, { id: 'e2', type: 'occupation' }] } as never;
        expect(conflictFact({ fact: 'OCCU' }, one, typeOf)).toBe('event:e1');
        expect(conflictFact({ fact: 'OCCU' }, two, typeOf)).toBeNull();
        expect(conflictFact({ fact: 'XYZ' }, one, typeOf)).toBeNull();
    });
});

describe('proposalModel', () => {
    const env = { scope: 'date' as const, partial: false, event: true, canDecide: true, decideLink: true };
    it('only open conflicts of a kind', () => {
        expect(proposalModel(conflict({ kind: undefined }), env)).toBeNull();
        expect(proposalModel(conflict({ status: 'decided' }), env)).toBeNull();
    });
    it('import: the research\'s value; "Conflict ›" when the app decides it', () => {
        const m = proposalModel(conflict(), env)!;
        expect(m.lead).toBe('import');
        expect(m.value?.value).toBe('3 FEB 1838');
        expect(m.action).toBe('open');
    });
    it('a part of a partly corrected event is named', () => {
        expect(proposalModel(conflict(), { ...env, partial: true })).toMatchObject({ lead: 'importPart', part: 'DATE' });
        expect(proposalModel(conflict(), { ...env, partial: true, scope: 'place' })).toMatchObject({ lead: 'importPart', part: 'PLAC' });
        expect(proposalModel(conflict(), { ...env, partial: true, scope: 'fact' })!.lead).toBe('import');
        expect(proposalModel(conflict(), { ...env, partial: true, event: false })!.lead).toBe('import');
    });
    it('user: its lead; not decidable here: "Decide in the research", or nothing without a link', () => {
        expect(proposalModel(conflict({ kind: 'user' }), { ...env, partial: true })!.lead).toBe('user');
        expect(proposalModel(conflict(), { ...env, canDecide: false })!.action).toBe('decide');
        expect(proposalModel(conflict(), { ...env, canDecide: false, decideLink: false })!.action).toBeNull();
    });
});

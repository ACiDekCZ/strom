import { describe, it, expect } from 'vitest';
import { sanitizeSyncReply, personConflictsOf } from '../research-link.js';
import { removedAskOpen, withoutAskedConflicts } from '../research-sync.js';
import { ResearchSendRecord } from '../research-link.js';

/**
 * A person removed by an earlier send of another window (`why: removed`,
 * `removedBy`), and whether a person comes back or goes (`fact: "PERSON"`
 * conflicts of a send's answer, Strom Research `sync.removed`).
 */
describe('a send\'s answer: removed, and PERSON conflicts', () => {
    it('keeps why "removed" with the send that removed the person; a removedBy that is no send mark goes', () => {
        const r = sanitizeSyncReply({ ok: true, notWritten: [
            { kind: 'person.removed', person: 'P0003', why: 'removed', removedBy: 'I0042' },
            { kind: 'person.removed', person: 'P0004', why: 'removed', removedBy: '<b>x</b>' },
            { kind: 'person.delete', person: 'P0005', why: 'kept', removedBy: 'I0042' },
        ] });
        expect(r.notWritten.map(n => [n.person, n.why, n.removedBy])).toEqual([
            ['P0003', 'removed', 'I0042'], ['P0004', 'removed', ''], ['P0005', 'kept', ''],
        ]);
        expect(sanitizeSyncReply(null).personConflicts).toEqual([]);
    });

    it('one question per person: its fact conflicts go with it, the same id asked twice is one, an undecidable one is none', () => {
        const asks = personConflictsOf([
            { id: 'X0007', person: 'P0003', fact: 'BIRT', take: true, sides: { user: '1900', research: '1901' } },
            { id: 'X0008', person: 'P0003', fact: 'PERSON', take: true, sides: { user: 'edited <i>here</i>', research: 'removed by I0042' } },
            { id: 'X0008', person: 'P0003', fact: 'PERSON', take: true, sides: { user: 'again', research: 'again' } },
            { id: 'X0009', person: 'P0004', fact: 'PERSON', sides: { user: 'a', research: 'b' } },
            { id: 'X0010', person: 'P0005', fact: 'NAME', take: true, sides: { user: 'a', research: 'b' } },
            { id: 'Y1', person: 'P0006', fact: 'PERSON', take: true, sides: { user: 'a', research: 'b' } },
        ]);
        expect(asks).toEqual([{ id: 'X0008', person: 'P0003', user: 'edited <i>here</i>', research: 'removed by I0042', facts: ['X0007'] }]);
        expect(sanitizeSyncReply({ ok: true, conflicts: [{ id: 'X0008', person: 'P0003', fact: 'PERSON', take: true, sides: { user: 'a', research: 'b' } }] })
            .personConflicts.map(a => a.id)).toEqual(['X0008']);
    });

    it('open while any send lists it; settled when its send lists others or none; not known otherwise', () => {
        const rec = (intake: string, conflicts: number | null, ids?: string[]): ResearchSendRecord =>
            ({ intake, conflicts, conflictPersons: [], ...(ids ? { conflictIds: ids } : {}) } as unknown as ResearchSendRecord);
        const ask = { id: 'X0008', intake: 'R1' };
        expect(removedAskOpen(ask, [rec('R1', 1, ['X0008'])])).toBe(true);
        expect(removedAskOpen(ask, [rec('R1', 0), rec('R2', 1, ['X0008'])])).toBe(true);
        expect(removedAskOpen(ask, [rec('R1', 0)])).toBe(false);
        expect(removedAskOpen(ask, [rec('R1', 1, ['X0002'])])).toBe(false);
        expect(removedAskOpen(ask, [rec('R1', 1)])).toBeNull();
        expect(removedAskOpen(ask, [rec('R9', 0)])).toBeNull();
        expect(removedAskOpen(ask, null)).toBeNull();
        expect(withoutAskedConflicts([rec('R1', 2, ['X0008', 'X0002'])], new Set(['X0008'])).map(r => [r.conflicts, r.conflictIds]))
            .toEqual([[1, ['X0002']]]);
    });
});

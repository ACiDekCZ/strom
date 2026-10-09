/**
 * The card of a conflict decidable by a side: every state it shows (open,
 * deciding, kept, taken, taken but not loaded, sending first, decided
 * elsewhere, by a link, not on this device, an archive, an error, gone) and
 * "sending comes first" told against the last sending, never against the
 * conflict's words. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { conflictCardView, conflictFactParts, conflictSentChanged, ConflictCardInput, ConflictDecidedValues } from '../research-conflict-card.js';
import { Partnership, Person, PersonId, StromData } from '../types.js';

const values: ConflictDecidedValues = { user: '1852', research: '12. 3. 1851', source: 'Křestní matrika Lipno' };
const view = (over: Partial<ConflictCardInput> = {}) =>
    conflictCardView({ mode: 'bridge', state: null, sendFirst: false, links: true, noAgent: false, ...over });

describe('the card of a decidable conflict: its states (DEV §3)', () => {
    it('open: the sides, both choices on, their sentences, the links under the line with the agent', () => {
        const v = view();
        expect(v).toMatchObject({
            row: 'open', tag: 'open', body: 'sides', notice: null, choices: 'buttons', disabled: false, busyTake: null,
            notes: true, linkNote: false, researchLinks: true, agent: true, unsent: false,
        });
    });

    it('no research links announced here: the choices stay, the links go', () => {
        expect(view({ links: false })).toMatchObject({ row: 'open', choices: 'buttons', researchLinks: false, agent: false });
    });

    it('archive: as open, only without the agent', () => {
        const v = view({ noAgent: true });
        expect(v).toMatchObject({ row: 'open', choices: 'buttons', notes: true, researchLinks: true, agent: false });
    });

    it('busy: the deciding tag, the asked side busy, the other off, the links hidden', () => {
        const v = view({ state: { kind: 'busy', take: 'research' } });
        expect(v).toMatchObject({ row: 'busy', tag: 'busy', body: 'sides', choices: 'buttons', busyTake: 'research', researchLinks: false, agent: false, notice: null });
        // Even when the field moved meanwhile: the request runs, its answer decides.
        expect(view({ state: { kind: 'busy', take: 'user' }, sendFirst: true })).toMatchObject({ row: 'busy', busyTake: 'user', disabled: false });
    });

    it('kept (200, take user): the decided block, the tag decided, no choices, no links', () => {
        const v = view({ state: { kind: 'kept', at: 0, values } });
        expect(v).toMatchObject({ row: 'kept', tag: 'done', body: 'decided', choices: 'none', notice: null, researchLinks: false, agent: false });
    });

    it('taken (200, take research): the decided block as well', () => {
        expect(view({ state: { kind: 'taken', at: 0, values } })).toMatchObject({ row: 'taken', tag: 'done', body: 'decided', choices: 'none', researchLinks: false });
        expect(view({ state: { kind: 'taken', at: 0, values, loaded: { from: '1852' } } })).toMatchObject({ row: 'taken', body: 'decided' });
    });

    it('takenPending ("Later" in Load): the sides hidden, an info row with "Load"', () => {
        const v = view({ state: { kind: 'takenPending', values } });
        expect(v).toMatchObject({ row: 'takenPending', tag: 'done', body: 'notice', choices: 'none', researchLinks: false,
            notice: { tone: 'info', text: 'takenPending', action: 'load' } });
    });

    it('sendFirst: a warning with "Send", both choices off, no sentences, the app\'s side as it is now; the links stay', () => {
        const v = view({ sendFirst: true });
        expect(v).toMatchObject({ row: 'sendFirst', tag: 'open', body: 'sides', choices: 'buttons', disabled: true, notes: false, unsent: true,
            researchLinks: true, notice: { tone: 'warn', text: 'sendFirst', action: 'send' } });
        // By a link as well: deciding in the research waits for the send too.
        expect(view({ mode: 'link', sendFirst: true })).toMatchObject({ row: 'sendFirst', choices: 'links', disabled: true, linkNote: false });
        // Sending comes first over an earlier error.
        expect(view({ sendFirst: true, state: { kind: 'error', take: 'user', error: 'busy' } })).toMatchObject({ row: 'sendFirst' });
    });

    it('elsewhere (409 conflict.decided): an info row and the decided block', () => {
        const v = view({ state: { kind: 'elsewhere', resolution: '12. 3. 1851 (S0001)', take: 'research', values } });
        expect(v).toMatchObject({ row: 'elsewhere', tag: 'done', body: 'decided', choices: 'none', researchLinks: false,
            notice: { tone: 'info', text: 'alreadyDecided', action: null } });
    });

    it('link (no bridge with conflict.decide, the link announced): the choices are links (↗) with the note under the sides', () => {
        const v = view({ mode: 'link' });
        expect(v).toMatchObject({ row: 'link', tag: 'open', body: 'sides', choices: 'links', disabled: false, notes: true, linkNote: true, researchLinks: true });
    });

    it('none (not on this device): the sides without choices or sentences, "Decided on the computer…", no links', () => {
        const v = view({ mode: 'none', links: false });
        expect(v).toMatchObject({ row: 'none', body: 'sides', choices: 'none', notes: false, linkNote: false, researchLinks: false, agent: false,
            notice: { tone: 'info', text: 'remote', action: null } });
        // Never "sending comes first" there: nothing is decided on this device.
        expect(view({ mode: 'none', sendFirst: true })).toMatchObject({ row: 'none', disabled: false, unsent: false });
    });

    it('error (409 busy, 423 locked, no answer): the error row with "Try again", the choices stay on', () => {
        for (const [error, text] of [['busy', 'errBusy'], ['locked', 'errLocked'], ['network', 'errNet']] as const) {
            const v = view({ state: { kind: 'error', take: 'user', error } });
            expect(v).toMatchObject({ row: 'error', tag: 'open', body: 'sides', choices: 'buttons', disabled: false, notes: true, researchLinks: true,
                notice: { tone: 'error', text, action: 'retry' } });
        }
        // An error of the bridge says nothing once the choices are links.
        expect(view({ mode: 'link', state: { kind: 'error', take: 'user', error: 'network' } })).toMatchObject({ row: 'link', notice: null });
    });

    it('gone (404 conflict.none): nothing drawn', () => {
        expect(view({ state: { kind: 'gone' } })).toMatchObject({ row: 'gone', body: 'none' });
    });
});

// ==================== SENDING COMES FIRST ====================

const ANNA = 'p_anna' as PersonId;
const TOMAS = 'p_tomas' as PersonId;

function tree(anna: Partial<Person> = {}, union: Partial<Partnership> = {}): Pick<StromData, 'persons' | 'partnerships'> {
    const base = (id: PersonId, over: Partial<Person>): Person => ({
        id, firstName: '', lastName: '', gender: 'female', partnerships: [], parentIds: [], childIds: [], siblingIds: [], ...over,
    } as unknown as Person);
    return {
        persons: {
            [ANNA]: base(ANNA, { firstName: 'Anna', lastName: 'Dvořáková', gender: 'female', birthDate: '1852', birthPlace: 'Lipno', ...anna }),
            [TOMAS]: base(TOMAS, { firstName: 'Tomáš', lastName: 'Dvořák', gender: 'male' }),
        } as StromData['persons'],
        partnerships: {
            u1: { id: 'u1', person1Id: TOMAS, person2Id: ANNA, childIds: [], status: 'married', startDate: '1876', startPlace: 'Lipno', ...union },
        } as unknown as StromData['partnerships'],
    };
}

describe('sending comes first: the field against the last sending', () => {
    it('the birth date as sent: no; edited after the send: yes', () => {
        const sent = tree({ birthDate: '1852' });
        expect(conflictSentChanged('BIRT', true, ANNA, tree({ birthDate: '1852' }), sent)).toBe(false);
        expect(conflictSentChanged('BIRT', true, ANNA, tree({ birthDate: '1853-06-03' }), sent)).toBe(true);
    });

    it('compares with what was sent, never with the conflict\'s words', () => {
        // The conflict's user value reads "1852" in the research's words; the last sending had 1853 and so has the tree:
        // nothing moved since the send, whatever the words say.
        const sent = tree({ birthDate: '1853' });
        expect(conflictSentChanged('BIRT', true, ANNA, tree({ birthDate: '1853' }), sent)).toBe(false);
        // The tree back at the words' value, but not what was sent: sending comes first.
        expect(conflictSentChanged('BIRT', true, ANNA, tree({ birthDate: '1852' }), sent)).toBe(true);
    });

    it('a date conflict looks at the date only, a place conflict at the place only', () => {
        const sent = tree();
        expect(conflictSentChanged('BIRT', true, ANNA, tree({ birthPlace: 'Praha' }), sent)).toBe(false);
        expect(conflictSentChanged('BIRT', false, ANNA, tree({ birthPlace: 'Praha' }), sent)).toBe(true);
        expect(conflictSentChanged('BIRT', false, ANNA, tree({ birthDate: '1860' }), sent)).toBe(false);
    });

    it('stored values compare trimmed (as the changes per person do)', () => {
        expect(conflictSentChanged('BIRT', false, ANNA, tree({ birthPlace: ' Lipno ' }), tree())).toBe(false);
    });

    it('the death, the name, its titles and the sex', () => {
        expect(conflictSentChanged('DEAT', true, ANNA, tree({ deathDate: '1911' }), tree({ deathDate: '1912' }))).toBe(true);
        expect(conflictSentChanged('NAME', false, ANNA, tree({ firstName: 'Anička' }), tree())).toBe(true);
        expect(conflictSentChanged('NAME', false, ANNA, tree({ birthDate: '1900' }), tree())).toBe(false);
        expect(conflictSentChanged('NPFX', false, ANNA, tree({ titleBefore: 'Ing.' }), tree())).toBe(true);
        expect(conflictSentChanged('NSFX', false, ANNA, tree({ titleAfter: 'st.' }), tree({ titleAfter: 'st.' }))).toBe(false);
        expect(conflictSentChanged('SEX', false, ANNA, tree({ gender: 'male' }), tree())).toBe(true);
    });

    it('a couple\'s wedding: the union\'s start; a divorce: its end', () => {
        expect(conflictSentChanged('MARR', true, ANNA, tree({}, { startDate: '1875' }), tree())).toBe(true);
        expect(conflictSentChanged('MARR', true, TOMAS, tree({}, { startDate: '1875' }), tree())).toBe(true);
        expect(conflictSentChanged('MARR', true, ANNA, tree({}, { startPlace: 'Praha' }), tree())).toBe(false);
        expect(conflictSentChanged('DIV', true, ANNA, tree({}, { endDate: '1890' }), tree())).toBe(true);
    });

    it('another event of the person: its events of that type', () => {
        const chr = (date: string, place = 'Lipno') => ({ events: [{ id: 'e1', type: 'baptism', date, place }] } as unknown as Partial<Person>);
        expect(conflictSentChanged('BAPM', true, ANNA, tree(chr('1852')), tree(chr('1852')))).toBe(false);
        expect(conflictSentChanged('BAPM', true, ANNA, tree(chr('1853')), tree(chr('1852')))).toBe(true);
        expect(conflictSentChanged('BAPM', true, ANNA, tree(chr('1852', 'Praha')), tree(chr('1852')))).toBe(false);
        expect(conflictSentChanged('BAPM', false, ANNA, tree(chr('1852', 'Praha')), tree(chr('1852')))).toBe(true);
    });

    it('not known: the person not in what was sent, a fact the app does not keep', () => {
        const sent = tree();
        delete (sent.persons as Record<string, Person>)[ANNA];
        expect(conflictSentChanged('BIRT', true, ANNA, tree({ birthDate: '1900' }), sent)).toBe(false);
        expect(conflictFactParts('FAMC', false, ANNA, tree())).toBeNull();
        expect(conflictSentChanged('FAMC', false, ANNA, tree(), tree())).toBe(false);
    });
});

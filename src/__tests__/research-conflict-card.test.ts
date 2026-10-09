/**
 * The card of a conflict decidable by a side: every state it shows (open,
 * deciding, kept, taken, taken but not loaded, sending first, decided
 * elsewhere, by a link, not on this device, an archive, an error, gone) and
 * "sending comes first" told against the last sending, never against the
 * conflict's words. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import {
    conflictCardView, conflictFactParts, conflictSentChanged, ConflictCardInput, ConflictDecidedValues, isDecidedRow, otherLoadChanges, DecidedFact,
} from '../research-conflict-card.js';
import { diffValues } from '../research-changes.js';
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

    it('not decidable from the app (422 conflict.no-edit): its own row, no "Try again", the choices off; "Decide in the research ↗" in the notice when links are here', () => {
        const noEdit = { kind: 'error', take: 'research', error: 'noEdit' } as const;
        expect(view({ state: noEdit })).toMatchObject({
            row: 'noEdit', tag: 'open', body: 'sides', choices: 'buttons', disabled: true, notes: false, linkNote: false,
            notice: { tone: 'info', text: 'noEdit', action: 'decide' },
            // The link is in the notice, not twice under the line; the agent stays there.
            researchLinks: false, agent: true,
        });
        expect(view({ state: noEdit, noAgent: true })).toMatchObject({ row: 'noEdit', researchLinks: false, agent: false });
        // No links here: the sentence alone.
        expect(view({ state: noEdit, links: false })).toMatchObject({ row: 'noEdit', notice: { text: 'noEdit', action: null }, agent: false });
        // By a link as well (the research said so), and over sending first: neither helps.
        expect(view({ mode: 'link', state: noEdit })).toMatchObject({ row: 'noEdit', choices: 'links', disabled: true, linkNote: false });
        expect(view({ state: noEdit, sendFirst: true })).toMatchObject({ row: 'noEdit', notice: { text: 'noEdit' } });
        // Not on this device: still said, no links.
        expect(view({ mode: 'none', state: noEdit })).toMatchObject({ row: 'noEdit', choices: 'none', notice: { text: 'noEdit', action: null } });
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
        expect(conflictSentChanged('BIRT', ANNA, tree({ birthDate: '1852' }), sent)).toBe(false);
        expect(conflictSentChanged('BIRT', ANNA, tree({ birthDate: '1853-06-03' }), sent)).toBe(true);
    });

    it('compares with what was sent, never with the conflict\'s words', () => {
        // The conflict's user value reads "1852" in the research's words; the last sending had 1853 and so has the tree:
        // nothing moved since the send, whatever the words say.
        const sent = tree({ birthDate: '1853' });
        expect(conflictSentChanged('BIRT', ANNA, tree({ birthDate: '1853' }), sent)).toBe(false);
        // The tree back at the words' value, but not what was sent: sending comes first.
        expect(conflictSentChanged('BIRT', ANNA, tree({ birthDate: '1852' }), sent)).toBe(true);
    });

    it('an event\'s conflict looks at the whole fact: its date or its place moved since the send', () => {
        const sent = tree();
        expect(conflictSentChanged('BIRT', ANNA, tree(), sent)).toBe(false);
        expect(conflictSentChanged('BIRT', ANNA, tree({ birthPlace: 'Praha' }), sent)).toBe(true);
        expect(conflictSentChanged('BIRT', ANNA, tree({ birthDate: '1860' }), sent)).toBe(true);
    });

    it('a part of a documented fact deleted and sent (the death date, the place kept), then typed again: sending comes first', () => {
        const sent = tree({ deathDate: '', deathPlace: 'Žďár' });
        expect(conflictSentChanged('DEAT', ANNA, tree({ deathPlace: 'Žďár' }), sent)).toBe(false);
        expect(conflictSentChanged('DEAT', ANNA, tree({ deathDate: '1865-10-23', deathPlace: 'Žďár' }), sent)).toBe(true);
        // The fact as the research says it: the value, the date, the place.
        expect(conflictFactParts('DEAT', 'fact', ANNA, tree({ deathDate: '1865-10-23', deathPlace: 'Žďár' }))).toEqual(['\u00001865-10-23\u0000Žďár']);
        expect(conflictFactParts('DEAT', 'date', ANNA, tree({ deathDate: '1865-10-23', deathPlace: 'Žďár' }))).toEqual(['1865-10-23']);
        expect(conflictFactParts('DEAT', 'place', ANNA, tree({ deathDate: '1865-10-23', deathPlace: 'Žďár' }))).toEqual(['Žďár']);
    });

    it('stored values compare trimmed (as the changes per person do)', () => {
        expect(conflictSentChanged('BIRT', ANNA, tree({ birthPlace: ' Lipno ' }), tree())).toBe(false);
    });

    it('the death, the name, its titles and the sex', () => {
        expect(conflictSentChanged('DEAT', ANNA, tree({ deathDate: '1911' }), tree({ deathDate: '1912' }))).toBe(true);
        expect(conflictSentChanged('NAME', ANNA, tree({ firstName: 'Anička' }), tree())).toBe(true);
        expect(conflictSentChanged('NAME', ANNA, tree({ birthDate: '1900' }), tree())).toBe(false);
        expect(conflictSentChanged('NPFX', ANNA, tree({ titleBefore: 'Ing.' }), tree())).toBe(true);
        expect(conflictSentChanged('NSFX', ANNA, tree({ titleAfter: 'st.' }), tree({ titleAfter: 'st.' }))).toBe(false);
        expect(conflictSentChanged('SEX', ANNA, tree({ gender: 'male' }), tree())).toBe(true);
    });

    it('an empty field (a value deleted here) compares as empty, not as missing', () => {
        // Deleted and sent: the same emptiness, stored as '' or not at all.
        expect(conflictSentChanged('NPFX', ANNA, tree({ titleBefore: '' }), tree())).toBe(false);
        expect(conflictSentChanged('NPFX', ANNA, tree(), tree({ titleBefore: '' }))).toBe(false);
        expect(conflictSentChanged('NPFX', ANNA, tree({ titleBefore: ' ' }), tree())).toBe(false);
        expect(conflictFactParts('NPFX', 'place', ANNA, tree())).toEqual(['']);
        // Typed again after the send: sending comes first; deleted after a send that had it: too.
        expect(conflictSentChanged('NPFX', ANNA, tree({ titleBefore: 'Ing.' }), tree({ titleBefore: '' }))).toBe(true);
        expect(conflictSentChanged('NPFX', ANNA, tree({ titleBefore: '' }), tree({ titleBefore: 'Ing.' }))).toBe(true);
        expect(conflictSentChanged('BIRT', ANNA, tree({ birthDate: '' }), tree({ birthDate: undefined }))).toBe(false);
    });

    it('a couple\'s wedding: the union\'s start; a divorce: its end', () => {
        expect(conflictSentChanged('MARR', ANNA, tree({}, { startDate: '1875' }), tree())).toBe(true);
        expect(conflictSentChanged('MARR', TOMAS, tree({}, { startDate: '1875' }), tree())).toBe(true);
        // The wedding's place moved, or its deleted date typed again: the whole fact.
        expect(conflictSentChanged('MARR', ANNA, tree({}, { startPlace: 'Praha' }), tree())).toBe(true);
        expect(conflictSentChanged('MARR', TOMAS, tree({}, { startDate: '1876' }), tree({}, { startDate: '' }))).toBe(true);
        expect(conflictSentChanged('MARR', TOMAS, tree({}, { startDate: '' }), tree({}, { startDate: undefined }))).toBe(false);
        expect(conflictSentChanged('DIV', ANNA, tree({ birthPlace: 'Praha' }), tree())).toBe(false);
        expect(conflictSentChanged('DIV', ANNA, tree({}, { endDate: '1890' }), tree())).toBe(true);
    });

    it('another event of the person: its events of that type', () => {
        const chr = (date: string, place = 'Lipno') => ({ events: [{ id: 'e1', type: 'baptism', date, place }] } as unknown as Partial<Person>);
        expect(conflictSentChanged('BAPM', ANNA, tree(chr('1852')), tree(chr('1852')))).toBe(false);
        expect(conflictSentChanged('BAPM', ANNA, tree(chr('1853')), tree(chr('1852')))).toBe(true);
        expect(conflictSentChanged('BAPM', ANNA, tree(chr('1852', 'Praha')), tree(chr('1852')))).toBe(true);
        // An occupation's value deleted and sent, then typed again: the value is a part of the fact too.
        const occu = (note: string) => ({ events: [{ id: 'e2', type: 'occupation', date: '1865', note }] } as unknown as Partial<Person>);
        expect(conflictSentChanged('OCCU', ANNA, tree(occu('')), tree(occu('')))).toBe(false);
        expect(conflictSentChanged('OCCU', ANNA, tree(occu('tkadlec')), tree(occu('')))).toBe(true);
        expect(conflictSentChanged('BURI', ANNA, tree(occu('tkadlec')), tree(occu('')))).toBe(false);
    });

    it('not known: the person not in what was sent, a fact the app does not keep', () => {
        const sent = tree();
        delete (sent.persons as Record<string, Person>)[ANNA];
        expect(conflictSentChanged('BIRT', ANNA, tree({ birthDate: '1900' }), sent)).toBe(false);
        expect(conflictFactParts('FAMC', 'place', ANNA, tree())).toBeNull();
        expect(conflictSentChanged('FAMC', ANNA, tree(), tree())).toBe(false);
    });
});

// ==================== LOADING THE RESEARCH'S VERSION AFTER A DECISION ====================

describe('a decision for the research\'s value: what else its version changes here', () => {
    const full = (anna: Partial<Person> = {}, union: Partial<Partnership> = {}) => ({ ...tree(anna, union), sources: {} }) as StromData;
    const birth: DecidedFact = { persons: [ANNA], fact: 'BIRT', scope: 'date' };

    it('only the decided value: nothing else (the load goes quietly)', () => {
        const diff = diffValues(full({ birthDate: '1852' }), full({ birthDate: '1851-03-12' }));
        expect(diff.rows).toHaveLength(1);
        expect(isDecidedRow(diff.rows[0], [birth])).toBe(true);
        expect(otherLoadChanges(diff, [birth])).toBe(0);
    });

    it('another value overwritten, a fact added: counted, the decided one not', () => {
        const diff = diffValues(full({ birthDate: '1852', deathDate: '1930' }), full({ birthDate: '1851-03-12', deathDate: '1931', deathPlace: 'Lipno' }));
        expect(otherLoadChanges(diff, [birth])).toBe(2);
        // Without a decision every change counts.
        expect(otherLoadChanges(diff, [])).toBe(3);
    });

    it('the date decided, the place of the same event changed: the place counts', () => {
        const diff = diffValues(full({ birthDate: '1852', birthPlace: 'Lipno' }), full({ birthDate: '1851', birthPlace: 'Praha' }));
        expect(otherLoadChanges(diff, [birth])).toBe(1);
        expect(otherLoadChanges(diff, [birth, { persons: [ANNA], fact: 'BIRT', scope: 'place' }])).toBe(0);
    });

    it('only at the people the conflict is shown at', () => {
        const diff = diffValues(full({ birthDate: '1852' }), full({ birthDate: '1851' }));
        expect(otherLoadChanges(diff, [{ persons: [TOMAS], fact: 'BIRT', scope: 'date' }])).toBe(1);
    });

    it('a couple\'s wedding (its row at the first partner), the name with its titles, the sex', () => {
        const wedding = diffValues(full({}, { startDate: '1876' }), full({}, { startDate: '1877' }));
        expect(otherLoadChanges(wedding, [{ persons: [TOMAS, ANNA], fact: 'MARR', scope: 'date' }])).toBe(0);
        expect(otherLoadChanges(wedding, [{ persons: [TOMAS, ANNA], fact: 'MARR', scope: 'place' }])).toBe(1);
        const name = diffValues(full({ titleBefore: 'Ing.' }), full({ titleBefore: 'Mgr.' }));
        expect(otherLoadChanges(name, [{ persons: [ANNA], fact: 'NPFX', scope: 'place' }])).toBe(0);
        const sex = diffValues(full({ gender: 'female' }), full({ gender: 'male' }));
        expect(otherLoadChanges(sex, [{ persons: [ANNA], fact: 'SEX', scope: 'place' }])).toBe(0);
        expect(otherLoadChanges(sex, [{ persons: [ANNA], fact: 'NAME', scope: 'place' }])).toBe(1);
    });

    it('a part deleted here coming back with the version (the death date, the place kept): the decided value when the conflict is the whole fact', () => {
        const diff = diffValues(full({ deathPlace: 'Žďár' }), full({ deathDate: '1865-10-23', deathPlace: 'Žďár' }));
        expect(diff.rows).toEqual([]);
        expect(diff.filled.map(r => [r.field, r.here, r.there])).toEqual([['deathDate', '', '1865-10-23']]);
        expect(otherLoadChanges(diff, [{ persons: [ANNA], fact: 'DEAT', scope: 'fact' }])).toBe(0);
        expect(otherLoadChanges(diff, [{ persons: [ANNA], fact: 'DEAT', scope: 'date' }])).toBe(0);
        // Only the place decided: the date coming back is another change.
        expect(otherLoadChanges(diff, [{ persons: [ANNA], fact: 'DEAT', scope: 'place' }])).toBe(1);
        expect(otherLoadChanges(diff, [])).toBe(1);
        // A couple's wedding date (its row at the first partner), an occupation's value.
        const wedding = diffValues(full({}, { startDate: '' }), full({}, { startDate: '1840-02-12' }));
        expect(otherLoadChanges(wedding, [{ persons: [TOMAS, ANNA], fact: 'MARR', scope: 'fact' }])).toBe(0);
        const occu = (note: string) => ({ events: [{ id: 'e2', type: 'occupation', date: '1865', note }] } as unknown as Partial<Person>);
        const value = diffValues(full(occu('')), full(occu('tkadlec')));
        expect(otherLoadChanges(value, [{ persons: [ANNA], fact: 'OCCU', scope: 'fact' }])).toBe(0);
        expect(otherLoadChanges(value, [{ persons: [ANNA], fact: 'OCCU', scope: 'date' }])).toBe(1);
    });

    it('another event: its type only', () => {
        const ev = (type: string, date: string) => ({ events: [{ id: 'e1', type, date, place: 'Lipno' }] } as unknown as Partial<Person>);
        const diff = diffValues(full(ev('baptism', '1852')), full(ev('baptism', '1851')));
        expect(otherLoadChanges(diff, [{ persons: [ANNA], fact: 'BAPM', scope: 'date' }])).toBe(0);
        expect(otherLoadChanges(diff, [{ persons: [ANNA], fact: 'BURI', scope: 'date' }])).toBe(1);
    });
});

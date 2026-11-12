/**
 * The satellite's states (spec 079 §3): which strip, which state in place of
 * the content and whether the skeleton shows, by the client's state (3 before
 * 2, a state in place of the content before the skeleton); a refused edit's
 * draft comes back once the fresh tree is in (3d).
 */

import { describe, it, expect, vi } from 'vitest';
import { satelliteScreen, type SatScreenInput } from '../sat-states.js';
import { draftToRestore, wireWindowDrafts, cellDraft, type DraftsClient, type PersonDraft } from '../window-drafts.js';

const base: SatScreenInput = { connection: 'connected', hasTree: true, gone: false, live: false, locked: false, awaitingTree: false };
const screen = (over: Partial<SatScreenInput>) => satelliteScreen({ ...base, ...over });

describe('satelliteScreen', () => {
    it('a tree shown: nothing over it', () => {
        expect(screen({})).toEqual({ strip: null, empty: null, loading: false, muted: false });
    });

    it('1 loading: no tree yet, or the tree held back by a lock until it is sent anew; the header muted', () => {
        expect(screen({ hasTree: false, connection: 'connecting' })).toEqual({ strip: null, empty: null, loading: true, muted: true });
        expect(screen({ awaitingTree: true })).toMatchObject({ loading: true, muted: true });
        // Live research has nothing to say over a skeleton.
        expect(screen({ hasTree: false, live: true })).toMatchObject({ strip: null, loading: true });
    });

    it('2 read-only: the neutral strip while the main window follows a live research', () => {
        expect(screen({ live: true })).toEqual({ strip: 'live', empty: null, loading: false, muted: false });
    });

    it('3 main closed: the amber strip, before 2', () => {
        expect(screen({ connection: 'main-closed' })).toMatchObject({ strip: 'closed', empty: null, loading: false });
        expect(screen({ connection: 'main-closed', live: true })).toMatchObject({ strip: 'closed' });
    });

    it('5b gone: the state in place of the content; with the main window closed too, both', () => {
        expect(screen({ gone: true })).toEqual({ strip: null, empty: 'gone', loading: false, muted: true });
        expect(screen({ gone: true, connection: 'main-closed' })).toMatchObject({ strip: 'closed', empty: 'gone' });
        expect(screen({ gone: true, live: true })).toMatchObject({ strip: null, empty: 'gone' });
    });

    it('6 locked: the state in place of the content and no strip 2; a closed main window shows its copy as of then', () => {
        expect(screen({ locked: true, awaitingTree: true, live: true })).toEqual({ strip: null, empty: 'locked', loading: false, muted: true });
        expect(screen({ locked: true, connection: 'main-closed' })).toMatchObject({ strip: 'closed', empty: null, loading: false });
    });
});

type Handler = (e: never) => void;

function fakeClient(): DraftsClient & { fire: (event: 'conflict' | 'tree', e: unknown) => void } {
    const handlers: Record<string, Handler[]> = {};
    return {
        on: ((event: string, cb: Handler) => {
            (handlers[event] ??= []).push(cb);
            return () => {};
        }) as DraftsClient['on'],
        fire: (event, e) => { for (const h of handlers[event] ?? []) h(e as never); },
    };
}

describe('drafts of a refused edit', () => {
    const person: PersonDraft = { kind: 'person', tree: 't', personId: 'p1', fields: { 'pm-first-name': { value: 'Zbyhněv' } } };

    it('the newest draft is the one brought back; anything else is ignored', () => {
        const a = cellDraft('t', 'persons', 'p1', 'firstName', 'A');
        const b = cellDraft('t', 'persons', 'p2', 'firstName', 'B');
        expect(draftToRestore([a, { kind: 'other' }, b, null])).toEqual(b);
        expect(draftToRestore([person, 'x'])).toEqual(person);
        expect(draftToRestore([])).toBeNull();
    });

    it('comes back once the fresh tree is in, not before and not again', () => {
        const client = fakeClient();
        const deps = { reopenCell: vi.fn(() => true), reopenPerson: vi.fn(() => true), markOpenCell: vi.fn(() => false) };
        wireWindowDrafts(client, deps);
        const draft = cellDraft('t', 'persons', 'p1', 'firstName', 'Zbyhněv');
        client.fire('conflict', { drafts: [draft] });
        expect(deps.reopenCell).not.toHaveBeenCalled();
        client.fire('tree', { afterConflict: true });
        expect(deps.reopenCell).toHaveBeenCalledWith(draft);
        client.fire('tree', { afterConflict: true });
        expect(deps.reopenCell).toHaveBeenCalledTimes(1);
        expect(deps.markOpenCell).not.toHaveBeenCalled();
    });

    it('the person dialog opens again with its fields', () => {
        const client = fakeClient();
        const deps = { reopenCell: vi.fn(() => true), reopenPerson: vi.fn(() => true), markOpenCell: vi.fn(() => false) };
        wireWindowDrafts(client, deps);
        client.fire('conflict', { drafts: [person] });
        client.fire('tree', { afterConflict: true });
        expect(deps.reopenPerson).toHaveBeenCalledWith(person);
        expect(deps.reopenCell).not.toHaveBeenCalled();
    });

    it('no draft sent (or its cell gone): an editor still open is framed as a draft', () => {
        const client = fakeClient();
        const deps = { reopenCell: vi.fn(() => false), reopenPerson: vi.fn(() => true), markOpenCell: vi.fn(() => true) };
        wireWindowDrafts(client, deps);
        client.fire('conflict', { drafts: [] });
        client.fire('tree', { afterConflict: true });
        expect(deps.markOpenCell).toHaveBeenCalledTimes(1);
        client.fire('conflict', { drafts: [cellDraft('t', 'persons', 'gone', 'firstName', 'x')] });
        client.fire('tree', { afterConflict: true });
        expect(deps.markOpenCell).toHaveBeenCalledTimes(2);
    });

    it('a tree without a conflict (a switch) brings nothing back', () => {
        const client = fakeClient();
        const deps = { reopenCell: vi.fn(() => true), reopenPerson: vi.fn(() => true), markOpenCell: vi.fn(() => true) };
        wireWindowDrafts(client, deps);
        client.fire('tree', { afterConflict: false });
        client.fire('tree', { afterConflict: true });
        expect(deps.reopenCell).not.toHaveBeenCalled();
        expect(deps.markOpenCell).not.toHaveBeenCalled();
    });
});

/**
 * Sources / citations tests: DataManager CRUD (with undo), the remove-cascade
 * that strips citations, cite/uncite on persons and events, and privacy
 * stripping of citations + the source catalog.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StromData, PersonId, TreeId, NewPersonData, Gender, Person, Source, LifeEvent } from '../types.js';
import { applyLivingPrivacy } from '../privacy.js';

const TREE = 'sources-test-tree' as TreeId;

function personData(firstName: string, gender: Gender = 'male'): NewPersonData {
    return { firstName, lastName: 'Test', gender };
}

function reset(): void {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    vi.spyOn(DataManager, 'isTreeLocked').mockReturnValue(false);
    const dm = DataManager as unknown as {
        data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
    };
    dm.data = { persons: {}, partnerships: {} };
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

beforeEach(reset);

describe('DataManager sources CRUD', () => {
    it('adds a source and undoes it', () => {
        const src = DataManager.addSource({ title: 'Parish register Děčín 1880' });
        expect(src).not.toBeNull();
        expect(DataManager.getData().sources?.[src!.id].title).toBe('Parish register Děčín 1880');

        DataManager.undo();
        expect(DataManager.getData().sources).toBeUndefined();

        DataManager.redo();
        expect(Object.keys(DataManager.getData().sources ?? {})).toHaveLength(1);
    });

    it('rejects a source without a title', () => {
        expect(DataManager.addSource({ title: '   ' })).toBeNull();
        expect(DataManager.getData().sources).toBeUndefined();
    });

    it('updates a source', () => {
        const src = DataManager.addSource({ title: 'A' })!;
        expect(DataManager.updateSource(src.id, { title: 'B', reference: 'p. 42' })).toBe(true);
        expect(DataManager.getData().sources?.[src.id].title).toBe('B');
        expect(DataManager.getData().sources?.[src.id].reference).toBe('p. 42');
    });
});

describe('citations', () => {
    it('cites a source on a person and undoes it', () => {
        const p = DataManager.createPerson(personData('Alice', 'female'));
        const src = DataManager.addSource({ title: 'Census 1900' })!;

        expect(DataManager.citePerson(p.id, src.id)).toBe(true);
        expect(DataManager.getPerson(p.id)?.sourceIds).toEqual([src.id]);
        // Citing again is a no-op.
        expect(DataManager.citePerson(p.id, src.id)).toBe(false);

        DataManager.undo();
        expect(DataManager.getPerson(p.id)?.sourceIds).toBeUndefined();
    });

    it('cites a source on a life event', () => {
        const p = DataManager.createPerson(personData('Bob'));
        const event = DataManager.addLifeEvent(p.id, { type: 'baptism', date: '1900' })!;
        const src = DataManager.addSource({ title: 'Baptism record' })!;

        expect(DataManager.citeEvent(p.id, event.id, src.id)).toBe(true);
        expect(DataManager.getPerson(p.id)?.events?.[0].sourceIds).toEqual([src.id]);

        expect(DataManager.unciteEvent(p.id, event.id, src.id)).toBe(true);
        expect(DataManager.getPerson(p.id)?.events?.[0].sourceIds).toBeUndefined();
    });

    it('counts citations across persons and events', () => {
        const a = DataManager.createPerson(personData('A'));
        const b = DataManager.createPerson(personData('B'));
        const ev = DataManager.addLifeEvent(a.id, { type: 'residence', place: 'Praha' })!;
        const src = DataManager.addSource({ title: 'Shared' })!;
        DataManager.citePerson(a.id, src.id);
        DataManager.citePerson(b.id, src.id);
        DataManager.citeEvent(a.id, ev.id, src.id);
        expect(DataManager.countSourceCitations(src.id)).toBe(3);
    });
});

describe('removing a source cascades to citations', () => {
    it('strips every citation and undo restores them', () => {
        const a = DataManager.createPerson(personData('A'));
        const b = DataManager.createPerson(personData('B'));
        const ev = DataManager.addLifeEvent(a.id, { type: 'burial' })!;
        const src = DataManager.addSource({ title: 'To delete' })!;
        DataManager.citePerson(a.id, src.id);
        DataManager.citePerson(b.id, src.id);
        DataManager.citeEvent(a.id, ev.id, src.id);
        expect(DataManager.countSourceCitations(src.id)).toBe(3);

        expect(DataManager.removeSource(src.id)).toBe(true);
        expect(DataManager.getData().sources).toBeUndefined();
        expect(DataManager.getPerson(a.id)?.sourceIds).toBeUndefined();
        expect(DataManager.getPerson(b.id)?.sourceIds).toBeUndefined();
        expect(DataManager.getPerson(a.id)?.events?.[0].sourceIds).toBeUndefined();

        DataManager.undo();
        expect(Object.keys(DataManager.getData().sources ?? {})).toHaveLength(1);
        expect(DataManager.getPerson(a.id)?.sourceIds).toEqual([src.id]);
        expect(DataManager.getPerson(b.id)?.sourceIds).toEqual([src.id]);
        expect(DataManager.getPerson(a.id)?.events?.[0].sourceIds).toEqual([src.id]);
    });
});

/** Build a tree with one person + one source + citation for privacy tests. */
function treeWithCitation(living: boolean): StromData {
    const source: Source = { id: 's1', title: 'Sensitive register', reference: 'sign. 12/3' };
    const event: LifeEvent = { id: 'e1', type: 'residence', place: 'Secret', sourceIds: ['s1'] };
    const person: Person = {
        id: 'p1' as PersonId,
        firstName: 'Test', lastName: 'Person', gender: 'male',
        isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [],
        events: [event],
        sourceIds: ['s1'],
        isDeceased: !living,
    };
    return { persons: { [person.id]: person }, partnerships: {}, sources: { s1: source } };
}

describe('privacy strips sources and citations', () => {
    it('drops the catalog and all citations under a privacy mode', () => {
        const filtered = applyLivingPrivacy(treeWithCitation(true), 'anonymous', 2026);
        expect(filtered.sources).toBeUndefined();
        expect(filtered.persons['p1' as PersonId].sourceIds).toBeUndefined();
    });

    it('drops citations even for deceased people (no dangling refs)', () => {
        const filtered = applyLivingPrivacy(treeWithCitation(false), 'minimal', 2026);
        expect(filtered.sources).toBeUndefined();
        const p = filtered.persons['p1' as PersonId];
        expect(p.sourceIds).toBeUndefined();
        expect(p.events?.[0].sourceIds).toBeUndefined();
    });

    it('keeps the catalog and citations under full mode', () => {
        const filtered = applyLivingPrivacy(treeWithCitation(true), 'full', 2026);
        expect(filtered.sources).toBeDefined();
        expect(filtered.persons['p1' as PersonId].sourceIds).toEqual(['s1']);
    });
});

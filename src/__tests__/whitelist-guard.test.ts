/**
 * Guard against silently dropping a field.
 *
 * Every path where data is copied rather than passed wholesale is a place a
 * field can vanish without a word:
 *   - migrateData() — every load goes through it (tree switch, app restart,
 *     import, opening a shared file),
 *   - DataManager.updatePerson() — every edit from the person modal,
 *   - executeMerge() — merging two trees builds the result by hand,
 *   - extractSubtree() — split / "tree from current view" extracts by hand.
 *
 * That has already cost users data three times: Person.refn/question were
 * invisible again the moment the modal was reopened, StromData.places threw
 * away every coordinate a person had looked up (hotfix 1.10.1), and merge
 * dropped places AND surnameVariants of both trees.
 *
 * The fixtures below are typed `Required<...>`, so TypeScript refuses to compile
 * this file the moment a new field appears on StromData or Person. Filling it in
 * then makes the test fail until the field is actually carried through. That is
 * the point: you cannot add a field and forget.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { executeMerge } from '../merge/executor.js';
import { MergeState } from '../merge/types.js';
import { StorageManager } from '../storage.js';
import { extractSubtree } from '../subtree.js';
import {
    StromData, Person, Partnership, PersonId, PartnershipId, TreeId,
    toPersonId, toPartnershipId, LAST_FOCUSED, STROM_DATA_VERSION,
} from '../types.js';

const ALICE = toPersonId('p_alice');
const BOB = toPersonId('p_bob');
const UNION = toPartnershipId('u_alice_bob');

function person(id: PersonId, firstName: string): Person {
    return {
        id, firstName, lastName: 'Novak', gender: 'female',
        isPlaceholder: false, partnerships: [UNION], parentIds: [], childIds: [],
        // extractSubtree prunes coordinates to used places and sources to live
        // citations, so the fixture must actually use both ('kolin', 's1').
        birthPlace: 'Kolín',
        sourceIds: ['s1'],
    };
}

function partnership(): Partnership {
    return { id: UNION, person1Id: BOB, person2Id: ALICE, childIds: [], status: 'married' };
}

/**
 * Every field of StromData with a value distinguishable from the default —
 * shared by the migrate, merge and split guards below. `Required` is what
 * makes this a guard: a new StromData field breaks the build here first.
 */
function fullTree(): Required<StromData> {
    return {
        version: STROM_DATA_VERSION,
        persons: { [ALICE]: person(ALICE, 'Alice'), [BOB]: person(BOB, 'Bob') },
        partnerships: { [UNION]: partnership() },
        sources: {
            s1: { id: 's1', title: 'Parish register, Kolín', quality: 3 },
        },
        places: {
            'kolin': { lat: 50.0281, lon: 15.2003, label: 'Kolín, Česko' },
        },
        surnameVariants: [['Víšek', 'Vyšek', 'Wischek']],
        defaultPersonId: LAST_FOCUSED,
        lastFocusPersonId: ALICE,
        lastFocusDepthUp: 3,
        lastFocusDepthDown: 4,
    };
}

describe('migrateData keeps every StromData field', () => {
    const full = fullTree();

    /**
     * `version` is deliberately not carried: the app re-stamps it on save, so a
     * load is where an old version number is meant to disappear.
     */
    const CARRIED = (Object.keys(full) as (keyof StromData)[]).filter(k => k !== 'version');

    it('carries every field through a load', () => {
        const loaded = migrateData(structuredClone(full));
        // Field by field rather than one toEqual, so a failure names the field
        // that was dropped instead of printing the whole tree.
        for (const key of CARRIED) {
            expect({ [key]: loaded[key] }).toEqual({ [key]: full[key] });
        }
    });

    it('drops nothing and invents nothing', () => {
        const loaded = migrateData(structuredClone(full));
        expect(Object.keys(loaded).sort()).toEqual([...CARRIED].sort());
    });

    it('survives data that is missing everything optional', () => {
        const bare = { persons: {}, partnerships: {} };
        expect(migrateData(bare)).toEqual({ persons: {}, partnerships: {} });
    });

    it('turns junk into an empty tree rather than throwing', () => {
        expect(migrateData(null)).toEqual({ persons: {}, partnerships: {} });
        expect(migrateData('nonsense')).toEqual({ persons: {}, partnerships: {} });
        expect(migrateData(undefined)).toEqual({ persons: {}, partnerships: {} });
    });

    it('fills in a partnership status that predates the field', () => {
        const old = {
            persons: {},
            partnerships: { [UNION]: { id: UNION, person1Id: BOB, person2Id: ALICE, childIds: [] } },
        };
        expect(migrateData(old).partnerships[UNION].status).toBe('married');
    });
});


// ==================== updatePerson ====================

/**
 * Which Person fields `updatePerson` is responsible for. Everything a user can
 * change in the person modal belongs here.
 */
type EditedByUpdatePerson =
    | 'firstName' | 'lastName' | 'gender' | 'nameVariants'
    | 'birthDate' | 'birthPlace' | 'deathDate' | 'deathPlace'
    | 'notes' | 'refn' | 'question' | 'isDeceased' | 'isLocked' | 'photo';

/**
 * Fields updatePerson deliberately does NOT touch, and who owns them instead.
 * Structural links are maintained by the relation APIs; the rest have their own
 * editors, which is why a plain field-copy would be wrong for them.
 */
type OwnedElsewhere =
    | 'id'                  // assigned once, never edited
    | 'isPlaceholder'       // derived: cleared when a real first name arrives
    | 'partnerships'        // createPartnership / removePartnership
    | 'parentIds'           // addParentChild / removeParentChild
    | 'childIds'            // addParentChild / removeParentChild
    | 'parentRelTypes'      // setParentRelType
    | 'events'              // addLifeEvent / updateLifeEvent / removeLifeEvent
    | 'sourceIds'           // citePerson / uncitePerson
    | 'attachments'         // addAttachment / removeAttachment
    | 'photoOriginalName';  // set with the photo itself (import / upload)

/**
 * Compile-time proof that the two lists together cover Person exactly. Add a
 * field to Person and this stops compiling until it is classified — which is
 * the moment to ask "does updatePerson need to apply it?". Person.refn and
 * Person.question once slipped through and were invisible the moment the modal
 * was reopened.
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type _PersonFieldsAreClassified = Expect<Equal<EditedByUpdatePerson | OwnedElsewhere, keyof Person>>;

const TREE = 'guard-test-tree' as TreeId;

function reset(): void {
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
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

describe('updatePerson applies every field it owns', () => {
    beforeEach(reset);

    /**
     * Every editable field, each with a value different from the default.
     *
     * isLocked is applied on its own below, not in this batch: locking takes
     * effect immediately and then blocks the rest of the same call, by design.
     * The UI only ever toggles it alone (context menu), never alongside edits.
     */
    const edits: Required<Pick<Person, EditedByUpdatePerson>> = {
        firstName: 'Marie',
        lastName: 'Nováková',
        gender: 'female',
        nameVariants: ['Wischek', 'u Kováře'],
        birthDate: '1901-02-03',
        birthPlace: 'Kolín',
        deathDate: '1980-04-05',
        deathPlace: 'Beroun',
        notes: 'Kept bees.',
        refn: 'box 12/1880',
        question: 'Who were her parents?',
        isDeceased: true,
        isLocked: true,
        photo: 'data:image/png;base64,iVBORw0KGgo=',
    };

    const { isLocked: _lock, ...editable } = edits;

    it('writes back every one of them', () => {
        const created = DataManager.createPerson({ firstName: 'Jan', lastName: 'Novak', gender: 'male' });
        DataManager.updatePerson(created.id, editable);

        const saved = DataManager.getPerson(created.id);
        // Field by field, so a failure names the one that was dropped.
        for (const key of Object.keys(editable) as (keyof typeof editable)[]) {
            expect({ [key]: saved?.[key] }).toEqual({ [key]: editable[key] });
        }
    });

    it('applies the lock too, on its own', () => {
        const created = DataManager.createPerson({ firstName: 'Jan', lastName: 'Novak', gender: 'male' });
        DataManager.updatePerson(created.id, { isLocked: true });
        expect(DataManager.getPerson(created.id)?.isLocked).toBe(true);
    });

    it('survives a load with all of them intact', () => {
        const created = DataManager.createPerson({ firstName: 'Jan', lastName: 'Novak', gender: 'male' });
        DataManager.updatePerson(created.id, editable);

        // The two whitelists in one go: edited, then carried through a load.
        const reloaded = migrateData(structuredClone(DataManager.getData()));
        expect(reloaded.persons[created.id]).toEqual(DataManager.getPerson(created.id));
    });
});


// ==================== merge and split ====================

/**
 * Merge and split build their result by hand instead of passing data
 * wholesale, so they are exactly where a new field silently vanishes —
 * places and surnameVariants already did (found in the 1.15 review).
 * Focus fields are the exception: merge clears them on purpose (a merged
 * tree starts fresh), split has no meaningful focus to inherit.
 */
const FOCUS_FIELDS: (keyof StromData)[] =
    ['defaultPersonId', 'lastFocusPersonId', 'lastFocusDepthUp', 'lastFocusDepthDown'];

describe('merge keeps every tree-level field', () => {
    beforeEach(() => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
    });

    it('the existing tree loses nothing but focus', async () => {
        const full = fullTree();
        const state: MergeState = {
            existingData: full,
            incomingData: { persons: {}, partnerships: {} },
            matches: [], unmatchedExisting: [], unmatchedIncoming: [],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        const carried = (Object.keys(full) as (keyof StromData)[])
            .filter(k => !FOCUS_FIELDS.includes(k));
        for (const key of carried) {
            expect({ [key]: result.mergedData[key] }).toEqual({ [key]: full[key] });
        }
    });

    it('the incoming tree’s registries come along too', async () => {
        const incoming = fullTree();
        incoming.places = { 'beroun': { lat: 49.96, lon: 14.07, label: 'Beroun' } };
        incoming.surnameVariants = [['Svoboda', 'Swoboda']];
        const state: MergeState = {
            existingData: fullTree(),
            incomingData: incoming,
            matches: [], unmatchedExisting: [], unmatchedIncoming: [],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        expect(result.mergedData.places?.['beroun']).toBeDefined();
        expect(result.mergedData.places?.['kolin']).toBeDefined();
        expect(result.mergedData.surnameVariants).toContainEqual(['Svoboda', 'Swoboda']);
        expect(result.mergedData.surnameVariants).toContainEqual(['Víšek', 'Vyšek', 'Wischek']);
    });
});

describe('split (extractSubtree) keeps every tree-level field', () => {
    it('carries registries and sources for the kept half', () => {
        const full = fullTree();
        const out = extractSubtree(full, new Set([ALICE, BOB]));
        // Everything except focus + version (re-stamped on save) must survive.
        const carried = (Object.keys(full) as (keyof StromData)[])
            .filter(k => !FOCUS_FIELDS.includes(k) && k !== 'version');
        for (const key of carried) {
            expect({ [key]: out[key] }).toBeDefined();
        }
        expect(out.places?.['kolin']).toEqual(full.places['kolin']);
        expect(out.surnameVariants).toEqual(full.surnameVariants);
        expect(out.sources?.['s1']).toBeDefined();
    });

    it('prunes coordinates of places the kept half never uses', () => {
        const full = fullTree();
        full.places['praha'] = { lat: 50.08, lon: 14.43, label: 'Praha' };
        const out = extractSubtree(full, new Set([ALICE, BOB]));
        expect(out.places?.['kolin']).toBeDefined();
        expect(out.places?.['praha']).toBeUndefined();
    });
});

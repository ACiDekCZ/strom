/**
 * Guard against silently dropping a field.
 *
 * Two places in the app copy data field by field instead of wholesale:
 *   - migrateData() — every load goes through it (tree switch, app restart,
 *     import, opening a shared file),
 *   - DataManager.updatePerson() — every edit from the person modal.
 *
 * Anything not named there is dropped without a word. That has already cost
 * users data twice: Person.refn/question were invisible again the moment the
 * modal was reopened, and StromData.places threw away every coordinate a person
 * had looked up (hotfix 1.10.1).
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
    };
}

function partnership(): Partnership {
    return { id: UNION, person1Id: BOB, person2Id: ALICE, childIds: [], status: 'married' };
}

describe('migrateData keeps every StromData field', () => {
    /**
     * Every field of StromData, each with a value that is distinguishable from
     * the default. `Required` is what makes this a guard rather than a sample:
     * a new field breaks the build here first.
     */
    const full: Required<StromData> = {
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

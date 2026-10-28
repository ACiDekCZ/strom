/**
 * Findings marked "not an error" and rejected spelling suggestions (spec 021
 * K1.5, §4.4; data version 13): their shape through a load, which findings
 * they hide, undo/redo, export and import (JSON and GEDCOM, both header
 * markers in the file for the research), a new research version, a merge and
 * the bridge's /quality. Fictional data only (the Lhoták family).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { validateJsonImport } from '../merge/validation.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { extractSubtree } from '../subtree.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom, SURNAME_GROUPS_MARKER, SURNAME_REJECTIONS_MARKER } from '../ged-exporter.js';
import { carryOverMedia, contentFingerprint } from '../research-link.js';
import { validateTreeData, ValidationIssue, qualityFinding, qualityFindingKey } from '../validation.js';
import {
    visibleIssues, visibleValidation, dismissalFor, dismissalKey, summaryKind, dismissBody,
    parseQualityReply, marksInTree, mergeResearchMarks, researchMarkKey, sanitizeQualityDismissed,
} from '../quality-dismiss.js';
import { StromData, Person, PersonId, TreeId, STROM_DATA_VERSION, QualityDismissal } from '../types.js';

const TREE = 'quality-test-tree' as TreeId;
const RESEARCH_ID = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';

function person(id: string, firstName: string, lastName: string, birthDate: string, refn?: string): Person {
    return {
        id: id as PersonId, firstName, lastName, gender: firstName.endsWith('a') ? 'female' : 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], birthDate,
        ...(refn ? { refn } : {}),
    };
}

/** Two Jan Lhoták born the same year: a possible duplicate. */
function lhotakTree(): StromData {
    return {
        persons: {
            ['p_jan1' as PersonId]: person('p_jan1', 'Jan', 'Lhoták', '1850', 'P0100'),
            ['p_jan2' as PersonId]: person('p_jan2', 'Jan', 'Lhoták', '1850', 'P0101'),
            ['p_marie' as PersonId]: person('p_marie', 'Marie', 'Lhotáková', '1855'),
        },
        partnerships: {},
    };
}

function duplicateIssue(data: StromData): ValidationIssue {
    const issue = validateTreeData(data).issues.find(i => i.type === 'possibleDuplicate');
    expect(issue).toBeDefined();
    return issue!;
}

function reset(data: StromData = lhotakTree()): void {
    vi.restoreAllMocks();
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as {
        data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
    };
    dm.data = data;
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

describe('data version 13', () => {
    it('is 13', () => {
        expect(STROM_DATA_VERSION).toBe(13);
    });

    it('a v12 tree loads unchanged, without either list', () => {
        const v12 = { version: 12, ...lhotakTree() };
        const loaded = migrateData(structuredClone(v12));
        expect(loaded.qualityDismissed).toBeUndefined();
        expect(loaded.surnameRejections).toBeUndefined();
        expect(loaded.persons).toEqual(v12.persons);
    });

    it('keeps both lists through a load, cleaned: people sorted, one mark per key, junk dropped', () => {
        const loaded = migrateData({
            ...lhotakTree(),
            qualityDismissed: [
                { kind: 'possibleDuplicate', persons: ['p_jan2', 'p_jan1'], at: '2026-10-01T00:00:00.000Z' },
                { kind: 'possibleDuplicate', persons: ['p_jan1', 'p_jan2'], at: '2026-10-02T00:00:00.000Z', sync: 'sent' },
                { kind: 'recurringGodparent', persons: ['p_marie'], subject: '  Václav Hrubeš ', at: '2026-10-03T00:00:00.000Z', sync: 'bogus' },
                { kind: '', persons: ['p_marie'] },
                { kind: 'eventAfterDeath', persons: [] },
                'junk',
            ],
            surnameRejections: [
                { forms: ['Lhoták', 'Lhota'], id: 'sg1', at: '2026-10-04T00:00:00.000Z' },
                { forms: ['Lhoták'] },
                { forms: 'Lhoták|Lhota' },
            ],
        });
        expect(loaded.qualityDismissed).toEqual([
            { kind: 'possibleDuplicate', persons: ['p_jan1', 'p_jan2'], at: '2026-10-02T00:00:00.000Z', sync: 'sent' },
            { kind: 'recurringGodparent', persons: ['p_marie'], subject: 'Václav Hrubeš', at: '2026-10-03T00:00:00.000Z' },
        ]);
        expect(loaded.surnameRejections).toEqual([{ forms: ['Lhoták', 'Lhota'], id: 'sg1', at: '2026-10-04T00:00:00.000Z' }]);
    });

    it('both lists survive a JSON export and import', () => {
        const data: StromData = {
            version: STROM_DATA_VERSION, ...lhotakTree(),
            qualityDismissed: [{ kind: 'possibleDuplicate', persons: ['p_jan1', 'p_jan2'], at: '2026-10-02T00:00:00.000Z' }],
            surnameRejections: [{ forms: ['Lhoták', 'Lhota'], at: '2026-10-04T00:00:00.000Z' }],
        };
        const imported = validateJsonImport(JSON.stringify(data));
        expect(imported.valid).toBe(true);
        expect(imported.data!.qualityDismissed).toEqual(data.qualityDismissed);
        expect(imported.data!.surnameRejections).toEqual(data.surnameRejections);
    });

    it('a part of the tree taken out keeps the marks whose people all come along', () => {
        const data: StromData = {
            ...lhotakTree(),
            qualityDismissed: [
                { kind: 'possibleDuplicate', persons: ['p_jan1', 'p_jan2'], at: '2026-10-02T00:00:00.000Z', sync: 'sent' },
                { kind: 'eventAfterDeath', persons: ['p_marie'], subject: '1901', at: '2026-10-03T00:00:00.000Z' },
            ],
            surnameRejections: [{ forms: ['Lhoták', 'Lhota'] }],
        };
        const out = extractSubtree(data, new Set(['p_jan1', 'p_marie'] as PersonId[]));
        expect(out.qualityDismissed).toEqual([{ kind: 'eventAfterDeath', persons: ['p_marie'], subject: '1901', at: '2026-10-03T00:00:00.000Z' }]);
        expect(out.surnameRejections).toEqual([{ forms: ['Lhoták', 'Lhota'] }]);
    });
});

describe('which findings a mark hides', () => {
    it('the marked finding is left out and the counts made again', () => {
        const data = lhotakTree();
        const before = validateTreeData(data);
        const dup = duplicateIssue(data);
        data.qualityDismissed = [dismissalFor(dup, '2026-10-02T00:00:00.000Z')];
        const shown = visibleValidation(before, data);
        expect(shown.issues.find(i => i.type === 'possibleDuplicate')).toBeUndefined();
        expect(shown.issues.length).toBe(before.issues.length - 1);
        expect(shown.stats.infos).toBe(before.stats.infos - 1);
    });

    it('the same finding found again (other issue ids, other people order) stays hidden', () => {
        const data = lhotakTree();
        const dup = duplicateIssue(data);
        data.qualityDismissed = [{ ...dismissalFor(dup), persons: [...dismissalFor(dup).persons].reverse() }];
        const again = { ...dup, id: 'issue_999', personIds: [...(dup.personIds ?? [])].reverse() };
        expect(visibleIssues([again], { qualityDismissed: sanitizeQualityDismissed(data.qualityDismissed) })).toEqual([]);
    });

    it('a finding with another subject or other people is still reported', () => {
        const issue: ValidationIssue = { id: 'i1', severity: 'info', type: 'recurringGodparent', message: '', personIds: ['p_jan1' as PersonId, 'p_jan2' as PersonId], subject: 'Václav Hrubeš' };
        const mark = dismissalFor(issue);
        const otherGodparent = { ...issue, subject: 'Josef Hrubeš' };
        const newChild = { ...issue, personIds: [...issue.personIds!, 'p_marie' as PersonId] };
        expect(visibleIssues([issue, otherGodparent, newChild], { qualityDismissed: [mark] })).toEqual([otherGodparent, newChild]);
    });

    it('the event year is the subject of an event after death', () => {
        const issue: ValidationIssue = { id: 'i1', severity: 'warning', type: 'eventAfterDeath', message: '', personIds: ['p_marie' as PersonId], year: 1901 };
        expect(dismissalFor(issue, 'x')).toEqual({ kind: 'eventAfterDeath', persons: ['p_marie'], subject: '1901', at: 'x' });
        expect(dismissalKey(dismissalFor(issue))).toBe(qualityFindingKey(qualityFinding(issue)));
    });

    it('the summary sentence follows the counts', () => {
        expect(summaryKind({ errors: 1, warnings: 0, traces: 0 })).toBe('errors');
        expect(summaryKind({ errors: 0, warnings: 2, traces: 3 })).toBe('noErrors');
        expect(summaryKind({ errors: 0, warnings: 0, traces: 3 })).toBe('leadsOnly');
        expect(summaryKind({ errors: 0, warnings: 0, traces: 0 })).toBeNull();
    });
});

describe('DataManager: marking, undo and redo', () => {
    beforeEach(() => reset());

    it('marks a finding as one undo step and a change-log entry; undo brings it back, redo hides it again', () => {
        const dup = duplicateIssue(DataManager.getData());
        const mark = dismissalFor(dup);
        expect(DataManager.dismissQualityFinding(mark, 'Jan Lhoták × Jan Lhoták')).toBe(true);
        expect(DataManager.getData().qualityDismissed).toEqual([mark]);
        expect(AuditLogManager.log).toHaveBeenCalledWith(TREE, 'quality.dismiss', expect.stringContaining('Jan Lhoták'));
        // The same mark twice is no new step.
        expect(DataManager.dismissQualityFinding(mark, 'again')).toBe(false);

        DataManager.undo();
        expect(DataManager.getData().qualityDismissed).toBeUndefined();
        DataManager.redo();
        expect(DataManager.getData().qualityDismissed).toEqual([mark]);
    });

    it('restores a mark by its key', () => {
        const mark = dismissalFor(duplicateIssue(DataManager.getData()));
        DataManager.dismissQualityFinding(mark, 'x');
        expect(DataManager.restoreQualityDismissal(dismissalKey(mark), 'x')).toBe(true);
        expect(DataManager.getData().qualityDismissed).toBeUndefined();
        expect(AuditLogManager.log).toHaveBeenCalledWith(TREE, 'quality.restore', expect.any(String));
        expect(DataManager.restoreQualityDismissal(dismissalKey(mark), 'x')).toBe(false);
    });

    it('the bridge’s send state is kept without an undo step', () => {
        const mark = dismissalFor(duplicateIssue(DataManager.getData()));
        DataManager.dismissQualityFinding(mark, 'x');
        const steps = UndoManager.peekUndoDescription();
        DataManager.replaceQualityDismissed([{ ...mark, sync: 'sent' }]);
        expect(DataManager.getData().qualityDismissed![0].sync).toBe('sent');
        expect(UndoManager.peekUndoDescription()).toBe(steps);
    });

    it('rejects and takes back a spelling suggestion, with undo', () => {
        expect(DataManager.addSurnameRejection({ forms: ['Lhoták', 'Lhota'], id: 'sg1', at: '2026-10-04T00:00:00.000Z' })).toBe(true);
        expect(DataManager.addSurnameRejection({ forms: ['lhota', 'LHOTÁK'] })).toBe(false);
        expect(AuditLogManager.log).toHaveBeenCalledWith(TREE, 'surname.reject', expect.stringContaining('Lhoták'));
        DataManager.undo();
        expect(DataManager.getData().surnameRejections).toBeUndefined();
        DataManager.redo();
        expect(DataManager.removeSurnameRejection(['Lhota', 'Lhoták'])).toBe(true);
        expect(DataManager.getData().surnameRejections).toBeUndefined();
    });
});

describe('GEDCOM: the two surname markers', () => {
    const withLists = (): StromData => ({
        ...lhotakTree(),
        surnameVariants: [['Lhoták', 'Lhotak']],
        surnameRejections: [{ forms: ['Lhoták', 'Lhota'], at: '2026-10-04T00:00:00.000Z' }],
    });

    it('the file for the research carries both markers, even empty', () => {
        const ged = exportToGedcom(lhotakTree(), 'T', { research: { id: RESEARCH_ID } }).content;
        expect(ged).toContain(`1 NOTE ${SURNAME_GROUPS_MARKER}\n`);
        expect(ged).toContain(`1 NOTE ${SURNAME_REJECTIONS_MARKER}\n`);
    });

    it('a plain export carries only a list with something in it', () => {
        expect(exportToGedcom(lhotakTree(), 'T').content).not.toContain('Strom surname-variant');
        const ged = exportToGedcom(withLists(), 'T').content;
        expect(ged).toContain(`1 NOTE ${SURNAME_REJECTIONS_MARKER}\n2 CONT Lhoták | Lhota`);
    });

    it('reads both lists back', () => {
        const out = convertToStrom(parseGedcom(exportToGedcom(withLists(), 'T').content)).data;
        expect(out.surnameVariants).toEqual([['Lhoták', 'Lhotak']]);
        expect(out.surnameRejections).toEqual([{ forms: ['Lhoták', 'Lhota'] }]);
    });

    it('a long group wrapped on CONC lines is one group, not cut', () => {
        const forms = Array.from({ length: 40 }, (_, i) => `Lhoták${String.fromCharCode(97 + (i % 26))}${i}`);
        const ged = exportToGedcom({ ...lhotakTree(), surnameVariants: [forms] }, 'T').content;
        expect(ged).toMatch(/\n3 CONC /);
        const out = convertToStrom(parseGedcom(ged)).data;
        expect(out.surnameVariants).toEqual([forms]);
    });

    it('an empty marker from the research is an empty list, a missing one none', () => {
        const research = parseGedcom(exportToGedcom(lhotakTree(), 'T', { research: { id: RESEARCH_ID } }).content);
        expect(research.surnameMarkers).toEqual({ groups: true, rejections: true });
        expect(convertToStrom(research).data.surnameRejections).toEqual([]);
        const plain = parseGedcom(exportToGedcom(lhotakTree(), 'T').content);
        expect(plain.surnameMarkers).toBeUndefined();
        expect(convertToStrom(plain).data.surnameRejections).toBeUndefined();
        // migrateData keeps no empty list.
        expect(migrateData(convertToStrom(research).data).surnameVariants).toBeUndefined();
    });
});

describe('a new version from the research keeps the tree’s decisions', () => {
    const previous = (): StromData => ({
        ...lhotakTree(),
        surnameVariants: [['Lhoták', 'Lhotak']],
        surnameRejections: [{ forms: ['Lhoták', 'Lhota'], at: '2026-10-04T00:00:00.000Z' }],
        qualityDismissed: [{ kind: 'possibleDuplicate', persons: ['p_jan1', 'p_jan2'], at: '2026-10-02T00:00:00.000Z', sync: 'sent' }],
    });

    it('a research without the markers: everything kept', () => {
        const next = carryOverMedia(lhotakTree(), previous()).data;
        expect(next.qualityDismissed).toEqual(previous().qualityDismissed);
        expect(next.surnameVariants).toEqual(previous().surnameVariants);
        expect(next.surnameRejections).toEqual(previous().surnameRejections);
        expect(contentFingerprint(next)).toBe(contentFingerprint(previous()));
    });

    it('a research with the markers: its lists win (empty = none), the marks stay', () => {
        const fromResearch: StromData = { ...lhotakTree(), surnameVariants: [], surnameRejections: [{ forms: ['Lhoták', 'Lhotka'] }] };
        const next = carryOverMedia(fromResearch, previous()).data;
        expect(next.surnameVariants).toBeUndefined();
        expect(next.surnameRejections).toEqual([{ forms: ['Lhoták', 'Lhotka'] }]);
        expect(next.qualityDismissed).toEqual(previous().qualityDismissed);
    });

    it('a rejection changes the fingerprint (it goes with the next send); a mark does not', () => {
        const base = lhotakTree();
        expect(contentFingerprint({ ...base, qualityDismissed: previous().qualityDismissed })).toBe(contentFingerprint(base));
        expect(contentFingerprint({ ...base, surnameRejections: [{ forms: ['Lhoták', 'Lhota'] }] })).not.toBe(contentFingerprint(base));
        expect(contentFingerprint({ ...base, surnameVariants: [] })).toBe(contentFingerprint(base));
    });
});

describe('the bridge’s /quality', () => {
    const mark: QualityDismissal = { kind: 'possibleDuplicate', persons: ['p_jan1', 'p_jan2'], at: '2026-10-02T00:00:00.000Z' };

    it('sends a mark only when all its people have the research’s REFN', () => {
        const persons = lhotakTree().persons;
        expect(dismissBody(mark, persons)).toEqual({ kind: 'possibleDuplicate', persons: ['P0100', 'P0101'] });
        expect(dismissBody(mark, persons, true)).toEqual({ kind: 'possibleDuplicate', persons: ['P0100', 'P0101'], do: 'undo' });
        expect(dismissBody({ kind: 'eventAfterDeath', persons: ['p_marie'], subject: '1901' }, persons)).toBeNull();
        expect(dismissBody({ kind: 'eventAfterDeath', persons: ['p_jan1'], subject: '1901' }, persons))
            .toEqual({ kind: 'eventAfterDeath', persons: ['P0100'], subject: '1901' });
    });

    it('reads GET /quality defensively', () => {
        expect(parseQualityReply(null)).toBeNull();
        expect(parseQualityReply({ rev: 'r1' })).toBeNull();
        expect(parseQualityReply({ rev: 'r1', dismissed: [
            { kind: 'possibleDuplicate', persons: ['P0101', 'P0100'], at: '2026-10-05', by: 'research' },
            { kind: 'x', persons: ['nope'] },
            { persons: ['P0100'] },
        ] })).toEqual({ rev: 'r1', dismissed: [{ kind: 'possibleDuplicate', persons: ['P0100', 'P0101'], at: '2026-10-05', by: 'research' }] });
    });

    it('takes over a mark made in the research, and one taken back there', () => {
        const persons = lhotakTree().persons;
        const research = marksInTree([{ kind: 'possibleDuplicate', persons: ['P0100', 'P0101'], at: '2026-10-05T00:00:00.000Z', by: 'research' }], persons);
        // Made in the research: added, marked so.
        const added = mergeResearchMarks([], research, new Set(), persons)!;
        expect(added).toEqual([{ ...mark, at: '2026-10-05T00:00:00.000Z', sync: 'sent', by: 'research' }]);
        // Known to the device and gone from the research: taken back there.
        const acked = new Set([researchMarkKey({ kind: 'possibleDuplicate', persons: ['P0100', 'P0101'] })]);
        expect(mergeResearchMarks([{ ...mark, sync: 'sent' }], [], acked, persons)).toEqual([]);
        // Not sent yet (not known to the device): stays.
        expect(mergeResearchMarks([{ ...mark, sync: 'queued' }], [], new Set(), persons)).toBeNull();
        // Taken back here, the undo on its way: not added again.
        expect(mergeResearchMarks([], research, acked, persons)).toBeNull();
        // Own mark confirmed: sent.
        const own = marksInTree([{ kind: 'possibleDuplicate', persons: ['P0100', 'P0101'], by: 'app' }], persons);
        expect(mergeResearchMarks([{ ...mark, sync: 'queued' }], own, acked, persons)).toEqual([{ ...mark, sync: 'sent' }]);
    });
});

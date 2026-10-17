/**
 * The married surname in the person editor (spec 010, K1.1, K3.1): the
 * suggestion from the husband's surname (src/married-suggestion.ts), the
 * app-local Person.dismissedMarriedSuggestion it leaves, and a married
 * surname the research's version brings back said as a row of the load
 * dialog. Invented data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { suggestionHusband, suggestMarriedSurname, wifeSurnameOf, MarriedSuggestionState } from '../married-suggestion.js';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { applyLivingPrivacy } from '../privacy.js';
import { diffByPerson, diffValues, baseCopy } from '../research-changes.js';
import { otherLoadChanges } from '../research-conflict-card.js';
import { exportToGedcom } from '../ged-exporter.js';
import { buildPersonsCsv } from '../csv-export.js';
import { setLanguage } from '../strings.js';
import { fitNameHtml } from '../person-name.js';
import { keepMarriedSurname, keepDismissedMarriedSuggestions, stabilizeIds, contentFingerprint, MARRIED_SURNAME_FEATURE } from '../research-link.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { SettingsManager } from '../settings.js';
import { Person, PersonId, PartnershipId, Partnership, StromData, TreeId, toPersonId } from '../types.js';

function person(id: string, firstName: string, lastName: string, gender: Person['gender'], extra: Partial<Person> = {}): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender, isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    };
}

/** Marie with her husbands, each union [husband, status, wedding date]. */
function marie(husbands: [Person, Partnership['status'], string?][], marieExtra: Partial<Person> = {}): StromData {
    const m = person('m', 'Marie', 'Dvořáková', 'female', marieExtra);
    const data: StromData = { persons: { [m.id]: m }, partnerships: {} };
    husbands.forEach(([h, status, date], i) => {
        const id = `u${i + 1}` as PartnershipId;
        data.persons[h.id] = { ...h, partnerships: [...h.partnerships, id] };
        m.partnerships.push(id);
        data.partnerships[id] = { id, person1Id: h.id, person2Id: m.id, childIds: [], status, ...(date ? { startDate: date } : {}) };
    });
    return data;
}

const state = (extra: Partial<MarriedSuggestionState> = {}): MarriedSuggestionState => ({
    gender: 'female', lastName: 'Dvořáková', marriedSurname: '', nameVariants: [], ...extra,
});
const M = toPersonId('m');

describe('the husband a married surname is suggested from', () => {
    it('the marriage with the latest wedding date, whatever the order in the data', () => {
        const data = marie([
            [person('h2', 'Karel', 'Svoboda', 'male'), 'married', '1931'],
            [person('h1', 'Jan', 'Novák', 'male'), 'divorced', '1920'],
        ]);
        expect(suggestionHusband(data, M)?.id).toBe('h2');
    });

    it('without any dates the last union in order; a dated one wins over undated', () => {
        const undated = marie([
            [person('h1', 'Jan', 'Novák', 'male'), 'divorced'],
            [person('h2', 'Karel', 'Svoboda', 'male'), 'married'],
        ]);
        expect(suggestionHusband(undated, M)?.id).toBe('h2');
        const oneDated = marie([
            [person('h1', 'Jan', 'Novák', 'male'), 'divorced', '1920'],
            [person('h2', 'Karel', 'Svoboda', 'male'), 'married'],
        ]);
        expect(suggestionHusband(oneDated, M)?.id).toBe('h1');
    });

    it('a partnership that was never a marriage, or a partner not a man, gives none', () => {
        expect(suggestionHusband(marie([[person('h1', 'Jan', 'Novák', 'male'), 'partners']]), M)).toBeNull();
        expect(suggestionHusband(marie([[person('h1', 'Jana', 'Nová', 'female'), 'married']]), M)).toBeNull();
        expect(suggestionHusband(marie([]), M)).toBeNull();
    });
});

describe('the wife\'s form of the husband\'s surname', () => {
    afterEach(() => setLanguage('en'));

    it('Czech rules: Novák → Nováková, Svoboda → Svobodová, Brodský → Brodská, Kočí and -ová stay', () => {
        setLanguage('cs');
        const data: StromData = { persons: {}, partnerships: {} };
        expect(wifeSurnameOf('Novák', data)).toBe('Nováková');
        expect(wifeSurnameOf('Svoboda', data)).toBe('Svobodová');
        expect(wifeSurnameOf('Brodský', data)).toBe('Brodská');
        expect(wifeSurnameOf('Kočí', data)).toBe('Kočí');
        expect(wifeSurnameOf('Nováková', data)).toBe('Nováková');
        expect(wifeSurnameOf('  ', data)).toBe('');
    });

    it('English, a tree without Czech letters: the surname as it is (Smith, Novak)', () => {
        setLanguage('en');
        const data: StromData = { persons: { [toPersonId('a')]: person('a', 'John', 'Smith', 'male') }, partnerships: {} };
        expect(wifeSurnameOf('Smith', data)).toBe('Smith');
        expect(wifeSurnameOf('Novak', data)).toBe('Novak');
    });

    it('English UI over a Czech tree (Czech letters in it): Czech rules', () => {
        setLanguage('en');
        const data = marie([[person('h1', 'Jan', 'Novák', 'male'), 'married']]);
        expect(wifeSurnameOf('Novák', data)).toBe('Nováková');
    });
});

describe('the suggestion', () => {
    beforeEach(() => setLanguage('cs'));
    afterEach(() => setLanguage('en'));
    const novak = () => marie([[person('h1', 'Jan', 'Novák', 'male'), 'married', '1920']]);

    it('a woman with a husband and no married surname: his surname as hers', () => {
        const s = suggestMarriedSurname(novak(), M, state());
        expect(s).toMatchObject({ surname: 'Nováková', inNameVariants: false });
        expect(s?.husband.id).toBe('h1');
    });

    it('several marriages: from the latest one', () => {
        const data = marie([
            [person('h1', 'Jan', 'Novák', 'male'), 'divorced', '1920'],
            [person('h2', 'Karel', 'Svoboda', 'male'), 'married', '1931'],
        ]);
        expect(suggestMarriedSurname(data, M, state())?.surname).toBe('Svobodová');
    });

    it('none for a man, unknown sex, a filled field, a husband without a surname, a "?" husband', () => {
        expect(suggestMarriedSurname(novak(), M, state({ gender: 'male' }))).toBeNull();
        expect(suggestMarriedSurname(novak(), M, state({ gender: 'unknown' }))).toBeNull();
        expect(suggestMarriedSurname(novak(), M, state({ marriedSurname: 'Svobodová' }))).toBeNull();
        expect(suggestMarriedSurname(marie([[person('h1', 'Jan', '  ', 'male'), 'married']]), M, state())).toBeNull();
        expect(suggestMarriedSurname(marie([[person('h1', '?', 'Novák', 'male', { isPlaceholder: true }), 'married']]), M, state())).toBeNull();
    });

    it('none when it is her own surname already (a tree that keeps women under the married one)', () => {
        expect(suggestMarriedSurname(novak(), M, state({ lastName: 'Nováková' }))).toBeNull();
    });

    it('the one hidden with × is not offered again; a different husband\'s surname is', () => {
        expect(suggestMarriedSurname(novak(), M, state({ dismissed: 'Nováková' }))).toBeNull();
        expect(suggestMarriedSurname(novak(), M, state({ dismissed: 'novakova' }))).toBeNull();
        expect(suggestMarriedSurname(novak(), M, state({ dismissed: 'Svobodová' }))?.surname).toBe('Nováková');
    });

    it('says when her other spellings already hold it', () => {
        expect(suggestMarriedSurname(novak(), M, state({ nameVariants: ['Marie Nováková'] }))?.inNameVariants).toBe(true);
        expect(suggestMarriedSurname(novak(), M, state({ nameVariants: ['Nováková'] }))?.inNameVariants).toBe(true);
        expect(suggestMarriedSurname(novak(), M, state({ nameVariants: ['Maria Dworak'] }))?.inNameVariants).toBe(false);
    });

    it('English tree: Smith stays Smith', () => {
        setLanguage('en');
        const data = marie([[person('h1', 'John', 'Smith', 'male'), 'married']], { lastName: 'Brown' });
        expect(suggestMarriedSurname(data, M, state({ lastName: 'Brown' }))?.surname).toBe('Smith');
    });
});

describe('Person.dismissedMarriedSuggestion (app-local)', () => {
    const TREE = 'married-suggestion-test-tree' as TreeId;

    beforeEach(() => {
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
    });
    afterEach(() => vi.restoreAllMocks());

    it('an edit stores it trimmed, an empty one removes it', () => {
        const p = DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female' });
        DataManager.updatePerson(p.id, { dismissedMarriedSuggestion: ' Nováková ' });
        expect(DataManager.getPerson(p.id)?.dismissedMarriedSuggestion).toBe('Nováková');
        DataManager.updatePerson(p.id, { dismissedMarriedSuggestion: '' });
        expect(DataManager.getPerson(p.id)?.dismissedMarriedSuggestion).toBeUndefined();
    });

    it('a load keeps a text and drops anything else', () => {
        for (const bad of ['', '  ', 7, null]) {
            const loaded = migrateData({ persons: { m: { ...person('m', 'Marie', 'Dvořáková', 'female'), dismissedMarriedSuggestion: bad } }, partnerships: {} });
            expect('dismissedMarriedSuggestion' in loaded.persons[M]).toBe(false);
        }
        const ok = migrateData({ persons: { m: { ...person('m', 'Marie', 'Dvořáková', 'female'), dismissedMarriedSuggestion: 'Nováková' } }, partnerships: {} });
        expect(ok.persons[M].dismissedMarriedSuggestion).toBe('Nováková');
    });

    it('is not a change for the research, never in GEDCOM or CSV, and goes with privacy for the living', () => {
        const before: StromData = { persons: { m: person('m', 'Marie', 'Dvořáková', 'female', { birthDate: '1990' }) }, partnerships: {} } as StromData;
        const after = baseCopy(before);
        after.persons[M].dismissedMarriedSuggestion = 'Nováková';
        expect(diffByPerson(baseCopy(before), after)).toEqual([]);
        expect(diffValues(before, after).rows).toEqual([]);
        expect(exportToGedcom(after).content).not.toContain('Nováková');
        expect(buildPersonsCsv(after)).not.toContain('Nováková');
        const shared = applyLivingPrivacy(after, 'minimal');
        expect(shared.persons[M].dismissedMarriedSuggestion).toBeUndefined();
    });
});

describe('a married surname the research\'s version brings back (load dialog)', () => {
    const here = (married?: string): StromData => ({
        persons: { m: person('m', 'Marie', 'Dvořáková', 'female', married ? { marriedSurname: married } : {}) },
        partnerships: {},
    } as StromData);

    it('emptied here, still there: a row "– → Nováková", not an added fact', () => {
        const diff = diffValues(here(), here('Nováková'));
        expect(diff.rows).toEqual([expect.objectContaining({ field: 'marriedSurname', here: '', there: 'Nováková' })]);
        expect(diff.addedFacts).toBe(0);
        expect(diff.filled).toEqual([]);
        // One change besides a decided conflict, as before (a row instead of a fact).
        expect(otherLoadChanges(diff, [])).toBe(1);
        expect(otherLoadChanges(diff, [{ persons: [M], fact: 'NAME', scope: 'fact' }])).toBe(0);
    });

    it('other emptied fields still count as added facts', () => {
        const a = here();
        const b = here();
        b.persons[M].birthDate = '1890';
        const diff = diffValues(a, b);
        expect(diff.rows).toEqual([]);
        expect(diff.addedFacts).toBe(1);
    });
});

describe('the hidden suggestion across a research version load (K3.1)', () => {
    const RESEARCH = [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.14.0', '2 NAME Strom Research', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Marie /Dvořáková/', '1 SEX F', '1 REFN P0001',
        '0 @P0002@ INDI', '1 NAME Josef /Novák/', '1 SEX M', '1 REFN P0002',
        '0 @P0003@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 BIRT', '2 DATE 1901',
        '0 TRLR',
    ].join('\n');
    const load = (): StromData => convertToStrom(parseGedcom(RESEARCH)).data;
    const named = (d: StromData, first: string): Person => Object.values(d.persons).find(p => p.firstName === first)!;
    /** The tree here: the suggestion hidden for Marie (REFN) and Anna (none yet). */
    const here = (): StromData => {
        const d = load();
        named(d, 'Marie').dismissedMarriedSuggestion = 'Nováková';
        named(d, 'Anna').dismissedMarriedSuggestion = 'Kovářová';
        return d;
    };

    it('stays with the person, matched by REFN, whatever the research knows', () => {
        const previous = here();
        for (const [features, received] of [[null, false], [[MARRIED_SURNAME_FEATURE], false], [[MARRIED_SURNAME_FEATURE], true]] as const) {
            const next = load();
            expect(named(next, 'Marie').id).not.toBe(named(previous, 'Marie').id);
            const out = stabilizeIds(keepMarriedSurname(next, previous, features, received), previous);
            expect(out.persons[named(previous, 'Marie').id].dismissedMarriedSuggestion).toBe('Nováková');
            expect(named(out, 'Josef').dismissedMarriedSuggestion).toBeUndefined();
            // The research never has it: its version is unchanged.
            expect(named(next, 'Marie').dismissedMarriedSuggestion).toBeUndefined();
        }
    });

    it('a person without a REFN yet is paired by name, birth and sex; one already there stays', () => {
        const out = keepDismissedMarriedSuggestions(load(), here());
        expect(named(out, 'Anna').dismissedMarriedSuggestion).toBe('Kovářová');
        const next = load();
        named(next, 'Marie').dismissedMarriedSuggestion = 'Svobodová';
        expect(named(keepDismissedMarriedSuggestions(next, here()), 'Marie').dismissedMarriedSuggestion).toBe('Svobodová');
    });

    it('hiding one leaves the tree in step with the research (same fingerprint)', () => {
        const before = load();
        const after = structuredClone(before);
        named(after, 'Marie').dismissedMarriedSuggestion = 'Nováková';
        expect(contentFingerprint(after)).toBe(contentFingerprint(before));
        named(after, 'Marie').marriedSurname = 'Nováková';
        expect(contentFingerprint(after)).not.toBe(contentFingerprint(before));
    });

    it('nothing hidden before: the version comes as it is', () => {
        const next = load();
        expect(keepDismissedMarriedSuggestions(next, load())).toBe(next);
    });
});

describe('a name on one row of a dense list (merge lists, research panels, participants)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('without a married surname exactly the row\'s text as before, escaped', () => {
        const jan = person('j', 'Jan', 'Novák <ml.>', 'male');
        expect(fitNameHtml(jan, 'Jan Novák <ml.>', '(*1919)')).toBe('Jan Novák &lt;ml.&gt; (*1919)');
        expect(fitNameHtml(jan, 'Jan Novák <ml.>')).toBe('Jan Novák &lt;ml.&gt;');
    });

    it('with one: the name whole and the birth note that shortens to fit, then the suffix', () => {
        setLanguage('en');
        const display = vi.spyOn(SettingsManager, 'getSurnameDisplay').mockReturnValue('both');
        const m = person('m', 'Marie', 'Dvořáková', 'female', { marriedSurname: 'Nováková' });
        expect(fitNameHtml(m, 'Marie Nováková', '(*1921)')).toBe(
            '<span class="pn-fit"><span class="pn-main">Marie Nováková</span><span class="pn-note">(née Dvořáková)</span></span> (*1921)');
        // The birth or the married surname alone: no note, the plain text.
        display.mockReturnValue('married');
        expect(fitNameHtml(m, 'Marie Nováková')).toBe('Marie Nováková');
    });
});

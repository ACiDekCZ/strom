/**
 * Rules saved for a program (spec 134 K10.4): step 5 remembers the scope and
 * who is right for files of one program, the next guide's step 1 starts
 * filled in from them, Settings removes them. Stored on this device only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager, mergeRuleKey, sanitizeMergeRule } from '../settings.js';
import { SETTINGS_KEY } from '../model-values.js';
import { applySavedRule, canRemember, rememberLabel, ruleFromChoices, savedRuleDetail } from '../merge/saved-rules.js';
import { freshChoices, type WizardSource } from '../merge/wizard-ui.js';
import type { MergeState } from '../merge/types.js';
import type { WizardChoices } from '../merge/plan.js';
import type { SavedMergeRule, TreeId } from '../types.js';
import { setLanguage } from '../strings.js';

let store: Map<string, string>;
const reload = () => (SettingsManager as unknown as { load(): void }).load();

beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
    setLanguage('en');
});
afterEach(() => {
    for (const { key } of SettingsManager.getMergeRules()) SettingsManager.removeMergeRule(key);
    vi.unstubAllGlobals();
});

const RULE: SavedMergeRule = {
    program: 'Family Tree Builder',
    scope: 'b',
    rules: { all: 'import', kind: { places: 'mine' } },
    savedAt: '2026-11-24T10:00:00.000Z',
};

function source(over: Partial<WizardSource['source']> = {}): WizardSource {
    return {
        source: { kind: 'ged', label: 'oakfield.ged', persons: 12, program: 'Family Tree Builder', ...over },
        targetTreeId: 't1' as TreeId,
        targetName: 'Oakfield',
    };
}

function choices(over: Partial<WizardChoices> = {}): WizardChoices {
    return { ...freshChoices(source(), {} as MergeState), ...over };
}

describe('saved merge rules in the settings', () => {
    it('are stored per program, read back after a reload, and removed', () => {
        SettingsManager.setMergeRule(RULE);
        const stored = JSON.parse(store.get(SETTINGS_KEY)!);
        expect(Object.keys(stored.mergeRules)).toEqual(['family tree builder']);
        reload();
        expect(SettingsManager.getMergeRule('Family Tree Builder')).toEqual(RULE);
        expect(SettingsManager.getMergeRules()).toEqual([{ key: 'family tree builder', rule: RULE }]);
        SettingsManager.removeMergeRule('family tree builder');
        expect(SettingsManager.getMergeRule('Family Tree Builder')).toBeNull();
        expect(SettingsManager.getMergeRules()).toEqual([]);
        expect(JSON.parse(store.get(SETTINGS_KEY)!).mergeRules).toBeUndefined();
    });

    it('find the program whatever its spacing or case; a newer rule replaces the older one', () => {
        expect(mergeRuleKey('  Family   Tree BUILDER ')).toBe('family tree builder');
        expect(mergeRuleKey('   ')).toBe('');
        SettingsManager.setMergeRule(RULE);
        expect(SettingsManager.getMergeRule(' family tree builder')?.scope).toBe('b');
        SettingsManager.setMergeRule({ ...RULE, program: 'FAMILY TREE BUILDER', scope: 'c' });
        expect(SettingsManager.getMergeRules()).toHaveLength(1);
        expect(SettingsManager.getMergeRule('Family Tree Builder')?.scope).toBe('c');
    });

    it('a stored value that is no rule is left out', () => {
        store.set(SETTINGS_KEY, JSON.stringify({ mergeRules: {
            a: { program: 'A', scope: 'z', rules: { all: 'mine' } },
            b: { program: '', scope: 'a', rules: { all: 'mine' } },
            c: { program: 'C', scope: 'a', rules: { all: 'mine', kind: { places: 'nobody', birth: 'import', bogus: 'mine' } } },
        } }));
        reload();
        expect(SettingsManager.getMergeRules().map(r => r.rule)).toEqual([
            { program: 'C', scope: 'a', rules: { all: 'mine', kind: { birth: 'import' } }, savedAt: '' },
        ]);
        expect(sanitizeMergeRule(null)).toBeNull();
    });
});

describe('the guide and a saved rule', () => {
    it('fresh choices for a file of the program start from its scope and rules', () => {
        const c = freshChoices({ ...source(), saved: RULE }, {} as MergeState);
        expect(c.scope).toBe('b');
        expect(c.rules).toEqual({ all: 'import', kind: { places: 'mine' } });
        expect(c.prefilledFrom).toBe('Family Tree Builder');
    });

    it('without a rule, or for an import that names no program, nothing is filled in', () => {
        expect(freshChoices(source(), {} as MergeState)).toMatchObject({ scope: 'a' });
        expect(freshChoices(source(), {} as MergeState).prefilledFrom).toBeUndefined();
        for (const src of [source({ program: undefined }), source({ kind: 'tree', program: undefined }), source({ kind: 'json', program: 'Strom' })]) {
            const c = freshChoices({ ...src, saved: RULE }, {} as MergeState);
            expect(c.scope).toBe('a');
            expect(c.rules).toBeUndefined();
            expect(c.prefilledFrom).toBeUndefined();
        }
        const c = choices();
        expect(applySavedRule(c, null)).toBe(c);
    });

    it('step 5 offers to remember only for a file that names its program, added to a tree or compared', () => {
        expect(canRemember(choices())).toBe(true);
        expect(canRemember(choices({ mode: 'compare' }))).toBe(true);
        expect(canRemember(choices({ mode: 'new' }))).toBe(false);
        expect(canRemember(choices({ json: true }))).toBe(false);
        expect(canRemember(choices({ source: { kind: 'ged', label: 'x.ged', persons: 1 } }))).toBe(false);
        expect(canRemember(choices({ source: { kind: 'tree', label: 'Oakfield', persons: 1 } }))).toBe(false);
    });

    it('saves the scope and the rules for the whole merge and by kind, never by person or value', () => {
        const rule = ruleFromChoices(choices({
            scope: 'c',
            rules: { all: 'both', kind: { birth: 'import' }, person: { p1: 'mine' }, value: { 'p1|birthDate': 'import' } },
        }), new Date('2026-11-24T09:00:00.000Z'));
        expect(rule).toEqual({ program: 'Family Tree Builder', scope: 'c', rules: { all: 'both', kind: { birth: 'import' } }, savedAt: '2026-11-24T09:00:00.000Z' });
        expect(ruleFromChoices(choices())?.rules).toEqual({ all: 'mine' });
        expect(ruleFromChoices(choices({ mode: 'new' }))).toBeNull();
    });

    it('says what is remembered in the step and in Settings', () => {
        expect(rememberLabel(choices())).toBe('Remember for files from Family Tree Builder: scope a), My tree wins');
        expect(rememberLabel(choices({ scope: 'b', rules: { all: 'import', kind: { places: 'mine' } } })))
            .toBe('Remember for files from Family Tree Builder: scope b), The import wins, with exceptions by kind of detail');
        expect(savedRuleDetail({ ...RULE, rules: { all: 'mine' } })).toBe('scope b) Missing people and empty details · My tree wins');
        setLanguage('cs');
        expect(rememberLabel(choices())).toBe('Zapamatovat pro soubory z Family Tree Builder: rozsah a), Platí můj strom');
    });
});

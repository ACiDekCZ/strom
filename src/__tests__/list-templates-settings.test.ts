/**
 * List rule templates saved on the device (spec 136 §7, D5): a rule saved as
 * a template keeps its conditions without the tree's people, places and
 * lists, survives a fresh start, and a stored template the app cannot read
 * whole is left out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsManager } from '../settings.js';
import { fillRuleParams, makeListTemplate, ruleNeeds, ruleIssues } from '../person-list-rules.js';
import { FAMILY_PRESETS } from '../lineage.js';
import { SETTINGS_KEY } from '../model-values.js';
import type { AppSettings, ListTemplate, PersonId, RuleGroup } from '../types.js';

let store: Map<string, string>;
const internals = SettingsManager as unknown as { load(): void; settings: AppSettings };
const restart = (): void => {
    internals.settings = { theme: 'system', language: 'system', encryption: false, auditLog: false };
    internals.load();
};

beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
    restart();
});
afterEach(() => {
    restart();
    vi.unstubAllGlobals();
});

/** Ancestors of Jorun Talvanen without a source, born near Mlýnky (all made up). */
const rule = (): RuleGroup => ({
    t: 'group', op: 'all', items: [
        { t: 'cond', c: 'family', p: { personId: 'jorun' as PersonId, personName: 'Jorun Talvanen', ...FAMILY_PRESETS.ancestors } },
        { t: 'cond', c: 'has', p: { have: false, what: 'source' } },
        { t: 'cond', c: 'near', p: { placeKey: 'mlynky', placeName: 'Mlýnky', events: ['birth'], km: 10 } },
    ],
});

describe('device list templates', () => {
    it('a saved template has no people or places, survives a restart and is a valid rule once filled', () => {
        expect(SettingsManager.getListTemplates()).toEqual([]);
        const tpl = makeListTemplate('t1', 'Millers near', rule(), '2026-11-24T10:30:00.000Z');
        SettingsManager.setListTemplates([tpl]);
        expect(store.get(SETTINGS_KEY)).not.toMatch(/jorun|Jorun|mlynky|Mlýnky/);
        restart();
        const [back] = SettingsManager.getListTemplates();
        expect(back).toEqual(tpl);
        expect(ruleNeeds(back.root).sort()).toEqual(['person', 'place']);
        const filled = fillRuleParams(back.root, { person: { id: 'ilsa' as PersonId, name: 'Ilsa Quellmayer' }, place: { key: 'vranice', name: 'Horní Vranice' } });
        expect(ruleNeeds(filled)).toEqual([]);
        expect(ruleIssues(filled)).toEqual([]);
    });

    it('a stored template the app cannot read whole is left out; none left drops the key', () => {
        const good = makeListTemplate('t1', 'Living', { t: 'group', op: 'all', items: [{ t: 'cond', c: 'alive', p: { value: 'living' } }] }, '2026-11-24T10:30:00.000Z');
        const bad = [
            { id: 't2', name: 'Unknown', root: { t: 'group', op: 'all', items: [{ t: 'cond', c: 'future', p: {} }] }, created: '' },
            { id: '', name: 'No id', root: good.root, created: '' },
            { id: 't3', name: '  ', root: good.root, created: '' },
        ] as unknown as ListTemplate[];
        SettingsManager.setListTemplates([good, ...bad]);
        restart();
        expect(SettingsManager.getListTemplates()).toEqual([good]);
        SettingsManager.setListTemplates([]);
        expect(JSON.parse(store.get(SETTINGS_KEY) ?? '{}')).not.toHaveProperty('listTemplates');
    });
});

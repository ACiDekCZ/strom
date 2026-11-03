import { describe, expect, it } from 'vitest';
import { autoDirectionName, changedLimits, findDuplicateDirection, firstWords, formProblem, newPrimary, parseBeforeYear } from '../direction-form.js';
import type { LiveDirection } from '../research-link.js';
import { DirectionWriteRefused, directionRefusal, directionRetryHelps } from '../research-directions-write.js';
import { strings } from '../strings.js';

const d = (x: Partial<LiveDirection>): LiveDirection => ({ id: 'G0001', name: 'x', state: 'active', ...x } as LiveDirection);

describe('direction form', () => {
    it('names a direction from its kind, person or question', () => {
        expect(autoDirectionName('ancestors', 'Jan Fíšek')).toBe('Ancestors: Jan Fíšek');
        expect(autoDirectionName('descendants', '')).toBe('');
        expect(autoDirectionName('question', 'Jan Fíšek')).toBe('Question: Jan Fíšek');
        expect(autoDirectionName('question', 'Jan Fíšek', ' Kdo byl kmotr Marie při křtu roku 1871? ')).toBe('Kdo byl kmotr Marie při křtu…');
        expect(firstWords('a b c')).toBe('a b c');
    });

    it('finds the direction there already: running, then paused, then the latest ended one', () => {
        const list = [
            d({ id: 'G1', state: 'done', direction: 'ancestors', focus: 'P1', since: '2026-01-01T00:00:00Z' }),
            d({ id: 'G2', state: 'done', direction: 'ancestors', focus: 'P1', since: '2026-05-01T00:00:00Z' }),
            d({ id: 'G3', state: 'paused', direction: 'ancestors', focus: 'P1' }),
            d({ id: 'G4', state: 'active', direction: 'question', focus: 'P1', question: 'Kdo byl kmotr?' }),
        ];
        expect(findDuplicateDirection(list, 'P1', 'ancestors')?.id).toBe('G3');
        expect(findDuplicateDirection(list.slice(0, 2), 'P1', 'ancestors')?.id).toBe('G2');
        expect(findDuplicateDirection(list, 'P1', 'question', '  kdo byl  KMOTR? ')?.id).toBe('G4');
        expect(findDuplicateDirection(list, 'P1', 'question', 'Kdy?')).toBeNull();
        expect(findDuplicateDirection(list, 'P2', 'ancestors')).toBeNull();
    });

    it('takes a year between 1000 and 2100', () => {
        expect(parseBeforeYear('')).toBeNull();
        expect(parseBeforeYear(' 1750 ')).toBe(1750);
        expect(parseBeforeYear('999')).toBe('bad');
        expect(parseBeforeYear('17a0')).toBe('bad');
        expect(parseBeforeYear('2101')).toBe('bad');
    });

    it('decides what the primary button does', () => {
        const base = { person: true, linked: true, kind: 'ancestors' as const, question: '', duplicate: null, duplicatesAllowed: false };
        expect(newPrimary(base)).toBe('create');
        expect(newPrimary({ ...base, person: false })).toBe('off');
        expect(newPrimary({ ...base, linked: false })).toBe('off');
        expect(newPrimary({ ...base, kind: 'question' })).toBe('off');
        expect(newPrimary({ ...base, duplicate: d({ state: 'active' }) })).toBe('show');
        expect(newPrimary({ ...base, duplicate: d({ state: 'active' }), duplicatesAllowed: true })).toBe('anyway');
        expect(newPrimary({ ...base, duplicate: d({ state: 'paused' }) })).toBe('resume');
    });

    it('writes only the limits that changed', () => {
        expect(changedLimits({ generations: 8 }, { generations: 8, before: null })).toBeNull();
        expect(changedLimits({ generations: 8 }, { generations: null, before: 1750 })).toEqual({ generations: null, before: 1750 });
    });

    it('offers Try again only where it helps: a busy research or no answer, never with a refusal', () => {
        const panel = (r: DirectionWriteRefused) => r.reason ? strings.live.dirNotSavedSaid(r.reason) : strings.live.dirNotSaved;
        const busy = directionRefusal(503, {});
        const none: DirectionWriteRefused = { ok: false, code: 'network', status: 0, errorCode: '', retryAfter: null, reason: '' };
        const failed = directionRefusal(500, {});
        const said = directionRefusal(500, { error: 'internal', text: 'Strom se právě zapisuje.' });
        expect([busy, none, failed, said].map(directionRetryHelps)).toEqual([true, true, false, false]);
        expect(formProblem(busy, 'edit', panel)).toMatchObject({ text: strings.live.dirBusy, tone: 'warn', retry: true });
        expect(formProblem(failed, 'edit', panel)).toEqual({ text: 'The change to the direction was not saved.', tone: 'danger', retry: false, said: '' });
        expect(formProblem(said, 'edit', panel)).toEqual({
            text: 'The change to the direction was not saved: “Strom se právě zapisuje.”', tone: 'danger', retry: false, said: 'Strom se právě zapisuje.',
        });
    });
});

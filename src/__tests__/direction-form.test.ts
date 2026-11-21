import { afterEach, describe, expect, it } from 'vitest';
import {
    autoDirectionName, changedLimits, createdToastText, directionMoveAsk, directionMoveAsked, directionMoveOffer, findDuplicateDirection,
    firstWords, formProblem, moveTasksSent, newPrimary, parseBeforeYear,
} from '../direction-form.js';
import type { LiveDirection } from '../research-link.js';
import { DirectionWriteRefused, directionRefusal, directionRetryHelps } from '../research-directions-write.js';
import { setLanguage, strings } from '../strings.js';

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

describe('a new direction inside wider ones (spec 126 U10, K2.15)', () => {
    afterEach(() => setLanguage('en'));
    const names: Record<string, string> = { G0001: 'Kubíčkovi z Dolní Lhoty', G0002: 'Malí z Horní Vsi' };
    const nameOf = (id: string) => names[id];

    it('asks the bridge only when creating with directions.move and a primary that creates', () => {
        expect(directionMoveAsked({ edit: false, moveOn: true, primary: 'create' })).toBe(true);
        expect(directionMoveAsked({ edit: false, moveOn: true, primary: 'anyway' })).toBe(true);
        expect(directionMoveAsked({ edit: false, moveOn: false, primary: 'create' })).toBe(false);
        expect(directionMoveAsked({ edit: true, moveOn: true, primary: 'save' })).toBe(false);
        for (const p of ['off', 'show', 'resume'] as const) expect(directionMoveAsked({ edit: false, moveOn: true, primary: p })).toBe(false);
    });

    it('shows nothing outside a wider direction, the sentence alone with nothing to move, the question with tasks', () => {
        expect(directionMoveOffer({ inside: [], move: 0 }, nameOf)).toBeNull();
        const alone = directionMoveOffer({ inside: ['G0001'], move: 0 }, nameOf);
        expect(alone).toEqual({ inside: ['Kubíčkovi z Dolní Lhoty'], move: 0 });
        expect(directionMoveAsk(alone)).toBe('');
        const ask = directionMoveOffer({ inside: ['G0001'], move: 7 }, nameOf);
        expect(directionMoveAsk(ask)).toBe('Move 7 open tasks here from the direction Kubíčkovi z Dolní Lhoty (about the people of this direction)');
        // A direction the panel does not know is named by its key; more wider ones: the count without a name.
        const two = directionMoveOffer({ inside: ['G0001', 'G0009'], move: 1 }, nameOf);
        expect(two?.inside).toEqual(['Kubíčkovi z Dolní Lhoty', 'G0009']);
        expect(directionMoveAsk(two)).toBe('Move 1 open task here from the wider directions (about the people of this direction)');
        expect(strings.live.dirMoveInside(two!.inside)).toBe(
            'The new direction lies inside the directions Kubíčkovi z Dolní Lhoty and G0009. The people in it stay in the wider directions too.');
    });

    it('sends moveTasks only when the question showed, as the box says', () => {
        expect(moveTasksSent(null, true)).toEqual({});
        expect(moveTasksSent({ inside: ['x'], move: 0 }, true)).toEqual({});
        expect(moveTasksSent({ inside: ['x'], move: 3 }, true)).toEqual({ moveTasks: true });
        expect(moveTasksSent({ inside: ['x'], move: 3 }, false)).toEqual({ moveTasks: false });
    });

    it('the toast counts the tasks moved, else stays as before', () => {
        expect(createdToastText(undefined)).toBe(strings.live.dirToastCreated);
        expect(createdToastText(0)).toBe(strings.live.dirToastCreated);
        expect(createdToastText(7)).toBe('Direction created. 7 tasks moved.');
        setLanguage('cs');
        expect(createdToastText(1)).toBe('Linie založena. Převeden 1 úkol.');
        expect(createdToastText(3)).toBe('Linie založena. Převedeny 3 úkoly.');
        expect(createdToastText(7)).toBe('Linie založena. Převedeno 7 úkolů.');
        expect(directionMoveAsk({ inside: ['Kubíčkovi z Dolní Lhoty'], move: 7 }))
            .toBe('Převést sem 7 otevřených úkolů z linie Kubíčkovi z Dolní Lhoty (o lidech této linie)');
        expect(strings.live.dirMoveInside(['Kubíčkovi z Dolní Lhoty']))
            .toBe('Nová linie je uvnitř linie Kubíčkovi z Dolní Lhoty. Lidé v ní zůstávají i v širší linii.');
        setLanguage('pl');
        expect(createdToastText(5)).toBe('Założono linię. Przeniesiono 5 zadań.');
        setLanguage('de');
        expect(createdToastText(1)).toBe('Richtung angelegt. 1 Aufgabe übernommen.');
    });
});

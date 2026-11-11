/**
 * A direction's line in the Research overview while the agent works on it
 * (spec 057 D1): with the Now section seen beside it (expanded or folded)
 * only a short "being worked on", the task standing in Now; with Now hidden,
 * or where there is no Now section, "Now: <task>" in full. In English,
 * Czech, German and Polish, none of them addressing anyone. Invented task.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { setLanguage } from '../strings.js';
import type { directionNowText as NowText } from '../ui/research-directions-ui.js';

const TASK = 'Křest Vrkoslava Bubeníčka, Hrabětice 1868';

let nowText: typeof NowText;
beforeAll(async () => {
    ({ directionNowText: nowText } = await import('../ui/research-directions-ui.js'));
}, 60000);
afterEach(() => setLanguage('en'));

describe('a direction\'s line while worked on (spec 057 D1)', () => {
    const words: Record<string, [string, string]> = {
        en: ['being worked on', `Now: ${TASK}`],
        cs: ['pracuje se', `Teď: ${TASK}`],
        de: ['wird bearbeitet', `Jetzt: ${TASK}`],
        pl: ['trwa praca', `Teraz: ${TASK}`],
    };

    it('the Now section seen: only that it is worked on, without the task', () => {
        for (const [lang, [short]] of Object.entries(words)) {
            setLanguage(lang as never);
            expect(nowText(TASK, true)).toBe(short);
            expect(nowText(TASK, true)).not.toContain(TASK);
        }
    });

    it('the Now section hidden or absent: the task in full', () => {
        for (const [lang, [, full]] of Object.entries(words)) {
            setLanguage(lang as never);
            expect(nowText(TASK, false)).toBe(full);
        }
    });

    it('the short text addresses no one', () => {
        const personal = /\b(you|your|vy|váš|vaše|ty|tvůj|Sie|Ihr|du|dein|ty|twój|wasz)\b/i;
        for (const lang of Object.keys(words)) {
            setLanguage(lang as never);
            expect(nowText(TASK, true)).not.toMatch(personal);
        }
    });
});

/**
 * Column names that say what the column shows (1118): the Sources table's
 * readers column counts the app's reader and the research's alike, so its
 * name does not name the research; the Events table's witnesses are any
 * event's (a baptism's, a burial's), so German says Zeugen there and keeps
 * Trauzeugen for the wedding's columns.
 */

import { describe, it, expect } from 'vitest';
import { getStringsForLang } from '../strings.js';
import { columnById } from '../ui/table-view/table-columns.js';

const LANGS = ['en', 'cs', 'de', 'pl'] as const;

describe('table column names', () => {
    it('the readers column does not name the research', () => {
        const label = columnById('sources', 'srcRead')!.label;
        const research = { en: /research/i, cs: /výzkum/i, de: /forschung/i, pl: /badani/i };
        for (const l of LANGS) {
            const text = getStringsForLang(l).table.col[label];
            expect(text, l).toBeTruthy();
            expect(text, l).not.toMatch(research[l]);
        }
    });

    it('the Events table\'s witnesses are not only a wedding\'s', () => {
        const ev = columnById('events', 'witnesses')!.label;
        const wed = columnById('unions', 'witnesses')!.label;
        expect(getStringsForLang('de').table.col[ev]).toBe('Zeugen');
        expect(getStringsForLang('de').table.col[wed]).toBe('Trauzeugen');
        for (const l of LANGS) expect(getStringsForLang(l).table.col[ev], l).toBeTruthy();
        // The life line's detail lists any event's witnesses too.
        expect(getStringsForLang('de').personPage.detail.witnesses('X')).toBe('Zeugen X');
    });
});

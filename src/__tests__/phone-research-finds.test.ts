/**
 * Finds of a phone's Research screen (spec 094 K3.13 §4): what a line says (its prefix and suffix by its kind), a
 * group's heading, which lines are "new" by when the finds were last seen here, at most three lines and the rest,
 * the heading's summary (since a moment or the last 24 hours), the older finds under the list and the finds that
 * came while the screen ran.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setLanguage } from '../strings';
import {
    findGroupSince, findIsNew, findsArrived, findsWindowSince, newestFindAt, olderFindGroups, phoneFindGroups, phoneFindHead, phoneFindLines,
    phoneFindText, phoneFindsSummary,
} from '../ui/phone-research-ui';
import type { DeviceFindGroup, DeviceFindLine, DeviceFinds } from '../device/device-research-data';

const NOW = Date.parse('2026-11-25T14:40:00Z');
const at = (min: number): string => new Date(NOW - min * 60_000).toISOString();

function line(kind: DeviceFindLine['kind'], o: Partial<DeviceFindLine> = {}): DeviceFindLine {
    return { kind, text: '', at: at(10), ...o };
}

function group(o: Partial<DeviceFindGroup> = {}): DeviceFindGroup {
    return { key: 'a1b2c3d4e5f6', kind: 'person', name: 'Bohumil Pýchavka', title: 'Bohumil Pýchavka (1861–1934)', span: '1861–1934', at: at(10), lines: [], ...o };
}

beforeAll(() => setLanguage('en'));

describe('what a line of finds says', () => {
    const person = group();
    it('a fact by its name and what it says; corrected and newly documented as a quiet suffix', () => {
        const fact = { kind: 'BIRT', name: 'Birth', what: '12 Mar 1861, Hřibová Lhota' };
        expect(phoneFindText(line('fact', { text: 'Birth: 12 Mar 1861, Hřibová Lhota', fact }), person))
            .toEqual({ text: 'Birth · 12 Mar 1861, Hřibová Lhota' });
        expect(phoneFindText(line('fixed', { text: 'x', fact }), person)).toEqual({ text: 'Birth · 12 Mar 1861, Hřibová Lhota', suffix: 'corrected' });
        expect(phoneFindText(line('cited', { text: 'x', fact }), person)).toEqual({ text: 'Birth · 12 Mar 1861, Hřibová Lhota', suffix: 'newly documented' });
        // Without what the fact says: the record's own words.
        expect(phoneFindText(line('fact', { text: 'Occupation', fact: { kind: 'OCCU', name: 'Occupation', what: '' } }), person)).toEqual({ text: 'Occupation' });
    });

    it('a new person or family, a name, a child with its years as the prefix of its kind', () => {
        expect(phoneFindText(line('person'), person)).toEqual({ prefix: 'New in the tree:', text: 'Bohumil Pýchavka · 1861–1934' });
        expect(phoneFindText(line('family'), group({ kind: 'family', title: 'Mlýnek family', name: undefined, span: undefined })))
            .toEqual({ prefix: 'New in the tree:', text: 'Mlýnek family' });
        expect(phoneFindText(line('name', { text: 'Bohumil Pýchavka' }), person)).toEqual({ prefix: 'Name:', text: 'Bohumil Pýchavka' });
        expect(phoneFindText(line('child', { text: 'Marie Pýchavková (1890–1891)', span: '1890–1891', person: 'P0007' }), person))
            .toEqual({ prefix: 'Child:', text: 'Marie Pýchavková · 1890–1891' });
        expect(phoneFindText(line('child', { text: 'Marie Pýchavková' }), person)).toEqual({ prefix: 'Child:', text: 'Marie Pýchavková' });
    });

    it('a source (no prefix under "New sources"), a conflict, a question and its decision', () => {
        expect(phoneFindText(line('source', { text: 'Register N 1860–1880' }), person)).toEqual({ prefix: 'Source:', text: 'Register N 1860–1880' });
        expect(phoneFindText(line('source', { text: 'Register N 1860–1880' }), group({ kind: 'sources' }))).toEqual({ text: 'Register N 1860–1880' });
        const resolved = group({ kind: 'resolved', name: undefined, title: undefined, span: undefined });
        expect(phoneFindText(line('conflict', { text: 'Marriage of Josef Mlýnek' }), resolved)).toEqual({ prefix: 'Conflict:', text: 'Marriage of Josef Mlýnek' });
        expect(phoneFindText(line('hypothesis', { text: 'Was Anna the daughter of Jan Bedla?' }), resolved))
            .toEqual({ prefix: 'Question:', text: 'Was Anna the daughter of Jan Bedla?' });
        expect(phoneFindText(line('hypothesis', { text: 'Was Anna the daughter of Jan Bedla?', decided: 'yes' }), resolved))
            .toEqual({ prefix: 'Question:', text: 'Was Anna the daughter of Jan Bedla?', suffix: 'decided: yes' });
    });

    it('in Czech', () => {
        setLanguage('cs');
        try {
            expect(phoneFindText(line('child', { text: 'Marie' }), person).prefix).toBe('Dítě:');
            expect(phoneFindText(line('cited', { text: 'Narození' }), person).suffix).toBe('nově doloženo');
            expect(phoneFindHead(group({ kind: 'sources' })).name).toBe('Nové prameny');
        } finally {
            setLanguage('en');
        }
    });
});

describe('a group of finds', () => {
    it('its heading: a person by its name and years (serif), sources and resolved by the app’s words', () => {
        expect(phoneFindHead(group())).toEqual({ name: 'Bohumil Pýchavka', years: '1861–1934', plain: false });
        expect(phoneFindHead(group({ name: undefined }))).toEqual({ name: 'Bohumil Pýchavka', years: '1861–1934', plain: false });
        expect(phoneFindHead(group({ kind: 'family', title: 'Mlýnek family', span: undefined }))).toEqual({ name: 'Mlýnek family', plain: false });
        expect(phoneFindHead(group({ kind: 'sources' }))).toEqual({ name: 'New sources', plain: true });
        expect(phoneFindHead(group({ kind: 'resolved' }))).toEqual({ name: 'Resolved', plain: true });
    });

    it('at most three lines, newest first, and how many more', () => {
        const g = group({ lines: [5, 50, 20, 1, 30].map(m => line('name', { text: `n${m}`, at: at(m) })) });
        const shown = phoneFindLines(g);
        expect(shown.lines.map(l => l.text)).toEqual(['n1', 'n5', 'n20']);
        expect(shown.more).toBe(2);
        expect(phoneFindLines(group({ lines: [line('name')] })).more).toBe(0);
        expect(phoneFindLines(g, Infinity).lines).toHaveLength(5);
    });

    it('the groups newest first', () => {
        const gs = [group({ key: 'a', at: at(30) }), group({ key: 'b', at: at(2) }), group({ key: 'c', at: at(10) })];
        expect(phoneFindGroups(gs).map(g => g.key)).toEqual(['b', 'c', 'a']);
    });
});

describe('new since the finds were last seen', () => {
    it('newer than the moment seen is new; nothing seen yet: every find is', () => {
        expect(findIsNew(at(5), at(10))).toBe(true);
        expect(findIsNew(at(10), at(10))).toBe(false);
        expect(findIsNew(at(20), at(10))).toBe(false);
        expect(findIsNew(at(20), null)).toBe(true);
        expect(findIsNew('', null)).toBe(false);
    });

    it('the finds are asked just after the moment seen (what was seen is not shown again); nothing seen: the last 24 hours', () => {
        expect(findsWindowSince('2026-11-25T14:05:00.000Z')).toBe('2026-11-25T14:05:00.001Z');
        expect(findsWindowSince(null)).toBeNull();
        expect(findsWindowSince('not a time')).toBeNull();
    });

    it('the newest moment of the finds (what is marked seen)', () => {
        const finds: DeviceFinds = { since: at(600), groups: [group({ at: at(30), lines: [line('name', { at: at(30) })] }), group({ at: at(4), lines: [line('name', { at: at(4) })] })] };
        expect(newestFindAt(finds)).toBe(at(4));
        expect(newestFindAt(null)).toBe('');
    });

    it('the summary: since the moment seen, or the last 24 hours', () => {
        expect(phoneFindsSummary(at(35), { lang: 'en', now: NOW })).toMatch(/^since \d{1,2}:05/);
        expect(phoneFindsSummary(null, { lang: 'en', now: NOW })).toBe('in the last 24 h');
        setLanguage('cs');
        try {
            expect(phoneFindsSummary(at(35), { lang: 'cs', now: NOW })).toMatch(/^od \d{1,2}:05$/);
            expect(phoneFindsSummary(null, { lang: 'cs', now: NOW })).toBe('za posledních 24 h');
        } finally {
            setLanguage('en');
        }
    });
});

describe('older finds and finds that came', () => {
    it('older finds: only their lines before the window shown, groups with none gone', () => {
        const older: DeviceFinds = {
            since: at(31 * 24 * 60),
            groups: [
                group({ key: 'a', at: at(5), lines: [line('name', { at: at(5) }), line('child', { text: 'Marie', at: at(2000) })] }),
                group({ key: 'b', at: at(3), lines: [line('name', { at: at(3) })] }),
                group({ key: 'c', kind: 'sources', at: at(3000), lines: [line('source', { text: 'S', at: at(3000) })] }),
            ],
        };
        const out = olderFindGroups(older, at(600));
        expect(out.map(g => g.key)).toEqual(['a', 'c']);
        expect(out[0].lines.map(l => l.kind)).toEqual(['child']);
        expect(out[0].at).toBe(at(2000));
    });

    it('the lines newer than everything shown before (none before: none came)', () => {
        const before: DeviceFinds = { since: at(600), groups: [group({ at: at(10), lines: [line('name', { at: at(10) })] })] };
        const after: DeviceFinds = {
            since: at(600),
            groups: [group({ at: at(1), lines: [line('name', { at: at(10) }), line('fact', { at: at(2) }), line('fixed', { at: at(1) })] })],
        };
        expect(findsArrived(before, after)).toBe(2);
        expect(findsArrived(null, after)).toBe(0);
        expect(findsArrived(before, before)).toBe(0);
    });

    it('a group’s detail counts since the window shown, or since its oldest line when it reaches before it', () => {
        const g = group({ lines: [line('name', { at: at(10) }), line('fact', { at: at(40) })] });
        expect(findGroupSince(g, at(60))).toBe(at(60));
        expect(findGroupSince(g, at(20))).toBe(at(40));
        expect(findGroupSince(g, null)).toBe(at(40));
    });
});

/**
 * The research writes `1 _STROM_ASOF` as an instant in UTC with a time
 * (`2026-10-31T06:12:05Z`); `1 DATE` stays a GEDCOM day in UTC. Near midnight
 * the UTC day is not the user's day: the version label and the stored "as of"
 * day are the LOCAL day of the instant. A bare day (older research) and a
 * DATE-only header read as before. Expected local days are computed with Date,
 * so the tests hold in any time zone. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { instantLocalDay, formatFlexDate } from '../dates.js';
import { readResearchHeader } from '../research-link.js';
import { parseGedcom, convertToStrom, parseGedcomDate } from '../ged-parser.js';
import { researchDateLabel } from '../ui/research-ui.js';

const UUID = '5a7e2c14-93b0-4f6d-8a21-c4e9d07b3f58';

/** The local day of an instant, computed independently of the code under test. */
function localDayOf(instant: string): string {
    const d = new Date(instant);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Just before and just after UTC midnight; and an instant whose written day
// (30 Oct, zone -12:00) is the previous day almost everywhere on Earth.
const BEFORE_MIDNIGHT = '2026-10-30T23:30:00Z';
const AFTER_MIDNIGHT = '2026-10-31T00:30:00Z';
const FAR_WEST = '2026-10-30T23:30:00-12:00';

function researchGed(asOf: string | null, date = '30 OCT 2026'): string {
    return [
        '0 HEAD',
        '1 SOUR STROM_RESEARCH',
        '2 VERS 1.9.0',
        `1 DATE ${date}`,
        `1 _STROM_TREE ${UUID}`,
        ...(asOf !== null ? [`1 _STROM_ASOF ${asOf}`] : []),
        '1 CHAR UTF-8',
        '1 NOTE Hrdličkovi',
        '0 @P0001@ INDI',
        '1 NAME Bohumil /Hrdlička/',
        '1 SEX M',
        '1 REFN P0001',
        '0 TRLR',
    ].join('\n');
}

describe('instantLocalDay', () => {
    it('gives the local day of an instant with a time and a zone', () => {
        expect(instantLocalDay(BEFORE_MIDNIGHT)).toBe(localDayOf(BEFORE_MIDNIGHT));
        expect(instantLocalDay(AFTER_MIDNIGHT)).toBe(localDayOf(AFTER_MIDNIGHT));
        expect(instantLocalDay(FAR_WEST)).toBe(localDayOf(FAR_WEST));
        expect(instantLocalDay('2026-10-30T23:30:00.250Z')).toBe(localDayOf(BEFORE_MIDNIGHT));
        expect(instantLocalDay('2026-10-30T23:30:00-1200')).toBe(localDayOf(FAR_WEST));
    });

    it('is null for a bare day, a GEDCOM date and a time without a zone', () => {
        expect(instantLocalDay('2026-10-31')).toBeNull();
        expect(instantLocalDay('31 OCT 2026')).toBeNull();
        expect(instantLocalDay('2026-10-31T06:12:05')).toBeNull();
        expect(instantLocalDay('')).toBeNull();
        expect(instantLocalDay(undefined)).toBeNull();
        expect(instantLocalDay(null)).toBeNull();
    });
});

describe('readResearchHeader: _STROM_ASOF', () => {
    it('reads the instant as written', () => {
        expect(readResearchHeader(researchGed(AFTER_MIDNIGHT)).asOf).toBe(AFTER_MIDNIGHT);
        expect(readResearchHeader(researchGed('2026-10-31')).asOf).toBe('2026-10-31');
    });

    it('absent without the line, and outside a Strom Research file', () => {
        expect(readResearchHeader(researchGed(null)).asOf).toBeUndefined();
        const other = researchGed(AFTER_MIDNIGHT).replace('1 SOUR STROM_RESEARCH', '1 SOUR OtherProgram');
        expect(readResearchHeader(other).asOf).toBeUndefined();
    });
});

describe('researchDateLabel: the version of the research', () => {
    it('an instant with a time: the local day of the instant, not the header DATE', () => {
        for (const instant of [BEFORE_MIDNIGHT, AFTER_MIDNIGHT, FAR_WEST]) {
            expect(researchDateLabel('30 OCT 2026', instant)).toBe(formatFlexDate(localDayOf(instant)));
        }
        const h = readResearchHeader(researchGed(FAR_WEST));
        expect(researchDateLabel(h.date, h.asOf)).toBe(formatFlexDate(localDayOf(FAR_WEST)));
    });

    it('a bare day or no _STROM_ASOF: the header DATE as before', () => {
        expect(researchDateLabel('30 OCT 2026', '2026-10-31')).toBe(formatFlexDate(parseGedcomDate('30 OCT 2026')));
        expect(researchDateLabel('30 OCT 2026')).toBe(formatFlexDate(parseGedcomDate('30 OCT 2026')));
        const h = readResearchHeader(researchGed(null));
        expect(researchDateLabel(h.date, h.asOf)).toBe(formatFlexDate(parseGedcomDate('30 OCT 2026')));
    });
});

describe('StromData.researchAsOf from _STROM_ASOF', () => {
    const asOf = (v: string | null) => convertToStrom(parseGedcom(researchGed(v))).data.researchAsOf;

    it('an instant with a time: the local day of the instant (an ISO day)', () => {
        expect(asOf(BEFORE_MIDNIGHT)).toBe(localDayOf(BEFORE_MIDNIGHT));
        expect(asOf(AFTER_MIDNIGHT)).toBe(localDayOf(AFTER_MIDNIGHT));
        expect(asOf(FAR_WEST)).toBe(localDayOf(FAR_WEST));
        expect(asOf(FAR_WEST)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('a bare day stays as written; none without the line', () => {
        expect(asOf('2026-10-31')).toBe('2026-10-31');
        expect(asOf('31 OCT 2026')).toBe('2026-10-31');
        expect(asOf(null)).toBeUndefined();
    });
});

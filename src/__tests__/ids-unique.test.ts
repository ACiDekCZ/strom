/**
 * Generated ids stay unique when thousands are made within one millisecond
 * (a GEDCOM import): 5 random characters alone collided, and a person was lost.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { generatePersonId, generatePartnershipId, generateSourceId } from '../types.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';

describe('generated ids', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('20 000 made within the same millisecond, with the same randomness, are all different', () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000);
        vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
        const ids = new Set<string>();
        for (let i = 0; i < 20_000; i++) ids.add(generatePersonId());
        expect(ids.size).toBe(20_000);
        expect(generatePartnershipId()).toMatch(/^u_1760000000000_[0-9a-z]+$/);
        expect(generateSourceId()).toMatch(/^src_1760000000000_[0-9a-z]+$/);
    });

    it('a GEDCOM of 3 000 people converts to 3 000 people (within one millisecond too)', () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_760_000_000_000);
        const lines = ['0 HEAD', '1 CHAR UTF-8'];
        for (let i = 1; i <= 3000; i++) lines.push(`0 @I${i}@ INDI`, `1 NAME Person${i} /Test/`, `1 SEX ${i % 2 ? 'M' : 'F'}`);
        lines.push('0 TRLR');
        const { data } = convertToStrom(parseGedcom(lines.join('\n')));
        expect(Object.keys(data.persons)).toHaveLength(3000);
    });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runInParts } from '../ui/in-parts.js';
import { parseGedcom, parseGedcomSteps, convertToStrom, convertToStromSteps } from '../ged-parser.js';

/** A generator whose every step takes `ms` of the (fake) clock. */
function* slowSteps(n: number, ms: number): Generator<number, string, void> {
    for (let k = 1; k <= n; k++) {
        vi.advanceTimersByTime(0);
        vi.setSystemTime(Date.now() + ms);
        yield k;
    }
    return 'done';
}

describe('runInParts (waiting buttons §8)', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('lets the page go only after a slice of work, with the last step', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
        const pauses: number[] = [];
        const result = await runInParts(slowSteps(10, 15), {
            sliceMs: 40,
            onStep: k => pauses.push(k),
            pause: () => Promise.resolve(),
        });
        expect(result).toBe('done');
        // 15 ms a step: a pause after the 3rd (45 ms), the 6th, the 9th.
        expect(pauses).toEqual([3, 6, 9]);
    });

    it('a quick computation never pauses', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
        const pause = vi.fn(() => Promise.resolve());
        expect(await runInParts(slowSteps(5, 1), { pause })).toBe('done');
        expect(pause).not.toHaveBeenCalled();
    });
});

describe('GEDCOM read in parts (C52)', () => {
    const ged = (n: number): string => {
        const out = ['0 HEAD', '1 CHAR UTF-8', '1 GEDC', '2 VERS 5.5.1'];
        for (let i = 1; i <= n; i++) {
            out.push(`0 @I${i}@ INDI`, `1 NAME Ota${i} /Rybízek/`, `1 SEX ${i % 2 ? 'M' : 'F'}`, `1 FAMS @F${Math.ceil(i / 2)}@`);
        }
        for (let f = 1; f <= n / 2; f++) out.push(`0 @F${f}@ FAM`, `1 HUSB @I${2 * f - 1}@`, `1 WIFE @I${2 * f}@`);
        out.push('0 TRLR');
        return out.join('\n');
    };

    it('steps say the people found so far, growing, and the result is the one read at once', () => {
        const text = ged(3000);
        const steps = parseGedcomSteps(text);
        const seen: number[] = [];
        let r = steps.next();
        while (!r.done) { seen.push(r.value.people); r = steps.next(); }
        expect(seen.length).toBeGreaterThan(3);
        expect(seen).toEqual([...seen].sort((a, b) => a - b));
        expect(seen[0]).toBeLessThan(3000);
        const atOnce = parseGedcom(text);
        expect(r.value.individuals.size).toBe(3000);
        expect([...r.value.individuals.keys()]).toEqual([...atOnce.individuals.keys()]);

        const conv = convertToStromSteps(r.value);
        let c = conv.next();
        let convSteps = 0;
        while (!c.done) { convSteps++; c = conv.next(); }
        expect(convSteps).toBeGreaterThan(3);
        const once = convertToStrom(atOnce);
        expect(c.value.stats).toEqual(once.stats);
        expect(Object.keys(c.value.data.persons).length).toBe(3000);
    });
});

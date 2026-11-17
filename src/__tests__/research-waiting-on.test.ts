/**
 * The "on" of a waiting item is the whole instruction of a manual step
 * (archive, book, year, where to save, what is enough). It is kept whole;
 * only an extreme text is cut, and never inside a surrogate pair.
 */
import { describe, expect, it } from 'vitest';
import { cleanText, sanitizeWaiting } from '../research-link.js';

const INSTRUCTION = [
    'Download the images of the birth register of Vzorov 1850-1871 (book 4521) from the State Regional Archive',
    'in Třeboň: sign in on the archive portal, open the book, take pages 12 to 48 in full resolution and save',
    'them into images/vzorov-4521/ of the research folder; the pages around 1858 are enough when the whole',
    'book cannot be taken. Then mark the step done here, the agent reads the pages and continues with the family.',
].join(' ');

describe('sanitizeWaiting keeps the whole "on"', () => {
    it('keeps an instruction of about 450 characters whole', () => {
        expect(INSTRUCTION.length).toBeGreaterThan(420);
        const [w] = sanitizeWaiting([{ id: 't1', what: 'Download the images', on: INSTRUCTION, at: '2026-11-17T08:00:00Z' }], true);
        expect(w.on).toBe(INSTRUCTION);
        expect(w.on.endsWith('continues with the family.')).toBe(true);
    });

    it('keeps an archive permission\'s terms whole as before', () => {
        const [w] = sanitizeWaiting([{ id: 'x', kind: 'permission', host: 'example.org', what: 'Allow the archive', on: INSTRUCTION }], true);
        expect(w.on).toBe(INSTRUCTION);
    });

    it('cuts only an extreme text, with an ellipsis', () => {
        const long = 'a'.repeat(5000);
        const [w] = sanitizeWaiting([{ id: 't2', what: 'x', on: long }], true);
        expect(w.on.length).toBe(1500);
        expect(w.on.endsWith('…')).toBe(true);
    });
});

describe('cleanText cut', () => {
    const PIECES = ['😀', '👩‍👩‍👧', '𠀋', '中文', 'é', 'é', 'x'];

    it('never leaves half of a surrogate pair at the cut', () => {
        for (const piece of PIECES) {
            for (let pad = 0; pad < 8; pad++) {
                const text = 'a'.repeat(pad) + piece.repeat(20);
                for (let max = 2; max < text.length; max++) {
                    const out = cleanText(text, max);
                    expect(out.length).toBeLessThanOrEqual(max);
                    expect(out.endsWith('…')).toBe(true);
                    const kept = out.slice(0, -1);
                    // What is kept is a prefix of the text and whole code points.
                    expect(text.startsWith(kept)).toBe(true);
                    expect(/[\uD800-\uDBFF]$/.test(kept)).toBe(false);
                }
                expect(cleanText(text, text.length)).toBe(text);
            }
        }
    });
});

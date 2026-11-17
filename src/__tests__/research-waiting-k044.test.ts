/**
 * K044: a task waiting for images of a book that does not know how many it
 * wants. The research says the book's next free number (`inbox.next`); every
 * file is given it in turn (never the number of its name: "IMG_4821.JPG"
 * would leave a gap in the book), a number typed by hand wins, the same
 * number twice by hand waits, a PDF starts at the next free and nothing
 * after it is foreseen; an older research (no `next`) keeps today's way.
 * The sentence when the research cannot tell the number, in four languages.
 * Invented file names only.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { sanitizeWaitingInbox } from '../research-link.js';
import { assignImages } from '../research-waiting.js';
import { taskImageReply } from '../research-waiting-write.js';
import { strings, setLanguage, type Language } from '../strings.js';

const f = (name: string, size = 1000) => ({ name, size });
const NAMES = ['Akta 1831 102.jpg', 'IMG_20241117_101500.jpg', 'skan.jpg', 'IMG_4821.JPG'];

describe('the research\'s next free number (inbox.next)', () => {
    it('kept only at a task that does not know how many it wants, a valid number only', () => {
        expect(sanitizeWaitingInbox({ have: 3, dir: 'x', next: 12 })).toMatchObject({ next: 12 });
        expect(sanitizeWaitingInbox({ have: 1, dir: 'x', want: 2, missing: [58], next: 59 })?.next).toBeUndefined();
        for (const bad of [0, -1, 1.5, '12', 1_000_000, null]) expect(sanitizeWaitingInbox({ have: 0, dir: 'x', next: bad })?.next).toBeUndefined();
    });

    it('an image\'s answer carries it (the number the next file gets)', () => {
        const r = taskImageReply(200, { task: 'T0007', image: 12, images: [12], by: 'image', inbox: { have: 4, dir: 'x', missing: [], next: 13 } });
        expect(r.ok && r.inbox?.next).toBe(13);
    });
});

describe('files at a task that does not know how many it wants (K044)', () => {
    it('every file the next free number in turn, whatever its name says; nothing waits', () => {
        const r = assignImages(NAMES.map(n => f(n)), null, [], { next: 12 });
        expect(r.files.map(a => [a.num, a.how])).toEqual([[12, 'next'], [13, 'next'], [14, 'next'], [15, 'next']]);
        expect(r).toMatchObject({ needAssign: 0, needDecide: 0, sendable: 4 });
    });

    it('a number typed by hand wins; the files after it go past it (highest + 1), a lower one leaves the rest', () => {
        let r = assignImages(NAMES.slice(0, 3).map(n => f(n)), null, [], { next: 12, chosen: [undefined, 20, undefined] });
        expect(r.files.map(a => [a.num, a.how])).toEqual([[12, 'next'], [20, 'hand'], [21, 'next']]);
        r = assignImages(NAMES.slice(0, 3).map(n => f(n)), null, [], { next: 12, chosen: [5, undefined, undefined] });
        expect(r.files.map(a => a.num)).toEqual([5, 12, 13]);
        // A number typed further on is not given to a file before it.
        r = assignImages(NAMES.slice(0, 3).map(n => f(n)), null, [], { next: 12, chosen: [undefined, undefined, 13] });
        expect(r.files.map(a => a.num)).toEqual([12, 14, 13]);
    });

    it('the same number twice by hand: the second waits for another, said', () => {
        const r = assignImages(NAMES.slice(0, 2).map(n => f(n)), null, [], { next: 12, chosen: [30, 30] });
        expect(r.files.map(a => [a.num, a.how, a.twice])).toEqual([[30, 'hand', undefined], [null, null, 30]]);
        expect(r.needAssign).toBe(1);
    });

    it('a PDF starts at the next free; nothing after it is foreseen (its pages not known)', () => {
        const r = assignImages([f('skan.jpg'), f('matrika.pdf'), f('IMG_4821.JPG'), f('dalsi.jpg')], null, [], { next: 7, chosen: [undefined, undefined, undefined, 40] });
        expect(r.files.map(a => [a.num, a.how])).toEqual([[7, 'next'], [8, 'pdf'], [null, 'unknown'], [40, 'hand']]);
        expect(r.needAssign).toBe(0);
    });

    it('checked before: a kind not taken or too large is left out of the numbers', () => {
        const r = assignImages([f('poznamky.docx'), f('skan.jpg', 10), f('velky.jpg', 10_000)], null, [], { next: 3, maxBytes: 5000 });
        expect(r.files.map(a => [a.num, a.problem ?? null])).toEqual([[null, 'format'], [3, null], [null, 'size']]);
    });

    it('an older research (no next): only a number typed by hand, the rest without one as before', () => {
        const r = assignImages(NAMES.slice(0, 2).map(n => f(n)), null, [], { chosen: [undefined, 9] });
        expect(r.files.map(a => [a.num, a.how])).toEqual([[null, 'unknown'], [9, 'hand']]);
        expect(r.needAssign).toBe(0);
    });

    it('a task that knows its numbers is not touched by next', () => {
        const a = assignImages([f('skan.jpg')], [57, 58], [57], { next: 99 });
        const b = assignImages([f('skan.jpg')], [57, 58], [57]);
        expect(a).toEqual(b);
        expect(a.files[0]).toMatchObject({ num: 58, how: 'order' });
    });
});

describe('the texts: never "Missing: images ." (K044)', () => {
    afterEach(() => setLanguage('en'));
    const langs: Language[] = ['en', 'cs', 'de', 'pl'];
    const want: Record<Language, [string, string, string]> = {
        en: ['The file name does not give the image number.', 'next free number', 'Image 12 is on another file too.'],
        cs: ['Název souboru neudává číslo snímku.', 'další volné číslo', 'Snímek 12 má i jiný soubor.'],
        de: ['Der Dateiname nennt keine Bildnummer.', 'nächste freie Nummer', 'Bild 12 hat auch eine andere Datei.'],
        pl: ['Nazwa pliku nie podaje numeru skanu.', 'kolejny wolny numer', 'Skan 12 ma też inny plik.'],
    } as Record<Language, [string, string, string]>;
    for (const lang of langs) {
        it(lang, () => {
            setLanguage(lang);
            const T = strings.live.waitingTask;
            expect([T.nameNoNumber, T.nextFree, T.numTwice(12)]).toEqual(want[lang]);
            expect(T.numLabel.length).toBeGreaterThan(0);
            expect(T.pdfNext.length).toBeGreaterThan(0);
        });
    }
});

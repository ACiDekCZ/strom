/**
 * An item waiting for images (spec 105 U4 §5): the Deliver block says which
 * images go as files into which folder — the numbers still missing when the
 * research says them, else a sentence without numbers; the book's folder
 * with its title for an item of one book the research lists with its folder
 * (and a link to open it), the task's folder otherwise, as its folder step —
 * and its steps come in their order (the archive's website, the folder,
 * "Add images"), a step that cannot go from here left out. Invented
 * archives and books only.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { LiveBooks, LiveWaiting, sanitizeBooks, sanitizeWaiting } from '../research-link.js';
import { deliverSentence, deliverSteps, deliverWebUrl, waitingDeliver } from '../research-waiting.js';
import { strings, setLanguage, type Language } from '../strings.js';

const archive = { key: 'repo:R0001', name: 'Archiv ve Vzorově', kind: 'archive', url: 'https://archiv.example/' };

const books: LiveBooks = sanitizeBooks({
    settings: { minTasks: 5, minTasksOwn: false, sameBook: 'no', sameBookOwn: false },
    list: [{
        id: 'B0001', title: 'Horní Vzorov 01', years: '1801–1838', tasks: 3, waiting: 1, open: 2, parked: 0, onDisk: 0, download: 'range',
        url: 'https://archiv.example/kniha/1', folder: 'B0001-horni-vzorov-01',
    }],
    more: 0,
})!;

const item = (extra: Record<string, unknown>): LiveWaiting => sanitizeWaiting([{
    id: 'T0001', what: 'Uložit snímky', kind: 'images', section: 'images', group: archive, order: 0, at: '2026-11-10T09:00:00Z',
    actions: ['images', 'answer', 'chat', 'folder'], ...extra,
}], true)[0];

const T = (lang: Language) => {
    setLanguage(lang);
    return strings.live.waitingTask;
};

describe('the Deliver sentence of an item waiting for images', () => {
    afterEach(() => setLanguage('en'));

    it('names the numbers still missing and the book\'s folder with its title', () => {
        const w = item({ book: 'B0001', inbox: { dir: 'inbox/T0001', have: 1, want: 3, missing: [112, 113], images: '111–113' } });
        const d = waitingDeliver(w, books);
        expect(d).toEqual({ missing: [112, 113], book: 'Horní Vzorov 01 1801–1838' });
        expect(deliverSentence(d, T('en'))).toBe('Images 112–113 as files (JPG or PNG) in the folder of the book Horní Vzorov 01 1801–1838');
        expect(deliverSentence(d, T('cs'))).toBe('Snímky 112–113 jako soubory (JPG nebo PNG) do složky knihy Horní Vzorov 01 1801–1838');
        expect(deliverSentence(d, T('de'))).toBe('Bilder 112–113 als Dateien (JPG oder PNG) im Ordner des Buchs Horní Vzorov 01 1801–1838');
        expect(deliverSentence(d, T('pl'))).toBe('Skany 112–113 jako pliki (JPG lub PNG) do folderu księgi Horní Vzorov 01 1801–1838');
    });

    it('without a book: the task\'s folder; one image in the singular', () => {
        const w = item({ inbox: { dir: 'inbox/T0001', have: 1, want: 2, missing: [58], images: '57–58' } });
        const d = waitingDeliver(w, books);
        expect(d).toEqual({ missing: [58], book: null });
        expect(deliverSentence(d, T('en'))).toBe('Image 58 as a file (JPG or PNG) in the task’s folder');
        expect(deliverSentence(d, T('cs'))).toBe('Snímek 58 jako soubor (JPG nebo PNG) do složky úkolu');
        expect(deliverSentence({ missing: [5, 6, 9], book: null }, T('cs'))).toBe('Snímky 5–6, 9 jako soubory (JPG nebo PNG) do složky úkolu');
    });

    it('without known numbers (an older research, a count not known): the sentence without them', () => {
        const old = item({ book: 'B0001', inbox: { dir: 'inbox/T0001', have: 0, want: 2 } });
        expect(waitingDeliver(old, books).missing).toBeNull();
        expect(deliverSentence(waitingDeliver(old, books), T('en'))).toBe('Images as files (JPG or PNG) in the folder of the book Horní Vzorov 01 1801–1838');
        const unknown = item({ inbox: { dir: 'inbox/T0001', have: 0 } });
        expect(deliverSentence(waitingDeliver(unknown, books), T('cs'))).toBe('Snímky jako soubory (JPG nebo PNG) do složky úkolu');
        const none = item({});
        expect(deliverSentence(waitingDeliver(none, null), T('de'))).toBe('Bilder als Dateien (JPG oder PNG) im Ordner der Aufgabe');
    });

    it('names the folder the folder step opens: the task\'s for a book outside the list, without a folder or a link to it', () => {
        // A book outside the research's list: its folder cannot be opened, the step opens the task's.
        const named = item({ book: 'B0009', inbox: { dir: 'inbox/T0001', have: 0, want: 1, missing: [7], book: 'Dolní Vzorov 03', recordset: 'B0009' } });
        expect(waitingDeliver(named, books)).toEqual({ missing: [7], book: null });
        expect(deliverSentence(waitingDeliver(named, books), T('cs'))).toBe('Snímek 7 jako soubor (JPG nebo PNG) do složky úkolu');
        expect(deliverSentence(waitingDeliver(item({ book: 'B0009' }), books), T('en'))).toBe('Images as files (JPG or PNG) in the task’s folder');
        // A listed book without its folder.
        const noFolder: LiveBooks = { ...books, list: [{ ...books.list[0], folder: undefined }] };
        expect(waitingDeliver(item({ book: 'B0001' }), noFolder).book).toBeNull();
        // A listed book with its folder, but no link to open it (an older research): the task's folder.
        const listed = item({ book: 'B0001', inbox: { dir: 'inbox/T0001', have: 0, want: 2, missing: [3, 4] } });
        expect(deliverSentence(waitingDeliver(listed, books, false), T('de'))).toBe('Bilder 3–4 als Dateien (JPG oder PNG) im Ordner der Aufgabe');
        expect(waitingDeliver(listed, books, true).book).toBe('Horní Vzorov 01 1801–1838');
    });
});

describe('the steps of delivering images', () => {
    it('keep their order; a step that cannot go is left out', () => {
        expect(deliverSteps({ web: 'https://archiv.example/kniha/1', folder: true, images: true })).toEqual(['web', 'folder', 'images']);
        expect(deliverSteps({ web: null, folder: true, images: true })).toEqual(['folder', 'images']);
        expect(deliverSteps({ web: null, folder: false, images: true })).toEqual(['images']);
        expect(deliverSteps({ web: 'https://archiv.example/', folder: false, images: false })).toEqual(['web']);
    });

    it('take the item\'s own website, else its book\'s, else none', () => {
        const book = books.list[0];
        expect(deliverWebUrl(item({ url: 'https://archiv.example/kniha/12' }), book)).toBe('https://archiv.example/kniha/12');
        expect(deliverWebUrl(item({}), book)).toBe('https://archiv.example/kniha/1');
        expect(deliverWebUrl(item({}), { archive: { name: 'Archiv', url: 'https://archiv.example/' } } as never)).toBe('https://archiv.example/');
        expect(deliverWebUrl(item({}), null)).toBeNull();
    });

    it('say their place in the steps to a screen reader', () => {
        expect(T('en').stepAria(1, 3, 'Archive website ↗')).toBe('Step 1 of 3: Archive website ↗');
        expect(T('cs').stepAria(2, 3, 'Otevřít složku knihy')).toBe('Krok 2 ze 3: Otevřít složku knihy');
        expect(T('cs').stepAria(1, 1, 'Mám snímky')).toBe('Krok 1 z 1: Mám snímky');
        expect(T('de').stepAria(3, 3, 'Bilder hinzufügen')).toBe('Schritt 3 von 3: Bilder hinzufügen');
        setLanguage('en');
    });
});

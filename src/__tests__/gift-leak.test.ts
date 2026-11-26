/**
 * "Give a family tree" (spec 093 K6.4, K6.5): nothing the protection hides
 * leaks into any part of the package. An invented family — the recipient
 * with her partner and child (shown in full), her brother and his partner
 * (the other living), their deceased parents — each living person with
 * unique marks of every sensitive kind. Under "Full data" with the default
 * sets the other living lose their sources, addresses, contacts, notes and
 * religion in the app's data, the pages, the book, the fan, the GEDCOM and
 * the cover page; those shown in full keep what their set keeps. A couple
 * of one shown in full and one other living takes the stricter set.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Gender, Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { defaultGiftFan, defaultGiftParts, defaultGiftPrivacy, type GiftPrivacy, type GiftSettings } from '../gift-tree.js';
import { buildGiftPackage, type GiftPackageEnv } from '../gift-package.js';
import { blobBytes, readZipEntries } from './helpers/zip-read.js';

const NOW = new Date(2026, 11, 20, 14, 0, 0);
const PNG_SHOWN_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_OTHER_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const dec = new TextDecoder();

const id = (key: string) => `leak_${key}` as PersonId;

/** The unique marks of one living person, by kind. */
function marks(key: string) {
    return {
        source: `Register of Quarrystone ${key}`,
        address: `Lantern Lane ${key}7`,
        residence: `Copperbeech Court ${key}9`,
        contact: `mail-${key.toLowerCase()}@example.invalid`,
        note: `Keeps bees at Hollowmere ${key}`,
        religion: `Chapel of Saint Ostrid ${key}`,
    };
}
type Kind = keyof ReturnType<typeof marks>;

function addPerson(data: StromData, key: string, firstName: string, lastName: string, gender: Gender, extra: Partial<Person> = {}): PersonId {
    const pid = id(key);
    data.persons[pid] = { id: pid, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra };
    return pid;
}

function addUnion(data: StromData, key: string, a: PersonId, b: PersonId, children: PersonId[], extra: Partial<Partnership> = {}): void {
    const uid = `leak_u_${key}` as PartnershipId;
    data.partnerships[uid] = { id: uid, person1Id: a, person2Id: b, childIds: [...children], status: 'married', ...extra };
    for (const p of [a, b]) data.persons[p].partnerships.push(uid);
    for (const ch of children) for (const p of [a, b]) {
        data.persons[p].childIds.push(ch);
        data.persons[ch].parentIds.push(p);
    }
}

/** A living person with a mark of every sensitive kind and a photo. */
function living(data: StromData, key: string, born: string, photo: string): Partial<Person> {
    const m = marks(key);
    const src = `src_${key}`;
    data.sources![src] = { id: src, title: m.source };
    return {
        birthDate: born, birthAddress: m.address, emails: [m.contact],
        notes: `${m.note}\nE-mail: ${m.contact}`, photo: `data:image/png;base64,${photo}`,
        sourceIds: [src],
        events: [
            { id: `res_${key}`, type: 'residence', date: '2020', address: m.residence },
            { id: `rel_${key}`, type: 'religion', place: m.religion },
        ],
    };
}

/** Couple marks: the couple's address, note and the source only it cites. */
function coupleMarks(key: string) {
    return { address: `Weathervane Square ${key}3`, note: `Married under the Thornapple ${key}`, source: `Banns book of Ashgrove ${key}` };
}

function couple(data: StromData, key: string): Partial<Partnership> {
    const m = coupleMarks(key);
    const src = `src_u_${key}`;
    data.sources![src] = { id: src, title: m.source };
    return { startDate: '1990-05-12', address: m.address, note: m.note, sourceIds: [src] };
}

/**
 * Aldous and Maudlin Fairbrook (deceased); their daughter Linnea (the
 * recipient) with Tavish Orrmund and their daughter Wrenna; their son Brannoch
 * with Isolde Brennholt.
 */
function leakTree(): StromData {
    const d: StromData = { persons: {}, partnerships: {}, sources: {} };
    const shown = PNG_SHOWN_B64;
    const other = PNG_OTHER_B64;
    const aldous = addPerson(d, 'aldous', 'Aldous', 'Fairbrook', 'male', { birthDate: '1931-02-11', deathDate: '2004-08-30' });
    const maudlin = addPerson(d, 'maudlin', 'Maudlin', 'Fairbrook', 'female', { birthDate: '1934-07-03', deathDate: '2011-01-19' });
    const linnea = addPerson(d, 'L', 'Linnea', 'Fairbrook', 'female', living(d, 'L', '1962-04-09', shown));
    const tavish = addPerson(d, 'T', 'Tavish', 'Orrmund', 'male', living(d, 'T', '1960-10-21', shown));
    const wrenna = addPerson(d, 'W', 'Wrenna', 'Orrmund', 'female', living(d, 'W', '1992-06-15', shown));
    const corvin = addPerson(d, 'C', 'Brannoch', 'Fairbrook', 'male', living(d, 'C', '1965-12-01', other));
    const isolde = addPerson(d, 'I', 'Isolde', 'Brennholt', 'female', living(d, 'I', '1967-03-27', other));
    addUnion(d, 'parents', aldous, maudlin, [linnea, corvin], { startDate: '1958' });
    addUnion(d, 'LT', linnea, tavish, [wrenna], couple(d, 'LT'));
    addUnion(d, 'CI', corvin, isolde, [], couple(d, 'CI'));
    d.defaultPersonId = linnea;
    return d;
}

function settings(privacy: GiftPrivacy): GiftSettings {
    return {
        cut: { recipients: [id('L')], depth: 2, branches: {} },
        privacy,
        parts: defaultGiftParts(),
        photos: true,
        fan: defaultGiftFan(),
        cards: 'detailed',
        letter: { lang: 'en', motif: 'none', salutation: 'Dear Linnea', message: 'For [name].', signature: 'Aunt', date: '2026-12-20' },
    };
}

const env: GiftPackageEnv = {
    now: NOW,
    app: async (data) => new Blob([JSON.stringify(data)]),
};

interface Package { texts: Map<string, string>; bytes: Map<string, Uint8Array>; app: string; gedcom: string }

/** Every file of the package (the archive unpacked), as text and as bytes. */
async function pack(privacy: GiftPrivacy, data: StromData = leakTree()): Promise<Package> {
    const r = await buildGiftPackage({ data, settings: settings(privacy), treeName: 'Fairbrook', env });
    const entries = readZipEntries(await blobBytes(r.blob));
    const texts = new Map<string, string>();
    const bytes = new Map<string, Uint8Array>();
    for (const e of entries) {
        if (e.path.endsWith('/')) continue;
        texts.set(e.path, dec.decode(e.data));
        bytes.set(e.path, e.data);
    }
    const find = (re: RegExp) => [...texts.entries()].find(([name]) => re.test(name))?.[1] ?? '';
    return { texts, bytes, app: find(/Family tree \(app\)\.html$/), gedcom: find(/\.ged$/) };
}

/** The package's parts by kind of file, each of which must be there. */
function partsOf(p: Package): Record<string, string[]> {
    const names = [...p.texts.keys()];
    return {
        app: names.filter(n => /Family tree \(app\)\.html$/.test(n)),
        pages: names.filter(n => n.includes('/Family pages/')),
        book: names.filter(n => /Family book\.html$/.test(n)),
        fan: names.filter(n => /Ancestor fan\.svg$/.test(n)),
        gedcom: names.filter(n => /\.ged$/.test(n)),
        cover: names.filter(n => /Start here\.html$/.test(n)),
    };
}

const OTHER_HIDDEN: Kind[] = ['source', 'address', 'residence', 'contact', 'note', 'religion'];

/** Every mark of these kinds of these people is absent from every file. */
function expectNowhere(p: Package, keys: string[], kinds: Kind[]): void {
    for (const [name, text] of p.texts) {
        for (const key of keys) {
            for (const kind of kinds) expect(text.includes(marks(key)[kind]), `${kind} of ${key} in ${name}`).toBe(false);
        }
    }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('K6.4 leak test: every part of the package', () => {
    it('Full data with the default sets: the other living lose sources, addresses, contacts, notes and religion everywhere; those in full keep their set', async () => {
        const privacy: GiftPrivacy = { ...defaultGiftPrivacy(), others: 'full' };
        const p = await pack(privacy);
        for (const [part, files] of Object.entries(partsOf(p))) expect(files.length, `${part} in the package`).toBeGreaterThan(0);

        // The other living (Brannoch, Isolde) and their couple: nothing of the hidden kinds anywhere.
        expectNowhere(p, ['C', 'I'], OTHER_HIDDEN);
        for (const [name, text] of p.texts) {
            for (const kind of ['address', 'note', 'source'] as const) {
                expect(text.includes(coupleMarks('CI')[kind]), `couple ${kind} in ${name}`).toBe(false);
            }
        }
        // They are named, with their birth dates and photos (their set keeps both).
        expect(p.app).toContain('Brannoch');
        expect(p.app).toContain('1965-12-01');
        expect(p.app).toContain(PNG_OTHER_B64);

        // Those shown in full: the default set hides contacts and notes, keeps the rest.
        expectNowhere(p, ['L', 'T', 'W'], ['contact', 'note']);
        for (const key of ['L', 'T', 'W']) {
            for (const kind of ['source', 'address', 'residence', 'religion'] as const) {
                expect(p.app, `${kind} of ${key} in the app`).toContain(marks(key)[kind]);
                expect(p.gedcom, `${kind} of ${key} in the GEDCOM`).toContain(marks(key)[kind]);
            }
        }
        // The household's couple keeps its address and source, not its note.
        expect(p.app).toContain(coupleMarks('LT').address);
        expect(p.gedcom).toContain(coupleMarks('LT').source);
        for (const [name, text] of p.texts) expect(text.includes(coupleMarks('LT').note), `household couple note in ${name}`).toBe(false);
    });

    it('a couple of one shown in full and one other living takes the stricter set everywhere', async () => {
        // Brannoch ticked: his own details by the full set, Isolde's by the others', their couple by the stricter of both.
        const privacy: GiftPrivacy = { ...defaultGiftPrivacy(), others: 'full', fullIds: [id('C')] };
        const p = await pack(privacy);
        for (const kind of ['source', 'address', 'residence', 'religion'] as const) {
            expect(p.app, `${kind} of Brannoch`).toContain(marks('C')[kind]);
            expect(p.gedcom, `${kind} of Brannoch in the GEDCOM`).toContain(marks('C')[kind]);
        }
        expectNowhere(p, ['I'], OTHER_HIDDEN);
        for (const [name, text] of p.texts) {
            for (const kind of ['address', 'note', 'source'] as const) {
                expect(text.includes(coupleMarks('CI')[kind]), `couple ${kind} in ${name}`).toBe(false);
            }
        }
    });

    it('the other living\'s photos off: their image is in no file, those in full keep theirs', async () => {
        const base = defaultGiftPrivacy();
        const privacy: GiftPrivacy = { ...base, others: 'full', othersSensitive: { ...base.othersSensitive, photos: false } };
        const p = await pack(privacy);
        const otherPng = bytesOf(PNG_OTHER_B64);
        const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
        for (const [name, text] of p.texts) expect(text.includes(PNG_OTHER_B64), `other living's photo in ${name}`).toBe(false);
        for (const [name, data] of p.bytes) expect(same(data, otherPng), `other living's photo as ${name}`).toBe(false);
        expect(p.app).toContain(PNG_SHOWN_B64);
    });

    it('under initials the brother and his partner keep nothing of any kind, not even their names', async () => {
        const p = await pack(defaultGiftPrivacy());
        expectNowhere(p, ['C', 'I'], OTHER_HIDDEN);
        for (const [name, text] of p.texts) {
            expect(text.includes('Brannoch'), `name in ${name}`).toBe(false);
            expect(text.includes(PNG_OTHER_B64), `photo in ${name}`).toBe(false);
        }
    });

    it('a house where people of the last ~100 years lived keeps its location and its name to itself in every file (spec 030 §10)', async () => {
        // Aldous (1931–2004) was born at the house: today it is another family's address.
        const tree = (): StromData => {
            const d = leakTree();
            d.persons[id('aldous')].birthPlace = 'Bělokamen';
            d.persons[id('aldous')].birthAddress = 'čp. 16';
            d.houses = { 'belokamen|16': { name: 'U Hollowmerů', location: { lat: 49.123457, lng: 15.654321, how: 'manual' }, merged: ['belokamen|9'] } };
            return d;
        };
        for (const privacy of [defaultGiftPrivacy(), { ...defaultGiftPrivacy(), others: 'full' as const }]) {
            const p = await pack(privacy, tree());
            for (const [name, text] of p.texts) {
                expect(text.includes('U Hollowmerů'), `house name in ${name}`).toBe(false);
                expect(text.includes('49.123457'), `house location in ${name}`).toBe(false);
            }
            // What joins the houses stays.
            expect(p.app).toContain('belokamen|9');
        }
    });

    it('under initials, anonymous and minimal the other living\'s citation details (main citation, QUAY) are in no file', async () => {
        // Unique marks in the citation details of the brother, his partner and their couple.
        const cite = (key: string) => ({ main: `Citemark main ${key}`, quay: `Citemark quay ${key}` });
        const tree = (): StromData => {
            const d = leakTree();
            for (const key of ['C', 'I']) {
                const person = d.persons[id(key)];
                person.citationMain = { birthSourceIds: cite(key).main };
                person.citationQuay = { sourceIds: { [cite(key).quay]: 2 } };
            }
            const union = d.partnerships['leak_u_CI' as PartnershipId];
            union.citationMain = { sourceIds: cite('CI').main };
            union.citationQuay = { divorceSourceIds: { [cite('CI').quay]: 1 } };
            return d;
        };
        for (const others of ['initials', 'anonymous', 'minimal'] as const) {
            const p = await pack({ ...defaultGiftPrivacy(), others }, tree());
            for (const [name, text] of p.texts) {
                for (const key of ['C', 'I', 'CI']) {
                    expect(text.includes(cite(key).main), `${others}: main citation of ${key} in ${name}`).toBe(false);
                    expect(text.includes(cite(key).quay), `${others}: citation QUAY of ${key} in ${name}`).toBe(false);
                }
            }
        }
    });
});

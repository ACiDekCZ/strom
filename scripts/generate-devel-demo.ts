/**
 * Deterministic development demo tree generator.
 *
 * Produces `test/devel-demo.json`: a rich, ENTIRELY FICTIONAL family tree used
 * by the team to eyeball features (multi-marriage chains, adoption/step/foster
 * links, widow remarriage, pedigree collapse, life events with godparents and
 * witnesses, sources, attachments, photos, place registry...). Natural Czech
 * names and real Czech/German place names are used, but no person is real.
 *
 * HOW TO LOAD IT FOR EYEBALLING:
 *   Open the app, use the tree menu → Import, and pick `test/devel-demo.json`.
 *   (It is a plain StromData JSON, the same shape the app exports.) This is a
 *   dev-only fixture; it is intentionally NOT wired into the built-in demo-tree
 *   UI (that is reserved for the Přemyslovci / Tudorovci sample trees).
 *
 * DETERMINISM:
 *   No Math.random / Date.now — running it twice produces byte-identical
 *   structure, names and dates. The one exception is PHOTO and ATTACHMENT image
 *   bytes: those are drawn on a real canvas by a throwaway Playwright script and
 *   may differ per platform. To keep regeneration reproducible, this generator
 *   PRESERVES any image bytes already present in the committed file (matched by
 *   person id / attachment id) and only fills the structure around them. The
 *   committed JSON already carries the images, so regeneration is occasional.
 *
 * Run with `npm run gen:devel-demo`. The photos are (re)generated separately by
 * the throwaway Playwright script that lives outside the repo tree.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Minimal structural types (kept local so the script is standalone, mirroring
// the shapes in src/types.ts — see there for the authoritative definitions).
// ---------------------------------------------------------------------------

type Gender = 'male' | 'female';
type Status = 'married' | 'partners' | 'divorced' | 'separated';
type RelType = 'biological' | 'adoptive' | 'step' | 'foster';
type EventType =
    | 'baptism' | 'burial' | 'occupation' | 'residence' | 'military'
    | 'emigration' | 'immigration' | 'education' | 'custom';
type Role = 'godparent' | 'witness' | 'officiant' | 'other';

interface Participant { id: string; role: Role; personId?: string; name?: string; note?: string; }
interface LifeEvent {
    id: string; type: EventType; customLabel?: string; date?: string; place?: string;
    note?: string; sourceIds?: string[]; participants?: Participant[];
}
interface Source { id: string; title: string; repository?: string; reference?: string; url?: string; note?: string; quality?: number; }
interface Attachment { id: string; name: string; mimeType: string; dataUrl: string; sizeBytes: number; note?: string; sourceId?: string; }
interface PlaceGeo { lat: number; lon: number; label?: string; }

interface Person {
    id: string; firstName: string; lastName: string; gender: Gender;
    isPlaceholder: boolean; partnerships: string[]; parentIds: string[]; childIds: string[];
    birthDate?: string; birthPlace?: string; deathDate?: string; deathPlace?: string;
    notes?: string; refn?: string; question?: string; nameVariants?: string[];
    isLocked?: boolean; isDeceased?: boolean; photo?: string; photoOriginalName?: string;
    events?: LifeEvent[]; sourceIds?: string[]; attachments?: Attachment[];
    parentRelTypes?: Record<string, RelType>;
}
interface Partnership {
    id: string; person1Id: string; person2Id: string; childIds: string[]; status: Status;
    startDate?: string; startPlace?: string; endDate?: string; note?: string;
    sourceIds?: string[]; isPrimary?: boolean;
}
interface StromData {
    version: number;
    persons: Record<string, Person>;
    partnerships: Record<string, Partnership>;
    sources?: Record<string, Source>;
    places?: Record<string, PlaceGeo>;
    surnameVariants?: string[][];
    defaultPersonId?: string;
}

// ---------------------------------------------------------------------------
// Place registry (real towns; coordinates plausible). 11 Czech + 2 German.
// Keyed by the same normalization src/places.ts uses (placeKey).
// ---------------------------------------------------------------------------

const PLACES: Record<string, { lat: number; lon: number }> = {
    'Kutná Hora': { lat: 49.9484, lon: 15.2682 },
    'Čáslav': { lat: 49.9109, lon: 15.3906 },
    'Kolín': { lat: 50.0274, lon: 15.2000 },
    'Kladno': { lat: 50.1477, lon: 14.1028 },
    'Praha': { lat: 50.0755, lon: 14.4378 },
    'Tábor': { lat: 49.4144, lon: 14.6578 },
    'Písek': { lat: 49.3088, lon: 14.1475 },
    'Havlíčkův Brod': { lat: 49.6079, lon: 15.5800 },
    'Poděbrady': { lat: 50.1425, lon: 15.1189 },
    'Nymburk': { lat: 50.1859, lon: 15.0413 },
    'Litomyšl': { lat: 49.8723, lon: 16.3106 },
    'Wien': { lat: 48.2082, lon: 16.3738 },
    'Dresden': { lat: 51.0504, lon: 13.7373 },
};

function placeKey(raw: string): string {
    return raw
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[.,;]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ---------------------------------------------------------------------------
// Sources catalog (parish-register style).
// ---------------------------------------------------------------------------

const SOURCES: Record<string, Source> = {
    src_kh_matrika_n: {
        id: 'src_kh_matrika_n',
        title: 'Matrika narozených, Kutná Hora 1850–1890',
        repository: 'SOA Praha',
        reference: 'sign. KH N12, fol. 44',
        quality: 3,
    },
    src_caslav_matrika_o: {
        id: 'src_caslav_matrika_o',
        title: 'Matrika oddaných, Čáslav 1870–1900',
        repository: 'SOA Praha',
        reference: 'sign. ČA O5, fol. 118',
        quality: 2,
    },
    src_kolin_matrika_z: {
        id: 'src_kolin_matrika_z',
        title: 'Matrika zemřelých, Kolín 1900–1925',
        repository: 'SOA Praha',
        reference: 'sign. KO Z8, fol. 71',
        quality: 2,
    },
    src_scitani_1921: {
        id: 'src_scitani_1921',
        title: 'Sčítání lidu 1921, Kutná Hora',
        repository: 'SOkA Kutná Hora',
        reference: 'sčítací arch, dům č. 112',
        quality: 2,
    },
    src_kronika: {
        id: 'src_kronika',
        title: 'Rodinná kronika Dvořákových',
        repository: 'soukromá sbírka',
        note: 'Rukopisná kronika vedená od 30. let 20. století; údaje před rokem 1880 jsou tradované.',
        quality: 1,
    },
    src_wien_meldezettel: {
        id: 'src_wien_meldezettel',
        title: 'Meldezettel, Wien III. Bezirk',
        repository: 'Wiener Stadt- und Landesarchiv',
        reference: 'Meldearchiv, Karton 1447',
        quality: 2,
    },
};

// ---------------------------------------------------------------------------
// Builder.
// ---------------------------------------------------------------------------

interface PersonOpts {
    first: string;
    last: string;
    gender: Gender;
    birth?: string;
    birthPlace?: string;
    death?: string;
    deathPlace?: string;
    notes?: string;
    refn?: string;
    question?: string;
    nameVariants?: string[];
    isLocked?: boolean;
    isDeceased?: boolean;
    /** Marks that this person should carry a portrait (photo bytes filled later). */
    photo?: boolean;
    sourceIds?: string[];
    placeholder?: boolean;
}

class Builder {
    persons: Record<string, Person> = {};
    partnerships: Record<string, Partnership> = {};
    private evCount = 0;
    private ptCount = 0;
    private attCount = 0;

    person(id: string, opts: PersonOpts): string {
        if (this.persons[id]) throw new Error(`Duplicate person: ${id}`);
        const p: Person = {
            id,
            firstName: opts.placeholder ? '?' : opts.first,
            lastName: opts.placeholder ? '' : opts.last,
            gender: opts.gender,
            isPlaceholder: !!opts.placeholder,
            partnerships: [],
            parentIds: [],
            childIds: [],
        };
        if (opts.birth) p.birthDate = opts.birth;
        if (opts.birthPlace) p.birthPlace = opts.birthPlace;
        if (opts.death) p.deathDate = opts.death;
        if (opts.deathPlace) p.deathPlace = opts.deathPlace;
        if (opts.notes) p.notes = opts.notes;
        if (opts.refn) p.refn = opts.refn;
        if (opts.question) p.question = opts.question;
        if (opts.nameVariants) p.nameVariants = opts.nameVariants;
        if (opts.isLocked) p.isLocked = true;
        if (opts.isDeceased !== undefined) p.isDeceased = opts.isDeceased;
        if (opts.photo) p.photoOriginalName = `${id}.jpg`;
        if (opts.sourceIds) p.sourceIds = opts.sourceIds;
        this.persons[id] = p;
        return id;
    }

    /** Male partner becomes person1 (rendered left), female person2 (right). */
    marry(aId: string, bId: string, opts: {
        status?: Status; start?: string; startPlace?: string; end?: string;
        note?: string; sourceIds?: string[]; primary?: boolean;
    } = {}): string {
        const a = this.persons[aId];
        const b = this.persons[bId];
        let p1 = aId, p2 = bId;
        if (a.gender === 'female' && b.gender === 'male') { p1 = bId; p2 = aId; }
        const id = `u_${p1}_${p2}`;
        if (this.partnerships[id]) throw new Error(`Duplicate union: ${id}`);
        const u: Partnership = {
            id, person1Id: p1, person2Id: p2, childIds: [],
            status: opts.status ?? 'married',
        };
        if (opts.start) u.startDate = opts.start;
        if (opts.startPlace) u.startPlace = opts.startPlace;
        if (opts.end) u.endDate = opts.end;
        if (opts.note) u.note = opts.note;
        if (opts.sourceIds) u.sourceIds = opts.sourceIds;
        if (opts.primary) u.isPrimary = true;
        this.partnerships[id] = u;
        this.persons[p1].partnerships.push(id);
        this.persons[p2].partnerships.push(id);
        return id;
    }

    /** Children of a union. `rel` overrides the parent-child type per child. */
    kids(unionId: string, childIds: string[], rel?: RelType): void {
        const u = this.partnerships[unionId];
        for (const c of childIds) {
            u.childIds.push(c);
            this.persons[c].parentIds = [u.person1Id, u.person2Id];
            if (!this.persons[u.person1Id].childIds.includes(c)) this.persons[u.person1Id].childIds.push(c);
            if (!this.persons[u.person2Id].childIds.includes(c)) this.persons[u.person2Id].childIds.push(c);
            if (rel && rel !== 'biological') {
                const child = this.persons[c];
                child.parentRelTypes = child.parentRelTypes ?? {};
                child.parentRelTypes[u.person1Id] = rel;
                child.parentRelTypes[u.person2Id] = rel;
            }
        }
    }

    /**
     * Single known parent. Mirrors what the app itself does when a child is
     * added to a person with no partner (relation-modal 'child' branch): a
     * PLACEHOLDER partner + partnership is created, because subgraph selection
     * and layout descend through unions — a bare parentIds link with no union
     * renders the parent alone (found the hard way: importing this fixture
     * showed "1 z 67 osob").
     */
    singleKids(parentId: string, childIds: string[]): void {
        const parent = this.persons[parentId];
        const phId = `${parentId}_ph`;
        this.person(phId, {
            first: '?', last: '',
            gender: parent.gender === 'male' ? 'female' : 'male',
            placeholder: true,
        });
        const unionId = this.marry(parentId, phId, {});
        this.kids(unionId, childIds);
    }

    event(personId: string, ev: {
        type: EventType; customLabel?: string; date?: string; place?: string;
        note?: string; sourceIds?: string[];
        participants?: Array<{ role: Role; personId?: string; name?: string; note?: string }>;
    }): void {
        const p = this.persons[personId];
        p.events = p.events ?? [];
        const e: LifeEvent = { id: `ev_${personId}_${++this.evCount}`, type: ev.type };
        if (ev.customLabel) e.customLabel = ev.customLabel;
        if (ev.date) e.date = ev.date;
        if (ev.place) e.place = ev.place;
        if (ev.note) e.note = ev.note;
        if (ev.sourceIds) e.sourceIds = ev.sourceIds;
        if (ev.participants) {
            e.participants = ev.participants.map(pt => {
                const part: Participant = { id: `pt_${++this.ptCount}`, role: pt.role };
                if (pt.personId) part.personId = pt.personId;
                if (pt.name) part.name = pt.name;
                if (pt.note) part.note = pt.note;
                return part;
            });
        }
        p.events.push(e);
    }

    attach(personId: string, att: { name: string; mimeType?: string; note?: string; sourceId?: string }): void {
        const p = this.persons[personId];
        p.attachments = p.attachments ?? [];
        p.attachments.push({
            id: `att_${personId}_${++this.attCount}`,
            name: att.name,
            mimeType: att.mimeType ?? 'image/jpeg',
            // Image bytes are injected by the Playwright script; empty until then.
            dataUrl: '',
            sizeBytes: 0,
            ...(att.note ? { note: att.note } : {}),
            ...(att.sourceId ? { sourceId: att.sourceId } : {}),
        });
    }
}

// ---------------------------------------------------------------------------
// The demo tree.
// ---------------------------------------------------------------------------

const FICTIONAL_NOTE =
    'FIKTIVNÍ DEMO STROM. Všechny osoby jsou smyšlené a slouží pouze k vývoji a '
    + 'testování aplikace; jakákoli shoda se skutečnými osobami je náhodná. Místní '
    + 'názvy jsou reálné.';

function buildDemo(): Builder {
    const b = new Builder();

    // ===== Generation 0: apex couple (shared ancestors -> pedigree collapse) =====
    // Kateřina raises Anna alone (single-parent line at the very top).
    b.person('katerina_berankova', {
        first: 'Kateřina', last: 'Beránková', gender: 'female',
        birth: '<1840', birthPlace: 'Čáslav', death: '1911', deathPlace: 'Čáslav',
        notes: 'Vdova, živila se přadláctvím. Otec Anny není v matrice uveden.',
        nameVariants: ['Beranek', 'Beránek'],
    });
    b.person('vaclav_dvorak', {
        first: 'Václav', last: 'Dvořák', gender: 'male',
        birth: '1855', birthPlace: 'Kutná Hora', death: '1919', deathPlace: 'Kutná Hora',
        notes: FICTIONAL_NOTE + '\n\nZakladatel rodu v Kutné Hoře, rolník na gruntu č. 112. Uzamčeno proti úpravám.',
        refn: 'KH-112', nameVariants: ['Dvořák', 'Dworschak'],
        isLocked: true, isDeceased: true, photo: true,
        sourceIds: ['src_kh_matrika_n', 'src_kronika'],
    });
    b.person('anna_dvorakova', {
        first: 'Anna', last: 'Beránková', gender: 'female',
        birth: '~1858', birthPlace: 'Čáslav', death: '1929', deathPlace: 'Kutná Hora',
        question: 'Odkud pocházela její matka Kateřina a kdo byl Annin otec?',
        photo: true,
    });
    b.singleKids('katerina_berankova', ['anna_dvorakova']);

    const uApex = b.marry('vaclav_dvorak', 'anna_dvorakova', {
        start: '1877-05-14', startPlace: 'Kutná Hora', sourceIds: ['src_caslav_matrika_o'], primary: true,
    });
    b.event('vaclav_dvorak', {
        type: 'occupation', note: 'rolník', date: '~1880', place: 'Kutná Hora',
    });
    b.event('vaclav_dvorak', {
        type: 'custom', customLabel: 'Svatba', date: '1877-05-14', place: 'Kutná Hora',
        note: 'Oddáni v chrámu sv. Barbory.',
        sourceIds: ['src_caslav_matrika_o'],
        participants: [
            { role: 'witness', name: 'Matěj Kadlec', note: 'soused, rolník' },
            { role: 'witness', name: 'Josef Beránek', note: 'strýc nevěsty' },
            { role: 'officiant', name: 'P. Antonín Vaněk', note: 'děkan' },
        ],
    });
    b.attach('vaclav_dvorak', {
        name: 'oddaci-list-1877.jpg', note: 'Výřez z matriky oddaných', sourceId: 'src_caslav_matrika_o',
    });

    // ===== Generation 1 (children of the apex couple) =====
    // Josef -> blacksmith, MULTI-MARRIAGE CHAIN #1 (widower remarriage).
    b.person('josef_dvorak', {
        first: 'Josef', last: 'Dvořák', gender: 'male',
        birth: '1879-03-02', birthPlace: 'Kutná Hora', death: '1945-11-20', deathPlace: 'Kolín',
        notes: 'Kovář, dílna v Kolíně. Ovdověl 1912, znovu se oženil 1914.',
        refn: 'KH-207', photo: true, sourceIds: ['src_kh_matrika_n'],
    });
    b.person('frantisek_dvorak', {
        first: 'František', last: 'Dvořák', gender: 'male',
        birth: '1882-07-19', birthPlace: 'Kutná Hora', death: '1958', deathPlace: 'Wien',
        notes: 'Truhlář, kolem roku 1910 se odstěhoval za prací do Vídně.',
        refn: 'W-III-88', nameVariants: ['Dworschak'], photo: true,
        sourceIds: ['src_wien_meldezettel'],
        question: 'Ve kterém roce přesně emigroval do Vídně?',
    });
    b.person('marie_dvorakova', {
        first: 'Marie', last: 'Dvořáková', gender: 'female',
        birth: '1885-12-08', birthPlace: 'Kutná Hora', death: '1972', deathPlace: 'Praha',
        photo: true,
    });
    b.kids(uApex, ['josef_dvorak', 'frantisek_dvorak', 'marie_dvorakova']);

    b.event('josef_dvorak', {
        type: 'military', note: 'pěší pluk č. 21', date: '1915..1918', place: 'Halič',
    });
    b.event('josef_dvorak', {
        type: 'residence', date: '1921', place: 'Kutná Hora',
        note: 'Sčítání lidu 1921, dům č. 112.', sourceIds: ['src_scitani_1921'],
    });
    b.event('josef_dvorak', {
        type: 'occupation', note: 'kovář', date: '~1910', place: 'Kolín',
    });
    b.attach('josef_dvorak', {
        name: 'matrika-krest-vyrez.jpg', note: 'Záznam o křtu, Kutná Hora', sourceId: 'src_kh_matrika_n',
    });

    // Josef chain: 1st wife Terezie (dies), 2nd wife Františka.
    b.person('terezie_dvorakova', {
        first: 'Terezie', last: 'Horáková', gender: 'female',
        birth: '1881-01-22', birthPlace: 'Kolín', death: '1912-04-03', deathPlace: 'Kolín',
        notes: 'Zemřela mladá na souchotiny.', nameVariants: ['Horák', 'Horaczek'],
        isDeceased: true, photo: true, sourceIds: ['src_kolin_matrika_z'],
    });
    b.person('frantiska_dvorakova', {
        first: 'Františka', last: 'Kučerová', gender: 'female',
        birth: '1888-09-30', birthPlace: 'Čáslav', death: '1969', deathPlace: 'Kolín',
        isDeceased: true,
    });
    const uJosef1 = b.marry('josef_dvorak', 'terezie_dvorakova', {
        start: '1901-06-11', startPlace: 'Kolín', sourceIds: ['src_kh_matrika_n'],
    });
    const uJosef2 = b.marry('josef_dvorak', 'frantiska_dvorakova', {
        start: '1914-02-09', startPlace: 'Kutná Hora', primary: true,
        note: 'Josef byl v době sňatku vdovcem.',
    });

    // Frantisek -> Wien branch (other side of the cousin marriage).
    b.person('barbora_dvorakova', {
        first: 'Barbora', last: 'Svobodová', gender: 'female',
        birth: '1886-05-17', birthPlace: 'Nymburk', death: '1961', deathPlace: 'Wien',
    });
    const uFrantisek = b.marry('frantisek_dvorak', 'barbora_dvorakova', {
        start: '1907-10-05', startPlace: 'Nymburk',
    });
    b.event('frantisek_dvorak', {
        type: 'emigration', date: '~1910', place: 'Wien',
        note: 'Za prací do truhlářské dílny ve Vídni.', sourceIds: ['src_wien_meldezettel'],
    });
    b.event('frantisek_dvorak', {
        type: 'residence', date: '1911..1958', place: 'Wien',
        note: 'Landstraße, Wien III.', sourceIds: ['src_wien_meldezettel'],
    });
    b.attach('frantisek_dvorak', {
        name: 'meldezettel-wien.jpg', note: 'Přihlašovací lístek, Wien', sourceId: 'src_wien_meldezettel',
    });

    // Marie -> Novák branch.
    b.person('antonin_novak', {
        first: 'Antonín', last: 'Novák', gender: 'male',
        birth: '1883-04-12', birthPlace: 'Kladno', death: '1955', deathPlace: 'Kladno',
        notes: 'Horník na Kladensku.', nameVariants: ['Nowak'],
    });
    const uMarie = b.marry('antonin_novak', 'marie_dvorakova', {
        start: '1906-09-22', startPlace: 'Kutná Hora',
    });
    b.event('antonin_novak', { type: 'occupation', note: 'horník', date: '>1904', place: 'Kladno' });

    // ===== Generation 2 =====
    // Bohumil (Josef x Terezie) -> teacher; leads to cousin marriage.
    b.person('bohumil_dvorak', {
        first: 'Bohumil', last: 'Dvořák', gender: 'male',
        birth: '1903-08-15', birthPlace: 'Kolín', death: '1971', deathPlace: 'Kutná Hora',
        notes: 'Učitel obecné školy.', photo: true,
    });
    // Ružena is Bohumil's sister; her daughter Vlasta marries Bohumil's son
    // Karel — a FIRST-cousin marriage, so the pedigree collapse is a single
    // shared grandparent couple (Josef × Terezie) that routes compactly.
    b.person('ruzena_mala', {
        first: 'Růžena', last: 'Dvořáková', gender: 'female',
        birth: '1908-05-06', birthPlace: 'Kolín', death: '1986', deathPlace: 'Praha',
    });
    b.kids(uJosef1, ['bohumil_dvorak', 'ruzena_mala']);
    b.event('bohumil_dvorak', {
        type: 'baptism', date: '1903-08-16', place: 'Kolín', sourceIds: ['src_kh_matrika_n'],
        participants: [
            { role: 'godparent', personId: 'frantisek_dvorak', note: 'strýc' },
            { role: 'godparent', name: 'Josefína Kadlecová', note: 'kmotra, sousedka' },
        ],
    });
    b.event('bohumil_dvorak', { type: 'occupation', note: 'učitel', date: '~1928', place: 'Kutná Hora' });

    // Ludmila & Jan (Josef x Františka).
    b.person('ludmila_dvorakova', {
        first: 'Ludmila', last: 'Dvořáková', gender: 'female',
        birth: '1916-11-04', birthPlace: 'Kutná Hora', death: '2001', deathPlace: 'Praha',
        question: 'Kdo byl otcem jejího syna Zdeňka?',
        notes: 'Syna Zdeňka vychovala sama.',
    });
    b.person('jan_dvorak', {
        first: 'Jan', last: 'Dvořák', gender: 'male',
        birth: '1919-05-28', birthPlace: 'Kutná Hora', death: '1944-08-02', deathPlace: 'Wien',
        notes: 'Padl za druhé světové války, svobodný a bezdětný.',
        isDeceased: true,
    });
    // Vera is Josef's daughter from his second marriage (half-sister of Bohumil),
    // kept OFF the pedigree-collapse bus so that collapse stays compact.
    b.person('vera_bendova', {
        first: 'Věra', last: 'Dvořáková', gender: 'female',
        birth: '1924-12-01', birthPlace: 'Kutná Hora', death: '2019', deathPlace: 'Litomyšl',
    });
    b.kids(uJosef2, ['ludmila_dvorakova', 'jan_dvorak', 'vera_bendova']);
    b.event('jan_dvorak', { type: 'military', date: '1941..1944', note: 'totálně nasazen' });

    // Anezka & Vojtech (Frantisek x Barbora), Wien.
    b.person('anezka_dvorakova', {
        first: 'Anežka', last: 'Dvořáková', gender: 'female',
        birth: '1908-02-11', birthPlace: 'Wien', death: '1988', deathPlace: 'Praha',
        photo: true,
    });
    b.person('vojtech_dvorak', {
        first: 'Vojtěch', last: 'Dvořák', gender: 'male',
        birth: '1911-06-25', birthPlace: 'Wien', death: '1994', deathPlace: 'Wien',
        notes: 'Manželství zůstalo bezdětné.',
    });
    b.kids(uFrantisek, ['anezka_dvorakova', 'vojtech_dvorak']);

    // Anezka -> Malý (Wien cousin branch, no loop).
    b.person('rudolf_maly', {
        first: 'Rudolf', last: 'Malý', gender: 'male',
        birth: '1905-03-19', birthPlace: 'Tábor', death: '1979', deathPlace: 'Praha',
        notes: 'Krejčí.',
    });
    const uAnezka = b.marry('rudolf_maly', 'anezka_dvorakova', {
        start: '1930-05-24', startPlace: 'Wien', sourceIds: ['src_wien_meldezettel'],
    });
    b.event('rudolf_maly', { type: 'occupation', note: 'krejčí', date: '~1932', place: 'Praha' });
    b.person('marie_mala', {
        first: 'Marie', last: 'Malá', gender: 'female',
        birth: '1934-09-12', birthPlace: 'Wien', death: '2011', deathPlace: 'Praha',
    });
    b.kids(uAnezka, ['marie_mala']);

    // Vojtech -> childless couple (Hedvika from Dresden).
    b.person('hedvika_dvorakova', {
        first: 'Hedvika', last: 'Richterová', gender: 'female',
        birth: '1915-07-08', birthPlace: 'Dresden', death: '1998', deathPlace: 'Wien',
        nameVariants: ['Richter'],
    });
    b.marry('vojtech_dvorak', 'hedvika_dvorakova', {
        start: '1938-04-16', startPlace: 'Dresden', note: 'Bez potomků.',
    });

    // Novák children.
    b.person('rudolf_novak', {
        first: 'Rudolf', last: 'Novák', gender: 'male',
        birth: '1910-01-30', birthPlace: 'Kladno', death: '1988', deathPlace: 'Kladno',
        notes: 'Horník, po otci.', photo: true,
    });
    b.person('helena_novakova', {
        first: 'Helena', last: 'Nováková', gender: 'female',
        birth: '1913-10-14', birthPlace: 'Kladno', death: '1999', deathPlace: 'Praha',
    });
    b.kids(uMarie, ['rudolf_novak', 'helena_novakova']);

    b.person('alzbeta_novakova', {
        first: 'Alžběta', last: 'Konečná', gender: 'female',
        birth: '1914-06-03', birthPlace: 'Kladno', death: '2003', deathPlace: 'Kladno',
    });
    const uRudolfN = b.marry('rudolf_novak', 'alzbeta_novakova', {
        start: '1935-07-13', startPlace: 'Kladno',
    });
    b.event('rudolf_novak', { type: 'occupation', note: 'horník', date: '~1935', place: 'Kladno' });

    b.person('josef_prochazka', {
        first: 'Josef', last: 'Procházka', gender: 'male',
        birth: '1911-09-09', birthPlace: 'Praha', death: '1985', deathPlace: 'Praha',
    });
    const uHelena = b.marry('josef_prochazka', 'helena_novakova', {
        start: '1936-08-30', startPlace: 'Praha',
    });

    // ===== Generation 3: the cousin marriage + focus parents =====
    b.person('josefina_dvorakova', {
        first: 'Josefína', last: 'Pokorná', gender: 'female',
        birth: '1907-04-27', birthPlace: 'Poděbrady', death: '1990', deathPlace: 'Kutná Hora',
    });
    const uBohumil = b.marry('bohumil_dvorak', 'josefina_dvorakova', {
        start: '1929-09-07', startPlace: 'Poděbrady',
    });
    b.person('karel_dvorak', {
        first: 'Karel', last: 'Dvořák', gender: 'male',
        birth: '1931-04-18', birthPlace: 'Kutná Hora', death: '2010', deathPlace: 'Kutná Hora',
        notes: 'Strojní inženýr. Manželka Vlasta byla jeho sestřenice z prvního kolena '
            + '(společní prarodiče Josef a Terezie) — v rodokmenu vzniká slučka předků.',
        refn: 'D-1931-04', photo: true, sourceIds: ['src_kronika'],
    });
    b.kids(uBohumil, ['karel_dvorak']);

    b.event('karel_dvorak', {
        type: 'baptism', date: '1931-04-26', place: 'Kutná Hora',
        participants: [
            // Recurring free-text godparent (also appears at Milan Novák's baptism).
            { role: 'godparent', name: 'Václav Kadlec', note: 'kmotr, mistr kovářský' },
            { role: 'godparent', name: 'Marie Kadlecová', note: 'kmotra' },
        ],
    });
    b.event('karel_dvorak', { type: 'occupation', note: 'strojní inženýr', date: '~1958', place: 'Kutná Hora' });
    b.event('karel_dvorak', { type: 'education', note: 'ČVUT Praha', date: '1950..1955', place: 'Praha' });

    // Vlasta = daughter of Ružena (Bohumil's sister) -> first cousin of Karel.
    b.person('alois_maly', {
        first: 'Alois', last: 'Malý', gender: 'male',
        birth: '1904-11-08', birthPlace: 'Tábor', death: '1972', deathPlace: 'Kutná Hora',
    });
    const uRuzena = b.marry('alois_maly', 'ruzena_mala', {
        start: '1931-04-25', startPlace: 'Kolín',
    });
    b.person('vlasta_dvorakova', {
        first: 'Vlasta', last: 'Malá', gender: 'female',
        birth: '1933-08-21', birthPlace: 'Praha', death: '2018', deathPlace: 'Kutná Hora',
        photo: true,
    });
    b.kids(uRuzena, ['vlasta_dvorakova']);

    // The cousin marriage (pedigree collapse).
    const uKarel = b.marry('karel_dvorak', 'vlasta_dvorakova', {
        start: '1957-06-15', startPlace: 'Kutná Hora', primary: true,
        sourceIds: ['src_kronika'],
    });
    b.event('karel_dvorak', {
        type: 'custom', customLabel: 'Svatba', date: '1957-06-15', place: 'Kutná Hora',
        participants: [
            { role: 'witness', personId: 'frantisek_benes', note: 'strýc' },
            { role: 'witness', name: 'Jan Kadlec', note: 'přítel' },
        ],
    });

    // Ludmila -> single mother (single-parent line).
    b.person('zdenek_dvorak', {
        first: 'Zdeněk', last: 'Dvořák', gender: 'male',
        birth: '1940-03-11', birthPlace: 'Kutná Hora',
        notes: 'Vychován matkou Ludmilou; otec neznámý.', isDeceased: true,
    });
    b.singleKids('ludmila_dvorakova', ['zdenek_dvorak']);

    // Vera -> Beneš (cousins to the focus family).
    b.person('frantisek_benes', {
        first: 'František', last: 'Beneš', gender: 'male',
        birth: '1932-02-28', birthPlace: 'Litomyšl', death: '2005', deathPlace: 'Litomyšl',
    });
    const uVera = b.marry('frantisek_benes', 'vera_bendova', {
        start: '1956-05-19', startPlace: 'Kutná Hora',
    });

    // Novák G3.
    b.person('milan_novak', {
        first: 'Milan', last: 'Novák', gender: 'male',
        birth: '1938-07-07', birthPlace: 'Kladno', death: '2016', deathPlace: 'Kladno',
        photo: true,
    });
    b.person('jana_kralova', {
        first: 'Jana', last: 'Nováková', gender: 'female',
        birth: '1941-11-19', birthPlace: 'Kladno', death: '2022', deathPlace: 'Praha',
        photo: true,
    });
    b.kids(uRudolfN, ['milan_novak', 'jana_kralova']);
    b.event('milan_novak', {
        type: 'baptism', date: '1938-07-17', place: 'Kladno',
        participants: [
            // Same free-text godparent as at Karel's baptism -> recurring-godparent lead.
            { role: 'godparent', name: 'Václav Kadlec', note: 'kmotr' },
            { role: 'godparent', name: 'Anna Konečná', note: 'teta' },
        ],
    });

    b.person('dana_prochazkova', {
        first: 'Dana', last: 'Procházková', gender: 'female',
        birth: '1945-04-02', birthPlace: 'Praha', death: '2020', deathPlace: 'Praha',
    });
    b.kids(uHelena, ['dana_prochazkova']);

    // ===== Generation 4: focus generation =====
    // Pavel: MULTI-MARRIAGE CHAIN #2 (divorce + remarriage) + STEP child.
    b.person('pavel_dvorak', {
        first: 'Pavel', last: 'Dvořák', gender: 'male',
        birth: '1958-10-12', birthPlace: 'Kutná Hora',
        notes: 'Lékař. Z prvního manželství dvě děti, podruhé ženatý od 1998.',
        isDeceased: false, photo: true,
    });
    b.person('eva_pokorna', {
        first: 'Eva', last: 'Dvořáková', gender: 'female',
        birth: '1961-03-08', birthPlace: 'Kutná Hora',
        notes: 'Ovdověla 2003, znovu se provdala 2007.', photo: true,
    });
    b.person('tomas_dvorak', {
        first: 'Tomáš', last: 'Dvořák', gender: 'male',
        birth: '1965-01-27', birthPlace: 'Kutná Hora',
        notes: 'S manželkou Radkou vzali do pěstounské péče Sáru.', photo: true,
    });
    b.kids(uKarel, ['pavel_dvorak', 'eva_pokorna', 'tomas_dvorak']);

    // Pavel union 1 (divorced).
    b.person('jarmila_bartova', {
        first: 'Jarmila', last: 'Bartová', gender: 'female',
        birth: '1960-06-14', birthPlace: 'Kolín',
    });
    const uPavel1 = b.marry('pavel_dvorak', 'jarmila_bartova', {
        status: 'divorced', start: '1982-07-03', startPlace: 'Kolín', end: '1995',
    });
    b.person('petra_sedlackova', {
        first: 'Petra', last: 'Dvořáková', gender: 'female',
        birth: '1984-05-09', birthPlace: 'Kutná Hora', photo: true,
    });
    b.person('ondrej_dvorak', {
        first: 'Ondřej', last: 'Dvořák', gender: 'male',
        birth: '1987-09-21', birthPlace: 'Kutná Hora',
    });
    b.kids(uPavel1, ['petra_sedlackova', 'ondrej_dvorak']);

    // Pavel union 2 (remarriage). Lenka has a son from before (step child for Pavel).
    b.person('lenka_dvorakova', {
        first: 'Lenka', last: 'Urbanová', gender: 'female',
        birth: '1968-02-16', birthPlace: 'Praha',
    });
    // Filip is Lenka's son from before; his biological father is not in the tree.
    // Pavel is his STEP-father, so Filip's two parents are Lenka (biological)
    // and Pavel (step) — a 2-parent step model, no third parent.
    b.person('filip_urban', {
        first: 'Filip', last: 'Urban', gender: 'male',
        birth: '1992-11-30', birthPlace: 'Praha',
        notes: 'Lenčin syn z dřívějška; Pavel je jeho nevlastní otec.',
    });
    b.persons['filip_urban'].parentIds = ['lenka_dvorakova', 'pavel_dvorak'];
    b.persons['lenka_dvorakova'].childIds.push('filip_urban');
    b.persons['pavel_dvorak'].childIds.push('filip_urban');
    b.persons['filip_urban'].parentRelTypes = { pavel_dvorak: 'step' };

    const uPavel2 = b.marry('pavel_dvorak', 'lenka_dvorakova', {
        start: '1998-08-15', startPlace: 'Praha', primary: true,
    });
    b.person('klara_dvorakova', {
        first: 'Klára', last: 'Dvořáková', gender: 'female',
        birth: '2000-12-05', birthPlace: 'Praha', photo: true,
    });
    b.kids(uPavel2, ['klara_dvorakova']);

    // Eva: WIDOW REMARRIAGE. Union 1 (husband dies), union 2 (childless).
    b.person('stanislav_pokorny', {
        first: 'Stanislav', last: 'Pokorný', gender: 'male',
        birth: '1958-04-22', birthPlace: 'Tábor', death: '2003-10-17', deathPlace: 'Praha',
        isDeceased: true,
    });
    const uEva1 = b.marry('stanislav_pokorny', 'eva_pokorna', {
        start: '1984-06-23', startPlace: 'Kutná Hora',
    });
    b.person('adam_pokorny', {
        first: 'Adam', last: 'Pokorný', gender: 'male',
        birth: '1986-08-14', birthPlace: 'Kutná Hora',
    });
    b.kids(uEva1, ['adam_pokorny']);
    b.person('jiri_zeman', {
        first: 'Jiří', last: 'Zeman', gender: 'male',
        birth: '1959-05-30', birthPlace: 'Praha',
    });
    b.marry('jiri_zeman', 'eva_pokorna', {
        start: '2007-09-08', startPlace: 'Praha', note: 'Druhý sňatek Evy, bez společných dětí.',
    });

    // Tomas: FOSTER child + biological child.
    b.person('radka_dvorakova', {
        first: 'Radka', last: 'Novotná', gender: 'female',
        birth: '1967-07-11', birthPlace: 'Písek',
    });
    const uTomas = b.marry('tomas_dvorak', 'radka_dvorakova', {
        start: '1990-09-15', startPlace: 'Písek', primary: true,
    });
    b.person('viktor_dvorak', {
        first: 'Viktor', last: 'Dvořák', gender: 'male',
        birth: '1993-03-24', birthPlace: 'Kutná Hora',
    });
    b.person('sara_foster', {
        first: 'Sára', last: 'Dvořáková', gender: 'female',
        birth: '2005-06-19', birthPlace: 'Praha',
        notes: 'V pěstounské péči Tomáše a Radky od roku 2010.',
    });
    b.kids(uTomas, ['viktor_dvorak']);
    b.kids(uTomas, ['sara_foster'], 'foster');

    // ADOPTION: Jana (Nováková) + Oldřich adopt Martin.
    b.person('oldrich_kral', {
        first: 'Oldřich', last: 'Král', gender: 'male',
        birth: '1939-12-24', birthPlace: 'Praha', death: '2015', deathPlace: 'Praha',
    });
    const uJana = b.marry('oldrich_kral', 'jana_kralova', {
        start: '1963-05-11', startPlace: 'Kladno',
    });
    b.person('martin_kral', {
        first: 'Martin', last: 'Král', gender: 'male',
        birth: '1970-02-08', birthPlace: 'Praha',
        notes: 'Osvojen roku 1971.',
    });
    b.kids(uJana, ['martin_kral'], 'adoptive');

    // Milan (Novák) -> son Jiří.
    b.person('bozena_novakova', {
        first: 'Božena', last: 'Mašková', gender: 'female',
        birth: '1940-10-06', birthPlace: 'Kladno', death: '2018', deathPlace: 'Kladno',
    });
    const uMilan = b.marry('milan_novak', 'bozena_novakova', {
        start: '1963-08-24', startPlace: 'Kladno',
    });
    b.person('jiri_novak', {
        first: 'Jiří', last: 'Novák', gender: 'male',
        birth: '1966-04-15', birthPlace: 'Kladno',
    });
    b.kids(uMilan, ['jiri_novak']);

    // Zdenek (single-mother line) -> daughter Lucie.
    b.person('marie_horackova', {
        first: 'Marie', last: 'Horáčková', gender: 'female',
        birth: '1943-01-17', birthPlace: 'Havlíčkův Brod',
        isDeceased: false,
    });
    const uZdenek = b.marry('zdenek_dvorak', 'marie_horackova', {
        start: '1965-10-02', startPlace: 'Havlíčkův Brod',
    });
    b.person('lucie_dvorakova', {
        first: 'Lucie', last: 'Dvořáková', gender: 'female',
        birth: '1968-12-28', birthPlace: 'Kutná Hora',
    });
    b.kids(uZdenek, ['lucie_dvorakova']);

    // Dana (Procházka cousin branch) -> child with an unknown partner (PLACEHOLDER #1).
    b.person('ph_dana_partner', { first: '?', last: '', gender: 'male', placeholder: true });
    const uDana = b.marry('ph_dana_partner', 'dana_prochazkova', { status: 'partners' });
    b.person('petr_prochazka', {
        first: 'Petr', last: 'Procházka', gender: 'male',
        birth: '1968-07-30', birthPlace: 'Praha',
        notes: 'Otec neznámý.',
    });
    b.kids(uDana, ['petr_prochazka']);

    // Lucie (Zdeněk's line) -> child with an unknown partner (PLACEHOLDER #2).
    b.person('ph_lucie_partner', { first: '?', last: '', gender: 'male', placeholder: true });
    const uLucie = b.marry('ph_lucie_partner', 'lucie_dvorakova', { status: 'partners' });
    b.person('nela_dvorakova', {
        first: 'Nela', last: 'Dvořáková', gender: 'female',
        birth: '1996-02-14', birthPlace: 'Kutná Hora',
    });
    b.kids(uLucie, ['nela_dvorakova']);

    // ===== Generation 5+: youngest, reaching the present =====
    b.person('marek_sedlacek', {
        first: 'Marek', last: 'Sedláček', gender: 'male',
        birth: '1982-03-05', birthPlace: 'Nymburk',
    });
    const uPetra = b.marry('marek_sedlacek', 'petra_sedlackova', {
        start: '2010-06-12', startPlace: 'Kutná Hora',
    });
    b.person('eliska_sedlackova', {
        first: 'Eliška', last: 'Sedláčková', gender: 'female',
        birth: '2012-09-14', birthPlace: 'Kutná Hora',
    });
    b.person('vojtech_sedlacek', {
        first: 'Vojtěch', last: 'Sedláček', gender: 'male',
        birth: '2015-05-20', birthPlace: 'Kutná Hora',
    });
    b.kids(uPetra, ['eliska_sedlackova', 'vojtech_sedlacek']);

    // Viktor (Tomáš's biological son) -> young family.
    b.person('nikola_dvorakova', {
        first: 'Nikola', last: 'Marková', gender: 'female',
        birth: '1995-08-03', birthPlace: 'Písek',
    });
    const uViktor = b.marry('viktor_dvorak', 'nikola_dvorakova', {
        start: '2019-06-08', startPlace: 'Písek',
    });
    b.person('matej_dvorak', {
        first: 'Matěj', last: 'Dvořák', gender: 'male',
        birth: '2021-04-11', birthPlace: 'Kutná Hora',
    });
    b.kids(uViktor, ['matej_dvorak']);

    // Adam (Eva's son) -> partner + child.
    b.person('tereza_pokorna', {
        first: 'Tereza', last: 'Dvořáková', gender: 'female',
        birth: '1988-10-19', birthPlace: 'Tábor',
    });
    const uAdam = b.marry('adam_pokorny', 'tereza_pokorna', {
        start: '2013-05-25', startPlace: 'Tábor',
    });
    b.person('vojtech_pokorny', {
        first: 'Vojtěch', last: 'Pokorný', gender: 'male',
        birth: '2016-01-09', birthPlace: 'Praha',
    });
    b.kids(uAdam, ['vojtech_pokorny']);

    // Jiří (Novák branch) -> partner + child.
    b.person('katerina_novakova', {
        first: 'Kateřina', last: 'Dostálová', gender: 'female',
        birth: '1969-03-14', birthPlace: 'Kladno',
    });
    const uJiriN = b.marry('jiri_novak', 'katerina_novakova', {
        start: '1994-09-17', startPlace: 'Kladno',
    });
    b.person('lucie_novakova', {
        first: 'Lucie', last: 'Nováková', gender: 'female',
        birth: '1997-06-22', birthPlace: 'Kladno',
    });
    b.kids(uJiriN, ['lucie_novakova']);

    return b;
}

// ---------------------------------------------------------------------------
// Assemble StromData, preserving image bytes from an existing committed file.
// ---------------------------------------------------------------------------

function usedPlaceKeys(b: Builder): Set<string> {
    const keys = new Set<string>();
    const add = (v?: string) => { if (v) keys.add(placeKey(v)); };
    for (const p of Object.values(b.persons)) {
        add(p.birthPlace); add(p.deathPlace);
        for (const ev of p.events ?? []) add(ev.place);
    }
    for (const u of Object.values(b.partnerships)) add(u.startPlace);
    return keys;
}

function buildData(b: Builder): StromData {
    const places: Record<string, PlaceGeo> = {};
    const used = usedPlaceKeys(b);
    for (const [name, geo] of Object.entries(PLACES)) {
        // Only emit registry entries for places the tree actually uses.
        if (used.has(placeKey(name))) {
            places[placeKey(name)] = { lat: geo.lat, lon: geo.lon, label: name };
        }
    }
    return {
        version: 5,
        persons: b.persons,
        partnerships: b.partnerships,
        sources: SOURCES,
        places,
        surnameVariants: [
            ['Dvořák', 'Dworschak', 'Dvorzak'],
            ['Novák', 'Nowak'],
        ],
        defaultPersonId: 'pavel_dvorak',
    };
}

/** Copy photo bytes and attachment payloads from a previously committed file. */
function preserveImages(data: StromData, outPath: string): void {
    if (!existsSync(outPath)) return;
    let prev: StromData;
    try {
        prev = JSON.parse(readFileSync(outPath, 'utf-8')) as StromData;
    } catch {
        return;
    }
    for (const [id, person] of Object.entries(data.persons)) {
        const old = prev.persons?.[id];
        if (old?.photo) person.photo = old.photo;
        for (const att of person.attachments ?? []) {
            const oldAtt = old?.attachments?.find(a => a.id === att.id);
            if (oldAtt?.dataUrl) { att.dataUrl = oldAtt.dataUrl; att.sizeBytes = oldAtt.sizeBytes; }
        }
    }
}

function main(): void {
    const b = buildDemo();
    const data = buildData(b);
    const outPath = join(process.cwd(), 'test', 'devel-demo.json');
    preserveImages(data, outPath);

    const nPersons = Object.keys(data.persons).length;
    const nUnions = Object.keys(data.partnerships).length;
    const nPhotos = Object.values(data.persons).filter(p => p.photo).length;
    const nPhotoSlots = Object.values(data.persons).filter(p => p.photoOriginalName).length;

    writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`devel-demo.json  (${nPersons} persons, ${nUnions} unions, `
        + `${nPhotos}/${nPhotoSlots} photos filled)`);
}

main();

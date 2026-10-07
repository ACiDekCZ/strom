/**
 * The bundled sample tree for onboarding: one made-up family, the Bergs, for
 * every language. It is there to show what a tree can hold, so it is built
 * from the cases real research runs into rather than from history:
 *
 * - dates as registers give them: exact, a month, "about", "before", "after",
 *   a range of years;
 * - a widower's second marriage (half-siblings), a divorce, partners who separated, partners
 *   who never married, an adopted daughter, twins, a child of an unnamed
 *   father ("?"), an infant death;
 * - events with godparents and witnesses, the cause of death, the age as the
 *   record writes it (Johan's death record says 75 — the dates say 74), the
 *   farm or house of a birth, a death or a wedding;
 * - register entries with a transcript and a crop of the page, spellings of
 *   the name (Bergh, John Berg), a family-book story, an open question;
 * - an emigration from Norway to America and a great-grandson moving back,
 *   so the map and the timeline have a journey to draw; living people, so the
 *   privacy options have someone to hide.
 *
 * Names and places read the same in every language; the words around them
 * (occupations, causes, notes, the story) come from strings.ts in the current
 * language, the transcripts are the records' own words. Place coordinates
 * ship with the tree, so the map works offline the moment it loads.
 *
 * Pictures are not shipped: a DemoImageMaker (src/demo-images.ts) draws the
 * register pages, the crops and the portraits when the sample loads. Without
 * one (tests, no canvas) the tree is the same, just without them.
 */

import {
    StromData, Person, Partnership, PersonId, PartnershipId, Gender, PlaceGeo, Source, LifeEvent,
    EventParticipant, toPersonId, toPartnershipId, STROM_DATA_VERSION,
} from './types.js';
import { strings } from './strings.js';
import { localAge } from './recorded-age.js';
import { placeKey } from './places.js';
import { CardFieldSettings, DEFAULT_CARD_FIELDS } from './card-fields.js';

/** A drawn register entry: the page it sits on and the crop of the entry. */
export interface DemoEntryImage {
    page: { dataUrl: string; width: number; height: number; sizeBytes: number };
    excerpt: { dataUrl: string; width: number; height: number; sizeBytes: number };
    /** Where the crop lies on the page, fractions 0–1 from the top left. */
    region: { x: number; y: number; w: number; h: number };
}

/** Draws the sample's pictures when it loads (see src/demo-images.ts). */
export interface DemoImageMaker {
    /** A register page with the entry written in one of its rows. */
    entry(text: string, seed: number): DemoEntryImage | undefined;
    /** An old-photo portrait stand-in (a square JPEG data URL). */
    portrait(seed: number, gender: Gender): string | undefined;
}

/** The places the family lived in, with their coordinates. */
const PLACES: Record<string, PlaceGeo> = {
    'Voss': { lat: 60.6286, lon: 6.4166, label: 'Voss, Vestland, Norge' },
    'Bergen': { lat: 60.3913, lon: 5.3221, label: 'Bergen, Vestland, Norge' },
    'Oslo': { lat: 59.9139, lon: 10.7522, label: 'Oslo, Norge' },
    'Lyon': { lat: 45.764, lon: 4.8357, label: 'Lyon, Auvergne-Rhône-Alpes, France' },
    'New York': { lat: 40.7128, lon: -74.006, label: 'New York, United States' },
    'Chicago': { lat: 41.8781, lon: -87.6298, label: 'Chicago, Illinois, United States' },
    'Minneapolis': { lat: 44.9778, lon: -93.265, label: 'Minneapolis, Minnesota, United States' },
    'Seattle': { lat: 47.6062, lon: -122.3321, label: 'Seattle, Washington, United States' },
};

type EventInput = Omit<LifeEvent, 'id' | 'participants'> & {
    participants?: Omit<EventParticipant, 'id'>[];
};

type PersonOpts = Partial<Omit<Person, 'id' | 'firstName' | 'lastName' | 'gender' | 'events'>> & {
    events?: EventInput[];
};

type UnionOpts = Partial<Omit<Partnership, 'id' | 'person1Id' | 'person2Id' | 'childIds' | 'participants'>> & {
    participants?: Omit<EventParticipant, 'id'>[];
};

/** Deterministic builder: stable ids, no Date.now / Math.random. */
class DemoFamily {
    readonly persons: Record<PersonId, Person> = {};
    readonly partnerships: Record<PartnershipId, Partnership> = {};
    readonly sources: Record<string, Source> = {};
    private seq = 0;

    private next(prefix: string): string {
        return `demo_${prefix}${++this.seq}`;
    }

    private participants(list: Omit<EventParticipant, 'id'>[] | undefined): EventParticipant[] | undefined {
        return list?.map(p => ({ id: this.next('pt'), ...p }));
    }

    person(key: string, firstName: string, lastName: string, gender: Gender, opts: PersonOpts = {}): PersonId {
        const id = toPersonId(`demo_${key}`);
        const { events, ...rest } = opts;
        this.persons[id] = {
            id, firstName, lastName, gender, isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [],
            ...rest,
            ...(events ? {
                events: events.map(({ participants, ...e }) => ({
                    id: this.next('ev'), ...e,
                    ...(participants ? { participants: this.participants(participants) } : {}),
                })),
            } : {}),
        };
        return id;
    }

    /** A parent the record does not name: the app's "?" stand-in. */
    unknown(key: string, gender: Gender): PersonId {
        const id = toPersonId(`demo_${key}`);
        this.persons[id] = {
            id, firstName: '?', lastName: '', gender, isPlaceholder: true,
            partnerships: [], parentIds: [], childIds: [],
        };
        return id;
    }

    /** A couple; the man is person1 (drawn left), as elsewhere. */
    union(a: PersonId, b: PersonId, opts: UnionOpts = {}): PartnershipId {
        const [p1, p2] = this.persons[a].gender === 'female' && this.persons[b].gender === 'male' ? [b, a] : [a, b];
        const id = toPartnershipId(`demo_u_${p1.slice(5)}_${p2.slice(5)}`);
        const { participants, ...rest } = opts;
        this.partnerships[id] = {
            id, person1Id: p1, person2Id: p2, childIds: [], status: 'married', ...rest,
            ...(participants ? { participants: this.participants(participants) } : {}),
        };
        this.persons[p1].partnerships.push(id);
        this.persons[p2].partnerships.push(id);
        return id;
    }

    kids(union: PartnershipId, ...children: PersonId[]): void {
        const u = this.partnerships[union];
        for (const c of children) {
            u.childIds.push(c);
            this.persons[c].parentIds = [u.person1Id, u.person2Id];
            for (const parent of [u.person1Id, u.person2Id]) {
                if (!this.persons[parent].childIds.includes(c)) this.persons[parent].childIds.push(c);
            }
        }
    }

    source(key: string, source: Omit<Source, 'id'>): string {
        const id = `demo_src_${key}`;
        this.sources[id] = { id, ...source };
        return id;
    }

    build(): StromData {
        const places: Record<string, PlaceGeo> = {};
        for (const [name, geo] of Object.entries(PLACES)) places[placeKey(name)] = geo;
        return {
            version: STROM_DATA_VERSION,
            persons: this.persons,
            partnerships: this.partnerships,
            sources: this.sources,
            places,
            surnameVariants: [['Berg', 'Bergh']],
        };
    }
}

/**
 * The card the sample opens with when the user has not chosen one: a custom
 * card of five lines with the cause of death, in the default appearance — the
 * tree has the details to fill it, and it shows at first sight what a card can
 * carry.
 */
export const DEMO_CARD_FIELDS: CardFieldSettings = {
    ...DEFAULT_CARD_FIELDS,
    on: ['birth', 'baptism', 'death', 'occupation', 'marriage'],
    cause: true,
};

/** The person the sample opens on: Johan, the emigrant, with three generations around him. */
export const DEMO_FOCUS = toPersonId('demo_johan');

/** A fresh copy of the sample tree, its words in the current UI language. */
export function getDemoTree(images?: DemoImageMaker): StromData {
    const t = strings.demo.data;
    const age = localAge;
    const f = new DemoFamily();
    const photo = (seed: number, gender: Gender): Partial<Person> => {
        const url = images?.portrait(seed, gender);
        return url ? { photo: url } : {};
    };
    const job = (note: string, date?: string, place?: string): EventInput =>
        ({ type: 'occupation', note, ...(date ? { date } : {}), ...(place ? { place } : {}) });

    // ---- Register entries (their transcripts are the records' own words) ----
    const baptismText = 'Johannes. Forældre: Gaardmand Peder Bergh og Hustru Maria Lind, Nedre Berg. '
        + 'Født 14de Marts. Faddere: Ole Dahl, Kari Strand.';
    const marriageText = 'Ungkarl Johannes Pedersen Bergh, 25 Aar, og Pige Ida Strand, 20 Aar, Øvre Strand. '
        + 'Forlovere: Peder Bergh, Nils Holm.';
    const deathText = 'John Berg, carpenter, age 75, born Norway. Died November 2, 1899, '
        + 'at 1412 Cedar Avenue. Cause: pneumonia.';
    const baptismImage = images?.entry(baptismText, 1);
    const marriageImage = images?.entry(marriageText, 2);
    const deathImage = images?.entry(deathText, 3);
    const excerpt = (key: string, img: DemoEntryImage | undefined, fromPage?: string) => img ? {
        excerpts: [{
            id: `demo_exc_${key}`, dataUrl: img.excerpt.dataUrl,
            width: img.excerpt.width, height: img.excerpt.height, sizeBytes: img.excerpt.sizeBytes,
            caption: t.excerptCaption,
            ...(fromPage ? { fromAttachmentId: fromPage, region: img.region } : {}),
        }],
    } : {};
    const baptismPage = baptismImage ? 'demo_att_baptism' : undefined;

    const srcBaptism = f.source('baptism', {
        title: t.srcBaptism('Johan Berg'), repository: 'Statsarkivet i Bergen',
        reference: 'Voss, Ministerialbok 1820–1835, s. 112', recordDate: '1825-03-20', quality: 3,
        transcript: baptismText, ...excerpt('baptism', baptismImage, baptismPage),
    });
    const srcMarriage = f.source('marriage', {
        title: t.srcMarriage('Johan Berg', 'Ida Strand'), repository: 'Statsarkivet i Bergen',
        reference: 'Voss, Ministerialbok 1845–1860, s. 203', recordDate: '1850-06-02', quality: 3,
        transcript: marriageText, ...excerpt('marriage', marriageImage),
    });
    const srcEmigrants = f.source('emigrants', {
        title: t.srcEmigrants('Bergen', 1868), repository: 'Bergen Byarkiv',
        reference: 'Emigrantprotokoll 1867–1869, nr. 1142', recordDate: '1868-04-22', quality: 2,
        transcript: 'Johan Bergh, Gaardmand, 43 Aar, Voss — med Hustru og 2 Børn. Bestemmelsessted: New York. Skib: Hero.',
    });
    const srcDeath = f.source('death', {
        title: t.srcDeath('John Berg'), repository: 'Hennepin County Library',
        reference: 'Death records 1899, no. 2241', recordDate: '1899-11-03', quality: 3,
        transcript: deathText, ...excerpt('death', deathImage),
    });
    const srcCensus = f.source('census', {
        title: t.srcCensus('Minneapolis', 1900), repository: 'U.S. National Archives',
        reference: 'Hennepin County, Ward 6, sheet 12', recordDate: '1900-06-05', quality: 2,
        transcript: 'Berg, Erik — head, 48, carpenter, b. Norway, imm. 1868. Rosa — wife, 37. Leo — son, 11.',
    });

    // ---- Voss, Norway: the oldest generation ----
    const peter = f.person('peter', 'Peter', 'Berg', 'male', {
        birthDate: '~1798', birthPlace: 'Voss',
        deathDate: '1861-01-17', deathPlace: 'Voss', deathCause: t.causeOldAge, deathAge: age('63y'),
        events: [job(t.farmer, undefined, 'Voss')],
    });
    const maria = f.person('maria', 'Maria', 'Lind', 'female', {
        birthDate: '1802..1804', birthPlace: 'Voss', deathDate: '<1850', deathPlace: 'Voss',
    });
    const uPeterMaria = f.union(peter, maria, { startDate: '1823', startPlace: 'Voss' });
    const kari = f.person('kari', 'Kari', 'Strand', 'female', {
        birthDate: '~1805', birthPlace: 'Voss', deathDate: '1871-02-09', deathPlace: 'Voss',
    });
    const idaFather = f.unknown('ida_father', 'male');
    const uKari = f.union(idaFather, kari, { status: 'partners' });

    // ---- Johan and Ida, who left for America ----
    const johan = f.person('johan', 'Johan', 'Berg', 'male', {
        birthDate: '1825-03-14', birthPlace: 'Voss', birthAddress: 'Nedre Berg', birthSourceIds: [srcBaptism],
        deathDate: '1899-11-02', deathPlace: 'Minneapolis', deathCause: t.causePneumonia, deathAge: age('75y'),
        deathAddress: '1412 Cedar Avenue', deathSourceIds: [srcDeath],
        notes: t.johanNote, nameVariants: ['Johannes Bergh', 'John Berg'],
        story: { status: 'final', title: t.johanStoryTitle, text: t.johanStory, note: t.johanStoryNote },
        events: [
            {
                type: 'baptism', date: '1825-03-20', place: 'Voss', sourceIds: [srcBaptism],
                participants: [
                    { role: 'godparent', name: 'Ole Dahl', note: t.noteNeighbour },
                    { role: 'godparent', personId: kari },
                ],
            },
            { type: 'confirmation', date: '1840-10-04', place: 'Voss' },
            job(t.farmer, '1850..1868', 'Voss'),
            { type: 'emigration', date: '1868-04-24', place: 'Bergen', note: t.emigrationNote, sourceIds: [srcEmigrants] },
            { type: 'immigration', date: '1868-05-30', place: 'New York' },
            job(t.carpenter, '1869..1899', 'Minneapolis'),
            { type: 'naturalization', date: '1874', place: 'Minneapolis' },
            { type: 'burial', date: '1899-11-05', place: 'Minneapolis' },
        ],
        ...(baptismImage && baptismPage ? {
            attachments: [{
                id: baptismPage, name: t.pageName('Voss', 112), mimeType: 'image/jpeg',
                dataUrl: baptismImage.page.dataUrl, sizeBytes: baptismImage.page.sizeBytes, sourceId: srcBaptism,
            }],
        } : {}),
    });
    // Karl stayed behind and moved to the coast.
    const karl = f.person('karl', 'Karl', 'Berg', 'male', {
        birthDate: '1829-05', birthPlace: 'Voss', deathDate: '1915', deathPlace: 'Bergen',
        events: [job(t.fisherman, '1855..1910', 'Bergen'), { type: 'residence', date: '1855', place: 'Bergen' }],
    });
    f.kids(uPeterMaria, johan, karl);
    const ida = f.person('ida', 'Ida', 'Strand', 'female', {
        birthDate: '~1830', birthPlace: 'Voss',
        deathDate: '1905-03-30', deathPlace: 'Minneapolis', deathCause: t.causeStroke,
        events: [{ type: 'emigration', date: '1868-04-24', place: 'Bergen', sourceIds: [srcEmigrants] }],
    });
    f.kids(uKari, ida);
    const uJohanIda = f.union(johan, ida, {
        startDate: '1850-06-02', startPlace: 'Voss', address: 'Øvre Strand', sourceIds: [srcMarriage],
        participants: [
            { role: 'witness', personId: peter },
            { role: 'witness', name: 'Nils Holm', note: t.noteSchoolteacher },
        ],
    });
    f.partnerships[uJohanIda].ages = { [johan]: age('25y'), [ida]: age('20y') };

    // ---- Their children: a son, and twin girls of whom one lived ----
    const erik = f.person('erik', 'Erik', 'Berg', 'male', {
        birthDate: '1851-08-10', birthPlace: 'Voss',
        deathDate: '1923-01-15', deathPlace: 'Minneapolis', deathCause: t.causeHeart,
        events: [
            { type: 'baptism', date: '1851-08-17', place: 'Voss' },
            { type: 'emigration', date: '1868-04-24', place: 'Bergen', sourceIds: [srcEmigrants] },
            job(t.carpenter, '1872..1920', 'Minneapolis'),
            { type: 'residence', date: '1900-06-05', place: 'Minneapolis', sourceIds: [srcCensus] },
        ],
    });
    const hanna = f.person('hanna', 'Hanna', 'Berg', 'female', {
        birthDate: '1855-04-02', birthPlace: 'Voss', deathDate: '1931', deathPlace: 'Minneapolis',
        events: [{ type: 'emigration', date: '1868-04-24', place: 'Bergen', sourceIds: [srcEmigrants] }],
    });
    const clara = f.person('clara', 'Clara', 'Berg', 'female', {
        birthDate: '1855-04-02', birthPlace: 'Voss',
        deathDate: '1855-04-20', deathPlace: 'Voss', deathCause: t.causeWeakness, deathAge: age('18d'),
        notes: t.claraNote, events: [{ type: 'baptism', date: '1855-04-03', place: 'Voss' }],
    });
    f.kids(uJohanIda, erik, hanna, clara);

    // Erik married twice: Laura died after their daughter's birth.
    const laura = f.person('laura', 'Laura', 'Carter', 'female', {
        birthDate: '1856-07-01', birthPlace: 'Chicago',
        deathDate: '1884-02-12', deathPlace: 'Minneapolis', deathCause: t.causeChildbed, deathAge: age('27y'),
    });
    const rosa = f.person('rosa', 'Rosa', 'Rossi', 'female', {
        birthDate: '1862', birthPlace: 'Chicago', deathDate: '1940', deathPlace: 'Minneapolis',
        sourceIds: [srcCensus], events: [job(t.seamstress, undefined, 'Chicago')],
    });
    const uErikLaura = f.union(erik, laura, { startDate: '1878-05-18', startPlace: 'Minneapolis' });
    const uErikRosa = f.union(erik, rosa, { startDate: '1886-09-12', startPlace: 'Chicago' });

    // Hanna and Simon had no children of their own and took in Alma.
    const simon = f.person('simon', 'Simon', 'Lind', 'male', {
        birthDate: '1849', birthPlace: 'Bergen', deathDate: '1920', deathPlace: 'Minneapolis',
        events: [job(t.teacher, undefined, 'Minneapolis')],
    });
    const uHannaSimon = f.union(simon, hanna, { startDate: '1878', startPlace: 'Minneapolis' });

    // ---- Minneapolis ----
    const david = f.person('david', 'David', 'Berg', 'male', {
        birthDate: '1880-03-03', birthPlace: 'Minneapolis',
        deathDate: '1944-06-30', deathPlace: 'Minneapolis', deathCause: t.causeStroke,
        ...photo(1, 'male'),
        events: [
            { type: 'education', date: '1898..1902', place: 'Minneapolis', note: t.educationNote },
            job(t.teacher, '1902..1944', 'Minneapolis'),
            { type: 'military', date: '1918', note: t.militaryNote },
        ],
    });
    const sofia = f.person('sofia', 'Sofia', 'Berg', 'female', {
        birthDate: '1884-02-03', birthPlace: 'Minneapolis', deathDate: '1962', deathPlace: 'Chicago',
    });
    f.kids(uErikLaura, david, sofia);
    const leo = f.person('leo', 'Leo', 'Berg', 'male', {
        birthDate: '1888-11-11', birthPlace: 'Minneapolis', deathDate: '>1950',
        question: t.leoQuestion, sourceIds: [srcCensus],
        events: [job(t.sailor, undefined, 'Seattle'), { type: 'residence', date: '1950', place: 'Seattle' }],
    });
    f.kids(uErikRosa, leo);
    const alma = f.person('alma', 'Alma', 'Lind', 'female', {
        birthDate: '1890-05-05', birthPlace: 'Chicago', deathDate: '1975', deathPlace: 'Minneapolis',
        events: [
            { type: 'adoption', date: '1893', place: 'Minneapolis', note: t.adoptionNote },
            job(t.nurse, undefined, 'Minneapolis'),
        ],
    });
    f.kids(uHannaSimon, alma);
    f.persons[alma].parentRelTypes = { [simon]: 'adoptive', [hanna]: 'adoptive' };

    const emma = f.person('emma', 'Emma', 'Holm', 'female', {
        birthDate: '1883-09-21', birthPlace: 'Chicago', deathDate: '1970-12-01', deathPlace: 'Minneapolis',
        ...photo(2, 'female'),
        events: [job(t.teacher, undefined, 'Minneapolis')],
    });
    const uDavidEmma = f.union(david, emma, {
        startDate: '1905-06-24', startPlace: 'Minneapolis',
        story: { status: 'final', title: t.coupleStoryTitle, text: t.coupleStory },
    });
    const paul = f.person('paul', 'Paul', 'Walker', 'male', {
        birthDate: '1879', birthPlace: 'Chicago', deathDate: '1938', deathPlace: 'Chicago',
    });
    f.union(paul, sofia, {
        status: 'divorced', startDate: '1906', startPlace: 'Minneapolis', endDate: '1921', endPlace: 'Chicago',
    });

    const thomas = f.person('thomas', 'Thomas', 'Berg', 'male', {
        birthDate: '1908-02-14', birthPlace: 'Minneapolis',
        deathDate: '1990-10-03', deathPlace: 'Minneapolis', deathCause: t.causeHeart,
        ...photo(3, 'male'),
        events: [
            job(t.engineer, undefined, 'Minneapolis'),
            { type: 'custom', customLabel: t.goldenWedding, date: '1985-08-17', place: 'Minneapolis' },
            { type: 'cremation', date: '1990-10-10', place: 'Minneapolis' },
        ],
    });
    const claraB = f.person('clara_b', 'Clara', 'Berg', 'female', {
        birthDate: '1911-07-07', birthPlace: 'Minneapolis', deathDate: '2001', deathPlace: 'Minneapolis',
    });
    f.kids(uDavidEmma, thomas, claraB);
    const lena = f.person('lena', 'Lena', 'Moreau', 'female', {
        birthDate: '1912-03-08', birthPlace: 'Lyon', deathDate: '2004', deathPlace: 'Minneapolis',
        events: [{ type: 'immigration', date: '1930', place: 'New York' }],
    });
    const uThomasLena = f.union(thomas, lena, { startDate: '1935-08-17', startPlace: 'Minneapolis' });

    // ---- The living ----
    const martin = f.person('martin', 'Martin', 'Berg', 'male', {
        birthDate: '1940-04-22', birthPlace: 'Minneapolis', deathDate: '2015-09-09', deathPlace: 'Seattle',
        events: [job(t.engineer, undefined, 'Seattle'), { type: 'residence', date: '1965', place: 'Seattle' }],
    });
    const eva = f.person('eva', 'Eva', 'Berg', 'female', {
        birthDate: '1946-12-01', birthPlace: 'Minneapolis', events: [job(t.doctor)],
    });
    f.kids(uThomasLena, martin, eva);
    const sarah = f.person('sarah', 'Sarah', 'Walsh', 'female', { birthDate: '1948', birthPlace: 'Seattle' });
    const uMartinSarah = f.union(martin, sarah, {
        status: 'separated', startDate: '1969', startPlace: 'Seattle', endDate: '1978',
    });
    const jonas = f.person('jonas', 'Jonas', 'Holm', 'male', { birthDate: '1944', birthPlace: 'Oslo' });
    f.union(jonas, eva, { status: 'partners', startDate: '1988' });

    // A great-grandson of the emigrants goes back to Norway.
    const daniel = f.person('daniel', 'Daniel', 'Berg', 'male', {
        birthDate: '1972-05-30', birthPlace: 'Seattle',
        events: [job(t.architect, undefined, 'Oslo'), { type: 'residence', date: '2000', place: 'Oslo' }],
    });
    f.kids(uMartinSarah, daniel);
    const julia = f.person('julia', 'Julia', 'Novak', 'female', { birthDate: '1974-10-12', birthPlace: 'Bergen' });
    const uDanielJulia = f.union(daniel, julia, { startDate: '2001-06-16', startPlace: 'Oslo' });
    const adam = f.person('adam', 'Adam', 'Berg', 'male', { birthDate: '2003-02-11', birthPlace: 'Oslo' });
    const nora = f.person('nora', 'Nora', 'Berg', 'female', { birthDate: '2006-09-05', birthPlace: 'Oslo' });
    f.kids(uDanielJulia, adam, nora);

    return f.build();
}

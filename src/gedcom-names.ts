/**
 * Reading a GEDCOM name (1 NAME + its GIVN / SURN / SPFX / NPFX / NSFX).
 *
 * The rules are shared with the research CLI (strom-research,
 * src/core/people.ts: parseName, noName, notAName, NO_NAME, DESCRIPTIONS and
 * its GEDCOM import), so one file reads the same in both:
 *
 * 1. GIVN and SURN come before the NAME line, which is only how a program
 *    wrote them. A SURN holding a list of surnames (GEDCOM's commas) or a
 *    surname with a prefix (SPFX: van, de) keeps the line's surname; commas
 *    in GIVN read as spaces.
 * 2. Without them the surname is the LAST pair of slashes whose opening slash
 *    stands at the start or after a space: "N/A /Chrpa/" is N/A + Chrpa, and
 *    "/⟨K/Č⟩emenská/" is one surname (a slash inside a word opens nothing).
 * 3. A given name that only says there is none (N/A, N.N., unknown, neznámý,
 *    "?", "—"; compared without case, diacritics and punctuation) is "?".
 * 4. A description in place of a name (stillborn, son, mrtvě narozený,
 *    anything in brackets, and the words of rule 3 — the research's
 *    notAName) is "?" too, and the words go to the person's note as written.
 *    Only a name of bare punctuation ("?") leaves no note.
 *
 * The app keeps its own conventions where the research has none to share:
 * text after the closing slash ("John /Smith/ Jr.") joins the surname, a
 * line without slashes splits at its first space, and a slash inside a name
 * is kept as written (the exporter writes it back and this reader takes it).
 */

/**
 * What a record or another program writes where it has no name (folded): the
 * person's given name is "?".
 *
 * MUST stay identical to NO_NAME in strom-research src/core/people.ts — the
 * research reads the same files and a list that drifts reads one person two
 * ways (pinned by src/__tests__/gedcom-names.test.ts).
 */
export const NO_NAME: readonly string[] = [
    'n a', 'nn', 'n n', 'nomen nescio', 'unknown', 'unnamed', 'no name', 'noname',
    'neznamy', 'neznama', 'nezname', 'nezjisteno', 'bez jmena', 'bezejmenny', 'bezejmenna',
    'unbekannt', 'namenlos', 'ohne namen', 'nieznany', 'nieznana', 'nieznane', 'bez imienia',
    'inconnu', 'inconnue', 'sans nom',
];
const NO_NAME_SET = new Set(NO_NAME);

/**
 * Words that describe a person instead of naming them (folded): stillborn,
 * unbaptised, son. MUST stay identical to DESCRIPTIONS in strom-research
 * src/core/people.ts (pinned by the same test).
 */
export const DESCRIPTIONS: readonly string[] = [
    'nn', 'n n', 'nomen nescio', 'unnamed', 'unknown', 'stillborn', 'still born', 'infant', 'child', 'son', 'daughter',
    'mrtve narozeny', 'mrtve narozena', 'mrtve narozene', 'mrtvy narozen', 'mrtva narozena', 'mrtvorozeny', 'mrtvorozena', 'mrtvorozene',
    'nepokrteny', 'nepokrtena', 'nepokrtene', 'nekrtenec', 'bez jmena', 'neznamy', 'neznama', 'dite', 'syn', 'dcera',
    'totgeboren', 'totgeborenes kind', 'ungetauft', 'namenlos', 'kind', 'sohn', 'tochter',
    'martwo urodzony', 'martwo urodzona', 'martwo urodzone', 'nieochrzczony', 'nieochrzczona', 'dziecko',
    'sans nom', 'mort ne', 'mort nee', 'inconnu', 'inconnue', 'enfant', 'proles', 'infans', 'filius', 'filia',
];
const DESCRIPTION_SET = new Set(DESCRIPTIONS);

/** Lowercase, strip diacritics, collapse whitespace — the research's foldText, letter for letter. */
function foldText(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ß/g, 'ss')
        .replace(/[łŁ]/g, 'l')
        .replace(/[đĐ]/g, 'd')
        .replace(/[øØ]/g, 'o')
        .replace(/[æÆ]/g, 'ae')
        .replace(/[œŒ]/g, 'oe')
        .replace(/[þÞ]/g, 'th')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Whether a given name only says there is none ("N/A", "N.N.", "?", "—"); an empty one is no name either way. */
export function noName(given: string): boolean {
    const g = given.trim();
    if (!g) return false;
    const words = foldText(g).replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
    return !words || NO_NAME_SET.has(words);
}

/**
 * Whether a given name describes the person instead of naming them: a word
 * like "stillborn" or "syn", or a description in brackets ("(dítě)").
 */
export function notAName(given: string): boolean {
    const g = given.trim();
    if (!g) return false;
    if (/^[(\[{].*[)\]}]$/su.test(g)) return true;
    const words = foldText(g).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return DESCRIPTION_SET.has(words) || NO_NAME_SET.has(words);
}

/** A NAME line split into its parts. */
interface SplitName {
    /** The given name as the line wrote it. */
    given: string;
    /** The surname between the slashes, with any text after them (the app's "Smith Jr."). */
    surname: string;
    /** Whether the line marks its surname with a pair of slashes. */
    slashed: boolean;
}

function splitNameLine(line: string): SplitName {
    const s = line.trim().replace(/\s+/g, ' ');
    const close = s.lastIndexOf('/');
    let open = -1;
    for (let i = close - 1; i >= 0; i--) {
        if (s[i] === '/' && (i === 0 || s[i - 1] === ' ')) { open = i; break; }
    }
    if (open < 0 && close > 0) open = s.indexOf('/');
    if (open >= 0 && open < close) {
        const surname = s.slice(open + 1, close).trim();
        const suffix = s.slice(close + 1).trim();
        return { given: s.slice(0, open).trim(), surname: suffix ? `${surname} ${suffix}` : surname, slashed: true };
    }
    // No surname markers: the first word is the given name. The given name is
    // kept as written for the placeholder check ("N/A" alone), the parts
    // shown lose their stray slashes.
    const parts = s.split(' ').filter(Boolean);
    return { given: parts[0] ?? '', surname: parts.slice(1).join(' ').replace(/\//g, '').trim(), slashed: false };
}

/**
 * Parse a GEDCOM NAME line to first/last name: "John /Surname/", "/Surname/",
 * "John /Surname/ Jr.", "N/A /Chrpa/", "FirstName".
 *
 * The surname is the last pair of slashes, opened at the start or after a
 * space; text after it joins the surname, because a person here has only two
 * name fields and that is the order they are shown in: "John Smith Jr.".
 * Without slashes the line splits at its first space.
 */
export function parseName(nameStr: string): { firstName: string; lastName: string } {
    const split = splitNameLine(nameStr);
    return { firstName: split.slashed ? split.given : split.given.replace(/\//g, ''), lastName: split.surname };
}

/** The structured parts written under one NAME line. */
export interface GedcomNameParts {
    givn?: string;
    surn?: string;
    spfx?: string;
    npfx?: string;
    nsfx?: string;
}

/** A NAME read for the person: the two name fields and what the file wrote in place of a name. */
export interface GedcomNameRead {
    firstName: string;
    lastName: string;
    /** NPFX / NSFX: the titles before and after the name ("Ing.", "ml."), as the file wrote them. */
    titleBefore?: string;
    titleAfter?: string;
    /** A description the file wrote instead of a given name ("Mrtvě narozený"), kept for the note. */
    description?: string;
}

/**
 * Read one GEDCOM name: the NAME line with its GIVN / SURN / SPFX parts, by
 * the rules shared with the research (see the top of this file).
 *
 * `fromStrom` (a file Strom itself wrote: HEAD > SOUR STROM or
 * STROM_RESEARCH) reads what someone typed in Strom as it was typed:
 * - rule 3 only: a given name like "Syn" is a name there, as the research
 *   reads the app's file in a sync (only its NO_NAME, no descriptions);
 *   `descriptions: false` asks for this alone;
 * - a title keeps its commas ("Prof., Dr." as typed), where another
 *   program's NPFX / NSFX list reads as the title is shown ("Prof. Dr.");
 * - "? /Unknown/", which the app wrote for a person of no name and no
 *   surname before 3.10, is no surname (a surname Unknown someone typed
 *   comes with its SURN) — the research's appNoSurname.
 *
 * NPFX / NSFX are the titles before and after the name ("Ing.", "ml."), kept
 * apart from it. A file writes them in the NAME line too ("Ing. Jan /Novák/
 * ml.", for programs that read no sub-tags), so there they are taken off the
 * line's start and end before it is read — a title never doubles, nor joins
 * the surname as text after the slashes. A line without NPFX / NSFX is never
 * searched for titles: telling "Ing." or "Dr." by a word list would be a
 * guess that damages a name which only looks like one (as in the research).
 *
 * A line without slashes, with GIVN and no SURN ("Petr Novotný" + GIVN
 * Petr), keeps its surname: the rest of the line after the given name, or
 * after its first word where the line does not start with the GIVN.
 */
export function readGedcomName(
    line: string,
    parts: GedcomNameParts = {},
    opts: { descriptions?: boolean; fromStrom?: boolean } = {},
): GedcomNameRead {
    const npfx = parts.npfx?.replace(/\s+/g, ' ').trim();
    const nsfx = parts.nsfx?.replace(/\s+/g, ' ').trim();
    const bare = stripTitles(line, npfx, nsfx);
    const split = splitNameLine(bare);
    const givn = parts.givn?.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const surn = parts.surn?.replace(/\s+/g, ' ').trim();
    const written = givn || split.given;
    const fromStrom = opts.fromStrom === true;
    // GEDCOM lists several titles with commas ("Prof., Dr."); shown, they
    // read as a line says them ("Prof. Dr."). Strom's own file has them as typed.
    const asShown = (t: string | undefined): string | undefined =>
        t && !fromStrom ? t.replace(/\s*,\s*/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim() || undefined : t;
    const titleBefore = asShown(npfx);
    const titleAfter = asShown(nsfx);

    let firstName = noName(written) ? '?' : (givn || (split.slashed ? split.given : split.given.replace(/\//g, '')));
    // A word that describes the person in place of a name (stillborn, son,
    // N.N.): the name is "?", the words go to the note as the file wrote them.
    const describes = opts.descriptions ?? !fromStrom;
    if (describes && notAName(firstName)) firstName = '?';
    const description = describes && notAName(written) ? written.trim() : undefined;

    let lastName: string;
    if (surn) lastName = split.slashed && (surn.includes(',') || parts.spfx?.trim()) ? split.surname : surn;
    else if (split.slashed || !givn) lastName = split.surname;
    else lastName = surnameAfterGiven(bare, givn) ?? split.surname;
    // The app's "? /Unknown/" of old: no surname, not the surname Unknown.
    if (fromStrom && !surn && lastName === 'Unknown' && noName(written)) lastName = '';

    return {
        firstName, lastName,
        ...(titleBefore ? { titleBefore } : {}),
        ...(titleAfter ? { titleAfter } : {}),
        ...(description ? { description } : {}),
    };
}

/**
 * A line without slashes that starts with the GIVN ("Petr Novotný", GIVN
 * Petr): the rest of it is the surname ('' when the line is the given name
 * alone). Undefined when the line does not start with the GIVN.
 */
function surnameAfterGiven(line: string, givn: string): string | undefined {
    // GIVN's commas read as spaces (see readGedcomName); the line's likewise.
    const s = line.trim().replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ');
    if (s.slice(0, givn.length).toLocaleLowerCase() !== givn.toLocaleLowerCase()) return undefined;
    const rest = s.slice(givn.length);
    if (rest && rest[0] !== ' ') return undefined;
    return rest.replace(/\//g, '').trim();
}

/**
 * The NAME line without the titles its NPFX / NSFX name: the title before at
 * the line's start, the title after at its end, each a whole word (a list of
 * titles may be written with GEDCOM's commas in the tag and spaces in the
 * line: "Prof., Dr." is "Prof. Dr. Jan"). A title written elsewhere in the
 * line stays where it is.
 */
function stripTitles(line: string, before: string | undefined, after: string | undefined): string {
    let s = line.trim().replace(/\s+/g, ' ');
    const forms = (title: string): string[] => [...new Set([title, title.replace(/\s*,\s*/g, ' ')])];
    if (before) {
        for (const t of forms(before)) {
            if (s.startsWith(t) && (s.length === t.length || /[\s/]/.test(s[t.length]))) {
                s = s.slice(t.length).trim();
                break;
            }
        }
    }
    if (after) {
        for (const t of forms(after)) {
            const at = s.length - t.length;
            if (at >= 0 && s.endsWith(t) && (at === 0 || /[\s/,]/.test(s[at - 1]))) {
                // "Novák, Ph.D." — the comma before a title after the name goes with it.
                s = s.slice(0, at).trim().replace(/,$/, '').trim();
                break;
            }
        }
    }
    return s;
}

/**
 * Dates written with words of a local language, the way other programs and
 * transcriptions put them in a GEDCOM: "Po 1919", "kolem r. 1850", "zwischen
 * 1850 und 1855", "после 1870 г.". GEDCOM itself only knows the English
 * keywords (AFT, BEF, ABT, BET … AND, FROM … TO); a word it does not know must
 * not turn "after 1919" into "in 1919".
 *
 * The words are compared folded: lower case, without diacritics (NFD), dots
 * dropped. Cyrillic folds the same way. A word only counts when a valid date
 * follows it: "po válce" (after the war) is not a date and stays text.
 */

/** Fold a word for comparison: lower case, no marks, no trailing dot or comma. */
export function foldDateWord(word: string): string {
    return word.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'l')
        .toLowerCase().replace(/[.,]+$/, '');
}

const words = (list: string): Set<string> => new Set(list.split(' ').map(foldDateWord));

/** "after": GEDCOM AFT, flex '>'. */
const AFTER = words('after po nach после після');
/** "before": GEDCOM BEF, flex '<'. */
const BEFORE = words('before před pred vor przed do bis до');
/** "about": GEDCOM ABT, flex '~'. */
const ABOUT = words('about circa ca c cca kolem okolo asi zhruba přibližně um etwa ungefähr około ok около близько приблизно');
/** "between X and Y": GEDCOM BET … AND …, flex 'x..y'. */
const BETWEEN = words('between mezi medzi zwischen między pomiędzy между між');
const BETWEEN_AND = words('and a und i и і та');
/** "from X to Y": GEDCOM FROM … TO …, flex 'x..y'; "from X" alone is '>x'. */
const FROM = words('from od von ab с з від');
const FROM_TO = words('to do bis по до');
/** Words that say nothing about the date: "po roce 1919", "kolem r. 1850", "1870 г.". */
const FILLER = words('roce roku rok roky rokmi rokom letech lety r im jahr jahre jahren year years the in w roku g г года году гг року роках');

/**
 * Read a date written with local words into a flex date (see src/dates.ts):
 * '>1919', '~1850', '1850..1855'. `readDate` reads a bare date (GEDCOM or
 * numeric) and gives '' or null for anything else. Returns null when the text
 * does not start with one of the words, or no valid date follows it.
 */
export function readDateWords(text: string, readDate: (s: string) => string | null): string | null {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;
    const folded = tokens.map(foldDateWord);
    const first = folded[0];

    // The date between two token positions, with filler words left out.
    const dateOf = (from: number, to: number): string | null => {
        const kept = tokens.slice(from, to).filter((_, i) => !FILLER.has(folded[from + i]));
        if (kept.length === 0) return null;
        // "1870 г." keeps its dot on the year; a bare date never ends with one.
        const d = readDate(kept.join(' ').replace(/\.$/, ''));
        return d || null;
    };
    const plain = (d: string | null): d is string => !!d && !/^[~<>]/.test(d) && !d.includes('..');

    if (BETWEEN.has(first) || FROM.has(first)) {
        const joiners = BETWEEN.has(first) ? BETWEEN_AND : FROM_TO;
        for (let i = 2; i < tokens.length - 1; i++) {
            if (!joiners.has(folded[i])) continue;
            const a = dateOf(1, i);
            const b = dateOf(i + 1, tokens.length);
            if (plain(a) && plain(b)) return `${a}..${b}`;
        }
        // "od 1850", "ab 1850": a period with no end is "after".
        if (FROM.has(first)) {
            const a = dateOf(1, tokens.length);
            if (plain(a)) return `>${a}`;
        }
        // A between-word or from-word that is also a qualifier ("do") falls through.
    }

    const qualifier = AFTER.has(first) ? '>' : BEFORE.has(first) ? '<' : ABOUT.has(first) ? '~' : '';
    if (qualifier) {
        const d = dateOf(1, tokens.length);
        if (plain(d)) return `${qualifier}${d}`;
        return null;
    }

    // A date followed only by filler ("1870 г."): the date itself, exact.
    if (folded.slice(1).every(w => FILLER.has(w))) {
        const d = dateOf(0, tokens.length);
        if (d) return d;
    }
    return null;
}

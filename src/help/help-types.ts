/**
 * The shape of the "How Strom works" help as the app carries it.
 *
 * The build converts the Markdown of strom-doc (vendor/strom-doc, pinned in
 * package.json "stromDoc") into this tree (src/help/help-convert.ts) and embeds
 * each language compressed in the single HTML file (scripts/bundle.js). The
 * help window draws it with createElement + textContent only: the data holds
 * no HTML, no styles and no handlers, just the block and inline kinds below.
 */

/** Languages the help is written in. */
export type HelpLang = 'cs' | 'en' | 'de' | 'pl';

export const HELP_LANGS: readonly HelpLang[] = ['cs', 'en', 'de', 'pl'];

/** The parts of the documentation, in the order the help shows them. */
export type HelpPartId = 'A' | 'R' | 'S';

export const HELP_PART_ORDER: readonly HelpPartId[] = ['A', 'R', 'S'];

/** The versions of the app and the research the documentation describes. */
export interface HelpDescribes {
    app: string;
    research: string;
}

/** The version a rule holds since (Platí od / Since / Gilt seit / Obowiązuje od). */
export interface HelpSince {
    app?: string;
    research?: string;
}

/**
 * A piece of running text. A plain string is text; the objects mark bold,
 * italic, code and links. A link inside the help is a number (`ref`): a rule
 * ('R5.3'), a chapter ('R6'), the index of terms ('index') or one of its terms
 * ('index#awaiting-reply'). A link out is https only (`url`).
 */
export type HelpInline =
    | string
    | { b: string }
    | { i: string }
    | { code: string }
    | { ref: string; t: string }
    | { url: string; t: string };

/** A bullet or numbered list; `sub[n]` is the list nested under item n (null: none). */
export interface HelpList {
    k: 'ul' | 'ol';
    items: HelpInline[][];
    sub?: (HelpList | null)[];
}

/** A numbered heading of a rule; `since` comes from the rule's own "Platí od". */
export interface HelpHeading {
    k: 'h';
    level: 2 | 3 | 4;
    id: string;
    title: string;
    since?: HelpSince;
}

/** Controls / Since lines at the end of a rule; `since: true` marks the Since line. */
export interface HelpMeta {
    k: 'meta';
    items: { label: string; c: HelpInline[]; since?: boolean }[];
}

export type HelpBlock =
    | HelpHeading
    | { k: 'p'; c: HelpInline[] }
    | HelpList
    | { k: 'table'; head: string[]; rows: HelpInline[][][] }
    | { k: 'code'; text: string }
    | HelpMeta
    /** A note set apart from the text (a Markdown block quote). */
    | { k: 'quote'; blocks: HelpBlock[] };

export interface HelpPart {
    id: HelpPartId;
    title: string;
}

export interface HelpChapter {
    id: string;
    part: HelpPartId;
    title: string;
    /** The chapter's line in the contents (from the language's README). */
    desc: string;
    /** The first paragraph of the chapter as plain text. */
    intro: string;
    /** The same paragraph with its marks and links. */
    introC: HelpInline[];
    /** The rest of the chapter: further intro paragraphs, then the rules. */
    blocks: HelpBlock[];
}

/** A term of the index (REJSTRIK.md) as the user interface says it. */
export interface HelpTerm {
    /** The term's English slug (the anchor in REJSTRIK.md). */
    id: string;
    term: string;
    def: string;
    refs: string[];
}

export interface HelpLangData {
    parts: HelpPart[];
    chapters: HelpChapter[];
    terms: HelpTerm[];
}

export interface HelpBundle {
    /** The strom-doc commit the help was built from. */
    docVersion: string;
    describes: HelpDescribes;
    langs: Record<HelpLang, HelpLangData>;
}

/** What the build embeds: each language as base64 of raw-deflated JSON. */
export interface EmbeddedHelp {
    docVersion: string;
    describes: HelpDescribes;
    langs: Partial<Record<HelpLang, string>>;
}

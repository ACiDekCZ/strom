/**
 * "How Strom works" in the running app: the help embedded in the HTML file.
 *
 * The build (scripts/bundle.js) defines __HELP_DATA__: per language the help
 * tree (src/help/help-types.ts) as raw-deflated JSON in base64. Nothing is
 * fetched: a language is inflated (DecompressionStream) and parsed the first
 * time it is asked for, then kept in memory. A build without the definition
 * (npm run watch, the unit tests) has a help without content; the tests put
 * one in with setEmbeddedHelp.
 */

import type {
    EmbeddedHelp, HelpChapter, HelpDescribes, HelpHeading, HelpLang, HelpLangData,
} from './help-types.js';
import { HELP_LANGS } from './help-types.js';

declare const __HELP_DATA__: EmbeddedHelp | undefined;

let embedded: EmbeddedHelp | null = typeof __HELP_DATA__ !== 'undefined' ? __HELP_DATA__ : null;

interface Loaded {
    data: HelpLangData;
    /** Chapter and rule numbers in lower case → where they are. */
    numbers: Map<string, { chapter: HelpChapter; block: HelpHeading | null }>;
}

const loaded = new Map<HelpLang, Loaded>();
const loading = new Map<HelpLang, Promise<Loaded>>();

const EMPTY: HelpLangData = { parts: [], chapters: [], terms: [] };

/** Replace the embedded help (tests; null: none). Drops what was loaded. */
export function setEmbeddedHelp(data: EmbeddedHelp | null): void {
    embedded = data;
    loaded.clear();
    loading.clear();
}

/** Whether this build carries the help's content. */
export function hasHelpData(): boolean {
    return !!embedded && Object.keys(embedded.langs).length > 0;
}

/** The help language of an app language: its own when the help has it, else English. */
export function helpLangOf(lang: string): HelpLang {
    const own = (HELP_LANGS as readonly string[]).includes(lang) ? (lang as HelpLang) : 'en';
    return !embedded || embedded.langs[own] ? own : 'en';
}

/** The strom-doc commit the help was built from and the versions it describes. */
export function helpDocInfo(): { docVersion: string; describes: HelpDescribes } {
    return {
        docVersion: embedded?.docVersion ?? '',
        describes: embedded?.describes ?? { app: '', research: '' },
    };
}

async function inflate(base64: string): Promise<string> {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
}

function indexOf(data: HelpLangData): Loaded {
    const numbers: Loaded['numbers'] = new Map();
    for (const chapter of data.chapters) {
        numbers.set(chapter.id.toLowerCase(), { chapter, block: null });
        const visit = (blocks: HelpChapter['blocks']): void => {
            for (const block of blocks) {
                if (block.k === 'h') numbers.set(block.id.toLowerCase(), { chapter, block });
                else if (block.k === 'quote') visit(block.blocks);
            }
        };
        visit(chapter.blocks);
    }
    return { data, numbers };
}

/**
 * The help of a language (an app language without help: English), inflated
 * and parsed on the first call and kept. Without embedded help: empty.
 */
export function loadHelp(lang: string): Promise<HelpLangData> {
    const l = helpLangOf(lang);
    const done = loaded.get(l);
    if (done) return Promise.resolve(done.data);
    let pending = loading.get(l);
    if (!pending) {
        const source = embedded?.langs[l];
        pending = (source ? inflate(source).then(text => JSON.parse(text) as HelpLangData) : Promise.resolve(EMPTY))
            .then(data => {
                const entry = indexOf(data);
                if (embedded?.langs[l] === source) loaded.set(l, entry);
                return entry;
            })
            .finally(() => loading.delete(l));
        loading.set(l, pending);
    }
    return pending.then(entry => entry.data);
}

/** The help of a language when it is already loaded (else null). */
export function getHelpLoaded(lang: string): HelpLangData | null {
    return loaded.get(helpLangOf(lang))?.data ?? null;
}

/** A chapter ('R2') of a loaded language, or null. */
export function getChapter(lang: string, id: string): HelpChapter | null {
    const hit = loaded.get(helpLangOf(lang))?.numbers.get(id.trim().toLowerCase());
    return hit && !hit.block ? hit.chapter : null;
}

/**
 * Where a number of a loaded language is: a rule ('R2.4': its chapter and
 * heading) or a chapter ('R2': block null). Any letter case. Null when the
 * help has no such number or the language is not loaded yet.
 */
export function findRule(lang: string, id: string): { chapter: HelpChapter; block: HelpHeading | null } | null {
    return loaded.get(helpLangOf(lang))?.numbers.get(id.trim().toLowerCase()) ?? null;
}

/** Whether a loaded language has the number (chapter or rule). */
export function ruleExists(lang: string, id: string): boolean {
    return findRule(lang, id) !== null;
}

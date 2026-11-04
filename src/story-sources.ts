/**
 * The sources a story rests on (Story.sources: the sources of its facts and of
 * its background, GEDCOM `2 SOUR @S…@` under _STORY, `3 SOUR` under _DRAFT),
 * and the research's bare source codes in a story's text ("[S0164]") named by
 * the source's title. Pure and DOM-free: the story reader, the person page,
 * the family book and the comparison of versions share it.
 */

import type { Source, Story } from './types.js';
import { safeHttpUrl } from './validation.js';
import { gedcomDateWhole } from './gedcom-date-read.js';
import { formatFlexDate } from './dates.js';

type Catalog = Readonly<Record<string, Source>> | undefined;

/** A source as a story shows it: its title and, when it has a web address, a safe link. */
export interface StorySourceShown {
    id: string;
    title: string;
    href: string | null;
}

/** The story's sources that the tree holds, in their order, each once. */
export function storySourcesShown(catalog: Catalog, ids: readonly string[] | undefined): StorySourceShown[] {
    const out: StorySourceShown[] = [];
    const seen = new Set<string>();
    for (const id of ids ?? []) {
        const s = catalog?.[id];
        if (!s || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, title: s.title?.trim() || '?', href: safeHttpUrl(s.url) });
    }
    return out;
}

/** "[S0164]", "(S0164)", "[S0001, S0002]": a bracket that holds research source codes only. */
const CODE_GROUP = /([[(])\s*(S\d{2,9}(?:\s*[,;]\s*S\d{2,9})*)\s*([\])])/g;

/**
 * A namer of bare source codes over one catalog (built once, for many texts):
 * a bracket of codes becomes the sources' titles in parentheses ("Lhotečka
 * [S0002]" → "Lhotečka (Dějiny hasičů ve Lhotě)"). A code the tree has no
 * source for leaves its bracket exactly as it was.
 */
export function sourceCodeNamer(catalog: Catalog): (text: string) => string {
    let byRefn: Map<string, string> | null = null;
    const titles = (): Map<string, string> => {
        if (byRefn) return byRefn;
        byRefn = new Map();
        for (const s of Object.values(catalog ?? {})) {
            const refn = s.refn?.trim();
            if (refn && !byRefn.has(refn)) byRefn.set(refn, s.title?.trim() || '');
        }
        return byRefn;
    };
    return (text: string): string => {
        if (!text || !catalog) return text;
        return text.replace(CODE_GROUP, (m, open: string, codes: string, close: string) => {
            if ((open === '[') !== (close === ']')) return m;
            const named = codes.split(/\s*[,;]\s*/).map(code => titles().get(code));
            if (named.some(t => !t)) return m;
            return `(${[...new Set(named)].join('; ')})`;
        });
    };
}

/** One text's bare source codes named by their titles (see sourceCodeNamer). */
export function nameSourceCodes(text: string, catalog: Catalog): string {
    return sourceCodeNamer(catalog)(text);
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Rewrite the source ids of a story and of its waiting new version in place:
 * `fix` returns the ids to keep (none: the field goes). For removing a source
 * from the tree, merging duplicate sources, a copy without sources.
 */
export function rewriteStorySources(story: Story | undefined, fix: (ids: string[]) => string[]): void {
    if (!story) return;
    for (const holder of [story, story.draft]) {
        if (!holder?.sources) continue;
        const kept = [...new Set(fix(holder.sources))];
        if (kept.length) holder.sources = kept;
        else delete holder.sources;
    }
}

/** The source ids a story cites (its own and its waiting new version's). */
export function storySourceIds(story: Story | undefined): string[] {
    return [...(story?.sources ?? []), ...(story?.draft?.sources ?? [])];
}

// ── What a story's text is based on: one folded section under the story ──
// The research writes two lists under a story: its facts as `2 DATA` lines
// ("DEAT 25 SEP 1857 Lhota [S0027]") and the sources it rests on (`2 SOUR`).
// Shown side by side they said the same sources twice, the facts in raw
// GEDCOM. Under every story (a person's and a couple's) there is one folded
// section instead: the sources once (the pointers and the codes the facts
// cite, joined), the facts readable, the author's caveat.

type StoryBasisInput = Pick<Story, 'sources' | 'facts'>;

/**
 * The ids of the sources a story rests on: its own pointers first, then the
 * sources whose codes its facts cite ("[S0027, S1000]"), each once. A code the
 * tree has no source for is left out.
 */
export function storyBasisSourceIds(catalog: Catalog, story: StoryBasisInput | undefined): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (id: string | undefined): void => {
        if (!id || seen.has(id) || !catalog?.[id]) return;
        seen.add(id);
        out.push(id);
    };
    for (const id of story?.sources ?? []) add(id);
    const facts = (story?.facts ?? []).filter(f => f.trim());
    if (!facts.length || !catalog) return out;
    const byRefn = new Map<string, string>();
    for (const [id, src] of Object.entries(catalog)) {
        const refn = src.refn?.trim();
        if (refn && !byRefn.has(refn)) byRefn.set(refn, id);
    }
    for (const f of facts) {
        for (const m of f.matchAll(CODE_GROUP)) {
            if ((m[1] === '[') !== (m[3] === ']')) continue;
            for (const code of m[2].split(/\s*[,;]\s*/)) add(byRefn.get(code));
        }
    }
    return out;
}

/** The words a fact line is read with: the app's event names. */
export interface StoryFactWords {
    events: { types: Record<string, string> };
    partnerEvents: { types: Record<string, string> };
    personSources: { citeUnion: (y: number | null) => string };
}

/** A GEDCOM fact tag → the name of the event it stands for (a person's or a couple's). */
const PERSON_FACT_TYPE: Record<string, string> = {
    BIRT: 'birth', DEAT: 'death', CHR: 'baptism', CHRA: 'baptism', BAPM: 'baptism', BURI: 'burial', CREM: 'cremation',
    OCCU: 'occupation', RESI: 'residence', EMIG: 'emigration', IMMI: 'immigration', EDUC: 'education', GRAD: 'education',
    RELI: 'religion', CONF: 'confirmation', FCOM: 'firstCommunion', BARM: 'barMitzvah', BASM: 'batMitzvah',
    ORDN: 'ordination', ADOP: 'adoption', NATU: 'naturalization', NATI: 'nationality', WILL: 'will', PROB: 'probate',
    TITL: 'title', MILI: 'military', _MILT: 'military', _MILI: 'military',
};
const COUPLE_FACT_TYPE: Record<string, string> = {
    ENGA: 'engagement', MARB: 'banns', MARL: 'marriageLicence', MARC: 'marriageContract', MARS: 'marriageSettlement',
    CENS: 'census', DIVF: 'divorceFiled', ANUL: 'annulment',
};
/** Tags read without a name of their own: the line goes on with its date. */
const UNNAMED_FACT_TAGS = new Set(['EVEN', 'FACT', 'RETI', 'BLES', 'CAST', 'DSCR', 'IDNO', 'NCHI', 'NMR', 'PROP', 'SSN', 'DIV']);

function factLabel(tag: string, w: StoryFactWords): string | null | undefined {
    if (tag === 'MARR') return w.personSources.citeUnion(null);
    const p = PERSON_FACT_TYPE[tag];
    if (p) return w.events.types[p] ?? null;
    const c = COUPLE_FACT_TYPE[tag];
    if (c) return w.partnerEvents.types[c] ?? null;
    return UNNAMED_FACT_TAGS.has(tag) ? null : undefined;
}

/**
 * One fact line of a story made readable: "DEAT 25 SEP 1857 Lhota [S0027]" →
 * "Death 25 Sep 1857, Lhota". The tag becomes the event's name (a tag of no
 * name of its own goes), the GEDCOM date the language's date, the codes of the
 * sources go (the sources are listed beside the facts). A line that does not
 * start with a tag (another program's own words) keeps its words, codes gone.
 */
export function storyFactText(line: string, words: StoryFactWords, lang: 'cs' | 'en' | 'de' | 'pl'): string {
    const plain = line.replace(CODE_GROUP, (m, open: string, _c: string, close: string) =>
        (open === '[') !== (close === ']') ? m : ' ').replace(/\s+/g, ' ').trim();
    const m = /^(_?[A-Z]{3,5})(?:\s+(.*))?$/.exec(plain);
    const label = m ? factLabel(m[1], words) : undefined;
    if (!m || label === undefined) return plain.replace(/\s+([,.;:])/g, '$1');
    const tokens = (m[2] ?? '').split(' ').filter(Boolean);
    // The longest run of words at the start that is one GEDCOM date ("BET 24 SEP 1888 AND 7 NOV 1892": 8).
    let date = '';
    let used = 0;
    for (let n = Math.min(tokens.length, 9); n > 0; n--) {
        const d = gedcomDateWhole(tokens.slice(0, n).join(' '));
        if (d) { date = formatFlexDate(d, lang); used = n; break; }
    }
    const rest = tokens.slice(used).join(' ').replace(/^[,;:\s]+|[,;:\s]+$/g, '');
    // "Death 25 Sep 1857, Lhota"; without a date the label reads as a heading: "Occupation: miller".
    const head = [label, date].filter(Boolean).join(' ');
    if (!head || !rest) return head || rest;
    // A bracket after the date belongs to it ("Birth 5 May 1863 [K-04]", "(farní kniha)").
    return `${head}${/^[[(]/.test(rest) ? '' : date ? ',' : ':'} ${rest}`;
}

/** What a story's text is based on, ready to show. */
export interface StoryBasisShown {
    sources: StorySourceShown[];
    facts: string[];
    note: string;
}

/**
 * The basis of a story: its sources (storyBasisSourceIds), its facts readable
 * and each once, its caveat. `fact` reads a line (storyFactText with the
 * page's language); `note` cleans the caveat (the page strips research ids).
 */
export function storyBasisShown(catalog: Catalog, story: Pick<Story, 'sources' | 'facts' | 'note'> | undefined,
    fact: (line: string) => string, note: (text: string) => string = t => t): StoryBasisShown {
    const facts: string[] = [];
    const seen = new Set<string>();
    for (const f of story?.facts ?? []) {
        const t = fact(f).trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        facts.push(t);
    }
    return {
        sources: storySourcesShown(catalog, storyBasisSourceIds(catalog, story)),
        facts,
        note: story?.note?.trim() ? note(story.note).trim() : '',
    };
}

export function storyBasisEmpty(b: StoryBasisShown): boolean {
    return !b.sources.length && !b.facts.length && !b.note;
}

/** The section's words: its heading (with the number of sources), the lists' labels, the caveat's label. */
export interface StoryBasisWords {
    head: string;
    count: (n: number) => string;
    sources: string;
    facts: string;
    note: string;
}

/** "What the text is based on (28)"; without sources the heading alone. */
export function storyBasisHead(b: StoryBasisShown, L: StoryBasisWords): string {
    return b.sources.length ? `${L.head} ${L.count(b.sources.length)}` : L.head;
}

/**
 * The inside of the section: the sources (a web address a link to a new
 * window, `link: false` the title alone), the facts, the caveat. `cls` is the
 * prefix of its classes.
 */
export function storyBasisBodyHtml(b: StoryBasisShown, L: StoryBasisWords, o: { cls: string; link?: boolean }): string {
    const c = o.cls;
    const parts: string[] = [];
    if (b.sources.length) {
        const items = b.sources.map(s => `<li>${o.link !== false && s.href
            ? `<a href="${esc(s.href)}" rel="noopener noreferrer" target="_blank">${esc(s.title)} ↗</a>`
            : esc(s.title)}</li>`).join('');
        parts.push(`<p class="${c}-h">${esc(L.sources)}</p><ul class="${c}-list ${c}-src">${items}</ul>`);
    }
    if (b.facts.length) {
        parts.push(`<p class="${c}-h">${esc(L.facts)}</p><ul class="${c}-list ${c}-facts">${b.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`);
    }
    if (b.note) parts.push(`<p class="${c}-note">${esc(L.note)}: ${esc(b.note)}</p>`);
    return parts.join('');
}

/**
 * The whole section as a `<details>` folded by default (the story reader, the
 * comparison of versions): one quiet line, the rest on a click. '' when the
 * story has nothing under it.
 */
export function storyBasisDetailsHtml(b: StoryBasisShown, L: StoryBasisWords, o: { cls: string; link?: boolean; attrs?: string }): string {
    if (storyBasisEmpty(b)) return '';
    return `<details class="${o.cls}"${o.attrs ?? ''}><summary class="${o.cls}-sum"><span>${esc(storyBasisHead(b, L))}</span><span class="${o.cls}-chev" aria-hidden="true">▸</span></summary>`
        + `<div class="${o.cls}-body">${storyBasisBodyHtml(b, L, o)}</div></details>`;
}

/** The section's words from the app's strings of one language. */
export function storyBasisWords(S: {
    story: { basisSources: string; basisFacts: string };
    personPage: { storyBasis: string; authorNote: string };
}): StoryBasisWords {
    return {
        head: S.personPage.storyBasis,
        count: n => `(${n})`,
        sources: S.story.basisSources,
        facts: S.story.basisFacts,
        note: S.personPage.authorNote,
    };
}

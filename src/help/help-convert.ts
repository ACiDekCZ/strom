/**
 * "How Strom works" at build time: the Markdown of strom-doc → the help tree
 * (HelpBundle, src/help/help-types.ts).
 *
 * Pure: no DOM, no file system. The input is a map path → text with the paths
 * of the strom-doc repository ('cs/R2-lines-and-queue.md', 'cs/README.md',
 * 'REJSTRIK.md', …). scripts/bundle.js runs it over vendor/strom-doc and embeds
 * the result; the tests run it over the same files.
 *
 * Only the subset strom-doc uses is understood: numbered headings with their
 * anchors, paragraphs, bullet and numbered lists (nested), tables, block
 * quotes, code fences and the inline marks **bold**, *italic*, `code` and
 * links. Comments and raw HTML are dropped; anything else stays plain text.
 *
 * The conversion fails (throws HelpConvertError naming the file, the language
 * and the number) when a link leads to a number the language does not have, or
 * when a language lacks a chapter another language has.
 */

import {
    HELP_LANGS, HELP_PART_ORDER,
    type EmbeddedHelp, type HelpBlock, type HelpBundle, type HelpChapter, type HelpDescribes, type HelpHeading,
    type HelpInline, type HelpLang, type HelpLangData, type HelpList, type HelpMeta, type HelpPart, type HelpPartId,
    type HelpSince, type HelpTerm,
} from './help-types.js';

export class HelpConvertError extends Error {
    constructor(message: string) {
        super(`help: ${message}`);
        this.name = 'HelpConvertError';
    }
}

/** A number of the documentation: R2, R2.3, R2.3.1 (R2.3a: inserted between two). */
const NUM = '[ARS]\\d+(?:\\.\\d+[a-z]?){0,3}';
const IS_NUM = new RegExp(`^${NUM}$`);
const HEADING_NUM = new RegExp(`^(${NUM})\\s+(.+?)\\s*$`);
const BARE_NUM = new RegExp(`(?<![\\w./#-])(${NUM})(?![\\w-]|\\.\\d)`, 'g');
const CHAPTER_FILE = /^([ARS]\d+)-[a-z0-9-]+\.md$/;

/** The labels of the lines that become a rule's Controls / Since block, per language. */
const META_LABELS: Record<HelpLang, { controls: string; since: string }> = {
    cs: { controls: 'Ovládání', since: 'Platí od' },
    en: { controls: 'Controls', since: 'Since' },
    de: { controls: 'Bedienung', since: 'Gilt seit' },
    pl: { controls: 'Obsługa', since: 'Obowiązuje od' },
};

/** The term table's "numbers" line of REJSTRIK.md. */
const TERM_REFS_LABEL = 'Čísla';

const depthOf = (num: string): number => num.split('.').length;

// --- versions ------------------------------------------------------------------

const VERSION = '\\d+\\.\\d+\\.\\d+';

function compareVersions(a: string, b: string): number {
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d) return d;
    }
    return 0;
}

const maxVersion = (a: string, b: string): string => (!a || compareVersions(b, a) > 0 ? b : a);

/** Words naming the research or the app, in every form the texts use. */
const RESEARCH_WORD = /^(?:výzkum\p{L}*|research|forschung|badani\p{L}*)$/iu;
const APP_WORD = /^(?:aplikac\p{L}*|app|strom-app)$/iu;

function subjectOf(word: string): 'research' | 'app' | null {
    if (RESEARCH_WORD.test(word)) return 'research';
    if (APP_WORD.test(word)) return 'app';
    return null;
}

/**
 * The versions a chapter's intro says it describes: the sentence "Popisuje
 * výzkum 1.25.2 a aplikaci Strom 3.21.2." (en Describes, de Beschrieben
 * werden / Beschreibt, pl Opisuje); each version belongs to the research or the
 * app named last before it ("výzkum 1.25.2 a 1.26.0": both the research).
 */
export function describedVersions(text: string): Partial<HelpDescribes> {
    const out: Partial<HelpDescribes> = {};
    const sentence = /(?:Popisuje|Describes|Beschrieben\s+(?:werden|wird)|Beschreibt|Opisuje)\s([\s\S]*?)(?:[.;](?=\s|$)|$)/g;
    for (const [, body] of text.matchAll(sentence)) {
        let subject: 'research' | 'app' | null = null;
        for (const [, word, version] of body.matchAll(new RegExp(`(\\p{L}[\\p{L}-]*)|(${VERSION})`, 'gu'))) {
            if (word) subject = subjectOf(word) ?? subject;
            else if (version && subject) out[subject] = maxVersion(out[subject] ?? '', version);
        }
    }
    return out;
}

/** "aplikace Strom", "Strom app": the word that names the research or the app. */
const phraseSubject = (phrase: string): 'research' | 'app' | null =>
    phrase.split(/\s+/).map(subjectOf).find(Boolean) ?? null;

const SINCE_SUBJECT = '(výzkum|výzkumem|research|Forschung|badanie|badaniem|aplikace Strom|aplikace|aplikací|'
    + 'aplikacja Strom|aplikacja|aplikacją|Strom app|app|Strom-App|App)';
const SINCE_PAIR = `${SINCE_SUBJECT}\\s+(${VERSION})`
    + `(?:(?:\\s*,\\s*|\\s+(?:s|with|mit|z)\\s+|\\s*\\(\\s*)${SINCE_SUBJECT}\\s+(${VERSION})`;
/** The whole clause: "výzkum 1.12.0, aplikace 3.9.0", "aplikace 3.11.0 (výzkum 1.14.0)". */
const SINCE_CLAUSE = new RegExp(`^${SINCE_PAIR}\\s*\\)?)?$`, 'iu');
/** The start of a clause with its explanations in brackets left out: "výzkum 1.0.0, --loop od 1.2.0". */
const SINCE_LEAD = new RegExp(`^${SINCE_PAIR})?(?=\\s*(?:,|$))`, 'iu');

/**
 * The version of a "Platí od" line: its first clause (up to "." or ";"), in the
 * forms "výzkum 1.27.0", "aplikace 3.24.0", "aplikace 3.11.0 s výzkumem
 * 1.14.0", "výzkum 1.12.0, aplikace 3.9.0", "aplikace 3.11.0 (výzkum 1.14.0)"
 * and their en/de/pl counterparts. An explanation in brackets and later parts
 * ("výzkum 1.0.0 (klíče 1, 7–10), klíč 6 od 1.1.0"; "Místa od 1.26.0") are
 * details of the rule: the rule holds since the version that leads. Null when
 * the clause does not start with the research or the app and its version
 * ("výchozí osoba aplikace 1.0.0; …", "aplikace 3.9.0 nebo dřív").
 */
export function parseSince(text: string): HelpSince | null {
    const clause = text.trim().split(/;|\.(?=\s|$)/)[0].trim();
    const m = clause.match(SINCE_CLAUSE) ?? clause.replace(/\s*\([^()]*\)/g, '').match(SINCE_LEAD);
    if (!m) return null;
    const since: HelpSince = {};
    const first = phraseSubject(m[1]);
    if (!first) return null;
    since[first] = m[2];
    if (m[3]) {
        const second = phraseSubject(m[3]);
        if (!second) return null;
        // "výzkum 1.24.0 (regiony), výzkum 1.25.0 (…)": the second is a detail of the first
        if (second !== first) since[second] = m[4];
    }
    return since;
}

// --- inline --------------------------------------------------------------------

/** Where a piece of text is, for links and error messages. */
interface Ctx {
    lang: HelpLang;
    /** The file in the repository ('cs/R2-lines-and-queue.md', 'REJSTRIK.md'). */
    file: string;
    /** Numbers of each language: lower case → as written. */
    numbers: Map<HelpLang, Map<string, string>>;
    termIds: Set<string>;
}

/** Tag names whose markup is dropped from the text (raw HTML is never passed on). */
const HTML_TAG = /^<\/?(?:a|abbr|b|br|code|del|details|div|em|i|img|ins|kbd|mark|p|pre|q|s|small|span|strong|sub|summary|sup|u)\b[^>]*>/i;

export function inlineText(c: HelpInline[]): string {
    return c.map(x => (typeof x === 'string' ? x : 'b' in x ? x.b : 'i' in x ? x.i : 'code' in x ? x.code : x.t)).join('');
}

function pushText(out: HelpInline[], text: string): void {
    if (!text) return;
    const last = out[out.length - 1];
    if (typeof last === 'string') out[out.length - 1] = last + text;
    else out.push(text);
}

/** The index of the `]` closing the `[` at `open`, skipping code spans and nested brackets. */
function closingBracket(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === '\\') { i++; continue; }
        if (c === '`') {
            const end = text.indexOf('`', i + 1);
            if (end > 0) i = end;
            continue;
        }
        if (c === '[') depth++;
        else if (c === ']' && --depth === 0) return i;
    }
    return -1;
}

/** The index of the `)` closing a link destination that opens at `open` (balanced brackets inside). */
function closingParen(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '(') depth++;
        else if (text[i] === ')' && --depth === 0) return i;
    }
    return -1;
}

/** The text of a Markdown line with its marks and links (soft line breaks already joined). */
function parseInline(text: string, ctx: Ctx): HelpInline[] {
    const out: HelpInline[] = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === '\\' && i + 1 < text.length && /[!-/:-@[-`{-~]/.test(text[i + 1])) {
            pushText(out, text[i + 1]);
            i += 2;
            continue;
        }
        if (c === '`') {
            let run = 1;
            while (text[i + run] === '`') run++;
            const fence = '`'.repeat(run);
            let end = text.indexOf(fence, i + run);
            while (end >= 0 && text[end + run] === '`') end = text.indexOf(fence, end + run + 1);
            if (end >= 0) {
                let code = text.slice(i + run, end);
                if (code.length > 1 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
                out.push({ code });
                i = end + run;
                continue;
            }
            pushText(out, fence);
            i += run;
            continue;
        }
        if (c === '*' && text[i + 1] === '*') {
            const end = text.indexOf('**', i + 2);
            if (end > i + 2 && !/\s/.test(text[i + 2])) {
                out.push({ b: inlineText(parseInline(text.slice(i + 2, end), ctx)) });
                i = end + 2;
                continue;
            }
        } else if (c === '*' && /\S/.test(text[i + 1] ?? ' ')) {
            let end = i + 1;
            while ((end = text.indexOf('*', end)) >= 0 && text[end + 1] === '*') end += 2;
            if (end > i + 1 && !/\s/.test(text[end - 1])) {
                out.push({ i: inlineText(parseInline(text.slice(i + 1, end), ctx)) });
                i = end + 1;
                continue;
            }
        }
        if (c === '[') {
            const close = closingBracket(text, i);
            if (close > 0 && text[close + 1] === '(') {
                const end = closingParen(text, close + 1);
                if (end > 0) {
                    const t = inlineText(parseInline(text.slice(i + 1, close), ctx));
                    const target = text.slice(close + 2, end).trim().split(/\s+/)[0];
                    const link = resolveLink(target, t, ctx);
                    if (typeof link === 'string') pushText(out, link);
                    else out.push(link);
                    i = end + 1;
                    continue;
                }
            }
        }
        if (c === '<') {
            const tag = text.slice(i).match(HTML_TAG);
            if (tag) {
                i += tag[0].length;
                continue;
            }
        }
        pushText(out, c);
        i++;
    }
    return out;
}

function numberIn(ctx: Ctx, lang: HelpLang, num: string, what: string): string {
    const found = ctx.numbers.get(lang)?.get(num.toLowerCase());
    if (!found) throw new HelpConvertError(`${ctx.file}: ${what} leads to ${num}, which the ${lang} text does not have`);
    return found;
}

/**
 * A link of the text: a number of the help ({ref}), a term of the index
 * ({ref: 'index#slug'}), a page out (https only, {url}); anything else
 * (http:, mailto:, javascript:, a file outside the help) is just its text.
 */
function resolveLink(target: string, t: string, ctx: Ctx): HelpInline {
    if (/^https:\/\//i.test(target)) return { url: target, t };
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return t;
    const hash = target.indexOf('#');
    const path = hash >= 0 ? target.slice(0, hash) : target;
    const frag = hash >= 0 ? target.slice(hash + 1) : '';
    const name = path.split('/').pop() ?? '';
    if (name === 'REJSTRIK.md') {
        if (!frag) return { ref: 'index', t };
        if (!ctx.termIds.has(frag)) throw new HelpConvertError(`${ctx.file}: a link leads to the term #${frag}, which REJSTRIK.md does not have`);
        return { ref: `index#${frag}`, t };
    }
    const chapter = name.match(CHAPTER_FILE);
    if (path && !chapter) return t; // README, CISLA.md, LICENSE: not part of the help
    if (frag) {
        if (!IS_NUM.test(frag)) throw new HelpConvertError(`${ctx.file}: a link leads to #${frag}, which is not a number`);
        return { ref: numberIn(ctx, ctx.lang, frag, 'a link'), t };
    }
    if (!chapter) return t;
    return { ref: numberIn(ctx, ctx.lang, chapter[1], 'a link'), t };
}

// --- blocks --------------------------------------------------------------------

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const HTML_LINE = /^\s*<\/?[a-zA-Z][^>]*>\s*(?:<\/[a-zA-Z]+>\s*)*$/;

const isBlank = (line: string): boolean => !line.trim();
const indentOf = (line: string): number => line.length - line.trimStart().length;

function startsBlock(line: string, next: string | undefined): boolean {
    const t = line.trimStart();
    if (/^#{1,6}\s/.test(t) || t.startsWith('>') || t.startsWith('```') || HTML_LINE.test(line)) return true;
    if (t.startsWith('|') && next !== undefined && TABLE_SEPARATOR.test(next)) return true;
    const item = line.match(LIST_ITEM);
    return !!item && (/^[-*+]$/.test(item[2]) || /^1[.)]$/.test(item[2]));
}

/** The cells of a table row; `\|` is a pipe inside a cell. */
function tableCells(line: string): string[] {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    const cells: string[] = [];
    let cell = '';
    for (let i = 0; i < row.length; i++) {
        if (row[i] === '\\' && row[i + 1] === '|') { cell += '|'; i++; continue; }
        if (row[i] === '|') { cells.push(cell.trim()); cell = ''; continue; }
        cell += row[i];
    }
    cells.push(cell.trim());
    return cells;
}

/** A list as raw item texts, before meta lines are split off. */
interface RawList {
    ordered: boolean;
    items: string[];
    sub: (RawList | null)[];
}

function parseRawList(lines: string[], start: number): [RawList, number] {
    const first = lines[start].match(LIST_ITEM)!;
    const indent = first[1].length;
    const ordered = !/^[-*+]$/.test(first[2]);
    const list: RawList = { ordered, items: [], sub: [] };
    let i = start;
    while (i < lines.length) {
        const line = lines[i];
        if (isBlank(line)) {
            let j = i + 1;
            while (j < lines.length && isBlank(lines[j])) j++;
            if (j >= lines.length) break;
            const next = lines[j].match(LIST_ITEM);
            if (next && next[1].length === indent && !/^[-*+]$/.test(next[2]) === ordered) { i = j; continue; }
            if (indentOf(lines[j]) > indent) { i = j; continue; }
            break;
        }
        const m = line.match(LIST_ITEM);
        if (m && m[1].length === indent) {
            if (!/^[-*+]$/.test(m[2]) !== ordered) break;
            list.items.push(m[3].trim());
            list.sub.push(null);
            i++;
            continue;
        }
        if (m && m[1].length < indent) break;
        if (!list.items.length) break;
        if (m && m[1].length > indent) {
            const [sub, next] = parseRawList(lines, i);
            const at = list.items.length - 1;
            const had = list.sub[at];
            if (had && had.ordered === sub.ordered) { had.items.push(...sub.items); had.sub.push(...sub.sub); }
            else list.sub[at] = sub;
            i = next;
            continue;
        }
        if (indentOf(line) <= indent && startsBlock(line, lines[i + 1])) break;
        list.items[list.items.length - 1] += ' ' + line.trim();
        i++;
    }
    return [list, i];
}

function toList(raw: RawList, ctx: Ctx): HelpList {
    const list: HelpList = { k: raw.ordered ? 'ol' : 'ul', items: raw.items.map(t => parseInline(t, ctx)) };
    if (raw.sub.some(Boolean)) list.sub = raw.sub.map(s => (s ? toList(s, ctx) : null));
    return list;
}

/** Since values of the Since lines met while parsing, by their meta item (attached to headings afterwards). */
type SinceNotes = WeakMap<HelpMeta['items'][number], HelpSince>;

/**
 * A top-level list, with the rule's "Ovládání:" / "Platí od:" lines (and
 * their en/de/pl labels) turned into meta blocks where they stand.
 */
function listBlocks(raw: RawList, ctx: Ctx, sinces: SinceNotes): HelpBlock[] {
    const labels = META_LABELS[ctx.lang];
    const metaLabel = new RegExp(`^\\*\\*(${labels.controls}|${labels.since}):\\*\\*\\s*`);
    const out: HelpBlock[] = [];
    let run: RawList | null = null;
    let meta: HelpMeta | null = null;
    for (let n = 0; n < raw.items.length; n++) {
        const text = raw.items[n];
        const m = raw.sub[n] ? null : text.match(metaLabel);
        if (m) {
            if (run) { out.push(toList(run, ctx)); run = null; }
            if (!meta) { meta = { k: 'meta', items: [] }; out.push(meta); }
            const item: HelpMeta['items'][number] = { label: m[1], c: parseInline(text.slice(m[0].length), ctx) };
            if (m[1] === labels.since) {
                item.since = true;
                const since = parseSince(inlineText(item.c));
                if (since) sinces.set(item, since);
            }
            meta.items.push(item);
            continue;
        }
        meta = null;
        if (!run) run = { ordered: raw.ordered, items: [], sub: [] };
        run.items.push(text);
        run.sub.push(raw.sub[n]);
    }
    if (run) out.push(toList(run, ctx));
    return out;
}

function parseBlocks(lines: string[], ctx: Ctx, sinces: SinceNotes): HelpBlock[] {
    const blocks: HelpBlock[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const t = line.trim();
        if (!t || HTML_LINE.test(line)) { i++; continue; }

        const heading = t.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
        if (heading) {
            const numbered = heading[2].match(HEADING_NUM);
            if (numbered) {
                const level = Math.min(4, Math.max(2, depthOf(numbered[1]))) as 2 | 3 | 4;
                blocks.push({ k: 'h', level, id: numbered[1], title: inlineText(parseInline(numbered[2], ctx)) });
            } else {
                blocks.push({ k: 'p', c: [{ b: inlineText(parseInline(heading[2], ctx)) }] });
            }
            i++;
            continue;
        }

        if (t.startsWith('```')) {
            const body: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
            i++;
            blocks.push({ k: 'code', text: body.join('\n') });
            continue;
        }

        if (t.startsWith('>')) {
            const inner: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('>')) inner.push(lines[i++].trim().replace(/^>\s?/, ''));
            blocks.push({ k: 'quote', blocks: parseBlocks(inner, ctx, sinces) });
            continue;
        }

        if (t.startsWith('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
            const head = tableCells(line).map(c => inlineText(parseInline(c, ctx)));
            const rows: HelpInline[][][] = [];
            i += 2;
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                rows.push(tableCells(lines[i]).map(c => parseInline(c, ctx)));
                i++;
            }
            blocks.push({ k: 'table', head, rows });
            continue;
        }

        if (LIST_ITEM.test(line)) {
            const [raw, next] = parseRawList(lines, i);
            if (raw.items.length) {
                blocks.push(...listBlocks(raw, ctx, sinces));
                i = next;
                continue;
            }
        }

        const para: string[] = [t];
        i++;
        while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++].trim());
        blocks.push({ k: 'p', c: parseInline(para.join(' '), ctx) });
    }
    return blocks;
}

/** Each heading takes the since of the first Since line before the next heading. */
function attachSince(blocks: HelpBlock[], sinces: SinceNotes): void {
    let heading: HelpHeading | null = null;
    for (const block of blocks) {
        if (block.k === 'h') { heading = block; continue; }
        if (block.k !== 'meta' || !heading || heading.since) continue;
        for (const item of block.items) {
            const since = item.since ? sinces.get(item) : undefined;
            if (since) { heading.since = since; break; }
        }
    }
}

const stripComments = (text: string): string =>
    text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, ''));

// --- chapters, contents, index -------------------------------------------------

interface ContentsEntry { id: string; part: HelpPartId; desc: string }

function parseContents(text: string, ctx: Ctx): { parts: HelpPart[]; entries: ContentsEntry[] } {
    const parts: HelpPart[] = [];
    const entries: ContentsEntry[] = [];
    let part: HelpPartId | null = null;
    for (const line of stripComments(text).split('\n')) {
        const h = line.match(/^##\s+([ARS])\s+(.+?)\s*$/);
        if (h) {
            part = h[1] as HelpPartId;
            parts.push({ id: part, title: h[2] });
            continue;
        }
        if (/^#{1,2}\s/.test(line)) { part = null; continue; }
        const item = line.match(/^[-*]\s+\[([^\]]+)\]\(([^)\s]+)\)\s*(?::\s*(.*))?$/);
        if (!item || !part) continue;
        const file = item[2].match(CHAPTER_FILE);
        const id = file?.[1] ?? item[1].split(/\s+/)[0];
        if (!IS_NUM.test(id) || id[0] !== part) continue;
        entries.push({ id, part, desc: item[3] ? inlineText(parseInline(item[3], ctx)).trim() : '' });
    }
    return { parts, entries };
}

function parseChapter(id: string, text: string, ctx: Ctx): Omit<HelpChapter, 'desc'> {
    const lines = stripComments(text).split('\n');
    const h1 = lines.findIndex(l => /^#\s/.test(l));
    if (h1 < 0) throw new HelpConvertError(`${ctx.file}: no chapter heading "# ${id} …"`);
    const head = lines[h1].replace(/^#\s+/, '').trim().match(HEADING_NUM);
    if (!head || head[1] !== id) throw new HelpConvertError(`${ctx.file}: the chapter heading should start with ${id}`);
    const sinces: SinceNotes = new WeakMap();
    const blocks = parseBlocks(lines.slice(h1 + 1), ctx, sinces);
    attachSince(blocks, sinces);
    let intro = '';
    let introC: HelpInline[] = [];
    if (blocks[0]?.k === 'p') {
        introC = blocks[0].c;
        intro = inlineText(introC);
        blocks.shift();
    }
    return { id, part: id[0] as HelpPartId, title: inlineText(parseInline(head[2], ctx)), intro, introC, blocks };
}

/** Plain text of the blocks before the first rule (for the versions the chapter describes). */
function introText(chapter: Omit<HelpChapter, 'desc'>): string {
    const texts = [chapter.intro];
    for (const b of chapter.blocks) {
        if (b.k === 'h') break;
        if (b.k === 'p') texts.push(inlineText(b.c));
    }
    return texts.join(' ');
}

function parseTerms(text: string, ctx: Ctx): Record<HelpLang, HelpTerm[]> {
    const out = Object.fromEntries(HELP_LANGS.map(l => [l, [] as HelpTerm[]])) as Record<HelpLang, HelpTerm[]>;
    const lines = stripComments(text).split('\n');
    let current: { id: string; rows: Partial<Record<HelpLang, { term: string; def: string }>>; refs: string[] } | null = null;
    const close = (): void => {
        if (!current) return;
        for (const lang of HELP_LANGS) {
            const row = current.rows[lang];
            if (row?.term) out[lang].push({ id: current.id, term: row.term, def: row.def, refs: current.refs });
        }
        current = null;
    };
    const refsLabel = new RegExp(`^[-*]\\s+\\*\\*${TERM_REFS_LABEL}:\\*\\*\\s*`);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const anchor = line.match(/^<a id="([^"]+)"><\/a>\s*$/);
        if (anchor) { close(); current = { id: anchor[1], rows: {}, refs: [] }; continue; }
        if (/^##\s/.test(line)) { close(); continue; }
        if (!current) continue;
        if (line.startsWith('|')) {
            const cells = tableCells(line);
            const lang = cells[0] as HelpLang;
            if (HELP_LANGS.includes(lang)) {
                const plain = (cell: string | undefined): string => inlineText(parseInline(cell ?? '', { ...ctx, lang })).trim();
                current.rows[lang] = { term: plain(cells[1]), def: plain(cells[2]) };
            }
            continue;
        }
        const refs = line.match(refsLabel);
        if (!refs) continue;
        let body = line.slice(refs[0].length);
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !LIST_ITEM.test(lines[i + 1])) body += ' ' + lines[++i].trim();
        const found: string[] = [];
        const add = (num: string): void => {
            for (const lang of HELP_LANGS) numberIn(ctx, lang, num, `the term "${current!.id}"`);
            const canonical = ctx.numbers.get('cs')!.get(num.toLowerCase())!;
            if (!found.includes(canonical)) found.push(canonical);
        };
        const rest = body.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (_all, _t: string, target: string) => {
            const frag = target.split('#')[1];
            const file = (target.split('#')[0].split('/').pop() ?? '').match(CHAPTER_FILE);
            const num = frag || file?.[1];
            if (num) add(num);
            return ' ';
        }).replace(/`[^`]*`/g, ' ');
        for (const [, num] of rest.matchAll(BARE_NUM)) add(num);
        current.refs = found;
    }
    close();
    return out;
}

// --- the whole bundle ------------------------------------------------------------

/** The chapter files of a language: chapter id → path. */
function chapterFiles(files: Record<string, string>, lang: HelpLang): Map<string, string> {
    const out = new Map<string, string>();
    for (const path of Object.keys(files).sort()) {
        const [dir, name, ...more] = path.split('/');
        if (dir !== lang || more.length || !name) continue;
        const m = name.match(CHAPTER_FILE);
        if (m) out.set(m[1], path);
    }
    return out;
}

/** The numbers (chapters and rules) of a language's texts: lower case → as written. */
function collectNumbers(files: Record<string, string>, chapters: Map<string, string>): Map<string, string> {
    const nums = new Map<string, string>();
    for (const path of chapters.values()) {
        let fence = false;
        for (const line of stripComments(files[path]).split('\n')) {
            if (line.trim().startsWith('```')) fence = !fence;
            if (fence) continue;
            const m = line.match(/^#{1,6}\s+(.*)$/)?.[1].match(HEADING_NUM);
            if (m) nums.set(m[1].toLowerCase(), m[1]);
        }
    }
    return nums;
}

/** Convert the strom-doc files (path → text) into the help of all four languages. */
export function convertHelp(files: Record<string, string>, docVersion: string): HelpBundle {
    const perLang = new Map(HELP_LANGS.map(l => [l, chapterFiles(files, l)]));
    const all = new Set([...perLang.values()].flatMap(m => [...m.keys()]));
    for (const lang of HELP_LANGS) {
        for (const id of all) {
            if (!perLang.get(lang)!.has(id)) {
                const other = HELP_LANGS.find(l => perLang.get(l)!.has(id))!;
                throw new HelpConvertError(`${lang} has no chapter ${id} (${other}/${perLang.get(other)!.get(id)!.split('/')[1]} exists)`);
            }
        }
        if (!files[`${lang}/README.md`]) throw new HelpConvertError(`${lang}/README.md (the contents) is missing`);
    }
    if (!all.size) throw new HelpConvertError('no chapters found');

    const numbers = new Map(HELP_LANGS.map(l => [l, collectNumbers(files, perLang.get(l)!)]));
    const termIds = new Set<string>();
    const index = files['REJSTRIK.md'] ?? '';
    for (const [, id] of index.matchAll(/^<a id="([^"]+)"><\/a>\s*$/gm)) termIds.add(id);

    const terms = parseTerms(index, { lang: 'cs', file: 'REJSTRIK.md', numbers, termIds });
    let describes: HelpDescribes = { app: '', research: '' };
    const langs = {} as Record<HelpLang, HelpLangData>;

    for (const lang of HELP_LANGS) {
        const readme = `${lang}/README.md`;
        const contents = parseContents(files[readme], { lang, file: readme, numbers, termIds });
        const listed = new Map(contents.entries.map(e => [e.id, e]));
        const chapters: HelpChapter[] = [];
        for (const [id, path] of perLang.get(lang)!) {
            const entry = listed.get(id);
            if (!entry) throw new HelpConvertError(`${readme}: chapter ${id} is not in the contents`);
            const chapter = parseChapter(id, files[path], { lang, file: path, numbers, termIds });
            const v = describedVersions(introText(chapter));
            describes = {
                app: v.app ? maxVersion(describes.app, v.app) : describes.app,
                research: v.research ? maxVersion(describes.research, v.research) : describes.research,
            };
            chapters.push({ ...chapter, desc: entry.desc });
        }
        const order = contents.entries.map(e => e.id);
        const partRank = (c: HelpChapter): number => HELP_PART_ORDER.indexOf(c.part);
        chapters.sort((a, b) => partRank(a) - partRank(b) || order.indexOf(a.id) - order.indexOf(b.id));
        const parts = HELP_PART_ORDER
            .map(id => contents.parts.find(p => p.id === id))
            .filter((p): p is HelpPart => !!p && chapters.some(c => c.part === p.id));
        for (const c of chapters) {
            if (!parts.some(p => p.id === c.part)) throw new HelpConvertError(`${readme}: no heading "## ${c.part} …" for chapter ${c.id}`);
        }
        langs[lang] = { parts, chapters, terms: terms[lang] };
    }
    return { docVersion, describes, langs };
}

// --- embedding -------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

/**
 * The bundle as the build embeds it: each language's JSON raw-deflated
 * (`deflateRaw`, e.g. zlib.deflateRawSync at level 9) and base64-encoded.
 */
export function embedHelp(bundle: HelpBundle, deflateRaw: (data: Uint8Array) => Uint8Array): EmbeddedHelp {
    const langs: EmbeddedHelp['langs'] = {};
    for (const lang of HELP_LANGS) {
        langs[lang] = toBase64(deflateRaw(new TextEncoder().encode(JSON.stringify(bundle.langs[lang]))));
    }
    return { docVersion: bundle.docVersion, describes: bundle.describes, langs };
}

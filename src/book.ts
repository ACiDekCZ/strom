/**
 * The family book ("Kniha rodu 2", 1031 §5, §6): the orchestrator. It takes
 * the tree and the book's options, protects the living, builds the chapter
 * model from the lineages and sets the blocks of src/book-blocks.ts into one
 * self-contained HTML document: the title page, the contents, a part per
 * lineage (its opening page, its line tree, its families), "Other families",
 * the sources and the index — as the enabled parts say.
 *
 * Pure and DOM-free; the same data and options give the same document (the
 * date and "now" are injected). Typesetting lives in src/book-css.ts.
 */

import { Partnership, Person, PersonId, PartnershipId, StromData, Story, StoryDraft } from './types.js';
import { applyLivingPrivacy, inferBirthUpperBounds, isLivingPerson, stripResearchWork } from './privacy.js';
import { stripMedia } from './attachments.js';
import { formatFlexDate, yearOf } from './dates.js';
import { getStringsForLang } from './strings.js';
import { researchOpenSvg } from './history-symbols.js';
import { proseHtml } from './story-text.js';
import { storyCompareHtml } from './story-compare.js';
import { shownName } from './person-name.js';
import { buildLineages } from './lineage.js';
import { PersonPageContext } from './person-page.js';
import { BookChapter, buildBookModel } from './book-model.js';
import { BookLang, BookOptions, BookParts, autoBookTitle, defaultBookOptions, effectiveBookParts, estimateBook } from './book-options.js';
import {
    BookCtx, BookLinkTarget, BookSourceNumbers, BookStoryExtras, familyChapterHtml, indexHtml, pairFirstNames, pairName,
    rodHasMaleLine, rodLabelOf, rodLineageHtml, rodOverviewHtml, smallRodsHtml, sourcesHtml,
} from './book-blocks.js';
import { BOOK_CSS, rodPagesCss } from './book-css.js';
import { BOOK_WINDOW_CSS, BOOK_WINDOW_SCRIPT, BookSideEntry, bookSideHtml, bookToolbarHtml } from './book-window.js';

export type { BookOptions, BookLang, BookDetail, BookParts, BookPreset, BookSelectionSpec, BookEstimate } from './book-options.js';
export { estimateBook, defaultBookOptions } from './book-options.js';

/** The options of one book: anything left out takes the default (defaultBookOptions). */
export type BookBuildOptions = Partial<BookOptions> & { lang: BookLang };

/** What the caller supplies besides the options (the window's world). */
export interface BookBuildEnv {
    /** The tree's name: the title of a whole-tree book. */
    treeName?: string;
    /** "compiled …" on the title page (supplied so the output is deterministic). */
    dateLabel?: string;
    /** The @font-face rules of the book's serif (the app's embedded faces + the italic). */
    fontCss?: string;
    /** The document is saved as a file: no research controls, the toolbar has Print only (§6.3). */
    forSave?: boolean;
    /** Today, for who is living and the person blocks (default: the clock). */
    now?: Date;
    /** The lineages of `data`, built once by the caller. */
    index?: ReturnType<typeof buildLineages>;
    /** The tree has a history layer (the "Period" part is possible). */
    hasHistory?: boolean;
    /** A person's history layer, as the person page gets it. */
    personHistory?: (personId: PersonId) => PersonPageContext['history'];
    /**
     * The strom-research:// link approving a person's draft story, or null
     * (a research tree whose research announced it). On screen only.
     */
    approveStoryUrl?: (person: Person) => string | null;
    /**
     * An approved story with a new version waiting (Story.draft): the links
     * that take it or keep the approved one ({} without links: the comparison
     * is read-only). On screen only: a banner above the story and the
     * comparison in a dialog of the book's window; never printed or saved.
     */
    storyDraftUrls?: (owner: { person: Person } | { couple: Partnership }) => { final?: string; keep?: string };
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Full options from a partial set (parts merged key by key). */
export function resolveBookOptions(options: BookBuildOptions): BookOptions {
    const base = defaultBookOptions(options.lang);
    return { ...base, ...options, parts: { ...base.parts, ...(options.parts ?? {}) } };
}

function linkTo(target: BookLinkTarget): string | null {
    if ('chapter' in target) return `#kap-${target.chapter}`;
    if ('rod' in target) return `#rod-${target.rod}`;
    return null;
}

/** "5" or "5–19". */
function range(chapters: readonly BookChapter[]): string {
    if (!chapters.length) return '';
    const a = chapters[0].no, b = chapters[chapters.length - 1].no;
    return a === b ? String(a) : `${a}–${b}`;
}

/** One line of the contents: "{no} {couple} · {gen}. gen. · {wedding year}", indented 18 px per generation. */
function tocFamilyHtml(ctx: BookCtx, ch: BookChapter): string {
    const B = getStringsForLang(ctx.lang).book;
    const u = ctx.tree.partnerships[ch.unionId];
    if (!u) return '';
    const wed = yearOf(u.startDate);
    const bits = [pairName(ctx, u), esc(B.generationsShort(ch.gen)), wed !== null ? String(wed) : ''].filter(Boolean).join(' · ');
    const indent = (Math.max(0, ch.gen - 1) + (ch.sub ? 1 : 0)) * 18;
    return `<li class="book-toc-fam${ch.sub ? ' book-toc-sub' : ''}" style="padding-left:${indent}px">`
        + `<a href="#kap-${ch.no}"><span class="book-toc-no">${ch.no}</span>${bits}</a></li>`;
}

/**
 * The contents (§5.2): the chapters in the line's order, without page numbers
 * (browsers cannot count them). A book of lineages lists each lineage with its
 * chapter range, its families under it; then the back of the book.
 */
export function tocHtml(ctx: BookCtx, parts: BookParts): string {
    const B = getStringsForLang(ctx.lang).book;
    const rows: string[] = [];
    if (ctx.model.groups.length) {
        ctx.model.groups.forEach((g, i) => {
            if (!g.chapters.length) return;
            const label = rodLabelOf(ctx, g.rod.id);
            rows.push(`<li class="book-toc-rod"><a href="#rod-${i + 1}">${esc(B.rodName(label))}</a> <span class="book-muted">· ${esc(B.chaptersRef(range(g.chapters)))}</span></li>`);
            for (const ch of g.chapters) rows.push(tocFamilyHtml(ctx, ch));
        });
    } else {
        for (const ch of ctx.model.chapters) rows.push(tocFamilyHtml(ctx, ch));
    }
    const back = (id: string, label: string): string => `<li class="book-toc-rod"><a href="#${id}">${esc(label)}</a></li>`;
    if (parts.smallRods && ctx.model.smallRods.length) rows.push(back('book-small-rods', B.parts.smallRods));
    if (parts.sources && ctx.sources.no.size) rows.push(back('book-sources', B.sources));
    if (parts.index) rows.push(back('book-index', B.index));
    return `<h2>${esc(B.contents)}</h2><ol>${rows.join('')}</ol>`;
}

/** The span of the book's dated records over the protected tree ('' without dates). */
function protectedPeriod(ctx: BookCtx): string {
    let from = Infinity, to = -Infinity;
    const see = (date: string | undefined): void => {
        const y = yearOf(date);
        if (y === null) return;
        if (y < from) from = y;
        if (y > to) to = y;
    };
    for (const id of ctx.model.personIds) {
        const p = ctx.tree.persons[id];
        if (!p || p.isPlaceholder) continue;
        see(p.birthDate);
        see(p.deathDate);
    }
    for (const ch of ctx.model.chapters) see(ctx.tree.partnerships[ch.unionId]?.startDate);
    if (from === Infinity) return '';
    return from === to ? String(from) : `${from}–${to}`;
}

/**
 * The side contents (§6.1): the title page, the contents, each lineage with
 * its line tree and chapters ("5 · Jan and Marie"), the back of the book.
 */
function bookSideEntries(ctx: BookCtx, parts: BookParts): BookSideEntry[] {
    const B = getStringsForLang(ctx.lang).book;
    const out: BookSideEntry[] = [{ kind: 'link', href: '#book-title-page', label: esc(B.win.titlePage) }];
    if (parts.toc) out.push({ kind: 'link', href: '#book-toc', label: esc(B.contents) });
    const chapter = (ch: BookChapter, kind: 'link' | 'sub'): BookSideEntry | null => {
        const u = ctx.tree.partnerships[ch.unionId];
        return u ? { kind, href: `#kap-${ch.no}`, label: B.win.chapter(ch.no, pairFirstNames(ctx, u)) } : null;
    };
    if (ctx.model.groups.length) {
        ctx.model.groups.forEach((g, i) => {
            if (!g.chapters.length) return;
            out.push({ kind: 'link', href: `#rod-${i + 1}`, label: esc(B.rodName(rodLabelOf(ctx, g.rod.id))) });
            if (parts.tree) out.push({ kind: 'sub', href: `#rod-${i + 1}-tree`, label: esc(B.parts.tree) });
            for (const ch of g.chapters) { const e = chapter(ch, 'sub'); if (e) out.push(e); }
        });
    } else {
        for (const ch of ctx.model.chapters) { const e = chapter(ch, 'link'); if (e) out.push(e); }
    }
    if (parts.smallRods && ctx.model.smallRods.length) out.push({ kind: 'link', href: '#book-small-rods', label: esc(B.parts.smallRods) });
    if (parts.sources && ctx.sources.no.size) out.push({ kind: 'link', href: '#book-sources', label: esc(B.sources) });
    if (parts.index) out.push({ kind: 'link', href: '#book-index', label: esc(B.index) });
    return out;
}

/** The license notice of the embedded serif (OFL 1.1 asks it to travel with the font). */
const FONT_NOTICE = 'Strom Serif: a modified (subsetted) version of Source Serif 4 (designed by Frank Grießhammer for Adobe), '
    + 'renamed as its Reserved Font Name requires. Copyright 2014 - 2021 Adobe Systems Incorporated, with Reserved Font Name "Source". '
    + 'Licensed under the SIL Open Font License, Version 1.1 (https://openfontlicense.org).';

/** Generate the complete family-book HTML for `data`. */
export function buildFamilyBook(data: StromData, options: BookBuildOptions, env: BookBuildEnv = {}): string {
    const opts = resolveBookOptions(options);
    const lang = opts.lang;
    const S = getStringsForLang(lang);
    const B = S.book;
    const now = env.now ?? new Date();
    const year = now.getFullYear();
    const index = env.index && env.index.data === data ? env.index : buildLineages(data);
    const parts = effectiveBookParts(data, opts, { index, ...(env.hasHistory !== undefined ? { hasHistory: env.hasHistory } : {}) });
    const model = buildBookModel(data, opts.selection, index);

    // Who is living is judged on the data before protection (the protection strips the very dates it reads).
    const bounds = inferBirthUpperBounds(data);
    const living = new Set<PersonId>();
    for (const p of Object.values(data.persons)) if (!p.isPlaceholder && isLivingPerson(p, year, bounds)) living.add(p.id);

    // Privacy before anything is rendered; only the living lose their sources (as on the person page).
    let tree = applyLivingPrivacy(data, opts.privacy, year, { keepDeceasedSources: true });
    if (opts.privacy === 'anonymous' || opts.privacy === 'minimal') {
        // "Living person" in the book's language, not the app's.
        for (const id of living) { const p = tree.persons[id]; if (p) p.firstName = S.privacy.livingPerson; }
    }
    // New versions of stories wait in the research's workshop: kept aside for the screen, gone from the tree.
    const personDrafts = new Map<PersonId, StoryDraft>();
    const coupleDrafts = new Map<PartnershipId, StoryDraft>();
    for (const p of Object.values(tree.persons)) if (p.story?.draft) personDrafts.set(p.id, p.story.draft);
    for (const u of Object.values(tree.partnerships)) if (u.story?.draft) coupleDrafts.set(u.id, u.story.draft);
    stripResearchWork(tree);
    if (!parts.media) tree = stripMedia(tree);

    // Research controls (compare a new version, approve a draft): on the screen only, never in a saved file.
    const openMark = `<span class="book-open-mark" title="${esc(S.research.opensInResearchTitle)}">${researchOpenSvg(12)}</span>`;
    const compareDialogs: string[] = [];
    const prose = (text: string, title?: string): string => proseHtml(text, { ...(title ? { title } : {}), headingLevel: 5, softBreak: 'space', dropStrayMarks: true });
    const plainName = (p?: Person): string => p ? shownName(p) : '?';
    const extras: BookStoryExtras | undefined = env.forSave ? undefined : {
        banner: (story: Story, owner) => {
            const draft = 'person' in owner ? personDrafts.get(owner.person.id) : coupleDrafts.get(owner.couple.id);
            if (!env.storyDraftUrls || story.status !== 'final' || !draft?.text.trim()) return '';
            const id = `bc-${compareDialogs.length + 1}`;
            const L = S.story;
            const day = draft.at ? formatFlexDate(draft.at, lang) || undefined : undefined;
            const who = 'person' in owner ? plainName(owner.person)
                : L.couple(plainName(tree.persons[owner.couple.person1Id]), plainName(tree.persons[owner.couple.person2Id]));
            const urls = env.storyDraftUrls(owner);
            const close = `<button type="button" class="bc-btn" data-compare-close>${esc(S.buttons.close)}</button>`;
            const foot = urls.final && urls.keep
                ? `${close}<span class="bc-gap"></span><a class="bc-btn" href="${esc(urls.keep)}" data-compare-do="keep">${esc(L.keepOld)}${openMark}</a><a class="bc-btn bc-btn--primary" href="${esc(urls.final)}" data-compare-do="final">${esc(L.takeNew)}${openMark}</a>`
                : `<div class="bc-msg">${esc(L.decideOnDesktop)}</div>${close}`;
            const target = 'person' in owner ? `data-story-person="${esc(owner.person.id)}"` : `data-story-couple="${esc(owner.couple.id)}"`;
            compareDialogs.push(`<dialog class="book-compare" id="${id}" ${target} aria-labelledby="${id}-h">`
                + `<div class="bc-head"><div><h2 id="${id}-h">${esc(L.compareTitle)}</h2><div class="bc-sub">${esc(L.compareSub(who, day))}</div></div><button type="button" class="bc-x" data-compare-close aria-label="${esc(S.buttons.close)}">&times;</button></div>`
                + `<div class="bc-body">${storyCompareHtml({ approved: story, draft }, L, { idPrefix: id, prose })}</div>`
                + `<div class="bc-foot${urls.final && urls.keep ? '' : ' bc-foot--note'}">${foot}</div></dialog>`);
            const sentence = esc(L.nvBook(day)).replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>');
            return `<div class="book-nv"><span>${sentence}</span><button type="button" class="book-nv-compare" data-story-compare="${id}">${esc(L.compare)}</button></div>`;
        },
        approve: (p: Person) => {
            const url = env.approveStoryUrl?.(p);
            return url ? `<p class="book-story-approve"><a href="${esc(url)}">${esc(S.research.approveStory)}${openMark}</a></p>` : '';
        },
    };

    const ctx: BookCtx = {
        mode: 'book', lang, privacy: opts.privacy, detail: opts.detail, parts, notes: opts.notes, research: opts.research,
        linkTo, tree, living, model, now,
        sources: new BookSourceNumbers(tree.sources ?? {}, parts.sources),
        ...(env.personHistory ? { personHistory: env.personHistory } : {}),
        ...(extras ? { extras } : {}),
        described: new Map(),
        protectedTree: { tree, privacy: opts.privacy, living, drafts: new Set(personDrafts.keys()), lineages: model.index, rodLabels: model.labels },
    };

    // ── The body: lineages (or the families of a book of ancestors / descendants) ──
    const body: string[] = [];
    const heads: string[] = [];
    if (model.groups.length) {
        model.groups.forEach((g, i) => {
            if (!g.chapters.length) return;
            const n = i + 1;
            heads[i] = B.rodName(rodLabelOf(ctx, g.rod.id));
            const lineage = parts.tree ? rodLineageHtml(g.rod, ctx, { breakBefore: rodHasMaleLine(g.rod, ctx), id: `rod-${n}-tree` }) : '';
            const chapters = g.chapters.map(ch => familyChapterHtml(ch, ctx)).join('');
            body.push(`<section class="book-sheet book-rod rod-${n}" id="rod-${n}">${rodOverviewHtml(g.rod, ctx)}${lineage}${chapters}</section>`);
        });
    } else if (model.chapters.length) {
        const chapters = model.chapters.map(ch => familyChapterHtml(ch, ctx)).join('');
        body.push(`<section class="book-sheet book-families"><h2>${esc(B.families)}</h2>${chapters}</section>`);
    }
    // Named pages need a name for every index, even of a group without chapters.
    const rodCss = rodPagesCss(model.groups.map((g, i) => heads[i] ?? B.rodName(g.label)));

    // ── The back of the book (after the chapters: the sources are numbered by then) ──
    const back: string[] = [];
    if (parts.smallRods && model.smallRods.length) {
        back.push(`<section class="book-sheet book-back" id="book-small-rods">${smallRodsHtml(model.smallRods, ctx)}</section>`);
    }
    if (parts.sources) {
        const list = sourcesHtml(ctx);
        if (list) back.push(`<section class="book-sheet book-back book-sources-page" id="book-sources">${list}</section>`);
    }
    if (parts.index) back.push(`<section class="book-sheet book-back book-index-page" id="book-index">${indexHtml(ctx)}</section>`);

    // ── The front: the title page and the contents ──
    const titleData = (opts.selection.kind === 'ancestors' || opts.selection.kind === 'descendants')
        && living.has(opts.selection.person) && opts.privacy !== 'full' ? tree : data;
    const title = opts.title?.trim()
        || autoBookTitle(titleData, opts.selection, lang, { ...(titleData === data ? { index } : {}), ...(env.treeName ? { treeName: env.treeName } : {}) });
    const period = protectedPeriod(ctx);
    const persons = [...model.personIds].filter(id => tree.persons[id] && !tree.persons[id].isPlaceholder).length;
    const meta = [B.persons(persons)];
    const front = `<section class="book-sheet book-front book-title-page" id="book-title-page"><div class="book-kicker">${esc(B.subtitle)}</div>`
        + `<h1>${esc(title)}</h1>${period ? `<div class="book-title-sub">${esc(period)}</div>` : ''}<hr class="book-rule">`
        + `<div class="book-title-meta">${esc(meta.join(' · '))}${env.dateLabel ? `<br>${esc(env.dateLabel)}` : ''}</div></section>`;
    const toc = parts.toc ? `<nav class="book-sheet book-front book-toc" id="book-toc">${tocHtml(ctx, parts)}</nav>` : '';

    // ── The window: the toolbar, the side contents (§6.1, §6.2) ──
    const pages = estimateBook(data, opts, { index, ...(env.hasHistory !== undefined ? { hasHistory: env.hasHistory } : {}) }).pages;
    const toolbar = bookToolbarHtml(lang, title, pages, !!env.forSave);
    const side = bookSideHtml(lang, bookSideEntries(ctx, parts));
    const fonts = (env.fontCss ?? '').replace(/<\//g, '<\\/');
    // The embedded font travels with a saved book: its notice goes with it.
    const fontNotice = fonts ? `<!-- ${FONT_NOTICE} -->\n` : '';

    return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${fontNotice}<style>${fonts}
${BOOK_CSS}
${BOOK_WINDOW_CSS}
${rodCss}</style></head><body>
${toolbar}
<div class="book-layout">
${side}
<main class="book">
${front}
${toc}
${body.join('\n')}
${back.join('\n')}
</main>
</div>
${compareDialogs.join('\n')}
<script>${BOOK_WINDOW_SCRIPT}</script>
</body></html>`;
}

/**
 * The comparison of an approved story with its waiting new version, as HTML:
 * a switch (Changes / New version / Approved) and its three panels. Pure and
 * DOM-free, so the app's dialog (src/ui/story-compare-ui.ts) and the family
 * book's window (src/book.ts) set the very same thing; `wireStoryCompare`
 * gives it life in either document, and STORY_COMPARE_CSS styles it in either
 * (the app's tokens where it has them, the book's paper colours otherwise).
 *
 * The difference is never shown by colour alone: added text is underlined
 * (<ins>), removed text struck through (<del>), and a screen reader hears
 * "added:" / "removed:" before each run.
 */

import { Story, StoryDraft } from './types.js';
import { getStringsForLang } from './strings.js';
import { diffStoryText, diffStoryLines, StoryPara, StorySeg, StoryParaDiff } from './story-diff.js';
import { storyBasisDetailsHtml, StoryBasisShown, StoryBasisWords } from './story-sources.js';

type StoryStrings = ReturnType<typeof getStringsForLang>['story'];

export interface StoryCompareInput {
    /** The approved story as it is now (in the person dialog: the text in the field). */
    approved: Pick<Story, 'title' | 'text' | 'facts' | 'note' | 'sources'>;
    draft: StoryDraft;
}

export interface StoryCompareOptions {
    /** Ids of the panels start with it (one document may hold several comparisons). */
    idPrefix: string;
    /** The prose of a whole version, as the reader / the book set it. */
    prose: (text: string, title?: string) => string;
    /**
     * What a version's text is based on (storyBasisShown over the tree: the
     * sources once, the facts readable, the caveat) and the section's words;
     * none: not shown (the facts are never shown raw).
     */
    basis?: { shown: (v: Pick<Story, 'sources' | 'facts' | 'note'>) => StoryBasisShown; words: StoryBasisWords };
    /** Applied to both versions' text first: the research's bare source codes named (sourceCodeNamer). */
    name?: (text: string) => string;
}

export type StoryCompareView = 'changes' | 'new' | 'old';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Text of a run: escaped, line breaks kept, bold set bold. */
function segHtml(seg: StorySeg): string {
    const html = esc(seg.text).replace(/\n/g, '<br>');
    return seg.bold ? `<strong>${html}</strong>` : html;
}

const paraBody = (p: StoryPara): string => p.segs.map(segHtml).join('');

export function storyCompareHtml(input: StoryCompareInput, L: StoryStrings, opts: StoryCompareOptions): string {
    const nm = opts.name ?? ((t: string): string => t);
    const approved = { ...input.approved, text: nm(input.approved.text) };
    const draft = { ...input.draft, text: nm(input.draft.text) };
    const id = opts.idPrefix;
    const ins = (html: string): string => `<ins data-sr="${esc(L.srAdded)}">${html}</ins>`;
    const del = (html: string): string => `<del data-sr="${esc(L.srRemoved)}">${html}</del>`;
    const diff = diffStoryText(approved.text, draft.text, approved.title, draft.title ?? approved.title);

    // ---- Changes: the fields that differ, the text paragraph by paragraph
    const paraHtml = (p: StoryParaDiff): string => {
        switch (p.kind) {
            case 'same':
                return `<p class="${p.para.heading ? 'sc-subhead' : ''}">${paraBody(p.para)}</p>`;
            case 'changed': {
                const body = p.ops.map(op => op.op === 'eq' ? segHtml(op) : op.op === 'add' ? ins(segHtml(op)) : del(segHtml(op))).join('');
                return `<p class="${p.heading ? 'sc-subhead' : ''}">${body}</p>`;
            }
            case 'added':
                return `<div class="sc-para sc-para--add"><span class="sc-tag sc-tag--add">${esc(L.paraNew)}</span><p class="${p.para.heading ? 'sc-subhead' : ''}">${ins(paraBody(p.para))}</p></div>`;
            case 'removed':
                return `<div class="sc-para sc-para--del"><span class="sc-tag sc-tag--del">${esc(L.paraRemoved)}</span><p class="${p.para.heading ? 'sc-subhead' : ''}">${del(paraBody(p.para))}</p></div>`;
        }
    };
    const text: string[] = [];
    for (let i = 0; i < diff.paras.length; i++) {
        const p = diff.paras[i];
        if (p.kind !== 'same' || !diff.collapse) { text.push(paraHtml(p)); continue; }
        // A run of unchanged paragraphs folds into one line; "Show" opens it in place.
        let k = i;
        while (k + 1 < diff.paras.length && diff.paras[k + 1].kind === 'same') k++;
        const run = diff.paras.slice(i, k + 1) as Extract<StoryParaDiff, { kind: 'same' }>[];
        text.push(`<details class="sc-run"><summary><span>${esc(L.unchangedRun(run[0].n, run[run.length - 1].n))} · <span class="sc-run-show">${esc(L.showUnchanged)}</span></span></summary>${run.map(paraHtml).join('')}</details>`);
        i = k;
    }

    const rows: string[] = [];
    const row = (label: string, value: string, cls = ''): void => {
        rows.push(`<div class="sc-label">${esc(label)}</div><div class="sc-value${cls}">${value}</div>`);
    };
    // A draft without a title says nothing about the title: no row.
    const newTitle = draft.title?.trim();
    const oldTitle = approved.title?.trim() ?? '';
    if (newTitle && newTitle !== oldTitle) {
        const before = oldTitle ? del(esc(oldTitle)) : `<span class="sc-none">${esc(L.noTitle)}</span>`;
        row(L.fieldTitle, `${before}<span class="sc-arrow" aria-hidden="true">→</span>${ins(esc(newTitle))}`, ' sc-value--title');
    }
    row(L.fieldText, text.join(''), ' sc-value--text');
    const extra: string[] = [];
    const lines = (added: string[], removed: string[], cls = ''): string =>
        [...added.map(f => `<div class="sc-line sc-line--add${cls}"><span class="sc-mark" aria-hidden="true">+</span>${ins(esc(f))}</div>`),
            ...removed.map(f => `<div class="sc-line sc-line--del${cls}"><span class="sc-mark" aria-hidden="true">−</span>${del(esc(f))}</div>`)].join('');
    // What the versions are based on: the sources and the facts the new version adds or leaves out, readable.
    const newBasis = opts.basis?.shown({ sources: draft.sources, facts: draft.facts, note: draft.note ?? approved.note });
    const oldBasis = opts.basis?.shown(approved);
    if (opts.basis && newBasis && oldBasis) {
        const src = diffStoryLines(oldBasis.sources.map(x => x.title), newBasis.sources.map(x => x.title));
        const facts = diffStoryLines(oldBasis.facts, newBasis.facts);
        const body = lines(src.added, src.removed) + lines(facts.added, facts.removed);
        if (body) extra.push(`<div class="sc-label">${esc(opts.basis.words.head)}</div><div class="sc-value">${body}</div>`);
    }
    // A draft without a caveat leaves the caveat as it is.
    const newNote = draft.note?.trim();
    const oldNote = approved.note?.trim() ?? '';
    if (newNote && newNote !== oldNote) {
        extra.push(`<div class="sc-label">${esc(L.fieldNote)}</div><div class="sc-value">${lines([newNote], oldNote ? [oldNote] : [], ' sc-line--note')}</div>`);
    }
    const changes = `<div class="sc-grid">${rows.join('')}</div>${extra.length > 0 ? `<div class="sc-rule"></div><div class="sc-grid sc-grid--small">${extra.join('')}</div>` : ''}`;

    // ---- New version / Approved: clean prose, as the reader sets it
    const version = (title: string | undefined, body: string, basis: StoryBasisShown | undefined, note: string | undefined): string =>
        `${title ? `<h3 class="sc-title">${esc(title)}</h3>` : ''}<div class="sc-prose">${opts.prose(body, title)}</div>`
        // One folded section, as under the story in the reader; without it the caveat alone.
        + (basis && opts.basis ? storyBasisDetailsHtml(basis, opts.basis.words, { cls: 'sc-basis' })
            : note ? `<div class="sc-extra"><p class="sc-note">${esc(note)}</p></div>` : '');
    const newPanel = version(newTitle || approved.title, draft.text, newBasis, draft.note ?? approved.note);
    const oldPanel = `<div class="sc-approved"><span class="sc-tag sc-tag--ok">${esc(L.approvedTag)}</span><span>${esc(L.approvedNote)}</span></div>${version(approved.title, approved.text, oldBasis, approved.note)}`;

    // ---- The switch: the legend in Changes, or how much changed in a long text
    const tab = (view: StoryCompareView, label: string): string =>
        `<button type="button" role="tab" class="sc-tab sel-tab" data-sel-dir="down" id="${id}-tab-${view}" data-view="${view}" aria-controls="${id}-${view}" aria-selected="${view === 'changes'}" tabindex="${view === 'changes' ? 0 : -1}"><span class="sel-l" data-label="${esc(label)}">${esc(label)}</span></button>`;
    const legend = diff.collapse && diff.total >= 3
        ? `<span class="sc-count">${esc(L.changedParas(diff.changed, diff.total))}</span>`
        : `<span class="sc-legend"><span class="sc-key sc-key--add">${esc(L.legendAdded)}</span><span class="sc-key sc-key--del">${esc(L.legendRemoved)}</span></span>`;
    const panel = (view: StoryCompareView, html: string): string =>
        `<div role="tabpanel" class="sc-panel sc-panel--${view}" id="${id}-${view}" aria-labelledby="${id}-tab-${view}"${view === 'changes' ? '' : ' hidden'}>${html}</div>`;

    return `<div class="sc" data-view="changes">`
        + `<div class="sc-bar"><div class="sc-tabs" role="tablist" aria-label="${esc(L.viewTabsLabel)}">${tab('changes', L.viewChanges)}${tab('new', L.viewNew)}${tab('old', L.viewOld)}</div><div class="sc-bar-note">${legend}</div></div>`
        + panel('changes', changes) + panel('new', newPanel) + panel('old', oldPanel)
        + `</div>`;
}

/**
 * The switch at work, in whichever document the comparison lives in (the
 * app's or the book's window): a click or the arrow keys pick the view.
 */
export function wireStoryCompare(root: Element): void {
    const sc = root.querySelector<HTMLElement>('.sc');
    if (!sc) return;
    const tabs = [...sc.querySelectorAll<HTMLButtonElement>('.sc-tab')];
    const show = (tab: HTMLButtonElement, focus: boolean): void => {
        sc.dataset.view = tab.dataset.view;
        for (const t of tabs) {
            const on = t === tab;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
            const panel = sc.querySelector<HTMLElement>(`#${t.getAttribute('aria-controls')}`);
            if (panel) panel.hidden = !on;
        }
        if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => show(tab, false));
        tab.addEventListener('keydown', (e) => {
            const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            show(tabs[(i + step + tabs.length) % tabs.length], true);
        });
    });
}

/**
 * The comparison's look. The app's tokens when it has them (light and dark),
 * the book's paper colours otherwise. The selection indicator's rules
 * (src/ui/sel-css.ts) are the host's: index.html in the app, BOOK_CSS in the
 * book; never repeated here, where a copy injected after index.html would win
 * over the app's own component rules.
 */
export const STORY_COMPARE_CSS = `
.sc { --sc-add-bg: var(--diff-add-bg, #e3eee5); --sc-add-text: var(--diff-add-text, #24452f); --sc-add-line: var(--diff-add-line, #3f6b4f);
      --sc-del-bg: var(--diff-del-bg, #f4e1dc); --sc-del-text: var(--diff-del-text, #8a3f33);
      --sc-label: var(--accent-text, #8a5528); --sc-muted: var(--text-light, #5c5546); --sc-faint: var(--text-faint, #746c5c);
      --sc-rule: var(--divider, #ece5d6); --sc-border: var(--border, #ddd4c2); --sc-surface: var(--surface, #fffdf8); --sc-surface-2: var(--surface-2, #f6f2ea);
      --sc-serif: var(--font-serif, 'Strom Serif', Georgia, serif); --sc-sans: var(--font-sans, system-ui, sans-serif);
      font-family: var(--sc-sans); color: var(--text, #2b2822); }
.sc ins, .sc del { border-radius: 3px; padding: 0 1px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.sc ins { background: var(--sc-add-bg); color: var(--sc-add-text); text-decoration: underline; text-decoration-color: var(--sc-add-line); text-underline-offset: 3px; }
.sc del { background: var(--sc-del-bg); color: var(--sc-del-text); text-decoration: line-through; }
.sc ins::before, .sc del::before { content: attr(data-sr) " "; position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.sc-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 0 0 14px; margin-bottom: 18px; border-bottom: 1px solid var(--sc-rule); }
.sc-tabs { display: flex; gap: 2px; }
/* .sc .sc-tab: over a host's own button rules (the app's .modal button); the tab is a .sel-tab, its look the host's. */
.sc .sc-tab { padding: 6px 12px; border: 0; background: transparent; font-family: inherit; font-size: 13px; line-height: 1.4; cursor: pointer; }
.sc-bar-note { font-size: 12px; color: var(--sc-muted); }
.sc:not([data-view="changes"]) .sc-bar-note { display: none; }
.sc-legend { display: inline-flex; gap: 14px; }
.sc-key { padding: 0 3px; border-radius: 3px; }
.sc-key--add { background: var(--sc-add-bg); color: var(--sc-add-text); text-decoration: underline; text-decoration-color: var(--sc-add-line); text-underline-offset: 3px; }
.sc-key--del { background: var(--sc-del-bg); color: var(--sc-del-text); text-decoration: line-through; }
.sc-count { font-size: 13px; }
.sc-panel[hidden] { display: none; }
.sc-grid { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px 14px; align-items: baseline; }
.sc-grid--small { font-size: 13px; line-height: 1.5; color: var(--sc-muted); gap: 8px 14px; }
.sc-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-label); }
.sc-value--title { font-family: var(--sc-serif); font-size: 18px; font-weight: 600; }
.sc-none { font-family: var(--sc-sans); font-size: 13px; font-weight: 400; font-style: italic; color: var(--sc-faint); }
.sc-arrow { padding: 0 8px; font-weight: 400; color: var(--sc-faint); }
.sc-value--text { font-family: var(--sc-serif); font-size: 17px; line-height: 1.75; max-width: 62ch; text-wrap: pretty; }
.sc-value--text p { margin: 0 0 0.9em; }
.sc-value--text > :last-child, .sc-value--text details > :last-child { margin-bottom: 0; }
.sc-subhead { font-weight: 600; }
.sc-para { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 0.9em; }
.sc-para p { margin: 0; }
.sc-para ins, .sc-para del { padding: 1px 3px; }
.sc-tag { flex-shrink: 0; margin-top: 5px; padding: 1px 7px; border-radius: 999px; font-family: var(--sc-sans); font-size: 11px; font-weight: 600; line-height: 1.5; }
.sc-tag--add { background: var(--sc-add-bg); color: var(--sc-add-text); }
.sc-tag--del { background: var(--sc-del-bg); color: var(--sc-del-text); }
.sc-tag--ok { margin-top: 0; background: var(--primary-soft, #e6efe8); color: var(--primary-dark, #2d5340); }
.sc-run { margin: 0 0 0.9em; }
.sc-run > summary { display: flex; align-items: center; gap: 10px; list-style: none; cursor: pointer; font-family: var(--sc-sans); font-size: 13px; line-height: 1.5; color: var(--sc-faint); }
.sc-run > summary::-webkit-details-marker { display: none; }
.sc-run > summary::before, .sc-run > summary::after { content: ''; flex: 1; height: 1px; background: repeating-linear-gradient(90deg, var(--sc-border) 0 4px, transparent 4px 8px); }
.sc-run[open] > summary { display: none; }
.sc-run-show { color: var(--primary, #3f6b4f); text-decoration: underline; }
.sc-rule { height: 1px; margin: 18px 0; background: var(--sc-rule); }
.sc-line { display: flex; gap: 8px; }
.sc-line ins, .sc-line del { background: none; padding: 0; text-decoration-thickness: 1px; }
.sc-line--add ins { text-decoration: none; }
.sc-line--note ins, .sc-line--note del { font-style: italic; }
.sc-mark { width: 10px; flex-shrink: 0; font-weight: 600; }
.sc-line--add .sc-mark { color: var(--sc-add-line); }
.sc-line--del .sc-mark { color: var(--sc-del-text); }
.sc-title { font-family: var(--sc-serif); font-size: 22px; font-weight: 600; line-height: 1.3; margin: 0 0 14px; }
.sc-prose { font-family: var(--sc-serif); font-size: 17px; line-height: 1.65; max-width: 62ch; text-wrap: pretty; }
.sc-prose p { margin: 0 0 0.9em; }
.sc-prose > :last-child { margin-bottom: 0; }
.sc-prose .story-subhead { font-size: 18px; font-weight: 600; margin: 1.3em 0 0.4em; }
.sc-prose ul { margin: 0 0 0.9em; padding-left: 1.3em; }
.sc-extra { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--sc-rule); font-size: 13px; line-height: 1.5; color: var(--sc-muted); }
.sc-extra ul { margin: 6px 0 8px; padding-left: 18px; }
.sc-note { margin: 0; font-style: italic; }
.sc-basis { margin-top: 14px; font-size: 13px; line-height: 1.5; color: var(--sc-muted); }
.sc-basis-sum { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; max-width: 100%; list-style: none; cursor: pointer; color: var(--primary, #8a5a2b); font-weight: 600; border-radius: 6px; }
.sc-basis-sum::-webkit-details-marker { display: none; }
.sc-basis-sum:focus-visible { outline: 2px solid var(--primary, #8a5a2b); outline-offset: 2px; }
.sc-basis-chev { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; line-height: 1; }
.sc-basis[open] .sc-basis-chev { transform: rotate(90deg); }
.sc-basis-body { margin-top: 6px; padding: 10px 14px; border-radius: 8px; background: var(--sc-surface-2); overflow-wrap: anywhere; }
.sc-basis-h { margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sc-faint); }
.sc-basis-list { margin: 0 0 10px; padding-left: 18px; }
.sc-basis-list li { margin: 2px 0; }
.sc-basis-list a { color: var(--primary, #8a5a2b); }
.sc-basis-note { margin: 0; font-style: italic; }
@media (pointer: coarse) { .sc-basis-sum { min-height: 44px; } .sc-basis-src a { display: inline-flex; align-items: center; min-height: 44px; } }
.sc-approved { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 12px; color: var(--sc-muted); }
@media (max-width: 640px) {
    .sc-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); width: 100%; }
    .sc .sc-tab { min-height: 44px; padding: 10px 4px; font-size: 14px; }
    .sc-grid { grid-template-columns: minmax(0, 1fr); gap: 4px; }
    .sc-grid > .sc-value { margin-bottom: 10px; }
    .sc-value--text, .sc-prose { font-size: 16px; }
    .sc-value--title { font-size: 17px; }
}
`;

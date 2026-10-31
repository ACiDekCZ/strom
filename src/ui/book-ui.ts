/**
 * The family book's options dialog (1031 §4) and its window (§6.1, §6.2).
 *
 * The dialog: presets in the header; on the left what goes in the book (the
 * whole tree, lineages, the ancestors or descendants of a person), the parts,
 * the detail, notes and researcher data, privacy, the book's language and the
 * title; on the right a live preview of the title page, the outline, the
 * estimate and "Open book". Every change recomputes the estimate without
 * building the book (estimateBook) and is remembered for the tree
 * (src/book-memory.ts: everything but the selection and the title). On a phone
 * the options are rows with a summary, each opening a sub-sheet.
 *
 * The book window: written by the app, its buttons with `data-book-act` wired
 * here — Change options (the dialog again, then the same window rewritten),
 * Save as HTML (a self-contained file without research controls), Share.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage, getStringsForLang } from '../strings.js';
import { PrivacyMode } from '../privacy.js';
import { PersonId, StromData } from '../types.js';
import { buildFamilyBook } from '../book.js';
import { bookFileName } from '../book-window.js';
import {
    BOOK_PART_KEYS, BookDetail, BookLang, BookOptions, BookPartKey, BookSelectionSpec,
    applyBookPreset, autoBookTitle, bookPartAvailability, bookPeriod, bookPresetOf, bookRodCounts, estimateBook,
} from '../book-options.js';
import {
    BOOK_GENERATIONS_DEFAULT, BOOK_GENERATIONS_MAX, BOOK_GENERATIONS_MIN, BookEntry,
    bookEntrySelection, bookOptionsFromMemory, bookRodChoices, clampBookGenerations, loadBookMemory, saveBookMemory,
} from '../book-memory.js';
import { LineageIndex, RodId, buildLineages, rodLabels } from '../lineage.js';
import { chapterRods } from '../book-model.js';
import { bookItalicFontCss } from '../book-font.js';
import { appFontFaceCss, POSTER_SERIF_FACES } from '../poster-fonts.js';
import { shownName } from '../person-name.js';
import { displayYear } from '../dates.js';
import { openPersonPopover } from './person-popover.js';
import { readRecent } from './tree-overview.js';
import { uiModule } from './module.js';

type Kind = 'tree' | 'rods' | 'ancestors' | 'descendants';
type PersonKind = 'ancestors' | 'descendants';
/** The phone's sub-sheets (§4.1, 4b). */
type Sub = 'sel' | 'parts' | 'detail' | 'notes' | 'privacy' | 'lang' | 'title';

const KINDS: readonly Kind[] = ['tree', 'rods', 'ancestors', 'descendants'];
const DETAILS: readonly BookDetail[] = ['brief', 'normal', 'all'];
const PRIVACY: readonly PrivacyMode[] = ['full', 'initials', 'minimal', 'anonymous'];
const LANGS: readonly BookLang[] = ['cs', 'en', 'de'];

interface DialogState {
    data: StromData;
    index: LineageIndex;
    treeId: string | null;
    treeName: string;
    appLang: BookLang;
    hasHistory: boolean;
    kind: Kind;
    /** The chosen lineages, the person and the generations: kept while another kind is chosen. */
    rods: RodId[];
    person: PersonId | null;
    gens: Record<PersonKind, number>;
    /** The options apart from the selection (that one comes from kind / rods / person). */
    opts: BookOptions;
    titleEdited: boolean;
    /** The book window to rewrite ("Change options"), or null for a new one. */
    win: Window | null;
    sub: Sub | null;
}

let st: DialogState | null = null;
let closePicker: (() => void) | null = null;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function appBookLang(): BookLang {
    const cur = getCurrentLanguage();
    return cur === 'cs' ? 'cs' : cur === 'de' ? 'de' : 'en';
}

function storage(): Storage | null {
    try { return window.localStorage; } catch { return null; }
}

/** The selection the state describes, or null (a person kind without a person). */
function selectionOf(s: DialogState): BookSelectionSpec | null {
    switch (s.kind) {
        case 'tree': return { kind: 'tree' };
        case 'rods': return { kind: 'rods', rods: [...s.rods] };
        default: return s.person ? { kind: s.kind, person: s.person, generations: s.gens[s.kind] } : null;
    }
}

/** The book can be opened: something is chosen. */
function selectionReady(sel: BookSelectionSpec | null): sel is BookSelectionSpec {
    return !!sel && !(sel.kind === 'rods' && sel.rods.length === 0);
}

function currentOptions(s: DialogState): BookOptions {
    const sel = selectionOf(s) ?? { kind: 'tree' as const };
    const { title: _title, ...rest } = s.opts;
    void _title;
    return { ...rest, selection: sel, ...(s.titleEdited && s.opts.title?.trim() ? { title: s.opts.title.trim() } : {}) };
}

function autoTitle(s: DialogState): string {
    const sel = selectionOf(s) ?? { kind: 'tree' as const };
    return autoBookTitle(s.data, sel, s.opts.lang, { index: s.index, treeName: s.treeName });
}

function personLabel(data: StromData, id: PersonId | null): string {
    const p = id ? data.persons[id] : undefined;
    if (!p || p.isPlaceholder) return '';
    const b = displayYear(p.birthDate), d = displayYear(p.deathDate);
    const years = b || d ? ` (${b}–${d})` : '';
    return shownName(p) + years;
}

/** "Rod Fíšek · kap. 1–19" → ["Rod Fíšek", "kap. 1–19"]. */
function splitOutline(line: string): [string, string] {
    const at = line.lastIndexOf(' · ');
    return at < 0 ? [line, ''] : [line.slice(0, at), line.slice(at + 3)];
}

function canShareFiles(win: Window): boolean {
    try {
        const nav = win.navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
        return typeof nav.share === 'function' && !!nav.canShare?.({ files: [new File([''], 'x.html', { type: 'text/html' })] });
    } catch {
        return false;
    }
}

/** The options' markup (once per opening; sync() keeps it current). */
function optionsHtml(s: DialogState): string {
    const T = strings.book;
    const D = T.dlg;
    const counts = bookRodCounts(s.data, { index: s.index });
    const persons = Object.values(s.data.persons).filter(p => !p.isPlaceholder).length;
    const hint: Record<Kind, string> = {
        tree: D.treeHint(persons, counts.rods, counts.other),
        rods: D.kindHint.rods, ancestors: D.kindHint.ancestors, descendants: D.kindHint.descendants,
    };
    const kinds = KINDS.map(k => `<label class="book-kind" data-kind="${k}">`
        + `<input type="radio" name="book-kind" value="${k}">`
        + `<span class="book-kind-text"><span class="book-kind-t">${esc(D.kind[k])}</span><span class="book-kind-h">${esc(hint[k])}</span></span>`
        + (k === 'tree' ? '' : `<button type="button" class="book-kind-sum" data-sub-open="sel" tabindex="-1"><span class="book-sum-v"></span><span class="book-chev" aria-hidden="true">›</span></button>`)
        + `</label>`).join('');
    const labels = rodLabels(s.index);
    const rods = chapterRods(s.index).map(r => {
        const period = r.period ? `${r.period.from}–${r.period.to}` : '';
        return `<label class="book-rod-row"><input type="checkbox" value="${esc(r.id)}">`
            + `<span class="book-rod-name">${esc(labels.get(r.id) ?? r.surname)}</span>`
            + `<span class="book-rod-meta">${esc(D.rodMeta(r.realMemberCount, period))}</span></label>`;
    }).join('');
    const parts = BOOK_PART_KEYS.map(k => `<label class="book-part" data-part="${k}"><input type="checkbox" value="${k}">`
        + `<span class="book-part-text"><span class="book-part-t">${esc(T.parts[k])}</span><span class="book-part-r"></span></span></label>`).join('');
    const seg = (name: string, items: ReadonlyArray<[string, string]>, label: string): string =>
        `<div class="book-seg" role="radiogroup" aria-label="${esc(label)}">`
        + items.map(([v, l]) => `<button type="button" role="radio" data-${name}="${v}">${esc(l)}</button>`).join('') + `</div>`;
    const sw = (key: 'notes' | 'research', title: string, hintText: string): string =>
        `<div class="book-switch-row"><button type="button" class="book-switch" role="switch" data-switch="${key}" aria-labelledby="book-sw-${key}">`
        + `<span class="book-switch-track" aria-hidden="true"></span></button>`
        + `<div class="book-switch-text"><span class="book-switch-t" id="book-sw-${key}">${esc(title)}</span><span class="book-hint">${esc(hintText)}</span></div></div>`;
    const privacyLabel: Record<PrivacyMode, string> = {
        full: strings.privacy.modeFull, initials: strings.privacy.modeInitials,
        minimal: strings.privacy.modeMinimal, anonymous: strings.privacy.modeAnonymous,
    };
    const sum = (sub: Sub, label: string): string =>
        `<button type="button" class="book-sum-row" data-sub-open="${sub}"><span class="book-sum-l">${esc(label)}</span>`
        + `<span class="book-sum-v" data-sum="${sub}"></span><span class="book-chev" aria-hidden="true">›</span></button>`;
    return `<div class="book-sub-head"><button type="button" class="book-sub-back"><span aria-hidden="true">‹</span> ${esc(D.back)}</button>`
        + `<span class="book-sub-title"></span></div>`
        + `<section class="book-sec book-sec-what" data-sec="what"><h3 class="book-sec-h" id="book-what-h">${esc(D.what)}</h3>`
        + `<div class="book-kinds" role="radiogroup" aria-labelledby="book-what-h">${kinds}`
        + `<div class="book-kind book-kind--house" aria-disabled="true"><input type="radio" disabled tabindex="-1" aria-hidden="true">`
        + `<span class="book-kind-text"><span class="book-kind-h">${esc(D.house)}</span></span></div></div></section>`
        + `<section class="book-sec book-sec-sel" data-sec="sel"><h3 class="book-sec-h book-sub-only" data-sub-title></h3>`
        + `<div class="book-sel book-sel-tree"><p class="book-hint">${esc(D.treeSentence)}</p></div>`
        + `<div class="book-sel book-sel-rods">`
        + (rods ? `<div class="book-rods-list">${rods}</div>` : `<p class="book-hint">${esc(D.noRods)}</p>`)
        + (counts.other ? `<p class="book-rods-small">${esc(D.rodsSmall(counts.other))}</p>` : '') + `</div>`
        + `<div class="book-sel book-sel-person"><div class="book-person-line"><span class="book-person-l">${esc(D.person)}</span>`
        + `<button type="button" class="book-person-btn" aria-haspopup="listbox" aria-expanded="false"><span class="book-person-name"></span><span class="book-caret" aria-hidden="true">▾</span></button>`
        + `<span class="book-gens"><button type="button" class="book-step" data-gen="-1" aria-label="${esc(D.fewer)}">−</button>`
        + `<output class="book-gens-n" aria-live="polite"></output>`
        + `<button type="button" class="book-step" data-gen="1" aria-label="${esc(D.more)}">+</button></span></div>`
        + `<p class="book-hint book-gens-t"></p></div></section>`
        + `<div class="book-sum">${sum('parts', D.parts)}${sum('detail', D.detail)}${sum('notes', D.notesRow)}`
        + `${sum('privacy', D.privacy)}${sum('lang', D.lang)}${sum('title', D.title)}</div>`
        + `<section class="book-sec" data-sec="parts"><h3 class="book-sec-h">${esc(D.parts)}</h3><div class="book-parts">${parts}</div></section>`
        + `<section class="book-sec" data-sec="detail"><h3 class="book-sec-h">${esc(D.detail)}</h3><div class="book-detail-line">`
        + seg('detail', DETAILS.map(d => [d, T.detail[d]] as [string, string]), D.detail)
        + `<p class="book-hint book-detail-hint"></p></div></section>`
        + `<section class="book-sec" data-sec="notes"><h3 class="book-sec-h book-sub-only">${esc(D.notesRow)}</h3>`
        + sw('notes', D.notes, D.notesHint) + sw('research', D.research, D.researchHint) + `</section>`
        + `<div class="book-pair">`
        + `<section class="book-sec" data-sec="privacy"><h3 class="book-sec-h" id="book-privacy-h">${esc(D.privacy)}</h3>`
        + `<div class="book-radios" role="radiogroup" aria-labelledby="book-privacy-h">`
        + PRIVACY.map(m => `<label class="book-radio"><input type="radio" name="book-privacy" value="${m}"><span>${esc(privacyLabel[m])}</span></label>`).join('')
        + `</div><p class="book-hint">${esc(D.privacyHint)}</p></section>`
        + `<section class="book-sec" data-sec="lang"><h3 class="book-sec-h">${esc(D.lang)}</h3>`
        + seg('lang', LANGS.map(l => [l, D.langName[l]] as [string, string]), D.lang)
        + `<p class="book-hint">${esc(D.langHint)}</p></section></div>`
        + `<section class="book-sec" data-sec="title"><h3 class="book-sec-h"><label for="book-title-input">${esc(D.title)}</label></h3>`
        + `<input type="text" id="book-title-input" class="book-title-input" autocomplete="off" spellcheck="false">`
        + `<p class="book-hint book-title-note"></p></section>`;
}

function setText(root: ParentNode, sel: string, text: string): void {
    root.querySelectorAll<HTMLElement>(sel).forEach(el => { if (el.textContent !== text) el.textContent = text; });
}

/** Bring every control, the preview, the outline and the estimate up to date. */
function sync(s: DialogState): void {
    const modal = document.querySelector<HTMLElement>('#book-modal .book-dlg');
    if (!modal) return;
    const T = strings.book;
    const D = T.dlg;
    const BL = getStringsForLang(s.opts.lang).book;
    const sel = selectionOf(s);
    const ready = selectionReady(sel);
    const opts = currentOptions(s);
    const env = { index: s.index, hasHistory: s.hasHistory };

    // Presets
    const preset = bookPresetOf(s.opts);
    modal.querySelectorAll<HTMLElement>('[data-preset]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.preset === preset)));

    // What goes in the book
    modal.querySelectorAll<HTMLInputElement>('input[name="book-kind"]').forEach(i => { i.checked = i.value === s.kind; });
    modal.querySelectorAll<HTMLElement>('.book-kind[data-kind]').forEach(k => k.classList.toggle('is-on', k.dataset.kind === s.kind));
    modal.dataset.kind = s.kind;
    modal.querySelector<HTMLElement>('.book-sel-tree')!.hidden = s.kind !== 'tree';
    modal.querySelector<HTMLElement>('.book-sel-rods')!.hidden = s.kind !== 'rods';
    modal.querySelector<HTMLElement>('.book-sel-person')!.hidden = s.kind !== 'ancestors' && s.kind !== 'descendants';
    const chosen = new Set(s.rods);
    modal.querySelectorAll<HTMLInputElement>('.book-rod-row input').forEach(i => { i.checked = chosen.has(i.value as RodId); });
    const label = personLabel(s.data, s.person);
    setText(modal, '.book-person-name', label || D.choosePerson);
    if (s.kind === 'ancestors' || s.kind === 'descendants') {
        const n = s.gens[s.kind];
        setText(modal, '.book-gens-n', String(n));
        setText(modal, '.book-gens-t', s.kind === 'ancestors' ? D.gensUp : D.gensDown);
        modal.querySelector<HTMLButtonElement>('[data-gen="-1"]')!.disabled = n <= BOOK_GENERATIONS_MIN;
        modal.querySelector<HTMLButtonElement>('[data-gen="1"]')!.disabled = n >= BOOK_GENERATIONS_MAX;
    }

    // Parts: an unavailable one stays in sight, grey, unticked, with its reason (in the app's language)
    const avail = bookPartAvailability(s.data, { ...opts, lang: s.appLang }, env);
    let ticked = 0;
    for (const k of BOOK_PART_KEYS) {
        const row = modal.querySelector<HTMLElement>(`.book-part[data-part="${k}"]`);
        const input = row?.querySelector<HTMLInputElement>('input');
        if (!row || !input) continue;
        const on = k === 'families' || (s.opts.parts[k] && avail[k].available);
        if (on) ticked++;
        input.checked = on;
        input.disabled = k === 'families' || !avail[k].available;
        row.classList.toggle('is-off', !avail[k].available);
        setText(row, '.book-part-r', avail[k].reason);
    }

    // Detail, notes, privacy, language
    modal.querySelectorAll<HTMLElement>('[data-detail]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.detail === s.opts.detail)));
    setText(modal, '.book-detail-hint', T.detailHint[s.opts.detail]);
    modal.querySelectorAll<HTMLElement>('[data-switch]').forEach(b => {
        b.setAttribute('aria-checked', String(b.dataset.switch === 'notes' ? s.opts.notes : s.opts.research));
    });
    modal.querySelectorAll<HTMLInputElement>('input[name="book-privacy"]').forEach(i => { i.checked = i.value === s.opts.privacy; });
    modal.querySelectorAll<HTMLElement>('[data-lang]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.lang === s.opts.lang)));

    // Title: automatic by the selection and the book's language, until edited
    const auto = autoTitle(s);
    const title = s.titleEdited && s.opts.title?.trim() ? s.opts.title.trim() : auto;
    const input = modal.querySelector<HTMLInputElement>('#book-title-input')!;
    if (!s.titleEdited && input.value !== auto) input.value = auto;
    const period = ready ? bookPeriod(s.data, sel, env) : '';
    const note = modal.querySelector<HTMLElement>('.book-title-note')!;
    note.innerHTML = s.titleEdited
        ? `${esc(D.titleEdited)} · <button type="button" class="book-title-revert">${esc(D.titleRevert)}</button>`
        : esc(D.titleAuto(period));

    // The estimate, the outline and the title page
    const est = ready ? estimateBook(s.data, opts, env) : null;
    const estEl = modal.querySelector<HTMLElement>('.book-estimate')!;
    estEl.textContent = est ? T.estimate(est.pages, est.persons, est.chapters) : s.kind === 'rods' ? T.noRodSelected : D.noPerson;
    estEl.classList.toggle('is-empty', !est);
    const open = modal.querySelector<HTMLButtonElement>('#book-open');
    if (open) open.disabled = !est;
    const outline = modal.querySelector<HTMLElement>('.book-outline')!;
    outline.innerHTML = `<div class="book-outline-h">${esc(BL.contents)}</div>`
        + (est ? `<ol>${est.outline.map(l => { const [a, b] = splitOutline(l); return `<li><span>${esc(a)}</span>${b ? `<span class="book-outline-r">${esc(b)}</span>` : ''}</li>`; }).join('')}</ol>` : '');
    const cover = modal.querySelector<HTMLElement>('.book-cover')!;
    const meta = est ? [BL.persons(est.persons), ...(est.generations ? [BL.generations(est.generations)] : [])].join(' · ') : '';
    cover.innerHTML = `<div class="book-cover-rule"></div><div class="book-cover-title">${esc(title)}</div>`
        + (period ? `<div class="book-cover-sub">${esc(period)}</div>` : '')
        + `<div class="book-cover-foot">${meta ? `<div>${esc(meta)}</div>` : ''}<div>${esc(BL.compiled(new Date().toLocaleDateString(s.opts.lang)))}</div>`
        + (s.opts.privacy !== 'full' ? `<div class="book-cover-prot">${esc(BL.dlg.coverProtected)}</div>` : '') + `</div>`;

    // The phone's summaries
    const sum = (key: string, text: string): void => setText(modal, `[data-sum="${key}"]`, text);
    sum('parts', D.partsCount(ticked, BOOK_PART_KEYS.length));
    sum('detail', T.detail[s.opts.detail]);
    sum('notes', D.notesSummary[s.opts.notes && s.opts.research ? 'both' : s.opts.notes ? 'notes' : s.opts.research ? 'research' : 'none']);
    sum('privacy', D.privacyShort[s.opts.privacy]);
    sum('lang', D.langName[s.opts.lang]);
    sum('title', title);
    const labels = rodLabels(s.index);
    const selSum = s.kind === 'rods' ? (s.rods.map(id => labels.get(id) ?? '').filter(Boolean).join(', ') || D.choose)
        : s.kind === 'tree' ? '' : (s.person ? shownName(s.data.persons[s.person]) : D.choose);
    modal.querySelectorAll<HTMLElement>('.book-kind[data-kind]').forEach(k => {
        const v = k.querySelector<HTMLElement>('.book-sum-v');
        if (v) v.textContent = k.dataset.kind === s.kind ? selSum : '';
    });

    // The phone's sub-sheet
    if (s.sub) modal.dataset.sub = s.sub; else delete modal.dataset.sub;
    const subTitle: Record<Sub, string> = {
        sel: D.kind[s.kind], parts: D.parts, detail: D.detail, notes: D.notesRow, privacy: D.privacy, lang: D.lang, title: D.title,
    };
    setText(modal, '.book-sub-title', s.sub ? subTitle[s.sub] : '');
    setText(modal, '[data-sub-title]', D.kind[s.kind]);
}

/** A change: remember the options (not the selection's person or the title) and refresh. */
function changed(s: DialogState): void {
    saveBookMemory(storage(), s.treeId, currentOptions(s));
    sync(s);
}

export const bookUiMethods = uiModule({
    /** The family book from the menu, Export or the bottom sheet (§4.8: the last lineages, else the whole tree). */
    showBookDialog(): void {
        this.openBookDialog({ kind: 'menu' });
    },

    /** The book of a person's descendants, 4 generations (§4.8). */
    openBookForPerson(personId: PersonId): void {
        this.openBookDialog({ kind: 'person', person: personId });
    },

    /**
     * Open the dialog for an entry. `reuse` reopens it from a book window
     * ("Change options"): that book's options, and "Open book" rewrites that
     * window.
     */
    openBookDialog(entry: BookEntry, reuse?: { options: BookOptions; win: Window }): void {
        this.closeMobileMenu?.();
        // Take over the dialog stack from the export menu (same pattern as poster).
        document.getElementById('export-modal')?.classList.remove('active');
        closePicker?.();

        const data = DataManager.getData();
        const index = buildLineages(data);
        const treeId = TreeManager.getActiveTreeId();
        const appLang = appBookLang();
        const memory = loadBookMemory(storage(), treeId);
        const opts = reuse
            ? { ...reuse.options, parts: { ...reuse.options.parts } }
            : bookOptionsFromMemory(appLang, memory, bookEntrySelection(entry, index, memory?.lastRods));
        const sel = opts.selection;
        const choosable = new Set(bookRodChoices(index));
        const real = (id: PersonId | null | undefined): PersonId | null => {
            const p = id ? data.persons[id] : undefined;
            return p && !p.isPlaceholder ? p.id : null;
        };
        const focus = real(TreeRenderer.getFocusPersonId());
        const gens = { ancestors: BOOK_GENERATIONS_DEFAULT, descendants: BOOK_GENERATIONS_DEFAULT };
        if (sel.kind === 'ancestors' || sel.kind === 'descendants') gens[sel.kind] = clampBookGenerations(sel.generations ?? BOOK_GENERATIONS_DEFAULT);
        const firstId = Object.keys(data.persons)[0];
        st = {
            data, index, treeId, appLang,
            treeName: TreeManager.getActiveTreeMetadata()?.name || '',
            hasHistory: !!(firstId && this.personPageHistory(firstId as PersonId)),
            kind: sel.kind,
            rods: (sel.kind === 'rods' ? sel.rods : memory?.lastRods ?? []).filter(id => choosable.has(id)),
            person: (sel.kind === 'ancestors' || sel.kind === 'descendants' ? real(sel.person) : null) ?? focus,
            gens,
            opts,
            titleEdited: !!opts.title?.trim(),
            win: reuse?.win ?? null,
            sub: null,
        };

        const overlay = document.getElementById('book-modal');
        const modal = overlay?.querySelector<HTMLElement>('.book-dlg');
        if (!overlay || !modal) return;
        const presets = modal.querySelector<HTMLElement>('.book-presets');
        if (presets) {
            presets.setAttribute('aria-label', strings.book.dlg.presetsLabel);
            presets.innerHTML = (['family', 'research', 'custom'] as const)
                .map(p => `<button type="button" role="radio" data-preset="${p}">${esc(strings.book.preset[p])}</button>`).join('');
        }
        const body = modal.querySelector<HTMLElement>('.book-dlg-opts');
        if (body) { body.innerHTML = optionsHtml(st); body.scrollTop = 0; }
        setText(modal, '.book-open-hint', strings.book.dlg.openHint);
        if (!modal.dataset.wired) {
            modal.dataset.wired = '1';
            this.wireBookDialog(modal);
        }
        sync(st);

        // Own the dialog stack (as the poster does): the first Escape closes
        // the book, and no parent dialog can reopen on top of it.
        this.clearDialogStack();
        this.pushDialog('book-modal');
        this.renderViewLinksNote(modal.querySelector('.modal-header'));
        overlay.classList.add('active');
    },

    /** The dialog's controls (wired once; they act on the current state). */
    wireBookDialog(modal: HTMLElement): void {
        const update = (fn: (s: DialogState) => void): void => {
            if (!st) return;
            fn(st);
            changed(st);
        };
        modal.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            const preset = t.closest<HTMLElement>('[data-preset]');
            if (preset) {
                const p = preset.dataset.preset;
                // "Custom" is where any other change lands; a click on it changes nothing.
                if (p === 'family' || p === 'research') update(s => { s.opts = applyBookPreset(s.opts, p); });
                return;
            }
            const sub = t.closest<HTMLElement>('[data-sub-open]');
            if (sub && st) {
                e.preventDefault();
                const kind = sub.closest<HTMLElement>('.book-kind')?.dataset.kind as Kind | undefined;
                if (kind && kind !== st.kind) update(s => { s.kind = kind; });
                st.sub = sub.dataset.subOpen as Sub;
                sync(st);
                modal.querySelector<HTMLElement>('.book-dlg-opts')?.scrollTo(0, 0);
                modal.querySelector<HTMLElement>('.book-sub-back')?.focus();
                return;
            }
            if (t.closest('.book-sub-back') && st) {
                const was = st.sub;
                st.sub = null;
                sync(st);
                modal.querySelector<HTMLElement>(was === 'sel' ? `.book-kind[data-kind="${st.kind}"] input` : `[data-sub-open="${was}"]`)?.focus();
                return;
            }
            if (t.closest('.book-person-btn')) { this.openBookPersonPicker(); return; }
            const step = t.closest<HTMLButtonElement>('[data-gen]');
            if (step) {
                update(s => {
                    if (s.kind !== 'ancestors' && s.kind !== 'descendants') return;
                    s.gens[s.kind] = clampBookGenerations(s.gens[s.kind] + Number(step.dataset.gen));
                });
                return;
            }
            const detail = t.closest<HTMLElement>('[data-detail]');
            if (detail) { update(s => { s.opts = { ...s.opts, detail: detail.dataset.detail as BookDetail }; }); return; }
            const sw = t.closest<HTMLElement>('[data-switch]');
            if (sw) {
                update(s => {
                    s.opts = sw.dataset.switch === 'notes' ? { ...s.opts, notes: !s.opts.notes } : { ...s.opts, research: !s.opts.research };
                });
                return;
            }
            const lang = t.closest<HTMLElement>('[data-lang]');
            if (lang) { update(s => { s.opts = { ...s.opts, lang: lang.dataset.lang as BookLang }; }); return; }
            if (t.closest('.book-title-revert')) {
                update(s => { s.titleEdited = false; s.opts = { ...s.opts, title: undefined }; });
                modal.querySelector<HTMLElement>('#book-title-input')?.focus();
            }
        });
        modal.addEventListener('change', (e) => {
            const t = e.target as HTMLInputElement;
            if (t.name === 'book-kind') { update(s => { s.kind = t.value as Kind; }); return; }
            if (t.name === 'book-privacy') { update(s => { s.opts = { ...s.opts, privacy: t.value as PrivacyMode }; }); return; }
            if (t.closest('.book-rod-row')) {
                update(s => {
                    const id = t.value as RodId;
                    const order = bookRodChoices(s.index);
                    const set = new Set(s.rods.filter(r => r !== id));
                    if (t.checked) set.add(id);
                    s.rods = order.filter(r => set.has(r));
                });
                return;
            }
            const part = t.closest<HTMLElement>('.book-part');
            if (part) {
                const k = part.dataset.part as BookPartKey;
                if (k === 'families') return;
                update(s => { s.opts = { ...s.opts, parts: { ...s.opts.parts, [k]: t.checked } }; });
            }
        });
        modal.addEventListener('input', (e) => {
            const t = e.target as HTMLInputElement;
            if (t.id !== 'book-title-input' || !st) return;
            const auto = autoTitle(st);
            const v = t.value;
            update(s => {
                if (!v.trim() || v.trim() === auto) { s.titleEdited = false; s.opts = { ...s.opts, title: undefined }; }
                else { s.titleEdited = true; s.opts = { ...s.opts, title: v }; }
            });
        });
        modal.addEventListener('keydown', (e) => {
            // A sub-sheet first: Escape steps back to the rows.
            if (e.key === 'Escape' && st?.sub) {
                e.preventDefault();
                e.stopPropagation();
                (modal.querySelector('.book-sub-back') as HTMLElement | null)?.click();
            }
        });
    },

    /** The person of a book of ancestors / descendants: the overview's popover. */
    openBookPersonPicker(): void {
        const s = st;
        const overlay = document.getElementById('book-modal');
        const button = overlay?.querySelector<HTMLElement>('.book-person-btn');
        if (!s || !overlay || !button) return;
        if (closePicker) { closePicker(); return; }
        const t = strings.treeOverview;
        const suggested: Array<{ id: PersonId; meta: string }> = [];
        if (s.person) suggested.push({ id: s.person, meta: '' });
        const focus = TreeRenderer.getFocusPersonId();
        if (focus) suggested.push({ id: focus, meta: t.inFocus });
        if (s.treeId) for (const id of readRecent(s.treeId)) suggested.push({ id, meta: t.recent });
        closePicker = openPersonPopover({
            host: overlay, anchor: button, data: s.data, selectedId: s.person, suggested,
            labels: { search: t.searchPerson, list: strings.book.dlg.choosePerson, noMatch: t.noMatch },
            onClose: () => { closePicker = null; },
            onPick: (id) => {
                if (!st) return;
                st.person = id;
                changed(st);
                button.focus();
            },
        });
    },

    closeBookDialog(): void {
        closePicker?.();
        document.getElementById('book-modal')?.classList.remove('active');
        this.clearDialogStack();
        st = null;
    },

    /** The book's HTML for these options: for the window, or for a saved file. */
    familyBookHtml(options: BookOptions, forSave: boolean): string {
        const data = DataManager.getData();
        const firstId = Object.keys(data.persons)[0];
        const lang = options.lang;
        const locale = lang === 'cs' ? 'cs-CZ' : lang === 'de' ? 'de-DE' : 'en-GB';
        return buildFamilyBook(data, options, {
            treeName: TreeManager.getActiveTreeMetadata()?.name,
            dateLabel: getStringsForLang(lang).book.compiled(new Date().toLocaleDateString(locale)),
            fontCss: appFontFaceCss(POSTER_SERIF_FACES) + bookItalicFontCss(),
            hasHistory: !!(firstId && this.personPageHistory(firstId as PersonId)),
            personHistory: (id) => this.personPageHistory(id),
            ...(forSave ? { forSave: true } : {
                approveStoryUrl: (p) => this.storyApproveUrl(p.id),
                storyDraftUrls: (owner) => this.storyCompareUrls('person' in owner
                    ? { personId: owner.person.id } : { partnershipId: owner.couple.id }),
            }),
        });
    },

    /** "Open book": the window opens (or the one being changed is rewritten). */
    generateFamilyBook(): void {
        const s = st;
        if (!s) return;
        const sel = selectionOf(s);
        if (!selectionReady(sel)) return;
        if (Object.keys(s.data.persons).length === 0) {
            this.showAlert(strings.book.empty, 'warning');
            return;
        }
        const options = currentOptions(s);
        saveBookMemory(storage(), s.treeId, options);
        // The window first (a popup must open in the click), then the book.
        const win = s.win && !s.win.closed ? s.win : window.open('', '_blank');
        this.closeBookDialog();
        if (!win) { this.showAlert(strings.export.failed, 'warning'); return; }
        const html = this.familyBookHtml(options, false);
        win.document.open();
        win.document.write(html);
        win.document.close();
        this.wireBookWindow(win, options);
        try { win.focus(); } catch { /* the browser decides */ }
    },

    /** The book window's app actions: Change options, Save as HTML, Share; the story comparison. */
    wireBookWindow(win: Window, options: BookOptions): void {
        const doc = win.document;
        // "Compare" above a story with a new version: its dialog in the book's window.
        this.wireBookStoryCompare(doc);
        const share = doc.querySelector<HTMLElement>('[data-book-act="share"]');
        if (share) share.hidden = !canShareFiles(win);
        const title = (): string => options.title?.trim()
            || autoBookTitle(DataManager.getData(), options.selection, options.lang, { treeName: TreeManager.getActiveTreeMetadata()?.name });
        doc.addEventListener('click', (e) => {
            const el = (e.target as Element | null)?.closest?.('[data-book-act]');
            if (!el) return;
            e.preventDefault();
            const act = el.getAttribute('data-book-act');
            if (act === 'options') {
                try { window.focus(); } catch { /* the browser decides */ }
                this.openBookDialog({ kind: 'menu' }, { options, win });
                return;
            }
            try {
                const html = this.familyBookHtml(options, true);
                const name = bookFileName(title());
                if (act === 'save') {
                    const W = win as Window & typeof globalThis;
                    const url = W.URL.createObjectURL(new W.Blob([html], { type: 'text/html;charset=utf-8' }));
                    const a = doc.createElement('a');
                    a.href = url;
                    a.download = name;
                    doc.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => W.URL.revokeObjectURL(url), 2000);
                } else if (act === 'share') {
                    const file = new File([html], name, { type: 'text/html' });
                    void win.navigator.share({ files: [file], title: title() }).catch(() => { /* cancelled */ });
                }
            } catch {
                win.alert(getStringsForLang(options.lang).book.win.saveFailed);
            }
        });
    },
});

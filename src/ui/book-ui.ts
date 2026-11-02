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
    autoBookTitle, bookPartAvailability, bookPeriod, bookRodCounts, estimateBook,
} from '../book-options.js';
import {
    BOOK_GENERATIONS_DEFAULT, BOOK_GENERATIONS_MAX, BOOK_GENERATIONS_MIN, BookEntry, BookOutput, PAGES_GROUP_KEYS, PagesChoices, PagesGroups,
    bookEntrySelection, bookOptionsFromMemory, bookRodChoices, clampBookGenerations, loadBookMemory, pagesChoicesFromMemory, saveBookMemory,
} from '../book-memory.js';
import { BookPresetState, choosePreset, initialPresetState, presetValuesChanged } from '../book-preset.js';
import { ImageChoice } from '../image-registry.js';
import {
    PageSet, PageSetOptions, PageSetSize, buildPageSet, estimatePageSetSize, pageSetFileName, pageSetImages, pageSetPrivacyWarning, sizeVerdict,
} from '../family-pages.js';
import { PagesCancelled, PagesFile, PagesJob, buildPagesFile, canSharePagesFile, downloadPagesFile, sharePagesFile } from './family-pages-ui.js';
import { pageSetZipName } from '../family-pages-html.js';
import { LineageIndex, Rod, RodId, ancestorCount, buildLineages, personRodRow, rodLabels, rods as allRods } from '../lineage.js';
import { MultiPersonPicker } from '../person-picker.js';
import { bookItalicFontCss } from '../book-font.js';
import { appFontFaceCss, POSTER_SERIF_FACES } from '../poster-fonts.js';
import { shownName } from '../person-name.js';
import { displayYear } from '../dates.js';
import { openPersonPopover } from './person-popover.js';
import { readRecent } from './tree-overview.js';
import { uiModule } from './module.js';

type Kind = 'tree' | 'rods' | 'ancestors' | 'descendants' | 'persons';
type PersonKind = 'ancestors' | 'descendants';
/** The phone's sub-sheets (§4.1, 4b; the pages' rows, 026 6b). */
type Sub = 'sel' | 'parts' | 'detail' | 'notes' | 'privacy' | 'lang' | 'title' | 'families' | 'images' | 'groups' | 'include';
/**
 * The pages' footer (026 §6.5, §6.6): the options with the estimate; the
 * file being built (its progress only after ~1 s); the file ready to save.
 */
type Phase = 'options' | 'building' | 'progress' | 'result';

/** Chosen people are a selection of the pages only (1102 §4.1). */
const KINDS: readonly Kind[] = ['tree', 'rods', 'ancestors', 'descendants', 'persons'];
const DETAILS: readonly BookDetail[] = ['brief', 'normal', 'all'];
const PRIVACY: readonly PrivacyMode[] = ['full', 'initials', 'minimal', 'anonymous'];
const LANGS: readonly BookLang[] = ['cs', 'en', 'de'];
const IMAGE_CHOICES: readonly ImageChoice[] = ['full', 'small', 'none'];
const INCLUDES = ['map', 'timelines'] as const;
/** The pages' depths of ancestors (1102 §4.1); "All" in the phone's sub-sheet only. */
const ANC_GENS: readonly (number | 'all')[] = [2, 3, 4, 5, 6, 8, 'all'];
const ANC_GENS_DEFAULT = 4;
/** Chips of chosen people shown before "+ N more". */
const SEL_CHIPS = 6;
/** The pages' estimate is recomputed this long after the last change (§6.3). */
const ESTIMATE_DEBOUNCE_MS = 150;
/** The build's progress shows only after this long (§6.5). */
const PROGRESS_AFTER_MS = 1000;

/** The pages' estimate (§6.3): the set as chosen, its size and the alternatives' sizes. */
interface PagesEstimate {
    set: PageSet;
    size: PageSetSize;
    /** With the images reduced, without the record excerpts: null when that changes nothing. */
    small: number | null;
    noClips: number | null;
    /** The warning about living people under full data, or ''. */
    warn: string;
    clips: number;
    photos: number;
    name: string;
}

interface DialogState {
    data: StromData;
    index: LineageIndex;
    /** The lineages the dialog lists: the chapters, plus a small lineage the entry asked for (the pages' window of that lineage). */
    rodChoices: RodId[];
    treeId: string | null;
    treeName: string;
    appLang: BookLang;
    hasHistory: boolean;
    kind: Kind;
    /** The chosen lineages, the person and the generations: kept while another kind is chosen. */
    rods: RodId[];
    person: PersonId | null;
    gens: Record<PersonKind, number>;
    /** The pages' chosen people (not remembered) and depth of ancestors (1102 §4.1). */
    selIds: PersonId[];
    ancGens: number | 'all';
    /** The book took the whole tree for chosen people: said once under the selection, until the next change. */
    moved: boolean;
    /** The options apart from the selection (that one comes from kind / rods / person). */
    opts: BookOptions;
    /** The preset chosen, Custom's own values and the hint line (§4.9). */
    presets: BookPresetState;
    titleEdited: boolean;
    /** The book window to rewrite ("Change options"), or null for a new one. */
    win: Window | null;
    sub: Sub | null;
    /** The book to print or the linked pages (026 §6.1). */
    output: BookOutput;
    pages: PagesChoices;
    phase: Phase;
    est: PagesEstimate | null;
    estTimer: number | null;
    job: PagesJob | null;
    prog: { done: number; total: number; text: string };
    file: PagesFile | null;
    /** The set of files chosen over 15 MB (§6.3, §6.4); over 50 MB it is the only way. */
    zip: boolean;
}

/** Whether "Save file" makes the set of files: chosen over 15 MB, always over 50 MB (§6.3). */
function savesZip(s: DialogState): boolean {
    const v = s.est ? sizeVerdict(s.est.size.bytes) : 'ok';
    return v === 'set' || (v === 'big' && s.zip);
}

let st: DialogState | null = null;
let closePicker: (() => void) | null = null;
let selPicker: MultiPersonPicker | null = null;

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
        case 'persons': return { kind: 'persons', ids: [...s.selIds] };
        default:
            if (!s.person) return null;
            // The pages' ancestors: the segment's depth (1102 §4.1); the book keeps its stepper.
            if (s.kind === 'ancestors' && s.output === 'pages') return { kind: 'ancestors', person: s.person, generations: s.ancGens };
            return { kind: s.kind, person: s.person, generations: s.gens[s.kind] };
    }
}

/** The book can be opened: something is chosen (a set of chosen people from two of them; one is a person page). */
function selectionReady(sel: BookSelectionSpec | null): sel is BookSelectionSpec {
    return !!sel && !(sel.kind === 'rods' && sel.rods.length === 0) && !(sel.kind === 'persons' && sel.ids.length < 2);
}

/** One chosen person: the primary button opens the person page's export (1102 §4.1). */
function onePerson(s: DialogState): PersonId | null {
    return s.output === 'pages' && s.kind === 'persons' && s.selIds.length === 1 ? s.selIds[0] : null;
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
    const F = strings.familyPages;
    const pages = s.output === 'pages';
    const counts = bookRodCounts(s.data, { index: s.index });
    const persons = Object.values(s.data.persons).filter(p => !p.isPlaceholder).length;
    const hint: Record<Kind, string> = {
        tree: D.treeHint(persons, counts.rods, counts.other),
        rods: D.kindHint.rods, ancestors: D.kindHint.ancestors, descendants: D.kindHint.descendants, persons: D.kindHint.persons,
    };
    // The pages of the whole tree: its lineages and the other families (spec 026 P3 §3.1).
    if (pages) hint.tree = F.treeHintPages(persons, counts.rods);
    const kinds = KINDS.filter(k => pages || k !== 'persons').map(k => {
        return `<label class="book-kind" data-kind="${k}">`
            + `<input type="radio" name="book-kind" value="${k}">`
            + `<span class="book-kind-text"><span class="book-kind-t">${esc(D.kind[k])}</span><span class="book-kind-h">${esc(hint[k])}</span></span>`
            + (k === 'tree' ? '' : `<button type="button" class="book-kind-sum" data-sub-open="sel" tabindex="-1"><span class="book-sum-v"></span><span class="book-chev" aria-hidden="true">›</span></button>`)
            + `</label>`;
    }).join('');
    const labels = rodLabels(s.index);
    const byId = new Map(allRods(s.index).map(r => [r.id, r]));
    const rods = s.rodChoices.map(id => byId.get(id)).filter((r): r is Rod => !!r).map(r => {
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
    const head = `<div class="book-sub-head"><button type="button" class="book-sub-back"><span aria-hidden="true">‹</span> ${esc(D.back)}</button>`
        + `<span class="book-sub-title"></span></div>`
        + `<section class="book-sec book-sec-what" data-sec="what"><h3 class="book-sec-h" id="book-what-h">${esc(pages ? F.what : D.what)}</h3>`
        + `<div class="book-kinds" role="radiogroup" aria-labelledby="book-what-h">${kinds}`
        + (pages ? '' : `<div class="book-kind book-kind--house" aria-disabled="true"><input type="radio" disabled tabindex="-1" aria-hidden="true">`
            + `<span class="book-kind-text"><span class="book-kind-h">${esc(D.house)}</span></span></div>`)
        + `</div><p class="book-sel-moved" role="status" hidden></p></section>`
        + `<section class="book-sec book-sec-sel" data-sec="sel"><h3 class="book-sec-h book-sub-only" data-sub-title></h3>`
        + `<div class="book-sel book-sel-tree"><p class="book-hint">${esc(D.treeSentence)}</p></div>`
        + `<div class="book-sel book-sel-rods">`
        + (rods ? `<div class="book-rods-list">${rods}</div>` : `<p class="book-hint">${esc(D.noRods)}</p>`)
        + (counts.other && !pages ? `<p class="book-rods-small">${esc(D.rodsSmall(counts.other))}</p>` : '') + `</div>`
        + `<div class="book-sel book-sel-person"><div class="book-person-line"><span class="book-person-l">${esc(D.person)}</span>`
        + `<button type="button" class="book-person-btn" aria-haspopup="listbox" aria-expanded="false"><span class="book-person-name"></span><span class="book-caret" aria-hidden="true">▾</span></button>`
        + `<span class="book-gens"><button type="button" class="book-step" data-gen="-1" aria-label="${esc(D.fewer)}">−</button>`
        + `<output class="book-gens-n" aria-live="polite"></output>`
        + `<button type="button" class="book-step" data-gen="1" aria-label="${esc(D.more)}">+</button></span></div>`
        + `<p class="book-hint book-gens-t"></p>`
        + (pages ? `<div class="book-anc-line"><span class="book-anc-l" id="book-anc-l">${esc(F.gensOf)}</span>`
            + `<div class="book-seg book-anc-seg" role="radiogroup" aria-labelledby="book-anc-l">`
            + ANC_GENS.map(g => `<button type="button" role="radio" data-anc-gen="${g}">${esc(g === 'all' ? F.gensAll : String(g))}</button>`).join('')
            + `</div><span class="book-anc-n" aria-live="polite"></span></div>` : '')
        + `</div>`
        + (pages ? `<div class="book-sel book-sel-persons"><div class="book-sel-picker"></div>`
            + `<p class="book-hint book-sel-state" aria-live="polite"></p>`
            + `<button type="button" class="primary book-sub-done">${esc(F.selDone)}</button></div>` : '')
        + `</section>`;
    const privacyRadios = `<div class="book-radios" role="radiogroup" aria-labelledby="book-privacy-h">`
        + PRIVACY.map(m => `<label class="book-radio"><input type="radio" name="book-privacy" value="${m}"><span>${esc(privacyLabel[m])}</span></label>`).join('')
        + `</div>`;
    if (pages) return head + pagesOptionsHtml(sum, privacyRadios);
    return head
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
        + privacyRadios + `<p class="book-hint">${esc(D.privacyHint)}</p></section>`
        + `<section class="book-sec" data-sec="lang"><h3 class="book-sec-h">${esc(D.lang)}</h3>`
        + seg('lang', LANGS.map(l => [l, D.langName[l]] as [string, string]), D.lang)
        + `<p class="book-hint">${esc(D.langHint)}</p></section></div>`
        + `<section class="book-sec" data-sec="title"><h3 class="book-sec-h"><label for="book-title-input">${esc(D.title)}</label></h3>`
        + `<input type="text" id="book-title-input" class="book-title-input" autocomplete="off" spellcheck="false">`
        + `<p class="book-hint book-title-note"></p></section>`;
}

/**
 * The pages' rows (026 §6.2): the protection of the living with its warning,
 * the families, the images, what the pages include; on a phone rows with a
 * summary, each opening a sub-sheet (6b).
 */
function pagesOptionsHtml(sum: (sub: Sub, label: string) => string, privacyRadios: string): string {
    const D = strings.book.dlg;
    const F = strings.familyPages;
    const imgRow = (key: 'clips' | 'photos', label: string): string =>
        `<div class="fp-img-row"><span class="fp-img-l" id="fp-img-${key}">${esc(label)}</span>`
        + `<div class="book-seg" role="radiogroup" aria-labelledby="fp-img-${key}">`
        + IMAGE_CHOICES.map(c => `<button type="button" role="radio" data-${key}="${c}">${esc(F.imgChoice[c])}</button>`).join('')
        + `</div><span class="fp-img-n" data-n="${key}"></span></div>`;
    return `<div class="book-sum">${sum('privacy', D.privacy)}${sum('families', F.families)}${sum('groups', F.groupsRow)}${sum('images', F.images)}${sum('include', F.include)}</div>`
        + `<section class="book-sec" data-sec="privacy"><h3 class="book-sec-h" id="book-privacy-h">${esc(D.privacy)}</h3>`
        + privacyRadios + `<p class="fp-warn" role="status" hidden></p><p class="book-hint">${esc(F.privacyHint)}</p></section>`
        + `<section class="book-sec" data-sec="families"><h3 class="book-sec-h" id="fp-families-h">${esc(F.families)}</h3>`
        + `<div class="book-radios" role="radiogroup" aria-labelledby="fp-families-h">`
        + (['pages', 'section'] as const).map(v => `<label class="book-radio"><input type="radio" name="fp-families" value="${v}"><span>${esc(F.famOpt[v])}</span></label>`).join('')
        + `</div></section>`
        + `<section class="book-sec" data-sec="groups"><h3 class="book-sec-h" id="fp-groups-h">${esc(F.groupsRow)}</h3>`
        + `<div class="fp-inc fp-groups" role="group" aria-labelledby="fp-groups-h">`
        + PAGES_GROUP_KEYS.map(k => `<label class="book-radio"><input type="checkbox" name="fp-grp" value="${k}"><span>${esc(F.groups[k])}</span></label>`).join('')
        + `</div></section>`
        + `<section class="book-sec" data-sec="images"><h3 class="book-sec-h">${esc(F.images)}</h3>`
        + imgRow('clips', F.clips) + imgRow('photos', F.photos) + `</section>`
        + `<section class="book-sec" data-sec="include"><h3 class="book-sec-h" id="fp-inc-h">${esc(F.include)}</h3>`
        + `<div class="fp-inc" role="group" aria-labelledby="fp-inc-h">`
        + INCLUDES.map(k => `<label class="book-radio" data-inc="${k}"><input type="checkbox" name="fp-inc" value="${k}"><span>${esc(F.inc[k])}</span></label>`).join('')
        + `</div><p class="book-hint">${esc(F.alwaysIdx)}</p></section>`;
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
    const F = strings.familyPages;
    const pages = s.output === 'pages';

    // The output (026 §6.1)
    modal.dataset.out = s.output;
    modal.querySelectorAll<HTMLElement>('.book-out [data-output]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.output === s.output)));
    setText(modal, '.book-out-hint', F.outHint[s.output]);

    // What goes in the book
    modal.querySelectorAll<HTMLInputElement>('input[name="book-kind"]').forEach(i => { i.checked = i.value === s.kind; });
    modal.querySelectorAll<HTMLElement>('.book-kind[data-kind]').forEach(k => k.classList.toggle('is-on', k.dataset.kind === s.kind));
    modal.dataset.kind = s.kind;
    modal.querySelector<HTMLElement>('.book-sel-tree')!.hidden = s.kind !== 'tree';
    modal.querySelector<HTMLElement>('.book-sel-rods')!.hidden = s.kind !== 'rods';
    modal.querySelector<HTMLElement>('.book-sel-person')!.hidden = s.kind !== 'ancestors' && s.kind !== 'descendants';
    const selPersons = modal.querySelector<HTMLElement>('.book-sel-persons');
    if (selPersons) selPersons.hidden = s.kind !== 'persons';
    const moved = modal.querySelector<HTMLElement>('.book-sel-moved');
    if (moved) {
        moved.hidden = !s.moved || pages;
        setText(modal, '.book-sel-moved', s.moved && !pages ? F.selMoved : '');
    }
    const chosen = new Set(s.rods);
    modal.querySelectorAll<HTMLInputElement>('.book-rod-row input').forEach(i => { i.checked = chosen.has(i.value as RodId); });
    const label = personLabel(s.data, s.person);
    setText(modal, '.book-person-name', label || D.choosePerson);
    // The pages' ancestors: the segment of depths and the count instead of the stepper (1102 §4.1).
    const ancSeg = pages && s.kind === 'ancestors';
    const stepper = modal.querySelector<HTMLElement>('.book-gens');
    if (stepper) stepper.hidden = ancSeg;
    const gensT = modal.querySelector<HTMLElement>('.book-gens-t');
    if (gensT) gensT.hidden = ancSeg;
    const ancLine = modal.querySelector<HTMLElement>('.book-anc-line');
    if (ancLine) ancLine.hidden = !ancSeg;
    if (ancSeg) {
        modal.querySelectorAll<HTMLElement>('[data-anc-gen]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.ancGen === String(s.ancGens))));
        const c = s.person ? ancestorCount(s.data, s.person, s.ancGens === 'all' ? undefined : s.ancGens) : null;
        setText(modal, '.book-anc-n', c ? F.ancCount(c.known, c.total) : '');
    }
    if (s.kind === 'persons') {
        const n = s.selIds.length;
        const fams = s.est && s.est.set.spec.kind === 'persons' ? s.est.set.familySlug.size : 0;
        setText(modal, '.book-sel-state', n === 0 ? F.selNone : n === 1 ? F.selOne : F.selMeta(n, fams));
    }
    if (s.kind === 'ancestors' || s.kind === 'descendants') {
        const n = s.gens[s.kind];
        setText(modal, '.book-gens-n', String(n));
        setText(modal, '.book-gens-t', s.kind === 'ancestors' ? D.gensUp : D.gensDown);
        modal.querySelector<HTMLButtonElement>('[data-gen="-1"]')!.disabled = n <= BOOK_GENERATIONS_MIN;
        modal.querySelector<HTMLButtonElement>('[data-gen="1"]')!.disabled = n >= BOOK_GENERATIONS_MAX;
    }
    modal.querySelectorAll<HTMLInputElement>('input[name="book-privacy"]').forEach(i => { i.checked = i.value === s.opts.privacy; });

    const sum = (key: string, text: string): void => setText(modal, `[data-sum="${key}"]`, text);
    sum('privacy', D.privacyShort[s.opts.privacy]);
    const labels = rodLabels(s.index);
    const selSum = s.kind === 'rods' ? (s.rods.map(id => labels.get(id) ?? '').filter(Boolean).join(', ') || D.choose)
        : s.kind === 'persons' ? (s.selIds.length ? F.nPersons(s.selIds.length) : D.choose)
        : s.kind === 'tree' ? '' : (s.person ? shownName(s.data.persons[s.person]) : D.choose);
    modal.querySelectorAll<HTMLElement>('.book-kind[data-kind]').forEach(k => {
        const v = k.querySelector<HTMLElement>('.book-sum-v');
        if (v) v.textContent = k.dataset.kind === s.kind ? selSum : '';
    });

    if (pages) setText(modal, '.book-preset-hint', '');
    const title = pages ? '' : syncBook(s, modal);
    if (pages) syncPages(s, modal);
    syncFoot(s, modal);

    // The phone's sub-sheet
    if (s.sub) modal.dataset.sub = s.sub; else delete modal.dataset.sub;
    const subTitle: Record<Sub, string> = {
        sel: D.kind[s.kind], parts: D.parts, detail: D.detail, notes: D.notesRow, privacy: D.privacy, lang: D.lang, title: D.title,
        families: F.families, images: F.images, groups: F.groupsRow, include: F.include,
    };
    setText(modal, '.book-sub-title', s.sub ? subTitle[s.sub] : '');
    setText(modal, '[data-sub-title]', D.kind[s.kind]);
    if (!pages) sum('title', title);
}

/** The book's own controls, the preview, the outline and the estimate; returns the title shown. */
function syncBook(s: DialogState, modal: HTMLElement): string {
    const T = strings.book;
    const D = T.dlg;
    const BL = getStringsForLang(s.opts.lang).book;
    const sel = selectionOf(s);
    const ready = selectionReady(sel);
    const opts = currentOptions(s);
    const env = { index: s.index, hasHistory: s.hasHistory };

    // Presets, and the hint line while Custom is chosen (§4.9)
    const P = s.presets;
    modal.querySelectorAll<HTMLElement>('[data-preset]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.preset === P.preset)));
    const hint = P.preset === 'custom' && P.hint
        ? (P.hint === 'saved' ? D.presetHint.saved : D.presetHint[P.hint](T.preset[P.origin])) : '';
    setText(modal, '.book-preset-hint', hint);
    const customBtn = modal.querySelector<HTMLElement>('[data-preset="custom"]');
    if (hint) customBtn?.setAttribute('aria-describedby', 'book-preset-hint'); else customBtn?.removeAttribute('aria-describedby');

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

    // Detail, notes, language
    modal.querySelectorAll<HTMLElement>('[data-detail]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.detail === s.opts.detail)));
    setText(modal, '.book-detail-hint', T.detailHint[s.opts.detail]);
    modal.querySelectorAll<HTMLElement>('[data-switch]').forEach(b => {
        b.setAttribute('aria-checked', String(b.dataset.switch === 'notes' ? s.opts.notes : s.opts.research));
    });
    modal.querySelectorAll<HTMLElement>('[data-lang]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.lang === s.opts.lang)));

    // Title: automatic by the selection and the book's language, until edited
    const auto = autoTitle(s);
    const title = s.titleEdited && s.opts.title?.trim() ? s.opts.title.trim() : auto;
    const input = modal.querySelector<HTMLInputElement>('#book-title-input')!;
    if (!s.titleEdited && input.value !== auto) input.value = auto;
    // The rows written again (back from the pages): the edited title into its field.
    if (s.titleEdited && !input.value && s.opts.title) input.value = s.opts.title;
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
    sum('lang', D.langName[s.opts.lang]);
    return title;
}

/** The pages' rows: families, images with their counts, what is included, the warning about the living. */
function syncPages(s: DialogState, modal: HTMLElement): void {
    const F = strings.familyPages;
    const p = s.pages;
    modal.querySelectorAll<HTMLInputElement>('input[name="fp-families"]').forEach(i => { i.checked = i.value === p.families; });
    modal.querySelectorAll<HTMLElement>('[data-clips]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.clips === p.clips)));
    modal.querySelectorAll<HTMLElement>('[data-photos]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.photos === p.photos)));
    modal.querySelectorAll<HTMLInputElement>('input[name="fp-inc"]').forEach(i => { i.checked = p.include[i.value as typeof INCLUDES[number]]; });
    modal.querySelectorAll<HTMLInputElement>('input[name="fp-grp"]').forEach(i => { i.checked = p.groups[i.value as keyof PagesGroups]; });
    // The lines' timelines: hidden for a selection without lines (1102 §4.4).
    const noLines = s.kind === 'persons' || s.kind === 'ancestors' || s.kind === 'descendants';
    const tl = modal.querySelector<HTMLElement>('[data-inc="timelines"]');
    if (tl) tl.hidden = noLines;
    setText(modal, '.fp-img-n[data-n="clips"]', s.est ? F.nClips(s.est.clips) : '');
    setText(modal, '.fp-img-n[data-n="photos"]', s.est ? F.nPhotos(s.est.photos) : '');
    const warn = modal.querySelector<HTMLElement>('.fp-warn');
    if (warn) {
        const text = s.opts.privacy === 'full' ? s.est?.warn ?? '' : '';
        warn.hidden = !text;
        if (warn.textContent !== text) warn.textContent = text;
    }
    const sum = (key: string, text: string): void => setText(modal, `[data-sum="${key}"]`, text);
    sum('families', F.famShort[p.families]);
    const clips = p.clips !== 'none', photos = p.photos !== 'none';
    sum('images', F.imagesShort[clips && photos ? 'both' : clips ? 'clips' : photos ? 'photos' : 'none']);
    const grp = PAGES_GROUP_KEYS.filter(k => p.groups[k]).length;
    sum('groups', strings.book.dlg.partsCount(grp, PAGES_GROUP_KEYS.length));
    const inc = INCLUDES.filter(k => p.include[k] && !(k === 'timelines' && noLines)).map(k => F.incShort[k]).join(', ');
    sum('include', inc ? inc.charAt(0).toLocaleUpperCase() + inc.slice(1) : F.incNone);
}

/** "12" / "4,3" MB in the app's language: one decimal under 10 MB (or always, for a file made). */
function mbText(bytes: number, exact = false): string {
    const mb = Math.max(bytes / 1e6, 0.1);
    const digits = exact || mb < 10 ? 1 : 0;
    return new Intl.NumberFormat(getCurrentLanguage(), { minimumFractionDigits: exact ? 1 : 0, maximumFractionDigits: digits }).format(mb);
}

/** The footer: the book's estimate and button, or the pages' estimate, warning, progress or result (§6.3, §6.5, §6.6). */
function syncFoot(s: DialogState, modal: HTMLElement): void {
    const F = strings.familyPages;
    const pages = s.output === 'pages';
    const foot = modal.querySelector<HTMLElement>('.fp-foot');
    const open = modal.querySelector<HTMLButtonElement>('#book-open');
    const win = modal.querySelector<HTMLButtonElement>('.fp-open');
    modal.dataset.phase = pages ? s.phase : 'options';
    if (win) win.hidden = !pages;
    if (foot) foot.hidden = !pages;
    const main = modal.querySelector<HTMLElement>('.book-dlg-main');
    const busy = pages && (s.phase === 'building' || s.phase === 'progress');
    if (main) main.inert = busy;
    const out = modal.querySelector<HTMLElement>('.book-out');
    if (out) out.inert = busy;
    if (!pages || !foot || !open || !win) {
        if (open && open.dataset.out !== 'book') {
            open.dataset.out = 'book';
            open.textContent = strings.book.generate;
        }
        return;
    }
    const one = onePerson(s);
    const want = one ? 'person' : 'pages';
    if (open.dataset.out !== want) {
        open.dataset.out = want;
        if (one) open.textContent = F.selPersonPage;
        else open.innerHTML = `<span class="fp-l-wide">${esc(F.saveFile)}</span><span class="fp-l-phone">${esc(F.saveShare)}</span>`;
    }
    setText(modal, '.fp-open', F.openWin);
    const view = s.phase === 'progress' ? 'progress' : s.phase === 'result' ? 'result' : 'options';
    if (foot.dataset.view !== view) {
        foot.dataset.view = view;
        foot.innerHTML = view === 'progress' ? progressHtml() : view === 'result' ? resultHtml() : estimateHtml();
    }
    if (view === 'progress') { syncProgress(s, foot); return; }
    if (view === 'result') {
        const file = s.file;
        setText(foot, '.fp-res-f', file ? F.resFile(file.name, mbText(file.bytes, true)) : '');
        const share = foot.querySelector<HTMLElement>('.fp-res-share');
        if (share) share.hidden = !canSharePagesFile();
        return;
    }
    const est = s.est;
    const sel = selectionOf(s);
    const ready = selectionReady(sel);
    const verdict = est ? sizeVerdict(est.size.bytes) : 'ok';
    const zip = savesZip(s);
    const estEl = foot.querySelector<HTMLElement>('.fp-est')!;
    estEl.classList.toggle('is-empty', !ready);
    estEl.classList.toggle('is-big', verdict !== 'ok');
    estEl.classList.toggle('is-stale', s.estTimer !== null);
    const notReady = s.kind === 'rods' ? strings.book.noRodSelected
        : s.kind === 'persons' ? (s.selIds.length === 1 ? F.selOne : F.selNone) : strings.book.dlg.noPerson;
    setText(foot, '.fp-est-t', !ready ? notReady : zip ? F.estZip : F.estFile);
    setText(foot, '.fp-est-d', ready && est ? F.estDetail(est.size.pages, est.size.persons, est.size.images) : '');
    // The set of files is reckoned as the one file: an upper bound (§6.3, §9.4).
    setText(foot, '.fp-est-s', ready && est ? (zip ? F.estAtMost : F.estSize)(mbText(est.size.bytes)) : '');
    setText(foot, '.fp-file', ready && est ? (zip ? pageSetZipName(est.set) : est.name) : '');
    const big = foot.querySelector<HTMLElement>('.fp-big')!;
    big.hidden = !ready || !est || verdict === 'ok';
    if (ready && est && verdict !== 'ok') {
        const mb = mbText(est.size.bytes);
        setText(big, '.fp-big-t', verdict === 'set' ? F.splitT(mb) : F.tooBig(F.estSize(mb)));
        setText(big, '.fp-big-d', verdict === 'set' ? F.splitD : F.bigNote);
        const offer = (key: string, bytes: number | null, text: (size: string) => string): void => {
            const b = big.querySelector<HTMLButtonElement>(`[data-offer="${key}"]`)!;
            b.hidden = bytes === null;
            if (bytes !== null) setText(big, `[data-offer="${key}"]`, text(F.estSize(mbText(bytes))));
        };
        offer('small', est.small, F.offerSmall);
        offer('noclips', est.noClips, F.offerNoClips);
        setText(big, '[data-offer="zip"]', F.offerZip);
        big.querySelector<HTMLElement>('[data-offer="zip"]')!.setAttribute('aria-pressed', String(zip));
    }
    // Over 50 MB only the set of files is saved; the window still opens.
    open.disabled = one ? s.phase !== 'options' : !ready || !est || s.phase !== 'options';
    win.disabled = !ready || s.phase !== 'options';
}

function estimateHtml(): string {
    return `<div class="fp-est" aria-live="polite"><span class="fp-est-t"></span><span class="fp-est-d"></span><span class="fp-est-s"></span></div>`
        + `<div class="fp-big" hidden><p class="fp-big-t"></p><p class="fp-big-d"></p><div class="fp-offers">`
        + `<button type="button" class="fp-offer" data-offer="small"></button>`
        + `<button type="button" class="fp-offer" data-offer="noclips"></button>`
        + `<button type="button" class="fp-offer" data-offer="zip" aria-pressed="false"></button></div></div>`
        + `<p class="fp-file"></p>`;
}

function progressHtml(): string {
    const F = strings.familyPages;
    return `<div class="fp-prog" role="status"><div class="fp-prog-h"><span class="fp-prog-t">${esc(F.progTitle)}</span><span class="fp-prog-n"></span></div>`
        + `<div class="fp-bar" role="progressbar" aria-valuemin="0" aria-label="${esc(F.progTitle)}"><span class="fp-bar-fill"></span></div>`
        + `<p class="fp-prog-step"></p><button type="button" class="secondary fp-prog-cancel">${esc(strings.buttons.cancel)}</button></div>`;
}

function resultHtml(): string {
    const F = strings.familyPages;
    return `<div class="fp-res" role="status"><p class="fp-res-t">${esc(F.resTitle)}</p><p class="fp-res-f"></p><p class="fp-res-n">${esc(F.resNote)}</p>`
        + `<div class="fp-res-b"><button type="button" class="primary fp-res-save">${esc(F.resSave)}</button>`
        + `<button type="button" class="secondary fp-res-share" hidden>${esc(F.resShare)}</button>`
        + `<button type="button" class="secondary fp-res-open">${esc(F.openWin)}</button></div></div>`;
}

function syncProgress(s: DialogState, foot: HTMLElement): void {
    const F = strings.familyPages;
    const { done, total, text } = s.prog;
    setText(foot, '.fp-prog-n', total ? F.progCount(done, total) : '');
    setText(foot, '.fp-prog-step', text);
    const bar = foot.querySelector<HTMLElement>('.fp-bar');
    const fill = foot.querySelector<HTMLElement>('.fp-bar-fill');
    if (bar && fill) {
        const pct = total ? Math.round(done / total * 100) : 0;
        fill.style.width = `${pct}%`;
        bar.setAttribute('aria-valuemax', String(total || 1));
        bar.setAttribute('aria-valuenow', String(done));
    }
}

/** The pages' options for the file: the app's language (the book's language row is the book's alone). */
function pageSetOptionsOf(s: DialogState): PageSetOptions {
    const p = s.pages;
    return {
        lang: getCurrentLanguage(), privacy: s.opts.privacy, families: p.families, clips: p.clips, photos: p.photos,
        map: p.include.map, groups: { ...p.groups },
    };
}

/** The set as chosen and its size, with the alternatives' sizes (§6.3); null without a selection. */
function computeEstimate(s: DialogState): PagesEstimate | null {
    const sel = selectionOf(s);
    if (!selectionReady(sel)) return null;
    const set = buildPageSet(s.data, sel, pageSetOptionsOf(s), { treeName: s.treeName });
    const size = estimatePageSetSize(set);
    const imgs = pageSetImages(set);
    const clips = imgs.filter(i => i.kind === 'clip').length;
    const photos = imgs.length - clips;
    const p = s.pages;
    const smaller = (c: ImageChoice): ImageChoice => c === 'full' ? 'small' : c;
    const canShrink = (p.clips === 'full' && clips > 0) || (p.photos === 'full' && photos > 0);
    return {
        set, size, clips, photos,
        small: canShrink ? estimatePageSetSize(set, { clips: smaller(p.clips), photos: smaller(p.photos) }).bytes : null,
        noClips: p.clips !== 'none' && clips > 0 ? estimatePageSetSize(set, { clips: 'none' }).bytes : null,
        warn: pageSetPrivacyWarning(set),
        name: pageSetFileName(set),
    };
}

/** Recompute the pages' estimate 150 ms after the last change (at once when asked). */
function scheduleEstimate(s: DialogState, now = false): void {
    if (s.estTimer !== null) clearTimeout(s.estTimer);
    s.estTimer = null;
    const run = (): void => {
        s.estTimer = null;
        if (st !== s || s.output !== 'pages') return;
        try { s.est = computeEstimate(s); } catch { s.est = null; }
        sync(s);
    };
    if (now) { run(); return; }
    s.estTimer = window.setTimeout(run, ESTIMATE_DEBOUNCE_MS);
}

/** Write the options' rows for the output (once per opening and on a switch of the output). */
function renderOptions(s: DialogState): void {
    selPicker?.destroy();
    selPicker = null;
    const body = document.querySelector<HTMLElement>('#book-modal .book-dlg-opts');
    if (!body) return;
    body.innerHTML = optionsHtml(s);
    body.scrollTop = 0;
    const host = body.querySelector<HTMLElement>('.book-sel-picker');
    if (host) mountSelPicker(s, host);
}

/** The chosen people's picker under "Selected people" (1102 §4.1): chips, the search, the list with checkboxes. */
function mountSelPicker(s: DialogState, host: HTMLElement): void {
    const F = strings.familyPages;
    selPicker = new MultiPersonPicker({
        container: host, multi: true, data: s.data,
        persons: Object.values(s.data.persons).filter(p => !p.isPlaceholder),
        placeholder: F.selPick, max: Infinity, initial: s.selIds, chipsShown: SEL_CHIPS, moreLabel: F.selMore,
        noneLabel: '', removeLabel: F.selRemove,
        onChange: (ids) => {
            if (st !== s) return;
            s.moved = false;
            s.selIds = ids;
            changed(s);
        },
    });
}

/** What the memory keeps besides the options: the output, the pages' choices, the preset and Custom's values. */
function memoryExtra(s: DialogState): Parameters<typeof saveBookMemory>[3] {
    return { output: s.output, pages: s.pages, preset: s.presets.preset, custom: s.presets.custom };
}

/** A change: remember the options (not the selection's person or the title) and refresh. */
function changed(s: DialogState): void {
    saveBookMemory(storage(), s.treeId, currentOptions(s), memoryExtra(s));
    // A file made for other options is not the one to save.
    if (s.phase === 'result') { s.phase = 'options'; s.file = null; }
    if (s.output === 'pages') scheduleEstimate(s);
    sync(s);
}

export const bookUiMethods = uiModule({
    /**
     * The family book from the menu, Export or the bottom sheet (§4.8: the
     * last lineages, else the whole tree); the output given, else the one
     * remembered for the tree (026 §6.6).
     */
    showBookDialog(output?: BookOutput): void {
        this.openBookDialog({ kind: 'menu' }, undefined, output ? { output } : undefined);
    },

    /**
     * Export → Family pages (026 §7): the dialog with the pages output, for
     * the lineage of the person in focus (the lineage of their card's row),
     * else the remembered lineages.
     */
    showFamilyPagesDialog(): void {
        const data = DataManager.getData();
        const focus = TreeRenderer.getFocusPersonId();
        const row = focus && data.persons[focus] ? personRodRow(buildLineages(data), focus) : null;
        this.openBookDialog({ kind: 'menu' }, undefined, { output: 'pages', selection: row ? { kind: 'rods', rods: [row.rodId] } : undefined });
    },

    /**
     * Actions → For the family and the phone's bottom sheet (026 §7, §9.6;
     * P3 §2.4): the whole tree's window at the line of the person in focus
     * (a small line or none: "Other families"); nobody in focus → its introduction.
     */
    openFamilyPagesForFocus(): void {
        this.closeMobileMenu?.();
        const data = DataManager.getData();
        const focus = TreeRenderer.getFocusPersonId();
        const p = focus ? data.persons[focus] : undefined;
        if (!p || p.isPlaceholder) { this.openTreePages(); return; }
        this.openTreePagesForPerson(p.id);
    },

    /** The person card's "Pages for selected people…" (1102 §3.2): the dialog's pages with this person chosen. */
    openSelectedPersonsPages(personId: PersonId): void {
        this.openBookDialog({ kind: 'menu' }, undefined, { output: 'pages', selection: { kind: 'persons', ids: [personId] } });
    },

    /** The book of a person's descendants, 4 generations (§4.8). */
    openBookForPerson(personId: PersonId): void {
        this.openBookDialog({ kind: 'person', person: personId });
    },

    /**
     * Open the dialog for an entry. `reuse` reopens it from a book window
     * ("Change options"): that book's options, and "Open book" rewrites that
     * window. `over` sets the output and the selection (the pages' window:
     * the pages, its set). The output: given, else the book for an entry of
     * the book (a lineage, a person, Change options), else the remembered one.
     */
    openBookDialog(entry: BookEntry, reuse?: { options: BookOptions; win: Window }, over?: { output?: BookOutput; selection?: BookSelectionSpec }): void {
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
            : bookOptionsFromMemory(appLang, memory, over?.selection ?? bookEntrySelection(entry, index, memory?.lastRods));
        const sel = opts.selection;
        // A small lineage is listed only when the entry asks for it (its pages' window's Save as file).
        const all = new Set(allRods(index).map(r => r.id));
        const rodChoices = bookRodChoices(index);
        if (sel.kind === 'rods') for (const id of sel.rods) if (all.has(id) && !rodChoices.includes(id)) rodChoices.push(id);
        const choosable = new Set(rodChoices);
        const real = (id: PersonId | null | undefined): PersonId | null => {
            const p = id ? data.persons[id] : undefined;
            return p && !p.isPlaceholder ? p.id : null;
        };
        const focus = real(TreeRenderer.getFocusPersonId());
        const gens = { ancestors: BOOK_GENERATIONS_DEFAULT, descendants: BOOK_GENERATIONS_DEFAULT };
        if (sel.kind === 'ancestors' || sel.kind === 'descendants') {
            gens[sel.kind] = clampBookGenerations(typeof sel.generations === 'number' ? sel.generations : BOOK_GENERATIONS_DEFAULT);
        }
        const firstId = Object.keys(data.persons)[0];
        const output: BookOutput = over?.output ?? (!reuse && entry.kind === 'menu' ? memory?.output ?? 'book' : 'book');
        // Chosen people are for the pages only: the book takes the whole tree and says so (1102 §3.1).
        const movedToTree = sel.kind === 'persons' && output !== 'pages';
        if (st?.job) st.job.cancelled = true;
        if (st?.estTimer != null) clearTimeout(st.estTimer);
        st = {
            data, index, treeId, appLang, rodChoices,
            treeName: TreeManager.getActiveTreeMetadata()?.name || '',
            hasHistory: !!(firstId && this.personPageHistory(firstId as PersonId)),
            kind: movedToTree ? 'tree' : sel.kind,
            rods: (sel.kind === 'rods' ? sel.rods : memory?.lastRods ?? []).filter(id => choosable.has(id)),
            person: (sel.kind === 'ancestors' || sel.kind === 'descendants' ? real(sel.person) : null) ?? focus,
            gens,
            selIds: sel.kind === 'persons' ? sel.ids.filter((id, i, all) => !!real(id) && all.indexOf(id) === i) : [],
            ancGens: sel.kind === 'ancestors' && sel.generations != null ? sel.generations : ANC_GENS_DEFAULT,
            moved: movedToTree,
            opts,
            presets: initialPresetState(opts, memory),
            titleEdited: !!opts.title?.trim(),
            win: reuse?.win ?? null,
            sub: null,
            output,
            pages: pagesChoicesFromMemory(memory),
            phase: 'options',
            est: null,
            estTimer: null,
            job: null,
            prog: { done: 0, total: 0, text: '' },
            file: null,
            zip: false,
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
        const out = modal.querySelector<HTMLElement>('.book-out');
        if (out) {
            const F = strings.familyPages;
            out.innerHTML = `<div class="book-seg book-out-seg" role="radiogroup" aria-label="${esc(F.output)}">`
                + (['book', 'pages'] as const).map(o => `<button type="button" role="radio" data-output="${o}">${esc(o === 'book' ? F.outBook : F.outPages)}</button>`).join('')
                + `</div><p class="book-hint book-out-hint"></p>`;
        }
        const foot = modal.querySelector<HTMLElement>('.fp-foot');
        if (foot) { foot.innerHTML = ''; delete foot.dataset.view; }
        renderOptions(st);
        setText(modal, '.book-open-hint', strings.book.dlg.openHint);
        if (!modal.dataset.wired) {
            modal.dataset.wired = '1';
            this.wireBookDialog(modal);
        }
        if (st.output === 'pages') scheduleEstimate(st, true);
        else sync(st);

        // Own the dialog stack (as the poster does): the first Escape closes
        // the book, and no parent dialog can reopen on top of it.
        // Over the pages' window (its Save as file) the window stays on the
        // stack under the dialog: Escape closes the dialog, then the window.
        if (this.isPersonPageOpen()) this.dialogStack = this.dialogStack.filter(id => id !== 'book-modal');
        else this.clearDialogStack();
        this.pushDialog('book-modal');
        this.renderViewLinksNote(modal.querySelector('.modal-header'));
        overlay.classList.add('active');
    },

    /** The dialog's controls (wired once; they act on the current state). */
    wireBookDialog(modal: HTMLElement): void {
        const update = (fn: (s: DialogState) => void): void => {
            if (!st) return;
            st.moved = false;
            fn(st);
            changed(st);
        };
        // A change of what a preset sets (detail, parts, notes, researcher data) lands in Custom (§4.9).
        const updateValues = (fn: (s: DialogState) => void): void => update(s => {
            const before = s.opts;
            fn(s);
            s.presets = presetValuesChanged(s.presets, before, s.opts);
        });
        modal.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            const output = t.closest<HTMLElement>('button[data-output]');
            if (output && st) {
                const out = output.dataset.output as BookOutput;
                if (out === st.output) return;
                closePicker?.();
                st.output = out;
                st.sub = null;
                st.moved = out === 'book' && st.kind === 'persons';
                if (st.moved) st.kind = 'tree';
                st.phase = 'options';
                st.file = null;
                renderOptions(st);
                changed(st);
                if (out === 'pages') scheduleEstimate(st, true);
                return;
            }
            const img = t.closest<HTMLElement>('[data-clips], [data-photos]');
            if (img) {
                update(s => {
                    s.pages = img.dataset.clips
                        ? { ...s.pages, clips: img.dataset.clips as ImageChoice }
                        : { ...s.pages, photos: img.dataset.photos as ImageChoice };
                });
                return;
            }
            const offer = t.closest<HTMLButtonElement>('[data-offer]');
            if (offer) {
                if (offer.disabled) return;
                const smaller = (c: ImageChoice): ImageChoice => c === 'full' ? 'small' : c;
                // The set of files: a switch over 15 MB, the only way over 50 MB.
                if (offer.dataset.offer === 'zip') {
                    update(s => { if (s.est && sizeVerdict(s.est.size.bytes) === 'big') s.zip = !s.zip; });
                    return;
                }
                update(s => {
                    s.pages = offer.dataset.offer === 'small'
                        ? { ...s.pages, clips: smaller(s.pages.clips), photos: smaller(s.pages.photos) }
                        : { ...s.pages, clips: 'none' };
                });
                return;
            }
            if (t.closest('.fp-prog-cancel')) { this.cancelPagesBuild(); return; }
            if (t.closest('.fp-res-save')) { this.savePagesResult(); return; }
            if (t.closest('.fp-res-share')) { this.sharePagesResult(); return; }
            if (t.closest('.fp-res-open')) { this.openFamilyPagesFromDialog(); return; }
            const preset = t.closest<HTMLElement>('[data-preset]');
            if (preset) {
                const p = preset.dataset.preset;
                if (!st || (p !== 'family' && p !== 'research' && p !== 'custom') || p === st.presets.preset) return;
                update(s => {
                    const next = choosePreset(s.presets, s.opts, p);
                    s.presets = next.state;
                    s.opts = next.options;
                });
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
            if ((t.closest('.book-sub-back') || t.closest('.book-sub-done')) && st) {
                const was = st.sub;
                st.sub = null;
                sync(st);
                modal.querySelector<HTMLElement>(was === 'sel' ? `.book-kind[data-kind="${st.kind}"] input` : `[data-sub-open="${was}"]`)?.focus();
                return;
            }
            if (t.closest('.book-person-btn')) { this.openBookPersonPicker(); return; }
            const anc = t.closest<HTMLElement>('[data-anc-gen]');
            if (anc) {
                const v = anc.dataset.ancGen === 'all' ? 'all' as const : Number(anc.dataset.ancGen);
                update(s => { s.ancGens = v; });
                return;
            }
            const step = t.closest<HTMLButtonElement>('[data-gen]');
            if (step) {
                update(s => {
                    if (s.kind !== 'ancestors' && s.kind !== 'descendants') return;
                    s.gens[s.kind] = clampBookGenerations(s.gens[s.kind] + Number(step.dataset.gen));
                });
                return;
            }
            const detail = t.closest<HTMLElement>('[data-detail]');
            if (detail) { updateValues(s => { s.opts = { ...s.opts, detail: detail.dataset.detail as BookDetail }; }); return; }
            const sw = t.closest<HTMLElement>('[data-switch]');
            if (sw) {
                updateValues(s => {
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
            if (t.name === 'fp-families') { update(s => { s.pages = { ...s.pages, families: t.value as PagesChoices['families'] }; }); return; }
            if (t.name === 'fp-grp') {
                const k = t.value as keyof PagesGroups;
                update(s => { s.pages = { ...s.pages, groups: { ...s.pages.groups, [k]: t.checked } }; });
                return;
            }
            if (t.name === 'fp-inc') {
                const k = t.value as typeof INCLUDES[number];
                update(s => { s.pages = { ...s.pages, include: { ...s.pages.include, [k]: t.checked } }; });
                return;
            }
            if (t.closest('.book-rod-row')) {
                update(s => {
                    const id = t.value as RodId;
                    const order = s.rodChoices;
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
                updateValues(s => { s.opts = { ...s.opts, parts: { ...s.opts.parts, [k]: t.checked } }; });
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
        selPicker?.destroy();
        selPicker = null;
        // A file being built is dropped: nothing is saved.
        if (st?.job) st.job.cancelled = true;
        if (st?.estTimer != null) clearTimeout(st.estTimer);
        document.getElementById('book-modal')?.classList.remove('active');
        if (this.isPersonPageOpen()) this.dialogStack = this.dialogStack.filter(id => id !== 'book-modal');
        else this.clearDialogStack();
        st = null;
    },

    /** "Save file…" / "Save and share…": the file a page at a time, its progress after ~1 s, then the result (026 §6.5). */
    async buildPagesFromDialog(): Promise<void> {
        const s = st;
        if (!s || s.output !== 'pages' || s.phase !== 'options') return;
        const sel = selectionOf(s);
        if (!selectionReady(sel)) return;
        if (s.estTimer !== null) scheduleEstimate(s, true);
        if (!s.est) return;
        const zip = savesZip(s);
        saveBookMemory(storage(), s.treeId, currentOptions(s), memoryExtra(s));
        const job: PagesJob = { cancelled: false };
        s.job = job;
        s.phase = 'building';
        s.prog = { done: 0, total: 0, text: '' };
        sync(s);
        const timer = window.setTimeout(() => {
            if (st === s && s.job === job && s.phase === 'building') { s.phase = 'progress'; sync(s); }
        }, PROGRESS_AFTER_MS);
        try {
            const file = await buildPagesFile(s.data, sel, pageSetOptionsOf(s), job, (done, total, text) => {
                s.prog = { done, total, text };
                const foot = document.querySelector<HTMLElement>('#book-modal .fp-foot');
                if (st === s && s.job === job && s.phase === 'progress' && foot) syncProgress(s, foot);
            }, zip);
            if (st !== s || s.job !== job) return;
            s.file = file;
            s.phase = 'result';
        } catch (e) {
            if (st !== s || s.job !== job) return;
            s.phase = 'options';
            if (!(e instanceof PagesCancelled)) this.showAlert(strings.familyPages.buildFailed, 'warning');
        } finally {
            clearTimeout(timer);
            if (s.job === job) s.job = null;
        }
        sync(s);
        if (s.phase === 'result') document.querySelector<HTMLElement>('#book-modal .fp-res-save')?.focus();
    },

    /** Cancel during the build: back to the options, nothing saved. */
    cancelPagesBuild(): void {
        const s = st;
        if (!s?.job) return;
        s.job.cancelled = true;
        s.job = null;
        s.phase = 'options';
        sync(s);
        document.querySelector<HTMLElement>('#book-modal #book-open')?.focus();
    },

    /** The result's Save: a download, as the person page and the book save. */
    savePagesResult(): void {
        const file = st?.file;
        if (!file) return;
        try {
            downloadPagesFile(file);
            this.showToast(strings.familyPages.saved(file.name));
        } catch {
            this.showAlert(strings.familyPages.saveFailed, 'warning');
        }
    },

    /** The result's Share…: Web Share with the file, where the device shares files. */
    sharePagesResult(): void {
        const file = st?.file;
        if (!file) return;
        void sharePagesFile(file).catch(() => { /* cancelled */ });
    },

    /** "Open in window": the set's page in the app's window (the window's own set, §0.8). */
    openFamilyPagesFromDialog(): void {
        const s = st;
        if (!s) return;
        const sel = selectionOf(s);
        if (!selectionReady(sel)) return;
        this.closeBookDialog();
        this.openFamilyPagesExact(sel);
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

    /** The book's window straight away for a selection (from the pages' window): the remembered options. */
    openFamilyBookFor(spec: BookSelectionSpec): void {
        const data = DataManager.getData();
        if (Object.keys(data.persons).length === 0) { this.showAlert(strings.book.empty, 'warning'); return; }
        const options = bookOptionsFromMemory(appBookLang(), loadBookMemory(storage(), TreeManager.getActiveTreeId()), spec);
        const win = window.open('', '_blank');
        if (!win) { this.showAlert(strings.export.failed, 'warning'); return; }
        win.document.open();
        win.document.write(this.familyBookHtml(options, false));
        win.document.close();
        this.wireBookWindow(win, options);
        try { win.focus(); } catch { /* the browser decides */ }
    },

    /** "Open book": the window opens (or the one being changed is rewritten); for the pages, the file is built. */
    generateFamilyBook(): void {
        const s = st;
        if (!s) return;
        if (s.output === 'pages') {
            // One chosen person: that person's page and its export (025), not a set (1102 §4.1).
            const one = onePerson(s);
            if (one) {
                if (s.phase !== 'options') return;
                this.closeBookDialog();
                this.showPersonPage(one);
                this.showPersonPageExport(false);
                return;
            }
            void this.buildPagesFromDialog();
            return;
        }
        const sel = selectionOf(s);
        if (!selectionReady(sel)) return;
        if (Object.keys(s.data.persons).length === 0) {
            this.showAlert(strings.book.empty, 'warning');
            return;
        }
        const options = currentOptions(s);
        saveBookMemory(storage(), s.treeId, options, memoryExtra(s));
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
            if (act === 'pages') {
                try { window.focus(); } catch { /* the browser decides */ }
                this.openFamilyPages(options.selection);
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

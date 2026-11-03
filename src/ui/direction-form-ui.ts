/**
 * The dialog that creates or edits a research direction through the
 * research's bridge (spec 038 §2, §3.1). Opened from the Directions panel
 * ("+ New direction", ⋯ Edit), from a person's research items and from a
 * branch outside the directions (preset person and kind).
 *
 * Built once per opening and updated in place, so typing keeps its focus.
 * Errors stay in the form (a busy research tried once more after 3 s, then a
 * box with Try again); only success closes it, with a toast.
 */

import type { LiveDirection, LiveDirectionKind } from '../research-link.js';
import { Person, PersonId } from '../types.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { shownName } from '../person-name.js';
import { yearOf } from '../dates.js';
import { filterAndSort } from '../person-picker.js';
import { withBusyRetry } from '../research-directions.js';
import { createDirection, directionPeopleKept, editDirection, fetchDirectionPeople, DirectionEditBody } from '../research-directions-write.js';
import type { PersonMenuAction } from './context-menu.js';
import {
    BEFORE_MAX, BEFORE_MIN, FORM_KINDS, FormKind, FormProblem, GENERATIONS_MAX, autoDirectionName, changedLimits,
    findDuplicateDirection, formProblem, newPrimary, parseBeforeYear,
} from '../direction-form.js';
import { LiveSession, el, liveSession } from './research-ui.js';
import { directionGlyph, directionRefusedText, markFreshDirection } from './research-directions-ui.js';
import { readRecent } from './tree-overview.js';
import { normalizeModal } from './modal-skeleton.js';
import { researchLinkFlags } from './research-open-mark.js';
import { uiModule } from './module.js';

const DIALOG_ID = 'direction-form-modal';
/** Most people the search lists. */
const MAX_RESULTS = 30;
/** Most recent people listed. */
const MAX_RECENT = 7;

/** What the dialog opens on. */
export interface DirectionFormOptions {
    mode: 'new' | 'edit';
    /** `edit`: the direction edited. */
    direction?: LiveDirection;
    /** `new`: the person chosen beforehand (the research's REFN, "P0012"). */
    person?: string;
    /** `new`: the kind chosen beforehand. */
    kind?: Exclude<LiveDirectionKind, 'person'>;
    /** `new`: a branch outside the directions the direction grows from ("B-P0031"). */
    branch?: string;
    /** `new`: the kind was pre-filled from the branch's relation (says so under the kinds). */
    kindFromBranch?: boolean;
    /** `new`: a line under the person ("From the branch Alois Fíšek · brother of …"). */
    branchNote?: string;
    /** The control focused back when the dialog closes. */
    returnFocus?: HTMLElement | null;
}

/** The dialog open now. */
interface FormState {
    opts: DirectionFormOptions;
    edit: LiveDirection | null;
    person: Person | null;
    /** The person's REFN ('' = the research does not know the person). */
    refn: string;
    kind: FormKind;
    question: string;
    name: string;
    nameEdited: boolean;
    generations: number | null;
    before: string;
    known: string;
    reason: string;
    limitsOpen: boolean;
    picker: boolean;
    search: string;
    sending: boolean;
    problem: FormProblem | null;
    /** The primary was tried without a question (the question kind): say it. */
    questionTried: boolean;
    /** The primary was tried with a year it does not take. */
    yearTried: boolean;
    /** A direction the research answered 409 `directions.exists` with. */
    existing: LiveDirection | null;
    root: HTMLElement;
}

let form: FormState | null = null;

const personByRefn = (refn: string | undefined): Person | null =>
    refn ? Object.values(DataManager.getData().persons).find(p => p.refn === refn) ?? null : null;

/** "1840–1902", "1840–", '' (no dates). */
function personYears(p: Person): string {
    const born = yearOf(p.birthDate);
    const died = yearOf(p.deathDate);
    return born !== null || died !== null ? `${born ?? ''}–${died ?? ''}` : '';
}

/** The day a duplicate's state changed ("28. 10.", "Oct 28"). */
function sinceDate(iso: string | undefined): string {
    const ts = Date.parse(iso ?? '');
    if (!Number.isFinite(ts)) return '';
    const d = new Date(ts);
    const opts: Intl.DateTimeFormatOptions = d.getFullYear() === new Date().getFullYear()
        ? { day: 'numeric', month: 'numeric' } : { day: 'numeric', month: 'numeric', year: 'numeric' };
    try { return d.toLocaleDateString(getCurrentLanguage(), opts); } catch { return d.toISOString().slice(0, 10); }
}

const KIND_GLYPH: Record<FormKind, string> = { ancestors: '↑', descendants: '↓', question: '?' };

function kindLabel(kind: FormKind): string {
    const L = strings.live;
    return kind === 'ancestors' ? L.dirKindAncestors : kind === 'descendants' ? L.dirKindDescendants : L.dirKindQuestion;
}

/** The kinds the research creates (`caps.directionKinds`; all three when it does not say). */
function offeredKinds(): FormKind[] {
    const said = liveSession()?.caps?.directionKinds;
    const kinds = Array.isArray(said) ? FORM_KINDS.filter(k => said.includes(k)) : [...FORM_KINDS];
    return kinds.length > 0 ? kinds : [...FORM_KINDS];
}

/** The feature of a research that says who is in which direction (`GET /directions/people`). */
const PEOPLE_FEATURE = 'directions.people';
/** Most directions named in "In direction" ("and {n} more" after them). */
const IN_LINE_SHOWN = 2;

const q = <T extends HTMLElement>(root: HTMLElement, sel: string): T => root.querySelector(sel) as T;

export const directionFormMethods = uiModule({
    /** The followed research of this tree manages its directions through the bridge (`caps.directionsWrite`). */
    managesDirections(): boolean {
        const s = liveSession();
        return !!s && !s.ended && s.treeId === DataManager.getCurrentTreeId() && !!s.caps?.directionsWrite;
    },

    /**
     * Read again who is in which direction when the research's head moved
     * (`directions.people`); the person detail open shows it then, and a
     * growing branch waiting is drawn again (its main button's direction).
     */
    refreshDirectionPeople(s: LiveSession, head: string): void {
        if (!s.caps?.directionsWrite || !s.features?.includes(PEOPLE_FEATURE)) return;
        const before = directionPeopleKept(s.bridge.base);
        void fetchDirectionPeople(s.bridge.base, head).then(r => {
            if (!r.ok || liveSession() !== s || s.ended) return;
            this.renderPersonInLine();
            // A growing branch's main button picks its running direction by who is in which one: newly read, drawn again.
            if (r.people !== before && s.waiting.some(w => w.kind === 'branch')) this.renderLivePanel();
        });
    },

    /** The person's directions (active and paused), the narrowest first; [] when not known. */
    personInLine(personId: PersonId): LiveDirection[] {
        const s = liveSession();
        if (!s || s.ended || s.treeId !== DataManager.getCurrentTreeId() || !s.caps?.directionsWrite) return [];
        if (!s.features?.includes(PEOPLE_FEATURE)) return [];
        const refn = DataManager.getPerson(personId)?.refn;
        const ids = refn ? directionPeopleKept(s.bridge.base)?.get(refn) ?? [] : [];
        return ids.map(id => s.researches.find(d => d.id === id))
            .filter((d): d is LiveDirection => !!d && d.state !== 'done');
    },

    /**
     * "In direction" on top of the person's Research › (spec 038 §5.1 a):
     * the label, each direction (its kind, its name, "in progress" while an
     * agent works on it), two at most and "and {n} more". No mark: it opens
     * the overview on the direction.
     */
    personInLineItems(personId: PersonId): PersonMenuAction[] {
        const L = strings.live;
        const lines = this.personInLine(personId);
        if (lines.length === 0) return [];
        const shown = lines.length > IN_LINE_SHOWN ? lines.slice(0, IN_LINE_SHOWN) : lines;
        const header = lines.length > 1 ? L.dirInLines : L.dirInLine;
        const items: PersonMenuAction[] = shown.map((d, i) => ({
            action: `research-in-line:${d.id}`,
            label: d.name,
            glyph: directionGlyph(d),
            ...(d.working ? { state: L.dirWorkingWord } : {}),
            ariaLabel: [header, d.name, d.working ? L.dirWorkingWord : ''].filter(Boolean).join(', '),
            ...(i === 0 ? { header } : {}),
        }));
        if (lines.length > shown.length) {
            items.push({ action: 'research-in-line-more', label: L.dirInMore(lines.length - shown.length), glyph: '' });
        }
        return items;
    },

    /** A "In direction" row chosen: the overview on that direction ("and {n} more": on the Directions). */
    runPersonInLine(action: string): void {
        const id = action.startsWith('research-in-line:') ? action.slice('research-in-line:'.length) : '';
        if (id) {
            this.openResearchDirection(id);
            return;
        }
        this.unfoldOverviewSection('directions');
        if (this.isResearchOverviewOpen()) this.renderResearchOverview();
        else this.openResearchOverview();
    },

    /** "In direction" in the person detail (§5.1 b): under the lineage row, the directions as links. */
    renderPersonInLine(personId?: PersonId | null): void {
        const row = document.getElementById('pm-in-line');
        if (!row) return;
        if (personId !== undefined) {
            if (personId) row.dataset.person = personId;
            else delete row.dataset.person;
        }
        const who = row.dataset.person as PersonId | undefined;
        const lines = who && DataManager.getPerson(who) ? this.personInLine(who) : [];
        row.replaceChildren();
        row.hidden = lines.length === 0;
        if (lines.length === 0) return;
        const L = strings.live;
        row.appendChild(el('span', 'pm-rod-label pm-in-line-label', lines.length > 1 ? L.dirInLines : L.dirInLine));
        const list = el('span', 'pm-in-line-list');
        const shown = lines.length > IN_LINE_SHOWN ? lines.slice(0, IN_LINE_SHOWN) : lines;
        shown.forEach((d, i) => {
            if (i > 0) list.append(' · ');
            const link = el('button', 'link-button pm-in-line-link');
            link.type = 'button';
            link.dataset.direction = d.id;
            const g = el('span', 'pm-in-line-glyph', directionGlyph(d));
            g.setAttribute('aria-hidden', 'true');
            link.append(g, el('span', 'pm-in-line-name', d.name));
            link.onclick = () => this.leavePersonModalThen(() => this.openResearchDirection(d.id));
            list.appendChild(link);
            if (d.working) list.append(' ', el('span', 'pm-in-line-working', L.dirWorkingWord));
        });
        if (lines.length > shown.length) list.append(' · ', el('span', 'pm-in-line-more', L.dirInMore(lines.length - shown.length)));
        row.appendChild(list);
    },

    /** Open the direction dialog on a new direction (a person and kind may come chosen) or on one to edit. */
    openDirectionForm(opts: DirectionFormOptions): void {
        const s = liveSession();
        if (!s || s.ended || !s.caps?.directionsWrite) return;
        this.closeDirectionForm(false);
        const edit = opts.mode === 'edit' ? opts.direction ?? null : null;
        if (opts.mode === 'edit' && !edit) return;
        const kinds = offeredKinds();
        const presetKind = edit?.direction ?? opts.kind;
        const kind: FormKind = presetKind && (FORM_KINDS as readonly string[]).includes(presetKind)
            && (edit || kinds.includes(presetKind as FormKind)) ? presetKind as FormKind : kinds[0];
        const person = personByRefn(edit ? edit.focus : opts.person);
        const refn = edit?.focus ?? (person?.refn ? person.refn : '');
        const limits = edit?.limits;
        const root = el('div', 'modal-overlay active');
        root.id = DIALOG_ID;
        form = {
            opts, edit, person, refn, kind,
            question: edit?.question ?? '',
            name: edit?.name ?? '',
            nameEdited: !!edit,
            generations: limits?.generations ?? null,
            before: limits?.before !== undefined ? String(limits.before) : '',
            known: '',
            reason: edit?.reason ?? '',
            limitsOpen: !!edit && (limits?.generations !== undefined || limits?.before !== undefined),
            picker: !edit && !person,
            search: '',
            sending: false,
            problem: null,
            questionTried: false,
            yearTried: false,
            existing: null,
            root,
        };
        this.buildDirectionForm(form, kinds);
        document.body.appendChild(root);
        this.pushDialog(DIALOG_ID);
        normalizeModal(q(root, '.modal'));
        this.renderDirectionForm();
        // First control: the search (no person yet), the name (an edit), else the kind chosen.
        const first = form.picker ? q<HTMLInputElement>(root, '#direction-form-search')
            : edit ? q<HTMLInputElement>(root, '#direction-form-name')
                : root.querySelector<HTMLElement>('.direction-form__kind[aria-checked="true"]');
        first?.focus();
    },

    /** Close the dialog (`back`: focus the control it was opened from). */
    closeDirectionForm(back = true): void {
        const f = form;
        form = null;
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        let to = f?.opts.returnFocus;
        // A redrawn panel replaced the control: its successor for the same direction.
        if (to && !to.isConnected && to.dataset.direction) {
            to = document.querySelector<HTMLElement>(`.${[...to.classList].join('.')}[data-direction="${to.dataset.direction}"]`);
        }
        if (back && to?.isConnected) to.focus();
    },

    /** The dialog's skeleton (once); renderDirectionForm fills in what changes. */
    buildDirectionForm(f: FormState, kinds: FormKind[]): void {
        const L = strings.live;
        const edit = f.edit;
        const modal = el('div', 'modal modal--md direction-form');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'direction-form-title');
        modal.dataset.dialogKind = 'form';

        // Header: the title, under it the tree (new) or the direction's name (edit).
        const header = el('div', 'modal-header');
        const heading = el('div', 'audit-log-heading');
        const h2 = el('h2', undefined, edit ? L.dirFormEdit : L.dirFormNew);
        h2.id = 'direction-form-title';
        heading.append(h2, el('div', 'audit-log-subtitle', edit ? edit.name : liveSession()?.name ?? ''));
        const x = el('button', 'close-btn', '×');
        x.type = 'button';
        x.id = 'direction-form-close-x';
        x.setAttribute('aria-label', strings.buttons.close);
        x.onclick = () => this.closeDirectionForm();
        header.append(heading, x);

        const fields = el('fieldset', 'direction-form__fields');

        // Person.
        const personField = el('div', 'direction-form__field');
        const personLabel = el('div', 'direction-form__label', L.dirPerson);
        personLabel.id = 'direction-form-person-label';
        const personBox = el('div', 'direction-form__person');
        personBox.setAttribute('role', 'group');
        personBox.setAttribute('aria-labelledby', 'direction-form-person-label');
        personField.append(personLabel, personBox);

        // Kind (a radio group; an edit shows its kind only).
        const kindField = el('div', 'direction-form__field');
        const kindLabelEl = el('div', 'direction-form__label', L.dirKindLabel);
        kindLabelEl.id = 'direction-form-kind-label';
        const seg = el('div', 'direction-form__kinds');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-labelledby', 'direction-form-kind-label');
        const shownKinds = edit ? FORM_KINDS.filter(k => k === f.kind || kinds.includes(k)) : kinds;
        for (const k of shownKinds) {
            const b = el('button', 'direction-form__kind');
            b.type = 'button';
            b.dataset.kind = k;
            b.setAttribute('role', 'radio');
            const g = el('span', 'direction-form__kind-glyph', KIND_GLYPH[k]);
            g.setAttribute('aria-hidden', 'true');
            b.append(g, el('span', undefined, kindLabel(k)));
            b.onclick = () => this.setDirectionFormKind(k);
            b.onkeydown = (e) => this.directionFormKindKey(e, shownKinds);
            seg.appendChild(b);
        }
        const kindHint = el('p', 'direction-form__hint direction-form__kind-hint');
        kindField.append(kindLabelEl, seg, kindHint);
        if (edit && !(FORM_KINDS as readonly string[]).includes(edit.direction ?? '')) kindField.hidden = true;

        // A direction there already (role=status: said when it shows).
        const dup = el('div', 'direction-form__dup');
        dup.setAttribute('role', 'status');

        // Question.
        const qField = el('div', 'direction-form__field');
        const qLabel = el('label', 'direction-form__label');
        qLabel.htmlFor = 'direction-form-question';
        qLabel.append(el('span', undefined, L.dirQuestion), el('span', 'direction-form__label-note'));
        const qInput = el('textarea', 'direction-form__input');
        qInput.id = 'direction-form-question';
        qInput.rows = 2;
        qInput.maxLength = 400;
        qInput.value = f.question;
        qInput.oninput = () => { f.question = qInput.value; this.renderDirectionForm(); };
        const qError = el('p', 'direction-form__error', L.dirQuestionNeeded);
        qError.id = 'direction-form-question-error';
        qField.append(qLabel, qInput, qError);

        // Name.
        const nField = el('div', 'direction-form__field');
        const nLabel = el('label', 'direction-form__label', L.dirName);
        nLabel.htmlFor = 'direction-form-name';
        const nInput = el('input', 'direction-form__input');
        nInput.id = 'direction-form-name';
        nInput.type = 'text';
        nInput.maxLength = 120;
        nInput.autocomplete = 'off';
        nInput.value = f.name;
        nInput.oninput = () => { f.name = nInput.value; f.nameEdited = true; this.renderDirectionForm(); };
        const nHint = el('p', 'direction-form__hint direction-form__name-hint', L.dirNameAuto);
        nHint.id = 'direction-form-name-hint';
        nField.append(nLabel, nInput, nHint);

        // A paused direction's reason (edit).
        const rField = el('div', 'direction-form__field');
        if (edit?.state === 'paused') {
            const rLabel = el('label', 'direction-form__label', L.dirPauseReason);
            rLabel.htmlFor = 'direction-form-reason';
            const rInput = el('input', 'direction-form__input');
            rInput.id = 'direction-form-reason';
            rInput.type = 'text';
            rInput.maxLength = 200;
            rInput.value = f.reason;
            rInput.oninput = () => { f.reason = rInput.value; };
            rField.append(rLabel, rInput);
        } else rField.hidden = true;

        // Limit… (a disclosure; folded, it says what is set).
        const limits = el('div', 'direction-form__limits');
        const disc = el('button', 'direction-form__disclosure');
        disc.type = 'button';
        disc.setAttribute('aria-controls', 'direction-form-limits-body');
        const chev = el('span', 'direction-form__chev', '▸');
        chev.setAttribute('aria-hidden', 'true');
        disc.append(chev, el('span', 'direction-form__disclosure-label', L.dirLimit), el('span', 'direction-form__limit-sum'));
        disc.onclick = () => { f.limitsOpen = !f.limitsOpen; this.renderDirectionForm(); };
        const limBody = el('div', 'direction-form__limits-body');
        limBody.id = 'direction-form-limits-body';
        const row = el('div', 'direction-form__limit-row');
        const gWrap = el('div', 'direction-form__limit');
        const gLabel = el('label', 'direction-form__label', L.dirLimitGens);
        gLabel.htmlFor = 'direction-form-generations';
        const gSel = el('select', 'direction-form__input direction-form__select');
        gSel.id = 'direction-form-generations';
        gSel.appendChild(new Option(L.dirNoLimit, ''));
        for (let i = 1; i <= GENERATIONS_MAX; i++) gSel.appendChild(new Option(String(i), String(i)));
        // An edited direction's own limit stays offered even past the list.
        if (f.generations !== null && f.generations > GENERATIONS_MAX) gSel.appendChild(new Option(String(f.generations), String(f.generations)));
        gSel.value = f.generations === null ? '' : String(f.generations);
        gSel.onchange = () => { f.generations = gSel.value ? Number.parseInt(gSel.value, 10) : null; this.renderDirectionForm(); };
        gWrap.append(gLabel, gSel);
        const yWrap = el('div', 'direction-form__limit direction-form__limit--year');
        const yLabel = el('label', 'direction-form__label', L.dirLimitYear);
        yLabel.htmlFor = 'direction-form-before';
        const yInput = el('input', 'direction-form__input direction-form__year');
        yInput.id = 'direction-form-before';
        yInput.type = 'text';
        yInput.inputMode = 'numeric';
        yInput.maxLength = 4;
        yInput.autocomplete = 'off';
        yInput.placeholder = `${BEFORE_MIN}–${BEFORE_MAX}`;
        yInput.value = f.before;
        yInput.oninput = () => { f.before = yInput.value; this.renderDirectionForm(); };
        const yError = el('p', 'direction-form__error', L.dirYearBad);
        yError.id = 'direction-form-before-error';
        yWrap.append(yLabel, yInput, yError);
        row.append(gWrap, yWrap);
        limBody.appendChild(row);
        if (!edit) {
            const kLabel = el('label', 'direction-form__label', L.dirKnown);
            kLabel.htmlFor = 'direction-form-known';
            const kInput = el('textarea', 'direction-form__input');
            kInput.id = 'direction-form-known';
            kInput.rows = 3;
            kInput.maxLength = 2000;
            kInput.oninput = () => { f.known = kInput.value; };
            const kWrap = el('div', 'direction-form__field direction-form__known');
            kWrap.append(kLabel, kInput);
            limBody.appendChild(kWrap);
        }
        limits.append(disc, limBody);

        const free = el('p', 'direction-form__free');
        const i = el('span', 'direction-form__free-icon', 'i');
        i.setAttribute('aria-hidden', 'true');
        free.append(i, el('span', undefined, edit ? L.dirEditFree : L.dirFree));

        fields.append(personField, kindField, dup, qField, nField, rField, limits, free);

        // The research's answer when it did not take the write (above the footer).
        const problem = el('div', 'direction-form__problem');
        problem.setAttribute('role', 'alert');

        const buttons = el('div', 'buttons');
        const cancel = el('button', 'secondary', strings.buttons.cancel);
        cancel.type = 'button';
        cancel.setAttribute('data-dismiss', '');
        cancel.onclick = () => this.closeDirectionForm();
        const primary = el('button', 'primary direction-form__primary');
        primary.type = 'button';
        primary.id = 'direction-form-submit';
        primary.onclick = () => void this.submitDirectionForm();
        buttons.append(cancel, primary);

        modal.append(header, fields, problem, buttons);
        f.root.appendChild(modal);
        // Enter in a one-line field acts like the primary (never in the search: it picks).
        modal.addEventListener('keydown', (e) => {
            const t = e.target as HTMLElement;
            if (e.key === 'Enter' && t instanceof HTMLInputElement && t.id !== 'direction-form-search' && !e.isComposing) {
                e.preventDefault();
                void this.submitDirectionForm();
            }
        });
    },

    /** Bring the dialog in line with its state (fields keep their focus and text). */
    renderDirectionForm(): void {
        const f = form;
        if (!f) return;
        const L = strings.live;
        const s = liveSession();
        const root = f.root;
        const modal = q(root, '.modal');
        modal.classList.toggle('is-sending', f.sending);
        modal.setAttribute('aria-busy', String(f.sending));
        q<HTMLFieldSetElement>(root, '.direction-form__fields').disabled = f.sending;

        this.renderDirectionFormPerson(f);

        // Kind.
        root.querySelectorAll<HTMLButtonElement>('.direction-form__kind').forEach(b => {
            const on = b.dataset.kind === f.kind;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
            b.classList.toggle('is-on', on);
            if (f.edit && !on) b.setAttribute('aria-disabled', 'true');
        });
        const kindHint = q(root, '.direction-form__kind-hint');
        const hint = f.edit ? L.dirLocked : f.opts.kindFromBranch ? L.dirKindFromBranch : '';
        kindHint.textContent = hint;
        kindHint.hidden = !hint;

        // A direction there already (a new one only).
        const duplicate = this.directionFormDuplicate(f);
        const dup = q(root, '.direction-form__dup');
        dup.replaceChildren();
        dup.hidden = !duplicate;
        dup.className = `direction-form__dup${duplicate?.state === 'active' ? ' is-active' : ''}`;
        const primaryWill = f.edit ? 'save' : newPrimary({
            person: !!f.person, linked: !!f.refn, kind: f.kind, question: f.question,
            duplicate, duplicatesAllowed: !!s?.caps?.duplicateDirections,
        });
        if (duplicate) {
            const text = duplicate.state === 'active' ? L.dirDupActive(duplicate.name)
                : duplicate.state === 'paused' ? L.dirDupPaused(duplicate.name) : L.dirDupEnded(duplicate.name);
            const line = el('div', 'direction-form__dup-text');
            line.appendChild(el('span', undefined, text));
            // The link to it, unless the primary already shows it.
            if (primaryWill !== 'show') {
                const show = el('button', 'link-button direction-form__show', L.dirShowIt);
                show.type = 'button';
                show.onclick = () => this.showDirectionFromForm(duplicate.id);
                line.append(' ', show);
            }
            dup.appendChild(line);
            if (duplicate.state !== 'active') {
                const since = sinceDate(duplicate.since);
                const sub = [since ? L.dirDupSince(since) : '', duplicate.reason ? strings.materials.quoted(duplicate.reason) : ''].filter(Boolean).join(' · ');
                if (sub) dup.appendChild(el('div', 'direction-form__dup-sub', sub));
            }
        }

        // Question: required for the question kind.
        const qNote = q(root, 'label[for="direction-form-question"] .direction-form__label-note');
        qNote.textContent = f.kind === 'question' ? ` · ${L.dirQuestionRequired}` : ` ${L.dirQuestionOptional}`;
        const qInput = q<HTMLTextAreaElement>(root, '#direction-form-question');
        const qMissing = f.kind === 'question' && !f.question.trim();
        const qError = q(root, '#direction-form-question-error');
        qError.hidden = !(qMissing && f.questionTried);
        qInput.setAttribute('aria-invalid', String(qMissing && f.questionTried));
        if (qMissing && f.questionTried) qInput.setAttribute('aria-describedby', qError.id);
        else qInput.removeAttribute('aria-describedby');
        qInput.required = f.kind === 'question';

        // Name: filled in until changed.
        const auto = autoDirectionName(f.kind, f.person ? shownName(f.person) : '', f.question);
        const nInput = q<HTMLInputElement>(root, '#direction-form-name');
        if (!f.nameEdited) {
            f.name = auto;
            if (nInput.value !== auto) nInput.value = auto;
        }
        const nHint = q(root, '.direction-form__name-hint');
        nHint.hidden = f.nameEdited || !auto;
        if (nHint.hidden) nInput.removeAttribute('aria-describedby');
        else nInput.setAttribute('aria-describedby', nHint.id);

        // Limit…
        const year = parseBeforeYear(f.before);
        const yearShown = f.kind !== 'descendants';
        const disc = q(root, '.direction-form__disclosure');
        disc.setAttribute('aria-expanded', String(f.limitsOpen));
        q(root, '.direction-form__chev').textContent = f.limitsOpen ? '▾' : '▸';
        const bits = [
            f.generations !== null ? L.dirLimitGen(f.generations) : '',
            yearShown && typeof year === 'number' ? L.dirLimitBefore(year) : '',
        ].filter(Boolean);
        const sum = q(root, '.direction-form__limit-sum');
        sum.textContent = !f.limitsOpen && bits.length > 0 ? bits.join(' · ') : '';
        sum.hidden = !sum.textContent;
        q(root, '.direction-form__limits-body').hidden = !f.limitsOpen;
        q(root, '.direction-form__limit--year').hidden = !yearShown;
        const yInput = q<HTMLInputElement>(root, '#direction-form-before');
        const yBad = yearShown && year === 'bad' && f.yearTried;
        q(root, '#direction-form-before-error').hidden = !yBad;
        yInput.setAttribute('aria-invalid', String(yBad));
        if (yBad) yInput.setAttribute('aria-describedby', 'direction-form-before-error');
        else yInput.removeAttribute('aria-describedby');

        // The research's answer.
        const problem = q(root, '.direction-form__problem');
        problem.replaceChildren();
        problem.hidden = !f.problem;
        if (f.problem) {
            problem.className = `direction-form__problem is-${f.problem.tone}`;
            problem.appendChild(el('span', undefined, f.problem.text));
            if (f.problem.retry) {
                const again = el('button', 'link-button direction-form__retry', L.dirRetry);
                again.type = 'button';
                again.onclick = () => void this.submitDirectionForm();
                problem.append(' ', again);
            }
        }

        // The primary: what it does now, held while sending or not ready.
        const primary = q<HTMLButtonElement>(root, '#direction-form-submit');
        primary.replaceChildren();
        if (f.sending) {
            const spin = el('span', 'direction-form__spinner');
            spin.setAttribute('aria-hidden', 'true');
            primary.append(spin, el('span', undefined, f.edit ? L.dirSaving : L.dirCreating));
        } else {
            primary.textContent = primaryWill === 'save' ? L.dirSave : primaryWill === 'show' ? L.dirShowIt
                : primaryWill === 'anyway' ? L.dirAnyway : primaryWill === 'resume' ? L.dirResume : L.dirCreate;
        }
        primary.dataset.will = primaryWill;
        const off = f.sending || primaryWill === 'off' || (!!f.edit && f.kind === 'question' && !f.question.trim());
        primary.setAttribute('aria-disabled', String(off));
        primary.classList.toggle('is-off', off);
    },

    /** The person: chosen (with Change), being chosen (search and list), or an edit's (cannot change). */
    renderDirectionFormPerson(f: FormState): void {
        const L = strings.live;
        const box = q(f.root, '.direction-form__person');
        const mode = f.edit ? 'locked' : f.picker ? 'picker' : 'chosen';
        if (box.dataset.mode !== mode || mode !== 'picker') {
            box.dataset.mode = mode;
            box.replaceChildren();
            if (mode === 'picker') {
                const search = el('input', 'direction-form__input direction-form__search');
                search.id = 'direction-form-search';
                search.type = 'search';
                search.autocomplete = 'off';
                search.placeholder = L.dirPersonSearch;
                search.setAttribute('aria-label', L.dirPersonSearch);
                search.setAttribute('aria-controls', 'direction-form-picks');
                search.value = f.search;
                search.oninput = () => { f.search = search.value; this.renderDirectionFormPicks(f); };
                search.onkeydown = (e) => {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        f.root.querySelector<HTMLElement>('.direction-form__pick:not([aria-disabled="true"])')?.focus();
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        f.root.querySelector<HTMLElement>('.direction-form__pick:not([aria-disabled="true"])')?.click();
                    }
                };
                const picks = el('div', 'direction-form__picks');
                picks.id = 'direction-form-picks';
                box.append(search, picks);
                this.renderDirectionFormPicks(f);
                return;
            }
            const card = el('div', `direction-form__chosen${mode === 'locked' ? ' is-locked' : ''}`);
            const who = el('div', 'direction-form__who');
            who.appendChild(el('span', 'direction-form__who-name', f.person ? shownName(f.person) : f.refn));
            const years = f.person ? personYears(f.person) : '';
            if (years) who.appendChild(el('span', 'direction-form__who-years', years));
            card.appendChild(who);
            if (mode === 'locked') {
                card.appendChild(el('span', 'direction-form__who-locked', L.dirPersonLocked));
            } else {
                const change = el('button', 'link-button direction-form__change', L.dirPersonChange);
                change.type = 'button';
                change.onclick = () => {
                    f.picker = true;
                    f.search = '';
                    this.renderDirectionForm();
                    q<HTMLInputElement>(f.root, '#direction-form-search')?.focus();
                };
                card.appendChild(change);
            }
            box.appendChild(card);
            if (mode === 'chosen' && f.person && !f.refn) box.appendChild(el('p', 'direction-form__hint is-warn', L.dirNoLink));
            if (mode === 'chosen' && f.opts.branchNote) box.appendChild(el('p', 'direction-form__hint', f.opts.branchNote));
        }
    },

    /** The list under the search: Focus and Recent, or the results (the research's unknown people greyed). */
    renderDirectionFormPicks(f: FormState): void {
        const L = strings.live;
        const picks = f.root.querySelector<HTMLElement>('#direction-form-picks');
        if (!picks) return;
        picks.replaceChildren();
        const head = (text: string): void => { picks.appendChild(el('div', 'direction-form__pick-head', text)); };
        const row = (p: Person): void => {
            const b = el('button', 'direction-form__pick');
            b.type = 'button';
            b.dataset.person = p.id;
            const top = el('span', 'direction-form__pick-top');
            top.appendChild(el('span', 'direction-form__pick-name', shownName(p)));
            const years = personYears(p);
            if (years) top.appendChild(el('span', 'direction-form__pick-years', years));
            b.appendChild(top);
            if (!p.refn) {
                b.setAttribute('aria-disabled', 'true');
                b.appendChild(el('span', 'direction-form__pick-note', L.dirNoLink));
            } else {
                b.onclick = () => {
                    f.person = p;
                    f.refn = p.refn ?? '';
                    f.picker = false;
                    f.search = '';
                    f.existing = null;
                    f.problem = null;
                    this.renderDirectionForm();
                    f.root.querySelector<HTMLElement>('.direction-form__kind[aria-checked="true"]')?.focus();
                };
            }
            b.onkeydown = (e) => this.directionFormPickKey(e);
            picks.appendChild(b);
        };
        const persons = DataManager.getAllPersons().filter(p => !p.isPlaceholder);
        const query = f.search.trim();
        if (query) {
            const hits = filterAndSort(query, persons, DataManager.getData()).slice(0, MAX_RESULTS);
            // Nobody of that name: a sentence, not a group.
            if (hits.length === 0) picks.appendChild(el('p', 'direction-form__pick-none', L.dirPickNone));
            else head(L.dirPickResults);
            hits.forEach(row);
            return;
        }
        const focusId = TreeRenderer.getFocusPersonId();
        const focus = focusId ? DataManager.getPerson(focusId) : null;
        if (focus && !focus.isPlaceholder) {
            head(L.dirPickFocus);
            row(focus);
        }
        const treeId = DataManager.getCurrentTreeId();
        const recent = (treeId ? readRecent(treeId) : [])
            .filter(id => id !== focusId)
            .map(id => DataManager.getPerson(id as PersonId))
            .filter((p): p is Person => !!p && !p.isPlaceholder)
            .slice(0, MAX_RECENT);
        if (recent.length > 0) {
            head(L.dirPickRecent);
            recent.forEach(row);
        }
    },

    /** ↑ ↓ through the people listed (↑ from the first: back to the search). */
    directionFormPickKey(e: KeyboardEvent): void {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const f = form;
        if (!f) return;
        e.preventDefault();
        const rows = [...f.root.querySelectorAll<HTMLElement>('.direction-form__pick:not([aria-disabled="true"])')];
        const at = rows.indexOf(e.currentTarget as HTMLElement);
        const next = e.key === 'ArrowDown' ? rows[at + 1] : at <= 0 ? f.root.querySelector<HTMLElement>('#direction-form-search') : rows[at - 1];
        next?.focus();
    },

    /** Arrows move the chosen kind (a new direction only). */
    directionFormKindKey(e: KeyboardEvent, kinds: FormKind[]): void {
        const f = form;
        if (!f || f.edit) return;
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = kinds[(kinds.indexOf(f.kind) + step + kinds.length) % kinds.length];
        this.setDirectionFormKind(next);
        f.root.querySelector<HTMLElement>(`.direction-form__kind[data-kind="${next}"]`)?.focus();
    },

    setDirectionFormKind(kind: FormKind): void {
        const f = form;
        if (!f || f.edit || f.sending || f.kind === kind) return;
        f.kind = kind;
        f.existing = null;
        f.problem = null;
        f.questionTried = false;
        this.renderDirectionForm();
    },

    /** The direction this person and kind have already (new only): from the panel, or as the research answered. */
    directionFormDuplicate(f: FormState): LiveDirection | null {
        if (f.edit || !f.refn) return null;
        if (f.existing) return f.existing;
        return findDuplicateDirection(liveSession()?.researches ?? [], f.refn, f.kind, f.question);
    },

    /** "Show it": the form closes, the overview opens on that direction. */
    showDirectionFromForm(id: string): void {
        this.closeDirectionForm(false);
        this.openResearchDirection(id);
    },

    /** The primary: create (or show / restart what is there), or save an edit. */
    async submitDirectionForm(): Promise<void> {
        const f = form;
        if (!f || f.sending) return;
        const s = liveSession();
        if (!s || s.ended) {
            this.closeDirectionForm();
            return;
        }
        const L = strings.live;
        const primary = q<HTMLButtonElement>(f.root, '#direction-form-submit');
        const will = primary.dataset.will;
        if (will === 'show' || will === 'resume') {
            const d = this.directionFormDuplicate(f);
            if (!d) return;
            this.closeDirectionForm(false);
            if (will === 'show') this.openResearchDirection(d.id);
            else {
                const known = s.researches.find(x => x.id === d.id) ?? d;
                void this.changeDirectionState(known, 'resume');
            }
            return;
        }
        // Not ready: say what is missing at its field.
        if (f.kind === 'question' && !f.question.trim() && (f.edit || (f.person && f.refn))) {
            f.questionTried = true;
            this.renderDirectionForm();
            q<HTMLTextAreaElement>(f.root, '#direction-form-question').focus();
            return;
        }
        if (will === 'off') {
            if (f.picker) q<HTMLInputElement>(f.root, '#direction-form-search')?.focus();
            return;
        }
        const year = f.kind === 'descendants' ? null : parseBeforeYear(f.before);
        if (year === 'bad') {
            f.yearTried = true;
            f.limitsOpen = true;
            this.renderDirectionForm();
            q<HTMLInputElement>(f.root, '#direction-form-before').focus();
            return;
        }
        const view = this.directionsView(s);
        if (!view.canWrite) {
            f.problem = { text: view.down ? L.dirBridgeDown : L.dirArchive, tone: 'danger', retry: false, said: '' };
            this.renderDirectionForm();
            return;
        }
        f.problem = null;
        f.sending = true;
        this.renderDirectionForm();
        if (f.edit) await this.saveDirectionEdit(f, year);
        else await this.createDirectionFromForm(f, year);
    },

    /** Create the direction: last in the order, lit for 2 s, a toast with "Work on this direction". */
    async createDirectionFromForm(f: FormState, year: number | null): Promise<void> {
        const s = liveSession();
        if (!s) return;
        const L = strings.live;
        const base = s.bridge.base;
        const branch = f.opts.branch;
        const head = await this.waitingHeadBeforeWrite(s);
        const r = await withBusyRetry(() => createDirection(base, {
            person: f.refn,
            direction: f.kind,
            name: f.name.trim() || undefined,
            ...(f.question.trim() ? { question: f.question.trim() } : {}),
            ...(f.generations !== null || year !== null ? {
                limits: { ...(f.generations !== null ? { generations: f.generations } : {}), ...(year !== null ? { before: year } : {}) },
            } : {}),
            ...(f.known.trim() ? { note: f.known.trim() } : {}),
            ...(branch ? { branch } : {}),
        }));
        f.sending = false;
        if (liveSession() !== s || s.ended) {
            if (form === f) this.closeDirectionForm(false);
            return;
        }
        if (!r.ok) {
            if (form !== f) return;
            if (r.code === 'exists' && r.existing) {
                // There is one: say which, the primary shows or restarts it.
                const known = s.researches.find(d => d.id === r.existing!.id);
                f.existing = known ?? { ...r.existing, direction: f.kind, focus: f.refn };
                this.renderDirectionForm();
                return;
            }
            f.problem = formProblem(r, 'new', directionRefusedText);
            this.renderDirectionForm();
            q<HTMLElement>(f.root, '#direction-form-submit').focus();
            return;
        }
        if (r.head) this.researchTakeOwnWriteHead(s.researchId, head, r.head, r.parent);
        const made = r.direction;
        if (made && !s.researches.some(d => d.id === made.id)) s.researches = [...s.researches, made];
        if (form === f) this.closeDirectionForm();
        if (made) markFreshDirection(made.id);
        this.redrawDirections();
        if (made) {
            requestAnimationFrame(() => {
                document.querySelector(`#research-overview .research-direction[data-direction="${CSS.escape(made.id)}"]`)
                    ?.scrollIntoView({ block: 'nearest' });
            });
        }
        // "Work on this direction": an agent in the research's terminal (a computer only).
        const work = made && !this.activeResearchNoAgent() ? this.activeResearchLink('chat', { research: made.id }) : null;
        this.showToast(L.dirToastCreated, 8000, {
            kind: 'direction',
            ...(work ? { action: { label: L.dirWork, run: () => this.launchResearchLink(work, 'agent'), ...researchLinkFlags(work) } } : {}),
        });
        this.liveStatusSoon(s);
    },

    /** Save an edit: only what changed; the research's sentence about tasks moved (or Saved) with Undo. */
    async saveDirectionEdit(f: FormState, year: number | null): Promise<void> {
        const d = f.edit!;
        const before = liveSession()?.researches.find(x => x.id === d.id) ?? d;
        const body: DirectionEditBody = {};
        const name = f.name.trim();
        if (name && name !== before.name) body.name = name;
        const question = f.question.trim();
        if (question && question !== (before.question ?? '')) body.question = question;
        const limits = changedLimits(before.limits, {
            generations: f.generations,
            before: f.kind === 'descendants' ? before.limits?.before ?? null : year,
        });
        if (limits) body.limits = limits;
        if (before.state === 'paused' && f.reason.trim() !== (before.reason ?? '').trim() && f.reason.trim()) body.reason = f.reason.trim();
        if (Object.keys(body).length === 0) {
            f.sending = false;
            this.closeDirectionForm();
            return;
        }
        const r = await this.writeDirectionEdit(before, body);
        f.sending = false;
        if (r === true) {
            if (form === f) this.closeDirectionForm();
            return;
        }
        if (form !== f || r === null) return;
        f.problem = r;
        this.renderDirectionForm();
        q<HTMLElement>(f.root, '#direction-form-submit').focus();
    },

    /**
     * Write an edit through the bridge and take it into the panel: true done
     * (toast with Undo unless `undo`), the problem when refused, null when the
     * research went away meanwhile.
     */
    async writeDirectionEdit(before: LiveDirection, body: DirectionEditBody, undo = false): Promise<true | FormProblem | null> {
        const s = liveSession();
        if (!s || s.ended) return null;
        const L = strings.live;
        const head = await this.waitingHeadBeforeWrite(s);
        const r = await withBusyRetry(() => editDirection(s.bridge.base, before.id, body));
        if (liveSession() !== s || s.ended) return null;
        if (!r.ok) return formProblem(r, 'edit', directionRefusedText);
        if (r.head) this.researchTakeOwnWriteHead(s.researchId, head, r.head, r.parent);
        const limits = { ...(before.limits ?? {}) };
        if (body.limits) {
            for (const k of ['generations', 'before'] as const) {
                const v = body.limits[k];
                if (v === null) delete limits[k];
                else if (v !== undefined) limits[k] = v;
            }
        }
        const next: LiveDirection = r.direction?.id === before.id ? r.direction : {
            ...before,
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.question !== undefined ? { question: body.question } : {}),
            ...(body.reason !== undefined ? { reason: body.reason } : {}),
            limits,
        };
        s.researches = s.researches.map(x => x.id === before.id ? next : x);
        this.redrawDirections();
        if (!undo) {
            const back: DirectionEditBody = {};
            if (body.name !== undefined) back.name = before.name;
            if (body.question !== undefined && before.question) back.question = before.question;
            if (body.limits) {
                back.limits = {};
                if ('generations' in body.limits) back.limits.generations = before.limits?.generations ?? null;
                if ('before' in body.limits) back.limits.before = before.limits?.before ?? null;
            }
            if (body.reason !== undefined && before.reason) back.reason = before.reason;
            const said = r.effect?.said;
            this.showToast(said || L.dirToastSaved, said ? 10000 : 6000, {
                kind: 'direction',
                ...(Object.keys(back).length > 0 ? {
                    action: {
                        label: L.dirUndo,
                        run: () => void this.writeDirectionEdit(next, back, true).then(res => {
                            // The undo has no form: a refusal is said in its own toast (the change stays).
                            if (res && res !== true) {
                                this.showToast(res.said ? L.dirUndoFailedSaid(res.said) : L.dirUndoFailed, 8000, { kind: 'direction', alert: true });
                            }
                        }),
                    },
                } : {}),
            });
        }
        this.liveStatusSoon(s);
        return true;
    },
});

/**
 * "Suggest from the research" in the Surname spellings dialog (spec 021
 * K2.1–K2.6, ZADANI_DEV §4): the research tree's bridge (`surnames.suggest`)
 * tells which spellings belong together, documented by its records or by the
 * spelling rules; each suggestion is accepted (a group of the tree, as linked
 * by hand) or rejected (StromData.surnameRejections, never offered again),
 * each with its Undo. Nothing is linked without a click. The last reply is
 * kept on the device, so the dialog shows it again without asking, also
 * while the research does not run.
 *
 * Only for a research tree whose bridge said `surnames.suggest` (now or the
 * last time); a tree without a research, or an older research, shows the
 * dialog as before. The groups and the rejections go to the research in the
 * file's header NOTEs with the next sending of changes (`surnames.read`).
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { parseLiveBridge, type LiveStatus } from '../research-link.js';
import { storedResearchBridge } from '../research-device.js';
import { surnameKey } from '../surnames.js';
import { surnameRejectionKey } from '../quality-dismiss.js';
import type { BaseCopy } from '../research-changes.js';
import {
    SURNAMES_SUGGEST_FEATURE, SURNAMES_READ_FEATURE, visibleSuggestions, isDiacriticsOnly, peopleWithForm, newlyLinked,
    reasonText, formsKey, decidedInResearch, type ShownSuggestion, type SurnameSuggestion, type SuggestionEvidence,
} from '../surname-suggest.js';
import {
    fetchSurnameSuggestions, loadSurnamesBridgeRecord, saveSurnamesBridgeRecord, type SurnamesBridgeRecord,
} from '../surname-suggest-bridge.js';
import { onBridgeStatus } from './research-sync-ui.js';
import type { TreeId } from '../types.js';
import { uiModule } from './module.js';

/** Cards shown per level before "Show more" (and added by each click). */
const PAGE = 10;

/** What the open dialog shows of the suggestions (reset on each opening). */
interface SuggestView {
    phase: 'idle' | 'loading' | 'error';
    error?: string;
    shown: { documented: number; rules: number };
    evidenceOpen: Set<string>;
    /** surnameKey of each form accepted while the dialog is open: its group shows "new". */
    accepted: Set<string>;
    /** The manual linking: null = as the state says (folded once suggestions are there). */
    manualOpen: boolean | null;
    rejectedOpen: boolean;
    filter: string;
    /** What the section was last drawn for (redrawn when it changes). */
    drawn: string;
}

const freshView = (): SuggestView => ({
    phase: 'idle', shown: { documented: PAGE, rules: PAGE }, evidenceOpen: new Set(), accepted: new Set(),
    manualOpen: null, rejectedOpen: false, filter: '', drawn: '',
});

let view: SuggestView = freshView();
const records = new Map<string, SurnamesBridgeRecord>();
const loadingRecord = new Map<string, Promise<SurnamesBridgeRecord>>();
/** Per research: the features of its last status in this page. */
const lastFeatures = new Map<string, readonly string[]>();
let listening = false;

/** The open tree's research (lower case), or null. */
function treeResearchId(): string | null {
    const treeId = DataManager.getCurrentTreeId();
    const id = treeId ? TreeManager.getTreeMetadata(treeId)?.research?.id : undefined;
    return id ? id.toLowerCase() : null;
}

function bridgeBase(researchId: string): string | null {
    return parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? null;
}

async function recordOf(rid: string): Promise<SurnamesBridgeRecord> {
    const have = records.get(rid);
    if (have) return have;
    let pending = loadingRecord.get(rid);
    if (!pending) {
        pending = loadSurnamesBridgeRecord(rid).then(r => {
            if (!records.has(rid)) records.set(rid, r);
            return records.get(rid)!;
        }).finally(() => loadingRecord.delete(rid));
        loadingRecord.set(rid, pending);
    }
    return pending;
}

/** The features of a research: its last status in this page, else what the device kept. */
function featuresOf(rid: string): readonly string[] {
    const said = lastFeatures.get(rid);
    if (said) return said;
    const r = records.get(rid);
    return [...(r?.suggest ? [SURNAMES_SUGGEST_FEATURE] : []), ...(r?.read ? [SURNAMES_READ_FEATURE] : [])];
}

/** Does the research of this tree (the open one when none is given) read the spelling groups? */
export function surnamesReadByResearch(treeId?: string | null): boolean {
    const id = treeId ?? DataManager.getCurrentTreeId();
    const rid = id ? TreeManager.getTreeMetadata(id as TreeId)?.research?.id?.toLowerCase() : undefined;
    return !!rid && featuresOf(rid).includes(SURNAMES_READ_FEATURE);
}

function dialogOpen(): boolean {
    return !!document.getElementById('surnames-modal');
}

function treeReadOnly(): boolean {
    return DataManager.isReadOnly() || DataManager.isTreeLocked();
}

function formatDay(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(getCurrentLanguage());
}

/** Is the research's person a woman (by the tree's person with that REFN, else by the form)? */
function evidenceFemale(e: SuggestionEvidence): boolean {
    if (e.person) {
        const p = Object.values(DataManager.getData().persons).find(x => x.refn === e.person);
        if (p?.gender === 'female') return true;
        if (p?.gender === 'male') return false;
    }
    return /(ová|á)$/i.test(e.form.normalize('NFC'));
}

export const surnameSuggestMethods = uiModule({
    /** At startup: listen for bridge statuses; keep the open tree's record at hand. */
    initSurnameSuggest(): void {
        if (listening) return;
        listening = true;
        onBridgeStatus((rid, status) => this.noteSurnamesStatus(rid, status));
        const preload = (): void => {
            const rid = treeResearchId();
            if (rid) void recordOf(rid);
        };
        window.addEventListener('strom:tree-switched', preload);
        preload();
    },

    /** A status: remember whether the research suggests and reads (for a later dialog without a bridge). */
    noteSurnamesStatus(researchId: string, status: LiveStatus): void {
        const rid = researchId.toLowerCase();
        const features = status.features ?? [];
        lastFeatures.set(rid, features);
        void recordOf(rid).then(async (record) => {
            const suggest = features.includes(SURNAMES_SUGGEST_FEATURE);
            const read = features.includes(SURNAMES_READ_FEATURE);
            if (record.suggest !== suggest || record.read !== read) {
                record.suggest = suggest;
                record.read = read;
                await saveSurnamesBridgeRecord(rid, record);
            }
            if (rid === treeResearchId()) this.surnameSuggestBridgeChanged();
        });
    },

    /** Does the research of this tree read the spelling groups (the "app only" mark goes)? */
    surnamesReadByResearch(treeId?: string | null): boolean {
        return surnamesReadByResearch(treeId);
    },

    /** The open tree's research suggests spellings (now or the last time its bridge said). */
    surnameSuggestSupported(): boolean {
        const rid = treeResearchId();
        return !!rid && featuresOf(rid).includes(SURNAMES_SUGGEST_FEATURE);
    },

    /** The open tree's research answers `/surnames` now. */
    surnameSuggestUp(): boolean {
        const rid = treeResearchId();
        if (!rid || !this.researchBridgeUp(rid) || !bridgeBase(rid)) return false;
        return (this.researchStatusOf(rid)?.features ?? []).includes(SURNAMES_SUGGEST_FEATURE);
    },

    /** A new dialog: the view starts over; the record is read when not at hand yet. */
    resetSurnameSuggestView(): void {
        view = freshView();
        const rid = treeResearchId();
        if (rid && !records.has(rid)) {
            void recordOf(rid).then(() => {
                if (dialogOpen() && rid === treeResearchId()) this.renderSurnamesDialogParts();
            });
        }
    },

    /** The bridge came or went, or a send went: redraw what depends on it (only when it changed). */
    surnameSuggestBridgeChanged(): void {
        if (!dialogOpen()) return;
        if (this.surnameSuggestDrawKey() !== view.drawn) this.renderSurnamesDialogParts();
    },

    surnameSuggestDrawKey(): string {
        const pending = this.surnamePendingSend();
        const groups = (DataManager.getData().surnameVariants ?? []).map(g => pending?.group(g) ? 1 : 0).join('');
        const rej = (DataManager.getData().surnameRejections ?? []).map(r => pending?.rejection(r.forms) ? 1 : 0).join('');
        return `${this.surnameSuggestSupported()}|${this.surnameSuggestUp()}|${treeReadOnly()}|${groups}|${rej}`;
    },

    /** Everything of the dialog that the suggestions touch. */
    renderSurnamesDialogParts(): void {
        this.renderSurnameSuggest();
        this.renderSurnameGroups();
        this.renderSurnameManual();
        this.renderSurnamePicker();
        this.renderSurnameRejected();
        view.drawn = this.surnameSuggestDrawKey();
    },

    /**
     * Which groups and rejections of the tree have not gone to the research
     * yet (its last known copy lacks them) — only for a research that reads
     * them; null: nothing to say (no copy known, an older copy).
     */
    surnamePendingSend(): { group: (forms: readonly string[]) => boolean; rejection: (forms: readonly string[]) => boolean } | null {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || !this.surnamesReadByResearch(treeId)) return null;
        const b = this.researchChangesBase();
        if (!b) return null;
        if (b === 'same') return { group: () => false, rejection: () => false };
        const base = b.base as BaseCopy;
        if (base.olderCopy) return null;
        const groups = new Set((base.surnameVariants ?? []).map(formsKey));
        const rejected = base.surnameRejections ? new Set(base.surnameRejections.map(r => surnameRejectionKey(r.forms))) : null;
        return {
            group: forms => !groups.has(formsKey(forms)),
            rejection: forms => !rejected || !rejected.has(surnameRejectionKey(forms)),
        };
    },

    /** The suggestions' section (or nothing, for a tree whose research does not suggest). */
    renderSurnameSuggest(): void {
        const box = document.getElementById('surnames-suggest');
        const modal = document.querySelector('#surnames-modal .surnames-modal');
        if (!box || !modal) return;
        const rid = treeResearchId();
        const supported = this.surnameSuggestSupported();
        modal.classList.toggle('modal--lg', supported);
        modal.classList.toggle('modal--md', !supported);
        modal.classList.toggle('is-suggest', supported);
        if (!rid || !supported) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        const t = strings.surnameSuggest;
        const esc = (s: string): string => this.escapeHtml(s);
        const record = records.get(rid);
        const reply = record?.reply;
        const up = this.surnameSuggestUp();
        const ro = treeReadOnly();
        const data = DataManager.getData();
        const shown = reply ? visibleSuggestions(reply, data) : null;

        const counts = shown && view.phase !== 'loading' ? `<span class="ss-counts">${esc(t.counts(shown.documented.length, shown.rules.length))}</span>` : '';
        const reload = up && reply && view.phase !== 'loading'
            ? `<button type="button" class="link-button ss-reload">${esc(t.reload)}</button>` : '';
        let body = '';
        if (!up) {
            body = `<p class="ss-note">${esc(reply ? t.cached : t.needsBridge)}</p>`;
        } else if (view.phase === 'loading') {
            body = `<div class="ss-progress" role="progressbar" aria-label="${esc(t.loading)}"><span></span></div>
                <p class="ss-note">${esc(t.loading)}</p>`;
        } else if (view.phase === 'error') {
            body = `<p class="ss-error" role="alert">${esc(view.error || t.error)}</p>
                <button type="button" class="secondary ss-retry">${esc(t.retry)}</button>`;
        } else if (!reply) {
            body = `<button type="button" class="primary ss-suggest">${esc(t.suggest)}</button>
                <p class="ss-note">${esc(t.hint)}</p>`;
        }
        if (ro && reply) body += `<p class="ss-note ss-readonly">${esc(t.readOnly)}</p>`;
        if (shown && view.phase !== 'loading') {
            if (shown.documented.length + shown.rules.length === 0) {
                body += `<p class="ss-note ss-nothing">${esc(t.nothingNew)}</p>`;
            } else {
                const archive = this.researchModeOf(rid, TreeManager.getTreeMetadata(DataManager.getCurrentTreeId()!)?.research) === 'archive';
                body += this.surnameSuggestLevelHtml('documented', shown.documented, ro, false)
                    + this.surnameSuggestLevelHtml('rules', shown.rules, ro, !archive);
            }
        }
        box.innerHTML = `
            <div class="ss-head">
                <h3 class="ss-title" id="surnames-suggest-title">${esc(t.title)}</h3>${counts}${reload}
            </div>
            ${body}`;
        this.wireSurnameSuggest(box, shown);
    },

    surnameSuggestLevelHtml(level: 'documented' | 'rules', list: ShownSuggestion[], ro: boolean, agentHint: boolean): string {
        const t = strings.surnameSuggest;
        const esc = (s: string): string => this.escapeHtml(s);
        const limit = view.shown[level];
        let bulk = '';
        if (!ro && level === 'documented' && list.length >= 2) {
            bulk = `<button type="button" class="secondary ss-accept-all" data-level="documented">${esc(t.acceptAllDocumented(list.length))}</button>`;
        }
        const diacritics = list.filter(s => isDiacriticsOnly(s.suggestion.forms)).length;
        if (!ro && level === 'rules' && diacritics >= 2) {
            bulk = `<button type="button" class="secondary ss-accept-all" data-level="diacritics">${esc(t.acceptAllDiacritics(diacritics))}</button>`;
        }
        const cards = list.slice(0, limit).map(s => this.surnameSuggestCardHtml(s, ro)).join('');
        const rest = list.length - limit;
        const more = rest > 0
            ? `<button type="button" class="link-button ss-more" data-level="${level}">${esc(level === 'documented'
                ? t.showMoreDocumented(Math.min(PAGE, rest)) : t.showMoreRules(Math.min(PAGE, rest)))}</button>` : '';
        const none = list.length === 0
            ? `<p class="ss-note">${esc(level === 'documented' ? t.noneDocumented : t.noneRules)}</p>` : '';
        return `
            <section class="ss-level" data-level="${level}">
                <div class="ss-level-head">
                    <h4>${esc(level === 'documented' ? t.levelDocumented : t.levelRules)} <span class="ss-level-count">${list.length}</span></h4>
                    ${bulk}
                </div>
                ${none}${cards}${more}
                ${agentHint && list.length > 0 ? `<p class="ss-agent-hint">${esc(t.agentHint)}</p>` : ''}
            </section>`;
    },

    surnameSuggestCardHtml(shown: ShownSuggestion, ro: boolean): string {
        const t = strings.surnameSuggest;
        const esc = (s: string): string => this.escapeHtml(s);
        const s: SurnameSuggestion = shown.suggestion;
        const data = DataManager.getData();
        const group = shown.extendsGroup;
        const inGroup = new Set((group ?? []).map(surnameKey));
        // The extended group's forms first, then the new ones.
        const forms = group
            ? [...s.forms.filter(f => inGroup.has(surnameKey(f))), ...group.filter(g => !s.forms.some(f => surnameKey(f) === surnameKey(g))),
                ...s.forms.filter(f => !inGroup.has(surnameKey(f)))]
            : s.forms;
        const tags = forms.map((f, i) => {
            const n = peopleWithForm(f, data);
            const cls = ['ss-form', group ? (inGroup.has(surnameKey(f)) ? 'is-group' : 'is-new') : '', n === 0 ? 'is-empty' : ''].filter(Boolean).join(' ');
            const tag = `<span class="${cls}"><span class="ss-form-name">${group && !inGroup.has(surnameKey(f)) ? '+ ' : ''}${esc(f)}</span>`
                + `<span class="ss-form-count">${esc(t.inTree(n))}</span></span>`;
            return i === 0 ? tag : `<span class="ss-form-next"><span class="ss-eq" aria-hidden="true">=</span>${tag}</span>`;
        }).join('');
        const reason = reasonText(s, { samePerson: t.samePerson, spelling: t.spelling, double: t.keyDouble, diacritics: t.keyDiacritics });
        const levelTag = s.level === 'documented'
            ? `<span class="ss-tag is-documented">${esc(t.levelDocumented)}</span>`
            : `<span class="ss-tag is-rules">${esc(t.levelRulesTag)}</span>`;
        let evidence = '';
        if (s.level === 'documented' && s.evidence.length > 0) {
            const open = view.evidenceOpen.has(s.id);
            const list = open ? s.evidence : s.evidence.slice(0, 1);
            const hidden = s.evidence.length - 1;
            const rows = list.map(e => this.surnameEvidenceHtml(e)).join('');
            let tail = '';
            if (!open && hidden + s.evidenceMore > 0) {
                tail = hidden > 0
                    ? `<button type="button" class="link-button ss-evidence-toggle" data-id="${esc(s.id)}" aria-expanded="false">${esc(t.evidenceMore(hidden + s.evidenceMore))}</button>`
                    : `<span class="ss-evidence-more">${esc(t.evidenceMore(s.evidenceMore))}</span>`;
            } else if (open) {
                tail = (s.evidenceMore > 0 ? `<span class="ss-evidence-more">${esc(t.evidenceMore(s.evidenceMore))}</span>` : '')
                    + `<button type="button" class="link-button ss-evidence-toggle" data-id="${esc(s.id)}" aria-expanded="true">${esc(t.evidenceLess)}</button>`;
            }
            evidence = `<div class="ss-evidence"><ul>${rows}</ul>${tail}</div>`;
        }
        const linked = newlyLinked(s.forms, group, data);
        const span = s.from !== undefined ? (s.to !== undefined && s.to !== s.from ? `${s.from}–${s.to}` : String(s.from)) : '';
        const meta = [
            linked.n > 0 ? esc(t.newlyLinked(linked.n, linked.m, linked.main)) : esc(t.newlyLinkedNone),
            s.places.length ? esc(s.places.join(', ')) : '',
            span ? `<span class="ss-years">${esc(span)}</span>` : '',
        ].filter(Boolean).join(' · ');
        const actions = ro ? '' : `
            <div class="ss-actions">
                <button type="button" class="secondary ss-reject" data-id="${esc(s.id)}">${esc(t.reject)}</button>
                <button type="button" class="primary ss-accept" data-id="${esc(s.id)}">${esc(t.accept)}</button>
            </div>`;
        return `
            <article class="ss-card" data-id="${esc(s.id)}">
                ${group ? `<div class="ss-extends">${esc(t.extendsGroup(group.join(' = ')))}</div>` : ''}
                <div class="ss-forms">${tags}</div>
                <div class="ss-reason">${levelTag}${reason ? `<span class="ss-reason-text">${esc(reason)}</span>` : ''}</div>
                ${evidence}
                <div class="ss-meta">${meta}</div>
                ${actions}
            </article>`;
    },

    surnameEvidenceHtml(e: SuggestionEvidence): string {
        const t = strings.surnameSuggest;
        const esc = (s: string): string => this.escapeHtml(s);
        const source = e.source ? Object.values(DataManager.getData().sources ?? {}).find(x => x.refn === e.source) : undefined;
        const citation = e.citation
            ? (source ? `<button type="button" class="link-button ss-source" data-source-id="${esc(source.id)}">${esc(e.citation)}</button>` : esc(e.citation))
            : '';
        return `<li><strong>${esc(e.name)}</strong> – ${esc(t.evidenceForm(e.form, evidenceFemale(e)))}${citation ? ` · ${citation}` : ''}</li>`;
    },

    wireSurnameSuggest(box: HTMLElement, shown: { documented: ShownSuggestion[]; rules: ShownSuggestion[] } | null): void {
        const all = shown ? [...shown.documented, ...shown.rules] : [];
        const byId = (id: string | undefined): ShownSuggestion | undefined => all.find(s => s.suggestion.id === id);
        const on = (sel: string, run: (btn: HTMLButtonElement) => void): void => {
            box.querySelectorAll<HTMLButtonElement>(sel).forEach(btn => { btn.onclick = () => run(btn); });
        };
        on('.ss-suggest, .ss-reload, .ss-retry', () => { void this.loadSurnameSuggestions(); });
        on('.ss-more', btn => {
            const level = btn.dataset.level === 'rules' ? 'rules' : 'documented';
            view.shown[level] += PAGE;
            this.renderSurnameSuggest();
        });
        on('.ss-evidence-toggle', btn => {
            const id = btn.dataset.id ?? '';
            if (view.evidenceOpen.has(id)) view.evidenceOpen.delete(id);
            else view.evidenceOpen.add(id);
            this.renderSurnameSuggest();
            box.querySelector<HTMLElement>(`.ss-card[data-id="${CSS.escape(id)}"] .ss-evidence-toggle`)?.focus();
        });
        on('.ss-source', btn => this.showSourceViewer(btn.dataset.sourceId ?? '', null, { readOnly: true }));
        on('.ss-accept', btn => {
            const s = byId(btn.dataset.id);
            if (s) this.acceptSurnameSuggestions([s], false);
        });
        on('.ss-reject', btn => {
            const s = byId(btn.dataset.id);
            if (s) this.rejectSurnameSuggestion(s.suggestion);
        });
        on('.ss-accept-all', btn => {
            const list = btn.dataset.level === 'diacritics'
                ? (shown?.rules ?? []).filter(s => isDiacriticsOnly(s.suggestion.forms))
                : shown?.documented ?? [];
            if (list.length > 0) this.acceptSurnameSuggestions(list, true);
        });
    },

    /** `GET /surnames` now (the button, "Load again", "Try again"). */
    async loadSurnameSuggestions(): Promise<void> {
        const rid = treeResearchId();
        const base = rid ? bridgeBase(rid) : null;
        if (!rid || !base || view.phase === 'loading') return;
        view.phase = 'loading';
        view.error = undefined;
        this.renderSurnameSuggest();
        const result = await fetchSurnameSuggestions(base);
        if (rid !== treeResearchId()) return;
        const record = await recordOf(rid);
        if (result.ok) {
            record.reply = result.reply;
            record.at = new Date().toISOString();
            await saveSurnamesBridgeRecord(rid, record);
            view.phase = 'idle';
            view.shown = { documented: PAGE, rules: PAGE };
            view.manualOpen = null;
        } else if (result.code === 'missing') {
            // An older research after all: the section goes.
            record.suggest = false;
            lastFeatures.set(rid, (lastFeatures.get(rid) ?? []).filter(f => f !== SURNAMES_SUGGEST_FEATURE));
            await saveSurnamesBridgeRecord(rid, record);
            view.phase = 'idle';
        } else {
            view.phase = 'error';
            view.error = result.text;
        }
        if (dialogOpen()) this.renderSurnamesDialogParts();
    },

    /** Accept suggestions (one, or a level's at once): groups of the tree, one Undo for all. */
    acceptSurnameSuggestions(list: ShownSuggestion[], bulk: boolean): void {
        if (treeReadOnly()) return;
        const added = DataManager.acceptSurnameGroups(list.map(s => s.suggestion.forms));
        if (!added) return;
        const forms = added.flat();
        for (const s of list) for (const f of s.suggestion.forms) view.accepted.add(surnameKey(f));
        this.renderSurnamesDialogParts();
        TreeRenderer.render();
        const t = strings.surnameSuggest;
        const message = bulk ? t.acceptedAllToast(list.length) : t.acceptedToast(list[0].suggestion.forms.join(' = '));
        this.showToast(message, 6000, {
            clearOf: '#surnames-modal .buttons',
            action: {
                label: t.undo,
                run: () => {
                    if (!DataManager.removeSurnameForms(forms)) return;
                    for (const s of list) for (const f of s.suggestion.forms) view.accepted.delete(surnameKey(f));
                    if (dialogOpen()) this.renderSurnamesDialogParts();
                    TreeRenderer.render();
                },
            },
        });
    },

    /** Reject a suggestion: the tree remembers it (and tells the research with the next send). */
    rejectSurnameSuggestion(s: SurnameSuggestion): void {
        if (treeReadOnly()) return;
        if (!DataManager.addSurnameRejection({ forms: [...s.forms], id: s.id, at: new Date().toISOString() })) return;
        this.renderSurnamesDialogParts();
        const t = strings.surnameSuggest;
        this.showToast(t.rejectedToast, 6000, {
            clearOf: '#surnames-modal .buttons',
            action: {
                label: t.undo,
                run: () => {
                    if (DataManager.removeSurnameRejection(s.forms) && dialogOpen()) this.renderSurnamesDialogParts();
                },
            },
        });
    },

    /** The linked groups' quiet marks: new, decided in the research, not sent yet. */
    surnameGroupMarks(group: readonly string[]): { isNew: boolean; html: string } {
        const t = strings.surnameSuggest;
        const esc = (s: string): string => this.escapeHtml(s);
        const isNew = group.some(n => view.accepted.has(surnameKey(n)));
        const rid = treeResearchId();
        const reply = rid ? records.get(rid)?.reply : undefined;
        const marks: string[] = [];
        if (isNew) marks.push(`<span class="ss-badge">${esc(t.newGroupBadge)}</span>`);
        if (reply && decidedInResearch(group, reply.groups)) marks.push(`<span class="ss-quiet">${esc(t.decidedInResearch)}</span>`);
        if (this.surnamePendingSend()?.group(group)) marks.push(`<span class="ss-quiet ss-pending">${esc(t.pendingSend)}</span>`);
        return { isNew, html: marks.length ? `<span class="ss-marks">${marks.join('')}</span>` : '' };
    },

    /** "Link manually": a row that folds the chips away once suggestions are there. */
    renderSurnameManual(): void {
        const add = document.querySelector<HTMLElement>('#surnames-modal .surnames-add');
        const toggle = document.getElementById('surnames-manual-toggle') as HTMLButtonElement | null;
        const title = document.querySelector<HTMLElement>('#surnames-modal .surnames-add-title');
        const link = document.getElementById('surnames-link') as HTMLButtonElement | null;
        if (!add || !toggle || !title) return;
        const supported = this.surnameSuggestSupported();
        const rid = treeResearchId();
        const hasReply = !!(rid && records.get(rid)?.reply);
        const open = !supported || (view.manualOpen ?? !hasReply);
        const ro = treeReadOnly();
        toggle.hidden = !supported;
        title.hidden = supported;
        add.classList.toggle('is-folded', !open);
        add.hidden = ro && supported && !open;
        toggle.setAttribute('aria-expanded', String(open));
        const t = strings.surnameSuggest;
        const count = new Set(Object.values(DataManager.getData().persons)
            .filter(p => !p.isPlaceholder && p.lastName?.trim()).map(p => surnameKey(p.lastName!))).size;
        toggle.innerHTML = `<span class="ss-manual-title">${this.escapeHtml(t.manualTitle)}</span>`
            + `<span class="ss-manual-count">${this.escapeHtml(t.manualCount(count))}</span>`
            + `<span class="ss-chevron" aria-hidden="true">${open ? '▴' : '▾'}</span>`;
        toggle.onclick = () => {
            view.manualOpen = !open;
            this.renderSurnameManual();
        };
        if (link) link.hidden = !open || ro;
    },

    /** The live filter over the chips (by surnameKey). */
    surnameFilterValue(): string {
        return view.filter;
    },

    setSurnameFilter(value: string): void {
        view.filter = value;
        this.renderSurnamePicker();
    },

    /** "Rejected suggestions: n" — a folded row; each rejection can be taken back. */
    renderSurnameRejected(): void {
        const box = document.getElementById('surnames-rejected');
        if (!box) return;
        const list = DataManager.getData().surnameRejections ?? [];
        if (list.length === 0) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        const t = strings.surnameSuggest;
        const esc = (s: string): string => this.escapeHtml(s);
        const ro = treeReadOnly();
        const rid = treeResearchId();
        const reply = rid ? records.get(rid)?.reply : undefined;
        const pending = this.surnamePendingSend();
        const rows = view.rejectedOpen ? `<ul class="ss-rejected-list">${list.map((r, i) => {
            const marks = [
                r.at ? `<span class="ss-quiet">${esc(t.rejectedOn(formatDay(r.at)))}</span>` : '',
                r.by === 'research' || (reply && decidedInResearch(r.forms, reply.rejected)) ? `<span class="ss-quiet">${esc(t.decidedInResearch)}</span>` : '',
                pending?.rejection(r.forms) ? `<span class="ss-quiet ss-pending">${esc(t.pendingSend)}</span>` : '',
            ].filter(Boolean).join('');
            return `<li class="ss-rejected-row">
                <span class="ss-rejected-forms">${esc(r.forms.join(' = '))}</span>
                ${marks ? `<span class="ss-marks">${marks}</span>` : ''}
                ${ro ? '' : `<button type="button" class="secondary ss-unreject" data-index="${i}">${esc(t.undo)}</button>`}
            </li>`;
        }).join('')}</ul>` : '';
        box.innerHTML = `
            <button type="button" class="ss-fold" id="surnames-rejected-toggle" aria-expanded="${view.rejectedOpen}">
                <span>${esc(t.rejectedRow(list.length))}</span><span class="ss-chevron" aria-hidden="true">${view.rejectedOpen ? '▴' : '▾'}</span>
            </button>${rows}`;
        (box.querySelector('#surnames-rejected-toggle') as HTMLButtonElement).onclick = () => {
            view.rejectedOpen = !view.rejectedOpen;
            this.renderSurnameRejected();
            (document.getElementById('surnames-rejected-toggle') as HTMLElement | null)?.focus();
        };
        box.querySelectorAll<HTMLButtonElement>('.ss-unreject').forEach(btn => {
            btn.onclick = () => {
                const r = list[Number(btn.dataset.index)];
                if (r && DataManager.removeSurnameRejection(r.forms)) this.renderSurnamesDialogParts();
            };
        });
    },
});

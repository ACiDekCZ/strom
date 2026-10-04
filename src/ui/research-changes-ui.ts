/**
 * Changes per person (A2): what the user changed since the research's
 * version, person by person — "What will be sent" before a send, "What was
 * written" after one. The base is the copy of the research's version kept in
 * this browser (research-copy.ts), refreshed whenever the tree takes a version
 * from the research or the research writes a send. A copy that no longer
 * matches the tree's tie (another path moved the base) is not used.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId, StromData, TreeId } from '../types.js';
import { formatLiveClock } from '../live-time.js';
import { ChangeKind, PersonChange, diffByPerson, baseCopy } from '../research-changes.js';
import { saveResearchCopy, loadResearchCopy } from '../research-copy.js';
import { researchAutoState, patchResearchAutoState, noteResearchSendPreviewSkipped } from '../research-device.js';
import { researchSendMode, personsByResearchRefs } from './research-sync-ui.js';
import { researchFactLabel } from './person-research-ui.js';
import { uiModule } from './module.js';

const PANEL_ID = 'research-changes-panel';
/** The fingerprint the kept copy stands for (the tie's base, or the written send's). */
const FP_KEY = 'strom-research-base-fp:';
/** What the last written send carried, person by person (for "What was written"). */
const WRITTEN_KEY = 'strom-research-written:';
/** At most this many kinds on a row, then "+ N more". */
const KINDS_SHOWN = 3;
/** At most this many people kept for "What was written". */
const WRITTEN_MAX = 200;

/** The copy of the open tree's research version, as loaded (base null: none kept). */
let copy: { treeId: string; base: StromData | null; fp: string } | null = null;
let loading: string | null = null;
let loadingDone: Promise<void> | null = null;
let memo: { treeId: string; key: string; list: PersonChange[] } | null = null;
/** A send still pending in the research: its data and list, kept until it is written. */
const pendingSent = new Map<string, { fingerprint: string; data: StromData; list: PersonChange[] | null }>();

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function storedFp(treeId: string): string {
    try { return localStorage.getItem(FP_KEY + treeId) ?? ''; } catch { return ''; }
}

function sanitizeChange(v: unknown): PersonChange | null {
    const r = v as Record<string, unknown> | null;
    if (!r || typeof r.personId !== 'string' || typeof r.name !== 'string' || !Array.isArray(r.kinds)) return null;
    return {
        personId: r.personId as PersonId, name: r.name.slice(0, 200),
        kinds: r.kinds.filter((k): k is ChangeKind => typeof k === 'string').slice(0, 20),
        ...(r.deleted === true ? { deleted: true } : {}),
    };
}

/** "What was written": the last written send's people (null: none kept). */
export function researchWrittenList(treeId: string): { at: string; list: PersonChange[] } | null {
    try {
        const raw = localStorage.getItem(WRITTEN_KEY + treeId);
        if (!raw) return null;
        const p = JSON.parse(raw) as { at?: unknown; list?: unknown };
        if (typeof p.at !== 'string' || !Array.isArray(p.list)) return null;
        return { at: p.at, list: p.list.map(sanitizeChange).filter((c): c is PersonChange => !!c) };
    } catch {
        return null;
    }
}

function storeWritten(treeId: string, at: string, list: PersonChange[]): void {
    try { localStorage.setItem(WRITTEN_KEY + treeId, JSON.stringify({ at, list: list.slice(0, WRITTEN_MAX) })); } catch { /* not kept */ }
}

/** Forget what this browser keeps of a tree's changes (the tree deleted). */
export function forgetResearchChanges(treeId: string): void {
    try {
        localStorage.removeItem(FP_KEY + treeId);
        localStorage.removeItem(WRITTEN_KEY + treeId);
    } catch { /* nothing kept */ }
    if (copy?.treeId === treeId) copy = null;
    pendingSent.delete(treeId);
}

/** The labels of a row's kinds: at most three, then "+ N more". */
export function changeKindsText(kinds: readonly ChangeKind[]): string {
    const c = strings.changes;
    const label: Record<ChangeKind, string> = {
        added: c.kindAdded, deleted: c.kindDeleted, name: c.kindName, gender: c.kindGender, birth: c.kindBirth, death: c.kindDeath,
        marriage: c.kindMarriage, event: c.kindEvent, godparent: c.kindGodparent, witness: c.kindWitness,
        citation: c.kindCitation, source: c.kindSource, attachment: c.kindAttachment,
        attachmentRemoved: c.kindAttachmentRemoved, note: c.kindNote, parents: c.kindParents, other: c.kindOther,
    };
    const shown = kinds.slice(0, KINDS_SHOWN).map(k => label[k]);
    return [...shown, ...(kinds.length > KINDS_SHOWN ? [c.more(kinds.length - KINDS_SHOWN)] : [])].join(' · ');
}

export const researchChangesMethods = uiModule({
    /**
     * Keep `data` as the research's version of a tree (a load, a hand-over,
     * a written send). `fp` is the fingerprint the tie counts as the base
     * (default: the tie's own, set just before).
     */
    researchKeepCopy(treeId: TreeId, data: StromData, fp?: string): void {
        const base = fp ?? TreeManager.getTreeMetadata(treeId)?.research?.fingerprint ?? '';
        copy = { treeId, base: baseCopy(data), fp: base };
        memo = null;
        try { localStorage.setItem(FP_KEY + treeId, base); } catch { /* the copy is not trusted next time */ }
        void saveResearchCopy(treeId, data);
    },

    /**
     * What changed in the open tree since the research's version, person by
     * person; null when it is not known (no copy kept, still loading, or the
     * copy no longer stands for the tie's base). Cached until the next edit.
     */
    researchChangesNow(): PersonChange[] | null {
        const ctx = this.researchSyncLink();
        if (!ctx) return null;
        const { treeId, link } = ctx;
        if (!copy || copy.treeId !== treeId) {
            if (loading !== treeId) {
                loading = treeId;
                loadingDone = loadResearchCopy(treeId).then(base => {
                    if (loading !== treeId) return;
                    loading = null;
                    loadingDone = null;
                    copy = { treeId, base, fp: storedFp(treeId) };
                    memo = null;
                    this.refreshResearchSyncUi();
                });
            }
            return null;
        }
        const fps = this.researchSyncFingerprints(treeId, link);
        // In step with the research: nothing to tell; a tree without a copy gets one now.
        if (fps.matchesBase) {
            if (!copy.base || copy.fp !== link.fingerprint) this.researchKeepCopy(treeId, DataManager.getData(), link.fingerprint);
            return [];
        }
        const written = link.sent?.state === 'written' ? link.sent.fingerprint : '';
        if (!copy.base || !copy.fp || (copy.fp !== link.fingerprint && copy.fp !== written)) return null;
        if (memo && memo.treeId === treeId && memo.key === fps.current) return memo.list;
        const list = diffByPerson(copy.base, DataManager.getData());
        memo = { treeId, key: fps.current, list };
        return list;
    },

    /** As researchChangesNow, waiting for the copy to load when it is not yet. */
    async researchChangesReady(): Promise<PersonChange[] | null> {
        const now = this.researchChangesNow();
        if (now !== null || !loadingDone) return now;
        await loadingDone;
        return this.researchChangesNow();
    },

    /** A send is about to go: what it carries (for "What was written" once written). */
    researchNoteSending(treeId: TreeId, data: StromData, fingerprint: string): void {
        const list = DataManager.getCurrentTreeId() === treeId ? this.researchChangesNow() : null;
        pendingSent.set(treeId, { fingerprint, data: baseCopy(data), list });
    },

    /** The research wrote the send with this fingerprint: its data is the research's version, its list what was written. */
    researchNoteWritten(treeId: TreeId, fingerprint: string, at: string): void {
        const p = pendingSent.get(treeId);
        if (!p || p.fingerprint !== fingerprint) return;
        pendingSent.delete(treeId);
        copy = { treeId, base: p.data, fp: fingerprint };
        memo = null;
        try { localStorage.setItem(FP_KEY + treeId, fingerprint); } catch { /* not trusted next time */ }
        void saveResearchCopy(treeId, p.data);
        if (p.list) storeWritten(treeId, at, p.list);
    },

    // ==================== THE PANEL ====================

    /** Open "What will be sent" / "What was written" under the toolbar's button (or the ⋯ button). */
    showResearchChanges(mode: 'send' | 'written', opts: { confirm?: boolean; inexact?: boolean } = {}): void {
        this.closeActionsMenu();
        this.closeResearchChanges();
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const c = strings.changes;
        const s = strings.sync;
        const clock = (iso: string | undefined): string => {
            const t = iso ? Date.parse(iso) : NaN;
            return Number.isFinite(t) ? formatLiveClock(t, Date.now(), getCurrentLanguage()) : '';
        };
        const archive = this.researchModeOf(ctx.link.id, ctx.link) === 'archive';
        const auto = researchSendMode(ctx.link) === 'auto';
        let list: PersonChange[];
        let title: string;
        let sub: string;
        let foot = '';
        let notWrittenHtml = '';
        let writtenHead = '';
        let moreWritten = 0;
        if (mode === 'written') {
            const w = researchWrittenList(ctx.treeId);
            const st = researchAutoState(ctx.treeId);
            const lw = st.lastWritten;
            list = w?.list ?? [];
            title = c.writtenTitle(clock(w?.at ?? lw?.at));
            const k = lw?.changes ?? list.length;
            const conflicts = lw?.conflicts ?? 0;
            sub = conflicts ? `${s.changesN(k)} · ${s.conflictsN(conflicts)}` : s.changesN(k);
            // What the research did not write (its `applied`, not what went, V-J): first, amber, with its reason;
            // the people it named are not listed as written.
            const nw = st.notWritten && (st.notWritten.fingerprint === ctx.link.sent?.fingerprint || st.notWritten.fingerprint === lw?.fingerprint) ? st.notWritten : null;
            if (nw) {
                if (!nw.seen) patchResearchAutoState(ctx.treeId, { notWritten: { ...nw, seen: true } });
                const data = DataManager.getData();
                const named = new Set<string>();
                const items = nw.items.map(n => {
                    const id = n.person ? personsByResearchRefs(data, [n.person])[0] : undefined;
                    if (id) named.add(id);
                    const p = id ? data.persons[id] : undefined;
                    const who = p ? `${p.firstName} ${p.lastName}`.trim() : n.person;
                    const what = n.fact ? researchFactLabel(n.fact) : '';
                    const why = n.why === 'kept' ? s.notWrittenKept : n.why === 'report' ? s.notWrittenReport : n.why === 'pick' ? s.notWrittenPick : c.noReason;
                    const name = id && p
                        ? `<button type="button" class="research-changes-name" data-person="${esc(id)}">${esc(who)}</button>`
                        : `<span class="research-changes-name">${esc(who || '?')}</span>`;
                    return `<li class="research-changes-row is-not-written"><span class="research-changes-icon is-warn" aria-hidden="true">!</span>`
                        + `<span class="research-changes-text">${name}${what ? `<span class="research-changes-kinds">${esc(what)}</span>` : ''}`
                        + `<span class="research-changes-why">${esc(why)}</span></span></li>`;
                });
                if (nw.unexplained > 0) {
                    items.push(`<li class="research-changes-row is-not-written"><span class="research-changes-icon is-warn" aria-hidden="true">!</span>`
                        + `<span class="research-changes-text"><span class="research-changes-name">${esc(c.unnamed(nw.unexplained))}</span>`
                        + `<span class="research-changes-why">${esc(c.noReason)}</span></span></li>`);
                }
                const m = nw.items.length + nw.unexplained;
                notWrittenHtml = `<div class="research-changes-section is-warn">${esc(c.notWrittenSection(m))}</div><ul class="research-changes-list">${items.join('')}</ul>`;
                list = list.filter(ch => !named.has(ch.personId));
                writtenHead = c.writtenSection(nw.written);
                sub = s.writtenCount(nw.written, m);
                // Quiet rows: the first three, then "and N more".
                moreWritten = Math.max(0, list.length - 3);
                list = list.slice(0, 3);
                this.refreshResearchSyncUi();
            }
            if (archive) foot = `<span class="research-changes-note">${esc(c.archiveNoConflicts)}</span>`;
            else if (conflicts && this.researchDecideUrl(ctx.treeId)) {
                foot = `<button type="button" class="research-sync-link" data-act="decide">${esc(s.decideInResearch)}</button>`;
            }
        } else {
            const now = this.researchChangesNow();
            list = now ?? [];
            title = c.willSendTitle;
            // Changed since the research last had the tree: its version loaded, or the last send it wrote
            // (also when a later send is still on its way or was taken back).
            const lastSent = ctx.link.sent?.state === 'written' ? ctx.link.sent.closedAt ?? ctx.link.sent.at : '';
            const since = [lastSent, researchAutoState(ctx.treeId).lastWritten?.at ?? '', ctx.link.syncedAt]
                .filter(t => Number.isFinite(Date.parse(t))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
            // No count when the exact list cannot be told ("0 people" would say nothing changed).
            const inexact = now === null || !!opts.inexact;
            sub = inexact ? c.changedSince(clock(since)) : auto ? c.willSendAutoSub(list.length) : c.willSendSub(list.length, clock(since));
            foot = auto && !opts.confirm
                ? `<button type="button" class="research-sync-link" data-act="send">${esc(s.sendNow)}</button>`
                : (opts.confirm && !ctx.link.previewDue
                    ? `<label class="research-changes-skip"><input type="checkbox" id="research-changes-skip"> ${esc(c.skipPreview)}</label>` : '')
                    + `<button type="button" class="secondary btn-sm" data-act="close">${esc(strings.buttons.close)}</button>`
                    + `<button type="button" class="primary btn-sm" data-act="send">${esc(s.barSend)}</button>`;
        }
        const rows = list.map(ch => {
            const name = ch.deleted || !DataManager.getPerson(ch.personId)
                ? `<span class="research-changes-name is-deleted">${esc(ch.name)}</span>`
                : `<button type="button" class="research-changes-name" data-person="${esc(ch.personId)}">${esc(ch.name)}</button>`;
            return `<li class="research-changes-row">`
                + `<span class="research-changes-icon ${mode === 'written' ? 'is-check' : 'is-ring'}" aria-hidden="true">${mode === 'written' ? '✓' : ''}</span>`
                + `<span class="research-changes-text">${name}<span class="research-changes-kinds">${esc(changeKindsText(ch.kinds))}</span></span>`
                + '</li>';
        }).join('');
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'research-changes-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', title);
        panel.dataset.mode = mode;
        panel.innerHTML = `
            <div class="research-changes-head">
                <div class="research-changes-title">${esc(title)}</div>
                <div class="research-changes-sub">${esc(sub)}</div>
            </div>
            ${mode === 'send' && (opts.inexact || (rows === '' && opts.confirm)) ? `<p class="research-changes-inexact">${esc(c.inexact)}</p>` : ''}
            ${notWrittenHtml}
            ${writtenHead && (rows || moreWritten) ? `<div class="research-changes-section">${esc(writtenHead)}</div>` : ''}
            ${rows ? `<ul class="research-changes-list${writtenHead ? ' is-quiet' : ''}">${rows}</ul>` : ''}
            ${moreWritten ? `<div class="research-changes-more">${esc(c.andMore(moreWritten))}</div>` : ''}
            ${foot ? `<div class="research-changes-foot">${foot}</div>` : ''}`;
        document.body.appendChild(panel);
        this.positionResearchChanges();
        panel.querySelectorAll<HTMLButtonElement>('[data-person]').forEach(btn => btn.addEventListener('click', () => {
            const id = btn.dataset.person as PersonId;
            this.closeResearchChanges();
            TreeRenderer.setFocus(id);
            ZoomPan.centerOnPerson(id);
        }));
        panel.querySelector('[data-act="close"]')?.addEventListener('click', () => this.closeResearchChanges());
        panel.querySelector<HTMLButtonElement>('[data-act="send"]')?.addEventListener('click', (e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            if (panel.querySelector<HTMLInputElement>('#research-changes-skip')?.checked) noteResearchSendPreviewSkipped(ctx.treeId, true);
            // Seen what goes: Send here sends ("Sending…" until the research answers, then the toast tells).
            if (btn.classList.contains('primary')) {
                btn.disabled = true;
                btn.textContent = s.sending;
                panel.querySelectorAll<HTMLInputElement>('input, [data-act="close"]').forEach(el => { el.disabled = true; });
                void this.researchSendNow({ previewed: true }).finally(() => {
                    if (document.getElementById(PANEL_ID) === panel) this.closeResearchChanges();
                });
                return;
            }
            this.closeResearchChanges();
            void this.researchSendNow({ previewed: true });
        });
        panel.querySelector('[data-act="decide"]')?.addEventListener('click', () => {
            this.closeResearchChanges();
            this.researchSyncAction('decideInResearch');
        });
        document.getElementById('research-sync-send-more')?.setAttribute('aria-expanded', 'true');
        // Esc and a click outside close it (the opening click is over by now).
        setTimeout(() => {
            document.addEventListener('pointerdown', closeOnOutside, true);
            document.addEventListener('keydown', closeOnEsc, true);
        }, 0);
        (panel.querySelector<HTMLElement>('button') ?? panel).focus?.();
    },

    /** Under the "N ⌄" part of the Send button when shown, else under ⋯; within the window. */
    positionResearchChanges(): void {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        const more = document.getElementById('research-sync-send-more');
        const anchor = more && more.offsetParent ? more : document.querySelector<HTMLElement>('.actions-menu-btn');
        const rect = anchor?.getBoundingClientRect();
        const width = Math.min(panel.offsetWidth || 380, window.innerWidth - 16);
        const left = rect ? Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) : 8;
        panel.style.top = `${Math.round((rect?.bottom ?? 56) + 6)}px`;
        panel.style.left = `${Math.round(left)}px`;
    },

    closeResearchChanges(): void {
        document.getElementById(PANEL_ID)?.remove();
        document.getElementById('research-sync-send-more')?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', closeOnOutside, true);
        document.removeEventListener('keydown', closeOnEsc, true);
    },

    /**
     * The send button's second part "N ⌄". Its place is always kept (an
     * invisible one when the people are not known or `reserve`), so the
     * toolbar does not move when it comes.
     */
    researchSendMoreHtml(reserve = false): string {
        const list = reserve ? null : this.researchChangesNow();
        if (!list || list.length === 0) {
            return '<span class="research-sync-send-more research-sync-send-more--placeholder" aria-hidden="true">0 <span>⌄</span></span>';
        }
        const open = !!document.getElementById(PANEL_ID);
        return `<button type="button" class="research-sync-send-more" id="research-sync-send-more" aria-haspopup="dialog" aria-expanded="${open}"`
            + ` aria-label="${esc(strings.changes.showWhat(list.length))}" onclick="event.stopPropagation(); window.Strom.UI.toggleResearchChanges()">`
            + `${list.length > 99 ? '99+' : list.length} <span aria-hidden="true">⌄</span></button>`;
    },

    toggleResearchChanges(): void {
        if (document.getElementById(PANEL_ID)) this.closeResearchChanges();
        else this.showResearchChanges('send');
    },

    /** The names for the "load over your changes" dialog: at most five, then "and N more" ('' when not known). */
    async researchOverwriteNames(): Promise<string> {
        const list = await this.researchChangesReady();
        if (!list || list.length === 0) return '';
        const c = strings.changes;
        const lines = list.slice(0, 5).map(ch => `• ${ch.name} (${changeKindsText(ch.kinds)})`);
        if (list.length > 5) lines.push(c.andMore(list.length - 5));
        return `${c.overwriteIntro}\n${lines.join('\n')}`;
    },
});

function closeOnOutside(e: Event): void {
    const panel = document.getElementById(PANEL_ID);
    const target = e.target as Node | null;
    if (!panel || (target && (panel.contains(target) || document.getElementById('research-sync-send-more')?.contains(target)))) return;
    window.Strom?.UI?.closeResearchChanges();
}

function closeOnEsc(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !document.getElementById(PANEL_ID)) return;
    e.stopPropagation();
    e.preventDefault();
    window.Strom?.UI?.closeResearchChanges();
}

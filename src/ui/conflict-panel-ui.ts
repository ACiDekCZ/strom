/**
 * The panel by a field of the person edit form: "conflict ›" at a field whose
 * conflict the app can decide by a side opens it — the card's content in
 * small (its title, the two sides each with a short choice and the sentence
 * saying what follows, "More in What the research knows ›"), not a dialog.
 * A popover under the field with its arrow at the tag; on a phone (and a
 * phone held sideways) a bottom sheet. The form with unsaved edits: the
 * choices wait, the edit is saved first. Its state is the card's
 * (conflict-decide-ui.ts): deciding, an error, sending first, by a link, not
 * on this device. Decided: the panel closes, the tag goes, the field follows
 * the value the research's version brings.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { PersonId, ResearchConflict, ResearchConflictValue } from '../types.js';
import { researchConflictRef, ResearchConflictTake } from '../research-link.js';
import { canDecideInApp, conflictSides } from '../research-decide.js';
import { isPhoneBar } from '../breakpoints.js';
import { researchConflictTitle, researchValueText } from './person-research-ui.js';
import { uiModule } from './module.js';

const PANEL_ID = 'prc-panel';
/** The popover's width, and how far it keeps from the window's edges. */
const PANEL_WIDTH = 400;
const EDGE = 8;

interface OpenPanel {
    personId: PersonId;
    conflictId: string;
    /** The tag that opened it (the keyboard goes back there on Esc / ×). */
    tag: HTMLElement;
    /** The field the conflict is about (the keyboard goes there once decided: the tag is gone). */
    field: HTMLElement | null;
    sheet: boolean;
    cleanup: () => void;
}
let open: OpenPanel | null = null;
/** What the panel was last drawn from: drawn again only when that changes. */
let drawnHtml = '';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The controls of the panel the keyboard moves through. */
function focusables(panel: HTMLElement): HTMLElement[] {
    return [...panel.querySelectorAll<HTMLElement>('button:not(:disabled)')].filter(el => el.getAttribute('aria-disabled') !== 'true');
}

export const conflictPanelMethods = uiModule({
    /** The panel is open (for this conflict, when given). */
    isResearchConflictPanelOpen(conflictId?: string): boolean {
        return !!open && (!conflictId || open.conflictId === conflictId);
    },

    /**
     * Open the panel of a decidable conflict by its tag in the edit form
     * (`field`: the input it is about). Another one open closes first.
     */
    openResearchConflictPanel(personId: PersonId, conflictId: string, tag: HTMLElement, field: HTMLElement | null): void {
        this.closeResearchConflictPanel({ focus: false });
        const sheet = isPhoneBar();
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = `prc-panel${sheet ? ' prc-panel--sheet bottom-sheet' : ''}`;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', `${PANEL_ID}-title`);
        let host: HTMLElement = panel;
        if (sheet) {
            // A phone: today's bottom sheet — opaque from its first frame, only the backdrop fades.
            const overlay = document.createElement('div');
            overlay.className = 'bottom-sheet-overlay prc-panel-overlay';
            overlay.appendChild(panel);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeResearchConflictPanel(); });
            host = overlay;
        }
        document.body.appendChild(host);
        tag.setAttribute('aria-expanded', 'true');

        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeResearchConflictPanel();
            } else if (e.key === 'Tab') {
                const list = focusables(panel);
                if (list.length === 0) return;
                const at = list.indexOf(document.activeElement as HTMLElement);
                e.preventDefault();
                const next = e.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : (at < 0 || at === list.length - 1 ? 0 : at + 1);
                list[next].focus();
            }
        };
        const onDown = (e: Event): void => {
            const t = e.target as Node;
            if (sheet || panel.contains(t) || tag.contains(t)) return;
            // A click elsewhere: the panel goes, the keyboard where the click went.
            this.closeResearchConflictPanel({ focus: false });
        };
        const place = (): void => { if (!sheet) this.placeResearchConflictPanel(); };
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onDown, true);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        open = {
            personId, conflictId, tag, field, sheet,
            cleanup: () => {
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('pointerdown', onDown, true);
                window.removeEventListener('resize', place);
                window.removeEventListener('scroll', place, true);
            },
        };
        drawnHtml = '';

        panel.addEventListener('click', (e) => this.researchConflictPanelClick(e));
        this.refreshResearchConflictPanel();
        if (!open) return;
        if (sheet) requestAnimationFrame(() => host.classList.add('active'));
        // The keyboard on the first choice (the close button when none is on).
        (panel.querySelector<HTMLElement>('.prc-panel-choice:not(:disabled)') ?? panel.querySelector<HTMLElement>('.prc-panel-close'))?.focus({ preventScroll: true });
    },

    /**
     * Close the panel. `focus` (default): the keyboard back on the tag that
     * opened it; `decided`: on the field (the tag goes with the conflict).
     */
    closeResearchConflictPanel(opts: { focus?: boolean; decided?: boolean } = {}): void {
        if (!open) return;
        const was = open;
        open = null;
        drawnHtml = '';
        was.cleanup();
        const panel = document.getElementById(PANEL_ID);
        const hadFocus = !!panel?.contains(document.activeElement);
        (panel?.closest('.prc-panel-overlay') ?? panel)?.remove();
        if (was.tag.isConnected) was.tag.setAttribute('aria-expanded', 'false');
        if (opts.focus === false && !(opts.decided && hadFocus)) return;
        const target = opts.decided ? was.field : was.tag;
        if (target?.isConnected) target.focus({ preventScroll: true });
    },

    /**
     * Draw the panel from the conflict's state and the data now. Decided (here,
     * elsewhere, gone) or no longer offered: it closes, the keyboard on the
     * field. The keyboard stays on the same control across a redraw.
     */
    refreshResearchConflictPanel(): void {
        if (!open) return;
        const panel = document.getElementById(PANEL_ID);
        const { personId, conflictId } = open;
        const c = this.researchConflictsShown(personId).find(x => researchConflictRef(x.id) === conflictId);
        const state = this.researchConflictCardState(conflictId);
        const done = !!state && state.kind !== 'busy' && state.kind !== 'error';
        if (!panel || !c || done || (!state && !canDecideInApp(c, DataManager.getPerson(personId)))) {
            this.closeResearchConflictPanel({ focus: false, decided: true });
            return;
        }
        const html = this.researchConflictPanelHtml(personId, c);
        if (html === drawnHtml) return;
        drawnHtml = html;
        const focusKey = panel.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focus ?? '' : null;
        // The arrow outside the scrolling body (it sticks out of the box).
        panel.innerHTML = `<span class="prc-panel-arrow" aria-hidden="true"></span><div class="prc-panel-body">${html}</div>`;
        if (focusKey !== null) {
            const target = focusKey ? panel.querySelector<HTMLElement>(`[data-focus="${focusKey}"]:not(:disabled)`) : null;
            (target ?? panel.querySelector<HTMLElement>('.prc-panel-close'))?.focus({ preventScroll: true });
        }
        panel.dataset.state = panel.querySelector<HTMLElement>('[data-row]')?.dataset.row ?? '';
        this.placeResearchConflictPanel();
    },

    /**
     * The panel's content (DEV §6.1): the title with ×, a notice when there is
     * one (saving first, sending first, an error, not on this device), the two
     * sides each with its short choice and sentence, "More in What the
     * research knows ›".
     */
    researchConflictPanelHtml(personId: PersonId, c: ResearchConflict): string {
        const sides = conflictSides(c);
        const id = researchConflictRef(c.id) ?? '';
        if (!sides) return '';
        const k = strings.conflict;
        const view = this.researchConflictCardView(personId, c);
        // The form has unsaved edits: loading the research's version would go over them — saved first.
        const saveFirst = view.row !== 'busy' && view.choices !== 'none' && this.hasPersonModalChanges();
        const sources = DataManager.getData().sources ?? {};

        let notice = '';
        if (saveFirst) {
            notice = `<div class="prc-notice prc-notice--warn" role="status"><span class="prc-notice-text">${esc(k.saveFirst)}</span></div>`;
        } else if (view.notice) {
            const n = view.notice;
            const text = n.text === 'sendFirst' ? k.sendFirst
                : n.text === 'remote' ? k.remote
                : n.text === 'errBusy' ? k.errBusy
                : n.text === 'errLocked' ? k.errLocked
                : k.errNet;
            const label = n.action === 'send' ? strings.sync.barSend : n.action === 'retry' ? k.retry : '';
            notice = `<div class="prc-notice prc-notice--${n.tone}" role="status">
                    <span class="prc-notice-text">${esc(text)}</span>${label ? `
                    <button type="button" class="prc-notice-action" data-notice-action="${n.action}" data-focus="notice">${esc(label)}</button>` : ''}
                </div>`;
        }

        const disabled = view.disabled || saveFirst;
        const notes = view.notes && view.choices !== 'none' && !saveFirst;
        const sourceLink = (v: ResearchConflictValue): string => {
            const sid = v.sourceIds?.find(s => sources[s]);
            return sid ? `<button type="button" class="link-button prc-panel-source" data-source="${esc(sid)}" data-focus="source">${esc(sources[sid].title)}</button>` : '';
        };
        const row = (which: ResearchConflictTake): string => {
            const v = sides[which];
            const noteId = `${PANEL_ID}-note-${which}`;
            const busy = view.busyTake === which;
            const off = disabled || (view.busyTake !== null && !busy);
            const value = which === 'user' && view.unsent ? this.researchConflictValueNow(personId, c) : researchValueText(c.fact, v.raw ?? v.value);
            let choice = '';
            if (view.choices === 'buttons') {
                choice = `<button type="button" class="prc-panel-choice" data-decide="${which}" data-focus="choice-${which}"
                    aria-label="${esc(which === 'user' ? k.keep : k.take)}"${busy ? ' aria-busy="true" aria-disabled="true"' : ''}${off ? ' disabled' : ''}${notes ? ` aria-describedby="${noteId}"` : ''}>${busy
                    ? `<span class="prc-spinner" aria-hidden="true"></span>${esc(k.busyTag)}` : esc(which === 'user' ? k.keepShort : k.takeShort)}</button>`;
            } else if (view.choices === 'links') {
                choice = `<button type="button" class="prc-panel-choice" data-take="${which}" data-focus="choice-${which}"
                    aria-label="${esc(which === 'user' ? k.keepLink : k.takeLink)}"${off ? ' disabled' : ''}${notes ? ` aria-describedby="${noteId}"` : ''}>${esc(which === 'user' ? k.keepShort : k.takeShort)} ↗</button>`;
            }
            const note = notes ? `<p class="prc-panel-note" id="${noteId}">${esc(which === 'user' ? k.keepNote : this.researchConflictTakeNote(c))}</p>` : '';
            return `
                <div class="prc-panel-row" data-side="${which}">
                    <div class="prc-panel-main">
                        <span class="prc-side-label">${esc(which === 'user' ? k.sideApp : k.sideResearch)}</span>
                        <span class="prc-panel-value">${esc(value)}</span>
                        ${which === 'research' ? sourceLink(v) : ''}
                    </div>
                    ${choice}${note}
                </div>`;
        };

        return `
            <div class="prc-panel-head" data-row="${saveFirst ? 'saveFirst' : view.row}">
                <h3 class="prc-panel-title" id="${PANEL_ID}-title">${esc(k.panelTitle(researchConflictTitle(c)))}</h3>
                <button type="button" class="prc-panel-close" data-focus="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
            </div>
            ${notice}
            <div class="prc-panel-box${view.choices === 'none' ? ' prc-panel-box--plain' : ''}">${row('user')}${row('research')}</div>
            ${view.linkNote && !saveFirst ? `<p class="prc-link-note">${esc(k.linkNote)}</p>` : ''}
            <button type="button" class="link-button prc-panel-more" data-focus="more" data-conflict-id="${esc(id)}">${esc(k.moreInKnows)}</button>`;
    },

    /** A click in the panel: a choice, a notice's action, the source, "More in…", ×. */
    researchConflictPanelClick(e: Event): void {
        if (!open) return;
        const { personId, conflictId } = open;
        const target = e.target as HTMLElement;
        if (target.closest('.prc-panel-close')) {
            this.closeResearchConflictPanel();
            return;
        }
        if (target.closest('.prc-panel-more')) {
            // The dialog above the form, at the card; closing it gives the keyboard back to the tag.
            this.closeResearchConflictPanel();
            this.showPersonResearchDialog(personId, { conflict: conflictId });
            return;
        }
        const source = target.closest<HTMLElement>('.prc-panel-source');
        if (source) {
            this.closeResearchConflictPanel();
            this.showSourceViewer(source.dataset.source ?? '', { personId });
            return;
        }
        const action = target.closest<HTMLElement>('[data-notice-action]');
        if (action) {
            this.researchConflictNoticeAction(personId, conflictId, action.dataset.noticeAction ?? '');
            return;
        }
        const choice = target.closest<HTMLButtonElement>('.prc-panel-choice');
        if (!choice || choice.disabled || choice.getAttribute('aria-disabled') === 'true') return;
        // Saved meanwhile or not: asked again at the click (the form may have changed since it was drawn).
        if (this.hasPersonModalChanges()) {
            this.refreshResearchConflictPanel();
            return;
        }
        if (choice.dataset.decide) {
            void this.decideResearchConflict(personId, conflictId, choice.dataset.decide === 'research' ? 'research' : 'user');
            return;
        }
        const take = choice.dataset.take === 'user' || choice.dataset.take === 'research' ? choice.dataset.take : undefined;
        const url = take ? this.activeResearchLink('conflict', { conflict: conflictId, conflictDo: 'decide', take }) : null;
        if (url) this.launchResearchLink(url, 'terminal');
    },

    /**
     * The popover under the field, its arrow at the tag, inside the window:
     * above the field when there is no room under it. A sheet places itself.
     */
    placeResearchConflictPanel(): void {
        const panel = document.getElementById(PANEL_ID);
        if (!open || open.sheet || !panel) return;
        if (!open.tag.isConnected) {
            this.closeResearchConflictPanel({ focus: false });
            return;
        }
        const tag = open.tag.getBoundingClientRect();
        const group = open.tag.closest('.form-group') ?? open.tag.parentElement;
        const below = (open.field?.isConnected ? open.field : group)?.getBoundingClientRect() ?? tag;
        const form = open.tag.closest('.modal')?.getBoundingClientRect();
        const width = Math.min(PANEL_WIDTH, (form ? form.width : window.innerWidth) - 40, window.innerWidth - 2 * EDGE);
        panel.style.width = `${Math.round(width)}px`;
        const left = Math.max(EDGE, Math.min(window.innerWidth - width - EDGE, below.left));
        const room = window.innerHeight - below.bottom - 10 - EDGE;
        const above = tag.top - 10 - EDGE;
        const body = panel.querySelector<HTMLElement>('.prc-panel-body');
        if (body) body.style.maxHeight = '';
        const height = panel.offsetHeight;
        const up = room < height && above > room;
        const max = Math.max(160, up ? above : room);
        // Only the body scrolls when the window is short of room (the arrow stays at the box).
        if (body && height > max) body.style.maxHeight = `${Math.round(max - (height - body.offsetHeight))}px`;
        const h = Math.min(height, max);
        const top = up ? tag.top - 10 - h : below.bottom + 10;
        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(Math.max(EDGE, Math.min(window.innerHeight - EDGE - h, top)))}px`;
        panel.classList.toggle('prc-panel--up', up);
        const arrow = Math.max(16, Math.min(width - 16, tag.left + tag.width / 2 - left));
        panel.style.setProperty('--arrow-x', `${Math.round(arrow)}px`);
    },
});

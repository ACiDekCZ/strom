/**
 * "Give a family tree" (spec 093 §2, §4, §9): the guide's window. A page-sized
 * dialog (#gift-modal, `.modal--page`) with the six steps as side tabs and the
 * summary under them, the steps' panes on the right and Back / Next under
 * them. On a phone (and a phone held sideways) the whole screen: the steps
 * one at a time, the subtitle a button that opens the list of steps as a
 * bottom sheet. The state lives in src/gift-guide.ts (no DOM); this file draws
 * it and changes it. × and Escape make nothing and remember the settings.
 */

import type { Person, PersonId, StromData } from '../types.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { shownName } from '../person-name.js';
import { personInitials } from '../initials.js';
import { yearOf } from '../dates.js';
import { filterAndSort } from '../person-picker.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import { formatTreeSize } from '../format.js';
import { iconSvg } from '../icons.js';
import { type PrivacyMode } from '../privacy.js';
import { giftPersonKey, loadGiftMemory } from '../gift-memory.js';
import { giftNamesLabel } from '../gift-package.js';
import { GIFT_DEPTHS, type GiftLang } from '../gift-tree.js';
import {
    GIFT_GUIDE_STEPS, giftCanProceed, giftDepthIndex, giftFullSet, giftGoTo, giftGuideStart, giftHasFamily,
    giftIsoDate, giftLivingModel, giftRecipients, giftRemember, giftSuggestedPartner, giftSummary, giftToggleFull,
    type GiftLivingModel, type GiftMode, type GiftState, type GiftSummary,
} from '../gift-guide.js';
import { uiModule } from './module.js';
import { MODAL_BACK_CHEVRON } from './modal-back.js';
import { openPersonPopover } from './person-popover.js';

export const GIFT_MODAL_ID = 'gift-modal';

/** From this many living people step 3 offers a search over its list (§4 [24]). */
export const GIFT_LIVING_SEARCH_FROM = 50;

/** How the guide is opened: a person (or a couple), the mode, a list (B4), the first step. */
export interface GiftTreeOpenOptions {
    personId?: PersonId;
    recipients?: PersonId[];
    mode?: GiftMode;
    listId?: string;
    step?: number;
}

interface GiftUi {
    g: GiftState;
    data: StromData;
    /** The person in focus when the guide opened ("person in focus" under the name). */
    focusId: PersonId | null;
    listId?: string;
    /** Step 3's search over the living. */
    query: string;
    /** A tap on the greyed "list" choice on a phone: the sentence why under the choices. */
    listWhy: boolean;
    closePicker: (() => void) | null;
    summaryKey: string;
    summary: GiftSummary | null;
    livingKey: string;
    living: GiftLivingModel | null;
    mq: MediaQueryList | null;
    onMq: (() => void) | null;
}

let ui: GiftUi | null = null;

function lang(): GiftLang {
    return getCurrentLanguage() as GiftLang;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

function isPhone(): boolean {
    return typeof matchMedia === 'function' && matchMedia(MQ_PHONE_BAR).matches;
}

/** A day as the language writes it ("24. 12. 2026", "12/24/2026"). */
export function giftDateLabel(iso: string, language: GiftLang = lang()): string {
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);
}

/** Whether the person menu offers "Give a family tree…": the person has parents, a partner or children (§1). */
export function canGiftTree(personId: PersonId): boolean {
    return giftHasFamily(DataManager.getData(), personId);
}

/** The person menu's quiet date: the day the last package for this person was made (§9 [66]), else undefined. */
export function giftMenuMeta(personId: PersonId): string | undefined {
    const memory = loadGiftMemory(TreeManager.getActiveTreeId(), giftPersonKey([personId]));
    return memory?.madeAt ? giftDateLabel(memory.madeAt) : undefined;
}

/** "1941–2015", "* 1972", "† 1990" or ''. */
function yearsOf(p: Person): string {
    const b = yearOf(p.birthDate), d = yearOf(p.deathDate);
    if (b !== null && d !== null) return `${b}–${d}`;
    if (b !== null) return `* ${b}`;
    if (d !== null) return `† ${d}`;
    return '';
}

function realPerson(data: StromData, id: PersonId | null | undefined): Person | null {
    const p = id ? data.persons[id] : undefined;
    return p && !p.isPlaceholder ? p : null;
}

/** The settings the summary and step 3 depend on, as a key (computed again only when it changes). */
function cutKey(g: GiftState): string {
    const s = g.settings;
    return JSON.stringify([s.cut, s.privacy, s.parts, s.photos]);
}

function summaryOf(u: GiftUi): GiftSummary {
    const key = cutKey(u.g);
    if (!u.summary || u.summaryKey !== key) {
        u.summary = giftSummary(u.data, u.g.settings, new Date());
        u.summaryKey = key;
    }
    return u.summary;
}

function livingOf(u: GiftUi): GiftLivingModel {
    const s = u.g.settings;
    const key = JSON.stringify([s.cut, s.privacy.others]);
    if (!u.living || u.livingKey !== key) {
        u.living = giftLivingModel(u.data, s, lang(), new Date().getFullYear(), p => shownName(p) || '?');
        u.livingKey = key;
    }
    return u.living;
}

/** A small round portrait place with the initials (the design's avatar), framed by gender. */
function avatar(p: Person): HTMLElement {
    const av = el('span', p.gender === 'female' ? 'gift-av is-f' : 'gift-av', personInitials(p.firstName, p.lastName));
    av.setAttribute('aria-hidden', 'true');
    return av;
}

export const giftTreeMethods = uiModule({
    /**
     * Open the guide (`window.Strom.UI.showGiftTree`): for a person (default:
     * the person in focus), a couple or a list; it starts from what was
     * remembered for them (§9) or from the defaults.
     */
    showGiftTree(opts: GiftTreeOpenOptions = {}): void {
        const overlay = document.getElementById(GIFT_MODAL_ID);
        if (!overlay) return;
        if (ui) this.closeGiftTree();
        const data = DataManager.getData();
        const focusId = TreeRenderer.getFocusPersonId() ?? null;
        const first = opts.recipients?.[0] ?? opts.personId ?? focusId ?? null;
        let mode: GiftMode = opts.mode ?? (opts.recipients && opts.recipients.length === 2 ? 'pair' : 'single');
        if (mode === 'list' && isPhone()) mode = 'single';
        const recipients: Array<PersonId | null> = [realPerson(data, first)?.id ?? null];
        if (mode === 'pair') {
            const second = opts.recipients?.[1] ?? (recipients[0] ? giftSuggestedPartner(data, recipients[0]) : null);
            recipients.push(realPerson(data, second)?.id ?? null);
        }
        const g = giftGuideStart({
            data, treeId: TreeManager.getActiveTreeId(), mode, recipients,
            lang: lang(), signature: SettingsManager.getSenderName(), now: new Date(),
        });
        ui = {
            g, data, focusId, listId: opts.listId, query: '', listWhy: false, closePicker: null,
            summaryKey: '', summary: null, livingKey: '', living: null, mq: null, onMq: null,
        };
        if (opts.step && giftCanProceed(g, data)) giftGoTo(g, opts.step);
        // A window turned between phone and wider: the steps drawn again (the greyed list choice, the footer).
        if (typeof matchMedia === 'function') {
            const mq = matchMedia(MQ_PHONE_BAR);
            const onMq = (): void => this.giftRender();
            mq.addEventListener('change', onMq);
            ui.mq = mq;
            ui.onMq = onMq;
        }
        this.wireGiftModal(overlay);
        if (this.isPersonPageOpen()) this.dialogStack = this.dialogStack.filter(id => id !== GIFT_MODAL_ID);
        else this.clearDialogStack();
        this.pushDialog(GIFT_MODAL_ID);
        overlay.classList.add('active');
        this.giftRender();
        requestAnimationFrame(() => {
            overlay.querySelector<HTMLElement>('.gift-pane [aria-checked="true"], .gift-pane button, .gift-pane input')?.focus({ preventScroll: true });
        });
    },

    /** The footer's and header's buttons (wired once; they act on the guide open now). */
    wireGiftModal(overlay: HTMLElement): void {
        if (overlay.dataset.wired) return;
        overlay.dataset.wired = '1';
        overlay.querySelector('#gift-prev')?.addEventListener('click', () => this.giftStep(-1));
        overlay.querySelector('#gift-next')?.addEventListener('click', () => {
            if (!ui) return;
            if (ui.g.step >= GIFT_GUIDE_STEPS) this.giftCreatePackage();
            else this.giftStep(1);
        });
        overlay.querySelector('#gift-back')?.addEventListener('click', () => {
            if (!ui) return;
            if (ui.g.step <= 1) this.closeGiftTree();
            else this.giftStep(-1);
        });
        overlay.querySelector('#gift-sub-btn')?.addEventListener('click', () => this.giftStepsSheet());
        overlay.querySelector('#gift-nav')?.addEventListener('click', (e) => {
            const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-step]');
            if (!tab || tab.getAttribute('aria-disabled') === 'true' || !ui) return;
            this.giftGo(Number(tab.dataset.step));
        });
    },

    /** The guide is open. */
    isGiftTreeOpen(): boolean {
        return !!ui && !!document.getElementById(GIFT_MODAL_ID)?.classList.contains('active');
    },

    /** Escape: the open person choice first, then the window (nothing made, the settings remembered). */
    giftEscape(): void {
        if (ui?.closePicker) { ui.closePicker(); return; }
        this.closeGiftTree();
    },

    /** Close the guide: nothing is made; the settings are remembered for this person or couple (§9). */
    closeGiftTree(): void {
        const u = ui;
        ui = null;
        if (u) {
            u.closePicker?.();
            if (u.mq && u.onMq) u.mq.removeEventListener('change', u.onMq);
            if (giftCanProceed(u.g, u.data)) giftRemember(u.g, summaryOf(u).persons, new Date());
        }
        document.getElementById(GIFT_MODAL_ID)?.classList.remove('active');
        this.dialogStack = this.dialogStack.filter(id => id !== GIFT_MODAL_ID);
    },

    /** "Create package" (step 6): the package itself is made by the next part of the guide. */
    giftCreatePackage(): void {
        // Made in step 6 (spec 093 §8); until then the button only ends the steps.
    },

    /** A step forward or back. */
    giftStep(delta: number): void {
        if (!ui) return;
        this.giftGo(ui.g.step + delta);
    },

    /** Show a step (a side tab, the phone's list of steps, "Straight to preview"). */
    giftGo(step: number): void {
        if (!ui) return;
        if (step > 1 && !giftCanProceed(ui.g, ui.data)) return;
        ui.closePicker?.();
        giftGoTo(ui.g, step);
        ui.query = '';
        this.giftRender();
        const pane = document.getElementById('gift-pane');
        if (pane) pane.scrollTop = 0;
    },

    /** Draw the window: header, side, the step's pane, footer. The focused control keeps its focus. */
    giftRender(): void {
        const u = ui;
        const overlay = document.getElementById(GIFT_MODAL_ID);
        if (!u || !overlay) return;
        const active = document.activeElement as HTMLElement | null;
        const focusKey = active && overlay.contains(active) ? active.dataset.gk : undefined;
        const t = strings.giftTree;
        const g = u.g;
        const names = t.stepNames;
        const can = giftCanProceed(g, u.data);
        const sum = summaryOf(u);
        overlay.dataset.step = String(g.step);

        // Header: ‹ the step before (a phone: ‹ always, from step 1 it closes), the title, "step N of 6: …".
        const back = overlay.querySelector<HTMLButtonElement>('#gift-back');
        if (back) {
            back.classList.toggle('is-first', g.step <= 1);
            back.innerHTML = MODAL_BACK_CHEVRON;
            const label = g.step > 1 ? names[g.step - 2] : strings.buttons.close;
            back.appendChild(el('span', 'gift-back-name', g.step > 1 ? label : ''));
            back.setAttribute('aria-label', g.step > 1 ? `${t.guide.back}: ${label}` : strings.buttons.close);
        }
        const sub = overlay.querySelector('#gift-sub');
        if (sub) sub.textContent = t.step(g.step, names[g.step - 1]);
        const subBtn = overlay.querySelector('#gift-sub-btn');
        if (subBtn) {
            subBtn.textContent = `${t.stepPhone(g.step, names[g.step - 1])} `;
            const caret = el('span', 'gift-sub-caret', '▾');
            caret.setAttribute('aria-hidden', 'true');
            subBtn.appendChild(caret);
            subBtn.setAttribute('aria-haspopup', 'dialog');
        }

        // The side: the six steps, then the summary.
        const nav = overlay.querySelector<HTMLElement>('#gift-nav');
        if (nav) {
            nav.replaceChildren();
            nav.setAttribute('aria-label', t.guide.stepsH);
            nav.appendChild(el('div', 'structure-who-head', t.guide.stepsH));
            const tabs = el('div', 'structure-who-tabs');
            for (let i = 1; i <= GIFT_GUIDE_STEPS; i++) {
                const tab = el('button', 'sel-tab gift-tab');
                tab.type = 'button';
                tab.dataset.selDir = 'side';
                tab.dataset.step = String(i);
                tab.dataset.gk = `tab-${i}`;
                if (i === g.step) tab.setAttribute('aria-current', 'step');
                if (i > 1 && !can) tab.setAttribute('aria-disabled', 'true');
                const k = el('span', 'gift-k', String(i));
                k.setAttribute('aria-hidden', 'true');
                tab.append(k, el('span', 'gift-tab-l', names[i - 1]));
                if (g.done.has(i)) {
                    const ok = el('span', 'gift-ok');
                    ok.innerHTML = iconSvg('check', { size: 14 });
                    ok.appendChild(el('span', 'gift-sr', t.guide.stepDone));
                    tab.appendChild(ok);
                }
                tabs.appendChild(tab);
            }
            nav.appendChild(tabs);
            nav.appendChild(this.giftSummaryEl(sum));
        }

        // The step's pane.
        const pane = overlay.querySelector<HTMLElement>('#gift-pane');
        if (pane) {
            const top = pane.scrollTop;
            pane.replaceChildren();
            if (g.step === 1) this.giftRenderForWhom(pane);
            else if (g.step === 3) this.giftRenderLiving(pane);
            else pane.appendChild(el('h3', 'gift-h3', names[g.step - 1]));
            pane.scrollTop = top;
        }

        // The footer: a phone's summary line, Back or Cancel, Next or Create package.
        const footSum = overlay.querySelector<HTMLElement>('#gift-foot-sum');
        if (footSum) {
            footSum.innerHTML = can
                ? `<b>${sum.persons}</b> ${esc(t.guide.persons(sum.persons))} · <b>${sum.living}</b> ${esc(t.guide.living(sum.living))} · ${esc(t.guide.about(formatTreeSize(sum.bytes, lang())))}`
                : '';
        }
        const prev = overlay.querySelector<HTMLButtonElement>('#gift-prev');
        const cancel = overlay.querySelector<HTMLButtonElement>('#gift-cancel');
        const next = overlay.querySelector<HTMLButtonElement>('#gift-next');
        if (prev) { prev.hidden = g.step <= 1; prev.textContent = t.guide.back; }
        if (cancel) cancel.hidden = g.step > 1;
        if (next) {
            next.textContent = g.step >= GIFT_GUIDE_STEPS ? t.create : t.guide.next;
            next.disabled = !can;
        }

        if (focusKey) overlay.querySelector<HTMLElement>(`[data-gk="${focusKey}"]`)?.focus({ preventScroll: true });
    },

    /** The side's summary (§2): the name, people and generations, the living, the ZIP's size. */
    giftSummaryEl(sum: GiftSummary): HTMLElement {
        const u = ui!;
        const t = strings.giftTree.guide;
        const box = el('div', 'gift-sum');
        box.setAttribute('aria-live', 'polite');
        const names = giftRecipients(u.g).map(id => realPerson(u.data, id)).filter((p): p is Person => !!p).map(p => shownName(p) || '?');
        box.appendChild(el('span', 'gift-sum-name', giftNamesLabel(lang(), names)));
        if (!giftCanProceed(u.g, u.data)) return box;
        const line = (html: string): void => { const s = el('span'); s.innerHTML = html; box.appendChild(s); };
        line(`<b>${sum.persons}</b> ${esc(t.persons(sum.persons))} · ${sum.generations} ${esc(t.generations(sum.generations))}`);
        line(`<b>${sum.living}</b> ${esc(t.living(sum.living))}`);
        box.appendChild(el('span', undefined, t.zip(formatTreeSize(sum.bytes, lang()))));
        return box;
    },

    /** The phone's list of steps (the subtitle's ▾): a bottom sheet with the steps and the summary. */
    giftStepsSheet(): void {
        const u = ui;
        if (!u) return;
        const t = strings.giftTree;
        const can = giftCanProceed(u.g, u.data);
        const sum = summaryOf(u);
        const rows = t.stepNames.map((name, i) => ({
            label: name, icon: String(i + 1), active: i + 1 === u.g.step,
            value: u.g.done.has(i + 1) ? '✓' : '',
            id: `gift-sheet-step-${i + 1}`,
            ...(i > 0 && !can ? { disabled: true } : {}),
            run: () => this.giftGo(i + 1),
        }));
        const quiet = can
            ? `${sum.persons} ${t.guide.persons(sum.persons)} · ${sum.living} ${t.guide.living(sum.living)} · ${t.guide.about(formatTreeSize(sum.bytes, lang()))}`
            : undefined;
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(t.guide.stepsH, [{ rows, ...(quiet ? { quiet } : {}) }], { overlayClass: 'gift-steps-sheet' });
    },

    // ---- Step 1: For whom (§2 [8–10], §9 [65]) ----

    giftRenderForWhom(pane: HTMLElement): void {
        const u = ui!;
        const g = u.g;
        const t = strings.giftTree;
        const G = t.guide;
        const phone = isPhone();
        const can = giftCanProceed(g, u.data);
        const cols = el('div', 'gift-cols is-s1');
        const left = el('div', 'gift-col');
        const right = el('div', 'gift-col gift-defaults');

        left.appendChild(el('h3', 'gift-h3', G.forWhomH));
        // The three choices (a radio group of .sel-opt rows with a dot).
        const group = el('div', 'structure-choice gift-modes');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', G.forWhomH);
        const modes: GiftMode[] = ['single', 'pair', 'list'];
        const choices: HTMLButtonElement[] = [];
        for (const m of modes) {
            const off = m === 'list' && phone;
            const b = el('button', 'sel-opt gift-mode');
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.dataset.mode = m;
            b.dataset.gk = `mode-${m}`;
            b.setAttribute('aria-checked', String(g.mode === m));
            b.tabIndex = g.mode === m ? 0 : -1;
            const dot = el('span', 'structure-dot');
            dot.setAttribute('aria-hidden', 'true');
            const text = el('span', 'option-text');
            text.append(el('span', 'option-title', G.mode[m].t), el('span', 'option-desc', off ? G.listPhoneWhy : G.mode[m].d));
            b.append(dot, text);
            if (off) b.setAttribute('aria-disabled', 'true');
            b.addEventListener('click', () => {
                if (off) { u.listWhy = true; this.giftRender(); return; }
                this.giftSetMode(m);
            });
            choices.push(b);
            group.appendChild(b);
        }
        group.addEventListener('keydown', (e) => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            const live = choices.filter(c => c.getAttribute('aria-disabled') !== 'true');
            const at = live.findIndex(c => c.dataset.mode === g.mode);
            const to = live[(at + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : live.length - 1)) % live.length];
            if (!to) return;
            e.preventDefault();
            this.giftSetMode(to.dataset.mode as GiftMode);
        });
        left.appendChild(group);
        if (phone && u.listWhy) left.appendChild(el('p', 'gift-note', G.listPhoneNote));

        // Who: one person, or the couple's two.
        const who = el('div', 'gift-who');
        const chosen = g.recipients;
        who.appendChild(el('span', 'gift-label', g.mode === 'pair' ? G.recipients : G.recipient));
        const first = realPerson(u.data, chosen[0]);
        who.appendChild(this.giftPersonRow(first, 0, first && first.id === u.focusId ? strings.selection.focusSub : '', strings.selection.changePerson));
        if (g.mode === 'pair') {
            const second = realPerson(u.data, chosen[1]);
            const suggested = first ? giftSuggestedPartner(u.data, first.id) : null;
            who.appendChild(this.giftPersonRow(second, 1, second && second.id === suggested ? G.partnerFromTree : '', G.otherPerson));
            if (!second) who.appendChild(el('p', 'gift-note', G.secondMissing));
            else who.appendChild(el('p', 'gift-note', G.pairNote));
        } else if (first && !giftHasFamily(u.data, first.id)) {
            // A person alone in the tree: nothing to make a family tree of (§1 [9]).
            const lone = el('p', 'gift-note gift-lone', G.lonePerson(shownName(first) || '?', first.gender === 'female', strings.selection.changePerson));
            lone.id = 'gift-lone';
            who.appendChild(lone);
        }
        if (g.memory) {
            // §9 [65]: the steps start from last time's settings.
            const last = el('p', 'gift-last');
            last.appendChild(el('b', undefined, t.last(giftDateLabel(g.memory.lastAt))));
            last.append(` ${G.lastMore} `);
            const restart = button('link-button', t.restart, () => this.giftRestart());
            restart.dataset.gk = 'restart';
            last.appendChild(restart);
            who.appendChild(last);
        }
        left.appendChild(who);

        // The signature (shown in the letter and when the app opens).
        const field = el('label', 'gift-field');
        field.appendChild(el('span', 'gift-label', phone ? G.signatureShort : G.signature));
        const input = el('input', 'gift-input');
        input.type = 'text';
        input.value = g.settings.letter.signature;
        input.dataset.gk = 'signature';
        input.autocomplete = 'off';
        input.addEventListener('input', () => {
            g.settings.letter = { ...g.settings.letter, signature: input.value };
        });
        field.appendChild(input);
        left.appendChild(field);

        cols.appendChild(left);
        if (can) {
            const sum = summaryOf(u);
            right.appendChild(el('h3', 'gift-h3', g.memory ? G.lastH : G.defaultsH));
            const dl = el('dl', 'gift-dl');
            for (const [dt, dd] of this.giftSettingsRows(sum)) {
                dl.append(el('dt', undefined, dt), el('dd', undefined, dd));
            }
            right.appendChild(dl);
            right.appendChild(el('p', 'gift-note gift-defaults-note', g.memory ? G.cutChanged(sum.persons - g.memory.cutSize) : G.fastNote));
            const fast = button('secondary gift-fast', t.fast, () => this.giftGo(GIFT_GUIDE_STEPS));
            fast.dataset.gk = 'fast';
            right.appendChild(fast);
            // A phone: one quiet sentence and the link instead of the four rows.
            const phoneFast = el('p', 'gift-note gift-phone-fast');
            phoneFast.append(`${g.memory ? G.phoneLast : G.phoneDefaults} `);
            const link = button('link-button', t.fast, () => this.giftGo(GIFT_GUIDE_STEPS));
            link.dataset.gk = 'fast-phone';
            phoneFast.appendChild(link);
            right.appendChild(phoneFast);
            cols.appendChild(right);
        }
        pane.appendChild(cols);
    },

    /** A recipient's row: portrait, name, years and what they are, "Change…" (or "Choose a person…" while missing). */
    giftPersonRow(p: Person | null, index: number, note: string, change: string): HTMLElement {
        const row = el('div', 'gift-prow');
        const G = strings.giftTree.guide;
        if (p) {
            row.appendChild(avatar(p));
            const text = el('div', 'gift-ptext');
            text.appendChild(el('div', 'gift-pname', shownName(p) || '?'));
            const place = p.birthPlace ? p.birthPlace.split(',')[0].trim() : '';
            const years = [yearsOf(p), place].filter(Boolean).join(', ');
            const sub = [years, note].filter(Boolean).join(' · ');
            if (sub) text.appendChild(el('div', 'gift-pyears', sub));
            row.appendChild(text);
        } else {
            row.appendChild(el('div', 'gift-ptext gift-pnone', G.secondMissing));
        }
        const btn = el('button', 'link-button gift-change', p ? change : G.choosePerson);
        btn.type = 'button';
        btn.dataset.gk = `change-${index}`;
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', () => this.giftPickPerson(index, btn));
        row.appendChild(btn);
        return row;
    },

    /** "Change…" / "Another person…": the person popover (search over the tree, the person in focus offered). */
    giftPickPerson(index: number, anchor: HTMLElement): void {
        const u = ui;
        const overlay = document.getElementById(GIFT_MODAL_ID);
        if (!u || !overlay) return;
        if (u.closePicker) { u.closePicker(); return; }
        const tv = strings.treeOverview;
        const suggested: Array<{ id: PersonId; meta: string }> = [];
        const current = u.g.recipients[index];
        if (current) suggested.push({ id: current, meta: '' });
        if (index === 1 && u.g.recipients[0]) {
            const partner = giftSuggestedPartner(u.data, u.g.recipients[0]);
            if (partner) suggested.push({ id: partner, meta: strings.giftTree.guide.partnerFromTree });
        }
        if (u.focusId) suggested.push({ id: u.focusId, meta: tv.inFocus });
        u.closePicker = openPersonPopover({
            host: overlay, anchor, data: u.data, selectedId: current ?? null, suggested,
            labels: { search: tv.searchPerson, list: strings.giftTree.guide.choosePerson, noMatch: tv.noMatch },
            onClose: () => { if (ui) ui.closePicker = null; },
            onPick: (id) => {
                if (!ui) return;
                const next = [...ui.g.recipients];
                next[index] = id;
                // A couple: a new first person brings their own last partner along.
                if (ui.g.mode === 'pair' && index === 0) next[1] = giftSuggestedPartner(ui.data, id);
                this.giftRestartFor(ui.g.mode, next);
                requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="change-${index}"]`)?.focus());
            },
        });
    },

    /** One person / a couple / a list. A couple's second person: the first one's last partner. */
    giftSetMode(mode: GiftMode): void {
        const u = ui;
        if (!u || u.g.mode === mode) return;
        const first = u.g.recipients[0] ?? null;
        const recipients: Array<PersonId | null> = [first];
        if (mode === 'pair') recipients.push(first ? giftSuggestedPartner(u.data, first) : null);
        this.giftRestartFor(mode, recipients);
    },

    /**
     * The guide for other recipients: their remembered settings or the
     * defaults (settings are kept per person or couple, §9); the signature
     * typed stays.
     */
    giftRestartFor(mode: GiftMode, recipients: Array<PersonId | null>): void {
        const u = ui;
        if (!u) return;
        const signature = u.g.settings.letter.signature;
        u.g = giftGuideStart({
            data: u.data, treeId: u.g.treeId, mode, recipients, lang: lang(), signature, now: new Date(),
        });
        u.g.settings.letter = { ...u.g.settings.letter, signature };
        u.query = '';
        this.giftRender();
    },

    /** "Start over with defaults": last time's settings left (they stay remembered until the guide closes). */
    giftRestart(): void {
        const u = ui;
        if (!u) return;
        u.g = giftGuideStart({
            data: u.data, treeId: u.g.treeId, mode: u.g.mode, recipients: u.g.recipients,
            lang: lang(), signature: SettingsManager.getSenderName(), now: new Date(), storage: null,
        });
        this.giftRender();
        document.querySelector<HTMLElement>(`#${GIFT_MODAL_ID} [data-gk="mode-${u.g.mode}"]`)?.focus({ preventScroll: true });
    },

    /** Step 1's four rows: what the tree, the living, the package and the letter will be (§2, §9). */
    giftSettingsRows(sum: GiftSummary): Array<[string, string]> {
        const u = ui!;
        const s = u.g.settings;
        const G = strings.giftTree.guide;
        const language = lang();
        const branches = Object.keys(s.cut.branches).length;
        const cut = [G.cutDepth[giftDepthIndex(s.cut.depth)] ?? G.cutDepth[GIFT_DEPTHS.length - 1],
            ...(branches ? [G.cutBranches(branches)] : [])].join(', ') + ` · ${sum.persons} ${G.persons(sum.persons)}`;
        let living: string;
        if (sum.living === 0) living = G.livingNone;
        else if (s.privacy.others === 'full') living = G.livingAll;
        else {
            const model = livingOf(u);
            const extra = model.rows.filter(r => !r.household && s.privacy.fullIds.includes(r.id)).length;
            const firsts = giftRecipients(u.g).map(id => u.data.persons[id]?.firstName || shownName(u.data.persons[id]) || '?');
            const others = s.privacy.others as Exclude<PrivacyMode, 'full'>;
            living = `${G.livingFull(giftNamesLabel(language, firsts), extra)}, ${G.others[others]}`;
        }
        const parts = [G.parts.letter, ...(['app', 'pages', 'book', 'fan', 'gedcom'] as const).filter(k => s.parts[k]).map(k => G.parts[k])];
        const pkg = `${parts.join(', ')}, ${s.photos ? G.withPhotos : G.withoutPhotos} · ${G.about(formatTreeSize(sum.bytes, language))}`;
        const today = giftIsoDate(new Date());
        const letter = [s.letter.message ? G.letterOwn : G.letterTemplate, G.motif[s.letter.motif],
            s.letter.date === today ? G.today : giftDateLabel(s.letter.date, language)].join(', ');
        return [[G.rows.cut, cut], [G.rows.living, living], [G.rows.parts, pkg], [G.rows.letter, letter]];
    },

    // ---- Step 3: Living people (§4 [13, 23–25, 37–39]) ----

    giftRenderLiving(pane: HTMLElement): void {
        const u = ui!;
        const s = u.g.settings;
        const G = strings.giftTree.guide;
        const model = livingOf(u);
        const full = giftFullSet(model, s);
        const living = model.rows.length;
        const cols = el('div', 'gift-cols is-s3');
        const left = el('div', 'gift-col gift-living');
        const right = el('div', 'gift-col gift-protect');

        if (living > 0) {
            // The numbers: living of all, in full, shortened (a phone: four, the people last).
            const stats = el('div', 'structure-stats gift-stats');
            const stat = (n: number, label: string, cls = ''): void => {
                const box = el('div', `structure-stat${cls}`);
                box.append(el('b', undefined, String(n)), el('span', undefined, label));
                stats.appendChild(box);
            };
            const others = s.privacy.others;
            stat(living, G.statLivingOf(living, model.persons), ' gift-stat-wide');
            stat(living, G.living(living), ' gift-stat-phone');
            stat(full.size, G.statFull);
            if (others !== 'full') {
                stat(living - full.size, G.statShort[others], ' gift-stat-wide');
                stat(living - full.size, G.statShortPhone, ' gift-stat-phone');
            }
            stat(model.persons, G.persons(model.persons), ' gift-stat-phone');
            left.appendChild(stats);

            const head = el('div', 'gift-living-head');
            head.append(el('h3', 'gift-h3', G.livingH), el('span', 'gift-faint', G.checkedFull));
            left.appendChild(head);

            const listHost = el('div', 'gift-living-list');
            if (living >= GIFT_LIVING_SEARCH_FROM) {
                const search = el('input', 'gift-input gift-search');
                search.type = 'search';
                search.placeholder = G.searchLiving;
                search.setAttribute('aria-label', G.searchLiving);
                search.value = u.query;
                search.dataset.gk = 'living-search';
                search.autocomplete = 'off';
                search.addEventListener('input', () => {
                    u.query = search.value;
                    this.giftFillLiving(listHost);
                });
                left.appendChild(search);
            }
            left.appendChild(listHost);
            this.giftFillLiving(listHost);
        } else {
            left.appendChild(el('p', 'gift-lead', G.noLiving));
            left.appendChild(el('p', 'gift-note', G.noLivingNote));
        }

        if (living > 0) {
            // The other living: today's modes, with what each makes of them.
            const field = el('label', 'gift-field gift-others');
            field.appendChild(el('span', 'gift-label', G.othersH));
            const select = el('select', 'gift-select');
            select.dataset.gk = 'others';
            const P = strings.privacy;
            const labels: Record<PrivacyMode, string> = {
                full: P.modeFull, initials: P.modeInitials, anonymous: P.modeAnonymous, minimal: P.modeMinimal,
            };
            for (const m of ['initials', 'anonymous', 'minimal', 'full'] as PrivacyMode[]) {
                const o = el('option', undefined, labels[m]);
                o.value = m;
                o.selected = s.privacy.others === m;
                select.appendChild(o);
            }
            select.addEventListener('change', () => {
                s.privacy = { ...s.privacy, others: select.value as PrivacyMode };
                this.giftRender();
            });
            field.appendChild(select);
            right.appendChild(field);
            right.appendChild(el('p', 'gift-faint gift-mode-desc', G.modeDesc[s.privacy.others]));

            right.appendChild(el('h3', 'gift-h3 gift-sens-h', G.sensitiveH));
            const sens = el('div', 'content-checks gift-checks gift-sens');
            for (const key of ['birthDates', 'addresses', 'contacts', 'photos', 'notes', 'religion', 'sources'] as const) {
                sens.appendChild(this.giftCheck(`sens-${key}`, G.sensitive[key], s.privacy.sensitive[key], (on) => {
                    s.privacy = { ...s.privacy, sensitive: { ...s.privacy.sensitive, [key]: on } };
                }));
            }
            right.appendChild(sens);
        }
        right.appendChild(el('h3', 'gift-h3 gift-dead-h', G.deadH));
        const dead = el('div', 'content-checks gift-checks gift-dead');
        for (const key of ['causes', 'notes', 'sources'] as const) {
            dead.appendChild(this.giftCheck(`dead-${key}`, G.dead[key], s.privacy.dead[key], (on) => {
                s.privacy = { ...s.privacy, dead: { ...s.privacy.dead, [key]: on } };
            }));
        }
        right.appendChild(dead);
        right.appendChild(el('p', 'gift-note gift-all-parts', strings.giftTree.allParts));

        cols.append(left, right);
        pane.appendChild(cols);
    },

    /** A `.content-check` box; a change redraws the summary (the size follows photos and the rest). */
    giftCheck(key: string, label: string, on: boolean, set: (on: boolean) => void): HTMLElement {
        const box = el('label', 'content-check');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = on;
        input.dataset.gk = key;
        input.addEventListener('change', () => {
            set(input.checked);
            this.giftRender();
        });
        box.append(input, el('span', undefined, label));
        return box;
    },

    /** Step 3's rows of the living: the household locked on top, the rest ticked for "in full" (filtered by the search). */
    giftFillLiving(host: HTMLElement): void {
        const u = ui!;
        const s = u.g.settings;
        const G = strings.giftTree.guide;
        const model = livingOf(u);
        const full = giftFullSet(model, s);
        const allFull = s.privacy.others === 'full';
        host.replaceChildren();
        let rows = model.rows;
        const q = u.query.trim();
        if (q) {
            const persons = rows.map(r => u.data.persons[r.id]).filter((p): p is Person => !!p);
            const hit = new Set(filterAndSort(q, persons, u.data).map(p => p.id));
            rows = rows.filter(r => hit.has(r.id));
            if (!rows.length) { host.appendChild(el('p', 'gift-faint gift-nomatch', G.noMatch)); return; }
        }
        const list = el('ul', 'gift-lv');
        list.setAttribute('aria-label', G.livingH);
        let householdEnded = false;
        const householdNote = (): void => {
            const li = el('li', 'gift-lv-note gift-faint', strings.giftTree.household);
            list.appendChild(li);
        };
        for (const r of rows) {
            if (!r.household && !householdEnded) {
                householdEnded = true;
                if (rows.some(x => x.household)) householdNote();
            }
            const isFull = full.has(r.id);
            const li = el('li', 'gift-lv-r' + (isFull ? ' is-full' : ''));
            const label = el('label', 'gift-lv-label');
            const input = el('input');
            input.type = 'checkbox';
            input.checked = isFull;
            input.dataset.gk = `lv-${r.id}`;
            if (r.household || allFull) input.disabled = true;
            input.addEventListener('change', () => {
                giftToggleFull(s, r.id, input.checked);
                this.giftRender();
            });
            const text = el('span', 'gift-lv-text');
            text.appendChild(el('span', 'gift-lv-name', r.name));
            const rel = r.recipient ? G.recipientRel(r.female) : r.relation;
            if (rel) text.appendChild(el('span', 'gift-lv-rel', rel));
            label.append(input, text);
            li.appendChild(label);
            li.appendChild(el('span', 'gift-lv-v', isFull ? G.fullWord : r.shortened));
            list.appendChild(li);
        }
        if (!householdEnded && rows.some(x => x.household)) householdNote();
        host.appendChild(list);
    },
});

/**
 * "Did this come from a family tree (import, merge)?" in Awaiting action
 * (1127, `waiting.import`): the send it asks about (its day, how many people,
 * three of them — in the row only), what the answer would change (the research's preview, read
 * when the item opens), the marks' meaning with "What the marks mean", and
 * the two answers through the bridge. The pure half is research-import-ask.ts.
 *
 * Answering goes through the bridge, without a terminal and without an
 * agent: no mark (CLAUDE.md). The overview's own window asks the main window
 * to read and write (readImportAskItem / writeImportAskAnswer are overridden
 * there). After "Yes" the research's tree is loaded again (its facts now ○○).
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { LiveWaiting, inShowcase, researchDeviceAllows } from '../research-link.js';
import {
    answerImportAsk, importAskOutcomeOf, importAskStayParts, readImportAskPreview,
    type ImportAskDo, type ImportAskOutcome, type ImportAskPreview, type ImportAskWritten,
} from '../research-import-ask.js';
import { el, liveSession, type LiveSession } from './research-ui.js';
import { itemKey } from './waiting-images-ui.js';
import { markShowcaseOff } from './sample-why.js';
import { runBusy } from './busy.js';
import { HELP_TOPICS } from '../help/topics.js';
import { openHelp } from './help-ui.js';
import type { UIClass } from './index.js';

/** The preview of an item: being read, read, or why not (with Try again when it helps). */
type PreviewState =
    | { phase: 'loading' }
    | { phase: 'ok'; preview: ImportAskPreview }
    | { phase: 'failed'; text: string; retry: boolean };

/** The previews, by item (`itemKey`). */
const previews = new Map<string, PreviewState>();
/** Answers on their way: the item and what it answers (its button works, the other waits, dimmed). */
const answering = new Map<string, ImportAskDo>();
/** A refused answer's sentence at its item, and how to try it again. */
const problems = new Map<string, { text: string; tone: 'warn' | 'danger'; retry: (() => void) | null }>();
/** Items answered here (or gone): hidden while a status read before the answer still lists them. */
const answered = new Set<string>();

/** The day of a send in the UI's language ("25. 11. 2026"); the day as said when it is not one. */
export function importAskDayText(day: string, lang: string = getCurrentLanguage()): string {
    const t = Date.parse(`${day}T12:00:00Z`);
    if (!Number.isFinite(t)) return day;
    try {
        return new Date(t).toLocaleDateString(lang, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
    } catch {
        return day;
    }
}

/** The reasons facts stay ✓, in words ("15 edited since the send, 4 confirmed"). */
export function importAskStayText(stay: ImportAskPreview['stay']): string {
    const T = strings.live.importAsk.stayPart;
    return importAskStayParts(stay).map(p => T[p.key](p.n)).join(', ');
}

export const waitingImportMethods = {
    /** A new status's waiting items: one answered here stays hidden while a status read before the answer still lists it. */
    withoutImportAnswers(items: LiveWaiting[]): LiveWaiting[] {
        for (const id of [...answered]) if (!items.some(w => w.id === id)) answered.delete(id);
        return answered.size === 0 ? items : items.filter(w => !answered.has(w.id));
    },

    /**
     * The detail of the question (the send's day, how many people and three of them stand in its row, not again):
     * what "Yes" would change (read when it opens), the marks' meaning with "What the marks mean", the answers, a refused answer's sentence.
     * A bridge that does not answer holds the answers (they say why); a device that may not answer says where.
     */
    appendImportAskDetail(this: UIClass, host: HTMLElement, w: LiveWaiting, s: LiveSession): void {
        if (!w.importAsk) return;
        const T = strings.live.importAsk;
        const L = strings.live;
        const key = itemKey(s, w.id);
        const box = el('div', 'research-overview__import-ask');
        // What would change: read once the item opens (not in the showcase, which writes nothing).
        const showcase = inShowcase();
        const down = s.ended || s.lostSince !== null;
        if (!showcase) {
            if (!previews.has(key) && !down) void this.loadImportAskPreview(s, w);
            box.appendChild(this.importAskPreviewEl(s, w, previews.get(key) ?? null));
        }
        const meaning = el('p', 'research-overview__import-meaning');
        meaning.append(el('span', undefined, T.meaning), ' ');
        const help = el('button', 'link-button research-overview__import-help', strings.reliability.help);
        help.type = 'button';
        help.onclick = (e) => {
            e.stopPropagation();
            void openHelp(HELP_TOPICS.reliability, help);
        };
        meaning.appendChild(help);
        box.appendChild(meaning);
        host.appendChild(box);
        if (!researchDeviceAllows('waiting-answer')) {
            host.appendChild(el('p', 'research-overview__muted research-offline__elsewhere', L.waitBranchElsewhere));
            return;
        }
        const actions = el('div', 'research-offline__wait-actions research-overview__import-actions');
        const busy = answering.get(w.id);
        const add = (label: string, what: ImportAskDo, primary: boolean): void => {
            const btn = el('button', `live-waiting-answer research-overview__waiting-action${primary ? ' is-primary' : ''}`, label);
            btn.type = 'button';
            btn.dataset.do = what;
            btn.dataset.action = `import-${what}`;
            btn.dataset.focusKey = `import-${what}:${w.id}`;
            if (showcase) markShowcaseOff(btn, 'none');
            else if (down) {
                btn.setAttribute('aria-disabled', 'true');
                btn.title = L.waitBranchDown;
            } else if (busy && busy !== what) btn.setAttribute('aria-disabled', 'true');
            else btn.onclick = () => this.answerImportAskFrom(btn, s, w, what);
            actions.appendChild(btn);
        };
        add(T.yes, 'import', true);
        add(T.no, 'own', false);
        host.appendChild(actions);
        if (down && !showcase) host.appendChild(el('p', 'research-overview__muted research-offline__held', L.waitBranchDown));
        const problem = problems.get(w.id);
        if (problem) host.appendChild(this.importAskProblemEl(problem.text, problem.tone, problem.retry));
    },

    /** The preview's part: being read, what changes and what stays, or why it was not read (Try again). */
    importAskPreviewEl(this: UIClass, s: LiveSession, w: LiveWaiting, state: PreviewState | null): HTMLElement {
        const T = strings.live.importAsk;
        const box = el('div', 'research-overview__import-preview');
        box.setAttribute('aria-live', 'polite');
        if (!state || state.phase === 'loading') {
            box.classList.add('is-loading');
            box.appendChild(el('p', 'research-overview__muted', T.previewLoading));
            return box;
        }
        if (state.phase === 'failed') {
            box.appendChild(this.importAskProblemEl(state.text, 'danger', state.retry ? () => {
                previews.delete(itemKey(s, w.id));
                void this.loadImportAskPreview(s, w);
            } : null));
            return box;
        }
        const p = state.preview;
        box.appendChild(el('p', 'research-overview__import-change',
            p.change.values > 0 ? T.change(p.change.values, p.change.persons) : T.changeNone));
        if (p.stay.values > 0) box.appendChild(el('p', 'research-overview__import-stay', T.stay(p.stay.values, importAskStayText(p.stay))));
        return box;
    },

    /** A refused read or answer: its sentence, Try again when it helps. */
    importAskProblemEl(text: string, tone: 'warn' | 'danger', retry: (() => void) | null): HTMLElement {
        const msg = el('div', `research-direction__problem is-${tone}`);
        msg.setAttribute('role', 'alert');
        msg.appendChild(el('span', undefined, text));
        if (retry) {
            const again = el('button', 'link-button research-direction__retry', strings.live.dirRetry);
            again.type = 'button';
            again.dataset.do = 'retry';
            again.onclick = (e) => {
                e.stopPropagation();
                retry();
            };
            msg.appendChild(again);
        }
        return msg;
    },

    /** Read the preview (its state drawn at once and when it ends); gone (404): the item goes, a toast says why. */
    async loadImportAskPreview(this: UIClass, s: LiveSession, w: LiveWaiting): Promise<void> {
        const key = itemKey(s, w.id);
        previews.set(key, { phase: 'loading' });
        const out = await this.readImportAskItem(s, w);
        if (previews.get(key)?.phase !== 'loading') return;
        if (out.ok) previews.set(key, { phase: 'ok', preview: out.value });
        else if (out.gone) {
            previews.delete(key);
            this.importAskGone(s, w);
            return;
        } else previews.set(key, { phase: 'failed', text: out.retry ? out.text : strings.live.importAsk.previewFailed, retry: out.retry });
        this.renderResearchOverview();
    },

    /** The preview through this page's bridge (the overview's own window asks the main window). */
    async readImportAskItem(this: UIClass, s: LiveSession, w: LiveWaiting): Promise<ImportAskOutcome<ImportAskPreview>> {
        if (s.ended) return { ok: false, gone: true };
        const r = await readImportAskPreview(s.bridge.base, w.id);
        if (s.ended) return { ok: false, gone: true };
        return r.ok ? { ok: true, value: r.preview } : importAskOutcomeOf(r, this.importAskTexts());
    },

    importAskTexts(): Parameters<typeof importAskOutcomeOf>[1] {
        const T = strings.live.importAsk;
        return { busy: T.busy, down: strings.live.waitBranchDown, notSaved: T.notSaved, notSavedSaid: T.notSavedSaid };
    },

    /** An answer from its button: the button works until the outcome (no time of its own: the bridge's 30 s end it). */
    answerImportAskFrom(this: UIClass, btn: HTMLElement, s: LiveSession, w: LiveWaiting, what: ImportAskDo): void {
        if (answering.has(w.id)) return;
        answering.set(w.id, what);
        problems.delete(w.id);
        void runBusy(btn, async () => {
            let out: ImportAskOutcome<ImportAskWritten>;
            try {
                out = await this.writeImportAskAnswer(s, w, what);
            } finally {
                answering.delete(w.id);
            }
            if (!out.ok && !out.gone) {
                problems.set(w.id, { text: out.text, tone: out.tone, retry: out.retry ? () => this.answerImportAskFrom(btn, s, w, what) : null });
            }
            this.renderResearchOverview();
            return out.ok;
        }, { label: strings.busy.saving, timeoutMs: Infinity });
    },

    /**
     * Write the answer through the bridge (one retry when the research is busy): done — the item goes, a toast
     * says what changed, and after "Yes" the research's tree is loaded again; 404 — answered elsewhere, the item
     * goes and a toast says so; else why not.
     */
    async writeImportAskAnswer(this: UIClass, s: LiveSession, w: LiveWaiting, what: ImportAskDo): Promise<ImportAskOutcome<ImportAskWritten>> {
        if (s.ended) return { ok: false, gone: true };
        const T = strings.live.importAsk;
        let r = await answerImportAsk(s.bridge.base, w.id, what);
        // Busy for a moment (503 with a short Retry-After): once more after it.
        const wait = !r.ok && r.code === 'busy' ? Math.max(1, r.retryAfter ?? 2) : null;
        if (wait !== null && wait <= 5) {
            await new Promise(res => setTimeout(res, wait * 1000));
            if (s.ended) return { ok: false, gone: true };
            r = await answerImportAsk(s.bridge.base, w.id, what);
        }
        if (s.ended) return { ok: false, gone: true };
        if (!r.ok) {
            const out = importAskOutcomeOf(r, this.importAskTexts());
            if (!out.ok && out.gone) this.importAskGone(s, w);
            return out;
        }
        this.settleImportAsk(s, w.id);
        const done = r.written;
        this.showToast(done.answer === 'import' ? T.doneImport(done.values ?? null, done.persons ?? null) : T.doneOwn, 8000, { kind: 'import-ask' });
        // "Yes" changed the research's tree (its facts ○○): its version loaded as after the research's other writes.
        if (done.answer === 'import') await this.importAskLoadTree(s, r.head);
        this.researchStatusAfterWrite(s);
        return { ok: true, value: done };
    },

    /** The research's tree after "Yes": a followed tree takes the new version at once, a tied one loads it as from its menu. */
    async importAskLoadTree(this: UIClass, s: LiveSession, head: string): Promise<void> {
        if (await this.liveLoadAfterWrite(head)) return;
        const ctx = this.researchSyncLink();
        if (ctx && ctx.link.id === s.researchId.toLowerCase()) await this.researchLoadNewer();
    },

    /** Answered elsewhere, or it no longer waits (404 `waiting.none`): the item goes, a toast says why. */
    importAskGone(this: UIClass, s: LiveSession, w: LiveWaiting): void {
        this.settleImportAsk(s, w.id);
        this.showToast(strings.live.importAsk.gone, 6000, { kind: 'import-ask' });
        this.researchStatusAfterWrite(s);
    },

    /** The item goes at once and stays hidden until a status leaves it out. */
    settleImportAsk(this: UIClass, s: LiveSession, id: string): void {
        answered.add(id);
        previews.delete(itemKey(s, id));
        problems.delete(id);
        s.waiting = s.waiting.filter(x => x.id !== id);
        if (s.waitingView.detail === id) s.waitingView.detail = null;
        if (liveSession() === s) this.renderLivePanel();
        this.renderResearchOverview();
    },
};

/** Forget every state (tests). */
export function resetWaitingImport(): void {
    previews.clear();
    answering.clear();
    problems.clear();
    answered.clear();
}

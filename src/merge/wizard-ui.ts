/**
 * The import and merge guide's frame (spec 134 §1): one window `#merge-modal`
 * with six steps, the row of counts, the step's body and the footer.
 *
 * The guide keeps no state in the DOM: where it stands and what was chosen
 * live in the merge state (`MergeState.wizard`: step, reached step,
 * comparison done, `WizardChoices`), saved with the merge. Every number comes
 * from `planCounts` of the plan built from that state.
 *
 * The merge's life (start, resume, Esc, saving for later, the write) is the
 * MergerUI facade's (`ui.ts`); it hands the guide a host. The phone's short
 * step list and one-line counts (§14) are both drawn and chosen by CSS.
 */

import type { MergeState, MergeWizardState } from './types.js';
import type { TreeId } from '../types.js';
import { buildPlan, planCounts, type MergePlan, type PlanCounts, type PlanMode, type PlanSource, type WizardChoices } from './plan.js';
import { stepInfo, nextStep, previousStep, WIZARD_STEPS, type StepInfo, type WizardStep } from './wizard-steps.js';
import { strings, countText } from '../strings.js';
import { announceText } from '../ui/live-announce.js';
import { escapeHtml, glyph, stepName, type GlyphKind, type Step1Env, type Step2Env, type StepContext, type TargetBlock } from './steps/context.js';
import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { getUI } from '../ui-ref.js';
import { renderStep1, parkGedcomSummary } from './steps/step1-what.js';
import { renderStep2 } from './steps/step2-who.js';
import { renderStep3 } from './steps/step3-whom.js';
import { renderStep4 } from './steps/step4-rules.js';
import { renderStep5 } from './steps/step5-plan.js';
import { renderStep6 } from './steps/step6-done.js';

export type { WizardStep } from './wizard-steps.js';

/** What the facade does for the guide. */
export interface WizardHost {
    /** The merge state (null once the merge closed). */
    state(): MergeState | null;
    /** A choice or a decision changed: unsaved, saved automatically. */
    changed(): void;
    /** The step changed: the place is saved with the merge (nothing decided). */
    moved(): void;
    saveForLater(): void;
    /** Leave the comparison (Only compare): nothing is written. */
    finishCompare(): void;
    /** Write the plan (step 5); resolves when the write ended either way. */
    write(plan: MergePlan): Promise<void>;
    /** What step 2 does beyond the choices. */
    step2?(): Step2Env;
    /**
     * Step 1's Compare: the people of the import matched with the chosen
     * target (the merge state replaced). False when it did not run.
     */
    compare(): Promise<boolean>;
    /** Step 1's Download JSON (a GEDCOM file): the converted data saved, the guide closed, nothing written. */
    downloadJson(): void;
    /** What step 1 reads and does beyond the choices. */
    step1?(): Step1Env;
}

/** Where the guide's import comes from and where it goes, for fresh choices. */
export interface WizardSource {
    source: PlanSource;
    mode?: PlanMode;
    targetTreeId: TreeId | null;
    targetName: string;
    research?: boolean;
}

function newPlanId(): string {
    return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The choices a guide starts with: Add to a tree (or the given mode), scope a), my tree applies. */
export function freshChoices(src: WizardSource, state: MergeState): WizardChoices {
    return {
        mode: src.mode ?? 'add',
        targetTreeId: src.targetTreeId,
        scope: 'a',
        swapped: false,
        source: src.source,
        targetName: src.targetName,
        ...(src.research ? { targetResearch: true } : {}),
        ...(state.target ? { targetFingerprint: state.target.fingerprint } : {}),
        planId: newPlanId(),
        createdAt: new Date().toISOString(),
    };
}

/** The window's title by where the import comes from (§1). */
export function wizardTitle(choices: Pick<WizardChoices, 'mode' | 'source'>): string {
    const W = strings.mergeWizard;
    if (choices.mode === 'compare') return W.titleCompare;
    if (choices.source.kind === 'share') return W.titleShare;
    if (choices.source.kind === 'tree' || choices.source.kind === 'view') return W.titleTrees;
    return W.titleImport;
}

/** The counts said in words ("Joined 40, New 129, Not added 0, To decide 18"). */
export function countsWords(c: PlanCounts): string {
    const W = strings.mergeWizard;
    return [`${W.cntJoined} ${countText(c.joined)}`, `${W.cntNew} ${countText(c.added)}`,
        `${W.cntSkipped} ${countText(c.skipped)}`, `${W.cntPending} ${countText(c.pending)}`].join(', ');
}

/**
 * Why the tree cannot be the import's target (§2), null when it can: locked
 * in Manage trees, from a newer app version, followed live from the research,
 * or open read-only. A blocked tree stays in step 1's list, said why.
 */
export function targetBlock(treeId: TreeId): TargetBlock | null {
    const meta = TreeManager.getTreeMetadata(treeId);
    if (!meta) return 'readOnly';
    if (meta.isLocked) return 'locked';
    if (TreeManager.isTreeNewer(treeId)) return 'newer';
    const open = !DataManager.isViewMode() && DataManager.getCurrentTreeId() === treeId;
    if (open) {
        let live = false;
        try { live = getUI().isLiveFollowOn(); } catch { /* no UI (unit tests) */ }
        if (live) return 'live';
        if (DataManager.isReadOnly()) return 'readOnly';
    }
    return null;
}

/** The block said in words, for the tree's line and its tooltip. */
export function targetBlockText(block: TargetBlock, treeId: TreeId): string {
    const W = strings.mergeWizard;
    const meta = TreeManager.getTreeMetadata(treeId);
    const name = meta?.name ?? '';
    switch (block) {
        case 'locked': return W.blockLocked(name);
        case 'newer': return W.blockNewer(name, meta?.dataVersion ?? 0);
        case 'live': return W.blockLive;
        case 'readOnly': return W.blockReadOnly;
    }
}

export class MergeWizard {
    private plan: MergePlan | null = null;
    private busy = false;

    constructor(private readonly host: WizardHost) {}

    private get ws(): MergeWizardState | undefined {
        return this.host.state()?.wizard;
    }

    /** The step the guide stands on. */
    get step(): WizardStep {
        return this.ws?.step ?? 1;
    }

    /** The plan of the current choices (null before the comparison). */
    get currentPlan(): MergePlan | null {
        return this.plan;
    }

    /**
     * Open the guide over the facade's merge state: fresh choices from
     * `src`, or the saved place (`state.wizard`) of a resumed merge. A merge
     * saved before the guide existed opens at step 2 (its comparison ran).
     */
    open(src: WizardSource, opts: { compared?: boolean } = {}): void {
        const state = this.host.state();
        if (!state) return;
        if (!state.wizard) {
            const compared = !!opts.compared;
            state.wizard = { step: compared ? 2 : 1, reached: compared ? 2 : 1, compared, choices: freshChoices(src, state) };
        }
        this.busy = false;
        this.rebuild();
        this.render(true);
    }

    /** The guide's window closed: no more redraws. */
    close(): void {
        this.plan = null;
        this.busy = false;
    }

    /** The plan again from the choices and the decisions. */
    rebuild(): void {
        const state = this.host.state();
        const ws = state?.wizard;
        this.plan = state && ws && (ws.compared || ws.choices.mode === 'new') ? buildPlan(state, ws.choices) : null;
    }

    /** Each step's state on this way. */
    info(): Record<WizardStep, StepInfo> {
        const ws = this.ws;
        if (!ws) return stepInfo({ mode: 'add', scope: 'a' }, null);
        return stepInfo(ws.choices, this.plan);
    }

    /**
     * A decision or a choice changed: the plan, the step list, the counts and
     * the footer again. The step's body is drawn again only with `body`
     * (step 2's list updates itself in place and keeps its scroll).
     */
    refresh(opts: { body?: boolean } = {}): void {
        this.rebuild();
        if (typeof document === 'undefined' || !this.ws) return;
        this.renderHeader();
        this.renderSteps();
        this.renderCounts();
        if (opts.body) this.renderBody();
        this.renderFooter();
    }

    /** Merge a change of the choices in (the steps' `update`), the step drawn again. */
    update(change?: Partial<WizardChoices>): void {
        const ws = this.ws;
        if (!ws) return;
        if (change) ws.choices = { ...ws.choices, ...change };
        this.host.changed();
        this.refresh({ body: true });
    }

    /** Go to a step that can be entered (skipped and locked ones cannot). */
    go(step: WizardStep): void {
        const ws = this.ws;
        if (!ws || this.busy) return;
        if (this.info()[step].state !== 'ok') return;
        ws.step = step;
        if (step > ws.reached) ws.reached = step;
        this.host.moved();
        this.render(true);
    }

    /** The primary button: compare (step 1), go on (2–4), write or finish (5). */
    async next(): Promise<void> {
        const ws = this.ws;
        if (!ws || this.busy) return;
        const step = ws.step;
        if (step === 1) {
            const c = ws.choices;
            // An import with nobody in it: only Close (13a).
            if (c.source.persons === 0) {
                this.host.finishCompare();
                return;
            }
            if (c.json) {
                this.host.downloadJson();
                return;
            }
            if (!this.primary().enabled) return;
            if (!ws.compared && c.mode !== 'new') {
                this.busy = true;
                this.renderFooter();
                let ok = false;
                try {
                    ok = await this.host.compare();
                } finally {
                    this.busy = false;
                }
                // The merge state was replaced by the comparison's.
                const now = this.ws;
                if (!now) return;
                if (!ok) {
                    this.renderFooter();
                    return;
                }
                now.compared = true;
                this.rebuild();
                this.host.changed();
            }
        }
        if (step === 5) {
            if (ws.choices.mode === 'compare') {
                this.host.finishCompare();
                return;
            }
            const plan = this.plan;
            if (!plan || this.info()[5].state !== 'ok') return;
            this.busy = true;
            this.renderFooter();
            try {
                await this.host.write(plan);
            } finally {
                this.busy = false;
                if (this.host.state()) this.renderFooter();
            }
            return;
        }
        const to = nextStep(step, this.availability());
        if (to) this.go(to);
    }

    back(): void {
        const ws = this.ws;
        if (!ws) return;
        const to = previousStep(ws.step, this.availability());
        if (to) this.go(to);
    }

    private availability(): Record<WizardStep, StepInfo['state']> {
        const info = this.info();
        const out = {} as Record<WizardStep, StepInfo['state']>;
        for (const s of WIZARD_STEPS) out[s] = info[s].state;
        return out;
    }

    // ==================== RENDER ====================

    /** Draw the whole frame; `focus`: a new step (its heading focused and announced). */
    render(focus: boolean): void {
        const ws = this.ws;
        if (!ws || typeof document === 'undefined' || !document.getElementById('merge-modal')) return;
        this.renderHeader();
        this.renderSteps();
        this.renderCounts();
        this.renderBody();
        this.renderFooter();
        const validation = document.getElementById('merge-validation-banner');
        if (validation) validation.hidden = ws.step !== 1;
        if (focus) {
            document.getElementById('merge-step-body')?.querySelector<HTMLElement>('.merge-step-title')?.focus({ preventScroll: true });
            const counts = this.plan ? countsWords(planCounts(this.plan)) : '';
            announceText(strings.mergeWizard.announceStep(ws.step, stepName(ws.step), counts));
        }
    }

    renderHeader(): void {
        const ws = this.ws;
        if (!ws) return;
        const title = document.getElementById('merge-title');
        if (title) title.textContent = wizardTitle(ws.choices);
        const route = document.getElementById('merge-route');
        if (route) {
            const c = ws.choices;
            const text = c.mode === 'new' ? c.source.label : `${c.source.label} → ${c.targetName}`;
            route.textContent = text;
            route.title = text;
        }
    }

    /** The second line of a step in the step list. */
    private stepSub(step: WizardStep, info: StepInfo): { text: string; warn?: boolean } {
        const W = strings.mergeWizard;
        const ws = this.ws!;
        if (info.state === 'skip') {
            switch (info.reason) {
                case 'newTree': return { text: W.subNewTree };
                case 'scopeA': return { text: W.subSkippedScope };
                case 'allNew': return { text: W.subAllNew };
                case 'mineRule': return { text: W.subMineRule };
                default: return { text: '' };
            }
        }
        if (step === 1) {
            if (ws.choices.json) return { text: W.modeJson };
            const mode = ws.choices.mode === 'new' ? W.modeNew : ws.choices.mode === 'compare' ? W.modeCompare : W.modeAdd;
            return { text: ws.choices.mode === 'new' ? mode : `${mode} · ${ws.choices.scope})` };
        }
        if (step === 2 && this.plan) {
            const pending = planCounts(this.plan).pending;
            if (pending > 0) return { text: W.subPending(pending), warn: true };
        }
        return { text: '' };
    }

    renderSteps(): void {
        const ws = this.ws;
        const nav = document.getElementById('merge-progress');
        if (!ws || !nav) return;
        const W = strings.mergeWizard;
        nav.setAttribute('aria-label', W.stepsNav);
        const info = this.info();
        const items: string[] = [];
        const bars: string[] = [];
        for (const s of WIZARD_STEPS) {
            const name = `${s} ${stepName(s)}`;
            const sub = this.stepSub(s, info[s]);
            const subHtml = `<span class="merge-step-sub${sub.warn ? ' is-warn' : ''}">${sub.text ? escapeHtml(sub.text) : '&nbsp;'}</span>`;
            const current = s === ws.step;
            const done = !current && info[s].state === 'ok' && s <= ws.reached;
            const skipped = info[s].state === 'skip';
            const label = `<span class="merge-step-name">${done ? `<span class="merge-step-ok" aria-hidden="true">${glyph('joined', 11)}</span>` : ''}`
                + `<span class="sel-l" data-label="${escapeHtml(name)}">${escapeHtml(name)}</span></span>`;
            if (done) {
                items.push(`<button type="button" class="merge-step sel-tab is-done" data-sel-dir="down" data-step="${s}">${label}${subHtml}</button>`);
            } else {
                const cls = current ? ' active' : skipped ? ' is-skipped' : ' is-future';
                items.push(`<span class="merge-step sel-tab${cls}" data-sel-dir="down" data-step="${s}"${current ? ' aria-current="step"' : ''}>${label}${subHtml}</span>`);
            }
            bars.push(`<span class="merge-bar${current ? ' is-current' : done ? ' is-done' : ''}"></span>`);
        }
        const open = nav.classList.contains('is-open');
        nav.innerHTML = `<button type="button" class="merge-progress-short" aria-expanded="${open}">`
            + `<span class="merge-progress-short-text">${escapeHtml(W.stepShort(ws.step, stepName(ws.step)))}</span>`
            + `<span class="merge-bars" aria-hidden="true">${bars.join('')}</span></button>`
            + `<div class="merge-step-list">${items.join('')}</div>`;
        nav.querySelector<HTMLButtonElement>('.merge-progress-short')?.addEventListener('click', () => {
            const isOpen = nav.classList.toggle('is-open');
            nav.querySelector('.merge-progress-short')?.setAttribute('aria-expanded', String(isOpen));
        });
        nav.querySelectorAll<HTMLButtonElement>('button.merge-step').forEach(b => b.addEventListener('click', () => {
            nav.classList.remove('is-open');
            this.go(Number(b.dataset.step) as WizardStep);
        }));
    }

    renderCounts(): void {
        const ws = this.ws;
        const box = document.getElementById('merge-counts');
        if (!ws || !box) return;
        const W = strings.mergeWizard;
        const c = ws.choices;
        const state = this.host.state()!;
        if (!this.plan) {
            const treePersons = Object.values(state.existingData.persons).filter(p => !p.isPlaceholder).length;
            const parts = [W.cntImport(c.source.persons)];
            if (c.mode !== 'new') parts.push(W.cntTree(c.targetName, treePersons), W.cntAfterCompare);
            box.className = 'merge-stats is-pre';
            box.innerHTML = `<span class="merge-stats-pre">${escapeHtml(parts.join(' · '))}</span>`
                + `<span class="merge-stats-note">${escapeHtml(W.nothingYet)}</span>`;
            return;
        }
        const n = planCounts(this.plan);
        const note = ws.step === 5 && c.mode !== 'compare' ? W.writeOnlyHere : W.nothingYet;
        const chip = (kind: GlyphKind, cls: string, label: string, v: number): string =>
            `<div class="merge-stat ${cls}" data-count="${kind}"><span class="merge-stat-label"><span class="merge-stat-glyph">${glyph(kind)}</span>${escapeHtml(label)}</span>`
            + `<span class="merge-stat-value">${countText(v)}</span></div>`;
        const line = [`${W.cntJoined} ${countText(n.joined)}`, `${W.cntNew} ${countText(n.added)}`,
            `${W.cntSkipped} ${countText(n.skipped)}`, `${W.cntPending} ${countText(n.pending)}`, `= ${countText(n.total)}`].join(' · ');
        box.className = 'merge-stats';
        box.innerHTML = chip('joined', 'highlight', W.cntJoined, n.joined)
            + chip('added', 'new', W.cntNew, n.added)
            + chip('skipped', 'skipped', W.cntSkipped, n.skipped)
            + chip('pending', n.pending > 0 ? 'warning' : 'is-zero', W.cntPending, n.pending)
            + `<div class="merge-stat-sum"><span class="merge-stat-total">${escapeHtml(W.cntTotal(n.total))}</span><span class="merge-stats-note">${escapeHtml(note)}</span></div>`
            + `<div class="merge-stats--line"><span>${escapeHtml(line)}</span><span class="merge-stats-note">${escapeHtml(note)}</span></div>`;
    }

    private context(): StepContext {
        const ws = this.ws!;
        return {
            step: ws.step,
            state: this.host.state()!,
            choices: ws.choices,
            plan: this.plan,
            counts: this.plan ? planCounts(this.plan) : null,
            compared: ws.compared,
            update: change => this.update(change),
            ...(this.host.step2 ? { step2: this.host.step2() } : {}),
            ...(this.host.step1 ? { step1: this.host.step1() } : {}),
        };
    }

    renderBody(): void {
        const ws = this.ws;
        const body = document.getElementById('merge-step-body');
        if (!ws || !body) return;
        body.dataset.step = String(ws.step);
        // Today's GEDCOM summary goes home before any body is drawn: step 1 takes it again.
        parkGedcomSummary();
        const ctx = this.context();
        switch (ws.step) {
            case 1: renderStep1(body, ctx); break;
            case 2: renderStep2(body, ctx); break;
            case 3: renderStep3(body, ctx); break;
            case 4: renderStep4(body, ctx); break;
            case 5: renderStep5(body, ctx); break;
            case 6: renderStep6(body, ctx); break;
        }
    }

    /** The primary button's words and whether it can be pressed (with the reason when not). */
    primary(): { label: string; enabled: boolean; why: string } {
        const W = strings.mergeWizard;
        const ws = this.ws;
        if (!ws) return { label: '', enabled: false, why: '' };
        const c = ws.choices;
        const info = this.info();
        const pending = this.plan ? planCounts(this.plan).pending : 0;
        const why = pending > 0 ? W.nextWhyPairs(pending) : '';
        if (ws.step === 5) {
            const n = this.plan ? planCounts(this.plan) : null;
            if (c.mode === 'compare') return { label: W.done, enabled: true, why: '' };
            const label = !n ? '' : c.mode === 'new' ? W.btnNewTree(n.added) : W.btnWrite(n.added, n.fieldChanges);
            const ok = info[5].state === 'ok' && !this.busy;
            return { label, enabled: ok, why: ok ? '' : why };
        }
        if (ws.step === 1) {
            if (c.source.persons === 0) return { label: strings.buttons.close, enabled: true, why: '' };
            if (c.json) return { label: W.btnJson, enabled: !this.busy, why: '' };
            if (c.mode !== 'new') {
                const env = this.host.step1?.();
                // No target that can take it (all blocked): New tree is the way (§2).
                if (!c.targetTreeId) return { label: W.btnCompare(c.source.persons, c.targetName), enabled: false, why: W.pickOther };
                // An encrypted tree is compared once it is unlocked (13f).
                if (env?.encLocked()) return { label: W.btnCompare(c.source.persons, c.targetName), enabled: false, why: W.encLocked(c.targetName) };
                if (!ws.compared) return { label: W.btnCompare(c.source.persons, c.targetName), enabled: !this.busy, why: '' };
            }
        }
        const to = nextStep(ws.step, this.availability());
        if (!to) return { label: W.done, enabled: false, why: '' };
        const ok = info[to].state === 'ok' && !this.busy;
        const label = ws.step === 1 && c.mode === 'new' && to === 3 ? W.btnNewNext(c.source.persons) : W.btnNext(stepName(to));
        return { label, enabled: ok, why: ok ? '' : why };
    }

    renderFooter(): void {
        const ws = this.ws;
        if (!ws) return;
        const W = strings.mergeWizard;
        const next = document.getElementById('merge-next') as HTMLButtonElement | null;
        const why = document.getElementById('merge-next-why');
        const back = document.getElementById('merge-back') as HTMLButtonElement | null;
        const later = document.getElementById('merge-save-later') as HTMLButtonElement | null;
        const p = this.primary();
        if (next) {
            next.textContent = p.label;
            next.disabled = !p.enabled;
        }
        if (why) {
            why.textContent = p.why;
            why.hidden = !p.why;
        }
        if (back) {
            back.textContent = W.back;
            back.hidden = !previousStep(ws.step, this.availability());
            back.disabled = this.busy;
        }
        // Step 1 before the comparison has nothing to save: Cancel stands
        // where Save for later stands later on (ZADANI_DEV §2).
        const nothingYet = ws.step === 1 && !ws.compared;
        const cancel = document.getElementById('merge-cancel') as HTMLButtonElement | null;
        // An empty import has only Close (13a).
        if (cancel) cancel.hidden = !nothingYet || ws.choices.source.persons === 0;
        if (later) {
            later.textContent = strings.merge.closeSave;
            later.hidden = nothingYet;
            later.disabled = this.busy;
        }
    }
}

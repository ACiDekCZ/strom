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
import { escapeHtml, glyph, stepName, type GlyphKind, type Step1Env, type Step2Env, type Step6Env, type StepContext, type TargetBlock, type WriteAction, type WriteStatus } from './steps/context.js';
import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { getUI } from '../ui-ref.js';
import { renderStep1, parkGedcomSummary } from './steps/step1-what.js';
import { isCopyOfTarget, renderStep2 } from './steps/step2-who.js';
import { barHtml, setBarShare } from '../ui/prog-bar.js';
import { busySpinHtml } from '../ui/busy.js';
import { renderStep3, variantSub } from './steps/step3-whom.js';
import { renderStep4 } from './steps/step4-rules.js';
import { renderStep5, showWriteStatus } from './steps/step5-plan.js';
import { renderStep6, writtenWhen } from './steps/step6-done.js';

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
    /**
     * Write the plan (step 5); resolves when the write ended either way, its
     * state said through `setWriteStatus`. `retention` answers 8e.
     */
    write(plan: MergePlan, opts?: { retention?: 'keep-both' | 'drop-oldest' }): Promise<void>;
    /** 8d: Backups… of the target, the guide waiting under it. */
    openBackups?(): void;
    /** 8d: Save the tree to a file… (the target as JSON). */
    saveTargetFile?(): void;
    /** What step 2 does beyond the choices. */
    step2?(): Step2Env;
    /**
     * Step 1's Compare: the people of the import matched with the chosen
     * target (the merge state replaced), in parts with its progress. False
     * when it did not run or was stopped (the state as it was).
     */
    compare(run?: CompareRun): Promise<boolean>;
    /** Step 1's Download JSON (a GEDCOM file): the converted data saved, the guide closed, nothing written. */
    downloadJson(): void;
    /** What step 1 reads and does beyond the choices. */
    step1?(): Step1Env;
    /** Step 5's Save the list… (K6.4): the plan as .txt and .json. */
    savePlan?(plan: MergePlan): void;
    /** Step 6 (§9): the written merge and its actions; null before a write. */
    step6?(): Step6Env | null;
    /** Step 6's Done (Esc, ×): the guide closes after the write. */
    finishDone?(): void;
}

/** A running comparison (K3.5): its progress in work units, and the signal that stops it. */
export interface CompareRun {
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
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

/** Why the guide cannot go on yet: the pairs left to decide, else the unlinked groups left to decide (§6); '' when nothing is. */
export function pendingWhy(plan: MergePlan): string {
    const W = strings.mergeWizard;
    const pairs = plan.items.filter(i => i.kind === 'person-pending').length;
    if (pairs > 0) return W.nextWhyPairs(pairs);
    const open = (plan.groups ?? []).filter(g => g.decision === null);
    return open.length ? W.groupsWhy(open.length, open.reduce((n, g) => n + g.persons.length, 0)) : '';
}

/** Where the import goes, "{source} → {target}" (the source alone for a new tree): the header's line, the toast of Save for later. */
export function wizardRoute(choices: Pick<WizardChoices, 'mode' | 'source' | 'targetName'> & { targetTreeId?: WizardChoices['targetTreeId'] }): string {
    // New tree, or no tree that can take the import (every tree blocked): the file alone.
    if (choices.mode === 'new' || 'targetTreeId' in choices && !choices.targetTreeId) return choices.source.label;
    return `${choices.source.label} → ${choices.targetName}`;
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
        // Only following that applies to this tree blocks it: ◎ is a device
        // preference and stays on when a copy or an unlinked tree is opened.
        try { live = getUI().isLiveFollowActive(); } catch { /* no UI (unit tests) */ }
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
    /** Where the write of step 5 stands (§8 8a–8f), null when no state is said. */
    private writeStatus: WriteStatus | null = null;
    /** The comparison running from step 1 (K3.5): shown as step 2's progress, stopped by Stop or Back. */
    private comparing: { ctrl: AbortController; started: number; share: number; treePersons: number } | null = null;

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
        this.writeStatus = null;
        this.stopCompare();
    }

    /** Stop the running comparison: back on step 1 with its choices (nothing lost, K3.5). */
    stopCompare(): void {
        this.comparing?.ctrl.abort();
    }

    /** The comparison of step 1 runs (its progress stands in step 2's place). */
    get isComparing(): boolean {
        return !!this.comparing;
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
        // A choice changed: a state of an earlier write no longer says the truth.
        if (!this.busy) this.writeStatus = null;
        this.host.changed();
        this.refresh({ body: true });
    }

    /** Go to a step that can be entered (skipped and locked ones cannot). */
    go(step: WizardStep): void {
        const ws = this.ws;
        // Written: the steps before cannot be opened any more (§9).
        if (!ws || this.busy || this.written) return;
        const at = this.info()[step];
        // A step 4 skipped by the scope still opens to say why (7e).
        if (at.state !== 'ok' && !(at.reason === 'scope' && this.plan)) return;
        ws.step = step;
        if (step > ws.reached) ws.reached = step;
        this.writeStatus = null;
        // From step 3 on the unlinked groups are asked about (§6): one left
        // undecided holds the guide up. Step 2 still counts them as added.
        if (step === 3 && !ws.choices.groups) {
            ws.choices = { ...ws.choices, groups: {} };
            this.rebuild();
        }
        this.host.moved();
        this.render(true);
    }

    /** The primary button: compare (step 1), go on (2–4), write or finish (5). */
    async next(): Promise<void> {
        const ws = this.ws;
        if (!ws || this.busy) return;
        const step = ws.step;
        if (this.written) {
            this.host.finishDone?.();
            return;
        }
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
                const state = this.host.state()!;
                const ctrl = new AbortController();
                this.busy = true;
                this.comparing = {
                    ctrl, started: Date.now(), share: 0,
                    treePersons: Object.values(state.existingData.persons).filter(p => !p.isPlaceholder).length,
                };
                this.render(true);
                let ok = false;
                try {
                    ok = await this.host.compare({ signal: ctrl.signal, onProgress: (done, total) => this.compareProgress(done, total) });
                } finally {
                    this.busy = false;
                    this.comparing = null;
                }
                // The merge state was replaced by the comparison's.
                const now = this.ws;
                if (!now) return;
                if (!ok) {
                    // Stopped (or the target could not be read): step 1 again, its choices kept.
                    this.render(true);
                    return;
                }
                now.compared = true;
                this.rebuild();
                this.host.changed();
            }
        }
        if (step >= 2 && step <= 5 && this.isCopy()) {
            this.host.finishCompare();
            return;
        }
        if (step === 5) {
            if (ws.choices.mode === 'compare') {
                // Only compare: the button saves the list, then the guide closes (nothing written).
                if (this.plan) this.host.savePlan?.(this.plan);
                this.host.finishCompare();
                return;
            }
            await this.writeNow();
            return;
        }
        const to = nextStep(step, this.availability());
        if (to) this.go(to);
    }

    /** The plan is written: the guide stands on step 6 (§9), nothing before it opens again. */
    get written(): boolean {
        const ws = this.ws;
        return !!ws && !!ws.choices.writtenAt && ws.step === 6;
    }

    /**
     * The write landed: step 6 (§9), the steps before locked. Nothing is
     * saved for later any more. `plan`: the plan as written, for the step
     * opened again (What happened).
     */
    showDone(plan?: MergePlan): void {
        const ws = this.ws;
        if (!ws) return;
        if (plan) this.plan = plan;
        this.busy = false;
        ws.step = 6;
        ws.reached = 6;
        this.writeStatus = null;
        this.render(true);
    }

    /** Step 5's write (§8): the button off while it runs, its state above the list. */
    private async writeNow(retention?: 'keep-both' | 'drop-oldest'): Promise<void> {
        const plan = this.plan;
        if (!plan || this.busy || this.info()[5].state !== 'ok') return;
        this.busy = true;
        this.writeStatus = null;
        this.renderFooter();
        try {
            await this.host.write(plan, retention ? { retention } : {});
        } finally {
            this.busy = false;
            if (this.host.state()) this.renderFooter();
        }
    }

    /** Where the write stands (8a–8f): said above step 5's list, the footer again. */
    setWriteStatus(status: WriteStatus | null): void {
        this.writeStatus = status;
        if (typeof document === 'undefined' || this.ws?.step !== 5) return;
        showWriteStatus(status, this.context());
    }

    /** A button of a write's state (§8 8b, 8d, 8e). */
    private writeAction(action: WriteAction): void {
        switch (action) {
            case 'whom': this.go(3); break;
            case 'backups': this.host.openBackups?.(); break;
            case 'save-tree': this.host.saveTargetFile?.(); break;
            case 'retry': void this.writeNow(); break;
            case 'keep-both': case 'drop-oldest': void this.writeNow(action); break;
        }
    }

    private isCopy(): boolean {
        const ws = this.ws;
        return !!ws && !!this.plan && ws.compared && isCopyOfTarget({ choices: ws.choices, counts: planCounts(this.plan) });
    }

    back(): void {
        const ws = this.ws;
        if (!ws || this.written) return;
        if (this.comparing) {
            this.stopCompare();
            return;
        }
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
            // A new step starts at its top (on a phone the step scrolls as a whole and kept the last step's scroll).
            for (let el = document.getElementById('merge-step-body'); el && el.id !== 'merge-modal'; el = el.parentElement) el.scrollTop = 0;
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
            const text = wizardRoute(ws.choices);
            route.textContent = text;
            route.title = text;
        }
    }

    /** The second line of a step in the step list. */
    private stepSub(step: WizardStep, info: StepInfo): { text: string; warn?: boolean } {
        const W = strings.mergeWizard;
        const ws = this.ws!;
        if (ws.choices.writtenAt && ws.step === 6 && (step === 5 || step === 6)) return { text: step === 5 ? W.subWritten : W.subDone };
        if (info.state === 'skip') {
            switch (info.reason) {
                case 'newTree': return { text: W.subNewTree };
                case 'scope': return { text: W.subSkippedScope(ws.choices.scope) };
                case 'allNew': return { text: W.subAllNew };
                default: return { text: '' };
            }
        }
        if (step === 1) {
            if (ws.choices.json) return { text: W.modeJson };
            const mode = ws.choices.mode === 'new' ? W.modeNew : ws.choices.mode === 'compare' ? W.modeCompare : W.subAdd;
            return { text: ws.choices.mode === 'new' ? mode : `${mode} · ${ws.choices.scope})` };
        }
        if (step === 2 && this.plan) {
            const pending = planCounts(this.plan).pending;
            if (pending > 0) return { text: W.subPending(pending), warn: true };
        }
        if (step === 3 && info.state === 'ok') return { text: variantSub(this.host.state() ?? null, ws.choices) };
        if (step === 4 && this.plan) {
            const rel = this.plan.items.filter(i => i.kind === 'relation').length;
            if (rel > 0) return { text: W.subRelConf(rel), warn: true };
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
        // While the comparison runs, step 2 stands as the current one ("comparing…", 4a).
        const at: WizardStep = this.comparing ? 2 : ws.step;
        for (const s of WIZARD_STEPS) {
            const name = `${s} ${stepName(s)}`;
            const sub = this.comparing && s === 2 ? { text: W.comparingSub } : this.stepSub(s, info[s]);
            const subHtml = `<span class="merge-step-sub${sub.warn ? ' is-warn' : ''}${sub.text ? '' : ' is-empty'}">${sub.text ? escapeHtml(sub.text) : '&nbsp;'}</span>`;
            const current = s === at;
            const done = !current && (s === 1 && !!this.comparing || info[s].state === 'ok' && s <= ws.reached);
            const skipped = info[s].state === 'skip';
            // The number and the name apart: a narrow window keeps only the number of the other steps (4j).
            const label = `<span class="merge-step-name">${done ? `<span class="merge-step-ok" aria-hidden="true">${glyph('joined', 11)}</span>` : ''}`
                + `<span class="sel-l" data-label="${escapeHtml(name)}"><span class="merge-step-no">${s}</span><span class="merge-step-nm"> ${escapeHtml(stepName(s))}</span></span></span>`;
            // The whole name and second line as a tooltip: a narrow window cuts them (§13).
            const title = escapeHtml(sub.text ? `${name} · ${sub.text}` : name);
            // A step 4 skipped by the scope opens to say why (7e).
            const opens = skipped && !current && info[s].reason === 'scope' && !!this.plan && !this.comparing;
            if ((done || opens) && !this.written) {
                const cls = done ? 'is-done' : 'is-skipped';
                items.push(`<button type="button" class="merge-step sel-tab ${cls}" data-sel-dir="down" data-step="${s}" title="${title}">${label}${subHtml}</button>`);
            } else {
                const cls = current ? ' active' : done ? ' is-done' : skipped ? ' is-skipped' : ' is-future';
                items.push(`<span class="merge-step sel-tab${cls}" data-sel-dir="down" data-step="${s}" title="${title}"${current ? ' aria-current="step"' : ''}>${label}${subHtml}</span>`);
            }
            bars.push(`<span class="merge-bar${current ? ' is-current' : done ? ' is-done' : ''}"></span>`);
        }
        const open = nav.classList.contains('is-open');
        nav.innerHTML = `<button type="button" class="merge-progress-short" aria-expanded="${open}">`
            + `<span class="merge-progress-short-text">${escapeHtml(W.stepShort(at, stepName(at)))}</span>`
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
        const chip = (kind: GlyphKind, cls: string, label: string, v: number | null): string =>
            `<div class="merge-stat ${cls}" data-count="${kind}"><span class="merge-stat-label"><span class="merge-stat-glyph">${glyph(kind)}</span>${escapeHtml(label)}</span>`
            + `<span class="merge-stat-value">${v === null ? '–' : countText(v)}</span></div>`;
        // The sum after the counts in the bar of a wider window ("= 187", 4j); the phone's line says it in words.
        const sum = (v: number): string => `<div class="merge-stat-sum"><span class="merge-stat-total">= <b>${countText(v)}</b></span></div>`;
        if (!this.plan) {
            const treePersons = Object.values(state.existingData.persons).filter(p => !p.isPlaceholder).length;
            const parts = [W.cntImport(c.source.persons)];
            if (c.mode !== 'new' && c.targetTreeId) parts.push(W.cntTree(c.targetName, treePersons), W.cntAfterCompare);
            box.className = 'merge-stats is-pre';
            // Before the comparison the bar's counts are "–" (4j); the phone keeps its sentence.
            box.innerHTML = chip('joined', 'highlight', W.cntJoined, null) + chip('added', 'new', W.cntNew, null)
                + chip('skipped', 'skipped', W.cntSkipped, null) + chip('pending', 'is-zero', W.cntPending, null) + sum(c.source.persons)
                + `<span class="merge-stats-pre">${escapeHtml(parts.join(' · '))}</span>`
                + `<span class="merge-stats-note">${escapeHtml(W.nothingYet)}</span>`;
            this.renderFootNote(W.nothingYet);
            return;
        }
        const n = planCounts(this.plan);
        const note = this.written ? W.writtenAt(writtenWhen(c.writtenAt!))
            : ws.step === 5 && c.mode !== 'compare' ? W.writeOnlyHere : W.nothingYet;
        const line = [`${W.cntJoined} ${countText(n.joined)}`, `${W.cntNew} ${countText(n.added)}`,
            `${W.cntSkipped} ${countText(n.skipped)}`, `${W.cntPending} ${countText(n.pending)}`, `= ${countText(n.total)}`].join(' · ');
        box.className = 'merge-stats';
        box.innerHTML = chip('joined', 'highlight', W.cntJoined, n.joined)
            + chip('added', 'new', W.cntNew, n.added)
            + chip('skipped', 'skipped', W.cntSkipped, n.skipped)
            + chip('pending', n.pending > 0 ? 'warning' : 'is-zero', W.cntPending, n.pending)
            + sum(n.total)
            + `<div class="merge-stats--line"><span>${escapeHtml(line)}</span><span class="merge-stats-note">${escapeHtml(note)}</span></div>`;
        this.renderFootNote(note);
    }

    /** "Nothing has been written yet." left in the footer of a wider window (4f); the phone says it under its counts. */
    private renderFootNote(text: string): void {
        const el = document.getElementById('merge-foot-note');
        if (el) el.textContent = text;
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
            step5: {
                savePlan: () => { if (this.plan) this.host.savePlan?.(this.plan); },
                status: this.writeStatus,
                act: action => this.writeAction(action),
            },
            ...(this.written && this.host.step6?.() ? { step6: this.host.step6()! } : {}),
        };
    }

    renderBody(): void {
        const ws = this.ws;
        const body = document.getElementById('merge-step-body');
        if (!ws || !body) return;
        // Today's GEDCOM summary goes home before any body is drawn: step 1 takes it again.
        parkGedcomSummary();
        if (this.comparing) {
            body.dataset.step = 'compare';
            this.renderComparing(body);
            return;
        }
        body.dataset.step = String(ws.step);
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

    /**
     * The comparison runs (4a, K3.5): "Comparing people…", the bar, "a of n
     * people of the tree t · about eta left", the note and Stop. Updated in
     * place by `compareProgress`.
     */
    private renderComparing(body: HTMLElement): void {
        const W = strings.mergeWizard;
        body.innerHTML = `<h3 class="merge-step-title" tabindex="-1" data-step-title="2">${escapeHtml(stepName(2))}</h3>`
            + `<div class="merge-comparing" aria-busy="true">`
            + `<div class="merge-comparing-head">${busySpinHtml(16)}<span class="merge-comparing-t">${escapeHtml(W.comparing)}</span></div>`
            + barHtml(0, { cls: 'merge-comparing-bar', attrs: `role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="${escapeHtml(W.comparing)}"` })
            + `<p class="merge-comparing-of" aria-live="polite"></p>`
            + `<p class="merge-comparing-note">${escapeHtml(W.comparingNote)}</p>`
            + `<button type="button" class="secondary merge-compare-stop" id="merge-compare-stop">${escapeHtml(W.stop)}</button>`
            + '</div>';
        body.querySelector<HTMLButtonElement>('#merge-compare-stop')?.addEventListener('click', () => this.stopCompare());
        this.compareProgress(0, 0);
    }

    /** A part of the comparison done: the bar, the count and the time left. */
    private compareProgress(done: number, total: number): void {
        const run = this.comparing;
        if (!run || typeof document === 'undefined') return;
        const W = strings.mergeWizard;
        if (total > 0) run.share = Math.min(1, done / total);
        const bar = document.querySelector<HTMLElement>('#merge-step-body .merge-comparing-bar');
        if (bar) {
            setBarShare(bar, run.share);
            bar.setAttribute('aria-valuenow', String(Math.round(run.share * 100)));
        }
        const line = document.querySelector<HTMLElement>('#merge-step-body .merge-comparing-of');
        if (!line) return;
        const ws = this.ws;
        const elapsed = Date.now() - run.started;
        // The time left once a part of the work shows its pace.
        const left = run.share >= 0.02 && elapsed >= 300 ? Math.max(1, Math.round(elapsed * (1 - run.share) / run.share / 1000)) : null;
        const a = Math.round(run.share * run.treePersons);
        line.textContent = left === null
            ? W.comparingOfNoEta(a, run.treePersons, ws?.choices.targetName ?? '')
            : W.comparingOf(a, run.treePersons, ws?.choices.targetName ?? '', W.etaShort(left));
    }

    /** The primary button's words and whether it can be pressed (with the reason when not). */
    primary(): { label: string; enabled: boolean; why: string } {
        const W = strings.mergeWizard;
        const ws = this.ws;
        if (!ws) return { label: '', enabled: false, why: '' };
        const c = ws.choices;
        const info = this.info();
        const why = this.plan ? pendingWhy(this.plan) : '';
        // Written (§9): Done closes the guide.
        if (this.written) return { label: W.done, enabled: true, why: '' };
        // While comparing: the way on is step 2's, not yet (4a).
        if (this.comparing) return { label: W.btnNext(stepName(nextStep(2, this.availability()) ?? 5)), enabled: false, why: '' };
        // A copy of the tree (13b): nothing to write, only Close.
        if (this.isCopy() && ws.step >= 2 && ws.step <= 5) return { label: strings.buttons.close, enabled: true, why: '' };
        if (ws.step === 5) {
            const n = this.plan ? planCounts(this.plan) : null;
            if (c.mode === 'compare') return { label: W.savePlan, enabled: true, why: '' };
            // Into a new tree (K6.3): a copy of the target with the import.
            const label = !n ? '' : c.mode === 'new' ? W.btnNewTree(n.added)
                : (c.into ?? 'tree') === 'new' ? W.btnNewTree((this.plan?.target.persons ?? 0) + n.added)
                : W.btnWrite(n.added, n.fieldChanges, n.fieldFills);
            const ok = info[5].state === 'ok' && !this.busy;
            return { label, enabled: ok, why: ok ? '' : why };
        }
        if (ws.step === 1) {
            if (c.source.persons === 0) return { label: strings.buttons.close, enabled: true, why: '' };
            if (c.json) return { label: W.btnJson, enabled: !this.busy, why: '' };
            if (c.mode !== 'new') {
                const env = this.host.step1?.();
                // No target that can take it (all blocked): New tree is the way (§2).
                if (!c.targetTreeId) return { label: W.btnCompareAny(c.source.persons), enabled: false, why: W.pickOther };
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
            // While comparing, Back stops the comparison (step 1 again). Written: no way back (§9).
            back.hidden = this.written || !this.comparing && !previousStep(ws.step, this.availability());
            back.disabled = this.busy && !this.comparing;
        }
        // Step 1 before the comparison has nothing to save: Cancel stands
        // where Save for later stands later on (ZADANI_DEV §2).
        const nothingYet = ws.step === 1 && !ws.compared && !this.comparing;
        const cancel = document.getElementById('merge-cancel') as HTMLButtonElement | null;
        // An empty import has only Close (13a).
        if (cancel) cancel.hidden = !nothingYet || ws.choices.source.persons === 0;
        if (later) {
            // Written (§9): the link saves the list of what happened (Save the list…), nothing waits for later.
            later.textContent = this.written ? W.savePlan : strings.merge.closeSave;
            later.hidden = nothingYet;
            later.disabled = this.busy;
        }
    }
}

/**
 * Change structure… (spec 139 §1–§2): one dialog in place of the six rows of
 * the old "Change structure ⌄" group. Its first screen lists the options in
 * three groups (New tree · Split · Join), each saying which tree changes; an
 * option runs today's operation or leads to a step of its own.
 *
 * The dialog is one modal (#structure-modal in index.html) of one height for
 * every screen, so the footer never jumps. A screen is a `StructureStep`: its
 * title, the line under it and a `render` that fills the body and the footer.
 * `structureGo(step)` shows a step after the current one, the header's
 * "‹ Change structure" and Escape go one screen back (`structureBack`), the
 * first screen's Escape or × closes the dialog and returns to the dialog it
 * was opened from (the tree manager). Steps of later parts (who, summary, the
 * file) are added the same way.
 *
 * Which option can run is decided by src/structure-options.ts (no DOM).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings } from '../strings.js';
import { PersonId, TreeId } from '../types.js';
import { structureDirSvg } from '../icons.js';
import {
    structureOptions, STRUCTURE_GROUPS,
    type StructureContext, type StructureOption, type StructureOptionKey, type StructureReason,
} from '../structure-options.js';
import { uiModule } from './module.js';
import { SPLIT_SHOWN_AT_ONCE } from './split-ui.js';
import { MODAL_BACK_CHEVRON } from './modal-back.js';
import { componentsKey, componentsOf } from './components-cache.js';
import type { TreeActionSource } from './tree-actions.js';

export const STRUCTURE_MODAL_ID = 'structure-modal';
const MODAL_ID = STRUCTURE_MODAL_ID;

export interface StructureDialogOptions {
    /** Where the dialog is opened from (Actions, More, the tree manager). */
    source?: TreeActionSource;
    /** The dialog it returns to on close (the tree manager). */
    parent?: string;
    /** Open on this step over the options (the copy's summary: Duplicate). */
    step?: 'copy';
}

/** What a step draws into: the dialog's body and footer, both emptied for it. */
export interface StructureView {
    treeId: TreeId;
    body: HTMLElement;
    footer: HTMLElement;
    /** Aborted when the step is left or the dialog closes (a count in the background stops). */
    signal: AbortSignal;
}

/** One screen of the dialog. */
export interface StructureStep {
    /** Stable key (tests, `data-step` on the modal): 'options', 'join-what', 'file', 'who', 'summary'. */
    key: string;
    title: string;
    /** The line under the title ("{tree} · step 2 of 3: who to take"). */
    sub?: string;
    /** The label of the header's back button, the screen it returns to (default: "Change structure"). */
    back?: string;
    /**
     * The dialog kind of this screen (the app's dialog rules): 'info' when its
     * footer only closes (Close), 'form' while something is being chosen or
     * typed (the backdrop leaves it alone), 'choice' otherwise (Cancel).
     */
    kind?: 'info' | 'choice' | 'form';
    /** A way back inside the step (a phone's second screen): true when it went back itself. */
    goBack?: () => boolean;
    render(view: StructureView): void | Promise<void>;
}

interface StructureState {
    treeId: TreeId;
    source?: TreeActionSource;
    parent?: string;
    /** The screens shown, the first one the options. */
    steps: StructureStep[];
    /** Of the screen shown. */
    abort: AbortController;
}

let state: StructureState | null = null;

/** The tree the dialog is open for and the dialog it returns to (null: closed). For the steps of other files. */
export function structureOpenFor(): { treeId: TreeId; parent?: string } | null {
    return state ? { treeId: state.treeId, parent: state.parent } : null;
}

/**
 * Whether a tree is one connected family, per tree and its last change: the
 * count runs once (the split dialog right after it finds the same parts).
 */
const connectedCache = new Map<string, boolean>();

function connectedKey(treeId: TreeId): string {
    return `${treeId}:${TreeManager.getTreeMetadata(treeId)?.lastModifiedAt ?? ''}`;
}

/** The known answer for the tree as it is now, or null. */
export function structureConnectedKnown(treeId: TreeId): boolean | null {
    return connectedCache.get(connectedKey(treeId)) ?? null;
}

const REASON_TEXT: Record<StructureReason, () => string> = {
    notOpen: () => strings.structure.whyNotOpen,
    connected: () => strings.structure.whyConnected,
    noOther: () => strings.structure.whyNoOther,
    followed: () => strings.structure.whyFollowed,
};

function optionText(key: StructureOptionKey): { title: string; desc: string } {
    const t = strings.structure;
    switch (key) {
        case 'select': return { title: t.optSelect, desc: t.optSelectDesc };
        case 'copy': return { title: t.optCopy, desc: t.optCopyDesc };
        case 'families': return { title: t.optFamilies, desc: t.optFamiliesDesc };
        case 'parts': return { title: strings.split.menu, desc: t.optPartsDesc };
        case 'into': return { title: t.optInto, desc: t.optIntoDesc };
        case 'file': return { title: t.optFile, desc: t.optFileDesc };
    }
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** A footer button. */
export function footerButton(label: string, kind: 'primary' | 'secondary', onClick: () => void, dismiss = false): HTMLButtonElement {
    const btn = el('button', kind, label);
    btn.type = 'button';
    if (dismiss) btn.setAttribute('data-dismiss', '');
    btn.addEventListener('click', onClick);
    return btn;
}

/**
 * The footer's Cancel of a step that leads on (Back · Cancel · primary, as in
 * the merge guide): it closes the whole dialog, Back and ‹ go a step back.
 */
export function structureCancelButton(close: () => void): HTMLButtonElement {
    return footerButton(strings.buttons.cancel, 'secondary', close, true);
}

/**
 * An option row as a `.menu-option`: the direction, the title and what
 * changes, "›" when it leads on. Exported for the steps that list options
 * the same way (the file step).
 */
export function structureOptionButton(opts: {
    action: string; dir: Parameters<typeof structureDirSvg>[0]; title: string; desc: string; next?: boolean; disabled?: boolean;
}): HTMLButtonElement {
    const btn = el('button', 'menu-option');
    btn.type = 'button';
    btn.dataset.action = opts.action;
    btn.insertAdjacentHTML('afterbegin', structureDirSvg(opts.dir));
    const text = el('span', 'option-text');
    text.append(el('span', 'option-title', opts.title), el('span', 'option-desc', opts.desc));
    btn.appendChild(text);
    if (opts.next !== false) {
        const next = el('span', 'structure-next', '›');
        next.setAttribute('aria-hidden', 'true');
        btn.appendChild(next);
    }
    if (opts.disabled) btn.setAttribute('aria-disabled', 'true');
    return btn;
}

/**
 * ↑ ↓ Home End move between the active rows of a list (greyed ones are
 * skipped, yet stay in the Tab order for screen readers).
 */
function arrowKeys(host: HTMLElement, selector: string): void {
    host.addEventListener('keydown', (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const items = [...host.querySelectorAll<HTMLElement>(selector)].filter(b => b.getAttribute('aria-disabled') !== 'true');
        if (items.length === 0) return;
        e.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'Home' ? 0
            : e.key === 'End' ? items.length - 1
                : e.key === 'ArrowDown' ? (at < 0 ? 0 : Math.min(items.length - 1, at + 1))
                    : (at < 0 ? items.length - 1 : Math.max(0, at - 1));
        items[next].focus();
    });
}

export const structureMethods = uiModule({
    /**
     * Change structure: {tree} — its options, over the dialog it is opened
     * from (`parent`, the tree manager), which comes back on close.
     */
    async showStructureDialog(treeId: TreeId, opts: StructureDialogOptions = {}): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId);
        const modal = document.getElementById(MODAL_ID);
        if (!tree || !modal) return;
        state?.abort.abort();
        state = { treeId, source: opts.source, parent: opts.parent, steps: [], abort: new AbortController() };
        const mine = state;
        // A small tree says at once whether it has parts to separate; a large one is counted once the dialog shows.
        const large = tree.personCount >= SPLIT_SHOWN_AT_ONCE;
        if (!large) await this.structureCountConnected(treeId);
        if (state !== mine) return;

        this.clearDialogStack();
        if (opts.parent) {
            this.pushDialog(opts.parent);
            this.closeDialogById(opts.parent);
        }
        this.pushDialog(MODAL_ID);
        modal.classList.add('active');
        this.structureGo(this.structureOptionsStep());
        if (opts.step === 'copy') this.structureGo(this.structureCopyStep());
        if (large && structureConnectedKnown(treeId) === null) {
            // The count after the first paint; the options drawn again with its answer (if still shown).
            setTimeout(() => {
                void this.structureCountConnected(treeId).then(() => {
                    if (state === mine && state.steps.length === 1) this.structureRender();
                });
            }, 0);
        }
    },

    /** Count whether the tree is one connected family (cached per tree and change). */
    async structureCountConnected(treeId: TreeId): Promise<void> {
        const key = connectedKey(treeId);
        if (connectedCache.has(key)) return;
        const data = treeId === DataManager.getCurrentTreeId() ? DataManager.getData() : await TreeManager.getTreeData(treeId);
        if (!data) return;
        // The parts kept for the split dialog that may follow (§5.3).
        connectedCache.set(key, componentsOf(componentsKey(treeId), data).length <= 1);
    },

    /** What decides the options of the tree now (§2.4). */
    structureContext(treeId: TreeId): StructureContext {
        const tree = TreeManager.getTreeMetadata(treeId);
        const isActive = treeId === TreeManager.getActiveTreeId();
        const liveFollowing = isActive && DataManager.isLiveFollowing();
        return {
            isActive,
            readOnly: !tree || tree.isLocked === true || (isActive && DataManager.isReadOnly())
                || TreeManager.isTreeNewer(treeId),
            liveFollowing,
            otherTrees: TreeManager.getTrees().some(t => t.id !== treeId),
            connected: structureConnectedKnown(treeId),
        };
    },

    /** Show a screen after the one shown (the first call: the options). */
    structureGo(step: StructureStep): void {
        if (!state) return;
        state.steps.push(step);
        this.structureRender();
    },

    /** One screen back; from the options the dialog closes. */
    structureBack(): void {
        if (!state) return;
        if (state.steps[state.steps.length - 1]?.goBack?.()) return;
        if (state.steps.length <= 1) {
            this.closeStructureDialog();
            return;
        }
        state.steps.pop();
        this.structureRender();
    },

    /** Escape: one screen back, from the options back to the dialog it was opened from. */
    structureEscape(): void {
        this.structureBack();
    },

    /** Draw the current screen into the dialog. */
    structureRender(): void {
        const modal = document.getElementById(MODAL_ID);
        const step = state?.steps[state.steps.length - 1];
        if (!state || !modal || !step) return;
        state.abort.abort();
        state.abort = new AbortController();
        modal.dataset.step = step.key;
        modal.querySelector(':scope > .modal')?.setAttribute('data-dialog-kind', step.kind ?? 'choice');
        const title = document.getElementById('structure-title');
        const sub = document.getElementById('structure-sub');
        const back = document.getElementById('structure-back') as HTMLButtonElement | null;
        const body = document.getElementById('structure-body');
        const footer = document.getElementById('structure-footer');
        if (!title || !sub || !back || !body || !footer) return;
        title.textContent = step.title;
        sub.textContent = step.sub ?? '';
        sub.hidden = !step.sub;
        const first = state.steps.length <= 1;
        back.hidden = first;
        if (!first) {
            const label = step.back ?? strings.treeActions.structure;
            back.innerHTML = MODAL_BACK_CHEVRON;
            back.appendChild(el('span', undefined, label));
            back.setAttribute('aria-label', `${strings.structure.back}: ${label}`);
            back.onclick = () => this.structureBack();
        }
        body.replaceChildren();
        footer.replaceChildren();
        body.scrollTop = 0;
        void step.render({ treeId: state.treeId, body, footer, signal: state.abort.signal });
    },

    /**
     * Close the dialog. `back`: the dialog it was opened from comes back (the
     * tree manager); false when an operation takes over (the merge guide).
     */
    closeStructureDialog(back = true): void {
        const was = state;
        state = null;
        was?.abort.abort();
        document.getElementById(MODAL_ID)?.classList.remove('active');
        this.dialogStack = this.dialogStack.filter(d => d !== MODAL_ID);
        if (back && was?.parent) {
            this.clearDialogStack();
            this.openDialogById(was.parent);
        }
    },

    /** The dialog is open (on any screen). */
    isStructureDialogOpen(): boolean {
        return !!state && !!document.getElementById(MODAL_ID)?.classList.contains('active');
    },

    // ---- The options (§2) ----

    structureOptionsStep(): StructureStep {
        const treeId = state!.treeId;
        const name = TreeManager.getTreeMetadata(treeId)?.name ?? '';
        return {
            key: 'options',
            kind: 'info',
            title: strings.structure.title(name),
            render: (view) => this.renderStructureOptions(view),
        };
    },

    renderStructureOptions(view: StructureView): void {
        const { treeId, body, footer } = view;
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree) return;
        const ctx = this.structureContext(treeId);
        const options = structureOptions(ctx);
        body.appendChild(el('p', 'structure-intro', strings.structure.intro));
        const groups = el('div', 'menu-options menu-options-grouped structure-options');
        for (const groupKey of STRUCTURE_GROUPS) {
            const group = el('div', 'menu-group');
            group.setAttribute('role', 'group');
            const titleId = `structure-group-${groupKey}`;
            group.setAttribute('aria-labelledby', titleId);
            const heading = el('div', 'menu-group-title', strings.structure.group[groupKey]);
            heading.id = titleId;
            group.appendChild(heading);
            for (const option of options.filter(o => o.group === groupKey)) group.appendChild(this.structureOptionRow(option));
            groups.appendChild(group);
        }
        arrowKeys(groups, '.menu-option');
        body.appendChild(groups);

        // A tree that is not open: the way to open it on the left (the options needing it then come alive).
        if (!ctx.isActive) {
            const open = el('button', 'link-button', strings.structure.openTree(tree.name));
            open.type = 'button';
            open.dataset.action = 'openTree';
            open.addEventListener('click', () => void this.structureOpenTree());
            footer.appendChild(open);
        }
        footer.appendChild(footerButton(strings.buttons.close, 'secondary', () => this.closeStructureDialog(), true));

        const firstActive = groups.querySelector<HTMLElement>('.menu-option:not([aria-disabled="true"])');
        firstActive?.focus({ preventScroll: true });
    },

    /** One option: its row, and under it why it is greyed out (with the way out). */
    structureOptionRow(option: StructureOption): HTMLElement {
        const text = optionText(option.key);
        const btn = structureOptionButton({ action: option.key, dir: option.dir, title: text.title, desc: text.desc, disabled: !option.enabled });
        if (option.enabled) {
            btn.addEventListener('click', () => void this.structureRunOption(option.key));
            return btn;
        }
        const row = el('div', 'structure-row');
        const why = el('p', 'structure-why', REASON_TEXT[option.reason!]());
        why.id = `structure-why-${option.key}`;
        btn.setAttribute('aria-describedby', why.id);
        if (option.reasonAction === 'stopFollowing') {
            why.append(' · ');
            const stop = el('button', 'link-button', strings.research.stop);
            stop.type = 'button';
            stop.dataset.action = 'stopFollowing';
            stop.addEventListener('click', () => {
                this.stopLiveFollow();
                this.structureRender();
            });
            why.appendChild(stop);
        }
        row.append(btn, why);
        return row;
    },

    /** "Open the tree {name}": the tree opened, then the dialog shown again for it. */
    async structureOpenTree(): Promise<void> {
        if (!state) return;
        const { treeId, source, parent } = state;
        this.closeStructureDialog(false);
        if (parent === 'tree-manager-modal') this.closeTreeManagerDialog();
        const result = await this.switchToTree(treeId);
        if (result === 'switched' && TreeManager.getActiveTreeId() === treeId) {
            await this.showStructureDialog(treeId, { source });
        }
    },

    /** An option chosen: today's operation, or its next step. */
    async structureRunOption(key: StructureOptionKey): Promise<void> {
        if (!state) return;
        const { treeId, parent } = state;
        const isActive = treeId === TreeManager.getActiveTreeId();
        switch (key) {
            // A new tree from a selection: who to take (§3), then its summary (§4).
            case 'select':
                this.structureGo(this.structureWhoStep({ mode: 'new' }));
                return;
            // A copy of the whole tree: its summary with the name (§4).
            case 'copy':
                this.structureGo(this.structureCopyStep());
                return;
            case 'families':
                if (isActive) await this.showSplitFamiliesDialog(MODAL_ID);
                else await this.showSplitFamiliesPickerDialog(treeId, MODAL_ID);
                return;
            case 'parts':
                await this.showSplitDialog(treeId, MODAL_ID);
                return;
            case 'into':
                this.structureGo(this.structureJoinWhatStep());
                return;
            case 'file':
                this.structureGo(this.structureFileStep());
                return;
        }
    },

    /**
     * The dialog makes way for an operation that does not come back to it
     * (a naming dialog, the merge guide); opened from the tree manager, the
     * manager is closed with it.
     */
    structureLeaveFor(parent: string | undefined): void {
        this.closeStructureDialog(false);
        if (parent === 'tree-manager-modal') this.closeTreeManagerDialog();
    },

    // ---- Join › what to join (§6.1) ----

    structureJoinWhatStep(): StructureStep {
        const treeId = state!.treeId;
        const name = TreeManager.getTreeMetadata(treeId)?.name ?? '';
        return {
            key: 'join-what',
            title: strings.structure.joinTitle,
            sub: `${name} · ${strings.structure.joinWhatStep}`,
            render: (view) => this.renderStructureJoinWhat(view),
        };
    },

    renderStructureJoinWhat(view: StructureView): void {
        const { treeId, body, footer } = view;
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree) return;
        const t = strings.structure;
        const isActive = treeId === TreeManager.getActiveTreeId();
        body.appendChild(el('p', 'structure-intro', t.joinWhatIntro));
        const group = el('div', 'structure-choice');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', t.joinWhatIntro);
        let chosen: 'whole' | 'selection' = 'whole';
        const choices: HTMLButtonElement[] = [];
        const choice = (value: 'whole' | 'selection', title: string, desc: string, why?: string): HTMLButtonElement => {
            const btn = el('button', 'sel-opt');
            btn.type = 'button';
            btn.setAttribute('role', 'radio');
            btn.dataset.join = value;
            const dot = el('span', 'structure-dot');
            dot.setAttribute('aria-hidden', 'true');
            const text = el('span', 'option-text');
            text.append(el('span', 'option-title', title), el('span', 'option-desc', why ? `${desc} ${why}` : desc));
            btn.append(dot, text);
            if (why) btn.setAttribute('aria-disabled', 'true');
            btn.addEventListener('click', () => {
                if (btn.getAttribute('aria-disabled') === 'true') return;
                chosen = value;
                sync();
            });
            choices.push(btn);
            return btn;
        };
        const sync = (): void => {
            for (const btn of choices) {
                const on = btn.dataset.join === chosen;
                btn.setAttribute('aria-checked', String(on));
                btn.tabIndex = on ? 0 : -1;
            }
        };
        group.append(
            choice('whole', t.joinWhole(tree.name), t.joinWholeDesc(strings.treeManager.persons(tree.personCount))),
            choice('selection', t.joinSelection, t.joinSelectionDesc, isActive ? undefined : t.whyNotOpen),
        );
        // ↑ ↓ choose, as a radio group does.
        group.addEventListener('keydown', (e) => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            const live = choices.filter(b => b.getAttribute('aria-disabled') !== 'true');
            const at = live.findIndex(b => b.dataset.join === chosen);
            const to = live[(at + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : live.length - 1)) % live.length];
            if (!to) return;
            e.preventDefault();
            chosen = to.dataset.join as 'whole' | 'selection';
            sync();
            to.focus();
        });
        sync();
        body.appendChild(group);
        body.appendChild(el('p', 'structure-note', t.joinNote));

        // §6.1: Back · Continue to the guide.
        footer.append(footerButton(t.back, 'secondary', () => this.structureBack()), structureCancelButton(() => this.closeStructureDialog()));
        const go = footerButton(t.continueGuide, 'primary', () => void this.structureJoin(chosen));
        go.dataset.action = 'continue';
        footer.appendChild(go);
        choices[0].focus({ preventScroll: true });
    },

    /**
     * Into another tree through the merge guide: the whole tree (today's
     * "Merge into another tree…"), or a selection — who to take (§3, the
     * step in its 'join' mode), then the guide with it as the import.
     * The dialog stays when no tree can take it (the guide's check says why).
     */
    async structureJoin(what: 'whole' | 'selection'): Promise<void> {
        if (!state) return;
        const { treeId, parent } = state;
        if (what === 'selection') {
            this.structureGo(this.structureWhoStep({ mode: 'join', onDone: (r) => void this.structureJoinSelection(r.ids, r.what) }));
            return;
        }
        const mine = state;
        await this.showMergeTreesDialog(treeId, parent);
        if (state !== mine) return;
        if (document.getElementById('merge-modal')?.classList.contains('active')) {
            // The guide returns to the tree manager itself when it came from there.
            this.closeStructureDialog(false);
        }
    },

    /** A selection of the open tree into another tree: the guide's import is "{tree} — {what}" (§6.1). */
    async structureJoinSelection(ids: ReadonlySet<PersonId>, what: string): Promise<void> {
        if (!state) return;
        const { treeId, parent } = state;
        const mine = state;
        const name = TreeManager.getTreeMetadata(treeId)?.name ?? '';
        await this.mergeSubsetInto(treeId, ids, name ? `${name} — ${what}` : what);
        if (state !== mine) return;
        if (document.getElementById('merge-modal')?.classList.contains('active')) this.structureLeaveFor(parent);
    },

    // ---- Join › add from a file to this tree (§6.2) ----

    structureFileStep(): StructureStep {
        const treeId = state!.treeId;
        const name = TreeManager.getTreeMetadata(treeId)?.name ?? '';
        return {
            key: 'file',
            title: strings.structure.fileTitle,
            sub: name,
            render: (view) => this.renderStructureFile(view),
        };
    },

    /** The kinds of file: a GEDCOM or a Strom file, either one through the merge guide into this tree (K1.4, K3.1). */
    renderStructureFile(view: StructureView): void {
        const { treeId, body, footer } = view;
        const name = TreeManager.getTreeMetadata(treeId)?.name ?? '';
        const t = strings.structure;
        const list = el('div', 'menu-options structure-options');
        const ged = structureOptionButton({ action: 'gedcom', dir: 'file', title: t.fileGed, desc: t.fileGedDesc, next: false });
        ged.addEventListener('click', () => {
            const parent = state?.parent;
            // The file read opens the import guide, the open tree its target.
            this.structureLeaveFor(parent);
            this.startGedcomImportPlain();
        });
        const json = structureOptionButton({ action: 'json', dir: 'file', title: t.fileJson, desc: t.fileJsonDesc, next: false });
        json.addEventListener('click', () => {
            const parent = state?.parent;
            this.structureLeaveFor(parent);
            this.startJsonImportIntoTree(treeId);
        });
        list.append(ged, json);
        arrowKeys(list, '.menu-option');
        body.appendChild(list);
        body.appendChild(el('p', 'structure-note', t.fileNote(name)));
        footer.appendChild(footerButton(strings.buttons.cancel, 'secondary', () => this.structureBack(), true));
        ged.focus({ preventScroll: true });
    },
});

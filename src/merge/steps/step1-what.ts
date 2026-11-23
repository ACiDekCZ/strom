/**
 * Step 1 – What to do (spec 134 §3). Left: what the import holds (for a
 * GEDCOM file today's summary of the conversion, moved here with its ids and
 * its logic: tiles, encoding, images, external media), and the line of what
 * the tree does not take over. Right: the mode (New tree · Add to a tree ·
 * Only compare · Save as JSON), the target tree, the scope a)–d) said on one
 * person, and for two trees From → to with Swap.
 *
 * The step keeps no state: every choice goes to the guide (`update`) or to
 * the facade (`step1`), which draws the step again.
 */

import { strings } from '../../strings.js';
import type { PlanScope, WizardChoices } from '../plan.js';
import { notTakenLine } from '../wizard-text.js';
import type { Step1Env, StepContext, TargetRow } from './context.js';
import { escapeHtml, stepHeading } from './context.js';
import type { TreeId } from '../../types.js';

/** Puts today's GEDCOM summary back where it lives while step 1 does not show it (the result dialog of "Insert into tree"). */
export function parkGedcomSummary(): void {
    if (typeof document === 'undefined') return;
    const node = document.getElementById('gedcom-summary');
    const home = document.getElementById('gedcom-summary-home');
    if (!node || !home) return;
    node.querySelector('.merge-not-taken')?.remove();
    if (node.parentElement !== home) home.appendChild(node);
}

type StepMode = WizardChoices['mode'] | 'json';

function modeOf(c: WizardChoices): StepMode {
    return c.json ? 'json' : c.mode;
}

function treeLine(row: TargetRow): string {
    return strings.mergeWizard.treeLine(row.persons, row.open, row.research, row.backup);
}

const LOCK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

function tilesHtml(tiles: Array<[string, number]>): string {
    return `<div class="gedcom-stats merge-s1-tiles">${tiles.filter(([, n], i) => i === 0 || n > 0).map(([label, n]) =>
        `<div class="stat-item"><div class="number">${n.toLocaleString()}</div><div class="label">${escapeHtml(label)}</div></div>`).join('')}</div>`;
}

/** The left column: what the import is. */
function sourceHtml(ctx: StepContext, env: Step1Env | undefined, gedcom: boolean): string {
    const W = strings.mergeWizard;
    const c = ctx.choices;
    const tree = env?.sourceTree() ?? null;
    const meta = tree ? treeLine(tree) : env?.sourceMeta() ?? '';
    const summary = [c.source.label, W.treeLine(c.source.persons, false, false, null)].join(' · ');
    return `<section class="merge-s1-src" aria-label="${escapeHtml(W.whatInFile)}">
            <button type="button" class="merge-s1-sumline" aria-expanded="false" title="${escapeHtml(summary)}"><span class="merge-s1-sumtext">${escapeHtml(summary)}</span><span class="merge-s1-chev" aria-hidden="true">▾</span></button>
            <div class="merge-s1-srcbody">
                <h4 class="merge-s1-h">${escapeHtml(W.whatInFile)}</h4>
                <div class="merge-s1-file"><b class="merge-s1-name" title="${escapeHtml(c.source.label)}">${escapeHtml(c.source.label)}</b>${meta ? `<span class="merge-s1-meta">${escapeHtml(meta)}</span>` : ''}</div>
                ${gedcom ? '<div class="merge-s1-summary"></div>' : tilesHtml(env?.sourceTiles() ?? [[strings.gedcom.persons, c.source.persons]])}
            </div>
        </section>`;
}

/** The line "The tree will not take over: …" with Show all and Save list… (§3, K1.6). */
function notTakenHtml(env: Step1Env | undefined): string {
    const line = notTakenLine({ droppedTags: env?.notTaken() ?? [] });
    if (!line) return '';
    const W = strings.mergeWizard;
    return `<div class="merge-not-taken"><p class="merge-not-taken-line">${escapeHtml(line)}</p>`
        + `<div class="merge-not-taken-links"><button type="button" class="link-button" data-s1="not-taken-all">${escapeHtml(W.showAll)}</button>`
        + `<button type="button" class="link-button" data-s1="not-taken-save">${escapeHtml(W.saveList)}</button></div></div>`;
}

function targetsHtml(ctx: StepContext, env: Step1Env): string {
    const W = strings.mergeWizard;
    const rows = env.targets();
    const chosen = ctx.choices.targetTreeId;
    const items = rows.map(r => {
        const on = r.treeId === chosen && !r.block;
        const line = r.block ? [W.treeLine(r.persons, r.open, false, null), r.why].join(' · ') : treeLine(r);
        return `<label class="sel-opt merge-s1-target${r.block ? ' is-blocked' : ''}" data-sel-form="tile" data-tree="${escapeHtml(r.treeId)}"${r.block ? ` aria-disabled="true" data-block="${r.block}"` : ''} title="${escapeHtml(r.block ? r.why : r.name)}">`
            + `<input type="radio" name="merge-target" value="${escapeHtml(r.treeId)}"${on ? ' checked' : ''}${r.block ? ' disabled' : ''}>`
            + `<span class="merge-s1-tname">${escapeHtml(r.name)}</span>${r.block ? `<span class="merge-s1-lock">${LOCK}</span>` : ''}`
            + `<span class="merge-s1-tline">${escapeHtml(line)}</span></label>`;
    }).join('');
    const target = rows.find(r => r.treeId === chosen && !r.block);
    const research = researchHtml(env, target ?? null);
    const locked = target && env.encLocked()
        ? `<p class="merge-s1-warn" id="merge-s1-enc"><span>${escapeHtml(W.encLocked(target.name))}</span> <button type="button" class="link-button" data-s1="unlock">${escapeHtml(strings.storageSafety.unlock)}</button></p>` : '';
    // A tree followed live from the research (2f): why, and End following, after which it takes the import.
    const liveRow = rows.find(r => r.block === 'live');
    const live = liveRow
        ? `<p class="merge-s1-warn" id="merge-s1-live"><strong>${escapeHtml(W.blockLiveTitle(liveRow.name))}</strong> <span>${escapeHtml(W.blockLive)}</span> <button type="button" class="link-button" data-s1="end-follow">${escapeHtml(W.blockLiveAction)}</button></p>` : '';
    return `<h4 class="merge-s1-h" id="merge-s1-targets-h">${escapeHtml(W.whichTree)}</h4>
        <div class="merge-s1-targets" role="radiogroup" aria-labelledby="merge-s1-targets-h">${items}</div>${live}${research}${locked}`;
}

const SWAP_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h12l-3-3"/><path d="M17 17H5l3 3"/></svg>';

/**
 * What step 1 says of the research (§11, 11f–11h, K9.5, K9.6) – nothing at
 * all when no tree of the merge is linked to one. Into a tree (`target`):
 * the target's research stays (researchKept); a linked source and a target
 * without one: the link does not carry over, with Swap (11g); both linked:
 * the source's link and numbers do not carry over (11h). A new tree
 * (`target` null): it will not be linked (11f). Either way another linked
 * tree with the import's people is named (K9.5).
 */
export function researchHtml(env: Step1Env, target: TargetRow | null): string {
    const W = strings.mergeWizard;
    const source = env.sourceTree();
    const note = (text: string, id: string): string => `<p class="merge-s1-note" id="${id}">${escapeHtml(text)}</p>`;
    let html = '';
    if (target) {
        if (target.research) html += note(W.researchKept(target.name), 'merge-s1-res-kept');
        if (source?.research && target.research) html += note(W.resTwo, 'merge-s1-res-two');
        if (source?.research && !target.research) {
            const swap = env.swapBlocked() ? ''
                : `<button type="button" class="secondary merge-s1-res-swap" data-s1="swap">${SWAP_ICON} ${escapeHtml(W.resSwapBtn(target.name, source.name))}</button>`;
            html += `<div class="merge-s1-res" id="merge-s1-res-swap"><p class="merge-s1-note">${escapeHtml(W.resSwap(source.name, target.name))}</p>${swap}</div>`;
        }
    } else if (source?.research) {
        html += note(W.resNewTree(source.name), 'merge-s1-res-new');
    }
    const same = env.samePeople();
    if (same) html += note(W.resSamePeople(same), 'merge-s1-res-same');
    return html;
}

function scopeHtml(ctx: StepContext, env: Step1Env | undefined): string {
    const W = strings.mergeWizard;
    const ex = env?.example() ?? null;
    const scope = ctx.choices.scope;
    const tile = (s: PlanScope, title: string, desc: string): string => {
        // One line of description: the option said on one person of the tree when there is one (§3).
        const example = ex ? ex[s] : '';
        const line = example || desc;
        return `<label class="sel-opt merge-s1-scope" data-sel-form="tile" data-scope="${s}" title="${escapeHtml(example ? `${desc} ${example}` : desc)}">`
            + `<input type="radio" name="merge-scope" value="${s}"${scope === s ? ' checked' : ''}>`
            + `<span class="merge-s1-scope-text"><span class="merge-s1-scope-title">${escapeHtml(title)}</span>`
            + `<span class="merge-s1-scope-desc${example ? ' is-example' : ''}">${escapeHtml(line)}</span></span></label>`;
    };
    // On a phone c) and d) wait behind "More options" unless one of them is chosen (14a).
    const more = scope === 'c' || scope === 'd';
    return `<h4 class="merge-s1-h" id="merge-s1-scope-h">${escapeHtml(W.existingWhat)}</h4>
        <div class="merge-s1-scopes${more ? ' is-more' : ''}" role="radiogroup" aria-labelledby="merge-s1-scope-h">
            ${tile('a', W.scopeA, W.scopeADesc)}${tile('b', W.scopeB, W.scopeBDesc)}
            <button type="button" class="link-button merge-s1-more" data-s1="more" aria-expanded="${more}">${escapeHtml(W.moreOptions)}</button>
            ${tile('c', W.scopeC, W.scopeCDesc)}${tile('d', W.scopeD, W.scopeDDesc)}
        </div>`;
}

function fromToHtml(ctx: StepContext, env: Step1Env): string {
    const source = env.sourceTree();
    if (!source) return '';
    const W = strings.mergeWizard;
    const target = env.targets().find(r => r.treeId === ctx.choices.targetTreeId);
    const blocked = env.swapBlocked();
    const end = (name: string, n: number | null, cls: string): string =>
        `<span class="merge-s1-end ${cls}"><b title="${escapeHtml(name)}">${escapeHtml(name)}</b>${n === null ? '' : `<span class="merge-s1-meta">${escapeHtml(W.treeLine(n, false, false, null))}</span>`}</span>`;
    return `<div class="merge-s1-fromto"><span class="merge-s1-h">${escapeHtml(W.fromTo)}</span>
        <div class="merge-s1-route">${end(source.name, source.persons, 'is-from')}<span class="merge-s1-arrow" aria-hidden="true">→</span>`
        + `${target ? end(target.name, target.persons, 'is-to') : end(W.modeNew, null, 'is-to')}`
        + `<button type="button" class="secondary merge-s1-swap" data-s1="swap"${blocked ? ` aria-disabled="true" title="${escapeHtml(blocked)}"` : ''}><span aria-hidden="true">⇄</span> ${escapeHtml(W.swap)}</button></div></div>`;
}

/** The right column: what to do with the import. */
function whatHtml(ctx: StepContext, env: Step1Env | undefined, json: boolean): string {
    const W = strings.mergeWizard;
    const c = ctx.choices;
    if (c.source.persons === 0) {
        return `<section class="merge-s1-what">${stepHeading(1, W.whatToDo)}<p class="merge-s1-empty">${escapeHtml(W.emptySource)}</p></section>`;
    }
    const mode = modeOf(c);
    const modes: Array<[StepMode, string]> = [['new', W.modeNew], ['add', W.modeAdd], ['compare', W.modeCompare]];
    if (json) modes.push(['json', W.modeJson]);
    const seg = modes.map(([m, label]) =>
        `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" aria-checked="${m === mode}" data-mode="${m}">${escapeHtml(label)}</button>`).join('');
    const desc = mode === 'new' ? W.modeNewDesc(c.source.label.replace(/\.(ged|gedcom|json)$/i, ''), c.source.persons)
        : mode === 'json' ? W.modeJsonDesc
            : mode === 'compare' ? W.modeCompareDesc : W.modeAddDesc;
    const into = mode === 'add' || mode === 'compare';
    const repeat = into ? env?.repeat() ?? '' : '';
    return `<section class="merge-s1-what">
            ${stepHeading(1, W.whatToDo)}
            ${env && into ? fromToHtml(ctx, env) : ''}
            <div class="sel-seg merge-s1-modes" role="radiogroup" aria-label="${escapeHtml(W.whatToDo)}">${seg}</div>
            <p class="merge-s1-desc">${escapeHtml(desc)}</p>
            ${env && into ? targetsHtml(ctx, env) : ''}
            ${env && mode === 'new' ? researchHtml(env, null) : ''}
            ${repeat ? `<p class="merge-s1-note">${escapeHtml(repeat)}</p>` : ''}
            ${into ? scopeHtml(ctx, env) : ''}
        </section>`;
}

/** "Show all": every kind of line not taken over, the rows wrapping (3e). */
function showNotTaken(env: Step1Env): void {
    const dialog = document.getElementById('merge-not-taken-modal');
    const list = document.getElementById('merge-not-taken-list');
    if (!dialog || !list) return;
    list.replaceChildren(...env.notTaken().filter(d => d.count > 0).map(d => {
        const li = document.createElement('li');
        const tag = document.createElement('b');
        tag.textContent = d.tag;
        const count = document.createElement('span');
        count.className = 'merge-not-taken-count';
        count.textContent = `${d.count.toLocaleString()}×`;
        const text = document.createElement('span');
        text.className = 'merge-not-taken-text';
        text.textContent = [d.label ?? '', d.example].filter(Boolean).join(' · ');
        li.append(tag, count, text);
        return li;
    }));
    dialog.classList.add('active');
    dialog.querySelector<HTMLElement>('.close-btn')?.focus();
}

/** Closes "Show all" when open (Escape, ×): true when it was. */
export function closeNotTaken(): boolean {
    const dialog = document.getElementById('merge-not-taken-modal');
    if (!dialog?.classList.contains('active')) return false;
    dialog.classList.remove('active');
    document.querySelector<HTMLElement>('#merge-step-body [data-s1="not-taken-all"]')?.focus();
    return true;
}

/**
 * The control that has the focus inside the step, as a selector that finds
 * the same control after the step is drawn again (a choice redraws it, and
 * a keyboard user must not be thrown out to the page).
 */
function focusedKey(host: HTMLElement): string | null {
    const el = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
    if (!el || !host.contains(el)) return null;
    const quote = (v: string): string => `"${v.replace(/["\\]/g, '\\$&')}"`;
    if (el instanceof HTMLInputElement && el.name) return `input[name=${quote(el.name)}][value=${quote(el.value)}]`;
    if (el.dataset.mode) return `.merge-s1-modes [data-mode=${quote(el.dataset.mode)}]`;
    if (el.dataset.s1) return `[data-s1=${quote(el.dataset.s1)}]`;
    if (el.classList.contains('merge-s1-sumline')) return '.merge-s1-sumline';
    return null;
}

export function renderStep1(host: HTMLElement, ctx: StepContext): void {
    const env = ctx.step1;
    const summary = env?.gedcomSummary() ?? null;
    const focused = focusedKey(host);
    host.innerHTML = `<div class="merge-step1">${sourceHtml(ctx, env, !!summary)}${whatHtml(ctx, env, ctx.choices.source.kind === 'ged' && !!summary)}</div>`;

    const lines = notTakenHtml(env);
    const slot = host.querySelector('.merge-s1-summary');
    if (summary && slot) {
        summary.querySelector('.merge-not-taken')?.remove();
        slot.appendChild(summary);
        if (lines) {
            // The line of what the tree does not take over, above today's lines about the people.
            const box = document.createElement('div');
            box.innerHTML = lines;
            const el = box.firstElementChild!;
            const detail = summary.querySelector('#gedcom-stat-detail');
            if (detail) summary.insertBefore(el, detail); else summary.appendChild(el);
        }
    } else if (lines) {
        host.querySelector('.merge-s1-srcbody')?.insertAdjacentHTML('beforeend', lines);
    }

    host.querySelector<HTMLButtonElement>('.merge-s1-sumline')?.addEventListener('click', e => {
        const b = e.currentTarget as HTMLButtonElement;
        const open = b.closest('.merge-s1-src')?.classList.toggle('is-open') ?? false;
        b.setAttribute('aria-expanded', String(open));
    });
    host.querySelectorAll<HTMLButtonElement>('.merge-s1-modes [data-mode]').forEach(b => b.addEventListener('click', () => {
        const mode = b.dataset.mode as StepMode;
        if (mode === modeOf(ctx.choices)) return;
        if (env) env.setMode(mode);
        else if (mode !== 'json') ctx.update({ mode, json: false });
    }));
    // The followed tree's tile is no dead end: pressed, it offers to turn following off and merge there.
    host.querySelectorAll<HTMLElement>('.merge-s1-target[data-block="live"]').forEach(t => t.addEventListener('click', e => {
        e.preventDefault();
        if (env && t.dataset.tree) env.endFollowAsk(t.dataset.tree as TreeId);
    }));
    host.querySelectorAll<HTMLInputElement>('input[name="merge-target"]').forEach(i => i.addEventListener('change', () => {
        if (i.checked && env) env.selectTarget(i.value as TreeId);
    }));
    host.querySelectorAll<HTMLInputElement>('input[name="merge-scope"]').forEach(i => i.addEventListener('change', () => {
        if (i.checked) ctx.update({ scope: i.value as PlanScope });
    }));
    host.querySelector('.merge-step1')?.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s1]');
        if (!b || b.getAttribute('aria-disabled') === 'true') return;
        switch (b.dataset.s1) {
            case 'not-taken-all': if (env) showNotTaken(env); break;
            case 'not-taken-save': env?.saveNotTaken(); break;
            case 'swap': env?.swap(); break;
            case 'unlock': env?.unlock(); break;
            case 'end-follow': env?.endFollow(); break;
            case 'more': {
                const box = b.closest('.merge-s1-scopes');
                const open = box?.classList.toggle('is-more') ?? false;
                b.setAttribute('aria-expanded', String(open));
                break;
            }
        }
    });
    if (focused) host.querySelector<HTMLElement>(focused)?.focus({ preventScroll: true });
}

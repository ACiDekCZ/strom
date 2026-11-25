/**
 * Editing a custom list rule (spec 136 §2, §5): the builder's steps as pure
 * functions over the rule's tree, without the DOM. Every step returns a new
 * root (the old one is never changed) and the path of the node to focus.
 *
 * Paths are those of `evalRuleCounts` (src/person-list-rules.ts): '' the
 * root group, '0' its first item, '1.0' the first item of its second item.
 *
 * The tree is kept in its display order: in each group the items without
 * `not` first, the excepts after them ("except" stands at the end of its
 * group, designer's decision 3). A group left empty is removed (the root
 * stays); a group of one item stays (it can be ungrouped). Groups nest at
 * most RULE_MAX_DEPTH levels (the root = 1).
 */

import type { RuleCond, RuleGroup, RuleNode } from './types.js';
import { RULE_MAX_DEPTH, condNeed } from './person-list-rules.js';

export interface RuleEdit {
    root: RuleGroup;
    /** The node to focus after the step ('' = none in particular). */
    path: string;
}

/** An empty root group ("All apply"). */
export function emptyRuleRoot(): RuleGroup {
    return { t: 'group', op: 'all', items: [] };
}

export function cloneRuleNode<T extends RuleNode>(node: T): T {
    return JSON.parse(JSON.stringify(node)) as T;
}

export function pathParts(path: string): number[] {
    return path === '' ? [] : path.split('.').map(Number);
}

export function joinPath(parent: string, i: number): string {
    return parent === '' ? String(i) : `${parent}.${i}`;
}

/** The parent group's path and the index in it ('' has no parent: index -1). */
export function parentOf(path: string): { parent: string; index: number } {
    const parts = pathParts(path);
    if (!parts.length) return { parent: '', index: -1 };
    const index = parts.pop()!;
    return { parent: parts.join('.'), index };
}

export function nodeAt(root: RuleGroup, path: string): RuleNode | null {
    let node: RuleNode = root;
    for (const i of pathParts(path)) {
        if (node.t !== 'group') return null;
        const next: RuleNode | undefined = node.items[i];
        if (!next) return null;
        node = next;
    }
    return node;
}

function groupAt(root: RuleGroup, path: string): RuleGroup | null {
    const n = nodeAt(root, path);
    return n && n.t === 'group' ? n : null;
}

/** The level of the group at `path` (the root = 1). */
export function groupLevel(path: string): number {
    return pathParts(path).length + 1;
}

/** How many group levels a node takes (a condition 0, a group of conditions 1). */
function levels(node: RuleNode): number {
    return node.t === 'cond' ? 0 : 1 + Math.max(0, ...node.items.map(levels));
}

/**
 * The display order: in each group the items without `not` first, then the
 * excepts (each part in its own order); groups left empty removed, the root
 * kept.
 */
export function normalizeRule(root: RuleGroup): RuleGroup {
    const walk = (g: RuleGroup): RuleGroup => {
        const items: RuleNode[] = [];
        for (const n of g.items) {
            if (n.t === 'cond') { items.push(n); continue; }
            const kid = walk(n);
            if (kid.items.length) items.push(kid);
        }
        return { ...g, items: [...items.filter(n => !n.not), ...items.filter(n => n.not)] };
    };
    return walk(root);
}

/** Change the group at `path` (a clone of the root is changed and normalized). */
function edit(root: RuleGroup, path: string, fn: (g: RuleGroup) => void): RuleGroup {
    const next = cloneRuleNode(root);
    const g = groupAt(next, path);
    if (g) fn(g);
    return next;
}

/** Where a node ends up after the root is normalized (it is found by identity). */
function locate(root: RuleGroup, target: RuleNode): string {
    const walk = (g: RuleGroup, path: string): string | null => {
        for (let i = 0; i < g.items.length; i++) {
            const n = g.items[i];
            const p = joinPath(path, i);
            if (n === target) return p;
            if (n.t === 'group') {
                const r = walk(n, p);
                if (r !== null) return r;
            }
        }
        return null;
    };
    return walk(root, '') ?? '';
}

/** The normalized root with the path of `target` in it. */
function finish(root: RuleGroup, target: RuleNode | null): RuleEdit {
    // Normalizing copies the groups but keeps the nodes it does not change; find the target by identity in the result.
    const norm = normalizeRuleKeeping(root);
    return { root: norm, path: target ? locate(norm, target) : '' };
}

/** normalizeRule that keeps condition objects (and groups' identity through a map) so a node can be found after it. */
function normalizeRuleKeeping(root: RuleGroup): RuleGroup {
    const walk = (g: RuleGroup): RuleGroup => {
        const items: RuleNode[] = [];
        for (const n of g.items) {
            if (n.t === 'cond') { items.push(n); continue; }
            walk(n);
            if (n.items.length) items.push(n);
        }
        g.items = [...items.filter(n => !n.not), ...items.filter(n => n.not)];
        return g;
    };
    return walk(root);
}

/** Add a condition at the end of the group's items without `not` (before its excepts). */
export function addCondition(root: RuleGroup, groupPath: string, cond: RuleCond): RuleEdit {
    const next = cloneRuleNode(root);
    const g = groupAt(next, groupPath);
    if (!g) return { root, path: '' };
    const node = cloneRuleNode(cond);
    delete node.not;
    const at = g.items.findIndex(n => n.not);
    if (at < 0) g.items.push(node); else g.items.splice(at, 0, node);
    return finish(next, node);
}

/** Whether "Add group" is offered in the group at `groupPath` (not in the last level). */
export function canAddGroup(groupPath: string): boolean {
    return groupLevel(groupPath) < RULE_MAX_DEPTH;
}

/** Add a new group ("All apply") with one condition at the end of the group's positive items; null in the last level. */
export function addGroup(root: RuleGroup, groupPath: string, cond: RuleCond): RuleEdit | null {
    if (!canAddGroup(groupPath)) return null;
    const next = cloneRuleNode(root);
    const g = groupAt(next, groupPath);
    if (!g) return null;
    const node = cloneRuleNode(cond);
    delete node.not;
    const group: RuleGroup = { t: 'group', op: 'all', items: [node] };
    const at = g.items.findIndex(n => n.not);
    if (at < 0) g.items.push(group); else g.items.splice(at, 0, group);
    return finish(next, node);
}

/** Put a changed condition in place of the one at `path` (its `not` kept). */
export function replaceCondition(root: RuleGroup, path: string, cond: RuleCond): RuleGroup {
    const { parent, index } = parentOf(path);
    const old = nodeAt(root, path);
    if (!old || old.t !== 'cond') return root;
    return edit(root, parent, g => {
        const node = cloneRuleNode(cond);
        if (old.not) node.not = true; else delete node.not;
        g.items[index] = node;
    });
}

/** All apply / any applies of the group at `path`. */
export function setGroupOp(root: RuleGroup, path: string, op: 'all' | 'any'): RuleGroup {
    return edit(root, path, g => { g.op = op; });
}

/** Remove a node; a group left empty goes too (the root stays). The path to focus: the row now in its place, else the one before. */
export function removeNode(root: RuleGroup, path: string): RuleEdit {
    if (path === '') return { root, path: '' };
    const next = cloneRuleNode(root);
    const { parent, index } = parentOf(path);
    const g = groupAt(next, parent);
    if (!g) return { root, path: '' };
    g.items.splice(index, 1);
    const neighbour = g.items[index] ?? g.items[index - 1] ?? null;
    const done = finish(next, neighbour);
    return { root: done.root, path: neighbour ? done.path : '' };
}

/** A copy of the node right after it (an except copy stays an except at the end). */
export function duplicateNode(root: RuleGroup, path: string): RuleEdit {
    const { parent, index } = parentOf(path);
    const next = cloneRuleNode(root);
    const g = groupAt(next, parent);
    const node = g?.items[index];
    if (!g || !node) return { root, path };
    const copy = cloneRuleNode(node);
    g.items.splice(index + 1, 0, copy);
    return finish(next, copy);
}

/** The indexes a node can move between: its own part of the group (positives or excepts). */
function partRange(g: RuleGroup, index: number): [number, number] {
    const firstExcept = g.items.findIndex(n => n.not);
    const split = firstExcept < 0 ? g.items.length : firstExcept;
    return g.items[index]?.not ? [split, g.items.length - 1] : [0, split - 1];
}

/** Whether the node can move up / down (within its own part of its group). */
export function moveBounds(root: RuleGroup, path: string): { up: boolean; down: boolean } {
    const { parent, index } = parentOf(path);
    const g = groupAt(root, parent);
    if (!g || index < 0) return { up: false, down: false };
    const [lo, hi] = partRange(g, index);
    return { up: index > lo, down: index < hi };
}

/** Move a node one place up (-1) or down (1) within its part; null when it cannot. */
export function moveNode(root: RuleGroup, path: string, dir: -1 | 1): RuleEdit | null {
    const { parent, index } = parentOf(path);
    const g = groupAt(root, parent);
    if (!g) return null;
    return moveNodeTo(root, path, index + dir);
}

/** Move a node to `to` in its group (dragging), kept within its own part; null when nothing moves. */
export function moveNodeTo(root: RuleGroup, path: string, to: number): RuleEdit | null {
    const { parent, index } = parentOf(path);
    const next = cloneRuleNode(root);
    const g = groupAt(next, parent);
    if (!g || index < 0 || !g.items[index]) return null;
    const [lo, hi] = partRange(g, index);
    const target = Math.max(lo, Math.min(hi, to));
    if (target === index) return null;
    const [node] = g.items.splice(index, 1);
    g.items.splice(target, 0, node);
    return finish(next, node);
}

/** "Except" is not offered for a group's first item (an except cannot open a group). */
export function canExcept(root: RuleGroup, path: string): boolean {
    const node = nodeAt(root, path);
    if (!node || path === '') return false;
    if (node.not) return true;
    return parentOf(path).index > 0;
}

/** Except ↔ include: an except goes to the end of its group, an included one to the end of the positives. */
export function toggleExcept(root: RuleGroup, path: string): RuleEdit {
    if (!canExcept(root, path)) return { root, path };
    const { parent, index } = parentOf(path);
    const next = cloneRuleNode(root);
    const g = groupAt(next, parent);
    const node = g?.items[index];
    if (!g || !node) return { root, path };
    g.items.splice(index, 1);
    if (node.not) {
        delete node.not;
        const at = g.items.findIndex(n => n.not);
        if (at < 0) g.items.push(node); else g.items.splice(at, 0, node);
    } else {
        node.not = true;
        g.items.push(node);
    }
    return finish(next, node);
}

/**
 * "Group with…" (designer's decision 4): 'hidden' in the last level (not
 * drawn), 'disabled' for the last row or when the group would be too deep,
 * else 'ok'.
 */
export function groupWithNextState(root: RuleGroup, path: string): 'hidden' | 'disabled' | 'ok' {
    const { parent, index } = parentOf(path);
    if (index < 0 || groupLevel(parent) >= RULE_MAX_DEPTH) return 'hidden';
    const g = groupAt(root, parent);
    const a = g?.items[index];
    const b = g?.items[index + 1];
    if (!a || !b) return 'disabled';
    const deepest = groupLevel(parent) + 1 + Math.max(levels(a), levels(b));
    return deepest > RULE_MAX_DEPTH ? 'disabled' : 'ok';
}

/**
 * Make a group ("All apply") of the row and the row under it, in the row's
 * place. Two excepts become one except group of "any" (the same people go
 * away); a positive row with an except under it becomes "row except that".
 */
export function groupWithNext(root: RuleGroup, path: string): RuleEdit | null {
    if (groupWithNextState(root, path) !== 'ok') return null;
    const { parent, index } = parentOf(path);
    const next = cloneRuleNode(root);
    const g = groupAt(next, parent)!;
    const [a, b] = g.items.splice(index, 2);
    let group: RuleGroup;
    if (a.not && b.not) {
        delete a.not; delete b.not;
        group = { t: 'group', op: 'any', items: [a, b], not: true };
    } else {
        delete a.not;
        group = { t: 'group', op: 'all', items: [a, b] };
    }
    g.items.splice(index, 0, group);
    return finish(next, group);
}

/** Ungroup: the group's items in its place (an except group's items become excepts). */
export function dissolveGroup(root: RuleGroup, path: string): RuleEdit {
    const node = nodeAt(root, path);
    if (path === '' || !node || node.t !== 'group') return { root, path };
    const { parent, index } = parentOf(path);
    const next = cloneRuleNode(root);
    const g = groupAt(next, parent)!;
    const group = g.items[index] as RuleGroup;
    const items = group.items.map(n => {
        if (group.not) n.not = true;
        return n;
    });
    g.items.splice(index, 1, ...items);
    return finish(next, items[0] ?? null);
}

/** The conditions in display order with their paths (groups left out). */
export function conditionPaths(root: RuleGroup): Array<{ path: string; cond: RuleCond }> {
    const out: Array<{ path: string; cond: RuleCond }> = [];
    const walk = (g: RuleGroup, path: string): void => {
        g.items.forEach((n, i) => {
            const p = joinPath(path, i);
            if (n.t === 'cond') out.push({ path: p, cond: n });
            else walk(n, p);
        });
    };
    walk(root, '');
    return out;
}

/** The number of a condition counted from the top over all levels (1-based; 0 when not found). */
export function conditionNumber(root: RuleGroup, path: string): number {
    return conditionPaths(root).findIndex(c => c.path === path) + 1;
}

/** The first incomplete condition (its number from the top and path), or null. */
export function firstIncomplete(root: RuleGroup): { n: number; path: string } | null {
    const all = conditionPaths(root);
    const i = all.findIndex(c => condNeed(c.cond) !== null);
    return i < 0 ? null : { n: i + 1, path: all[i].path };
}

/**
 * How many conditions differ from the rule the dialog started with (for
 * "Discard the unfinished rule?"): conditions added or changed, and those
 * taken away.
 */
export function editedConditions(start: RuleGroup | null, now: RuleGroup): number {
    const key = (c: RuleCond): string => JSON.stringify({ c: c.c, p: c.p, not: !!c.not });
    const before = new Map<string, number>();
    for (const { cond } of start ? conditionPaths(start) : []) before.set(key(cond), (before.get(key(cond)) ?? 0) + 1);
    let changed = 0;
    for (const { cond } of conditionPaths(now)) {
        const k = key(cond);
        const left = before.get(k) ?? 0;
        if (left > 0) before.set(k, left - 1); else changed++;
    }
    let removed = 0;
    for (const v of before.values()) removed += v;
    return Math.max(changed, removed);
}

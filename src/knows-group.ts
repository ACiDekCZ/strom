/**
 * The groups of the overview's "What the research knows" (spec 140): none,
 * by the research's lines, or in the tree and outside it. Kept per tree
 * (SettingsManager.getKnowsGroupForTree); counted over the rows shown (after
 * the kind chips and the search), each row keeping its place inside a group.
 */

export type KnowsGroup = 'none' | 'line' | 'tree';

/** The choices the section offers: by line only with lines (K1.5). */
export function knowsGroupOptions(hasLines: boolean): KnowsGroup[] {
    return hasLines ? ['none', 'line', 'tree'] : ['none', 'tree'];
}

/**
 * What is drawn: a stored 'line' without lines draws as 'none', and so does
 * any choice with fewer than two rows (D5). The stored choice is not rewritten.
 */
export function knowsGroupShown(stored: KnowsGroup, hasLines: boolean, rows: number): KnowsGroup {
    if (rows < 2) return 'none';
    if (stored === 'line' && !hasLines) return 'none';
    return stored;
}

/** A stored value read back: anything else is 'none'. */
export function isKnowsGroup(v: unknown): v is KnowsGroup {
    return v === 'none' || v === 'line' || v === 'tree';
}

export interface KnowsGroupLine { id: string; name: string; done: boolean }

export interface KnowsGroupOf<R> {
    /** The line's id, 'noLine', 'in' or 'out'. */
    key: string;
    kind: 'line' | 'noLine' | 'in' | 'out';
    line?: KnowsGroupLine;
    rows: R[];
}

/**
 * The groups of the rows shown (K1.3), the rows' order kept inside each
 * (conflicts first). 'line': a group per line in the order of `lines`, a row
 * in each line of its person, 'noLine' last. 'tree': 'in', then 'out' (a
 * person of an island). An empty group is left out (D4: one 'in' alone).
 */
export function knowsGroups<R>(rows: readonly R[], group: Exclude<KnowsGroup, 'none'>, ctx: {
    lines: readonly KnowsGroupLine[];
    lineIdsOf(row: R): ReadonlySet<string>;
    islandOf(row: R): boolean;
}): KnowsGroupOf<R>[] {
    if (group === 'tree') {
        const inTree: R[] = [];
        const out: R[] = [];
        for (const r of rows) (ctx.islandOf(r) ? out : inTree).push(r);
        const groups: KnowsGroupOf<R>[] = [{ key: 'in', kind: 'in', rows: inTree }, { key: 'out', kind: 'out', rows: out }];
        return groups.filter(g => g.rows.length > 0);
    }
    const byLine = new Map<string, R[]>(ctx.lines.map(l => [l.id, []]));
    const noLine: R[] = [];
    for (const r of rows) {
        let placed = false;
        for (const id of ctx.lineIdsOf(r)) {
            const list = byLine.get(id);
            if (!list) continue;
            list.push(r);
            placed = true;
        }
        if (!placed) noLine.push(r);
    }
    const groups: KnowsGroupOf<R>[] = ctx.lines.map(l => ({ key: l.id, kind: 'line' as const, line: l, rows: byLine.get(l.id) ?? [] }));
    groups.push({ key: 'noLine', kind: 'noLine', rows: noLine });
    return groups.filter(g => g.rows.length > 0);
}

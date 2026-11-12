/**
 * The research's rows of the person menu in a satellite window (spec 079 §2,
 * mockup 2g). The main window lists them as it offers them now (its research,
 * its bridge), with their marks unchanged; here they stand under the heading
 * "Research · runs in the main window", and a click asks the main window to
 * run the row (`research-action` 'person-menu'). While the main window is
 * closed the rows last listed stay, greyed, under "Research · main window only".
 */

import { strings } from '../strings.js';
import type { PersonMenuAction } from '../ui/context-menu.js';

/** A satellite's research row: the main window's action after it. */
export const WIN_RESEARCH_PREFIX = 'win-research:';
/** How long a menu waits for the main window's rows before it opens without fresh ones. */
export const RESEARCH_MENU_WAIT_MS = 300;
/** Rows asked for this recently are used as they are (one menu, its sheet's second page). */
const FRESH_MS = 1500;

/** The research action a satellite's row asks for. */
export const PERSON_MENU_ACTION = 'person-menu';

export interface PersonMenuActionArgs {
    personId: string;
    action: string;
}

/** What the rows need from the satellite client (SatelliteClient fits). */
export interface ResearchMenuClient {
    readonly connection: string;
    requestResearchMenu(personId: string, waitMs: number): Promise<unknown[] | null>;
    researchAction(action: string, args?: unknown): void;
    requestMainFocus(): Promise<boolean>;
}

/** A row from the main window, kept to the fields a menu row has (nothing else crosses windows). */
function readRow(raw: unknown): PersonMenuAction | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.action !== 'string' || typeof r.label !== 'string') return null;
    const out: PersonMenuAction = { action: r.action, label: r.label };
    for (const k of ['meta', 'ariaLabel', 'header', 'tag', 'state', 'note', 'glyph'] as const) {
        if (typeof r[k] === 'string') out[k] = r[k] as string;
    }
    for (const k of ['divider', 'external', 'disabled', 'danger', 'strong', 'link'] as const) {
        if (r[k] === true) out[k] = true;
    }
    if (r.badge === 'ai') out.badge = 'ai';
    if (Array.isArray(r.submenu)) out.submenu = r.submenu.map(readRow).filter((x): x is PersonMenuAction => !!x);
    return out;
}

/** The rows as the main window sent them, read safely. */
export function readResearchRows(raw: unknown[]): PersonMenuAction[] {
    return raw.map(readRow).filter((x): x is PersonMenuAction => !!x);
}

/** Every action of the rows (their second levels too): what the main window runs from a satellite. */
export function researchRowActions(rows: readonly PersonMenuAction[]): Set<string> {
    const out = new Set<string>();
    const walk = (items: readonly PersonMenuAction[]): void => {
        for (const a of items) {
            if (a.submenu) walk(a.submenu);
            else if (!a.disabled && !a.caption) out.add(a.action);
        }
    };
    walk(rows);
    return out;
}

/** The rows as a satellite shows them: its heading on the first, the actions its own, greyed while the main window is closed. */
export function satelliteResearchRows(rows: readonly PersonMenuAction[], mainOpen: boolean): PersonMenuAction[] {
    const mark = (a: PersonMenuAction): PersonMenuAction => ({
        ...a,
        action: WIN_RESEARCH_PREFIX + a.action,
        ...(mainOpen ? {} : { disabled: true, dim: true }),
        ...(a.submenu ? { submenu: a.submenu.map(mark) } : {}),
    });
    const section = mainOpen ? strings.win.researchInMain : strings.win.researchMainOnly;
    return rows.map((a, i) => (i === 0 ? { ...mark(a), divider: true, section } : mark(a)));
}

/** A satellite's research rows: asked for when a menu opens, run by the main window. */
export class SatelliteResearchMenu {
    private readonly cache = new Map<string, { rows: PersonMenuAction[]; at: number }>();

    constructor(private readonly client: ResearchMenuClient, private readonly now: () => number = () => Date.now()) {}

    private mainOpen(): boolean {
        return this.client.connection === 'connected';
    }

    /** The menu should ask the main window first (it is there and the rows are not fresh). */
    needsFetch(personId: string): boolean {
        if (!this.mainOpen()) return false;
        const c = this.cache.get(personId);
        return !c || this.now() - c.at > FRESH_MS;
    }

    /** Ask the main window for the person's rows (kept also when it does not answer: the last ones). */
    async fetch(personId: string): Promise<void> {
        const raw = await this.client.requestResearchMenu(personId, RESEARCH_MENU_WAIT_MS);
        const rows = raw ? readResearchRows(raw) : this.cache.get(personId)?.rows ?? [];
        this.cache.set(personId, { rows, at: this.now() });
    }

    /** The rows for the person's menu now. */
    rows(personId: string): PersonMenuAction[] {
        const c = this.cache.get(personId);
        return c && c.rows.length ? satelliteResearchRows(c.rows, this.mainOpen()) : [];
    }

    /** A row was chosen: the main window runs it; one that shows its result there asks it forward. */
    run(personId: string, action: string): void {
        if (!this.mainOpen()) return;
        const row = this.find(personId, action);
        const args: PersonMenuActionArgs = { personId, action };
        this.client.researchAction(PERSON_MENU_ACTION, args);
        // A row with the terminal's mark opens the research's terminal: the main window stays where it is.
        if (!row?.external) void this.client.requestMainFocus();
    }

    private find(personId: string, action: string): PersonMenuAction | undefined {
        const walk = (items: readonly PersonMenuAction[]): PersonMenuAction | undefined => {
            for (const a of items) {
                if (a.action === action) return a;
                const sub = a.submenu ? walk(a.submenu) : undefined;
                if (sub) return sub;
            }
            return undefined;
        };
        return walk(this.cache.get(personId)?.rows ?? []);
    }
}

/**
 * The main window runs a satellite's research row (`research-action`
 * 'person-menu'): only an action its own person menu offers now, exactly as
 * its own menu runs it. True when run.
 */
export function runSatelliteResearchRow(
    args: unknown,
    deps: { items(personId: string): PersonMenuAction[] | null; run(personId: string, action: string): void },
): boolean {
    if (!args || typeof args !== 'object') return false;
    const { personId, action } = args as Partial<PersonMenuActionArgs>;
    if (typeof personId !== 'string' || typeof action !== 'string') return false;
    const items = deps.items(personId);
    if (!items || !researchRowActions(items).has(action)) return false;
    deps.run(personId, action);
    return true;
}

let current: SatelliteResearchMenu | null = null;

/** This window's research rows (a satellite only). */
export function setSatelliteResearchMenu(menu: SatelliteResearchMenu | null): void {
    current = menu;
}

export function satelliteResearchMenu(): SatelliteResearchMenu | null {
    return current;
}

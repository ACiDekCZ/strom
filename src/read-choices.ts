/**
 * Who reads a document (spec 059): the readers the research offers for each
 * reader of a reading (`/status.accepts.read.choices`, feature `read.choose`),
 * the choice the app sends with a request (`with`: only where it differs from
 * the default) and who read a reading (`readers.who` in `GET read/<id>`,
 * `who` in `/status.reads[]` and `GET reads`).
 *
 * Data only: the dialog and the result build on it. Everything from the
 * bridge is untrusted: checked and capped here. A model or effort `""` means
 * "as the agent itself is set" — the research offers it for every agent.
 */

import { cleanText } from './research-link.js';

/** `/status.features`: the research takes the readers' agent, model and effort (`choices`, `with`, `who`). */
export const READ_CHOOSE_FEATURE = 'read.choose';

/** `/status.features`: a model that is an alias says what it last ran on here (`models[].now` / `nowName`). */
export const READ_CHOICES_NOW_FEATURE = 'read.choices.now';

/** One model offered for an agent. */
export interface ReadChoiceModel {
    /** What is sent (`with[].model`): an alias stays an alias ("opus"), never `now`. */
    id: string;
    name: string;
    /** What the alias last ran on here, as a person reads it ("Opus 5.5"; `read.choices.now`); absent: unknown. A label only. */
    nowName?: string;
    /** From Codex's kept catalog fetched by a newer Codex than the installed one: it may not know this model. */
    unsure?: true;
}

/** What one reader reads with. `model` / `effort` `''`: as the agent itself is set. */
export interface ReaderChoice {
    agent: string;
    model: string;
    effort: string;
}

/** An agent a reader may read with (`choices.agents[]`). */
export interface ReadChoiceAgent {
    id: string;
    /** Its own name ("Claude Code", "OpenAI Codex CLI"), never translated. */
    name: string;
    /** false: installed here, but no reader of it can start now (`why`). */
    ready: boolean;
    /** `limit` | `auth` | another code; '' when ready. */
    why: string;
    /** Until when a `limit` lasts (ISO); ''. */
    resets: string;
    /** The models offered, in the bridge's order (`id: ''` = the agent's own model, `name` then ''). */
    models: ReadChoiceModel[];
    /** Codex: its kept catalog was fetched by a newer Codex (`catalog`) than the installed one (`installed`); absent: none said. */
    catalogNewer?: { catalog: string; installed: string };
    /** The efforts it takes (`''` = the agent's own setting); empty: it has no effort to set. */
    efforts: string[];
    /** What a reader of it reads with when only the agent is chosen. */
    default: { model: string; effort: string };
}

/** `/status.accepts.read.choices`. */
export interface ReadChoices {
    /** The agents, the research's own first. */
    agents: ReadChoiceAgent[];
    /** What each reader reads with by default: [0] the first, [1] the blind one. */
    default: [ReaderChoice, ReaderChoice];
}

/** One item of `with` as sent: a field or the item left out reads as by default. */
export type ReadWithItem = Partial<ReaderChoice>;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** An agent's id ("claude", "codex", "opencode"), or ''. */
function agentId(v: unknown): string {
    return typeof v === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(v) ? v : '';
}

/** A model's id as the agent takes it ("opus", "gpt-5.1-codex", "anthropic/claude-opus-4", "" = its own), or null. */
function modelId(v: unknown): string | null {
    return typeof v === 'string' && /^[A-Za-z0-9._:/@+\-[\]]{0,80}$/.test(v) ? v : null;
}

/** An effort ("high", "xhigh", "" = its own), or null. */
function effortId(v: unknown): string | null {
    return typeof v === 'string' && /^[a-z0-9-]{0,20}$/.test(v) ? v : null;
}

function code(v: unknown): string {
    return typeof v === 'string' && /^[a-z][a-z0-9.-]{0,40}$/.test(v) ? v : '';
}

function isoTime(v: unknown): string {
    const t = cleanText(v, 40);
    return t && Number.isFinite(Date.parse(t)) ? t : '';
}

/** A Codex version as its CLI names itself ("0.58.0"), or ''. */
function cliVersion(v: unknown): string {
    return typeof v === 'string' && /^\d{1,4}(\.\d{1,6}){1,3}(-[0-9A-Za-z.]{1,20})?$/.test(v) ? v : '';
}

function sanitizeCatalogNewer(v: unknown): { catalog: string; installed: string } | null {
    const r = asRecord(v);
    const catalog = r ? cliVersion(r.catalog) : '';
    const installed = r ? cliVersion(r.installed) : '';
    return catalog && installed ? { catalog, installed } : null;
}

function sanitizeAgent(v: unknown, now: boolean): ReadChoiceAgent | null {
    const r = asRecord(v);
    const id = r ? agentId(r.id) : '';
    if (!r || !id) return null;
    const catalogNewer = sanitizeCatalogNewer(r.catalogNewer);
    const models: ReadChoiceModel[] = [];
    for (const item of Array.isArray(r.models) ? r.models.slice(0, 40) : []) {
        const m = asRecord(item);
        const mid = m ? modelId(m.id) : null;
        if (!m || mid === null || models.some(x => x.id === mid)) continue;
        const name = mid ? cleanText(m.name, 60) || mid : '';
        // What an alias runs on now: only from a research that says it, and only where it adds something.
        const nowName = now ? cleanText(m.nowName, 60) : '';
        models.push({
            id: mid, name,
            ...(nowName && nowName !== name && nowName !== mid ? { nowName } : {}),
            ...(catalogNewer && m.unsure === true ? { unsure: true as const } : {}),
        });
    }
    const efforts: string[] = [];
    for (const item of Array.isArray(r.efforts) ? r.efforts.slice(0, 20) : []) {
        const e = effortId(item);
        if (e !== null && !efforts.includes(e)) efforts.push(e);
    }
    const d = asRecord(r.default) ?? {};
    const ready = r.ready !== false;
    return {
        id,
        name: cleanText(r.name, 60) || id,
        ready,
        why: ready ? '' : code(r.why) || 'other',
        resets: ready ? '' : isoTime(r.resets),
        models, ...(catalogNewer && models.some(m => m.unsure) ? { catalogNewer } : {}), efforts,
        default: { model: modelId(d.model) ?? '', effort: effortId(d.effort) ?? '' },
    };
}

/**
 * `accepts.read.choices`, or null when the research offers none (an older
 * one, not ready, nothing installed). A default naming an agent it does not
 * offer is not a choice the app can show: null. `now`: the research says
 * what an alias runs on (`read.choices.now`), else `nowName` is not read.
 * Untrusted.
 */
export function sanitizeReadChoices(value: unknown, now = false): ReadChoices | null {
    const r = asRecord(value);
    if (!r || !Array.isArray(r.agents)) return null;
    const agents: ReadChoiceAgent[] = [];
    for (const item of r.agents.slice(0, 20)) {
        const a = sanitizeAgent(item, now);
        if (a && !agents.some(x => x.id === a.id)) agents.push(a);
    }
    if (!agents.length) return null;
    const defaults: ReaderChoice[] = [];
    for (const item of Array.isArray(r.default) ? r.default.slice(0, 2) : []) {
        const d = asRecord(item);
        const agent = d ? agents.find(a => a.id === agentId(d.agent)) : undefined;
        if (!d || !agent) return null;
        defaults.push({ agent: agent.id, model: modelId(d.model) ?? agent.default.model, effort: effortId(d.effort) ?? agent.default.effort });
    }
    // None said: the research's agent as its settings say (agents[0]).
    const first = defaults[0] ?? { agent: agents[0].id, ...agents[0].default };
    return { agents, default: [first, defaults[1] ?? { ...first }] };
}

/** What reader `at` (0 the first, 1 the blind one) reads with by default. */
export function readerDefault(choices: ReadChoices, at: number): ReaderChoice {
    return { ...(choices.default[at] ?? choices.default[0]) };
}

/** A reader with an agent just chosen: that agent's own default model and effort. */
export function readerWithAgent(choices: ReadChoices, agent: string): ReaderChoice | null {
    const a = choices.agents.find(x => x.id === agent);
    return a ? { agent: a.id, model: a.default.model, effort: a.default.effort } : null;
}

/** Whether a reader's choice is one the research offers now (its agent, a model and an effort of it). */
export function readerOffered(choices: ReadChoices, r: ReaderChoice): boolean {
    const a = choices.agents.find(x => x.id === r.agent);
    if (!a || !a.models.some(m => m.id === r.model)) return false;
    return a.efforts.length ? a.efforts.includes(r.effort) : r.effort === '';
}

const sameReader = (a: ReaderChoice, b: ReaderChoice): boolean =>
    a.agent === b.agent && a.model === b.model && a.effort === b.effort;

/**
 * The readers for a dialog, from a choice kept in the browser (`read.with`):
 * each reader as kept when the research still offers it, else by default
 * (an agent no longer offered, a model gone). Always `readers` items.
 */
export function readersFromStored(choices: ReadChoices, stored: unknown, readers: number): ReaderChoice[] {
    const list = Array.isArray(stored) ? stored : [];
    const out: ReaderChoice[] = [];
    for (let at = 0; at < Math.max(1, Math.min(2, readers)); at++) {
        const s = asRecord(list[at]);
        const r: ReaderChoice | null = s && agentId(s.agent) && modelId(s.model) !== null && effortId(s.effort) !== null
            ? { agent: s.agent as string, model: s.model as string, effort: s.effort as string } : null;
        out.push(r && readerOffered(choices, r) ? r : readerDefault(choices, at));
    }
    return out;
}

/** Whether the readers differ from the default (the dialog says "changed" and offers to reset). */
export function readersChanged(choices: ReadChoices, chosen: readonly ReaderChoice[]): boolean {
    return chosen.some((r, at) => !sameReader(r, readerDefault(choices, at)));
}

/**
 * `with` for a request: undefined when every reader reads as by default
 * (then nothing is sent — a research reads exactly as before). Otherwise one
 * item per reader up to the last changed one: a reader as by default `{}`,
 * a changed one with all its fields (`''` = as the agent itself is set).
 */
export function readWith(choices: ReadChoices | null | undefined, chosen: readonly ReaderChoice[], readers: number): ReadWithItem[] | undefined {
    if (!choices) return undefined;
    const n = Math.max(1, Math.min(2, readers, chosen.length));
    let last = -1;
    for (let at = 0; at < n; at++) if (!sameReader(chosen[at], readerDefault(choices, at))) last = at;
    if (last < 0) return undefined;
    return chosen.slice(0, last + 1).map((r, at) =>
        sameReader(r, readerDefault(choices, at)) ? {} : { agent: r.agent, model: r.model, effort: r.effort });
}

/** The first chosen reader whose agent cannot read now (Read stays off, the row says why); null: all can. */
export function readerHeld(choices: ReadChoices, chosen: readonly ReaderChoice[]): { at: number; agent: ReadChoiceAgent } | null {
    for (const [at, r] of chosen.entries()) {
        const a = choices.agents.find(x => x.id === r.agent);
        if (a && !a.ready) return { at, agent: a };
    }
    return null;
}

/** `with` as sent, checked again just before it goes out (shape only: the bridge checks against its offer). */
export function cleanWith(value: readonly ReadWithItem[] | undefined, readers: number): ReadWithItem[] | undefined {
    if (!value?.length) return undefined;
    return value.slice(0, Math.max(1, Math.min(2, readers))).map(item => {
        const out: ReadWithItem = {};
        if (item.agent !== undefined && agentId(item.agent)) out.agent = item.agent;
        if (item.model !== undefined && modelId(item.model) !== null) out.model = item.model;
        if (item.effort !== undefined && effortId(item.effort) !== null) out.effort = item.effort;
        return out;
    });
}

// ==================== Who read ====================

/** One reader of a reading as the research says it read. */
export interface ReadWho {
    agent: string;
    /** The agent's name ('' unknown: the id stands in). */
    name: string;
    /** The model ('' = as the agent itself was set: which one the research does not know). */
    model: string;
    /** The model's label (GET read/<id> only; '' = none said). */
    modelName: string;
    /** The effort ('' = as the agent itself was set, or it has none). */
    effort: string;
    /** false: this reader did not run (the blind one of a reading stopped early). */
    ran: boolean;
}

/** `readers.who` / `who`: each reader in order, or undefined (a reading before 059 says none: nothing shown). Untrusted. */
export function sanitizeReadWho(value: unknown): ReadWho[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: ReadWho[] = [];
    for (const item of value.slice(0, 2)) {
        const w = asRecord(item);
        const agent = w ? agentId(w.agent) : '';
        if (!w || !agent) continue;
        const model = modelId(w.model) ?? '';
        out.push({
            agent,
            name: cleanText(w.name, 60) || agent,
            model,
            modelName: model ? cleanText(w.modelName, 60) : '',
            effort: effortId(w.effort) ?? '',
            ran: w.ran !== false,
        });
    }
    return out.length ? out : undefined;
}

/**
 * A reader as one line: "name · model · effort". A reader without a model
 * read as the agent itself is set: `bySettings` (the app's words for it)
 * stands in its place; an effort not said is left out.
 */
export function readWhoLabel(w: Pick<ReadWho, 'name' | 'model' | 'modelName' | 'effort'>, bySettings: string): string {
    const model = w.model ? w.modelName || w.model : bySettings;
    return [w.name, model, w.effort].filter(Boolean).join(' · ');
}

/** Both readers read with the same agent, model and effort (one line for both). */
export function readWhoSame(who: readonly ReadWho[]): boolean {
    return who.length > 1 && who.every(w => w.agent === who[0].agent && w.model === who[0].model && w.effort === who[0].effort);
}

/**
 * The names of the agents that read, when one of them is not the research's
 * own (`researchAgent`): for the reading's line in the research panel. Empty
 * when all read with the research's agent (nothing is added there).
 */
export function readWhoOtherAgents(who: readonly ReadWho[] | undefined, researchAgent: string): string[] {
    if (!who?.length || who.every(w => w.agent === researchAgent)) return [];
    return [...new Set(who.map(w => w.name))];
}

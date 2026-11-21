import { Page } from '@playwright/test';
import { ManagedBridge, UUID, ago, followManaged } from './live-directions-bridge';

/**
 * The runs of the directions (spec 126 U10) on the managing bridge (live-directions-bridge): the
 * research "Kubíčkovi a Malí" with three directions — G0001 with its own run (Claude), G0002 ready
 * to start with 7 tasks, G0003 paused — the general run, the agents Claude (the default) and Codex,
 * and at most 3 runs at once (up to 10). Invented data only.
 */

export const RUNS_GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 21 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Kubíčkovi a Malí',
    '0 @P0001@ INDI', '1 NAME Vojtěch /Kubíček/', '1 SEX M', '1 BIRT', '2 DATE 1852', '1 REFN P0001', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Ludmila /Malá/', '1 SEX F', '1 BIRT', '2 DATE 1856', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Bedřich /Šustr/', '1 SEX M', '1 BIRT', '2 DATE 1830', '1 REFN P0003',
    '0 @P0004@ INDI', '1 NAME Vojtěch /Kubíček/', '1 SEX M', '1 BIRT', '2 DATE 1879', '1 REFN P0004', '1 FAMC @F0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0004@',
    '0 TRLR',
].join('\n');

/** Everything of the runs a research sends, and what the app needs besides (the directions' writes, the queue by pages). */
export const RUN_FEATURES = ['run.lines', 'run.agents', 'run.stop', 'run.limit', 'directions.move', 'queue.page', 'work.link'];

/** Three directions in the order of work: one with its own run, one ready to start, one paused. */
export const RUN_DIRECTIONS: Record<string, unknown>[] = [
    { id: 'G0001', name: 'Kubíčkovi z Dolní Lhoty', state: 'active', direction: 'ancestors', focus: 'P0001', order: 1, tasks: 3, waiting: 0,
        working: true, since: ago(4000), run: 'run-1a07', canStart: false, why: 'running', agent: 'claude' },
    { id: 'G0002', name: 'Malí z Horní Vsi', state: 'active', direction: 'ancestors', focus: 'P0002', order: 2, tasks: 7, waiting: 0,
        working: false, since: ago(3000), canStart: true },
    { id: 'G0003', name: 'Šustrovi', state: 'paused', direction: 'ancestors', focus: 'P0003', order: 3, tasks: 2, waiting: 0,
        reason: 'matriky ještě nejsou online', since: ago(1440), canStart: false, why: 'paused' },
];

/** The general run (the whole queue) and the run of G0001, each in a session. */
export const RUNS: Record<string, unknown>[] = [
    { id: 'run-8f2c', research: null, agent: 'claude', agentName: 'Claude', model: 'opus', since: ago(50), state: 'working',
        session: 'N0141', task: 'T0388', lastStep: 'Hledá křest Vojtěcha Kubíčka v matrice Dolní Lhota 1850–1860', sessions: 3 },
    { id: 'run-1a07', research: 'G0001', agent: 'claude', agentName: 'Claude', since: ago(10), state: 'between',
        session: 'N0142', task: 'T0390', lastStep: 'Hledá oddací záznam Vojtěcha Kubíčka a Ludmily Malé', sessions: 1 },
];

/** The rows of `working[]` of the two runs (each naming its run). */
export const RUN_WORKING: Record<string, unknown>[] = [
    { who: 'claude', since: ago(4), task: 'křest Vojtěcha Kubíčka', person: 'P0001', session: 'N0141', run: 'run-8f2c' },
    { who: 'claude', since: ago(2), task: 'oddací záznam', person: 'P0001', research: 'G0001', session: 'N0142', run: 'run-1a07' },
];

export const RUN_AGENTS: Record<string, unknown>[] = [
    { id: 'claude', name: 'Claude', default: true },
    { id: 'codex', name: 'Codex' },
];

/** Five agents with long names, as a real research sends them (pass as `agents`; the sample keeps two). */
export const RUN_AGENTS_MANY: Record<string, unknown>[] = [
    { id: 'claude', name: 'Claude Code', default: true },
    { id: 'codex', name: 'OpenAI Codex CLI' },
    { id: 'antigravity', name: 'Antigravity CLI' },
    { id: 'opencode', name: 'OpenCode' },
    { id: 'grok', name: 'Grok Build' },
];

/** At most 3 runs at once, the research takes up to 10 (`running` is counted by the bridge). */
export const RUN_LIMITS = { maxRuns: 3, cap: 10 };

/** The queue: tasks of G0001 (its run takes them), seven of G0002, two of the paused G0003, two of no direction. */
export const RUN_QUEUE: Record<string, unknown>[] = [
    { id: 'T0390', text: 'Oddací záznam Vojtěcha Kubíčka', state: 'next', research: 'G0001', person: 'P0001', run: 'run-1a07' },
    { id: 'T0391', text: 'Křest Ludmily Malé', state: 'next', research: 'G0002', person: 'P0002' },
    { id: 'T0392', text: 'Sčítání lidu 1880, Dolní Lhota', state: 'next' },
    { id: 'T0393', text: 'Úmrtí Vojtěcha Kubíčka', state: 'next', research: 'G0001', person: 'P0001', run: 'run-1a07' },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `T04${String(i).padStart(2, '0')}`, text: `Matrika Horní Ves, svazek ${i + 1}`,
        state: 'next', research: 'G0002', person: 'P0002' })),
    { id: 'T0410', text: 'Šustrovi v pozemkové knize', state: 'next', research: 'G0003', person: 'P0003' },
    { id: 'T0411', text: 'Šustrovi v matrice', state: 'next', research: 'G0003', person: 'P0003' },
    { id: 'T0412', text: 'Fotografie domu čp. 12', state: 'next' },
    { id: 'T0388', text: 'Křest Vojtěcha Kubíčka', state: 'next', person: 'P0001' },
    { id: 'T0420', text: 'Odložený úkol', state: 'parked', research: 'G0002' },
];

/** A run of G0003 that ended a moment ago (`runsEnded`), stopped by hand. */
export const runEnded = (secondsAgo = 20): Record<string, unknown> => ({
    id: 'run-5b20', research: 'G0003', agent: 'codex', since: ago(90), ended: new Date(Date.now() - secondsAgo * 1000).toISOString(), why: 'stopped',
});

/** Follow "Kubíčkovi a Malí" with its runs; any option of followManaged replaces the sample's. */
export function followRuns(page: Page, opts: Parameters<typeof followManaged>[1] = {}): Promise<ManagedBridge> {
    return followManaged(page, {
        ged: RUNS_GED, researches: RUN_DIRECTIONS, working: RUN_WORKING, queue: RUN_QUEUE, paged: true,
        features: RUN_FEATURES, runs: RUNS, runsEnded: [], limits: RUN_LIMITS, agents: RUN_AGENTS,
        work: { gate: null, minutes: 0, confirm: 'ask' }, treeName: 'Kubíčkovi a Malí', links: ['work'], ...opts,
    });
}

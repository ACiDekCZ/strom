/**
 * The research in the Table view, live and in the export (spec 073 §16.6,
 * §16.7): the agent's bar on the name and ✓ for AGENT_DONE_MS, only while
 * the research is followed; the CSV with the research's words and counts
 * (no marks), the live-only columns empty while the research is not
 * followed, and when the toast says so. Invented data only
 * (e2e/fixtures/research-table.ged).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { setLanguage } from '../strings.js';
import { AGENT_DONE_MS } from '../card-signals.js';
import type { Person, StromData } from '../types.js';
import {
    applyResearch, researchAgentRow, researchCell, researchOffer, researchTableEnv, type ResearchTableInput,
} from '../ui/table-view/table-research.js';
import { columnById, setResearchOffer, type ColumnDef } from '../ui/table-view/table-columns.js';
import { buildTableModel, type TableModel } from '../ui/table-view/table-model.js';
import { buildTableCsv, exportsNotLive, exportText } from '../ui/table-view/table-export.js';
import { agentRowHtml } from '../ui/table-view/table-grid.js';

const GED = readFileSync(join(__dirname, '../../e2e/fixtures/research-table.ged'), 'utf8');
const NOW = Date.parse('2026-11-10T12:00:00Z');

const data: StromData = convertToStrom(parseGedcom(GED)).data;
const P = (refn: string): Person => Object.values(data.persons).find(p => p.refn === refn)!;

const base: ResearchTableInput = {
    kind: 'research', live: true, now: NOW,
    working: [{ person: 'P0003', task: 'Křest Josefa', who: 'agent' }],
    queue: [{ state: 'next', person: 'P0005', text: 'a' }, { state: 'next', person: 'P0005', text: 'b' }],
    done: new Map([['P0013', NOW - 1000], ['P0012', NOW - AGENT_DONE_MS]]),
};

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setLanguage('cs');
});
afterAll(() => {
    vi.useRealTimers();
    setLanguage('en');
});
afterEach(() => setResearchOffer({}));

describe('the agent on the name (§16.6)', () => {
    it('at work: the task; done: ✓ until AGENT_DONE_MS; else nothing', () => {
        const env = researchTableEnv(data, base);
        expect(researchAgentRow(env, P('P0003'))).toEqual({ kind: 'working', task: 'Křest Josefa' });
        expect(researchAgentRow(env, P('P0013'))).toEqual({ kind: 'done' });
        // Exactly AGENT_DONE_MS after: gone.
        expect(researchAgentRow(env, P('P0012'))).toBeNull();
        // Queued only: no bar.
        expect(researchAgentRow(env, P('P0005'))).toBeNull();
    });

    it('only while following, never in a read-only copy or an archive', () => {
        expect(researchAgentRow(researchTableEnv(data, { ...base, live: false }), P('P0003'))).toBeNull();
        expect(researchAgentRow(researchTableEnv(data, { ...base, readOnly: true }), P('P0003'))).toBeNull();
        expect(researchAgentRow(researchTableEnv(data, { ...base, kind: 'archive' }), P('P0003'))).toBeNull();
    });

    it('the bar: a track with a running segment in the shared phase; ✓ when done; nothing else', () => {
        const bar = agentRowHtml({ kind: 'working', task: 'x' });
        expect(bar).toMatch(/^<span class="tv-agent-bar" aria-hidden="true"><span class="tv-agent-run" style="animation-delay:-?\d+(\.\d+)?ms"><\/span><\/span>$/);
        expect(agentRowHtml({ kind: 'done' })).toContain('tv-rmark--done');
        expect(agentRowHtml({ kind: 'done' })).toContain('✓');
        expect(agentRowHtml(null)).toBe('');
    });
});

describe('the export (§16.7, 16za)', () => {
    const COLS = ['name', 'rSum', 'rWait', 'rConf', 'rHyp', 'rAgent', 'rTasks', 'rLine'];

    function modelWith(input: ResearchTableInput): { m: TableModel; columns: ColumnDef[] } {
        const env = researchTableEnv(data, input);
        setResearchOffer(researchOffer(env));
        const m = buildTableModel(data, { rev: 1, homeId: null, lang: 'cs', year: 2026 });
        applyResearch(m, env);
        const columns = COLS.map(id => columnById('persons', id)).filter((c): c is ColumnDef => !!c);
        return { m, columns };
    }

    function csvLines(input: ResearchTableInput, refns: string[]): string[][] {
        const { m, columns } = modelWith(input);
        const rows = refns.map(r => m.persons.find(x => x.person.refn === r)!);
        const csv = buildTableCsv({ model: m, type: 'persons', rows, columns }).csv;
        return csv.replace(/^﻿/, '').trim().split('\r\n').map(l => l.split(';'));
    }

    it('text and counts, no marks: the summary, the conflicts, the agent, the tasks, the line', () => {
        const [head, josef, matej, marie] = csvLines(base, ['P0003', 'P0005', 'P0006']);
        expect(head).toEqual(['Celé jméno', 'Výzkum', 'Čeká na rozhodnutí', 'Rozpory', 'Hypotézy', 'Agent', 'Úkoly výzkumu', 'Linie']);
        expect(josef[5]).toBe('pracuje: Křest Josefa');
        expect(josef[6]).toBe('1: právě běží');
        expect(matej[1]).toBe('ve frontě');
        expect(matej[6]).toBe('2: nejbližší 1. ve frontě');
        expect(marie[1]).toBe('rozpor (1)');
        expect(marie[3]).toBe('1: narození');
        // Counting columns write 0 where the table shows nothing.
        expect(josef[3]).toBe('0');
        expect(josef[4]).toBe('0');
        expect(josef[7]).toMatch(/^G0001 /);
        for (const line of [josef, matej, marie]) for (const field of line) expect(field).not.toMatch(/[≠✓!?]/u);
    });

    it('the live-only columns go out empty while the research is not followed, and the toast says so', () => {
        const off = { ...base, live: false };
        const [, josef] = csvLines(off, ['P0003']);
        expect(josef[5]).toBe('');
        expect(josef[6]).toBe('');
        const { m, columns } = modelWith(off);
        expect(exportsNotLive(m, m.persons, columns)).toBe(true);
        const live = modelWith(base);
        expect(exportsNotLive(live.m, live.m.persons, live.columns)).toBe(false);
        // Without the live-only columns nothing is said.
        expect(exportsNotLive(m, m.persons, columns.filter(c => c.id !== 'rAgent' && c.id !== 'rTasks'))).toBe(false);
    });

    it('a research cell writes its export, any other cell its text', () => {
        const env = researchTableEnv(data, base);
        expect(exportText(researchCell(env, P('P0005'), 'rTasks'))).toBe('2: nejbližší 1. ve frontě');
        expect(exportText({ text: '1850', sortKey: 1850, empty: false, na: false, subst: null, computed: false, approx: false, uncertain: false })).toBe('1850');
    });
});

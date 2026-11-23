/**
 * The Statistics window (spec 138): opening it on the open tree, the topics
 * and their options (sex, first or every name, surnames, decade or month),
 * search, sort, the total and "Not given", the scope (a family line, a direct
 * line, a list, a birth period and their combination), Export CSV, the empty
 * and busy states, a tree that is not open, a row's click (the event the
 * Table takes over) and the look in German at 1440, 1024 and 390 px wide,
 * light and dark, with a long tree name. Invented names only (Ostrožný,
 * Pětioký, Vochomůrka; Mezihoř, Hrabětice, Žabokřiky).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openApp } from './helpers';

type P = Record<string, unknown>;

/** Screenshots of the look check go to the package's folder (never test-results/, wiped at a run's start). */
const SHOTS = join(homedir(), 'Projects/strom-dirigent/prace/1123-app-138-statistiky/snimky');

interface Spec {
    first: string; last: string; sex: 'male' | 'female' | 'unknown';
    born?: string; died?: string; bornAt?: string; married?: string; parents?: string[]; occ?: string[]; placeholder?: boolean;
}

/** The Ostrožný family of Mezihoř and the Pětioký family of Hrabětice. */
function family(): { persons: Record<string, P>; partnerships: Record<string, P>; defaultPersonId: string; personLists: P[] } {
    const people: Record<string, Spec> = {
        jan: { first: 'Jan', last: 'Ostrožný', sex: 'male', born: '1840-02-10', died: '1904-02-09', bornAt: 'Mezihoř', occ: ['rolník'] },
        marie: { first: 'Marie', last: 'Vochomůrková', sex: 'female', born: '1845-01-10', bornAt: 'Mezihoř 12', married: 'Ostrožná' },
        jan2: { first: 'Jan Karel', last: 'Ostrožný', sex: 'male', born: '1866-05-01', bornAt: 'mezihoř', parents: ['jan', 'marie'], occ: ['Rolník', 'kovář'] },
        anna: { first: 'Anna', last: 'Ostrožná', sex: 'female', born: '1868', parents: ['jan', 'marie'], married: 'Pětioká' },
        josef: { first: 'Josef', last: 'Pětioký', sex: 'male', born: '1865-03-03', bornAt: 'Hrabětice' },
        josef2: { first: 'Josef', last: 'Pětioký', sex: 'male', born: '1891-03-04', bornAt: 'Žabokřiky', parents: ['josef', 'anna'] },
        jan3: { first: 'Jan', last: 'Pětioký', sex: 'male', born: '1893-07-07', bornAt: 'Hrabětice', parents: ['josef', 'anna'] },
        noname: { first: '', last: 'Vochomůrka', sex: 'male', born: '1895-01-01' },
        josef3: { first: 'Josef', last: 'Ostrožný', sex: 'male', born: '1869-11-02', bornAt: 'Žabokřiky', parents: ['jan', 'marie'] },
        marie2: { first: 'Marie', last: 'Ostrožná', sex: 'female', born: '1871-04-05', bornAt: 'Mezihoř', parents: ['jan', 'marie'] },
        ghost: { first: 'Jan', last: 'Ostrožný', sex: 'male', placeholder: true, born: '1800' },
    };
    const persons: Record<string, P> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id, firstName: s.first, lastName: s.last, gender: s.sex, isPlaceholder: s.placeholder === true,
            partnerships: [], parentIds: s.parents ?? [], childIds: [],
            ...(s.born ? { birthDate: s.born } : {}), ...(s.died ? { deathDate: s.died } : {}),
            ...(s.bornAt ? { birthPlace: s.bornAt } : {}), ...(s.married ? { marriedSurname: s.married } : {}),
            ...(s.occ ? { events: s.occ.map((note, i) => ({ id: `${id}-o${i}`, type: 'occupation', note })) } : {}),
        };
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds as string[]) (persons[par].childIds as string[]).push(p.id as string);
    const partnerships: Record<string, P> = {};
    const union = (uid: string, a: string, b: string, kids: string[], extra: P): void => {
        partnerships[uid] = { id: uid, person1Id: a, person2Id: b, childIds: kids, status: 'married', ...extra };
        (persons[a].partnerships as string[]).push(uid);
        (persons[b].partnerships as string[]).push(uid);
    };
    union('u1', 'jan', 'marie', ['jan2', 'anna', 'josef3', 'marie2'], { startDate: '1864-06-01', startPlace: 'Mezihoř' });
    union('u2', 'josef', 'anna', ['josef2', 'jan3'], { startDate: '1890', startPlace: 'Hrabětice' });
    const personLists = [{ id: 'l1', name: 'Pětiocí', dynamic: false, personIds: ['josef', 'josef2', 'jan3'], sort: 'manual', updated: '2026-11-01T10:00:00Z' }];
    return { persons, partnerships, defaultPersonId: 'jan2', personLists };
}

async function importTree(page: Page, name: string, focus = 'jan2'): Promise<string> {
    return page.evaluate(async ({ data, name, focus }) => {
        const S = window.Strom;
        const id = await S.DataManager.importAsNewTree(data as never, name);
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(focus as never);
        await S.TreeRenderer.renderAsync();
        return id as string;
    }, { data: family(), name, focus });
}

async function setup(page: Page, width = 1440, height = 900, name = 'Ostrožní'): Promise<string> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    return importTree(page, name);
}

/** The open tree's Statistics; waits for the first table. */
async function openStats(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showActiveTreeStats());
    const win = page.locator('#tree-stats-modal .modal.stv');
    await expect(win).toBeVisible();
    await expect(win.locator('.stv-table')).toBeVisible();
    return win;
}

/** The value column of the shown rows, top to bottom. */
async function values(win: Locator): Promise<string[]> {
    return win.locator('.stv-vbody .stv-row').evaluateAll(rows => rows.map(r => {
        const v = r.querySelector('.stv-val');
        const clone = v?.cloneNode(true) as HTMLElement | undefined;
        clone?.querySelectorAll('.v2').forEach(x => x.remove());
        return `${clone?.textContent ?? ''}=${r.querySelector('.stv-n')?.textContent ?? ''}`;
    }));
}

const topic = (win: Locator, id: string): Locator => win.locator(`.stv-topic[data-topic="${id}"]`);
const opt = (win: Locator, attr: string, v: string): Locator => win.locator(`.stv-opts .sel-opt[data-${attr}="${v}"]`);

test.describe('Statistics window', () => {
    test('opens on first names of men, topics with their numbers, Not given and the total @smoke', async ({ page }) => {
        await setup(page);
        const win = await openStats(page);
        await expect(win.locator('.stv-title')).toContainText('Statistics: Ostrožní');
        await expect(topic(win, 'firstNames')).toHaveAttribute('aria-current', 'true');
        await expect(topic(win, 'firstNames')).toBeFocused();
        // The placeholder counts nowhere: men Jan ×3 (Jan, Jan Karel, Jan Pětioký), Josef ×3, one without a name.
        await expect.poll(() => values(win)).toEqual(['Jan=3', 'Josef=3']);
        await expect(opt(win, 'sex', 'male')).toContainText('7');
        await expect(opt(win, 'sex', 'female')).toContainText('3');
        await expect(win.locator('.stv-none-row')).toContainText('Not given');
        await expect(win.locator('.stv-none-row .stv-n')).toHaveText('1');
        await expect(win.locator('.stv-total')).toHaveText('Total 7 people · 2 values');
        await expect(win.locator('.stv-count')).toHaveText('10 people');
        // The other topics' numbers come one by one; religions have none ("–", faint).
        await expect(topic(win, 'religions').locator('.stv-topic-n')).toHaveText('–');
        await expect(topic(win, 'religions')).toHaveClass(/is-empty/);
        await expect(topic(win, 'occupations').locator('.stv-topic-n')).toHaveText('2');
        await expect(win.locator('.stv-foot-what')).toHaveText('Saves the table: First names – men, first name · whole tree');
        // Escape closes; the window is gone.
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-stats-modal')).toHaveCount(0);
    });

    test('options: every name, women (Not given hidden at 0), surnames with married ones, births by month', async ({ page }) => {
        await setup(page);
        const win = await openStats(page);
        await opt(win, 'names', 'each').click();
        await expect(opt(win, 'names', 'each')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => values(win)).toEqual(['Jan=3', 'Josef=3', 'Karel=1']);
        await expect(win.locator('.stv-total')).toHaveText('Total 7 people · 7 name uses · 3 values');
        await expect(win.locator('.stv-note')).toContainText('more than 100 %');
        await opt(win, 'sex', 'female').click();
        await expect.poll(() => values(win)).toEqual(['Marie=2', 'Anna=1']);
        await expect(win.locator('.stv-none-row')).toHaveCount(0);

        await topic(win, 'surnames').click();
        await expect(win.locator('.stv-th-t')).toHaveText('Surnames');
        // Ostrožný/Ostrožná together under the more used form, the other as "also".
        await expect(win.locator('.stv-vbody .stv-row').first()).toContainText('Ostrožný');
        const before = await values(win);
        await opt(win, 'surnames', 'withMarried').click();
        await expect(win.locator('.stv-th-d')).toHaveText('Birth and married surnames');
        await expect.poll(() => values(win)).not.toEqual(before);

        await topic(win, 'births').click();
        await expect.poll(() => values(win)).toEqual(['1840–1849=2', '1860–1869=4', '1870–1879=1', '1890–1899=3']);
        await opt(win, 'births', 'month').click();
        await expect(win.locator('.stv-hrow')).toContainText('Month');
        // Months known: Jan, Feb, Mar, Apr, May, Jul, Nov (1868 has no month).
        await expect(win.locator('.stv-vbody .stv-row')).toHaveCount(7);
        // The state lasts until the window closes: back on first names, women and every name stay.
        await topic(win, 'firstNames').click();
        await expect(opt(win, 'sex', 'female')).toHaveAttribute('aria-pressed', 'true');
        await expect(opt(win, 'names', 'each')).toHaveAttribute('aria-pressed', 'true');
    });

    test('places unify spellings, no level without a hierarchy; occupations count each', async ({ page }) => {
        await setup(page);
        const win = await openStats(page);
        await topic(win, 'birthPlaces').click();
        // "Mezihoř", "Mezihoř 12" and "mezihoř" are one town with three spellings.
        const first = win.locator('.stv-vbody .stv-row').first();
        await expect(first.locator('.stv-val')).toContainText('Mezihoř');
        await expect(first.locator('.stv-n')).toHaveText('4');
        await expect(first.locator('.v2')).toHaveText('3 spellings');
        await expect(win.locator('.stv-opts .sel-opt[data-level]')).toHaveCount(0);
        await expect(win.locator('.stv-total')).toContainText('Total 10 people');
        await topic(win, 'occupations').click();
        await expect.poll(() => values(win)).toEqual(['rolník=2', 'kovář=1']);
    });

    test('search marks the hits, hides Not given and says the total; sort by the segment and by the column head', async ({ page }) => {
        await setup(page);
        const win = await openStats(page);
        await win.locator('.stv-search').fill('jo');
        await expect(win.locator('.stv-matches')).toHaveText('1 match');
        await expect.poll(() => values(win)).toEqual(['Josef=3']);
        await expect(win.locator('.stv-vbody mark')).toHaveText('Jo');
        await expect(win.locator('.stv-none-row')).toBeHidden();
        await expect(win.locator('.stv-total')).toHaveText('Search “jo”: 1 of 2 values · 3 people');
        await win.locator('.stv-search').fill('');
        await expect(win.locator('.stv-none-row')).toBeVisible();

        // A–Z by the segment, then by count by the column head.
        await win.locator('.stv-sortbox .sel-opt[data-sort="name"]').click();
        await expect(win.locator('.stv-hrow [role="columnheader"]').first()).toHaveAttribute('aria-sort', 'ascending');
        await expect.poll(() => values(win)).toEqual(['Jan=3', 'Josef=3']);
        await topic(win, 'births').click();
        await win.locator('.stv-hsort[data-hsort="count"]').click();
        await expect(win.locator('.stv-hrow [role="columnheader"]').nth(1)).toHaveAttribute('aria-sort', 'descending');
        await expect.poll(() => values(win)).toEqual(['1860–1869=4', '1890–1899=3', '1840–1849=2', '1870–1879=1']);
        await expect(win.locator('.stv-sortbox .sel-opt[data-sort="count"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('scope: a family line, a direct line, a list, a period and a line with a period', async ({ page }) => {
        await setup(page);
        const win = await openStats(page);
        const btn = win.locator('.stv-scope-btn');
        await expect(btn).toHaveText(/Whole tree/);

        // The Ostrožný line.
        await btn.click();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        const pick = page.locator('#tree-stats-modal .stv-scope-pick .sp-rodpick-pop');
        await expect(pick).toBeVisible();
        await pick.locator('.sp-rodpick-q').fill('Ostro');
        await pick.locator('li[data-sel^="rod:"] .sp-rodpick-a').filter({ hasText: 'Ostrožný' }).first().click();
        await expect(pick).toHaveCount(0);
        await expect(btn).toHaveText(/Ostrožný line/);
        await expect(win.locator('.stv-count')).not.toHaveText('10 people');
        const lineCount = await win.locator('.stv-count').textContent();

        // The line born 1868 and later: Anna, Josef, Marie.
        await win.locator('.stv-year[data-year="from"]').fill('1868');
        await win.locator('.stv-year[data-year="from"]').press('Enter');
        await expect(win.locator('.stv-year-x')).toBeVisible();
        await expect(win.locator('.stv-count')).toHaveText('3 people');
        await expect.poll(() => values(win)).toEqual(['Josef=1']);
        await expect(win.locator('.stv-foot-what')).toContainText('Ostrožný line, born from 1868');
        // An invalid period is marked and changes nothing.
        await win.locator('.stv-year[data-year="to"]').fill('1800');
        await win.locator('.stv-year[data-year="to"]').press('Enter');
        await expect(win.locator('.stv-year[data-year="to"]')).toHaveAttribute('aria-invalid', 'true');
        await expect(win.locator('.stv-count')).toHaveText('3 people');
        await win.locator('.stv-year-x').click();
        await expect(win.locator('.stv-count')).toHaveText(lineCount ?? '');
        await expect(win.locator('.stv-year[data-year="to"]')).toHaveValue('');

        // A list.
        await btn.click();
        await pick.locator('.sp-rodpick-q').fill('Pětiocí');
        await pick.locator('li[data-sel^="list:"]:not([hidden]) .sp-rodpick-a').filter({ hasText: 'Pětiocí' }).click();
        await expect(btn).toHaveText(/List: Pětiocí/);
        await expect(win.locator('.stv-count')).toHaveText('3 people');

        // The direct line of the person in focus (Jan Karel): his parents and him.
        await btn.click();
        await pick.locator('li[data-sel^="direct:"] .sp-rodpick-a').first().click();
        await expect(btn).toHaveText(/Direct line: Jan Karel Ostrožný/);
        await expect(win.locator('.stv-count')).toHaveText('3 people');

        // The whole tree again.
        await btn.click();
        await pick.locator('li[data-sel="none"] .sp-rodpick-a').first().click();
        await expect(win.locator('.stv-count')).toHaveText('10 people');
    });

    test('a period without people: the empty sentence with Clear the period; a topic without data', async ({ page }) => {
        await setup(page);
        const win = await openStats(page);
        await win.locator('.stv-year[data-year="from"]').fill('1950');
        await win.locator('.stv-year[data-year="from"]').press('Enter');
        await expect(win.locator('.stv-empty')).toContainText('Nobody is in the scope whole tree, born from 1950.');
        await expect(topic(win, 'surnames').locator('.stv-topic-n')).toHaveText('–');
        await expect(win.locator('.stv-btn[data-stv="export"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(win.locator('.stv-foot-what')).toHaveText('Nothing to save');
        await win.locator('.stv-empty .tov-link').click();
        await expect(win.locator('.stv-count')).toHaveText('10 people');
        await topic(win, 'religions').click();
        await expect(win.locator('.stv-empty')).toHaveText('Nobody in the tree has a religion recorded.');
        await expect(win.locator('.stv-tools')).toBeHidden();
        // People out of the period without a birth year are counted under the scope row.
        await page.evaluate(() => {
            const S = window.Strom;
            S.DataManager.getData().persons['noname' as never].birthDate = undefined as never;
        });
        await win.locator('.stv-year[data-year="from"]').fill('1800');
        await win.locator('.stv-year[data-year="from"]').press('Enter');
        await expect(win.locator('.stv-scope-note')).toHaveText('1 person without a birth year is outside the period.');
    });

    test('calculating: the table waits, Export waits', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const w = window as unknown as { requestIdleCallback: unknown; setTimeout: unknown };
            w.requestIdleCallback = () => 0;
        });
        await page.evaluate(() => window.Strom.UI.showActiveTreeStats());
        const win = page.locator('#tree-stats-modal .modal.stv');
        await expect(win.locator('.stv-busy')).toBeVisible();
        await expect(win.locator('.stv-busy')).toContainText('Calculating…');
        await expect(win.locator('.stv-btn[data-stv="export"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(win.locator('.stv-foot-what')).toHaveText('Saves the table once it is computed');
    });

    test('Export CSV saves the table as shown under the tree’s name', async ({ page }) => {
        await setup(page);
        const win = await openStats(page);
        const [download] = await Promise.all([page.waitForEvent('download'), win.locator('.stv-btn[data-stv="export"]').click()]);
        const name = download.suggestedFilename();
        expect(name).toMatch(/^Ostrozni_Statistics-First-names_\d{4}-\d{2}-\d{2}\.csv$/);
        const csv = readFileSync(await download.path(), 'utf8');
        const lines = csv.replace(/^﻿/, '').split('\r\n');
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
        // The description line is one quoted field.
        expect(lines[0]).toMatch(/^"Statistics: First names – men, first name · Scope: whole tree · Tree: Ostrožní · .+"$/);
        expect(lines.slice(1)).toEqual(['Value;Count;Share %', 'Jan;3;50.0', 'Josef;3;50.0', 'Not given;1;', 'Total;7;', '']);
        await expect(page.locator('.toast, .toast-container').filter({ hasText: `Saved: ${name}` }).first()).toBeVisible();
    });

    test('a row’s click sends its people and the way back, and closes the window; keyboard on rows and topics', async ({ page }) => {
        await setup(page);
        const win = await openStats(page);
        // ↓ moves among the topics.
        await page.keyboard.press('ArrowDown');
        await expect(topic(win, 'surnames')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(win.locator('.stv-th-t')).toHaveText('Surnames');
        await topic(win, 'firstNames').click();
        await page.evaluate(() => {
            window.addEventListener('strom:stats-row-open', (e) => {
                (window as unknown as { __rowOpen: unknown }).__rowOpen = (e as CustomEvent).detail;
            }, { once: true });
        });
        const row = win.locator('.stv-vbody .stv-row').first();
        await row.focus();
        await page.keyboard.press('ArrowDown');
        await expect(win.locator('.stv-vbody .stv-row').nth(1)).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('#tree-stats-modal')).toHaveCount(0);
        const got = await page.evaluate(() => (window as unknown as { __rowOpen: { ids: string[]; label: string; back: { topic: string } } }).__rowOpen);
        expect(got.ids.sort()).toEqual(['josef', 'josef2', 'josef3']);
        expect(got.label).toBe('Statistics: first name Josef');
        expect(got.back.topic).toBe('firstNames');
    });

    test('a tree that is not open is read only: rows are no links', async ({ page }) => {
        const first = await setup(page);
        await importTree(page, 'Vochomůrkovi');
        await page.evaluate((id) => window.Strom.UI.showTreeStats(id), first);
        const win = page.locator('#tree-stats-modal .modal.stv');
        await expect(win.locator('.stv-table')).toBeVisible();
        await expect(win.locator('.stv-readonly')).toBeVisible();
        await expect(win.locator('.stv-vbody .stv-row.is-link')).toHaveCount(0);
        await expect(win.locator('.stv-vbody .stv-row').first()).not.toHaveAttribute('tabindex', /.*/);
    });
});

test.describe('Statistics window on a phone', () => {
    test('Topic and Scope as sheets, rows of 44 px, period with Done', async ({ page }) => {
        await setup(page, 390, 844);
        const win = await openStats(page);
        await expect(win.locator('.stv-topics')).toBeHidden();
        await expect(win.locator('.stv-scope')).toBeHidden();
        await expect(win.locator('.stv-sub')).toHaveText('Ostrožní · 10 people');
        const row = await win.locator('.stv-vbody .stv-row').first().boundingBox();
        expect(row!.height).toBeGreaterThanOrEqual(44);
        await win.locator('.stv-pbtn[data-stv="topic-sheet"]').click();
        const sheet = page.locator('.stv-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('[data-topic="firstNames"]')).toHaveAttribute('aria-current', 'true');
        await sheet.locator('[data-topic="births"]').click();
        await expect(sheet).toHaveCount(0);
        await expect(win.locator('.stv-pbtn[data-stv="topic-sheet"]')).toHaveText(/Topic: Births over time/);

        await win.locator('.stv-pbtn[data-stv="scope-sheet"]').click();
        await expect(sheet).toBeVisible();
        await sheet.locator('.stv-year[data-year="from"]').fill('1860');
        await sheet.locator('.stv-year[data-year="to"]').fill('1870');
        await sheet.locator('.stv-sheet-done').click();
        await expect(sheet).toHaveCount(0);
        await expect(win.locator('.stv-pbtn[data-stv="scope-sheet"]')).toHaveText(/Scope: Whole tree, born 1860–1870/);
        await expect(win.locator('.stv-sub')).toHaveText('Ostrožní · 4 people');

        // A family line from the sheet's choice.
        await win.locator('.stv-pbtn[data-stv="scope-sheet"]').click();
        await sheet.locator('[data-scope-kind="rods"]').click();
        const pick = page.locator('.rod-pick-sheet');
        await expect(pick).toBeVisible();
        await pick.locator('li[data-sel^="rod:"] .sp-rodpick-a').filter({ hasText: 'Ostrožný' }).first().click();
        await expect(pick).toHaveCount(0);
        await expect(win.locator('.stv-pbtn[data-stv="scope-sheet"]')).toHaveText(/Ostrožný line, born 1860–1870/);
    });
});

/** Visible elements of the window that hold more than their width, and pairs of siblings that overlap. */
async function layoutProblems(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const out: string[] = [];
        const shown = (el: Element): boolean => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const name = (el: Element): string => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
        if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth}`);
        const boxes = ['.modal.stv', '.stv-head', '.stv-titlebar', '.stv-title', '.stv-sub', '.stv-scope', '.stv-pbtns', '.stv-body', '.stv-topics',
            '.stv-main', '.stv-th', '.stv-opts', '.stv-opt', '.stv-tools', '.stv-table', '.stv-hrow', '.stv-sum', '.stv-total', '.stv-note', '.stv-foot',
            '.stv-vbody .stv-row', '.stv-topic', '.stv-seg > .sel-opt', '.stv-pbtn', '.stv-btn', '.stv-foot-close', '.stv-scope-btn'];
        for (const sel of boxes) {
            for (const el of document.querySelectorAll<HTMLElement>(`#tree-stats-modal ${sel}`)) {
                // A text cut with an ellipsis is cut on purpose.
                if (!shown(el) || getComputedStyle(el).textOverflow === 'ellipsis') continue;
                if (el.scrollWidth > el.clientWidth + 1) out.push(`${name(el)} overflows: ${el.scrollWidth} > ${el.clientWidth}`);
            }
        }
        const rows = ['.stv-titlebar', '.stv-head', '.stv-scope', '.stv-pbtns', '.stv-opts', '.stv-tools', '.stv-foot', '.stv-hrow', '.stv-vbody .stv-row',
            '.stv-th', '.stv-period', '.stv-seg'];
        for (const sel of rows) {
            for (const box of document.querySelectorAll<HTMLElement>(`#tree-stats-modal ${sel}`)) {
                if (!shown(box)) continue;
                const kids = [...box.children].filter(shown);
                const outer = box.getBoundingClientRect();
                for (let i = 0; i < kids.length; i++) {
                    const a = kids[i].getBoundingClientRect();
                    if (a.left < outer.left - 1 || a.right > outer.right + 1) out.push(`${name(kids[i])} sticks out of ${name(box)}`);
                    for (let j = i + 1; j < kids.length; j++) {
                        const b = kids[j].getBoundingClientRect();
                        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                        if (w > 1 && h > 1) out.push(`${name(kids[i])} overlaps ${name(kids[j])} in ${name(box)}`);
                    }
                }
            }
        }
        // The × stays on the title's row (the bar of the phone held sideways does not wrap it below).
        const title = document.querySelector('#tree-stats-modal .stv-title')?.getBoundingClientRect();
        const close = document.querySelector('#tree-stats-modal .stv-close')?.getBoundingClientRect();
        if (title && close && close.top >= title.bottom) out.push('the × is below the title');
        return out;
    });
}

test.describe('Statistics window: the look', () => {
    const SIZES: Array<[number, number]> = [[1440, 900], [1024, 768], [390, 844], [844, 390]];
    for (const theme of ['light', 'dark'] as const) {
        for (const [w, h] of SIZES) {
            test(`German, ${w}×${h}, ${theme}: nothing overflows or overlaps`, async ({ page }) => {
                await setup(page, w, h, 'Ostrožní a Pětiocí z Mezihoře');
                await page.evaluate(t => {
                    window.Strom.UI.setLanguage('de' as never);
                    window.Strom.SettingsManager.setTheme(t);
                }, theme);
                await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
                const win = await openStats(page);
                await expect(win.locator('.stv-total')).toContainText('Insgesamt');
                await expect(win.locator('.stv-topic[data-topic="religions"] .stv-topic-n, .stv-topic-n').last()).not.toHaveText('');
                expect(await layoutProblems(page)).toEqual([]);
                await page.screenshot({ path: join(SHOTS, `stv-de-${w}x${h}-${theme}.png`) });
                // Every name and a place topic with longer labels.
                await win.locator('.stv-opts .sel-opt[data-names="each"]').click();
                expect(await layoutProblems(page)).toEqual([]);
                if (w > 640 && h > 500) {
                    await win.locator('.stv-topic[data-topic="birthPlaces"]').click();
                    await win.locator('.stv-scope-btn').click();
                    await expect(page.locator('.stv-scope-pick .sp-rodpick-pop')).toBeVisible();
                    await page.screenshot({ path: join(SHOTS, `stv-de-${w}x${h}-${theme}-rozsah.png`) });
                    await page.keyboard.press('Escape');
                    await expect(page.locator('.stv-scope-pick')).toHaveCount(0);
                    await win.locator('.stv-year[data-year="from"]').fill('1860');
                    await win.locator('.stv-year[data-year="from"]').press('Enter');
                    await expect(win.locator('.stv-year-x')).toBeVisible();
                    expect(await layoutProblems(page)).toEqual([]);
                    await page.screenshot({ path: join(SHOTS, `stv-de-${w}x${h}-${theme}-obdobi.png`) });
                } else {
                    await win.locator('.stv-pbtn[data-stv="topic-sheet"]').click();
                    await expect(page.locator('.stv-sheet')).toBeVisible();
                    await page.screenshot({ path: join(SHOTS, `stv-de-${w}x${h}-${theme}-tema.png`) });
                    await page.locator('.stv-sheet-x').click();
                    await win.locator('.stv-pbtn[data-stv="scope-sheet"]').click();
                    await expect(page.locator('.stv-sheet')).toBeVisible();
                    await page.screenshot({ path: join(SHOTS, `stv-de-${w}x${h}-${theme}-rozsah.png`) });
                }
            });
        }
    }
});

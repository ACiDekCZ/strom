/**
 * The Statistics window (spec 138): opening it on the open tree, the topics
 * and their options (sex, first or every name, surnames, decade or month),
 * search, sort, the total and "Not given", the scope (a family line, a direct
 * line, a list, a birth period and their combination), Export CSV, the empty
 * and busy states, a tree that is not open, a row's click (the event the
 * Table takes over) and the look in German at 1440, 1024 and 390 px wide,
 * light and dark, with a long tree name. Then the ways in and out: Actions ›
 * Tree, the overview's In detail, the phone's More sheet, a value's people
 * in the Table with the chip "Statistics: …", Back to Statistics, the
 * chip's × and Save as list of people. Invented names only (Ostrožný,
 * Pětioký, Vochomůrka; Mezihoř, Hrabětice, Žabokřiky).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openApp, openTreeActions } from './helpers';

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

test.describe('Statistics window: the birth period fields', () => {
    for (const [w, h] of [[1440, 900], [1024, 768]] as const) {
        test(`German, ${w}×${h}: year fields 66 px wide, “Geboren von” on one line beside them`, async ({ page }) => {
            await setup(page, w, h);
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            const win = await openStats(page);
            await expect(win.locator('.stv-period-l')).toHaveText('Geboren von');
            const m = await win.locator('.stv-period').evaluate(period => {
                const label = period.querySelector('.stv-period-l') as HTMLElement;
                const range = document.createRange();
                range.selectNodeContents(label);
                const tops = new Set([...range.getClientRects()].map(r => Math.round(r.top)));
                const years = [...period.querySelectorAll<HTMLElement>('.stv-year')].map(y => y.getBoundingClientRect());
                const l = label.getBoundingClientRect();
                return { lines: tops.size, widths: years.map(y => y.width), labelRight: l.right, firstLeft: years[0].left, sameRow: years.every(y => Math.abs(y.top + y.height / 2 - (l.top + l.height / 2)) < 4) };
            });
            expect(m.lines).toBe(1);
            for (const width of m.widths) expect(width).toBeLessThanOrEqual(70);
            expect(m.labelRight).toBeLessThanOrEqual(m.firstLeft);
            expect(m.sameRow).toBe(true);
            // The search beside the segments keeps the design's 240 px too.
            const search = await win.locator('.stv-search').evaluate(el => el.getBoundingClientRect().width);
            expect(Math.round(search)).toBe(240);
        });
    }
});

/** The overview with one section open; waits for its "In detail" link. */
async function overviewLink(page: Page, treeId: string, section: string, sel: string): Promise<Locator> {
    await page.evaluate(({ id, section }) => window.Strom.UI.showTreeOverview(id, { section: section as never }), { id: treeId, section });
    const link = page.locator(`#tree-overview-modal .tov-sec[data-section="${section}"] ${sel}`);
    await expect(link).toBeVisible();
    return link;
}

const tv = (page: Page, sel: string): Locator => page.locator(`#table-container ${sel}`);
const statsChip = (page: Page): Locator => tv(page, '.tv-chip--stats');

/** A value's row of the window, by its value. */
const valueRow = (win: Locator, v: string): Locator => win.locator('.stv-vbody .stv-row').filter({ has: win.page().locator('.stv-val', { hasText: new RegExp(`^${v}\\b`) }) });

test.describe('Statistics: menus, In detail and the Table (spec 138 §2, §8, §10.1)', () => {
    test('Actions › Tree and In detail of the overview open the Statistics on the right topic, sex and scope', async ({ page }) => {
        const treeId = await setup(page);
        const sub = await openTreeActions(page);
        const item = sub.locator('[data-action="stats"]');
        await expect(item).toHaveText('Statistics');
        // Right after the overview's row.
        await expect(sub.locator('[data-action="overview"] + [data-action="stats"]')).toHaveCount(1);
        await item.click();
        let win = page.locator('#tree-stats-modal .modal.stv');
        await expect(win.locator('.stv-table')).toBeVisible();
        await expect(topic(win, 'firstNames')).toHaveAttribute('aria-current', 'true');
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-stats-modal')).toHaveCount(0);

        // Women's names: the Statistics over the overview, the overview stays under them.
        const women = await overviewLink(page, treeId, 'time', '.tov-stats-more[data-topic="firstNames"][data-sex="female"]');
        await expect(women).toHaveText('In detail');
        await expect(women).toHaveAttribute('aria-label', /Most common female names/);
        await women.click();
        win = page.locator('#tree-stats-modal .modal.stv');
        await expect(win.locator('.stv-table')).toBeVisible();
        await expect(topic(win, 'firstNames')).toHaveAttribute('aria-current', 'true');
        await expect(opt(win, 'sex', 'female')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => values(win)).toEqual(['Marie=2', 'Anna=1']);
        await expect(page.locator('#tree-overview-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-stats-modal')).toHaveCount(0);
        await expect(page.locator('#tree-overview-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);

        // A family line's detail: the line as the scope.
        await page.evaluate((id) => window.Strom.UI.showTreeOverview(id, { section: 'rods' }), treeId);
        const rods = page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
        await expect(rods).toHaveAttribute('data-ready', 'true');
        // The one big line is open already (its detail under the section's head).
        const more = rods.locator('.tov-rod.is-open .tov-rod-actions .tov-stats-more');
        await expect(more).toHaveAttribute('aria-label', 'In detail: Ostrožný');
        await more.click();
        await expect(win.locator('.stv-table')).toBeVisible();
        await expect(win.locator('.stv-scope-btn')).toHaveText(/Ostrožný line/);

        // A row's click closes the Statistics and the overview: the Table with the chip of the line.
        await valueRow(win, 'Jan').click();
        await expect(page.locator('#tree-stats-modal')).toHaveCount(0);
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
        await expect(statsChip(page).locator('.tv-chip-text')).toHaveText(/^Statistics: first name Jan · Ostrožný line$/);
    });

    test('a value’s people in the Table: the chip, “N of M people”, Back to Statistics as they were, × drops the chip', async ({ page }) => {
        await setup(page);
        let win = await openStats(page);
        // A state to come back to: every name, a search, sorted by name.
        await opt(win, 'names', 'each').click();
        await win.locator('.stv-search').fill('ja');
        await win.locator('.stv-sortbox .sel-opt[data-sort="name"]').click();
        await expect.poll(() => values(win)).toEqual(['Jan=3']);
        await valueRow(win, 'Jan').click();
        await expect(page.locator('#tree-stats-modal')).toHaveCount(0);

        await expect(tv(page, '.tv-grid')).toBeVisible();
        await expect(page.getByRole('radio', { name: /^People, / })).toHaveAttribute('aria-checked', 'true');
        await expect(statsChip(page).locator('.tv-chip-text')).toHaveText('Statistics: first name Jan');
        await expect(tv(page, '.tv-status-count')).toHaveText(/^3 of \d+ people$/);
        const keys = await tv(page, '.tv-body .tv-row[data-key^="p:"]').evaluateAll(rows => rows.map(r => (r as HTMLElement).dataset.key).sort());
        expect(keys).toEqual(['p:jan', 'p:jan2', 'p:jan3']);
        // First in the chips' row, Back to Statistics beside it, Clear filters at the end.
        await expect(tv(page, '.tv-back')).toHaveText('Back to Statistics');
        await expect(tv(page, '.tv-chips-clear')).toBeVisible();

        await tv(page, '.tv-back').click();
        win = page.locator('#tree-stats-modal .modal.stv');
        await expect(win.locator('.stv-table')).toBeVisible();
        await expect(topic(win, 'firstNames')).toHaveAttribute('aria-current', 'true');
        await expect(opt(win, 'names', 'each')).toHaveAttribute('aria-pressed', 'true');
        await expect(win.locator('.stv-search')).toHaveValue('ja');
        await expect(win.locator('.stv-sortbox .sel-opt[data-sort="name"]')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => values(win)).toEqual(['Jan=3']);
        // Closed without a click: the Table keeps the chip.
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-stats-modal')).toHaveCount(0);
        await expect(statsChip(page)).toBeVisible();

        // The chip is the window's own: not in the views' state.
        const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => /table/i.test(k))));
        expect(stored).not.toContain('"chip":"stats"');

        await statsChip(page).locator('.tv-chip-x').click();
        await expect(statsChip(page)).toHaveCount(0);
        await expect(tv(page, '.tv-back')).toHaveCount(0);
        await expect(tv(page, '.tv-status-count')).toHaveText(/^(\d+) of \1 people$/);
    });

    test('Save as list of people saves exactly the chip’s people as a fixed list named after it', async ({ page }) => {
        await setup(page);
        const win = await openStats(page);
        await valueRow(win, 'Josef').click();
        await expect(tv(page, '.tv-status-count')).toHaveText(/^3 of \d+ people$/);
        await tv(page, '.tv-more-menu-btn').click();
        // No "Save as the list's rule": a value's people are no rule.
        await expect(page.locator('.tv-menu .tv-menu-label').last()).toHaveText('Save as list of people…');
        await page.locator('.tv-menu .tv-menu-item', { hasText: 'Save as list of people…' }).click();
        const save = page.locator('#person-list-save');
        await expect(save).toContainText('3 people are saved in the table’s order.');
        await expect(save.locator('#pln-name')).toHaveValue('first name Josef');
        await expect(save.locator('.pln-switch[aria-checked="true"]')).toHaveCount(0);
        const before = await page.evaluate(() => (window.Strom.DataManager.getData().personLists ?? []).length);
        await save.locator('[data-act="create"]').click();
        await expect(save).toHaveCount(0);
        const list = await page.evaluate(() => (window.Strom.DataManager.getData().personLists ?? []).at(-1));
        expect(await page.evaluate(() => (window.Strom.DataManager.getData().personLists ?? []).length)).toBe(before + 1);
        expect(list?.name).toBe('first name Josef');
        expect(list?.dynamic).toBe(false);
        expect(list?.rule?.kind).not.toBe('tableFilter');
        expect([...(list?.personIds ?? [])].sort()).toEqual(['josef', 'josef2', 'josef3']);
    });
});

test.describe('Statistics on a phone: the More sheet and the Table (spec 138 §8, §10.1)', () => {
    for (const [w, h] of [[390, 844], [844, 390]] as const) {
        test(`${w}×${h}, dark: the View row's Statistics tile, the Topic button focused, the chip's row in the Table`, async ({ page }) => {
            await setup(page, w, h);
            await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
            await page.locator('#bb-view-more').click();
            const sheet = page.locator('.bottom-sheet-menu');
            const tile = sheet.locator('.bottom-sheet-pair[aria-label="View"] #sheet-stats');
            await expect(tile).toHaveText('Statistics');
            expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            // The sheet holds it without scrolling sideways.
            expect(await sheet.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            await page.screenshot({ path: join(SHOTS, `c-vice-${w}x${h}-dark.png`) });
            await tile.click();
            const win = page.locator('#tree-stats-modal .modal.stv');
            await expect(win.locator('.stv-table')).toBeVisible();
            await expect(win.locator('.stv-pbtn[data-stv="topic-sheet"]')).toBeFocused();

            await valueRow(win, 'Jan').click();
            await expect(page.locator('#tree-stats-modal')).toHaveCount(0);
            const row = tv(page, '.tv-statsrow');
            await expect(row).toBeVisible();
            await expect(row.locator('.tv-chip-text')).toHaveText('Statistics: first name Jan');
            await expect(tv(page, '.tv-status-count')).toHaveText(/^3 of \d+ people$/);
            // The table drawn again (a check done, a mark set) keeps the row's chip and × as they are:
            // a × replaced under a finger lost the tap (and the test's measurement of it).
            const x = await row.locator('.tv-chip-x').elementHandle();
            await page.evaluate(() => (window.Strom.UI as unknown as { redrawTableNow(): void }).redrawTableNow());
            expect(await x!.evaluate(el => el.isConnected)).toBe(true);
            await x!.dispose();
            for (const sel of ['.tv-chip-x', '.tv-back']) {
                const box = (await row.locator(sel).boundingBox())!;
                expect(box.height).toBeGreaterThanOrEqual(44);
                expect(box.x + box.width).toBeLessThanOrEqual(w + 1);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({ path: join(SHOTS, `c-tabulka-${w}x${h}-dark.png`) });

            // Back to Statistics, then × drops the row.
            await row.locator('.tv-back').click();
            await expect(win.locator('.stv-table')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.locator('#tree-stats-modal')).toHaveCount(0);
            await row.locator('.tv-chip-x').click();
            await expect(row).toBeHidden();
        });
    }
});

test.describe('Statistics: the look of the overview’s In detail and the Table’s chip', () => {
    for (const theme of ['light', 'dark'] as const) {
        for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]] as const) {
            test(`German, ${w}×${h}, ${theme}: nothing overflows`, async ({ page }) => {
                const treeId = await setup(page, w, h, 'Ostrožní a Pětiocí z Mezihoře');
                await page.evaluate(t => {
                    window.Strom.UI.setLanguage('de' as never);
                    window.Strom.SettingsManager.setTheme(t);
                }, theme);
                await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
                const link = await overviewLink(page, treeId, 'time', '.tov-stats-more[data-topic="firstNames"][data-sex="male"]');
                await link.scrollIntoViewIfNeeded();
                const heads = await page.locator('#tree-overview-modal .tov-chart-head').evaluateAll(els => els.map(el => {
                    const r = el.getBoundingClientRect();
                    const kids = [...el.children].map(k => k.getBoundingClientRect());
                    return kids.every(k => k.left >= r.left - 1 && k.right <= r.right + 1) && el.scrollWidth <= el.clientWidth + 1;
                }));
                expect(heads.length).toBeGreaterThan(0);
                expect(heads.every(Boolean)).toBe(true);
                // 44 px on a touch screen only (pointer: coarse).
                const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
                if (coarse) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
                await page.screenshot({ path: join(SHOTS, `c-uebersicht-de-${w}x${h}-${theme}.png`) });
                await link.click();
                const win = page.locator('#tree-stats-modal .modal.stv');
                await expect(win.locator('.stv-table')).toBeVisible();
                await valueRow(win, 'Jan').click();
                await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
                const chip = w <= 640 ? tv(page, '.tv-statsrow') : tv(page, '.tv-chips');
                await expect(chip.locator('.tv-chip--stats')).toBeVisible();
                await expect(chip.locator('.tv-back')).toHaveText('Zurück zur Statistik');
                const problems = await chip.evaluate(el => {
                    const out: string[] = [];
                    const box = el.getBoundingClientRect();
                    for (const k of el.querySelectorAll<HTMLElement>('.tv-chip--stats, .tv-back, .tv-chip-x')) {
                        const r = k.getBoundingClientRect();
                        if (r.width === 0) continue;
                        if (r.left < box.left - 1 || r.right > box.right + 1) out.push(`${k.className} sticks out`);
                    }
                    const a = el.querySelector('.tv-chip--stats')!.getBoundingClientRect();
                    const b = el.querySelector('.tv-back')!.getBoundingClientRect();
                    const ow = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                    const oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                    if (ow > 1 && oh > 1) out.push('the chip overlaps Back');
                    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('page scrolls sideways');
                    return out;
                });
                expect(problems).toEqual([]);
                await page.screenshot({ path: join(SHOTS, `c-tabelle-de-${w}x${h}-${theme}.png`) });
            });
        }
    }
});

test.describe('Statistics: the View tiles of the More sheet on a narrow phone', () => {
    for (const lang of ['de', 'pl', 'cs'] as const) {
        test(`${lang}, 360×640: four tiles in one row, no word broken inside a tile`, async ({ page }) => {
            await setup(page, 360, 640);
            await page.evaluate(l => window.Strom.UI.setLanguage(l as never), lang);
            await page.locator('#bb-view-more').click();
            const tiles = page.locator('.bottom-sheet-menu .bottom-sheet-pair:has(#sheet-stats) > .bottom-sheet-item');
            await expect(tiles).toHaveCount(4);
            const boxes = await tiles.evaluateAll(els => els.map(el => {
                const r = el.getBoundingClientRect();
                // A word broken inside a tile makes a line narrower than the longest word: compare with the text's own width.
                const range = document.createRange();
                range.selectNodeContents(el);
                const words = (el.textContent ?? '').trim().split(/\s+/);
                const probe = document.createElement('span');
                probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
                el.appendChild(probe);
                const widest = Math.max(...words.map(w => { probe.textContent = w; return probe.getBoundingClientRect().width; }));
                probe.remove();
                return { top: Math.round(r.top), right: r.right, fits: widest <= r.width + 0.5 };
            }));
            expect(new Set(boxes.map(b => b.top)).size).toBe(1);
            expect(boxes.every(b => b.fits)).toBe(true);
            const pair = (await page.locator('.bottom-sheet-menu .bottom-sheet-pair:has(#sheet-stats)').boundingBox())!;
            expect(Math.max(...boxes.map(b => b.right))).toBeLessThanOrEqual(pair.x + pair.width + 0.5);
            await page.screenshot({ path: join(SHOTS, `c-vice-${lang}-360x640.png`) });
        });
    }
});

import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakeRead, readAccepts, openResearch, poll, FakeBridge, READ_ID } from './research-bridge.js';

/**
 * "Read a document" (spec 013 §5): Suggest for the tree. Per person New /
 * Link / No with its defaults, events and relationships, an uncertain name,
 * the counts on the button, the write as one undo step with a source
 * (transcription, crop, the reading's marks) cited by the facts, the marks
 * sent only to a research that takes them, a second reader before writing,
 * a watched tree, the summary. All against a fake bridge; invented
 * documents and names (the research's tree: Josef Fíšek, Anna Svobodová,
 * their son Jan).
 */

const DESKTOP = { width: 1440, height: 900 };
const SHA = 'c0ffee'.repeat(10) + 'c0ff';

/** A baptism in Lhota: Marie (uncertain given name), her parents Josef and Anna (in the tree), a godfather. */
function baptism(over: Record<string, unknown> = {}, entry: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: READ_ID, state: 'done', lang: 'en',
        doc: { kind: 'register.baptism', language: ['la'], script: 'kurrent', date: '3. 4. 1846', legible: 'yes', why: null },
        readers: { asked: 2, ran: 2, agree: 'differ' },
        pages: [{ n: 1, file: 'I0101', name: 'matrika-lhota-1846.jpg', page: 1, w: 600, h: 800, sha: SHA, image: `read/${READ_ID}/page/1.jpg` }],
        entries: [{
            id: 'e1', page: 1, region: [0.08, 0.1, 0.84, 0.3],
            transcript: 'Maria[?] filia legitima\nJosephi Fíšek inquilini et Annae Svobodová\npatrinus Wenceslaus Král',
            variants: [{ at: 'Maria[?]', other: 'Martha' }],
            persons: [
                { ref: 'p1', role: 'child', given: 'Marie', surname: 'Fíšková', written: 'Maria', sex: 'F', uncertain: ['given'], region: [0.1, 0.12, 0.3, 0.05] },
                { ref: 'p2', role: 'father', given: 'Josef', surname: 'Fíšek', written: 'Josephi Fíšek', occupation: 'domkář', match: [{ person: 'P0001', why: 'name, place', score: 0.9 }], region: [0.1, 0.2, 0.4, 0.05] },
                { ref: 'p3', role: 'mother', given: 'Anna', surname: 'Svobodová', written: 'Annae Svobodová', region: [0.5, 0.2, 0.4, 0.05] },
                { ref: 'p4', role: 'godparent', given: 'Václav', surname: 'Král', written: 'Wenceslaus Král', region: [0.1, 0.3, 0.5, 0.05] },
            ],
            events: [
                { type: 'BAPM', date: { text: '3. 4. 1846', gedcom: '3 APR 1846' }, place: { text: 'Lhota' },
                    persons: [{ ref: 'p1', role: 'principal' }, { ref: 'p4', role: 'godparent' }] },
            ],
            relations: [
                { type: 'parent', parent: 'p2', child: 'p1' },
                { type: 'parent', parent: 'p3', child: 'p1' },
                { type: 'spouse', a: 'p2', b: 'p3' },
            ],
            ...entry,
        }],
        context: '', version: 1, ...over,
    };
}

async function setup(page: Page, res: Record<string, unknown>, opts: { features?: string[]; second?: boolean } = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, {
        accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true }, read: readAccepts() },
        features: opts.features ?? ['read.now'],
        read: fakeRead(),
    });
    await openResearch(page, { media: true });
    if (opts.second === false) await page.evaluate(() => localStorage.setItem('read.secondBeforeApply', '0'));
    const now = new Date().toISOString();
    b.read!.reads = [{ id: READ_ID, state: 'done', version: 1, at: now, since: now, files: 1, pages: 1, readers: 1, done: 1,
        entries: (res.entries as unknown[]).length, name: 'matrika-lhota-1846.jpg', person: '', from: 'app' }];
    b.read!.results.set(READ_ID, res);
    await poll(page);
    return b;
}

const dialog = (page: Page) => page.locator('#read-document-modal');
const cardOf = (d: Locator, ref: string) => d.locator(`.read-p-card[data-ref="${ref}"]`);
const itemOf = (d: Locator, key: string) => d.locator(`.read-p-item[data-key="${key}"]`);
const apply = (d: Locator) => d.locator('[data-act="p-apply"]');

/** The result open, then Suggest for the tree. */
async function openPropose(page: Page): Promise<Locator> {
    await page.evaluate((id) => (window.Strom.UI as any).showReadDocumentDialog({ readId: id }), READ_ID);
    const d = dialog(page);
    await expect(d.locator('#read-result')).toBeVisible();
    await d.locator('[data-act="propose"]').click();
    await expect(d.locator('#read-propose')).toBeVisible();
    return d;
}

function persons(page: Page): Promise<{ id: string; name: string; parentIds: string[]; notes: string; events: { type: string; note?: string; sourceIds?: string[] }[]; citations: unknown[] }[]> {
    return page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons).map((p: any) => ({
        id: p.id, name: `${p.firstName} ${p.lastName}`, parentIds: p.parentIds, notes: p.notes ?? '',
        events: p.events ?? [], citations: p.citations ?? [],
    })));
}

test.describe('Read a document: suggest for the tree', () => {
    test.use({ viewport: DESKTOP });

    test('defaults: research match and a likely person linked, nobody similar new, a godparent not written; in the tree off', { tag: '@smoke' }, async ({ page }) => {
        await setup(page, baptism());
        const d = await openPropose(page);
        await expect(d.locator('.audit-log-subtitle')).toContainText('Entry 1');
        await expect(d.locator('.read-p-card')).toHaveCount(4);
        // The father: the research's own match.
        await expect(cardOf(d, 'p2').locator('.read-p-seg-btn.is-on')).toHaveText('Link');
        await expect(cardOf(d, 'p2').locator('.read-p-match')).toContainText('Josef Fíšek');
        await expect(cardOf(d, 'p2').locator('.read-p-match')).toContainText('per the research');
        await expect(cardOf(d, 'p2').locator('.read-p-adds')).toHaveText('To be added: occupation domkář');
        await expect(cardOf(d, 'p2').locator('.read-p-role')).toHaveText('FATHER');
        await expect(cardOf(d, 'p2').locator('.read-p-written')).toHaveText('Josephi Fíšek');
        // The mother: found by name and husband.
        await expect(cardOf(d, 'p3').locator('.read-p-seg-btn.is-on')).toHaveText('Link');
        await expect(cardOf(d, 'p3').locator('.read-p-match')).toContainText('Anna Svobodová');
        // Nothing of her own is new, but she cites the entry's source.
        await expect(cardOf(d, 'p3').locator('.read-p-cites')).toHaveText('A citation is added for this person');
        await expect(cardOf(d, 'p2').locator('.read-p-cites')).toHaveCount(0);
        // The child: nobody similar.
        await expect(cardOf(d, 'p1').locator('.read-p-seg-btn.is-on')).toHaveText('New');
        await expect(cardOf(d, 'p1')).toContainText('no similar one in the tree');
        // The godfather: not written.
        await expect(cardOf(d, 'p4').locator('.read-p-seg-btn.is-on')).toHaveText('No');
        await expect(cardOf(d, 'p4')).toHaveClass(/is-skip/);
        await expect(cardOf(d, 'p4')).toContainText('not added; stays only in the transcription');
        // The couple is in the tree already: off and grey.
        await expect(itemOf(d, 'rel:2')).toHaveClass(/is-off/);
        await expect(itemOf(d, 'rel:2')).toContainText('already in the tree');
        await expect(itemOf(d, 'rel:2').locator('input')).not.toBeChecked();
        await expect(itemOf(d, 'rel:0').locator('input')).toBeChecked();
        await expect(itemOf(d, 'ev:0')).toContainText('Lhota');
        // 1 new; baptism + 2 parent relations + Josef's occupation.
        await expect(apply(d)).toHaveText('Add to tree (1 new person, 4 facts)');
        await expect(d.locator('.read-p-foot-note')).toHaveText('Nothing is added without the button');
        await expect(d.locator('.read-p-info')).toContainText('Baptism entry, Lhota 1846');
        // Hovering a card shows its crop on the scan.
        await cardOf(d, 'p3').hover();
        await expect(d.locator('.read-scan-person')).toBeVisible();
        // Back keeps the choices.
        await cardOf(d, 'p3').locator('[data-choice="new"]').click();
        await d.locator('.read-back').click();
        await expect(d.locator('#read-result .read-scan')).toBeVisible();
        await d.locator('[data-act="propose"]').click();
        await expect(cardOf(d, 'p3').locator('.read-p-seg-btn.is-on')).toHaveText('New');
    });

    test('No unticks the person\'s events and relationships; counts follow; an unticked item drops a fact', async ({ page }) => {
        await setup(page, baptism());
        const d = await openPropose(page);
        await itemOf(d, 'rel:1').locator('input').uncheck();
        await expect(apply(d)).toHaveText('Add to tree (1 new person, 3 facts)');
        await cardOf(d, 'p1').locator('[data-choice="skip"]').click();
        await expect(itemOf(d, 'rel:0')).toHaveClass(/is-off/);
        await expect(itemOf(d, 'rel:0')).toContainText('a person not added');
        await expect(itemOf(d, 'rel:0').locator('input')).not.toBeChecked();
        await expect(itemOf(d, 'ev:0').locator('input')).not.toBeChecked();
        // Only Josef's occupation remains.
        await expect(apply(d)).toHaveText('Add to tree (0 new people, 1 fact)');
    });

    test('an uncertain name: amber with the readers\' variants until edited; written with the note', async ({ page }) => {
        await setup(page, baptism());
        const d = await openPropose(page);
        const given = cardOf(d, 'p1').locator('.read-p-field').first();
        await expect(given).toHaveClass(/is-uncertain/);
        await expect(given.locator('.read-p-tag')).toHaveText('uncertain');
        await expect(cardOf(d, 'p1').locator('.read-p-unsure')).toContainText('Readers: Maria / Martha');
        await expect(cardOf(d, 'p1').locator('input[data-p-field="surname"]')).toHaveValue('Fíšková');
        await apply(d).click();
        await expect(d.locator('#read-title')).toHaveText('Added to the tree');
        await expect(d.locator('.read-written')).toContainText('Marie Fíšková');
        await expect(d.locator('.read-w-unsure')).toContainText('name uncertain');
        const marie = (await persons(page)).find(p => p.name === 'Marie Fíšková')!;
        expect(marie.notes).toContain('uncertain reading');
        expect(marie.notes).toContain('given name');
    });

    test('an edited uncertain name loses the mark and is written as typed, without the note', async ({ page }) => {
        await setup(page, baptism());
        const d = await openPropose(page);
        const input = cardOf(d, 'p1').locator('input[data-p-field="given"]');
        await input.fill('Marta');
        await expect(cardOf(d, 'p1').locator('.read-p-field').first()).not.toHaveClass(/is-uncertain/);
        await expect(cardOf(d, 'p1').locator('.read-p-unsure')).toHaveCount(0);
        await expect(itemOf(d, 'rel:0')).toContainText('Josef Fíšek → Marta Fíšková');
        await apply(d).click();
        await expect(d.locator('#read-title')).toHaveText('Added to the tree');
        const marta = (await persons(page)).find(p => p.name === 'Marta Fíšková')!;
        expect(marta.notes).toBe('');
    });

    test('the write: persons, a source with transcription, crop and marks, the facts citing it; one Undo takes it all back', async ({ page }) => {
        await setup(page, baptism());
        const before = await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData()));
        const d = await openPropose(page);
        await apply(d).click();
        await expect(d.locator('#read-title')).toHaveText('Added to the tree');
        await expect(d.locator('.read-written')).toContainText('Josef Fíšek: occupation');
        await expect(d.locator('.read-written')).toContainText('2 relationships');
        await expect(d.locator('.read-written')).toContainText('Source “Baptism entry, Lhota 1846”');
        // By hand: the changes wait for Send.
        await expect(d.locator('.read-w-sent')).toContainText('wait for “Send changes”');

        const state = await page.evaluate(() => {
            const data = window.Strom.DataManager.getData();
            const src = Object.values(data.sources ?? {}).find((s: any) => s.reading) as any;
            const ps = Object.values(data.persons) as any[];
            const marie = ps.find(p => p.firstName === 'Marie');
            const josef = ps.find(p => p.firstName === 'Josef');
            const anna = ps.find(p => p.firstName === 'Anna');
            return {
                src: src ? { title: src.title, transcript: src.transcript, reading: src.reading, entry: src.readingEntry, sha: src.readingSha,
                    excerpts: (src.excerpts ?? []).map((x: any) => ({ sha: x.originalSha, w: x.width, h: x.height, image: /^data:image\/jpeg/.test(x.dataUrl), caption: x.caption })) } : null,
                srcId: src?.id,
                marie: marie && { parents: marie.parentIds.length, bapm: (marie.events ?? []).find((e: any) => e.type === 'baptism'), citations: marie.sourceIds ?? [] },
                josef: josef && { occupation: (josef.events ?? []).find((e: any) => e.type === 'occupation'), citations: josef.sourceIds ?? [] },
                annaCites: anna?.sourceIds ?? [],
                count: ps.length,
                godfather: ps.some(p => p.lastName === 'Král'),
            };
        });
        expect(state.src).toMatchObject({
            title: 'Baptism entry, Lhota 1846',
            transcript: 'Maria[?] filia legitima\nJosephi Fíšek inquilini et Annae Svobodová\npatrinus Wenceslaus Král',
            reading: READ_ID, entry: 'e1', sha: SHA,
        });
        expect(state.src!.excerpts).toHaveLength(1);
        expect(state.src!.excerpts[0]).toMatchObject({ sha: SHA, image: true });
        expect(state.count).toBe(4);
        expect(state.godfather).toBe(false);
        expect(state.marie!.parents).toBe(2);
        expect(state.marie!.bapm).toMatchObject({ date: '1846-04-03', place: 'Lhota', sourceIds: [state.srcId] });
        expect(state.marie!.citations).toContain(state.srcId);
        expect(state.josef!.occupation).toMatchObject({ note: 'domkář', sourceIds: [state.srcId] });
        expect(state.josef!.citations).toContain(state.srcId);
        expect(state.annaCites).toContain(state.srcId);

        // Show in tree: the dialog closes, Marie in focus.
        await expect(d.locator('[data-act="show-person"]')).toHaveText('Show in the tree: Marie Fíšková');
        await d.locator('[data-act="show-person"]').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => {
            const id = window.Strom.TreeRenderer.getFocusPersonId();
            return id ? window.Strom.DataManager.getPerson(id)?.firstName : '';
        })).toBe('Marie');

        // One Undo: everything back.
        const undone = await page.evaluate(() => window.Strom.DataManager.undo());
        expect(undone?.description).toBe('Read document');
        const after = await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData()));
        expect(JSON.parse(after).persons).toEqual(JSON.parse(before).persons);
        expect(JSON.parse(after).sources).toEqual(JSON.parse(before).sources);
        expect(JSON.parse(after).partnerships).toEqual(JSON.parse(before).partnerships);
    });

    for (const features of [['read.now', 'read.sync'], ['read.now']]) {
        const takes = features.includes('read.sync');
        test(`the reading's marks ${takes ? 'go to a research with read.sync' : 'stay home without read.sync'}`, async ({ page }) => {
            const b = await setup(page, baptism(), { features });
            const d = await openPropose(page);
            await apply(d).click();
            await expect(d.locator('#read-title')).toHaveText('Added to the tree');
            await d.locator('.read-footer [data-act="close"]').click();
            await expect(dialog(page)).toHaveCount(0);
            await page.evaluate(() => (window.Strom.UI as any).researchSendNow());
            await expect.poll(() => b.posts.length).toBe(1);
            const ged = b.posts[0];
            expect(ged).toContain('Baptism entry, Lhota 1846');
            if (takes) {
                expect(ged).toContain(`_STROM_READING ${READ_ID}`);
                expect(ged).toMatch(/2 _STROM_ENTRY e1/);
                expect(ged).toContain(`_STROM_SHA ${SHA}`);
            } else {
                expect(ged).not.toContain('_STROM_READING');
                expect(ged).not.toContain('_STROM_ENTRY');
            }
        });
    }

    test('a linked person with another name: the difference said, the tree\'s name kept, the read one added as a form', async ({ page }) => {
        await setup(page, baptism({}, {
            persons: [
                { ref: 'p1', role: 'child', given: 'Marie', surname: 'Fíšková', sex: 'F' },
                { ref: 'p2', role: 'father', given: 'Jacobus', surname: 'Fíšek', match: [{ person: 'P0001', why: 'place', score: 0.9 }] },
            ],
            relations: [{ type: 'parent', parent: 'p2', child: 'p1' }],
        }));
        const d = await openPropose(page);
        await expect(cardOf(d, 'p2').locator('.read-p-differs')).toHaveText('Given name differs: tree Josef, entry Jacobus');
        await expect(cardOf(d, 'p2').locator('.read-p-adds')).toContainText('name form Jacobus Fíšek');
        await apply(d).click();
        await expect(d.locator('#read-title')).toHaveText('Added to the tree');
        const josef = await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.refn === 'P0001'));
        expect(josef.firstName).toBe('Josef');
        expect(josef.nameVariants).toContain('Jacobus Fíšek');
    });

    test('a linked person read in the register\'s Latin form of the same name: no difference said, the form added', async ({ page }) => {
        await setup(page, baptism({}, {
            persons: [
                { ref: 'p1', role: 'child', given: 'Marie', surname: 'Fíšková', sex: 'F' },
                { ref: 'p2', role: 'father', given: 'Josephus', surname: 'Fíšek', match: [{ person: 'P0001', why: 'place', score: 0.9 }] },
            ],
            relations: [{ type: 'parent', parent: 'p2', child: 'p1' }],
        }));
        const d = await openPropose(page);
        await expect(cardOf(d, 'p2').locator('.read-p-adds')).toContainText('name form Josephus Fíšek');
        await expect(cardOf(d, 'p2').locator('.read-p-differs')).toHaveCount(0);
    });

    test('Other… links a person picked in the tree', async ({ page }) => {
        await setup(page, baptism());
        const d = await openPropose(page);
        await cardOf(d, 'p1').locator('[data-choice="link"]').click();
        const picker = cardOf(d, 'p1').locator('.read-p-picker input');
        await expect(picker).toBeVisible();
        await picker.fill('Jan');
        await cardOf(d, 'p1').locator('.person-picker-item').filter({ hasText: 'Jan' }).first().click();
        await expect(cardOf(d, 'p1').locator('.read-p-match')).toContainText('Jan Fíšek');
        // Jan is Josef's and Anna's son already: both parent links in the tree.
        await expect(itemOf(d, 'rel:0')).toContainText('already in the tree');
        await expect(itemOf(d, 'rel:1')).toContainText('already in the tree');
        // Marie's name and sex are not Jan's: said, the tree's kept, the name added as a form.
        await expect(cardOf(d, 'p1').locator('.read-p-differs').first()).toContainText('Given name differs: tree Jan, entry Marie');
        await expect(apply(d)).toHaveText('Add to tree (0 new people, 3 facts)');
    });

    test('Link with nobody chosen: each such card says so, the button waits; chosen or New, it writes; a grandparent given as "other" is New', async ({ page }) => {
        const base = baptism();
        const e = (base.entries as Record<string, unknown>[])[0];
        await setup(page, baptism({}, {
            persons: [...(e.persons as unknown[]),
                { ref: 'p5', role: 'other', roleText: 'father\'s father', given: 'Bohumil', surname: 'Fíšek', written: 'Bohumili Fíšek', sex: 'M' }],
            relations: [...(e.relations as unknown[]), { type: 'parent', parent: 'p5', child: 'p2' }],
        }));
        const d = await openPropose(page);
        // The research's match, the app's match, nobody similar, the grandfather (family, not a witness).
        await expect(cardOf(d, 'p2').locator('.read-p-match')).toContainText('per the research');
        await expect(cardOf(d, 'p3').locator('.read-p-match')).toContainText('Anna Svobodová');
        await expect(cardOf(d, 'p1').locator('.read-p-seg-btn.is-on')).toHaveText('New');
        await expect(cardOf(d, 'p5').locator('.read-p-seg-btn.is-on')).toHaveText('New');
        await expect(cardOf(d, 'p4').locator('.read-p-seg-btn.is-on')).toHaveText('No');
        await expect(apply(d)).toHaveText('Add to tree (2 new people, 5 facts)');

        await cardOf(d, 'p1').locator('[data-choice="link"]').click();
        await cardOf(d, 'p5').locator('[data-choice="link"]').click();
        for (const ref of ['p1', 'p5']) {
            await expect(cardOf(d, ref).locator('.read-p-unchosen')).toContainText('No person in the tree chosen yet');
            await expect(cardOf(d, ref).locator('.read-p-unchosen [data-act="p-other"]')).toHaveText('Choose…');
        }
        // One picker at a time: on the card asked last.
        await expect(d.locator('.read-p-picker')).toHaveCount(1);
        await expect(cardOf(d, 'p5').locator('.read-p-picker input')).toBeVisible();
        await expect(apply(d)).toBeDisabled();
        await expect(d.locator('.read-p-foot-note')).toHaveText('2 people set to “Link” have no person in the tree chosen yet');
        // Nothing of theirs counts: Josef's occupation only.
        await expect(apply(d)).toHaveText('Add to tree (0 new people, 1 fact)');
        await expect(itemOf(d, 'rel:3')).toContainText('no person in the tree chosen');
        await expect(itemOf(d, 'rel:3').locator('input')).not.toBeChecked();

        await cardOf(d, 'p1').locator('.read-p-unchosen [data-act="p-other"]').click();
        const picker = cardOf(d, 'p1').locator('.read-p-picker input');
        await expect(picker).toBeVisible();
        await picker.fill('Jan');
        await cardOf(d, 'p1').locator('.person-picker-item').filter({ hasText: 'Jan' }).first().click();
        await expect(cardOf(d, 'p1').locator('.read-p-match')).toContainText('Jan Fíšek');
        await expect(cardOf(d, 'p1').locator('.read-p-unchosen')).toHaveCount(0);
        await expect(cardOf(d, 'p5').locator('.read-p-picker input')).toBeVisible();
        await expect(d.locator('.read-p-foot-note')).toHaveText('One person set to “Link” has no person in the tree chosen yet');
        await expect(apply(d)).toBeDisabled();

        await cardOf(d, 'p5').locator('[data-choice="new"]').click();
        await expect(d.locator('.read-p-foot-note')).toHaveText('Nothing is added without the button');
        // Bohumil new; the baptism, Bohumil → Josef, Josef's occupation, Marie as a name form of Jan.
        await expect(apply(d)).toHaveText('Add to tree (1 new person, 4 facts)');
        await expect(apply(d)).toBeEnabled();
        await apply(d).click();
        await expect(d.locator('#read-title')).toHaveText('Added to the tree');
        const ps = await persons(page);
        const josef = ps.find(p => p.name === 'Josef Fíšek')!;
        const bohumil = ps.find(p => p.name === 'Bohumil Fíšek')!;
        expect(josef.parentIds).toContain(bohumil.id);
    });

    test('a second reader first: progress over the suggestion, choices kept, new variants marked; cancelled keeps the first', async ({ page }) => {
        const b = await setup(page, baptism({ readers: { asked: 1, ran: 1, agree: null } }, { variants: [] }));
        const d = await openPropose(page);
        await expect(d.locator('#read-p-second')).toBeChecked();
        await expect(apply(d)).toContainText('Read with a second reader');
        await expect(apply(d).locator('.research-ai-badge')).toBeVisible();
        await cardOf(d, 'p3').locator('[data-choice="new"]').click();
        await apply(d).click();
        await expect.poll(() => b.read!.agains.length).toBe(1);
        expect(b.read!.agains[0].body).toMatchObject({ readers: 2 });
        await expect(d.locator('.read-p-progress')).toContainText('The second reader is reading');
        await expect(d.locator('#read-title')).toHaveText('Suggest for the tree');
        await expect(apply(d)).toBeDisabled();
        await expect(cardOf(d, 'p3').locator('.read-p-seg-btn.is-on')).toHaveText('New');
        // The second reader read: a place where the readers differ, the choices kept (Anna new: the couple is new too).
        const r = b.read!.reads[0];
        r.state = 'done';
        r.done = 2;
        r.readers = 2;
        r.since = new Date().toISOString();
        b.read!.results.set(READ_ID, baptism({ readers: { asked: 2, ran: 2, agree: 'differ' }, version: 2 }));
        await poll(page);
        await expect(d.locator('.read-notice')).toContainText('The second reader is done');
        await expect(d.locator('.read-p-progress')).toHaveCount(0);
        await expect(cardOf(d, 'p3').locator('.read-p-seg-btn.is-on')).toHaveText('New');
        await expect(cardOf(d, 'p1').locator('.read-p-unsure')).toHaveClass(/is-fresh/);
        await expect(d.locator('#read-p-second')).toHaveCount(0);
        await expect(apply(d)).toHaveText('Add to tree (2 new people, 5 facts)');
        // Remembered for next time.
        expect(await page.evaluate(() => localStorage.getItem('read.secondBeforeApply'))).toBe('1');
    });

    test('a second reader that agrees: the notice says the readings agree, nothing marked new', async ({ page }) => {
        const b = await setup(page, baptism({ readers: { asked: 1, ran: 1, agree: null } }, { variants: [] }));
        const d = await openPropose(page);
        await apply(d).click();
        await expect.poll(() => b.read!.agains.length).toBe(1);
        const r = b.read!.reads[0];
        r.state = 'done';
        r.done = 2;
        r.readers = 2;
        r.since = new Date().toISOString();
        b.read!.results.set(READ_ID, baptism({ readers: { asked: 2, ran: 2, agree: 'same' }, version: 2 }, { variants: [] }));
        await poll(page);
        await expect(d.locator('.read-notice')).toHaveText('The second reader is done. Both readings agree.');
        await expect(d.locator('.read-p-unsure.is-fresh')).toHaveCount(0);
    });

    test('a second reader cancelled: the first reading\'s suggestion stays', async ({ page }) => {
        const b = await setup(page, baptism({ readers: { asked: 1, ran: 1, agree: null } }));
        const d = await openPropose(page);
        await cardOf(d, 'p3').locator('[data-choice="new"]').click();
        await apply(d).click();
        await expect(d.locator('.read-p-progress')).toBeVisible();
        // The bridge: an again cancelled leaves the previous result done.
        b.read!.cancelReply = { status: 200, body: { read: READ_ID, state: 'done', version: 2, cancelled: true } };
        await d.locator('.read-p-progress [data-act="cancel"]').click();
        await expect(d.locator('.read-notice')).toBeVisible();
        await expect(d.locator('#read-title')).toHaveText('Suggest for the tree');
        await expect(d.locator('.read-p-progress')).toHaveCount(0);
        await expect(cardOf(d, 'p3').locator('.read-p-seg-btn.is-on')).toHaveText('New');
    });

    test('without the second reader: written at once, the choice remembered', async ({ page }) => {
        const b = await setup(page, baptism({ readers: { asked: 1, ran: 1, agree: null } }));
        const d = await openPropose(page);
        await d.locator('#read-p-second').uncheck();
        await expect(apply(d)).toHaveText('Add to tree (1 new person, 4 facts)');
        await apply(d).click();
        await expect(d.locator('#read-title')).toHaveText('Added to the tree');
        expect(b.read!.agains).toHaveLength(0);
        expect(await page.evaluate(() => localStorage.getItem('read.secondBeforeApply'))).toBe('0');
    });

    test('a watched tree: the button waits; Stop watching enables it without closing the dialog', async ({ page }) => {
        await setup(page, baptism());
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            dm.setLiveTree(window.Strom.TreeManager.getActiveTreeId());
            (window.Strom.UI as any).stopLiveFollow = () => dm.setLiveTree(null);
        });
        const d = await openPropose(page);
        await expect(apply(d)).toBeDisabled();
        await expect(d.locator('.read-p-foot-note')).toContainText('watched live');
        await d.locator('[data-act="p-stop-live"]').click();
        await expect(apply(d)).toBeEnabled();
        await expect(d.locator('[data-act="p-stop-live"]')).toHaveCount(0);
        await expect(d.locator('#read-title')).toHaveText('Suggest for the tree');
        await apply(d).click();
        await expect(d.locator('#read-title')).toHaveText('Added to the tree');
    });
});

/** Nothing in the element is wider than the element itself. */
async function noOverflow(target: Locator): Promise<void> {
    const sizes = await target.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const wider = [...el.querySelectorAll<HTMLElement>('*')]
            .filter(c => c.getClientRects().length > 0)
            .filter(c => !c.closest('.read-scan-view') && !c.closest('.read-crop'))
            .filter(c => { const r = c.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1; })
            .map(c => c.className || c.tagName);
        return { scroll: el.scrollWidth, client: el.clientWidth, right: box.right, vw: window.innerWidth, wider };
    });
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
    expect(sizes.right).toBeLessThanOrEqual(sizes.vw + 1);
    expect(sizes.wider).toEqual([]);
}

for (const viewport of [DESKTOP, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    test.describe(`The suggestion in German at ${viewport.width}px`, () => {
        test.use({ viewport, locale: 'de-DE' });

        test('cards, events, the footer, the summary: nothing runs over', async ({ page }) => {
            await setup(page, baptism({ readers: { asked: 1, ran: 1, agree: null } }), { second: false });
            await page.evaluate((id) => (window.Strom.UI as any).showReadDocumentDialog({ readId: id }), READ_ID);
            await expect(dialog(page).locator('#read-result')).toBeVisible();
            if (viewport.width <= 640) {
                // The result's footer: the secondary buttons side by side, the main one across.
                const close = (await dialog(page).locator('.read-footer [data-act="close"]').boundingBox())!;
                const another = (await dialog(page).locator('.read-footer [data-act="another"]').boundingBox())!;
                const propose = (await dialog(page).locator('.read-footer [data-act="propose"]').boundingBox())!;
                expect(Math.abs(close.y - another.y)).toBeLessThan(2);
                expect(propose.width).toBeGreaterThan(close.width + another.width);
                await noOverflow(dialog(page).locator('.read-footer'));
            }
            await dialog(page).locator('.read-footer [data-act="propose"]').click();
            const d = dialog(page);
            await expect(d.locator('#read-propose')).toBeVisible();
            await expect(d.locator('#read-title')).not.toHaveText('Suggest for the tree');
            await expect(cardOf(d, 'p1').locator('.read-p-field.is-uncertain')).toBeVisible();
            await noOverflow(d.locator('.modal'));
            await noOverflow(d.locator('#read-propose'));
            await noOverflow(d.locator('.read-footer'));
            const button = (await apply(d).boundingBox())!;
            const footer = (await d.locator('.read-footer').boundingBox())!;
            if (viewport.width <= 640) {
                // The main button across, the secondary ones side by side.
                expect(button.width).toBeGreaterThan(footer.width * 0.85);
                const back = (await d.locator('.read-footer [data-act="propose-back"]').boundingBox())!;
                expect(button.y).toBeGreaterThan(back.y + back.height - 1);
                expect(button.height).toBeGreaterThanOrEqual(44);
            }
            await apply(d).click();
            await expect(d.locator('.read-written')).toBeVisible();
            await noOverflow(d.locator('.modal'));
        });
    });
}

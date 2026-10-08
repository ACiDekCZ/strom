import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal, card } from './helpers.js';
import { expectFits } from './mobile-screens.js';

/**
 * Titles of the name (T07): "Title before name" / "Title after name" under the
 * name fields, behind the quiet "+ title" link while empty; the card, the
 * dialog's header and the lists show "Ing. Jan Novák ml." while Settings →
 * "Show titles" is on. Invented data.
 */

/**
 * The card's name: the whole name in its title (the text may break into a
 * given-name line and a surname line on a narrow card), and the two lines.
 */
async function expectCardName(page: Page, first: string, given: string, surname: string): Promise<void> {
    const name = card(page, first).locator('.name-text');
    await expect(name).toHaveAttribute('title', `${given} ${surname}`);
    await expect(name).toHaveAttribute('data-given', given);
    await expect(name).toHaveAttribute('data-surname', surname);
}

async function addTitles(page: Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novák', { birthDate: '1901' });
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    const more = modal.locator('#name-details .detail-more');
    await expect(modal.locator('#input-title-before')).toBeHidden();
    await expect(more).toHaveText('+ title');
    await more.click();
    await expect(modal.locator('#input-title-before')).toBeFocused();
    await modal.locator('#input-title-before').fill('Ing.');
    await modal.locator('#input-title-after').fill('ml.');
    // The header follows the form as it is typed.
    await expect(modal.locator('#pm-name')).toHaveText('Ing. Jan Novák ml.');
}

test('titles are entered in the person dialog and shown on the card, the setting hides them', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await addTitles(page);
    const modal = personModal(page);
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    expect(await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        return [p.firstName, p.lastName, p.titleBefore, p.titleAfter];
    })).toEqual(['Jan', 'Novák', 'Ing.', 'ml.']);
    await expectCardName(page, 'Jan', 'Ing. Jan', 'Novák ml.');
    // The avatar's initials come from the name, never from a title.
    await expect(card(page, 'Jan').locator('.avatar-initials')).toHaveText('JN');
    // A title is not searched.
    expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Ing').length)).toBe(0);

    // Reopened: filled titles show without the link.
    await cardAction(page, 'Jan', 'edit');
    await expect(modal.locator('#input-title-before')).toBeVisible();
    await expect(modal.locator('#input-title-before')).toHaveValue('Ing.');
    await expect(modal.locator('#input-title-after')).toHaveValue('ml.');
    await expect(modal.locator('#name-details .detail-more')).toBeHidden();
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();

    // Settings → Show titles (on by default) hides them and brings them back.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const toggle = page.locator('#show-titles-toggle');
    await expect(toggle).toBeChecked();
    await expect(page.locator('#settings-modal')).toContainText('Show titles');
    await toggle.uncheck();
    await expectCardName(page, 'Jan', 'Jan', 'Novák');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').showTitles)).toBe(false);
    await toggle.check();
    await expectCardName(page, 'Jan', 'Ing. Jan', 'Novák ml.');
});

test('a title cleared in the dialog is gone from the card and the data', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await addTitles(page);
    const modal = personModal(page);
    await modal.getByRole('button', { name: 'Save' }).click();
    await cardAction(page, 'Jan', 'edit');
    await modal.locator('#input-title-before').fill('');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expectCardName(page, 'Jan', 'Jan', 'Novák ml.');
    expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons()[0].titleBefore)).toBeUndefined();
});

test.describe('on a 360 px phone', () => {
    test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

    test('the two titles sit side by side under the name and fit the screen', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showAddPersonModal());
        const modal = personModal(page);
        await expect(modal).toBeVisible();
        const more = modal.locator('#name-details .detail-more');
        await expect(more).toBeVisible();
        // A finger's target, not a hairline of text.
        expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await more.tap();
        const before = (await modal.locator('#input-title-before').boundingBox())!;
        const after = (await modal.locator('#input-title-after').boundingBox())!;
        expect(Math.abs(before.y - after.y)).toBeLessThan(2);
        expect(after.x).toBeGreaterThan(before.x + before.width - 1);
        await expectFits(page, 'person form with titles');

        await modal.locator('#input-firstname').fill('Marie');
        await modal.locator('#input-lastname').fill('Svobodová');
        await modal.locator('#input-title-before').fill('MUDr.');
        await modal.getByRole('button', { name: 'Save' }).click();
        await expectCardName(page, 'Marie', 'MUDr. Marie', 'Svobodová');
    });
});

test('the undo toast, the duplicate hint and the timeline name a person with the titles', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'Petr', 'Dvořák');
    // A new person entered with the titles: the undo step says the name as the card does.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const modal = personModal(page);
    await modal.locator('#input-firstname').fill('Jan');
    await modal.locator('#input-lastname').fill('Novák');
    await modal.locator('#input-birthdate').fill('1901');
    await modal.locator('#name-details .detail-more').click();
    await modal.locator('#input-title-before').fill('Ing.');
    await modal.locator('#input-title-after').fill('ml.');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    await expect(page.locator('.undo-toast .undo-toast-msg').last()).toHaveText('adding Ing. Jan Novák ml.');

    // Typing the bare name of a new person offers him, with the titles.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await modal.locator('#input-firstname').fill('Jan');
    await modal.locator('#input-lastname').fill('Novák');
    await modal.locator('#input-birthdate').fill('1901');
    const panel = page.locator('#duplicate-suggest-person');
    await expect(panel.locator('.duplicate-suggest-name')).toHaveText('Ing. Jan Novák ml.');
    await panel.getByRole('button', { name: 'Go to person' }).click();
    await expect(modal).toBeHidden();

    // The timeline view's row.
    await page.locator('#view-mode-timeline').click();
    await expect(page.locator('#timeline-container .tl-name')).toHaveText(['Ing. Jan Novák ml. 1901–?']);
});

test('a research conflict about a title is named in words and marks the title\'s field', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await addTitles(page);
    const modal = personModal(page);
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    // What Strom Research writes (_STROM_CONFLICT, TYPE NPFX / NSFX), already read onto the person.
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        p.research = {
            conflicts: [
                { id: 'X0001', fact: 'NPFX', status: 'open', values: [{ value: 'Ing.' }, { value: '—' }] },
                { id: 'X0002', fact: 'NSFX', status: 'open', values: [{ value: 'ml.' }, { value: 'st.' }] },
            ],
        };
    });
    await cardAction(page, 'Jan', 'edit');
    const before = modal.locator('label[for="input-title-before"] .pm-conflict-tag');
    await expect(before).toHaveText('conflict ›');
    await expect(before).toHaveAttribute('aria-label', /^Title before name: /);
    await expect(modal.locator('label[for="input-title-after"] .pm-conflict-tag')).toHaveAttribute('aria-label', /^Title after name: /);
    await before.click();
    const dialog = page.locator('#person-research-modal');
    await expect(dialog.locator('.person-research-fact')).toHaveText(['Title before name', 'Title after name']);
    await expect(dialog).not.toContainText('NPFX');
    await expect(dialog).not.toContainText('NSFX');
    await page.keyboard.press('Escape');
    await modal.getByRole('button', { name: 'Cancel' }).click();

    // With no title left (the field folded behind "+ title"), the given name carries the mark.
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        delete p.titleBefore;
        delete p.titleAfter;
    });
    await cardAction(page, 'Jan', 'edit');
    await expect(modal.locator('#input-title-before')).toBeHidden();
    await expect(modal.locator('label[for="input-firstname"] .pm-conflict-tag')).toHaveCount(1);
});

test.describe('titles and the research\'s version (T07)', () => {
    for (const knows of [false, true]) {
        test(knows ? 'a research that knows titles (person.titles): its version decides — a title removed there goes here too'
            : 'a research that drops titles: loading its version keeps the titles entered here', async ({ page }) => {
            const { openResearch, fakeBridge, poll, researchGed } = await import('./research-bridge.js');
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.clock.install();
            await openResearch(page);
            const bridge = await fakeBridge(page, { accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null },
                features: knows ? ['family.alone', 'person.titles'] : ['family.alone'] });
            await poll(page);
            const titlesOf = (first: string) => page.evaluate((first) => {
                const p = (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(x => x.firstName === first);
                return [p.titleBefore ?? '', p.titleAfter ?? ''];
            }, first);
            // Titles entered in the app (Jan) — the research's newer version has none of them; Josef gets one there.
            await page.evaluate(() => {
                const dm = window.Strom.DataManager;
                const jan = (Object.values(dm.getData().persons) as any[]).find(p => p.firstName === 'Jan');
                dm.updatePerson(jan.id, { titleBefore: 'Ing.', titleAfter: 'ml.' });
            });
            bridge.head = 'cd34ef56ab12';
            bridge.treeGed = researchGed('cd34ef56ab12').replace('1 NAME Josef /Víšek/', '1 NAME MUDr. Josef /Víšek/\n2 NPFX MUDr.');
            await poll(page);
            await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
            await page.locator('.confirm-aside-btn', { hasText: 'Load without changes' }).click();
            await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe('cd34ef56ab12');
            expect(await titlesOf('Jan')).toEqual(knows ? ['', ''] : ['Ing.', 'ml.']);
            expect(await titlesOf('Josef')).toEqual(['MUDr.', '']);
            await expect(card(page, 'Jan').locator('.name-text')).toHaveAttribute('title', knows ? 'Jan Víšek' : 'Ing. Jan Víšek ml.');
        });
    }
});

test('B-1: a research that knows no titles (1.12.1): three sends and loads never double a title, each send writes the one edit, the menu says how to update', async ({ page }) => {
    const { openResearch, fakeBridge, poll, editJan, researchGed, openResearchMenu, HEAD } = await import('./research-bridge.js');
    await page.setViewportSize({ width: 1440, height: 900 });
    // The tree here has titles (a GEDCOM with NPFX / NSFX, or typed in 3.10).
    await openResearch(page, { ged: researchGed().replace('1 NAME Josef /Víšek/', '1 NAME Ing. Josef /Víšek/ st.\n2 NPFX Ing.\n2 NSFX st.') });
    // Strom Research 1.12.1: what its bridge says it can do (no person.titles), and how it reads a file:
    // the NAME line only (no NPFX / NSFX / GIVN / SURN), the text after the surname joined to the given name.
    type Rec = { given: string; surname: string; birthPlace: string };
    const research = new Map<string, Rec>([
        ['P0001', { given: 'Josef', surname: 'Víšek', birthPlace: '' }],
        ['P0002', { given: 'Anna', surname: 'Svobodová', birthPlace: '' }],
        ['P0003', { given: 'Jan', surname: 'Víšek', birthPlace: '' }],
    ]);
    const readAsOld = (ged: string): Map<string, Rec> => {
        const out = new Map<string, Rec>();
        for (const rec of ged.split(/\n(?=0 )/)) {
            if (!/^0 @[^@]+@ INDI/.test(rec)) continue;
            const refn = /\n1 REFN (\S+)/.exec(rec)?.[1];
            const name = /\n1 NAME (.*?)\/(.*?)\/(.*)/.exec(rec);
            if (!refn || !name) continue;
            out.set(refn, {
                given: [name[1].trim(), name[3].trim()].filter(Boolean).join(' '), surname: name[2].trim(),
                birthPlace: /\n1 BIRT(?:\n[2-9] .*)*?\n2 PLAC (.*)/.exec(rec)?.[1].trim() ?? '',
            });
        }
        return out;
    };
    const gedOf = (head: string): string => {
        let ged = researchGed(head);
        for (const [refn, r] of research) {
            ged = ged.replace(new RegExp(`(0 @${refn}@ INDI)\n1 NAME [^\n]*`), `$1\n1 NAME ${r.given} /${r.surname}/${r.birthPlace ? `\n1 BIRT\n2 PLAC ${r.birthPlace}` : ''}`);
        }
        return ged;
    };
    const bridge = await fakeBridge(page, {
        accepts: { mode: 'research', sync: { auto: 'off' }, sources: true, verified: true, media: null }, strom: '1.12.1',
        features: ['sync.again', 'sync.undoneSince', 'sync.takenBack', 'sync.conflictEdit', 'sync.since', 'sync.ids', 'family.noCouple', 'family.alone', 'adopt.transfer', 'adopt.empty'],
        head: HEAD, treeGed: gedOf(HEAD),
    });
    const written: number[] = [];
    let heads = 0;
    const nextHead = () => `${(++heads).toString(16).padStart(2, '0')}cd34ef56ab`;
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0050' } };
    bridge.onWrite = (posted) => {
        let changes = 0;
        for (const [refn, got] of readAsOld(posted)) {
            const had = research.get(refn);
            if (!had) continue;
            for (const key of ['given', 'surname', 'birthPlace'] as const) {
                if (got[key] && got[key] !== had[key]) { had[key] = got[key]; changes++; }
            }
        }
        written.push(changes);
        const head = nextHead();
        return { head, ged: gedOf(head) };
    };
    bridge.replyExtra = () => ({ changes: written[written.length - 1], applied: written[written.length - 1] });
    await poll(page);
    const josef = () => page.evaluate(() => {
        const p = (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(x => x.refn === 'P0001');
        return { firstName: p.firstName, lastName: p.lastName, titleBefore: p.titleBefore ?? '', titleAfter: p.titleAfter ?? '' };
    });
    const asBefore = { firstName: 'Josef', lastName: 'Víšek', titleBefore: 'Ing.', titleAfter: 'st.' };
    expect(await josef()).toEqual(asBefore);
    const places = ['Praha', 'Brno', 'Kolín'];
    for (let round = 0; round < 3; round++) {
        // One edit here, sent.
        await editJan(page, places[round]);
        await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
        await expect.poll(() => written.length).toBe(round + 1);
        // Something new there (Anna's birth, added in the research), loaded.
        research.get('P0002')!.birthPlace = `Čáslav ${round}`;
        const head = nextHead();
        bridge.head = head;
        bridge.treeGed = gedOf(head);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        const load = page.locator('#research-load-modal #research-load-ok');
        const loaded = () => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);
        await expect.poll(async () => (await loaded()) === head || await load.isVisible()).toBe(true);
        if (await load.isVisible()) await load.click();
        await expect.poll(loaded).toBe(head);
        expect(await josef(), `round ${round + 1}`).toEqual(asBefore);
    }
    // Each send wrote exactly the one edit; the research holds the name without the titles, never "Ing. Josef st.".
    expect(written).toEqual([1, 1, 1]);
    expect(research.get('P0001')).toMatchObject({ given: 'Josef', surname: 'Víšek' });
    for (const posted of bridge.posts) expect(posted).not.toMatch(/Ing\.|NPFX|NSFX/);
    await expect(card(page, 'Josef').locator('.name-text')).toHaveAttribute('title', 'Ing. Josef Víšek st.');
    // The research menu says the research keeps no titles, with "How to update…".
    await openResearchMenu(page);
    const older = page.locator('#research-older-block');
    await expect(older).toContainText("The research has an older version (1.12.1) that doesn't keep titles.");
    await older.getByRole('menuitem', { name: 'How to update…' }).click();
    await expect(page.locator('#research-update-modal .research-update-intro')).toContainText("doesn't keep the titles before and after names");
});


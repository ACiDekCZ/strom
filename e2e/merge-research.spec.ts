import { test, expect, type Locator, type Page } from '@playwright/test';
import { card, openApp, importAsNewTree, importJsonAsNewTree, mergeCompare, mergeCurrentStep, mergeDone, mergeJoinPending, mergeToStep5, mergeTreeInto, mergeWrite } from './helpers.js';
import { type FakeBridge, fakeBridge, links, openResearch, poll } from './research-bridge.js';

/**
 * The research after a merge (spec 134 §11) against a simulated bridge:
 * a merge written into a tree linked to a research stays in the app (K9.2:
 * nothing goes to the research by itself, even with sending by itself on),
 * the tree says "not sent" until it is sent, also after a reload; Send to
 * the research… sends it and the state goes; an undo after the send says
 * the research's command with the send's input (11c). A tree without a
 * research says nothing about one anywhere in the guide (11i).
 * The research tree Fíškovi (research-bridge.ts) and the file with
 * Bedřich Fíšek are invented, as are Modřínovi and rodokmen-jilmovi.ged.
 */

const WRITTEN = new Date(2026, 10, 22, 15, 41);

/** A file of the same family with one new person (Bedřich). */
const FISKOVI_GED = [
    '0 HEAD', '1 SOUR TEST', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 FAMS @F1@',
    '0 @I3@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 FAMC @F1@',
    '0 @I4@ INDI', '1 NAME Bedřich /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1901', '1 FAMC @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 CHIL @I4@',
    '0 TRLR',
].join('\n');

/**
 * Fíškovi linked to a research that sends by itself, the bridge simulated;
 * the file compared, its three people of the tree joined, Bedřich added, written
 * into the tree: the guide stands on step 6.
 */
async function writtenIntoResearchTree(page: Page): Promise<{ wizard: Locator; bridge: FakeBridge }> {
    await page.clock.install({ time: WRITTEN });
    await openResearch(page, { auto: true });
    const bridge = await fakeBridge(page);
    await page.locator('#gedcom-input').setInputFiles({ name: 'fiskovi-dopis.ged', mimeType: 'text/plain', buffer: Buffer.from(FISKOVI_GED) });
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    await mergeJoinPending(wizard);
    await mergeWrite(wizard, 'tree');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    return { wizard, bridge };
}

const research = (wizard: Locator): Locator => wizard.locator('.merge-s6-research');
const hold = (page: Page): Locator => page.locator('#tree-switcher-hold');
const panel = (page: Page): Locator => page.locator('#research-changes-panel');

test('a merge into a tree with a research is not sent by itself; the tree says "not sent" also after a reload; Send… of Manage trees sends it and the state goes', async ({ page }) => {
    const { wizard, bridge } = await writtenIntoResearchTree(page);
    await expect(research(wizard)).toBeVisible();
    await expect(research(wizard)).toContainText('stay only in the app for now');
    // Sending by itself is on, a minute goes by: the bridge got no send.
    await page.clock.runFor(60_000);
    await poll(page);
    expect(bridge.posts).toHaveLength(0);
    await mergeDone(wizard);
    await expect(hold(page)).toHaveText(/^not sent to the research · \d+ (person|people)$/);
    expect(bridge.posts).toHaveLength(0);

    await page.reload();
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(hold(page)).toHaveText(/^not sent to the research/);
    await page.clock.runFor(60_000);
    expect(bridge.posts).toHaveLength(0);

    // Manage trees says it on the tree's row, its Send… opens What will be sent.
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const row = page.locator('.tree-manager-item-hold');
    await expect(row).toContainText('not sent: merge of');
    await row.locator('.tree-manager-hold-send').click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText('From a family tree (unverified)');
    // The lead counts the rows of the list below it (V-N5): Bedřich, the one row; a link is no row of its own.
    await expect(panel(page).locator('.research-changes-row[data-kind="person"]')).toHaveCount(1);
    await expect(panel(page)).toContainText(/: 1 new person\. The details go/);
    await expect(panel(page)).not.toContainText(/\blinks?\b/);
    await panel(page).locator('[data-act="send"]').click();
    await expect.poll(() => bridge.posts.length).toBe(1);
    // The new person goes as from a family tree: the file's mark on him and his facts (K9.4);
    // the people joined stay the research's own (its numbers, no import mark).
    const records = bridge.posts[0].split('\n0 ');
    const bedrich = records.find(r => r.includes('1 NAME Bedřich /Fíšek/'))!;
    expect(bedrich).toMatch(/\n1 _STROM_IMPORT I\S+/);
    expect(bedrich).toMatch(/1 BIRT\n2 DATE 1901\n2 _STROM_IMPORT I\S+/);
    expect(bedrich).not.toContain('REFN');
    const josef = records.find(r => r.includes('1 NAME Josef /Fíšek/'))!;
    expect(josef).toContain('1 REFN P0001');
    expect(josef).not.toContain('_STROM_IMPORT');
    await expect(hold(page)).toBeHidden();
});

test('Send to the research… of step 6 closes the guide and sends the merge; its undo then says the research\'s command with the send\'s input and removes the person the send numbered (V-N3)', async ({ page }) => {
    const { wizard, bridge } = await writtenIntoResearchTree(page);
    // The research writes the send at once and numbers the person it added (its answer's ids, by the file's xref).
    bridge.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 2, applied: 2, input: 'I0042' } };
    bridge.onWrite = (posted) => ({ head: 'b7b7b7b7b7b7', ged: posted });
    bridge.replyExtra = (posted) => {
        const rec = posted.split('\n0 ').find(r => r.includes('1 NAME Bedřich /Fíšek/'));
        const xref = rec ? /^(@[^@]+@) INDI/.exec(rec)?.[1] : undefined;
        return xref ? { ids: { persons: { [xref]: 'P0077' }, sources: {} } } : {};
    };
    await research(wizard).locator('[data-ract="send"]').click();
    await expect(panel(page)).toBeVisible();
    await panel(page).locator('[data-act="send"]').click();
    await expect.poll(() => bridge.posts.length).toBe(1);
    await expect(hold(page)).toBeHidden();

    // The guide closed on the tree for the send.
    await expect(wizard).toBeHidden();
    await expect.poll(() => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Bedřich')?.refn)).toBe('P0077');

    // The research names the send's input in its sends: the undo says its command.
    bridge.sends[0].input = 'I0042';
    // The research takes its undo by a link (`sync-undo` announced): the step is offered as an action too.
    bridge.links = [...bridge.links, 'sync-undo'];
    await poll(page);
    await page.evaluate(() => {
        const D = window.Strom.DataManager;
        window.Strom.UI.showUndoMerge(D.getCurrentTreeId(), D.getData().merges[0].id);
    });
    const undo = page.locator('#merge-undo-modal');
    await expect(undo).toHaveClass(/active/);
    await expect(undo.locator('.merge-undo-research .merge-undo-cmd')).toHaveText('strom sync undo I0042');
    await expect(undo.locator('.merge-undo-research')).toContainText('so the research has its people');
    // The step is the research terminal's: its mark beside the words.
    await expect(undo.locator('.merge-undo-research .research-undo-lead .research-open-mark')).toBeVisible();
    // The number the send gave him is no edit: he goes, nothing is kept as changed since.
    await expect(undo.locator('.merge-undo-keep')).toHaveCount(0);
    await undo.locator('[data-act="undo"]').click();
    await expect(undo).not.toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).some(p => p.firstName === 'Bedřich'))).toBe(false);
    // Undone in the tree: its toast offers taking it back in the research too (K5.6), the terminal's step.
    const take = page.locator('.toast').getByRole('button', { name: /Take back in the research/ });
    await expect(take).toBeVisible();
    await expect(take.locator('.research-open-mark')).toHaveCount(1);
    await take.click();
    await expect.poll(async () => (await links(page)).filter(l => l.includes('://sync-undo?'))).toEqual([expect.stringMatching(/^strom-research:\/\/sync-undo\?tree=[^&]+&intake=I0042$/)]);
});

/** An older tree of the app (data version 14, no import record): the same family with Bedřich. */
const OLD_TREE = {
    version: 14,
    persons: {
        o1: { id: 'o1', firstName: 'Josef', lastName: 'Fíšek', gender: 'male', isPlaceholder: false, partnerships: ['ou1'], parentIds: [], childIds: ['o3', 'o4'] },
        o2: { id: 'o2', firstName: 'Anna', lastName: 'Svobodová', gender: 'female', isPlaceholder: false, partnerships: ['ou1'], parentIds: [], childIds: ['o3', 'o4'] },
        o3: { id: 'o3', firstName: 'Jan', lastName: 'Fíšek', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: ['o1', 'o2'], childIds: [] },
        o4: { id: 'o4', firstName: 'Bedřich', lastName: 'Fíšek', gender: 'male', isPlaceholder: false, birthDate: '1901', partnerships: [], parentIds: ['o1', 'o2'], childIds: [] },
    },
    partnerships: { ou1: { id: 'ou1', person1Id: 'o1', person2Id: 'o2', childIds: ['o3', 'o4'], status: 'married' } },
};

test('a tree of the app without an import record merged into the research\'s tree goes as a family tree: the HEAD names it (SOUR Strom), its new person carries the marks (1127)', async ({ page }) => {
    await page.clock.install({ time: WRITTEN });
    await openResearch(page, { auto: true });
    const bridge = await fakeBridge(page);
    const researchId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    await importAsNewTree(page, OLD_TREE, 'Fíškovi – starý strom');
    const sourceId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    expect(sourceId).not.toBe(researchId);
    const wizard = await mergeTreeInto(page, sourceId, researchId);
    await mergeCompare(wizard);
    await mergeJoinPending(wizard);
    await mergeWrite(wizard, 'tree');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    await research(wizard).locator('[data-ract="send"]').click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText('From a family tree (unverified)');
    await panel(page).locator('[data-act="send"]').click();
    await expect.poll(() => bridge.posts.length).toBe(1);
    const records = bridge.posts[0].split('\n0 ');
    const head = records[0];
    const id = /\n1 _STROM_IMPORT (I\d+)\n2 SOUR Strom\n2 _AT 2026-11-22\n2 FILE Fíškovi – starý strom(\n|$)/.exec(head)?.[1];
    expect(id, head).toBeDefined();
    const bedrich = records.find(r => r.includes('1 NAME Bedřich /Fíšek/'))!;
    expect(bedrich).toContain(`\n1 _STROM_IMPORT ${id}`);
    expect(bedrich).toMatch(new RegExp(`1 BIRT\n2 DATE 1901\n2 _STROM_IMPORT ${id}`));
    // The people joined stay the research's own.
    const josef = records.find(r => r.includes('1 NAME Josef /Fíšek/'))!;
    expect(josef).toContain('1 REFN P0001');
    expect(josef).not.toContain('_STROM_IMPORT');
});

test('a tree without a research: no step of the guide says a word about a research', async ({ page }) => {
    await page.clock.install({ time: WRITTEN });
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    const said = async () => expect(await wizard.textContent()).not.toMatch(/research|výzkum/i);
    await said();
    await mergeCompare(wizard);
    await said();
    await mergeToStep5(wizard);
    await said();
    await mergeWrite(wizard, 'tree');
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '6');
    await said();
});

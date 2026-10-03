import { test, expect, Page, Browser, TestInfo } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, createFirstPerson, addRelation, card, cardAction, waitForPersist } from './helpers.js';

/**
 * Collaboration beyond the basic round trip (share.spec.ts, share-diff.spec.ts):
 * - change packet with edits on BOTH sides: the recipient changes a person and
 *   adds one, the owner meanwhile edits the same person and adds a child; the
 *   preview names the updated fields and Accept keeps the owner's edits;
 *   re-opening the packet says it is already applied;
 * - a whole-file reply imported as a new tree ("Import as a new tree");
 * - a reply file opened as the app itself (view mode) leaving view mode into
 *   the owner's tree with the merge wizard.
 *
 * Shared files are served AS strom.html (route) instead of file://, so the
 * recipient's app runs on the same http origin setup as every other suite.
 */

// Two or three app loads of the 2 MB single-file app per test: allow for a busy machine.
test.describe.configure({ timeout: 60_000 });

type PersonLite = { firstName: string; birthDate?: string; birthPlace?: string; isPlaceholder?: boolean; childIds: string[]; id: string };

/** Serve `filePath` as /strom.html for the next navigation(s) of `page`, then open it. */
async function openFileAsApp(page: Page, filePath: string): Promise<void> {
    const body = readFileSync(filePath, 'utf-8');
    await page.route('**/strom.html', route => route.fulfill({ body, contentType: 'text/html; charset=utf-8' }));
    await openApp(page);
    await page.unroute('**/strom.html');
}

/** Owner: Milan with his son Petr, shared whole (full names) with a message. */
async function shareOwnerTree(page: Page, testInfo: TestInfo): Promise<string> {
    await openApp(page);
    await createFirstPerson(page, 'Milan', 'Odesilatel');
    await addRelation(page, 'Milan', 'child', 'Petr', 'Odesilatel');
    await waitForPersist(page, 'Petr');

    await page.evaluate(() => window.Strom.UI.showShareDialog());
    const share = page.locator('#share-modal');
    await expect(share).toBeVisible();
    await share.locator('#share-sender-name').fill('Milan');
    await share.locator('#share-message').fill('Please fill in what you know');
    await share.locator('#share-privacy-mode').selectOption('full');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        share.getByRole('button', { name: 'Create file to send' }).click(),
    ]);
    const sharedPath = testInfo.outputPath('shared.html');
    await download.saveAs(sharedPath);
    return sharedPath;
}

/** Recipient: open the shared file in a fresh browser, take the welcome's "Add what I know". */
async function openAsRecipient(browser: Browser, sharedPath: string): Promise<Page> {
    const ctx = await browser.newContext();
    const uncle = await ctx.newPage();
    await openFileAsApp(uncle, sharedPath);
    const welcome = uncle.locator('#share-welcome-modal');
    await expect(welcome).toBeVisible();
    await expect(uncle.locator('#share-welcome-title')).toHaveText('Milan sent you a family tree');
    await expect(uncle.locator('#share-welcome-counts')).toContainText('2 people');
    await expect(uncle.locator('#share-welcome-message')).toHaveText('Please fill in what you know');
    await welcome.getByRole('button', { name: 'Add what I know' }).click();
    // The bar appears once the baseline of the received state is saved.
    await expect(uncle.locator('#collab-bar')).toBeVisible();
    await expect(uncle.locator('#collab-bar-text')).toHaveText('You are filling in a tree for Milan.');
    await expect(uncle.locator('body')).not.toHaveClass(/view-mode/);
    return uncle;
}

/** Recipient: collaboration bar → "Send the file back" → share dialog (scope picked). */
async function openSendBack(uncle: Page, scope: 'whole' | 'changes'): Promise<void> {
    await uncle.locator('#collab-bar .collab-send').click();
    const share = uncle.locator('#share-modal');
    await expect(share).toBeVisible();
    await share.locator('#share-sender-name').fill('Strejda');
    if (scope === 'changes') {
        await expect.poll(() => uncle.evaluate(() =>
            document.getElementById('share-scope-changes')?.style.display !== 'none')).toBe(true);
        // Set the value directly — selectOption on a just-revealed <option> is flaky.
        await uncle.evaluate(() => {
            const s = document.getElementById('share-scope') as HTMLSelectElement;
            s.value = 'changes';
            s.dispatchEvent(new Event('change'));
        });
        // A change file carries no privacy / password choice.
        await expect(share.locator('#share-privacy-mode')).toBeHidden();
        await expect(share.locator('#share-password')).toBeHidden();
    } else {
        await share.locator('#share-privacy-mode').selectOption('full');
    }
}

function persons(page: Page): Promise<PersonLite[]> {
    return page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons) as PersonLite[]);
}

test('change packet with edits on both sides: preview names the fields, Accept keeps the owner\'s edits', { tag: '@smoke' }, async ({ page, browser }, testInfo) => {
    const sharedPath = await shareOwnerTree(page, testInfo);

    // ---- RECIPIENT ----
    const uncle = await openAsRecipient(browser, sharedPath);

    // Nothing changed yet: "only changes" makes no file, just says so.
    let uncleDownloads = 0;
    uncle.on('download', () => { uncleDownloads++; });
    await openSendBack(uncle, 'changes');
    await uncle.locator('#share-modal').getByRole('button', { name: 'Create file to send' }).click();
    await expect(uncle.locator('#share-modal')).toBeHidden();
    await expect(uncle.locator('.toast', { hasText: 'Nothing has changed since the last share' })).toBeVisible();
    expect(uncleDownloads).toBe(0);
    await uncle.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));

    // Hide the bar: a badge stays; the badge brings the bar back.
    await uncle.locator('#collab-bar .collab-hide').click();
    await expect(uncle.locator('#collab-bar')).toBeHidden();
    await expect(uncle.locator('#collab-badge')).toBeVisible();
    await uncle.locator('#collab-badge').click();
    await expect(uncle.locator('#collab-bar')).toBeVisible();
    await expect(uncle.locator('#collab-badge')).toBeHidden();

    // The recipient fills in Petr's birth date and adds Milan's daughter Anna.
    await cardAction(uncle, 'Petr', 'edit');
    const modal = uncle.locator('#person-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#input-birthdate').fill('1980');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    await addRelation(uncle, 'Milan', 'child', 'Anna', 'Odesilatel', 'female');
    await uncle.evaluate(() => window.Strom.UI.dismissUndoToast?.());

    await openSendBack(uncle, 'changes');
    const [packet] = await Promise.all([
        uncle.waitForEvent('download'),
        uncle.locator('#share-modal').getByRole('button', { name: 'Create file to send' }).click(),
    ]);
    expect(packet.suggestedFilename()).toMatch(/\.strom-changes\.json$/);
    const packetPath = testInfo.outputPath('reply.strom-changes.json');
    await packet.saveAs(packetPath);
    // A change file is small and carries no app.
    const packetJson = JSON.parse(readFileSync(packetPath, 'utf-8'));
    expect(packetJson.kind).toBe('strom-changes');
    expect(packetJson.senderName).toBe('Strejda');
    await uncle.context().close();

    // ---- OWNER: own edits made meanwhile ----
    await cardAction(page, 'Petr', 'edit');
    const ownModal = page.locator('#person-modal');
    await ownModal.locator('#input-birthplace').fill('Brno');
    await ownModal.getByRole('button', { name: 'Save' }).click();
    await expect(ownModal).toBeHidden();
    await addRelation(page, 'Milan', 'child', 'Ota', 'Odesilatel');
    await page.evaluate(() => window.Strom.UI.dismissUndoToast?.());

    // ---- OWNER: open the change file → named preview ----
    await page.locator('#file-input').setInputFiles(packetPath);
    const preview = page.locator('#share-packet-modal');
    await expect(preview).toBeVisible();
    await expect(page.locator('#share-packet-title')).toHaveText('Strejda sent you changes');
    await expect(page.locator('#share-packet-intro')).toContainText('These additions update your tree');
    const body = page.locator('#share-packet-body');
    await expect(body.locator('.share-packet-chip', { hasText: '1 new person' })).toBeVisible();
    await expect(body.locator('.share-packet-section', { hasText: 'New people' })).toContainText('Anna Odesilatel');
    const updated = body.locator('.share-packet-section', { hasText: 'Updated people' });
    await expect(updated.locator('li', { hasText: 'Petr' })).toContainText('changed: Birth date');
    // The owner's own birth-place edit is not listed as a change from the packet.
    await expect(updated.locator('li', { hasText: 'Petr' })).not.toContainText('Birth place');

    await preview.getByRole('button', { name: 'Accept changes' }).click();
    await expect(preview).toBeHidden();
    await expect(page.locator('.toast', { hasText: 'Applied — 1 added' })).toBeVisible();

    // Both sides' edits are in the tree.
    await expect.poll(async () => {
        const all = await persons(page);
        const petr = all.find(p => p.firstName === 'Petr');
        return { birthDate: petr?.birthDate, birthPlace: petr?.birthPlace };
    }).toEqual({ birthDate: '1980', birthPlace: 'Brno' });
    const all = await persons(page);
    expect(all.filter(p => !p.isPlaceholder).map(p => p.firstName).sort()).toEqual(['Anna', 'Milan', 'Ota', 'Petr']);
    // Milan keeps all three children (the packet's child list merged as a set).
    const milan = all.find(p => p.firstName === 'Milan')!;
    const childNames = milan.childIds.map(id => all.find(p => p.id === id)?.firstName).sort();
    expect(childNames).toEqual(['Anna', 'Ota', 'Petr']);
    await expect(card(page, 'Anna')).toBeVisible();
    await expect(card(page, 'Ota')).toBeVisible();
    await waitForPersist(page, 'Anna');

    // Re-opening the same packet changes nothing and says so.
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    await page.locator('#file-input').setInputFiles(packetPath);
    await expect(page.locator('#confirm-message')).toHaveText('These changes are already in your tree — nothing to apply.');
    await expect(preview).toBeHidden();
    expect((await persons(page)).filter(p => !p.isPlaceholder)).toHaveLength(4);
});

/** Recipient adds Strycek and sends the WHOLE file back; returns its path. */
async function makeWholeReply(browser: Browser, sharedPath: string, testInfo: TestInfo): Promise<string> {
    const uncle = await openAsRecipient(browser, sharedPath);
    await addRelation(uncle, 'Milan', 'sibling', 'Strycek', 'Odesilatel');
    await openSendBack(uncle, 'whole');
    await uncle.locator('#share-message').fill('I added your brother');
    const [reply] = await Promise.all([
        uncle.waitForEvent('download'),
        uncle.locator('#share-modal').getByRole('button', { name: 'Create file to send' }).click(),
    ]);
    const replyPath = testInfo.outputPath('reply.html');
    await reply.saveAs(replyPath);
    await uncle.context().close();
    return replyPath;
}

test('a returned whole file can be imported as a separate new tree', async ({ page, browser }, testInfo) => {
    const sharedPath = await shareOwnerTree(page, testInfo);
    const replyPath = await makeWholeReply(browser, sharedPath, testInfo);
    const ownTreeId: string = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());

    await page.locator('#html-input').setInputFiles(replyPath);
    const reply = page.locator('#share-reply-modal');
    await expect(reply).toBeVisible();
    await expect(page.locator('#share-reply-title')).toHaveText('Strejda returned your tree');
    await expect(page.locator('#share-reply-message')).toHaveText('I added your brother');

    await reply.getByRole('button', { name: 'Import as a new tree' }).click();
    await expect(reply).toBeHidden();
    await expect(page.locator('#merge-modal')).toBeHidden();

    // A second tree holds the reply; mine is untouched.
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(2);
    const activeId: string = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    expect(activeId).not.toBe(ownTreeId);
    await expect(card(page, 'Strycek')).toBeVisible();
    const names = await page.evaluate(async (id) => {
        const data = await window.Strom.TreeManager.getTreeData(id);
        return (Object.values(data!.persons) as Array<{ firstName: string; isPlaceholder?: boolean }>)
            .filter(p => !p.isPlaceholder).map(p => p.firstName).sort();
    }, ownTreeId);
    expect(names).toEqual(['Milan', 'Petr']);
});

test('a returned file opened as the app offers the merge and leaves view mode into my tree', async ({ page, browser }, testInfo) => {
    const sharedPath = await shareOwnerTree(page, testInfo);
    const replyPath = await makeWholeReply(browser, sharedPath, testInfo);
    const ownTreeId: string = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());

    // The owner opens the reply file itself (same browser storage).
    await openFileAsApp(page, replyPath);
    await expect(page.locator('body')).toHaveClass(/view-mode/);
    const reply = page.locator('#share-reply-modal');
    await expect(reply).toBeVisible();
    await expect(page.locator('#share-reply-title')).toHaveText('Strejda returned your tree');
    // Not offered as "already stored" — the reply keeps its merge offer.
    await expect(page.locator('#existing-export-modal')).toBeHidden();

    await reply.getByRole('button', { name: 'Review and merge' }).click();
    await expect(reply).toBeHidden();
    const merge = page.locator('#merge-modal');
    await expect(merge).toBeVisible();
    await expect(merge).toContainText('Strycek');
    // Out of view mode, onto my own stored tree, no extra tree created.
    await expect(page.locator('body')).not.toHaveClass(/view-mode/);
    expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).toBe(ownTreeId);
    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(1);
});

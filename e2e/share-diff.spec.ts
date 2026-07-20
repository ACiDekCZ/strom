import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'url';
import { writeFileSync } from 'fs';
import { openApp, createFirstPerson, card, addRelation } from './helpers.js';

/**
 * Change packets ("send only changes"): the sender shares a whole tree; the
 * recipient adds a person and sends back a tiny .strom-changes.json; the sender
 * opens it, sees a named preview of what it changes, and Accepts it — the
 * addition lands in the tree as a single undoable step.
 */
test('change packet round-trip: preview names the change, Accept applies with undo', async ({ page, browser }, testInfo) => {
    // ---- SENDER: small tree, share the whole thing ----
    await openApp(page);
    await createFirstPerson(page, 'Milan', 'Odesilatel');
    await addRelation(page, 'Milan', 'child', 'Petr', 'Odesilatel');

    await page.evaluate(() => window.Strom.UI.showShareDialog());
    const share = page.locator('#share-modal');
    await expect(share).toBeVisible();
    await share.locator('#share-sender-name').fill('Milan');
    await share.locator('#share-privacy-mode').selectOption('full');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        share.getByRole('button', { name: 'Create file to send' }).click(),
    ]);
    const sharedPath = testInfo.outputPath('shared.html');
    await download.saveAs(sharedPath);

    // ---- RECIPIENT: open file, "Add what I know", add a person ----
    const uncleCtx = await browser.newContext();
    const uncle = await uncleCtx.newPage();
    await uncle.goto(pathToFileURL(sharedPath).href);
    await uncle.locator('#share-welcome-modal').getByRole('button', { name: 'Add what I know' }).click();
    await expect(card(uncle, 'Petr')).toBeVisible();
    // The collaboration bar appears at the end of the save flow — after the
    // baseline is captured. Wait for it before mutating, so the baseline holds
    // the received state (without the new person).
    await expect(uncle.locator('#collab-bar')).toBeVisible();

    await uncle.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Strycek', lastName: 'Doplnil', gender: 'male' }));

    // Open the share dialog; the "only changes" option appears once the baseline
    // is saved. Pick it and create the small change file.
    await uncle.evaluate(() => window.Strom.UI.showShareDialog());
    const uncleShare = uncle.locator('#share-modal');
    await expect(uncleShare).toBeVisible();
    await expect.poll(() => uncle.evaluate(() =>
        document.getElementById('share-scope-changes')?.style.display !== 'none'
    )).toBe(true);
    // Set the value directly — selectOption on a display:none <option> is flaky.
    await uncle.evaluate(() => {
        const s = document.getElementById('share-scope') as HTMLSelectElement;
        s.value = 'changes';
        s.dispatchEvent(new Event('change'));
    });
    const [packet] = await Promise.all([
        uncle.waitForEvent('download'),
        uncleShare.getByRole('button', { name: 'Create file to send' }).click(),
    ]);
    const packetPath = testInfo.outputPath('changes.strom-changes.json');
    await packet.saveAs(packetPath);
    await uncleCtx.close();

    // ---- SENDER: open the packet -> dedicated preview names the addition ----
    await page.locator('#file-input').setInputFiles(packetPath);
    const preview = page.locator('#share-packet-modal');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Strycek');
    await expect(preview).toContainText(/new person|new people/i);
    // The heavy merge wizard is NOT the default door any more.
    await expect(page.locator('#merge-modal')).toBeHidden();

    // Accept applies the packet straight into the sender's tree data.
    const hasStrycek = () => page.evaluate(() =>
        Object.values(window.Strom.DataManager.getData().persons)
            .some((p: { firstName?: string }) => p.firstName === 'Strycek'));
    await preview.getByRole('button', { name: 'Accept changes' }).click();
    await expect(preview).toBeHidden();
    await expect.poll(hasStrycek).toBe(true);

    // One Ctrl+Z reverts the whole acceptance (undoable choke point).
    await page.evaluate(() => window.Strom.DataManager.undo());
    await expect.poll(hasStrycek).toBe(false);
});

/**
 * "Review in detail" escalates the same packet to the full merge engine, for
 * when the recipient wants per-person control rather than a blind accept.
 */
test('change packet preview: Review in detail opens the merge wizard', async ({ page, browser }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Milan', 'Odesilatel');
    await addRelation(page, 'Milan', 'child', 'Petr', 'Odesilatel');

    await page.evaluate(() => window.Strom.UI.showShareDialog());
    const share = page.locator('#share-modal');
    await expect(share).toBeVisible();
    await share.locator('#share-sender-name').fill('Milan');
    await share.locator('#share-privacy-mode').selectOption('full');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        share.getByRole('button', { name: 'Create file to send' }).click(),
    ]);
    const sharedPath = testInfo.outputPath('shared2.html');
    await download.saveAs(sharedPath);

    const uncleCtx = await browser.newContext();
    const uncle = await uncleCtx.newPage();
    await uncle.goto(pathToFileURL(sharedPath).href);
    await uncle.locator('#share-welcome-modal').getByRole('button', { name: 'Add what I know' }).click();
    await expect(card(uncle, 'Petr')).toBeVisible();
    await expect(uncle.locator('#collab-bar')).toBeVisible();
    await uncle.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Strycek', lastName: 'Doplnil', gender: 'male' }));
    await uncle.evaluate(() => window.Strom.UI.showShareDialog());
    const uncleShare = uncle.locator('#share-modal');
    await expect(uncleShare).toBeVisible();
    await expect.poll(() => uncle.evaluate(() =>
        document.getElementById('share-scope-changes')?.style.display !== 'none'
    )).toBe(true);
    await uncle.evaluate(() => {
        const s = document.getElementById('share-scope') as HTMLSelectElement;
        s.value = 'changes';
        s.dispatchEvent(new Event('change'));
    });
    const [packet] = await Promise.all([
        uncle.waitForEvent('download'),
        uncleShare.getByRole('button', { name: 'Create file to send' }).click(),
    ]);
    const packetPath = testInfo.outputPath('changes2.strom-changes.json');
    await packet.saveAs(packetPath);
    await uncleCtx.close();

    await page.locator('#file-input').setInputFiles(packetPath);
    const preview = page.locator('#share-packet-modal');
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: 'Review in detail' }).click();
    const merge = page.locator('#merge-modal');
    await expect(merge).toBeVisible();
    await expect(merge).toContainText('Strycek');
});

test('a change packet with no matching tree shows a clear message', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Solo', 'Root');

    const bogus = {
        kind: 'strom-changes', formatVersion: 1, baseExportId: 'does-not-exist',
        persons: { added: [], changed: [], removedIds: [] },
        partnerships: { added: [], changed: [], removedIds: [] },
        sources: { added: [], changed: [], removedIds: [] },
    };
    const p = testInfo.outputPath('orphan.strom-changes.json');
    writeFileSync(p, JSON.stringify(bogus));

    await page.locator('#file-input').setInputFiles(p);
    // No merge starts; a warning alert explains the missing tree.
    await expect(page.locator('#confirm-message')).toContainText(/matching tree|whole file/i);
    await expect(page.locator('#merge-modal')).toBeHidden();
});

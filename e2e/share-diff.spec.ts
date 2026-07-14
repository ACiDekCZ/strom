import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'url';
import { writeFileSync } from 'fs';
import { openApp, createFirstPerson, card, addRelation } from './helpers.js';

/**
 * Change packets ("send only changes"): the sender shares a whole tree; the
 * recipient adds a person and sends back a tiny .strom-changes.json; the sender
 * imports it and the merge preview contains the addition (reconstructed against
 * the local baseline, then fed to the normal merge engine).
 */
test('change packet round-trip: recipient sends only changes, sender merges them', async ({ page, browser }, testInfo) => {
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

    // ---- SENDER: import the packet -> merge preview has the new person ----
    await page.locator('#file-input').setInputFiles(packetPath);
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

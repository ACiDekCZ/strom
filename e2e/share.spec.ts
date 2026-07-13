import { test, expect, Page, TestInfo } from '@playwright/test';
import { pathToFileURL } from 'url';
import { openApp, createFirstPerson, card, addRelation } from './helpers.js';

/**
 * Collaboration round-trip ("send to a relative"):
 * sender shares a file with a message -> the recipient opens it, gets the
 * welcome screen, saves an editable copy (collaboration bar), adds a person
 * and sends the file back -> the sender imports the reply in-app and gets the
 * merge offer whose preview contains the addition.
 */
test('share round-trip: welcome, collaboration bar, reply merge offer', async ({ page, browser }, testInfo) => {
    // ---- SENDER: build a small tree and share it with a message ----
    await openApp(page);
    await createFirstPerson(page, 'Milan', 'Odesilatel');
    await addRelation(page, 'Milan', 'child', 'Petr', 'Odesilatel');

    await page.evaluate(() => window.Strom.UI.showShareDialog());
    const share = page.locator('#share-modal');
    await expect(share).toBeVisible();
    await share.locator('#share-sender-name').fill('Milan');
    await share.locator('#share-message').fill('Doplň prosím, co víš!');
    await share.locator('#share-privacy-mode').selectOption('full');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        share.getByRole('button', { name: 'Create file to send' }).click(),
    ]);
    const sharedPath = testInfo.outputPath('shared.html');
    await download.saveAs(sharedPath);

    // ---- RECIPIENT: fresh context, open the file, welcome screen shows ----
    const uncleCtx = await browser.newContext();
    const uncle = await uncleCtx.newPage();
    await uncle.goto(pathToFileURL(sharedPath).href);
    const welcome = uncle.locator('#share-welcome-modal');
    await expect(welcome).toBeVisible();
    await expect(uncle.locator('#share-welcome-title')).toContainText('Milan');
    await expect(uncle.locator('#share-welcome-message')).toContainText('Doplň prosím');

    // "Add what I know" -> editable copy + collaboration bar
    await welcome.getByRole('button', { name: 'Add what I know' }).click();
    await expect(uncle.locator('#collab-bar')).toBeVisible();
    await expect(uncle.locator('#collab-bar-text')).toContainText('Milan');
    await expect(card(uncle, 'Petr')).toBeVisible();

    // The uncle adds a person, then sends the file back.
    await uncle.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.createPerson({ firstName: 'Strycek', lastName: 'Doplnil', gender: 'male' });
    });
    await uncle.locator('#collab-bar .collab-send').click();
    const uncleShare = uncle.locator('#share-modal');
    await expect(uncleShare).toBeVisible();
    await uncleShare.locator('#share-sender-name').fill('Strejda');
    await uncleShare.locator('#share-privacy-mode').selectOption('full');
    const [reply] = await Promise.all([
        uncle.waitForEvent('download'),
        uncleShare.getByRole('button', { name: 'Create file to send' }).click(),
    ]);
    const replyPath = testInfo.outputPath('reply.html');
    await reply.saveAs(replyPath);
    await uncleCtx.close();

    // ---- SENDER AGAIN: import the reply in-app -> merge offer ----
    await page.locator('#html-input').setInputFiles(replyPath);
    const replyModal = page.locator('#share-reply-modal');
    await expect(replyModal).toBeVisible();
    await expect(page.locator('#share-reply-title')).toContainText('Strejda');

    await replyModal.getByRole('button', { name: 'Review and merge' }).click();
    // The merge wizard opens over MY tree with the uncle's addition proposed.
    const merge = page.locator('#merge-modal');
    await expect(merge).toBeVisible();
    await expect(merge).toContainText('Strycek');
});

test('a plain (non-shared) export shows no welcome screen', async ({ page, browser }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeApp());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    const out = testInfo.outputPath('plain.html');
    await download.saveAs(out);

    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await viewer.goto(pathToFileURL(out).href);
    await expect(viewer.locator('.toolbar')).toBeVisible();
    await expect(viewer.locator('#share-welcome-modal')).toBeHidden();
    await ctx.close();
});

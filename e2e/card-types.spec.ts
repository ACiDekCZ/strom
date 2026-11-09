import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedSetting } from './helpers.js';

/**
 * Settings → "Card detail" (U03b): the row of the five card types — a radio
 * group of tiles with a small sample card each — the chosen type's sentence,
 * "Edit as Custom" on the preset types with its notice and "Restore
 * previous", and the "Same as …" note when Custom equals a preset. Phone:
 * three columns; phone held sideways: a segment of names. Invented data (the
 * sample tree).
 */

const PRESET_REGISTER_ON = ['birth', 'baptism', 'marriage', 'death', 'burial'];
const MINE = { on: ['marriage'], style: 'labels', widthCap: 400 };

async function sampleTree(page: Page, density = 'normal', fields?: unknown): Promise<void> {
    await seedSetting(page, 'cardDensity', density);
    if (fields) await seedSetting(page, 'cardFields', fields);
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(page.locator('#settings-modal')).toBeVisible();
}

const row = (page: Page) => page.locator('#card-type-row');
const tile = (page: Page, name: string) => row(page).getByRole('radio', { name, exact: true });
const host = (page: Page) => page.locator('#card-type-settings');
const stored = (page: Page) => page.evaluate(() => window.Strom.SettingsManager.getCardFields() as { on: string[]; style: string; widthCap: number });
const density = (page: Page) => page.evaluate(() => window.Strom.SettingsManager.getCardDensity() as string);

test('five tiles with a small card each, one chosen with its sentence; a click chooses and stays after a reload', async ({ page }) => {
    await sampleTree(page);
    await openSettings(page);
    await expect(row(page)).toHaveAttribute('role', 'radiogroup');
    await expect(row(page)).toHaveAccessibleName('Card detail');
    await expect(row(page).locator('.card-type-name')).toHaveText(['Compact', 'Normal', 'Detailed', 'Register', 'Custom…']);
    await expect(row(page).locator('[aria-checked="true"] .card-type-name')).toHaveText('Normal');
    // One tab stop: the chosen tile.
    await expect(row(page).locator('[role="radio"][tabindex="0"] .card-type-name')).toHaveText('Normal');
    await expect(row(page).locator('[role="radio"][tabindex="-1"]')).toHaveCount(4);
    // A real card a tile, hidden from the reader, without signals (unreadable that small).
    await expect(row(page).locator('.card-type-thumb[aria-hidden="true"] .person-card')).toHaveCount(5);
    await expect(row(page).locator('.card-type-thumb .card-signal, .card-type-thumb .card-signal-dot, .card-type-thumb .card-status-mark')).toHaveCount(0);
    // A quarter of the card: Normal's 188 × 64 box drawn 47 × 16.
    const normalThumb = await tile(page, 'Normal').locator('.card-type-thumb-box').boundingBox();
    expect([Math.round(normalThumb!.width), Math.round(normalThumb!.height)]).toEqual([47, 16]);
    await expect(host(page).locator('.card-type-desc')).toHaveText('Name, years and place of birth.');
    await expect(host(page).locator('.card-type-edit')).toHaveCount(0);

    await tile(page, 'Compact').click();
    await expect(host(page).locator('.card-type-desc')).toHaveText('Name only.');
    await tile(page, 'Detailed').click();
    await expect(host(page).locator('.card-type-desc')).toHaveText('Birth and death with place, age, occupation.');
    await expect(host(page).locator('.card-type-edit')).toHaveText('Edit as Custom');
    await tile(page, 'Register').click();
    await expect(page.locator('body')).toHaveAttribute('data-card-density', 'register');
    await expect(tile(page, 'Register')).toHaveAttribute('aria-checked', 'true');
    await expect(tile(page, 'Normal')).toHaveAttribute('aria-checked', 'false');
    await expect(host(page).locator('.card-type-desc')).toHaveText(
        'Birth, baptism, marriage, death with cause and burial, each with place and full date.');
    await expect(host(page).locator('.card-type-edit')).toBeVisible();
    // Custom has no sentence; its panel opens under the preview.
    await tile(page, 'Custom…').click();
    await expect(host(page).locator('.card-type-desc')).toHaveCount(0);
    await expect(page.locator('#card-fields-settings')).toBeVisible();
    await tile(page, 'Register').click();
    await expect(page.locator('#card-fields-settings')).toBeHidden();

    await page.reload();
    await expect(card(page, 'Johan')).toBeVisible();
    expect(await density(page)).toBe('register');
    await openSettings(page);
    await expect(row(page).locator('[aria-checked="true"] .card-type-name')).toHaveText('Register');
});

test('keyboard: the arrows move the choice and the focus, wrapping; Home and End; one tab stop', async ({ page }) => {
    await sampleTree(page);
    await openSettings(page);
    await tile(page, 'Normal').focus();
    const expectChosen = async (name: string, key: string) => {
        await expect(tile(page, name)).toHaveAttribute('aria-checked', 'true');
        await expect(tile(page, name)).toBeFocused();
        await expect(tile(page, name)).toHaveAttribute('tabindex', '0');
        await expect(page.locator('body')).toHaveAttribute('data-card-density', key);
    };
    await page.keyboard.press('ArrowRight');
    await expectChosen('Detailed', 'detailed');
    await page.keyboard.press('ArrowDown');
    await expectChosen('Register', 'register');
    await page.keyboard.press('ArrowLeft');
    await expectChosen('Detailed', 'detailed');
    await page.keyboard.press('ArrowUp');
    await expectChosen('Normal', 'normal');
    await page.keyboard.press('End');
    await expectChosen('Custom…', 'custom');
    await page.keyboard.press('ArrowRight');
    await expectChosen('Compact', 'compact');
    await page.keyboard.press('ArrowLeft');
    await expectChosen('Custom…', 'custom');
    await page.keyboard.press('Home');
    await expectChosen('Compact', 'compact');
    // Tab leaves the group at once (no stop on the other tiles).
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('#card-type-row') === null)).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect(tile(page, 'Compact')).toBeFocused();
});

test('choosing a type keeps the Custom fields; "Edit as Custom" copies the preset, "Restore previous" brings the old ones back', async ({ page }) => {
    await sampleTree(page, 'normal', MINE);
    await openSettings(page);
    await tile(page, 'Detailed').click();
    await tile(page, 'Register').click();
    expect((await stored(page)).on).toEqual(['marriage']);

    await host(page).locator('.card-type-edit').click();
    expect(await density(page)).toBe('custom');
    await expect(tile(page, 'Custom…')).toHaveAttribute('aria-checked', 'true');
    const copied = await stored(page);
    expect(copied.on).toEqual(PRESET_REGISTER_ON);
    expect([copied.style, copied.widthCap]).toEqual(['labels', 320]);
    const notice = host(page).locator('.card-type-notice');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice.locator('.card-type-notice-text')).toHaveText('Custom now has the Register settings.');
    await expect(notice).toBeFocused();
    await expect(page.locator('#card-fields-settings')).toBeVisible();
    // The notice says it; no "Same as" beside it.
    await expect(host(page).locator('.card-type-same')).toHaveCount(0);
    await expect(page.locator('#card-fields-settings input[type="checkbox"]:checked')).toHaveCount(5);

    await notice.getByRole('button', { name: 'Restore previous' }).click();
    expect(await stored(page)).toMatchObject(MINE);
    expect(await density(page)).toBe('custom');
    await expect(tile(page, 'Custom…')).toHaveAttribute('aria-checked', 'true');
    await expect(notice).toHaveCount(0);
    await expect(page.locator('#card-fields-settings input[type="checkbox"]:checked')).toHaveCount(1);
    await expect(tile(page, 'Custom…')).toBeFocused();

    // The next change in the panel takes the notice (and what it could restore) away.
    await tile(page, 'Register').click();
    await host(page).locator('.card-type-edit').click();
    await expect(notice).toBeVisible();
    await page.locator('#card-fields-settings .card-field-row[data-key="divorce"] input').check();
    await expect(notice).toHaveCount(0);

    // Closing Settings too.
    await tile(page, 'Detailed').click();
    await host(page).locator('.card-type-edit').click();
    await expect(notice.locator('.card-type-notice-text')).toHaveText('Custom now has the Detailed settings.');
    await page.keyboard.press('Escape');
    await openSettings(page);
    await expect(notice).toHaveCount(0);

    // Custom already was the preset: nothing to restore.
    await tile(page, 'Detailed').click();
    await host(page).locator('.card-type-edit').click();
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('button', { name: 'Restore previous' })).toHaveCount(0);
});

test('Custom equal to a preset: the Custom tile stays chosen with "Same as …"; the Custom tile draws its own fields', async ({ page }) => {
    await sampleTree(page);
    await openSettings(page);
    // The first Custom is the Detailed card's fields.
    await tile(page, 'Custom…').click();
    await expect(host(page).locator('.card-type-same')).toHaveText('Same as Detailed.');
    await expect(tile(page, 'Custom…')).toHaveAttribute('aria-checked', 'true');
    const lines = tile(page, 'Custom…').locator('.card-line');
    await expect(lines).toHaveCount(4);
    // A change of its own: no longer the preset, the small card follows.
    await page.locator('#card-fields-settings .card-field-row[data-key="marriage"] input').check();
    await expect(host(page).locator('.card-type-same')).toHaveCount(0);
    await expect(lines).toHaveCount(5);

    await tile(page, 'Register').click();
    await host(page).locator('.card-type-edit').click();
    await page.keyboard.press('Escape');
    await openSettings(page);
    await expect(host(page).locator('.card-type-same')).toHaveText('Same as Register.');
    await expect(row(page).locator('[aria-checked="true"] .card-type-name')).toHaveText('Custom…');
});

test('every type chosen in the row keeps "Show on card" in view and its stored choices', async ({ page }) => {
    await sampleTree(page);
    await openSettings(page);
    const kept = await page.evaluate(() => localStorage.getItem('strom-card-signals'));
    for (const name of ['Compact', 'Normal', 'Detailed', 'Register', 'Custom…']) {
        await tile(page, name).click();
        await expect(page.locator('#card-signals-settings .card-signals-options')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('strom-card-signals'))).toBe(kept);
    }
});

test('phone 360: three columns of thumb-sized tiles, "Edit as Custom" across the panel, the German names fit', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await sampleTree(page, 'register');
    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await openSettings(page);
    await row(page).scrollIntoViewIfNeeded();
    await expect(row(page).locator('.card-type-name')).toHaveText(['Kompakt', 'Normal', 'Detailliert', 'Matrikel', 'Eigene…']);
    const boxes = await row(page).getByRole('radio').evaluateAll(els => els.map(e => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height };
    }));
    // 3 + 2.
    expect(new Set(boxes.slice(0, 3).map(b => b.y)).size).toBe(1);
    expect(boxes[3].y).toBeGreaterThan(boxes[0].y);
    expect(boxes[3].x).toBe(boxes[0].x);
    expect(boxes[4].y).toBe(boxes[3].y);
    for (const b of boxes) {
        expect(b.h).toBeGreaterThanOrEqual(44);
        expect(b.w).toBeGreaterThanOrEqual(90);
    }
    // No name cut short.
    const cut = await row(page).locator('.card-type-name').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 0.5).length);
    expect(cut).toBe(0);
    const edit = await host(page).locator('.card-type-edit').boundingBox();
    const rowBox = await row(page).boundingBox();
    expect(edit!.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(edit!.width - rowBox!.width)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('phone held sideways: one segment of five names, no small cards, a thumb high', async ({ page }) => {
    await page.setViewportSize({ width: 740, height: 360 });
    await sampleTree(page, 'detailed');
    await openSettings(page);
    await row(page).scrollIntoViewIfNeeded();
    await expect(row(page).locator('.card-type-thumb').first()).toBeHidden();
    const boxes = await row(page).getByRole('radio').evaluateAll(els => els.map(e => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: Math.round(r.top), h: r.height };
    }));
    expect(new Set(boxes.map(b => b.top)).size).toBe(1);
    for (let i = 1; i < boxes.length; i++) expect(Math.abs(boxes[i].left - boxes[i - 1].right)).toBeLessThanOrEqual(1);
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44);
    // The chosen one filled, as a pressed segment button.
    const fill = await tile(page, 'Detailed').evaluate(e => getComputedStyle(e).backgroundColor);
    const primary = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.color = 'var(--primary)';
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    });
    expect(fill).toBe(primary);
});

/** The sentence under the row for each preset type, per language (src/strings.ts cardTypes.*Desc). */
const TYPE_SENTENCES: Record<'cs' | 'de', [string, string][]> = {
    cs: [
        ['Kompaktní', 'Jméno.'],
        ['Normální', 'Jméno, roky a místo narození.'],
        ['Podrobná', 'Narození a úmrtí s místem, věk, povolání.'],
        ['Matriční', 'Narození, křest, sňatek, úmrtí s příčinou a pohřeb, u každého místo a celé datum.'],
    ],
    de: [
        ['Kompakt', 'Nur der Name.'],
        ['Normal', 'Name, Jahre und Geburtsort.'],
        ['Detailliert', 'Geburt und Tod mit Ort, Alter, Beruf.'],
        ['Matrikel', 'Geburt, Taufe, Heirat, Tod mit Ursache und Beerdigung, jeweils mit Ort und vollem Datum.'],
    ],
};

for (const lang of ['cs', 'de'] as const) {
    test(`${lang}: the sentence under the row follows the chosen type, in the language of the app`, async ({ page }) => {
        await sampleTree(page);
        await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
        await openSettings(page);
        const sentence = host(page).locator('.card-type-desc');
        for (const [name, text] of TYPE_SENTENCES[lang]) {
            await tile(page, name).click();
            await expect(tile(page, name)).toHaveAttribute('aria-checked', 'true');
            await expect(sentence).toHaveText(text);
            // The row is described by the sentence of the chosen type.
            await expect(row(page)).toHaveAccessibleDescription(text);
        }
        // Custom has no sentence; back on a preset type its own returns.
        await row(page).locator('[role="radio"]').last().click();
        await expect(sentence).toHaveCount(0);
        const [firstName, firstText] = TYPE_SENTENCES[lang][0];
        await tile(page, firstName).click();
        await expect(sentence).toHaveText(firstText);
    });
}

test('Czech and German texts of the row, the notice and the note', async ({ page }) => {
    await sampleTree(page, 'register', MINE);
    await page.evaluate(() => window.Strom.UI.setLanguage('cs' as never));
    await openSettings(page);
    await expect(row(page)).toHaveAccessibleName('Detail karet');
    await expect(row(page).locator('.card-type-name')).toHaveText(['Kompaktní', 'Normální', 'Podrobná', 'Matriční', 'Vlastní…']);
    await expect(host(page).locator('.card-type-desc')).toHaveText(
        'Narození, křest, sňatek, úmrtí s příčinou a pohřeb, u každého místo a celé datum.');
    await host(page).getByRole('button', { name: 'Upravit jako Vlastní' }).click();
    await expect(host(page).locator('.card-type-notice-text')).toHaveText('Vlastní převzala nastavení Matriční.');
    await expect(host(page).getByRole('button', { name: 'Vrátit předchozí' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await openSettings(page);
    await expect(host(page).locator('.card-type-same')).toHaveText('Wie Matrikel.');
    await row(page).getByRole('radio', { name: 'Detailliert' }).click();
    await expect(host(page).locator('.card-type-desc')).toHaveText('Geburt und Tod mit Ort, Alter, Beruf.');
    await host(page).getByRole('button', { name: 'Als Eigene bearbeiten' }).click();
    await expect(host(page).locator('.card-type-notice-text')).toHaveText('Eigene hat jetzt die Einstellungen von Detailliert.');
    await expect(host(page).getByRole('button', { name: 'Vorherige wiederherstellen' })).toBeVisible();
});

/**
 * The corner map of a card (spec 066 P4 §2): the fullest card — the status
 * mark, the story's fold, the lock, the action badge, ⇄ N on the bottom edge
 * and ∞ N at its left — in every type, on a computer and on a 390px phone.
 * Nothing of it covers another part or a text of the card. Václav (invented)
 * married three times; one partner without children is not drawn ("▸ ∞ 1");
 * the tree is imported twice, so he is in another tree (⇄ 1).
 */
async function fullestCard(page: Page, width: number): Promise<void> {
    await page.setViewportSize({ width, height: width < 641 ? 844 : 900 });
    await openApp(page);
    await page.evaluate(async () => {
        const P = (id: string, o: Record<string, unknown>) => ({ id, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...o });
        const persons = {
            g1: P('g1', { firstName: 'Václav Bonifác', lastName: 'Kvapilík-Vlčinský', birthDate: '1800', birthPlace: 'Horní Lhota u Bystřice nad Pernštejnem',
                deathDate: '1870', deathPlace: 'Horní Lhota', partnerships: ['u1', 'u2', 'u4'], childIds: ['p1', 'x1'], birthSourceIds: ['s1'],
                story: { text: 'Hospodařil na čp. 12.', status: 'final' }, question: 'Kdy se oženil podruhé?', isLocked: true }),
            g2: P('g2', { firstName: 'Anna', lastName: 'Vlková', gender: 'female', birthDate: '1805', partnerships: ['u1'], childIds: ['p1'] }),
            gx: P('gx', { firstName: 'Rozálie', lastName: 'Dvořáková', gender: 'female', birthDate: '1810', partnerships: ['u2'], childIds: ['x1'] }),
            gy: P('gy', { firstName: 'Kateřina', lastName: 'Malá', gender: 'female', birthDate: '1815', partnerships: ['u4'] }),
            x1: P('x1', { firstName: 'Matěj', lastName: 'Vlk', birthDate: '1835', parentIds: ['g1', 'gx'] }),
            p1: P('p1', { firstName: 'Jan', lastName: 'Vlk', birthDate: '1830', parentIds: ['g1', 'g2'], partnerships: ['u3'], childIds: ['f'] }),
            p2: P('p2', { firstName: 'Marie', lastName: 'Nová', gender: 'female', birthDate: '1835', partnerships: ['u3'], childIds: ['f'] }),
            f: P('f', { firstName: 'Josef', lastName: 'Vlk', birthDate: '1860', parentIds: ['p1', 'p2'] }),
        };
        const partnerships = {
            u1: { id: 'u1', person1Id: 'g1', person2Id: 'g2', childIds: ['p1'], status: 'married', isPrimary: true },
            u2: { id: 'u2', person1Id: 'g1', person2Id: 'gx', childIds: ['x1'], status: 'married' },
            u3: { id: 'u3', person1Id: 'p1', person2Id: 'p2', childIds: ['f'], status: 'married', startDate: '1858' },
            u4: { id: 'u4', person1Id: 'g1', person2Id: 'gy', childIds: [], status: 'married', startDate: '1850' },
        };
        const sources = { s1: { id: 's1', title: 'Matrika' } };
        const dm = window.Strom.DataManager;
        await dm.importAsNewTree({ persons, partnerships, sources } as never, 'Vlkovi A');
        await dm.importAsNewTree({ persons, partnerships, sources } as never, 'Vlkovi B');
        window.Strom.TreeRenderer.setFocus('f' as never);
    });
    await expect(card(page, 'Václav')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
}

for (const width of [1440, 390]) {
    test(`${width}px: the corner map of the fullest card in every type — mark, fold, lock, badge, ⇄ and ∞ over nothing else (spec 066 P4 §2)`, async ({ page }) => {
        await fullestCard(page, width);
        const vaclav = card(page, 'Václav');
        for (const type of ['compact', 'normal', 'detailed', 'register', 'custom']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), type);
            await expect(page.locator('body')).toHaveAttribute('data-card-density', type);
            for (const sel of [':scope > .card-status-mark', ':scope > .card-story', ':scope > .lock-icon', '.cross-tree-badge', '.hidden-partners-btn']) {
                await expect(vaclav.locator(sel), `${type}: ${sel}`).toBeVisible();
            }
            await expect(vaclav.locator(type === 'compact' ? ':scope > .card-signal-dot' : '.card-signal'), `${type}: badge`).toBeVisible();
            // Names are fitted a frame after the render (and again once the fonts load): wait for that.
            const clash = () => vaclav.evaluate((el) => {
                const parts = [':scope > .card-status-mark', ':scope > .card-story', ':scope > .lock-icon', '.cross-tree-badge',
                    '.hidden-partners-btn', '.sibling-order-pill', '.card-signal', ':scope > .card-signal-dot']
                    .flatMap(sel => [...el.querySelectorAll<HTMLElement>(sel)].filter(e => e.offsetWidth > 0)
                        .map(e => ({ sel, r: e.getBoundingClientRect() })));
                const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
                const out: string[] = [];
                for (let i = 0; i < parts.length; i++) {
                    for (let k = i + 1; k < parts.length; k++) if (hit(parts[i].r, parts[k].r)) out.push(`${parts[i].sel} × ${parts[k].sel}`);
                }
                // No text of the card under the corner's parts (the badge sits on the avatar, not on text).
                const walker = document.createTreeWalker(el.querySelector('.card-body')!, NodeFilter.SHOW_TEXT);
                for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                    if (!n.textContent?.trim()) continue;
                    const range = document.createRange();
                    range.selectNodeContents(n);
                    // A text cut with "…" is seen only inside the boxes that clip it.
                    let clip = new DOMRect(-1e6, -1e6, 2e6, 2e6);
                    for (let e = n.parentElement; e && e !== el; e = e.parentElement) {
                        if (getComputedStyle(e).overflowX === 'visible') continue;
                        const b = e.getBoundingClientRect();
                        const l = Math.max(clip.left, b.left), t = Math.max(clip.top, b.top);
                        clip = new DOMRect(l, t, Math.min(clip.right, b.right) - l, Math.min(clip.bottom, b.bottom) - t);
                    }
                    for (const raw of range.getClientRects()) {
                        const l = Math.max(raw.left, clip.left), t = Math.max(raw.top, clip.top);
                        const r = new DOMRect(l, t, Math.min(raw.right, clip.right) - l, Math.min(raw.bottom, clip.bottom) - t);
                        if (r.width <= 0 || r.height <= 0) continue;
                        for (const p of parts) if (p.sel !== '.card-signal' && hit(r, p.r)) out.push(`"${n.textContent.trim()}" × ${p.sel}`);
                    }
                }
                return out;
            });
            await expect.poll(clash, { message: `${type}: parts over each other or over text` }).toEqual([]);
            // The bottom edge ends 40px before the corner; the narrow compact card shows a bare ⇄.
            await expect(vaclav.locator('.edge-bottom-right')).toHaveCSS('right', '40px');
            if (type === 'compact') await expect(vaclav.locator('.cross-tree-badge .pill-count')).toBeHidden();
            else await expect(vaclav.locator('.cross-tree-badge .pill-count')).toHaveText('1');
        }
        // A phone: no sideways scroll of the page.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
}

/**
 * Far zoom (30–55 %, spec 066 P4 §7): the status mark grows to stay readable
 * (0.85 / zoom), so the card's text keeps clear of the grown mark too — on
 * every card in view, in every type, from the band's top to its bottom.
 */
async function farZoomClear(page: Page, around: string): Promise<void> {
    for (const type of ['compact', 'normal', 'detailed', 'register', 'custom']) {
        await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), type);
        await expect(page.locator('body')).toHaveAttribute('data-card-density', type);
        for (const scale of [0.54, 0.5, 0.4, 0.31]) {
            await card(page, around).evaluate((el, s) => {
                const c = el as HTMLElement;
                const wx = parseFloat(c.style.left) + c.offsetWidth / 2;
                const wy = parseFloat(c.style.top) + c.offsetHeight / 2;
                window.Strom.ZoomPan.zoomAroundWorldPoint(wx, wy, s, 0, (t: number) => t);
            }, scale);
            await expect(page.locator('#tree-canvas')).toHaveClass(/zoom-far/);
            await expect(page.locator('#tree-canvas')).not.toHaveClass(/zoom-tiny/);
            // Names are fitted a frame after the render: wait for that.
            const clash = () => page.evaluate(() => {
                const out: string[] = [];
                const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
                for (const el of document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')) {
                    const markEl = el.querySelector<HTMLElement>(':scope > .card-status-mark');
                    if (!markEl || markEl.offsetWidth === 0) continue;
                    const mark = markEl.getBoundingClientRect();
                    const body = el.querySelector('.card-body');
                    if (!body) continue;
                    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
                    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                        if (!n.textContent?.trim()) continue;
                        const range = document.createRange();
                        range.selectNodeContents(n);
                        // A text cut with "…" is seen only inside the boxes that clip it.
                        let clip = new DOMRect(-1e6, -1e6, 2e6, 2e6);
                        for (let e = n.parentElement; e && e !== el; e = e.parentElement) {
                            if (getComputedStyle(e).overflowX === 'visible') continue;
                            const b = e.getBoundingClientRect();
                            const l = Math.max(clip.left, b.left), t = Math.max(clip.top, b.top);
                            clip = new DOMRect(l, t, Math.min(clip.right, b.right) - l, Math.min(clip.bottom, b.bottom) - t);
                        }
                        for (const raw of range.getClientRects()) {
                            const l = Math.max(raw.left, clip.left), t = Math.max(raw.top, clip.top);
                            const r = new DOMRect(l, t, Math.min(raw.right, clip.right) - l, Math.min(raw.bottom, clip.bottom) - t);
                            if (r.width > 0 && r.height > 0 && hit(r, mark)) out.push(`${el.dataset.id}: "${n.textContent.trim()}"`);
                        }
                    }
                }
                return out;
            });
            await expect.poll(clash, { message: `${type} at ${scale}: text under the status mark` }).toEqual([]);
            // The mark stays readable: at least 10px on screen.
            expect((await card(page, around).locator(':scope > .card-status-mark').boundingBox())!.height).toBeGreaterThanOrEqual(10);
        }
    }
}

test('far zoom: the grown status mark over no text of any card in any type, the cards with ⇄ (spec 066 P4 §7)', async ({ page }) => {
    await fullestCard(page, 1440);
    // Long bottom rows: the places run to the card's edge in the types with details.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const place = 'Horní Lhota u Bystřice nad Pernštejnem';
        for (const p of Object.values(dm.getData().persons)) {
            if (p.firstName === 'Václav Bonifác') dm.updatePerson(p.id, { deathPlace: place });
            if (p.firstName === 'Josef') dm.updatePerson(p.id, { birthPlace: place, deathDate: '1901', deathPlace: place });
        }
        window.Strom.TreeRenderer.render();
    });
    await farZoomClear(page, 'Václav');
});

test('far zoom: the grown status mark over no text of any card in any type, one tree without ⇄ (spec 066 P4 §7)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async () => {
        const P = (id: string, o: Record<string, unknown>) => ({ id, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...o });
        const place = 'Horní Lhota u Bystřice nad Pernštejnem';
        const persons = {
            g1: P('g1', { firstName: 'Václav Bonifác', lastName: 'Kvapilík-Vlčinský', birthDate: '1800', birthPlace: place,
                deathDate: '1870', deathPlace: place, partnerships: ['u1'], childIds: ['p1'], birthSourceIds: ['s1'] }),
            g2: P('g2', { firstName: 'Anna Rozálie', lastName: 'Kvapilíková-Vlčinská', gender: 'female', birthDate: '1805', birthPlace: place,
                deathDate: '1871', deathPlace: place, partnerships: ['u1'], childIds: ['p1'] }),
            p1: P('p1', { firstName: 'Jan Nepomuk', lastName: 'Kvapilík-Vlčinský', birthDate: '1830', birthPlace: place, deathDate: '1890', deathPlace: place, parentIds: ['g1', 'g2'] }),
        };
        const partnerships = { u1: { id: 'u1', person1Id: 'g1', person2Id: 'g2', childIds: ['p1'], status: 'married', isPrimary: true } };
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, sources: { s1: { id: 's1', title: 'Matrika' } } } as never, 'Vlčinští');
        window.Strom.TreeRenderer.setFocus('p1' as never);
    });
    await expect(card(page, 'Václav')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await farZoomClear(page, 'Václav');
});

/**
 * Touch (spec 065 round 2, §9): the areas a finger hits on the fullest card,
 * the tree at 100 %, probed point by point with elementFromPoint — C the badge
 * 32 × 32, D the status mark 44 × 32 in the bottom-right corner (the story's
 * corner gives its taps to it), E ⇄ 40 × 32 below the card, B the lock 28 × 24;
 * each area whole, none over another.
 */
test.describe('touch: the marks\' areas', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('C, D, E and B take a finger each and keep apart in every type with an avatar', async ({ page }) => {
        await fullestCard(page, 390);
        const vaclav = card(page, 'Václav');
        for (const type of ['normal', 'detailed', 'register', 'custom']) {
            await page.evaluate((d) => window.Strom.UI.setCardDensity(d as never), type);
            await expect(page.locator('body')).toHaveAttribute('data-card-density', type);
            await vaclav.evaluate((el) => {
                const c = el as HTMLElement;
                window.Strom.ZoomPan.centerOnPerson(c.dataset.id as never);
                const wx = parseFloat(c.style.left) + c.offsetWidth / 2;
                const wy = parseFloat(c.style.top) + c.offsetHeight / 2;
                window.Strom.ZoomPan.zoomAroundWorldPoint(wx, wy, 1, 0, (t: number) => t);
            });
            await expect.poll(() => vaclav.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return r.left >= 14 && r.right <= window.innerWidth - 14 ? 'in view' : `${r.left}–${r.right}`;
            }), `${type}: the card in view`).toBe('in view');
            await expect(page.locator('#tree-canvas')).not.toHaveClass(/is-moving/);
            await expect(vaclav.locator('.card-signal')).toBeVisible();
            const areas = await vaclav.evaluate((el) => {
                const r = el.getBoundingClientRect();
                const out: Record<string, { n: number; l: number; r: number; t: number; b: number }> = {};
                // The edge's pills (▸ children, ∞ …) are controls of their own over the card's top
                // and bottom edge: where one stands, a mark's area gives way to it.
                const pills: [number, number][] = [];
                for (let y = Math.floor(r.top - 30); y <= r.bottom + 45; y++) {
                    for (let x = Math.floor(r.left - 30); x <= r.right + 30; x++) {
                        const hit = document.elementFromPoint(x + 0.5, y + 0.5);
                        const m = hit?.closest<HTMLElement>('[data-mark]');
                        if (!m && hit?.closest('.card-edge')) pills.push([x, y]);
                        if (!m || !el.contains(m)) continue;
                        const k = m.dataset.mark!;
                        const a = out[k] ??= { n: 0, l: x, r: x, t: y, b: y };
                        a.n++; a.l = Math.min(a.l, x); a.r = Math.max(a.r, x); a.t = Math.min(a.t, y); a.b = Math.max(a.b, y);
                    }
                }
                return Object.fromEntries(Object.entries(out).map(([k, a]) => {
                    const w = a.r - a.l + 1, h = a.b - a.t + 1;
                    const pill = pills.filter(([x, y]) => x >= a.l && x <= a.r && y >= a.t && y <= a.b).length;
                    return [k, { l: a.l, t: a.t, w, h, fill: a.n / (w * h - pill) }];
                }));
            });
            const want: Record<string, [number, number]> = { badge: [32, 32], status: [44, 32], cross: [40, 32], lock: [28, 24] };
            for (const [k, [w, h]] of Object.entries(want)) {
                const a = areas[k];
                expect(a, `${type}: ${k} takes a tap (${JSON.stringify(areas)})`).toBeTruthy();
                expect(a.w, `${type}: ${k} wide enough`).toBeGreaterThanOrEqual(w - 1);
                expect(a.h, `${type}: ${k} high enough`).toBeGreaterThanOrEqual(h - 1);
                expect(a.fill, `${type}: ${k} whole, nothing over it`).toBeGreaterThanOrEqual(0.85);
            }
            // The story's corner gives its taps to the status mark (one tip with a story row).
            expect(areas.story, `${type}: the story under the status mark's area`).toBeUndefined();
            const keys = Object.keys(want);
            for (let i = 0; i < keys.length; i++) {
                for (let k = i + 1; k < keys.length; k++) {
                    const a = areas[keys[i]], b = areas[keys[k]];
                    const meet = a.l < b.l + b.w && b.l < a.l + a.w && a.t < b.t + b.h && b.t < a.t + a.h;
                    expect(meet, `${type}: ${keys[i]} × ${keys[k]}`).toBe(false);
                }
            }
        }
    });
});

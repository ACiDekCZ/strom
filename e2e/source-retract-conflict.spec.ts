import { test, expect, Page } from '@playwright/test';
import { NEW_HEAD, poll } from './research-bridge.js';
import { Version, conflictOf, setupConflict, openKnows, openEdit, cardOf, tag, panel } from './research-conflict.js';

/**
 * Conflicts marked for review after a source was deleted in the research
 * (spec 117 §8): the research writes `2 _STROM_REVIEW source.retracted` on
 * the conflict and `3 _STROM_RETRACTED S…` where the deleted source stood
 * (under a value, under the decision). "What the research knows" shows the
 * tag "to review", "source retracted" in the source's place and the sentence
 * why; a decided one becomes a card with the decision's row, "Decision
 * stands" (through the bridge, no mark) and "Decide again in the research"
 * (the terminal's mark). The panel by the edit form's field has the tag too.
 * Invented data only.
 */

const REVIEW = '2 _STROM_REVIEW source.retracted';

/** Jan's birth decidable by a side, the research's value standing on a deleted source. */
const BIRTH_OPEN = (): string[] => conflictOf('X0007', 'BIRT', '3 FEB 1865', '1865')
    .flatMap(l => l === '2 STAT open' ? [l, REVIEW] : l === '3 SOUR @S0001@' ? ['3 _STROM_RETRACTED S0042'] : [l]);
/** Two sources disagreeing about his death, one of them deleted; the other still cited. */
const DEATH_OPEN = ['1 _STROM_CONFLICT X0010', '2 TYPE DEAT', '2 STAT open', REVIEW,
    '2 VAL 1931', '3 _STROM_RETRACTED S0042', '2 VAL 1932', '3 SOUR @S0001@'];
/** His baptism decided, the decision standing on the deleted source too. */
const BAPTISM_DECIDED = (marked = true): string[] => ['1 _STROM_CONFLICT X0011', '2 TYPE BAPM', '2 STAT decided', ...(marked ? [REVIEW] : []),
    '2 VAL 5 FEB 1865', ...(marked ? ['3 _STROM_RETRACTED S0042'] : []), '2 VAL 1865', '3 SOUR @S0001@',
    '2 DECI 5 FEB 1865', ...(marked ? ['3 _STROM_RETRACTED S0042'] : [])];

const OPENED: Version = { noBirthConflict: true, janConflicts: [...BIRTH_OPEN(), ...DEATH_OPEN, ...BAPTISM_DECIDED()] };
/** The research's version after "Decision stands": the decided conflict without its marks. */
const KEPT: Version = { head: NEW_HEAD, noBirthConflict: true, janConflicts: [...BIRTH_OPEN(), ...DEATH_OPEN, ...BAPTISM_DECIDED(false)] };
const FEATURES = ['conflict.decide', 'source.retract'];

const review = (page: Page) => page.locator('#person-research-modal [data-review-card="X0011"]');
const plain = (page: Page) => page.locator('#person-research-modal .person-research-conflict').filter({ hasText: 'Death' });

async function setup(page: Page, features = FEATURES) {
    return setupConflict(page, { opened: OPENED, features });
}

test.describe('conflicts marked for review (spec 117 §8)', () => {
    test('open ones: the tag, "source retracted" where the source was, the sentence; actions as before', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setup(page);
        await openKnows(page);
        // Sources disagreeing: the tag beside Open, the deleted source said in its place, the other one a link.
        const d = plain(page);
        await expect(d.locator('.person-research-conflict-head')).toHaveText(/Death\s*Open\s*to review/);
        await expect(d.locator('.prc-review-tag')).toHaveText('to review');
        await expect(d.locator('tbody tr').nth(0).locator('td').nth(1)).toHaveText('source retracted');
        await expect(d.locator('tbody tr').nth(0).locator('.person-research-retracted')).toBeVisible();
        await expect(d.locator('tbody tr').nth(1).locator('.person-research-source')).toHaveText('Oddací matrika Čáslav');
        await expect(d.locator('.person-research-review-note')).toHaveText('The source of one of the values was retracted; the conflict awaits review.');
        await expect(d.locator('[data-keep]')).toHaveCount(0);
        // Decidable by a side: the same in its card.
        const c = cardOf(page);
        await expect(c.locator('.prc-review-tag')).toHaveText('to review');
        await expect(c.locator('.prc-side[data-side="research"] .person-research-retracted')).toHaveText('source retracted');
        await expect(c.locator('.person-research-review-note')).toHaveText('The source of one of the values was retracted; the conflict awaits review.');
        await expect(c.locator('.prc-choice')).toHaveCount(2);
    });

    test('the panel by the field: the tag in its title, "source retracted" at the research\'s value', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setup(page);
        await openEdit(page);
        await tag(page, 'input-birthdate').click();
        const p = panel(page);
        await expect(p.locator('.prc-panel-title .prc-review-tag')).toHaveText('to review');
        expect(await p.locator('.prc-panel-title .prc-review-tag').evaluate(e => getComputedStyle(e).fontSize)).toBe('10.5px');
        await expect(p.locator('.prc-panel-row[data-side="research"] .person-research-retracted')).toHaveText('source retracted');
    });

    test('decided: a card with the decision\'s row; "Decision stands" keeps it through the bridge, the marks gone', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { bridge, decide } = await setup(page);
        await openKnows(page);
        const r = review(page);
        await expect(r.locator('.person-research-conflict-head')).toHaveText(/Baptism\s*Decided\s*to review/);
        await expect(r.locator('tr.is-decision td').nth(0)).toHaveText(/^decided: .*1865.?$/);
        await expect(r.locator('tr.is-decision td').nth(1)).toHaveText('source retracted');
        await expect(r.locator('.person-research-review-note')).toHaveText('The decision also rested on the retracted source; it awaits review.');
        const keep = r.locator('[data-keep]');
        await expect(keep).toHaveText('Decision stands');
        // Through the bridge: no mark. Deciding again opens the research's terminal: its mark.
        await expect(keep.locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        const again = r.locator('[data-conflict="X0011"][data-do="decide"]');
        await expect(again).toContainText('Decide again in the research');
        await expect(again.locator('.research-open-mark')).toHaveCount(1);

        let release!: () => void;
        decide.hold = new Promise<void>(res => { release = res; });
        decide.replies.push({ status: 200, body: { conflict: 'X0011', head: NEW_HEAD, parent: 'aaaa1111bbbb' }, then: KEPT });
        await keep.click();
        await expect(keep).toHaveAttribute('aria-busy', 'true');
        await expect(keep).toHaveText('Saving…');
        await keep.click({ force: true });
        release();
        // Kept: today's decided row, the research's version loaded quietly.
        await expect(review(page)).toHaveCount(0);
        await expect(page.locator('#person-research-modal .person-research-decided').filter({ hasText: 'Baptism' })).toBeVisible();
        expect(decide.asks).toEqual([{ id: 'keep', body: { conflict: 'X0011' } }]);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(NEW_HEAD);
        void bridge;
    });

    test('read-only research: the action goes, its sentence stays; a failed write keeps the action', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page);
        await openKnows(page);
        const r = review(page);
        decide.replies.push({ status: 500, body: { error: 'source.failed' } });
        await r.locator('[data-keep]').click();
        await expect(r.locator('.prc-keep-err')).toHaveText('Writing to the research failed.');
        await expect(r.locator('[data-keep]')).toHaveText('Decision stands');
        decide.replies.push({ status: 403, body: { error: 'source.readonly' } });
        await r.locator('[data-keep]').click();
        await expect(r.locator('.prc-keep-err')).toHaveText('The research is read-only; the decision cannot be confirmed here.');
        await expect(r.locator('[data-keep]')).toHaveCount(0);
        await expect(review(page)).toHaveCount(1);
        expect(decide.asks.map(a => a.id)).toEqual(['keep', 'keep']);
    });

    test('without the gate: no "Decision stands", the card and its sentence stay', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setup(page, ['conflict.decide']);
        await openKnows(page);
        await expect(review(page).locator('.prc-review-tag')).toHaveText('to review');
        await expect(review(page).locator('[data-keep]')).toHaveCount(0);
        await expect(review(page).locator('[data-do="decide"]')).toBeVisible();
    });

    // 390 px wide: the window narrowed on the research's computer (a phone has no bridge, so no actions at all there).
    test('phone width (390 × 844): the cards fit, the head wraps, the actions are 44 px; kept on a tap', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await openKnows(page);
        const r = review(page);
        await r.scrollIntoViewIfNeeded();
        const keep = r.locator('[data-keep]');
        expect((await keep.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await r.locator('[data-do="decide"]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        const wide = await page.evaluate(() => {
            const m = document.querySelector('#person-research-modal .modal')!;
            return [...m.querySelectorAll<HTMLElement>('.person-research-conflict, .person-research-conflict *')]
                .filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5).map(e => e.className);
        });
        expect(wide).toEqual([]);
        decide.replies.push({ status: 200, body: { conflict: 'X0011', head: NEW_HEAD }, then: KEPT });
        await keep.click();
        await expect(review(page)).toHaveCount(0);
    });

    test('a decided conflict without the mark is today\'s row', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setupConflict(page, { opened: KEPT, features: FEATURES });
        await poll(page);
        await openKnows(page);
        await expect(page.locator('#person-research-modal .person-research-decided').filter({ hasText: 'Baptism' })).toBeVisible();
        await expect(page.locator('#person-research-modal [data-review-card]')).toHaveCount(0);
    });
});

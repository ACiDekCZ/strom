import { test, expect, TestInfo } from '@playwright/test';
import { writeFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * A woman with two partners (GitHub issue #6), the GEDCOM as the research
 * writes it: the marriage F2 (C + B, children D2, D3) before F1 (A + B, no
 * marriage, child D1). Each family's line comes down from its own partner
 * line, in the middle between the two parents' cards, not from one parent's
 * card.
 */

function writeIssueGedcom(testInfo: TestInfo): string {
    const ged = [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @A@ INDI', '1 NAME Adam /Lindqvist/', '1 SEX M',
        '0 @B@ INDI', '1 NAME Berit /Holm/', '1 SEX F',
        '0 @C@ INDI', '1 NAME Carl /Sandberg/', '1 SEX M',
        '0 @D1@ INDI', '1 NAME Dagny /Lindqvist/', '1 SEX F',
        '0 @D2@ INDI', '1 NAME Erik /Sandberg/', '1 SEX M',
        '0 @D3@ INDI', '1 NAME Frej /Sandberg/', '1 SEX M',
        '0 @F2@ FAM', '1 HUSB @C@', '1 WIFE @B@', '1 MARR', '1 CHIL @D2@', '1 CHIL @D3@',
        '0 @F1@ FAM', '1 HUSB @A@', '1 WIFE @B@', '1 CHIL @D1@',
        '0 TRLR', '',
    ].join('\n');
    const p = testInfo.outputPath('two-partners.ged');
    writeFileSync(p, ged);
    return p;
}

test('a child of a woman with two partners: the line leaves the middle between both parents (issue #6)', async ({ page }, testInfo) => {
    await openApp(page);
    await page.locator('#gedcom-input').setInputFiles(writeIssueGedcom(testInfo));
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    await page.evaluate(async () => {
        const berit = window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Berit')!;
        await window.Strom.TreeRenderer.setFocus(berit.id as never);
    });
    for (const name of ['Adam', 'Berit', 'Carl', 'Dagny', 'Erik', 'Frej']) await expect(card(page, name)).toBeVisible();

    // For each child: the drawn vertical line that starts on the parents' partner line
    const stems = await page.evaluate(() => {
        const r = window.Strom.TreeRenderer as unknown as {
            positions: Map<string, { x: number; y: number }>;
            config: { cardWidth: number };
            connections: { unionId: string; stemX: number; stemTopY: number; drops: { personId: string }[] }[];
            spouseLines: { unionId: string; y: number }[];
        };
        const id = (first: string) => window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === first)!.id;
        const lines = [...document.querySelectorAll<SVGLineElement>('#tree-lines line.child-link')]
            .map(l => ({ x1: l.x1.baseVal.value, y1: l.y1.baseVal.value, x2: l.x2.baseVal.value, y2: l.y2.baseVal.value }));
        return (['Dagny', 'Erik'] as const).map(child => {
            const parents = child === 'Dagny' ? ['Adam', 'Berit'] : ['Berit', 'Carl'];
            const [left, right] = parents.map(p => r.positions.get(id(p))!.x).sort((a, b) => a - b);
            const middle = (left + r.config.cardWidth + right) / 2;
            const conn = r.connections.find(c => c.drops.some(d => d.personId === id(child)))!;
            const partnerLineY = r.spouseLines.find(l => l.unionId === conn.unionId)!.y;
            const drawn = lines.some(l => Math.abs(l.x1 - middle) < 0.01 && Math.abs(l.x2 - middle) < 0.01
                && Math.abs(Math.min(l.y1, l.y2) - partnerLineY) < 0.01);
            return { child, stemX: conn.stemX, middle, stemTopY: conn.stemTopY, partnerLineY, drawn };
        });
    });
    for (const s of stems) {
        expect(s.stemX, s.child).toBe(s.middle);
        expect(s.stemTopY, s.child).toBe(s.partnerLineY);
        expect(s.drawn, `${s.child}: a drawn stem from the partner line`).toBe(true);
    }
});

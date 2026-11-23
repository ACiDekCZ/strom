import { describe, it, expect } from 'vitest';
import { getStringsForLang } from '../strings.js';

// Step 6 of the merge and its research block say small counts in the word's
// own form (Czech and Polish), and the verb agrees with what it says.
const cs = getStringsForLang('cs').mergeWizard;
const pl = getStringsForLang('pl').mergeWizard;

describe('merge step 6 counts (cs)', () => {
    it('the totals put each count in its own form', () => {
        expect(cs.doneTotals(4, 3, 1, 0)).toContain('= 3 spojené + 1 nová + 0 nepřidaných.');
        expect(cs.doneTotals(4, 1, 3, 0)).toContain('= 1 spojená + 3 nové + 0 nepřidaných.');
        expect(cs.doneTotals(12, 5, 2, 5)).toContain('= 5 spojených + 2 nové + 5 nepřidaných.');
        expect(cs.doneTotals(45, 21, 22, 2)).toContain('= 21 spojených + 22 nových + 2 nepřidané.');
        expect(cs.doneTotals(3, 1, 1, 1)).toContain('= 1 spojená + 1 nová + 1 nepřidaná.');
    });
    it('what stays in the app: the verb agrees with its subjects', () => {
        expect(cs.resPending(1, 2)).toMatch(/^1 nová osoba a 2 vazby zatím zůstávají jen v aplikaci\. Do výzkumu půjdou /);
        expect(cs.resPending(1, 0)).toMatch(/^1 nová osoba zatím zůstává jen v aplikaci\. Do výzkumu půjde /);
        expect(cs.resPending(2, 0)).toMatch(/^2 nové osoby zatím zůstávají jen v aplikaci\. Do výzkumu půjdou /);
        expect(cs.resPending(5, 0)).toMatch(/^5 nových osob zatím zůstává jen v aplikaci\. Do výzkumu půjdou /);
        expect(cs.resPending(21, 0)).toMatch(/^21 nových osob zatím zůstává /);
        expect(cs.resPending(22, 0)).toMatch(/^22 nových osob zatím zůstává /);
        expect(cs.resPending(0, 1)).toMatch(/^1 vazba zatím zůstává jen v aplikaci\. Do výzkumu půjde /);
        expect(cs.resPending(5, 21)).toMatch(/^5 nových osob a 21 vazeb zatím zůstávají /);
    });
    it('the toast and the research bringing people back', () => {
        expect(cs.toastAdded(1, 'X')).toBe('Přidána 1 osoba do stromu X');
        expect(cs.toastAdded(2, 'X')).toBe('Přidány 2 osoby do stromu X');
        expect(cs.toastAdded(5, 'X')).toBe('Přidáno 5 osob do stromu X');
        expect(cs.toastAdded(21, 'X')).toBe('Přidáno 21 osob do stromu X');
        expect(cs.resComesBack(1)).toContain('vrátí 1 osobu zpět – aplikace ji pak nabídne');
        expect(cs.resComesBack(2)).toContain('vrátí 2 osoby zpět – aplikace je pak nabídne');
        expect(cs.resComesBack(5)).toContain('vrátí 5 osob zpět – aplikace je pak nabídne');
    });
});

describe('merge step 6 counts (pl)', () => {
    it('the totals put each count in its own form', () => {
        expect(pl.doneTotals(4, 3, 1, 0)).toContain('= 3 połączone + 1 nowa + 0 niedodanych.');
        expect(pl.doneTotals(4, 1, 3, 0)).toContain('= 1 połączona + 3 nowe + 0 niedodanych.');
        expect(pl.doneTotals(12, 5, 2, 5)).toContain('= 5 połączonych + 2 nowe + 5 niedodanych.');
        expect(pl.doneTotals(45, 21, 22, 2)).toContain('= 21 połączonych + 22 nowe + 2 niedodane.');
        expect(pl.doneTotals(3, 1, 1, 1)).toContain('= 1 połączona + 1 nowa + 1 niedodana.');
    });
    it('what stays in the app: the verb agrees with its subjects', () => {
        expect(pl.resPending(1, 2)).toMatch(/^1 nowa osoba i 2 powiązania na razie zostają tylko w aplikacji\. Do badań trafią /);
        expect(pl.resPending(1, 0)).toMatch(/^1 nowa osoba na razie zostaje tylko w aplikacji\. Do badań trafi /);
        expect(pl.resPending(2, 0)).toMatch(/^2 nowe osoby na razie zostają /);
        expect(pl.resPending(5, 0)).toMatch(/^5 nowych osób na razie zostaje /);
        expect(pl.resPending(21, 0)).toMatch(/^21 nowych osób na razie zostaje /);
        expect(pl.resPending(22, 0)).toMatch(/^22 nowe osoby na razie zostają /);
        expect(pl.resPending(0, 1)).toMatch(/^1 powiązanie na razie zostaje tylko w aplikacji\. Do badań trafi /);
    });
    it('the toast and the research bringing people back', () => {
        expect(pl.toastAdded(1, 'X')).toBe('Dodano 1 osobę do drzewa X');
        expect(pl.toastAdded(22, 'X')).toBe('Dodano 22 osoby do drzewa X');
        expect(pl.toastAdded(5, 'X')).toBe('Dodano 5 osób do drzewa X');
        expect(pl.resComesBack(1)).toContain('zaproponuje wtedy jej usunięcie');
        expect(pl.resComesBack(2)).toContain('zaproponuje wtedy ich usunięcie');
    });
});

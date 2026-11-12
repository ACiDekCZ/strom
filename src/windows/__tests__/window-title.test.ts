/**
 * The window's title (spec 079 §2): the main window names its tree, a
 * satellite its view and the tree, other windows only the app.
 */

import { describe, it, expect } from 'vitest';
import { windowTitle } from '../window-title.js';

describe('window title', () => {
    it('main window: tree – app; no tree: the app alone', () => {
        expect(windowTitle({ role: 'main', treeName: 'Vrtišek', beta: false })).toBe('Vrtišek – Strom');
        expect(windowTitle({ role: 'main', treeName: '', beta: false })).toBe('Strom');
        expect(windowTitle({ role: 'main', treeName: 'Vrtišek', beta: true })).toBe('Vrtišek – Strom Beta');
    });

    it('satellite: its view – tree – app (a table without a kind)', () => {
        expect(windowTitle({ role: 'satellite', kind: 'table', treeName: 'Vrtišek', beta: false })).toBe('Table – Vrtišek – Strom');
        expect(windowTitle({ role: 'satellite', kind: null, treeName: 'Vrtišek', beta: false })).toBe('Table – Vrtišek – Strom');
        expect(windowTitle({ role: 'satellite', kind: 'table', treeName: '', beta: true })).toBe('Table – Strom Beta');
    });

    it('a second tab and a window outside the roles (an exported file): the app\'s name', () => {
        expect(windowTitle({ role: 'second-tab', treeName: 'Vrtišek', beta: false })).toBe('Strom');
        expect(windowTitle({ role: 'none', treeName: 'Vrtišek', beta: true })).toBe('Strom Beta');
    });
});

/**
 * The person card timeline's chips ("Children's events", "History"), spec
 * 020 K4.5: each tree has its default (its settings, SettingsManager
 * .getLifelineDefaults); a chip on the card changes it for a while only —
 * in memory, for the open tree, until another tree is opened or the app is
 * loaded again. Then the tree's default is back.
 */

import { SettingsManager, type LifelineDefaults } from './settings.js';

/** The card's change of the open tree's default (never stored). */
let override: { treeId: string; chips: Partial<LifelineDefaults> } | null = null;

/** What the card's timeline shows now in `treeId`: its default, with the card's change while that tree stays open. */
export function lifelineChips(treeId: string | null): LifelineDefaults {
    const defaults = SettingsManager.getLifelineDefaults(treeId);
    if (!override || !treeId || override.treeId !== treeId) return defaults;
    return { ...defaults, ...override.chips };
}

/** A chip on the card: for the open tree, until it changes or the app is loaded again. */
export function setLifelineChip(treeId: string | null, chip: keyof LifelineDefaults, on: boolean): void {
    if (!treeId) return;
    if (!override || override.treeId !== treeId) override = { treeId, chips: {} };
    override.chips[chip] = on;
}

/** Another tree is open (or the tree's default was set anew): the card's change is gone. */
export function keepLifelineChipsFor(treeId: string | null): void {
    if (override && override.treeId !== treeId) override = null;
}

/** The tree's default set anew: the card shows it. */
export function dropLifelineChips(treeId: string): void {
    if (override?.treeId === treeId) override = null;
}

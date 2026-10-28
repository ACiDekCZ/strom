/**
 * The person card timeline's chips ("Children's events", "History"), spec
 * 020 K4.5: each tree has its default (its settings, SettingsManager
 * .getLifelineDefaults); a chip on the card changes it for that card only —
 * in memory, while the card stays open. Another card (also a link to a
 * relative from the card, or the same person opened again), another tree, a
 * reload or a new default brings the tree's default back. A redraw of the
 * open card (an edit, the research's answer) keeps the change.
 */

import { SettingsManager, type LifelineDefaults } from './settings.js';

/** The open card's change of its tree's default (never stored). */
let override: { treeId: string; chips: Partial<LifelineDefaults> } | null = null;

/** What the card's timeline shows now in `treeId`: its default, with the open card's change. */
export function lifelineChips(treeId: string | null): LifelineDefaults {
    const defaults = SettingsManager.getLifelineDefaults(treeId);
    if (!override || !treeId || override.treeId !== treeId) return defaults;
    return { ...defaults, ...override.chips };
}

/** A chip on the card: for the open card only. */
export function setLifelineChip(treeId: string | null, chip: keyof LifelineDefaults, on: boolean): void {
    if (!treeId) return;
    if (!override || override.treeId !== treeId) override = { treeId, chips: {} };
    override.chips[chip] = on;
}

/** A card opens (another person, or the same one again): it starts from the tree's default. */
export function newLifelineCard(): void {
    override = null;
}

/** Another tree is open: the card's change is gone. */
export function keepLifelineChipsFor(treeId: string | null): void {
    if (override && override.treeId !== treeId) override = null;
}

/** The tree's default set anew: the card shows it. */
export function dropLifelineChips(treeId: string): void {
    if (override?.treeId === treeId) override = null;
}

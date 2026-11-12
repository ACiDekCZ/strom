/**
 * The window's title (`document.title`, spec 079 §2 "Window title"): the main
 * window names its tree ("Habrmans – Strom"; no tree or an empty one: "Strom"); a satellite
 * names its view and the tree ("Table – Habrmans – Strom"). A test build says
 * "Strom Beta" for the app, as the installed app's name.
 */

import { strings } from '../strings.js';
import type { SatelliteKind, WindowRole } from './window-role.js';

/** The app's name in titles. */
export function appTitleName(beta: boolean): string {
    return beta ? 'Strom Beta' : 'Strom';
}

/** A satellite's view as its title names it. */
export function satelliteKindLabel(kind: SatelliteKind): string {
    return kind === 'overview' ? strings.live.overviewTitle : strings.viewModeSwitch[kind];
}

export interface WindowTitleInput {
    role: WindowRole;
    /** A satellite's view (role 'satellite'). */
    kind?: SatelliteKind | null;
    /** The open tree's name ('' = none). */
    treeName: string;
    beta: boolean;
}

/** The title of this window now. A second tab and an exported file keep the app's name. */
export function windowTitle({ role, kind, treeName, beta }: WindowTitleInput): string {
    const app = appTitleName(beta);
    if (role === 'satellite') return strings.win.windowTitle(satelliteKindLabel(kind ?? 'table'), treeName, app);
    if (role === 'main') return strings.win.mainTitle(treeName, app);
    return app;
}

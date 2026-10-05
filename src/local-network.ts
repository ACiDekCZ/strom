/**
 * The browser's permission for the research's address on this computer
 * (127.0.0.1): asked under every name a browser keeps it. Chromium splits
 * local network access in two (Edge 154: "Apps on device" for this computer,
 * "Local network" for other devices); the loopback half governs the research,
 * so it is asked first. Brave keeps its own localhost access, asked first there.
 */

import { currentAppBrowser } from './research-transfer.js';

const LOCAL_NETWORK_PERMISSIONS = ['loopback-network', 'local-network-access', 'local-network'];

/** The permission's status, or null where the browser has none to tell. */
export async function localNetworkStatus(): Promise<PermissionStatus | null> {
    if (typeof navigator === 'undefined') return null;
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return null;
    const names = currentAppBrowser() === 'brave' ? ['localhost-access', ...LOCAL_NETWORK_PERMISSIONS] : LOCAL_NETWORK_PERMISSIONS;
    for (const name of names) {
        try {
            return await perms.query({ name } as unknown as PermissionDescriptor);
        } catch { /* not a name this browser knows: the next */ }
    }
    return null;
}

/** The browser says it blocks the research's address (a research there may well be running). */
export async function localNetworkDenied(): Promise<boolean> {
    try {
        return (await localNetworkStatus())?.state === 'denied';
    } catch {
        return false;
    }
}

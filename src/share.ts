/**
 * Collaboration ("send to a relative") — pure helpers over the export envelope.
 * The flow: sender exports a file with a message; the recipient's saved copy
 * remembers the exportId (lineage); the reply export carries replyToExportId,
 * which lets the original sender's app offer a merge into the right tree.
 */

import { EmbeddedDataEnvelope, TreeMetadata } from './types.js';

export type ShareFileKind =
    | { kind: 'reply'; tree: TreeMetadata }   // a relative returns MY tree → offer merge
    | { kind: 'welcome' }                     // a shared file with a sender → welcome screen
    | { kind: 'plain' };                      // regular export → today's behaviour

/**
 * Classify an opened embedded file. `findByExportId` is injected
 * (TreeManager.findTreeByExportId) so the logic stays pure and testable.
 * Reply detection wins over the welcome screen: when a file both replies to
 * my export AND carries a message, the merge offer is the right surface.
 */
export function classifyShareFile(
    envelope: EmbeddedDataEnvelope | null,
    findByExportId: (exportId: string) => TreeMetadata | null
): ShareFileKind {
    if (!envelope) return { kind: 'plain' };
    if (envelope.replyToExportId) {
        const tree = findByExportId(envelope.replyToExportId);
        if (tree) return { kind: 'reply', tree };
    }
    if (envelope.senderName || envelope.senderMessage) return { kind: 'welcome' };
    return { kind: 'plain' };
}

/**
 * The research bubbles of a satellite's Table (spec 097 §5): the research's
 * actions go to the main window as what they are (id, person, item); the main
 * window runs only an action its own bubble offers; a source and a website
 * stay in the satellite; a waiting item's own answer is not offered there.
 */

import { describe, it, expect } from 'vitest';
import {
    bubbleFocusesMain, bubbleOfferedHere, bubbleRunsHere, findBubbleAction, readTableBubbleArgs, tableBubbleArgs,
} from '../window-table-research.js';
import type { ResearchBubbleAction } from '../../ui/table-view/table-research-bubble.js';
import type { PersonId } from '../../types.js';

const p1 = 'p1' as PersonId;
const p2 = 'p2' as PersonId;

const decide = (personId: PersonId, conflictId: string): ResearchBubbleAction =>
    ({ id: 'decide', label: 'Decide', via: 'app', mark: null, personId, conflictId });
const openTask: ResearchBubbleAction = {
    id: 'openTask', label: 'Open the task', via: 'link', mark: 'terminal', personId: p1, taskId: 'T0101',
    link: { action: 'task', params: { task: 'T0101' } },
};
const follow: ResearchBubbleAction = { id: 'follow', label: 'Follow', via: 'link', mark: 'none', personId: p1, link: { action: 'live', params: {} } };
const source: ResearchBubbleAction = { id: 'source', label: 'S12', via: 'app', mark: null, personId: p1, sourceId: 's12' };
const archive: ResearchBubbleAction = { id: 'archive', label: 'Archive', via: 'web', mark: null, personId: p1, url: 'https://example.org' };
const answer: ResearchBubbleAction = { id: 'waitAnswer', label: 'Answer', via: 'item', mark: null, personId: p1, waitId: 'W1' };

describe('a satellite\'s bubble action sent to the main window', () => {
    it('carries only the id, the person and the item; read back the same, anything malformed is none', () => {
        const args = tableBubbleArgs({ ...openTask });
        expect(args).toEqual({ personId: 'p1', id: 'openTask', taskId: 'T0101' });
        expect(readTableBubbleArgs(JSON.parse(JSON.stringify(args)))).toEqual(args);
        expect(readTableBubbleArgs({ id: 'decide' })).toBeNull();
        expect(readTableBubbleArgs(null)).toBeNull();
        expect(readTableBubbleArgs({ personId: 'p1', id: 'decide', conflictId: 7, link: 'x' })).toEqual({ personId: 'p1', id: 'decide' });
    });

    it('the main window finds its own action by id, person and item; another item or person: none', () => {
        const own = [decide(p1, 'C1'), decide(p2, 'C2'), openTask];
        expect(findBubbleAction(own, { personId: 'p2', id: 'decide', conflictId: 'C2' })).toBe(own[1]);
        expect(findBubbleAction(own, { personId: 'p1', id: 'decide', conflictId: 'C2' })).toBeNull();
        expect(findBubbleAction(own, { personId: 'p1', id: 'decide' })).toBeNull();
        expect(findBubbleAction(own, { personId: 'p1', id: 'openTask', taskId: 'T0101' })).toBe(openTask);
        expect(findBubbleAction(own, { personId: 'p1', id: 'revert', fact: 'birth' })).toBeNull();
    });
});

describe('what a satellite offers', () => {
    it('a source and a website run there; a waiting item\'s answer is not offered; the rest only while the main window is open', () => {
        expect(bubbleRunsHere(source)).toBe(true);
        expect(bubbleRunsHere(archive)).toBe(true);
        expect(bubbleRunsHere(decide(p1, 'C1'))).toBe(false);
        expect(bubbleOfferedHere(source, false)).toBe(true);
        expect(bubbleOfferedHere(archive, false)).toBe(true);
        expect(bubbleOfferedHere(answer, true)).toBe(false);
        expect(bubbleOfferedHere(decide(p1, 'C1'), true)).toBe(true);
        expect(bubbleOfferedHere(decide(p1, 'C1'), false)).toBe(false);
        expect(bubbleOfferedHere(openTask, false)).toBe(false);
    });

    it('the main window comes forward unless the action opens the research\'s terminal', () => {
        expect(bubbleFocusesMain(decide(p1, 'C1'))).toBe(true);
        expect(bubbleFocusesMain(follow)).toBe(true);
        expect(bubbleFocusesMain(openTask)).toBe(false);
    });
});

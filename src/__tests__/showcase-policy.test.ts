/**
 * The showcase's policy (spec 143 K4.1, UIX §5): the ten main actions of a
 * research drawn greyed (`off`, with their usual mark), the reads shown, any
 * other write and the agent hidden — through the same lever as a device
 * without the right (researchDeviceAllows / researchDeviceLinkAllows /
 * researchDeviceMark). Outside the showcase nothing changes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    SHOWCASE_MAIN_ACTIONS, researchShowcaseShown, showcaseActionOfLink, setInShowcaseLookup, inShowcase,
    researchDeviceAllows, researchDeviceLinkAllows, researchDeviceMark, researchLinkMark, setShowcaseWhy, showcaseWhy,
    type ResearchShowcaseAction,
} from '../research-link.js';

afterEach(() => {
    setInShowcaseLookup(null);
    setShowcaseWhy(null);
});

describe('researchShowcaseShown', () => {
    it('greys exactly the ten main actions of §5', () => {
        expect([...SHOWCASE_MAIN_ACTIONS].sort()).toEqual([
            'chat', 'conflict', 'conflict-agent', 'direction-new', 'hypothesis', 'queue-order', 'send', 'waiting-answer', 'work', 'work-now',
        ]);
        for (const a of SHOWCASE_MAIN_ACTIONS) expect(researchShowcaseShown(a)).toBe('off');
    });

    it('shows the reads and hides any other write and the agent', () => {
        for (const a of ['overview', 'knows', 'materials'] as const) expect(researchShowcaseShown(a)).toBe('show');
        for (const a of ['excerpt', 'media', 'verify', 'verify-bulk', 'run-stop', 'fact-confirm', 'material-sort', 'waiting-defer',
            'queue-next', 'merge-here', 'research-follow', 'history', 'fixes', 'sources-split'] as const) {
            expect(researchShowcaseShown(a)).toBe('hide');
        }
        expect(researchShowcaseShown('no-such-action' as ResearchShowcaseAction)).toBe('hide');
    });

    it('takes a conflict left to the agent as its own main action', () => {
        expect(showcaseActionOfLink('conflict', { conflictDo: 'agent' })).toBe('conflict-agent');
        expect(showcaseActionOfLink('conflict', { conflictDo: 'pick' })).toBe('conflict');
        expect(showcaseActionOfLink('work')).toBe('work');
    });
});

describe('the showcase through the device lever', () => {
    it('changes nothing outside the showcase', () => {
        expect(inShowcase()).toBe(false);
        expect(researchDeviceAllows('verify')).toBe(true);
        expect(researchDeviceLinkAllows('excerpt')).toBe(true);
        expect(researchDeviceMark('excerpt')).toBe(researchLinkMark('excerpt'));
    });

    it('hides what the showcase hides, keeps the main actions with their usual mark', () => {
        setInShowcaseLookup(() => true);
        expect(inShowcase()).toBe(true);
        expect(researchDeviceAllows('verify')).toBe(false);
        expect(researchDeviceAllows('send')).toBe(true);
        expect(researchDeviceLinkAllows('excerpt')).toBe(false);
        expect(researchDeviceMark('excerpt')).toBe('hidden');
        expect(researchDeviceLinkAllows('work')).toBe(true);
        expect(researchDeviceMark('work')).toBe(researchLinkMark('work'));
        expect(researchDeviceMark('conflict', { conflictDo: 'agent' })).toBe(researchLinkMark('conflict', { conflictDo: 'agent' }));
    });

    it('a lookup that throws is not the showcase', () => {
        setInShowcaseLookup(() => { throw new Error('no tree'); });
        expect(inShowcase()).toBe(false);
    });
});

describe('showcaseWhy', () => {
    it('hands the control and the action to the UI, and is quiet without one', () => {
        expect(() => showcaseWhy(null, 'send')).not.toThrow();
        const said: Array<[HTMLElement | null, ResearchShowcaseAction | null]> = [];
        setShowcaseWhy((el, action) => said.push([el, action]));
        showcaseWhy(null, 'work');
        expect(said).toEqual([[null, 'work']]);
    });
});

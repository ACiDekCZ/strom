/**
 * Polish UI strings (UI language "pl"). Translated by areas of the English
 * pack; every part has exactly the keys of its area, so together they make
 * the whole pack, checked against StringsType.
 */

import type { StringsType } from '../strings.js';
import { plPart1 } from './part1.js';
import { plPart2 } from './part2.js';
import { plPart3 } from './part3.js';
import { plPart4 } from './part4.js';
import { plPart5 } from './part5.js';
import { plPart6 } from './part6.js';
import { plPart7 } from './part7.js';
import { plPart8 } from './part8.js';

export const stringsPL: StringsType = {
    ...plPart1,
    ...plPart2,
    ...plPart3,
    ...plPart4,
    ...plPart5,
    ...plPart6,
    ...plPart7,
    ...plPart8,
};

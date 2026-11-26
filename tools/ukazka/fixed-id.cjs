// The id of a sample research (build-demo.ts with SHOWCASE_SAMPLE=1): loaded only into `strom init` (NODE_OPTIONS).
// With STROM_SAMPLE_TREE_ID=<uuid> the process's first crypto.randomUUID() gives that id, the tree's (Tree.create),
// so every build of a language's sample is the same research (sampleTreeId in sample.ts); later calls are random as
// ever. build-demo.ts checks that the tree got it. Without the variable nothing changes.
'use strict';
const id = process.env.STROM_SAMPLE_TREE_ID || '';
if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    const crypto = require('node:crypto');
    const random = crypto.randomUUID.bind(crypto);
    let given = false;
    const once = (...args) => {
        if (given) return random(...args);
        given = true;
        return id;
    };
    crypto.randomUUID = once;
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        const web = globalThis.crypto.randomUUID.bind(globalThis.crypto);
        globalThis.crypto.randomUUID = () => (given ? web() : once());
    }
}

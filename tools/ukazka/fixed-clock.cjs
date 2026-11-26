// The clock of a sample build (build-demo.ts with SHOWCASE_SAMPLE=1 or SHOWCASE_NOW): loaded into every node
// process of the demo research (NODE_OPTIONS in env.json). With STROM_SAMPLE_CLOCK=<ISO time> the process starts
// at that moment and runs on from it (real elapsed time added), so every time strom writes into its records is
// the command's own moment of the demo, never the moment of the build. Without the variable nothing changes.
'use strict';
const at = Date.parse(process.env.STROM_SAMPLE_CLOCK || '');
if (Number.isFinite(at)) {
    const Real = Date;
    const start = Real.now();
    const now = () => at + (Real.now() - start);
    function SampleDate(...args) {
        if (!new.target) return new Real(now()).toString();
        return args.length ? new Real(...args) : new Real(now());
    }
    Object.setPrototypeOf(SampleDate, Real);
    SampleDate.prototype = Real.prototype;
    SampleDate.now = now;
    SampleDate.parse = Real.parse;
    SampleDate.UTC = Real.UTC;
    globalThis.Date = SampleDate;
}

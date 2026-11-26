// The fixed moment of a sample build, shared by build-demo.ts and build-family.ts.
//   SHOWCASE_SAMPLE=1   the sample: its moment is SHOWCASE_NOW, else SAMPLE_AS_OF
//   SHOWCASE_NOW=<ISO>  a fixed moment for any build (the screenshots' too)
// Neither set: "" (the screenshots: the moment of the build).

/** The moment of the sample when SHOWCASE_NOW does not name one. */
export const SAMPLE_AS_OF = "2026-11-01T09:00:00.000Z";

export const SAMPLE = process.env.SHOWCASE_SAMPLE === "1";

/** The fixed moment of this build (ISO), or "" when the build takes the clock's. */
export function fixedMoment(): string {
  const at = process.env.SHOWCASE_NOW || (SAMPLE ? SAMPLE_AS_OF : "");
  if (at && !Number.isFinite(Date.parse(at))) throw new Error(`SHOWCASE_NOW: not a time: ${at}`);
  return at ? new Date(at).toISOString() : "";
}

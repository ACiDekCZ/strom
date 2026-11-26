// The fixed moment of a sample build, shared by build-demo.ts and build-family.ts.
//   SHOWCASE_SAMPLE=1   the sample: its moment is SHOWCASE_NOW, else SAMPLE_AS_OF
//   SHOWCASE_NOW=<ISO>  a fixed moment for any build (the screenshots' too)
// Neither set: "" (the screenshots: the moment of the build).
import { createHash } from "node:crypto";

/** The moment of the sample when SHOWCASE_NOW does not name one. */
export const SAMPLE_AS_OF = "2026-11-01T09:00:00.000Z";

export const SAMPLE = process.env.SHOWCASE_SAMPLE === "1";

/** The fixed moment of this build (ISO), or "" when the build takes the clock's. */
export function fixedMoment(): string {
  const at = process.env.SHOWCASE_NOW || (SAMPLE ? SAMPLE_AS_OF : "");
  if (at && !Number.isFinite(Date.parse(at))) throw new Error(`SHOWCASE_NOW: not a time: ${at}`);
  return at ? new Date(at).toISOString() : "";
}

/** The showcase's languages. */
export const SAMPLE_LANGS = ["cs", "en", "de", "pl"] as const;
export type SampleLang = (typeof SAMPLE_LANGS)[number];

/** The showcase's fixed id of one language (the file's `exportId`, the same across versions). */
export const sampleExportId = (lang: string): string => `showcase-${lang}`;

/** RFC 4122 URL namespace: the name of a sample research's id is `https://stromapp.info/demo/showcase-<lang>`. */
const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/**
 * The research id of a language's sample (UUIDv5 of `https://stromapp.info/demo/showcase-<lang>`): the same in every
 * build, so the file on the web and the research of `strom demo` are one research.
 */
export function sampleTreeId(lang: string): string {
  const ns = Buffer.from(URL_NAMESPACE.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(ns).update(`https://stromapp.info/demo/${sampleExportId(lang)}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

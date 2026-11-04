import assert from "node:assert/strict";
import { it } from "node:test";
import { resolveAuthOrigin, safeAuthNext } from "../supabase/auth-origin";

const main = "the-lol-report-jet.vercel.app";
const snapshot = "the-lol-report-build-jc6002-8816.vercel.app";
const env = { VERCEL: "1", VERCEL_URL: snapshot, VERCEL_PROJECT_PRODUCTION_URL: main, NEXT_PUBLIC_SITE_URL: `https://${main}` };

it("keeps a snapshot login and callback on the snapshot despite production SITE_URL", () => {
  assert.equal(resolveAuthOrigin(snapshot, env), `https://${snapshot}`);
  assert.equal(resolveAuthOrigin(main, env), `https://${main}`);
});
it("supports a verified Vercel branch alias", () => {
  assert.equal(resolveAuthOrigin("preview.vercel.app", { ...env, VERCEL_BRANCH_URL: "preview.vercel.app" }), "https://preview.vercel.app");
});
it("does not trust an arbitrary request host", () => {
  assert.equal(resolveAuthOrigin("attacker.example", env), `https://${main}`);
  assert.throws(() => resolveAuthOrigin("attacker.example", {}));
});
it("retains configured origins for Amplify internal hosts and local development", () => {
  assert.equal(resolveAuthOrigin("localhost:3000", { NEXT_PUBLIC_SITE_URL: "https://stats.humorstudy.org" }), "https://stats.humorstudy.org");
  assert.equal(resolveAuthOrigin("localhost:3007", {}), "http://localhost:3007");
});
it("rejects cross-origin next paths and allows internal report links", () => {
  for (const next of ["//attacker.example", "/\\attacker.example", "https://attacker.example", "/\n/attacker.example"]) assert.equal(safeAuthNext(next, `https://${main}`), "/");
  assert.equal(safeAuthNext("/study/20/attribution?groupBy=model", `https://${main}`), "/study/20/attribution?groupBy=model");
});

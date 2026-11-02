import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const HOOK_SOURCE = `
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = ${JSON.stringify(REPO_ROOT)};

const resolveCandidatePath = (basePath) => {
  const candidates = [
    basePath,
    basePath + ".ts",
    basePath + ".tsx",
    basePath + ".js",
    basePath + ".mjs",
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export {};",
    };
  }

  if (specifier === "next/headers") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export const cookies = async () => ({ getAll: () => [], set: () => {} }); export const headers = async () => new Headers();",
    };
  }

  if (specifier.startsWith("@/")) {
    const resolvedUrl = resolveCandidatePath(
      path.join(REPO_ROOT, specifier.slice(2)),
    );
    if (resolvedUrl) {
      return nextResolve(resolvedUrl, context);
    }
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parentPath = context.parentURL?.startsWith("file:")
      ? path.dirname(fileURLToPath(context.parentURL))
      : REPO_ROOT;
    const resolvedUrl = resolveCandidatePath(path.resolve(parentPath, specifier));
    if (resolvedUrl) {
      return nextResolve(resolvedUrl, context);
    }
  }

  return nextResolve(specifier, context);
}
`;

if (fs.existsSync(REPO_ROOT)) {
  module.register(
    `data:text/javascript,${encodeURIComponent(HOOK_SOURCE)}`,
    pathToFileURL(REPO_ROOT + path.sep),
  );
}

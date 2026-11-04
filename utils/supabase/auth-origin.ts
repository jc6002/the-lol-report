type AuthEnvironment = Record<string, string | undefined>;

const parseOrigin = (value: string | undefined) => {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
};

// PKCE cookies belong to the host that starts sign-in. A Vercel snapshot must
// therefore also receive its own callback, even when SITE_URL points to main.
// Only deployment hosts supplied by Vercel may override the configured origin.
export function resolveAuthOrigin(
  requestHost: string | null,
  env: AuthEnvironment = process.env,
): string {
  const host = requestHost?.trim().toLowerCase();
  const deploymentHosts = [
    env.VERCEL_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_BRANCH_URL,
  ].map((value) => value?.trim().toLowerCase()).filter(Boolean);

  if (env.VERCEL === "1" && host && deploymentHosts.includes(host)) {
    return `https://${host}`;
  }

  // Amplify may expose an internal localhost host; retain its explicit origin.
  const configured = parseOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured;

  if (host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
    return `http://${host}`;
  }
  throw new Error("A trusted sign-in origin is not configured.");
}

export function safeAuthNext(next: string | null, origin: string): string {
  if (!next?.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

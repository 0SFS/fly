import { normalizeModSource } from "@0sfs/mods/normalizeModSource";

/**
 * A GitHub Pages 404 for an unpinned owner/repo. On a dev server the same
 * owner and repo may exist as a checkout at `/dev-mods/<repo>/`.
 * Returns `local:owner/repo`, or null when the failure is not that case.
 */
export function localCheckoutSource(source: string, error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes(".github.io/") || !message.includes("(404)")) return null;
  const trimmed = source.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith("local:")) return null;
  try {
    const normalized = normalizeModSource(trimmed);
    if (normalized.ref !== "HEAD" || !normalized.manifestUrl.includes(".github.io/")) return null;
    return `local:${normalized.owner}/${normalized.repo}`;
  } catch {
    return null;
  }
}

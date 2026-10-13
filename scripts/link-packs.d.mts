/** Types for `link-packs.mjs`, which `vite.config.ts` imports to link package public files. */
export function linkPackPublicFiles(root?: string): {
  linked: number;
  created: number;
  removed: number;
};

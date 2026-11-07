import type { OsfsModManifest } from "@0sfs/mods/schema";
import { installSpace, registerBody, registerMission, uninstallSpace, unregisterBody, unregisterMission } from "@0sfs/space/session";

/** Registers the space plugin, a body, or a mission. Dependencies are applied first. */
export function applySpaceManifest(manifest: OsfsModManifest): void {
  if (manifest.space) installSpace(manifest.space);
  if (manifest.body) registerBody(manifest.body);
  if (manifest.mission) registerMission(manifest.mission);
}

/** Drops whichever of those this manifest added. Removing space drops the domain. */
export function removeSpaceManifest(manifest: OsfsModManifest): void {
  if (manifest.mission) unregisterMission(manifest.mission.id);
  if (manifest.body) unregisterBody(manifest.body.id);
  if (manifest.space) uninstallSpace();
}

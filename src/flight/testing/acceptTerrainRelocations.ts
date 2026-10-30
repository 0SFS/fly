import type { createTerrainContact } from "@0sfs/ground-contact/terrainContact";

type TerrainContact = ReturnType<typeof createTerrainContact>;

/**
 * A terrain contact whose pilot answers Yes to every relocation question at
 * once. Physics scenarios use it to measure the move itself; the questions and
 * the No answer have their own tests. An accepted move reports "reset", as the
 * app resets the physics loop after one.
 */
export function acceptTerrainRelocations<Contact extends TerrainContact>(contact: Contact): Contact {
  const update = contact.update;
  return {
    ...contact,
    update(...args: Parameters<TerrainContact["update"]>): ReturnType<TerrainContact["update"]> {
      const result = update(...args);
      const proposal = contact.getRelocationProposal();
      if (!proposal) return result;
      if (!contact.acceptRelocation(proposal.id)) throw new Error("A pending terrain proposal could not be accepted");
      return "reset";
    },
  };
}

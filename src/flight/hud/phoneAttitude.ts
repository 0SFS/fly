import type { PhoneAttitudeRenderer } from "@0sfs/rc/phoneAttitudeInstrument";
import { ATTITUDE_HALF_SHARE, createAttitudeRenderer } from "./attitudeRenderer";

/**
 * This HUD's attitude indicator for a paired phone's pitch/roll pad, drawn by
 * the same renderer from the attitude, stick and view this computer sends. In
 * Canvas 2D: the phone has no globe whose GPU device it could share.
 */
export const phoneAttitudeRenderer: PhoneAttitudeRenderer = {
  halfShare: ATTITUDE_HALF_SHARE,
  mount(host) {
    const renderer = createAttitudeRenderer(host, { preference: "canvas2d" });
    return {
      draw: (attitude, stick) => renderer.draw(attitude, stick, attitude.view ?? null),
      destroy: () => renderer.destroy(),
    };
  },
};

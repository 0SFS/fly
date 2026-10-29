import type { Camera, Node, Scene } from "@babylonjs/core";
import { createCanvasTextureDevicePorts, createOrbitCompass } from "foss-earth/runtime";
import type { FloatingOriginHandle } from "../bridge/floatingOrigin";

/** The tour's horizon letters in the flight's east/up/south scene frame. */
export function createFlightCompass(scene: Scene, origin: FloatingOriginHandle, document: Document, requestRender: () => void) {
  const compass = createOrbitCompass(scene, {
    // Flight cameras have a much nearer far clip than the globe's camera.
    get horizonMaxDistanceMeters() { return scene.activeCamera ? scene.activeCamera.maxZ * 0.8 : undefined; },
    ecefToScene(position) {
      const { m } = origin.getWorldFromEcef()!;
      return {
        x: m[0] * position.x + m[4] * position.y + m[8] * position.z + m[12],
        y: m[1] * position.x + m[5] * position.y + m[9] * position.z + m[13],
        z: m[2] * position.x + m[6] * position.y + m[10] * position.z + m[14],
      };
    },
    requestRender,
    device: createCanvasTextureDevicePorts({
      scene,
      createCanvas(width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
      transfer: (_bytes, _label, submit) => submit(),
    }),
  });
  return {
    update(camera: Camera | null): void {
      const reference = origin.getOriginEcef();
      const frame = origin.getWorldFromEcef();
      if (!camera || !reference || !frame) { compass.update(null, 0, null); return; }
      // Babylon's cached getters skip a dirty ancestor when the render id has not
      // advanced, and a forced computeWorldMatrix recomputes a node that is already
      // current. The chase frame often refreshed this chain: force only a stale
      // parent, root first, then the view matrix only when the camera's own view
      // is stale. Projection is not part of that check.
      const parents: Node[] = [];
      for (let node = camera.parent; node; node = node.parent) parents.unshift(node);
      for (const node of parents) {
        if (!node.isSynchronized()) node.computeWorldMatrix(true);
      }
      if (!camera._isSynchronizedViewMatrix()) camera.getViewMatrix(true);
      const { x, y, z } = camera.globalPosition;
      const { m } = frame;
      // Invert the orthonormal ECEF -> east/up/south rotation in double precision.
      compass.update(null, 0, {
        x: reference.x + m[0] * x + m[1] * y + m[2] * z,
        y: reference.y + m[4] * x + m[5] * y + m[6] * z,
        z: reference.z + m[8] * x + m[9] * y + m[10] * z,
      });
    },
    destroy: () => compass.destroy(),
  };
}

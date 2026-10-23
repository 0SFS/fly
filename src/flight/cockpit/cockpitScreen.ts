/**
 * The cockpit's touchscreen. By default it shows the flight's own interface,
 * as the chase view does: a copy of the page (@foss-earth/ui's DOM mirror)
 * drawn into a texture on a second, transparent face just in front of the
 * model's screen, which itself shows black or, by choice, the chase camera's
 * view drawn again for it. A tap on it presses what is there on the page. The
 * model's own picture, which stands in for the aircraft's displays until they
 * are made, is the other choice; the screen is then the model's, unchanged.
 *
 * With a flat display the page's interface stays over the view too: the
 * settings choose which parts of it are also on the screen. Spec:
 * docs/proposals/cockpit-screen.md.
 *
 * TODO(performance): none of the world behind the cockpit is seen in the
 * cockpit view, but all of it inside the view's frustum is drawn; see the 0SFS
 * docs repository's TODO.md (../docs/TODO.md) → performance, "Do not draw the
 * world the cockpit covers".
 */
import {
  Color3,
  Constants,
  DynamicTexture,
  Material,
  Mesh,
  PBRMaterial,
  Quaternion,
  Ray,
  RenderTargetTexture,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
  type AbstractMesh,
  type Camera,
  type Node,
  type Scene,
} from "@babylonjs/core";
import { createDomMirror, createDomPointer, type DomMirror, type DomPointer, type MirrorRect } from "@foss-earth/ui/browser";

export type CockpitScreenContent = "flight" | "aircraft";
export type CockpitScreenBackground = "black" | "chase";
export type CockpitScreenPlace = "screen" | "hud";
export type CockpitScreenPart = "instruments" | "toolbar" | "windows";

export interface CockpitScreenSettings {
  content: CockpitScreenContent;
  background: CockpitScreenBackground;
  places: Record<CockpitScreenPart, CockpitScreenPlace>;
  refreshRateHz: number;
  /** The texture's width; its height follows the screen's shape. */
  resolutionPx: number;
}

export interface CockpitScreenAircraft {
  getViewMode(): "first" | "third";
  firstPersonCamera: Camera;
  thirdPersonCamera: Camera;
}

export interface CockpitScreenOptions {
  scene: Scene;
  document: Document;
  /** The 3D view's canvas: a tap on the screen there presses the page. */
  canvas: HTMLCanvasElement;
  aircraft(): CockpitScreenAircraft | null;
  settings(): CockpitScreenSettings;
  /** Each part of the page's interface, as a selector of its outermost elements. */
  parts: Record<CockpitScreenPart, string>;
  /** What is never on the screen: the 3D view itself, and what acts on the pilot's eyes. */
  never: string;
  /** What holds the 3D view: drawn without its background, so the screen's own shows behind the interface. */
  viewHolders: string;
  requestRender(): void;
  now(): number;
}

export interface CockpitScreen {
  /** The aircraft's loaded mesh changed: its screens are those of these materials under these roots. */
  setModel(roots: readonly Node[], screenMaterialNames: readonly string[]): void;
  /** A setting changed. */
  refresh(): void;
  /** Before each frame: draws what is due. */
  update(): void;
  /** The point of the page, in CSS px, at a point of a screen's texture, or null off the page's picture. */
  pagePoint(u: number, v: number): { x: number; y: number } | null;
  /** Whether it shows the flight's interface: the aircraft has a screen, and the settings ask for it. */
  showsInterface(): boolean;
  /**
   * Where a ray in the world, such as a headset's hand's, meets the screen
   * while it shows the interface: metres along it, and the point of the page
   * there, or null off the page's picture. Null where it misses.
   */
  hit(origin: readonly [number, number, number], direction: readonly [number, number, number]): { distance: number; page: { x: number; y: number } | null } | null;
  /** Where a point of the page, CSS px, shows on the screen while it shows the interface, in the world: for a test to aim at it. */
  locate(x: number, y: number): [number, number, number] | null;
  dispose(): void;
}

/**
 * Copies of the page take at most this share of the main thread: a copy that
 * took 5 ms waits 100 ms for the next. A slower device copies less often and
 * keeps its frames.
 */
export const MIRROR_MAIN_THREAD_SHARE = 0.05;
/** The chase view behind the interface is drawn at this share of the texture's pixels each way. */
export const CHASE_SCALE = 0.5;
/** The transparent face's distance in front of the model's screen, m: clear of its depth, and too near to see. */
const OVERLAY_OFFSET_METERS = 0.001;
/** A press that moves less than this, CSS px, and lasts less than TAP_MS, is a tap on the screen. */
const TAP_SLOP_PX = 6;
const TAP_MS = 600;
/** A hand reaches the screen from the seat within this, m. */
const REACH_METERS = 5;

/** `inner`, as large as it fits inside `outer` and centred in it. */
export function fitRect(inner: { width: number; height: number }, outer: { width: number; height: number }): MirrorRect {
  const scale = Math.min(outer.width / inner.width, outer.height / inner.height);
  const width = inner.width * scale, height = inner.height * scale;
  return { x: (outer.width - width) / 2, y: (outer.height - height) / 2, width, height };
}

/**
 * A flat screen's width over its height, from its mesh: the two longest sides
 * of its box, in metres. The texture's u runs along the longer, as on a wide
 * display.
 */
export function screenAspect(mesh: AbstractMesh): number {
  const { minimum, maximum } = mesh.getBoundingInfo().boundingBox;
  const world = mesh.computeWorldMatrix(true);
  const sides = [Vector3.Right(), Vector3.Up(), new Vector3(0, 0, 1)]
    .map((axis, index) => Vector3.TransformNormal(axis, world).length() * (maximum.asArray()[index]! - minimum.asArray()[index]!))
    .sort((a, b) => b - a);
  return sides[1]! > 0 ? sides[0]! / sides[1]! : 1;
}

/** Whether an element of the page is drawn on the screen: not one that never is, nor one of a part placed in the HUD. */
export function screenIncludes(parts: Record<CockpitScreenPart, string>, never: string, places: Record<CockpitScreenPart, CockpitScreenPlace>): (element: Element) => boolean {
  const left = [never, ...(Object.keys(parts) as CockpitScreenPart[]).filter(part => places[part] === "hud").map(part => parts[part])]
    .filter(selector => selector.length > 0).join(", ");
  return left ? element => !element.matches(left) : () => true;
}

/**
 * The point of the page, in CSS px, at a point (u, v) of a texture with the
 * page's picture fitted in it, or null off the picture. The texture's top row
 * is at v = 0, as the canvas drawn into it.
 */
export function pageAt(u: number, v: number, viewport: { width: number; height: number }, texture: { width: number; height: number }): { x: number; y: number } | null {
  if (texture.width === 0 || texture.height === 0) return null;
  const fitted = fitRect(viewport, texture);
  const x = ((u * texture.width - fitted.x) / fitted.width) * viewport.width;
  const y = ((v * texture.height - fitted.y) / fitted.height) * viewport.height;
  return x >= 0 && y >= 0 && x <= viewport.width && y <= viewport.height ? { x, y } : null;
}

/** The point of a screen's texture showing a point of the page, CSS px: pageAt's inverse. */
export function textureAt(x: number, y: number, viewport: { width: number; height: number }, texture: { width: number; height: number }): { u: number; v: number } | null {
  if (texture.width === 0 || texture.height === 0 || viewport.width === 0 || viewport.height === 0) return null;
  const fitted = fitRect(viewport, texture);
  return { u: (fitted.x + (x / viewport.width) * fitted.width) / texture.width, v: (fitted.y + (y / viewport.height) * fitted.height) / texture.height };
}

/** Where a mesh's texture point (u, v) is, in its own space: on the first of its triangles holding it, or null on none. */
export function pointAtUv(positions: ArrayLike<number>, uvs: ArrayLike<number>, indices: ArrayLike<number>, u: number, v: number): [number, number, number] | null {
  const EDGE = -1e-9;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    const ua = uvs[2 * a]!, va = uvs[2 * a + 1]!, ub = uvs[2 * b]!, vb = uvs[2 * b + 1]!, uc = uvs[2 * c]!, vc = uvs[2 * c + 1]!;
    const det = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc);
    if (det === 0) continue;
    const wa = ((vb - vc) * (u - uc) + (uc - ub) * (v - vc)) / det;
    const wb = ((vc - va) * (u - uc) + (ua - uc) * (v - vc)) / det;
    const wc = 1 - wa - wb;
    if (wa < EDGE || wb < EDGE || wc < EDGE) continue;
    const at = (i: number): number => wa * positions[3 * a + i]! + wb * positions[3 * b + i]! + wc * positions[3 * c + i]!;
    return [at(0), at(1), at(2)];
  }
  return null;
}

/**
 * When the next copy of the page may start: after the refresh interval, and
 * after the last copy's cost has been repaid at MIRROR_MAIN_THREAD_SHARE.
 */
export function nextMirrorAt(startedAt: number, costMs: number, refreshRateHz: number): number {
  return startedAt + Math.max(1000 / refreshRateHz, costMs / MIRROR_MAIN_THREAD_SHARE);
}

interface ScreenFace {
  mesh: AbstractMesh;
  original: Material | null;
  base: PBRMaterial;
  overlay: Mesh;
  /** The screen's +y, the quad's own normal, in its local space. */
  normalSign: number;
}

export function createCockpitScreen(options: CockpitScreenOptions): CockpitScreen {
  const { scene, document } = options;
  let faces: ScreenFace[] = [];
  let aspect = 2;
  let texture: DynamicTexture | null = null;
  let overlayMaterial: StandardMaterial | null = null;
  let chase: RenderTargetTexture | null = null;
  let mirror: DomMirror | null = null;
  let pointer: DomPointer | null = null;
  let include = screenIncludes(options.parts, options.never, options.settings().places);
  let applied: { content: CockpitScreenContent; background: CockpitScreenBackground } | null = null;
  let shown = false;
  let drawnRevision = -1;
  let drawnAt = -Infinity;
  let chaseAt = -Infinity;
  let mirrorAt = -Infinity;
  let mirroring = false;
  let wake: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const textureSize = { width: 0, height: 0 };

  const excluded = new Set<AbstractMesh>();
  const visible = (): boolean => {
    const aircraft = options.aircraft();
    return !disposed && faces.length > 0 && aircraft?.getViewMode() === "first" && options.settings().content === "flight";
  };

  const ensureTexture = (): DynamicTexture => {
    const { resolutionPx } = options.settings();
    const width = Math.round(resolutionPx), height = Math.max(1, Math.round(resolutionPx / aspect));
    if (texture && textureSize.width === width && textureSize.height === height) return texture;
    texture?.dispose();
    textureSize.width = width;
    textureSize.height = height;
    texture = new DynamicTexture("cockpit-screen-interface", { width, height }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    texture.hasAlpha = true;
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    if (overlayMaterial) {
      overlayMaterial.emissiveTexture = texture;
      overlayMaterial.opacityTexture = texture;
    }
    drawnRevision = -1;
    drawnAt = -Infinity;
    return texture;
  };

  const ensureOverlayMaterial = (): StandardMaterial => {
    if (overlayMaterial) return overlayMaterial;
    const material = new StandardMaterial("cockpit-screen-interface", scene);
    // The interface's own colours, whatever the light: it is a lit display.
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    // A standard material adds its emissive texture to this colour.
    material.emissiveColor = Color3.Black();
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    const surface = ensureTexture();
    material.emissiveTexture = surface;
    material.opacityTexture = surface;
    overlayMaterial = material;
    return material;
  };

  const ensureChase = (): RenderTargetTexture => {
    const width = Math.max(64, Math.round(textureSize.width * CHASE_SCALE));
    const height = Math.max(32, Math.round(textureSize.height * CHASE_SCALE));
    if (chase && chase.getSize().width === width && chase.getSize().height === height) return chase;
    removeChase();
    const target = new RenderTargetTexture("cockpit-screen-chase", { width, height }, scene, {
      generateMipMaps: false,
      type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
    });
    target.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    // The screen draws this texture: it cannot be in it.
    target.renderListPredicate = mesh => !excluded.has(mesh);
    target.gammaSpace = true;
    // A render target's first row is its picture's bottom; the model's screen has v = 0 at its top.
    target.vScale = -1;
    target.vOffset = 1;
    scene.customRenderTargets.push(target);
    chase = target;
    chaseAt = -Infinity;
    return target;
  };

  const removeChase = (): void => {
    if (!chase) return;
    const index = scene.customRenderTargets.indexOf(chase);
    if (index >= 0) scene.customRenderTargets.splice(index, 1);
    for (const face of faces) if (face.base.emissiveTexture === chase) face.base.emissiveTexture = null;
    chase.dispose();
    chase = null;
  };

  const ensureMirror = (): DomMirror => {
    if (mirror) return mirror;
    mirror = createDomMirror({
      document,
      include: element => include(element),
      seeThrough: options.viewHolders,
      onChange: () => { if (shown) options.requestRender(); },
    });
    return mirror;
  };

  const ensurePointer = (): DomPointer => {
    if (pointer) return pointer;
    pointer = createDomPointer({ document, include: element => include(element) });
    return pointer;
  };

  /** Puts the settings on the meshes: the model's screen, or the interface over black or the chase view. */
  const apply = (): void => {
    const { content, background } = options.settings();
    if (applied && applied.content === content && applied.background === background) return;
    applied = { content, background };
    for (const face of faces) {
      if (content === "aircraft") {
        face.mesh.material = face.original;
        face.overlay.setEnabled(false);
        continue;
      }
      face.mesh.material = face.base;
      face.overlay.material = ensureOverlayMaterial();
      face.overlay.setEnabled(true);
      if (background === "chase") {
        const target = ensureChase();
        face.base.emissiveTexture = target;
        face.base.emissiveColor = Color3.White();
      } else {
        face.base.emissiveTexture = null;
        face.base.emissiveColor = Color3.Black();
      }
    }
    if (content === "aircraft" || background === "black") removeChase();
    options.requestRender();
  };

  const releaseFaces = (): void => {
    for (const face of faces) {
      if (!face.mesh.isDisposed()) face.mesh.material = face.original;
      excluded.delete(face.mesh);
      excluded.delete(face.overlay);
      if (!face.overlay.isDisposed()) face.overlay.dispose(false, false);
      face.base.dispose(false, false);
    }
    faces = [];
    applied = null;
  };

  const drawInterface = (now: number): void => {
    const surface = ensureTexture();
    const context = surface.getContext() as CanvasRenderingContext2D;
    context.clearRect(0, 0, textureSize.width, textureSize.height);
    if (mirror && mirror.revision > 0) {
      const viewport = mirror.viewport;
      mirror.draw(context, { x: 0, y: 0, width: viewport.width, height: viewport.height }, fitRect(viewport, textureSize));
    }
    // As the model's own texture: the canvas's top row at v = 0.
    surface.update(false);
    drawnRevision = mirror?.revision ?? 0;
    drawnAt = now;
  };

  const snapshot = (now: number): void => {
    if (!mirror || mirroring || !mirror.stale || now < mirrorAt) return;
    mirroring = true;
    const started = options.now();
    void mirror.snapshot().finally(() => {
      mirroring = false;
      mirrorAt = nextMirrorAt(started, options.now() - started, options.settings().refreshRateHz);
    });
  };

  /** Keeps the transparent face on the pilot's side of the screen. */
  const orient = (eye: Vector3): void => {
    for (const face of faces) {
      const world = face.mesh.getWorldMatrix();
      const normal = Vector3.TransformNormal(Vector3.Up(), world);
      const scale = normal.length();
      if (scale === 0) continue;
      const toEye = eye.subtract(face.mesh.getAbsolutePosition());
      const sign = Vector3.Dot(normal, toEye) >= 0 ? 1 : -1;
      if (sign === face.normalSign) continue;
      face.normalSign = sign;
      face.overlay.position.set(0, (sign * OVERLAY_OFFSET_METERS) / scale, 0);
    }
  };

  // A tap on the screen in the 3D view: the cockpit look keeps a drag.
  let press: { x: number; y: number; at: number; id: number } | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    press = shown && event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, at: options.now(), id: event.pointerId } : null;
  };
  const onPointerUp = (event: PointerEvent): void => {
    const pressed = press;
    press = null;
    if (!pressed || pressed.id !== event.pointerId || !shown) return;
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > TAP_SLOP_PX || options.now() - pressed.at > TAP_MS) return;
    const aircraft = options.aircraft();
    if (!aircraft) return;
    const rect = options.canvas.getBoundingClientRect();
    const overlays = new Set<AbstractMesh>(faces.map(face => face.overlay));
    const pick = scene.pick(event.clientX - rect.left, event.clientY - rect.top, mesh => overlays.has(mesh), false, aircraft.firstPersonCamera);
    const uv = pick?.hit ? pick.getTextureCoordinates() : null;
    const point = uv ? pagePoint(uv.x, uv.y) : null;
    if (!point) return;
    const tapping = ensurePointer();
    tapping.move(point.x, point.y);
    tapping.down(point.x, point.y);
    tapping.up(point.x, point.y);
    tapping.leave();
    options.requestRender();
  };
  options.canvas.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  options.canvas.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });

  const pageSize = (): { width: number; height: number } => mirror?.viewport ?? { width: document.defaultView!.innerWidth, height: document.defaultView!.innerHeight };
  const pagePoint = (u: number, v: number): { x: number; y: number } | null => pageAt(u, v, pageSize(), textureSize);

  return {
    setModel(roots, names) {
      releaseFaces();
      if (disposed || names.length === 0) return;
      const wanted = new Set(names);
      const meshes = roots.flatMap(root => [root, ...root.getChildMeshes(false)])
        .filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.material !== null && wanted.has(mesh.material.name));
      for (const mesh of meshes) {
        const original = mesh.material;
        const base = original instanceof PBRMaterial ? original.clone(`${original.name}-cockpit-screen`) : new PBRMaterial(`${mesh.name}-cockpit-screen`, scene);
        // A screen that is off: dark glass, which keeps the model's reflections.
        base.albedoTexture = null;
        base.albedoColor = Color3.Black();
        base.emissiveTexture = null;
        base.emissiveColor = Color3.Black();
        base.emissiveIntensity = 1;
        const overlay = mesh.clone(`${mesh.name}-cockpit-screen-interface`, null, true)!;
        overlay.parent = mesh;
        overlay.position.setAll(0);
        overlay.rotationQuaternion = Quaternion.Identity();
        overlay.scaling.setAll(1);
        overlay.isPickable = false;
        overlay.setEnabled(false);
        excluded.add(mesh);
        excluded.add(overlay);
        faces.push({ mesh, original, base, overlay, normalSign: 0 });
      }
      if (faces[0]) aspect = screenAspect(faces[0].mesh);
      apply();
    },
    refresh() {
      include = screenIncludes(options.parts, options.never, options.settings().places);
      mirror?.invalidate();
      apply();
      drawnAt = -Infinity;
      chaseAt = -Infinity;
      options.requestRender();
    },
    update() {
      const now = options.now();
      const wasShown = shown;
      shown = visible();
      if (!shown) {
        if (wasShown) pointer?.leave();
        return;
      }
      apply();
      const aircraft = options.aircraft()!;
      orient(aircraft.firstPersonCamera.globalPosition);
      ensureTexture();
      ensureMirror();
      snapshot(now);
      const interval = 1000 / options.settings().refreshRateHz;
      // The page's own canvases move between copies: they are drawn at the screen's rate.
      const due = now - drawnAt >= interval && (mirror?.canvasCount ?? 0) > 0;
      if (mirror && (mirror.revision !== drawnRevision || due)) drawInterface(now);
      if (options.settings().background === "chase" && now - chaseAt >= interval) {
        const target = ensureChase();
        for (const face of faces) if (face.base.emissiveTexture !== target) face.base.emissiveTexture = target;
        target.activeCamera = aircraft.thirdPersonCamera;
        target.resetRefreshCounter();
        chaseAt = now;
      }
      // A paused view renders on demand: it comes back when the next copy may start.
      if (mirror?.stale && !mirroring && now < mirrorAt && wake === null) {
        wake = setTimeout(() => { wake = null; options.requestRender(); }, mirrorAt - now);
      }
    },
    pagePoint,
    showsInterface: () => !disposed && faces.length > 0 && options.settings().content === "flight",
    hit(origin, direction) {
      if (!shown) return null;
      const overlays = new Set<AbstractMesh>(faces.map(face => face.overlay));
      const ray = new Ray(new Vector3(origin[0], origin[1], origin[2]), new Vector3(direction[0], direction[1], direction[2]), REACH_METERS);
      const pick = scene.pickWithRay(ray, mesh => overlays.has(mesh), false);
      if (!pick?.hit) return null;
      const uv = pick.getTextureCoordinates();
      return { distance: pick.distance, page: uv ? pagePoint(uv.x, uv.y) : null };
    },
    locate(x, y) {
      if (!shown) return null;
      const uv = textureAt(x, y, pageSize(), textureSize);
      if (!uv) return null;
      for (const { overlay } of faces) {
        const positions = overlay.getVerticesData(VertexBuffer.PositionKind);
        const uvs = overlay.getVerticesData(VertexBuffer.UVKind);
        if (!positions || !uvs) continue;
        const local = pointAtUv(positions, uvs, overlay.getIndices() ?? Array.from({ length: positions.length / 3 }, (_, i) => i), uv.u, uv.v);
        if (!local) continue;
        const world = Vector3.TransformCoordinates(Vector3.FromArray(local), overlay.computeWorldMatrix(true));
        return [world.x, world.y, world.z];
      }
      return null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
      options.canvas.removeEventListener("pointerup", onPointerUp, { capture: true });
      if (wake !== null) clearTimeout(wake);
      releaseFaces();
      removeChase();
      texture?.dispose();
      overlayMaterial?.dispose(false, false);
      mirror?.dispose();
      pointer?.dispose();
    },
  };
}

import {
  ArcRotateCamera, Engine, HemisphericLight, MeshBuilder, PointLight, RenderTargetTexture, Scene, TransformNode, Vector3, WebGPUEngine,
  type AbstractEngine,
} from "@babylonjs/core";
import { getAircraftDefinition } from "@0sfs/aircraft/aircraftCatalog";
import { createAircraftModel } from "@0sfs/aircraft/createAircraftModel";
import { createEngineExhaustDepth } from "@0sfs/exhaust/engineExhaustDepth";
import "./fleet";

/**
 * One rendered frame after the flight's own gear warmup. `pipelines` counts GPU
 * pipeline and shader compiles during that frame; a gear toggle should not
 * start any, and it should not take longer than the frames around it.
 */
interface GearFrame {
  ms: number;
  pipelines: number;
  active: number;
  visibleGear: number;
  activeGear: number;
}

interface GearHitchReport {
  backend: "webgpu" | "webgl";
  warmed: boolean;
  /** Gear drawn before any warmup target was allowed to compile it. */
  cold: GearFrame[];
  /** Compiles while the hidden gear was drawn into its warmup targets. */
  warmupPipelines: number;
  /** Compiles on the first canvas frame, before the gear toggle. */
  firstCanvasPipelines: number;
  settled: GearFrame[];
  show: GearFrame[];
  hide: GearFrame[];
  showAgain: GearFrame[];
}

declare global {
  interface Window {
    __gearHitchBootErrors: string[];
    measureStowedGearHitch(): Promise<GearHitchReport>;
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function watchGpuCompiles(): { arm(on: boolean): void; read(): number; reset(): void } {
  let armed = false;
  let pipelines = 0;
  const note = () => { if (armed) pipelines += 1; };
  const device = GPUDevice.prototype;
  const createRenderPipeline = device.createRenderPipeline;
  const createShaderModule = device.createShaderModule;
  device.createRenderPipeline = function (this: GPUDevice, descriptor: GPURenderPipelineDescriptor) {
    note();
    return createRenderPipeline.call(this, descriptor);
  };
  device.createShaderModule = function (this: GPUDevice, descriptor: GPUShaderModuleDescriptor) {
    note();
    return createShaderModule.call(this, descriptor);
  };
  const gl = WebGL2RenderingContext.prototype;
  const compileShader = gl.compileShader;
  const linkProgram = gl.linkProgram;
  gl.compileShader = function (this: WebGL2RenderingContext, shader: WebGLShader) {
    note();
    return compileShader.call(this, shader);
  };
  gl.linkProgram = function (this: WebGL2RenderingContext, program: WebGLProgram) {
    note();
    return linkProgram.call(this, program);
  };
  return {
    arm(on: boolean) { armed = on; },
    read: () => pipelines,
    reset() { pipelines = 0; },
  };
}

async function engineFor(canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; backend: "webgpu" | "webgl" }> {
  if (navigator.gpu) {
    try {
      const engine = new WebGPUEngine(canvas, { antialias: true, stencil: true, adaptToDeviceRatio: false });
      await engine.initAsync();
      return { engine, backend: "webgpu" };
    } catch { /* This Chrome has no working WebGPU adapter; WebGL still compiles on first draw. */ }
  }
  return { engine: new Engine(canvas, true, { stencil: true, adaptToDeviceRatio: false }), backend: "webgl" };
}

async function measureStowedGearHitch(): Promise<GearHitchReport> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gear-hitch");
  if (!canvas) throw new Error("Missing gear hitch canvas.");
  const compiles = watchGpuCompiles();
  const { engine, backend } = await engineFor(canvas);
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera("gear-hitch-camera", -Math.PI / 2, Math.PI / 2.15, 22, Vector3.Zero(), scene);
  camera.minZ = 0.1;
  camera.maxZ = 1_000;
  scene.activeCamera = camera;
  new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  const parent = new TransformNode("aircraft", scene);
  // Airborne F-35B: the gear is fully up before the mesh is ever drawn.
  const model = createAircraftModel(scene, parent, { aircraftId: "f-35b", lodId: "hd", requestRender: () => {} });
  model.updateGearVisibility(0);
  const deadline = performance.now() + 60_000;
  while (model.getState().status !== "ready") {
    if (model.getState().status === "error") throw new Error(model.getState().error ?? "Aircraft model failed to load.");
    if (performance.now() > deadline) throw new Error("Aircraft model load timed out.");
    await delay(50);
  }
  camera.setTarget(parent.getAbsolutePosition());
  // The exhaust light and the plume depth pass appear after the gear is hidden.
  new PointLight("engine-exhaust-scene-light", new Vector3(0, 1, -6), scene);
  const plume = MeshBuilder.CreateBox("plume", { size: 0.5 }, scene);
  plume.position.set(0, 0.5, -7);
  const depth = createEngineExhaustDepth(scene, plume, () => {});
  await delay(50);
  const names = new Set(getAircraftDefinition("f-35b").stowedGearNodeNames ?? []);
  const isGear = (name: string) => names.has(name.replace(/_primitive\d+$/, ""));
  const gearMeshes = () => scene.meshes.filter(mesh => isGear(mesh.name));
  const visibleGear = () => gearMeshes().filter(mesh => mesh.isVisible).length;
  const activeGear = () => {
    const active = scene.getActiveMeshes();
    let count = 0;
    for (let index = 0; index < active.length; index += 1) if (isGear(active.data[index].name)) count += 1;
    return count;
  };
  // Hidden bounds can sit at the origin. Pose them, then look at the gear so
  // the measured frame actually draws it.
  const gearBounds = { min: new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY), max: new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY) };
  for (const mesh of gearMeshes()) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    gearBounds.min.minimizeInPlace(box.minimumWorld);
    gearBounds.max.maximizeInPlace(box.maximumWorld);
  }
  const gearCenter = gearBounds.min.add(gearBounds.max).scale(0.5);
  if (Number.isFinite(gearCenter.x)) {
    camera.setTarget(gearCenter);
    camera.radius = Math.max(6, gearBounds.max.subtract(gearBounds.min).length() * 3);
  }
  const frame = (change?: () => void): GearFrame => {
    compiles.reset();
    compiles.arm(true);
    const start = performance.now();
    try {
      change?.();
      scene.render();
    } finally { compiles.arm(false); }
    return {
      ms: performance.now() - start, pipelines: compiles.read(), active: scene.getActiveMeshes().length,
      visibleGear: visibleGear(), activeGear: activeGear(),
    };
  };
  // The color warmup and the hidden-gear depth draw both go through a render
  // target. Hold those back so the first time the gear is shown is a real
  // canvas draw, which is the hitch the flight still has when warmup misses.
  let holdGearTargets = true;
  const renderTarget = RenderTargetTexture.prototype.render;
  RenderTargetTexture.prototype.render = function (this: RenderTargetTexture, useCameraPostProcess?: boolean, dumpForDebug?: boolean) {
    const list = this.renderList ?? [];
    const gearOnly = list.length > 0 && list.every(mesh => isGear(mesh.name));
    if (holdGearTargets && (this.name === "stowed-gear-color-warmup" || (this.name === "engine-exhaust-opaque-depth" && gearOnly))) return;
    return renderTarget.call(this, useCameraPostProcess, dumpForDebug);
  };
  depth.setActive(true, 1);
  const coldSettled: GearFrame[] = [];
  for (let index = 0; index < 12; index += 1) {
    coldSettled.push(frame());
    if (coldSettled.length >= 3 && coldSettled.slice(-3).every(sample => sample.pipelines === 0)) break;
    await delay(16);
  }
  const cold = [frame(() => model.updateGearVisibility(Number.EPSILON, true)), frame(), frame()];
  model.updateGearVisibility(0, true);
  frame();
  holdGearTargets = false;
  compiles.reset();
  compiles.arm(true);
  model.warmHiddenGear();
  const warmupPipelines = compiles.read();
  compiles.arm(false);
  const firstCanvas = frame();
  const warmUntil = performance.now() + 15_000;
  let warmed = model.hiddenGearPrepared();
  while (!warmed && performance.now() < warmUntil) {
    compiles.reset();
    compiles.arm(true);
    model.warmHiddenGear();
    compiles.arm(false);
    frame();
    warmed = model.hiddenGearPrepared();
    await delay(20);
  }
  const settled: GearFrame[] = [];
  for (let index = 0; index < 24; index++) {
    settled.push(frame());
    if (settled.length >= 5 && settled.slice(-3).every(sample => sample.pipelines === 0)) break;
    await delay(16);
  }
  const burst = (change: () => void): GearFrame[] => [frame(change), frame(), frame()];
  const show = burst(() => model.updateGearVisibility(Number.EPSILON, true));
  const hide = burst(() => model.updateGearVisibility(0, true));
  const showAgain = burst(() => model.updateGearVisibility(Number.EPSILON, true));
  depth.dispose();
  model.dispose();
  scene.dispose();
  engine.dispose();
  RenderTargetTexture.prototype.render = renderTarget;
  return { backend, warmed, cold, warmupPipelines, firstCanvasPipelines: firstCanvas.pipelines, settled, show, hide, showAgain };
}

window.measureStowedGearHitch = measureStowedGearHitch;

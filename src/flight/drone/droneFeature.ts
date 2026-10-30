import { Matrix, UniversalCamera, Vector3, type TransformNode } from "@babylonjs/core";
import { getAircraftDefinition } from "@0sfs/aircraft/aircraftCatalog";
import { createRotatingProp } from "@0sfs/rotating-prop";
import { createCameraControlsPanel } from "@0sfs/drone-camera/cameraControls";
import { poseVisualGimbal, slewGimbal } from "@0sfs/camera-gimbal";
import { setDroneMeshHook } from "@0sfs/aircraft/droneMeshHook";
import { readFlightState } from "@0sfs/ground-contact/ecefBridge";
import type { DroneFeatureHooks, DroneMeshMount, DroneMotorPosition, DroneMotorReading, DroneStepContext, DroneViewContext } from "./droneGate";
import {
  activeAircraftId, droneHeldCapture, droneHeldGimbal, droneMotorTelemetry, droneRefusal, setDroneHeldGimbal, setDroneHeldCapture, setDroneAcousticTelemetry, setDroneMotorTelemetry, setDroneRefusal, setDroneTelemetry,
} from "./droneGate";
import { mountDroneProceduralMesh } from "./buildDroneProceduralMesh";
import { createCaptureRig, type CaptureRig } from "@0sfs/drone-camera/captureFrame";
import { createCaptureSequence, sequenceZip } from "@0sfs/drone-camera/captureSequence";
import { createDroneController, type DroneController } from "./droneController";
import { createDroneGimbal, type DroneGimbalRig } from "./droneGimbal";
import { blurLimitRadPerSec } from "@0sfs/drone-camera/flowEstimator";
import { createOpticalFlow, type OpticalFlow } from "@0sfs/drone-camera/opticalFlow";
import { quadProfile, setQuadProfileBuilder } from "./quadRegistry";
import { sphericalGrid } from "@0sfs/drone-camera/sphericalGrid";
import { downloadZip } from "@0sfs/drone-camera/zipStore";
import { buildDroneProfile, type DroneProfile } from "./droneTypes";
import { createDroneCameraPreview } from "./droneCameraPreview";
import { droneMotorPosition } from "./droneMotorTelemetry";
import { createQuadEngineMonitor } from "@0sfs/engines/quadEngineMonitor";
import { getAppSettings } from "foss-earth/settings";

function wrapDegrees(degrees: number): number {
  return Math.atan2(Math.sin(degrees * Math.PI / 180), Math.cos(degrees * Math.PI / 180)) * 180 / Math.PI;
}
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Loaded only from `loadDroneFeature`. Builds the controller, gimbal, mesh,
 * capture and the spherical sequence, then hands them to the gate.
 */
export function attach(registration: {
  setHooks(next: DroneFeatureHooks | null): void;
  setMesh(next: DroneMeshMount | null): void;
}): void {
  setQuadProfileBuilder(buildDroneProfile);
  let controller: DroneController | null = null;
  let bound = "";
  let boundProfile: DroneProfile | null = null;
  let gimbal: DroneGimbalRig | null = null;
  let gimbalFor = "";
  let disposeMesh = () => {};
  let rotorPivots: TransformNode[] = [];
  let rotorPositions: DroneMotorPosition[] = [];
  let rotors: ReturnType<typeof createRotatingProp>[] = [];
  let motorReadings: readonly DroneMotorReading[] = [];
  let hoverRpm = 0;
  let motorSimTime = 0;
  let rotorSeconds = 0;
  let capture: CaptureRig | null = null;
  let flow: OpticalFlow | null = null;
  let terrain: number | null = null;
  let shutterSeen = false;
  let pendingStill = false;
  let lastFrame = 0;
  const sequence = createCaptureSequence();
  let lastView: DroneViewContext | null = null;
  let stillBusy = false;
  let captureStopped = false;
  let commandedGimbalDeg = 0;
  const mountTarget = { rollDeg: 0, yawDeg: 0 };
  const mountActual = { rollDeg: 0, yawDeg: 0 };
  let automaticGimbal = false;
  const preview = createDroneCameraPreview(document, {
    readAim() {
      const current = profile();
      return { yawDeg: mountTarget.yawDeg, pitchDeg: droneHeldGimbal(),
        yawMinDeg: current?.gimbalYawMinDeg ?? 0, yawMaxDeg: current?.gimbalYawMaxDeg ?? 0,
        pitchMinDeg: -90, pitchMaxDeg: current?.gimbalMaxDeg ?? 0,
        enabled: Boolean(current) && !sequence.isCapturing() && !droneHeldCapture() };
    },
    onAim(yawDeg, pitchDeg) {
      const current = profile();
      if (!current || sequence.isCapturing() || droneHeldCapture()) return;
      setDroneHeldGimbal(Math.max(-90, Math.min(current.gimbalMaxDeg, pitchDeg)));
      setMountTarget("yawDeg", yawDeg);
    },
  });
  const cameraPanel = createCameraControlsPanel({
    document,
    preview: preview.element,
    onGimbalPitch(deg) {
      const current = profile();
      if (!current || sequence.isCapturing() || droneHeldCapture()) return;
      setDroneHeldGimbal(Math.max(-90, Math.min(current.gimbalMaxDeg, deg)));
      refreshCameraPanel();
      lastView?.requestRender();
    },
    onGimbalRoll(deg) { setMountTarget("rollDeg", deg); },
    onGimbalYaw(deg) { setMountTarget("yawDeg", deg); },
    onCapture(on) {
      setDroneHeldCapture(on);
      // A desktop stop also cancels a phone-held sequence until that toggle is
      // released. A new explicit start releases the cancellation.
      captureStopped = !on;
      refreshCameraPanel();
      lastView?.requestRender();
    },
    onShutter() {
      if (stillBusy || pendingStill || sequence.isCapturing()) return;
      pendingStill = true;
      refreshCameraPanel();
      lastView?.requestRender();
    },
  });
  const profile = (): DroneProfile | null => {
    const id = activeAircraftId();
    return id ? quadProfile(id) : null;
  };
  function releaseController() {
    controller?.dispose();
    controller = null;
    bound = "";
    boundProfile = null;
    motorReadings = [];
    hoverRpm = motorSimTime = rotorSeconds = 0;
    setDroneMotorTelemetry(null);
    setDroneAcousticTelemetry(null);
  }
  function setMountTarget(axis: "rollDeg" | "yawDeg", deg: number) {
    const current = profile();
    if (!current || sequence.isCapturing() || droneHeldCapture() || !Number.isFinite(deg)) return;
    const min = axis === "rollDeg" ? current.gimbalRollMinDeg : current.gimbalYawMinDeg;
    const max = axis === "rollDeg" ? current.gimbalRollMaxDeg : current.gimbalYawMaxDeg;
    mountTarget[axis] = Math.max(min ?? 0, Math.min(max ?? 0, deg));
    refreshCameraPanel();
    lastView?.requestRender();
  }
  const ensure = (next: DroneProfile): DroneController => {
    if (!controller || bound !== next.id || boundProfile !== next) {
      releaseController();
      bound = next.id;
      boundProfile = next;
      controller = createDroneController(next);
      motorReadings = next.rotors.map(rotor => ({ position: rotor.position, rpm: 0, direction: rotor.spin }));
      hoverRpm = 0;
      motorSimTime = 0;
      rotorSeconds = 0;
      mountTarget.rollDeg = Math.max(next.gimbalRollMinDeg ?? 0, Math.min(next.gimbalRollMaxDeg ?? 0, mountTarget.rollDeg));
      mountTarget.yawDeg = Math.max(next.gimbalYawMinDeg ?? 0, Math.min(next.gimbalYawMaxDeg ?? 0, mountTarget.yawDeg));
      mountActual.rollDeg = mountActual.yawDeg = 0;
      gimbal?.dispose();
      gimbal = null;
      gimbalFor = "";
    }
    return controller;
  };
  const mesh: DroneMeshMount = {
    mount(modelRoot: TransformNode) {
      disposeMesh();
      const current = profile();
      disposeMesh = current ? mountDroneProceduralMesh(modelRoot, {
        rotors: current.rotors, cgM: current.cgM, propellerRadiusM: current.propeller.radiusM,
      }) : () => {};
      return disposeMesh;
    },
    dispose() { disposeMesh(); disposeMesh = () => {}; },
  };
  const hooks: DroneFeatureHooks = {
    cameraTab: () => cameraPanel.element,
    releaseAircraft(id) { if (bound === id) releaseController(); },
    createEngineMonitor(root, options) {
      const monitor = createQuadEngineMonitor(root, { ...options, summaryMode: "passive" });
      return {
        update(_reader, held) { monitor.update(droneMotorTelemetry(), held); },
        // Quadcopter rotor speeds are separate from native combustion-engine
        // samples. The phone's drone telemetry retains its own contract.
        getReading: () => null,
        attachDetails: (host, settings) => monitor.attachDetails(host, settings),
        destroy: () => monitor.destroy(),
      };
    },
    beforeStep(step: DroneStepContext) {
      const current = profile();
      if (!current) { releaseController(); return; }
      if (step.command.shutter && !shutterSeen) pendingStill = true;
      shutterSeen = step.command.shutter;
      terrain = step.terrainMeters;
      if (!step.command.capture360) captureStopped = false;
      const requested = captureStopped ? { ...step.command, capture360: false } : step.command;
      const controllerNow = ensure(current);
      automaticGimbal = requested.capture360 || sequence.isCapturing();
      const rollBefore = mountActual.rollDeg, yawBefore = mountActual.yawDeg;
      mountActual.rollDeg = slewGimbal(mountActual.rollDeg, automaticGimbal ? 0 : mountTarget.rollDeg, step.dtSeconds,
        current.gimbalRollMinDeg ?? 0, current.gimbalRollMaxDeg ?? 0, current.gimbalSlewDeg);
      mountActual.yawDeg = slewGimbal(mountActual.yawDeg, automaticGimbal ? 0 : mountTarget.yawDeg, step.dtSeconds,
        current.gimbalYawMinDeg ?? 0, current.gimbalYawMaxDeg ?? 0, current.gimbalSlewDeg);
      const mountRate = Math.hypot(mountActual.rollDeg - rollBefore, mountActual.yawDeg - yawBefore) * Math.PI / 180 / step.dtSeconds;
      const planned = sequence.command(requested);
      commandedGimbalDeg = planned.gimbalPitchDeg;
      const result = controllerNow.step(step.sdk, planned, step.dtSeconds, step.terrainMeters);
      setDroneAcousticTelemetry({ aircraftId: current.id, propulsionId: current.propulsionId, ...result.acoustic });
      motorReadings = current.rotors.map((rotor, index) => ({
        position: rotor.position, rpm: result.rpm[index]!, direction: rotor.spin,
      }));
      hoverRpm = result.hoverRpm;
      motorSimTime = result.simTimeS;
      rotorSeconds += step.dtSeconds;
      const flowNow = flow?.latest();
      const rates = Math.hypot(
        step.sdk.getPropertyValue("velocities/p-rad_sec") || 0,
        step.sdk.getPropertyValue("velocities/q-rad_sec") || 0,
        step.sdk.getPropertyValue("velocities/r-rad_sec") || 0,
      );
      sequence.step({
        dt: step.dtSeconds,
        capture360: requested.capture360,
        psiDeg: result.psi * 180 / Math.PI,
        gimbalDeg: result.gimbalDeg,
        flowSource: flowNow?.source ?? "imu",
        deltaYawDeg: (flowNow?.deltaYawRad ?? 0) * 180 / Math.PI,
        deltaPitchDeg: (flowNow?.deltaPitchRad ?? 0) * 180 / Math.PI,
        omegaGate: Math.max(mountRate, flowNow?.source === "visual" ? flowNow.omegaRadPerSec : rates),
        omegaBlur: blurLimitRadPerSec(current.sensorH, current.vfovRad, current.exposureDen),
        capture: async () => {
          if (!gimbal || !capture) throw new Error("360° capture requires WebGPU.");
          try {
            const shot = await capture.capture(gimbal.camera, current,
              pose(current, result.gimbalDeg, readFlightState(step.sdk), step.terrainMeters));
            setDroneRefusal(null);
            return shot.jpeg;
          } catch (error) {
            setDroneRefusal(error instanceof Error ? error.message : String(error));
            throw error;
          }
        },
        download: entries => downloadZip(`0sfs-360-${current.id}.zip`, sequenceZip(entries)),
        grid: () => sphericalGrid(current),
      });
    },
    afterView(view: DroneViewContext) {
      const current = profile();
      if (!current) { releaseController(); return; }
      // A paused aircraft switch has no physics step to bind its mount limits.
      ensure(current);
      lastView = view;
      if (view.terrainMeters !== undefined) terrain = view.terrainMeters;
      const definition = getAircraftDefinition(current.id as Parameters<typeof getAircraftDefinition>[0]);
      const bindings = definition.rotors ?? [];
      const pivots = bindings.map(binding => view.aircraftRoot.getChildTransformNodes?.().find(node => node.name === binding.node))
        .filter((node): node is TransformNode => node !== undefined);
      if (pivots.length !== rotorPivots.length || pivots.some((node, index) => node !== rotorPivots[index])) {
        for (const rotor of rotors) rotor.dispose();
        rotorPivots = pivots;
        view.aircraftRoot.computeWorldMatrix(true);
        const rootInverse = Matrix.Invert(view.aircraftRoot.getWorldMatrix());
        rotorPositions = pivots.map(node => {
          node.computeWorldMatrix(true);
          const point = Vector3.TransformCoordinates(node.getAbsolutePosition(), rootInverse);
          return droneMotorPosition(point.x, point.z);
        });
        rotors = pivots.map((node, index) => {
          const binding = bindings.find(binding => binding.node === node.name)!;
          // Physics spin is about body +Z (down); the visual axes point up.
          return createRotatingProp({ node, axis: Vector3.FromArray(binding.axis), radius: binding.radiusMeters,
            blades: binding.blades, direction: -current.rotors.find(rotor => rotor.position === rotorPositions[index])!.spin });
        });
      }
      for (const [index, rotor] of rotors.entries()) {
        const rpm = motorReadings.find(motor => motor.position === rotorPositions[index])?.rpm ?? 0;
        rotor.update(rpm * Math.PI / 30, rotorSeconds, rotorSeconds === 0,
          getAppSettings().get<boolean>("osfs.aircraft.propellerDiscs") === true);
      }
      rotorSeconds = 0;
      setDroneMotorTelemetry({ aircraftId: current.id, label: current.label, hoverRpm, maxRpm: current.propeller.maxRpm,
        simTimeS: motorSimTime, motors: motorReadings, source: "simulated" });
      if (!gimbal || gimbalFor !== current.id) {
        gimbal?.dispose();
        const visual = view.aircraftRoot.getChildTransformNodes?.().find(node => node.name === "aircraft-visual")
          ?? view.scene.getTransformNodeByName("aircraft-visual");
        gimbal = createDroneGimbal(view.scene, current);
        if (visual) gimbal.base.parent = visual;
        gimbalFor = current.id;
        capture?.dispose();
        capture = createCaptureRig(view.scene, view.rendererMode, view.scene.getEngine() as { _device?: GPUDevice; flushFramebuffer(): void },
          mesh => !mesh.isDescendantOf(view.aircraftRoot) && !mesh.name.startsWith("orbit-compass-"));
        const device = view.rendererMode === "webgpu"
          ? (view.scene.getEngine() as { _device?: GPUDevice })._device
          : undefined;
        flow?.dispose();
        flow = device ? createOpticalFlow(device) : null;
      }
      const gimbalDeg = controller?.gimbalDeg() ?? 0;
      gimbal?.pose(view.state, gimbalDeg, mountActual);
      if (definition.gimbal) {
        const nodes = view.aircraftRoot.getChildTransformNodes?.() ?? [];
        const base = nodes.find(node => node.name === definition.gimbal!.baseNode);
        const pitch = nodes.find(node => node.name === definition.gimbal!.pitchNode);
        const yaw = nodes.find(node => node.name === definition.gimbal!.yawNode);
        const roll = nodes.find(node => node.name === definition.gimbal!.rollNode);
        if (base && pitch) poseVisualGimbal(base, pitch, view.state, gimbalDeg, mountActual,
          yaw && roll ? { yaw, roll } : undefined);
      }
      gimbal?.followView(view.scene.activeCamera as UniversalCamera | null);
      if (gimbal) preview.update(view, gimbal.camera, current);
      const wantFlow = droneHeldCapture() || sequence.isCapturing();
      if (wantFlow && gimbal && flow) {
        const now = performance.now();
        const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
        lastFrame = now;
        void capture?.proxy(gimbal.camera, current).then(texture => {
          if (texture) flow?.push(texture, 320, Math.round(320 * current.sensorH / current.sensorW / 2) * 2, current.vfovRad, dt);
        }).catch(error => setDroneRefusal(error instanceof Error ? error.message : String(error)));
      }
      if (pendingStill && gimbal) {
        pendingStill = false;
        takeStill(current, view, gimbalDeg);
      }
      publish(current, gimbalDeg, view);
    },
    dispose() {
      releaseController();
      for (const rotor of rotors) rotor.dispose();
      rotors = []; rotorPivots = [];
      cameraPanel.destroy();
      preview.destroy();
      lastView = null;
      sequence.reset();
      gimbal?.dispose();
      capture?.dispose();
      flow?.dispose();
      mesh.dispose();
      setDroneMeshHook(null);
      registration.setHooks(null);
      registration.setMesh(null);
      setDroneTelemetry(null);
      setDroneMotorTelemetry(null);
    setDroneAcousticTelemetry(null);
      setDroneRefusal(null);
    },
  };
  registration.setHooks(hooks);
  registration.setMesh(mesh);
  setDroneMeshHook(mesh);
  function pose(current: DroneProfile, gimbalDeg: number, state: DroneViewContext["state"], terrainMeters: number | null) {
    return {
      model: current.exifModel,
      make: current.make,
      software: current.software,
      xmpNamespace: current.xmpNamespace,
      exposureDen: current.exposureDen,
      focalMm: current.focalMm,
      focal35mm: current.focal35mm,
      when: new Date(),
      yawDeg: state.headingRad * 180 / Math.PI,
      pitchDeg: state.pitchRad * 180 / Math.PI,
      rollDeg: state.rollRad * 180 / Math.PI,
      gimbalPitchDeg: gimbalDeg,
      gimbalYawDeg: wrapDegrees(state.headingRad * 180 / Math.PI + mountActual.yawDeg),
      gimbalRollDeg: mountActual.rollDeg,
      aglM: terrainMeters === null ? 0 : state.altMeters - terrainMeters,
      mslM: state.altMeters,
    };
  }
  function takeStill(current: DroneProfile, view: DroneViewContext, gimbalDeg: number) {
    if (!gimbal || !capture) return;
    const meta = pose(current, gimbalDeg, view.state, terrain);
    stillBusy = true;
    refreshCameraPanel();
    void capture.capture(gimbal.camera, current, meta).then(shot => {
      setDroneRefusal(null);
      downloadZip(`0sfs-still-${current.id}.zip`, sequenceZip([{ name: `DJI_000_${gimbalDeg.toFixed(2)}_${meta.yawDeg.toFixed(2)}.jpg`, bytes: shot.jpeg }]));
    }).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      setDroneRefusal(message);
    }).finally(() => {
      stillBusy = false;
      refreshCameraPanel();
    });
  }
  function publish(current: DroneProfile, gimbalDeg: number, view: DroneViewContext) {
    const flowNow = flow?.latest();
    setDroneTelemetry({
      available: true,
      droneId: current.id,
      yawAngleDeg: round(view.state.headingRad * 180 / Math.PI),
      gimbalPitchDeg: round(gimbalDeg),
      gimbalRollDeg: round(mountActual.rollDeg),
      isSettled: sequence.isSettled(),
      isCapturing: sequence.isCapturing(),
      capturePhase: sequence.phase(),
      nodeIndex: sequence.nodeIndex(),
      nodeCount: sequence.nodeCount(),
      flowConfidence: round(flowNow?.confidence ?? 0),
      flowSource: flowNow?.source ?? "imu",
      omegaVisualRadPerSec: round(flowNow?.omegaRadPerSec ?? 0),
    });
    refreshCameraPanel();
  }
  function refreshCameraPanel() {
    const current = profile();
    if (!current) return;
    cameraPanel.update({
      label: current.label,
      gimbalMinDeg: -90,
      gimbalMaxDeg: current.gimbalMaxDeg,
      gimbalTargetDeg: sequence.isCapturing() ? commandedGimbalDeg : droneHeldGimbal(),
      gimbalPitchDeg: controller?.gimbalDeg() ?? 0,
      gimbalRollMinDeg: current.gimbalRollMinDeg ?? 0,
      gimbalRollMaxDeg: current.gimbalRollMaxDeg ?? 0,
      gimbalRollTargetDeg: sequence.isCapturing() || droneHeldCapture() ? 0 : mountTarget.rollDeg,
      gimbalRollDeg: mountActual.rollDeg,
      gimbalYawMinDeg: current.gimbalYawMinDeg ?? 0,
      gimbalYawMaxDeg: current.gimbalYawMaxDeg ?? 0,
      gimbalYawTargetDeg: sequence.isCapturing() || droneHeldCapture() ? 0 : mountTarget.yawDeg,
      gimbalYawDeg: mountActual.yawDeg,
      captureHeld: droneHeldCapture(),
      isCapturing: sequence.isCapturing(),
      capturePhase: sequence.phase(),
      nodeIndex: sequence.nodeIndex(),
      nodeCount: sequence.nodeCount(),
      blocked: lastView && lastView.rendererMode !== "webgpu" ? "360° capture requires WebGPU." : null,
      error: droneRefusal(),
      paused: lastView?.paused ?? true,
      stillBusy: stillBusy || pendingStill,
    });
  }
}

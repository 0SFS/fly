import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ChoiceTrack } from "foss-earth/shell";
import {
  firstEvent, PROTOCOLS, replay, sampleLoads, type LoadProtocol, type ReplayResult, type ResponseEventKind,
} from "@0sfs/g-forces/responseTrace";
import { createPilotModel, PILOT_PARAMETER_IDS, readFlightPilotSettings, type FlightPilotSettings } from "../createFlightPilot";
import { readPhysicsHz } from "../physics/physicsRate";
import type { FlightParameterStore } from "../settings/flightParameters";
import "./gResponsePreview.css";

/**
 * G-forces → Pilot: what the chosen response does with a load over time. A
 * response with memory has no single curve of sight against load, so the
 * preview replays a short protocol from a rested pilot at +1 g, at the
 * physics rate the next flight runs, through a private pilot built as the
 * flight builds its own. The flight's pilot is never touched. A replay takes
 * well under a millisecond, so it runs on the edit that asks for it, and
 * nothing runs while the section is not shown.
 */

const PROTOCOL_CHOICES = [
  { id: "step", label: "Step", description: "The load from rest, held 15 s." },
  { id: "ramp", label: "Ramp", description: "The load reached at 0.5 g a second, held 10 s." },
  { id: "repeated", label: "Repeated", description: "Four 5 s pulls with 5 s at +1 g between them." },
  { id: "push-pull", label: "Push–pull", description: "−1 g for 3 s, then the load held 20 s." },
  { id: "unload", label: "Unload", description: "The load held 20 s, then back to +1 g over 4 s." },
] as const;
type PreviewProtocol = (typeof PROTOCOL_CHOICES)[number]["id"];

const LOAD_CHOICES = [
  { id: "5", label: "+5 g", shortLabel: "+5" },
  { id: "7", label: "+7 g", shortLabel: "+7" },
  { id: "9", label: "+9 g", shortLabel: "+9" },
  { id: "11", label: "+11 g", shortLabel: "+11 g" },
] as const;

/** Where the load starts in every protocol: one second at +1 g. */
const ONSET_SECONDS = 1;
/** The push before the pull in Push–pull. */
const PUSH_SECONDS = 3;

/** Seconds into the replay where the pull starts, which the events are counted from. */
const pullStart = (protocol: PreviewProtocol): number => ONSET_SECONDS + (protocol === "push-pull" ? PUSH_SECONDS : 0);

function previewProtocol(protocol: PreviewProtocol, g: number): LoadProtocol {
  switch (protocol) {
    case "step": return PROTOCOLS.sustained(g, 15);
    case "ramp": return PROTOCOLS.ramp(0.5, g, 10);
    case "repeated": return PROTOCOLS.repeated(5, g, 5, 4);
    case "push-pull": return PROTOCOLS.pushPull(-1, g, PUSH_SECONDS);
    case "unload": return PROTOCOLS.unload(4, g, 20);
  }
}

export interface PreviewTrace {
  protocol: LoadProtocol;
  hz: number;
  result: ReplayResult;
  seconds: number;
}

/** The private replay: passing out is followed whether or not it is on, at its mean time, so the markers show where it would come. */
function replayPreview(
  kind: Parameters<typeof createPilotModel>[0], settings: FlightPilotSettings, protocol: LoadProtocol, hz: number,
): PreviewTrace {
  const meanSeconds = settings.passOut?.meanSeconds ?? 11.9;
  const { model } = createPilotModel(kind, { ...settings, passOut: { meanSeconds, spreadSeconds: 0 } }, () => 0.5);
  const loads = sampleLoads(protocol, hz);
  // About four hundred points a line, whatever the rate.
  const result = replay(model, loads, 1 / hz, { recordEvery: Math.max(1, Math.round(loads.length / 400)) });
  return { protocol, hz, result, seconds: loads.length / hz };
}

const SHOWN_EVENTS: readonly [ResponseEventKind, string][] = [
  ["symptoms", "Sight starts to go"],
  ["vision-lost", "Sight lost"],
  ["unconscious", "LOC"],
  ["conscious", "Comes to"],
  ["vision-returned", "Sight back"],
];

const WIDTH = 320;
/** Room left of the plot for the strips' labels. */
const GUTTER = 30;
const G_TOP = 6;
const G_HEIGHT = 44;
const LOSS_TOP = 62;
const LOSS_HEIGHT = 56;
const AXIS_Y = 132;

function PreviewChart({ trace }: { trace: PreviewTrace }) {
  const record = trace.result.record!;
  const gs = Array.from(record.g);
  const gMax = Math.max(10, ...gs);
  const gMin = Math.min(-2, ...gs);
  const x = (seconds: number): number => GUTTER + (seconds / trace.seconds) * (WIDTH - GUTTER);
  const gy = (g: number): number => G_TOP + (gMax - g) / (gMax - gMin) * G_HEIGHT;
  const ly = (fraction: number): number => LOSS_TOP + (1 - fraction) * LOSS_HEIGHT;
  const line = (values: ArrayLike<number>, y: (value: number) => number): string =>
    Array.from(values, (value, index) => `${x(record.seconds[index]!).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.floor(trace.seconds / 10) + 1 }, (_, index) => index * 10);
  const markers = trace.result.events.filter(event => event.kind === "unconscious" || event.kind === "conscious");
  return (
    <svg className="flight-g-preview__chart" viewBox={`0 0 ${WIDTH} 144`} role="img"
      aria-label={`Load and sight over ${Math.round(trace.seconds)} s`}>
      <line className="flight-g-preview__rule" x1={GUTTER} x2={WIDTH} y1={gy(1)} y2={gy(1)} />
      <text className="flight-g-preview__axis" x={0} y={gy(1) + 3}>+1 g</text>
      <text className="flight-g-preview__axis" x={0} y={G_TOP + 6}>{`+${Math.round(gMax)} g`}</text>
      <polyline className="flight-g-preview__load" points={line(record.g, gy)} />
      <line className="flight-g-preview__rule" x1={GUTTER} x2={WIDTH} y1={ly(0)} y2={ly(0)} />
      <line className="flight-g-preview__rule" x1={GUTTER} x2={WIDTH} y1={ly(1)} y2={ly(1)} />
      <text className="flight-g-preview__axis" x={0} y={ly(1) + 3}>lost</text>
      <text className="flight-g-preview__axis" x={0} y={ly(0) + 3}>seen</text>
      <polyline className="flight-g-preview__peripheral" points={line(record.peripheralLoss, ly)} />
      <polyline className="flight-g-preview__central" points={line(record.centralLoss, ly)} />
      <polyline className="flight-g-preview__redout" points={line(record.redout, ly)} />
      {markers.map(event => <g key={`${event.kind}-${event.seconds}`}
        className={event.kind === "unconscious" ? "flight-g-preview__loc" : "flight-g-preview__awake"}>
        <line x1={x(event.seconds)} x2={x(event.seconds)} y1={G_TOP} y2={LOSS_TOP + LOSS_HEIGHT} />
        <text x={x(event.seconds) + 2} y={LOSS_TOP - 3}>{event.kind === "unconscious" ? "LOC" : "awake"}</text>
      </g>)}
      {ticks.map(seconds => <text key={seconds} className="flight-g-preview__axis" x={Math.min(x(seconds), WIDTH - 14)} y={AXIS_Y + 10}
        textAnchor="middle">{seconds === 0 ? "0 s" : seconds}</text>)}
    </svg>
  );
}

export function GResponsePreview({ parameters }: { parameters: FlightParameterStore }) {
  const [protocol, setProtocol] = useState<PreviewProtocol>("step");
  const [load, setLoad] = useState("9");
  // What the private pilot is built from, as one string, so an unrelated change does not replay.
  const watch = useCallback((onChange: () => void) => {
    const stops = (["osfs.gForce.response", "osfs.physics.rate", ...PILOT_PARAMETER_IDS] as const)
      .map(id => parameters.watch(id, onChange));
    return () => { for (const stop of stops) stop(); };
  }, [parameters]);
  const key = useSyncExternalStore(watch, () => JSON.stringify([
    parameters.get("osfs.gForce.response"), readPhysicsHz(parameters), readFlightPilotSettings(parameters),
  ]));
  const trace = useMemo(() => {
    const [kind, hz, settings] = JSON.parse(key) as [Parameters<typeof createPilotModel>[0], number, FlightPilotSettings];
    return replayPreview(kind, settings, previewProtocol(protocol, Number(load)), hz);
  }, [key, protocol, load]);
  const passOut = useSyncExternalStore(
    useCallback((onChange: () => void) => parameters.watch("osfs.gForce.passOut", onChange), [parameters]),
    () => parameters.get("osfs.gForce.passOut"),
  );
  const found = SHOWN_EVENTS.flatMap(([kind, label]) => {
    const event = firstEvent(trace.result, kind);
    return event ? [{ kind, label, seconds: event.seconds - pullStart(protocol) }] : [];
  }).sort((a, b) => a.seconds - b.seconds);
  // A pilot who is out sees black whatever their sight would be, so sight between going out and coming to is left out.
  const out = passOut ? found.find(event => event.kind === "unconscious") : undefined;
  const back = found.find(event => event.kind === "conscious");
  const events = found
    .filter(event => !out || event.seconds <= out.seconds || event.kind === "conscious" || (back !== undefined && event.seconds > back.seconds))
    .map(event => `${event.label} ${event.seconds.toFixed(1)} s`);
  return (
    <div className="flight-g-preview">
      <div className="flight-panel__row">
        <ChoiceTrack heading="Preview" value={protocol} defaultValue="step" choices={PROTOCOL_CHOICES}
          onChange={id => setProtocol(id as PreviewProtocol)}
          help={<p>
            A load protocol replayed through a rested pilot with the response and settings chosen above, at the
            physics rate of the next flight. The pilot in flight is not changed by it. A response with memory gives
            no single curve of sight against load: the same load does more after another.
          </p>} />
      </div>
      <div className="flight-panel__row">
        <ChoiceTrack heading="Load" value={load} defaultValue="9" choices={LOAD_CHOICES} onChange={setLoad} />
      </div>
      <PreviewChart trace={trace} />
      <p className="flight-g-preview__legend">
        <span className="flight-g-preview__key flight-g-preview__key--load">Load</span>
        <span className="flight-g-preview__key flight-g-preview__key--peripheral">Edges lost</span>
        <span className="flight-g-preview__key flight-g-preview__key--central">Centre lost</span>
        <span className="flight-g-preview__key flight-g-preview__key--redout">Red</span>
      </p>
      <p className="flight-panel__hint" data-preview-events>
        {trace.protocol.label} from rest at {trace.hz} Hz. {events.length ? `From the pull: ${events.join(" · ")}.` : "Sight is kept."}
        {!passOut && events.some(event => event.startsWith("LOC")) ? " With passing out off, the pilot keeps the controls." : ""}
      </p>
    </div>
  );
}

function useResponse(parameters: FlightParameterStore) {
  const watch = useCallback((onChange: () => void) => parameters.watch("osfs.gForce.response", onChange), [parameters]);
  return useSyncExternalStore(watch, () => parameters.get("osfs.gForce.response"));
}

/** G-forces → Vision: how the vignettes follow the load, in the chosen response. */
export function GVisionHint({ parameters }: { parameters: FlightParameterStore }) {
  return <p className="flight-panel__hint">
    A load that stays on takes the pilot's sight: black from the edges inward in a pull, red in a push.{" "}
    {useResponse(parameters) === "curve"
      ? "Each vignette starts at one end of its range and covers the view at the other, and follows the load over the onset and recovery times."
      : "How soon and how far the black closes follows the response chosen under Pilot; the redout range is every response's."}{" "}
    The aircraft flies the same.
  </p>;
}

/** G-forces → Passing out: when the pilot goes out and comes to, in the chosen response. */
export function PassOutHint({ parameters }: { parameters: FlightParameterStore }) {
  const curve = useResponse(parameters) === "curve";
  return <p className="flight-panel__hint">
    {curve
      ? "A pilot whose sight goes completely black loses consciousness: a load at or above the top of the blackout range, held for about three onset times."
      : "A pilot loses consciousness once the brain's reserve runs out: a load beyond what they bear, held for some seconds, sooner after another pull. They come to once it has refilled with the load off; a pull while recovering keeps them out."}{" "}
    While out, the screen is black in every view and the stick, pedals and brakes are let go.
    {curve ? " Each time out is drawn at random around the mean." : ""}
  </p>;
}

/** The flight's airport choice in FOSS Earth's Location tab: Departure or Arrival on a runway. */
import type { LocationContributionContext, LocationPanelContribution } from "foss-earth/windowing";
import type { AirportMode, FlightLocationHostData } from "./airportTypes";
import { airportSpawn } from "./airportGeometry";
import { flightLocationHostData } from "./flightLocationData";
import "./airportLocation.css";

const hostData = (context: Pick<LocationContributionContext, "hostData">): FlightLocationHostData => flightLocationHostData(context.hostData) ?? {};
const selectedRunway = ({ airport, runwayId }: FlightLocationHostData) => airport?.runways.find(item => item.id === runwayId);

/**
 * Selecting an airport result opens its runway choice instead of moving there;
 * Go then starts on the runway, paused, or on a 5 NM final. Any other result
 * moves as it does on the globe.
 */
export function createAirportLocationContribution(): LocationPanelContribution {
  // Moving to a place clears the panel's host data. The Departure/Arrival choice
  // was kept beside the form before, so the next airport opens in it again.
  let lastMode: AirportMode | undefined;
  const modeOf = (data: FlightLocationHostData) => data.airportMode ?? lastMode ?? "departure";
  return {
    resolveSelected: true,
    resolvingMessage: "Loading runway details…",
    select(result, context) {
      const current = hostData(context);
      const found = flightLocationHostData(result.hostData);
      if (!found?.airport) { lastMode = modeOf(current); return false; }
      const { airport } = found;
      context.setHostData({
        airport,
        airportMode: found.airportMode ?? modeOf(current),
        runwayId: current.airport?.code === airport.code && airport.runways.some(item => item.id === current.runwayId)
          ? current.runwayId : airport.runways[0]?.id ?? "",
      } satisfies FlightLocationHostData);
      context.setMessage(airport.runways.length ? "Choose departure or arrival and a runway, then Go." : "No usable runway data found. Enter coordinates manually instead.");
      return true;
    },
    apply(context) {
      const data = hostData(context);
      const { airport } = data;
      if (!airport) return false;
      const runway = selectedRunway(data);
      if (!runway) { context.setMessage("Choose a runway first."); return true; }
      const airportMode = modeOf(data);
      try { context.onApply(airportSpawn(runway, airportMode)); context.setMessage(`Moved to ${airport.code}, runway ${runway.label} ${airportMode}.`); }
      catch (error) { context.setMessage(error instanceof Error ? error.message : "Unable to apply airport location."); }
      return true;
    },
    render(context) {
      const data = hostData(context);
      const { airport } = data;
      if (!airport) return null;
      const airportMode = modeOf(data);
      const runway = selectedRunway(data);
      const update = (change: FlightLocationHostData) => { context.cancelResolution(); context.setHostData({ ...data, airportMode, ...change }); };
      return <div className="foss-earth-airport-controls">
        <strong>{airport.code} · {airport.name}</strong>
        <label>Position<select aria-label="Airport position" value={airportMode} onChange={event => update({ airportMode: event.target.value as AirportMode })}>
          <option value="departure">Departure</option><option value="arrival">Arrival</option>
        </select></label>
        <label>Runway<select aria-label="Runway" value={data.runwayId ?? ""} onChange={event => update({ runwayId: event.target.value })}>
          {airport.runways.map(item => <option key={item.id} value={item.id}>{item.label} · {Math.round(item.lengthMeters)} m</option>)}
        </select></label>
        <p>{airportMode === "departure" ? "On runway, paused. Resume when ready for takeoff." : "5 NM final · 3° approach."}</p>
        {runway && runway.elevationMeters === undefined && <p>Runway elevation unavailable.</p>}
        <button type="button" onClick={() => {
          context.cancelResolution();
          lastMode = airportMode;
          context.setHostData(airportMode === "arrival" ? { airportMode } : undefined);
          context.setMessage("");
        }}>Enter coordinates instead</button>
        <p>Airport data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · <a href="https://freeairportdb.com" target="_blank" rel="noreferrer">FreeAirportDB</a></p>
      </div>;
    },
    hideCoordinates: value => !!flightLocationHostData(value)?.airport,
    blocked(value) {
      const data = flightLocationHostData(value);
      if (!data?.airport) return false;
      const runway = selectedRunway(data);
      return !runway || runway.elevationMeters === undefined;
    },
  };
}

import { useState } from "react";
import { ChoiceTrack } from "foss-earth/shell";
import { browserDeviceLocation } from "foss-earth/cameraMath";
import { LocationPanel, type GeodeticLocation } from "foss-earth/windowing";
import { getAircraftDefinition } from "@0sfs/aircraft/aircraftCatalog";
import { AIRCRAFT_IDS, type AircraftId } from "@0sfs/aircraft/aircraftIds";
import type { FlightLocation, FlightLocationPanel } from "../location/flightLocation";
import { createFlightLocationDraft, flightLocationCodec } from "../location/flightLocationData";
import { createAirportLocationContribution } from "../location/airportLocationContribution";
import type { InvitationStart } from "./invitationStart";

export interface InvitationStartControlsProps {
  aircraftId: AircraftId;
  initialLocation: GeodeticLocation;
  searchProvider?: FlightLocationPanel["searchProvider"];
  onChange(start: InvitationStart): void;
}
const choices = [{ id: "off", label: "Off" }, { id: "on", label: "On" }];
const noObservation = () => () => {};

/** Reuses the Location tab's editor and flight runway contribution, with a private draft. */
export function InvitationStartControls(props: InvitationStartControlsProps) {
  const [aircraftOn, setAircraftOn] = useState(false);
  const [locationOn, setLocationOn] = useState(false);
  const [aircraftId, setAircraftId] = useState(props.aircraftId);
  const [location, setLocation] = useState<FlightLocation>(props.initialLocation);
  const [draft] = useState(() => {
    const values = new Map<string, string>();
    return createFlightLocationDraft({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
  });
  const [contribution] = useState(createAirportLocationContribution);
  const [deviceLocation] = useState(() => browserDeviceLocation(navigator.geolocation));
  const change = (aircraft: boolean, place: boolean, id = aircraftId, point = location) => {
    props.onChange({ ...(aircraft ? { aircraftId: id } : {}), ...(place ? { location: point } : {}) });
  };
  return <div className="multiplayer-start">
    <div className="multiplayer-start__group">
      <ChoiceTrack heading="Set aircraft" choices={choices} value={aircraftOn ? "on" : "off"} defaultValue="off"
        onChange={value => { const enabled = value === "on"; setAircraftOn(enabled); change(enabled, locationOn); }} />
      {aircraftOn && <label>Aircraft <select className="flight-panel__select" aria-label="Invited aircraft" value={aircraftId} onChange={event => {
        const id = event.target.value as AircraftId; setAircraftId(id); change(true, locationOn, id);
      }}>{AIRCRAFT_IDS.map(id => <option key={id} value={id}>{getAircraftDefinition(id).label}</option>)}</select></label>}
    </div>
    <div className="multiplayer-start__group">
      <ChoiceTrack heading="Set location" choices={choices} value={locationOn ? "on" : "off"} defaultValue="off"
        onChange={value => { const enabled = value === "on"; setLocationOn(enabled); change(aircraftOn, enabled); }} />
      {locationOn && <>
        <p className="flight-panel__hint">Guest start: {location.latDeg.toFixed(5)}, {location.lonDeg.toFixed(5)}. Go updates the invitation.</p>
        <LocationPanel initialLocation={location} observeLocation={noObservation} deviceLocation={deviceLocation}
          onApply={point => { setLocation(point); change(aircraftOn, true, aircraftId, point); }}
          searchProvider={props.searchProvider as Parameters<typeof LocationPanel>[0]["searchProvider"]}
          draft={draft} contribution={contribution} hostDataCodec={flightLocationCodec}
          createAbortController={() => new AbortController()}
          searchAttribution={<span>Places: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>; airports: <a href="https://www.freeairportdb.com/" target="_blank" rel="noreferrer">FreeAirportDB</a></span>} />
      </>}
    </div>
  </div>;
}

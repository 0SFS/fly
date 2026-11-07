import { useSyncExternalStore } from "react";
import { getSpaceSnapshot, subscribeSpaceSession } from "@0sfs/space/session";
import { requestMissionPlacement } from "./missionPlacement";

/** Bodies and missions that are installed on top of the space mod. */
export function SpaceTab() {
  const space = useSyncExternalStore(subscribeSpaceSession, getSpaceSnapshot, getSpaceSnapshot);
  return (
    <div className="flight-panel__content">
      <p className="flight-panel__hint">Above 100 km the aircraft coasts under gravity. Engines do not push in space yet.</p>
      <section>
        <h3>Bodies</h3>
        {space.bodies.length === 0
          ? <p className="flight-panel__hint">Earth is the only body. Add a body mod to open another sphere of influence.</p>
          : <ul>{space.bodies.map(body => <li key={body.id}>{body.name}</li>)}</ul>}
      </section>
      <section>
        <h3>Missions</h3>
        {space.missions.length === 0
          ? <p className="flight-panel__hint">No mission is installed.</p>
          : space.missions.map(mission => {
            const phase = mission.phases.find(item => item.id === mission.activePhaseId);
            const missing = mission.missingBodyIds.join(", ");
            return (
              <article key={mission.id}>
                <h4>{mission.name}</h4>
                <p className="flight-panel__hint">{mission.summary}</p>
                {mission.active && mission.complete ? <p>Complete</p> : null}
                {mission.active && phase ? <p>{phase.label}</p> : null}
                {missing ? <p className="flight-panel__hint">Needs {missing}.</p> : null}
                <button type="button" disabled={missing.length > 0} onClick={() => requestMissionPlacement(mission.id)}>
                  Start {mission.name}
                </button>
              </article>
            );
          })}
      </section>
    </div>
  );
}

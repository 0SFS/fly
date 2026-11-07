type MissionPlacementHandler = (missionId: string) => void;

let handler: MissionPlacementHandler | null = null;

/** The flight registers the move. The Space tab only asks for it. */
export function registerMissionPlacement(next: MissionPlacementHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function requestMissionPlacement(missionId: string): void {
  handler?.(missionId);
}

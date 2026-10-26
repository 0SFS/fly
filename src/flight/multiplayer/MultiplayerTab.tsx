import { useEffect, useRef, useState } from "react";
export type MountMultiplayer = (host: HTMLElement) => () => void;

export function MultiplayerTab({ load }: { load(): Promise<MountMultiplayer> }) {
  const host = useRef<HTMLDivElement>(null);
  const [attempt, retry] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    let unmount: (() => void) | undefined;
    void load().then(mount => { if (current && host.current) unmount = mount(host.current); }, () => { if (current) setError(true); });
    return () => { current = false; unmount?.(); };
  }, [load, attempt]);
  return <div className="flight-panel__content">
    {error && <p role="status">Multiplayer could not load. <button type="button" className="flight-panel__command" onClick={() => { setError(false); retry(value => value + 1); }}>Try again</button></p>}
    <div ref={host} />
  </div>;
}

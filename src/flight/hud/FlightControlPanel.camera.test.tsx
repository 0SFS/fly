// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WindowOverlayProps } from 'foss-earth/shell';
import { createSettingsRegistry, FOSS_EARTH_PARAMETERS } from 'foss-earth/settings';
import { registerFlightSettings } from '../settings/registerFlightSettings';
import { FlightControlPanel, type FlightControlPanelSnapshot, type FlightPanelTab } from './FlightControlPanel';
const state = vi.hoisted(() => ({ open: true, tabs: [] as string[] }));
vi.mock('foss-earth/shell', async importOriginal => ({
  ...await importOriginal<typeof import('foss-earth/shell')>(),
  WindowOverlay: ({ additionalTabs = [], renderAdditionalTab }: WindowOverlayProps<FlightPanelTab>) => {
    state.tabs = additionalTabs.map(tab => tab.id);
    return <>{state.open && state.tabs.includes('camera') && renderAdditionalTab?.('camera')}</>;
  },
}));
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); state.open = true; });
describe('aircraft camera tab', () => {
  it('offers only an available camera panel and retains its element and commands across closing/reopening', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    const settings = createSettingsRegistry({ storage: null }); settings.register(FOSS_EARTH_PARAMETERS);
    const parameters = registerFlightSettings(settings);
    const props = { settings, parameters, snapshot: { aircraftId: 'cessna-172', lodId: 'auto' } as FlightControlPanelSnapshot,
      overlayApiRef: { current: null } } as Parameters<typeof FlightControlPanel>[0];
    const render = () => act(async () => root.render(<FlightControlPanel {...props} />));
    await render(); expect(state.tabs).not.toContain('camera');
    const element = document.createElement('section'), button = document.createElement('button');
    const command = vi.fn(); button.textContent = 'Capture'; button.addEventListener('click', command); element.append(button);
    props.cameraTab = element; await render(); expect(state.tabs).toContain('camera'); expect(element.isConnected).toBe(true);
    button.click(); expect(command).toHaveBeenCalledOnce();
    state.open = false; await render(); expect(element.isConnected).toBe(false);
    state.open = true; await render(); expect(host.contains(element)).toBe(true); button.click(); expect(command).toHaveBeenCalledTimes(2);
    props.cameraTab = undefined; await render(); expect(state.tabs).not.toContain('camera'); expect(element.isConnected).toBe(false);
  });
});

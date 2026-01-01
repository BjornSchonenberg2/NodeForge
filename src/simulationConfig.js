// src/simulationConfig.js

// CRA will copy this ZIP into the build output and give you a URL string.
import autoZipUrl from "./data/simulations/golander.zip";

/**
 * autoSimulation:
 *  - false: do nothing
 *  - true: import autoSimulationZipUrl
 *  - string: import that URL (or relative path)
 */
export const simulationConfig = {
    showUI: true,
    autoSimulation: false,
    autoSimulationZipUrl: autoZipUrl,
};

export function resolveAutoSimulationZipUrl(cfg = simulationConfig) {
    if (!cfg?.autoSimulation) return null;

    const raw =
        typeof cfg.autoSimulation === "string"
            ? cfg.autoSimulation
            : cfg.autoSimulationZipUrl;

    if (!raw) return null;

    // refuse Windows file paths
    if (/^[a-zA-Z]:\\/.test(raw)) return null;

    // raw might already be absolute (from import). If it's relative, make it absolute.
    return new URL(raw, window.location.origin).href;
}

// src/simulationConfig.js

/**
 * autoSimulation:
 *  - false: do nothing
 *  - true: import autoSimulationZipUrl
 *  - string: import that URL (or relative path)
 */
export const simulationConfig = {
    showUI: false,
    autoSimulation: true,
    autoSimulationZipUrl: "./data/simulations/burgercase.zip",
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
    if (/^(data:|blob:|https?:)/i.test(raw)) return raw;

    const envBase = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
    const runtimeBase = (() => {
        if (typeof window === "undefined") return "";
        try {
            const url = new URL(".", window.location.href);
            const path = String(url.pathname || "").replace(/\/+$/, "");
            return path === "/" ? "" : path;
        } catch {
            const path = String(window.location?.pathname || "").replace(/\/+$/, "");
            return path === "/" ? "" : path;
        }
    })();

    const basePath = envBase || runtimeBase || "";
    let next = raw;

    if (next.startsWith("/")) {
        if (basePath && !next.startsWith(`${basePath}/`) && next !== basePath) {
            next = `${basePath}${next}`;
        }
        return new URL(next, window.location.origin).href;
    }

    if (basePath) {
        const clean = next.replace(/^\/+/, "");
        return new URL(`${basePath}/${clean}`, window.location.origin).href;
    }

    return new URL(next, window.location.origin).href;
}

export function buildAutoSimulationZipCandidates(cfg = simulationConfig) {
    if (!cfg?.autoSimulation) return [];

    const raw =
        typeof cfg.autoSimulation === "string"
            ? cfg.autoSimulation
            : cfg.autoSimulationZipUrl;

    if (!raw) return [];
    if (/^[a-zA-Z]:\\/.test(raw)) return [];
    if (/^(data:|blob:|https?:)/i.test(raw)) return [raw];

    const normalize = (p) => String(p || "").replace(/\\/g, "/");

    const envBase = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
    const runtimeBase = (() => {
        if (typeof window === "undefined") return "";
        try {
            const url = new URL(".", window.location.href);
            const path = String(url.pathname || "").replace(/\/+$/, "");
            return path === "/" ? "" : path;
        } catch {
            const path = String(window.location?.pathname || "").replace(/\/+$/, "");
            return path === "/" ? "" : path;
        }
    })();
    const basePath = envBase || runtimeBase || "";

    const rawNorm = normalize(raw);
    const list = [];
    const add = (v) => {
        if (!v) return;
        if (!list.includes(v)) list.push(v);
    };

    const stripBase = (v) => {
        if (!basePath) return v;
        if (v === basePath) return "/";
        if (v.startsWith(`${basePath}/`)) return v.slice(basePath.length);
        return v;
    };

    if (rawNorm.startsWith("/")) {
        add(rawNorm);
        if (basePath && !rawNorm.startsWith(`${basePath}/`) && rawNorm !== basePath) {
            add(`${basePath}${rawNorm}`);
        }
        const stripped = stripBase(rawNorm);
        if (stripped !== rawNorm) add(stripped);
    } else {
        add(rawNorm);
        add(`/${rawNorm}`);
        if (basePath) {
            const clean = rawNorm.replace(/^\/+/, "");
            add(`${basePath}/${clean}`);
        }
        if (basePath && rawNorm.startsWith(`${basePath}/`)) {
            add(rawNorm.slice(basePath.length));
        }
    }

    if (typeof window === "undefined") return list;

    const abs = [];
    list.forEach((v) => {
        if (/^(data:|blob:|https?:)/i.test(v)) {
            if (!abs.includes(v)) abs.push(v);
            return;
        }
        try {
            const u = new URL(v, window.location.origin).href;
            if (!abs.includes(u)) abs.push(u);
        } catch {
            // ignore malformed candidate
        }
    });

    return abs;
}

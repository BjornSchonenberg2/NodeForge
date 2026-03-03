// src/data/pictures/registry.js
// Local, offline picture registry.
//
// Goals:
// - Work in CRA (react-scripts) via webpack require.context
// - Also work in Vite if you ever migrate (import.meta.glob)
// - Always return a *string URL* for each image (never a module object)
// - Provide DEBUG counters expected by the Pictures UI
//
// IMPORTANT:
// Browsers cannot load Windows paths like "C:\\...".
// Pictures must be bundled (under src/) so webpack/vite can serve them.

/* eslint-disable no-undef */

const isImageFile = (p) => /\.(png|jpe?g|webp|gif|svg)$/i.test(String(p || ""));
const basename = (p) => {
    const s = String(p || "");
    const parts = s.split(/[\\/]/).filter(Boolean);
    return (parts[parts.length - 1] || s).replace(/^\.\//, "");
};

// Extract a usable URL string from whatever the bundler returns.
function unwrapAssetUrl(mod) {
    if (!mod) return "";
    if (typeof mod === "string") return mod;
    if (typeof URL !== "undefined" && mod instanceof URL) return mod.href;

    // Common shapes from bundlers/loaders.
    if (typeof mod === "object") {
        const candidates = [
            mod,
            mod.default,
            mod.src,
            mod.url,
            mod.href,
            mod?.default?.src,
            mod?.default?.url,
            mod?.default?.href,
            mod?.default?.default,
        ];
        for (const c of candidates) {
            if (!c) continue;
            if (typeof c === "string") return c;
            if (typeof URL !== "undefined" && c instanceof URL) return c.href;
        }
    }

    try {
        const s = String(mod);
        if (s && s !== "[object Module]" && s !== "[object Object]") return s;
    } catch {
        // ignore
    }
    return "";
}

// --- Webpack (CRA) discovery ---
let webpackKeys = [];
let webpackEntries = [];
try {
    const ctx = require.context("./", true, /\.(png|jpe?g|webp|gif|svg)$/i);
    webpackKeys = ctx.keys().filter((k) => isImageFile(k));
    webpackEntries = webpackKeys
        .map((k) => {
            let mod = null;
            try {
                mod = ctx(k);
            } catch {
                mod = null;
            }
            const src = unwrapAssetUrl(mod);
            const rel = String(k).replace(/^\.\//, "");
            return { key: rel, name: basename(rel), path: rel, src };
        })
        .filter((e) => !!e.src);
} catch {
    webpackKeys = [];
    webpackEntries = [];
}

// --- Vite discovery (optional) ---
let viteKeys = [];
let viteEntries = [];
try {
    // import.meta is only defined in Vite/Esm contexts.
    // We use eager glob to get URLs at build time.
    // eslint-disable-next-line no-new-func
    const hasImportMeta = Function("try { return typeof import.meta !== 'undefined'; } catch { return false; }")();
    if (hasImportMeta) {
        // eslint-disable-next-line no-new-func
        const glob = Function(
            "return import.meta.glob('./**/*.{png,jpg,jpeg,webp,gif,svg}', { eager: true, as: 'url' });"
        )();
        if (glob && typeof glob === "object") {
            viteKeys = Object.keys(glob);
            viteEntries = viteKeys
                .map((k) => {
                    const rel = String(k).replace(/^\.\//, "").replace(/^\.\//, "");
                    const src = unwrapAssetUrl(glob[k]);
                    return { key: basename(rel), name: basename(rel), path: rel, src };
                })
                .filter((e) => !!e.src);
        }
    }
} catch {
    viteKeys = [];
    viteEntries = [];
}

// Prefer webpack list when available (CRA), otherwise use vite.
const combined = (webpackEntries.length ? webpackEntries : viteEntries)
    .map((e) => ({
        ...e,
        // For compatibility: key should be a stable filename.
        key: basename(e.key || e.path || e.name),
        name: basename(e.name || e.key || e.path),
    }))
    .filter((e) => !!e.key && !!e.src && isImageFile(e.key));

// De-dupe by key.
const map = new Map();
for (const e of combined) {
    if (!map.has(e.key)) map.set(e.key, e);
}

export const LOCAL_PICTURES = Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
export const LOCAL_PICTURE_MAP = Object.fromEntries(LOCAL_PICTURES.map((p) => [p.key, p.src]));

export function resolveLocalPictureSrc(localKey) {
    if (!localKey) return "";
    const k = basename(localKey);
    return LOCAL_PICTURE_MAP[k] || "";
}

// Debug object used by the UI (keep these field names).
export const LOCAL_PICTURES_DEBUG = {
    mode: webpackEntries.length ? "webpack" : (viteEntries.length ? "vite" : "none"),
    webpackCount: webpackKeys.length,
    webpackSample: webpackKeys.map((k) => basename(k)).slice(0, 10),
    viteCount: viteKeys.length,
    resolvedCount: LOCAL_PICTURES.length,
    sample: LOCAL_PICTURES.slice(0, 10).map((x) => ({ key: x.key, src: x.src })),
};

// src/data/models/registry.js
// Auto-discover .glb/.gltf models under THIS folder (src/data/models) and subfolders.

// eslint-disable-next-line no-undef
const ctx = require.context("./", true, /\.(glb|gltf)$/i);

const pretty = (p) =>
    p
        .replace(/^\.\//, "")
        .replace(/\.(glb|gltf)$/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());

const toUrl = (mod) => {
    if (!mod) return "";
    return typeof mod === "string" ? mod : (mod.default || "");
};

const files = ctx.keys().sort();

export const STATIC_MODELS = files.map((k, i) => {
    const url = toUrl(ctx(k));
    const type = k.toLowerCase().endsWith(".gltf") ? "gltf" : "glb";
    return {
        id: `auto-${i}`,
        name: pretty(k),
        type,
        url,
    };
});

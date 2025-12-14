// src/data/models/registry.js
// Auto-discover .glb/.gltf in *this folder and subfolders*.
const ctx = require.context("./", true, /\.(glb|gltf)$/i);

const pretty = (p) =>
    p
        .replace(/^.\//, "")                 // ./sub/Boat.glb -> sub/Boat.glb
        .replace(/\.(glb|gltf)$/i, "")       // remove extension
        .replace(/[_-]+/g, " ")              // underscores -> spaces
        .replace(/\b\w/g, (m) => m.toUpperCase()); // capitalize words

const files = ctx.keys().sort();         // deterministic order

export const STATIC_MODELS = files.map((k, i) => {
    const url = ctx(k);                    // bundler gives a runtime URL
    const type = k.toLowerCase().endsWith(".gltf") ? "gltf" : "glb";
    return {
        id: `auto-${i}`,
        name: pretty(k),                     // e.g. "Sub/Boat"
        type,
        url,
    };
});

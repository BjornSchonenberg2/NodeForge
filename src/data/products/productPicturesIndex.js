// src/data/products/productPicturesIndex.js
// ---------------------------------------------------------------------------
// Product pictures indexer (Bundled + Disk).
//
// WHY THIS FILE EXISTS:
//   In a browser build you can't read C:\ paths. So we "bundle-index" files under
//   src/data/products/productPictures/** using the bundler.
//   - CRA/Webpack: require.context (MUST be called with literal args)
//   - Vite: import.meta.glob (MUST be a direct call with literal pattern)
//   - Electron: optional disk scan via fs
// ---------------------------------------------------------------------------

export function hasFs() {
  try { return !!(window?.require?.("fs")); } catch { return false; }
}

function normalizeSep(p) {
  return String(p || "").replace(/\\/g, "/");
}

function node(name) {
  return { name, dirs: {}, files: [] };
}

function addPath(root, relPath, file) {
  const parts = normalizeSep(relPath).split("/").filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    cur.dirs[seg] ||= node(seg);
    cur = cur.dirs[seg];
  }
  cur.files.push(file);
}

function unwrapAsset(mod) {
  if (typeof mod === "string") return mod;
  if (mod && typeof mod === "object" && typeof mod.default === "string") return mod.default;
  return String(mod || "");
}

function fileUrlFromAbs(absPath) {
  const p = normalizeSep(absPath);
  if (/^[A-Za-z]:\//.test(p)) return `file:///${p}`; // Windows drive
  return `file://${p}`;
}

/**
 * Bundled (browser) index:
 * - Vite: import.meta.glob
 * - Webpack: require.context
 */
export function buildBundledProductPicturesIndex() {
  // 1) Vite branch
  try {
    if (typeof import.meta !== "undefined" && typeof import.meta.glob === "function") {
      // Keep pattern literal. Include uppercase because your repo contains .JPG.
      const modules = import.meta.glob(
          "./productPictures/**/*.{png,jpg,jpeg,webp,gif,PNG,JPG,JPEG,WEBP,GIF}",
          { eager: true, import: "default" }
      );

      const root = node("");
      const byRef = new Map();
      const keys = Object.keys(modules || {}).slice().sort();

      for (const k of keys) {
        const rel = normalizeSep(k).replace(/^\.\/productPictures\//, "");
        const ref = `@pp/${rel}`;
        const url = unwrapAsset(modules[k]);
        const file = { name: rel.split("/").pop(), rel, ref, url };
        byRef.set(ref, file);
        addPath(root, rel, file);
      }

      return { mode: "bundled", method: "vite-glob", root, byRef, count: keys.length, error: null };
    }
  } catch {
    // fallthrough to webpack
  }

  // 2) CRA/Webpack branch
  try {
    // IMPORTANT: These arguments MUST be literals for Webpack to transform it.
    // Do NOT replace the regex with a variable.
    const ctx = require.context("./productPictures", true, /\.(png|jpe?g|webp|gif)$/i);
    const root = node("");
    const byRef = new Map();
    const keys = ctx.keys().slice().sort();

    for (const k of keys) {
      const rel = normalizeSep(k).replace(/^\.\//, "");
      const ref = `@pp/${rel}`;
      const url = unwrapAsset(ctx(k));
      const file = { name: rel.split("/").pop(), rel, ref, url };
      byRef.set(ref, file);
      addPath(root, rel, file);
    }

    return { mode: "bundled", method: "webpack-context", root, byRef, count: keys.length, error: null };
  } catch (e) {
    return {
      mode: "bundled",
      method: "none",
      root: node(""),
      byRef: new Map(),
      count: 0,
      error: "Bundled index failed. If you're on CRA/Webpack this usually means require.context wasn't transformed.",
    };
  }
}

/**
 * Disk index (Electron / NW):
 * Scans an absolute folder with fs.
 */
export function buildDiskProductPicturesIndex(absRootPath) {
  if (!hasFs()) return { mode: "disk", method: "fs-scan", root: node(""), byRef: new Map(), count: 0, error: "fs unavailable" };
  const fs = window.require("fs");
  const path = window.require("path");

  const root = node("");
  const byRef = new Map();

  function walk(dirAbs, relBase) {
    let entries = [];
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dirAbs, ent.name);
      const rel = normalizeSep(path.join(relBase, ent.name));
      if (ent.isDirectory()) walk(full, rel);
      else if (/\.(png|jpe?g|webp|gif)$/i.test(ent.name)) {
        const ref = `@pp/${rel}`;
        const url = fileUrlFromAbs(full);
        const file = { name: ent.name, rel, ref, url };
        byRef.set(ref, file);
        addPath(root, rel, file);
      }
    }
  }

  try { walk(absRootPath, ""); } catch {}
  return { mode: "disk", method: "fs-scan", root, byRef, count: byRef.size, error: null };
}

export function resolvePictureRef(ref, bundledIndex, diskIndex) {
  const r = String(ref || "");
  if (!r) return "";
  if (r.startsWith("data:") || r.startsWith("blob:") || r.startsWith("http://") || r.startsWith("https://") || r.startsWith("file://")) return r;

  if (r.startsWith("@pp/")) {
    const hit = (diskIndex?.byRef?.get?.(r)) || (bundledIndex?.byRef?.get?.(r));
    return hit?.url || "";
  }

  if (r.startsWith("@media/")) {
    if (!hasFs()) return "";
    const path = window.require("path");
    const base = process.cwd();
    const abs = path.join(base, r.replace(/^@media\//, "data/media/"));
    return fileUrlFromAbs(abs);
  }

  return r;
}

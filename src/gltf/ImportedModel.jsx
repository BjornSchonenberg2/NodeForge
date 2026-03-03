// src/gltf/ImportedModel.jsx
import React, { memo, useEffect, useMemo, useRef } from "react";
import { Html, Center } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTFResilient } from "./useGLTFResilient.js";

/**
 * ImportedModel.jsx — sampler-safe with textures by default
 *
 * - Default "leanPBR" mode shows textures and keeps ≤ 3 samplers/material:
 *     map (base-color), normalMap, roughnessMap
 *   (metalness is left as a scalar; env/ao omitted to avoid GPU cap)
 *
 * - Optional "safe" mode (MeshBasicMaterial) if you ever hit a hard GPU limit.
 *
 * Wireframe overlays/wipes/shadow toggles are preserved.
 */

// ---------------- Tunables ----------------
const DETAIL_THRESH = { low: 85, medium: 55, med: 55, high: 25 };
const PREWARM_DETAIL = "high";
const DETAIL_ALIASES = {
  ultra: "full",
  full: "full",
  triangles: "full",
  tri: "full",
  bbox: "bbox",
  bounds: "bbox",
  box: "bbox",
  medium: "med",
};

function normalizeWireDetail(rawDetail, edgeAngle) {
  const token = String(rawDetail || "high").toLowerCase();
  const mapped = DETAIL_ALIASES[token] || token;
  if (mapped === "full") return { mode: "full", key: "full" };
  if (mapped === "bbox") return { mode: "bbox", key: "bbox" };

  const detail = DETAIL_THRESH[mapped] != null ? mapped : "high";
  const angle =
      typeof edgeAngle === "number" && Number.isFinite(edgeAngle)
          ? Math.max(0, Math.min(180, edgeAngle))
          : null;
  const threshold = angle != null ? angle : DETAIL_THRESH[detail] ?? DETAIL_THRESH.high;
  const key = angle != null ? `${detail}:${Math.round(angle * 10) / 10}` : detail;
  return { mode: "edges", key, threshold };
}

// Easing
const easeInOutQuint = (t) =>
    t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const progress = (now, t0, delayMs, durMs) =>
    Math.max(0, Math.min(1, (now - (t0 + delayMs)) / Math.max(1, durMs)));

// ---------------- Shared caches/materials ----------------
const EDGE_CACHE = new WeakMap();

const SHARED_LINE_MATERIAL = new THREE.LineBasicMaterial({
  transparent: true,
  opacity: 1,
  depthTest: true,
  depthWrite: false,
  toneMapped: false,
});

function ensureStrokeAttrib(geom) {
  if (!geom?.attributes?.aU) {
    const vCount = geom.getAttribute("position")?.count || 0;
    const a = new Float32Array(vCount);
    for (let i = 0; i < vCount; i += 2) {
      a[i] = 0;
      a[i + 1] = 1;
    }
    geom.setAttribute("aU", new THREE.BufferAttribute(a, 1));
  }
}

let SHARED_LINE_STROKE = null;
function getStrokeMat(baseColor, baseOpacity, uDraw, uFeather, mask = {}) {
  if (!SHARED_LINE_STROKE) {
    SHARED_LINE_STROKE = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color("#ffffff") },
        uOpacity: { value: 1 },
        uDraw: { value: 0 },
        uFeather: { value: 0.08 },
        uMin: { value: 0 },
        uMax: { value: 1 },
        uAxis: { value: 0 },
        uDir: { value: 1 },
        uInvert: { value: 0 },
      },
      vertexShader: `
        attribute float aU;
        varying float vU;
        varying vec3 vWorld;
        void main() {
          vU = aU;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uDraw;
        uniform float uFeather;
        uniform float uMin, uMax, uAxis, uDir, uInvert;
        varying float vU;
        varying vec3 vWorld;
        float maskVal(){
          float v = (uAxis < 0.5) ? vWorld.x : ((uAxis < 1.5) ? vWorld.y : vWorld.z);
          float t = clamp((v - uMin) / max(uMax - uMin, 1e-5), 0.0, 1.0);
          float edge = (uDir > 0.0) ? uDraw : (1.0 - uDraw);
          float m = smoothstep(edge - uFeather, edge, t);
          return (uInvert > 0.5) ? (1.0 - m) : m;
        }
        void main() {
          float m = maskVal();
          gl_FragColor = vec4(uColor, uOpacity * m);
        }
      `,
    });
  }
  SHARED_LINE_STROKE.uniforms.uColor.value.set(baseColor);
  SHARED_LINE_STROKE.uniforms.uOpacity.value = THREE.MathUtils.clamp(
      baseOpacity ?? 1,
      0,
      1
  );
  SHARED_LINE_STROKE.uniforms.uDraw.value = THREE.MathUtils.clamp(
      uDraw ?? 0,
      0,
      1
  );
  SHARED_LINE_STROKE.uniforms.uFeather.value = uFeather ?? 0.08;

  const { min = 0, max = 1, axis = 0, dir = 1, invert = 0 } = mask || {};
  SHARED_LINE_STROKE.uniforms.uMin.value = min;
  SHARED_LINE_STROKE.uniforms.uMax.value = max;
  SHARED_LINE_STROKE.uniforms.uAxis.value = axis;
  SHARED_LINE_STROKE.uniforms.uDir.value = dir;
  SHARED_LINE_STROKE.uniforms.uInvert.value = invert ? 1 : 0;

  SHARED_LINE_STROKE.needsUpdate = true;
  return SHARED_LINE_STROKE;
}

// ---------------- Wipe helpers ----------------
function axisDirFrom(mode) {
  const m = String(mode || "lr").toLowerCase();
  if (m === "lr") return { axis: 0, dir: +1 };
  if (m === "rl") return { axis: 0, dir: -1 };
  if (m === "tb") return { axis: 1, dir: +1 };
  if (m === "bt") return { axis: 1, dir: -1 };
  if (m === "fb") return { axis: 2, dir: +1 };
  if (m === "bf") return { axis: 2, dir: -1 };
  return { axis: 0, dir: +1 };
}
const NOOP = () => {};

function injectSurfaceMaskFade(material, params) {
  if (!material) return;
  material.userData ||= {};
  const ud = material.userData;

  if (!ud.__oldOnBeforeCompile) {
    const prev = material.onBeforeCompile;
    ud.__oldOnBeforeCompile = typeof prev === "function" ? prev : NOOP;
  }
  if (!ud.__oldCustomKey) {
    const prevKey = material.customProgramCacheKey;
    ud.__oldCustomKey = typeof prevKey === "function" ? prevKey : null;
  }

  ud.__fadeVersion = (ud.__fadeVersion || 0) + 1;
  const version = ud.__fadeVersion;

  material.transparent = true;
  material.depthWrite = false;

  material.onBeforeCompile = (shader) => {
    const prev = material.userData.__oldOnBeforeCompile;
    if (typeof prev === "function") prev(shader);

    shader.uniforms.uMin = { value: params.min };
    shader.uniforms.uMax = { value: params.max };
    shader.uniforms.uAxis = { value: params.axis };
    shader.uniforms.uDir = { value: params.dir };
    shader.uniforms.uProg = { value: params.prog || 0 };
    shader.uniforms.uFeather = { value: params.feather ?? 0.08 };
    shader.uniforms.uInvert = { value: params.invert ? 1 : 0 };

    shader.vertexShader =
        "varying vec3 vWorld;\n" +
        shader.vertexShader.replace(
            "void main() {",
            "void main(){ vWorld = (modelMatrix * vec4(position,1.0)).xyz;"
        );

    const header = `
      varying vec3 vWorld;
      uniform float uMin, uMax, uAxis, uDir, uProg, uFeather, uInvert;
      float maskVal(){
        float v = (uAxis < 0.5) ? vWorld.x : ((uAxis < 1.5) ? vWorld.y : vWorld.z);
        float t = clamp((v - uMin) / max(uMax - uMin, 1e-5), 0.0, 1.0);
        float edge = (uDir > 0.0) ? uProg : (1.0 - uProg);
        float m = smoothstep(edge - uFeather, edge, t);
        return (uInvert > 0.5) ? (1.0 - m) : m;
      }
    `;
    shader.fragmentShader = header + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\n  gl_FragColor.a *= clamp(maskVal(), 0.0, 1.0);"
    );

    ud.__fadeUniforms = shader.uniforms;
  };

  const oldKey = ud.__oldCustomKey;
  material.customProgramCacheKey = function () {
    let base = "";
    try {
      base = oldKey ? oldKey.call(this) || "" : "";
    } catch (_) {
      base = "";
    }
    return (
        base +
        `|wfmask:v=${version},axis=${params.axis},dir=${params.dir},inv=${
            params.invert ? 1 : 0
        },feather=${params.feather ?? 0.08}`
    );
  };

  material.needsUpdate = true;
}
function updateSurfaceMaskProgress(material, p) {
  const u = material?.userData?.__fadeUniforms;
  if (u && u.uProg) u.uProg.value = p;
}
function clearSurfaceMaskFade(material) {
  if (!material || !material.userData) return;
  const ud = material.userData;
  const prev = ud.__oldOnBeforeCompile;
  material.onBeforeCompile = typeof prev === "function" ? prev : NOOP;

  const oldKey = ud.__oldCustomKey;
  material.customProgramCacheKey =
      typeof oldKey === "function" ? oldKey : () => "";

  delete ud.__fadeUniforms;
  delete ud.__oldOnBeforeCompile;
  delete ud.__oldCustomKey;

  material.needsUpdate = true;
}

// ---------------- Scene traversal & overlays ----------------
const matsOf = (mesh) =>
    mesh.material
        ? Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
        : [];

function wfCache(mesh) {
  mesh.userData.__wf ||= { overlays: Object.create(null), snapshot: null };
  return mesh.userData.__wf;
}
function snapshotMaterials(mesh) {
  const cache = wfCache(mesh);
  if (cache.snapshot) return;
  cache.snapshot = matsOf(mesh).map((m) => ({
    ref: m,
    visible: m.visible ?? true,
    transparent: m.transparent,
    opacity: m.opacity,
    depthWrite: m.depthWrite,
    colorWrite: m.colorWrite ?? true,
    wireframe: m.wireframe,
  }));
  cache.baseMaterials = mesh.material;
  cache.frustumCulled = mesh.frustumCulled;
}
function restoreMaterials(mesh) {
  const cache = mesh.userData.__wf;
  if (!cache?.snapshot) return;
  if (cache.baseMaterials) {
    mesh.material = cache.baseMaterials;
  }
  if (cache.frustumCulled !== undefined) {
    mesh.frustumCulled = cache.frustumCulled;
  }
  for (const s of cache.snapshot) {
    const m = s.ref;
    if (!m) continue;
    if (m.visible !== undefined) m.visible = s.visible;
    if (m.colorWrite !== undefined) m.colorWrite = s.colorWrite;
    m.transparent = s.transparent;
    m.opacity = s.opacity;
    m.depthWrite = s.depthWrite;
    m.wireframe = s.wireframe;
    clearSurfaceMaskFade(m);
    m.needsUpdate = true;
  }
}

function getWireframeMaterial(orig, opacity = 1) {
  const c = orig?.color ? orig.color.clone() : new THREE.Color(0xffffff);
  const m = new THREE.MeshBasicMaterial({
    color: c,
    transparent: true,
    opacity: THREE.MathUtils.clamp(opacity ?? 1, 0, 1),
    depthWrite: false,
    wireframe: true,
    toneMapped: false,
  });
  return m;
}

function ensureWireframeMaterials(mesh, opacity) {
  const cache = wfCache(mesh);
  if (!cache.wireMats) cache.wireMats = new WeakMap();
  const mats = matsOf(mesh);
  const out = mats.map((m) => {
    if (cache.wireMats.has(m)) {
      const wm = cache.wireMats.get(m);
      if (wm?.opacity !== undefined) wm.opacity = THREE.MathUtils.clamp(opacity ?? 1, 0, 1);
      return wm;
    }
    const wm = getWireframeMaterial(m, opacity);
    cache.wireMats.set(m, wm);
    return wm;
  });
  return Array.isArray(mesh.material) ? out : out[0];
}

function setWireframeOpacity(mesh, opacity) {
  const cache = mesh.userData?.__wf;
  const wireMap = cache?.wireMats;
  if (!wireMap) return;
  const base = cache?.baseMaterials;
  const baseArr = Array.isArray(base) ? base : base ? [base] : [];
  const o = THREE.MathUtils.clamp(opacity ?? 1, 0, 1);
  baseArr.forEach((m) => {
    const wm = wireMap.get?.(m);
    if (wm) {
      wm.opacity = o;
      wm.transparent = o < 0.999;
      wm.depthWrite = false;
      wm.needsUpdate = true;
    }
  });
}

function ensureFullDrawRange(geom) {
  if (!geom || !geom.isBufferGeometry) return;
  const count = geom.index ? geom.index.count : geom.attributes?.position?.count;
  if (!Number.isFinite(count) || count <= 0) return;
  geom.setDrawRange(0, count);
  if (!geom.boundingSphere) {
    try {
      geom.computeBoundingSphere?.();
    } catch {}
  }
}
function showBaseMaterials(mesh) {
  for (const m of matsOf(mesh)) {
    m.visible = true;
    if (m.colorWrite !== undefined) m.colorWrite = true;
    m.depthWrite = true;
    m.needsUpdate = true;
  }
}
function hideBaseMaterials(mesh) {
  for (const m of matsOf(mesh)) {
    m.visible = false;
    if (m.colorWrite !== undefined) m.colorWrite = false;
    m.depthWrite = false;
    if (m.wireframe) m.wireframe = false;
    m.needsUpdate = true;
  }
}
function traverseMeshes(root, fn) {
  root.traverse((o) => {
    if ((o.isMesh || o.isSkinnedMesh) && o.geometry && o.material) fn(o);
  });
}

// ---------------- Material strategies ----------------

// Heuristic to find a base-color texture even if it isn't on ".map"
const BASE_MAP_KEYS = [
  "map",
  "baseMap",
  "baseColorMap",
  "albedoMap",
  "diffuseMap",
  "colorMap",
];
function findBaseMap(mat) {
  for (const k of BASE_MAP_KEYS) {
    const tex = mat?.[k];
    if (tex && tex.isTexture) return tex;
  }
  // as a last resort, scan properties:
  for (const k of Object.keys(mat || {})) {
    const v = mat[k];
    if (v && v.isTexture && /map/i.test(k) && !/normal|rough|metal|ao|env|spec/i.test(k)) {
      return v;
    }
  }
  return null;
}

function ensureBaseColorVisible(mat, hasMap) {
  if (!hasMap || !mat?.color?.isColor) return;
  const c = mat.color;
  if ((c.r + c.g + c.b) < 0.02) c.set(0xffffff);
}

function isUnlitMaterial(orig) {
  if (!orig) return false;
  if (orig.isMeshBasicMaterial) return true;
  const ext = orig.userData?.gltfExtensions;
  return !!(ext && (ext.KHR_materials_unlit || ext.KHR_materials_unlit === {}));
}

// SAFE: MeshBasicMaterial (albedo only)
function makeBasicFrom(orig) {
  const mat = new THREE.MeshBasicMaterial({
    name: (orig && orig.name) || "",
    color: orig?.color ? orig.color.clone() : new THREE.Color(0xffffff),
    map: findBaseMap(orig) || orig?.emissiveMap || null,
    side: orig?.side ?? THREE.FrontSide,
    transparent: !!orig?.transparent,
    opacity: typeof orig?.opacity === "number" ? orig.opacity : 1,
    alphaTest: typeof orig?.alphaTest === "number" ? orig.alphaTest : 0,
  });
  ensureBaseColorVisible(mat, !!mat.map);
  return mat;
}
function forceUltraLeanMaterials(root) {
  traverseMeshes(root, (o) => {
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    const lean = arr.map((m) => {
      const mat = makeBasicFrom(m);
      mat.alphaMap = null;
      mat.envMap = null;
      mat.needsUpdate = true;

      // make sure texture is rendered as sRGB if it's an albedo
      if (mat.map && mat.map.colorSpace !== THREE.SRGBColorSpace) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.needsUpdate = true;
      }
      return mat;
    });
    o.material = Array.isArray(o.material) ? lean : lean[0];
    o.castShadow = false;
    o.receiveShadow = false;
  });
}

// LEAN PBR: keep ≤ 3 maps (map, normal, roughness)
function rebuildStandardFrom(matLike) {
  const m = new THREE.MeshStandardMaterial();
  m.color.copy(matLike.color || new THREE.Color(0xffffff));
  m.roughness = typeof matLike.roughness === "number" ? matLike.roughness : 1.0;
  m.metalness = typeof matLike.metalness === "number" ? matLike.metalness : 0.0;
  m.transparent = !!matLike.transparent;
  m.opacity = typeof matLike.opacity === "number" ? matLike.opacity : 1.0;
  m.side = matLike.side ?? THREE.FrontSide;
  m.alphaTest = matLike.alphaTest ?? 0;
  if (matLike.normalScale) m.normalScale = matLike.normalScale.clone();
  // IMPORTANT: drop env to save a sampler
  m.envMap = null;
  return m;
}
function dietSceneLeanPBR(root) {
  traverseMeshes(root, (o) => {
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    const lean = arr.map((orig) => {
      if (isUnlitMaterial(orig)) {
        const basic = makeBasicFrom(orig);
        basic.needsUpdate = true;
        return basic;
      }

      const base =
          orig.isMeshStandardMaterial
              ? orig
              : orig.isMeshPhysicalMaterial
                  ? (() => {
                    const tmp = new THREE.MeshStandardMaterial();
                    tmp.copy(orig);
                    return tmp;
                  })()
                  : orig;

      const m = rebuildStandardFrom(base);

      // Try to keep base-color map even if it's not in .map
      const baseMap = base.map || findBaseMap(base) || null;
      const emissiveMap = base.emissiveMap || null;
      const normalMap = base.normalMap || null;
      const roughnessMap = base.roughnessMap || null;

      // Assign up to 3 textures in priority order
      let used = 0;
      if (baseMap || emissiveMap) {
        m.map = baseMap || emissiveMap;
        if (m.map && m.map.colorSpace !== THREE.SRGBColorSpace) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.needsUpdate = true;
        }
        used++;
      }
      if (!baseMap && emissiveMap) {
        m.emissiveMap = emissiveMap;
        if (m.emissive?.isColor) m.emissive.set(0xffffff);
        m.emissiveIntensity = Math.max(1, Number(base?.emissiveIntensity ?? 1) || 1);
      }
      ensureBaseColorVisible(m, !!(baseMap || emissiveMap));
      // Avoid backface culling issues on models with flipped winding
      m.side = THREE.DoubleSide;
      // Do not let global env lighting affect model materials
      m.envMap = null;
      if (typeof m.envMapIntensity === "number") m.envMapIntensity = 0;
      // If there's no alpha usage, keep it opaque to avoid blending artifacts
      if (!m.alphaMap && (!m.transparent || m.opacity >= 1)) {
        m.transparent = false;
        if (typeof m.opacity === "number") m.opacity = 1;
      }
      if (base?.vertexColors) {
        m.vertexColors = true;
        if (m.color?.isColor) m.color.set(0xffffff);
      }
      if (baseMap && typeof m.opacity === "number" && m.opacity <= 0.01) {
        m.opacity = 1;
        m.transparent = false;
        if (typeof m.alphaTest === "number") m.alphaTest = 0;
      }
      if (normalMap && used < 3) {
        m.normalMap = normalMap;
        used++;
      }
      if (roughnessMap && used < 3) {
        m.roughnessMap = roughnessMap;
        used++;
      }

      m.needsUpdate = true;
      return m;
    });
    o.material = Array.isArray(o.material) ? lean : lean[0];

    // Allow model shadows if the parent prop enables them (they don't add samplers to the material)
    // You can flip these to false if you still hit sampler pressure in extreme scenes.
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

function applyEnvlessMetalFix(root) {
  traverseMeshes(root, (o) => {
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    arr.forEach((m) => {
      if (!m || !m.isMeshStandardMaterial) return;
      const hasBaseMap = !!findBaseMap(m);
      const hasMetal = !!m.metalnessMap || (typeof m.metalness === "number" && m.metalness > 0.15);
      if (!hasBaseMap || !hasMetal) return;
      m.metalnessMap = null;
      m.metalness = 0;
      if (typeof m.roughness === "number") m.roughness = Math.max(m.roughness, 0.85);
      m.needsUpdate = true;
    });
  });
}
// ---------- Wireframe overlay helpers (missing defs) ----------
function getEdgesGeometry(srcGeom, detail) {
  let entry = EDGE_CACHE.get(srcGeom);
  if (!entry) {
    entry = { edges: Object.create(null), wire: null, bbox: null };
    EDGE_CACHE.set(srcGeom, entry);
  }
  const vertCount = srcGeom.getAttribute("position")?.count || 0;
  const maxVerts = 800000;
  if (vertCount > maxVerts) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[ImportedModel] Skip wireframe; geometry too large", { vertCount });
    }
    return null;
  }
  if (detail.mode === "full") {
    if (!entry.wire) {
      try {
        const wire = new THREE.WireframeGeometry(srcGeom);
        wire.computeBoundingSphere?.();
        wire.computeBoundingBox?.();
        entry.wire = wire;
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ImportedModel] WireframeGeometry failed", err);
        }
        return null;
      }
    }
    return entry.wire;
  }
  if (detail.mode === "bbox") {
    if (!entry.bbox) {
      srcGeom.computeBoundingBox?.();
      const box = srcGeom.boundingBox;
      if (!box) {
        if (!entry.wire) {
          const wire = new THREE.WireframeGeometry(srcGeom);
          wire.computeBoundingSphere?.();
          wire.computeBoundingBox?.();
          entry.wire = wire;
        }
        return entry.wire;
      }
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const sx = Math.max(0.0001, size.x);
      const sy = Math.max(0.0001, size.y);
      const sz = Math.max(0.0001, size.z);
      const boxGeom = new THREE.BoxGeometry(sx, sy, sz);
      boxGeom.translate(center.x, center.y, center.z);
      try {
        const eg = new THREE.EdgesGeometry(boxGeom, 1);
        eg.computeBoundingSphere?.();
        eg.computeBoundingBox?.();
        entry.bbox = eg;
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ImportedModel] EdgesGeometry bbox failed", err);
        }
        return null;
      } finally {
        boxGeom.dispose?.();
      }
    }
    return entry.bbox;
  }

  if (!entry.edges[detail.key]) {
    const t = detail.threshold ?? DETAIL_THRESH.high;
    try {
      const eg = new THREE.EdgesGeometry(srcGeom, t);
      eg.computeBoundingSphere?.();
      eg.computeBoundingBox?.();
      entry.edges[detail.key] = eg;
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[ImportedModel] EdgesGeometry failed", err);
      }
      return null;
    }
  }
  return entry.edges[detail.key];
}

function ensureOverlay(mesh, detail) {
  const cache = wfCache(mesh);
  const detailKey = detail.key || "high";
  let overlay = cache.overlays[detailKey];
  if (!overlay) {
    const geom = getEdgesGeometry(mesh.geometry, detail);
    if (!geom) return null;
    overlay = new THREE.LineSegments(geom, SHARED_LINE_MATERIAL);
    const max = geom.index ? geom.index.count : geom.attributes.position.count;
    overlay.userData._reveal = { now: Math.floor(max * 0.25), max };
    geom.setDrawRange(0, overlay.userData._reveal.now);
    overlay.name = "wireOverlay";
    overlay.renderOrder = 2;
    overlay.frustumCulled = true;
    overlay.raycast = () => null;
    mesh.add(overlay);
    cache.overlays[detailKey] = overlay;
  }
  return overlay;
}

function showOnlyOverlay(mesh, detail, visible) {
  const cache = wfCache(mesh);
  if (!cache) return;
  for (const k of Object.keys(cache.overlays)) {
    const ls = cache.overlays[k];
    if (ls) ls.visible = visible && k === detail;
  }
}

function disposeOverlays(mesh) {
  const cache = mesh.userData.__wf;
  if (!cache) return;
  for (const k of Object.keys(cache.overlays)) {
    const ls = cache.overlays[k];
    if (ls) ls.removeFromParent();
  }
  cache.overlays = Object.create(null);
}

const idle = (cb) =>
    window.requestIdleCallback
        ? window.requestIdleCallback(cb, { timeout: 60 })
        : setTimeout(() => cb({ timeRemaining: () => 0 }), 0);

function prewarmEdges(scene, detail = PREWARM_DETAIL, edgeAngle = null) {
  const detailCfg = normalizeWireDetail(detail, edgeAngle);
  const geoms = new Set();
  traverseMeshes(scene, (m) => geoms.add(m.geometry));
  const arr = Array.from(geoms);
  (function step(i = 0) {
    if (i >= arr.length) return;
    idle(() => {
      getEdgesGeometry(arr[i], detailCfg);
      step(i + 1);
    });
  })();
}

// ---------------- Component ----------------
export default memo(function ImportedModel({
                                             descriptor,
                                             wireframe = false,
                                             wireOpacity = 1,
                                             wireDetail = "high",
                                             wireEdgeAngle = null,
                                             enableShadows = false,
                                             wireStroke = null,
                                             shadingMode = "leanPBR", // DEFAULT: show textures; set "safe" to force unlit fallback
                                             onScene,
                                           }) {
  const rafRef = useRef(0);
  const cycleRef = useRef(0);
  const last = useRef({ enabled: undefined, detail: undefined });
  const isWebGPU = useThree((s) => s.gl?.isWebGPURenderer);
  const sceneEnv = useThree((s) => s.scene?.environment);
  const invalidate = useThree((s) => s.invalidate);

  // keep line opacity synced
  useMemo(() => {
    const o = THREE.MathUtils.clamp(wireOpacity ?? 1, 0, 1);
    SHARED_LINE_MATERIAL.opacity = o;
    if (SHARED_LINE_STROKE) {
      SHARED_LINE_STROKE.uniforms.uOpacity.value = o;
      SHARED_LINE_STROKE.needsUpdate = true;
    }
    SHARED_LINE_MATERIAL.needsUpdate = true;
    return null;
  }, [wireOpacity]);

  const { gltf, error } = useGLTFResilient(descriptor, (loaded) => {
    // ---- MATERIAL STRATEGY ----
    if (shadingMode === "safe") {
      forceUltraLeanMaterials(loaded);
    } else {
      dietSceneLeanPBR(loaded);
    }

    // No env lighting can make metal materials render black.
    if (!sceneEnv) {
      applyEnvlessMetalFix(loaded);
    }

    // Respect external shadow toggle (for scene lights).
    loaded.traverse((mesh) => {
      if (mesh.isMesh || mesh.isSkinnedMesh) {
        mesh.castShadow = !!enableShadows;
        mesh.receiveShadow = !!enableShadows;
      }
    });

    onScene && onScene(loaded);
  });

  // WebGPU: make sure all geometry draw ranges + bounds are valid before any wireframe swap.
  useEffect(() => {
    if (!isWebGPU || !gltf?.scene) return;
    gltf.scene.traverse((mesh) => {
      if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.geometry) return;
      ensureFullDrawRange(mesh.geometry);
    });
  }, [isWebGPU, gltf?.scene]);

  // keep shadows toggled live
  useEffect(() => {
    if (!gltf?.scene) return;
    gltf.scene.traverse((mesh) => {
      if (mesh.isMesh || mesh.isSkinnedMesh) {
        mesh.castShadow = !!enableShadows;
        mesh.receiveShadow = !!enableShadows;
      }
    });
  }, [gltf?.scene, enableShadows]);

  // keep WebGPU wireframe opacity synced
  useEffect(() => {
    if (!isWebGPU || !gltf?.scene) return;
    const o = THREE.MathUtils.clamp(wireOpacity ?? 1, 0, 1);
    gltf.scene.traverse((mesh) => {
      if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
      setWireframeOpacity(mesh, o);
    });
  }, [isWebGPU, gltf?.scene, wireOpacity]);

  // wireframe animation block
  useEffect(() => {
    if (!gltf?.scene) return;

    const enabled = !!wireframe;
    const detailCfg = normalizeWireDetail(wireDetail, wireEdgeAngle);
    const detailKey = detailCfg.key;
    if (last.current.enabled === enabled && last.current.detail === detailKey) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const cycle = ++cycleRef.current;

    const cfg = (function normalize(ws) {
      const out = {
        enabled: false,
        mode: "lr",
        feather: 0.08,
        surfaceFeather: 0.08,
        durationIn: 1.1,
        durationOut: 0.95,
      };
      if (ws && typeof ws === "object") {
        if ("enabled" in ws) out.enabled = !!ws.enabled;
        else out.enabled = true;
        if (ws.mode) out.mode = String(ws.mode);
        if (typeof ws.feather === "number") out.feather = ws.feather;
        if (typeof ws.surfaceFeather === "number")
          out.surfaceFeather = ws.surfaceFeather;
        if (typeof ws.duration === "number")
          out.durationIn = out.durationOut = ws.duration;
        if (typeof ws.durationIn === "number") out.durationIn = ws.durationIn;
        if (typeof ws.durationOut === "number") out.durationOut = ws.durationOut;
      }
      out.durationIn = Math.max(0.08, out.durationIn);
      out.durationOut = Math.max(0.08, out.durationOut);
      out.feather = Math.min(0.25, Math.max(0, out.feather));
      out.surfaceFeather = Math.min(0.25, Math.max(0, out.surfaceFeather));
      return out;
    })(wireStroke);

    const { axis, dir } = axisDirFrom(cfg.mode);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const min = box.min.getComponent(axis);
    const max = box.max.getComponent(axis);

    const color =
        (SHARED_LINE_MATERIAL.color || new THREE.Color("#fff")).getStyle?.() ||
        "#ffffff";

    const startRAF = (fn) => {
      const loop = (now) => {
        if (cycle !== cycleRef.current) return;
        const cont = fn(now);
        invalidate();
        if (cont) rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    };

    // If we start in regular (non-wireframe) mode, don't animate from "fully hidden"
    // (the wireStroke reveal) on initial mount. That animation relies on having a
    // snapshot of original material flags; without it, surfaces can remain transparent.
    if (last.current.enabled === undefined && !enabled) {
      gltf.scene.traverse((mesh) => {
        if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
        // Ensure no stale injected shaders
        matsOf(mesh).forEach((m) => clearSurfaceMaskFade(m));
        // Ensure base surfaces render normally
        showBaseMaterials(mesh);
        // Hide overlays if any
        showOnlyOverlay(mesh, detailKey, false);
        // If a snapshot exists (e.g. hot-reload), restore it
        restoreMaterials(mesh);
      });
      last.current = { enabled, detail: detailKey };
      invalidate();
      return;
    }

    if (isWebGPU) {
      const startRAF = (fn) => {
        const loop = (now) => {
          if (cycle !== cycleRef.current) return;
          const cont = fn(now);
          invalidate();
          if (cont) rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      };

      gltf.scene.traverse((mesh) => {
        if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
        snapshotMaterials(mesh);
        ensureFullDrawRange(mesh.geometry);
        if (enabled) {
          const wireMats = ensureWireframeMaterials(mesh, 0);
          mesh.material = wireMats;
          setWireframeOpacity(mesh, 0);
          // Keep frustum culling on so off-screen model chunks do not consume GPU time.
          if (mesh.geometry && !mesh.geometry.boundingSphere && mesh.geometry.computeBoundingSphere) {
            mesh.geometry.computeBoundingSphere();
          }
          mesh.frustumCulled = true;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        } else {
          // keep wire mats in place during fade-out, restore after
        }
      });

      const durIn = Math.max(0.08, Number(wireStroke?.durationIn ?? 1.1) || 1.1) * 1000;
      const durOut = Math.max(0.08, Number(wireStroke?.durationOut ?? 0.95) || 0.95) * 1000;
      const target = THREE.MathUtils.clamp(wireOpacity ?? 1, 0, 1);
      const t0 = performance.now();

      if (enabled) {
        startRAF((now) => {
          const p = progress(now, t0, 0, durIn);
          const e = easeInOutQuint(p);
          gltf.scene.traverse((mesh) => {
            if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
            setWireframeOpacity(mesh, target * e);
          });
          if (p < 1) return true;
          return false;
        });
      } else {
        // Fade out wireframe, then restore materials
        startRAF((now) => {
          const p = progress(now, t0, 0, durOut);
          const e = easeInOutQuint(p);
          const a = target * (1 - e);
          gltf.scene.traverse((mesh) => {
            if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
            setWireframeOpacity(mesh, a);
          });
          if (p < 1) return true;
          gltf.scene.traverse((mesh) => {
            if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
            restoreMaterials(mesh);
            mesh.castShadow = !!enableShadows;
            mesh.receiveShadow = !!enableShadows;
          });
          return false;
        });
      }

      last.current = { enabled, detail: detailKey };
      invalidate();
      return;
    }

    if (enabled && cfg.enabled) {
      // Wireframe ON: fade OUT surfaces, draw IN lines
      gltf.scene.traverse((mesh) => {
        if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
        snapshotMaterials(mesh);
        showBaseMaterials(mesh);

        matsOf(mesh).forEach((m) =>
            injectSurfaceMaskFade(m, {
              axis,
              dir,
              min,
              max,
              prog: 0,
              feather: cfg.surfaceFeather,
              invert: 0,
            })
        );

        const ls = ensureOverlay(mesh, detailCfg);
        ensureStrokeAttrib(ls.geometry);
        const meta = ls.userData && ls.userData._reveal;
        if (meta && meta.now < meta.max) {
          meta.now = meta.max;
          ls.geometry.setDrawRange(0, meta.max);
        }
        ls.material = getStrokeMat(color, wireOpacity, 0, cfg.feather, {
          min,
          max,
          axis,
          dir,
          invert: 0,
        });
        showOnlyOverlay(mesh, detailKey, true);
      });

      const t0 = performance.now();
      const durSurf = cfg.durationIn * 1000;
      const durLine = cfg.durationIn * 1000;

      startRAF((now) => {
        const pSurf = progress(now, t0, 0, durSurf);
        const pLine = progress(now, t0, 100, durLine);
        const eSurf = easeInOutQuint(pSurf);
        const eLine = easeOutCubic(pLine);

        if (SHARED_LINE_STROKE) {
          SHARED_LINE_STROKE.uniforms.uDraw.value =
              dir > 0 ? 1.0 - eLine : eLine;
        }
        gltf.scene.traverse((mesh) => {
          if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
          matsOf(mesh).forEach((m) => updateSurfaceMaskProgress(m, eSurf));
        });

        if (pSurf < 1 || pLine < 1) return true;

        gltf.scene.traverse((mesh) => {
          if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
          hideBaseMaterials(mesh);
          matsOf(mesh).forEach((m) => clearSurfaceMaskFade(m));
          const ls = wfCache(mesh).overlays?.[detailKey];
          if (ls) ls.material = SHARED_LINE_MATERIAL;
        });
        return false;
      });
    } else if (!enabled && cfg.enabled) {
      // Wireframe OFF: undraw lines, fade IN surfaces
      gltf.scene.traverse((mesh) => {
        if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
        // Snapshot original flags the first time we ever fade surfaces back in.
        // Without this, restoreMaterials(...) can't undo transparent/depthWrite changes.
        snapshotMaterials(mesh);
        const ls = wfCache(mesh).overlays?.[detailKey] || ensureOverlay(mesh, detailCfg);
        ensureStrokeAttrib(ls.geometry);
        const meta = ls.userData && ls.userData._reveal;
        if (meta && meta.now < meta.max) {
          meta.now = meta.max;
          ls.geometry.setDrawRange(0, meta.max);
        }
        ls.material = getStrokeMat(color, wireOpacity, dir > 0 ? 0 : 1, cfg.feather, {
          min,
          max,
          axis,
          dir,
          invert: 0,
        });
        showOnlyOverlay(mesh, detailKey, true);

        showBaseMaterials(mesh);
        matsOf(mesh).forEach((m) =>
            injectSurfaceMaskFade(m, {
              axis,
              dir,
              min,
              max,
              prog: 0,
              feather: cfg.surfaceFeather,
              invert: 1,
            })
        );
      });

      const t0 = performance.now();
      const durLine = cfg.durationOut * 1000;
      const durSurf = cfg.durationOut * 1000;

      startRAF((now) => {
        const pLine = progress(now, t0, 0, durLine);
        const pSurf = progress(now, t0, 120, durSurf);
        const eLine = easeInOutQuint(pLine);
        const eSurf = easeOutCubic(pSurf);

        if (SHARED_LINE_STROKE) {
          SHARED_LINE_STROKE.uniforms.uDraw.value =
              dir > 0 ? eLine : 1.0 - eLine;
        }
        gltf.scene.traverse((mesh) => {
          if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
          matsOf(mesh).forEach((m) => updateSurfaceMaskProgress(m, eSurf));
        });

        if (pLine < 1 || pSurf < 1) return true;

        gltf.scene.traverse((mesh) => {
          if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
          showOnlyOverlay(mesh, detailKey, false);
          restoreMaterials(mesh);
        });
        return false;
      });
    } else {
      // Snap instantly
      if (enabled) {
        gltf.scene.traverse((mesh) => {
          if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
          snapshotMaterials(mesh);
          const ls = ensureOverlay(mesh, detailCfg);
          showOnlyOverlay(mesh, detailKey, true);
          hideBaseMaterials(mesh);
          ls.material = SHARED_LINE_MATERIAL;
        });
      } else {
        gltf.scene.traverse((mesh) => {
          if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
          showOnlyOverlay(mesh, detailKey, false);
          restoreMaterials(mesh);
        });
      }
    }

    last.current = { enabled, detail: detailKey };

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    gltf?.scene,
    wireframe,
    wireDetail,
    wireEdgeAngle,
    wireOpacity,
    wireStroke?.enabled,
    wireStroke?.mode,
    wireStroke?.duration,
    wireStroke?.durationIn,
    wireStroke?.durationOut,
    wireStroke?.feather,
    wireStroke?.surfaceFeather,
  ]);

  // keep line opacity synced if changed later
  useEffect(() => {
    const o = THREE.MathUtils.clamp(wireOpacity ?? 1, 0, 1);
    SHARED_LINE_MATERIAL.opacity = o;
    if (SHARED_LINE_STROKE) {
      SHARED_LINE_STROKE.uniforms.uOpacity.value = o;
      SHARED_LINE_STROKE.needsUpdate = true;
    }
    SHARED_LINE_MATERIAL.needsUpdate = true;
  }, [wireOpacity]);

  // overlay cleanup
  useEffect(() => {
    if (!gltf?.scene) return;
    const root = gltf.scene;

    return () => {
      traverseMeshes(root, (mesh) => {
        restoreMaterials(mesh);
        disposeOverlays(mesh);
      });
    };
  }, [gltf?.scene]);

  if (error) {
    return (
        <Html center>
          <div style={{ color: "#fff", textAlign: "center", maxWidth: 420 }}>
            Failed to load model.<br />
            {String(error?.message || error)}
            {descriptor?.url ? (
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8, wordBreak: "break-all" }}>
                  URL: {String(descriptor.url)}
                </div>
            ) : null}
          </div>
        </Html>
    );
  }
  if (!gltf) {
    return (
        <Html center>
          <span style={{ color: "#fff" }}>Loading model…</span>
        </Html>
    );
  }

  return (
      <Center disableY>
        <primitive object={gltf.scene} />
      </Center>
  );
});

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
}
function restoreMaterials(mesh) {
  const cache = mesh.userData.__wf;
  if (!cache?.snapshot) return;
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

// SAFE: MeshBasicMaterial (albedo only)
function makeBasicFrom(orig) {
  return new THREE.MeshBasicMaterial({
    name: (orig && orig.name) || "",
    color: orig?.color ? orig.color.clone() : new THREE.Color(0xffffff),
    map: findBaseMap(orig),
    side: orig?.side ?? THREE.FrontSide,
    transparent: !!orig?.transparent,
    opacity: typeof orig?.opacity === "number" ? orig.opacity : 1,
    alphaTest: typeof orig?.alphaTest === "number" ? orig.alphaTest : 0,
  });
}
function forceUltraLeanMaterials(root) {
  traverseMeshes(root, (o) => {
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    const lean = arr.map((m) => {
      const mat = makeBasicFrom(m);
      mat.alphaMap = null;
      mat.envMap = null;
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
            .replace(/#define USE_ENVMAP/g, "")
            .replace(/#ifdef USE_ENVMAP[\s\S]*?#endif/g, "");
      };
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
      const baseMap = base.map || findBaseMap(base);
      const normalMap = base.normalMap || null;
      const roughnessMap = base.roughnessMap || null;

      // Assign up to 3 textures in priority order
      let used = 0;
      if (baseMap) {
        m.map = baseMap;
        if (m.map.colorSpace !== THREE.SRGBColorSpace) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.needsUpdate = true;
        }
        used++;
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
// ---------- Wireframe overlay helpers (missing defs) ----------
function getEdgesGeometry(srcGeom, detail) {
  let entry = EDGE_CACHE.get(srcGeom);
  if (!entry) {
    entry = { edges: Object.create(null), wire: null };
    EDGE_CACHE.set(srcGeom, entry);
  }
  if (detail === "triangles" || detail === "full") {
    if (!entry.wire) {
      const wire = new THREE.WireframeGeometry(srcGeom);
      wire.computeBoundingSphere?.();
      wire.computeBoundingBox?.();
      entry.wire = wire;
    }
    return entry.wire;
  }
  if (!entry.edges[detail]) {
    const t = DETAIL_THRESH[detail] ?? DETAIL_THRESH.high;
    const eg = new THREE.EdgesGeometry(srcGeom, t);
    eg.computeBoundingSphere?.();
    eg.computeBoundingBox?.();
    entry.edges[detail] = eg;
  }
  return entry.edges[detail];
}

function ensureOverlay(mesh, detail) {
  const cache = wfCache(mesh);
  let overlay = cache.overlays[detail];
  if (!overlay) {
    const geom = getEdgesGeometry(mesh.geometry, detail);
    overlay = new THREE.LineSegments(geom, SHARED_LINE_MATERIAL);
    const max = geom.index ? geom.index.count : geom.attributes.position.count;
    overlay.userData._reveal = { now: Math.floor(max * 0.25), max };
    geom.setDrawRange(0, overlay.userData._reveal.now);
    overlay.name = "wireOverlay";
    overlay.renderOrder = 2;
    overlay.frustumCulled = true;
    overlay.raycast = () => null;
    mesh.add(overlay);
    cache.overlays[detail] = overlay;
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

function prewarmEdges(scene, detail = PREWARM_DETAIL) {
  const geoms = new Set();
  traverseMeshes(scene, (m) => geoms.add(m.geometry));
  const arr = Array.from(geoms);
  (function step(i = 0) {
    if (i >= arr.length) return;
    idle(() => {
      getEdgesGeometry(arr[i], detail);
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
                                             enableShadows = false,
                                             wireStroke = {
                                               enabled: true,
                                               mode: "lr",
                                               durationIn: 1.1,
                                               durationOut: 0.95,
                                               feather: 0.08,
                                               surfaceFeather: 0.08,
                                             },
                                             shadingMode = "leanPBR", // DEFAULT: show textures; set "safe" to force unlit fallback
                                             onScene,
                                           }) {
  const rafRef = useRef(0);
  const cycleRef = useRef(0);
  const last = useRef({ enabled: undefined, detail: undefined });
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

    // Respect external shadow toggle (for scene lights).
    loaded.traverse((mesh) => {
      if (mesh.isMesh || mesh.isSkinnedMesh) {
        mesh.castShadow = !!enableShadows;
        mesh.receiveShadow = !!enableShadows;
      }
    });

    prewarmEdges(loaded, PREWARM_DETAIL);
    onScene && onScene(loaded);
  });

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

  // wireframe animation block
  useEffect(() => {
    if (!gltf?.scene) return;

    const enabled = !!wireframe;
    const detail = String(wireDetail || "high").toLowerCase();
    if (last.current.enabled === enabled && last.current.detail === detail) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const cycle = ++cycleRef.current;

    const cfg = (function normalize(ws) {
      const out = {
        enabled: true,
        mode: "lr",
        feather: 0.08,
        surfaceFeather: 0.08,
        durationIn: 1.1,
        durationOut: 0.95,
      };
      if (ws && typeof ws === "object") {
        if ("enabled" in ws) out.enabled = !!ws.enabled;
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

        const ls = ensureOverlay(mesh, detail);
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
        showOnlyOverlay(mesh, detail, true);
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
          const ls = wfCache(mesh).overlays?.[detail];
          if (ls) ls.material = SHARED_LINE_MATERIAL;
        });
        return false;
      });
    } else if (!enabled && cfg.enabled) {
      // Wireframe OFF: undraw lines, fade IN surfaces
      gltf.scene.traverse((mesh) => {
        if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
        const ls = wfCache(mesh).overlays?.[detail] || ensureOverlay(mesh, detail);
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
        showOnlyOverlay(mesh, detail, true);

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
          showOnlyOverlay(mesh, detail, false);
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
          const ls = ensureOverlay(mesh, detail);
          showOnlyOverlay(mesh, detail, true);
          hideBaseMaterials(mesh);
          ls.material = SHARED_LINE_MATERIAL;
        });
      } else {
        gltf.scene.traverse((mesh) => {
          if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.material) return;
          showOnlyOverlay(mesh, detail, false);
          restoreMaterials(mesh);
        });
      }
    }

    last.current = { enabled, detail };

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    gltf?.scene,
    wireframe,
    wireDetail,
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

  // overlay reveal prewarm & cleanup
  useEffect(() => {
    if (!gltf?.scene) return;
    const root = gltf.scene;
    let running = true;
    let raf = 0;

    const tick = () => {
      traverseMeshes(root, (mesh) => {
        const cache = wfCache(mesh);
        Object.values(cache.overlays).forEach((ls) => {
          const meta = ls?.userData?._reveal;
          if (meta && meta.now < meta.max) {
            meta.now = Math.min(meta.max, Math.floor(meta.now * 1.5) + 1024);
            ls.geometry.setDrawRange(0, meta.now);
          }
        });
      });
      if (running) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
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

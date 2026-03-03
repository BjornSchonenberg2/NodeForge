// ModelOptimizerLab.jsx
// Layout:
// - Left: big 3D viewport (Canvas)
// - Right: scrollable sidebar menu (all controls)
// Notes:
// - Wireframe is always ignored
// - Texture toggles reliably re-render (frameloop=demand + invalidate)

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { createRenderer, isWebGPUAvailable } from "./utils/webgpuRenderer.js";
import { ContactShadows, Environment, Grid, Html, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { SimplifyModifier } from "three/examples/jsm/modifiers/SimplifyModifier.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ------------------------ tiny utils ------------------------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function formatBytes(bytes) {
    if (bytes == null || !isFinite(bytes)) return "–";
    const kb = bytes / 1024;
    const mb = kb / 1024;
    if (mb >= 100) return `${mb.toFixed(0)} MB`;
    if (mb >= 10) return `${mb.toFixed(1)} MB`;
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    if (kb >= 10) return `${kb.toFixed(0)} KB`;
    return `${kb.toFixed(1)} KB`;
}

function downloadArrayBuffer(arrayBuffer, filename) {
    const blob = new Blob([arrayBuffer], { type: "model/gltf-binary" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function yieldToUI() {
    return new Promise((r) => requestAnimationFrame(() => r()));
}

function computeStats(scene) {
    const out = { meshes: 0, tris: 0, verts: 0, materials: 0, textures: 0 };
    if (!scene) return out;

    const mats = new Set();
    const texs = new Set();

    scene.traverse((obj) => {
        if (!(obj.isMesh || obj.isSkinnedMesh)) return;
        out.meshes += 1;

        const geo = obj.geometry;
        if (geo?.attributes?.position) {
            const pos = geo.attributes.position;
            out.verts += pos.count || 0;
            if (geo.index) out.tris += (geo.index.count / 3) | 0;
            else out.tris += ((pos.count || 0) / 3) | 0;
        }

        const ms = Array.isArray(obj.material) ? obj.material : [obj.material];
        ms.forEach((m) => {
            if (!m) return;
            mats.add(m);
            [
                m.map,
                m.normalMap,
                m.metalnessMap,
                m.roughnessMap,
                m.aoMap,
                m.emissiveMap,
                m.alphaMap,
                m.envMap,
            ].forEach((t) => t && texs.add(t));
        });
    });

    out.materials = mats.size;
    out.textures = texs.size;
    return out;
}

function computeBounds(scene) {
    const box = new THREE.Box3();
    if (!scene) return { box, size: new THREE.Vector3(), center: new THREE.Vector3() };
    box.setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    return { box, size, center };
}

function traverseMaterials(root, fn) {
    if (!root) return;
    root.traverse((obj) => {
        if (!(obj.isMesh || obj.isSkinnedMesh) || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m && fn(m, obj));
    });
}

function enforceNoWireframe(root) {
    traverseMaterials(root, (m) => {
        if ("wireframe" in m) m.wireframe = false;
    });
}

function deepCloneForEdit(source, originals) {
    const clone = source.clone(true);
    const geoMap = new Map();
    const matMap = new Map();
    const texMap = new Map();

    clone.traverse((obj) => {
        if (!(obj.isMesh || obj.isSkinnedMesh)) return;

        if (obj.geometry) {
            const g = obj.geometry;
            if (!geoMap.has(g)) geoMap.set(g, g.clone());
            obj.geometry = geoMap.get(g);
        }

        if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            const newMats = mats.map((m) => {
                if (!m) return m;
                if (!matMap.has(m)) {
                    const m2 = m.clone();
                    const props = [
                        "map",
                        "normalMap",
                        "metalnessMap",
                        "roughnessMap",
                        "aoMap",
                        "emissiveMap",
                        "alphaMap",
                        "envMap",
                    ];
                    const orig = (m?.userData && m.userData.__origMaps) || (originals && originals.get ? originals.get(m) : null);
                    props.forEach((p) => {
                        const t = (orig && orig[p]) || m2[p];
                        if (!t) return;
                        if (!texMap.has(t)) texMap.set(t, t.clone ? t.clone() : t);
                        m2[p] = texMap.get(t);
                    });
                    matMap.set(m, m2);
                }
                return matMap.get(m);
            });
            obj.material = Array.isArray(obj.material) ? newMats : newMats[0];
        }
    });

    return clone;
}

function stripAttributes(geometry, opts) {
    if (!geometry?.attributes) return;
    if (opts.stripVertexColors && geometry.attributes.color) geometry.deleteAttribute("color");
    if (opts.stripTangents && geometry.attributes.tangent) geometry.deleteAttribute("tangent");
    if (opts.stripUV2 && geometry.attributes.uv2) geometry.deleteAttribute("uv2");
    if (opts.stripNormals && geometry.attributes.normal) {
        geometry.deleteAttribute("normal");
        geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}

function restoreOriginalMaps(root, originals) {
    if (!root) return;
    traverseMaterials(root, (m) => {
        const orig = (m?.userData && m.userData.__origMaps) || (originals && originals.get ? originals.get(m) : null);
        if (!orig) return;
        if (orig.map) {
            m.map = orig.map;
            if (m.map && m.map.colorSpace !== THREE.SRGBColorSpace) {
                m.map.colorSpace = THREE.SRGBColorSpace;
            }
        }
        if (orig.normalMap) m.normalMap = orig.normalMap;
        if (orig.metalnessMap) m.metalnessMap = orig.metalnessMap;
        if (orig.roughnessMap) m.roughnessMap = orig.roughnessMap;
        if (orig.aoMap) m.aoMap = orig.aoMap;
        if (orig.emissiveMap) m.emissiveMap = orig.emissiveMap;
        if (orig.alphaMap) m.alphaMap = orig.alphaMap;
        if (m.color && m.color.isColor && orig.map) m.color.set(0xffffff);
        if (m.metalnessMap == null && typeof m.metalness === "number") m.metalness = 0;
        if (m.roughnessMap == null && typeof m.roughness === "number") m.roughness = 1;
        m.needsUpdate = true;
    });
}

function forceUnlitMaterials(root) {
    if (!root) return;
    const matMap = new Map();
    root.traverse((obj) => {
        if (!(obj.isMesh || obj.isSkinnedMesh) || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        const next = mats.map((m) => {
            if (!m) return m;
            if (matMap.has(m)) return matMap.get(m);
            const baseMap = m.map || null;
            if (baseMap && baseMap.colorSpace && baseMap.colorSpace !== THREE.SRGBColorSpace) {
                baseMap.colorSpace = THREE.SRGBColorSpace;
                baseMap.needsUpdate = true;
            }
            const baseColor = (m.color && m.color.isColor) ? m.color.clone() : new THREE.Color(0xffffff);
            const mat = new THREE.MeshBasicMaterial({
                color: baseColor,
                map: baseMap || null,
                transparent: false,
                opacity: 1,
                depthWrite: true,
                side: THREE.DoubleSide,
            });
            matMap.set(m, mat);
            return mat;
        });
        obj.material = Array.isArray(obj.material) ? next : next[0];
    });
}



function applyNodeForgeSafeExport(root) {
    if (!root) return;
    const matMap = new Map();
    root.traverse((obj) => {
        if (!(obj.isMesh || obj.isSkinnedMesh) || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        const next = mats.map((m) => {
            if (!m) return m;
            if (matMap.has(m)) return matMap.get(m);
            const baseMap = m.map || m.emissiveMap || null;
            if (baseMap && baseMap.colorSpace && baseMap.colorSpace !== THREE.SRGBColorSpace) {
                baseMap.colorSpace = THREE.SRGBColorSpace;
                baseMap.needsUpdate = true;
            }
            const mat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: baseMap || null,
                metalness: 0,
                roughness: 1,
                transparent: false,
                opacity: 1,
                depthWrite: true,
                side: THREE.DoubleSide,
            });
            matMap.set(m, mat);
            return mat;
        });
        obj.material = Array.isArray(obj.material) ? next : next[0];
        const geo = obj.geometry;
        if (geo?.attributes?.color) geo.deleteAttribute("color");
    });
}

function normalizeTextureTransforms(root) {
    if (!root) return;
    const texProps = ["map", "normalMap", "metalnessMap", "roughnessMap", "aoMap", "emissiveMap", "alphaMap"];
    traverseMaterials(root, (m) => {
        texProps.forEach((p) => {
            const t = m[p];
            if (!t) return;
            try { if (!t.offset || typeof t.offset.toArray !== "function") t.offset = new THREE.Vector2(0, 0); } catch {}
            try { if (!t.repeat || typeof t.repeat.toArray !== "function") t.repeat = new THREE.Vector2(1, 1); } catch {}
            try { if (!t.center || typeof t.center.toArray !== "function") t.center = new THREE.Vector2(0, 0); } catch {}
            if (typeof t.rotation !== "number" || !isFinite(t.rotation)) t.rotation = 0;
        });
    });
}

function applyVisibilityFix(root) {
    if (!root) return;
    traverseMaterials(root, (m) => {
        const hasMap = !!m.map || !!m.emissiveMap;
        if (hasMap && m.color?.isColor) {
            const c = m.color;
            if ((c.r + c.g + c.b) < 0.02) c.set(0xffffff);
        }
        if (hasMap && typeof m.opacity === "number" && m.opacity <= 0.01) {
            m.opacity = 1;
            m.transparent = false;
        }
        if (typeof m.alphaTest === "number" && m.alphaTest >= 0.95) m.alphaTest = 0;

        if ("metalness" in m) {
            if (!m.metalnessMap && typeof m.metalness === "number" && m.metalness > 0.4) {
                m.metalness = 0;
            }
            if (!m.roughnessMap && typeof m.roughness === "number") {
                m.roughness = Math.max(m.roughness, 0.85);
            }
        }
        m.needsUpdate = true;
    });
}

function stripMaterialMaps(material, opts) {
    if (opts.stripBaseColor) material.map = null;
    if (opts.stripNormalMaps) material.normalMap = null;
    if (opts.stripMetalRoughMaps) {
        material.metalnessMap = null;
        material.roughnessMap = null;
        if (typeof material.metalness === "number") material.metalness = 0;
        if (typeof material.roughness === "number") material.roughness = 1;
        if (material.map && material.color?.isColor) material.color.set(0xffffff);
    }
    if (opts.stripAOMaps) material.aoMap = null;
    if (opts.stripEmissiveMaps) material.emissiveMap = null;
    if (opts.stripAlphaMaps) {
        material.alphaMap = null;
        if (material.transparent) {
            material.transparent = false;
            if (typeof material.opacity === "number") material.opacity = 1;
            if (typeof material.alphaTest === "number") material.alphaTest = 0;
        }
    }
    if (opts.stripEnvMaps) material.envMap = null;
    material.needsUpdate = true;
}

function removeLightsAndCameras(root) {
    const toRemove = [];
    root.traverse((obj) => {
        if (obj.isLight || obj.isCamera) toRemove.push(obj);
    });
    toRemove.forEach((o) => o.parent && o.parent.remove(o));
}

function removeEmptyGroups(root) {
    const toRemove = [];
    root.traverse((obj) => {
        if (obj.type === "Group" && obj.children?.length === 0) toRemove.push(obj);
    });
    toRemove.forEach((o) => o.parent && o.parent.remove(o));
}

function normalizeRootTransform(root, opts) {
    const { centerXZ, placeOnGround, uniformScaleTo, rotateYDeg } = opts;
    root.rotation.set(0, THREE.MathUtils.degToRad(rotateYDeg || 0), 0);
    root.updateMatrixWorld(true);

    const { box, center } = computeBounds(root);

    if (centerXZ) {
        root.position.x -= center.x;
        root.position.z -= center.z;
    }
    if (placeOnGround) {
        root.position.y -= box.min.y;
    }

    if (uniformScaleTo && uniformScaleTo > 0) {
        root.updateMatrixWorld(true);
        const { size } = computeBounds(root);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        root.scale.setScalar(uniformScaleTo / maxDim);
    }

    root.updateMatrixWorld(true);
}

function bakeTransformsIntoGeometry(root) {
    root.updateMatrixWorld(true);
    const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();

    root.traverse((obj) => {
        if (!obj.isMesh) return;
        if (obj.isSkinnedMesh) return;
        if (!obj.geometry) return;

        obj.updateMatrixWorld(true);
        const m = new THREE.Matrix4().multiplyMatrices(invRoot, obj.matrixWorld);
        obj.geometry.applyMatrix4(m);

        obj.position.set(0, 0, 0);
        obj.rotation.set(0, 0, 0);
        obj.scale.set(1, 1, 1);
        obj.updateMatrix();
    });

    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
}

function mergeMeshesByMaterial(root) {
    if (typeof mergeGeometries !== "function") return;

    const buckets = new Map();
    root.updateMatrixWorld(true);

    root.traverse((obj) => {
        if (!obj.isMesh) return;
        if (obj.isSkinnedMesh) return;
        if (!obj.geometry || !obj.material) return;
        if (Array.isArray(obj.material)) return;

        const mat = obj.material;
        const key = mat.uuid;
        if (!buckets.has(key)) buckets.set(key, []);

        const geo = obj.geometry.clone();
        geo.applyMatrix4(obj.matrixWorld);
        buckets.get(key).push({ geo, mat });
    });

    const toRemove = [];
    root.traverse((obj) => {
        if (!obj.isMesh) return;
        if (obj.isSkinnedMesh) return;
        if (!obj.geometry || !obj.material) return;
        if (Array.isArray(obj.material)) return;
        toRemove.push(obj);
    });
    toRemove.forEach((m) => m.parent && m.parent.remove(m));

    const group = new THREE.Group();
    group.name = "__MergedByMaterial";

    for (const [, items] of buckets.entries()) {
        const geos = items.map((it) => it.geo);
        const merged = mergeGeometries(geos, false);
        geos.forEach((g) => g.dispose());
        if (!merged) continue;
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        group.add(new THREE.Mesh(merged, items[0].mat));
    }

    root.add(group);
    root.updateMatrixWorld(true);
}

async function simplifyGeometries(root, ratio, log, signal) {
    const simplifier = new SimplifyModifier();
    const targets = [];
    root.traverse((obj) => {
        if (!obj.isMesh) return;
        if (obj.isSkinnedMesh) return;
        if (!obj.geometry?.attributes?.position) return;
        targets.push(obj);
    });

    for (let i = 0; i < targets.length; i++) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const obj = targets[i];
        const geo = obj.geometry;
        const count = geo.attributes.position.count;
        const targetCount = Math.max(3, Math.floor(count * clamp(ratio, 0.05, 1)));

        try {
            const simplified = simplifier.modify(geo, targetCount);
            simplified.computeVertexNormals();
            simplified.computeBoundingBox();
            simplified.computeBoundingSphere();
            geo.dispose();
            obj.geometry = simplified;
        } catch (e) {
            log(`Simplify failed for '${obj.name || "(mesh)"}': ${String(e?.message || e)}`);
        }

        if (i % 3 === 0) await yieldToUI();
    }
}

function isExportImageType(img) {
    if (!img) return false;
    if (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement) return true;
    if (typeof HTMLCanvasElement !== "undefined" && img instanceof HTMLCanvasElement) return true;
    if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) return true;
    if (typeof OffscreenCanvas !== "undefined" && img instanceof OffscreenCanvas) return true;
    return false;
}

function bakeTextureImageToCanvas(img, forceOpaque = false) {
    const makeCanvas = (w, h) => {
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w || 1));
        c.height = Math.max(1, Math.round(h || 1));
        return c;
    };
    if (!img) return makeCanvas(1, 1);
    // ImageData
    if (typeof ImageData !== "undefined" && img instanceof ImageData) {
        const c = makeCanvas(img.width, img.height);
        const ctx = c.getContext("2d");
        try { ctx.putImageData(img, 0, 0); } catch {}
        return c;
    }
    // DataTexture-like {data,width,height}
    if (img.data && img.width && img.height) {
        const c = makeCanvas(img.width, img.height);
        const ctx = c.getContext("2d");
        try {
            const arr = img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data);
            if (arr.length >= img.width * img.height * 4) {
                const imageData = new ImageData(arr, img.width, img.height);
                ctx.putImageData(imageData, 0, 0);
                return c;
            }
        } catch {}
        return c;
    }
    // Video or ImageBitmap or HTMLImageElement fallback via drawImage
    const w = img.width ?? img.videoWidth ?? img.naturalWidth;
    const h = img.height ?? img.videoHeight ?? img.naturalHeight;
    if (w && h) {
        const c = makeCanvas(w, h);
        const ctx = c.getContext("2d");
        try { ctx.drawImage(img, 0, 0, c.width, c.height); } catch {}
        if (forceOpaque) {
            try {
                const imgData = ctx.getImageData(0, 0, c.width, c.height);
                const d = imgData.data;
                for (let i = 3; i < d.length; i += 4) d[i] = 255;
                ctx.putImageData(imgData, 0, 0);
            } catch {}
        }
        return c;
    }
    return makeCanvas(1, 1);
}

async function resizeAndReencodeImage({ image, maxSize, mime, quality }) {
    if (!image) return image;
    const w = image.width ?? image.videoWidth ?? image.naturalWidth;
    const h = image.height ?? image.videoHeight ?? image.naturalHeight;
    if (!w || !h) return image;

    const scale = maxSize ? Math.min(1, maxSize / Math.max(w, h)) : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    if (scale === 1 && !mime) return image;

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, tw, th);

    if (!mime) return canvas;

    const dataUrl = canvas.toDataURL(mime, quality);
    const img = new Image();
    img.src = dataUrl;
    await new Promise((r) => {
        img.onload = () => r();
        img.onerror = () => r();
    });
    return img;
}

function disposeObject3D(root) {
    if (!root) return;
    root.traverse((obj) => {
        obj.geometry?.dispose?.();
        const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
        mats.forEach((m) => {
            if (!m) return;
            [
                m.map,
                m.normalMap,
                m.metalnessMap,
                m.roughnessMap,
                m.aoMap,
                m.emissiveMap,
                m.alphaMap,
                m.envMap,
            ].forEach((t) => t?.dispose?.());
            m.dispose?.();
        });
    });
}

// ------------------------ R3F helpers ------------------------

function InvalidateBridge({ onReady }) {
    const invalidate = useThree((s) => s.invalidate);
    useEffect(() => {
        onReady?.(invalidate);
    }, [onReady, invalidate]);
    return null;
}

function WebGPUModeGate({ children }) {
    const isWebGPU = useThree((s) => s.gl?.isWebGPURenderer);
    return children(isWebGPU);
}

function WebGPUSceneClamp() {
    const isWebGPU = useThree((s) => s.gl?.isWebGPURenderer);
    const scene = useThree((s) => s.scene);
    useEffect(() => {
        if (!isWebGPU || !scene) return;
        scene.environment = null;
        scene.background = null;
    }, [isWebGPU, scene]);
    return null;
}

function ModelView({ url, onSceneReady }) {
    const loader = useMemo(() => {
        const l = new GLTFLoader();

        try {
            l.setMeshoptDecoder(MeshoptDecoder);
        } catch {
            // ignore
        }

        try {
            const draco = new DRACOLoader();
            draco.setDecoderPath("/draco/");
            l.setDRACOLoader(draco);
        } catch {
            // ignore
        }

        return l;
    }, []);

    const [scene, setScene] = useState(null);

    useEffect(() => {
        if (!url) {
            setScene(null);
            onSceneReady?.(null, null, null);
            return;
        }

        let canceled = false;

        loader.load(
            url,
            (res) => {
                if (canceled) return;
                setScene(res.scene);
                onSceneReady?.(res.scene, res, null);
            },
            undefined,
            (err) => {
                if (canceled) return;
                console.error(err);
                setScene(null);
                onSceneReady?.(null, null, err);
            }
        );

        return () => {
            canceled = true;
        };
    }, [url, loader, onSceneReady]);

    if (!scene) return null;
    return <primitive object={scene} />;
}

// ------------------------ UI bits (no tailwind) ------------------------

function Card({ title, subtitle, right, children }) {
    return (
        <section className="mol-card">
            <header className="mol-cardHeader">
                <div className="mol-cardTitleWrap">
                    <div className="mol-cardTitle">{title}</div>
                    {subtitle ? <div className="mol-cardSubtitle">{subtitle}</div> : null}
                </div>
                {right ? <div className="mol-cardRight">{right}</div> : null}
            </header>
            <div className="mol-cardBody">{children}</div>
        </section>
    );
}

function Btn({ children, onClick, disabled, variant = "primary", title }) {
    return (
        <button
            className={`mol-btn mol-btn-${variant}`}
            onClick={onClick}
            disabled={disabled}
            title={title}
            type="button"
        >
            {children}
        </button>
    );
}

function Toggle({ checked, onChange, label, disabled }) {
    return (
        <label className={`mol-toggle ${disabled ? "mol-disabled" : ""}`}>
            <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
            <span>{label}</span>
        </label>
    );
}

function Range({ value, min, max, step, onChange, label, right, disabled }) {
    return (
        <label className={`mol-range ${disabled ? "mol-disabled" : ""}`}>
            <div className="mol-rangeTop">
                <span className="mol-muted">{label}</span>
                <span className="mol-rangeRight">{right}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} disabled={disabled} />
        </label>
    );
}

function TextInput({ value, onChange, placeholder, disabled }) {
    return (
        <input className="mol-input" value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} />
    );
}

function Select({ value, onChange, disabled, children }) {
    return (
        <select className="mol-select" value={value} onChange={onChange} disabled={disabled}>
            {children}
        </select>
    );
}

// ------------------------ main component ------------------------

export default function ModelOptimizerLab() {
    // source
    const [sourceUrl, setSourceUrl] = useState("");
    const [objectUrl, setObjectUrl] = useState("");
    const [sourceName, setSourceName] = useState("model.glb");
    const [sourceBytes, setSourceBytes] = useState(null);
    const activeUrl = objectUrl || sourceUrl;

    // loaded
    const [loadedScene, setLoadedScene] = useState(null);
    const [loadedGLTF, setLoadedGLTF] = useState(null);
    const [loadError, setLoadError] = useState(null);

    // viewer
    const [showGrid, setShowGrid] = useState(true);
    const [isWebGPU, setIsWebGPU] = useState(() => isWebGPUAvailable());
    const [showHDRI, setShowHDRI] = useState(true);
    const [envPreset, setEnvPreset] = useState("studio");
    const [ambient, setAmbient] = useState(0.7);
    const [dirIntensity, setDirIntensity] = useState(1.2);
    const [fov, setFov] = useState(45);

    // texture visibility (viewport)
    const [viewMaps, setViewMaps] = useState({
        baseColor: true,
        normal: true,
        metalRough: true,
        ao: true,
        emissive: true,
        alpha: true,
    });

    // normalizer
    const [norm, setNorm] = useState({
        centerXZ: true,
        placeOnGround: true,
        uniformScaleTo: 1.6,
        rotateYDeg: 0,
    });

    // optimizer
    const [opt, setOpt] = useState({
        binary: true,
        applyViewportNormalization: false,
        bakeTransforms: false,

        removeLightsCameras: true,
        removeEmptyGroups: true,
        removeAnimations: false,

        simplifyEnabled: false,
        simplifyRatio: 0.6,
        mergeByMaterial: false,

        stripVertexColors: false,
        stripTangents: true,
        stripNormals: false,
        stripUV2: false,

        maxTextureSize: 0,
        reencodeTextures: false,
        reencodeMime: "image/jpeg",
        jpegQuality: 0.85,
        jpegOnlyIfSafe: true,

        stripBaseColor: false,
        stripNormalMaps: false,
        stripMetalRoughMaps: false,
        stripAOMaps: false,
        stripEmissiveMaps: false,
        stripAlphaMaps: false,
        stripEnvMaps: false,
        forceDiffuseExport: false,
        forceOpaqueExport: false,
        forceUnlitExport: false,
        nodeForgeSafeExport: false,
        visibilityFix: true,
    });

    const [targetMB, setTargetMB] = useState(60);
    const targetBytes = useMemo(() => Math.max(0, targetMB) * 1024 * 1024, [targetMB]);

    // progress/logs
    const [busy, setBusy] = useState(false);
    const [lastExport, setLastExport] = useState(null);
    const [progress, setProgress] = useState({ step: "", pct: 0 });
    const [logs, setLogs] = useState([]);
    const abortRef = useRef(null);

    const log = useCallback((msg) => {
        setLogs((l) => [...l, { t: Date.now(), msg }].slice(-250));
    }, []);

    // stats/bounds
    const [stats, setStats] = useState(() => computeStats(null));
    const [bounds, setBounds] = useState(() => computeBounds(null));

    // invalidate bridge (frameloop=demand)
    const invalidateRef = useRef(null);
    const requestRedraw = useCallback(() => {
        try {
            invalidateRef.current?.();
        } catch {
            // ignore
        }
    }, []);

    // originals for map toggles
    const originalsRef = useRef(new WeakMap());
    const captureOriginals = useCallback((scene) => {
        const map = new WeakMap();
        traverseMaterials(scene, (m) => {
            if (map.has(m)) return;
            const orig = {
                map: m.map || null,
                normalMap: m.normalMap || null,
                metalnessMap: m.metalnessMap || null,
                roughnessMap: m.roughnessMap || null,
                aoMap: m.aoMap || null,
                emissiveMap: m.emissiveMap || null,
                alphaMap: m.alphaMap || null,
            };
            map.set(m, orig);
            try {
                m.userData ||= {};
                m.userData.__origMaps = orig;
            } catch {}

        });
        originalsRef.current = map;
    }, []);

    const applyViewToggles = useCallback(
        (scene) => {
            if (!scene) return;
            enforceNoWireframe(scene);

            traverseMaterials(scene, (m) => {
                const orig = originalsRef.current.get(m);
                if (!orig) return;

                m.map = viewMaps.baseColor ? orig.map : null;
                m.normalMap = viewMaps.normal ? orig.normalMap : null;
                m.metalnessMap = viewMaps.metalRough ? orig.metalnessMap : null;
                m.roughnessMap = viewMaps.metalRough ? orig.roughnessMap : null;
                m.aoMap = viewMaps.ao ? orig.aoMap : null;
                m.emissiveMap = viewMaps.emissive ? orig.emissiveMap : null;
                m.alphaMap = viewMaps.alpha ? orig.alphaMap : null;

                m.needsUpdate = true;
            });

            requestRedraw();
        },
        [requestRedraw, viewMaps]
    );

    const applyNormalization = useCallback(
        (scene) => {
            if (!scene) return;
            normalizeRootTransform(scene, norm);
            requestRedraw();
        },
        [norm, requestRedraw]
    );

    const handleSceneReady = useCallback(
        (scene, gltf, err) => {
            setLoadError(err || null);

            if (!scene || !gltf) {
                setLoadedScene(null);
                setLoadedGLTF(null);
                setStats(computeStats(null));
                setBounds(computeBounds(null));
                return;
            }

            setLoadedScene(scene);
            setLoadedGLTF(gltf);

            enforceNoWireframe(scene);
            captureOriginals(scene);
            applyViewToggles(scene);
            applyNormalization(scene);

            setStats(computeStats(scene));
            setBounds(computeBounds(scene));
            log("Model loaded.");
        },
        [applyNormalization, applyViewToggles, captureOriginals, log]
    );

    useEffect(() => {
        if (!loadedScene) return;
        applyViewToggles(loadedScene);
    }, [loadedScene, applyViewToggles]);

    useEffect(() => {
        if (!loadedScene) return;
        applyNormalization(loadedScene);
        setBounds(computeBounds(loadedScene));
    }, [loadedScene, applyNormalization]);

    useEffect(() => {
        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [objectUrl]);

    useEffect(() => {
        return () => {
            if (lastExport?.url) URL.revokeObjectURL(lastExport.url);
        };
    }, [lastExport?.url]);

    const onPickFile = useCallback(
        (file) => {
            if (!file) return;
            setLogs([]);
            setLoadError(null);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            const url = URL.createObjectURL(file);
            setObjectUrl(url);
            setSourceUrl("");
            setSourceName(file.name || "model.glb");
            setSourceBytes(file.size || null);
            log(`Loaded file: ${file.name} (${formatBytes(file.size)})`);
        },
        [log, objectUrl]
    );

    const onLoadUrl = useCallback(async () => {
        setLogs([]);
        setLoadError(null);

        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            setObjectUrl("");
        }

        const url = sourceUrl.trim();
        if (!url) return;
        setSourceName(url.split("/").pop() || "model.glb");

        try {
            const res = await fetch(url, { method: "HEAD" });
            const len = res.headers.get("content-length");
            setSourceBytes(len ? Number(len) : null);
        } catch {
            setSourceBytes(null);
        }

        log(`Loading URL: ${url}`);
    }, [log, objectUrl, sourceUrl]);

    const cancel = useCallback(() => {
        abortRef.current?.abort?.();
    }, []);

    const exportGLB = useCallback(
        async ({ download = true, overrideOpt = null, _retry = false, _bakeTextures = false } = {}) => {
            if (!loadedScene) return null;
            const optUse = overrideOpt || opt;

            setBusy(true);
            setProgress({ step: "Starting…", pct: 0 });
            abortRef.current = new AbortController();
            const signal = abortRef.current.signal;

            const step = (name, pct) => setProgress({ step: name, pct });

            try {
                step("Cloning", 0.06);
                log("Cloning scene for export…");
                await yieldToUI();
                let root = deepCloneForEdit(loadedScene, originalsRef.current);
                enforceNoWireframe(root);
                restoreOriginalMaps(root, originalsRef.current);
                normalizeTextureTransforms(root);
                if (optUse.visibilityFix) {
                    applyVisibilityFix(root);
                }
                if (optUse.nodeForgeSafeExport) {
                    applyNodeForgeSafeExport(root);
                }
                if (optUse.forceDiffuseExport) {
                    traverseMaterials(root, (m) => {
                        if (!m || !("metalness" in m)) return;
                        const hasBase = !!m.map;
                        if (hasBase || optUse.stripMetalRoughMaps) {
                            m.metalnessMap = null;
                            m.roughnessMap = null;
                            m.metalness = 0;
                            if (typeof m.roughness === "number") m.roughness = 1;
                            if (hasBase && m.color && m.color.isColor) m.color.set(0xffffff);
                            m.needsUpdate = true;
                        }
                    });
                }
                if (optUse.forceOpaqueExport) {
                    traverseMaterials(root, (m) => {
                        if (!m) return;
                        try { m.transparent = false; } catch {}
                        try { m.opacity = 1; } catch {}
                        try { m.alphaTest = 0; } catch {}
                        try { m.alphaMap = null; } catch {}
                        try { m.depthWrite = true; } catch {}
                        try { m.side = THREE.DoubleSide; } catch {}
                        m.needsUpdate = true;
                    });
                }
                if (optUse.forceUnlitExport) {
                    forceUnlitMaterials(root);
                }
                if (optUse.forceOpaqueExport || optUse.forceUnlitExport) {
                    root.traverse((obj) => {
                        if (!(obj.isMesh || obj.isSkinnedMesh)) return;
                        const geo = obj.geometry;
                        if (geo?.attributes?.color) geo.deleteAttribute("color");
                        const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
                        mats.forEach((m) => { if (m && "vertexColors" in m) m.vertexColors = false; });
                    });
                }

                if (_bakeTextures) {
                    const texProps = ["map", "normalMap", "metalnessMap", "roughnessMap", "aoMap", "emissiveMap", "alphaMap"];
                    const seen = new Set();
                    traverseMaterials(root, (m) => {
                        texProps.forEach((p) => {
                            const t = m[p];
                            if (!t || seen.has(t)) return;
                            seen.add(t);
                            const img = t.image;
                            t.image = bakeTextureImageToCanvas(img, p === "map");
                            // Ensure transform vectors are valid for exporter
                            try { if (!t.offset || typeof t.offset.toArray !== "function") t.offset = new THREE.Vector2(0, 0); } catch {}
                            try { if (!t.repeat || typeof t.repeat.toArray !== "function") t.repeat = new THREE.Vector2(1, 1); } catch {}
                            try { if (!t.center || typeof t.center.toArray !== "function") t.center = new THREE.Vector2(0, 0); } catch {}
                            if (typeof t.rotation !== "number" || !isFinite(t.rotation)) t.rotation = 0;
                            t.needsUpdate = true;
                        });
                    });
                }

                if (optUse.applyViewportNormalization) {
                    step("Normalizing", 0.14);
                    log("Applying normalization…");
                    normalizeRootTransform(root, norm);
                    await yieldToUI();
                }

                if (signal.aborted) throw new DOMException("Aborted", "AbortError");

                if (optUse.removeLightsCameras) {
                    step("Pruning lights/cameras", 0.20);
                    log("Removing lights/cameras…");
                    removeLightsAndCameras(root);
                    await yieldToUI();
                }

                if (optUse.bakeTransforms) {
                    step("Baking transforms", 0.28);
                    log("Baking transforms (skinned meshes skipped)…");
                    bakeTransformsIntoGeometry(root);
                    await yieldToUI();
                }

                step("Geometry cleanup", 0.40);
                log("Stripping geometry attributes…");
                root.traverse((obj) => {
                    if (!(obj.isMesh || obj.isSkinnedMesh)) return;
                    stripAttributes(obj.geometry, optUse);
                });
                await yieldToUI();

                if (optUse.mergeByMaterial) {
                    step("Merging meshes", 0.50);
                    log("Merging static meshes by material…");
                    mergeMeshesByMaterial(root);
                    await yieldToUI();
                }

                if (optUse.simplifyEnabled) {
                    step("Simplifying", 0.62);
                    log(`Simplifying geometry (ratio ${optUse.simplifyRatio})…`);
                    await simplifyGeometries(root, optUse.simplifyRatio, log, signal);
                    await yieldToUI();
                }

                step("Stripping maps", 0.72);
                log("Stripping maps…");
                traverseMaterials(root, (m) => stripMaterialMaps(m, optUse));
                await yieldToUI();

                if (optUse.maxTextureSize || optUse.reencodeTextures) {
                    step("Processing textures", 0.84);
                    log("Processing textures (resize/re-encode)…");

                    const texProps = ["map", "normalMap", "metalnessMap", "roughnessMap", "aoMap", "emissiveMap", "alphaMap"];

                    const textures = new Set();
                    traverseMaterials(root, (m) => {
                        texProps.forEach((p) => m[p] && textures.add(m[p]));
                    });

                    const list = [...textures];
                    for (let i = 0; i < list.length; i++) {
                        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
                        const t = list[i];

                        const safeMime = (() => {
                            if (!optUse.reencodeTextures) return null;
                            if (optUse.reencodeMime !== "image/jpeg") return optUse.reencodeMime;
                            if (!optUse.jpegOnlyIfSafe) return "image/jpeg";
                            let usedAsAlpha = false;
                            traverseMaterials(root, (m) => {
                                if (m.alphaMap === t) usedAsAlpha = true;
                            });
                            return usedAsAlpha ? "image/png" : "image/jpeg";
                        })();

                        try {
                            const newImg = await resizeAndReencodeImage({
                                image: t.image,
                                maxSize: optUse.maxTextureSize ? Number(optUse.maxTextureSize) : null,
                                mime: safeMime,
                                quality: optUse.jpegQuality,
                            });
                            t.image = newImg;
                            t.needsUpdate = true;
                        } catch (e) {
                            log(`Texture failed: ${String(e?.message || e)}`);
                        }

                        if (i % 2 === 0) await yieldToUI();
                    }

                    log(`Processed ${list.length} textures.`);
                }

                if (optUse.removeEmptyGroups) {
                    step("Pruning empty groups", 0.90);
                    log("Pruning empty groups…");
                    removeEmptyGroups(root);
                    await yieldToUI();
                }

                step("Exporting GLB", 0.96);
                log("Exporting…");
                await yieldToUI();

                const exporter = new GLTFExporter();
                let arrayBuffer;
                try {
                    arrayBuffer = await new Promise((resolve, reject) => {
                        exporter.parse(
                            root,
                            (res) => resolve(res),
                            (err) => reject(err),
                            {
                                binary: !!optUse.binary,
                                maxTextureSize: optUse.maxTextureSize ? Number(optUse.maxTextureSize) : Infinity,
                                animations: optUse.removeAnimations ? [] : loadedGLTF?.animations || [],
                            }
                        );
                    });
                } catch (err) {
                    if (!_retry) {
                        log("Export failed; retrying with safe texture bake and no metal/rough maps?");
                        disposeObject3D(root);
                        return await exportGLB({ download, overrideOpt: { ...optUse, stripMetalRoughMaps: false, forceDiffuseExport: true }, _retry: true, _bakeTextures: true });
                    }
                    throw err;
                }

                disposeObject3D(root);

                if (!(arrayBuffer instanceof ArrayBuffer)) {
                    throw new Error("Export failed: exporter did not return ArrayBuffer.");
                }

                const exportBytes = arrayBuffer.byteLength;
                setProgress({ step: "Done", pct: 1 });
                log(`Export complete: ${formatBytes(exportBytes)}.`);

                if (targetBytes > 0) {
                    if (exportBytes <= targetBytes) log(`�
 Target met (${formatBytes(targetBytes)}).`);
                    else log(`⬇️ Target not met (${formatBytes(targetBytes)}). Keep optimizing.`);
                }

                const base = sourceName.replace(/\.(gltf|glb)$/i, "") || "model";
                const filename = `${base}.optimized.glb`;
                const exportUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: "model/gltf-binary" }));
                setLastExport({ url: exportUrl, name: filename, bytes: exportBytes });

                if (download) {
                    const a = document.createElement("a");
                    a.href = exportUrl;
                    a.download = filename;
                    a.style.display = "none";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                }

                return exportBytes;
            } catch (e) {
                if (e?.name === "AbortError") log("Cancelled.");
                else {
                    console.error(e);
                    log(`Error: ${String(e?.message || e)}`);
                }
            } finally {
                setBusy(false);
                setProgress({ step: "", pct: 0 });
                abortRef.current = null;
            }

            return null;
        },
        [loadedScene, loadedGLTF, log, norm, opt, sourceName, targetBytes]
    );

    const hasModel = !!loadedScene;

    return (
        <div className="mol-root">
            <style>{`
        html, body, #root {
          height:100%;
        }
        body {
          overflow:hidden;
        }
        /* Root is fixed-height; internal panels scroll independently */
        .mol-root{
          height:100vh;
          min-height:100vh;
          height:100dvh;
          min-height:100dvh;
          display:flex;
          flex-direction:column;
          overflow:hidden;
          background:#060913;
          color:#e5e7eb;
          font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji";
        }

        .mol-top{
          height:56px;
          flex:0 0 56px;
          display:flex;
          align-items:center;
          gap:14px;
          padding:0 16px;
          border-bottom:1px solid rgba(148,163,184,0.18);
          background:rgba(2,6,23,0.72);
          backdrop-filter: blur(10px);
        }
        .mol-title{font-weight:700;letter-spacing:-0.01em;line-height:1;}
        .mol-sub{margin-top:2px;font-size:12px;color:rgba(148,163,184,0.9);}
        .mol-topRight{margin-left:auto;display:flex;gap:14px;align-items:center;font-size:12px;color:rgba(148,163,184,0.95);flex-wrap:wrap;justify-content:flex-end;}
        .mol-topRight b{color:#e5e7eb;font-weight:600;}

        /* IMPORTANT: lock main area height so sidebar can scroll */
        .mol-main{
          flex:1 1 auto;
          min-height:0;
          height:calc(100dvh - 56px);
          display:flex;
          overflow:hidden;
        }

        /* LEFT = CANVAS */
        .mol-viewport{flex:1 1 auto;min-width:0;position:relative;overflow:hidden;}
        .mol-canvasWrap{position:absolute;inset:0;}

        /* RIGHT = MENU */
        .mol-sidebar{
          width:clamp(360px, 38vw, 560px);
          max-width:56vw;
          min-width:320px;
          flex:0 0 auto;
          display:flex;
          flex-direction:column;
          height:100%;
          min-height:0;
          overflow:hidden;
          border-left:1px solid rgba(148,163,184,0.18);
          background:rgba(2,6,23,0.35);
        }
        .mol-sideTop{
          flex:0 0 auto;
          padding:12px 16px;
          border-bottom:1px solid rgba(148,163,184,0.18);
          background:rgba(2,6,23,0.72);
          backdrop-filter: blur(10px);
          display:flex;
          align-items:center;
          gap:10px;
          flex-wrap:wrap;
        }
        .mol-sideBody{
          flex:1 1 0%;
          min-height:0;
          height:100%;
          max-height:100%;
          overflow-y:auto;
          overflow-x:hidden;
          padding:16px 16px 80px;
          display:flex;
          flex-direction:column;
          gap:14px;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-gutter: stable both-edges;
        }
        /* visible scrollbars */
        .mol-sideBody::-webkit-scrollbar{width:10px}
        .mol-sideBody::-webkit-scrollbar-thumb{background:rgba(148,163,184,0.22);border-radius:999px}
        .mol-sideBody::-webkit-scrollbar-track{background:rgba(15,23,42,0.35);border-radius:999px}

        .mol-card{
          border:1px solid rgba(148,163,184,0.18);
          background:rgba(2,6,23,0.55);
          border-radius:16px;
          overflow:hidden;
          box-shadow:0 10px 30px rgba(0,0,0,0.25);
        }
        .mol-cardHeader{
          padding:12px 14px;
          border-bottom:1px solid rgba(148,163,184,0.14);
          display:flex;
          gap:10px;
          align-items:flex-start;
        }
        .mol-cardTitleWrap{min-width:0;}
        .mol-cardTitle{font-size:13px;font-weight:700;}
        .mol-cardSubtitle{font-size:12px;color:rgba(148,163,184,0.9);margin-top:2px;}
        .mol-cardBody{padding:14px;min-width:0;}

        .mol-btn{
          border-radius:12px;
          border:1px solid rgba(148,163,184,0.25);
          padding:10px 12px;
          font-size:13px;
          cursor:pointer;
          transition:transform .08s ease, background .12s ease, border-color .12s ease;
          user-select:none;
        }
        .mol-btn:active{transform:translateY(1px)}
        .mol-btn:disabled{opacity:.55;cursor:not-allowed}
        .mol-btn-primary{background:#10b981;color:#03120b;border-color:rgba(16,185,129,0.5)}
        .mol-btn-primary:hover{background:#22c55e}
        .mol-btn-secondary{background:rgba(148,163,184,0.14);color:#e5e7eb}
        .mol-btn-secondary:hover{background:rgba(148,163,184,0.2)}
        .mol-btn-danger{background:#ef4444;color:white;border-color:rgba(239,68,68,0.55)}
        .mol-btn-danger:hover{background:#f43f5e}

        .mol-row{display:flex;gap:10px;align-items:center;min-width:0;flex-wrap:wrap;}
        .mol-grow{flex:1 1 auto;min-width:0;}

        .mol-input,.mol-select{
          width:100%;
          border-radius:12px;
          border:1px solid rgba(148,163,184,0.25);
          background:rgba(15,23,42,0.65);
          color:#e5e7eb;
          padding:10px 12px;
          font-size:13px;
          outline:none;
          min-width:0;
        }
        .mol-input:focus,.mol-select:focus{border-color:rgba(16,185,129,0.8);box-shadow:0 0 0 3px rgba(16,185,129,0.15)}

        .mol-muted{color:rgba(148,163,184,0.92)}
        .mol-kv{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
        .mol-pill{border:1px solid rgba(148,163,184,0.18);background:rgba(148,163,184,0.08);border-radius:14px;padding:10px 12px;font-size:12px;color:#cbd5e1}
        .mol-pill b{color:#e5e7eb;font-weight:650}

        .mol-toggle{display:flex;gap:8px;align-items:center;font-size:13px;color:#e5e7eb}
        .mol-toggle input{accent-color:#10b981}
        .mol-range{display:block}
        .mol-rangeTop{display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:6px;gap:8px;flex-wrap:wrap}
        .mol-rangeRight{color:#e5e7eb;font-weight:600}
        .mol-range input{width:100%;accent-color:#10b981}
        .mol-disabled{opacity:.55}

        .mol-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
        .mol-gap{height:10px}

        .mol-log{
          height:clamp(160px, 24vh, 260px);
          overflow:auto;
          border-radius:14px;
          border:1px solid rgba(148,163,184,0.18);
          background:rgba(0,0,0,0.22);
          padding:10px;
        }
        .mol-logLine{font-size:12px;color:#d1d5db;line-height:1.35;margin-bottom:6px}
        .mol-logTime{color:rgba(148,163,184,0.7);margin-right:8px}

        .mol-progress{position:absolute;left:14px;right:14px;top:14px;z-index:5;pointer-events:none;}
        .mol-progressBox{border-radius:16px;border:1px solid rgba(148,163,184,0.18);background:rgba(2,6,23,0.75);backdrop-filter: blur(10px);padding:12px 12px;}
        .mol-progressTop{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#cbd5e1}
        .mol-bar{margin-top:8px;height:8px;border-radius:999px;background:rgba(148,163,184,0.18);overflow:hidden}
        .mol-barFill{height:100%;background:#10b981;width:0%}

        @media (max-width: 1100px){
          .mol-grid2{grid-template-columns:1fr}
        }
        @media (max-width: 900px){
          .mol-sidebar{width:420px;min-width:300px;max-width:60vw}
        }
        @media (max-width: 720px){
          .mol-main{flex-direction:column;height:calc(100dvh - 56px);min-height:0}
          .mol-root{overflow:hidden}
          .mol-sidebar{
            width:auto;max-width:none;min-width:0;
            border-left:none;border-top:1px solid rgba(148,163,184,0.18);
            height:48vh;min-height:0;overflow:hidden;
          }
          .mol-sideBody{max-height:100%;overflow:auto}
          .mol-viewport{min-height:40vh;flex:1 1 auto}
        }
      `}</style>

            <div className="mol-top">
                <div>
                    <div className="mol-title">Model Optimizer Lab</div>
                    <div className="mol-sub">Normalizer • Viewer • Export Optimizer</div>
                </div>
                <div className="mol-topRight">
                    <span>Tris: <b>{stats.tris.toLocaleString()}</b></span>
                    <span>Textures: <b>{stats.textures}</b></span>
                    <span>Source: <b>{formatBytes(sourceBytes)}</b></span>
                </div>
            </div>

            <div className="mol-main">
                {/* LEFT: CANVAS */}
                <div className="mol-viewport">
                    <div className="mol-canvasWrap">
                        <Canvas
                            style={{ width: "100%", height: "100%" }}
                            frameloop="demand"
                            dpr={isWebGPU ? 1 : [1, 2]}
                            gl={async (props) => createRenderer(props, {
                                antialias: true,
                                alpha: false,
                                powerPreference: "high-performance",
                            })}
                            onCreated={({ gl }) => {
                                setIsWebGPU(!!gl.isWebGPURenderer);
                                if (gl.setPixelRatio && gl.isWebGPURenderer) {
                                    gl.setPixelRatio(1);
                                }
                            }}
                        >
                            <InvalidateBridge onReady={(inv) => (invalidateRef.current = inv)} />
                            <color attach="background" args={["#050816"]} />
                            <hemisphereLight intensity={ambient} />
                            <directionalLight position={[6, 8, 5]} intensity={dirIntensity} />

                            <PerspectiveCamera makeDefault position={[2.8, 1.8, 2.8]} fov={fov} near={0.05} far={500} />
                            <OrbitControls makeDefault enableDamping dampingFactor={0.08} />

                            <Suspense
                                fallback={
                                    <Html center>
                                        <div
                                            style={{
                                                padding: "10px 12px",
                                                borderRadius: 12,
                                                border: "1px solid rgba(148,163,184,0.25)",
                                                background: "rgba(2,6,23,0.75)",
                                                color: "#e5e7eb",
                                                fontSize: 13,
                                            }}
                                        >
                                            Loading model…
                                        </div>
                                    </Html>
                                }
                            >
                                <ModelView url={activeUrl} onSceneReady={handleSceneReady} />
                            </Suspense>

                            <WebGPUModeGate>
                                {(isWebGPU) => (
                                    <>
                                        {showGrid && !isWebGPU && (
                                            <Grid
                                                args={[30, 30]}
                                                sectionSize={1}
                                                sectionColor="#1f2937"
                                                cellColor="#0b1220"
                                                infiniteGrid
                                                position={[0, -0.0001, 0]}
                                            />
                                        )}
                                        {showGrid && isWebGPU && (
                                            <gridHelper
                                                args={[30, 30, "#1f2937", "#0b1220"]}
                                                position={[0, -0.0001, 0]}
                                            />
                                        )}
                                        {!isWebGPU && (
                                            <ContactShadows opacity={0.35} scale={10} blur={2.2} far={10} resolution={512} />
                                        )}
                                    </>
                                )}
                            </WebGPUModeGate>
                            <WebGPUModeGate>
                                {(isWebGPU) => (showHDRI && !isWebGPU ? <Environment preset={envPreset} /> : null)}
                            </WebGPUModeGate>

                            {!activeUrl ? (
                                <Html center>
                                    <div
                                        style={{
                                            maxWidth: 440,
                                            textAlign: "center",
                                            padding: "14px 16px",
                                            borderRadius: 16,
                                            border: "1px solid rgba(148,163,184,0.22)",
                                            background: "rgba(2,6,23,0.75)",
                                            color: "#e5e7eb",
                                            fontSize: 13,
                                        }}
                                    >
                                        <div style={{ fontWeight: 700, marginBottom: 6 }}>No model loaded</div>
                                        <div style={{ color: "rgba(148,163,184,0.95)" }}>
                                            Use the menu on the right to load a <b>.glb</b> / <b>.gltf</b>.
                                        </div>
                                    </div>
                                </Html>
                            ) : null}

                            {/* HUD */}
                            <Html position={[-2.9, 2.35, 0]} transform occlude={false}>
                                <div
                                    style={{
                                        width: 260,
                                        borderRadius: 16,
                                        border: "1px solid rgba(148,163,184,0.22)",
                                        background: "rgba(2,6,23,0.72)",
                                        backdropFilter: "blur(10px)",
                                        padding: "10px 10px",
                                        fontSize: 12,
                                        color: "#e5e7eb",
                                    }}
                                >
                                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Model</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px" }}>
                                        <div style={{ color: "rgba(148,163,184,0.85)" }}>Meshes</div>
                                        <div>{stats.meshes}</div>
                                        <div style={{ color: "rgba(148,163,184,0.85)" }}>Tris</div>
                                        <div>{stats.tris.toLocaleString()}</div>
                                        <div style={{ color: "rgba(148,163,184,0.85)" }}>Verts</div>
                                        <div>{stats.verts.toLocaleString()}</div>
                                        <div style={{ color: "rgba(148,163,184,0.85)" }}>Mats</div>
                                        <div>{stats.materials}</div>
                                        <div style={{ color: "rgba(148,163,184,0.85)" }}>Textures</div>
                                        <div>{stats.textures}</div>
                                    </div>
                                    <div
                                        style={{
                                            borderTop: "1px solid rgba(148,163,184,0.18)",
                                            marginTop: 10,
                                            paddingTop: 8,
                                            color: "rgba(148,163,184,0.95)",
                                        }}
                                    >
                                        Bounds:{" "}
                                        <b style={{ color: "#e5e7eb" }}>
                                            {bounds.size.x.toFixed(2)}×{bounds.size.y.toFixed(2)}×{bounds.size.z.toFixed(2)}
                                        </b>
                                    </div>
                                </div>
                            </Html>
                        </Canvas>
                    </div>

                    {busy ? (
                        <div className="mol-progress">
                            <div className="mol-progressBox">
                                <div className="mol-progressTop">
                                    <div style={{ fontWeight: 650 }}>{progress.step || "Working…"}</div>
                                    <div>{Math.round((progress.pct || 0) * 100)}%</div>
                                </div>
                                <div className="mol-bar">
                                    <div className="mol-barFill" style={{ width: `${Math.round((progress.pct || 0) * 100)}%` }} />
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {loadError ? (
                        <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, zIndex: 6 }}>
                            <div
                                style={{
                                    borderRadius: 16,
                                    border: "1px solid rgba(244,63,94,0.45)",
                                    background: "rgba(88, 10, 23, 0.55)",
                                    color: "#fecdd3",
                                    padding: "12px 14px",
                                    fontSize: 13,
                                }}
                            >
                                Failed to load model. Check console / URL / file.
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* RIGHT: MENU (scrollable) */}
                <aside className="mol-sidebar">
                    <div className="mol-sideTop">
                        {busy ? (
                            <Btn variant="danger" onClick={cancel}>
                                Cancel
                            </Btn>
                        ) : (
                            <div style={{ display: "grid", gap: 8 }}>
                                <Btn variant="primary" disabled={!hasModel} onClick={() => exportGLB({ download: true })}>
                                    Export .glb
                                </Btn>
                                {lastExport?.url && (
                                    <Btn variant="ghost" onClick={() => {
                                        const a = document.createElement("a");
                                        a.href = lastExport.url;
                                        a.download = lastExport.name || "model.optimized.glb";
                                        a.style.display = "none";
                                        document.body.appendChild(a);
                                        a.click();
                                        a.remove();
                                    }}>
                                        Download last export
                                    </Btn>
                                )}
                            </div>
                        )}
                        <Btn variant="secondary" disabled={!hasModel || busy} title="Redraw viewport" onClick={requestRedraw}>
                            Refresh
                        </Btn>
                        <div className="mol-grow" />
                        <div className="mol-muted" style={{ fontSize: 12 }}>
                            Target: <b style={{ color: "#e5e7eb" }}>{formatBytes(targetBytes)}</b>
                        </div>
                    </div>

                    <div className="mol-sideBody">
                        <Card title="Source" subtitle={sourceName}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <div>
                                    <div className="mol-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                                        URL
                                    </div>
                                    <div className="mol-row">
                                        <div className="mol-grow">
                                            <TextInput
                                                value={sourceUrl}
                                                onChange={(e) => setSourceUrl(e.target.value)}
                                                placeholder="https://…/model.glb"
                                                disabled={!!objectUrl || busy}
                                            />
                                        </div>
                                        <Btn variant="secondary" onClick={onLoadUrl} disabled={!sourceUrl.trim() || busy || !!objectUrl}>
                                            Load
                                        </Btn>
                                    </div>
                                </div>

                                <div>
                                    <div className="mol-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                                        File
                                    </div>
                                    <div className="mol-row" style={{ alignItems: "stretch" }}>
                                        <input
                                            type="file"
                                            accept=".glb,.gltf"
                                            disabled={busy}
                                            onChange={(e) => onPickFile(e.target.files?.[0] || null)}
                                            style={{
                                                flex: "1 1 auto",
                                                minWidth: 0,
                                                maxWidth: "100%",
                                                color: "#e5e7eb",
                                            }}
                                        />
                                        {objectUrl ? (
                                            <Btn
                                                variant="secondary"
                                                disabled={busy}
                                                onClick={() => {
                                                    URL.revokeObjectURL(objectUrl);
                                                    setObjectUrl("");
                                                    setSourceBytes(null);
                                                    setSourceName("model.glb");
                                                    log("Cleared file source.");
                                                }}
                                            >
                                                Clear
                                            </Btn>
                                        ) : null}
                                    </div>
                                </div>

                                <div className="mol-kv">
                                    <div className="mol-pill">
                                        Source size: <b>{formatBytes(sourceBytes)}</b>
                                    </div>
                                    <div className="mol-pill">
                                        Meshes: <b>{stats.meshes}</b>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        <Card title="Viewport" subtitle="Lighting, grid, HDRI & texture visibility">
                            <div className="mol-grid2">
                                <div>
                                    <div className="mol-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                                        Environment
                                    </div>
                                    <Select
                                        value={envPreset}
                                        onChange={(e) => {
                                            setEnvPreset(e.target.value);
                                            requestRedraw();
                                        }}
                                    >
                                        {["studio", "city", "apartment", "dawn", "forest", "lobby", "night", "park", "sunset", "warehouse"].map(
                                            (p) => (
                                                <option key={p} value={p}>
                                                    {p}
                                                </option>
                                            )
                                        )}
                                    </Select>
                                </div>

                                <Range
                                    label="FOV"
                                    min={25}
                                    max={80}
                                    step={1}
                                    value={fov}
                                    onChange={(e) => {
                                        setFov(Number(e.target.value));
                                        requestRedraw();
                                    }}
                                    right={`${fov}°`}
                                />

                                <Range
                                    label="Ambient"
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    value={ambient}
                                    onChange={(e) => {
                                        setAmbient(Number(e.target.value));
                                        requestRedraw();
                                    }}
                                    right={ambient.toFixed(2)}
                                />

                                <Range
                                    label="Directional"
                                    min={0}
                                    max={4}
                                    step={0.05}
                                    value={dirIntensity}
                                    onChange={(e) => {
                                        setDirIntensity(Number(e.target.value));
                                        requestRedraw();
                                    }}
                                    right={dirIntensity.toFixed(2)}
                                />
                            </div>

                            <div className="mol-gap" />
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                                <Toggle
                                    label="Show grid"
                                    checked={showGrid}
                                    onChange={(e) => {
                                        setShowGrid(e.target.checked);
                                        requestRedraw();
                                    }}
                                />
                                <Toggle
                                    label="Enable HDRI"
                                    checked={showHDRI}
                                    onChange={(e) => {
                                        setShowHDRI(e.target.checked);
                                        requestRedraw();
                                    }}
                                />
                                <span className="mol-muted" style={{ fontSize: 12 }}>
                  Wireframe is always ignored.
                </span>
                            </div>

                            <div className="mol-gap" />
                            <div style={{ fontWeight: 700, marginBottom: 8 }}>Texture visibility (viewport)</div>
                            <div className="mol-grid2" style={{ gap: 10 }}>
                                {[
                                    ["Base color", "baseColor"],
                                    ["Normal", "normal"],
                                    ["Metal/Rough", "metalRough"],
                                    ["AO", "ao"],
                                    ["Emissive", "emissive"],
                                    ["Alpha", "alpha"],
                                ].map(([label, key]) => (
                                    <Toggle
                                        key={key}
                                        label={label}
                                        checked={!!viewMaps[key]}
                                        disabled={!hasModel}
                                        onChange={(e) => setViewMaps((v) => ({ ...v, [key]: e.target.checked }))}
                                    />
                                ))}
                            </div>
                        </Card>

                        <Card title="3D Model Lab Normalizer" subtitle="Center • ground • scale • rotate">
                            <div className="mol-grid2">
                                <Toggle
                                    label="Center XZ"
                                    checked={norm.centerXZ}
                                    disabled={!hasModel}
                                    onChange={(e) => setNorm((n) => ({ ...n, centerXZ: e.target.checked }))}
                                />
                                <Toggle
                                    label="Place on ground"
                                    checked={norm.placeOnGround}
                                    disabled={!hasModel}
                                    onChange={(e) => setNorm((n) => ({ ...n, placeOnGround: e.target.checked }))}
                                />

                                <div>
                                    <div className="mol-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                                        Uniform scale to (units)
                                    </div>
                                    <TextInput
                                        value={String(norm.uniformScaleTo)}
                                        disabled={!hasModel}
                                        onChange={(e) => setNorm((n) => ({ ...n, uniformScaleTo: Number(e.target.value) }))}
                                        placeholder="1.6"
                                    />
                                </div>

                                <Range
                                    label="Rotate Y"
                                    min={-180}
                                    max={180}
                                    step={1}
                                    value={norm.rotateYDeg}
                                    disabled={!hasModel}
                                    onChange={(e) => setNorm((n) => ({ ...n, rotateYDeg: Number(e.target.value) }))}
                                    right={`${norm.rotateYDeg}°`}
                                />
                            </div>
                        </Card>

                        <Card title="Optimizer" subtitle="Reduce file size to hit your target" right={(
                            <Btn
                                variant="secondary"
                                disabled={busy}
                                onClick={() => setOpt((o) => ({
                                    ...o,
                                    applyViewportNormalization: false,
                                    bakeTransforms: false,
                                    removeLightsCameras: true,
                                    removeEmptyGroups: true,
                                    removeAnimations: false,
                                    mergeByMaterial: false,
                                    stripTangents: true,
                                    stripVertexColors: false,
                                    stripUV2: false,
                                    stripNormals: false,
                                    maxTextureSize: 0,
                                    reencodeTextures: false,
                                    stripBaseColor: false,
                                    stripNormalMaps: false,
                                    stripMetalRoughMaps: false,
                                    stripAOMaps: false,
                                    stripEmissiveMaps: false,
                                    stripAlphaMaps: false,
                                    stripEnvMaps: false,
                                    forceDiffuseExport: true,
                                    forceOpaqueExport: true,
                                    forceUnlitExport: true,
                                    nodeForgeSafeExport: false,
                                    visibilityFix: true,
                                }))}
                            >
                                NodeForge preset
                            </Btn>
                        )}>
                            <div className="mol-grid2">
                                <div>
                                    <div className="mol-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                                        Target (MB)
                                    </div>
                                    <TextInput value={String(targetMB)} disabled={busy} onChange={(e) => setTargetMB(Number(e.target.value))} placeholder="60" />
                                </div>

                                <div>
                                    <div className="mol-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                                        Max texture size
                                    </div>
                                    <Select value={opt.maxTextureSize} disabled={busy} onChange={(e) => setOpt((o) => ({ ...o, maxTextureSize: Number(e.target.value) }))}>
                                        {[4096, 2048, 1024, 512, 256, 0].map((n) => (
                                            <option key={n} value={n}>
                                                {n === 0 ? "No resize" : `${n}px`}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                            </div>

                            <div className="mol-gap" />
                            <div className="mol-grid2" style={{ gap: 10 }}>
                                {[
                                    ["Apply viewport normalization", "applyViewportNormalization"],
                                    ["Bake transforms", "bakeTransforms"],
                                    ["Remove lights/cameras", "removeLightsCameras"],
                                    ["Remove empty groups", "removeEmptyGroups"],
                                    ["Remove animations", "removeAnimations"],
                                    ["Merge by material", "mergeByMaterial"],
                                    ["Strip tangents", "stripTangents"],
                                    ["Strip vertex colors", "stripVertexColors"],
                                    ["Strip UV2", "stripUV2"],
                                    ["Strip normals (recompute)", "stripNormals"],
                                ].map(([label, key]) => (
                                    <Toggle key={key} label={label} checked={!!opt[key]} disabled={busy} onChange={(e) => setOpt((o) => ({ ...o, [key]: e.target.checked }))} />
                                ))}
                            </div>

                            <div className="mol-gap" />
                            <div className="mol-pill" style={{ borderRadius: 16 }}>
                                <Toggle label="Simplify geometry" checked={opt.simplifyEnabled} disabled={busy} onChange={(e) => setOpt((o) => ({ ...o, simplifyEnabled: e.target.checked }))} />
                                <div style={{ marginTop: 10 }}>
                                    <Range
                                        label="Simplify ratio"
                                        min={0.1}
                                        max={1}
                                        step={0.05}
                                        value={opt.simplifyRatio}
                                        disabled={busy || !opt.simplifyEnabled}
                                        onChange={(e) => setOpt((o) => ({ ...o, simplifyRatio: Number(e.target.value) }))}
                                        right={`${Math.round(opt.simplifyRatio * 100)}%`}
                                    />
                                    <div className="mol-muted" style={{ fontSize: 12, marginTop: 6 }}>
                                        Skinned meshes are skipped.
                                    </div>
                                </div>
                            </div>

                            <div className="mol-gap" />
                            <div className="mol-pill" style={{ borderRadius: 16 }}>
                                <div style={{ fontWeight: 700, marginBottom: 8 }}>Texture re-encode</div>
                                <Toggle label="Re-encode textures (experimental)" checked={opt.reencodeTextures} disabled={busy} onChange={(e) => setOpt((o) => ({ ...o, reencodeTextures: e.target.checked }))} />

                                <div className="mol-gap" />
                                <div className="mol-grid2">
                                    <div>
                                        <div className="mol-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                                            Format
                                        </div>
                                        <Select value={opt.reencodeMime} disabled={busy || !opt.reencodeTextures} onChange={(e) => setOpt((o) => ({ ...o, reencodeMime: e.target.value }))}>
                                            <option value="image/jpeg">JPEG</option>
                                            <option value="image/png">PNG</option>
                                        </Select>
                                    </div>
                                    <Range
                                        label="JPEG quality"
                                        min={0.4}
                                        max={0.98}
                                        step={0.02}
                                        value={opt.jpegQuality}
                                        disabled={busy || !opt.reencodeTextures || opt.reencodeMime !== "image/jpeg"}
                                        onChange={(e) => setOpt((o) => ({ ...o, jpegQuality: Number(e.target.value) }))}
                                        right={opt.jpegQuality.toFixed(2)}
                                    />
                                </div>

                                <div className="mol-gap" />
                                <Toggle
                                    label="Only JPEG when safe (avoid alpha maps)"
                                    checked={opt.jpegOnlyIfSafe}
                                    disabled={busy || !opt.reencodeTextures || opt.reencodeMime !== "image/jpeg"}
                                    onChange={(e) => setOpt((o) => ({ ...o, jpegOnlyIfSafe: e.target.checked }))}
                                />
                            </div>

                            <div className="mol-gap" />
                            <div className="mol-pill" style={{ borderRadius: 16 }}>
                                <div style={{ fontWeight: 700, marginBottom: 8 }}>Strip texture types (export)</div>
                                <div className="mol-grid2" style={{ gap: 10 }}>
                                    {[
                                        ["Base color", "stripBaseColor"],
                                        ["Normal", "stripNormalMaps"],
                                        ["Metal/Rough", "stripMetalRoughMaps"],
                                        ["AO", "stripAOMaps"],
                                        ["Emissive", "stripEmissiveMaps"],
                                        ["Alpha", "stripAlphaMaps"],
                                        ["Environment", "stripEnvMaps"],
                                    ].map(([label, key]) => (
                                        <Toggle key={key} label={label} checked={!!opt[key]} disabled={busy} onChange={(e) => setOpt((o) => ({ ...o, [key]: e.target.checked }))} />
                                    ))}
                                </div>
                                <div className="mol-gap" />
                                <Toggle
                                    label="Visibility fix (avoid black/transparent exports)"
                                    checked={!!opt.visibilityFix}
                                    disabled={busy}
                                    onChange={(e) => setOpt((o) => ({ ...o, visibilityFix: e.target.checked }))}
                                />
                                <Toggle
                                    label="Force diffuse export (avoid black materials in other apps)"
                                    checked={!!opt.forceDiffuseExport}
                                    disabled={busy}
                                    onChange={(e) => setOpt((o) => ({ ...o, forceDiffuseExport: e.target.checked }))}
                                />
                                <Toggle
                                    label="Force opaque export (fix invisible materials)"
                                    checked={!!opt.forceOpaqueExport}
                                    disabled={busy}
                                    onChange={(e) => setOpt((o) => ({ ...o, forceOpaqueExport: e.target.checked }))}
                                />
                                <Toggle
                                    label="Force unlit export (guarantee visibility)"
                                    checked={!!opt.forceUnlitExport}
                                    disabled={busy}
                                    onChange={(e) => setOpt((o) => ({ ...o, forceUnlitExport: e.target.checked }))}
                                />
                                <Toggle
                                    label="NodeForge safe export (textures always visible)"
                                    checked={!!opt.nodeForgeSafeExport}
                                    disabled={busy}
                                    onChange={(e) => setOpt((o) => ({ ...o, nodeForgeSafeExport: e.target.checked }))}
                                />
                            </div>
                        </Card>

                        <Card
                            title="Activity"
                            subtitle="What the tool is doing"
                            right={<Btn variant="secondary" disabled={busy || logs.length === 0} onClick={() => setLogs([])}>Clear</Btn>}
                        >
                            <div className="mol-log">
                                {logs.length === 0 ? (
                                    <div className="mol-muted" style={{ fontSize: 12 }}>
                                        No activity yet.
                                    </div>
                                ) : (
                                    logs.map((l) => (
                                        <div key={l.t + l.msg} className="mol-logLine">
                                            <span className="mol-logTime">{new Date(l.t).toLocaleTimeString()}</span>
                                            {l.msg}
                                        </div>
                                    ))
                                )}
                            </div>
                        </Card>

                        <div className="mol-muted" style={{ fontSize: 12 }}>
                            Tip: for best compression (Draco/Meshopt/KTX2), run a glTF-Transform pipeline offline.
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}

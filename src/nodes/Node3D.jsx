// src/nodes/Node3D.jsx
import React, {memo, forwardRef, useEffect, useMemo, useRef, useState, useCallback} from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text, Text3D, Html } from "@react-three/drei";
import RackListView from "../ui/RackListView.jsx";

import GeometryForShape from "../geometry/GeometryForShape.jsx";
import { useGLTFResilient } from "../gltf/useGLTFResilient.js";
import helvetikerFont from "three/examples/fonts/helvetiker_regular.typeface.json";
import optimerFont from "three/examples/fonts/optimer_regular.typeface.json";
import gentilisFont from "three/examples/fonts/gentilis_regular.typeface.json";
import LightBounds from "../lights/LightBounds.jsx";
import { clusterColor } from "../utils/clusters.js";
import { getProductById, getRackById } from "../data/products/store.js";
import { buildBundledProductPicturesIndex, buildDiskProductPicturesIndex, hasFs as hasPicsFs, resolvePictureRef } from "../data/products/productPicturesIndex.js";
import NodeTextBox from "./NodeTextBox.jsx";

/* -------------------------------- helpers -------------------------------- */

function makeLabelSpriteTexture(text, color) {
    if (typeof document === "undefined") return null;
    const t = String(text ?? "").trim();
    if (!t) return null;
    const fontSize = 56;
    const padding = 18;
    const font = `700 ${fontSize}px system-ui, Segoe UI, sans-serif`;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.font = font;
    const metrics = ctx.measureText(t);
    const w = Math.min(1024, Math.max(128, Math.ceil(metrics.width + padding * 2)));
    const h = 128;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color || "#ffffff";
    ctx.fillText(t, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
}


// Build picture indices once per module (fast to resolve @pp/... refs in 3D)
const __BUNDLED_PICS_INDEX = buildBundledProductPicturesIndex();
let __DISK_PICS_INDEX = null;
let __DISK_PICS_ROOT = null;
function __getDiskPicsIndex() {
    try {
        if (!hasPicsFs()) return null;
        const root =
            localStorage.getItem("epic3d.productPictures.diskRoot.v1") ||
            localStorage.getItem("epic3d.productPicturesRoot.v1") ||
            "";
        if (!root) return null;
        if (root !== __DISK_PICS_ROOT) {
            __DISK_PICS_ROOT = root;
            __DISK_PICS_INDEX = buildDiskProductPicturesIndex(root);
        }
        return __DISK_PICS_INDEX;
    } catch {
        return null;
    }
}



function dirFromYawPitch(yawDeg = 0, pitchDeg = 0, basis = "forward") {
    const yaw = (Number(yawDeg) * Math.PI) / 180;
    const pitch = (Number(pitchDeg) * Math.PI) / 180;
    const e = new THREE.Euler(pitch, yaw, 0, "YXZ");

    // Historically this app used a DOWN (-Y) basis which made it impossible to aim upward.
    // New default basis is FORWARD (-Z), which behaves like a conventional yaw/pitch camera.
    const base = (String(basis).toLowerCase() === "down")
        ? new THREE.Vector3(0, -1, 0)
        : new THREE.Vector3(0, 0, -1);

    return base.applyEuler(e).normalize();
}

function parseVec3(v) {
    if (!v) return null;
    // Array form: [x,y,z]
    if (Array.isArray(v) && v.length >= 3) {
        const x = Number(v[0]);
        const y = Number(v[1]);
        const z = Number(v[2]);
        if ([x, y, z].every(Number.isFinite)) return [x, y, z];
        return null;
    }
    // Object form: {x,y,z}
    if (typeof v === "object") {
        const x = Number(v.x);
        const y = Number(v.y);
        const z = Number(v.z);
        if ([x, y, z].every(Number.isFinite)) return [x, y, z];
    }
    return null;
}




function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpColorString(a, b, t) {
    try {
        const c0 = new THREE.Color(a || "#ffffff");
        const c1 = new THREE.Color(b || a || "#ffffff");
        c0.lerp(c1, clamp01(t));
        return `#${c0.getHexString()}`;
    } catch {
        return a || "#ffffff";
    }
}
function Dim({ a, b, text, opacityMul = 1 }) {
    const op = clamp01(opacityMul);
    const geo = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute(
            "position",
            new THREE.BufferAttribute(new Float32Array([...a, ...b]), 3)
        );
        const count = g.attributes?.position?.count;
        if (Number.isFinite(count) && count > 0) g.setDrawRange(0, count);
        return g;
    }, [a[0], a[1], a[2], b[0], b[1], b[2]]);
    const mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];

    return (
        <group>
            <line geometry={geo}>
                <lineBasicMaterial transparent opacity={0.9 * op} />
            </line>
            <Billboard position={mid}>
                <Text
                    fontSize={0.08}
                    anchorX="center"
                    anchorY="middle"
                    outlineWidth={0.004}
                    outlineColor="#000"
                    material-transparent
                    material-opacity={op}
                >
                    {text}
                </Text>
            </Billboard>
        </group>
    );
}

function NodeShapeModel({
    url,
    scale = [1, 1, 1],
    opacity = 1,
    castShadow = true,
    receiveShadow = true,
}) {
    const { gltf } = useGLTFResilient(url ? { url } : null);
    const scene = useMemo(() => {
        if (!gltf?.scene) return null;
        return gltf.scene.clone(true);
    }, [gltf?.scene]);

    useEffect(() => {
        if (!scene) return;
        scene.traverse((obj) => {
            if (!(obj.isMesh || obj.isSkinnedMesh)) return;
            obj.castShadow = !!castShadow;
            obj.receiveShadow = !!receiveShadow;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of mats) {
                if (!m) continue;
                if (opacity < 0.999) m.transparent = true;
                m.opacity = opacity;
                m.depthWrite = opacity >= 0.999;
                m.needsUpdate = true;
            }
        });
    }, [scene, opacity, castShadow, receiveShadow]);

    if (!scene) return null;

    return (
        <group scale={scale}>
            <primitive object={scene} />
        </group>
    );
}

function pickShapeColor(shape, key, fallback) {
    const colors = shape?.colors || {};
    const direct = shape?.[`${key}Color`];
    return direct || colors[key] || fallback;
}

const LAVIE_FONTS = {
    helvetiker: helvetikerFont,
    optimer: optimerFont,
    gentilis: gentilisFont,
};

function buildRoundedRectGeometry(width, height, depth, cornerRadius) {
    const w = Math.max(0.001, Number(width) || 0.001);
    const h = Math.max(0.001, Number(height) || 0.001);
    const d = Math.max(0.001, Number(depth) || 0.001);
    const maxCorner = Math.min(w, h) * 0.5;
    const corner = Math.max(0.001, Math.min(Number(cornerRadius) || 0, maxCorner));
    const hw = w * 0.5;
    const hh = h * 0.5;
    const r = Math.min(corner, hw, hh);
    const s = new THREE.Shape();
    s.moveTo(-hw + r, -hh);
    s.lineTo(hw - r, -hh);
    s.quadraticCurveTo(hw, -hh, hw, -hh + r);
    s.lineTo(hw, hh - r);
    s.quadraticCurveTo(hw, hh, hw - r, hh);
    s.lineTo(-hw + r, hh);
    s.quadraticCurveTo(-hw, hh, -hw, hh - r);
    s.lineTo(-hw, -hh + r);
    s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.center();
    return g;
}

function NodeShapeAdvanced({
    shape,
    baseColor,
    opacity = 1,
    castShadow = true,
    receiveShadow = true,
}) {
    const tRaw = (shape?.type || "").toLowerCase();
    const tAliases = {
        transmitter: "sphere",
        receiver: "sphere",
        mediahub: "box",
        lansocket: "switch",
        "lan-socket": "switch",
        "lan_socket": "switch",
        speakerfloor: "speaker",
        "speaker-floor": "speaker",
        "speaker_floor": "speaker",
        rack: "rack",
    };
    const t = tAliases[tRaw] || tRaw;
    const scaleVec = useMemo(() => {
        const raw = shape?.scale;
        if (Array.isArray(raw)) {
            const x = Number(raw[0]) || 1;
            const y = Number(raw[1]) || 1;
            const z = Number(raw[2]) || 1;
            return [x, y, z];
        }
        const s = Number(raw);
        if (Number.isFinite(s) && s > 0) return [s, s, s];
        return [1, 1, 1];
    }, [shape?.scale]);
    const matProps = {
        transparent: opacity < 0.999,
        opacity,
        depthWrite: opacity >= 0.999,
    };
    const bodyColor = pickShapeColor(shape, "body", baseColor || "#6ee7d8");
    const frameColor = pickShapeColor(shape, "frame", baseColor || "#1f2937");
    const screenColor = pickShapeColor(shape, "screen", "#0f172a");
    const buttonColor = pickShapeColor(shape, "buttons", "#94a3b8");
    const overlapColor = pickShapeColor(shape, "overlap", "#38bdf8");
    const bezelColor = pickShapeColor(shape, "bezel", "#111827");
    const tvDims = useMemo(() => {
        if (t !== "tv") return null;
        const w = shape.w ?? 1.1;
        const h = shape.h ?? 0.7;
        const d = shape.d ?? 0.02;
        const frame = Math.max(0, shape.frame ?? 0.05);
        const maxScreenW = Math.max(0.05, w - frame * 2);
        const maxScreenH = Math.max(0.05, h - frame * 2);
        const screenW = Math.min(maxScreenW, shape.screenW ?? maxScreenW);
        const screenH = Math.min(maxScreenH, shape.screenH ?? maxScreenH);
        const screenD = Math.min(
            Math.max(0.001, shape.screenD ?? d * 0.25),
            Math.max(0.001, d * 0.95),
        );
        const screenInset = Math.min(Math.max(0, shape.screenInset ?? 0.004), d * 0.5);
        const corner = Math.max(
            0,
            Math.min(shape.cornerRadius ?? 0, Math.min(w, h) * 0.45),
        );
        return { w, h, d, frame, screenW, screenH, screenD, screenInset, corner };
    }, [
        t,
        shape.w,
        shape.h,
        shape.d,
        shape.frame,
        shape.screenW,
        shape.screenH,
        shape.screenD,
        shape.screenInset,
        shape.cornerRadius,
    ]);
    const tvFrameGeom = useMemo(() => {
        if (!tvDims) return null;
        if (!(tvDims.corner > 0)) return null;
        return buildRoundedRectGeometry(tvDims.w, tvDims.h, tvDims.d, tvDims.corner);
    }, [tvDims?.w, tvDims?.h, tvDims?.d, tvDims?.corner]);
    const ipadDims = useMemo(() => {
        if (t !== "ipad") return null;
        const w = shape.w ?? 0.5;
        const h = shape.h ?? 0.7;
        const d = shape.d ?? 0.04;
        const bezel = shape.bezel ?? 0.04;
        const corner = Math.max(0.005, Math.min(shape.cornerRadius ?? 0.06, Math.min(w, h) * 0.25));
        const screenW = Math.max(0.05, shape.screenW ?? (w - bezel * 2));
        const screenH = Math.max(0.05, shape.screenH ?? (h - bezel * 2));
        const screenD = Math.max(0.003, shape.screenD ?? d * 0.2);
        const screenInset = Math.min(Math.max(0, shape.screenInset ?? 0.004), d * 0.5);
        const screenOffsetZ = Number(shape.screenOffsetZ ?? 0) || 0;
        const maxScreenCorner = Math.min(screenW, screenH) * 0.25;
        const defaultScreenCorner = Math.max(0.003, Math.min(corner - bezel * 0.4, maxScreenCorner));
        const screenCorner = Math.max(
            0.003,
            Math.min(shape.screenCornerRadius ?? defaultScreenCorner, maxScreenCorner),
        );
        const baseZ = d * 0.5 - screenD * 0.5 - screenInset + screenOffsetZ;
        const screenZ = baseZ;
        return {
            w,
            h,
            d,
            bezel,
            corner,
            screenW,
            screenH,
            screenD,
            screenCorner,
            screenInset,
            screenOffsetZ,
            screenZ,
        };
    }, [
        t,
        shape.w,
        shape.h,
        shape.d,
        shape.bezel,
        shape.cornerRadius,
        shape.screenW,
        shape.screenH,
        shape.screenD,
        shape.screenInset,
        shape.screenOffsetZ,
        shape.screenCornerRadius,
    ]);
    const ipadGeom = useMemo(() => {
        if (!ipadDims) return null;
        return buildRoundedRectGeometry(ipadDims.w, ipadDims.h, ipadDims.d, ipadDims.corner);
    }, [ipadDims?.w, ipadDims?.h, ipadDims?.d, ipadDims?.corner]);
    const ipadScreenGeom = useMemo(() => {
        if (!ipadDims) return null;
        return buildRoundedRectGeometry(
            ipadDims.screenW,
            ipadDims.screenH,
            ipadDims.screenD,
            ipadDims.screenCorner,
        );
    }, [ipadDims?.screenW, ipadDims?.screenH, ipadDims?.screenD, ipadDims?.screenCorner]);

    if (t === "tv") {
        const w = tvDims?.w ?? 1.1;
        const h = tvDims?.h ?? 0.7;
        const d = tvDims?.d ?? 0.02;
        const screenW = tvDims?.screenW ?? 1;
        const screenH = tvDims?.screenH ?? 0.63;
        const screenD = tvDims?.screenD ?? Math.max(0.001, d * 0.25);
        const screenInset = tvDims?.screenInset ?? 0.004;
        const frameOffsetX = Number(shape.frameOffsetX ?? 0) || 0;
        const frameOffsetY = Number(shape.frameOffsetY ?? 0) || 0;
        const frameOffsetZ = Number(shape.frameOffsetZ ?? 0) || 0;
        const screenOffsetX = Number(shape.screenOffsetX ?? 0) || 0;
        const screenOffsetY = Number(shape.screenOffsetY ?? 0) || 0;
        const screenOffsetZ = Number(shape.screenOffsetZ ?? 0) || 0;
        const screenBias = Math.max(0.0005, d * 0.02);
        const screenDepth = Math.max(0.001, screenD);
        const screenPosZ = d * 0.5 - screenDepth * 0.5 - screenInset - screenBias + screenOffsetZ;
        const frontDepth = Math.max(0.001, screenDepth * 0.35);
        const frontZ = screenPosZ + screenDepth * 0.5 - frontDepth * 0.5 + 0.0005;
        const hideScreen = !!shape.hideScreen;
        return (
            <group scale={scaleVec}>
                <mesh
                    position={[frameOffsetX, frameOffsetY, frameOffsetZ]}
                    castShadow={castShadow}
                    receiveShadow={receiveShadow}
                >
                    {tvFrameGeom ? (
                        <primitive object={tvFrameGeom} attach="geometry" />
                    ) : (
                        <boxGeometry args={[w, h, d]} />
                    )}
                    <meshStandardMaterial
                        color={frameColor}
                        roughness={0.45}
                        metalness={0.15}
                        emissive={frameColor}
                        emissiveIntensity={0.08}
                        {...matProps}
                    />
                </mesh>
                {!hideScreen && (
                    <>
                        <mesh
                            position={[screenOffsetX, screenOffsetY, screenPosZ]}
                            castShadow={castShadow}
                            receiveShadow={receiveShadow}
                        >
                            <boxGeometry args={[screenW, screenH, screenDepth]} />
                            <meshStandardMaterial
                                color={screenColor}
                                roughness={0.35}
                                metalness={0.25}
                                emissive={screenColor}
                                emissiveIntensity={0.18}
                                {...matProps}
                            />
                        </mesh>
                        <mesh
                            position={[screenOffsetX, screenOffsetY, frontZ]}
                            castShadow={castShadow}
                            receiveShadow={receiveShadow}
                        >
                            <boxGeometry args={[screenW, screenH, frontDepth]} />
                            <meshStandardMaterial
                                color={screenColor}
                                roughness={0.2}
                                metalness={0.35}
                                emissive={screenColor}
                                emissiveIntensity={0.35}
                                {...matProps}
                            />
                        </mesh>
                    </>
                )}
            </group>
        );
    }

    if (t === "remote") {
        const w = shape.w ?? 0.16;
        const h = shape.h ?? 0.55;
        const d = Math.max(0.001, shape.d ?? 0.05);
        const corner = Math.max(0, Math.min(shape.cornerRadius ?? 0, Math.min(w, h) * 0.45));
        const accentH = Math.max(0.04, shape.accentH ?? h * 0.35);
        const accentW = Math.max(0.05, shape.accentW ?? w * 0.75);
        const accentD = Math.max(0.001, shape.accentD ?? d * 0.18);
        const accentOffsetY = Number(shape.accentOffsetY ?? -0.15) || 0;
        const accentOffsetZ = Number(shape.accentOffsetZ ?? -0.03) || 0;
        const screenW = Math.max(0.04, shape.screenW ?? 0.13);
        const screenH = Math.max(0.04, shape.screenH ?? 0.14);
        const screenD = Math.max(0.001, shape.screenD ?? 0);
        const screenOffsetY = Number(shape.screenOffsetY ?? 0.19) || 0;
        const screenOffsetZ = Number(shape.screenOffsetZ ?? -0.025) || 0;
        const showScreen = shape.showScreen ?? true;
        const dockEnabled = !!shape.dockEnabled;
        const dockRadius = Math.max(0.08, shape.dockRadius ?? 0.18);
        const dockHeight = Math.max(0.02, shape.dockHeight ?? 0.045);
        const dockMidRadius = Math.max(0.04, shape.dockMidRadius ?? 0.19);
        const dockMidHeight = Math.max(0.01, shape.dockMidHeight ?? 0.025);
        const dockInnerRadius = Math.max(0.02, shape.dockInnerRadius ?? 0.12);
        const dockInnerHeight = Math.max(0.005, shape.dockInnerHeight ?? 0.07);
        const dockOffsetY = Number(shape.dockOffsetY ?? (-h * 0.5 - dockHeight * 0.5 - 0.01)) || 0;
        const dockOffsetZ = Number(shape.dockOffsetZ ?? 0) || 0;
        const dockBaseColor = pickShapeColor(shape, "dockBase", "#0f172a");
        const dockMidColor = pickShapeColor(shape, "dockMid", "#1f2937");
        const dockInnerColor = pickShapeColor(shape, "dockInner", "#334155");
        const remoteGeom = corner > 0 ? buildRoundedRectGeometry(w, h, d, corner) : null;
        return (
            <group scale={scaleVec}>
                <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
                    {remoteGeom ? (
                        <primitive object={remoteGeom} attach="geometry" />
                    ) : (
                        <boxGeometry args={[w, h, d]} />
                    )}
                    <meshStandardMaterial
                        color={bodyColor}
                        roughness={0.5}
                        metalness={0.15}
                        emissive={bodyColor}
                        emissiveIntensity={0.06}
                        {...matProps}
                    />
                </mesh>
                <mesh
                    position={[
                        0,
                        h * 0.15 + accentOffsetY,
                        d * 0.5 - accentD * 0.5 - 0.004 + accentOffsetZ,
                    ]}
                    castShadow={castShadow}
                    receiveShadow={receiveShadow}
                >
                    <boxGeometry args={[accentW, accentH, accentD]} />
                    <meshStandardMaterial
                        color={buttonColor}
                        roughness={0.35}
                        metalness={0.2}
                        emissive={buttonColor}
                        emissiveIntensity={0.12}
                        {...matProps}
                    />
                </mesh>
                {showScreen && (
                    <mesh
                        position={[0, screenOffsetY, screenOffsetZ]}
                        castShadow={castShadow}
                        receiveShadow={receiveShadow}
                    >
                        <boxGeometry args={[screenW, screenH, screenD]} />
                        <meshStandardMaterial
                            color={screenColor}
                            roughness={0.25}
                            metalness={0.25}
                            emissive={screenColor}
                            emissiveIntensity={0.35}
                            {...matProps}
                        />
                    </mesh>
                )}
                {dockEnabled && (
                    <group position={[0, dockOffsetY, dockOffsetZ]}>
                        <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
                            <cylinderGeometry args={[dockRadius, dockRadius, dockHeight, 48]} />
                            <meshStandardMaterial
                                color={dockBaseColor}
                                roughness={0.5}
                                metalness={0.1}
                                emissive={dockBaseColor}
                                emissiveIntensity={0.05}
                                {...matProps}
                            />
                        </mesh>
                        <mesh position={[0, dockHeight * 0.15, 0]} castShadow={castShadow} receiveShadow={receiveShadow}>
                            <cylinderGeometry args={[dockMidRadius, dockMidRadius, dockMidHeight, 48]} />
                            <meshStandardMaterial
                                color={dockMidColor}
                                roughness={0.45}
                                metalness={0.1}
                                emissive={dockMidColor}
                                emissiveIntensity={0.05}
                                {...matProps}
                            />
                        </mesh>
                        <mesh position={[0, dockHeight * 0.25, 0]} castShadow={castShadow} receiveShadow={receiveShadow}>
                            <cylinderGeometry args={[dockInnerRadius, dockInnerRadius, dockInnerHeight, 48]} />
                            <meshStandardMaterial
                                color={dockInnerColor}
                                roughness={0.35}
                                metalness={0.1}
                                emissive={dockInnerColor}
                                emissiveIntensity={0.08}
                                {...matProps}
                            />
                        </mesh>
                    </group>
                )}
            </group>
        );
    }

    if (t === "accesspoint") {
        const r = shape.radius ?? 0.35;
        const h = shape.height ?? 0.12;
        const overlapSpread = Math.max(0, Number(shape.overlapSpread ?? 1) || 0);
        const overlapHeight = Math.max(0.004, shape.overlapHeight ?? h * 0.2);
        const overlapRadius = Math.max(0.02, r * overlapSpread);
        return (
            <group scale={scaleVec}>
                <mesh
                    position={[0, h * 0.5, 0]}
                    scale={[1, h / r, 1]}
                    castShadow={castShadow}
                    receiveShadow={receiveShadow}
                >
                    <sphereGeometry args={[r, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
                    <meshStandardMaterial
                        color={bodyColor}
                        roughness={0.45}
                        metalness={0.05}
                        emissive={bodyColor}
                        emissiveIntensity={0.05}
                        {...matProps}
                    />
                </mesh>
                <mesh
                    position={[0, overlapHeight * 0.5 + 0.001, 0]}
                    castShadow={castShadow}
                    receiveShadow={receiveShadow}
                >
                    <cylinderGeometry args={[overlapRadius, overlapRadius, overlapHeight, 48]} />
                    <meshStandardMaterial
                        color={overlapColor}
                        roughness={0.4}
                        metalness={0.1}
                        emissive={overlapColor}
                        emissiveIntensity={0.12}
                        {...matProps}
                    />
                </mesh>
                <mesh
                    position={[0, h * 0.5, 0]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    castShadow={castShadow}
                    receiveShadow={receiveShadow}
                >
                    <circleGeometry args={[r, 48]} />
                    <meshStandardMaterial
                        color={bodyColor}
                        roughness={0.45}
                        metalness={0.05}
                        emissive={bodyColor}
                        emissiveIntensity={0.05}
                        {...matProps}
                    />
                </mesh>
            </group>
        );
    }

    if (t === "amplifier") {
        const w = shape.w ?? 0.8;
        const d = shape.d ?? 0.4;
        const baseH = shape.baseH ?? 0.18;
        const mH = shape.midH ?? 0.16;
        const tH = shape.topH ?? 0.12;
        const baseW = shape.baseW ?? w;
        const baseD = shape.baseD ?? d;
        const midW = shape.midW ?? w * 0.92;
        const midD = shape.midD ?? d * 0.92;
        const topW = shape.topW ?? w * 0.88;
        const topD = shape.topD ?? d * 0.88;
        const baseCorner = Math.max(0, Math.min(shape.baseCorner ?? 0, Math.min(baseW, baseD) * 0.45));
        const midCorner = Math.max(0, Math.min(shape.midCorner ?? 0, Math.min(midW, midD) * 0.45));
        const topCorner = Math.max(0, Math.min(shape.topCorner ?? 0, Math.min(topW, topD) * 0.45));
        const baseY = baseH * 0.5;
        const midY = baseH + mH * 0.5;
        const topY = baseH + mH + tH * 0.5;
        const displayW = shape.displayW ?? topW * 0.7;
        const displayH = shape.displayH ?? tH * 0.35;
        const displayD = shape.displayD ?? Math.max(0.003, tH * 0.12);
        const displayOffsetX = Number(shape.displayOffsetX ?? 0) || 0;
        const displayOffsetY = Number(shape.displayOffsetY ?? tH * 0.1) || 0;
        const displayOffsetZ = Number(shape.displayOffsetZ ?? (topD * 0.5 - displayD * 0.5 - 0.004)) || 0;
        const knobR = shape.knobR ?? Math.min(baseH, baseW) * 0.12;
        const knobD = shape.knobD ?? Math.max(0.01, baseD * 0.08);
        const knobOffsetX = Number(shape.knobOffsetX ?? (-baseW * 0.3)) || 0;
        const knobOffsetY = Number(shape.knobOffsetY ?? (-baseH * 0.15)) || 0;
        const knobOffsetZ = Number(shape.knobOffsetZ ?? (baseD * 0.5 + knobD * 0.5 - 0.002)) || 0;
        const baseColor = pickShapeColor(shape, "base", "#0f172a");
        const midColor = pickShapeColor(shape, "mid", "#111827");
        const topColor = pickShapeColor(shape, "top", "#1f2937");
        const displayColor = pickShapeColor(shape, "display", "#38bdf8");
        const knobColor = pickShapeColor(shape, "knob", "#e2e8f0");
        const baseGeom = baseCorner > 0 ? buildRoundedRectGeometry(baseW, baseH, baseD, baseCorner) : null;
        const midGeom = midCorner > 0 ? buildRoundedRectGeometry(midW, mH, midD, midCorner) : null;
        const topGeom = topCorner > 0 ? buildRoundedRectGeometry(topW, tH, topD, topCorner) : null;
        return (
            <group scale={scaleVec}>
                <mesh position={[0, baseY, 0]} castShadow={castShadow} receiveShadow={receiveShadow}>
                    {baseGeom ? <primitive object={baseGeom} attach="geometry" /> : <boxGeometry args={[baseW, baseH, baseD]} />}
                    <meshStandardMaterial
                        color={baseColor}
                        roughness={0.5}
                        metalness={0.15}
                        emissive={baseColor}
                        emissiveIntensity={0.04}
                        {...matProps}
                    />
                </mesh>
                <mesh position={[0, midY, 0]} castShadow={castShadow} receiveShadow={receiveShadow}>
                    {midGeom ? <primitive object={midGeom} attach="geometry" /> : <boxGeometry args={[midW, mH, midD]} />}
                    <meshStandardMaterial
                        color={midColor}
                        roughness={0.5}
                        metalness={0.12}
                        emissive={midColor}
                        emissiveIntensity={0.04}
                        {...matProps}
                    />
                </mesh>
                <mesh position={[0, topY, 0]} castShadow={castShadow} receiveShadow={receiveShadow}>
                    {topGeom ? <primitive object={topGeom} attach="geometry" /> : <boxGeometry args={[topW, tH, topD]} />}
                    <meshStandardMaterial
                        color={topColor}
                        roughness={0.5}
                        metalness={0.12}
                        emissive={topColor}
                        emissiveIntensity={0.04}
                        {...matProps}
                    />
                </mesh>
                <mesh
                    position={[displayOffsetX, topY + displayOffsetY, displayOffsetZ]}
                    castShadow={castShadow}
                    receiveShadow={receiveShadow}
                >
                    <boxGeometry args={[displayW, displayH, displayD]} />
                    <meshStandardMaterial
                        color={displayColor}
                        roughness={0.2}
                        metalness={0.4}
                        emissive={displayColor}
                        emissiveIntensity={0.5}
                        {...matProps}
                    />
                </mesh>
                <mesh
                    position={[knobOffsetX, baseY + knobOffsetY, knobOffsetZ]}
                    rotation={[Math.PI / 2, 0, 0]}
                    castShadow={castShadow}
                    receiveShadow={receiveShadow}
                >
                    <cylinderGeometry args={[knobR, knobR, knobD, 32]} />
                    <meshStandardMaterial
                        color={knobColor}
                        roughness={0.4}
                        metalness={0.35}
                        emissive={knobColor}
                        emissiveIntensity={0.05}
                        {...matProps}
                    />
                </mesh>
            </group>
        );
    }

    if (t === "laviebox") {
        const w = shape.w ?? 0.8;
        const h = shape.h ?? 0.4;
        const d = shape.d ?? 0.35;
        const corner = Math.max(0, Math.min(shape.cornerRadius ?? 0, Math.min(w, d) * 0.45));
        const bodyGeom = corner > 0 ? buildRoundedRectGeometry(w, h, d, corner) : null;
        const panelEnabled = !!shape.panelEnabled;
        const panelW = shape.panelW ?? w * 0.9;
        const panelH = shape.panelH ?? h * 0.6;
        const panelD = Math.max(0.01, shape.panelD ?? d * 0.08);
        const panelOffsetX = Number(shape.panelOffsetX ?? 0) || 0;
        const panelOffsetY = Number(shape.panelOffsetY ?? 0) || 0;
        const panelOffsetZ = Number(shape.panelOffsetZ ?? (d * 0.5 - panelD * 0.5 - 0.002)) || 0;
        const holeMode = (shape.holeMode || "circle").toLowerCase();
        const holeCountX = Math.max(1, Math.floor(Number(shape.holeCountX ?? 4) || 4));
        const holeCountY = Math.max(1, Math.floor(Number(shape.holeCountY ?? 3) || 3));
        const holeSize = Math.max(0.005, shape.holeSize ?? Math.min(panelW, panelH) * 0.08);
        const holeDepth = Math.max(0.001, shape.holeDepth ?? panelD * 0.7);
        const holePadding = Math.max(0, shape.holePadding ?? 0.01);
        const holeColor = pickShapeColor(shape, "holes", "#0b1220");
        const textEnabled = !!shape.textEnabled;
        const textValue = shape.textValue ?? "LAVIE";
        const textSize = Math.max(0.02, shape.textSize ?? 0.12);
        const textDepth = Math.max(0.002, shape.textDepth ?? 0.02);
        const textColor = pickShapeColor(shape, "text", "#e2e8f0");
        const textFontKey = (shape.textFont || "helvetiker").toLowerCase();
        const textFont = LAVIE_FONTS[textFontKey] || helvetikerFont;
        const textSide = (shape.textSide || "front").toLowerCase();
        const textOffsetX = Number(shape.textOffsetX ?? 0) || 0;
        const textOffsetY = Number(shape.textOffsetY ?? 0) || 0;
        const textOffsetZ = Number(shape.textOffsetZ ?? 0) || 0;
        const ledBoxEnabled = !!shape.ledBoxEnabled;
        const ledBoxW = shape.ledBoxW ?? w * 0.6;
        const ledBoxH = shape.ledBoxH ?? h * 0.2;
        const ledBoxD = shape.ledBoxD ?? d * 0.1;
        const ledBoxOffsetX = Number(shape.ledBoxOffsetX ?? 0) || 0;
        const ledBoxOffsetY = Number(shape.ledBoxOffsetY ?? (-h * 0.2)) || 0;
        const ledBoxOffsetZ = Number(shape.ledBoxOffsetZ ?? (d * 0.5 - ledBoxD * 0.5 - 0.002)) || 0;
        const ledEnabled = !!shape.ledEnabled;
        const ledColor = pickShapeColor(shape, "led", "#38bdf8");
        const ledIntensityRaw = Number(shape.ledIntensity);
        const ledIntensity = Number.isFinite(ledIntensityRaw) ? ledIntensityRaw : 1.4;
        const ledStripH = Math.max(0.002, shape.ledStripH ?? ledBoxH * 0.35);
        const ledStripW = Math.max(0.01, shape.ledStripW ?? ledBoxW * 0.9);
        const ledStripD = Math.max(0.002, shape.ledStripD ?? ledBoxD * 0.3);
        const ledStripOffsetY = Number(shape.ledStripOffsetY ?? 0) || 0;
        const ledStripOffsetZ = Number(shape.ledStripOffsetZ ?? 0) || 0;
        const panelHolePositions = [];
        if (panelEnabled) {
            const usableW = Math.max(0.01, panelW - holePadding * 2);
            const usableH = Math.max(0.01, panelH - holePadding * 2);
            const stepX = holeCountX > 1 ? usableW / (holeCountX - 1) : 0;
            const stepY = holeCountY > 1 ? usableH / (holeCountY - 1) : 0;
            for (let y = 0; y < holeCountY; y += 1) {
                const rowOffset = holeMode === "honeycomb" ? (y % 2 === 0 ? 0 : stepX * 0.5) : 0;
                for (let x = 0; x < holeCountX; x += 1) {
                    const px = -usableW * 0.5 + stepX * x + rowOffset;
                    const py = -usableH * 0.5 + stepY * y;
                    if (Math.abs(px) <= usableW * 0.55) panelHolePositions.push([px, py]);
                }
            }
        }
        const textPlacement = (() => {
            const halfW = w * 0.5;
            const halfH = h * 0.5;
            const halfD = d * 0.5;
            if (textSide === "back") return { pos: [textOffsetX, textOffsetY, -halfD - textDepth * 0.5 + textOffsetZ], rot: [0, Math.PI, 0] };
            if (textSide === "left") return { pos: [-halfW - textDepth * 0.5 + textOffsetZ, textOffsetY, textOffsetX], rot: [0, -Math.PI / 2, 0] };
            if (textSide === "right") return { pos: [halfW + textDepth * 0.5 + textOffsetZ, textOffsetY, -textOffsetX], rot: [0, Math.PI / 2, 0] };
            if (textSide === "top") return { pos: [textOffsetX, halfH + textDepth * 0.5 + textOffsetZ, textOffsetY], rot: [-Math.PI / 2, 0, 0] };
            if (textSide === "bottom") return { pos: [textOffsetX, -halfH - textDepth * 0.5 + textOffsetZ, -textOffsetY], rot: [Math.PI / 2, 0, 0] };
            return { pos: [textOffsetX, textOffsetY, halfD + textDepth * 0.5 + textOffsetZ], rot: [0, 0, 0] };
        })();
        return (
            <group scale={scaleVec}>
                <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
                    {bodyGeom ? <primitive object={bodyGeom} attach="geometry" /> : <boxGeometry args={[w, h, d]} />}
                    <meshStandardMaterial
                        color={bodyColor}
                        roughness={0.5}
                        metalness={0.1}
                        emissive={bodyColor}
                        emissiveIntensity={0.04}
                        {...matProps}
                    />
                </mesh>
                {panelEnabled && (
                    <group position={[panelOffsetX, panelOffsetY, panelOffsetZ]}>
                        <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
                            <boxGeometry args={[panelW, panelH, panelD]} />
                            <meshStandardMaterial
                                color={pickShapeColor(shape, "panel", "#1f2937")}
                                roughness={0.55}
                                metalness={0.1}
                                emissive={pickShapeColor(shape, "panel", "#1f2937")}
                                emissiveIntensity={0.04}
                                {...matProps}
                            />
                        </mesh>
                        {panelHolePositions.map(([px, py], idx) => (
                            <mesh
                                key={`h${idx}`}
                                position={[px, py, panelD * 0.5 - holeDepth * 0.5 - 0.001]}
                                rotation={[Math.PI / 2, 0, 0]}
                                castShadow={castShadow}
                                receiveShadow={receiveShadow}
                            >
                                <cylinderGeometry args={[holeSize, holeSize, holeDepth, holeMode === "honeycomb" ? 6 : 18]} />
                                <meshStandardMaterial
                                    color={holeColor}
                                    roughness={0.7}
                                    metalness={0}
                                    emissive={holeColor}
                                    emissiveIntensity={0.02}
                                    {...matProps}
                                />
                            </mesh>
                        ))}
                    </group>
                )}
                {ledBoxEnabled && (
                    <group position={[ledBoxOffsetX, ledBoxOffsetY, ledBoxOffsetZ]}>
                        <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
                            <boxGeometry args={[ledBoxW, ledBoxH, ledBoxD]} />
                            <meshStandardMaterial
                                color={pickShapeColor(shape, "ledBox", "#111827")}
                                roughness={0.4}
                                metalness={0.1}
                                emissive={pickShapeColor(shape, "ledBox", "#111827")}
                                emissiveIntensity={0.03}
                                {...matProps}
                            />
                        </mesh>
                        {ledEnabled && (
                            <mesh position={[0, ledStripOffsetY, ledStripOffsetZ]}>
                                <boxGeometry args={[ledStripW, ledStripH, ledStripD]} />
                                <meshStandardMaterial
                                    color={ledColor}
                                    emissive={ledColor}
                                    emissiveIntensity={ledIntensity}
                                    roughness={0.2}
                                    metalness={0.2}
                                    {...matProps}
                                />
                            </mesh>
                        )}
                    </group>
                )}
                {textEnabled && (
                    <group position={textPlacement.pos} rotation={textPlacement.rot}>
                        <Text3D font={textFont} size={textSize} height={textDepth} curveSegments={6}>
                            {String(textValue)}
                            <meshStandardMaterial
                                color={textColor}
                                roughness={0.35}
                                metalness={0.15}
                                emissive={textColor}
                                emissiveIntensity={0.08}
                                {...matProps}
                            />
                        </Text3D>
                    </group>
                )}
            </group>
        );
    }

    if (t === "subwoofer") {
        const w = shape.w ?? 0.7;
        const h = shape.h ?? 0.7;
        const d = shape.d ?? 0.5;
        const corner = Math.max(0, Math.min(shape.cornerRadius ?? 0.06, Math.min(w, d) * 0.45));
        const frontDepth = Math.max(0.005, Math.min(shape.frontDepth ?? d, d));
        const bodyGeom = corner > 0 ? buildRoundedRectGeometry(w, h, frontDepth, corner) : null;
        const driverRadius = Math.max(0.05, shape.driverRadius ?? Math.min(w, h) * 0.32);
        const driverDepth = Math.max(0.005, shape.driverDepth ?? frontDepth * 0.12);
        const driverInset = Math.max(0.001, shape.driverInset ?? 0.01);
        const portRadius = Math.max(0.02, shape.portRadius ?? driverRadius * 0.18);
        const portOffsetY = Number(shape.portOffsetY ?? -h * 0.22) || -h * 0.22;
        const bodyColorLocal = pickShapeColor(shape, "body", baseColor || "#0f172a");
        const driverColor = pickShapeColor(shape, "driver", "#111827");
        const ringColor = pickShapeColor(shape, "driverRing", "#0b1220");
        const portColor = pickShapeColor(shape, "port", "#0b1220");
        const driverFaceZ = frontDepth * 0.5 + 0.0015;
        return (
            <group scale={scaleVec}>
                <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
                    {bodyGeom ? <primitive object={bodyGeom} attach="geometry" /> : <boxGeometry args={[w, h, frontDepth]} />}
                    <meshStandardMaterial
                        color={bodyColorLocal}
                        roughness={0.55}
                        metalness={0.1}
                        emissive={bodyColorLocal}
                        emissiveIntensity={0.03}
                        {...matProps}
                    />
                </mesh>
                <group position={[0, 0.05, driverFaceZ]}>
                    <mesh position={[0, 0, 0.0015]} castShadow={false} receiveShadow={false}>
                        <ringGeometry args={[driverRadius * 0.7, driverRadius * 1.05, 48]} />
                        <meshStandardMaterial
                            color={ringColor}
                            roughness={0.55}
                            metalness={0.08}
                            emissive={ringColor}
                            emissiveIntensity={0.04}
                            {...matProps}
                        />
                    </mesh>
                    <mesh castShadow={false} receiveShadow={false}>
                        <circleGeometry args={[driverRadius, 48]} />
                        <meshStandardMaterial
                            color={driverColor}
                            roughness={0.35}
                            metalness={0.1}
                            emissive={driverColor}
                            emissiveIntensity={0.06}
                            {...matProps}
                        />
                    </mesh>
                    <mesh position={[0, 0, 0.0035]} castShadow={false} receiveShadow={false}>
                        <ringGeometry args={[driverRadius * 0.35, driverRadius * 0.55, 40]} />
                        <meshStandardMaterial
                            color={ringColor}
                            roughness={0.6}
                            metalness={0.05}
                            emissive={ringColor}
                            emissiveIntensity={0.04}
                            {...matProps}
                        />
                    </mesh>
                </group>
                <mesh position={[0, portOffsetY, driverFaceZ]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[portRadius, portRadius, driverDepth * 1.6, 24]} />
                    <meshStandardMaterial
                        color={portColor}
                        roughness={0.8}
                        metalness={0.05}
                        emissive={portColor}
                        emissiveIntensity={0.03}
                        {...matProps}
                    />
                </mesh>
            </group>
        );
    }

    if (t === "rack") {
        const w = shape.w ?? 0.6;
        const h = shape.h ?? 1.8;
        const d = shape.d ?? 0.6;
        const bar = Math.max(0.01, shape.bar ?? 0.04);
        const rail = Math.max(0.01, shape.rail ?? 0.03);
        const columns = Math.max(1, Math.floor(shape.columns ?? 1));
        const colGap = Math.max(0.02, shape.columnGap ?? Math.max(0.08, w * 0.2));
        const hw = w * 0.5;
        const hh = h * 0.5;
        const hd = d * 0.5;
        const postPositions = [
            [-hw + bar * 0.5, 0, -hd + bar * 0.5],
            [hw - bar * 0.5, 0, -hd + bar * 0.5],
            [-hw + bar * 0.5, 0, hd - bar * 0.5],
            [hw - bar * 0.5, 0, hd - bar * 0.5],
        ];
        const topY = hh - rail * 0.5;
        const botY = -hh + rail * 0.5;
        const widthRailW = Math.max(0.01, w - bar * 2);
        const depthRailD = Math.max(0.01, d - bar * 2);
        const totalW = columns * w + (columns - 1) * colGap;
        const baseX = -totalW * 0.5 + w * 0.5;
        return (
            <group scale={scaleVec}>
                {Array.from({ length: columns }).map((_, col) => {
                    const x = baseX + col * (w + colGap);
                    return (
                        <group key={`rack-col-${col}`} position={[x, 0, 0]}>
                            {postPositions.map((pos, idx) => (
                                <mesh key={`rack-post-${col}-${idx}`} position={pos} castShadow={castShadow} receiveShadow={receiveShadow}>
                                    <boxGeometry args={[bar, h, bar]} />
                                    <meshStandardMaterial
                                        color={frameColor}
                                        roughness={0.35}
                                        metalness={0.15}
                                        emissive={frameColor}
                                        emissiveIntensity={0.08}
                                        {...matProps}
                                    />
                                </mesh>
                            ))}
                            {[-topY, topY].map((y, i) => (
                                <group key={`rack-rails-${col}-${i}`} position={[0, y, 0]}>
                                    <mesh position={[0, 0, -hd + bar * 0.5]} castShadow={castShadow} receiveShadow={receiveShadow}>
                                        <boxGeometry args={[widthRailW, rail, bar]} />
                                        <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.1} {...matProps} />
                                    </mesh>
                                    <mesh position={[0, 0, hd - bar * 0.5]} castShadow={castShadow} receiveShadow={receiveShadow}>
                                        <boxGeometry args={[widthRailW, rail, bar]} />
                                        <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.1} {...matProps} />
                                    </mesh>
                                    <mesh position={[-hw + bar * 0.5, 0, 0]} castShadow={castShadow} receiveShadow={receiveShadow}>
                                        <boxGeometry args={[bar, rail, depthRailD]} />
                                        <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.1} {...matProps} />
                                    </mesh>
                                    <mesh position={[hw - bar * 0.5, 0, 0]} castShadow={castShadow} receiveShadow={receiveShadow}>
                                        <boxGeometry args={[bar, rail, depthRailD]} />
                                        <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.1} {...matProps} />
                                    </mesh>
                                </group>
                            ))}
                        </group>
                    );
                })}
            </group>
        );
    }

    if (t === "speaker") {
        const w = shape.w ?? 0.6;
        const h = shape.h ?? 0.9;
        const d = shape.d ?? 0.25;
        const isFloor = tRaw === "speakerfloor";
        const isCeiling = !isFloor && String(shape.orientation || "").toLowerCase() === "ceiling";
        const corner = Math.max(0, Math.min(shape.cornerRadius ?? 0, Math.min(w, d) * 0.45));
        const inWall = !!shape.inWall;
        const frontDepth = Math.max(0.005, Math.min(shape.frontDepth ?? (inWall ? d * 0.4 : d), d));
        const bodyGeom = corner > 0 ? buildRoundedRectGeometry(w, h, frontDepth, corner) : null;
        const rimEnabled = inWall || !!shape.rimEnabled;
        const rimW = shape.rimW ?? w * 1.05;
        const rimH = shape.rimH ?? h * 1.05;
        const rimD = Math.max(0.002, shape.rimD ?? frontDepth * 0.2);
        const driverCount = Math.max(1, Math.floor(Number(shape.driverCount ?? 2) || 2));
        const driverRadius = Math.max(0.005, shape.driverRadius ?? Math.min(w, h) * 0.18);
        const driverDepth = Math.max(0.005, shape.driverDepth ?? frontDepth * 0.18);
        const driverInset = Math.max(0.001, shape.driverInset ?? 0.01);
        const driverOffsetY = Number(shape.driverOffsetY ?? 0) || 0;
        const driverGap = driverCount > 1 ? (h * 0.6) / (driverCount - 1) : 0;
        const driverStart = -((driverCount - 1) * driverGap) * 0.5;
        const bodyColorLocal = pickShapeColor(shape, "body", baseColor || "#111827");
        const rimColor = pickShapeColor(shape, "rim", "#0f172a");
        const driverColor = pickShapeColor(shape, "driver", "#0f172a");
        const driverRingColor = pickShapeColor(shape, "driverRing", "#0b1220");
        const grilleEnabled = !!shape.grilleEnabled;
        const grilleColor = pickShapeColor(shape, "grille", "#1f2937");
        const grilleD = Math.max(0.001, shape.grilleD ?? 0.01);
        const driverFaceZ = frontDepth * 0.5 + 0.0015;
        const driverSurfaceZ = frontDepth * 0.5 + 0.0025;
        const tweeterRadius = Math.max(0.01, shape.tweeterRadius ?? driverRadius * 0.45);
        const floorDriverPositions = isFloor
            ? [
                { r: driverRadius * 1.02, y: -h * 0.28 },
                { r: tweeterRadius, y: h * 0.12 },
            ]
            : [];
        return (
            <group scale={scaleVec} rotation={isCeiling ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
                {rimEnabled && (
                    <mesh position={[0, 0, frontDepth * 0.5 - rimD * 0.5]} castShadow={castShadow} receiveShadow={receiveShadow}>
                        <boxGeometry args={[rimW, rimH, rimD]} />
                        <meshStandardMaterial
                            color={rimColor}
                            roughness={0.5}
                            metalness={0.1}
                            emissive={rimColor}
                            emissiveIntensity={0.04}
                            {...matProps}
                        />
                    </mesh>
                )}
                <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
                    {bodyGeom ? <primitive object={bodyGeom} attach="geometry" /> : <boxGeometry args={[w, h, frontDepth]} />}
                    <meshStandardMaterial
                        color={bodyColorLocal}
                        roughness={0.5}
                        metalness={0.1}
                        emissive={bodyColorLocal}
                        emissiveIntensity={0.03}
                        {...matProps}
                    />
                </mesh>
                {!isFloor && Array.from({ length: driverCount }).map((_, idx) => (
                    <mesh
                        key={`d${idx}`}
                        position={[0, driverStart + idx * driverGap + driverOffsetY, frontDepth * 0.5 - driverDepth * 0.5 - driverInset]}
                        rotation={[Math.PI / 2, 0, 0]}
                        castShadow={castShadow}
                        receiveShadow={receiveShadow}
                    >
                        <cylinderGeometry args={[driverRadius, driverRadius * 0.95, driverDepth, 28]} />
                        <meshStandardMaterial
                            color={driverColor}
                            roughness={0.6}
                            metalness={0.05}
                            emissive={driverColor}
                            emissiveIntensity={0.04}
                            {...matProps}
                        />
                    </mesh>
                ))}
                {isFloor && floorDriverPositions.map((d, idx) => (
                    <group
                        key={`dr${idx}`}
                        position={[0, d.y + driverOffsetY, driverFaceZ]}
                    >
                        <mesh position={[0, 0, driverSurfaceZ - driverFaceZ]} castShadow={false} receiveShadow={false}>
                            <ringGeometry args={[d.r * 0.7, d.r * 1.1, 48]} />
                            <meshStandardMaterial
                                color={driverRingColor}
                                roughness={0.55}
                                metalness={0.08}
                                emissive={driverRingColor}
                                emissiveIntensity={0.04}
                                {...matProps}
                            />
                        </mesh>
                        <mesh castShadow={false} receiveShadow={false}>
                            <circleGeometry args={[d.r * 0.96, 40]} />
                            <meshStandardMaterial
                                color={driverColor}
                                roughness={0.35}
                                metalness={0.1}
                                emissive={driverColor}
                                emissiveIntensity={0.06}
                                {...matProps}
                            />
                        </mesh>
                        <mesh position={[0, 0, 0.0035]} castShadow={false} receiveShadow={false}>
                            <ringGeometry args={[d.r * 0.55, d.r * 0.78, 40]} />
                            <meshStandardMaterial
                                color={driverRingColor}
                                roughness={0.6}
                                metalness={0.05}
                                emissive={driverRingColor}
                                emissiveIntensity={0.04}
                                {...matProps}
                            />
                        </mesh>
                    </group>
                ))}
                {grilleEnabled && (
                    <mesh position={[0, 0, frontDepth * 0.5 - grilleD * 0.5 - 0.001]} castShadow={castShadow} receiveShadow={receiveShadow}>
                        <boxGeometry args={[w * 0.96, h * 0.96, grilleD]} />
                        <meshStandardMaterial
                            color={grilleColor}
                            roughness={0.7}
                            metalness={0.05}
                            emissive={grilleColor}
                            emissiveIntensity={0.02}
                            {...matProps}
                        />
                    </mesh>
                )}
            </group>
        );
    }

    if (t === "soundbar") {
        const w = shape.w ?? 1.2;
        const h = shape.h ?? 0.18;
        const d = shape.d ?? 0.16;
        const corner = Math.max(0, Math.min(shape.cornerRadius ?? 0.06, Math.min(w, h) * 0.45));
        const frontDepth = Math.max(0.02, Math.min(shape.frontDepth ?? d, d));
        const bodyGeom = corner > 0 ? buildRoundedRectGeometry(w, h, frontDepth, corner) : null;
        const driverColor = pickShapeColor(shape, "driver", "#1b1d22");
        const driverRingColor = pickShapeColor(shape, "driverRing", "#0b1220");
        const grilleEnabled = !!shape.grilleEnabled;
        const grilleColor = pickShapeColor(shape, "grille", "#1f2937");
        const grilleD = Math.max(0.001, shape.grilleD ?? frontDepth * 0.12);
        const grilleInset = Math.max(0, shape.grilleInset ?? 0.01);
        const bodyColorLocal = pickShapeColor(shape, "body", baseColor || "#111827");
        const wooferRadius = Math.max(0.02, shape.wooferRadius ?? Math.min(h * 0.42, w * 0.2));
        const tweeterRadius = Math.max(0.01, shape.tweeterRadius ?? wooferRadius * 0.45);
        const maxWooferX = Math.max(0.01, w * 0.5 - wooferRadius * 1.15);
        const wooferOffsetX = Math.min(Math.max(wooferRadius * 0.9, shape.wooferOffsetX ?? w * 0.3), maxWooferX);
        const tweeterOffsetY = Number(shape.tweeterOffsetY ?? h * 0.12) || 0;
        const driverFaceZ = frontDepth * 0.5 + 0.0015;
        const driverSurfaceZ = frontDepth * 0.5 + 0.0025;
        const driverStyle = {
            roughness: 0.45,
            metalness: 0.08,
            emissiveIntensity: 0.05,
        };
        const renderDriver = (r, key) => (
            <group key={key} position={[0, 0, driverFaceZ]}>
                <mesh position={[0, 0, driverSurfaceZ - driverFaceZ]} castShadow={false} receiveShadow={false}>
                    <ringGeometry args={[r * 0.7, r * 1.1, 48]} />
                    <meshStandardMaterial
                        color={driverRingColor}
                        emissive={driverRingColor}
                        {...driverStyle}
                        {...matProps}
                    />
                </mesh>
                <mesh castShadow={false} receiveShadow={false}>
                    <circleGeometry args={[r * 0.96, 40]} />
                    <meshStandardMaterial
                        color={driverColor}
                        emissive={driverColor}
                        roughness={0.35}
                        metalness={0.1}
                        emissiveIntensity={0.06}
                        {...matProps}
                    />
                </mesh>
                <mesh position={[0, 0, 0.0035]} castShadow={false} receiveShadow={false}>
                    <ringGeometry args={[r * 0.55, r * 0.78, 40]} />
                    <meshStandardMaterial
                        color={driverRingColor}
                        emissive={driverRingColor}
                        {...driverStyle}
                        {...matProps}
                    />
                </mesh>
            </group>
        );
        return (
            <group scale={scaleVec}>
                <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
                    {bodyGeom ? <primitive object={bodyGeom} attach="geometry" /> : <boxGeometry args={[w, h, frontDepth]} />}
                    <meshStandardMaterial
                        color={bodyColorLocal}
                        roughness={0.5}
                        metalness={0.12}
                        emissive={bodyColorLocal}
                        emissiveIntensity={0.03}
                        {...matProps}
                    />
                </mesh>
                <group position={[-wooferOffsetX, 0, 0]}>
                    {renderDriver(wooferRadius, "woofer-left")}
                </group>
                <group position={[wooferOffsetX, 0, 0]}>
                    {renderDriver(wooferRadius, "woofer-right")}
                </group>
                <group position={[0, tweeterOffsetY, 0]}>
                    {renderDriver(tweeterRadius, "tweeter")}
                </group>
                {grilleEnabled && (
                    <mesh position={[0, 0, frontDepth * 0.5 - grilleD * 0.5 - 0.001]} castShadow={castShadow} receiveShadow={receiveShadow}>
                        {corner > 0 ? (
                            <primitive
                                object={buildRoundedRectGeometry(
                                    Math.max(0.01, w - grilleInset * 2),
                                    Math.max(0.01, h - grilleInset * 2),
                                    grilleD,
                                    Math.max(0, corner - grilleInset * 0.6),
                                )}
                                attach="geometry"
                            />
                        ) : (
                            <boxGeometry args={[Math.max(0.01, w - grilleInset * 2), Math.max(0.01, h - grilleInset * 2), grilleD]} />
                        )}
                        <meshStandardMaterial
                            color={grilleColor}
                            roughness={0.7}
                            metalness={0.05}
                            emissive={grilleColor}
                            emissiveIntensity={0.02}
                            {...matProps}
                        />
                    </mesh>
                )}
            </group>
        );
    }

    if (t === "headphones") {
        const w = shape.w ?? 0.98;
        const h = shape.h ?? 0.84;
        const d = shape.d ?? 0.32;
        const earR = shape.earR ?? Math.max(0.14, w * 0.18);
        const earDepth = shape.earD ?? Math.max(0.08, d * 0.55);
        const earFaceInset = Math.max(0.002, shape.earInset ?? earDepth * 0.08);
        const cushionR = shape.cushionRadius ?? earR * 1.05;
        const cushionTube = shape.cushionTube ?? earR * 0.18;
        const driverR = shape.earDriverRadius ?? earR * 0.55;
        const bandRadius = Math.max(0.12, shape.bandRadius ?? w * 0.42);
        const bandTube = Math.max(0.02, shape.bandTube ?? earR * 0.22);
        const bandPadTube = Math.max(0.02, shape.bandPadTube ?? bandTube * 0.7);
        const bandYOffset = Number(shape.bandYOffset ?? (h * 0.26)) || 0;
        const earYOffset = Number(shape.earYOffset ?? (-h * 0.08)) || 0;
        const yokeW = Math.max(0.02, earR * 0.22);
        const yokeH = Math.max(0.06, h * 0.2);
        const earX = Math.max(earR * 1.2, w * 0.5 - earR * 0.8);
        const bandZ = -earDepth * 0.15;
        const bodyColorLocal = pickShapeColor(shape, "body", baseColor || "#111827");
        const earColor = pickShapeColor(shape, "ear", "#1f2937");
        const cushionColor = pickShapeColor(shape, "cushion", "#0f172a");
        const driverColor = pickShapeColor(shape, "driver", "#0b1220");
        const driverRingColor = pickShapeColor(shape, "driverRing", "#0b1220");
        const bandPadColor = pickShapeColor(shape, "bandPad", "#0b1220");

        const renderEar = (side) => {
            const dir = side; // -1 left, +1 right
            return (
                <group position={[dir * earX, earYOffset, 0]}>
                    <mesh castShadow={castShadow} receiveShadow={receiveShadow} rotation={[0, 0, Math.PI / 2]}>
                        <cylinderGeometry args={[earR, earR * 0.98, earDepth, 40]} />
                        <meshStandardMaterial
                            color={earColor}
                            roughness={0.5}
                            metalness={0.12}
                            emissive={earColor}
                            emissiveIntensity={0.03}
                            {...matProps}
                        />
                    </mesh>
                    <mesh castShadow={castShadow} receiveShadow={receiveShadow} position={[0, earR + yokeH * 0.35, -earDepth * 0.05]}>
                        <boxGeometry args={[yokeW, yokeH, yokeW * 0.7]} />
                        <meshStandardMaterial color={bodyColorLocal} roughness={0.5} metalness={0.15} {...matProps} />
                    </mesh>
                    <group position={[-dir * (earDepth * 0.5 - earFaceInset), 0, 0]}>
                        <mesh rotation={[0, 0, Math.PI / 2]} castShadow={false} receiveShadow={false}>
                            <torusGeometry args={[cushionR * 0.62, cushionTube, 14, 36]} />
                            <meshStandardMaterial
                                color={cushionColor}
                                roughness={0.7}
                                metalness={0.05}
                                emissive={cushionColor}
                                emissiveIntensity={0.04}
                                {...matProps}
                            />
                        </mesh>
                        <mesh rotation={[0, 0, Math.PI / 2]} castShadow={false} receiveShadow={false}>
                            <ringGeometry args={[driverR * 0.75, driverR * 1.08, 36]} />
                            <meshStandardMaterial
                                color={driverRingColor}
                                roughness={0.55}
                                metalness={0.08}
                                emissive={driverRingColor}
                                emissiveIntensity={0.05}
                                {...matProps}
                            />
                        </mesh>
                        <mesh rotation={[0, 0, Math.PI / 2]} castShadow={false} receiveShadow={false}>
                            <circleGeometry args={[driverR * 0.95, 32]} />
                            <meshStandardMaterial
                                color={driverColor}
                                roughness={0.35}
                                metalness={0.12}
                                emissive={driverColor}
                                emissiveIntensity={0.06}
                                {...matProps}
                            />
                        </mesh>
                        <mesh rotation={[0, 0, Math.PI / 2]} position={[0.002, 0, 0]} castShadow={false} receiveShadow={false}>
                            <ringGeometry args={[driverR * 0.5, driverR * 0.72, 32]} />
                            <meshStandardMaterial
                                color={driverRingColor}
                                roughness={0.6}
                                metalness={0.05}
                                emissive={driverRingColor}
                                emissiveIntensity={0.04}
                                {...matProps}
                            />
                        </mesh>
                    </group>
                </group>
            );
        };

        return (
            <group scale={scaleVec}>
                <mesh castShadow={castShadow} receiveShadow={receiveShadow} position={[0, bandYOffset, bandZ]}>
                    <torusGeometry args={[bandRadius, bandTube, 18, 64, Math.PI]} />
                    <meshStandardMaterial
                        color={bodyColorLocal}
                        roughness={0.45}
                        metalness={0.18}
                        emissive={bodyColorLocal}
                        emissiveIntensity={0.03}
                        {...matProps}
                    />
                </mesh>
                <mesh castShadow={castShadow} receiveShadow={receiveShadow} position={[0, bandYOffset - bandTube * 0.28, bandZ + bandTube * 0.22]}>
                    <torusGeometry args={[bandRadius * 0.92, bandPadTube, 16, 48, Math.PI]} />
                    <meshStandardMaterial
                        color={bandPadColor}
                        roughness={0.7}
                        metalness={0.05}
                        emissive={bandPadColor}
                        emissiveIntensity={0.02}
                        {...matProps}
                    />
                </mesh>
                {renderEar(-1)}
                {renderEar(1)}
            </group>
        );
    }

    if (t === "ipad") {
        const w = ipadDims?.w ?? 0.5;
        const h = ipadDims?.h ?? 0.7;
        const d = ipadDims?.d ?? 0.04;
        const screenW = ipadDims?.screenW ?? Math.max(0.05, w - 0.08);
        const screenH = ipadDims?.screenH ?? Math.max(0.05, h - 0.08);
        const screenD = ipadDims?.screenD ?? Math.max(0.003, d * 0.2);
        const screenZ = ipadDims?.screenZ ?? (d * 0.5 - screenD * 0.5 - 0.004);
        return (
            <group scale={scaleVec}>
                <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
                    {ipadGeom && <primitive object={ipadGeom} attach="geometry" />}
                    <meshStandardMaterial
                        color={bodyColor}
                        roughness={0.45}
                        metalness={0.2}
                        emissive={bodyColor}
                        emissiveIntensity={0.06}
                        {...matProps}
                    />
                </mesh>
                <mesh
                    position={[0, 0, screenZ]}
                    castShadow={castShadow}
                    receiveShadow={receiveShadow}
                >
                    {ipadScreenGeom ? (
                        <primitive object={ipadScreenGeom} attach="geometry" />
                    ) : (
                        <boxGeometry args={[screenW, screenH, screenD]} />
                    )}
                    <meshStandardMaterial
                        color={screenColor}
                        roughness={0.2}
                        metalness={0.4}
                        emissive={screenColor}
                        emissiveIntensity={0.35}
                        {...matProps}
                    />
                </mesh>
                <mesh
                    position={[0, 0, d * 0.5 - screenD - 0.008]}
                    castShadow={castShadow}
                    receiveShadow={receiveShadow}
                >
                    <boxGeometry args={[w * 0.98, h * 0.98, Math.max(0.005, d * 0.05)]} />
                    <meshStandardMaterial
                        color={bezelColor}
                        roughness={0.6}
                        metalness={0.05}
                        emissive={bezelColor}
                        emissiveIntensity={0.04}
                        {...matProps}
                    />
                </mesh>
            </group>
        );
    }

    return null;
}

/* --------------------------------- main ---------------------------------- */

const Node3D = memo(
    forwardRef(function Node3D(
        {
            node,
            productsVersion = 0,
            selected = false,
            masterSelected = false,
            masterSelectedAlt = false,
            linkHover = false,
            onPointerOver,
            onPointerOut,
            selectedFlowAnchor,
            onPointerDown,
            onFlowAnchorPointerDown,
            onSwitchPress,
            dragging = false,
            fadeTarget,
            fadeAlphaExternal,
            fadeInDuration,
            fadeOutDuration,
            fadeAlphaMapRef,

            // lights
            showLights = true,
            showLightBoundsGlobal = false,

            // labels
            labelsOn = true,
            labelMode = "billboard",
            labelSize = 0.24,
            labelMaxWidth = 24,
            label3DLayers = 8,
            label3DStep = 0.01,
            shadowsOn = true,
            suspendUI = false,
            visibleOverride = true,
        },
        ref
    ) {
        /* ---------- basic props ---------- */
        const position = node?.position || [0, 0, 0];
        const rotation = node?.rotation || [0, 0, 0];
        const baseColor = node?.color || clusterColor(node?.cluster);
        const wantsVisible = node?.visible !== false;
        const shapeHidden = !!(node?.hiddenMesh);
        const flowAnchorsEnabled = node?.flowAnchorsEnabled === true;
        const flowAnchorSets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
        const legacyFlowAnchors = Array.isArray(node?.flowAnchors) ? node.flowAnchors : [];
        const selectedSetId = selectedFlowAnchor?.nodeId === node?.id ? selectedFlowAnchor?.setId : null;
        const activeSetId = selectedSetId || node?.flowAnchorActiveSetId || flowAnchorSets[0]?.id || null;
        let activeSet =
            flowAnchorSets.find((s) => s?.id === activeSetId) ||
            flowAnchorSets[0] ||
            null;
        if (!activeSet && legacyFlowAnchors.length) {
            activeSet = {
                id: activeSetId || "fas-default",
                anchors: legacyFlowAnchors,
                hideRings: node?.flowAnchorsHideRings ?? false,
            };
        }
        const flowAnchorsHideRings = (activeSet?.hideRings === true) || node?.flowAnchorsHideRings === true;
        const flowAnchors = Array.isArray(activeSet?.anchors) ? activeSet.anchors : [];
        const flowAnchorSetId = activeSet?.id || activeSetId || null;

        /* ---------- cinematic fade (optional) ---------- */
        const fadeCfg = node?.fade || {};
        // Default ON so action buttons can fade nodes without needing per-node enable flags.
        const fadeEnabled = fadeCfg.enabled !== false;
        const externalFade = typeof fadeTarget === "number";
        const externalFadeAlpha = Number.isFinite(fadeAlphaExternal) ? fadeAlphaExternal : null;
        const hasFadeMap = !!fadeAlphaMapRef?.current;
        const useExternalAlpha = typeof externalFadeAlpha === "number" || hasFadeMap;
        const fadeInDur = Math.max(
            0,
            Number(
                fadeInDuration ??
                fadeCfg.fadeInDuration ??
                fadeCfg.inDuration ??
                fadeCfg.fadeIn ??
                fadeCfg.in ??
                0.6,
            ) || 0.6,
        );
        const fadeOutDur = Math.max(
            0,
            Number(
                fadeOutDuration ??
                fadeCfg.fadeOutDuration ??
                fadeCfg.outDuration ??
                fadeCfg.fadeOut ??
                fadeCfg.out ??
                0.6,
            ) || 0.6,
        );
        const fadeEpsilon = Math.max(0.0005, Number(fadeCfg.epsilon ?? fadeCfg.fastEpsilon ?? 0.01) || 0.01);
        const fadeAlphaRef = useRef(1);
        const setFadeAlpha = useCallback((v) => {
            fadeAlphaRef.current = clamp01(v);
        }, []);

const fadeAnimRef = useRef(null); // { from,to,dur,elapsed }
        /* ---------- visibility fade (node.visible) ---------- */
        const visAlphaRef = useRef(wantsVisible ? 1 : 0);
        const setVisAlpha = useCallback((v) => {
            visAlphaRef.current = clamp01(v);
        }, []);

const visAnimRef = useRef(null); // { from,to,dur,elapsed }

        // ---------------------------------------------------------------------
        // Imperative alpha application (performance):
        // Avoid React re-renders during fades by applying opacity directly to
        // cached materials on the node's root group.
        // ---------------------------------------------------------------------
        const rootGroupRef = useRef(null);
        const materialCacheRef = useRef([]);
        const alphaAppliedRef = useRef(1);
        const visibleOverrideRef = useRef(true);

        useEffect(() => {
            visibleOverrideRef.current = !!visibleOverride;
        }, [visibleOverride]);

        const rebuildMaterialCache = useCallback(() => {
            const root = rootGroupRef.current;
            if (!root) {
                materialCacheRef.current = [];
                return;
            }
            const mats = [];
            root.traverse((obj) => {
                const mIn = obj?.material;
                if (!mIn) return;
                const arr = Array.isArray(mIn) ? mIn : [mIn];
                for (const m of arr) {
                    if (!m) continue;
                    // Only cache materials that support opacity.
                    if (m.opacity == null) continue;
                    if (!Number.isFinite(m.userData?.__nodeforgeBaseOpacity)) {
                        m.userData.__nodeforgeBaseOpacity = m.opacity ?? 1;
                    }
                    // Make sure opacity changes take effect.
                    m.transparent = true;
                    mats.push(m);
                }
            });
            materialCacheRef.current = mats;
        }, []);

        const applyAlphaToMaterials = useCallback((alpha) => {
            const a = clamp01(alpha);
            const root = rootGroupRef.current;
            if (root) {
                root.visible = visibleOverrideRef.current && a > 0.002;
            }
            if (Math.abs(a - alphaAppliedRef.current) < 0.002) return;

            const mats = materialCacheRef.current;
            for (let i = 0; i < mats.length; i++) {
                const m = mats[i];
                if (!m || m.opacity == null) continue;
                const base = Number.isFinite(m.userData?.__nodeforgeBaseOpacity)
                    ? m.userData.__nodeforgeBaseOpacity
                    : (m.opacity ?? 1);
                const next = base * a;
                if (Math.abs((m.opacity ?? 0) - next) > 0.002) {
                    m.opacity = next;
                }
            }
            alphaAppliedRef.current = a;
        }, []);

        // Rebuild cache when the rendered subtree likely changed.
        useEffect(() => {
            rebuildMaterialCache();
            applyAlphaToMaterials(fadeAlphaRef.current * visAlphaRef.current);
            return () => {
                materialCacheRef.current = [];
            };
        }, [
            node?.id,
            node?.shape,
            node?.kind,
            node?.represent?.kind,
            node?.textBox?.enabled,
            node?.product,
            rebuildMaterialCache,
            applyAlphaToMaterials,
        ]);


        // Animate when node.visible toggles, using the same fade durations.
        useEffect(() => {
            const cur = Math.max(0, Math.min(1, Number(visAlphaRef.current) || 0));
            const to = wantsVisible ? 1 : 0;
            if (Math.abs(cur - to) < 0.0001) return;

            const dur = wantsVisible ? fadeInDur : fadeOutDur;
            if (dur <= 0.0001) {
                visAnimRef.current = null;
                setVisAlpha(to);
                return;
            }
            visAnimRef.current = { from: cur, to, dur, elapsed: 0 };
        }, [wantsVisible, fadeInDur, fadeOutDur]);

        // NOTE: we do NOT early-return on wantsVisible; we fade visAlpha instead.

        // If user disables the feature, snap back to fully visible.
        useEffect(() => {
            if (!fadeEnabled) {
                fadeAnimRef.current = null;
                setFadeAlpha(1);
            }
        }, [fadeEnabled]);

        // External fade driver (SceneInner).
        useEffect(() => {
            if (useExternalAlpha) return;
            if (!externalFade) return;
            if (!fadeEnabled) return;
            const cur = clamp01(fadeAlphaRef.current);
            const to = clamp01(Number(fadeTarget));
            if (Math.abs(to - cur) < 0.0001) return;
            const wantsIn = to >= cur;
            const dur = wantsIn ? fadeInDur : fadeOutDur;
            if (dur <= 0.0001) {
                fadeAnimRef.current = null;
                setFadeAlpha(to);
                return;
            }
            fadeAnimRef.current = { from: cur, to, dur, elapsed: 0 };
        }, [externalFade, fadeTarget, fadeEnabled, fadeInDur, fadeOutDur, useExternalAlpha]);

        // Listen for global fade events (so action buttons / scripts can trigger fades).
        useEffect(() => {
            if (externalFade || useExternalAlpha) return;
            const handler = (ev) => {
                const d = ev?.detail || {};
                if (!d) return;
                if (!(fadeEnabled || d.force === true)) return;

                const nodeId = node?.id;
                if (!nodeId) return;

                const __eq = (a, b) => String(a) === String(b);
                const __in = (arr, v) => Array.isArray(arr) && arr.some((x) => __eq(x, v));

                const roomId = node?.roomId;
                const deckId = node?.deckId;

                const groupId = node?.groupId;

                const includeNodesInRooms = d.includeNodesInRooms !== false;

                const matches = (() => {
                    if (d.all === true) return true;

                    // Direct node targeting
                    if (d.nodeId != null && __eq(d.nodeId, nodeId)) return true;
                    if (__in(d.nodeIds, nodeId)) return true;

                    // Target nodes in a room
                    if (includeNodesInRooms && roomId) {
                        if (d.roomId != null && __eq(d.roomId, roomId)) return true;
                        if (__in(d.roomIds, roomId)) return true;
                    }

                    // Target nodes in a deck
                    if (deckId) {
                        if (d.deckId != null && __eq(d.deckId, deckId)) return true;
                        if (__in(d.deckIds, deckId)) return true;
                    }

                    // Target nodes in a group
                    if (groupId) {
                        if (d.groupId != null && __eq(d.groupId, groupId)) return true;
                        if (__in(d.groupIds, groupId)) return true;
                    }

                    return false;
                })();

                if (!matches) return;

                const type = String(ev?.type || "");
                let action = String(d.action || d.type || "").toLowerCase().trim();
                if (!action) {
                    if (type.includes("_IN")) action = "in";
                    else if (type.includes("_OUT")) action = "out";
                    else action = "toggle";
                }

                const cur = clamp01(fadeAlphaRef.current);
                const to = (() => {
                    if (action === "set") return clamp01(Number(d.alpha ?? d.opacity ?? 1));
                    if (action === "in" || action === "fadein" || action === "show") return 1;
                    if (action === "out" || action === "fadeout" || action === "hide") return 0;
                    if (action === "toggle") return cur > 0.5 ? 0 : 1;
                    return cur;
                })();

                // Duration resolution (per direction)
                const dur = (() => {
                    const wantsIn = to >= cur;
                    const fromDetail = wantsIn
                        ? (d.durationIn ?? d.fadeInDuration ?? d.fadeIn ?? d.inDuration ?? d.in)
                        : (d.durationOut ?? d.fadeOutDuration ?? d.fadeOut ?? d.outDuration ?? d.out);
                    const override = fromDetail != null ? Number(fromDetail) : null;
                    const base = wantsIn ? fadeInDur : fadeOutDur;
                    const d0 = override != null && Number.isFinite(override) ? Math.max(0, override) : base;
                    return d.duration != null ? Math.max(0, Number(d.duration) || 0) : d0;
                })();

                if (Math.abs(to - cur) < 0.0001) return;
                if (dur <= 0.0001) {
                    fadeAnimRef.current = null;
                    setFadeAlpha(to);
                    return;
                }

                fadeAnimRef.current = { from: cur, to, dur, elapsed: 0 };
            };

            const events = ["EPIC3D_FADE_CTRL", "EPIC3D_FADE_IN", "EPIC3D_FADE_OUT", "EPIC3D_FADE_TOGGLE"];
            for (const n of events) window.addEventListener(n, handler);
            return () => {
                for (const n of events) window.removeEventListener(n, handler);
            };
        }, [externalFade, fadeEnabled, node?.id, node?.roomId, node?.deckId, node?.groupId, fadeInDur, fadeOutDur, useExternalAlpha]);

        // Animate fade (consolidated with other per-frame work)

        const uiAlpha = 1;
// representative (resolve what this node represents)
        const represent = node?.represent || null;
        const repUI = represent?.ui || {};
        const show3DInfo = repUI.show3DInfo ?? true;
        const useDimsForRack = repUI.useDims ?? true;   // used for rack dims
        const showDimsLocal = repUI.showDims ?? true;   // per-node toggle

        const sh = node?.shadows || {};
        const castShadow    = (sh.cast    ?? true);
        const receiveShadow = (sh.receive ?? true);
        const lightCasts    = (sh.light   ?? true); // whether this node's own light casts shadows
// Prefer representative’s product when in "product" mode; fallback to legacy node.product
        const productRef = React.useMemo(() => {
            if (represent?.enabled && represent?.kind === "product") {
                if (represent.productId) return { id: represent.productId };
                if (represent.product)   return represent.product; // inline/unsaved
                return null;
            }
            return node?.product || null;
        }, [represent?.enabled, represent?.kind, represent?.productId, represent?.product, node?.product]);

// Resolve catalog product (falls back to inline object when no id)
        const product = React.useMemo(() => {
            const pid = productRef?.id;
            return pid ? getProductById(pid) : (productRef || null);
        }, [productRef?.id, productRef, productsVersion]);




        const showRackPhotos = repUI.showRackPhotos ?? true;
        const infoFont = Math.max(10, Math.min(20, Number(repUI.infoFontSize ?? 12)));  // px
        const thumbSize = Math.max(40, Math.min(140, Number(repUI.thumbSize ?? 70)));   // px
        const infoYOffset = Number(repUI.infoYOffset ?? 0.25); // meters extra lift



        const rack = useMemo(() => {
            if (represent?.kind !== "rack") return null;
            if (represent?.rackId) return getRackById(represent.rackId);
            return represent?.rack || null; // inline unsaved rack
        }, [represent?.kind, represent?.rackId, represent?.rack, productsVersion]);

// label text (now safe to reference product)
        const labelText = node?.label || node?.name || node?.id;
        const labelFull = useMemo(() => {
            const pn = product?.name?.trim();
            const rn = rack?.name?.trim();
            let base = labelText || "";
            if (represent?.enabled) {
                if (represent.kind === "product" && pn) base = base ? `${base} — ${pn}` : pn;
                if (represent.kind === "rack" && rn)    base = base ? `${base} — Rack: ${rn}` : `Rack: ${rn}`;
            }
            return base || labelText;
        }, [labelText, product?.name, rack?.name, represent?.enabled, represent?.kind]);



        const productScale = Number(localStorage.getItem("epic3d.productScale.v1") || "1");
        const showDimsGlobal = localStorage.getItem("epic3d.showDimsGlobal.v1") === "1";
        const photoDefault = localStorage.getItem("epic3d.photoDefault.v1") !== "0";
        const productUnits = localStorage.getItem("epic3d.productUnits.v1") || "cm";
        const alwaysShow3DInfo = localStorage.getItem("epic3d.alwaysShow3DInfo.v1") === "1";

        const toMeters = React.useCallback((v) => {
            const n = Number(v || 0);
            if (productUnits === "mm") return n / 1000;
            if (productUnits === "cm") return n / 100;
            return n; // meters
        }, [productUnits]);

        const shapeToRender = useMemo(() => {
            if (represent?.enabled && represent?.kind === "rack" && rack && useDimsForRack) {
                const w = rack.width ?? 60;
                const h = rack.height ?? 200;
                const l = rack.length ?? 80;
                const sx = Math.max(0.001, toMeters(w) * productScale);
                const sy = Math.max(0.001, toMeters(h) * productScale);
                const sz = Math.max(0.001, toMeters(l) * productScale);
                return { type: "box", scale: [sx, sy, sz] };
            }
            if (product && productRef?.useDims && represent?.kind !== "rack") {
                const w = product.width ?? product?.dims?.w ?? 0.3;
                const h = product.height ?? product?.dims?.h ?? 0.2;
                const l = product.length ?? product?.dims?.l ?? 0.3;
                const sx = Math.max(0.001, toMeters(w) * productScale);
                const sy = Math.max(0.001, toMeters(h) * productScale);
                const sz = Math.max(0.001, toMeters(l) * productScale);
                return { type: "box", scale: [sx, sy, sz] };
            }
            return node.shape || { type: "sphere", radius: 0.32 };
        }, [node.shape, product, productRef?.useDims, productScale, toMeters, represent?.enabled, represent?.kind, rack, useDimsForRack]);

        const modelUrl = shapeToRender?.url || "";
        const isModelShape = (shapeToRender?.type || "").toLowerCase() === "model";
        const useModel = isModelShape && !!modelUrl;
        const isAdvancedShape = ["tv", "remote", "accesspoint", "ipad", "amplifier", "laviebox", "speaker", "speakerfloor", "soundbar", "headphones", "subwoofer", "rack"].includes(
            (shapeToRender?.type || "").toLowerCase(),
        );
        const modelScale = useMemo(() => {
            if (!isModelShape) return null;
            const s = parseVec3(shapeToRender?.scale) || [1, 1, 1];
            return s.map((v) => (Number.isFinite(v) ? Math.max(0.001, v) : 1));
        }, [
            isModelShape,
            shapeToRender?.scale?.[0],
            shapeToRender?.scale?.[1],
            shapeToRender?.scale?.[2],
        ]);

        // label vertical offset from the actual rendered shape
        const yOffset = useMemo(() => {
            const s = shapeToRender || {};
            const t = (s.type || "sphere").toLowerCase();
            if (t === "sphere") return (s.radius ?? 0.32) + 0.12;
            if (t === "cylinder") return (s.height ?? 0.6) / 2 + 0.12;
            if (t === "cone") return (s.height ?? 0.7) / 2 + 0.12;
            if (t === "disc" || t === "circle") return (s.height ?? 0.08) / 2 + 0.12;
            if (t === "hexagon") return (s.height ?? 0.5) / 2 + 0.12;
            if (t === "switch") return (s.h ?? 0.12) / 2 + 0.12;
            if (t === "box" || t === "square") return (s.scale?.[1] ?? 0.3) / 2 + 0.12;
            if (t === "model") return (modelScale?.[1] ?? 1) / 2 + 0.12;
            const scale = Number(s.scale) || 1;
            if (t === "tv") return ((s.h ?? 0.7) / 2 + 0.12) * scale;
            if (t === "remote") return ((s.h ?? 0.6) / 2 + 0.12) * scale;
            if (t === "accesspoint") return ((s.height ?? 0.12) * 0.5 + 0.12) * scale;
            if (t === "ipad") return ((s.h ?? 0.7) / 2 + 0.12) * scale;
            if (t === "amplifier") {
                const base = (s.baseH ?? 0.18) + (s.midH ?? 0.16) + (s.topH ?? 0.12);
                return (base / 2 + 0.12) * scale;
            }
            if (t === "laviebox") return ((s.h ?? 0.4) / 2 + 0.12) * scale;
            if (t === "speaker" || t === "speakerfloor") return ((s.h ?? 0.9) / 2 + 0.12) * scale;
            if (t === "soundbar") return ((s.h ?? 0.18) / 2 + 0.12) * scale;
            if (t === "headphones") return ((s.h ?? 0.75) / 2 + 0.12) * scale;
            if (t === "subwoofer") return ((s.h ?? 0.7) / 2 + 0.12) * scale;
            if (t === "rack") return ((s.h ?? 1.8) / 2 + 0.12) * scale;
            return 0.44;
        }, [shapeToRender, modelScale]);
        const labelYOffset = Number(node?.labelYOffset ?? 0) || 0;
        const labelXOffset = Number(node?.labelXOffset ?? 0) || 0;
        const labelY = yOffset + labelYOffset;

        const shapeBounds = useMemo(() => {
            const s = shapeToRender || {};
            const t = (s.type || "sphere").toLowerCase();
            if (t === "sphere") {
                const r = s.radius ?? 0.32;
                return [r * 2, r * 2, r * 2];
            }
            if (t === "cylinder" || t === "hexagon" || t === "disc" || t === "circle") {
                const r = s.radius ?? 0.35;
                const h = s.height ?? 0.6;
                return [r * 2, h, r * 2];
            }
            if (t === "cone") {
                const r = s.radius ?? 0.35;
                const h = s.height ?? 0.7;
                return [r * 2, h, r * 2];
            }
            if (t === "switch") return [s.w ?? 0.9, s.h ?? 0.12, s.d ?? 0.35];
            if (t === "box" || t === "square") return s.scale || [0.6, 0.3, 0.6];
            if (t === "model") return modelScale || [1, 1, 1];
            const scale = Number(s.scale) || 1;
            if (t === "tv") return [(s.w ?? 1.1) * scale, (s.h ?? 0.7) * scale, (s.d ?? 0.02) * scale];
            if (t === "remote") {
                const d = Math.max(0.001, s.d ?? 0.07);
                return [(s.w ?? 0.22) * scale, (s.h ?? 0.6) * scale, d * scale];
            }
            if (t === "accesspoint") {
                const r = s.radius ?? 0.35;
                const h = s.height ?? 0.12;
                return [r * 2 * scale, h * scale, r * 2 * scale];
            }
            if (t === "ipad") return [(s.w ?? 0.5) * scale, (s.h ?? 0.7) * scale, (s.d ?? 0.04) * scale];
            if (t === "amplifier") {
                const w = s.w ?? s.baseW ?? 0.8;
                const d = s.d ?? s.baseD ?? 0.4;
                const h = (s.baseH ?? 0.18) + (s.midH ?? 0.16) + (s.topH ?? 0.12);
                return [w * scale, h * scale, d * scale];
            }
            if (t === "laviebox") return [(s.w ?? 0.8) * scale, (s.h ?? 0.4) * scale, (s.d ?? 0.35) * scale];
            if (t === "speaker" || t === "speakerfloor") return [(s.w ?? 0.6) * scale, (s.h ?? 0.9) * scale, (s.d ?? 0.25) * scale];
            if (t === "soundbar") return [(s.w ?? 1.2) * scale, (s.h ?? 0.18) * scale, (s.d ?? 0.16) * scale];
            if (t === "headphones") return [(s.w ?? 0.9) * scale, (s.h ?? 0.75) * scale, (s.d ?? 0.28) * scale];
            if (t === "subwoofer") return [(s.w ?? 0.7) * scale, (s.h ?? 0.7) * scale, (s.d ?? 0.5) * scale];
            if (t === "rack") {
                const w = (s.w ?? 0.6);
                const cols = Math.max(1, Math.floor(s.columns ?? 1));
                const gap = Math.max(0.02, s.columnGap ?? Math.max(0.08, w * 0.2));
                const totalW = cols * w + (cols - 1) * gap;
                return [totalW * scale, (s.h ?? 1.8) * scale, (s.d ?? 0.6) * scale];
            }
            return [0.6, 0.3, 0.6];
        }, [shapeToRender, modelScale]);

        /* ---------- lights ---------- */
        const light = node?.light || null;
        const ltype = (light?.type || "none").toLowerCase();

        // Important: keep light objects mounted while toggling enabled so SpotLight/DirectionalLight
        // targets stay correct and don't get stuck pointing at the wrong place.
        const hasLight = !!(showLights && light && ltype !== "none");
        const wantsOn = light?.enabled ?? true;

        const color = light?.color || "#ffffff";

        // Physical units (Canvas sets physicallyCorrectLights=true):
        // - point/spot intensity: candela (cd)
        // - directional intensity: lux (lx)
        const userIntensity =
            light?.intensity ??
            (ltype === "spot" ? 1200 : ltype === "dir" || ltype === "directional" ? 30 : 800);

        const distance = light?.distance ?? (ltype === "spot" ? 10 : ltype === "point" ? 8 : 0);
        const decay = light?.decay ?? 2;
        const angle = light?.angle ?? 0.6;
        const penumbra = light?.penumbra ?? 0.35;

        // Optional: auto-compute intensity from a target illuminance (lux) at the target distance.
        const autoIntensity = light?.autoIntensity ?? (ltype === "spot" || ltype === "point");
        const targetLux = Number(light?.targetLux ?? (ltype === "dir" || ltype === "directional" ? 30 : 120));

        const computedIntensity = useMemo(() => {
            const ui = Number(userIntensity) || 0;
            if (!autoIntensity) return ui;
            if (ltype === "dir" || ltype === "directional") return Math.max(0, targetLux);

            // Center-beam approximation: E ≈ I / d^2  =>  I ≈ E * d^2
            const d = Math.max(0.001, Number(distance || 0));
            return Math.max(0, targetLux) * d * d;
        }, [autoIntensity, userIntensity, targetLux, distance, ltype]);

        const aimMode = (light?.aimMode || (light?.target != null ? "target" : "yawPitch")).toLowerCase();

        // Spot/Directional aim target in the node's LOCAL space (relative to the light position)
        const targetPos = useMemo(() => {
            const parsed = parseVec3(light?.target ?? light?.pointAt ?? null);
            if (aimMode === "target" && parsed) return parsed;

            // yaw/pitch fallback (legacy)
            const yaw = Number(light?.yaw ?? 0);
            const pitch = Number(light?.pitch ?? 0);
            const basis = (light?.yawPitchBasis || "forward").toLowerCase();
            const dir = dirFromYawPitch(yaw, pitch, basis);
            const distForAim = Math.max(0.001, Number(light?.aimDistance ?? distance ?? 5));
            return [dir.x * distForAim, dir.y * distForAim, dir.z * distForAim];
        }, [
            aimMode,
            light?.target,
            light?.pointAt,
            light?.yaw,
            light?.pitch,
            light?.yawPitchBasis,
            light?.aimDistance,
            distance,
        ]);

        // Smooth on/off (dimmer)
        const fadeIn = Math.max(0, Number(light?.fadeIn ?? 0.25));
        const fadeOut = Math.max(0, Number(light?.fadeOut ?? 0.25));

        const spotRef = useRef();
        const pointRef = useRef();
        const dirRef = useRef();
        const targetRef = useRef();

        const dimmerRef = useRef(wantsOn ? 1 : 0);
        const intensityRef = useRef(computedIntensity);
        useEffect(() => {
            intensityRef.current = computedIntensity;
        }, [computedIntensity]);

        const wantsOnRef = useRef(wantsOn);
        useEffect(() => {
            const prev = wantsOnRef.current;
            wantsOnRef.current = wantsOn;

            // Optional integration events
            if (typeof window !== "undefined" && prev !== wantsOn && node?.id) {
                try {
                    window.dispatchEvent(
                        new CustomEvent(wantsOn ? "epic3d:light-on" : "epic3d:light-off", {
                            detail: { nodeId: node.id, lightType: ltype },
                        })
                    );
                } catch {}
            }
        }, [wantsOn, node?.id, ltype]);

        useEffect(() => {
            if (!hasLight) return;
            const l = spotRef.current || dirRef.current;
            const t = targetRef.current;
            if (!l || !t) return;

            // Keep target inside the same group so it inherits node transforms.
            t.position.set(targetPos[0], targetPos[1], targetPos[2]);
            t.updateMatrixWorld(true);

            l.target = t;
            l.updateMatrixWorld(true);
            if (l.shadow?.camera?.updateProjectionMatrix) {
                l.shadow.camera.updateProjectionMatrix();
            }
        }, [hasLight, ltype, targetPos[0], targetPos[1], targetPos[2]]);

        // Light dimmer (consolidated with other per-frame work)

        const baseShadowMapSize = Math.max(256, Math.min(4096, Number(light?.shadowMapSize ?? 1024)));
        const shadowMapSize = suspendUI
            ? Math.max(256, Math.min(1024, Math.round(baseShadowMapSize * 0.5)))
            : baseShadowMapSize;
        const shadowBias = Number(light?.shadowBias ?? -0.0002);
        const shadowNormalBias = Number(light?.shadowNormalBias ?? 0.02);

        /* ---------- dimension helpers (hooks must be before any return) ---------- */

        // half extents (for box only)
        const half = useMemo(() => {
            const s = shapeToRender;
            if (!s || (s.type !== "box" && s.type !== "square")) return null;
            const sx = s.scale?.[0] ?? 0.6;
            const sy = s.scale?.[1] ?? 0.3;
            const sz = s.scale?.[2] ?? 0.6;
            return [sx / 2, sy / 2, sz / 2];
        }, [shapeToRender]);

        // pretty raw dim labels from product
        const dimText = useMemo(() => {

            if (represent?.enabled && represent?.kind === "rack" && rack) {
                const w = Number(rack.width || 0);
                const h = Number(rack.height || 0);
                const l = Number(rack.length || 0);
                const unit = localStorage.getItem("epic3d.productUnits.v1") || "cm";
                return { w: `${w}${unit}`, h: `${h}${unit}`, l: `${l}${unit}` };
            }
            if (!product || !productRef?.useDims) return null;
            const w = Number(product.width ?? product?.dims?.w) || 0;
            const h = Number(product.height ?? product?.dims?.h) || 0;
            const l = Number(product.length ?? product?.dims?.l) || 0;

            const unit = localStorage.getItem("epic3d.productUnits.v1") || "cm";
            return { w: `${w}${unit}`, h: `${h}${unit}`, l: `${l}${unit}` };
        }, [product, productRef?.useDims, represent?.enabled, represent?.kind, rack]);
// same UI knobs the HUD uses
        const unit = localStorage.getItem("epic3d.productUnits.v1") || "cm";
        const ui = repUI || {};
        const panelWidth = Math.max(340, Math.min(720, Number(ui.panelWidth ?? 480)));

// pick the rack source and pre-resolve products
        const rackRaw = represent?.rackId ? getRackById(represent.rackId) : represent?.rack;
        const rackResolved = rackRaw ? {
            ...rackRaw,
            items: (rackRaw.items || []).map(it => {
                const p = it.productId ? getProductById(it.productId) : null;
                return { ...it, __product: p };
            }),
        } : null;

        // Resolve representative thumbnail (supports data URLs, @pp/ bundled refs, @media disk refs)
        const diskPicsIndex = React.useMemo(() => __getDiskPicsIndex(), [productsVersion]);
        const coverRef = (product?.image || (Array.isArray(product?.images) ? product.images[0] : "")) || "";
        const coverUrl = React.useMemo(
            () => (coverRef ? resolvePictureRef(coverRef, __BUNDLED_PICS_INDEX, diskPicsIndex) : ""),
            [coverRef, diskPicsIndex]
        );

        const showPhoto = (productRef?.showPhoto ?? photoDefault) && !!coverUrl;
        const showPhotoEffective = showPhoto && !suspendUI;

// near labelSizeLocal / labelColorLocal
        const labelSizeLocal  = (node?.labelScale ?? 1) * (labelSize ?? 0.24);
        const labelColorLocal = node?.labelColor ?? "#ffffff";

        // Per-node label layout & advanced style (driven by EditorRightPane)
        const labelAlignLocal = String(node?.labelAlign ?? "center").toLowerCase();
        const labelTextAlign = (labelAlignLocal === "left" || labelAlignLocal === "right" || labelAlignLocal === "center")
            ? labelAlignLocal
            : "center";

        const labelAnchorX = labelTextAlign;
        const labelTextAlignBack = (labelTextAlign === "left") ? "right" : (labelTextAlign === "right" ? "left" : "center");
        const labelAnchorXBack = labelTextAlignBack;

        const labelWrapLocal = (node?.labelWrap ?? true) !== false;
        const labelOverflowWrap = labelWrapLocal ? "break-word" : "normal";
        const labelMaxWidthLocal = Number(node?.labelMaxWidth ?? labelMaxWidth ?? 24);
        const labelMaxWidthEff = (labelWrapLocal && Number.isFinite(labelMaxWidthLocal) && labelMaxWidthLocal > 0)
            ? labelMaxWidthLocal
            : undefined;

        const labelFontLocal = node?.labelFont || undefined;
        const labelFillOpacity = clamp01(Number(node?.labelFillOpacity ?? 1));
        const labelOutlineBlur = Math.max(0, Number(node?.labelOutlineBlur ?? 0) || 0);
        const labelLetterSpacing = Number(node?.labelLetterSpacing ?? 0) || 0;
        const labelLineHeight = Number(node?.labelLineHeight ?? 1) || 1;
        const labelStrokeWidth = Math.max(0, Number(node?.labelStrokeWidth ?? 0) || 0);
        const labelStrokeColor = node?.labelStrokeColor ?? "#000000";

        const label3DLayersLocal = Math.max(1, Math.min(64, Math.floor(Number(node?.label3DLayers ?? label3DLayers) || label3DLayers)));
        const labelModeEffective = labelMode !== "billboard" && !selected ? "billboard" : labelMode;
        const label3DStepLocal = Math.max(0, Number(node?.label3DStep ?? label3DStep) || label3DStep);
        const spriteLabelText = !selected ? String(labelFull || "").replace(/\s+/g, " ").trim().slice(0, 64) : "";
        const spriteLabelTex = useMemo(() => {
            if (!spriteLabelText) return null;
            return makeLabelSpriteTexture(spriteLabelText, labelColorLocal);
        }, [spriteLabelText, labelColorLocal]);
        const spriteAspect = useMemo(() => {
            const img = spriteLabelTex?.image;
            if (!img || !img.width || !img.height) return 2;
            return img.width / img.height;
        }, [spriteLabelTex]);
        const spriteScale = [
            Math.max(0.01, labelSizeLocal * 1.1 * spriteAspect),
            Math.max(0.01, labelSizeLocal * 1.1),
            1,
        ];


// optional outline support from the inspector
        const labelOutlineOn    = !!node?.labelOutline;
        const labelOutlineWidth = labelOutlineOn ? (Number(node?.labelOutlineWidth ?? 0.02) || 0.02) : 0;
        const labelOutlineColor = labelOutlineOn ? (node?.labelOutlineColor ?? "#000000") : "#000000";

        /* ---------- switch (pressable) ---------- */
        const isSwitch = (node?.kind || "node") === "switch";

        /* ---------- dissolver (boundary visual) ---------- */
        const isDissolver = String(node?.kind || node?.type || "node").toLowerCase() === "dissolver";
        const dissolverCfg = isDissolver ? (node?.dissolver || {}) : null;
        const dissolverEnabled = !!(dissolverCfg ? (dissolverCfg.enabled !== false) : false);
        const showDissolverBoundary = !!(dissolverCfg ? (dissolverCfg.showBoundary ?? true) : false);
        const dissBoundary = (dissolverCfg && typeof dissolverCfg.boundary === "object") ? dissolverCfg.boundary : {};
        const dissType = String(dissBoundary.type || "sphere").toLowerCase();
        const dissRadius = Math.max(0.01, Number(dissBoundary.radius ?? 1.0) || 1.0);
        const dissHeight = Math.max(0.01, Number(dissBoundary.height ?? 2.0) || 2.0);
        const dissThickness = Math.max(0.001, Number(dissBoundary.thickness ?? 0.2) || 0.2);
        const dissOpacity = clamp01(Number(dissBoundary.opacity ?? 0.35));
        const dissColor = dissBoundary.color ?? "#c084fc";
        const sw = node?.switch || {};
        const swButtonsCountRaw = (sw.buttonsCount ?? (Array.isArray(sw.buttons) ? sw.buttons.length : null) ?? 2);
        const swButtonsCount = Math.max(1, Math.min(12, Math.floor(Number(swButtonsCountRaw) || 2)));
        const swShowButtons = !!(sw.showButtons ?? false);
        const swPortsEnabled = (sw.portsEnabled ?? true) !== false;
        const normalizeSwitchPorts = (val, allowed, fallback) => {
            const n = Math.round(Number(val) || 0);
            if (allowed.includes(n)) return n;
            return fallback;
        };
        const swPortsCount = normalizeSwitchPorts(sw.portsCount ?? sw.portCount ?? 24, [8, 16, 24, 48], 24);
        const swSfpCount = normalizeSwitchPorts(sw.sfpCount ?? sw.sfpPorts ?? 0, [0, 1, 2, 4], 0);

        const swDims = useMemo(() => {
            const s = shapeToRender || {};
            const t = String(s.type || "sphere").toLowerCase();
            if (t === "switch") {
                return {
                    ok: true,
                    w: Number(s.w ?? 0.9) || 0.9,
                    h: Number(s.h ?? 0.12) || 0.12,
                    d: Number(s.d ?? 0.35) || 0.35,
                };
            }
            if (t === "box" || t === "square") {
                const sc = Array.isArray(s.scale) ? s.scale : [0.6, 0.3, 0.6];
                return {
                    ok: true,
                    w: Number(sc[0] ?? 0.6) || 0.6,
                    h: Number(sc[1] ?? 0.3) || 0.3,
                    d: Number(sc[2] ?? 0.6) || 0.6,
                };
            }
            return { ok: false, w: 0, h: 0, d: 0 };
        }, [shapeToRender]);

        const swPhysical = !!sw.physical;
        const swPhysicalH = Math.max(0.001, Number(sw.physicalHeight ?? 0.028) || 0.028);
        const swThickness = swPhysical ? swPhysicalH : 0.01;
        const swMargin = Math.max(0, Number(sw.margin ?? 0.03) || 0);
        const swGap = Math.max(0, Number(sw.gap ?? 0.02) || 0);
        const swPressDepth = Math.max(0, Number(sw.pressDepth ?? 0.014) || 0);

        // ✅ fluid press animation (same timing in + out)
        const swPressAnimMs = Math.max(40, Math.floor(Number(sw.pressAnimMs ?? sw.pressMs ?? 160) || 160));
        const swPressHoldMs = Math.max(0, Math.floor(Number(sw.pressHoldMs ?? 60) || 60));

        const [swHoverIdx, setSwHoverIdx] = useState(-1);

        // idx -> press amount [0..1]
        const [swPressAmtByIdx, setSwPressAmtByIdx] = useState([]);
        const swPressAnimRef = useRef(new Map()); // idx -> { t0, from, to, dur }
        const swPressHoldTimeoutsRef = useRef([]);

        useEffect(() => {
            if (!isSwitch) return;
            setSwPressAmtByIdx((prev) => {
                const next = Array(swButtonsCount).fill(0);
                for (let i = 0; i < Math.min(prev.length, next.length); i++) next[i] = prev[i];
                return next;
            });
        }, [isSwitch, swButtonsCount]);

        useEffect(() => {
            return () => {
                try {
                    swPressHoldTimeoutsRef.current.forEach((t) => t && clearTimeout(t));
                } catch {}
                try { document.body.style.cursor = "auto"; } catch {}
            };
        }, []);

        const __startPressAnim = (idx, to, durMs) => {
            setSwPressAmtByIdx((prev) => {
                const from = prev[idx] ?? 0;
                swPressAnimRef.current.set(idx, {
                    t0: performance.now(),
                    from,
                    to,
                    dur: Math.max(1, durMs),
                });
                return prev;
            });
        };

        // Switch press animation (consolidated with other per-frame work)
        const nodeStrideRef = useRef(0);
        const nodeDeltaRef = useRef(0);
        const perfTimeRef = useRef(0);
        useFrame((_, dt) => {
            perfTimeRef.current += dt;
            if (useExternalAlpha) {
                const next = Number.isFinite(externalFadeAlpha)
                    ? externalFadeAlpha
                    : (fadeAlphaMapRef?.current?.get(String(node?.id)) ?? null);
                if (Number.isFinite(next)) {
                    const clamped = Math.max(0, Math.min(1, next));
                    const cur = fadeAlphaRef.current;
                    if (clamped <= 0.01 && cur > 0.01) setFadeAlpha(0);
                    else if (Math.abs(clamped - cur) > 0.005) setFadeAlpha(clamped);
                }
            }
            const hasFadeAnim = !!fadeAnimRef.current && !useExternalAlpha;
            const hasVisAnim = !!visAnimRef.current;
            const hasLightAnim = !!hasLight;
            const hasSwitchAnim = isSwitch && swPressAnimRef.current.size !== 0;

            // Apply fade/visibility alpha every frame, even when nothing else animates.
            applyAlphaToMaterials(fadeAlphaRef.current * visAlphaRef.current);

            if (!hasFadeAnim && !hasVisAnim && !hasLightAnim && !hasSwitchAnim) return;

            const fullyHidden =
                (useExternalAlpha ? (externalFadeAlpha ?? 0) <= 0.001 : fadeAlphaRef.current <= 0.001) &&
                visAlphaRef.current <= 0.001 &&
                !fadeAnimRef.current &&
                !visAnimRef.current;

            const stride = suspendUI ? 2 : 1;
            if (stride > 1) {
                nodeDeltaRef.current += dt;
                nodeStrideRef.current = (nodeStrideRef.current + 1) % stride;
                if (nodeStrideRef.current !== 0) return;
                dt = nodeDeltaRef.current;
                nodeDeltaRef.current = 0;
            }

            if (!fullyHidden) {
                const fa = fadeAnimRef.current;
                if (fa && !useExternalAlpha) {
                    fa.elapsed += dt;
                    const t = fa.dur <= 0 ? 1 : clamp01(fa.elapsed / fa.dur);
                    const e = easeInOutCubic(t);
                    const v = fa.from + (fa.to - fa.from) * e;
                    if (Math.abs(v - fadeAlphaRef.current) > fadeEpsilon) setFadeAlpha(v);
                    if (t >= 1) {
                        fadeAnimRef.current = null;
                        setFadeAlpha(fa.to);
                    }
                }

                const va = visAnimRef.current;
                if (va) {
                    va.elapsed += dt;
                    const t = va.dur <= 0 ? 1 : Math.max(0, Math.min(1, va.elapsed / va.dur));
                    const e = easeInOutCubic(t);
                    const v = va.from + (va.to - va.from) * e;
                    if (Math.abs(v - visAlphaRef.current) > fadeEpsilon) setVisAlpha(v);
                    if (t >= 1) {
                        visAnimRef.current = null;
                        setVisAlpha(va.to);
                    }
                }
            }

            if (hasLight) {
                const l = spotRef.current || pointRef.current || dirRef.current;
                if (l) {
                    const desired = wantsOnRef.current ? 1 : 0;
                    const cur = dimmerRef.current;
                    if (cur != desired) {
                        const dur = desired > cur ? fadeIn : fadeOut;
                        if (dur <= 0.0001) {
                            dimmerRef.current = desired;
                        } else {
                            const step = dt / dur;
                            const next = cur + Math.sign(desired - cur) * step;
                            dimmerRef.current = THREE.MathUtils.clamp(next, 0, 1);
                        }
                    }

                    const dim = dimmerRef.current;
                    l.intensity = (Number(intensityRef.current) || 0) * dim;
                }
            }

            if (isSwitch && swPressAnimRef.current.size !== 0) {
                const now = performance.now();
                setSwPressAmtByIdx((prev) => {
                    let changed = false;
                    const next = prev.slice();

                    for (const [idx, a] of swPressAnimRef.current.entries()) {
                        const t = clamp01((now - a.t0) / a.dur);
                        const e = easeInOutCubic(t);
                        const v = a.from + (a.to - a.from) * e;
                        if (next[idx] !== v) {
                            next[idx] = v;
                            changed = true;
                        }
                        if (t >= 1) swPressAnimRef.current.delete(idx);
                    }

                    return changed ? next : prev;
                });
            }
        });

        const swButtonSpecs = useMemo(() => {
            if (!isSwitch) return [];
            if (!swDims.ok) return [];

            const count = swButtonsCount;
            const cols = count <= 3 ? count : count <= 8 ? 2 : 3;
            const rows = Math.ceil(count / cols);

            const availW = Math.max(0.01, swDims.w - swMargin * 2);
            const availD = Math.max(0.01, swDims.d - swMargin * 2);

            const cellW = Math.max(0.01, (availW - (cols - 1) * swGap) / cols);
            const cellD = Math.max(0.01, (availD - (rows - 1) * swGap) / rows);

            const out = [];
            for (let i = 0; i < count; i++) {
                const r = Math.floor(i / cols);
                const c = i % cols;

                const x = -availW * 0.5 + cellW * 0.5 + c * (cellW + swGap);
                const z = -availD * 0.5 + cellD * 0.5 + r * (cellD + swGap);

                out.push({
                    idx: i,
                    x,
                    z,
                    w: cellW,
                    d: cellD,
                });
            }
            return out;
        }, [isSwitch, swDims, swButtonsCount, swMargin, swGap]);

        /* ---------- NOTE ---------- */
        // Do not early-return on node.visible; we fade visAlpha so nodes disappear smoothly.

        /* ---------- events ---------- */
        const handlePointerDown = (e) => {
            e.stopPropagation();
            if (dragging) return;
            onPointerDown?.(node.id, e);
        };


        // Merge forwarded ref with our internal rootGroupRef
        const setMergedRootRef = useCallback((el) => {
            rootGroupRef.current = el;
            if (typeof ref === "function") {
                ref(el);
            } else if (ref && typeof ref === "object") {
                ref.current = el;
            }
        }, [ref]);

/* -------------------------------- render -------------------------------- */
        return (
            <group
                ref={setMergedRootRef}
                position={position}
                rotation={rotation}
                visible={visibleOverride}
                userData={{ ...(node?.userData || {}), __epicType: "node", __nodeId: node?.id }}
                onPointerDown={(e) => {
                    // Node should *always* win when it’s hit
                    e.stopPropagation();
                    if (dragging) return;
                    onPointerDown?.(node.id, e);
                }}
                onPointerOver={(e) => {
                    onPointerOver?.(e, node);
                }}
                onPointerOut={(e) => {
                    onPointerOut?.(e, node);
                }}
                castShadow={castShadow && shadowsOn}        // <-- use global too (added in step 2)
                receiveShadow={receiveShadow && shadowsOn}
            >
                {/* main mesh */}
                {!shapeHidden && !useModel && !isAdvancedShape && (
                    <mesh castShadow={castShadow && shadowsOn} receiveShadow={receiveShadow && shadowsOn}>
                        <GeometryForShape shape={shapeToRender} />
                        <meshStandardMaterial
                            color={baseColor}
                            roughness={0.35}
                            metalness={0.05}
                            // Keep nodes visible regardless of global lighting prefs.
                            // (Does not change hidden/shown state, only shading.)
                            emissive={baseColor}
                            emissiveIntensity={0.18}

                            transparent
                            opacity={uiAlpha}
                            depthWrite={uiAlpha >= 0.999}

                        />
                    </mesh>
                )}
                {!shapeHidden && !useModel && isAdvancedShape && (
                    <NodeShapeAdvanced
                        shape={shapeToRender}
                        baseColor={baseColor}
                        opacity={uiAlpha}
                        castShadow={castShadow && shadowsOn}
                        receiveShadow={receiveShadow && shadowsOn}
                    />
                )}
                {!shapeHidden && useModel && (
                    <NodeShapeModel
                        url={modelUrl}
                        scale={modelScale || [1, 1, 1]}
                        opacity={uiAlpha}
                        castShadow={castShadow && shadowsOn}
                        receiveShadow={receiveShadow && shadowsOn}
                    />
                )}

                {/* Switch ports */}
                {isSwitch && swPortsEnabled && !shapeHidden && swDims.ok && (
                    <group position={[0, 0, swDims.d * 0.5 - 0.006]}>
                        {(() => {
                            const ports = swPortsCount;
                            const sfp = Math.min(swSfpCount, 4);
                            const rows = Math.min(2, Math.max(1, ports > 12 ? 2 : 1));
                            const cols = Math.ceil(ports / rows);
                            const panelH = swDims.h * 0.7;
                            const panelW = swDims.w * 0.9;
                            const gapX = Math.max(0.004, panelW * 0.02);
                            const gapY = Math.max(0.004, panelH * 0.12);
                            const sfpAreaW = sfp > 0 ? Math.min(panelW * 0.22, Math.max(0.08, panelW * 0.18)) : 0;
                            const rjAreaW = sfp > 0 ? Math.max(0.05, panelW - sfpAreaW - gapX) : panelW;
                            const portW = Math.max(0.012, (rjAreaW - (cols - 1) * gapX) / cols);
                            const portH = Math.max(0.012, (panelH - (rows - 1) * gapY) / rows);
                            const portD = Math.max(0.008, swDims.d * 0.12);
                            const baseX = -panelW * 0.5 + portW * 0.5;
                            const baseY = -panelH * 0.5 + portH * 0.5;
                            const rjOffsetX = sfp > 0 ? -panelW * 0.5 + portW * 0.5 : baseX;
                            const rjPorts = [];
                            for (let i = 0; i < ports; i++) {
                                const r = Math.floor(i / cols);
                                const c = i % cols;
                                const x = rjOffsetX + c * (portW + gapX);
                                const y = baseY + r * (portH + gapY);
                                rjPorts.push({ x, y });
                            }
                            const sfpPorts = [];
                            if (sfp > 0) {
                                const sfpRows = sfp > 2 ? 2 : 1;
                                const sfpCols = Math.ceil(sfp / sfpRows);
                                const sfpGapX = Math.max(0.004, sfpAreaW * 0.12);
                                const sfpGapY = Math.max(0.004, panelH * 0.18);
                                const sfpW = Math.max(0.016, (sfpAreaW - (sfpCols - 1) * sfpGapX) / sfpCols);
                                const sfpH = Math.max(0.016, (panelH - (sfpRows - 1) * sfpGapY) / sfpRows);
                                const startX = panelW * 0.5 - sfpAreaW + sfpW * 0.5;
                                const startY = -panelH * 0.5 + sfpH * 0.5;
                                for (let i = 0; i < sfp; i++) {
                                    const r = Math.floor(i / sfpCols);
                                    const c = i % sfpCols;
                                    sfpPorts.push({
                                        x: startX + c * (sfpW + sfpGapX),
                                        y: startY + r * (sfpH + sfpGapY),
                                        w: sfpW,
                                        h: sfpH,
                                    });
                                }
                            }
                            const portColor = sw.portColor ?? "#0f172a";
                            const portFrame = sw.portFrameColor ?? "#1f2937";
                            return (
                                <group>
                                    {rjPorts.map((p, idx) => (
                                        <group key={`rj-${idx}`} position={[p.x, p.y, 0]}>
                                            <mesh castShadow={false} receiveShadow={false}>
                                                <boxGeometry args={[portW, portH, portD]} />
                                                <meshStandardMaterial color={portFrame} roughness={0.6} metalness={0.08} emissive={portFrame} emissiveIntensity={0.02} />
                                            </mesh>
                                            <mesh position={[0, 0, portD * 0.15]} castShadow={false} receiveShadow={false}>
                                                <boxGeometry args={[portW * 0.8, portH * 0.7, portD * 0.5]} />
                                                <meshStandardMaterial color={portColor} roughness={0.8} metalness={0.02} emissive={portColor} emissiveIntensity={0.01} />
                                            </mesh>
                                        </group>
                                    ))}
                                    {sfpPorts.map((p, idx) => (
                                        <group key={`sfp-${idx}`} position={[p.x, p.y, 0]}>
                                            <mesh castShadow={false} receiveShadow={false}>
                                                <boxGeometry args={[p.w, p.h, portD * 1.1]} />
                                                <meshStandardMaterial color={portFrame} roughness={0.55} metalness={0.12} emissive={portFrame} emissiveIntensity={0.02} />
                                            </mesh>
                                            <mesh position={[0, 0, portD * 0.22]} castShadow={false} receiveShadow={false}>
                                                <boxGeometry args={[p.w * 0.78, p.h * 0.65, portD * 0.55]} />
                                                <meshStandardMaterial color={portColor} roughness={0.8} metalness={0.02} emissive={portColor} emissiveIntensity={0.01} />
                                            </mesh>
                                        </group>
                                    ))}
                                </group>
                            );
                        })()}
                    </group>
                )}

                {/* Switch buttons */}
                {isSwitch && swShowButtons && !shapeHidden && swDims.ok && swButtonSpecs.length > 0 && (
                    <group position={[0, swDims.h * 0.5 + swThickness * 0.5, 0]}>
                        {swButtonSpecs.map((b) => {
                            const btn = (Array.isArray(sw.buttons) ? sw.buttons[b.idx] : null) || {};
                            const label = (btn.name ?? btn.label ?? `Btn ${b.idx + 1}`) || `Btn ${b.idx + 1}`;

                            const idleColor = btn.color ?? sw.buttonColor ?? "#22314d";
                            const pressedColor = btn.pressedColor ?? sw.pressedColor ?? "#101a2d";
                            const hoverEmissive = btn.hoverEmissive ?? sw.hoverEmissive ?? "#ffffff";

                            const textColor = btn.textColor ?? sw.textColor ?? "#e2e8f0";
                            const textScale = Number(btn.textScale ?? sw.textScale ?? 1) || 1;

                            const press01 = swPressAmtByIdx[b.idx] ?? 0;
                            const isPressed = press01 > 0.001;
                            const isHover = swHoverIdx === b.idx;

                            const yOff = -swPressDepth * press01;

                            // Text layout / orientation
                            const textRotationDeg = Number(btn.textRotationDeg ?? sw.textRotationDeg ?? 0) || 0;
                            const textAlign = (btn.textAlign ?? sw.textAlign ?? "center");
                            const textOffset = (() => {
                                const o = (btn.textOffset ?? sw.textOffset ?? { x: 0, y: 0 });
                                if (Array.isArray(o) && o.length >= 2) return { x: Number(o[0]) || 0, y: Number(o[1]) || 0 };
                                return { x: Number(o?.x) || 0, y: Number(o?.y) || 0 };
                            })();
                            const rotZ = (textRotationDeg * Math.PI) / 180;
                            const anchorX = textAlign === "left" ? "left" : (textAlign === "right" ? "right" : "center");

                            // Backlight + text glow (defaults can be overridden per button)
                            const backlight = { ...(sw.backlight || {}), ...(btn.backlight || {}) };
                            const textGlow = { ...(sw.textGlow || {}), ...(btn.textGlow || {}) };

                            const fillColor = (press01 <= 0.0001)
                                ? idleColor
                                : (press01 >= 0.999 ? pressedColor : lerpColorString(idleColor, pressedColor, press01));

                            const fs = Math.max(0.035, Math.min(0.12, Math.min(b.w, b.d) * 0.25 * textScale));

                            const backEnabled = !!backlight.enabled;
                            const backPad = Math.max(0, Number(backlight.padding ?? 0.012) || 0);
                            const backAlpha = clamp01(
                                (Number(backlight.opacity ?? 0.35) || 0.35) *
                                (Number(backlight.intensity ?? 1.6) || 1.6) *
                                (0.6 + 0.4 * press01)
                            );
                            const backColorNow = lerpColorString(
                                backlight.color ?? "#00b7ff",
                                backlight.pressedColor ?? (backlight.color ?? "#00b7ff"),
                                press01
                            );

                            const glowEnabled = !!textGlow.enabled;
                            const outlineWidth = glowEnabled
                                ? (Number(textGlow.outlineWidth ?? 0.02) || 0.02) * (Number(textGlow.intensity ?? 1) || 1)
                                : 0;
                            const outlineOpacity = glowEnabled ? clamp01(Number(textGlow.outlineOpacity ?? 0.8) || 0.8) : 1;
                            const outlineColor = glowEnabled
                                ? lerpColorString(
                                    textGlow.color ?? "#ffffff",
                                    textGlow.pressedColor ?? (textGlow.color ?? "#ffffff"),
                                    press01
                                )
                                : undefined;


                            return (
                                <group key={b.idx} position={[b.x, yOff, b.z]}>
                                    {backEnabled && (
                                        <mesh
                                            position={[0, swThickness * 0.5 + 0.0012, 0]}
                                            rotation={[-Math.PI / 2, 0, 0]}
                                            renderOrder={9997}
                                        >
                                            <planeGeometry args={[b.w + backPad * 2, b.d + backPad * 2]} />
                                            <meshBasicMaterial
                                                transparent
                                                depthWrite={false}
                                                toneMapped={false}
                                                blending={THREE.AdditiveBlending}
                                                opacity={backAlpha * uiAlpha}
                                                color={backColorNow}
                                            />
                                        </mesh>
                                    )}

                                    <mesh
                                        onPointerDown={(e) => {
                                            e.stopPropagation();
                                            if (dragging) return;

                                            // fluid press-in + press-out
                                            try {
                                                const idx = b.idx;
                                                const prev = swPressHoldTimeoutsRef.current[idx];
                                                if (prev) clearTimeout(prev);

                                                __startPressAnim(idx, 1, swPressAnimMs);
                                                swPressHoldTimeoutsRef.current[idx] = setTimeout(() => {
                                                    __startPressAnim(idx, 0, swPressAnimMs);
                                                }, swPressAnimMs + swPressHoldMs);
                                            } catch {}

                                            // Trigger configured actions
                                            onSwitchPress?.(node?.id, b.idx, e);

                                            // Also select node (matches normal click behavior)
                                            onPointerDown?.(node?.id, e);
                                        }}
                                        onPointerOver={(e) => {
                                            e.stopPropagation();
                                            setSwHoverIdx(b.idx);
                                            try { document.body.style.cursor = "pointer"; } catch {}
                                        }}
                                        onPointerOut={(e) => {
                                            e.stopPropagation();
                                            setSwHoverIdx((cur) => (cur === b.idx ? -1 : cur));
                                            try { document.body.style.cursor = "auto"; } catch {}
                                        }}
                                        castShadow={false}
                                        receiveShadow={receiveShadow && shadowsOn}
                                    >
                                        <boxGeometry args={[b.w, swThickness, b.d]} />
                                        <meshStandardMaterial
                                            color={fillColor}
                                            roughness={0.45}
                                            metalness={0.05}
                                            emissive={isHover ? hoverEmissive : "#000000"}
                                            emissiveIntensity={isHover ? 0.18 : 0}
                                            transparent={uiAlpha < 0.999}
                                            opacity={uiAlpha}
                                        />
                                    </mesh>

                                    {/* Button label */}
                                    {label && (
                                        <Text
                                            position={[textOffset.x || 0, swThickness * 0.5 + 0.0015, textOffset.y || 0]}
                                            rotation={[-Math.PI / 2, 0, rotZ]}
                                            fontSize={fs}
                                            color={textColor}
                                            anchorX={anchorX}
                                            outlineWidth={outlineWidth}
                                            outlineColor={outlineColor}
                                            outlineOpacity={outlineOpacity * uiAlpha}
                                            material-transparent
                                            material-opacity={uiAlpha}
                                            anchorY="middle"
                                            maxWidth={Math.max(0.1, b.w * 0.92)}
                                        >
                                            {label}
                                        </Text>
                                    )}
                                </group>
                            );
                        })}
                    </group>
                )}


                {/* Dissolver boundary (visual helper only) */}
                {isDissolver && dissolverEnabled && showDissolverBoundary && (
                    <group renderOrder={9996}>
                        {(dissType === "plane" || dissType === "slab") ? (
                            <mesh>
                                <boxGeometry args={[dissRadius * 2, dissThickness, dissRadius * 2]} />
                                <meshBasicMaterial
                                    color={dissColor}
                                    transparent
                                    opacity={dissOpacity * uiAlpha}
                                    wireframe
                                    depthWrite={false}
                                />
                            </mesh>
                        ) : (dissType === "cylinder" || dissType === "circle") ? (
                            <mesh>
                                <cylinderGeometry args={[dissRadius, dissRadius, dissHeight, 32, 1, true]} />
                                <meshBasicMaterial
                                    color={dissColor}
                                    transparent
                                    opacity={dissOpacity * uiAlpha}
                                    wireframe
                                    depthWrite={false}
                                />
                            </mesh>
                        ) : (
                            <mesh>
                                <sphereGeometry args={[dissRadius, 32, 16]} />
                                <meshBasicMaterial
                                    color={dissColor}
                                    transparent
                                    opacity={dissOpacity * uiAlpha}
                                    wireframe
                                    depthWrite={false}
                                />
                            </mesh>
                        )}
                    </group>
                )}

                {masterSelected && !shapeHidden && (
                    <mesh renderOrder={9997}>
                        {useModel || isAdvancedShape ? (
                            <boxGeometry
                                args={[
                                    (shapeBounds?.[0] ?? 1) + 0.06,
                                    (shapeBounds?.[1] ?? 1) + 0.06,
                                    (shapeBounds?.[2] ?? 1) + 0.06,
                                ]}
                            />
                        ) : (
                            <GeometryForShape
                                shape={(function inflateShape(s) {
                                    const t = (s.type || "sphere").toLowerCase();
                                    if (t === "sphere") return { ...s, radius: (s.radius ?? 0.32) + 0.05 };
                                    if (t === "cylinder" || t === "hexagon" || t === "disc" || t === "circle")
                                        return {
                                            ...s,
                                            radius: (s.radius ?? 0.35) + 0.05,
                                            height: (s.height ?? 0.6) + 0.05,
                                        };
                                    if (t === "cone")
                                        return {
                                            ...s,
                                            radius: (s.radius ?? 0.35) + 0.05,
                                            height: (s.height ?? 0.7) + 0.05,
                                        };
                                    if (t === "switch")
                                        return {
                                            ...s,
                                            w: (s.w ?? 0.9) + 0.05,
                                            h: (s.h ?? 0.12) + 0.05,
                                            d: (s.d ?? 0.35) + 0.05,
                                        };
                                    if (t === "box" || t === "square")
                                        return { ...s, scale: (s.scale || [0.6, 0.3, 0.6]).map((v) => v + 0.05) };
                                    return s;
                                })(shapeToRender)}
                            />
                        )}
                        <meshBasicMaterial color="#f59e0b" transparent opacity={0.35 * uiAlpha} depthWrite={false} />
                    </mesh>
                )}

                {/* selection halo */}
                {selected && !shapeHidden && (
                    <mesh renderOrder={9998}>
                        {useModel || isAdvancedShape ? (
                            <boxGeometry
                                args={[
                                    (shapeBounds?.[0] ?? 1) + 0.02,
                                    (shapeBounds?.[1] ?? 1) + 0.02,
                                    (shapeBounds?.[2] ?? 1) + 0.02,
                                ]}
                            />
                        ) : (
                            <GeometryForShape
                                shape={(function inflateShape(s) {
                                    const t = (s.type || "sphere").toLowerCase();
                                    if (t === "sphere") return { ...s, radius: (s.radius ?? 0.32) + 0.02 };
                                    if (t === "cylinder" || t === "hexagon" || t === "disc" || t === "circle")
                                        return {
                                            ...s,
                                            radius: (s.radius ?? 0.35) + 0.02,
                                            height: (s.height ?? 0.6) + 0.02,
                                        };
                                    if (t === "cone")
                                        return {
                                            ...s,
                                            radius: (s.radius ?? 0.35) + 0.02,
                                            height: (s.height ?? 0.7) + 0.02,
                                        };
                                    if (t === "switch")
                                        return {
                                            ...s,
                                            w: (s.w ?? 0.9) + 0.02,
                                            h: (s.h ?? 0.12) + 0.02,
                                            d: (s.d ?? 0.35) + 0.02,
                                        };
                                    if (t === "box" || t === "square")
                                        return { ...s, scale: (s.scale || [0.6, 0.3, 0.6]).map((v) => v + 0.02) };
                                    return s;
                                })(shapeToRender)}
                            />
                        )}
                        <meshBasicMaterial color="#ffffff" transparent opacity={0.18 * uiAlpha} depthWrite={false} />
                    </mesh>
                )}


                {/* link target hover halo */}
                {linkHover && !shapeHidden && !selected && (
                    <mesh renderOrder={9997}>
                        {useModel || isAdvancedShape ? (
                            <boxGeometry
                                args={[
                                    (shapeBounds?.[0] ?? 1) + 0.04,
                                    (shapeBounds?.[1] ?? 1) + 0.04,
                                    (shapeBounds?.[2] ?? 1) + 0.04,
                                ]}
                            />
                        ) : (
                            <GeometryForShape
                                shape={(function inflateShape(s) {
                                    const t = (s.type || "sphere").toLowerCase();
                                    if (t === "sphere") return { ...s, radius: (s.radius ?? 0.32) + 0.04 };
                                    if (t === "cylinder" || t === "hexagon" || t === "disc" || t === "circle")
                                        return {
                                            ...s,
                                            radius: (s.radius ?? 0.35) + 0.04,
                                            height: (s.height ?? 0.6) + 0.04,
                                        };
                                    if (t === "cone")
                                        return {
                                            ...s,
                                            radius: (s.radius ?? 0.35) + 0.04,
                                            height: (s.height ?? 0.7) + 0.04,
                                        };
                                    if (t === "switch")
                                        return {
                                            ...s,
                                            w: (s.w ?? 0.9) + 0.04,
                                            h: (s.h ?? 0.12) + 0.04,
                                            d: (s.d ?? 0.35) + 0.04,
                                        };
                                    if (t === "box" || t === "square")
                                        return { ...s, scale: (s.scale || [0.6, 0.3, 0.6]).map((v) => v + 0.04) };
                                    return s;
                                })(shapeToRender)}
                            />
                        )}
                        <meshBasicMaterial color="#38bdf8" transparent opacity={0.28 * uiAlpha} depthWrite={false} />
                    </mesh>
                )}

                {/* master/alternate master indicator */}
                {(masterSelected || masterSelectedAlt) && !shapeHidden && (() => {
                    const t = perfTimeRef.current || 0;
                    const masterFloat = 0.12 * Math.sin(t * 2.8);
                    const pulse = 0.9 + 0.12 * Math.sin(t * 4.6);
                    const ringSpin = t * 0.9;
                    const cPrimary = masterSelectedAlt ? "#a78bfa" : "#34d399";
                    const cGlow = masterSelectedAlt ? "#c4b5fd" : "#6ee7b7";
                    return (
                        <group position={[0, (shapeBounds?.[1] ?? 1) * 1.05 + masterFloat, 0]} scale={[pulse, pulse, pulse]}>
                            <mesh renderOrder={9999} position={[0, 0.18, 0]}>
                                <coneGeometry args={[0.2, 0.42, 28]} />
                                <meshBasicMaterial
                                    color={cPrimary}
                                    transparent
                                    opacity={0.96 * uiAlpha}
                                    depthWrite={false}
                                />
                            </mesh>
                            <mesh renderOrder={9998} position={[0, -0.02, 0]}>
                                <cylinderGeometry args={[0.07, 0.07, 0.24, 18]} />
                                <meshBasicMaterial
                                    color={cPrimary}
                                    transparent
                                    opacity={0.85 * uiAlpha}
                                    depthWrite={false}
                                />
                            </mesh>
                            <mesh renderOrder={9998} position={[0, -0.22, 0]} rotation={[Math.PI / 2, ringSpin, 0]}>
                                <torusGeometry args={[0.32, 0.022, 16, 80]} />
                                <meshBasicMaterial
                                    color={cGlow}
                                    transparent
                                    opacity={0.75 * uiAlpha}
                                    depthWrite={false}
                                />
                            </mesh>
                            <mesh renderOrder={9997} position={[0, -0.22, 0]} rotation={[Math.PI / 2, -ringSpin * 1.4, 0]}>
                                <ringGeometry args={[0.36, 0.4, 80]} />
                                <meshBasicMaterial
                                    color={cGlow}
                                    transparent
                                    opacity={0.45 * uiAlpha}
                                    depthWrite={false}
                                    side={THREE.DoubleSide}
                                />
                            </mesh>
                            <Billboard position={[0, 0.42, 0]}>
                                <mesh renderOrder={9997}>
                                    <planeGeometry args={[1.02, 0.3]} />
                                    <meshBasicMaterial
                                        color="#0b1020"
                                        transparent
                                        opacity={0.55 * uiAlpha}
                                        depthWrite={false}
                                    />
                                </mesh>
                                <Text
                                    fontSize={0.2}
                                    color={cGlow}
                                    anchorX="center"
                                    anchorY="middle"
                                    outlineWidth={0.012}
                                    outlineColor="#0b1020"
                                    material-transparent
                                    material-opacity={0.98 * uiAlpha}
                                >
                                    {masterSelectedAlt ? "ALT MASTER" : "MASTER"}
                                </Text>
                            </Billboard>
                        </group>
                    );
                })()}

                {flowAnchorsEnabled && !flowAnchorsHideRings && flowAnchors.length > 0 &&
                    (selected || selectedFlowAnchor?.nodeId === node?.id) && (
                    <group>
                        {flowAnchors.map((anchor, idx) => {
                            if (anchor?.enabled === false) return null;
                            const pos = Array.isArray(anchor?.pos) ? anchor.pos : null;
                            if (!pos) return null;
                            const isSelectedAnchor =
                                selectedFlowAnchor?.nodeId === node?.id &&
                                selectedFlowAnchor?.index === idx &&
                                (!selectedFlowAnchor?.setId || selectedFlowAnchor?.setId === flowAnchorSetId);
                            return (
                                <group
                                    key={anchor?.id || `flow-anchor-${idx}`}
                                    position={[pos[0] || 0, pos[1] || 0, pos[2] || 0]}
                                >
                                    <mesh
                                        rotation={[Math.PI / 2, 0, 0]}
                                        renderOrder={9999}
                                        onPointerDown={(e) => {
                                            e.stopPropagation();
                                            if (dragging) return;
                                            onFlowAnchorPointerDown?.(node?.id, flowAnchorSetId, idx, e);
                                        }}
                                    >
                                        <ringGeometry args={[0.06, 0.085, 32]} />
                                        <meshBasicMaterial
                                            color={isSelectedAnchor ? "#f59e0b" : "#7cf"}
                                            transparent
                                            opacity={0.85}
                                            side={THREE.DoubleSide}
                                        />
                                    </mesh>
                                </group>
                            );
                        })}
                    </group>
                )}

                {/* lights */}
                {hasLight && (
                    <>
                        {ltype === "spot" && (
                            <>
                                <spotLight
                                    ref={spotRef}
                                    color={color}
                                    intensity={0} // driven by dimmer in useFrame
                                    distance={Math.max(0.01, Number(distance || 0))}
                                    decay={Number(decay || 2)}
                                    angle={Number(angle || 0.6)}
                                    penumbra={Number(penumbra || 0.35)}
                                    castShadow={lightCasts && shadowsOn}
                                    shadow-mapSize={[shadowMapSize, shadowMapSize]}
                                    shadow-bias={shadowBias}
                                    shadow-normalBias={shadowNormalBias}
                                />
                                <object3D ref={targetRef} position={targetPos} />
                            </>
                        )}

                        {ltype === "point" && (
                            <pointLight
                                ref={pointRef}
                                color={color}
                                intensity={0} // driven by dimmer in useFrame
                                distance={Number(distance || 0)}
                                decay={Number(decay || 2)}
                                castShadow={lightCasts && shadowsOn}
                                shadow-mapSize={[shadowMapSize, shadowMapSize]}
                                shadow-bias={shadowBias}
                                shadow-normalBias={shadowNormalBias}
                            />
                        )}

                        {(ltype === "dir" || ltype === "directional") && (
                            <>
                                <directionalLight
                                    ref={dirRef}
                                    color={color}
                                    intensity={0} // driven by dimmer in useFrame
                                    castShadow={lightCasts && shadowsOn}
                                    shadow-mapSize={[shadowMapSize, shadowMapSize]}
                                    shadow-bias={shadowBias}
                                    shadow-normalBias={shadowNormalBias}
                                />
                                <object3D ref={targetRef} position={targetPos} />
                            </>
                        )}
                    </>
                )}

                {/* labels + optional product photo */}
                {labelsOn && labelFull && (
                    <>
                        {labelModeEffective === "billboard" && (
                            <Billboard follow position={[labelXOffset, labelY, 0]}>
                                <group>
                                    {selected || !spriteLabelTex ? (
                                        <Text
                                            fontSize={labelSizeLocal}
                                            color={labelColorLocal}
                                            font={labelFontLocal}
                                            maxWidth={labelMaxWidthEff}
                                            textAlign={labelTextAlign}
                                            overflowWrap={labelOverflowWrap}
                                            letterSpacing={labelLetterSpacing}
                                            lineHeight={labelLineHeight}
                                            strokeWidth={labelStrokeWidth}
                                            strokeColor={labelStrokeColor}
                                            anchorX={labelAnchorX}
                                            anchorY="bottom"
                                            outlineWidth={labelOutlineWidth}
                                            outlineColor={labelOutlineColor}
                                            outlineBlur={labelOutlineBlur}
                                            outlineOpacity={uiAlpha * labelFillOpacity}
                                            depthTest={false}
                                            depthWrite={false}
                                            renderOrder={9999}
                                            material-transparent
                                            material-opacity={uiAlpha * labelFillOpacity}
                                            material-alphaTest={0}
                                            outlineAlphaTest={0}
                                        >
                                            {labelFull}
                                        </Text>
                                    ) : (
                                        <sprite scale={spriteScale}>
                                            <spriteMaterial
                                                map={spriteLabelTex}
                                                transparent
                                                opacity={uiAlpha * labelFillOpacity}
                                                depthTest={false}
                                                depthWrite={false}
                                            />
                                        </sprite>
                                    )}

                                    {showPhotoEffective && (
                                        <Html transform position={[0, labelSize * 0.75, 0]} pointerEvents="none">
                                            <div
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: 6,
                                                    background: "rgba(0,0,0,0.45)",
                                                    border: "1px solid rgba(255,255,255,0.2)",
                                                    padding: "4px 6px",
                                                    borderRadius: 8,
                                                    boxShadow: "0 6px 14px rgba(0,0,0,0.45)",
                                                    backdropFilter: "blur(4px)",
                                                    opacity: uiAlpha,
                                                }}
                                            >
                                                <img
                                                    src={coverUrl}
                                                    alt={product?.name || "product"}
                                                    style={{
                                                        width: 120,
                                                        height: 80,
                                                        objectFit: "cover",
                                                        borderRadius: 8,
                                                        imageRendering: "auto",
                                                    }}
                                                    draggable={false}
                                                />
                                            </div>
                                        </Html>
                                    )}
                                </group>
                            </Billboard>
                        )}

                        {labelModeEffective === "3d" && selected && (
                            <group position={[labelXOffset, labelY, 0]}>
                                {Array.from({ length: label3DLayersLocal }).map((_, i) => (
                                    <Text
                                        key={`f${i}`}
                                        position={[0, 0, -i * label3DStepLocal]}
                                        fontSize={labelSizeLocal}
                                        color={labelColorLocal}
                                        font={labelFontLocal}
                                        maxWidth={labelMaxWidthEff}
                                        textAlign={labelTextAlign}
                                        overflowWrap={labelOverflowWrap}
                                        letterSpacing={labelLetterSpacing}
                                        lineHeight={labelLineHeight}
                                        strokeWidth={labelStrokeWidth}
                                        strokeColor={labelStrokeColor}
                                        anchorX={labelAnchorX}
                                        anchorY="bottom"
                                        outlineWidth={i === 0 ? labelOutlineWidth : 0}
                                        outlineColor={labelOutlineColor}
                                        outlineBlur={labelOutlineBlur}
                                        material-alphaTest={0}
                                        outlineAlphaTest={0}
                                        outlineOpacity={i === 0 ? uiAlpha * labelFillOpacity : 0}
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                        material-transparent
                                        material-opacity={uiAlpha * labelFillOpacity}
                                    >
                                        {labelFull}
                                    </Text>
                                ))}

                                <group rotation={[0, Math.PI, 0]}>
                                    {Array.from({ length: label3DLayersLocal }).map((_, i) => (
                                        <Text
                                            key={`b${i}`}
                                            position={[0, 0, -i * label3DStepLocal]}
                                            fontSize={labelSizeLocal}
                                            color={labelColorLocal}
                                            font={labelFontLocal}
                                            maxWidth={labelMaxWidthEff}
                                            textAlign={labelTextAlignBack}
                                            overflowWrap={labelOverflowWrap}
                                            letterSpacing={labelLetterSpacing}
                                            lineHeight={labelLineHeight}
                                            strokeWidth={labelStrokeWidth}
                                            strokeColor={labelStrokeColor}
                                            anchorX={labelAnchorXBack}
                                            anchorY="bottom"
                                            outlineWidth={i === 0 ? labelOutlineWidth : 0}
                                            material-alphaTest={0}
                                            outlineAlphaTest={0}
                                            outlineColor={labelOutlineColor}
                                            outlineBlur={labelOutlineBlur}
                                            outlineOpacity={i === 0 ? uiAlpha * labelFillOpacity : 0}
                                            depthTest={false}
                                            depthWrite={false}
                                            renderOrder={9999}
                                            material-transparent
                                            material-opacity={uiAlpha * labelFillOpacity}
                                        >
                                            {labelFull}
                                        </Text>
                                    ))}
                                </group>
                            </group>
                        )}

                        {labelModeEffective === "static" && selected && (
                            <>
                                <group position={[labelXOffset, labelY, 0]} rotation={[0, 0, 0]}>
                                    <Text
                                        fontSize={labelSizeLocal}
                                        color={labelColorLocal}
                                        font={labelFontLocal}
                                        maxWidth={labelMaxWidthEff}
                                        textAlign={labelTextAlign}
                                        overflowWrap={labelOverflowWrap}
                                        letterSpacing={labelLetterSpacing}
                                        lineHeight={labelLineHeight}
                                        strokeWidth={labelStrokeWidth}
                                        strokeColor={labelStrokeColor}
                                        anchorX={labelAnchorX}
                                        anchorY="bottom"
                                        outlineWidth={labelOutlineWidth}
                                        material-alphaTest={0}
                                        outlineAlphaTest={0}
                                        outlineColor={labelOutlineColor}
                                        outlineBlur={labelOutlineBlur}
                                        outlineOpacity={uiAlpha * labelFillOpacity}
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                        material-transparent
                                        material-opacity={uiAlpha * labelFillOpacity}
                                    >
                                        {labelFull}
                                    </Text>
                                </group>

                                <group position={[labelXOffset, labelY, 0]} rotation={[0, Math.PI, 0]}>
                                    <Text
                                        fontSize={labelSizeLocal}
                                        color={labelColorLocal}
                                        font={labelFontLocal}
                                        maxWidth={labelMaxWidthEff}
                                        textAlign={labelTextAlignBack}
                                        overflowWrap={labelOverflowWrap}
                                        letterSpacing={labelLetterSpacing}
                                        lineHeight={labelLineHeight}
                                        strokeWidth={labelStrokeWidth}
                                        strokeColor={labelStrokeColor}
                                        anchorX={labelAnchorXBack}
                                        anchorY="bottom"
                                        outlineWidth={labelOutlineWidth}
                                        material-alphaTest={0}
                                        outlineAlphaTest={0}
                                        outlineColor={labelOutlineColor}
                                        outlineBlur={labelOutlineBlur}
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                        material-transparent
                                        material-opacity={uiAlpha * labelFillOpacity}
                                    >
                                        {labelFull}
                                    </Text>
                                </group>
                            </>
                        )}
                    </>
                )}

                {!suspendUI && node.textBox?.enabled && (
                    <NodeTextBox
                        enabled={node.textBox.enabled !== false}
                        text={node.textBox.text || ""}

                        // timings
                        fadeIn={Number(node.textBox.fadeIn ?? 0)}
                        hold={Number(node.textBox.hold ?? 0)}
                        fadeOut={Number(node.textBox.fadeOut ?? 0)}
                        useTimers={!!node.textBox.useTimers}
                        autoTriggerId={Number(node.textBox.autoTriggerId ?? 0)}

                        // manual command channel
                        commandId={Number(node.textBox.commandId ?? 0)}
                        commandType={node.textBox.commandType || null} // "show" | "hide" | "fadeIn" | "fadeOut"
                        commandDuration={
                            node.textBox.commandDuration != null
                                ? Number(node.textBox.commandDuration)
                                : null
                        }

                        // visuals (convert old world-units to px if small)
                        bgColor={node.textBox.bgColor ?? "#000000"}
                        bgOpacity={Number(
                            node.textBox.bgOpacity ??
                            node.textBox.backgroundOpacity ?? // legacy
                            0.6
                        )}
                        color={node.textBox.color ?? node.textBox.textColor ?? "#ffffff"}
                        width={(() => {
                            const tb = node.textBox || {};
                            const has = Object.prototype.hasOwnProperty.call(tb, "width");
                            if (!has) return 320;
                            const raw = Number(tb.width);
                            if (!Number.isFinite(raw) || raw <= 0) return 0; // 0 => auto
                            if (raw <= 5) return raw * 220; // 1.6 → ~350px
                            return raw;
                        })()}
                        height={(() => {
                            const tb = node.textBox || {};
                            const has = Object.prototype.hasOwnProperty.call(tb, "height");
                            if (!has) return 140;
                            const raw = Number(tb.height);
                            if (!Number.isFinite(raw) || raw <= 0) return 0; // 0 => auto
                            if (raw <= 3) return raw * 180; // 0.8 → ~140px
                            return raw;
                        })()}
                        minWidth={(() => {
                            const raw = Number(node.textBox?.minWidth ?? 0) || 0;
                            if (raw <= 0) return 0;
                            if (raw <= 5) return raw * 220;
                            return raw;
                        })()}
                        minHeight={(() => {
                            const raw = Number(node.textBox?.minHeight ?? 0) || 0;
                            if (raw <= 0) return 0;
                            if (raw <= 3) return raw * 180;
                            return raw;
                        })()}
                        maxWidth={(() => {
                            const raw = Number(node.textBox?.maxWidth ?? 0) || 0;
                            if (raw <= 0) return 0;
                            if (raw <= 5) return raw * 220;
                            return raw;
                        })()}
                        maxHeight={(() => {
                            const raw = Number(node.textBox?.maxHeight ?? 0) || 0;
                            if (raw <= 0) return 0;
                            if (raw <= 3) return raw * 180;
                            return raw;
                        })()}
                        fontSize={(() => {
                            const raw = Number(node.textBox.fontSize ?? 0) || 0;
                            if (raw > 0 && raw <= 0.5) return raw * 64; // 0.18 → ~11.5px
                            return raw || 16;
                        })()}

                        // rich text + sizing helpers
                        richText={!!node.textBox?.richText}
                        fitContent={!!node.textBox?.fitContent}
                        autoScroll={node.textBox?.autoScroll !== false}
                        autoScrollSpeed={Number(node.textBox?.autoScrollSpeed ?? 0.4)}

                        mode={node.textBox.mode || "billboard"}
                        position={[0, yOffset + 0.4, 0]}
                        parentOpacity={uiAlpha}

                        // advanced style passthrough (so editor controls actually work)
                        align={node.textBox?.align ?? "left"}
                        wrap={node.textBox?.wrap ?? "pre-wrap"}
                        fontFamily={node.textBox?.fontFamily ?? ""}
                        fontWeight={node.textBox?.fontWeight ?? "normal"}
                        fontStyle={node.textBox?.fontStyle ?? "normal"}
                        letterSpacing={Number(node.textBox?.letterSpacing ?? 0) || 0}
                        lineHeight={Number(node.textBox?.lineHeight ?? 1.4) || 1.4}
                        padding={Number(node.textBox?.padding ?? 10) || 10}
                        borderRadius={Number(node.textBox?.borderRadius ?? 10) || 10}
                        borderWidth={Number(node.textBox?.borderWidth ?? 0) || 0}
                        borderColor={node.textBox?.borderColor ?? "#ffffff"}
                        borderOpacity={Number(node.textBox?.borderOpacity ?? 1)}
                        shadow={node.textBox?.shadow !== false}
                        allowPointerEvents={node.textBox?.allowPointerEvents !== false}
                        // Clicking the textbox should select the node (so the inspector updates)
                        onSelect={(e) => {
                            if (dragging) return;
                            try { onPointerDown?.(node?.id, e); } catch {}
                        }}
                        // Keep OrbitControls zoom / scroll working while hovering the textbox
                        forwardWheelToCanvas={node.textBox?.forwardWheelToCanvas !== false}
                        backdropBlur={Number(node.textBox?.backdropBlur ?? 0) || 0}
                        backdropSaturate={Number(node.textBox?.backdropSaturate ?? 100) || 100}
                        distanceFactor={
                            node.textBox?.distanceFactor != null
                                ? Number(node.textBox.distanceFactor)
                                : undefined
                        }
                    />
                )}



                {/* dimension overlays (when product dims are used) */}
                {half && product && productRef?.useDims && (showDimsGlobal || productRef?.showDims) && dimText && (
                    <group>
                        {/* length (Z) */}
                        <Dim
                            a={[-half[0], half[1] + 0.04, -half[2]]}
                            b={[-half[0], half[1] + 0.04, half[2]]}
                            text={`L ${dimText.l}`}
                            opacityMul={uiAlpha}
                        />
                        {/* width (X) */}
                        <Dim
                            a={[half[0], half[1] + 0.04, -half[2]]}
                            b={[-half[0], half[1] + 0.04, -half[2]]}
                            text={`W ${dimText.w}`}
                            opacityMul={uiAlpha}
                        />
                        {/* height (Y) */}
                        <Dim
                            a={[-half[0], -half[1], half[2]]}
                            b={[-half[0], half[1], half[2]]}
                            text={`H ${dimText.h}`}
                            opacityMul={uiAlpha}
                        />
                    </group>
                )}
                {/* overview card when selected and representative is set */}
                {represent?.enabled && (alwaysShow3DInfo || (selected && show3DInfo)) && (
                    <Html
                        transform
                        position={[labelXOffset, labelY + labelSize * 0.9 + infoYOffset, 0]}
                        pointerEvents="none"
                    >                        <div
                        style={{
                            opacity: uiAlpha,
                            minWidth: 260,
                            maxWidth: 380,
                            background: "linear-gradient(180deg, rgba(0,0,0,0.75), rgba(0,0,0,0.55))",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 12,
                            padding: 10,
                            boxShadow: "0 10px 28px rgba(0,0,0,0.55)",
                            color: "#e9f3ff",
                            fontSize: infoFont
                        }}
                    >
                        {represent.kind === "product" && product && (
                            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10 }}>
                                {coverUrl && (
                                    <img
                                        src={coverUrl}
                                        alt={product.name}
                                        style={{ width: 100, height: 70, objectFit: "cover", borderRadius: 8 }}
                                        draggable={false}
                                    />
                                )}
                                <div>
                                    <div style={{ fontWeight: 900, marginBottom: 2 }}>{product.name}</div>
                                    <div style={{ opacity: 0.8 }}>
                                        {[product.category, product.make, product.model].filter(Boolean).join(" › ")}
                                    </div>
                                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                                        <strong>W×H×L:</strong>{" "}
                                        {(product.width ?? product?.dims?.w) ?? 0} × {(product.height ?? product?.dims?.h) ?? 0} × {(product.length ?? product?.dims?.l) ?? 0} {localStorage.getItem("epic3d.productUnits.v1") || "cm"}
                                    </div>
                                </div>
                            </div>
                        )}

                        {represent.kind === "rack" && rackResolved && (
                            <RackListView
                                rack={rackResolved}
                                unit={unit}
                                ui={ui}
                                editable={false}
                            />
                        )}


                    </div>
                    </Html>
                )}


                {/* light bounds */}
                <LightBounds node={node} globalOn={showLightBoundsGlobal} opacityMul={uiAlpha} />

            </group>
        );
    })
);

export default Node3D;
export { NodeShapeAdvanced };

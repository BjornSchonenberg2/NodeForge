// src/nodes/Node3D.jsx
import React, {memo, forwardRef, useEffect, useMemo, useRef, useState, useCallback} from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text, Html } from "@react-three/drei";
import RackListView from "../ui/RackListView.jsx";

import GeometryForShape from "../geometry/GeometryForShape.jsx";
import LightBounds from "../lights/LightBounds.jsx";
import { clusterColor } from "../utils/clusters.js";
import { getProductById, getRackById } from "../data/products/store.js";
import { buildBundledProductPicturesIndex, buildDiskProductPicturesIndex, hasFs as hasPicsFs, resolvePictureRef } from "../data/products/productPicturesIndex.js";
import NodeTextBox from "./NodeTextBox.jsx";

/* -------------------------------- helpers -------------------------------- */


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

/* --------------------------------- main ---------------------------------- */

const Node3D = memo(
    forwardRef(function Node3D(
        {
            node,
            productsVersion = 0,
            selected = false,
            onPointerDown,
            onSwitchPress,
            dragging = false,

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
        },
        ref
    ) {
        /* ---------- basic props ---------- */
        const position = node?.position || [0, 0, 0];
        const rotation = node?.rotation || [0, 0, 0];
        const baseColor = node?.color || clusterColor(node?.cluster);
        const wantsVisible = node?.visible !== false;
        const shapeHidden = !!(node?.hiddenMesh);

        /* ---------- cinematic fade (optional) ---------- */
        const fadeCfg = node?.fade || {};
        // Default ON so action buttons can fade nodes without needing per-node enable flags.
        const fadeEnabled = fadeCfg.enabled !== false;
        const fadeInDur = Math.max(
            0,
            Number(
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
                fadeCfg.fadeOutDuration ??
                fadeCfg.outDuration ??
                fadeCfg.fadeOut ??
                fadeCfg.out ??
                0.6,
            ) || 0.6,
        );
        const [fadeAlpha, _setFadeAlpha] = useState(1);
        const fadeAlphaRef = useRef(1);
        const setFadeAlpha = useCallback((v) => {
            const nv = clamp01(v);
            fadeAlphaRef.current = nv;
            _setFadeAlpha(nv);
        }, []);

        const fadeAnimRef = useRef(null); // { from,to,dur,elapsed }
        /* ---------- visibility fade (node.visible) ---------- */
        const [visAlpha, _setVisAlpha] = useState(wantsVisible ? 1 : 0);
        const visAlphaRef = useRef(wantsVisible ? 1 : 0);
        const setVisAlpha = useCallback((v) => {
            const nv = clamp01(v);
            visAlphaRef.current = nv;
            _setVisAlpha(nv);
        }, []);
        const visAnimRef = useRef(null); // { from,to,dur,elapsed }

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

        // Listen for global fade events (so action buttons / scripts can trigger fades).
        useEffect(() => {
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
        }, [fadeEnabled, node?.id, node?.roomId, node?.deckId, node?.groupId, fadeInDur, fadeOutDur]);

        // Animate fade
        useFrame((_, dt) => {
            const a = fadeAnimRef.current;
            if (!a) return;
            a.elapsed += dt;
            const t = a.dur <= 0 ? 1 : clamp01(a.elapsed / a.dur);
            const e = easeInOutCubic(t);
            const v = a.from + (a.to - a.from) * e;
            if (Math.abs(v - fadeAlphaRef.current) > 0.0005) setFadeAlpha(v);
            if (t >= 1) {
                fadeAnimRef.current = null;
                setFadeAlpha(a.to);
            }
        });

        useFrame((_, dt) => {
            const a = visAnimRef.current;
            if (!a) return;
            a.elapsed += dt;
            const t = a.dur <= 0 ? 1 : Math.max(0, Math.min(1, a.elapsed / a.dur));
            const e = easeInOutCubic(t);
            const v = a.from + (a.to - a.from) * e;
            if (Math.abs(v - visAlphaRef.current) > 0.0005) setVisAlpha(v);
            if (t >= 1) {
                visAnimRef.current = null;
                setVisAlpha(a.to);
            }
        });

        const uiAlpha = clamp01(fadeAlpha) * clamp01(visAlpha);
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
            return 0.44;
        }, [shapeToRender]);

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

        useFrame((_, dt) => {
            if (!hasLight) return;
            const l = spotRef.current || pointRef.current || dirRef.current;
            if (!l) return;

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
        });

        const shadowMapSize = Math.max(256, Math.min(4096, Number(light?.shadowMapSize ?? 1024)));
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
        const label3DStepLocal = Math.max(0, Number(node?.label3DStep ?? label3DStep) || label3DStep);


// optional outline support from the inspector
        const labelOutlineOn    = !!node?.labelOutline;
        const labelOutlineWidth = labelOutlineOn ? (Number(node?.labelOutlineWidth ?? 0.02) || 0.02) : 0;
        const labelOutlineColor = labelOutlineOn ? (node?.labelOutlineColor ?? "#000000") : "#000000";

        /* ---------- switch (pressable) ---------- */
        const isSwitch = (node?.kind || "node") === "switch";
        const sw = node?.switch || {};
        const swButtonsCountRaw = (sw.buttonsCount ?? (Array.isArray(sw.buttons) ? sw.buttons.length : null) ?? 2);
        const swButtonsCount = Math.max(1, Math.min(12, Math.floor(Number(swButtonsCountRaw) || 2)));

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

        useFrame(() => {
            if (!isSwitch) return;
            if (swPressAnimRef.current.size === 0) return;

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

        /* -------------------------------- render -------------------------------- */

        return (
            <group
                ref={ref}
                position={position}
                rotation={rotation}
                visible={uiAlpha > 0.001}
                userData={{ ...(node?.userData || {}), __epicType: "node", __nodeId: node?.id }}
                onPointerDown={(e) => {
                    // Node should *always* win when it’s hit
                    e.stopPropagation();
                    onPointerDown?.(node.id, e);
                }}
                castShadow={castShadow && shadowsOn}        // <-- use global too (added in step 2)
                receiveShadow={receiveShadow && shadowsOn}
            >
                {/* main mesh */}
                {!shapeHidden && (
                    <mesh castShadow={castShadow && shadowsOn} receiveShadow={receiveShadow && shadowsOn}>
                        <GeometryForShape shape={shapeToRender} />
                        <meshStandardMaterial
                            color={baseColor}
                            roughness={0.35}
                            metalness={0.05}
                            transparent={uiAlpha < 0.999}
                            opacity={uiAlpha}
                        />
                    </mesh>
                )}

                {/* Switch buttons */}
                {isSwitch && !shapeHidden && swDims.ok && swButtonSpecs.length > 0 && (
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

                {/* selection halo */}
                {selected && !shapeHidden && (
                    <mesh renderOrder={9998}>
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
                        <meshBasicMaterial color="#ffffff" transparent opacity={0.18 * uiAlpha} depthWrite={false} />
                    </mesh>
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
                        {labelMode === "billboard" && (
                            <Billboard follow position={[0, yOffset, 0]}>
                                <group>
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
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                        material-transparent
                                        material-opacity={uiAlpha * labelFillOpacity}
                                    >
                                        {labelFull}
                                    </Text>

                                    {showPhoto && (
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

                        {labelMode === "3d" && (
                            <group position={[0, yOffset, 0]}>
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
                                    ))}
                                </group>
                            </group>
                        )}

                        {labelMode === "static" && (
                            <>
                                <group position={[0, yOffset, 0]} rotation={[0, 0, 0]}>
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
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                        material-transparent
                                        material-opacity={uiAlpha * labelFillOpacity}
                                    >
                                        {labelFull}
                                    </Text>
                                </group>

                                <group position={[0, yOffset, 0]} rotation={[0, Math.PI, 0]}>
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

                {node.textBox?.enabled && (
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
                        position={[0, yOffset + labelSize * 0.9 + infoYOffset, 0]}
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
                <LightBounds node={node} globalOn={showLightBoundsGlobal} />

            </group>
        );
    })
);

export default Node3D;

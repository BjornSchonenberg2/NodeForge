import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from "react";
import { OrbitControls, TransformControls, Grid, ContactShadows, Environment, Billboard, Text } from "@react-three/drei";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Match your project structure:
import ImportedModel from "./gltf/ImportedModel.jsx";
import RoomBox from "./rooms/RoomBox.jsx";
import Node3D from "./nodes/Node3D.jsx";
import Link3D from "./links/Link3D.jsx";
import InteractionLayer from "./interaction/InteractionLayer.jsx";
import { clusterColor } from "./utils/clusters.js";

const __publicBasePath = () => {
    const envBase = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
    if (envBase) return envBase;
    if (typeof window === "undefined") return "";
    try {
        const url = new URL(".", window.location.href);
        const path = String(url.pathname || "").replace(/\/+$/, "");
        return path === "/" ? "" : path;
    } catch {
        const path = String(window.location?.pathname || "").replace(/\/+$/, "");
        return path === "/" ? "" : path;
    }
};

const __workerUrl = (name) => {
    const base = __publicBasePath();
    return `${base}/workers/${name}`;
};


// -------- Node flow anchor spread (endpoint fan-out) --------
class EnvErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    componentDidCatch(err) {
        this.setState({ hasError: true });
        if (this.props.onError) this.props.onError(err);
    }
    render() {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}

const __TAU = Math.PI * 2;
function __hashAngle(id) {
    const s = String(id ?? "");
    // FNV-1a 32-bit hash
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const u = (h >>> 0) / 4294967295;
    return u * __TAU;
}

function __endpointOffsetXZ(node, idx, count) {
    const r = Number(node?.flowAnchor ?? node?.anchorSpread ?? 0);
    if (!Number.isFinite(r) || r <= 0 || !count || count <= 1) return [0, 0, 0];
    const base = __hashAngle(node?.id || "");
    const a = base + (idx / count) * __TAU;
    return [Math.cos(a) * r, 0, Math.sin(a) * r];
}

function __normalizeAnchorBendDeg(v) {
    const n = Number(v) || 0;
    if (n <= 0) return 0;
    return n >= 67.5 ? 90 : 45;
}

function __applyFlowAnchorBends(points, anchorBendsByIndex) {
    if (!Array.isArray(points) || points.length < 3) return points;
    if (!anchorBendsByIndex || anchorBendsByIndex.size === 0) return points;
    const out = [points[0]];
    const pushPoint = (pt) => {
        const last = out[out.length - 1];
        if (
            !last ||
            Math.abs(pt[0] - last[0]) > 1e-6 ||
            Math.abs(pt[1] - last[1]) > 1e-6 ||
            Math.abs(pt[2] - last[2]) > 1e-6
        ) {
            out.push(pt);
        }
    };

    for (let i = 1; i < points.length - 1; i++) {
        const bendDeg = __normalizeAnchorBendDeg(anchorBendsByIndex.get(i));
        if (bendDeg <= 0) {
            out.push(points[i]);
            continue;
        }
        if (Math.abs(bendDeg - 90) <= 1e-6) {
            const prev = points[i - 1];
            const cur = points[i];
            const next = points[i + 1];
            const dxIn = (cur[0] || 0) - (prev[0] || 0);
            const dzIn = (cur[2] || 0) - (prev[2] || 0);
            const dxOut = (next[0] || 0) - (cur[0] || 0);
            const dzOut = (next[2] || 0) - (cur[2] || 0);
            const inCorner = Math.abs(dxIn) >= Math.abs(dzIn)
                ? [cur[0], cur[1], prev[2]]
                : [prev[0], cur[1], cur[2]];
            const outCorner = Math.abs(dxOut) >= Math.abs(dzOut)
                ? [next[0], cur[1], cur[2]]
                : [cur[0], cur[1], next[2]];
            pushPoint(inCorner);
            pushPoint(cur);
            pushPoint(outCorner);
            continue;
        }
        // 45-degree rule: keep a hard anchor corner (never rounded/chamfered).
        pushPoint(points[i]);
    }
    out.push(points[points.length - 1]);
    return out;
}

function __forceOrthogonalXZ(points) {
    if (!Array.isArray(points) || points.length < 2) return points;
    const first = points[0];
    const last = points[points.length - 1];
    const overallDx = (last?.[0] || 0) - (first?.[0] || 0);
    const overallDz = (last?.[2] || 0) - (first?.[2] || 0);
    const preferXFirst =
        Math.abs(overallDx) > 1e-6 &&
        (Math.abs(overallDx) >= Math.abs(overallDz) || Math.abs(overallDz) <= 1e-6);
    const out = [first];
    const pushUnique = (pt) => {
        const lastPt = out[out.length - 1];
        if (
            !lastPt ||
            Math.abs(pt[0] - lastPt[0]) > 1e-6 ||
            Math.abs(pt[1] - lastPt[1]) > 1e-6 ||
            Math.abs(pt[2] - lastPt[2]) > 1e-6
        ) {
            out.push(pt);
        }
    };
    for (let i = 1; i < points.length; i++) {
        const prev = out[out.length - 1];
        const target = points[i];
        const dx = (target[0] || 0) - (prev[0] || 0);
        const dz = (target[2] || 0) - (prev[2] || 0);
        if (Math.abs(dx) > 1e-6 && Math.abs(dz) > 1e-6) {
            const goXFirst = i === 1 ? preferXFirst : Math.abs(dx) >= Math.abs(dz);
            const rawMid = goXFirst
                ? [target[0], prev[1], prev[2]]
                : [prev[0], prev[1], target[2]];
            const minX = Math.min(prev[0], target[0]);
            const maxX = Math.max(prev[0], target[0]);
            const minZ = Math.min(prev[2], target[2]);
            const maxZ = Math.max(prev[2], target[2]);
            const mid = [
                Math.min(maxX, Math.max(minX, rawMid[0])),
                rawMid[1],
                Math.min(maxZ, Math.max(minZ, rawMid[2])),
            ];
            pushUnique(mid);
        }
        pushUnique(target);
    }
    return out;
}

function __getFlowAnchorSets(node) {
    const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
    if (sets.length) return sets;
    const legacyAnchors = Array.isArray(node?.flowAnchors) ? node.flowAnchors : [];
    if (legacyAnchors.length) {
        return [{
            id: node?.flowAnchorActiveSetId || "fas-default",
            name: "Default",
            anchors: legacyAnchors,
            globalBendDeg: node?.flowAnchorGlobalBendDeg ?? 0,
            dynamicBreakpoints: node?.flowAnchorDynamicBreakpoints ?? false,
            noDiagonal: node?.flowAnchorNoDiagonal ?? false,
            spreadPaths: node?.flowAnchorSpreadPaths ?? 0,
            hideRings: node?.flowAnchorsHideRings ?? false,
        }];
    }
    return [];
}

function __findFlowAnchorSet(node, setId, allowFallback = true) {
    const sets = __getFlowAnchorSets(node);
    if (!sets.length) return null;
    if (setId) {
        const hit = sets.find((s) => s?.id === setId);
        if (hit) return hit;
        if (!allowFallback) return null;
    }
    return sets[0];
}

function __linkPathMapsEqual(a, b) {
    if (a === b) return true;
    if (!(a instanceof Map) || !(b instanceof Map)) return false;
    if (a.size !== b.size) return false;
    for (const [id, next] of b.entries()) {
        const prev = a.get(id);
        if (!prev) return false;
        if (!!prev.forceOrthogonal !== !!next.forceOrthogonal) return false;
        if (!!prev.forceStraight !== !!next.forceStraight) return false;
        const pPrev = Array.isArray(prev.points) ? prev.points : [];
        const pNext = Array.isArray(next.points) ? next.points : [];
        if (pPrev.length !== pNext.length) return false;
        for (let i = 0; i < pNext.length; i++) {
            const A = pPrev[i];
            const B = pNext[i];
            if (!Array.isArray(A) || !Array.isArray(B)) return false;
            const ax = Number(A[0]) || 0;
            const ay = Number(A[1]) || 0;
            const az = Number(A[2]) || 0;
            const bx = Number(B[0]) || 0;
            const by = Number(B[1]) || 0;
            const bz = Number(B[2]) || 0;
            if (Math.abs(ax - bx) > 1e-5 || Math.abs(ay - by) > 1e-5 || Math.abs(az - bz) > 1e-5) return false;
        }
    }
    return true;
}

// -------- Global lighting prefs (localStorage; updated via window event) --------
const FADE_GROUPS_KEY = "epic3d.fade.groups.v1";
function readFadeGroupIds() {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(FADE_GROUPS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.map((v) => String(v)).filter(Boolean);
    } catch {
        return [];
    }
}
function writeFadeGroupIds(ids) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(FADE_GROUPS_KEY, JSON.stringify(ids || []));
    } catch {}
}

function readLightingPrefs() {
    const fallback = {
        envPreset: "warehouse",
        envIntensity: 0.8,
        hemiIntensity: 0.7,
        sunIntensity: 2.4,
        sunPosX: 6,
        sunPosY: 8,
        sunPosZ: 6,
        fillIntensity: 1.0,
        fillPosX: -5,
        fillPosY: 4,
        fillPosZ: -3,
        exposure: 1.0,
    };

    if (typeof window === "undefined") return fallback;

    try {
        // IMPORTANT:
        // localStorage.getItem(k) returns null when the key is missing.
        // Number(null) === 0 (finite), which can accidentally zero-out lights
        // and make the whole scene appear "invisible" on startup.
        const getNum = (k, f) => {
            const raw = localStorage.getItem(k);
            if (raw === null || raw === "") return f;
            const v = Number(raw);
            return Number.isFinite(v) ? v : f;
        };
        const getStr = (k, f) => {
            const raw = localStorage.getItem(k);
            return raw === null || raw === "" ? f : raw;
        };

        return {
            envPreset: getStr("epic3d.lighting.envPreset.v1", fallback.envPreset),
            envIntensity: getNum("epic3d.lighting.envIntensity.v1", fallback.envIntensity),
            hemiIntensity: getNum("epic3d.lighting.hemiIntensity.v1", fallback.hemiIntensity),
            sunIntensity: getNum("epic3d.lighting.sunIntensity.v1", fallback.sunIntensity),
            sunPosX: getNum("epic3d.lighting.sunPosX.v1", fallback.sunPosX),
            sunPosY: getNum("epic3d.lighting.sunPosY.v1", fallback.sunPosY),
            sunPosZ: getNum("epic3d.lighting.sunPosZ.v1", fallback.sunPosZ),
            fillIntensity: getNum("epic3d.lighting.fillIntensity.v1", fallback.fillIntensity),
            fillPosX: getNum("epic3d.lighting.fillPosX.v1", fallback.fillPosX),
            fillPosY: getNum("epic3d.lighting.fillPosY.v1", fallback.fillPosY),
            fillPosZ: getNum("epic3d.lighting.fillPosZ.v1", fallback.fillPosZ),
            exposure: getNum("epic3d.lighting.exposure.v1", fallback.exposure),
        };
    } catch {
        return fallback;
    }
}

export default function SceneInner({
                                       perf,
                                       // scene/model

                                       modelDescriptor,
                                       wireframe,
                                       wireOpacity = 1,
                                       wireDetail = "high",
                                       wireEdgeAngle = null,
                                       wireHideSurfaces = false,
                                       wireStroke: wireStrokeProp, // NEW: preferred config for new reveal
                                       wireReveal,                 // Back-compat: old UI still uses this
                                       enableShadows = false,
                                       modelRef,
                                       showModel = true,
                                       roomOpacity = 0.4,
                                       modelScale = 1, // <-- NEW
                                       modelScaleVec = null,
                                       modelPosition = [0, 0, 0], // NEW: model offset
                                       // data
                                       rooms = [],
                                       nodes = [],
                                       links = [],
                                       hiddenDeckIds = [],
                                       hiddenRoomIds = [],
                                       // pictures (for gizmo movement)
                                       pictureRefs,
                                       // selection
                                       selected,
                                       setSelected,
                                       onNodePointerDown,
                                       onFlowAnchorPointerDown,
                                       onSwitchPress,
                                       onRoomPointerDown,
                                       selectedMulti = [],
                                       multiMaster = null,
                                       linkMode = false,
                                       linkFromId = null,
                                       linkHoverId = null,
                                       setLinkHoverId,
                                       selectedBreakpoint = null,   // NEW
                                       selectedFlowAnchor = null,
                                       // transforms
                                       moveMode = false,
                                       transformMode = "translate",
                                       uiHidden = false,
                                       onEntityTransform,
                                       onEntityRotate,

                                       // room pack operations
                                       onRoomDragPack,
                                       onRoomDragApply,
                                       // NEW: room scale-all (room + contents)
                                       onRoomScalePack,
                                       onRoomScaleApply,


                                       // visuals
                                       showLights = true,
                                       showLightBounds = false,
                                       shadowsOn = true,
                                       showGround = true,
                                       // NEW: grid config
                                       gridConfig,
                                       // labels
                                       labelsOn = true,
                                       labelMode = "billboard",
                                       labelSize = 0.24,
                                       labelMaxWidth = 24,
                                       label3DLayers = 8,
                                       label3DStep = 0.01,
                                       showRoomTiles = false,
                                       roomTileCount = 6,
                                       roomOperatorMode = false,
                                       onRoomAnchorClick,
                                       onRoomDelete,
                                       onRoomResize,
                                       tilePickActive = false,
                                       tilePickRoomId = null,
                                       roomPickActive = false,
                                       // placement
                                       placement,
                                       onPlace,
                                       multiPivotOverride,

                                       // animation toggle
                                       animate = true,

                                       // drag guard from parent
                                       dragState,
                                       missGuardRef,

                                       // scene ready callback
                                       onModelScene,
                                       onModelScale
                                   }) {
    // ------------------------------------------------------------
    // Link FX hiding bridge for cinematic fades
    //
    // Your node/room/deck/group fade system animates the targets themselves,
    // but links are separate objects. To ensure "scene fade" also hides the
    // animated link flows between any faded endpoints, we listen to the same
    // fade control event and temporarily omit rendering of links that touch
    // faded targets.
    //
    // IMPORTANT: We intentionally do NOT touch Link3D materials/shaders here
    // (to avoid the performance / "everything disappears" regressions).
    // This is an on/off visibility bridge specifically for link visuals.
    // ------------------------------------------------------------
    const fadeLinkHideRef = useRef(null);
    if (!fadeLinkHideRef.current) {
        const storedGroupIds = readFadeGroupIds();
        fadeLinkHideRef.current = {
            all: false,
            nodes: new Set(),
            rooms: new Set(),
            decks: new Set(),
            groups: new Set(storedGroupIds),
            forceShowNodes: new Set(),
            forceShowRooms: new Set(),
            // last-known fade durations (used so links fade at the same speed as nodes)
            inDur: 0.6,
            outDur: 0.6,
            version: 0,
        };
    }

    const fadeNodesRef = useRef(nodes);
    const fadeRoomsRef = useRef(rooms);
    const fadeWorkerRef = useRef(null);
    const fadeWorkerReqIdRef = useRef(0);
    useEffect(() => {
        fadeNodesRef.current = nodes;
    }, [nodes]);
    useEffect(() => {
        fadeRoomsRef.current = rooms;
    }, [rooms]);

    const [fadeTick, forceFadeLinksRerender] = useState(0);
    const [envFailed, setEnvFailed] = useState(false);
    const lastCamRef = useRef({ pos: new THREE.Vector3(), target: new THREE.Vector3(), valid: false });
    const [shiftHeld, setShiftHeld] = useState(false);
    const alignBeamXCoreMat = useMemo(() => {
        const m = new THREE.MeshBasicMaterial({
            color: "#38bdf8",
            transparent: true,
            opacity: 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });
        return m;
    }, []);
    const alignBeamXGlowMat = useMemo(() => {
        const m = new THREE.MeshBasicMaterial({
            color: "#7dd3fc",
            transparent: true,
            opacity: 0.45,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });
        return m;
    }, []);
    const alignBeamYCoreMat = useMemo(() => {
        const m = new THREE.MeshBasicMaterial({
            color: "#f59e0b",
            transparent: true,
            opacity: 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });
        return m;
    }, []);
    const alignBeamYGlowMat = useMemo(() => {
        const m = new THREE.MeshBasicMaterial({
            color: "#fbbf24",
            transparent: true,
            opacity: 0.45,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });
        return m;
    }, []);
    const alignBeamZCoreMat = useMemo(() => {
        const m = new THREE.MeshBasicMaterial({
            color: "#f472b6",
            transparent: true,
            opacity: 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });
        return m;
    }, []);
    const alignBeamZGlowMat = useMemo(() => {
        const m = new THREE.MeshBasicMaterial({
            color: "#fb7185",
            transparent: true,
            opacity: 0.45,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });
        return m;
    }, []);

    useEffect(() => {
        const down = (e) => { if (e?.key === "Shift") setShiftHeld(true); };
        const up = (e) => { if (e?.key === "Shift") setShiftHeld(false); };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("blur", () => setShiftHeld(false));
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("blur", () => setShiftHeld(false));
        };
    }, []);

    useEffect(() => {
        if (typeof Worker === "undefined") return undefined;
        const worker = new Worker(__workerUrl("fadeExpandWorker.js"));
        worker.onerror = (err) => {
            err?.preventDefault?.();
            worker.terminate();
            fadeWorkerRef.current = null;
        };
        fadeWorkerRef.current = worker;
        worker.onmessage = (e) => {
            const payload = e?.data || {};
            if (payload.id !== fadeWorkerReqIdRef.current) return;
            const store = fadeLinkHideRef.current;
            if (!store) return;
            const removeNodeIds = Array.isArray(payload.removeNodeIds) ? payload.removeNodeIds : [];
            const removeRoomIds = Array.isArray(payload.removeRoomIds) ? payload.removeRoomIds : [];
            removeNodeIds.forEach((id) => store.nodes.delete(String(id)));
            removeRoomIds.forEach((id) => store.rooms.delete(String(id)));
            store.version = (store.version || 0) + 1;
            forceFadeLinksRerender((x) => x + 1);
        };
        return () => {
            worker.terminate();
            fadeWorkerRef.current = null;
        };
    }, []);

    useEffect(() => {
        const store = fadeLinkHideRef.current;
        if (!store) return;

        const normArr = (v) => {
            if (!v) return [];
            if (Array.isArray(v)) return v;
            return [v];
        };

        const toId = (v) => {
            if (v == null) return "";
            const s = String(v);
            return s.trim();
        };

        const applyMode = (set, ids, mode) => {
            if (!set || !ids || !ids.length) return;
            for (const raw of ids) {
                const id = toId(raw);
                if (!id) continue;
                if (mode === "hide") set.add(id);
                else if (mode === "show") set.delete(id);
                else if (mode === "toggle") {
                    if (set.has(id)) set.delete(id);
                    else set.add(id);
                }
            }
        };
        const persistGroupFade = () => {
            try {
                writeFadeGroupIds(Array.from(store.groups || []));
            } catch {}
        };

        const onFade = (ev) => {
            const d = ev?.detail || {};

            // Optional: allow a hard reset from any caller
            if (d.reset === true || d.clear === true) {
                store.all = false;
                store.nodes.clear();
                store.rooms.clear();
                store.decks.clear();
                store.groups.clear();
                store.forceShowNodes.clear();
                store.forceShowRooms.clear();
                persistGroupFade();
                forceFadeLinksRerender((x) => x + 1);
                return;
            }

            const type = String(ev?.type || "");
            let action = String(d.action || d.mode || d.fadeAction || "").toLowerCase().trim();
            if (!action) {
                if (type.includes("_IN")) action = "in";
                else if (type.includes("_OUT")) action = "out";
                else if (type.includes("_TOGGLE")) action = "toggle";
                else action = "toggle";
            }
            if (action === "fadein") action = "in";
            if (action === "fadeout") action = "out";

            let mode = null; // show | hide | toggle
            if (action === "in" || action === "show") mode = "show";
            else if (action === "out" || action === "hide") mode = "hide";
            else if (action === "toggle") mode = "toggle";
            else if (action === "set") {
                const a = Number(d.alpha ?? d.opacity ?? 1);
                mode = a >= 0.5 ? "show" : "hide";
            }

            // Unknown/unsupported actions shouldn't affect link visibility
            if (!mode) return;

            // Track last durations (so Link3D can match Node3D timing).
            // These are global hints and are only applied to links affected by this event.
            const inHint = d.durationIn ?? d.fadeInDuration ?? d.fadeIn ?? d.inDuration ?? d.in;
            const outHint = d.durationOut ?? d.fadeOutDuration ?? d.fadeOut ?? d.outDuration ?? d.out;
            const durHint = d.duration;
            if (durHint != null && Number.isFinite(Number(durHint))) {
                const v = Math.max(0, Number(durHint) || 0);
                store.inDur = v;
                store.outDur = v;
            } else {
                if (inHint != null && Number.isFinite(Number(inHint))) store.inDur = Math.max(0, Number(inHint) || 0);
                if (outHint != null && Number.isFinite(Number(outHint))) store.outDur = Math.max(0, Number(outHint) || 0);
            }

            // Global
            if (d.all === true) {
                if (mode === "toggle") store.all = !store.all;
                else store.all = mode === "hide";
            }

            // Targeted
            const nodeIds = [...normArr(d.nodeIds), ...normArr(d.nodeId)].map(toId).filter(Boolean);
            const roomIds = [...normArr(d.roomIds), ...normArr(d.roomId)].map(toId).filter(Boolean);
            applyMode(store.nodes, nodeIds, mode);
            applyMode(store.rooms, roomIds, mode);
            applyMode(store.decks, [...normArr(d.deckIds), ...normArr(d.deckId)], mode);
            applyMode(store.groups, [...normArr(d.groupIds), ...normArr(d.groupId)], mode);

            const includeNodesInRooms = (d.includeNodesInRooms ?? true) !== false;
            if (mode === "show" && includeNodesInRooms) {
                const roomIds = new Set([...normArr(d.roomIds), ...normArr(d.roomId)].map(toId).filter(Boolean));
                const deckIds = new Set([...normArr(d.deckIds), ...normArr(d.deckId)].map(toId).filter(Boolean));
                const groupIds = new Set([...normArr(d.groupIds), ...normArr(d.groupId)].map(toId).filter(Boolean));

                const useWorker = !!fadeWorkerRef.current;
                if (useWorker && (roomIds.size || deckIds.size || groupIds.size)) {
                    const nodesNow = fadeNodesRef.current || [];
                    const roomsNow = fadeRoomsRef.current || [];
                    const nodesLite = nodesNow.map((n) => ({
                        id: n?.id,
                        roomId: n?.roomId,
                        deckId: n?.deckId,
                        groupId: n?.groupId,
                    }));
                    const roomsLite = roomsNow.map((r) => ({
                        id: r?.id,
                        deckId: r?.deckId,
                        groupId: r?.groupId,
                    }));
                    const reqId = fadeWorkerReqIdRef.current + 1;
                    fadeWorkerReqIdRef.current = reqId;
                    fadeWorkerRef.current.postMessage({
                        id: reqId,
                        nodes: nodesLite,
                        rooms: roomsLite,
                        roomIds: Array.from(roomIds),
                        deckIds: Array.from(deckIds),
                        groupIds: Array.from(groupIds),
                    });
                } else {
                    const nodesNow = fadeNodesRef.current || [];
                    const roomsNow = fadeRoomsRef.current || [];
                    if (roomIds.size) {
                        for (const n of nodesNow) {
                            const rid = n?.roomId != null ? String(n.roomId) : "";
                            if (rid && roomIds.has(rid)) store.nodes.delete(String(n.id));
                        }
                    }
                    if (deckIds.size) {
                        for (const r of roomsNow) {
                            const did = r?.deckId != null ? String(r.deckId) : "";
                            if (did && deckIds.has(did)) store.rooms.delete(String(r.id));
                        }
                        for (const n of nodesNow) {
                            const did = n?.deckId != null ? String(n.deckId) : "";
                            if (did && deckIds.has(did)) store.nodes.delete(String(n.id));
                        }
                    }
                    if (groupIds.size) {
                        for (const r of roomsNow) {
                            const gid = r?.groupId != null ? String(r.groupId) : "";
                            if (gid && groupIds.has(gid)) store.rooms.delete(String(r.id));
                        }
                        for (const n of nodesNow) {
                            const gid = n?.groupId != null ? String(n.groupId) : "";
                            if (gid && groupIds.has(gid)) store.nodes.delete(String(n.id));
                        }
                    }
                }
            }
            if (mode === "show" && d.all === true) {
                store.nodes.clear();
                store.rooms.clear();
                store.decks.clear();
                store.groups.clear();
                store.forceShowNodes.clear();
                store.forceShowRooms.clear();
            }
            if (nodeIds.length) {
                if (mode === "show") {
                    nodeIds.forEach((id) => store.forceShowNodes.add(id));
                } else if (mode === "hide") {
                    nodeIds.forEach((id) => store.forceShowNodes.delete(id));
                } else if (mode === "toggle") {
                    nodeIds.forEach((id) => {
                        if (store.nodes.has(id)) store.forceShowNodes.delete(id);
                        else store.forceShowNodes.add(id);
                    });
                }
            }
            if (roomIds.length) {
                if (mode === "show") {
                    roomIds.forEach((id) => store.forceShowRooms.add(id));
                } else if (mode === "hide") {
                    roomIds.forEach((id) => store.forceShowRooms.delete(id));
                } else if (mode === "toggle") {
                    roomIds.forEach((id) => {
                        if (store.rooms.has(id)) store.forceShowRooms.delete(id);
                        else store.forceShowRooms.add(id);
                    });
                }
            }

            persistGroupFade();
            store.version = (store.version || 0) + 1;
            forceFadeLinksRerender((x) => x + 1);
        };

        const events = ["EPIC3D_FADE_CTRL", "EPIC3D_FADE_IN", "EPIC3D_FADE_OUT", "EPIC3D_FADE_TOGGLE"];
        for (const n of events) window.addEventListener(n, onFade);
        return () => {
            for (const n of events) window.removeEventListener(n, onFade);
        };
    }, []);
    // ---------- grid config (ground + snapping helpers) ----------
    const __grid = gridConfig || {};
    // Keep cell size & snap in lockstep when gridConfig.linkSnap is enabled (default true).
    // - When linked: prefer placement.snap for the rendered grid (prevents reload desync).
    // - When unlinked: prefer gridConfig.cellSize (fallback to placement.snap for back-compat).
    const __linkSnap = __grid.linkSnap !== undefined ? !!__grid.linkSnap : true;
    const __snapCell = Number(placement?.snap);
    const __cellFromConfig = Number(__grid.cellSize);
    const gridCellSize = (() => {
        const snapOk = Number.isFinite(__snapCell) && __snapCell > 0;
        const cellOk = Number.isFinite(__cellFromConfig) && __cellFromConfig > 0;
        if (__linkSnap) {
            if (snapOk) return __snapCell;
            if (cellOk) return __cellFromConfig;
        } else {
            if (cellOk) return __cellFromConfig;
            if (snapOk) return __snapCell;
        }
        return 0.25;
    })();
    const tileCount = Math.max(2, Math.min(24, Math.round(Number(roomTileCount) || 6)));
    const roomTileCountSafe = tileCount;
    const gridMajorEvery = Number.isFinite(Number(__grid.majorEvery)) && Number(__grid.majorEvery) >= 1 ? Math.round(Number(__grid.majorEvery)) : 10;
    const gridSectionSize = gridCellSize * gridMajorEvery;
    const gridFadeDistance = Number.isFinite(Number(__grid.fadeDistance)) ? Number(__grid.fadeDistance) : 100;
    const gridFadeStrength = Number.isFinite(Number(__grid.fadeStrength)) ? Number(__grid.fadeStrength) : 1;
    const gridCellThickness = Number.isFinite(Number(__grid.cellThickness)) ? Number(__grid.cellThickness) : 0.85;
    const gridSectionThickness = Number.isFinite(Number(__grid.sectionThickness)) ? Number(__grid.sectionThickness) : 1.15;
    const gridFollowCamera = !!__grid.followCamera;
    const gridInfinite = __grid.infiniteGrid !== undefined ? !!__grid.infiniteGrid : true;
    const gridEnabled = __grid.enabled !== undefined ? !!__grid.enabled : true;
    const gridSpace3D = !!__grid.space3D;
    const gridShowPlane = __grid.showPlane !== undefined ? !!__grid.showPlane : true;
    const gridY = Number.isFinite(Number(__grid.y)) ? Number(__grid.y) : 0;

    const gridOpacity = (() => {
        const v = Number(__grid.opacity);
        return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.35;
    })();

    const gridColor = typeof __grid.color === "string" && __grid.color ? __grid.color : "#4aa3ff";
    const gridGroundBlend = typeof __grid.blendBase === "string" && __grid.blendBase ? __grid.blendBase : "#0d1322";

    // We can't alpha-blend via THREE.ColorRepresentation, so we emulate transparency by blending the grid
    // color toward the ground color by gridOpacity.
    const gridCellColor = useMemo(() => {
        const base = new THREE.Color(gridGroundBlend);
        const tgt = new THREE.Color(gridColor);
        // cell lines are a little softer
        return base.clone().lerp(tgt, gridOpacity * 0.7).getStyle();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gridGroundBlend, gridColor, gridOpacity]);

    const gridSectionColor = useMemo(() => {
        const base = new THREE.Color(gridGroundBlend);
        const tgt = new THREE.Color(gridColor);
        // major lines are stronger
        return base.clone().lerp(tgt, Math.min(1, gridOpacity * 1.1)).getStyle();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gridGroundBlend, gridColor, gridOpacity]);

    const gridSize = (() => {
        const v = Number(__grid.size);
        return Number.isFinite(v) ? Math.max(1, Math.min(4000, v)) : 20;
    })();

    const gridHighlightSelection = !!__grid.highlightSelection;
    const gridHighlightOpacity = (() => {
        const v = Number(__grid.highlightOpacity);
        return Number.isFinite(v) ? Math.max(0.02, Math.min(0.85, v)) : 0.18;
    })();
    const gridHighlightColor = typeof __grid.highlightColor === "string" && __grid.highlightColor ? __grid.highlightColor : gridColor;

    const gridPlaneOffsetX = Number.isFinite(Number(__grid.planeOffsetX)) ? Number(__grid.planeOffsetX) : 0;
    const gridPlaneOffsetZ = Number.isFinite(Number(__grid.planeOffsetZ)) ? Number(__grid.planeOffsetZ) : 0;
    const gridShowAxes = !!__grid.showAxes;


    // ---------- Floors / Decks (horizontal grid layers) ----------
    const floorsEnabled = !!__grid.floorsEnabled;
    const floorsAutoEnabled = !!__grid.floorsAutoEnabled;
    const floorsAutoBaseY = Number.isFinite(Number(__grid.floorsAutoBaseY)) ? Number(__grid.floorsAutoBaseY) : gridY;
    const floorsAutoStep = Number.isFinite(Number(__grid.floorsAutoStep)) ? Math.max(0.1, Number(__grid.floorsAutoStep)) : 2;
    const floorsAutoCount = Number.isFinite(Number(__grid.floorsAutoCount)) ? Math.max(0, Math.min(60, Math.round(Number(__grid.floorsAutoCount)))) : 6;
    const floorsManual = Array.isArray(__grid.floorsManual) ? __grid.floorsManual : [];

    const allFloors = useMemo(() => {
        const out = [];
        // Ground always exists (even if floors are disabled)
        out.push({
            id: "ground",
            name: "Ground",
            y: gridY,
            visible: true,
            color: gridColor,
            opacity: gridOpacity,
        });

        if (floorsEnabled) {
            if (floorsAutoEnabled && floorsAutoCount > 0) {
                for (let i = 1; i <= floorsAutoCount; i++) {
                    out.push({
                        id: `auto_${i}`,
                        name: `Auto ${i}`,
                        y: floorsAutoBaseY + i * floorsAutoStep,
                        visible: true,
                        color: gridColor,
                        opacity: Math.max(0.06, Math.min(0.35, gridOpacity * 0.65)),
                    });
                }
            }
            for (const f of floorsManual) {
                if (!f) continue;
                const id = String(f.id || "");
                if (!id) continue;
                out.push({
                    id,
                    name: String(f.name || id),
                    y: Number.isFinite(Number(f.y)) ? Number(f.y) : gridY,
                    visible: f.visible !== undefined ? !!f.visible : true,
                    color: typeof f.color === "string" && f.color ? f.color : gridColor,
                    opacity: Number.isFinite(Number(f.opacity)) ? Math.max(0.02, Math.min(0.9, Number(f.opacity))) : Math.max(0.06, Math.min(0.35, gridOpacity * 0.65)),
                });
            }
        }

        // stable sort by height
        out.sort((a, b) => (a.y || 0) - (b.y || 0));
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [floorsEnabled, floorsAutoEnabled, floorsAutoBaseY, floorsAutoStep, floorsAutoCount, floorsManual, gridY, gridColor, gridOpacity]);

    const visibleFloors = useMemo(() => allFloors.filter((f) => f && f.visible), [allFloors]);

    // ---------- 3D grid space improvements (multiple wall planes) ----------
    const gridSpace3DCount = Number.isFinite(Number(__grid.space3DCount)) ? Math.max(0, Math.min(24, Math.round(Number(__grid.space3DCount)))) : 2;
    const gridSpace3DStep = Number.isFinite(Number(__grid.space3DStep)) ? Math.max(0.1, Number(__grid.space3DStep)) : 5;
    const gridSpace3DXY = __grid.space3DXY !== undefined ? !!__grid.space3DXY : true;
    const gridSpace3DYZ = __grid.space3DYZ !== undefined ? !!__grid.space3DYZ : true;
    const gridSpaceOffsets = useMemo(() => {
        const out = [];
        const n = gridSpace3DCount;
        const step = gridSpace3DStep;
        for (let i = -n; i <= n; i++) out.push(i * step);
        return out;
    }, [gridSpace3DCount, gridSpace3DStep]);

    // ---------- snapping ghost preview ----------
    const snapGhostEnabled = __grid.snapGhostEnabled !== undefined ? !!__grid.snapGhostEnabled : true;
    const snapGhostColor = typeof __grid.snapGhostColor === "string" && __grid.snapGhostColor ? __grid.snapGhostColor : "#7dd3fc";
    const snapGhostOpacity = Number.isFinite(Number(__grid.snapGhostOpacity)) ? Math.max(0.02, Math.min(0.8, Number(__grid.snapGhostOpacity))) : 0.22;

    const snapToFloors = !!__grid.snapToFloors;
    const snapFloorMode = String(__grid.snapFloorMode || "nearest");
    const activeFloorId = String(__grid.activeFloorId || "ground");
    const floorSnapAlign = String(__grid.floorSnapAlign || "base");

    const effectiveSnapMode = String(__grid.snapMode || ((__grid.linkSnap ?? true) ? "vertices" : "off"));
    const tileCenterMove = String(__grid.snapTilesCenterMove || "auto");
    const tileCenterResize = __grid.snapTilesCenterResize !== undefined ? !!__grid.snapTilesCenterResize : true;

    const getNodeHalfHeight = (node) => {
        const sh = node?.shape || {};
        if (sh.type === "sphere") {
            const r = Number(sh.radius);
            return Number.isFinite(r) && r > 0 ? r : 0.28;
        }
        if (Number.isFinite(Number(sh.h))) return Math.max(0.01, Number(sh.h) / 2);
        return 0.28;
    };

    const pickFloorY = (y, preferId = null) => {
        const list = Array.isArray(allFloors) ? allFloors : [];
        if (!list.length) return gridY;

        if (preferId) {
            const hit = list.find((f) => f && String(f.id) === String(preferId));
            if (hit && Number.isFinite(Number(hit.y))) return Number(hit.y);
        }

        // for nearest: ignore hidden floors, but keep ground
        const candidates = list.filter((f) => f && (f.id === "ground" || f.visible));
        if (!candidates.length) return gridY;

        let best = candidates[0];
        let bestD = Math.abs((Number(best.y) || 0) - y);
        for (const f of candidates) {
            const fy = Number(f.y) || 0;
            const d = Math.abs(fy - y);
            if (d < bestD) {
                best = f;
                bestD = d;
            }
        }
        return Number(best.y) || gridY;
    };

    const snapXZ = (x, z, spanX = 1, spanZ = 1) => {
        const cell = gridCellSize;
        if (!Number.isFinite(cell) || cell <= 0) return [x, z];

        const mode = effectiveSnapMode;
        if (mode === "off") return [x, z];

        const useTiles = (mode === "tiles") && (tileCenterMove !== "off");
        if (!useTiles) {
            // vertices
            return [Math.round(x / cell) * cell, Math.round(z / cell) * cell];
        }

        const ox = (spanX % 2 === 0) ? 0 : cell / 2;
        const oz = (spanZ % 2 === 0) ? 0 : cell / 2;
        const sx = Math.round((x - ox) / cell) * cell + ox;
        const sz = Math.round((z - oz) / cell) * cell + oz;
        return [sx, sz];
    };

    // ---------- lookups ----------
    const nodeRefs = useRef({});
    const roomRefs = useRef({});

    // Keep a reference to the *loaded* model scene without hijacking the wrapper group ref.
    // - modelRef.current stays the wrapper <group> (raycasts + gizmo targeting)
    // - onModelScene(scene) receives the actual imported scene for bounds/material work
    const modelSceneRef = useRef(null);
    const anyFadeActive = useMemo(() => {
        const store = fadeLinkHideRef.current;
        if (!store) return false;
        return !!(
            store.all ||
            (store.nodes && store.nodes.size) ||
            (store.rooms && store.rooms.size) ||
            (store.decks && store.decks.size) ||
            (store.groups && store.groups.size)
        );
    }, [fadeTick]);
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent("EPIC3D_FADE_ACTIVITY", { detail: { active: !!anyFadeActive } }));
    }, [anyFadeActive]);

    const labelsOnEffective = labelsOn && !anyFadeActive;
    const fadedGroupSet = useMemo(() => {
        const store = fadeLinkHideRef.current;
        if (!store?.groups) return new Set();
        return new Set(store.groups);
    }, [fadeTick]);

    // ------------------------------------------------------------
    // Dissolver runtime (model + nodes/links)
    //
    // - Model surfaces + wireframe dissolve via shader masking in world space.
    // - Nodes inside the dissolver boundary fade using the existing EPIC3D_FADE_CTRL system.
    // - Dissolver nodes are EXCLUDED from being dissolved.
    // ------------------------------------------------------------
    const __DISS_MAX = 8;
    const dissolverUniformsRef = useRef(null);
    if (!dissolverUniformsRef.current) {
        dissolverUniformsRef.current = {
            uDissCount: { value: 0 },
            uDissType: { value: new Float32Array(__DISS_MAX) }, // 0=sphere, 1=plane(slab), 2=cylinder
            uDissPos: { value: Array.from({ length: __DISS_MAX }, () => new THREE.Vector3()) },
            uDissAxis: { value: Array.from({ length: __DISS_MAX }, () => new THREE.Vector3(0, 1, 0)) },
            // (radius, height, thickness, feather)
            uDissParams: { value: Array.from({ length: __DISS_MAX }, () => new THREE.Vector4(1, 2, 0.2, 0.15)) },
            uDissProgress: { value: new Float32Array(__DISS_MAX) }, // 0..1
        };
    }

    const dissolverStateRef = useRef(null);
    if (!dissolverStateRef.current) {
        dissolverStateRef.current = {
            // id -> progress 0..1
            progress: new Map(),
            // id -> { from, to, dur, elapsed }
            anim: new Map(),
        };
    }

    const nodesRefForDissolvers = useRef(nodes);
    useEffect(() => {
        nodesRefForDissolvers.current = nodes;
    }, [nodes]);

    const __isDissolver = (n) => String(n?.kind || n?.type || "node").toLowerCase() === "dissolver";

    const __axisFromRot = (rot) => {
        const r = Array.isArray(rot) ? rot : [0, 0, 0];
        const ex = Number(r[0]) || 0;
        const ey = Number(r[1]) || 0;
        const ez = Number(r[2]) || 0;
        const e = new THREE.Euler(ex, ey, ez, "XYZ");
        return new THREE.Vector3(0, 1, 0).applyEuler(e).normalize();
    };

    const __getDissolverWorld = (node) => {
        const cfg = (node && typeof node.dissolver === "object") ? node.dissolver : {};
        const boundary = (cfg && typeof cfg.boundary === "object") ? cfg.boundary : {};
        const t = String(boundary.type || "sphere").toLowerCase();
        const type = (t === "plane") ? 1 : ((t === "cylinder" || t === "circle") ? 2 : 0);
        const pos = Array.isArray(node?.position) ? node.position : [0, 0, 0];
        const center = new THREE.Vector3(Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0);
        const axis = __axisFromRot(node?.rotation);
        const radius = Math.max(0.01, Number(boundary.radius ?? 1.0) || 1.0);
        const height = Math.max(0.01, Number(boundary.height ?? 2.0) || 2.0);
        const thickness = Math.max(0.001, Number(boundary.thickness ?? 0.2) || 0.2);
        const feather = Math.max(0, Number(boundary.feather ?? 0.15) || 0);
        return { type, center, axis, radius, height, thickness, feather };
    };

    const __pointInsideDissolver = (p, diss) => {
        const v = new THREE.Vector3(p.x, p.y, p.z).sub(diss.center);

        if (diss.type === 0) {
            // sphere
            return v.length() <= diss.radius;
        }
        if (diss.type === 1) {
            // plane slab: inside if distance to plane <= thickness/2
            const d = Math.abs(v.dot(diss.axis));
            return d <= diss.thickness * 0.5;
        }
        // cylinder
        const h = v.dot(diss.axis);
        const halfH = diss.height * 0.5;
        if (Math.abs(h) > halfH) return false;
        const radial = v.clone().sub(diss.axis.clone().multiplyScalar(h));
        return radial.length() <= diss.radius;
    };

    const __patchMaterialForDissolve = (mat) => {
        if (!mat || typeof mat !== "object") return;
        if (mat.userData?.__epicDissolvePatched) return;
        // Skip depth-only / shadow materials
        const t = String(mat.type || "").toLowerCase();
        if (t.includes("depth") || t.includes("distance")) return;

        const shared = dissolverUniformsRef.current;
        const prevOnBeforeCompile = mat.onBeforeCompile;

        mat.onBeforeCompile = (shader) => {
            if (typeof prevOnBeforeCompile === "function") prevOnBeforeCompile(shader);

            shader.uniforms.uDissCount = shared.uDissCount;
            shader.uniforms.uDissType = shared.uDissType;
            shader.uniforms.uDissPos = shared.uDissPos;
            shader.uniforms.uDissAxis = shared.uDissAxis;
            shader.uniforms.uDissParams = shared.uDissParams;
            shader.uniforms.uDissProgress = shared.uDissProgress;

            // Vertex: compute world pos
            if (!shader.vertexShader.includes("varying vec3 vEpicDissWorldPos")) {
                const vDecl = "varying vec3 vEpicDissWorldPos;";
                if (shader.vertexShader.includes("#include <common>")) {
                    shader.vertexShader = shader.vertexShader.replace(
                        "#include <common>",
                        `#include <common>\n ${vDecl}`
                    );
                } else {
                    // Some shaders (custom/lines) don't include <common>. Insert after #version if present.
                    if (shader.vertexShader.startsWith("#version")) {
                        const nl = shader.vertexShader.indexOf("\n");
                        shader.vertexShader = shader.vertexShader.slice(0, nl + 1) + `${vDecl}\n` + shader.vertexShader.slice(nl + 1);
                    } else {
                        shader.vertexShader = `${vDecl}\n` + shader.vertexShader;
                    }
                }

                // Try to hook before gl_Position
                shader.vertexShader = shader.vertexShader.replace(
                    /gl_Position\s*=\s*/,
                    "vEpicDissWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;\n  gl_Position = "
                );
            }

            // Fragment: apply dissolve alpha
            if (!shader.fragmentShader.includes("float epicDissolveMask")) {
                const header = `
uniform float uDissCount;
uniform float uDissType[${__DISS_MAX}];
uniform vec3 uDissPos[${__DISS_MAX}];
uniform vec3 uDissAxis[${__DISS_MAX}];
uniform vec4 uDissParams[${__DISS_MAX}];
uniform float uDissProgress[${__DISS_MAX}];
varying vec3 vEpicDissWorldPos;

float epicDissolveMask(int i, vec3 wp) {
  float t = uDissType[i];
  vec3 c = uDissPos[i];
  vec3 ax = normalize(uDissAxis[i]);
  vec4 prm = uDissParams[i];
  float radius = prm.x;
  float height = prm.y;
  float thickness = prm.z;
  float feather = max(prm.w, 0.0001);
  vec3 v = wp - c;

  // Sphere
  if (t < 0.5) {
    float d = length(v) - radius;
    return smoothstep(0.0, feather, -d);
  }

  // Plane slab
  if (t < 1.5) {
    float d = abs(dot(v, ax)) - thickness * 0.5;
    return smoothstep(0.0, feather, -d);
  }

  // Cylinder
  float h = dot(v, ax);
  float halfH = height * 0.5;
  float dv = abs(h) - halfH;
  vec3 radial = v - ax * h;
  float dr = length(radial) - radius;
  float d = max(dr, dv);
  return smoothstep(0.0, feather, -d);
}
`;

                if (shader.fragmentShader.includes("#include <common>")) {
                    shader.fragmentShader = shader.fragmentShader.replace(
                        "#include <common>",
                        `#include <common>\n${header}`
                    );
                } else {
                    // Custom shaders may not include <common>. Insert after #version if present.
                    if (shader.fragmentShader.startsWith("#version")) {
                        const nl = shader.fragmentShader.indexOf("\n");
                        shader.fragmentShader = shader.fragmentShader.slice(0, nl + 1) + `${header}\n` + shader.fragmentShader.slice(nl + 1);
                    } else {
                        shader.fragmentShader = `${header}\n` + shader.fragmentShader;
                    }
                }

                const applyBlock = `
// --- epic dissolver ---
float epicDissAlpha = 1.0;
int epicCount = int(clamp(uDissCount, 0.0, float(${__DISS_MAX})));
for (int i = 0; i < ${__DISS_MAX}; i++) {
  if (i >= epicCount) break;
  float p = clamp(uDissProgress[i], 0.0, 1.0);
  if (p <= 0.0001) continue;
  float m = epicDissolveMask(i, vEpicDissWorldPos);
  epicDissAlpha *= (1.0 - m * p);
}
gl_FragColor.a *= epicDissAlpha;
if (gl_FragColor.a < 0.001) discard;
`;

                const anchors = [
                    "#include <tonemapping_fragment>",
                    "#include <dithering_fragment>",
                    "#include <fog_fragment>",
                ];

                let injected = false;
                for (const a of anchors) {
                    if (shader.fragmentShader.includes(a)) {
                        shader.fragmentShader = shader.fragmentShader.replace(a, `${applyBlock}\n${a}`);
                        injected = true;
                        break;
                    }
                }
                if (!injected) {
                    // last resort: append
                    shader.fragmentShader += `\n${applyBlock}`;
                }
            }
        };

        // Allow graceful fade even on otherwise-opaque materials.
        mat.transparent = true;
        mat.userData = { ...(mat.userData || {}), __epicDissolvePatched: true };
        mat.needsUpdate = true;
    };

    const __patchModelSceneForDissolve = (scene) => {
        if (!scene) return;
        try {
            scene.traverse((obj) => {
                // Patch meshes + lines (wireframe)
                const m = obj?.material;
                if (!m) return;
                if (Array.isArray(m)) m.forEach(__patchMaterialForDissolve);
                else __patchMaterialForDissolve(m);
            });
        } catch (err) {
            if (process.env.NODE_ENV !== "production") console.warn("[Dissolver] failed to patch model materials", err);
        }
    };

    const __updateDissolverUniforms = () => {
        const shared = dissolverUniformsRef.current;
        const state = dissolverStateRef.current;
        const all = (nodesRefForDissolvers.current || []).filter((n) => __isDissolver(n) && (n?.dissolver?.enabled !== false));
        all.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const count = Math.min(__DISS_MAX, all.length);

        shared.uDissCount.value = count;
        for (let i = 0; i < __DISS_MAX; i++) {
            shared.uDissProgress.value[i] = 0;
            shared.uDissType.value[i] = 0;
            shared.uDissPos.value[i].set(0, 0, 0);
            shared.uDissAxis.value[i].set(0, 1, 0);
            shared.uDissParams.value[i].set(1, 2, 0.2, 0.15);
        }

        for (let i = 0; i < count; i++) {
            const n = all[i];
            const w = __getDissolverWorld(n);
            shared.uDissType.value[i] = w.type;
            shared.uDissPos.value[i].copy(w.center);
            shared.uDissAxis.value[i].copy(w.axis);
            shared.uDissParams.value[i].set(w.radius, w.height, w.thickness, w.feather);
            shared.uDissProgress.value[i] = Math.max(0, Math.min(1, Number(state.progress.get(String(n.id)) ?? 0) || 0));
        }
    };

    // Listen for dissolver control events (from inspector/actions/HUD)
    useEffect(() => {
        if (typeof window === "undefined") return;

        const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

        const startAnim = (id, to, dur) => {
            const state = dissolverStateRef.current;
            const key = String(id);
            const cur = Math.max(0, Math.min(1, Number(state.progress.get(key) ?? 0) || 0));
            const target = Math.max(0, Math.min(1, Number(to) || 0));
            if (Math.abs(target - cur) < 0.0001) return;

            if (!Number.isFinite(dur) || dur <= 0.0001) {
                state.anim.delete(key);
                state.progress.set(key, target);
                return;
            }
            state.anim.set(key, { from: cur, to: target, dur: Math.max(0, dur), elapsed: 0, easeInOut });
        };

        const isAllToken = (v) => v === "__ALL__" || v === "*" || v === "__ALL_DISSOLVERS__";

        const onCtrl = (ev) => {
            const d = ev?.detail || {};
            const action = String(d.action || d.mode || "toggle").toLowerCase().trim();
            const dissolverIdRaw = d.dissolverId ?? d.nodeId ?? d.id ?? null;

            const allNodes = nodesRefForDissolvers.current || [];
            const dissolvers = allNodes.filter((n) => __isDissolver(n) && (n?.dissolver?.enabled !== false));
            const targets = (() => {
                if (!dissolverIdRaw || isAllToken(dissolverIdRaw)) return dissolvers;
                const key = String(dissolverIdRaw);
                return dissolvers.filter((n) => String(n.id) === key);
            })();

            if (!targets.length) return;

            for (const dissNode of targets) {
                const cfg = dissNode?.dissolver || {};
                const dissDur = Math.max(0, Number(d.duration ?? cfg?.dissolve?.duration ?? 1.0) || 0);
                const restDur = Math.max(0, Number(d.duration ?? cfg?.restore?.duration ?? 1.0) || 0);

                const key = String(dissNode.id);
                const cur = Math.max(0, Math.min(1, Number(dissolverStateRef.current.progress.get(key) ?? 0) || 0));
                const to = (() => {
                    if (action === "dissolve") return 1;
                    if (action === "restore") return 0;
                    if (action === "toggle") return cur > 0.5 ? 0 : 1;
                    if (action === "set") return Math.max(0, Math.min(1, Number(d.progress ?? d.value ?? 0) || 0));
                    return cur;
                })();
                const dur = (to > cur) ? dissDur : restDur;
                startAnim(key, to, dur);

                const fadeAction = (action === "restore") ? "in" : (action === "dissolve") ? "out" : (to > cur ? "out" : "in");

                // Fade nodes inside the boundary (exclude dissolvers themselves)
                try {
                    const dissW = __getDissolverWorld(dissNode);
                    const insideNodeIds = (allNodes || [])
                        .filter((n) => !__isDissolver(n))
                        .filter((n) => {
                            const pos = Array.isArray(n?.position) ? n.position : [0, 0, 0];
                            const p = new THREE.Vector3(Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0);
                            return __pointInsideDissolver(p, dissW);
                        })
                        .map((n) => n.id);

                    if (insideNodeIds.length) {
                        window.dispatchEvent(
                            new CustomEvent("EPIC3D_FADE_CTRL", {
                                detail: {
                                    action: fadeAction,
                                    nodeIds: insideNodeIds,
                                    duration: dur,
                                },
                            })
                        );
                    }
                } catch (err) {
                    if (process.env.NODE_ENV !== "production") console.warn("[Dissolver] node fade dispatch failed", err);
                }
            }
        };

        window.addEventListener("EPIC3D_DISSOLVER_CTRL", onCtrl);
        return () => window.removeEventListener("EPIC3D_DISSOLVER_CTRL", onCtrl);
    }, []);

    // Animate dissolver progress + update shared uniforms
    useFrame((_, dt) => {
        const state = dissolverStateRef.current;
        if (!state) return;
        for (const [id, a] of Array.from(state.anim.entries())) {
            a.elapsed += dt;
            const t = a.dur <= 0 ? 1 : Math.max(0, Math.min(1, a.elapsed / a.dur));
            const e = a.easeInOut ? a.easeInOut(t) : t;
            const v = a.from + (a.to - a.from) * e;
            state.progress.set(String(id), v);
            if (t >= 1) state.anim.delete(String(id));
        }

        __updateDissolverUniforms();
    });

    const safeModelPosition = useMemo(() => {
        if (Array.isArray(modelPosition) && modelPosition.length >= 3) {
            const x = Number(modelPosition[0]);
            const y = Number(modelPosition[1]);
            const z = Number(modelPosition[2]);
            return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0];
        }
        return [0, 0, 0];
    }, [modelPosition?.[0], modelPosition?.[1], modelPosition?.[2]]);
    const rackSlotMap = useMemo(() => {
        const map = new Map();
        const rackNodes = (nodes || []).filter((n) => String(n?.shape?.type || "").toLowerCase() === "rack");
        rackNodes.forEach((rack) => {
            const contents = Array.isArray(rack?.rackContents) ? rack.rackContents : [];
            const count = contents.length;
            if (!count) return;
            const shape = rack.shape || {};
            const w = Number(shape.w ?? 0.6);
            const h = Number(shape.h ?? 1.8);
            const d = Number(shape.d ?? 0.6);
            const pad = Math.max(0.02, Math.min(w, d) * 0.05);
            const slotH = Math.max(0.05, Number(shape.slotH ?? 0.25));
            const slots = Math.max(1, Math.floor(Number(shape.slots ?? 12) || 12));
            const columns = Math.max(1, Math.ceil((contents.length || 0) / slots));
            const colGap = Number(shape.columnGap ?? Math.max(0.08, w * 0.2)) || 0.12;
            const cx = rack.position?.[0] ?? 0;
            const cy = rack.position?.[1] ?? 0;
            const cz = rack.position?.[2] ?? 0;
            const baseY = cy - h * 0.5 + slotH * 0.5;
            const totalW = columns * w + (columns - 1) * colGap;
            const baseX = cx - totalW * 0.5 + w * 0.5;
            const ordered = contents.slice();
            ordered.forEach((id, idx) => {
                const row = idx % slots;
                const col = Math.floor(idx / slots);
                const colOffset = col * (w + colGap);
                map.set(String(id), [baseX + colOffset, baseY + slotH * row, cz]);
            });
        });
        return map;
    }, [nodes]);

    const nodesForRender = useMemo(() => {
        if (!rackSlotMap.size) return nodes || [];
        return (nodes || []).map((n) => {
            if (!n || !n.id) return n;
            if (!n.centralized || !n.rackId) return n;
            const pos = rackSlotMap.get(String(n.id));
            if (!pos) return n;
            return { ...n, position: pos };
        });
    }, [nodes, rackSlotMap]);
    const nodeMap = useMemo(() => Object.fromEntries(nodesForRender.map((n) => [n.id, n])), [nodesForRender]);
    const roomDeckById = useMemo(
        () => new Map((rooms || []).map((r) => [String(r?.id || ""), r?.deckId != null ? String(r.deckId) : ""])),
        [rooms],
    );
    const selectedNode = selected?.type === "node" ? nodeMap[selected?.id] : null;
    const masterNodeId = multiMaster?.enabled ? multiMaster?.id : null;
    const masterIsAlternate = !!multiMaster?.isAlternate;
    const masterNode = masterNodeId ? nodeMap?.[masterNodeId] : null;
    const selectedRoom = selected?.type === "room" ? rooms.find((r) => r.id === selected?.id) : null;
    const selectedPictureId = selected?.type === "picture" ? selected?.id : null;

    const selectionGridRect = useMemo(() => {
        if (!gridHighlightSelection) return null;
        if (!selectedNode && !selectedRoom) return null;
        const cell = gridCellSize;
        if (!Number.isFinite(cell) || cell <= 0) return null;

        const snapFloor = (v) => Math.floor(v / cell) * cell;
        const snapCeil = (v) => Math.ceil(v / cell) * cell;

        // Node: highlight the single cell it sits in
        if (selectedNode?.position) {
            const x = Number(selectedNode.position[0]) || 0;
            const z = Number(selectedNode.position[2]) || 0;
            const x0 = snapFloor(x);
            const z0 = snapFloor(z);
            return {
                cx: x0 + cell * 0.5,
                cz: z0 + cell * 0.5,
                w: cell,
                d: cell,
            };
        }

        // Room: highlight its footprint snapped to grid cells (axis-aligned)
        if (selectedRoom?.center) {
            const x = Number(selectedRoom.center[0]) || 0;
            const z = Number(selectedRoom.center[2]) || 0;
            const size = selectedRoom.size || [3, 1.6, 2.2];
            const w0 = Number(size[0]) || 0;
            const d0 = Number(size[2]) || 0;
            const minX = x - w0 * 0.5;
            const maxX = x + w0 * 0.5;
            const minZ = z - d0 * 0.5;
            const maxZ = z + d0 * 0.5;
            const sx0 = snapFloor(minX);
            const sx1 = snapCeil(maxX);
            const sz0 = snapFloor(minZ);
            const sz1 = snapCeil(maxZ);
            const w = Math.max(cell, sx1 - sx0);
            const d = Math.max(cell, sz1 - sz0);
            return {
                cx: sx0 + w * 0.5,
                cz: sz0 + d * 0.5,
                w,
                d,
            };
        }

        return null;
    }, [gridHighlightSelection, selectedNode, selectedRoom, gridCellSize]);

    const tidyRoutingNodes = useMemo(() => {
        const src = Array.isArray(nodesForRender) ? nodesForRender : [];
        const out = [];
        const pad = 0.02;
        for (const n of src) {
            if (!n || String(n.kind || "").toLowerCase() !== "tidy" || !n.tidy?.enabled) continue;
            const center = n.position || [0, 0, 0];
            const offset = n.tidy?.offset || {};
            const wallCenter = [
                (center[0] || 0) + (offset.x || 0),
                (center[1] || 0) + (offset.y || 0),
                (center[2] || 0) + (offset.z || 0),
            ];
            const boxes = [];
            const v = n.tidy?.vertical || {};
            const h = n.tidy?.horizontal || {};
            if (v.w && v.h && v.d) {
                boxes.push({
                    min: [wallCenter[0] - v.w * 0.5 - pad, wallCenter[1] - v.h * 0.5 - pad, wallCenter[2] - v.d * 0.5 - pad],
                    max: [wallCenter[0] + v.w * 0.5 + pad, wallCenter[1] + v.h * 0.5 + pad, wallCenter[2] + v.d * 0.5 + pad],
                });
            }
            if (h.w && h.h && h.d) {
                boxes.push({
                    min: [wallCenter[0] - h.w * 0.5 - pad, wallCenter[1] - h.h * 0.5 - pad, wallCenter[2] - h.d * 0.5 - pad],
                    max: [wallCenter[0] + h.w * 0.5 + pad, wallCenter[1] + h.h * 0.5 + pad, wallCenter[2] + h.d * 0.5 + pad],
                });
            }
            const forceAll = n.tidy?.forceAll === true;
            if (!forceAll && !boxes.length) continue;
            out.push({ wallCenter, boxes, forceAll });
        }
        return out;
    }, [nodesForRender]);
    const segmentIntersectsAABB = (p0, p1, min, max) => {
        let tmin = 0;
        let tmax = 1;
        for (let i = 0; i < 3; i++) {
            const s = p0[i] || 0;
            const e = p1[i] || 0;
            const d = e - s;
            if (Math.abs(d) < 1e-8) {
                if (s < min[i] || s > max[i]) return false;
            } else {
                const inv = 1 / d;
                let t1 = (min[i] - s) * inv;
                let t2 = (max[i] - s) * inv;
                if (t1 > t2) {
                    const tmp = t1; t1 = t2; t2 = tmp;
                }
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
                if (tmin > tmax) return false;
            }
        }
        return true;
    };
    const segmentDetourCost = (a, b, c) => {
        const ax = Number(a?.[0] ?? 0);
        const ay = Number(a?.[1] ?? 0);
        const az = Number(a?.[2] ?? 0);
        const bx = Number(b?.[0] ?? 0);
        const by = Number(b?.[1] ?? 0);
        const bz = Number(b?.[2] ?? 0);
        const cx = Number(c?.[0] ?? 0);
        const cy = Number(c?.[1] ?? 0);
        const cz = Number(c?.[2] ?? 0);
        const ab = Math.hypot(bx - ax, by - ay, bz - az);
        const ac = Math.hypot(cx - ax, cy - ay, cz - az);
        const cb = Math.hypot(bx - cx, by - cy, bz - cz);
        return Math.max(0, ac + cb - ab);
    };
    const findTidyRouteForPath = (points) => {
        if (!tidyRoutingNodes.length || !Array.isArray(points) || points.length < 2) return null;
        let best = null;
        let bestCost = Infinity;
        for (const tidy of tidyRoutingNodes) {
            const wallCenter = tidy.wallCenter;
            const boxes = tidy.boxes;
            const intersectedSegments = [];
            const forceAll = tidy.forceAll;
            if (forceAll) {
                for (let i = 0; i < points.length - 1; i++) intersectedSegments.push(i);
            } else {
                for (let i = 0; i < points.length - 1; i++) {
                    const a = points[i];
                    const b = points[i + 1];
                    for (const box of boxes) {
                        if (segmentIntersectsAABB(a, b, box.min, box.max)) {
                            intersectedSegments.push(i);
                            break;
                        }
                    }
                }
            }
            if (!intersectedSegments.length) continue;
            for (const idx of intersectedSegments) {
                const a = points[idx];
                const b = points[idx + 1];
                const cost = segmentDetourCost(a, b, wallCenter);
                if (cost < bestCost) {
                    bestCost = cost;
                    best = {
                        point: [wallCenter[0] || 0, wallCenter[1] || 0, wallCenter[2] || 0],
                        insertAfter: idx,
                    };
                }
            }
        }
        return best;
    };




    const snapGhost = useMemo(() => {
        if (!snapGhostEnabled) return null;
        if (!dragState?.active) return null;
        const n = selectedNode;
        const r = selectedRoom;
        if (!n && !r) return null;

        const pos = r?.center || n?.position;
        if (!Array.isArray(pos) || pos.length < 3) return null;

        let x = Number(pos[0]) || 0;
        let y = Number(pos[1]) || 0;
        let z = Number(pos[2]) || 0;

        let w = gridCellSize;
        let h = 0.56;
        let d = gridCellSize;

        if (r) {
            const size = Array.isArray(r.size) ? r.size : [1, 1, 1];
            w = Number(size[0]) || 1;
            h = Number(size[1]) || 1;
            d = Number(size[2]) || 1;
        } else if (n) {
            h = getNodeHalfHeight(n) * 2;
        }

        // Determine span in tiles (for parity-based tile centering)
        let spanX = 1;
        let spanZ = 1;
        if (effectiveSnapMode === "tiles" && r) {
            spanX = Math.max(1, Math.round(w / gridCellSize));
            spanZ = Math.max(1, Math.round(d / gridCellSize));
        }

        // snap x/z
        const [sx, sz] = snapXZ(x, z, spanX, spanZ);
        x = sx;
        z = sz;

        // snap Y to floors
        if (snapToFloors) {
            const floorY = (snapFloorMode === "active")
                ? pickFloorY(y, activeFloorId)
                : pickFloorY(y, null);

            if (floorSnapAlign === "center") {
                y = floorY;
            } else {
                y = floorY + h / 2;
            }
        }

        // Footprint: in tile mode we preview the occupied tiles (rounded to whole tiles)
        let footprintW = w;
        let footprintD = d;
        if (effectiveSnapMode === "tiles" && tileCenterResize) {
            const spanWX = r ? Math.max(1, Math.round(w / gridCellSize)) : 1;
            const spanWZ = r ? Math.max(1, Math.round(d / gridCellSize)) : 1;
            footprintW = spanWX * gridCellSize;
            footprintD = spanWZ * gridCellSize;
        }

        const baseY = y - h / 2;

        return {
            x,
            y,
            z,
            w: footprintW,
            h,
            d: footprintD,
            baseY,
        };
    }, [
        snapGhostEnabled,
        dragState?.active,
        selectedNode,
        selectedRoom,
        gridCellSize,
        effectiveSnapMode,
        tileCenterMove,
        snapToFloors,
        snapFloorMode,
        activeFloorId,
        floorSnapAlign,
        allFloors,
    ]);


    // Pictures are rendered outside this component; their refs may not be ready on the same render.
    // Resolve the picture object asynchronously (next frame) so the gizmo can attach reliably.
    const [pictureTarget, setPictureTarget] = useState(null);
    useEffect(() => {
        if (!selectedPictureId) {
            setPictureTarget(null);
            return;
        }
        let cancelled = false;
        let raf = 0;
        let tries = 0;
        const resolve = () => {
            if (cancelled) return;
            tries += 1;
            const obj = pictureRefs?.current?.[selectedPictureId]?.current || null;
            if (obj) {
                setPictureTarget(obj);
                return;
            }
            if (tries < 12) raf = requestAnimationFrame(resolve);
        };
        raf = requestAnimationFrame(resolve);
        return () => {
            cancelled = true;
            if (raf) cancelAnimationFrame(raf);
        };
    }, [selectedPictureId, pictureRefs]);
    const hiddenDeck = useMemo(() => new Set(hiddenDeckIds), [hiddenDeckIds]);
    const hiddenRooms = useMemo(() => new Set(hiddenRoomIds), [hiddenRoomIds]);

    const alignmentGuides = useMemo(() => {
        if (!shiftHeld) return [];
        if (!moveMode && !dragState?.active) return [];
        const guideDist = Number(gridConfig?.snapGuideDistance ?? 3.5);
        if (!Number.isFinite(guideDist) || guideDist <= 0) return [];
        const source = selectedNode || masterNode;
        if (!source || !Array.isArray(source.position)) return [];
        const [sx, sy, sz] = source.position;
        const baseEps = Number(gridConfig?.snapGuideEpsilon ?? 0.05);
        const snapEps = Number.isFinite(Number(placement?.snap)) ? Number(placement.snap) * 0.1 : 0.05;
        const eps = Math.max(0.01, Math.min(0.2, baseEps || snapEps));
        const out = [];
        for (const n of nodes || []) {
            if (!n || n.id == null || n.id === source.id) continue;
            if (n.deckId && hiddenDeck.has(n.deckId)) continue;
            if (n.roomId && hiddenRooms.has(n.roomId)) continue;
            if (!Array.isArray(n.position)) continue;
            const [nx, ny, nz] = n.position;
            const dx = Math.abs(nx - sx);
            const dy = Math.abs(ny - sy);
            const dz = Math.abs(nz - sz);
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > guideDist) continue;
            if (dx <= eps) {
                out.push({ axis: "x", from: [sx, sy, sz], to: [nx, ny, nz], dist, nodeId: n.id });
            }
            if (dy <= eps) {
                out.push({ axis: "y", from: [sx, sy, sz], to: [nx, ny, nz], dist, nodeId: n.id });
            }
            if (dz <= eps) {
                out.push({ axis: "z", from: [sx, sy, sz], to: [nx, ny, nz], dist, nodeId: n.id });
            }
        }
        return out;
    }, [dragState?.active, gridConfig?.snapGuideDistance, gridConfig?.snapGuideEpsilon, hiddenDeck, hiddenRooms, masterNode, moveMode, nodes, selectedNode, shiftHeld]);

    const alignmentFlags = useMemo(() => {
        let x = false;
        let y = false;
        for (const g of alignmentGuides) {
            if (g.axis === "x") x = true;
            if (g.axis === "y") y = true;
            if (x && y) break;
        }
        return { x, y };
    }, [alignmentGuides]);

    const alignmentBeamMarkers = useMemo(() => {
        if (!alignmentGuides?.length) return null;
        const beamLenX = Math.max(2.4, Number(gridConfig?.snapGuideBeamLenX ?? 4.8));
        const beamLenY = Math.max(2.2, Number(gridConfig?.snapGuideBeamLenY ?? 4.2));
        const beamLenZ = Math.max(2.4, Number(gridConfig?.snapGuideBeamLenZ ?? 4.8));
        const beamRadius = Math.max(0.035, Number(gridConfig?.snapGuideBeamThickness ?? 0.075));
        const ringRadius = beamRadius * 6.5;
        const xIds = new Set();
        const yIds = new Set();
        const zIds = new Set();
        alignmentGuides.forEach((g) => {
            if (g.axis === "x" && g.nodeId != null) xIds.add(String(g.nodeId));
            if (g.axis === "y" && g.nodeId != null) yIds.add(String(g.nodeId));
            if (g.axis === "z" && g.nodeId != null) zIds.add(String(g.nodeId));
        });
        const markers = [];
        (nodes || []).forEach((n) => {
            if (!n || n.id == null || !Array.isArray(n.position)) return;
            const id = String(n.id);
            const [nx, ny, nz] = n.position;
            if (xIds.has(id)) {
                markers.push(
                    <group key={`align_x_${id}`}>
                        <mesh position={[nx, ny, nz]} renderOrder={1002} raycast={() => null}>
                            <boxGeometry args={[beamLenX, beamRadius, beamRadius]} />
                            <primitive attach="material" object={alignBeamXCoreMat} />
                        </mesh>
                        <mesh position={[nx, ny, nz]} renderOrder={1001} raycast={() => null}>
                            <planeGeometry args={[beamLenX * 1.6, beamRadius * 8]} />
                            <primitive attach="material" object={alignBeamXGlowMat} />
                        </mesh>
                        <mesh position={[nx, ny, nz]} rotation={[0, Math.PI / 2, 0]} renderOrder={1001} raycast={() => null}>
                            <planeGeometry args={[beamLenX * 1.6, beamRadius * 8]} />
                            <primitive attach="material" object={alignBeamXGlowMat} />
                        </mesh>
                        <mesh position={[nx, ny, nz]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1003} raycast={() => null}>
                            <torusGeometry args={[ringRadius, beamRadius * 0.9, 16, 64]} />
                            <primitive attach="material" object={alignBeamXCoreMat} />
                        </mesh>
                    </group>
                );
            }
            if (yIds.has(id)) {
                markers.push(
                    <group key={`align_y_${id}`}>
                        <mesh position={[nx, ny, nz]} renderOrder={1002} raycast={() => null}>
                            <boxGeometry args={[beamRadius, beamLenY, beamRadius]} />
                            <primitive attach="material" object={alignBeamYCoreMat} />
                        </mesh>
                        <mesh position={[nx, ny, nz]} renderOrder={1001} raycast={() => null}>
                            <planeGeometry args={[beamRadius * 8, beamLenY * 1.6]} />
                            <primitive attach="material" object={alignBeamYGlowMat} />
                        </mesh>
                        <mesh position={[nx, ny, nz]} rotation={[0, Math.PI / 2, 0]} renderOrder={1001} raycast={() => null}>
                            <planeGeometry args={[beamRadius * 8, beamLenY * 1.6]} />
                            <primitive attach="material" object={alignBeamYGlowMat} />
                        </mesh>
                        <mesh position={[nx, ny, nz]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1003} raycast={() => null}>
                            <torusGeometry args={[ringRadius, beamRadius * 0.9, 16, 64]} />
                            <primitive attach="material" object={alignBeamYCoreMat} />
                        </mesh>
                    </group>
                );
            }
            if (zIds.has(id)) {
                markers.push(
                    <group key={`align_z_${id}`}>
                        <mesh position={[nx, ny, nz]} renderOrder={1002} raycast={() => null}>
                            <boxGeometry args={[beamRadius, beamRadius, beamLenZ]} />
                            <primitive attach="material" object={alignBeamZCoreMat} />
                        </mesh>
                        <mesh position={[nx, ny, nz]} renderOrder={1001} raycast={() => null}>
                            <planeGeometry args={[beamRadius * 8, beamLenZ * 1.6]} />
                            <primitive attach="material" object={alignBeamZGlowMat} />
                        </mesh>
                        <mesh position={[nx, ny, nz]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1001} raycast={() => null}>
                            <planeGeometry args={[beamRadius * 8, beamLenZ * 1.6]} />
                            <primitive attach="material" object={alignBeamZGlowMat} />
                        </mesh>
                        <mesh position={[nx, ny, nz]} rotation={[0, Math.PI / 2, 0]} renderOrder={1003} raycast={() => null}>
                            <torusGeometry args={[ringRadius, beamRadius * 0.9, 16, 64]} />
                            <primitive attach="material" object={alignBeamZCoreMat} />
                        </mesh>
                    </group>
                );
            }
        });
        return markers.length ? <group>{markers}</group> : null;
    }, [alignmentGuides, alignBeamXCoreMat, alignBeamXGlowMat, alignBeamYCoreMat, alignBeamYGlowMat, alignBeamZCoreMat, alignBeamZGlowMat, gridConfig?.snapGuideBeamLenX, gridConfig?.snapGuideBeamLenY, gridConfig?.snapGuideBeamLenZ, gridConfig?.snapGuideBeamThickness, nodes]);
    // Bridge: prefer wireStroke prop; otherwise derive from legacy wireReveal UI
// Bridge: prefer wireStroke prop; otherwise derive from legacy wireReveal UI
    // Bridge: prefer wireStroke prop; otherwise derive from legacy wireReveal UI
    const mergedWireStroke = React.useMemo(() => {
        let stroke = wireStrokeProp;

        // Back-compat: if only the old wireReveal API is provided, convert it
        if (!stroke && wireReveal) {
            stroke = {
                enabled: !!wireReveal.enabled,
                mode: wireReveal.mode || "lr",
                // your "Duration (s)" slider drives both in/out
                duration: typeof wireReveal.duration === "number" ? wireReveal.duration : 1.2,
                feather: typeof wireReveal.feather === "number" ? wireReveal.feather : 0.08,
                surfaceFeather: typeof wireReveal.feather === "number" ? wireReveal.feather : 0.08,
            };
        }

        // No config at all → let ImportedModel use its defaults (no reveal)
        if (!stroke) return undefined;

        // If the REVEAL checkbox is off, don't run the effect at all
        if (!stroke.enabled) return undefined;

        // 🔑 IMPORTANT: never run the reveal effect when the wireframe overlay is off
        // This is what guarantees the solid textured model is fully visible.
        if (!wireframe) {
            return {
                ...stroke,
                // keep duration identical so timing matches both directions
                duration: stroke.duration,
                featherStart: 0.001,
            };
        }
        return stroke;
    }, [wireStrokeProp, wireReveal, wireframe]);



    const allowSelect = !uiHidden;
    const selectedForRender = allowSelect ? selected : null;
    const selectedMultiForRender = allowSelect ? selectedMulti : [];
    const selectedFlowAnchorForRender = allowSelect ? selectedFlowAnchor : null;

    const clampNodeToRoomBoundsLocal = useCallback((node, pos) => {
        const p = Array.isArray(pos)
            ? [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0]
            : (pos?.toArray ? pos.toArray() : [pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0]);

        if (!node?.roomId) return p;
        const room = rooms.find((r) => r.id === node.roomId);
        if (!room) return p;
        if (room.locked) return p;

        const cfg = room.nodeBounds || {};
        if (!cfg.enabled) return p;

        const shape = cfg.shape || "box";
        const padding = Number(cfg.padding ?? 0) || 0;
        const center = room.center || [0, 0, 0];
        const roomSize = room.size || [3, 1.6, 2.2];

        const [cx, cy, cz] = center;
        const [rw, rh, rd] = roomSize;

        const width = Number.isFinite(cfg.width) ? cfg.width : rw;
        const height = Number.isFinite(cfg.height) ? cfg.height : rh;
        const depth = Number.isFinite(cfg.depth) ? cfg.depth : rd;

        const innerW = Math.max(0, width - padding * 2);
        const innerH = Math.max(0, height - padding * 2);
        const innerD = Math.max(0, depth - padding * 2);

        let [x, y, z] = p;

        if (innerW <= 0 || innerD <= 0 || innerH <= 0) {
            const minY0 = cy - rh / 2;
            const maxY0 = cy + rh / 2;
            const yClamped = Math.max(minY0, Math.min(maxY0, y));
            return [cx, yClamped, cz];
        }

        const minY = cy - innerH / 2;
        const maxY = cy + innerH / 2;
        y = Math.max(minY, Math.min(maxY, y));

        if (shape === "circle") {
            let radius = Number(cfg.radius);
            if (!Number.isFinite(radius) || radius <= 0) {
                radius = Math.min(innerW, innerD) / 2;
            }
            if (radius > 0) {
                const dx = x - cx;
                const dz = z - cz;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > radius && dist > 1e-4) {
                    const k = radius / dist;
                    x = cx + dx * k;
                    z = cz + dz * k;
                }
            } else {
                x = cx;
                z = cz;
            }
        } else {
            const minX = cx - innerW / 2;
            const maxX = cx + innerW / 2;
            const minZ = cz - innerD / 2;
            const maxZ = cz + innerD / 2;
            x = Math.max(minX, Math.min(maxX, x));
            z = Math.max(minZ, Math.min(maxZ, z));
        }

        return [x, y, z];
    }, [rooms]);

// Fast lookup for multi-selection like "node:123" / "room:abc"
    const selectedMultiSet = useMemo(() => {
        const s = new Set();
        (selectedMultiForRender || []).forEach((it) => {
            if (it?.type && it?.id) s.add(`${it.type}:${it.id}`);
        });
        return s;
    }, [selectedMultiForRender]);
    // De-dupe multi-selection so an entity can never be updated twice per tick.
// This is a common cause of "teleport/fly" when selecting via a box.
    const uniqueSelectedMulti = useMemo(() => {
        const out = [];
        const seen = new Set();
        (selectedMultiForRender || []).forEach((it) => {
            if (!it?.type || !it?.id) return;
            const k = `${it.type}:${it.id}`;
            if (seen.has(k)) return;
            seen.add(k);
            out.push(it);
        });
        return out;
    }, [selectedMultiForRender]);

    const handleRoomPointerDown = useCallback((id, e) => {
        if (!allowSelect) return;
        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
        if (!isLeft) return;
        const additive = e?.ctrlKey || e?.metaKey;
        if (moveMode && (selectedForRender || (selectedMultiForRender || []).length) && !additive && !linkMode) return;
        if (selectedFlowAnchorForRender) return;
        if (selectedBreakpoint) return;
        if (!additive && selectedForRender?.type === "node") return;
        if (!additive && (selectedMultiForRender || []).some((s) => s?.type === "node")) return;
        if (dragState?.active) return;
        if (onRoomPointerDown) onRoomPointerDown(id, e);
        else setSelected?.({ type: "room", id });
    }, [allowSelect, dragState?.active, moveMode, onRoomPointerDown, selectedForRender, selectedFlowAnchorForRender, selectedBreakpoint, selectedMultiForRender, setSelected]);

    const handleNodePointerDown = useCallback((id, e) => {
        if (!allowSelect) return;
        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
        if (!isLeft) return;
        const additive = e?.ctrlKey || e?.metaKey;
        if (moveMode && (selectedForRender || (selectedMultiForRender || []).length) && !additive) return;
        if (selectedFlowAnchorForRender || selectedBreakpoint) return;
        if (dragState?.active) return;
        if (onNodePointerDown) onNodePointerDown(id, e);
        else setSelected?.({ type: "node", id });
    }, [allowSelect, dragState?.active, moveMode, linkMode, onNodePointerDown, selectedFlowAnchorForRender, selectedBreakpoint, selectedForRender, selectedMultiForRender, setSelected]);

    const trySelectNodeFromEvent = useCallback((e) => {
        const hits = e?.intersections || [];
        for (const hit of hits) {
            const obj = hit?.object;
            if (!obj) continue;
            if (obj.userData?.__epicType === "instancedNode") {
                const ids = obj.userData.__epicNodeIds;
                const idx = hit.instanceId;
                const nodeId = Array.isArray(ids) && idx != null ? ids[idx] : null;
                if (nodeId != null) {
                    handleNodePointerDown(nodeId, e);
                    return true;
                }
            }
            let cur = hit?.eventObject || obj;
            while (cur) {
                if (cur.userData?.__epicType === "node") {
                    const nodeId = cur.userData.__nodeId ?? cur.userData.__nodeID ?? cur.userData.__id;
                    if (nodeId != null) {
                        handleNodePointerDown(nodeId, e);
                        return true;
                    }
                }
                cur = cur.parent;
            }
        }
        return false;
    }, [handleNodePointerDown]);

    const getNodeFadeInfo = useCallback((n) => {
        const store = fadeLinkHideRef.current;
        if (!store) return { fadeTarget: 1, fadeInDuration: 0.6, fadeOutDuration: 0.6 };
        const roomId = n?.roomId != null ? String(n.roomId) : "";
        const deckId = n?.deckId != null ? String(n.deckId) : (roomId ? (roomDeckById.get(roomId) || "") : "");
        const forceShowNode = store.forceShowNodes?.has?.(String(n.id)) ?? false;
        const forceShowRoom = n.roomId ? (store.forceShowRooms?.has?.(String(n.roomId)) ?? false) : false;
        const containerHidden =
            (!forceShowRoom && n.roomId && (store.rooms?.has?.(String(n.roomId)) ?? false)) ||
            (deckId && (store.decks?.has?.(deckId) ?? false)) ||
            (!forceShowRoom && n.groupId && (store.groups?.has?.(String(n.groupId)) ?? false));
        const fadeHidden =
            (store.nodes?.has?.(String(n.id)) ?? false) ||
            (!forceShowNode && containerHidden);
        const fadeTarget = (store.all || fadeHidden) ? 0 : 1;
        return {
            fadeTarget,
            fadeInDuration: Math.max(0, Number(store.inDur ?? 0.6) || 0.6),
            fadeOutDuration: Math.max(0, Number(store.outDur ?? 0.6) || 0.6),
        };
    }, [roomDeckById]);

    const getRoomFadeInfo = useCallback((r) => {
        const store = fadeLinkHideRef.current;
        if (!store) return { fadeTarget: 1, fadeInDuration: 0.6, fadeOutDuration: 0.6 };
        const roomId = r?.id != null ? String(r.id) : "";
        const deckId = r?.deckId != null ? String(r.deckId) : "";
        const forceShowRoom = roomId ? (store.forceShowRooms?.has?.(roomId) ?? false) : false;
        const fadeHidden =
            (!forceShowRoom && roomId && (store.rooms?.has?.(roomId) ?? false)) ||
            (deckId && (store.decks?.has?.(deckId) ?? false)) ||
            (!forceShowRoom && r?.groupId && (store.groups?.has?.(String(r.groupId)) ?? false));
        const fadeTarget = (store.all || fadeHidden) ? 0 : 1;
        return {
            fadeTarget,
            fadeInDuration: Math.max(0, Number(store.inDur ?? 0.6) || 0.6),
            fadeOutDuration: Math.max(0, Number(store.outDur ?? 0.6) || 0.6),
        };
    }, []);

    const fadeAlphaByIdRef = useRef(new Map());
    const roomFadeAlphaByIdRef = useRef(new Map());
    const instancedFadeAlphaByIdRef = useRef(new Map());
    const instancedNodeIdSetRef = useRef(new Set());
    useFrame((_, dt) => {
        const list = nodes || [];
        if (!list.length) return;
        const map = fadeAlphaByIdRef.current;
        const instancedSet = instancedNodeIdSetRef.current;
        let dirty = false;
        const liveIds = new Set();
        list.forEach((n) => {
            if (!n || n.id == null) return;
            const id = String(n.id);
            liveIds.add(id);
            if (instancedSet.has(id)) return;
            if (n?.fade?.enabled === false) {
                if (map.has(id)) {
                    map.delete(id);
                    dirty = true;
                }
                return;
            }
            const { fadeTarget, fadeInDuration, fadeOutDuration } = getNodeFadeInfo(n);
            const target = fadeTarget;
            const cur = map.get(id);
            if (cur == null) {
                map.set(id, target);
                return;
            }
            if (Math.abs(target - cur) < 0.0005) {
                if (cur !== target) {
                    map.set(id, target);
                    dirty = true;
                }
                return;
            }
            const wantsIn = target > cur;
            const dur = wantsIn ? fadeInDuration : fadeOutDuration;
            const step = dur <= 0.0001 ? 1 : (dt / dur);
            const next = cur + Math.sign(target - cur) * step;
            const clamped = Math.max(0, Math.min(1, next));
            if (Math.abs(clamped - cur) > 0.0005) {
                map.set(id, clamped);
                dirty = true;
            }
        });
        if (map.size) {
            for (const id of map.keys()) {
                if (!liveIds.has(id)) {
                    map.delete(id);
                    dirty = true;
                }
            }
        }
    });

    useFrame((_, dt) => {
        const list = rooms || [];
        if (!list.length) return;
        const map = roomFadeAlphaByIdRef.current;
        const liveIds = new Set();
        list.forEach((r) => {
            if (!r || r.id == null) return;
            const id = String(r.id);
            liveIds.add(id);
            if (r?.fade?.enabled === false) {
                map.delete(id);
                return;
            }
            const { fadeTarget, fadeInDuration, fadeOutDuration } = getRoomFadeInfo(r);
            const target = fadeTarget;
            const cur = map.get(id);
            if (cur == null) {
                map.set(id, target);
                return;
            }
            if (Math.abs(target - cur) < 0.0005) {
                if (cur !== target) map.set(id, target);
                return;
            }
            const wantsIn = target > cur;
            const dur = wantsIn ? fadeInDuration : fadeOutDuration;
            const step = dur <= 0.0001 ? 1 : (dt / dur);
            const next = cur + Math.sign(target - cur) * step;
            const clamped = Math.max(0, Math.min(1, next));
            if (Math.abs(clamped - cur) > 0.0005) map.set(id, clamped);
        });
        if (map.size) {
            for (const id of map.keys()) {
                if (!liveIds.has(id)) map.delete(id);
            }
        }
    });

    useFrame((state) => {
        const t = state.clock.getElapsedTime();
        const pulse = 0.5 + 0.5 * Math.sin(t * 6.0);
        const coreOp = 0.08 + pulse * 0.18;
        const glowOp = 0.25 + pulse * 0.35;
        alignBeamXCoreMat.opacity = coreOp;
        alignBeamXGlowMat.opacity = glowOp;
        alignBeamYCoreMat.opacity = coreOp;
        alignBeamYGlowMat.opacity = glowOp;
        alignBeamZCoreMat.opacity = coreOp;
        alignBeamZGlowMat.opacity = glowOp;
    });

    const instancedHighCount = useMemo(() => (nodesForRender || []).length > 160, [nodesForRender]);
    const linkPathWorkerRef = useRef(null);
    const linkPathReqIdRef = useRef(0);
    const [linkPathById, setLinkPathById] = useState(new Map());

    const instancedCandidates = useMemo(() => {
        if (linkMode) return [];
        const exclude = new Set();
        if (selected?.type === "node" && selected.id != null) exclude.add(String(selected.id));
        if (selectedFlowAnchorForRender?.nodeId != null) exclude.add(String(selectedFlowAnchorForRender.nodeId));
        if (masterNodeId != null) exclude.add(String(masterNodeId));

        const isEligibleShape = (shape) => {
            const t = String(shape?.type || "sphere").toLowerCase();
            return ["sphere", "box", "square", "cylinder", "cone", "disc", "circle", "hexagon"].includes(t);
        };

        const allowLightInstancing = !showLights && !showLightBounds;
        const list = [];
        (nodesForRender || []).forEach((n) => {
            if (!n || !n.id) return;
            const roomId = n?.roomId != null ? String(n.roomId) : "";
            const deckId = n?.deckId != null ? String(n.deckId) : (roomId ? (roomDeckById.get(roomId) || "") : "");
            const hiddenByContainer =
                (deckId && hiddenDeck.has(deckId)) ||
                (roomId && hiddenRooms.has(roomId));
            if (hiddenByContainer) {
                const { fadeTarget } = getNodeFadeInfo(n);
                const fadeAlpha = instancedFadeAlphaByIdRef.current.get(String(n.id));
                const keepForFadeOut =
                    fadeTarget <= 0.001 &&
                    fadeAlpha != null &&
                    fadeAlpha > 0.001;
                if (!keepForFadeOut) return;
            }
            if (exclude.has(String(n.id))) return;
            if (n.hiddenMesh) return;
            if (n.represent?.enabled) return;
            if (n.product) return;
            if (n.textBox?.enabled) return;
            if (n.flowAnchorsEnabled) return;
            const lightType = String(n.light?.type || "none").toLowerCase();
            const hasActiveLight = (n.light?.enabled !== false) && lightType !== "none";
            if (!allowLightInstancing && hasActiveLight) return;
            const shape = n.shape || { type: "sphere", radius: 0.32 };
            if (!isEligibleShape(shape)) return;
            list.push(n);
        });
        return list;
    }, [nodesForRender, selected, selectedFlowAnchorForRender, hiddenDeck, hiddenRooms, showLights, showLightBounds, masterNodeId, linkMode, roomDeckById, getNodeFadeInfo]);

    const instancedNodeIdSet = useMemo(() => {
        return new Set(instancedCandidates.map((n) => String(n.id)));
    }, [instancedCandidates]);
    useEffect(() => {
        instancedNodeIdSetRef.current = instancedNodeIdSet;
    }, [instancedNodeIdSet]);

    const InstancedNodeLabels = useCallback(function InstancedNodeLabels({ items }) {
        if (!labelsOnEffective) return null;
        if (items.length > 120) return null;
        return (
            <>
                {items.map((n) => {
                    const shape = n.shape || { type: "sphere", radius: 0.32 };
                    const t = String(shape?.type || "sphere").toLowerCase();
                    const labelText = n?.label || n?.name || n?.id;
                    if (!labelText) return null;
                const { fadeTarget } = getNodeFadeInfo(n);
                if (fadeTarget <= 0) return null;
                const externalAlpha = fadeAlphaByIdRef.current.get(String(n.id));
                if (externalAlpha != null && externalAlpha > 0.001 && externalAlpha < 0.999) return null;
                if (n?.groupId != null && fadedGroupSet.has(String(n.groupId))) return null;
                const p = n.position || [0, 0, 0];
                let yOffset = 0.44;
                    if (t === "sphere") yOffset = (shape.radius ?? 0.32) + 0.12;
                    else if (t === "cylinder") yOffset = (shape.height ?? 0.6) / 2 + 0.12;
                    else if (t === "cone") yOffset = (shape.height ?? 0.7) / 2 + 0.12;
                    else if (t === "disc" || t === "circle") yOffset = (shape.height ?? 0.08) / 2 + 0.12;
                    else if (t === "hexagon") yOffset = (shape.height ?? 0.5) / 2 + 0.12;
                    else if (t === "box" || t === "square") yOffset = (shape.scale?.[1] ?? 0.3) / 2 + 0.12;
                    const labelYOffset = Number(n?.labelYOffset ?? 0) || 0;
                    const labelXOffset = Number(n?.labelXOffset ?? 0) || 0;
                    const labelY = yOffset + labelYOffset;
                    const labelSizeLocal = (n?.labelScale ?? 1) * (labelSize ?? 0.24);
                    const labelColorLocal = n?.labelColor ?? "#ffffff";
                    const labelAlignLocal = String(n?.labelAlign ?? "center").toLowerCase();
                    const labelTextAlign = (labelAlignLocal === "left" || labelAlignLocal === "right" || labelAlignLocal === "center")
                        ? labelAlignLocal
                        : "center";
                    const labelMaxWidthLocal = Number(n?.labelMaxWidth ?? labelMaxWidth ?? 24);
                    const labelWrapLocal = (n?.labelWrap ?? true) !== false;
                    const labelMaxWidthEff = (labelWrapLocal && Number.isFinite(labelMaxWidthLocal) && labelMaxWidthLocal > 0)
                        ? labelMaxWidthLocal
                        : undefined;
                    return (
                        <Billboard key={`lbl-${n.id}`} follow position={[p[0] + labelXOffset, p[1] + labelY, p[2]]}>
                            <Text
                                fontSize={labelSizeLocal}
                                color={labelColorLocal}
                                maxWidth={labelMaxWidthEff}
                                textAlign={labelTextAlign}
                                overflowWrap={labelWrapLocal ? "break-word" : "normal"}
                                anchorX={labelTextAlign}
                                outlineWidth={0}
                                outlineColor="#000000"
                                outlineOpacity={0}
                            >
                                {labelText}
                            </Text>
                        </Billboard>
                    );
                })}
            </>
        );
    }, [labelMaxWidth, labelSize, labelsOnEffective]);

    const InstancedNodes = useCallback(function InstancedNodes({ items, highNodeCount = false }) {
        const meshRefs = useRef({});
        const idByTypeRef = useRef({});
        const opacityByIdRef = useRef({});
        const dataByType = useMemo(() => {
            const groups = new Map();
            items.forEach((n) => {
                const shape = n.shape || { type: "sphere", radius: 0.32 };
                const type = String(shape?.type || "sphere").toLowerCase();
                const entry = {
                    node: n,
                    type,
                    shape,
                };
                if (!groups.has(type)) groups.set(type, []);
                groups.get(type).push(entry);
            });
            return groups;
        }, [items]);

        const geometries = useMemo(() => ({
            sphere: new THREE.SphereGeometry(1, 16, 16),
            box: new THREE.BoxGeometry(1, 1, 1),
            square: new THREE.BoxGeometry(1, 1, 1),
            cylinder: new THREE.CylinderGeometry(1, 1, 1, 24),
            cone: new THREE.ConeGeometry(1, 1, 24),
            disc: new THREE.CylinderGeometry(1, 1, 1, 48),
            circle: new THREE.CylinderGeometry(1, 1, 1, 48),
            hexagon: new THREE.CylinderGeometry(1, 1, 1, 6),
        }), []);

        const material = useMemo(() => {
            const mat = new THREE.MeshStandardMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 1,
                roughness: 0.35,
                metalness: 0.05,
            });
            mat.onBeforeCompile = (shader) => {
                shader.vertexShader = [
                    "attribute float instanceOpacity;",
                    "varying float vInstanceOpacity;",
                    shader.vertexShader.replace(
                        "void main() {",
                        "void main() { vInstanceOpacity = instanceOpacity;"
                    ),
                ].join("\n");
                shader.fragmentShader = [
                    "varying float vInstanceOpacity;",
                    shader.fragmentShader.replace(
                        "vec4 diffuseColor = vec4( diffuse, opacity );",
                        "vec4 diffuseColor = vec4( diffuse, opacity );\n  diffuseColor.a *= vInstanceOpacity;"
                    ),
                ].join("\n");
            };
            return mat;
        }, []);

        useEffect(() => {
            const liveIds = new Set();
            dataByType.forEach((list, type) => {
                const mesh = meshRefs.current[type];
                if (!mesh) return;
                const count = list.length;
                mesh.count = count;

                const idList = [];
                const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
                const opacityAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);

                const dummy = new THREE.Object3D();
                list.forEach((entry, idx) => {
                    const n = entry.node;
                    const shape = entry.shape || {};
                    const p = n.position || [0, 0, 0];
                    const r = n.rotation || [0, 0, 0];
                    const t = entry.type;

                    let sx = 1, sy = 1, sz = 1;
                    const mult = highNodeCount ? 0.85 : 1;
                    if (t === "sphere") {
                        const rad = shape.radius ?? 0.32;
                        sx = rad * mult; sy = rad * mult; sz = rad * mult;
                    } else if (t === "box" || t === "square") {
                        const s = shape.scale || [0.6, 0.3, 0.6];
                        sx = (s[0] ?? 0.6) * mult;
                        sy = (s[1] ?? 0.3) * mult;
                        sz = (s[2] ?? 0.6) * mult;
                    } else {
                        const rad = shape.radius ?? (t === "disc" || t === "circle" ? 0.35 : 0.35);
                        const h = shape.height ?? (t === "disc" || t === "circle" ? 0.08 : 0.6);
                        sx = rad * mult; sy = h * mult; sz = rad * mult;
                    }

                    dummy.position.set(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
                    dummy.rotation.set(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0);
                    dummy.scale.set(sx, sy, sz);
                    dummy.updateMatrix();
                    mesh.setMatrixAt(idx, dummy.matrix);

                    const baseColor = n?.color || clusterColor(n?.cluster);
                    const c = new THREE.Color(baseColor || "#6ee7d8");
                    colorAttr.setXYZ(idx, c.r, c.g, c.b);

                    const { fadeTarget } = getNodeFadeInfo(n);
                    const visible = n?.visible !== false ? 1 : 0;
                    const target = visible * fadeTarget;
                    opacityAttr.setX(idx, target);
                    opacityByIdRef.current[n.id] = target;
                    instancedFadeAlphaByIdRef.current.set(String(n.id), target);
                    liveIds.add(String(n.id));
                    idList.push(n.id);
                });

                mesh.instanceColor = colorAttr;
                mesh.geometry.setAttribute("instanceOpacity", opacityAttr);
                mesh.instanceMatrix.needsUpdate = true;
                mesh.instanceColor.needsUpdate = true;
                mesh.geometry.attributes.instanceOpacity.needsUpdate = true;
                idByTypeRef.current[type] = idList;

                mesh.userData.__epicType = "instancedNode";
                mesh.userData.__epicNodeIds = idList;
            });
            for (const id of instancedFadeAlphaByIdRef.current.keys()) {
                if (!liveIds.has(id)) instancedFadeAlphaByIdRef.current.delete(id);
            }
        }, [dataByType, getNodeFadeInfo]);

        useFrame((_, dt) => {
            if (!anyFadeActive) return;
            dataByType.forEach((list, type) => {
                const mesh = meshRefs.current[type];
                if (!mesh) return;
                const opacityAttr = mesh.geometry.getAttribute("instanceOpacity");
                if (!opacityAttr) return;
                let dirty = false;
                list.forEach((entry, idx) => {
                    const n = entry.node;
                    const { fadeTarget, fadeInDuration, fadeOutDuration } = getNodeFadeInfo(n);
                    const visible = n?.visible !== false ? 1 : 0;
                    const target = visible * fadeTarget;
                    const cur = opacityByIdRef.current[n.id] ?? target;
                    if (Math.abs(target - cur) < 0.0005) {
                        opacityByIdRef.current[n.id] = target;
                        instancedFadeAlphaByIdRef.current.set(String(n.id), target);
                        return;
                    }
                    const wantsIn = target > cur;
                    const dur = wantsIn ? fadeInDuration : fadeOutDuration;
                    const step = dur <= 0.0001 ? 1 : (dt / dur);
                    const next = cur + Math.sign(target - cur) * step;
                    const clamped = Math.max(0, Math.min(1, next));
                    opacityByIdRef.current[n.id] = clamped;
                    instancedFadeAlphaByIdRef.current.set(String(n.id), clamped);
                    opacityAttr.setX(idx, clamped);
                    dirty = true;
                });
                if (dirty) opacityAttr.needsUpdate = true;
            });
        });

        return (
            <>
                {Array.from(dataByType.entries()).map(([type, list]) => {
                    if (!list.length) return null;
                    const geom = geometries[type] || geometries.sphere;
                    return (
                        <instancedMesh
                            key={`instanced-${type}`}
                            ref={(el) => { meshRefs.current[type] = el; }}
                            args={[geom, material, list.length]}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    const idx = e.instanceId;
                    const ids = idByTypeRef.current[type] || [];
                    const nodeId = ids[idx];
                    if (nodeId != null) {
                        const alpha = opacityByIdRef.current[nodeId];
                        if (alpha != null && alpha < 0.999) return;
                        handleNodePointerDown(nodeId, e);
                    }
                }}
            />
                    );
                })}
            </>
        );
    }, [anyFadeActive, getNodeFadeInfo, handleNodePointerDown]);

// --- DEMO LINKS (only used if no links were passed in) ---
    const demoLinks = (() => {
        // If you already know your node IDs, replace these:
        const preset = [
            { id: "l1", from: "A", to: "B", kind: "wifi",  style: "wavy", effects: { rainbow: true }, scale: 1.2 },
            { id: "l2", from: "B", to: "C", kind: "wired", style: "dashed", width: 3, speed: 1.2 },
            { id: "l3", from: "C", to: "D", kind: "fiber", style: "epic", effects: { rainbow: true, sparks: true }, tube: { glow: 1.8 }, scale: 1.3 },
            { id: "l4", from: "A", to: "C", kind: "wired", style: "sweep", speed: 1.1, sweep: { thickness: 0.06, glow: 1.25 } },
        ];

        // If you DON'T know your IDs, auto-wire the first 4 nodes:
        if (!nodes || nodes.length < 2) return [];
        const ids = nodes.slice(0, 4).map(n => n.id);
        const auto = [];
        if (ids[0] && ids[1]) auto.push({ id: "l1", from: ids[0], to: ids[1], kind: "wifi",  style: "wavy", effects:{ rainbow:true }, scale: 1.2 });
        if (ids[1] && ids[2]) auto.push({ id: "l2", from: ids[1], to: ids[2], kind: "wired", style: "dashed", width: 3, speed: 1.2 });
        if (ids[2] && ids[3]) auto.push({ id: "l3", from: ids[2], to: ids[3], kind: "fiber", style: "epic", effects:{ rainbow:true, sparks:true }, tube:{ glow:1.8 }, scale:1.3 });

        // Prefer auto if possible; otherwise fall back to the A/B/C/D preset.
        return auto.length ? auto : preset;
    })();

// Use demo links only if none were provided via props
    const allLinks = useMemo(() => (links && links.length ? links : demoLinks), [links, demoLinks]);

    // Per-node link slot indices (stable) used for flow anchor spreading at endpoints
    const linkSlots = useMemo(() => {
        const outBy = new Map();
        const inBy = new Map();
        (allLinks || []).forEach((l) => {
            if (!l || !l.id) return;
            const f = l.from;
            const t = l.to;
            if (f != null) {
                if (!outBy.has(f)) outBy.set(f, []);
                outBy.get(f).push(l.id);
            }
            if (t != null) {
                if (!inBy.has(t)) inBy.set(t, []);
                inBy.get(t).push(l.id);
            }
        });

        const out = new Map();
        const inn = new Map();

        outBy.forEach((ids) => {
            ids.sort();
            const count = ids.length || 1;
            ids.forEach((id, idx) => out.set(id, { idx, count }));
        });

        inBy.forEach((ids) => {
            ids.sort();
            const count = ids.length || 1;
            ids.forEach((id, idx) => inn.set(id, { idx, count }));
        });

        return { out, inn };
    }, [allLinks]);

    const anchorSetSlots = useMemo(() => {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const buckets = new Map();
        (allLinks || []).forEach((l) => {
            if (!l || !l.id) return;
            const a = byId.get(l.from);
            const b = byId.get(l.to);
            if (!a || !b) return;
            const selection = (() => {
                const candidates = [b, a];
                if (l.flowAnchorSetOwnerId) {
                    const ownerKey = String(l.flowAnchorSetOwnerId);
                    const preferred = candidates.find((cand) => String(cand?.id) === ownerKey);
                    if (preferred) {
                        const set = __findFlowAnchorSet(preferred, l.flowAnchorSetId, false)
                            || __findFlowAnchorSet(preferred, null, true);
                        if (set) return { owner: preferred, set };
                    }
                }
                if (l.flowAnchorSetId) {
                    for (const cand of candidates) {
                        if (!cand || cand.flowAnchorsEnabled !== true) continue;
                        const set = __findFlowAnchorSet(cand, l.flowAnchorSetId, false);
                        if (set) return { owner: cand, set };
                    }
                }
                for (const cand of candidates) {
                    if (!cand || cand.flowAnchorsEnabled !== true) continue;
                    const set = __findFlowAnchorSet(cand, null, true);
                    if (set) return { owner: cand, set };
                }
                return { owner: null, set: null };
            })();
            if (!selection.owner || !selection.set) return;
            const dir = selection.owner === b ? "in" : "out";
            const key = `${selection.owner.id}:${selection.set.id}:${dir}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push({ id: l.id, ownerId: selection.owner.id });
        });
        const slots = new Map();
        const angleThreshold = (12 * Math.PI) / 180;
        const linkById = new Map((allLinks || []).map((l) => [l.id, l]));
        buckets.forEach((items) => {
            const entries = items
                .map((item) => {
                    const link = linkById.get(item.id);
                    if (!link) return null;
                    const owner = byId.get(item.ownerId);
                    if (!owner) return null;
                    const otherId = owner.id === link.from ? link.to : link.from;
                    const other = byId.get(otherId);
                    if (!other) return null;
                    const ownerPos = owner.position || [0, 0, 0];
                    const otherPos = other.position || [0, 0, 0];
                    const dirV = new THREE.Vector3(
                        (otherPos[0] || 0) - (ownerPos[0] || 0),
                        (otherPos[1] || 0) - (ownerPos[1] || 0),
                        (otherPos[2] || 0) - (ownerPos[2] || 0),
                    );
                    if (dirV.lengthSq() < 1e-6) dirV.set(1, 0, 0);
                    dirV.normalize();
                    return { id: item.id, dirV };
                })
                .filter(Boolean);

            const groups = [];
            entries.forEach((entry) => {
                let target = null;
                for (const g of groups) {
                    const ang = g.dir.angleTo(entry.dirV);
                    if (ang <= angleThreshold) {
                        target = g;
                        break;
                    }
                }
                if (!target) {
                    groups.push({ dir: entry.dirV.clone(), ids: [entry.id] });
                } else {
                    target.ids.push(entry.id);
                    const blend = target.dir.clone().add(entry.dirV).normalize();
                    target.dir.copy(blend.lengthSq() > 1e-6 ? blend : target.dir);
                }
            });

            groups.forEach((g) => {
                g.ids.sort();
                const count = g.ids.length || 1;
                g.ids.forEach((id, idx) => slots.set(id, { idx, count }));
            });
        });
        return slots;
    }, [allLinks, nodes]);

    useEffect(() => {
        if (typeof Worker === "undefined") return undefined;
        const worker = new Worker(__workerUrl("linkPathWorker.js"));
        worker.onerror = (err) => {
            err?.preventDefault?.();
            worker.terminate();
            linkPathWorkerRef.current = null;
        };
        linkPathWorkerRef.current = worker;
        worker.onmessage = (e) => {
            const payload = e?.data || {};
            if (payload.id !== linkPathReqIdRef.current) return;
            const results = Array.isArray(payload.results) ? payload.results : [];
            const next = new Map();
            for (const item of results) {
                if (!item || !item.id) continue;
                next.set(String(item.id), {
                    points: Array.isArray(item.points) ? item.points : [],
                    forceOrthogonal: !!item.forceOrthogonal,
                    forceStraight: !!item.forceStraight,
                });
            }
            setLinkPathById((prev) => (__linkPathMapsEqual(prev, next) ? prev : next));
        };
        return () => {
            worker.terminate();
            linkPathWorkerRef.current = null;
        };
    }, []);

    const linkPathPayload = useMemo(() => {
        const nodesLite = (nodesForRender || []).map((n) => ({
            id: n?.id,
            position: n?.position,
            rackId: n?.rackId,
            kind: n?.kind,
            tidy: n?.tidy,
            flowAnchorSets: n?.flowAnchorSets,
            flowAnchors: n?.flowAnchors,
            flowAnchorActiveSetId: n?.flowAnchorActiveSetId,
            flowAnchorGlobalBendDeg: n?.flowAnchorGlobalBendDeg,
            flowAnchorNoDiagonal: n?.flowAnchorNoDiagonal,
            flowAnchorDynamicBreakpoints: n?.flowAnchorDynamicBreakpoints,
            flowAnchorSpreadPaths: n?.flowAnchorSpreadPaths,
            flowAnchorSpreadIgnoreBreakpoints: n?.flowAnchorSpreadIgnoreBreakpoints,
            flowAnchorsEnabled: n?.flowAnchorsEnabled,
            flowAnchor: n?.flowAnchor,
            anchorSpread: n?.anchorSpread,
        }));
        const linksLite = (allLinks || []).map((l) => ({
            id: l?.id,
            from: l?.from,
            to: l?.to,
            breakpoints: Array.isArray(l?.breakpoints) ? l.breakpoints : [],
            flowAnchorSetId: l?.flowAnchorSetId,
            flowAnchorSetOwnerId: l?.flowAnchorSetOwnerId,
        }));
        return { nodes: nodesLite, links: linksLite };
    }, [nodesForRender, allLinks]);

    useEffect(() => {
        const worker = linkPathWorkerRef.current;
        if (!worker) return;
        const reqId = linkPathReqIdRef.current + 1;
        linkPathReqIdRef.current = reqId;
        worker.postMessage({ id: reqId, nodes: linkPathPayload.nodes, links: linkPathPayload.links });
    }, [linkPathPayload]);

    // ---------- drei controls & camera ----------
    const tcRef = useRef();
    const controlsRef = useRef();
    const { gl, camera, scene } = useThree();
    const focusRafRef = useRef(0);
    const [lightingPrefs, setLightingPrefs] = useState(() => readLightingPrefs());
    const raycastWarmRef = useRef(false);
    const [rackHoverId, setRackHoverId] = useState(null);

    useEffect(() => {
        const onHover = (e) => {
            const id = e?.detail?.nodeId;
            if (id == null) return;
            setRackHoverId(String(id));
        };
        const onClear = () => setRackHoverId(null);
        window.addEventListener("EPIC3D_RACK_HOVER", onHover);
        window.addEventListener("EPIC3D_RACK_HOVER_CLEAR", onClear);
        return () => {
            window.removeEventListener("EPIC3D_RACK_HOVER", onHover);
            window.removeEventListener("EPIC3D_RACK_HOVER_CLEAR", onClear);
        };
    }, []);

    useEffect(() => {
        if (raycastWarmRef.current) return;
        if (!scene || !camera) return;
        raycastWarmRef.current = true;

        const run = () => {
            try {
                const raycaster = new THREE.Raycaster();
                const ndc = new THREE.Vector2(2, 2);
                raycaster.setFromCamera(ndc, camera);
                raycaster.intersectObjects(scene.children, true);
            } catch {}
        };

        if (typeof window !== "undefined" && window.requestIdleCallback) {
            const id = window.requestIdleCallback(run, { timeout: 200 });
            return () => window.cancelIdleCallback?.(id);
        }

        const id = setTimeout(run, 0);
        return () => clearTimeout(id);
    }, [scene, camera]);

    // Clamp/sanitize lighting so the scene can never go fully dark due to bad/zeroed prefs.
    // (This protects against localStorage edge-cases and keeps nodes/rooms visible when Lights are on.)
    const safeLighting = useMemo(() => {
        const clampNum = (v, fallback, lo, hi) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return fallback;
            return Math.max(lo, Math.min(hi, n));
        };

        const envPreset = (lightingPrefs?.envPreset ?? "warehouse") || "warehouse";
        const envIntensity = clampNum(lightingPrefs?.envIntensity, 0.8, 0, 10);
        const hemiIntensity = clampNum(lightingPrefs?.hemiIntensity, 0.7, 0, 10);
        const sunIntensity = clampNum(lightingPrefs?.sunIntensity, 2.4, 0, 80);
        const fillIntensity = clampNum(lightingPrefs?.fillIntensity, 1.0, 0, 80);
        const exposure = clampNum(lightingPrefs?.exposure, 1.0, 0.25, 6);

        const total = envIntensity + hemiIntensity + sunIntensity + fillIntensity;
        // Keep a stable ambient floor so the Lights toggle never hides meshes or UI.
        const ambientIntensity = Math.max(0.4, total < 0.15 ? 0.5 : 0.2);

        return {
            envPreset,
            envIntensity,
            hemiIntensity,
            sunIntensity,
            sunPosX: clampNum(lightingPrefs?.sunPosX, 6, -500, 500),
            sunPosY: clampNum(lightingPrefs?.sunPosY, 8, -500, 500),
            sunPosZ: clampNum(lightingPrefs?.sunPosZ, 6, -500, 500),
            fillIntensity,
            fillPosX: clampNum(lightingPrefs?.fillPosX, -5, -500, 500),
            fillPosY: clampNum(lightingPrefs?.fillPosY, 4, -500, 500),
            fillPosZ: clampNum(lightingPrefs?.fillPosZ, -3, -500, 500),
            exposure,
            ambientIntensity,
        };
    }, [lightingPrefs]);


    useEffect(() => {
        if (typeof window === "undefined") return;
        const on = () => setLightingPrefs(readLightingPrefs());
        window.addEventListener("epic3d:lighting-changed", on);
        return () => window.removeEventListener("epic3d:lighting-changed", on);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const onFocus = (e) => {
            const detail = e?.detail || {};
            const targetArr = Array.isArray(detail.target) ? detail.target : null;
            if (!targetArr || targetArr.length < 3) return;

            const target = new THREE.Vector3(
                Number(targetArr[0]) || 0,
                Number(targetArr[1]) || 0,
                Number(targetArr[2]) || 0,
            );
            const radiusRaw = Number(detail.radius);
            const baseDist = Number.isFinite(radiusRaw) ? radiusRaw * 2.2 + 2 : 6;
            const dist = THREE.MathUtils.clamp(
                baseDist,
                CFG.current.zoom.min,
                CFG.current.zoom.max,
            );

            const controls = controlsRef.current;
            const fromTarget = controls?.target?.clone?.() || new THREE.Vector3(0, 0, 0);
            const fromPos = camera.position.clone();

            const dir = fromPos.clone().sub(fromTarget);
            if (dir.lengthSq() < 1e-4) dir.set(1, 0.6, 1);
            dir.normalize();

            const toPos = target.clone().add(dir.multiplyScalar(dist));
            const toTarget = target;

            const start = performance.now();
            const duration = 650;
            const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

            if (focusRafRef.current) cancelAnimationFrame(focusRafRef.current);
            const tick = (now) => {
                const t = Math.min(1, (now - start) / duration);
                const k = ease(t);
                const curPos = fromPos.clone().lerp(toPos, k);
                const curTarget = fromTarget.clone().lerp(toTarget, k);
                camera.position.copy(curPos);
                if (controls && controls.target) {
                    controls.target.copy(curTarget);
                    controls.update();
                } else {
                    camera.lookAt(curTarget);
                }
                if (t < 1) {
                    focusRafRef.current = requestAnimationFrame(tick);
                }
            };
            focusRafRef.current = requestAnimationFrame(tick);
        };
        window.addEventListener("EPIC3D_CAMERA_FOCUS", onFocus);
        return () => {
            window.removeEventListener("EPIC3D_CAMERA_FOCUS", onFocus);
            if (focusRafRef.current) cancelAnimationFrame(focusRafRef.current);
        };
    }, [camera]);

    useEffect(() => {
        if (!gl) return;
        gl.toneMappingExposure = Number(safeLighting.exposure) || 1.0;
    }, [gl, safeLighting.exposure]);

    // ---------- config (tweak feel here) ----------
    const CFG = useRef({
        zoom: {
            min: 3.5,
            max: 180,
            lambda: 20,            // still used for some radius smoothing (tracks)
            wheelStrength: 0.0010,
            maxWheelStep: 0.75,
            zoomToCursor: true,

            // NEW: smooth scroll-zoom tuning
            scrollImpulse: 0.01,   // how strong each scroll tick is (higher = further)
            velLambda: 10,         // how fast zoom velocity decays (higher = snappier)
            maxZoomVel: 20        // cap on zoom velocity (world units / second)
        },

        fly: {
            lambda: 16,
            speedMin: 0.1,
            speedMax: 200,
            baseSpeed: 30,
            sprintMult: 3,
            verticalMult: 1.0,
            adjustRate: 1.2,
            speedSmooth: 10,
        },
    });


    // ---------- smoothed state ----------
    const s = useRef({
        // orbit radius
        radius: 8,
        radiusTarget: 8,
        zoomVel: 0,
        // fly velocity
        vel: new THREE.Vector3(),

        // dynamic fly speed (user adjustable)
        flySpeed: null,         // current speed
        flySpeedTarget: null,   // target speed (changes with +/-)

        // cursor for zoom anchoring
        ndc: new THREE.Vector2(0, 0),
        raycaster: new THREE.Raycaster(),

        // scratch
        tmp: {
            offset: new THREE.Vector3(),
            spherical: new THREE.Spherical(),
            dir: new THREE.Vector3(),
            right: new THREE.Vector3(),
            up: new THREE.Vector3(0, 1, 0),
            before: new THREE.Vector3(),
            after: new THREE.Vector3(),
            plane: new THREE.Plane(),
            move: new THREE.Vector3()
        }
    });

    const cameraTrackStateRef = useRef(new Map());
    const roomOperatorMoveRef = useRef(null);
    const prevRoomOperatorModeRef = useRef(roomOperatorMode);

    // ---------- helpers ----------
    const isTyping = () => {
        const ae = document.activeElement;
        return !!ae && (
            ae.tagName === "INPUT" ||
            ae.tagName === "TEXTAREA" ||
            ae.isContentEditable === true
        );
    };

    const dampScalar = (current, target, lambda, dt) =>
        current + (target - current) * (1 - Math.exp(-lambda * dt));

    const dampVec = (out, target, lambda, dt) => {
        const t = 1 - Math.exp(-lambda * dt);
        out.x += (target.x - out.x) * t;
        out.y += (target.y - out.y) * t;
        out.z += (target.z - out.z) * t;
        return out;
    };

    // track pointer (for zoom-to-cursor)
    useEffect(() => {
        const el = gl?.domElement;
        if (!el) return;
        const onMove = (e) => {
            const r = el.getBoundingClientRect();
            s.current.ndc.set(
                ((e.clientX - r.left) / r.width) * 2 - 1,
                -((e.clientY - r.top) / r.height) * 2 + 1
            );
        };
        el.addEventListener("pointermove", onMove);
        return () => el.removeEventListener("pointermove", onMove);
    }, [gl]);
    // When Room Operator mode is active, snap camera into a top-down view over the rooms/grid
    useEffect(() => {
        if (!roomOperatorMode) return;

        const ctrl = controlsRef.current;
        if (!ctrl || !camera) return;

        // Compute a simple average center of all rooms; fall back to origin.
        const c = new THREE.Vector3();
        let count = 0;
        (rooms || []).forEach((r) => {
            const center = r.center || [0, 0, 0];
            c.x += center[0];
            c.y += center[1];
            c.z += center[2];
            count++;
        });
        if (count > 0) {
            c.multiplyScalar(1 / count);
        }

        // Look mostly straight down, but with a tiny horizontal offset so we don't gimbal-lock
        const height = Math.max(8, s.current.radiusTarget || 8);
        const target = new THREE.Vector3(c.x, 0, c.z);
        const pos = new THREE.Vector3(c.x + 0.001, height, c.z + 0.001);

        ctrl.target.copy(target);
        camera.position.copy(pos);
        camera.updateProjectionMatrix();

        // Keep orbit smoothing in sync
        s.current.radius = height;
        s.current.radiusTarget = height;
    }, [roomOperatorMode, rooms, camera]);
// Smooth camera move into top-down Room Operator view
    useEffect(() => {
        const justEntered = roomOperatorMode && !prevRoomOperatorModeRef.current;
        prevRoomOperatorModeRef.current = roomOperatorMode;
        if (!justEntered) return;

        const ctrl = controlsRef.current;
        if (!ctrl || !camera) return;
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("EPIC3D_CAMERA_TURNTABLE_STOP", { detail: { reason: "room-operator" } }));
        }

        // 1) Find floorplan center (average of room centers)
        const center = new THREE.Vector3();
        let count = 0;
        (rooms || []).forEach((r) => {
            const c = r.center || [0, 0, 0];
            center.x += c[0];
            center.y += c[1];
            center.z += c[2];
            count++;
        });
        if (count > 0) center.multiplyScalar(1 / count);

        // 2) Estimate extents to choose a good height
        let maxExtent = 4;
        (rooms || []).forEach((r) => {
            const size = r.size || [3, 1.6, 2.2];
            const c = r.center || [0, 0, 0];
            const dx = Math.abs(c[0] - center.x) + size[0] * 0.5;
            const dz = Math.abs(c[2] - center.z) + size[2] * 0.5;
            maxExtent = Math.max(maxExtent, dx, dz);
        });
        const desiredRadius = Math.max(maxExtent * 1.4, 8);

        // 3) Build a "top-down, facing north" spherical offset
        const tmp = s.current.tmp;
        const spherical = tmp.spherical;
        spherical.radius = desiredRadius;
        spherical.phi = 0.0005;   // almost straight down from +Y
        spherical.theta = 0;      // fixed yaw (north-aligned)
        tmp.offset.setFromSpherical(spherical);

        const toTarget = new THREE.Vector3(center.x, 0, center.z);
        const toPos = toTarget.clone().add(tmp.offset);

        const fromPos = camera.position.clone();
        const fromTarget = ctrl.target.clone();

        const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
        roomOperatorMoveRef.current = {
            fromPos,
            fromTarget,
            toPos,
            toTarget,
            startMs: nowMs,
            endMs: nowMs + 700, // 0.7s tween
        };

        // Stop any fly velocity so we don't drift
        s.current.vel.set(0, 0, 0);

        // Keep zoom system in sync
        s.current.radiusTarget = desiredRadius;
    }, [roomOperatorMode, rooms, camera]);

    // initialize radius and fly speed from current camera/target
    useEffect(() => {
        const ctrl = controlsRef.current;
        if (!ctrl) return;
        const off = s.current.tmp.offset;
        off.copy(camera.position).sub(ctrl.target);
        s.current.tmp.spherical.setFromVector3(off);
        s.current.radius = s.current.tmp.spherical.radius;
        s.current.radiusTarget = s.current.radius;

        // init speed
        const base = CFG.current.fly.baseSpeed;
        s.current.flySpeed = base;
        s.current.flySpeedTarget = base;
    }, [camera]);

    // wheel -> set radiusTarget (movement is smoothed in frame loop)
    // wheel -> add zoom velocity impulse (smooth, inertial zoom along view direction)
    useEffect(() => {
        const el = gl?.domElement;
        if (!el) return;

        const onWheel = (e) => {
            const ctrl = controlsRef.current;
            const allowWhilePlacingRoom =
                roomOperatorMode && placement?.placeKind === "room";

            const allowed =
                ctrl &&
                !dragState?.active &&
                !isTyping() &&
                (!placement?.armed || allowWhilePlacingRoom);

            if (!allowed) return;

            e.preventDefault();
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("EPIC3D_CAMERA_TURNTABLE_STOP", { detail: { reason: "wheel" } }));
            }

            const z = CFG.current.zoom;
            const f = CFG.current.fly;
            const base = s.current.flySpeed ?? f.baseSpeed;

            // how “hard” this scroll event is
            const dy = THREE.MathUtils.clamp(e.deltaY, -400, 400);

            // scroll up (dy < 0) => zoom in => positive forward velocity
            const impulse = -dy * z.scrollImpulse * base;

            const maxVel = z.maxZoomVel * base;
            const current = s.current.zoomVel || 0;
            const next = THREE.MathUtils.clamp(current + impulse, -maxVel, maxVel);

            s.current.zoomVel = next;
        };

        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [gl, placement, dragState, roomOperatorMode]);


    useEffect(() => {
        if (typeof window === "undefined") return;

        const onDolly = (e) => {
            const scale = Number(e?.detail?.scale);
            if (!scale || scale === 1) return;
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("EPIC3D_CAMERA_TURNTABLE_STOP", { detail: { reason: "dolly" } }));
            }

            // pinch out (scale > 1) → zoom in
            // pinch in  (scale < 1) → zoom out
            const z = CFG.current.zoom;
            const f = CFG.current.fly;
            const base = s.current.flySpeed ?? f.baseSpeed;

            const strength = (scale - 1) * 120; // feels natural on tablets
            const impulse = strength * z.scrollImpulse * base;

            const maxVel = z.maxZoomVel * base;
            s.current.zoomVel = THREE.MathUtils.clamp(
                (s.current.zoomVel || 0) + impulse,
                -maxVel,
                maxVel
            );
        };

        window.addEventListener("EPIC3D_CAMERA_DOLLY", onDolly);
        return () => window.removeEventListener("EPIC3D_CAMERA_DOLLY", onDolly);
    }, [camera]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onStopAll = () => {
            roomOperatorMoveRef.current = null;
            turntableStateRef.current.clear();
            s.current.vel.set(0, 0, 0);
            s.current.zoomVel = 0;
        };
        window.addEventListener("EPIC3D_CAMERA_STOP_ALL", onStopAll);
        return () => window.removeEventListener("EPIC3D_CAMERA_STOP_ALL", onStopAll);
    }, []);





    // WASD/QE keys + speed adjust keys (+ / - and numpad add/sub)
// WASD/QE keys + speed adjust keys (+ / - and numpad add/sub)
    const keys = useRef(new Set());
    useEffect(() => {
        const bumpSpeed = (mult) => {
            const f = CFG.current.fly;
            const cur = s.current.flySpeedTarget ?? s.current.flySpeed ?? f.baseSpeed;
            let next = cur * mult;
            next = THREE.MathUtils.clamp(next, f.speedMin, f.speedMax);
            s.current.flySpeedTarget = next;
            // snap immediately so both WASD and wheel feel responsive
            s.current.flySpeed = next;
        };

        const down = (e) => {
            if (e.code === "Escape") {
                const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
                if (now - (lastEscRef.current || 0) < 380) {
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("EPIC3D_CAMERA_STOP_ALL", { detail: { reason: "double-escape" } }));
                    }
                    lastEscRef.current = 0;
                    return;
                }
                lastEscRef.current = now;
            }
            if (isTyping() || e.altKey) return;
            // Don't hijack browser zoom shortcuts
            if (e.ctrlKey || e.metaKey) return;

            const code = e.code;

            const isPlus = code === "Equal" || code === "NumpadAdd" || e.key === "+";
            const isMinus = code === "Minus" || code === "NumpadSubtract" || e.key === "-";

            if ((isPlus || isMinus) && !e.repeat) {
                e.preventDefault();
                // Shift = bigger step
                const step = e.shiftKey ? 1.35 : 1.15;
                bumpSpeed(isPlus ? step : 1 / step);
                return;
            }

            keys.current.add(code);
            if (
                code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD" ||
                code === "KeyQ" || code === "KeyE" || code === "ArrowUp" || code === "ArrowDown" ||
                code === "ArrowLeft" || code === "ArrowRight"
            ) {
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("EPIC3D_CAMERA_TURNTABLE_STOP", { detail: { reason: "keys" } }));
                }
            }
        };

        const up = (e) => { keys.current.delete(e.code); };

        const clearOnFocus = () => { if (isTyping()) keys.current.clear(); };

        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("focusin", clearOnFocus);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("focusin", clearOnFocus);
        };
    }, []);
// Camera view commands from top bar & hotkeys
    useEffect(() => {
        const handler = (ev) => {
            const detail = ev?.detail || {};
            const view = detail.view;
            if (!view) return;

            const ctrl = controlsRef.current;
            if (!ctrl) return;
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("EPIC3D_CAMERA_TURNTABLE_STOP", { detail: { reason: "camera-view" } }));
            }

            const tmp = s.current.tmp;
            const offset = tmp.offset;
            const target = ctrl.target || new THREE.Vector3(0, 0, 0);

            // current orbit radius from camera to target
            offset.copy(camera.position).sub(target);
            let radius = offset.length();
            if (!radius || radius < 0.0001) {
                radius = s.current.radius || 8;
            }

            const t = target.clone();

            if (view === "reset") {
                // Default startup pose: diagonal above front-right of origin
                const defaultTarget = new THREE.Vector3(0, 0, 0);
                camera.position.set(6, 4.5, 6);
                ctrl.target.copy(defaultTarget);
                camera.up.set(0, 1, 0);

                offset.copy(camera.position).sub(ctrl.target);
                tmp.spherical.setFromVector3(offset);
                s.current.radius = tmp.spherical.radius;
                s.current.radiusTarget = s.current.radius;

                camera.updateProjectionMatrix();
                ctrl.update();
                return;
            }

            switch (view) {
                case "front":
                    camera.up.set(0, 1, 0);
                    camera.position.set(t.x, t.y, t.z + radius);
                    break;
                case "back":
                    camera.up.set(0, 1, 0);
                    camera.position.set(t.x, t.y, t.z - radius);
                    break;
                case "left":
                    camera.up.set(0, 1, 0);
                    camera.position.set(t.x - radius, t.y, t.z);
                    break;
                case "right":
                    camera.up.set(0, 1, 0);
                    camera.position.set(t.x + radius, t.y, t.z);
                    break;
                case "top":
                    camera.up.set(0, 0, -1);
                    camera.position.set(t.x, t.y + radius, t.z);
                    break;
                case "bottom":
                    camera.up.set(0, 0, 1);
                    camera.position.set(t.x, t.y - radius, t.z);
                    break;
                default:
                    return;
            }

            // keep orbit radius in sync for a smooth handoff
            offset.copy(camera.position).sub(ctrl.target);
            tmp.spherical.setFromVector3(offset);
            s.current.radius = tmp.spherical.radius;
            s.current.radiusTarget = s.current.radius;

            camera.updateProjectionMatrix();
            ctrl.update();
        };

        if (typeof window !== "undefined") {
            window.addEventListener("EPIC3D_CAMERA_VIEW", handler);
        }
        return () => {
            if (typeof window !== "undefined") {
                window.removeEventListener("EPIC3D_CAMERA_VIEW", handler);
            }
        };
    }, [camera]);


    const lastTrackVelRef = useRef({
        trackId: null,
        timeMs: 0,
        pos: new THREE.Vector3(),
        target: new THREE.Vector3(),
        fov: 0,
        velPos: new THREE.Vector3(),
        velTarget: new THREE.Vector3(),
        velFov: 0,
        valid: false,
    });
    const turntableStateRef = useRef(new Map());
    const lastEscRef = useRef(0);

    // main loop: smooth zoom + smooth fly (dt-clamped), live speed adjust
    useFrame((_, rawDt) => {
        const ctrl = controlsRef.current;
        if (!ctrl) return;

        // avoid jumps when tab regains focus
        const dt = Math.min(Math.max(rawDt, 0), 1 / 255);

        const tmp = s.current.tmp;

        // 🔥 NEW: make right-mouse panning feel the same at any zoom level
        if (ctrl.target) {
            // current orbit radius (distance camera <-> target)
            tmp.offset.copy(camera.position).sub(ctrl.target);

            const z = CFG.current.zoom;
            const minR = z.min;   // 0.25
            const maxR = z.max;   // 500

            const radius = THREE.MathUtils.clamp(tmp.offset.length() || 1, minR, maxR);

            const baseRadius    = 155;    // radius where panSpeed ≈ 1 feels good
            const basePanSpeed  = 1.0;  // default Drei/OrbitControls panSpeed

            // We want world movement per pixel to stay roughly constant:
            // panSpeed ∝ baseRadius / currentRadius
            const factor = baseRadius / radius;

            // Allow very strong boost when you are very close,
            // but keep it sane so it doesn't teleport.
            ctrl.panSpeed = THREE.MathUtils.clamp(
                basePanSpeed * factor,
                0.25,   // don't go slower than this when far away
                100.0   // strong enough when fully zoomed in at 0.25 units
            );
        }

        // --- Camera tracks (cinematic moves triggered from actions) ---
        const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
        const tracks = (typeof window !== "undefined" && window.__EPIC3D_CAMERA_TRACKS) || [];
        let activeTrack = null;

        if (tracks.length) {
            // pick the first track that is currently active
            for (let i = 0; i < tracks.length; i++) {
                const t = tracks[i];
                const start = t.startMs || 0;
                const end = start + (t.durationMs || 0);
                if (nowMs >= start && nowMs <= end) {
                    activeTrack = t;
                    break;
                }
            }

            // notify completion for finished tracks
            const doneCb = (typeof window !== "undefined" && window.__EPIC3D_ON_CAMERA_TRACK_DONE) || null;
            if (doneCb) {
                tracks.forEach((t) => {
                    const start = t.startMs || 0;
                    const end = start + (t.durationMs || 0);
                    if (nowMs > end + 16) { // small grace
                        try { doneCb(t.id); } catch (e) { /* ignore */ }
                        cameraTrackStateRef.current.delete(t.id);
                    }
                });
            }
        }

        if (activeTrack) {
            let st = cameraTrackStateRef.current.get(activeTrack.id);
            const presets = (typeof window !== "undefined" && window.__EPIC3D_CAMERA_PRESETS) || [];
            const findPreset = (id) => presets && Array.isArray(presets) ? presets.find((p) => p.id === id) || null : null;

            if (!st) {
                const hasContinuousIn = activeTrack.continuousIn !== undefined;
                const hasContinuousOut = activeTrack.continuousOut !== undefined;
                const continuousIn = hasContinuousIn ? !!activeTrack.continuousIn : !!activeTrack.continuous;
                const continuousOut = hasContinuousOut ? !!activeTrack.continuousOut : !!activeTrack.continuous;
                const fromPreset = (!continuousIn && activeTrack.fromPresetId)
                    ? findPreset(activeTrack.fromPresetId)
                    : null;
                const toPreset = activeTrack.toPresetId ? findPreset(activeTrack.toPresetId) : null;
                if (!toPreset) return;

                const fromPos = fromPreset?.position
                    ? new THREE.Vector3(fromPreset.position[0], fromPreset.position[1], fromPreset.position[2])
                    : camera.position.clone();

                const fromTarget = fromPreset?.target && ctrl?.target
                    ? new THREE.Vector3(fromPreset.target[0], fromPreset.target[1], fromPreset.target[2])
                    : (ctrl?.target ? ctrl.target.clone() : new THREE.Vector3());

                const fromFov = typeof fromPreset?.fov === "number"
                    ? fromPreset.fov
                    : (camera.isPerspectiveCamera ? camera.fov : undefined);

                const toPosArr = toPreset.position || [6, 4.5, 6];
                const toTargetArr = toPreset.target || [0, 0, 0];
                const toFov = typeof toPreset.fov === "number" ? toPreset.fov : fromFov;

                const toPos = new THREE.Vector3(toPosArr[0], toPosArr[1], toPosArr[2]);
                const toTarget = new THREE.Vector3(toTargetArr[0], toTargetArr[1], toTargetArr[2]);
                const durationSec = Math.max(0.001, (activeTrack.durationMs || 1) / 1000);
                const speedPos = fromPos.distanceTo(toPos) / durationSec;
                const speedTarget = fromTarget.distanceTo(toTarget) / durationSec;
                const clampVel = (v, maxMag) => {
                    if (!Number.isFinite(maxMag) || maxMag <= 0) return v.set(0, 0, 0);
                    const mag = v.length();
                    if (mag > maxMag) v.setLength(maxMag);
                    return v;
                };
                const v0Pos = new THREE.Vector3();
                const v1Pos = new THREE.Vector3();
                const v0Target = new THREE.Vector3();
                const v1Target = new THREE.Vector3();
                let v0Fov = 0;
                let v1Fov = 0;
                const lastVel = lastTrackVelRef.current;
                if (continuousIn && lastVel.valid && Number.isFinite(lastVel.timeMs) && (nowMs - lastVel.timeMs) < 220) {
                    v0Pos.copy(lastVel.velPos || v0Pos);
                    v0Target.copy(lastVel.velTarget || v0Target);
                    if (Number.isFinite(lastVel.velFov)) v0Fov = lastVel.velFov;
                }
                clampVel(v0Pos, speedPos * 1.6);
                clampVel(v0Target, speedTarget * 1.6);
                if (continuousOut) {
                    let nextTrack = null;
                    for (let i = 0; i < tracks.length; i++) {
                        const t = tracks[i];
                        if (!t || t.id === activeTrack.id) continue;
                        if ((t.startMs || 0) > (activeTrack.startMs || 0)) {
                            if (!nextTrack || (t.startMs || 0) < (nextTrack.startMs || 0)) nextTrack = t;
                        }
                    }
                    if (nextTrack && nextTrack.toPresetId) {
                        const nextPreset = findPreset(nextTrack.toPresetId);
                        if (nextPreset?.position) {
                            const nextPos = new THREE.Vector3(nextPreset.position[0], nextPreset.position[1], nextPreset.position[2]);
                            const dir = nextPos.sub(toPos);
                            if (dir.lengthSq() > 1e-6) v1Pos.copy(dir.normalize().multiplyScalar(speedPos));
                        }
                        if (nextPreset?.target) {
                            const nextT = new THREE.Vector3(nextPreset.target[0], nextPreset.target[1], nextPreset.target[2]);
                            const dirT = nextT.sub(toTarget);
                            if (dirT.lengthSq() > 1e-6) v1Target.copy(dirT.normalize().multiplyScalar(speedTarget));
                        }
                        if (typeof nextPreset?.fov === "number" && typeof toFov === "number") {
                            v1Fov = (nextPreset.fov - toFov) / durationSec;
                        }
                    } else {
                        if (speedPos > 0) v1Pos.copy(toPos).sub(fromPos).normalize().multiplyScalar(speedPos);
                        if (speedTarget > 0) v1Target.copy(toTarget).sub(fromTarget).normalize().multiplyScalar(speedTarget);
                    }
                    clampVel(v1Pos, speedPos * 1.6);
                    clampVel(v1Target, speedTarget * 1.6);
                }

                st = {
                    fromPos,
                    fromTarget,
                    fromFov,
                    toPos,
                    toTarget,
                    toFov,
                    startMs: activeTrack.startMs || nowMs,
                    endMs: (activeTrack.startMs || nowMs) + (activeTrack.durationMs || 1),
                    v0Pos,
                    v1Pos,
                    v0Target,
                    v1Target,
                    v0Fov,
                    v1Fov,
                    tmp: {
                        a: new THREE.Vector3(),
                        b: new THREE.Vector3(),
                        c: new THREE.Vector3(),
                        d: new THREE.Vector3(),
                    },
                };
                cameraTrackStateRef.current.set(activeTrack.id, st);
            }

            const start = st.startMs;
            const end = st.endMs;
            const span = Math.max(1, end - start);
            const tNorm = THREE.MathUtils.clamp((nowMs - start) / span, 0, 1);
            const hasContinuousIn = activeTrack.continuousIn !== undefined;
            const hasContinuousOut = activeTrack.continuousOut !== undefined;
            const continuousIn = hasContinuousIn ? !!activeTrack.continuousIn : !!activeTrack.continuous;
            const continuousOut = hasContinuousOut ? !!activeTrack.continuousOut : !!activeTrack.continuous;
            const t2 = tNorm * tNorm;
            const t3 = t2 * tNorm;
            const h00 = 2 * t3 - 3 * t2 + 1;
            const h10 = t3 - 2 * t2 + tNorm;
            const h01 = -2 * t3 + 3 * t2;
            const h11 = t3 - t2;
            const durationSec = Math.max(0.001, span / 1000);
            const v0Pos = st.v0Pos || new THREE.Vector3();
            const v1Pos = st.v1Pos || new THREE.Vector3();
            const v0Target = st.v0Target || new THREE.Vector3();
            const v1Target = st.v1Target || new THREE.Vector3();
            const v0Fov = Number.isFinite(st.v0Fov) ? st.v0Fov : 0;
            const v1Fov = Number.isFinite(st.v1Fov) ? st.v1Fov : 0;
            const tmpA = st.tmp?.a;
            const tmpB = st.tmp?.b;
            const tmpC = st.tmp?.c;
            const tmpD = st.tmp?.d;
            if (tmpA && tmpB && tmpC && tmpD) {
                tmpA.copy(st.fromPos).multiplyScalar(h00);
                tmpB.copy(v0Pos).multiplyScalar(durationSec * h10);
                tmpC.copy(st.toPos).multiplyScalar(h01);
                tmpD.copy(v1Pos).multiplyScalar(durationSec * h11);
                camera.position.copy(tmpA.add(tmpB).add(tmpC).add(tmpD));
            } else {
                camera.position.set(
                    THREE.MathUtils.lerp(st.fromPos.x, st.toPos.x, tNorm),
                    THREE.MathUtils.lerp(st.fromPos.y, st.toPos.y, tNorm),
                    THREE.MathUtils.lerp(st.fromPos.z, st.toPos.z, tNorm)
                );
            }

            if (ctrl && ctrl.target) {
                if (tmpA && tmpB && tmpC && tmpD) {
                    tmpA.copy(st.fromTarget).multiplyScalar(h00);
                    tmpB.copy(v0Target).multiplyScalar(durationSec * h10);
                    tmpC.copy(st.toTarget).multiplyScalar(h01);
                    tmpD.copy(v1Target).multiplyScalar(durationSec * h11);
                    ctrl.target.copy(tmpA.add(tmpB).add(tmpC).add(tmpD));
                } else {
                    ctrl.target.set(
                        THREE.MathUtils.lerp(st.fromTarget.x, st.toTarget.x, tNorm),
                        THREE.MathUtils.lerp(st.fromTarget.y, st.toTarget.y, tNorm),
                        THREE.MathUtils.lerp(st.fromTarget.z, st.toTarget.z, tNorm)
                    );
                }
                ctrl.update();
            } else {
                camera.lookAt(st.toTarget.x, st.toTarget.y, st.toTarget.z);
            }

            if (camera.isPerspectiveCamera && typeof st.toFov === "number") {
                const fromFov = st.fromFov ?? camera.fov;
                const fov = h00 * fromFov + h10 * (v0Fov * durationSec) + h01 * st.toFov + h11 * (v1Fov * durationSec);
                camera.fov = Number.isFinite(fov) ? fov : THREE.MathUtils.lerp(fromFov, st.toFov, tNorm);
                camera.updateProjectionMatrix();
            }

            // keep orbit radius in sync for a smooth handoff after the move
            if (ctrl && ctrl.target) {
                tmp.offset.copy(camera.position).sub(ctrl.target);
                tmp.spherical.setFromVector3(tmp.offset);
                s.current.radius = tmp.spherical.radius;
                s.current.radiusTarget = s.current.radius;
            }

            {
                const velRef = lastTrackVelRef.current;
                if (velRef && Number.isFinite(velRef.timeMs)) {
                    const dtMs = nowMs - velRef.timeMs;
                    const dtSec = dtMs > 0 ? (dtMs / 1000) : 0;
                    if (dtSec > 0 && velRef.trackId === activeTrack.id) {
                        velRef.velPos.copy(camera.position).sub(velRef.pos).divideScalar(dtSec);
                        if (ctrl && ctrl.target) {
                            velRef.velTarget.copy(ctrl.target).sub(velRef.target).divideScalar(dtSec);
                        }
                        if (camera.isPerspectiveCamera) {
                            velRef.velFov = (camera.fov - (velRef.fov ?? camera.fov)) / dtSec;
                        }
                        velRef.valid = true;
                    }
                }
                if (ctrl && ctrl.target) {
                    velRef.pos.copy(camera.position);
                    velRef.target.copy(ctrl.target);
                } else {
                    velRef.pos.copy(camera.position);
                }
                velRef.fov = camera.isPerspectiveCamera ? camera.fov : 0;
                velRef.timeMs = nowMs;
                velRef.trackId = activeTrack.id;
            }

            return; // skip manual zoom/fly while a track is active
        }
        // --- Camera turntable orbit (actions) ---
        const turntables = (typeof window !== "undefined" && window.__EPIC3D_CAMERA_TURNTABLES) || [];
        if (turntables.length) {
            const activeIds = new Set(turntables.map((t) => t?.id));
            for (const id of turntableStateRef.current.keys()) {
                if (!activeIds.has(id)) turntableStateRef.current.delete(id);
            }
        } else if (turntableStateRef.current.size) {
            turntableStateRef.current.clear();
        }

        let activeTurntable = null;
        if (turntables.length) {
            for (let i = turntables.length - 1; i >= 0; i--) {
                const t = turntables[i];
                const start = t?.startMs || 0;
                if (nowMs >= start) {
                    activeTurntable = t;
                    break;
                }
            }
        }

        if (activeTurntable) {
            const centerNodeId = activeTurntable.centerNodeId || activeTurntable.nodeId || null;
            const centerNode = centerNodeId ? nodeMap?.[centerNodeId] : null;
            const centerPos = centerNode?.position || null;
            if (Array.isArray(centerPos)) {
                const cx = centerPos[0] || 0;
                const cy = centerPos[1] || 0;
                const cz = centerPos[2] || 0;
                const camX = camera.position.x;
                const camY = camera.position.y;
                const camZ = camera.position.z;
                const centerVec = new THREE.Vector3(cx, cy, cz);

                let radius = Number(activeTurntable.orbitDistance ?? 0);
                if (!Number.isFinite(radius) || radius <= 0) {
                    const dx0 = camX - cx;
                    const dy0 = camY - cy;
                    const dz0 = camZ - cz;
                    radius = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0);
                }
                if (radius > 0) {
                    const tol = Math.max(0.05, radius * 0.01);
                    const tolSq = tol * tol;
                    const requireMatch = (activeTurntable.requireMatch ?? true) !== false;
                    const startPresetId = activeTurntable.startPresetId || null;

                    let st = turntableStateRef.current.get(activeTurntable.id);
                    if (!st) {
                        let canStart = true;
                        if (requireMatch) {
                            if (startPresetId) {
                                const presets = (typeof window !== "undefined" && window.__EPIC3D_CAMERA_PRESETS) || [];
                                const preset = Array.isArray(presets)
                                    ? presets.find((p) => p?.id === startPresetId) || null
                                    : null;
                                const pPos = preset?.position;
                                if (!Array.isArray(pPos)) {
                                    canStart = false;
                                } else {
                                    const dx = camX - (pPos[0] || 0);
                                    const dy = camY - (pPos[1] || 0);
                                    const dz = camZ - (pPos[2] || 0);
                                    if ((dx * dx + dy * dy + dz * dz) > tolSq) canStart = false;
                                }
                                if (canStart && ctrl?.target && Array.isArray(preset?.target)) {
                                    const tPos = preset.target;
                                    const tx = (ctrl.target.x ?? 0) - (tPos[0] || 0);
                                    const ty = (ctrl.target.y ?? 0) - (tPos[1] || 0);
                                    const tz = (ctrl.target.z ?? 0) - (tPos[2] || 0);
                                    if ((tx * tx + ty * ty + tz * tz) > tolSq) canStart = false;
                                }
                            } else {
                                const dx = camX - cx;
                                const dy = camY - cy;
                                const dz = camZ - cz;
                                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                                if (Math.abs(dist - radius) > tol) canStart = false;
                            }
                        }

                        if (canStart) {
                            const angle0 = Math.atan2(camZ - cz, camX - cx);
                            st = {
                                startMs: nowMs,
                                angle: angle0,
                                phase: 0,
                                baseY: camY,
                                radius,
                                target: (ctrl?.target ? ctrl.target.clone() : centerVec.clone()),
                            };
                            turntableStateRef.current.set(activeTurntable.id, st);
                        }
                    }

                    if (st) {
                        const speedDeg = Number(activeTurntable.orbitSpeed ?? 0) || 0;
                        const speedRad = THREE.MathUtils.degToRad(Math.abs(speedDeg));
                        const dirRaw = String(activeTurntable.orbitDirection || "left").toLowerCase();
                        const dirSign = dirRaw === "right" ? -1 : 1;
                        if (speedRad > 0) {
                            st.angle = (st.angle ?? 0) + dirSign * speedRad * dt;
                            st.phase = (st.phase ?? 0) + speedRad * dt;
                        }
                        const angle = st.angle ?? 0;

                        let y = st.baseY;
                        if (activeTurntable.orbitVertical) {
                            const range = Math.max(0, Number(activeTurntable.orbitVerticalRange ?? 0) || 0);
                            if (range > 0) {
                                y = st.baseY + Math.sin(st.phase ?? 0) * range;
                            }
                        }

                        camera.position.set(
                            cx + Math.cos(angle) * st.radius,
                            y,
                            cz + Math.sin(angle) * st.radius
                        );

                        const lookLerp = 1 - Math.exp(-8 * dt);
                        if (st.target) {
                            st.target.lerp(centerVec, lookLerp);
                        }
                        if (ctrl && ctrl.target) {
                            ctrl.target.copy(st.target || centerVec);
                            ctrl.update();
                        } else {
                            const t = st.target || centerVec;
                            camera.lookAt(t.x, t.y, t.z);
                        }

                        if (ctrl && ctrl.target) {
                            tmp.offset.copy(camera.position).sub(ctrl.target);
                            tmp.spherical.setFromVector3(tmp.offset);
                            s.current.radius = tmp.spherical.radius;
                            s.current.radiusTarget = s.current.radius;
                        }

                        return; // skip manual zoom/fly while turntable is active
                    }
                }
            }
        }
        if (roomOperatorMoveRef.current) {
            const mov = roomOperatorMoveRef.current;
            const nowMs2 = (typeof performance !== "undefined" ? performance.now() : Date.now());
            const start = mov.startMs;
            const end = mov.endMs;
            const span = Math.max(1, end - start);
            const tNorm = THREE.MathUtils.clamp((nowMs2 - start) / span, 0, 1);
            const tSmooth = tNorm * tNorm * (3 - 2 * tNorm); // smoothstep

            camera.position.set(
                THREE.MathUtils.lerp(mov.fromPos.x, mov.toPos.x, tSmooth),
                THREE.MathUtils.lerp(mov.fromPos.y, mov.toPos.y, tSmooth),
                THREE.MathUtils.lerp(mov.fromPos.z, mov.toPos.z, tSmooth)
            );

            if (ctrl && ctrl.target) {
                ctrl.target.set(
                    THREE.MathUtils.lerp(mov.fromTarget.x, mov.toTarget.x, tSmooth),
                    THREE.MathUtils.lerp(mov.fromTarget.y, mov.toTarget.y, tSmooth),
                    THREE.MathUtils.lerp(mov.fromTarget.z, mov.toTarget.z, tSmooth)
                );
                ctrl.update();
            } else {
                camera.lookAt(mov.toTarget.x, mov.toTarget.y, mov.toTarget.z);
            }

            // keep orbit radius in sync
            if (ctrl && ctrl.target) {
                tmp.offset.copy(camera.position).sub(ctrl.target);
                tmp.spherical.setFromVector3(tmp.offset);
                s.current.radius = tmp.spherical.radius;
                s.current.radiusTarget = s.current.radius;
            }

            if (nowMs2 >= end) {
                roomOperatorMoveRef.current = null; // tween done
            }
        }

        // --- Smooth Zoom (velocity-based, like free-roam) ---
        {
            const z = CFG.current.zoom;
            const v0 = s.current.zoomVel || 0;

            if (Math.abs(v0) > 1e-4) {
                // Damp velocity toward 0 (friction)
                const v = dampScalar(v0, 0, z.velLambda, dt);
                s.current.zoomVel = v;

                const dist = v * dt;
                if (Math.abs(dist) > 1e-6) {
                    // Move along view direction on ground plane
                    camera.getWorldDirection(tmp.dir);
                    tmp.dir.y = 0;
                    tmp.dir.normalize();

                    tmp.move.copy(tmp.dir).multiplyScalar(dist);
                    camera.position.add(tmp.move);
                    if (ctrl.target) {
                        ctrl.target.add(tmp.move);
                    }
                    ctrl.update();
                }
            } else {
                s.current.zoomVel = 0;
            }
        }



        // --- Fly speed smoothing (speed target is adjusted by +/- key presses) ---
        {
            const f = CFG.current.fly;
            let target = s.current.flySpeedTarget ?? f.baseSpeed;
            target = THREE.MathUtils.clamp(target, f.speedMin, f.speedMax);
            s.current.flySpeedTarget = target;
            s.current.flySpeed = dampScalar(s.current.flySpeed ?? target, target, f.speedSmooth, dt);
        }

        // --- Smooth Fly (WASD + QE with damping) ---
        const controlsEnabled = !placement?.armed && !dragState?.active && !isTyping();
        if (controlsEnabled) {
            const f = CFG.current.fly;
            const shift = keys.current.has("ShiftLeft") || keys.current.has("ShiftRight");
            const base = s.current.flySpeed ?? f.baseSpeed;
            const speed = base * (shift ? f.sprintMult : 1);

            camera.getWorldDirection(tmp.dir);
            tmp.dir.y = 0; tmp.dir.normalize();
// Right-handed: right = forward × up
            tmp.right.copy(tmp.dir).cross(tmp.up).normalize();


            tmp.move.set(0, 0, 0);
            if (keys.current.has("KeyW")) tmp.move.add(tmp.dir);
            if (keys.current.has("KeyS")) tmp.move.addScaledVector(tmp.dir, -1);
            if (keys.current.has("KeyA")) tmp.move.addScaledVector(tmp.right, -1);
            if (keys.current.has("KeyD")) tmp.move.add(tmp.right);
            if (keys.current.has("KeyQ")) tmp.move.addScaledVector(tmp.up, -f.verticalMult);
            if (keys.current.has("KeyE")) tmp.move.addScaledVector(tmp.up,  f.verticalMult);

            if (tmp.move.lengthSq() > 0) tmp.move.normalize().multiplyScalar(speed);

            dampVec(s.current.vel, tmp.move, f.lambda, dt);

            if (s.current.vel.lengthSq() > 1e-10) {
                const step = s.current.vel.clone().multiplyScalar(dt);
                camera.position.add(step);
                ctrl.target.add(step);
                ctrl.update();
            }
        } else {
            // bleed off velocity when disabled
            dampVec(s.current.vel, new THREE.Vector3(), CFG.current.fly.lambda, dt);
        }

        {
            const last = lastCamRef.current;
            if (last) {
                const camPos = camera.position;
                const tgt = ctrl?.target;
                const eps = 1e-6;
                let moved = false;
                if (!last.valid) {
                    last.pos.copy(camPos);
                    if (tgt) last.target.copy(tgt);
                    last.valid = true;
                } else {
                    if (camPos.distanceToSquared(last.pos) > eps) moved = true;
                    if (tgt && tgt.distanceToSquared(last.target) > eps) moved = true;
                    if (moved) {
                        last.pos.copy(camPos);
                        if (tgt) last.target.copy(tgt);
                    }
                }
            }
        }
    });

    // gizmo dragging guard
    // when hiding model, clear ref so it doesn't raycast
    useEffect(() => {
        if (!showModel && modelRef) modelRef.current = null;
    }, [showModel, modelRef]);

    const stop = (e) => {
        e?.stopPropagation?.();
        if (missGuardRef) missGuardRef.current = performance.now();
    };
// put these just above your <TransformControls> JSX:
    const anchorExclusive = !!(selectedFlowAnchorForRender || selectedBreakpoint);
    const tSnap =
        !anchorExclusive &&
        transformMode === "translate" && (placement?.snap ?? 0) > 0
            ? (placement?.snap ?? 0)    // meters (world units)
            : undefined;

    const rSnap =
        !anchorExclusive &&
        transformMode === "rotate" && (placement?.snap ?? 0) > 0
            ? THREE.MathUtils.degToRad(placement?.snap ?? 0) // degrees -> radians
            : undefined;

    const sSnap =
        !anchorExclusive &&
        transformMode === "scale" && (placement?.snap ?? 0) > 0
            ? (placement?.snap ?? 0)    // unit steps
            : undefined;
// ----- Multi-move support -----
    // NOTE: Multi-move is driven via a virtual pivot (the selection centroid).
    // The parent component already contains a stabilizer that snapshots all selected
    // positions and applies a single delta. We delegate to it by emitting a single
    // transform event for a "pivot" target (instead of per-entity incremental deltas).
    const multiRef = useRef(new THREE.Object3D());
    const roomScaleRef = useRef(new THREE.Object3D());
    const lastPos = useRef(new THREE.Vector3());

// Use refs so the "don't-sync pivot while dragging" guard flips immediately.
// (React state can lag a frame, which is enough to cause huge deltas.)
    const tcDraggingRef = useRef(false);

    // Keep latest selection/mode for TransformControls drag start/end hooks without re-registering listeners.
    const tcDragCtxRef = useRef(null);

    // NOTE: the "dragging-changed" listener must be attached *after* TransformControls mounts.
    // TransformControls is conditional; if we attach the listener while tcRef.current is null,
    // the effect won't re-run, and our pack snapshots (scale/translate) never get taken.

    // Align room-scale proxy to the selected room (so scaling happens in room-local axes)
    useEffect(() => {
        const o = roomScaleRef.current;
        if (!o) return;

        if (selectedRoom && transformMode === "scale" && !selectedRoom.locked) {
            const c = selectedRoom.center || [0, 0, 0];
            const rot = selectedRoom.rotation || [0, 0, 0];

            o.position.set(c[0] || 0, c[1] || 0, c[2] || 0);
            o.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);

            // Proxy scale is managed by TransformControls; we reset it on drag start/end.
            o.updateMatrixWorld();
        }
    }, [selectedRoom?.id, selectedRoom?.center, selectedRoom?.rotation, selectedRoom?.locked, transformMode]);


// Stable multi-drag snapshot (baseline pivot + start positions for each selected entity)
    const multiDragRef = useRef({
        active: false,
        baseline: new THREE.Vector3(),
        starts: new Map(), // key -> [x,y,z]
    });

    const bpRef = useRef(new THREE.Object3D());
    const bpMetaRef = useRef(null); // { linkId, index }
    const flowAnchorRef = useRef(new THREE.Object3D());
    const flowAnchorMetaRef = useRef(null); // { nodeId, setId, index }
    const tcWarmRef = useRef(new THREE.Object3D());
    useEffect(() => {
        if (tcWarmRef.current) tcWarmRef.current.position.set(0, -9999, 0);
    }, []);
    useEffect(() => {
        if (!selectedBreakpoint) {
            bpMetaRef.current = null;
            return;
        }
        const { linkId, index } = selectedBreakpoint;
        const link = links.find(l => l.id === linkId);
        const bp = link?.breakpoints?.[index];
        if (!link || !Array.isArray(link.breakpoints) || !bp) {
            bpMetaRef.current = null;
            return;
        }
        bpRef.current.position.set(bp[0], bp[1], bp[2]);
        bpMetaRef.current = { linkId, index };
    }, [selectedBreakpoint?.linkId, selectedBreakpoint?.index, links]);
    useEffect(() => {
        if (!selectedFlowAnchorForRender) {
            flowAnchorMetaRef.current = null;
            return;
        }
        const node = nodes.find((n) => n.id === selectedFlowAnchorForRender.nodeId);
        const anchorSet = __findFlowAnchorSet(node, selectedFlowAnchorForRender.setId, true);
        const anchor = anchorSet?.anchors?.[selectedFlowAnchorForRender.index];
        const pos = Array.isArray(anchor?.pos) ? anchor.pos : null;
        if (!node || !Array.isArray(pos)) {
            flowAnchorMetaRef.current = null;
            return;
        }
        const base = node.position || [0, 0, 0];
        flowAnchorRef.current.position.set(
            (base[0] || 0) + (pos[0] || 0),
            (base[1] || 0) + (pos[1] || 0),
            (base[2] || 0) + (pos[2] || 0),
        );
        flowAnchorMetaRef.current = {
            nodeId: selectedFlowAnchorForRender.nodeId,
            setId: anchorSet?.id || selectedFlowAnchorForRender.setId,
            index: selectedFlowAnchorForRender.index,
        };
    }, [selectedFlowAnchorForRender?.nodeId, selectedFlowAnchorForRender?.setId, selectedFlowAnchorForRender?.index, nodes]);
    const UP = new THREE.Vector3(0, 1, 0);
    const __v0 = new THREE.Vector3();
    const __v1 = new THREE.Vector3();
    const __v2 = new THREE.Vector3();
    function NodeSelectionPulse({ position }) {
        const groupRef = React.useRef();
        const ringARef = React.useRef();
        const ringBRef = React.useRef();
        const tRef = React.useRef(0);

        useFrame((_, delta) => {
            if (!groupRef.current) return;

            // Slow-ish, smooth pulse
            tRef.current += delta * 0.75;
            const t = tRef.current;

            const updateRing = (ref, offset) => {
                if (!ref.current) return;
                const phase = (t + offset) % 1;

                // scale: 1 → 1.7
                const s = 1 + phase * 0.7;
                // opacity: 0.7 → 0
                const o = 0.7 * (1 - phase);

                ref.current.scale.set(s, s, s);
                if (ref.current.material) {
                    ref.current.material.opacity = o;
                }
            };

            updateRing(ringARef, 0.0);  // first wave
            updateRing(ringBRef, 0.5);  // second wave, offset in time
        });

        if (!position) return null;

        return (
            <group
                ref={groupRef}
                position={[
                    position[0],
                    (position[1] || 0) + 0.03, // sits just above the floor / platform
                    position[2],
                ]}
                rotation={[-Math.PI / 2, 0, 0]}
                renderOrder={9998}
            >
                {/* inner pulse */}
                <mesh ref={ringARef}>
                    <ringGeometry args={[0.55, 0.75, 48]} />
                    <meshBasicMaterial
                        color="#38bdf8"
                        transparent
                        opacity={0.7}
                        depthWrite={false}
                    />
                </mesh>

                {/* outer pulse */}
                <mesh ref={ringBRef}>
                    <ringGeometry args={[0.55, 0.75, 48]} />
                    <meshBasicMaterial
                        color="#38bdf8"
                        transparent
                        opacity={0.7}
                        depthWrite={false}
                    />
                </mesh>
        </group>
    );

    }

    function computeCableOffsetsForLink(link, start, end) {
        const cable = link?.cable || {};
        const count = Math.max(1, Math.min(32, Math.round(cable.count ?? 4)));
        const spread = cable.spread ?? 0.12;
        const rough = cable.roughness ?? 0.25;

        if (count <= 0) return [];

        const dir = __v0.set(
            end[0] - start[0],
            end[1] - start[1],
            end[2] - start[2]
        );
        if (dir.lengthSq() === 0) return [[0, 0, 0]];
        dir.normalize();

        const side = __v1.copy(dir).cross(UP);
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        side.normalize();

        const up = __v2.copy(dir).cross(side).normalize();

        const offsets = [];
        // core in the middle
        offsets.push([0, 0, 0]);

        const outer = Math.max(0, count - 1);
        for (let i = 0; i < outer; i++) {
            const t = outer <= 1 ? 0 : i / outer;
            let angle = t * Math.PI * 2;

            if (rough > 0) {
                const jitter = (Math.sin((i + 1) * 31.7) * 43758.5453) % 1 - 0.5;
                angle += jitter * 0.8 * rough;
            }

            let radius = spread;
            if (rough > 0) {
                const rj = (Math.sin((100 + i) * 17.3) * 12345.6789) % 1 - 0.5;
                radius *= 1 + rj * 0.6 * rough;
            }

            const c = Math.cos(angle);
            const s = Math.sin(angle);

            const ox = side.x * c * radius + up.x * s * radius;
            const oy = side.y * c * radius + up.y * s * radius;
            const oz = side.z * c * radius + up.z * s * radius;

            offsets.push([ox, oy, oz]);
        }

        return offsets;
    }

    const multiPositions = useMemo(() => {
        return (uniqueSelectedMulti || [])
            .map((it) => {
                if (it.type === "node") {
                    const n = nodeMap[it.id];
                    return n?.position ? new THREE.Vector3(...n.position) : null;
                }
                if (it.type === "room") {
                    const r = rooms.find((x) => x.id === it.id);
                    if (!r || r.locked) return null;
                    return r.center ? new THREE.Vector3(...r.center) : null;
                }
                return null;
            })
            .filter(Boolean);
    }, [uniqueSelectedMulti, nodeMap, rooms]);


    const multiCentroid = useMemo(() => {
        const pos = multiPivotOverride?.pos;
        if (Array.isArray(pos) && pos.length >= 3 && [pos[0], pos[1], pos[2]].every(Number.isFinite)) {
            return new THREE.Vector3(pos[0], pos[1], pos[2]);
        }

        if (!multiPositions.length) return null;
        const s = new THREE.Vector3();
        multiPositions.forEach((v) => s.add(v));
        s.multiplyScalar(1 / multiPositions.length);
        return s;
    }, [
        multiPositions,
        multiPivotOverride?.pos?.[0],
        multiPivotOverride?.pos?.[1],
        multiPivotOverride?.pos?.[2],
    ]);



    // Refresh drag context each render (used by TransformControls 'dragging-changed')
    tcDragCtxRef.current = {
        transformMode,
        selectedRoom,
        uniqueSelectedMulti,
        multiCentroid,
        onRoomDragPack,
        onRoomScalePack,
        onEntityTransform,
        onEntityRotate,
    };

    useLayoutEffect(() => {
        if (!multiCentroid) return;

        // IMPORTANT: do NOT fight TransformControls while dragging.
        if (tcDraggingRef.current || dragState?.active) return;

        // Never write non-finite values into the pivot.
        if (![multiCentroid.x, multiCentroid.y, multiCentroid.z].every(Number.isFinite)) return;

        multiRef.current.position.copy(multiCentroid);
        multiRef.current.rotation.set(0, 0, 0);

        lastPos.current.copy(multiCentroid);
    }, [multiCentroid?.x, multiCentroid?.y, multiCentroid?.z, dragState?.active]);



    // pick target for TransformControls
    // pick target for TransformControls
    const tcTarget = useMemo(() => {
        // In Room Operator we never want the gizmo
        if (roomOperatorMode) return null;

        // If move mode is off, no gizmo either
        if (!moveMode) return null;

        // ----- Multi-selection -----
        const multiCount = uniqueSelectedMulti?.length || 0;
        if (multiCount > 1) {
            // Only attach the gizmo if at least one selected item is movable
            const hasMovable = (selectedMultiForRender || []).some((it) => {
                if (!it) return false;
                if (it.type === "node") return true;
                if (it.type === "room") {
                    const r = rooms.find((x) => x.id === it.id);
                    return r && !r.locked;
                }
                return false;
            });

            return hasMovable ? multiRef.current : null;
        }

        // ----- Single flow anchor -----
        if (selectedFlowAnchorForRender) {
            return flowAnchorRef.current;
        }

        // ----- Single breakpoint -----
        if (selectedBreakpoint) {
            return bpRef.current;
        }

        // ----- Single node -----
        if (selectedNode?.id) {
            return nodeRefs.current[selectedNode.id]?.current || null;
        }

        // ----- Single room (only if not locked) -----
        if (selectedRoom?.id && !selectedRoom.locked) {
            if (transformMode === "scale") return roomScaleRef.current;
            return roomRefs.current[selectedRoom.id]?.current || null;
        }

        // ----- Single picture (gizmo translate) -----
        if (selectedPictureId) {
            return pictureTarget;
        }
        // ----- Model (gizmo translate) -----
        if (selectedForRender?.type === "model" && showModel) {
            return modelRef?.current || null;
        }

        return null;
    }, [
        roomOperatorMode,
        moveMode,
        transformMode,
        selectedMultiForRender,
        selectedFlowAnchorForRender?.nodeId,
        selectedFlowAnchorForRender?.setId,
        selectedFlowAnchorForRender?.index,
        selectedBreakpoint?.linkId,
        selectedBreakpoint?.index,
        selectedNode?.id,
        selectedRoom?.id,
        selectedPictureId,
        selectedForRender?.type,
        modelRef,
        rooms,
        pictureRefs,
        pictureTarget,
    ]);

    // Attach TransformControls dragging hooks *after* it mounts.
    // (TransformControls is conditional; if tcRef.current is null when an effect runs,
    //  we must re-run once the control exists, otherwise pack snapshots never happen.)
    const tcEnabled = !!(moveMode && !roomOperatorMode && tcTarget);
    const tcActive = !!(moveMode && !roomOperatorMode && tcTarget);
    useEffect(() => {
        if (!tcEnabled) return;

        const tc = tcRef.current;
        if (!tc) return;

        const onDrag = (e) => {
            const dragging = !!e?.value;

            // Always mirror the drag flag for the parent (used to disable raycasting).
            dragState?.set?.(dragging);

            // Run our own start/end hooks if the component props aren't firing.
            const ctx = tcDragCtxRef.current || {};
            const o = tcRef.current?.object;

            if (dragging && !tcDraggingRef.current) {
                tcDraggingRef.current = true;

                // Single-room translate: snapshot room + its contents so children move together
                if (ctx.transformMode === "translate" && ctx.selectedRoom && !ctx.selectedRoom.locked) {
                    const rr = roomRefs.current?.[ctx.selectedRoom.id]?.current || null;
                    if (o && rr && o === rr) ctx.onRoomDragPack?.(ctx.selectedRoom);
                }

                // Single-room scale: snapshot room + contents baseline
                if (ctx.transformMode === "scale" && ctx.selectedRoom && !ctx.selectedRoom.locked) {
                    if (o && o === roomScaleRef.current) {
                        o.scale.set(1, 1, 1);
                        o.updateMatrixWorld();
                        ctx.onRoomScalePack?.(ctx.selectedRoom.id);
                    }
                }

                // Multi-move pivot init (prevents first-delta "jump")
                const multiCount = ctx.uniqueSelectedMulti?.length || 0;
                if (o && o === multiRef.current && multiCount > 1) {
                    const mc = ctx.multiCentroid;
                    if (mc && Number.isFinite(mc.x) && Number.isFinite(mc.y) && Number.isFinite(mc.z)) {
                        o.position.copy(mc);
                    }
                    lastPos.current.copy(o.position);

                    ctx.onEntityTransform?.({ type: "pivot", id: "__pivot__" }, [o.position.x, o.position.y, o.position.z]);
                    if (ctx.transformMode === "rotate") {
                        ctx.onEntityRotate?.({ type: "pivot", id: "__pivot__" }, [o.rotation.x, o.rotation.y, o.rotation.z]);
                    }
                }
            } else if (!dragging && tcDraggingRef.current) {
                tcDraggingRef.current = false;
                multiDragRef.current.active = false;

                // Reset room-scale proxy so the next drag starts from identity
                if (roomScaleRef.current) {
                    roomScaleRef.current.scale.set(1, 1, 1);
                    roomScaleRef.current.updateMatrixWorld();
                }
            }

            if (missGuardRef) missGuardRef.current = performance.now();
        };

        tc.addEventListener("dragging-changed", onDrag);
        return () => {
            tc.removeEventListener("dragging-changed", onDrag);
        };
    }, [tcEnabled, dragState, missGuardRef]);

    const sunShadowMapSize = useMemo(() => {
        return perf === "low" ? 1024 : perf === "med" ? 1536 : 2048;
    }, [perf]);



    return (
        <>
            {/*
              Hidden scene anchors used by TransformControls.
              These MUST be part of the scene graph so their matrixWorld stays valid;
              otherwise TransformControls can output NaN / huge jumps for "virtual" objects
              (which looks like selections flying away or resetting to the center).
            */}
            <primitive object={multiRef.current} visible={false} />
            <primitive object={bpRef.current} visible={false} />
            <primitive object={flowAnchorRef.current} visible={false} />
            <primitive object={tcWarmRef.current} visible={false} />
            <primitive object={roomScaleRef.current} visible={false} />

            {/* Global lighting */}
            {showLights ? (
                <>
                    {safeLighting.envPreset !== "none" && safeLighting.envIntensity > 0 && !envFailed && (
                        <EnvErrorBoundary onError={(err) => {
                            console.warn("[SceneInner] Environment load failed; disabling env", err);
                            setEnvFailed(true);
                        }}>
                            <Environment
                                preset={safeLighting.envPreset}
                                intensity={safeLighting.envIntensity}
                            />
                        </EnvErrorBoundary>
                    )}

                    <hemisphereLight
                        intensity={safeLighting.hemiIntensity}
                        color={"#ffffff"}
                        groundColor={"#1b2a44"}
                    />

                    <directionalLight
                        position={[safeLighting.sunPosX, safeLighting.sunPosY, safeLighting.sunPosZ]}
                        intensity={safeLighting.sunIntensity}
                        castShadow={enableShadows}
                        shadow-mapSize={[sunShadowMapSize, sunShadowMapSize]}
                        shadow-camera-near={0.5}
                        shadow-camera-far={60}
                        shadow-camera-left={-30}
                        shadow-camera-right={30}
                        shadow-camera-top={30}
                        shadow-camera-bottom={-30}
                        shadow-bias={-0.0002}
                        shadow-normalBias={0.02}
                    />

                    <directionalLight
                        position={[safeLighting.fillPosX, safeLighting.fillPosY, safeLighting.fillPosZ]}
                        intensity={safeLighting.fillIntensity}
                        castShadow={false}
                    />

                    <ambientLight intensity={safeLighting.ambientIntensity} />
                </>
            ) : (
                <ambientLight intensity={0.4} />
            )}

            {/* Model */}
            {showModel && modelDescriptor && (
                <group
                    ref={modelRef}
                    scale={(Array.isArray(modelScaleVec) && modelScaleVec.length >= 3)
                        ? modelScaleVec
                        : [modelScale, modelScale, modelScale]}
                    position={safeModelPosition}
                >
                    <ImportedModel
                        descriptor={modelDescriptor}
                        wireframe={wireframe}
                        wireOpacity={wireOpacity}
                        wireDetail={wireDetail}
                        wireEdgeAngle={wireEdgeAngle}
                        enableShadows={!!shadowsOn}
                        wireHideSurfaces={wireframe && wireHideSurfaces}
                        wireStroke={mergedWireStroke}
                        perf={perf}
                        shadingMode="leanPBR"
                        onScene={(scene) => {
                            modelSceneRef.current = scene;
                            // Enable dissolver masking on imported model materials (surfaces + wireframe).
                            __patchModelSceneForDissolve(scene);
                            if (typeof onModelScene === "function") onModelScene(scene);
                        }}
                    />
                </group>
            )}



            {/* Rooms */}
                {rooms.map((r) => {
                    const roomDeckId = r?.deckId != null ? String(r.deckId) : "";
                    const roomHidden =
                        hiddenRooms.has(r.id) ||
                        (roomDeckId && hiddenDeck.has(roomDeckId));
                    const { fadeTarget: roomFadeTarget } = getRoomFadeInfo(r);
                    const roomFadeAlpha = roomFadeAlphaByIdRef.current.get(String(r.id));
                    const keepHiddenRoomForFadeOut =
                        roomHidden &&
                        roomFadeTarget <= 0.001 &&
                        roomFadeAlpha != null &&
                        roomFadeAlpha > 0.001;
                    if (roomHidden && !keepHiddenRoomForFadeOut) return null;
                    roomRefs.current[r.id] ||= React.createRef();
                    const allowRoomSelect = allowSelect && (!tilePickActive || roomPickActive);
                    return (
                        <RoomBox
                            ref={roomRefs.current[r.id]}
                            key={r.id}
                            room={r}
                            dragging={dragState.active}
                            selected={(selectedForRender?.type === "room" && selectedForRender.id === r.id) || selectedMultiSet.has(`room:${r.id}`)}
                            onPointerDown={allowRoomSelect ? handleRoomPointerDown : null}
                            onTrySelectNode={trySelectNodeFromEvent}

                            dragging={!!dragState?.active}
                            opacity={roomOpacity}
                            fadeAlphaMapRef={roomFadeAlphaByIdRef}
                            wireframeGlobal={wireframe}
                            labelsOn={labelsOn}
                        labelMode={labelMode}
                        labelSize={labelSize}
                        labelMaxWidth={labelMaxWidth}
                        label3DLayers={label3DLayers}
                        label3DStep={label3DStep}
                        showRoomTiles={showRoomTiles}
                        roomTileSize={roomTileCountSafe}
                        tilePickActive={tilePickActive}
                        tilePickRoomId={tilePickRoomId}
                        roomPickActive={roomPickActive}
                        roomOperatorMode={roomOperatorMode}
                        onRoomAnchorClick={(roomId, dir) => {
                            console.log("[SceneInner] onRoomAnchorClick", { roomId, dir, hasParent: !!onRoomAnchorClick });
                            if (onRoomAnchorClick) onRoomAnchorClick(roomId, dir);
                        }}
                        onRoomDelete={onRoomDelete}
                        onRoomResize={onRoomResize}

                    />
                );
            })}

            {/* Nodes */}
            {instancedCandidates.length > 0 && (
                <InstancedNodes items={instancedCandidates} highNodeCount={instancedHighCount} />
            )}
            {nodesForRender.map((n) => {
                const roomId = n?.roomId != null ? String(n.roomId) : "";
                const deckId = n?.deckId != null ? String(n.deckId) : (roomId ? (roomDeckById.get(roomId) || "") : "");
                const nodeHidden =
                    (deckId && hiddenDeck.has(deckId)) ||
                    (roomId && hiddenRooms.has(roomId));
                const { fadeTarget, fadeInDuration, fadeOutDuration } = getNodeFadeInfo(n);
                const externalFadeAlpha = fadeAlphaByIdRef.current.get(String(n.id));
                const keepHiddenNodeForFadeOut =
                    nodeHidden &&
                    fadeTarget <= 0.001 &&
                    externalFadeAlpha != null &&
                    externalFadeAlpha > 0.001;
                if (nodeHidden && !keepHiddenNodeForFadeOut) return null;
                if (instancedNodeIdSet.has(String(n.id))) return null;
                const baseSelectedNode = (selectedForRender?.type === "node" && selectedForRender.id === n.id) || selectedMultiSet.has(`node:${n.id}`);
                const isSelectedNode = linkMode ? false : baseSelectedNode;
                const isLinkHover = !!(linkMode && linkHoverId && String(linkHoverId) === String(n.id) && (!linkFromId || String(linkFromId) !== String(n.id)));
                const isRackHover = rackHoverId && String(rackHoverId) === String(n.id);
                const isFading = externalFadeAlpha != null && externalFadeAlpha > 0.001 && externalFadeAlpha < 0.999;
                const allowPointer = !isFading && !tilePickActive && !roomPickActive;
                const labelsAllowed = labelsOnEffective && (!isFading || isSelectedNode);
                nodeRefs.current[n.id] ||= React.createRef();
                return (
                    <Node3D
                        ref={nodeRefs.current[n.id]}
                        key={n.id}
                        node={n}
                        fadeTarget={fadeTarget}
                        fadeAlphaMapRef={fadeAlphaByIdRef}
                        fadeInDuration={fadeInDuration}
                        fadeOutDuration={fadeOutDuration}

                        selected={isSelectedNode}
                        linkHover={isLinkHover || isRackHover}
                        masterSelected={!!(masterNodeId && String(masterNodeId) === String(n.id))}
                        masterSelectedAlt={!!(masterNodeId && masterIsAlternate && String(masterNodeId) === String(n.id))}
                        selectedFlowAnchor={selectedFlowAnchorForRender}
                        onPointerDown={(allowSelect && allowPointer) ? handleNodePointerDown : null}
                        onPointerOver={(linkMode && !tilePickActive) ? ((e) => {
                            e.stopPropagation();
                            if (!allowPointer) return;
                            if (linkFromId && String(linkFromId) === String(n.id)) return;
                            setLinkHoverId?.(n.id);
                        }) : null}
                        onPointerOut={(linkMode && !tilePickActive) ? ((e) => {
                            e.stopPropagation();
                            if (linkHoverId && String(linkHoverId) === String(n.id)) {
                                setLinkHoverId?.(null);
                            }
                        }) : null}
                        onFlowAnchorPointerDown={(allowSelect && allowPointer) ? onFlowAnchorPointerDown : null}

                        onSwitchPress={onSwitchPress}

                        showLights={showLights && !anyFadeActive}
                        showLightBoundsGlobal={showLightBounds && !anyFadeActive}
                        shadowsOn={shadowsOn && fadeTarget > 0.2 && !anyFadeActive}
                        suspendUI={anyFadeActive}
                        dragging={!!dragState?.active}
                        labelsOn={labelsAllowed && !(n?.groupId != null && fadedGroupSet.has(String(n.groupId)))}
                        labelMode={labelMode}
                        labelSize={labelSize}
                        labelMaxWidth={labelMaxWidth}
                        label3DLayers={label3DLayers}
                        label3DStep={label3DStep}
                    />
                );
            })}

            {/* Cable tidy wall previews */}
            {nodesForRender.map((n) => {
                if (!n || String(n.kind || "").toLowerCase() !== "tidy") return null;
                if (!n.tidy?.enabled || !n.tidy?.showWalls) return null;
                const roomId = n?.roomId != null ? String(n.roomId) : "";
                const deckId = n?.deckId != null ? String(n.deckId) : (roomId ? (roomDeckById.get(roomId) || "") : "");
                const nodeHidden =
                    (deckId && hiddenDeck.has(deckId)) ||
                    (roomId && hiddenRooms.has(roomId));
                const { fadeTarget } = getNodeFadeInfo(n);
                const externalFadeAlpha = fadeAlphaByIdRef.current.get(String(n.id));
                const fadeAlpha = Math.max(0, Math.min(1, externalFadeAlpha ?? fadeTarget));
                if (nodeHidden && fadeAlpha <= 0.001) return null;
                if (fadeAlpha <= 0.001) return null;
                const pos = n.position || [0, 0, 0];
                const v = n.tidy?.vertical || {};
                const h = n.tidy?.horizontal || {};
                const ox = n.tidy?.offset?.x ?? 0;
                const oy = n.tidy?.offset?.y ?? 0;
                const oz = n.tidy?.offset?.z ?? 0;
                const wallColor = "#38bdf8";
                const glowColor = "#7dd3fc";
                return (
                    <group key={`tidy_${n.id}`} position={[pos[0] + ox, pos[1] + oy, pos[2] + oz]}>
                        {(v.w && v.h && v.d) && (
                            <group>
                                <mesh>
                                    <boxGeometry args={[v.w, v.h, v.d]} />
                                    <meshStandardMaterial
                                        color={wallColor}
                                        transparent
                                        opacity={0.12 * fadeAlpha}
                                        roughness={0.2}
                                        metalness={0.0}
                                        emissive={glowColor}
                                        emissiveIntensity={0.25}
                                    />
                                </mesh>
                                <lineSegments>
                                    <edgesGeometry args={[new THREE.BoxGeometry(v.w, v.h, v.d)]} />
                                    <lineBasicMaterial color={glowColor} transparent opacity={0.75 * fadeAlpha} />
                                </lineSegments>
                            </group>
                        )}
                        {(h.w && h.h && h.d) && (
                            <group>
                                <mesh>
                                    <boxGeometry args={[h.w, h.h, h.d]} />
                                    <meshStandardMaterial
                                        color={wallColor}
                                        transparent
                                        opacity={0.12 * fadeAlpha}
                                        roughness={0.2}
                                        metalness={0.0}
                                        emissive={glowColor}
                                        emissiveIntensity={0.25}
                                    />
                                </mesh>
                                <lineSegments>
                                    <edgesGeometry args={[new THREE.BoxGeometry(h.w, h.h, h.d)]} />
                                    <lineBasicMaterial color={glowColor} transparent opacity={0.75 * fadeAlpha} />
                                </lineSegments>
                            </group>
                        )}
                    </group>
                );
            })}
            {instancedCandidates.length > 0 && (
                <InstancedNodeLabels items={instancedCandidates} />
            )}

            {/* Links */}
            {allLinks.map((l) => {
                const a = nodeMap[l.from];
                const b = nodeMap[l.to];
                if (!a || !b) return null;

                // Cinematic fades: links should fade with the exact same timing
                // as nodes/rooms/decks/groups (no instant pop-off).
                const __fade = fadeLinkHideRef.current;
                const aForceShowNode = __fade?.forceShowNodes?.has?.(String(a.id)) ?? false;
                const bForceShowNode = __fade?.forceShowNodes?.has?.(String(b.id)) ?? false;
                const aForceShowRoom = a.roomId ? (__fade?.forceShowRooms?.has?.(String(a.roomId)) ?? false) : false;
                const bForceShowRoom = b.roomId ? (__fade?.forceShowRooms?.has?.(String(b.roomId)) ?? false) : false;
                const aDeckId = a?.deckId != null
                    ? String(a.deckId)
                    : (a?.roomId != null ? (roomDeckById.get(String(a.roomId)) || "") : "");
                const bDeckId = b?.deckId != null
                    ? String(b.deckId)
                    : (b?.roomId != null ? (roomDeckById.get(String(b.roomId)) || "") : "");
                const aContainerHidden =
                    (!aForceShowRoom && a.roomId && (__fade?.rooms?.has?.(String(a.roomId)) ?? false)) ||
                    (aDeckId && (__fade?.decks?.has?.(aDeckId) ?? false)) ||
                    (!aForceShowRoom && a.groupId && (__fade?.groups?.has?.(String(a.groupId)) ?? false));
                const bContainerHidden =
                    (!bForceShowRoom && b.roomId && (__fade?.rooms?.has?.(String(b.roomId)) ?? false)) ||
                    (bDeckId && (__fade?.decks?.has?.(bDeckId) ?? false)) ||
                    (!bForceShowRoom && b.groupId && (__fade?.groups?.has?.(String(b.groupId)) ?? false));
                const aFadeHidden =
                    (__fade?.nodes?.has?.(String(a.id)) ?? false) ||
                    (!aForceShowNode && aContainerHidden);
                const bFadeHidden =
                    (__fade?.nodes?.has?.(String(b.id)) ?? false) ||
                    (!bForceShowNode && bContainerHidden);
                const fadeTarget = (__fade?.all || aFadeHidden || bFadeHidden) ? 0 : 1;
                const fadeInDuration = Math.max(0, Number(__fade?.inDur ?? 0.6) || 0.6);
                const fadeOutDuration = Math.max(0, Number(__fade?.outDur ?? 0.6) || 0.6);

                const aHidden =
                    (aDeckId && hiddenDeck.has(aDeckId)) ||
                    (a.roomId && hiddenRooms.has(a.roomId));
                const bHidden =
                    (bDeckId && hiddenDeck.has(bDeckId)) ||
                    (b.roomId && hiddenRooms.has(b.roomId));
                const hiddenByVisibility = aHidden || bHidden;
                const hiddenByFadeAction = !!(__fade?.all || aFadeHidden || bFadeHidden);
                if (hiddenByVisibility && !hiddenByFadeAction) return null;

                const outSlot = linkSlots.out.get(l.id) || { idx: 0, count: 1 };
                const inSlot = linkSlots.inn.get(l.id) || { idx: 0, count: 1 };

                const ao = __endpointOffsetXZ(a, outSlot.idx, outSlot.count);
                const bo = __endpointOffsetXZ(b, inSlot.idx, inSlot.count);

                const aPos = a.position || [0, 0, 0];
                const bPos = b.position || [0, 0, 0];
                const start = [
                    (aPos[0] || 0) + ao[0],
                    (aPos[1] || 0) + ao[1],
                    (aPos[2] || 0) + ao[2],
                ];
                const end = [
                    (bPos[0] || 0) + bo[0],
                    (bPos[1] || 0) + bo[1],
                    (bPos[2] || 0) + bo[2],
                ];
                const precomputed = linkPathById.get(String(l.id));
                let points = precomputed?.points;
                let forceOrthogonal = precomputed?.forceOrthogonal ?? false;
                let forceStraight = precomputed?.forceStraight ?? forceOrthogonal;

                if (!points || points.length < 2) {
                const anchorSelection = (() => {
                    const candidates = [b, a];
                    if (l.flowAnchorSetOwnerId) {
                        const ownerKey = String(l.flowAnchorSetOwnerId);
                        const preferred = candidates.find((cand) => String(cand?.id) === ownerKey);
                        if (preferred) {
                            const set = __findFlowAnchorSet(preferred, l.flowAnchorSetId, false)
                                || __findFlowAnchorSet(preferred, null, true);
                            if (set) return { owner: preferred, set };
                        }
                    }
                    if (l.flowAnchorSetId) {
                        for (const cand of candidates) {
                            if (!cand || cand.flowAnchorsEnabled !== true) continue;
                            const set = __findFlowAnchorSet(cand, l.flowAnchorSetId, false);
                            if (set) {
                                return { owner: cand, set };
                            }
                        }
                    }
                    for (const cand of candidates) {
                        if (!cand || cand.flowAnchorsEnabled !== true) continue;
                        const set = __findFlowAnchorSet(cand, null, true);
                        if (set) {
                            return { owner: cand, set };
                        }
                    }
                    return { owner: null, set: null };
                })();

                const anchorOwner = anchorSelection.owner;
                const anchorSet = anchorSelection.set;
                const anchorBase = anchorOwner === b ? bPos : aPos;
                const rawFlowAnchors = Array.isArray(anchorSet?.anchors) ? anchorSet.anchors : [];
                const flowAnchorGlobalBend = __normalizeAnchorBendDeg(
                    anchorSet?.globalBendDeg ?? anchorOwner?.flowAnchorGlobalBendDeg ?? 0
                );
                const flowAnchorDynamicBreakpoints = anchorSet?.dynamicBreakpoints ?? anchorOwner?.flowAnchorDynamicBreakpoints;
                const flowAnchorNoDiagonal = anchorSet?.noDiagonal ?? anchorOwner?.flowAnchorNoDiagonal;
                const flowAnchorSpreadPaths = Number(anchorSet?.spreadPaths ?? 0) || 0;
                const flowAnchorSpreadIgnore = Math.max(
                    0,
                    Math.round(Number(anchorSet?.spreadIgnoreBreakpoints ?? 0) || 0),
                );
                const flowAnchors = rawFlowAnchors.filter((anchor) => anchor && (anchor.enabled ?? true));
                const spreadSlot = anchorSetSlots.get(l.id);
                const spreadOffset =
                    flowAnchorSpreadPaths > 0 && spreadSlot && spreadSlot.count > 1
                        ? (spreadSlot.idx - (spreadSlot.count - 1) * 0.5) * flowAnchorSpreadPaths
                        : 0;
                const spreadDir = (() => {
                    if (!spreadOffset) return null;
                    const dx = (end?.[0] ?? 0) - (start?.[0] ?? 0);
                    const dz = (end?.[2] ?? 0) - (start?.[2] ?? 0);
                    const len = Math.sqrt(dx * dx + dz * dz);
                    if (len > 1e-5) {
                        const sx = -dz / len;
                        const sz = dx / len;
                        return [sx * spreadOffset, 0, sz * spreadOffset];
                    }
                    return [spreadOffset, 0, 0];
                })();

                let spreadPointIndex = 0;
                const shouldApplySpread = () => {
                    spreadPointIndex += 1;
                    return spreadPointIndex > flowAnchorSpreadIgnore;
                };
                const applySpread = (pt) => {
                    if (!spreadDir) return pt;
                    if (!shouldApplySpread()) return pt;
                    return [
                        (pt[0] || 0) + (spreadDir[0] || 0),
                        pt[1] || 0,
                        (pt[2] || 0) + (spreadDir[2] || 0),
                    ];
                };
                const flowAnchorPoints = flowAnchors.reduce((acc, anchor) => {
                    const pos = Array.isArray(anchor.pos) ? anchor.pos : null;
                    if (!pos) return acc;
                    const p = [
                        (anchorBase[0] || 0) + (pos[0] || 0),
                        (anchorBase[1] || 0) + (pos[1] || 0),
                        (anchorBase[2] || 0) + (pos[2] || 0),
                    ];
                    acc.push(applySpread(p));
                    return acc;
                }, []);
                const flowAnchorBendsByIndex = new Map();
                let anchorPointIndex = 0;
                flowAnchors.forEach((anchor) => {
                    const pos = Array.isArray(anchor.pos) ? anchor.pos : null;
                    if (!pos) return;
                    const bendDeg = __normalizeAnchorBendDeg(anchor?.bendDeg ?? flowAnchorGlobalBend ?? 0);
                    if (bendDeg > 0) flowAnchorBendsByIndex.set(1 + anchorPointIndex, bendDeg);
                    anchorPointIndex += 1;
                });
                const findActiveSet = (node) => {
                    if (!node) return null;
                    const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
                    if (!sets.length) return null;
                    const activeId = node?.flowAnchorActiveSetId || sets[0]?.id;
                    return sets.find((s) => s?.id === activeId) || sets[0] || null;
                };
                const findSetById = (node, setId) => {
                    if (!node || !setId) return null;
                    const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
                    return sets.find((s) => s?.id === setId) || null;
                };
                const nodeHasNoDiagonalSet = (node) => {
                    if (!node) return false;
                    const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
                    return sets.some((s) => s?.noDiagonal === true);
                };
                const nodeHasBend90Set = (node) => {
                    if (!node) return false;
                    const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
                    return sets.some((s) => __normalizeAnchorBendDeg(s?.globalBendDeg ?? 0) === 90);
                };
                const nodeHasBendRuleSet = (node) => {
                    if (!node) return false;
                    const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
                    return sets.some((s) => __normalizeAnchorBendDeg(s?.globalBendDeg ?? 0) > 0);
                };
                const getNoDiagonalForNode = (node) => {
                    if (!node) return false;
                    if (l.flowAnchorSetId) {
                        const set = findSetById(node, l.flowAnchorSetId);
                        if (set?.noDiagonal === true) return true;
                    }
                    const active = findActiveSet(node);
                    if (active?.noDiagonal === true) return true;
                    return node?.flowAnchorNoDiagonal === true;
                };
                const getGlobalBendForNode = (node) => {
                    if (!node) return 0;
                    if (l.flowAnchorSetId) {
                        const set = findSetById(node, l.flowAnchorSetId);
                        if (set?.globalBendDeg != null) return __normalizeAnchorBendDeg(set.globalBendDeg);
                    }
                    const active = findActiveSet(node);
                    if (active?.globalBendDeg != null) return __normalizeAnchorBendDeg(active.globalBendDeg);
                    return __normalizeAnchorBendDeg(node?.flowAnchorGlobalBendDeg ?? 0);
                };
                const anyNoDiagonal =
                    flowAnchorNoDiagonal === true ||
                    getNoDiagonalForNode(a) ||
                    getNoDiagonalForNode(b) ||
                    nodeHasNoDiagonalSet(a) ||
                    nodeHasNoDiagonalSet(b);
                const anyBend90 =
                    flowAnchorGlobalBend === 90 ||
                    getGlobalBendForNode(a) === 90 ||
                    getGlobalBendForNode(b) === 90 ||
                    nodeHasBend90Set(a) ||
                    nodeHasBend90Set(b) ||
                    Array.from(flowAnchorBendsByIndex.values()).some((v) => v === 90);
                const anyBendRule =
                    flowAnchorGlobalBend > 0 ||
                    getGlobalBendForNode(a) > 0 ||
                    getGlobalBendForNode(b) > 0 ||
                    nodeHasBendRuleSet(a) ||
                    nodeHasBendRuleSet(b) ||
                    Array.from(flowAnchorBendsByIndex.values()).some((v) => v > 0);
                forceOrthogonal = anyNoDiagonal || anyBend90;
                forceStraight = forceOrthogonal || anyBendRule;

                const hasLinkBps = Array.isArray(l.breakpoints) && l.breakpoints.length > 0;
                const dynamicBendEnabled =
                    anchorOwner?.flowAnchorsEnabled === true &&
                    flowAnchorDynamicBreakpoints === true &&
                    flowAnchorGlobalBend > 0 &&
                    !hasLinkBps;
                const dynamicBendPoints = [];
                if (dynamicBendEnabled) {
                    const segStart = flowAnchorPoints.length
                        ? flowAnchorPoints[flowAnchorPoints.length - 1]
                        : start;
                    const dx = end[0] - segStart[0];
                    const dy = end[1] - segStart[1];
                    const dz = end[2] - segStart[2];
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist > 1e-4) {
                        const pushPoint = (pt) => {
                            const last = dynamicBendPoints[dynamicBendPoints.length - 1];
                            if (
                                !last ||
                                Math.abs(pt[0] - last[0]) > 1e-6 ||
                                Math.abs(pt[1] - last[1]) > 1e-6 ||
                                Math.abs(pt[2] - last[2]) > 1e-6
                            ) {
                                dynamicBendPoints.push(pt);
                            }
                        };

                        if (flowAnchorNoDiagonal) {
                            const goXFirst = Math.abs(dx) >= Math.abs(dz);
                            let p1 = goXFirst
                                ? [end[0], segStart[1], segStart[2]]
                                : [segStart[0], segStart[1], end[2]];
                            let p2 = [end[0], segStart[1], end[2]];
                            p1 = applySpread(p1);
                            p2 = applySpread(p2);
                            pushPoint(p1);
                            pushPoint(p2);
                        } else {
                            let px = -dz;
                            let pz = dx;
                            const plen = Math.sqrt(px * px + pz * pz);
                            if (plen > 1e-5) {
                                px /= plen;
                                pz /= plen;
                            } else {
                                px = 0;
                                pz = 1;
                            }
                            const t = Math.min(1, Math.max(0, flowAnchorGlobalBend / 180));
                            const offset = dist * (0.15 + t * 0.45);
                            const midX = (segStart[0] + end[0]) * 0.5;
                            const midY = (segStart[1] + end[1]) * 0.5;
                            const midZ = (segStart[2] + end[2]) * 0.5;
                            const cornerX = midX + px * offset;
                            const cornerZ = midZ + pz * offset;

                            if (flowAnchorGlobalBend >= 60) {
                                if (Math.abs(dx) >= Math.abs(dz)) {
                                    const p1 = applySpread([cornerX, midY, segStart[2]]);
                                    const p2 = applySpread([cornerX, midY, end[2]]);
                                    dynamicBendPoints.push(p1, p2);
                                } else {
                                    const p1 = applySpread([segStart[0], midY, cornerZ]);
                                    const p2 = applySpread([end[0], midY, cornerZ]);
                                    dynamicBendPoints.push(p1, p2);
                                }
                            } else {
                                dynamicBendPoints.push(applySpread([cornerX, midY, cornerZ]));
                            }
                        }
                    }
                }

                points = __applyFlowAnchorBends([
                    start,
                    ...flowAnchorPoints,
                    ...dynamicBendPoints,
                    ...(Array.isArray(l.breakpoints) ? l.breakpoints : []),
                    end,
                ], flowAnchorBendsByIndex);
                const tidyRoute = findTidyRouteForPath(points);
                if (tidyRoute?.point) {
                    const splitIndex = Math.max(0, Math.min(points.length - 2, Number(tidyRoute.insertAfter) || 0));
                    const tidyPoint = tidyRoute.point;
                    const prevPt = points[splitIndex];
                    const nextPt = points[splitIndex + 1];
                    const sameAsPrev = prevPt
                        && Math.abs((prevPt[0] || 0) - (tidyPoint[0] || 0)) < 1e-6
                        && Math.abs((prevPt[1] || 0) - (tidyPoint[1] || 0)) < 1e-6
                        && Math.abs((prevPt[2] || 0) - (tidyPoint[2] || 0)) < 1e-6;
                    const sameAsNext = nextPt
                        && Math.abs((nextPt[0] || 0) - (tidyPoint[0] || 0)) < 1e-6
                        && Math.abs((nextPt[1] || 0) - (tidyPoint[1] || 0)) < 1e-6
                        && Math.abs((nextPt[2] || 0) - (tidyPoint[2] || 0)) < 1e-6;
                    if (!sameAsPrev && !sameAsNext) {
                        points = points.slice(0, splitIndex + 1).concat([tidyPoint], points.slice(splitIndex + 1));
                    }
                }
                if (anyNoDiagonal && points.length >= 2) {
                    const last = points[points.length - 1];
                    const prev = points[points.length - 2];
                    if (last && prev) {
                        const target = [last[0], prev[1], last[2]];
                        const same =
                            Math.abs(target[0] - prev[0]) < 1e-6 &&
                            Math.abs(target[1] - prev[1]) < 1e-6 &&
                            Math.abs(target[2] - prev[2]) < 1e-6;
                        const sameEnd =
                            Math.abs(target[0] - last[0]) < 1e-6 &&
                            Math.abs(target[1] - last[1]) < 1e-6 &&
                            Math.abs(target[2] - last[2]) < 1e-6;
                        if (!same && !sameEnd) {
                            points = [...points.slice(0, -1), target, last];
                        }
                    }
                }
                if (forceOrthogonal) {
                    points = __forceOrthogonalXZ(points);
                }
                if (points.length < 2) return null;
                }

                const segCount = points.length - 1;

                // 👉 NEW: global strand offsets for this whole link
                const cableOffsets =
                    l.style === "cable"
                        ? computeCableOffsetsForLink(l, points[0], points[points.length - 1])
                        : null;

                const isSelected = selectedForRender?.type === "link" && selectedForRender.id === l.id;

                // 👉 NEW: for animated/curve styles, optionally treat breakpoints as ONE continuous path
                const curveStyles = new Set(["sweep", "particles", "wavy", "icons", "epic", "packet"]);
                const curvePathMode = l.pathMode ?? l.sweep?.pathMode ?? "auto"; // "auto" | "single" | "segments"
                const wantSinglePath =
                    segCount > 1 &&
                    curveStyles.has(l.style) &&
                    curvePathMode !== "segments" &&
                    (curvePathMode === "single" || curvePathMode === "auto");

                if (wantSinglePath) {
                    return (
                        <Link3D
                            key={`${l.id}-path`}
                            link={l}
                            from={start}
                            to={end}
                            points={points}
                            pathCurveMode={forceStraight ? "polyline" : undefined}
                            forceStraight={forceStraight}
                            perf={perf}
                            fadeTarget={fadeTarget}
                            fadeInDuration={fadeInDuration}
                            fadeOutDuration={fadeOutDuration}
                            cableOffsets={cableOffsets}
                            selected={isSelected}
                            dragging={!!dragState?.active}
                            onPointerDown={(allowSelect && !dragState?.active && !(moveMode && (selectedForRender || (selectedMultiForRender || []).length)) && !selectedFlowAnchorForRender && !selectedBreakpoint) ? (e) => {
                                const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                if (!isLeft) return;
                                e.stopPropagation();
                                setSelected?.({ type: "link", id: l.id });
                            } : null}
                            animate={animate}
                            animateFx={animate}
                            fxStride={perf === "low" ? 3 : perf === "med" ? 2 : 1}
                            simplify={false}
                    />
                );
                }

                // Legacy / per-segment rendering (still used for solid/cable/dashed etc)
                return points.slice(0, -1).map((p, idx) => (
                    <Link3D
                        key={`${l.id}-seg-${idx}`}
                        link={l}
                        from={p}
                        to={points[idx + 1]}
                        segmentIndex={idx}
                        segmentCount={segCount}
                        pathCurveMode={forceStraight ? "polyline" : undefined}
                        forceStraight={forceStraight}
                        perf={perf}
                        fadeTarget={fadeTarget}
                        fadeInDuration={fadeInDuration}
                        fadeOutDuration={fadeOutDuration}
                        cableOffsets={cableOffsets}
                        selected={isSelected}
                        dragging={!!dragState?.active}
                        onPointerDown={(allowSelect && !dragState?.active && !(moveMode && (selectedForRender || (selectedMultiForRender || []).length)) && !selectedFlowAnchorForRender && !selectedBreakpoint) ? (e) => {
                            const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                            if (!isLeft) return;
                            e.stopPropagation();
                            setSelected?.({ type: "link", id: l.id });
                        } : null}
                        animate={animate}
                        animateFx={animate}
                        fxStride={perf === "low" ? 3 : perf === "med" ? 2 : 1}
                        simplify={false}
                    />
                ));
            })}




            {/* Transform gizmo */}
            <TransformControls
                ref={tcRef}
                object={tcTarget || tcWarmRef.current}
                enabled={tcActive}
                visible={tcActive}
                showX={tcActive}
                showY={tcActive}
                showZ={tcActive}
                mode={
                    selectedPictureId
                        ? "translate"
                        : (selected?.type === "model"
                            ? (transformMode === "scale" ? "scale" : "translate")
                            : transformMode)
                }
                onDragStart={() => {
                    if (!tcActive) return;
                    tcDraggingRef.current = true;
                    dragState?.set?.(true);

                    const o = tcRef.current?.object;

                    // Single-room translate: snapshot room + its contents so children move together
                    if (transformMode === "translate" && selectedRoom && !selectedRoom.locked) {
                        const rr = roomRefs.current?.[selectedRoom.id]?.current || null;
                        if (o && rr && o === rr) onRoomDragPack?.(selectedRoom);
                    }

                    // Single-room scale: snapshot room + contents baseline
                    if (transformMode === "scale" && selectedRoom && !selectedRoom.locked && o === roomScaleRef.current) {
                        // ensure proxy starts clean
                        o.scale.set(1, 1, 1);
                        o.updateMatrixWorld();
                        onRoomScalePack?.(selectedRoom.id);
                    }
                    const multiCount = uniqueSelectedMulti?.length || 0;

                    // Multi-move: snap the pivot to the latest centroid BEFORE we lock out centroid syncing.
                    // This prevents the classic "first-delta jump" (teleport/reset-to-center) when the user
                    // clicks "Move all" and drags immediately.
                    if (o && o === multiRef.current && multiCount > 1) {
                        if (multiCentroid &&
                            Number.isFinite(multiCentroid.x) &&
                            Number.isFinite(multiCentroid.y) &&
                            Number.isFinite(multiCentroid.z)
                        ) {
                            o.position.copy(multiCentroid);
                        }
                        lastPos.current.copy(o.position);

                        // Initialize the parent's multi-move snapshot (dx=0 on start).
                        onEntityTransform?.({ type: "pivot", id: "__pivot__" }, [o.position.x, o.position.y, o.position.z]);

                        // If rotating, also init rotation snapshot (so the parent can compute a delta from a stable baseline).
                        if (transformMode === "rotate") {
                            onEntityRotate?.({ type: "pivot", id: "__pivot__" }, [o.rotation.x, o.rotation.y, o.rotation.z]);
                        }

                        if (missGuardRef) missGuardRef.current = performance.now();
                    }
                }}

                onDragEnd={() => {
                    if (!tcActive) return;
                    tcDraggingRef.current = false;
                    dragState?.set?.(false);
                    multiDragRef.current.active = false;

                    // Reset room-scale proxy so the next drag starts from identity
                    if (roomScaleRef.current) {
                        roomScaleRef.current.scale.set(1, 1, 1);
                        roomScaleRef.current.updateMatrixWorld();
                    }

                    if (missGuardRef) missGuardRef.current = performance.now();
                }}

                translationSnap={tSnap}
                rotationSnap={rSnap}
                scaleSnap={sSnap}
                size={1.0}
                space={transformMode === "scale" ? "local" : "world"}
                onMouseDown={stop}
                onMouseUp={stop}
                onPointerDown={stop}
                onPointerUp={stop}
                onObjectChange={() => {
                    if (!tcActive) return;
                    const obj = tcRef.current?.object;
                    if (!obj) return;

                        const p = obj.position;
                        const r = obj.rotation;

                        // 1) Multi-move centroid (group pivot)
                        // IMPORTANT: Delegate to the parent stabilizer by sending a single "pivot" transform.
                        // Doing per-entity incremental deltas here can easily produce a huge first-delta and
                        // make everything "fly" off-screen or reset toward origin.
                        if ((selectedMultiForRender?.length || 0) > 1 && obj === multiRef.current) {
                            if (transformMode === "rotate") {
                                onEntityRotate?.({ type: "pivot", id: "__pivot__" }, [r.x, r.y, r.z]);
                            } else {
                                lastPos.current.set(p.x, p.y, p.z); // keep in sync for any legacy/fallback paths
                                onEntityTransform?.({ type: "pivot", id: "__pivot__" }, [p.x, p.y, p.z]);
                            }
                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }


                        // 2) Single breakpoint – handle this BEFORE node/room
                        if (selectedBreakpoint && obj === bpRef.current) {
                            const meta = bpMetaRef.current || selectedBreakpoint;
                            onEntityTransform?.(
                                { type: "breakpoint", linkId: meta.linkId, index: meta.index },
                                [p.x, p.y, p.z],
                            );
                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }

                        // 2.5) Single flow anchor
                        if (selectedFlowAnchorForRender && obj === flowAnchorRef.current) {
                            const meta = flowAnchorMetaRef.current || selectedFlowAnchorForRender;
                            onEntityTransform?.(
                                { type: "flowAnchor", nodeId: meta.nodeId, setId: meta.setId, index: meta.index },
                                [p.x, p.y, p.z],
                            );
                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }

                        // 3) Single picture – translate only
                        if (selectedPictureId && pictureTarget && obj === pictureTarget) {
                            onEntityTransform?.(
                                { type: "picture", id: selectedPictureId },
                                [p.x, p.y, p.z],
                            );
                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }

                        // 4) Single node / room
                        // 3.5) Single room scale proxy (scale room + contents)
                        if (transformMode === "scale" && selectedRoom && !selectedRoom.locked && obj === roomScaleRef.current) {
                            const s = obj.scale;
                            onRoomScaleApply?.(selectedRoom.id, [s.x, s.y, s.z]);
                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }
                        if (selectedForRender?.type === "model" && modelRef?.current && obj === modelRef.current && transformMode === "scale") {
                            onModelScale?.([obj.scale.x, obj.scale.y, obj.scale.z]);
                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }
                        // 3.5) Model – translate only
                        if (selectedForRender?.type === "model" && modelRef?.current && obj === modelRef.current) {
                            onEntityTransform?.({ type: "model" }, [p.x, p.y, p.z]);
                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }


                        // 4) Single node / room
                        if (selectedNode) {
                            const raw = [p.x, p.y, p.z];
                            const clamped = clampNodeToRoomBoundsLocal(selectedNode, raw);
                            if (clamped && (clamped[0] !== raw[0] || clamped[1] !== raw[1] || clamped[2] !== raw[2])) {
                                obj.position.set(clamped[0], clamped[1], clamped[2]);
                            }
                            onEntityTransform?.(
                                { type: "node", id: selectedNode.id },
                                clamped || raw,
                            );
                            onEntityRotate?.(
                                { type: "node", id: selectedNode.id },
                                [r.x, r.y, r.z],
                            );
                        } else if (selectedRoom && !selectedRoom.locked) {
                            if (transformMode === "translate") {
                                // Move room + its contents as a pack (keeps nodes in place within the room)
                                onRoomDragApply?.(selectedRoom.id, [p.x, p.y, p.z]);
                            } else {
                                onEntityTransform?.(
                                    { type: "room", id: selectedRoom.id },
                                    [p.x, p.y, p.z],
                                );
                                onEntityRotate?.(
                                    { type: "room", id: selectedRoom.id },
                                    [r.x, r.y, r.z],
                                );
                            }
                        }


                        if (missGuardRef) missGuardRef.current = performance.now();
                }}
            />
            {uiHidden && selectedNode?.position && (
                <NodeSelectionPulse position={selectedNode.position} />
            )}

            {alignmentBeamMarkers}


            {/* Ground & shadows */}
            {showGround && (
                <>
                    {shadowsOn && (
                        <ContactShadows
                            opacity={0.35}
                            scale={12}
                            blur={1.75}
                            far={8}
                            resolution={1024}
                            frames={60}
                        />
                    )}

                    {gridEnabled && (
                        <>
                            {/* Configurable ground grid */}
                            <Grid
                                args={[gridSize, gridSize]}
                                position={[0, gridY + 0.002, 0]}
                                cellSize={gridCellSize}
                                sectionSize={gridSectionSize}
                                cellThickness={gridCellThickness}
                                sectionThickness={gridSectionThickness}
                                cellColor={gridCellColor}
                                sectionColor={gridSectionColor}
                                infiniteGrid={gridInfinite}
                                followCamera={gridFollowCamera}
                                fadeDistance={gridFadeDistance}
                                fadeStrength={gridFadeStrength}
                            />


                            {/* Floors / Decks (extra horizontal layers) */}
                            {floorsEnabled && visibleFloors && visibleFloors.length > 1 && (
                                <>
                                    {visibleFloors
                                        .filter((f) => f && f.id !== "ground")
                                        .map((f) => {
                                            const base = new THREE.Color(gridGroundBlend);
                                            const tgt = new THREE.Color(f.color || gridColor);
                                            const op = Number.isFinite(Number(f.opacity)) ? Number(f.opacity) : Math.max(0.06, Math.min(0.35, gridOpacity * 0.65));
                                            const cellCol = base.clone().lerp(tgt, Math.max(0.05, Math.min(1, op * 0.7))).getStyle();
                                            const secCol = base.clone().lerp(tgt, Math.max(0.05, Math.min(1, op * 1.1))).getStyle();

                                            return (
                                                <Grid
                                                    key={`floor_${f.id}`}
                                                    args={[gridSize, gridSize]}
                                                    position={[0, (Number(f.y) || gridY) + 0.002, 0]}
                                                    cellSize={gridCellSize}
                                                    sectionSize={gridSectionSize}
                                                    cellThickness={gridCellThickness}
                                                    sectionThickness={gridSectionThickness}
                                                    cellColor={cellCol}
                                                    sectionColor={secCol}
                                                    infiniteGrid={gridInfinite}
                                                    followCamera={gridFollowCamera}
                                                    fadeDistance={gridFadeDistance}
                                                    fadeStrength={gridFadeStrength}
                                                />
                                            );
                                        })}
                                </>
                            )}

                            {/* Optional 3D grid space (multiple wall planes) */}
                            {gridSpace3D && (
                                <>
                                    {gridSpace3DXY && gridSpaceOffsets.map((off) => (
                                        <Grid
                                            key={`grid_xy_\${off}`}
                                            args={[gridSize, gridSize]}
                                            rotation={[Math.PI / 2, 0, 0]}
                                            position={[0, gridY, (gridPlaneOffsetZ + off)]}
                                            cellSize={gridCellSize}
                                            sectionSize={gridSectionSize}
                                            cellThickness={gridCellThickness}
                                            sectionThickness={gridSectionThickness}
                                            cellColor={gridCellColor}
                                            sectionColor={gridSectionColor}
                                            infiniteGrid={gridInfinite}
                                            followCamera={gridFollowCamera}
                                            fadeDistance={gridFadeDistance}
                                            fadeStrength={gridFadeStrength}
                                        />
                                    ))}
                                    {gridSpace3DYZ && gridSpaceOffsets.map((off) => (
                                        <Grid
                                            key={`grid_yz_\${off}`}
                                            args={[gridSize, gridSize]}
                                            rotation={[0, 0, Math.PI / 2]}
                                            position={[(gridPlaneOffsetX + off), gridY, 0]}
                                            cellSize={gridCellSize}
                                            sectionSize={gridSectionSize}
                                            cellThickness={gridCellThickness}
                                            sectionThickness={gridSectionThickness}
                                            cellColor={gridCellColor}
                                            sectionColor={gridSectionColor}
                                            infiniteGrid={gridInfinite}
                                            followCamera={gridFollowCamera}
                                            fadeDistance={gridFadeDistance}
                                            fadeStrength={gridFadeStrength}
                                        />
                                    ))}
                                </>
                            )}

                            {null}

                            {/* Selection highlight (which grid cell(s) the selection occupies) */}
                            {selectionGridRect && (
                                <mesh
                                    rotation={[-Math.PI / 2, 0, 0]}
                                    position={[selectionGridRect.cx, gridY + 0.004, selectionGridRect.cz]}
                                    renderOrder={1000}
                                >
                                    <planeGeometry args={[selectionGridRect.w, selectionGridRect.d]} />
                                    <meshBasicMaterial
                                        color={gridHighlightColor}
                                        transparent
                                        opacity={gridHighlightOpacity}
                                        depthWrite={false}
                                    />
                                </mesh>
                            )}



                            {/* Snap preview ghost (during drag) */}
                            {snapGhost && (
                                <>
                                    <mesh
                                        rotation={[-Math.PI / 2, 0, 0]}
                                        position={[snapGhost.x, snapGhost.baseY + 0.006, snapGhost.z]}
                                        renderOrder={999}
                                    >
                                        <planeGeometry args={[snapGhost.w, snapGhost.d]} />
                                        <meshBasicMaterial
                                            color={snapGhostColor}
                                            transparent
                                            opacity={Math.max(0.08, snapGhostOpacity * 0.9)}
                                            depthWrite={false}
                                        />
                                    </mesh>
                                    <mesh
                                        position={[snapGhost.x, snapGhost.y, snapGhost.z]}
                                        renderOrder={999}
                                    >
                                        <boxGeometry args={[snapGhost.w, snapGhost.h, snapGhost.d]} />
                                        <meshStandardMaterial
                                            color={snapGhostColor}
                                            transparent
                                            opacity={snapGhostOpacity}
                                            roughness={0.4}
                                            metalness={0.0}
                                            depthWrite={false}
                                        />
                                    </mesh>
                                </>
                            )}

                            {/* Optional origin axes helper */}
                            {gridShowAxes && <axesHelper args={[2.25]} />}
                        </>
                    )}

                    {/* Ground plane */}
                    {gridShowPlane && (
                        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, gridY + 0.001, 0]} receiveShadow>
                            <planeGeometry args={[50, 50]} />
                            <meshStandardMaterial color="#0d1322" roughness={0.95} metalness={0.0} />
                        </mesh>
                    )}
                </>
            )}

            {/* Orbit: rotate/pan only; zoom handled above */}
            <OrbitControls
                ref={controlsRef}
                makeDefault
                enabled={!placement?.armed && !dragState?.active}
                enableDamping
                dampingFactor={0.16}
                enableZoom={false} // still off: zoom is handled by our custom logic
                // minDistance={CFG.current.zoom.min}
                // maxDistance={CFG.current.zoom.max}
                enableRotate={!roomOperatorMode}
                minPolarAngle={roomOperatorMode ? 0.0005 : undefined}
                maxPolarAngle={roomOperatorMode ? 0.0005 : undefined}
                minAzimuthAngle={roomOperatorMode ? 0 : undefined}
                maxAzimuthAngle={roomOperatorMode ? 0 : undefined}
            />


            {/* Click-to-place */}
            <InteractionLayer
                armed={!!placement?.armed}
                placeKind={placement?.placeKind}
                multi={false}
                snap={placement?.snap ?? 0.25}
                onPlace={onPlace}
                modelRef={modelRef}
                roomDrawMode={placement?.roomDrawMode || "single"}
                roomHeightScale={placement?.roomHeightScale !== false}
                roomHeightValue={placement?.roomHeightValue ?? 1.6}
            />
        </>
    );
}

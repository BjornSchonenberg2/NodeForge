import React, { useMemo, useRef, useEffect, useLayoutEffect, useState } from "react";
import { OrbitControls, TransformControls, Grid, ContactShadows , Environment} from "@react-three/drei";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Match your project structure:
import ImportedModel from "./gltf/ImportedModel.jsx";
import RoomBox from "./rooms/RoomBox.jsx";
import Node3D from "./nodes/Node3D.jsx";
import Link3D from "./links/Link3D.jsx";
import InteractionLayer from "./interaction/InteractionLayer.jsx";


// -------- Node flow anchor spread (endpoint fan-out) --------
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

// -------- Global lighting prefs (localStorage; updated via window event) --------
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
        const getNum = (k, f) => {
            const v = Number(localStorage.getItem(k));
            return Number.isFinite(v) ? v : f;
        };
        const getStr = (k, f) => localStorage.getItem(k) || f;

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
                                       wireHideSurfaces = false,
                                       wireStroke: wireStrokeProp, // NEW: preferred config for new reveal
                                       wireReveal,                 // Back-compat: old UI still uses this
                                       enableShadows = false,
                                       modelRef,
                                       showModel = true,
                                       roomOpacity = 0.4,
                                       modelScale = 1, // <-- NEW
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
                                       onSwitchPress,
                                       onRoomPointerDown,
                                       selectedMulti = [],
                                       selectedBreakpoint = null,   // NEW
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
                                       roomOperatorMode = false,
                                       onRoomAnchorClick,
                                       onRoomDelete,
                                       onRoomResize,
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
                                       onModelScene
                                   }) {
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

    const safeModelPosition = useMemo(() => {
        if (Array.isArray(modelPosition) && modelPosition.length >= 3) {
            const x = Number(modelPosition[0]);
            const y = Number(modelPosition[1]);
            const z = Number(modelPosition[2]);
            return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0];
        }
        return [0, 0, 0];
    }, [modelPosition?.[0], modelPosition?.[1], modelPosition?.[2]]);
    const nodeMap = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
    const selectedNode = selected?.type === "node" ? nodeMap[selected?.id] : null;
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
        if (!wireframe) return undefined;

        return stroke;
    }, [wireStrokeProp, wireReveal, wireframe]);



// Fast lookup for multi-selection like "node:123" / "room:abc"
    const selectedMultiSet = useMemo(() => {
        const s = new Set();
        (selectedMulti || []).forEach((it) => {
            if (it?.type && it?.id) s.add(`${it.type}:${it.id}`);
        });
        return s;
    }, [selectedMulti]);
    // De-dupe multi-selection so an entity can never be updated twice per tick.
// This is a common cause of "teleport/fly" when selecting via a box.
    const uniqueSelectedMulti = useMemo(() => {
        const out = [];
        const seen = new Set();
        (selectedMulti || []).forEach((it) => {
            if (!it?.type || !it?.id) return;
            const k = `${it.type}:${it.id}`;
            if (seen.has(k)) return;
            seen.add(k);
            out.push(it);
        });
        return out;
    }, [selectedMulti]);

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

    // ---------- drei controls & camera ----------
    const tcRef = useRef();
    const controlsRef = useRef();
    const { gl, camera } = useThree();


    const [lightingPrefs, setLightingPrefs] = useState(() => readLightingPrefs());

    useEffect(() => {
        if (typeof window === "undefined") return;
        const on = () => setLightingPrefs(readLightingPrefs());
        window.addEventListener("epic3d:lighting-changed", on);
        return () => window.removeEventListener("epic3d:lighting-changed", on);
    }, []);

    useEffect(() => {
        if (!gl) return;
        gl.toneMappingExposure = Number(lightingPrefs.exposure) || 1.0;
    }, [gl, lightingPrefs.exposure]);

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
                const fromPreset = activeTrack.fromPresetId ? findPreset(activeTrack.fromPresetId) : null;
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

                st = {
                    fromPos,
                    fromTarget,
                    fromFov,
                    toPos,
                    toTarget,
                    toFov,
                    startMs: activeTrack.startMs || nowMs,
                    endMs: (activeTrack.startMs || nowMs) + (activeTrack.durationMs || 1),
                };
                cameraTrackStateRef.current.set(activeTrack.id, st);
            }

            const start = st.startMs;
            const end = st.endMs;
            const span = Math.max(1, end - start);
            const tNorm = THREE.MathUtils.clamp((nowMs - start) / span, 0, 1);
            const tSmooth = tNorm * tNorm * (3 - 2 * tNorm); // smoothstep easing

            camera.position.set(
                THREE.MathUtils.lerp(st.fromPos.x, st.toPos.x, tSmooth),
                THREE.MathUtils.lerp(st.fromPos.y, st.toPos.y, tSmooth),
                THREE.MathUtils.lerp(st.fromPos.z, st.toPos.z, tSmooth)
            );

            if (ctrl && ctrl.target) {
                ctrl.target.set(
                    THREE.MathUtils.lerp(st.fromTarget.x, st.toTarget.x, tSmooth),
                    THREE.MathUtils.lerp(st.fromTarget.y, st.toTarget.y, tSmooth),
                    THREE.MathUtils.lerp(st.fromTarget.z, st.toTarget.z, tSmooth)
                );
                ctrl.update();
            } else {
                camera.lookAt(st.toTarget.x, st.toTarget.y, st.toTarget.z);
            }

            if (camera.isPerspectiveCamera && typeof st.toFov === "number") {
                const fromFov = st.fromFov ?? camera.fov;
                camera.fov = THREE.MathUtils.lerp(fromFov, st.toFov, tSmooth);
                camera.updateProjectionMatrix();
            }

            // keep orbit radius in sync for a smooth handoff after the move
            if (ctrl && ctrl.target) {
                tmp.offset.copy(camera.position).sub(ctrl.target);
                tmp.spherical.setFromVector3(tmp.offset);
                s.current.radius = tmp.spherical.radius;
                s.current.radiusTarget = s.current.radius;
            }

            return; // skip manual zoom/fly while a track is active
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
    const tSnap =
        transformMode === "translate" && (placement?.snap ?? 0) > 0
            ? (placement?.snap ?? 0)    // meters (world units)
            : undefined;

    const rSnap =
        transformMode === "rotate" && (placement?.snap ?? 0) > 0
            ? THREE.MathUtils.degToRad(placement?.snap ?? 0) // degrees -> radians
            : undefined;

    const sSnap =
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
            const hasMovable = (selectedMulti || []).some((it) => {
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
        if (selected?.type === "model" && showModel) {
            return modelRef?.current || null;
        }

        return null;
    }, [
        roomOperatorMode,
        moveMode,
        transformMode,
        selectedMulti,
        selectedBreakpoint?.linkId,
        selectedBreakpoint?.index,
        selectedNode?.id,
        selectedRoom?.id,
        selectedPictureId,
        selected?.type,
        modelRef,
        rooms,
        pictureRefs,
        pictureTarget,
    ]);

    // Attach TransformControls dragging hooks *after* it mounts.
    // (TransformControls is conditional; if tcRef.current is null when an effect runs,
    //  we must re-run once the control exists, otherwise pack snapshots never happen.)
    const tcEnabled = !!(moveMode && !roomOperatorMode && tcTarget);
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
            <primitive object={roomScaleRef.current} visible={false} />

            {/* Global lighting */}
            {showLights ? (
                <>
                    {lightingPrefs.envPreset !== "none" && (
                        <Environment
                            preset={lightingPrefs.envPreset}
                            intensity={lightingPrefs.envIntensity}
                        />
                    )}

                    <hemisphereLight
                        intensity={lightingPrefs.hemiIntensity}
                        color={"#ffffff"}
                        groundColor={"#1b2a44"}
                    />

                    <directionalLight
                        position={[lightingPrefs.sunPosX, lightingPrefs.sunPosY, lightingPrefs.sunPosZ]}
                        intensity={lightingPrefs.sunIntensity}
                        castShadow={enableShadows}
                        shadow-mapSize={[2048, 2048]}
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
                        position={[lightingPrefs.fillPosX, lightingPrefs.fillPosY, lightingPrefs.fillPosZ]}
                        intensity={lightingPrefs.fillIntensity}
                        castShadow={false}
                    />
                </>
            ) : (
                <ambientLight intensity={0.4} />
            )}

            {/* Model */}
            {showModel && modelDescriptor && (
                <group ref={modelRef} scale={modelScale} position={safeModelPosition}>
                    <ImportedModel
                        descriptor={modelDescriptor}
                        wireframe={wireframe}
                        wireOpacity={wireOpacity}
                        wireDetail={wireDetail}
                        enableShadows={!!shadowsOn}
                        wireHideSurfaces={wireframe && wireHideSurfaces}
                        wireStroke={mergedWireStroke}
                        perf={perf}
                        shadingMode="leanPBR"
                        onScene={(scene) => {
                            modelSceneRef.current = scene;
                            if (typeof onModelScene === "function") onModelScene(scene);
                        }}
                    />
                </group>
            )}



            {/* Rooms */}
            {rooms.map((r) => {
                if (hiddenRooms.has(r.id) || (r.deckId && hiddenDeck.has(r.deckId))) return null;
                roomRefs.current[r.id] ||= React.createRef();
                return (
                    <RoomBox
                        ref={roomRefs.current[r.id]}
                        key={r.id}
                        room={r}
                        dragging={dragState.active}
                        selected={(selected?.type === "room" && selected.id === r.id) || selectedMultiSet.has(`room:${r.id}`)}
                        onPointerDown={(id, e) => {
                            const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                            if (!isLeft) return;
                            // ---------- EXCLUSIVE SELECTION MODE ----------
                            // If a node is currently selected, do NOT allow rooms to be selected.
                            if (selected?.type === "node") return;

                            // If multi-selection contains any nodes, also disallow.
                            if ([...(selectedMulti || [])].some(s => s.type === "node")) return;

                            // If dragging, block selection (your current behavior)
                            if (dragState.active) return;

                            // ---------- ALLOW ROOM SELECTION ----------
                            if (onRoomPointerDown) onRoomPointerDown(id, e);
                            else setSelected?.({ type: "room", id });
                        }}

                        dragging={!!dragState?.active}
                        opacity={roomOpacity}
                        wireframeGlobal={wireframe}
                        labelsOn={labelsOn}
                        labelMode={labelMode}
                        labelSize={labelSize}
                        labelMaxWidth={labelMaxWidth}
                        label3DLayers={label3DLayers}
                        label3DStep={label3DStep}
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
            {nodes.map((n) => {
                const nodeHidden =
                    (n.deckId && hiddenDeck.has(n.deckId)) ||
                    (n.roomId && hiddenRooms.has(n.roomId));
                if (nodeHidden) return null;
                nodeRefs.current[n.id] ||= React.createRef();
                return (
                    <Node3D
                        ref={nodeRefs.current[n.id]}
                        key={n.id}
                        node={n}

                        selected={(selected?.type === "node" && selected.id === n.id) || selectedMultiSet.has(`node:${n.id}`)}
                        onPointerDown={(id, e) => {
                            const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                            if (!isLeft) return;
                            if (dragState?.active) return;
                            if (onNodePointerDown) onNodePointerDown(id, e);
                            else setSelected?.({ type: "node", id });
                        }}

                        onSwitchPress={onSwitchPress}

                        showLights={showLights}
                        showLightBoundsGlobal={showLightBounds}
                        shadowsOn={shadowsOn}

                        dragging={!!dragState?.active}
                        labelsOn={labelsOn}
                        labelMode={labelMode}
                        labelSize={labelSize}
                        labelMaxWidth={labelMaxWidth}
                        label3DLayers={label3DLayers}
                        label3DStep={label3DStep}
                    />
                );
            })}

            {/* Links */}
            {allLinks.map((l) => {
                const a = nodeMap[l.from];
                const b = nodeMap[l.to];
                if (!a || !b) return null;
                const aHidden =
                    (a.deckId && hiddenDeck.has(a.deckId)) ||
                    (a.roomId && hiddenRooms.has(a.roomId));
                const bHidden =
                    (b.deckId && hiddenDeck.has(b.deckId)) ||
                    (b.roomId && hiddenRooms.has(b.roomId));
                if (aHidden || bHidden) return null;

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

                const points = [
                    start,
                    ...(Array.isArray(l.breakpoints) ? l.breakpoints : []),
                    end,
                ];
                if (points.length < 2) return null;

                const segCount = points.length - 1;

                // 👉 NEW: global strand offsets for this whole link
                const cableOffsets =
                    l.style === "cable"
                        ? computeCableOffsetsForLink(l, points[0], points[points.length - 1])
                        : null;

                const isSelected = selected?.type === "link" && selected.id === l.id;

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
                            cableOffsets={cableOffsets}
                            selected={isSelected}
                            onPointerDown={(e) => {
                                const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                if (!isLeft) return;
                                e.stopPropagation();
                                setSelected?.({ type: "link", id: l.id });
                            }}
                            animate={animate}
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
                        cableOffsets={cableOffsets}
                        selected={isSelected}
                        onPointerDown={(e) => {
                            const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                            if (!isLeft) return;
                            e.stopPropagation();
                            setSelected?.({ type: "link", id: l.id });
                        }}
                        animate={animate}
                    />
                ));
            })}




            {/* Transform gizmo */}
            {moveMode && !roomOperatorMode && tcTarget && (
                <TransformControls
                    ref={tcRef}
                    object={tcTarget}
                    mode={(selectedPictureId || selected?.type === "model") ? "translate" : transformMode}
                    onDragStart={() => {
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
                        const obj = tcRef.current?.object;
                        if (!obj) return;

                        const p = obj.position;
                        const r = obj.rotation;

                        // 1) Multi-move centroid (group pivot)
                        // IMPORTANT: Delegate to the parent stabilizer by sending a single "pivot" transform.
                        // Doing per-entity incremental deltas here can easily produce a huge first-delta and
                        // make everything "fly" off-screen or reset toward origin.
                        if ((selectedMulti?.length || 0) > 1 && obj === multiRef.current) {
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
                        // 3.5) Model – translate only
                        if (selected?.type === "model" && modelRef?.current && obj === modelRef.current) {
                            onEntityTransform?.({ type: "model" }, [p.x, p.y, p.z]);
                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }


                        // 4) Single node / room
                        if (selectedNode) {
                            onEntityTransform?.(
                                { type: "node", id: selectedNode.id },
                                [p.x, p.y, p.z],
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
            )}
            {uiHidden && selectedNode?.position && (
                <NodeSelectionPulse position={selectedNode.position} />
            )}


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
                multi={!!placement?.multi}
                snap={placement?.snap ?? 0.25}
                onPlace={onPlace}
                modelRef={modelRef}
                roomDrawMode={placement?.roomDrawMode || "single"}
            />
        </>
    );
}

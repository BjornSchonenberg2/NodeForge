// rooms/RoomBox.jsx
import React, { memo, forwardRef, useMemo, useState, useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import DissolveEdgesMaterial from "../materials/DissolveEdgesMaterial.jsx"; // adjust path if needed

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
// ---------- Polygon room helpers (local XZ footprint) ----------
function isValidPoly(poly) {
    return Array.isArray(poly) && poly.length >= 3 && poly.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
}

function rectPolyFromSize(w, d) {
    const hw = (Number(w) || 0) * 0.5;
    const hd = (Number(d) || 0) * 0.5;
    // CCW starting at south-west corner
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
}

function polyBounds(poly) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) {
        const x = Number(p?.[0]) || 0;
        const z = Number(p?.[1]) || 0;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    }
    if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    return { minX, maxX, minZ, maxZ };
}

function shapeFromPoly(poly) {
    const shape = new THREE.Shape();
    poly.forEach((p, i) => {
        const x = Number(p?.[0]) || 0;
        const z = Number(p?.[1]) || 0;
        if (i === 0) shape.moveTo(x, z);
        else shape.lineTo(x, z);
    });
    shape.closePath();
    return shape;
}

function makePolyEdgesGeometry(poly, halfH) {
    const pts = poly.map((p) => [Number(p?.[0]) || 0, Number(p?.[1]) || 0]);
    const n = pts.length;
    const segs = [];

    // top loop
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        segs.push([a[0], +halfH, a[1], b[0], +halfH, b[1]]);
    }
    // bottom loop
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        segs.push([a[0], -halfH, a[1], b[0], -halfH, b[1]]);
    }
    // verticals
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        segs.push([a[0], -halfH, a[1], a[0], +halfH, a[1]]);
    }

    const positions = new Float32Array(segs.length * 6);
    for (let i = 0; i < segs.length; i++) {
        const o = i * 6;
        const s = segs[i];
        positions[o + 0] = s[0];
        positions[o + 1] = s[1];
        positions[o + 2] = s[2];
        positions[o + 3] = s[3];
        positions[o + 4] = s[4];
        positions[o + 5] = s[5];
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeBoundingSphere();
    return g;
}

function defaultEdgeIdsForCount(n) {
    if (n === 4) return ['south', 'east', 'north', 'west'];
    return Array.from({ length: n }, (_, i) => `edge_${i}`);
}

function normalizeEdgeIds(edgeIds, n) {
    const base = defaultEdgeIdsForCount(n);
    if (!Array.isArray(edgeIds) || edgeIds.length !== n) return base;
    return edgeIds.map((v, i) => (typeof v === 'string' && v.trim() ? v.trim() : base[i]));
}
const RoomBox = memo(
    forwardRef(function RoomBox(
        {
            room,
            selected,
            onPointerDown,
            dragging,                // ← when true we disable room raycasting entirely
            opacity = 0.12,

            // from SceneInner
            wireframeGlobal = false,

            // labels
            labelsOn = true,
            labelMode = "billboard", // "billboard" | "3d" | "static"
            labelSize = 0.24,
            labelMaxWidth = 24,
            label3DLayers = 8,
            label3DStep = 0.01,
            // NEW: room operator UI
            roomOperatorMode = false,
            onRoomAnchorClick,
            onRoomDelete,
            onRoomResize,
        },
        ref
    ) {
        const { camera, gl } = useThree();
        const raycaster = useMemo(() => new THREE.Raycaster(), []);
        const mouse = useMemo(() => new THREE.Vector2(), []);

        const groupRef = useRef(null);
        const vertexPivotRef = useRef(null);

        const forwardToParent = (node) => {
            if (!ref) return;
            if (typeof ref === "function") ref(node);
            else ref.current = node;
        };

        const setGroupRef = (node) => {
            groupRef.current = node;
        };


        const nodeBounds = room.nodeBounds || {};
        const boundsEnabled = nodeBounds.enabled ?? false;
        const boundsVisible =
            boundsEnabled && (nodeBounds.showBoundary ?? false);

        const isLocked = room.locked;
        const visible = room.visible !== false;
        const size = room.size || [3, 1.6, 2.2];
        const [w, h, d] = size;
        const center = room.center || [0, h * 0.5, 0];
        const [cx, cy, cz] = center;

        // 🔑 In Room Operator we never want to treat the room as "dragging"
        const rotation = room.rotation || [0, 0, 0];

        const halfW = size[0] / 2;
        const halfH = size[1] / 2;
        const halfD = size[2] / 2;

        const [resizeMode, setResizeMode] = useState(false);

        // Polygon (room.poly) support:
        // - poly points are local to the room center in XZ: [[x,z],...]
        const poly = useMemo(() => {
            const raw = room?.poly;
            if (!isValidPoly(raw)) return null;
            return raw.map((p) => [Number(p[0]), Number(p[1])]);
        }, [room?.poly]);
        const isPolyRoom = !!poly;

        // Used for vertex editing even if the room started as a plain box.
        const polyForEdit = useMemo(
            () => (isPolyRoom ? poly : rectPolyFromSize(size[0], size[2])),
            [isPolyRoom, poly, size]
        );

        const edgeIdsForEdit = useMemo(
            () => normalizeEdgeIds(room?.polyEdgeIds, polyForEdit.length),
            [room?.polyEdgeIds, polyForEdit.length]
        );

        const polyB = useMemo(() => polyBounds(polyForEdit), [polyForEdit]);
        const halfW_UI = Math.max(Math.abs(polyB.minX), Math.abs(polyB.maxX));
        const halfD_UI = Math.max(Math.abs(polyB.minZ), Math.abs(polyB.maxZ));
        const uiW = Math.max(0.05, halfW_UI * 2);
        const uiD = Math.max(0.05, halfD_UI * 2);

        // Geometry for poly floor/ceiling + outline edges
        const polyShapeGeo = useMemo(() => {
            if (!isPolyRoom) return null;
            const geo = new THREE.ShapeGeometry(shapeFromPoly(poly));
            geo.computeVertexNormals();
            return geo;
        }, [isPolyRoom, poly]);

        const polyEdges = useMemo(() => {
            if (!isPolyRoom) return null;
            return makePolyEdgesGeometry(poly, halfH);
        }, [isPolyRoom, poly, halfH]);

        useEffect(() => {
            return () => {
                polyShapeGeo?.dispose?.();
                polyEdges?.dispose?.();
            };
        }, [polyShapeGeo, polyEdges]);

        const polyWallSegs = useMemo(() => {
            if (!isPolyRoom) return [];
            const n = poly.length;
            const out = [];
            for (let i = 0; i < n; i++) {
                const a = poly[i];
                const b = poly[(i + 1) % n];
                const dx = b[0] - a[0];
                const dz = b[1] - a[1];
                const len = Math.max(0.0001, Math.hypot(dx, dz));
                const ang = Math.atan2(dz, dx);
                out.push({
                    i,
                    mx: (a[0] + b[0]) * 0.5,
                    mz: (a[1] + b[1]) * 0.5,
                    len,
                    ang,
                });
            }
            return out;
        }, [isPolyRoom, poly]);

        // Vertex editing state (multi-select + drag)
        const [selectedVerts, setSelectedVerts] = useState([]); // indices
        const dragVertsRef = useRef(null);
        const vertexEditEnabled = !!((room.vertexEdit ?? isPolyRoom) && !isLocked);
        const vertexTool = String(room.vertexTool || "both");
        const canAddVerts = vertexTool === "both" || vertexTool === "add";
        const canMoveVerts = vertexTool === "both" || vertexTool === "move";
        const activeEdgeId = useMemo(() => {
            const want = room.vertexEdgeActive != null ? String(room.vertexEdgeActive) : null;
            if (!want) return null;
            return edgeIdsForEdit.some((x) => String(x) === want) ? want : null;
        }, [room.vertexEdgeActive, edgeIdsForEdit]);
        // Vertex editing should work from the inspector as long as the room is selected.
        const editMode = !!(selected && vertexEditEnabled);

        // When editing vertices, retarget the main gizmo to a pivot at the selected vertex/centroid.
        // This prevents the default room gizmo from moving the whole room while in vertex mode.
        useEffect(() => {
            if (!groupRef.current) return;
            if (editMode && canMoveVerts && vertexPivotRef.current) {
                forwardToParent(vertexPivotRef.current);
            } else {
                forwardToParent(groupRef.current);
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [editMode, canMoveVerts, room?.id]);

        useEffect(() => {
            if (!editMode) setSelectedVerts([]);
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [editMode, room?.id]);

        // Sync selection from the Room Inspector
        useEffect(() => {
            const onSet = (ev) => {
                const d = ev?.detail || {};
                if (d.roomId !== room?.id) return;
                if (!Array.isArray(d.indices)) return;
                const next = d.indices.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n));
                setSelectedVerts(next);
            };
            window.addEventListener?.("EPIC3D_ROOM_VERTS_SET_SELECTION", onSet);
            return () => window.removeEventListener?.("EPIC3D_ROOM_VERTS_SET_SELECTION", onSet);
        }, [room?.id]);

        // Emit selection changes back to the inspector
        useEffect(() => {
            if (!editMode) return;
            try {
                window.dispatchEvent(
                    new CustomEvent("EPIC3D_ROOM_VERTS_SELECTION_CHANGED", {
                        detail: { roomId: room.id, indices: selectedVerts },
                    })
                );
            } catch {}
        }, [editMode, room.id, selectedVerts]);

        // floor / ceiling
        const showFloor   = room.floor   ?? true;
        const showCeiling = room.ceiling ?? true;

        // per-wall toggles
        const showWallN = room.wallN ?? true; // +Z
        const showWallS = room.wallS ?? true; // -Z
        const showWallE = room.wallE ?? true; // +X
        const showWallW = room.wallW ?? true; // -X

        // solid vs plane walls
        const wallsSolid    = room.wallsSolid ?? false;
        const wallThickness = clamp(room.wallThickness ?? 0.05, 0.005, Math.min(size[0], size[2]) / 4);

        // follow global wireframe?
        const wireWithGlobal = room.wireWithGlobal ?? false;
        const showSurfaces = !(wireframeGlobal && wireWithGlobal);

        // centered gap (“door”) on a chosen wall
        const gapEnabled = room.gap?.enabled ?? false;
        const gapWall    = room.gap?.wall    ?? "north"; // 'north'|'south'|'east'|'west'
        const gapWidth   = Math.max(0, room.gap?.width ?? Math.min(1, size[0] * 0.33));
        const gapHeight  = Math.max(0, room.gap?.height ?? Math.min(1, size[1] * 0.66));

        // neat outline edges (always shown)
        const boxGeo = useMemo(() => new THREE.BoxGeometry(size[0], size[1], size[2]), [size]);
        const edges  = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo]);
        const labelY = halfH + 0.12;

        // Optional per-room vertex/edge labels (for easier vertex editing)
        const showVertexLabels = !!room.showVertexLabels;
        const showEdgeLabels = !!room.showEdgeLabels;
        const polyForLabels = polyForEdit;
        const edgeIds = edgeIdsForEdit;
        const labelRaycast = useMemo(() => () => null, []);
        const labelYFloor = -halfH + 0.08;

        const color = room.color || "#1b2a44";

        // Material tuning for better, more readable lighting on room surfaces
        const surfaceRoughness = Number(room.surface?.roughness ?? 0.75);
        const surfaceMetalness = Number(room.surface?.metalness ?? 0.02);
        const surfaceEnvIntensity = Number(room.surface?.envMapIntensity ?? 0.9);
        const insideOnly = !!(room.surface?.insideOnly ?? room.insideOnly);

        const surfaceMat = useMemo(() => {
            const mat = new THREE.MeshStandardMaterial({
                color,
                transparent: opacity < 1,
                opacity,
                roughness: Number.isFinite(surfaceRoughness) ? surfaceRoughness : 0.75,
                metalness: Number.isFinite(surfaceMetalness) ? surfaceMetalness : 0.02,
                envMapIntensity: Number.isFinite(surfaceEnvIntensity) ? surfaceEnvIntensity : 0.9,
                side: insideOnly ? THREE.BackSide : THREE.DoubleSide,
                // For transparent surfaces, depthWrite causes "sticking" artifacts.
                depthWrite: opacity >= 0.999,
                depthTest: true,
                blending: THREE.NormalBlending,
            });
            return mat;
        }, [color, opacity, surfaceRoughness, surfaceMetalness, surfaceEnvIntensity, insideOnly]);

        // ---- CORE FIX: block raycasting on *everything* during gizmo drag ----

        // ---- CORE FIX: control hit-testing for locked rooms & dragging ----
        // Large surfaces (floor, ceiling, walls) should be click-through when
        // the room is locked, so nodes behind them always win.
        // And while dragging the gizmo, nothing should be hit-testable.
        const noRaycast = dragging ? () => null : undefined;
        const effectiveDragging = dragging;
        const surfaceRaycast = effectiveDragging ? () => null : undefined;
        const overlayRaycast = effectiveDragging ? () => null : undefined;

// swallow hover/move while dragging so nothing lights up
        const swallow = effectiveDragging ? (e) => e.stopPropagation() : undefined;

        // --- Poly/vertex edit helpers ---
        const planeFloor = useMemo(() => {
            const floorY = (cy ?? 0) - halfH;
            return new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY);
        }, [cy, halfH]);

        const getLocalOnFloorFromClient = (clientX, clientY) => {
            if (!gl?.domElement || !camera || !groupRef.current) return null;
            const rect = gl.domElement.getBoundingClientRect();
            mouse.set(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(mouse, camera);
            const hit = new THREE.Vector3();
            const ok = raycaster.ray.intersectPlane(planeFloor, hit);
            if (!ok) return null;
            const local = hit.clone();
            groupRef.current.worldToLocal(local);
            return local;
        };

        // Apply a polygon (room.poly) patch.
        // IMPORTANT: Do NOT call onRoomResize() for poly edits.
        // In this project, onRoomResize() is primarily used for box resize handles ("left"/"right" etc).
        // Calling it with an object can be misinterpreted and corrupt the room.
        // Instead we broadcast a commit event that the editor/store (and the Right Pane) already listens to.
        const applyPolyPatch = (polyNext, edgeIdsNext, selectionOverride) => {
            if (!Array.isArray(polyNext) || polyNext.length < 3) return;

            const b = polyBounds(polyNext);
            const w2 = Math.max(0.05, b.maxX - b.minX);
            const d2 = Math.max(0.05, b.maxZ - b.minZ);

            const nextEdgeIds = Array.isArray(edgeIdsNext) && edgeIdsNext.length === polyNext.length
                ? edgeIdsNext.map((x) => String(x))
                : edgeIdsForEdit;

            const patch = {
                poly: polyNext,
                polyEdgeIds: nextEdgeIds,
                size: [w2, h, d2],
                vertexEdit: true,
            };

            // Optional hook for any higher-level controllers.
            try {
                window.dispatchEvent(new CustomEvent("EPIC3D_ROOM_PATCH", { detail: { roomId: room.id, patch } }));
            } catch (_) {}

            // Primary path: the Right Pane listens to this and calls setRoom().
            try {
                window.dispatchEvent(
                    new CustomEvent("EPIC3D_ROOM_POLY_COMMIT", {
                        detail: {
                            roomId: room.id,
                            poly: polyNext,
                            size: patch.size,
                            polyEdgeIds: nextEdgeIds,
                            selection: Array.isArray(selectionOverride) ? selectionOverride : selectedVerts,
                        },
                    })
                );
            } catch (_) {}
        };



        // --- Gizmo-driven vertex move ---
        // The app's main gizmo targets the forwarded ref. While in vertex edit mode we forward
        // an internal pivot object and convert its movement into poly vertex deltas.
        const gizmoMoveRef = useRef({ active: false });

        const centroidForSelection = (polyArr, indices) => {
            if (!Array.isArray(indices) || indices.length === 0) return { x: 0, z: 0 };
            let sx = 0, sz = 0, c = 0;
            for (const ii of indices) {
                const i = Math.floor(Number(ii));
                const p = polyArr?.[i];
                if (!p) continue;
                sx += Number(p[0]) || 0;
                sz += Number(p[1]) || 0;
                c++;
            }
            if (!c) return { x: 0, z: 0 };
            return { x: sx / c, z: sz / c };
        };

        useFrame(() => {
            if (!editMode || !canMoveVerts) return;
            const pivot = vertexPivotRef.current;
            if (!pivot) return;

            // Always keep pivot at the selection centroid when not actively dragging the gizmo.
            const c = centroidForSelection(polyForEdit, selectedVerts);
            const desiredX = Number.isFinite(c.x) ? c.x : 0;
            const desiredZ = Number.isFinite(c.z) ? c.z : 0;

            // If there's no selection, keep the pivot pinned to origin so the gizmo can't "drag nothing".
            const hasSel = Array.isArray(selectedVerts) && selectedVerts.length > 0;

            // "dragging" is provided by the parent and is true while the global gizmo is being dragged.
            if (!dragging || !hasSel) {
                gizmoMoveRef.current.active = false;
                pivot.position.set(hasSel ? desiredX : 0, 0, hasSel ? desiredZ : 0);
                pivot.rotation.set(0, 0, 0);
                return;
            }

            const st = gizmoMoveRef.current;
            if (!st.active || st.roomId !== room.id) {
                st.active = true;
                st.roomId = room.id;
                st.startPivot = pivot.position.clone();
                st.startPoly = polyForEdit.map((p) => [p[0], p[1]]);
                st.indices = selectedVerts.slice();
                st.edgeIds = edgeIdsForEdit.slice();
                st.lastDx = 0;
                st.lastDz = 0;
            }

            const dx = pivot.position.x - st.startPivot.x;
            const dz = pivot.position.z - st.startPivot.z;

            // Ignore tiny jitter.
            if (Math.abs(dx - st.lastDx) > 1e-5 || Math.abs(dz - st.lastDz) > 1e-5) {
                st.lastDx = dx;
                st.lastDz = dz;

                const moved = st.startPoly.map((p, i) => {
                    if (st.indices.includes(i)) return [p[0] + dx, p[1] + dz];
                    return [p[0], p[1]];
                });
                applyPolyPatch(moved, st.edgeIds, st.indices);
            }

            // Pin Y to 0 so vertical moves don't affect the room.
            if (pivot.position.y !== 0) pivot.position.y = 0;
        });

        const toggleVertexSelection = (idx, multi) => {
            setSelectedVerts((prev) => {
                if (!multi) return [idx];
                const set = new Set(prev);
                if (set.has(idx)) set.delete(idx);
                else set.add(idx);
                return Array.from(set).sort((a, b) => a - b);
            });
        };

        const beginVertexDrag = ({ idx, clientX, clientY, nextSelection, startPoly }) => {
            const local = getLocalOnFloorFromClient(clientX, clientY);
            if (!local) return;
            // drag baseline is the current poly-for-edit
            const base = Array.isArray(startPoly) && startPoly.length >= 3 ? startPoly : polyForEdit;
            const basePoly = base.map((p) => [p[0], p[1]]);
            dragVertsRef.current = {
                active: true,
                startLocal: [local.x, local.z],
                startPoly: basePoly,
                indices: nextSelection?.length ? nextSelection.slice() : [idx],
            };
        };

        const endVertexDrag = () => {
            if (dragVertsRef.current) dragVertsRef.current.active = false;
            dragVertsRef.current = null;
        };

        useEffect(() => {
            const onMove = (ev) => {
                const st = dragVertsRef.current;
                if (!st?.active) return;
                const local = getLocalOnFloorFromClient(ev.clientX, ev.clientY);
                if (!local) return;

                const dx = local.x - st.startLocal[0];
                const dz = local.z - st.startLocal[1];

                const moved = st.startPoly.map((p, i) => {
                    if (st.indices.includes(i)) return [p[0] + dx, p[1] + dz];
                    return [p[0], p[1]];
                });
                applyPolyPatch(moved, edgeIdsForEdit, st.indices);
            };

            const onUp = () => {
                if (!dragVertsRef.current?.active) return;
                endVertexDrag();
            };

            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onUp);
            return () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                window.removeEventListener("pointercancel", onUp);
            };
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [gl, camera, planeFloor, polyForEdit, room.id, onRoomResize]);

        useEffect(() => {
            if (!editMode) return;
            const onKey = (e) => {
                if (e.key !== "Backspace" && e.key !== "Delete") return;
                if (!selectedVerts.length) return;
                const base = polyForEdit.map((p) => [p[0], p[1]]);
                if (base.length <= 3) return;
                const toRemove = new Set(selectedVerts);
                const keep = base.map((_, i) => i).filter((i) => !toRemove.has(i));
                const next = keep.map((i) => base[i]);
                if (next.length < 3) return;
                const nextEdgeIds = keep.map((i) => edgeIdsForEdit[i]);
                setSelectedVerts([]);
                applyPolyPatch(next, nextEdgeIds, []);
            };
            window.addEventListener("keydown", onKey);
            return () => window.removeEventListener("keydown", onKey);
        }, [editMode, selectedVerts, polyForEdit]);


        // Edges / labels stay clickable when locked (so you can still select the room),


        // --- WALL BUILDER ---
        function SolidOrPlane({ w, h, T }) {
            if (!showSurfaces) return null;

            if (!wallsSolid) {
                // Thin plane walls
                return (
                    <mesh
                        castShadow
                        receiveShadow
                        raycast={surfaceRaycast}      // ⬅️ use surfaceRaycast here
                        onPointerOver={swallow}
                        onPointerMove={swallow}
                    >
                        <planeGeometry args={[w, h]} />
                        <primitive attach="material" object={surfaceMat} />
                    </mesh>
                );
            }

            // Solid box walls
            return (
                <mesh
                    castShadow
                    receiveShadow
                    position={[0, 0, -T / 2]}
                    raycast={surfaceRaycast}          // ⬅️ and here
                    onPointerOver={swallow}
                    onPointerMove={swallow}
                >
                    <boxGeometry args={[w, h, T]} />
                    <primitive attach="material" object={surfaceMat} />
                </mesh>
            );
        }


        // version that composes 4 strips around a centered gap (width=gw, height=gh)
        function WithGap({ w, h, T, gw, gh }) {
            const lrW = clamp((w - gw) * 0.5, 0, w);       // left/right strip width
            const capH = clamp((h - gh) * 0.5, 0, h);      // top/bottom strip height
            const topY = gh * 0.5 + capH * 0.5;
            const botY = -topY;

            const VStrip = ({ width, x }) => {
                if (width <= 0) return null;
                if (!wallsSolid) {
                    return (
                        <mesh castShadow receiveShadow position={[x, 0, 0]} raycast={overlayRaycast} onPointerOver={swallow} onPointerMove={swallow}>
                            <planeGeometry args={[width, h]} />
                            <primitive attach="material" object={surfaceMat} />

                        </mesh>
                    );
                }
                return (
                    <mesh castShadow receiveShadow position={[x, 0, -T / 2]} raycast={overlayRaycast} onPointerOver={swallow} onPointerMove={swallow}>
                        <boxGeometry args={[width, h, T]} />
                        <primitive attach="material" object={surfaceMat} />

                    </mesh>
                );
            };

            const HStrip = ({ height, y }) => {
                if (height <= 0 || gw <= 0) return null;
                if (!wallsSolid) {
                    return (
                        <mesh castShadow receiveShadow position={[0, y, 0]} raycast={overlayRaycast} onPointerOver={swallow} onPointerMove={swallow}>
                            <planeGeometry args={[gw, height]} />
                            <primitive attach="material" object={surfaceMat} />

                        </mesh>
                    );
                }
                return (
                    <mesh castShadow receiveShadow position={[0, y, -T / 2]} raycast={overlayRaycast} onPointerOver={swallow} onPointerMove={swallow}>
                        <boxGeometry args={[gw, height, T]} />
                        <primitive attach="material" object={surfaceMat} />

                    </mesh>
                );
            };

            return (
                <group>
                    <VStrip width={lrW} x={-(gw * 0.5 + lrW * 0.5)} />
                    <VStrip width={lrW} x={(gw * 0.5 + lrW * 0.5)} />
                    <HStrip height={capH} y={topY} />
                    <HStrip height={capH} y={botY} />
                </group>
            );
        }

        function Wall({ length, height, thickness, withGap, gapW, gapH }) {
            if (!showSurfaces) return null;
            if (!withGap) return <SolidOrPlane w={length} h={height} T={thickness} />;
            return <WithGap w={length} h={height} T={thickness} gw={gapW} gh={gapH} />;
        }

        // Floor / Ceiling
        const Floor = () => {
            if (!showSurfaces || !showFloor) return null;
            if (isPolyRoom && polyShapeGeo) {
                return (
                    <mesh
                        rotation={[-Math.PI / 2, 0, 0]}
                        position={[0, -halfH, 0]}
                        receiveShadow
                        castShadow
                        geometry={polyShapeGeo}
                        raycast={surfaceRaycast}
                        onPointerOver={swallow}
                        onPointerMove={swallow}
                    >
                        <primitive attach="material" object={surfaceMat} />
                    </mesh>
                );
            }
            return (
                <mesh
                    rotation={[-Math.PI / 2, 0, 0]}
                    position={[0, -halfH, 0]}
                    receiveShadow
                    castShadow
                    raycast={surfaceRaycast}
                    onPointerOver={swallow}
                    onPointerMove={swallow}
                >
                    <planeGeometry args={[size[0], size[2]]} />
                    <primitive attach="material" object={surfaceMat} />
                </mesh>
            );
        };

        const Ceiling = () => {
            if (!showSurfaces || !showCeiling) return null;
            if (isPolyRoom && polyShapeGeo) {
                return (
                    <mesh
                        rotation={[Math.PI / 2, 0, 0]}
                        position={[0, halfH, 0]}
                        receiveShadow
                        castShadow
                        geometry={polyShapeGeo}
                        raycast={surfaceRaycast}
                        onPointerOver={swallow}
                        onPointerMove={swallow}
                    >
                        <primitive attach="material" object={surfaceMat} />
                    </mesh>
                );
            }
            return (
                <mesh
                    rotation={[Math.PI / 2, 0, 0]}
                    position={[0, halfH, 0]}
                    receiveShadow
                    castShadow
                    raycast={surfaceRaycast}
                    onPointerOver={swallow}
                    onPointerMove={swallow}
                >
                    <planeGeometry args={[size[0], size[2]]} />
                    <primitive attach="material" object={surfaceMat} />
                </mesh>
            );
        };

        // Walls
        const showWallsAny = showWallN || showWallS || showWallE || showWallW;

        const PolyWalls = () => {
            if (!showSurfaces || !showWallsAny || !isPolyRoom) return null;
            return (
                <group>
                    {polyWallSegs.map((seg) => (
                        <group key={`pw_${seg.i}`} position={[seg.mx, 0, seg.mz]} rotation={[0, seg.ang, 0]}>
                            {!wallsSolid ? (
                                <mesh
                                    castShadow
                                    receiveShadow
                                    raycast={surfaceRaycast}
                                    onPointerOver={swallow}
                                    onPointerMove={swallow}
                                >
                                    <planeGeometry args={[seg.len, size[1]]} />
                                    <primitive attach="material" object={surfaceMat} />
                                </mesh>
                            ) : (
                                <mesh
                                    castShadow
                                    receiveShadow
                                    raycast={surfaceRaycast}
                                    onPointerOver={swallow}
                                    onPointerMove={swallow}
                                >
                                    <boxGeometry args={[seg.len, size[1], wallThickness]} />
                                    <primitive attach="material" object={surfaceMat} />
                                </mesh>
                            )}
                        </group>
                    ))}
                </group>
            );
        };

        // Rectangle walls (legacy)
        const WallNorth = () => (!isPolyRoom && showWallN) ? (
            <group position={[0, 0, halfD]}>
                <Wall
                    length={size[0]}
                    height={size[1]}
                    thickness={wallThickness}
                    withGap={gapEnabled && gapWall === "north"}
                    gapW={gapWidth}
                    gapH={gapHeight}
                />
            </group>
        ) : null;

        const WallSouth = () => (!isPolyRoom && showWallS) ? (
            <group position={[0, 0, -halfD]} rotation={[0, Math.PI, 0]}>
                <Wall
                    length={size[0]}
                    height={size[1]}
                    thickness={wallThickness}
                    withGap={gapEnabled && gapWall === "south"}
                    gapW={gapWidth}
                    gapH={gapHeight}
                />
            </group>
        ) : null;

        const WallEast = () => (!isPolyRoom && showWallE) ? (
            <group position={[halfW, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
                <Wall
                    length={size[2]}
                    height={size[1]}
                    thickness={wallThickness}
                    withGap={gapEnabled && gapWall === "east"}
                    gapW={gapWidth}
                    gapH={gapHeight}
                />
            </group>
        ) : null;

        const WallWest = () => (!isPolyRoom && showWallW) ? (
            <group position={[-halfW, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
                <Wall
                    length={size[2]}
                    height={size[1]}
                    thickness={wallThickness}
                    withGap={gapEnabled && gapWall === "west"}
                    gapW={gapWidth}
                    gapH={gapHeight}
                />
            </group>
        ) : null;

        return (
            <group
                ref={setGroupRef}
                position={center}
                rotation={rotation}
                // Mark rooms consistently so global interaction / gizmo systems can identify them.
                userData={{ ...(room?.userData || {}), __epicType: "room", __roomId: room?.id }}
                onPointerDown={(e) => {
                    const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                    if (!isLeft) return;
                    // 1) block rooms during active drag
                    if (effectiveDragging) return;

                    // 2) if any intersection is a node, let the node handle it
                    const hasNodeHit = (e.intersections || []).some((hit) => {
                        if (hit.eventObject?.userData?.__epicType === "node") return true;
                        let o = hit.object;
                        while (o) {
                            if (o.userData?.__epicType === "node") return true;
                            o = o.parent;
                        }
                        return false;
                    });

                    if (hasNodeHit) return; // don't select the room

                    // 3) actually select the room
                    e.stopPropagation();
                    onPointerDown?.(room.id, e);
                }}
                onPointerOver={swallow}
                onPointerMove={swallow}
            >

                {/* Vertex edit pivot (gizmo target). It's an Object3D so it does not get raycasted. */}
                {editMode && canMoveVerts && (
                    <object3D
                        ref={vertexPivotRef}
                        position={[0, 0, 0]}
                        // Keep the same identity markers as the room itself so the global gizmo
                        // system doesn't "lose" the selected room when we retarget to this pivot.
                        userData={{ __epicType: "room", __roomId: room?.id, __epicVertexPivot: true }}
                    />
                )}

                {/* Node boundary visualization */}
                {boundsVisible && (() => {
                    const roomSize = size;
                    const [rw, rh, rd] = roomSize;

                    const padding = nodeBounds.padding ?? 0;
                    const shape = nodeBounds.shape || "box";

                    let width  = Number(nodeBounds.width)  || rw;
                    let height = Number(nodeBounds.height) || rh;
                    let depth  = Number(nodeBounds.depth)  || rd;

                    const innerH = Math.max(0, height - padding * 2);

                    if (shape === "circle") {
                        let radius = Number(nodeBounds.radius);
                        const innerW = Math.max(0, width - padding * 2);
                        const innerD = Math.max(0, depth - padding * 2);
                        if (!Number.isFinite(radius) || radius <= 0) {
                            radius =
                                (Math.min(innerW, innerD) ||
                                    Math.min(rw, rd)) / 2;
                        }
                        if (radius <= 0) return null;

                        return (
                            <group>
                                {/* Top ring in XZ at top of boundary */}
                                <mesh
                                    rotation={[-Math.PI / 2, 0, 0]}
                                    position={[0, innerH / 2 || 0, 0]}
                                >
                                    <ringGeometry
                                        args={[radius * 0.98, radius, 64]}
                                    />
                                    <meshBasicMaterial
                                        color="#22ffff"
                                        transparent
                                        opacity={0.5}
                                        side={THREE.DoubleSide}
                                        depthWrite={false}
                                    />
                                </mesh>
                            </group>
                        );
                    }

                    // Box shape
                    const innerW = Math.max(0, width - padding * 2);
                    const innerD = Math.max(0, depth - padding * 2);

                    if (innerW <= 0 || innerD <= 0 || innerH <= 0) return null;

                    return (
                        <mesh>
                            <boxGeometry
                                args={[innerW, innerH, innerD]}
                            />
                            <meshBasicMaterial
                                color="#22ffff"
                                wireframe
                                transparent
                                opacity={0.35}
                                depthWrite={false}
                            />
                        </mesh>
                    );
                })()}

                <Floor />
                <Ceiling />
                {isPolyRoom ? (
                    <PolyWalls />
                ) : (
                    <>
                        <WallNorth />
                        <WallSouth />
                        <WallEast />
                        <WallWest />
                    </>
                )}

                {/* Optional per-room vertex/edge labels */}
                {(showVertexLabels || showEdgeLabels) && (
                    <group>
                        {showVertexLabels && polyForLabels.map((p, i) => (
                            <Billboard
                                key={`vlabel-${room.id}-${i}`}
                                position={[Number(p?.[0]) || 0, -halfH + 0.08, Number(p?.[1]) || 0]}
                                follow
                            >
                                <Text
                                    raycast={labelRaycast}
                                    fontSize={0.14}
                                    maxWidth={2}
                                    anchorX="center"
                                    anchorY="middle"
                                    depthWrite={false}
                                >
                                    {`v${i}`}
                                </Text>
                            </Billboard>
                        ))}

                        {showEdgeLabels && polyForLabels.map((a, i) => {
                            const n = polyForLabels.length;
                            const b = polyForLabels[(i + 1) % n];
                            const ax = Number(a?.[0]) || 0;
                            const az = Number(a?.[1]) || 0;
                            const bx = Number(b?.[0]) || 0;
                            const bz = Number(b?.[1]) || 0;
                            const mx = (ax + bx) * 0.5;
                            const mz = (az + bz) * 0.5;
                            const txt = edgeIds?.[i] ?? `edge_${i}`;
                            return (
                                <Billboard
                                    key={`elabel-${room.id}-${i}`}
                                    position={[mx, -halfH + 0.08, mz]}
                                    follow
                                >
                                    <Text
                                        raycast={labelRaycast}
                                        fontSize={0.14}
                                        maxWidth={4}
                                        anchorX="center"
                                        anchorY="middle"
                                        depthWrite={false}
                                    >
                                        {txt}
                                    </Text>
                                </Billboard>
                            );
                        })}
                    </group>
                )}
                {/* Room Operator magnet anchors */}
                {roomOperatorMode && onRoomAnchorClick && (
                    <group>
                        {[
                            { key: "north", pos: [0, 0.06,  halfD_UI + 0.02] },  // +Z
                            { key: "south", pos: [0, 0.06, -halfD_UI - 0.02] },  // -Z
                            { key: "east",  pos: [ halfW_UI + 0.02, 0.06, 0] },  // +X
                            { key: "west",  pos: [-halfW_UI - 0.02, 0.06, 0] },  // -X
                        ].map(({ key, pos }) => (
                            <mesh
                                key={key}
                                position={pos}
                                onPointerDown={(e) => {
                                    const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                    if (!isLeft) return;
                                    e.stopPropagation();
                                    console.log("[RoomBox] magnet clicked", {
                                        roomId: room.id,
                                        side: key,
                                    });
                                    if (!dragging && onRoomAnchorClick) {
                                        onRoomAnchorClick(room.id, key);
                                    }
                                }}
                            >
                                <sphereGeometry args={[0.08, 16, 16]} />
                                <meshBasicMaterial
                                    color="#22c55e"
                                    transparent
                                    opacity={0.95}
                                    depthWrite={false}
                                />
                            </mesh>
                        ))}
                    </group>
                )}



                {/* Edges — also non-raycast when dragging */}
                <lineSegments
                    geometry={isPolyRoom && polyEdges ? polyEdges : edges}
                    raycast={overlayRaycast}
                    onPointerOver={swallow}
                    onPointerMove={swallow}
                >
                    <DissolveEdgesMaterial
                        color={selected ? "#00e1ff" : "#8aa1c3"}
                        gap={room.gapShader || { size: 0.14, falloff: 0.06, center: [0, 0, 0] }}
                    />
                </lineSegments>

                {/* Vertex editor (add/multi-select/drag) */}
                {editMode && (
                    <group>
                        {/* Mid-edge "breakpoint" handles (click to insert a vertex) */}
                        {polyForEdit.map((a, i) => {
                            if (!canAddVerts) return null;
                            const edgeIdHere = edgeIdsForEdit[i];
                            if (activeEdgeId && String(edgeIdHere) !== activeEdgeId) return null;

                            const b = polyForEdit[(i + 1) % polyForEdit.length];
                            const mx = (a[0] + b[0]) * 0.5;
                            const mz = (a[1] + b[1]) * 0.5;
                            const insertAt = i + 1;
                            const onInsertDown = (e) => {
                                const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                if (!isLeft) return;
                                e.stopPropagation();
                                if (dragging) return;
                                const base = polyForEdit.map((p) => [p[0], p[1]]);
                                const edgeId = edgeIdsForEdit[i];
                                const next = base.slice(0, insertAt).concat([[mx, mz]], base.slice(insertAt));
                                const nextEdgeIds = edgeIdsForEdit.slice(0, insertAt).concat([edgeId], edgeIdsForEdit.slice(insertAt));
                                setSelectedVerts([insertAt]);
                                applyPolyPatch(next, nextEdgeIds, [insertAt]);
                                if (canMoveVerts) {
                                    beginVertexDrag({ idx: insertAt, clientX: e.clientX, clientY: e.clientY, nextSelection: [insertAt], startPoly: next });
                                }
                            };

                            return (
                                <group key={`mid_${i}`}>
                                    <mesh position={[mx, -halfH + 0.03, mz]} onPointerDown={onInsertDown}>
                                        <sphereGeometry args={[0.055, 14, 14]} />
                                        <meshBasicMaterial color="#f59e0b" transparent opacity={0.9} depthWrite={false} />
                                    </mesh>
                                    <mesh position={[mx, halfH - 0.03, mz]} onPointerDown={onInsertDown}>
                                        <sphereGeometry args={[0.055, 14, 14]} />
                                        <meshBasicMaterial color="#f59e0b" transparent opacity={0.55} depthWrite={false} />
                                    </mesh>
                                </group>
                            );
                        })}

                        {/* Vertex handles (Shift=add, Ctrl/⌘=toggle, drag to move selection) */}
                        {polyForEdit.map(([x, z], i) => {
                            const isSel = selectedVerts.includes(i);
                            const onVertDown = (e) => {
                                const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                if (!isLeft) return;
                                e.stopPropagation();
                                if (dragging) return;

                                // selection semantics:
                                // - Ctrl/⌘: toggle
                                // - Shift: add
                                // - otherwise: replace
                                const isToggle = !!(e.ctrlKey || e.metaKey);
                                const isAdd = !!e.shiftKey;
                                let nextSel;
                                if (!isToggle && !isAdd) {
                                    // If you click a vertex that is already selected, keep the current multi-selection
                                    // so you can drag the whole selection without holding modifiers.
                                    nextSel = selectedVerts.includes(i) && selectedVerts.length ? selectedVerts.slice() : [i];
                                } else {
                                    const set = new Set(selectedVerts);
                                    if (isToggle) {
                                        if (set.has(i)) set.delete(i);
                                        else set.add(i);
                                    } else {
                                        set.add(i);
                                    }
                                    nextSel = Array.from(set).sort((a, b) => a - b);
                                    if (nextSel.length === 0) nextSel = [i];
                                }
                                setSelectedVerts(nextSel);
                                if (canMoveVerts) beginVertexDrag({ idx: i, clientX: e.clientX, clientY: e.clientY, nextSelection: nextSel });
                            };

                            return (
                                <group key={`v_${i}`}>
                                    <mesh position={[x, -halfH + 0.04, z]} onPointerDown={onVertDown}>
                                        <sphereGeometry args={[0.07, 16, 16]} />
                                        <meshBasicMaterial color={isSel ? "#38bdf8" : "#60a5fa"} transparent opacity={0.95} depthWrite={false} />
                                    </mesh>
                                    <mesh position={[x, halfH - 0.04, z]} onPointerDown={onVertDown}>
                                        <sphereGeometry args={[0.07, 16, 16]} />
                                        <meshBasicMaterial color={isSel ? "#38bdf8" : "#60a5fa"} transparent opacity={0.55} depthWrite={false} />
                                    </mesh>
                                </group>
                            );
                        })}
                    </group>
                )}
                {/* ROOM OPERATOR: big clickable UI for floorplan editing */}
                {roomOperatorMode && (
                    <>
                        {/* DELETE + MODIFY icons (billboarded, with large invisible hitboxes) */}
                        <Billboard position={[0, halfH + 0.25, 0]}>
                            <group>
                                {/* Delete hit area */}
                                <mesh
                                    position={[-0.35, 0, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomDelete && onRoomDelete(room.id);
                                    }}
                                >
                                    {/* Big invisible box for easy clicking */}
                                    <boxGeometry args={[0.5, 0.3, 0.05]} />
                                    <meshBasicMaterial
                                        transparent
                                        opacity={0}  // invisible, only used for picking
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Visible delete icon */}
                                <Text
                                    position={[-0.35, 0, 0.02]}
                                    fontSize={0.18}
                                    color="#ef4444"
                                    depthWrite={false}
                                >
                                    ✕
                                </Text>

                                {/* Modify hit area */}
                                <mesh
                                    position={[0.35, 0, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        setResizeMode((v) => !v);
                                    }}
                                >
                                    <boxGeometry args={[0.5, 0.3, 0.05]} />
                                    <meshBasicMaterial
                                        transparent
                                        opacity={0}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Visible modify icon */}
                                <Text
                                    position={[0.35, 0, 0.02]}
                                    fontSize={0.18}
                                    color={resizeMode ? "#38bdf8" : "#0ea5e9"}
                                    depthWrite={false}
                                >
                                    ⇔
                                </Text>
                            </group>
                        </Billboard>

                        {/* SIDE HANDLES for new rooms: Up / Down / Left / Right */}
                        {onRoomAnchorClick && (
                            <group>
                                {/* Up (+Z) */}
                                <mesh
                                    position={[0, 0.02, halfD_UI + 0.12]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomAnchorClick(room.id, "up");
                                    }}
                                >
                                    <boxGeometry args={[uiW * 0.4, 2.04, 0.18]} />
                                    <meshBasicMaterial
                                        color="#22c55e"
                                        transparent
                                        opacity={0.9}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Down (-Z) */}
                                <mesh
                                    position={[0, 0.02, -halfD_UI - 0.12]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomAnchorClick(room.id, "down");
                                    }}
                                >
                                    <boxGeometry args={[uiW * 0.4, 2.04, 0.18]} />
                                    <meshBasicMaterial
                                        color="#22c55e"
                                        transparent
                                        opacity={0.9}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Right (+X) */}
                                <mesh
                                    position={[halfW_UI + 0.12, 0.02, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomAnchorClick(room.id, "right");
                                    }}
                                >
                                    <boxGeometry args={[0.18, 2.04, uiD * 0.4]} />
                                    <meshBasicMaterial
                                        color="#22c55e"
                                        transparent
                                        opacity={0.9}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Left (-X) */}
                                <mesh
                                    position={[-halfW_UI - 0.12, 0.02, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomAnchorClick(room.id, "left");
                                    }}
                                >
                                    <boxGeometry args={[0.18, 2.04, uiD * 0.4]} />
                                    <meshBasicMaterial
                                        color="#22c55e"
                                        transparent
                                        opacity={0.9}
                                        depthWrite={false}
                                    />
                                </mesh>
                            </group>
                        )}

                        {/* RESIZE HANDLES – only when Modify is active */}
                        {resizeMode && onRoomResize && (
                            <group>
                                {/* Grow to the right */}
                                <mesh
                                    position={[halfW_UI * 0.6, 2.01, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomResize(room.id, "right");
                                    }}
                                >
                                    <boxGeometry args={[0.42, 0.03, uiD * 0.5]} />
                                    <meshBasicMaterial
                                        color="#38bdf8"
                                        transparent
                                        opacity={0.85}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Grow to the left */}
                                <mesh
                                    position={[-halfW_UI * 0.6, 2.01, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomResize(room.id, "left");
                                    }}
                                >
                                    <boxGeometry args={[0.42, 0.03, uiD * 0.5]} />
                                    <meshBasicMaterial
                                        color="#38bdf8"
                                        transparent
                                        opacity={0.85}
                                        depthWrite={false}
                                    />
                                </mesh>
                            </group>
                        )}
                    </>
                )}


                {/* Labels */}
                {labelsOn && room?.name && (
                    <>
                        {labelMode === "billboard" && (
                            <Billboard follow position={[0, labelY, 0]}>
                                <Text
                                    fontSize={labelSize}
                                    maxWidth={labelMaxWidth}
                                    anchorX="center"
                                    anchorY="bottom"
                                    color="white"
                                    outlineWidth={0.005}
                                    outlineColor="#000"
                                    depthTest={false}
                                    depthWrite={false}
                                    renderOrder={9999}
                                    raycast={overlayRaycast}
                                    onPointerOver={swallow}
                                    onPointerMove={swallow}
                                >
                                    {room.name}
                                </Text>
                            </Billboard>
                        )}

                        {labelMode === "3d" && (
                            <group position={[0, labelY, 0]}>
                                {Array.from({ length: label3DLayers }).map((_, i) => (
                                    <Text
                                        key={`rf${i}`}
                                        position={[0, 0, -i * label3DStep]}
                                        fontSize={labelSize}
                                        maxWidth={labelMaxWidth}
                                        anchorX="center"
                                        anchorY="bottom"
                                        color="white"
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                        raycast={overlayRaycast}
                                        onPointerOver={swallow}
                                        onPointerMove={swallow}
                                    >
                                        {room.name}
                                    </Text>
                                ))}
                            </group>
                        )}
                        {labelMode === "static" && (
                            <group position={[0, labelY, 0]}>
                                <Text
                                    fontSize={labelSize}
                                    maxWidth={labelMaxWidth}
                                    anchorX="center"
                                    anchorY="bottom"
                                    color="white"
                                    depthTest={false}
                                    depthWrite={false}
                                    renderOrder={9999}
                                    raycast={overlayRaycast}
                                    onPointerOver={swallow}
                                    onPointerMove={swallow}
                                >
                                    {room.name}
                                </Text>
                            </group>
                        )}
                    </>
                )}
            </group>
        );
    })
);

export default RoomBox;

import React, { useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { snapValue } from "../utils/math";

/**
 * InteractionLayer
 * - Basic click-to-place for nodes/switches/rooms (single mode)
 * - Room draw modes:
 *   - roomDrawMode="box": 2-click square draw with live preview
 *   - roomDrawMode="points": click to place points, Enter/Finalize to create polygon room
 *
 * Emits onPlace(kind, position, multi, extra?)
 * - For room box/points: kind="room", position is [cx, 0, cz], extra={ size:[w,h,d], poly?: [[lx,lz],...] }
 */
export default function InteractionLayer({
                                           armed,
                                           placeKind,
                                           multi,
                                           snap = 0.25,
                                           onPlace,
                                           modelRef,
                                           roomDrawMode = "single", // "single" | "box" | "points"
                                         }) {
  const { gl, camera } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useMemo(() => new THREE.Vector2(), []);
  const groundRef = useRef();

  // room draw state (kept local to the scene)
  const [boxStart, setBoxStart] = useState(null); // [x, z]
  const [boxEnd, setBoxEnd] = useState(null);     // [x, z]
  const [points, setPoints] = useState([]);       // [[x,z],...]
  const [hoverXZ, setHoverXZ] = useState(null);   // [x,z]

  const defaultRoomH = 1.6;

  const activeRoomMode =
      armed && placeKind === "room" ? (roomDrawMode || "single") : "single";

  const setMouseFromEvent = (e) => {
    const rect = gl.domElement.getBoundingClientRect();
    mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  };

  const getSnappedHit = (e) => {
    setMouseFromEvent(e);
    raycaster.setFromCamera(mouse, camera);

    const candidates = [];

    // 1) Imported model (if present)
    if (modelRef?.current) {
      const modelHits = raycaster.intersectObject(modelRef.current, true);
      if (modelHits && modelHits.length) candidates.push(modelHits[0]);
    }

    // 2) Ground plane (always present)
    if (groundRef.current) {
      const groundHits = raycaster.intersectObject(groundRef.current, false);
      if (groundHits && groundHits.length) candidates.push(groundHits[0]);
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => a.distance - b.distance);
    const hit = candidates[0];
    const p = hit.point;

    const snapped = [
      snapValue(p.x, snap),
      snapValue(p.y, snap),
      snapValue(p.z, snap),
    ];

    // Slight lift when dropping on ground to avoid z-fighting
    if (hit.object === groundRef.current) snapped[1] = Math.max(snapped[1], 0.0);

    return snapped;
  };

  const resetRoomBox = () => {
    setBoxStart(null);
    setBoxEnd(null);
  };
  const resetRoomPoints = () => {
    setPoints([]);
    setHoverXZ(null);
  };

  const finalizePointsRoom = () => {
    if (points.length < 3) return;

    // compute bounds in world XZ
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }

    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const w = Math.max(0.05, maxX - minX);
    const d = Math.max(0.05, maxZ - minZ);

    const localPoly = points.map(([x, z]) => [x - cx, z - cz]);

    onPlace && onPlace("room", [cx, 0, cz], multi, { size: [w, defaultRoomH, d], poly: localPoly });

    resetRoomPoints();
  };

  const finalizeBoxRoom = () => {
    if (!boxStart || !boxEnd) return;
    const [x0, z0] = boxStart;
    const [x1, z1] = boxEnd;

    const cx = (x0 + x1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    const w = Math.max(0.05, Math.abs(x1 - x0));
    const d = Math.max(0.05, Math.abs(z1 - z0));

    onPlace && onPlace("room", [cx, 0, cz], multi, { size: [w, defaultRoomH, d] });
    resetRoomBox();
  };

  // DOM listeners (pointerdown / pointermove / keydown)
  useEffect(() => {
    if (!armed) return;

    const dom = gl.domElement;

    const onPointerDown = (e) => {
      if (typeof e.button !== "undefined" && e.button !== 0) return;

      const snapped = getSnappedHit(e);
      if (!snapped) return;

      // Normal single-click placing (nodes/switches or room single)
      if (placeKind !== "room" || activeRoomMode === "single") {
        onPlace && onPlace(placeKind, snapped, multi);
        return;
      }

      // Room draw: box mode (2-click)
      if (activeRoomMode === "box") {
        const x = snapped[0];
        const z = snapped[2];

        if (!boxStart) {
          setBoxStart([x, z]);
          setBoxEnd([x, z]);
          return;
        }

        // second click: finalize
        setBoxEnd([x, z]);
        finalizeBoxRoom();
        return;
      }

      // Room draw: points mode
      if (activeRoomMode === "points") {
        const x = snapped[0];
        const z = snapped[2];
        setPoints((prev) => [...prev, [x, z]]);
        setHoverXZ([x, z]);
      }
    };

    const onPointerMove = (e) => {
      if (!armed || placeKind !== "room") return;

      const snapped = getSnappedHit(e);
      if (!snapped) return;
      const x = snapped[0];
      const z = snapped[2];

      if (activeRoomMode === "box" && boxStart) {
        setBoxEnd([x, z]);
      }
      if (activeRoomMode === "points") {
        setHoverXZ([x, z]);
      }
    };

    const onKeyDown = (e) => {
      if (!armed || placeKind !== "room") return;

      if (e.key === "Escape") {
        resetRoomBox();
        resetRoomPoints();
        return;
      }
      if (e.key === "Enter") {
        if (activeRoomMode === "points") finalizePointsRoom();
      }
    };

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, placeKind, multi, snap, gl, camera, modelRef, onPlace, activeRoomMode, boxStart, boxEnd, points]);

  // Custom UI events (Finalize / Clear / Cancel)
  useEffect(() => {
    if (!armed) return;

    const onFinalize = () => finalizePointsRoom();
    const onClear = () => resetRoomPoints();
    const onCancelBox = () => resetRoomBox();

    window.addEventListener("EPIC3D_FINALIZE_ROOM_POINTS", onFinalize);
    window.addEventListener("EPIC3D_CLEAR_ROOM_POINTS", onClear);
    window.addEventListener("EPIC3D_CANCEL_ROOM_BOX", onCancelBox);

    return () => {
      window.removeEventListener("EPIC3D_FINALIZE_ROOM_POINTS", onFinalize);
      window.removeEventListener("EPIC3D_CLEAR_ROOM_POINTS", onClear);
      window.removeEventListener("EPIC3D_CANCEL_ROOM_BOX", onCancelBox);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, points, boxStart, boxEnd, activeRoomMode]);

  // --- Preview geometry ---
  const boxPreview = useMemo(() => {
    if (activeRoomMode !== "box" || !boxStart || !boxEnd) return null;
    const [x0, z0] = boxStart;
    const [x1, z1] = boxEnd;
    const w = Math.max(0.05, Math.abs(x1 - x0));
    const d = Math.max(0.05, Math.abs(z1 - z0));
    const cx = (x0 + x1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    return { w, d, cx, cz };
  }, [activeRoomMode, boxStart, boxEnd]);

  const pointsLineGeo = useMemo(() => {
    if (activeRoomMode !== "points") return null;
    const pts = [...points];
    if (hoverXZ && points.length) pts.push(hoverXZ);

    if (pts.length < 2) return null;

    const arr = new Float32Array(pts.length * 3);
    pts.forEach(([x, z], i) => {
      arr[i * 3 + 0] = x;
      arr[i * 3 + 1] = 0.02;
      arr[i * 3 + 2] = z;
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [activeRoomMode, points, hoverXZ]);

  // Invisible ground + preview helpers
  return (
      <>
        <mesh ref={groundRef} rotation={[Math.PI * -0.5, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[2000, 2000, 1, 1]} />
          <meshBasicMaterial visible={false} />
        </mesh>

        {/* Box draw preview */}
        {boxPreview && (
            <mesh position={[boxPreview.cx, defaultRoomH * 0.5, boxPreview.cz]}>
              <boxGeometry args={[boxPreview.w, defaultRoomH, boxPreview.d]} />
              <meshBasicMaterial wireframe transparent opacity={0.35} depthWrite={false} />
            </mesh>
        )}

        {/* Points draw preview */}
        {activeRoomMode === "points" && points.length > 0 && (
            <group>
              {points.map(([x, z], i) => (
                  <mesh key={i} position={[x, 0.03, z]}>
                    <sphereGeometry args={[0.06, 14, 14]} />
                    <meshBasicMaterial transparent opacity={0.85} depthWrite={false} />
                  </mesh>
              ))}

              {pointsLineGeo && (
                  <line geometry={pointsLineGeo}>
                    <lineBasicMaterial transparent opacity={0.85} />
                  </line>
              )}
            </group>
        )}
      </>
  );
}

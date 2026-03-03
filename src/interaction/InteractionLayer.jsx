import React, { useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { snapValue } from "../utils/math";

/**
 * InteractionLayer
 * - Click-to-place for nodes/switches/rooms
 * - Room draw modes:
 *   - "single": click place
 *   - "box": 2-click box
 *   - "points": polygon room
 *
 * Touch gestures:
 * - 2 fingers: dolly (forward/back)
 * - 3 fingers: pan (left/right/up/down)
 */
export default function InteractionLayer({
                                           armed,
                                           placeKind,
                                           multi,
                                           snap = 0.25,
                                           onPlace,
                                           modelRef,
                                           roomDrawMode = "single",
                                           roomHeightScale = true,
                                           roomHeightValue = 1.6,
                                         }) {
  const { gl, camera } = useThree();

  const raycaster = useMemo(() => {
    const rc = new THREE.Raycaster();
    if ("firstHitOnly" in rc) rc.firstHitOnly = true;
    return rc;
  }, []);
  const mouse = useMemo(() => new THREE.Vector2(), []);
  const groundRef = useRef();
  const modelHitsRef = useRef([]);
  const groundHitsRef = useRef([]);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.01), []);
  const groundHitPoint = useMemo(() => new THREE.Vector3(), []);

  // ─────────────────────────────────────────────
  // Room draw state
  // ─────────────────────────────────────────────
  const [boxStart, setBoxStart] = useState(null);
  const [boxEnd, setBoxEnd] = useState(null);
  const [boxHeight, setBoxHeight] = useState(null);
  const boxStartScreenYRef = useRef(null);
  const boxHeightStartRef = useRef(null);
  const boxBaseYRef = useRef(0);
  const [boxPhase, setBoxPhase] = useState(0); // 0 idle, 1 footprint, 2 height
  const heightDragPlaneRef = useRef(null);
  const heightDragHitRef = useRef(new THREE.Vector3());
  const [points, setPoints] = useState([]);
  const [hoverXZ, setHoverXZ] = useState(null);

  const defaultRoomH = Math.max(0.2, Number(roomHeightValue) || 1.6);
  const previewY = 0.02;
  const previewColor = "#22d3ee";
  const previewHintColor = "#f59e0b";

  const activeRoomMode =
      armed && placeKind === "room" ? roomDrawMode : "single";

  // ─────────────────────────────────────────────
  // Touch gesture state (ref, not state)
  // ─────────────────────────────────────────────
  const touchState = useRef({
    mode: null,        // "dolly" | "pan"
    startDist: 0,
    startMid: [0, 0],
  });

  // ─────────────────────────────────────────────
  // Raycasting helpers
  // ─────────────────────────────────────────────
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

    const modelHits = modelHitsRef.current;
    const groundHits = groundHitsRef.current;
    modelHits.length = 0;
    groundHits.length = 0;

    if (modelRef?.current) {
      raycaster.intersectObject(modelRef.current, true, modelHits);
    }

    let groundDistance = Infinity;
    let groundPoint = null;
    if (raycaster.ray.intersectPlane(groundPlane, groundHitPoint)) {
      groundPoint = groundHitPoint;
      groundDistance = raycaster.ray.origin.distanceTo(groundPoint);
    } else if (groundRef.current) {
      raycaster.intersectObject(groundRef.current, false, groundHits);
      if (groundHits[0]) {
        groundPoint = groundHits[0].point;
        groundDistance = groundHits[0].distance;
      }
    }

    const modelHit = modelHits[0];
    const hitPoint = modelHit && groundPoint
        ? (modelHit.distance <= groundDistance ? modelHit.point : groundPoint)
        : (modelHit ? modelHit.point : groundPoint);

    if (!hitPoint) return null;
    const p = hitPoint;

    const snapped = [
      snapValue(p.x, snap),
      snapValue(p.y, snap),
      snapValue(p.z, snap),
    ];

    if (!modelHit || (groundPoint && groundDistance < modelHit.distance)) {
      snapped[1] = Math.max(snapped[1], 0);
    }

    return snapped;
  };

  const axisLockPoint = (x, z, last) => {
    if (!last) return [x, z];
    const dx = x - last[0];
    const dz = z - last[1];
    if (Math.abs(dx) >= Math.abs(dz)) return [x, last[1]];
    return [last[0], z];
  };

  const buildLineGeometry = (pts, close = false) => {
    if (!Array.isArray(pts) || pts.length < 2) return null;
    const coords = [];
    for (const p of pts) {
      if (!p || p.length < 2) continue;
      coords.push(Number(p[0]) || 0, previewY, Number(p[1]) || 0);
    }
    if (close && pts[0]) {
      coords.push(Number(pts[0][0]) || 0, previewY, Number(pts[0][1]) || 0);
    }
    if (coords.length < 6) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(coords), 3));
    const count = g.attributes?.position?.count;
    if (Number.isFinite(count) && count > 0) g.setDrawRange(0, count);
    g.computeBoundingSphere();
    return g;
  };

  // ─────────────────────────────────────────────
  // Room finalize helpers
  // ─────────────────────────────────────────────
  const resetRoomBox = () => {
    setBoxStart(null);
    setBoxEnd(null);
    setBoxHeight(null);
    boxStartScreenYRef.current = null;
    boxHeightStartRef.current = null;
    boxBaseYRef.current = 0;
    heightDragPlaneRef.current = null;
    setBoxPhase(0);
  };

  const resetRoomPoints = () => {
    setPoints([]);
    setHoverXZ(null);
  };

  const finalizeBoxRoom = () => {
    if (!boxStart || !boxEnd) return;

    const [x0, z0] = boxStart;
    const [x1, z1] = boxEnd;

    const cx = (x0 + x1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    const w = Math.max(0.05, Math.abs(x1 - x0));
    const d = Math.max(0.05, Math.abs(z1 - z0));

    const baseY = Number(boxBaseYRef.current) || 0;
    const h = Math.max(0.2, Number(boxHeight) || defaultRoomH);
    onPlace?.("room", [cx, baseY + h * 0.5, cz], false, {
      size: [w, h, d],
      drawMode: "box",
    });

    resetRoomBox();
  };

  const finalizePointsRoom = (ptsOverride = null) => {
    const src = Array.isArray(ptsOverride) ? ptsOverride : points;
    if (src.length < 3) return;

    let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;

    for (const [x, z] of src) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const w = Math.max(0.05, maxX - minX);
    const d = Math.max(0.05, maxZ - minZ);

    const poly = src.map(([x, z]) => [x - cx, z - cz]);

    onPlace?.("room", [cx, defaultRoomH * 0.5, cz], false, {
      size: [w, defaultRoomH, d],
      poly,
      drawMode: "points",
    });

    resetRoomPoints();
  };

  const mirrorPointsRoom = () => {
    if (points.length < 2) return;
    const a = points[0];
    const b = points[points.length - 1];
    const dx = (b[0] - a[0]);
    const dz = (b[1] - a[1]);
    const len = Math.hypot(dx, dz);
    const ux = len > 1e-4 ? dx / len : 1;
    const uz = len > 1e-4 ? dz / len : 0;

    const reflect = (p) => {
      const vx = p[0] - a[0];
      const vz = p[1] - a[1];
      const dot = vx * ux + vz * uz;
      const projX = a[0] + ux * dot;
      const projZ = a[1] + uz * dot;
      return [2 * projX - p[0], 2 * projZ - p[1]];
    };

    const mirrorCore = [];
    for (let i = points.length - 2; i >= 1; i -= 1) {
      mirrorCore.push(reflect(points[i]));
    }
    const merged = [...points, ...mirrorCore];
    finalizePointsRoom(merged);
  };

  // ─────────────────────────────────────────────
  // DOM & Touch listeners
  // ─────────────────────────────────────────────
  useEffect(() => {
    const dom = gl.domElement;

    // ── Pointer (mouse / pen)
    const onPointerDown = (e) => {
      if (!armed) return;
      if (e.button !== 0) return;

      const hit = getSnappedHit(e);
      if (!hit) return;

      const multiPlace = placeKind === "room" ? false : !!e.shiftKey;

      if (placeKind !== "room" || activeRoomMode === "single") {
        onPlace?.(placeKind, hit, multiPlace);
        return;
      }

      if (activeRoomMode === "box") {
        const [x, y, z] = hit;
        if (!boxStart) {
          setBoxStart([x, z]);
          setBoxEnd([x, z]);
          setBoxHeight(defaultRoomH);
          boxBaseYRef.current = Number(y) || 0;
          boxStartScreenYRef.current = e.clientY;
          setBoxPhase(1);
        } else {
          if (roomHeightScale) {
            if (boxPhase === 1) {
              setBoxEnd([x, z]);
              boxStartScreenYRef.current = e.clientY;
              boxHeightStartRef.current = Number(boxHeight) || defaultRoomH;
              const cx = (boxStart[0] + x) * 0.5;
              const cz = (boxStart[1] + z) * 0.5;
              const baseY = Number(boxBaseYRef.current) || 0;
              const camRight = new THREE.Vector3(1, 0, 0);
              camera.updateMatrixWorld(true);
              camera.getWorldDirection(camRight);
              camRight.cross(camera.up).normalize();
              const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
                  camRight,
                  new THREE.Vector3(cx, baseY, cz)
              );
              heightDragPlaneRef.current = plane;
              setBoxPhase(2);
            } else {
              finalizeBoxRoom();
            }
          } else {
            setBoxEnd([x, z]);
            setBoxHeight(defaultRoomH);
            finalizeBoxRoom();
          }
        }
      }

      if (activeRoomMode === "points") {
        let [x, , z] = hit;
        if (e.shiftKey && points.length) {
          [x, z] = axisLockPoint(x, z, points[points.length - 1]);
        }
        setPoints((p) => [...p, [x, z]]);
        setHoverXZ([x, z]);
      }
    };

    const onPointerMove = (e) => {
      if (!armed || placeKind !== "room") return;
      const hit = getSnappedHit(e);
      if (!hit) return;

      const [x, , z] = hit;

      if (activeRoomMode === "box" && boxStart) {
        if (boxPhase === 1) {
          setBoxEnd([x, z]);
        } else if (boxPhase === 2 && roomHeightScale && boxStartScreenYRef.current != null) {
          const plane = heightDragPlaneRef.current;
          if (plane) {
            setMouseFromEvent(e);
            raycaster.setFromCamera(mouse, camera);
            if (raycaster.ray.intersectPlane(plane, heightDragHitRef.current)) {
              const baseY = Number(boxBaseYRef.current) || 0;
              const y = heightDragHitRef.current.y;
              if (Number.isFinite(y)) {
                setBoxHeight(Math.max(0.2, y - baseY));
                return;
              }
            }
          }
          const rect = gl.domElement.getBoundingClientRect();
          const cx = (boxStart[0] + (boxEnd?.[0] ?? boxStart[0])) * 0.5;
          const cz = (boxStart[1] + (boxEnd?.[1] ?? boxStart[1])) * 0.5;
          const up = new THREE.Vector3(0, 1, 0);
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          if (Math.abs(camDir.dot(up)) > 0.92) {
            const dy = boxStartScreenYRef.current - e.clientY;
            const fov = (camera.fov || 60) * (Math.PI / 180);
            const baseY = Number(boxBaseYRef.current) || 0;
            const center = new THREE.Vector3(cx, baseY, cz);
            const toCenter = center.clone().sub(camera.position);
            const depth = Math.max(0.1, camDir.dot(toCenter));
            const unitsPerPixel = (2 * Math.tan(fov * 0.5) * depth) / Math.max(1, rect.height);
            const startH = boxHeightStartRef.current ?? defaultRoomH;
            setBoxHeight(Math.max(0.2, startH + dy * unitsPerPixel));
          } else {
            const p0 = new THREE.Vector3(cx, 0, cz).project(camera);
            const p1 = new THREE.Vector3(cx, 1, cz).project(camera);
            const y0 = (1 - (p0.y + 1) * 0.5) * rect.height + rect.top;
            const y1 = (1 - (p1.y + 1) * 0.5) * rect.height + rect.top;
            const denom = y0 - y1;
            if (Math.abs(denom) > 1e-6) {
              const ratio = (y0 - e.clientY) / denom;
              setBoxHeight(Math.max(0.2, ratio));
            }
          }
        }
      }

      if (activeRoomMode === "points") {
        let hx = x;
        let hz = z;
        if (e.shiftKey && points.length) {
          [hx, hz] = axisLockPoint(hx, hz, points[points.length - 1]);
        }
        setHoverXZ([hx, hz]);
      }
    };

    // ── Touch gestures
    const onTouchStart = (e) => {
      console.log("TOUCH START", e.touches.length);

      if (e.touches.length === 2) {
        e.preventDefault();

        const [a, b] = e.touches;
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;

        touchState.current.mode = "dolly";
        touchState.current.startDist = Math.hypot(dx, dy);
        touchState.current.startMid = [
          (a.clientX + b.clientX) * 0.5,
          (a.clientY + b.clientY) * 0.5,
        ];
      }


      if (e.touches.length === 3) {
        const xs = [...e.touches].map((t) => t.clientX);
        const ys = [...e.touches].map((t) => t.clientY);

        touchState.current.mode = "pan";
        touchState.current.startMid = [
          xs.reduce((a, b) => a + b, 0) / 3,
          ys.reduce((a, b) => a + b, 0) / 3,
        ];
      }
    };

    const onTouchMove = (e) => {
      const state = touchState.current;
      if (!state.mode) return;

      e.preventDefault();

      if (state.mode === "dolly" && e.touches.length === 2) {
        e.preventDefault();

        const [a, b] = e.touches;
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;
        const dist = Math.hypot(dx, dy);
        const mid = [
          (a.clientX + b.clientX) * 0.5,
          (a.clientY + b.clientY) * 0.5,
        ];

        if (state.startDist <= 0) {
          state.startDist = dist;
          state.startMid = mid;
          return;
        }

        // ?? SCALE, not delta
        const scale = dist / state.startDist;

        // dead-zone
        if (Math.abs(scale - 1) >= 0.01) {
          state.startDist = dist;
          state.startMid = mid;

          window.dispatchEvent(
              new CustomEvent("EPIC3D_CAMERA_DOLLY", {
                detail: { scale }
              })
          );
          return;
        }

        if (state.startMid) {
          const dyMid = mid[1] - state.startMid[1];
          if (Math.abs(dyMid) >= 3) {
            const dragScale = THREE.MathUtils.clamp(1 + (-dyMid * 0.004), 0.9, 1.1);
            state.startMid = mid;
            window.dispatchEvent(
                new CustomEvent("EPIC3D_CAMERA_DOLLY", {
                  detail: { scale: dragScale }
                })
            );
          }
        }
      }

      if (state.mode === "pan" && e.touches.length === 3) {
        const xs = [...e.touches].map((t) => t.clientX);
        const ys = [...e.touches].map((t) => t.clientY);

        const mid = [
          xs.reduce((a, b) => a + b, 0) / 3,
          ys.reduce((a, b) => a + b, 0) / 3,
        ];

        const dx = mid[0] - state.startMid[0];
        const dy = mid[1] - state.startMid[1];

        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

        state.startMid = mid;

        window.dispatchEvent(
            new CustomEvent("EPIC3D_CAMERA_PAN", { detail: { dx, dy } })
        );
      }
    };

    const onTouchEnd = () => {
      touchState.current.mode = null;
    };

    const onKeyDown = (e) => {
      if (!armed || placeKind !== "room") return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z") && activeRoomMode === "points") {
        e.preventDefault();
        e.stopPropagation();
        if (points.length > 0) {
          const next = points.slice(0, -1);
          setPoints(next);
          setHoverXZ(next.length ? next[next.length - 1] : null);
        }
        return;
      }

      if (e.key === "Escape") {
        resetRoomBox();
        resetRoomPoints();
      }

      if (e.key === "Enter" && activeRoomMode === "points") {
        finalizePointsRoom();
      }
    };

    const onFinalizeEvent = () => {
      if (!armed || placeKind !== "room") return;
      if (activeRoomMode !== "points") return;
      finalizePointsRoom();
    };

    const onClearEvent = () => {
      if (!armed || placeKind !== "room") return;
      if (activeRoomMode !== "points") return;
      resetRoomPoints();
    };

    const onMirrorEvent = () => {
      if (!armed || placeKind !== "room") return;
      if (activeRoomMode !== "points") return;
      mirrorPointsRoom();
    };

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("touchstart", onTouchStart, { passive: false });
    dom.addEventListener("touchmove", onTouchMove, { passive: false });
    dom.addEventListener("touchend", onTouchEnd);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("EPIC3D_FINALIZE_ROOM_POINTS", onFinalizeEvent);
    window.addEventListener("EPIC3D_CLEAR_ROOM_POINTS", onClearEvent);
    window.addEventListener("EPIC3D_MIRROR_ROOM_POINTS", onMirrorEvent);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("touchstart", onTouchStart);
      dom.removeEventListener("touchmove", onTouchMove);
      dom.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("EPIC3D_FINALIZE_ROOM_POINTS", onFinalizeEvent);
      window.removeEventListener("EPIC3D_CLEAR_ROOM_POINTS", onClearEvent);
      window.removeEventListener("EPIC3D_MIRROR_ROOM_POINTS", onMirrorEvent);
    };
  }, [
    armed,
    placeKind,
    multi,
    snap,
    gl,
    camera,
    modelRef,
    onPlace,
    activeRoomMode,
    boxStart,
    boxEnd,
    points,
  ]);

  // ─────────────────────────────────────────────
  // Preview geometry + ground
  // ─────────────────────────────────────────────
  const boxPreviewGeo = useMemo(() => {
    if (activeRoomMode !== "box" || !boxStart || !boxEnd) return null;
    const x0 = boxStart[0];
    const z0 = boxStart[1];
    const x1 = boxEnd[0];
    const z1 = boxEnd[1];
    const pts = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    return buildLineGeometry(pts, true);
  }, [activeRoomMode, boxStart, boxEnd]);
  const boxPreview3D = useMemo(() => {
    if (activeRoomMode !== "box" || !boxStart || !boxEnd) return null;
    if (!roomHeightScale) return null;
    if (boxPhase !== 2) return null;
    const x0 = boxStart[0];
    const z0 = boxStart[1];
    const x1 = boxEnd[0];
    const z1 = boxEnd[1];
    const w = Math.max(0.05, Math.abs(x1 - x0));
    const d = Math.max(0.05, Math.abs(z1 - z0));
    const h = Math.max(0.2, Number(boxHeight) || defaultRoomH);
    const geo = new THREE.BoxGeometry(w, h, d);
    const edges = new THREE.EdgesGeometry(geo);
    return { edges, w, h, d };
  }, [activeRoomMode, boxStart, boxEnd, boxHeight, roomHeightScale, boxPhase]);

  const pointsPreviewGeo = useMemo(() => {
    if (activeRoomMode !== "points" || points.length < 1) return null;
    const pts = points.slice();
    if (hoverXZ) pts.push(hoverXZ);
    return buildLineGeometry(pts, false);
  }, [activeRoomMode, points, hoverXZ]);

  const pointsCloseGeo = useMemo(() => {
    if (activeRoomMode !== "points" || points.length < 2 || !hoverXZ) return null;
    return buildLineGeometry([hoverXZ, points[0]], false);
  }, [activeRoomMode, points, hoverXZ]);

  useEffect(() => () => boxPreviewGeo?.dispose?.(), [boxPreviewGeo]);
  useEffect(() => () => boxPreview3D?.edges?.dispose?.(), [boxPreview3D]);
  useEffect(() => () => pointsPreviewGeo?.dispose?.(), [pointsPreviewGeo]);
  useEffect(() => () => pointsCloseGeo?.dispose?.(), [pointsCloseGeo]);

  return (
      <>
        <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[2000, 2000]} />
          <meshBasicMaterial visible={false} />
        </mesh>
        {armed && placeKind === "room" && activeRoomMode === "box" && boxPreviewGeo && (
          <line geometry={boxPreviewGeo} raycast={() => null}>
            <lineBasicMaterial color={previewColor} transparent opacity={0.9} depthWrite={false} />
          </line>
        )}
        {armed && placeKind === "room" && activeRoomMode === "box" && boxPreview3D && (
          <lineSegments
            geometry={boxPreview3D.edges}
            position={[
              (boxStart[0] + boxEnd[0]) * 0.5,
              (Number(boxBaseYRef.current) || 0) + (Number(boxHeight) || defaultRoomH) * 0.5,
              (boxStart[1] + boxEnd[1]) * 0.5,
            ]}
            raycast={() => null}
          >
            <lineBasicMaterial color={previewColor} transparent opacity={0.6} depthWrite={false} />
          </lineSegments>
        )}
        {armed && placeKind === "room" && activeRoomMode === "points" && (
          <group>
            {pointsPreviewGeo && (
              <line geometry={pointsPreviewGeo} raycast={() => null}>
                <lineBasicMaterial
                  color={points.length >= 2 ? previewColor : previewHintColor}
                  transparent
                  opacity={0.9}
                  depthWrite={false}
                />
              </line>
            )}
            {pointsCloseGeo && (
              <line geometry={pointsCloseGeo} raycast={() => null}>
                <lineBasicMaterial color={previewColor} transparent opacity={0.45} depthWrite={false} />
              </line>
            )}
            {points.map(([x, z], i) => (
              <mesh key={`pt_${i}`} position={[x, previewY, z]} raycast={() => null}>
                <sphereGeometry args={[0.05, 12, 12]} />
                <meshBasicMaterial color={previewColor} transparent opacity={0.85} depthWrite={false} />
              </mesh>
            ))}
            {hoverXZ && (
              <mesh position={[hoverXZ[0], previewY, hoverXZ[1]]} raycast={() => null}>
                <sphereGeometry args={[0.06, 14, 14]} />
                <meshBasicMaterial color={previewHintColor} transparent opacity={0.9} depthWrite={false} />
              </mesh>
            )}
          </group>
        )}
      </>
  );
}


import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { snapValue } from "../utils/math";

export default function InteractionLayer({
                                           armed,
                                           placeKind,
                                           multi,
                                           snap = 0.25,
                                           onPlace,
                                           modelRef,
                                         }) {
  const { gl, camera } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useMemo(() => new THREE.Vector2(), []);
  const groundRef = useRef();

  useEffect(() => {
    if (!armed) return;

    const onPointerDown = (e) => {
      // Only left click (some browsers pass undefined in non-React listeners)
      if (typeof e.button !== "undefined" && e.button !== 0) return;

      const rect = gl.domElement.getBoundingClientRect();
      mouse.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

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

      if (!candidates.length) return;

      // Nearest hit
      candidates.sort((a, b) => a.distance - b.distance);
      const hit = candidates[0];
      const p = hit.point;

      // Snap result
      const snapped = [
        snapValue(p.x, snap),
        snapValue(p.y, snap),
        snapValue(p.z, snap),
      ];

      // Slight lift when dropping on ground to avoid z-fighting
      if (hit.object === groundRef.current) {
        snapped[1] = Math.max(snapped[1], 0.0);
      }

      onPlace && onPlace(placeKind, snapped, multi);
    };

    const dom = gl.domElement;
    dom.addEventListener("pointerdown", onPointerDown);
    return () => dom.removeEventListener("pointerdown", onPointerDown);
  }, [armed, placeKind, multi, snap, gl, camera, modelRef, onPlace, raycaster, mouse]);

  // Invisible ground
  return (
      <mesh ref={groundRef} rotation={[Math.PI * -0.5, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[2000, 2000, 1, 1]} />
        <meshBasicMaterial visible={false} />
      </mesh>
  );
}

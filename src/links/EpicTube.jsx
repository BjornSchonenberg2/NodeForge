import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

export default function EpicTube({
                                   curve,
                                   thickness = 0.07,
                                   glow = 1.4,
                                   color = "#80d8ff",
                                   speed = 1,
                                   trail = true,
                                   selected = false,
                                   widthHint = 2,
                                   animate = true,
 thicknessMult = 1,
                                     rainbow = false,
      sparks = false,
                                 }) {
  const matRef = useRef();
  const geom = useMemo(() => {
    const tubularSegments = 240;
          return new THREE.TubeGeometry(curve, tubularSegments, thickness * thicknessMult, 12, false);
        }, [curve, thickness, thicknessMult]);

  const color3 = useMemo(() => new THREE.Color(color), [color]);

  useFrame(({ clock }) => {
    if (!matRef.current) return;
    const t = clock.getElapsedTime();
          const pulse = animate ? 0.85 + Math.sin(t * speed * 1.7) * 0.15 : 1.0;
          if (rainbow) {
          const c = new THREE.Color().setHSL((t * speed * 0.08) % 1, 0.9, 0.55);
                matRef.current.color.copy(c);
                matRef.current.emissive.copy(c.clone().multiplyScalar(0.7));
              }
      matRef.current.emissiveIntensity = (glow || 1.4) * pulse * (selected ? 1.2 : 1);
  });

      const headRef = useRef();
      const sparksRef = useRef();   // <-- add this
  useFrame(({ clock }) => {
    if (!headRef.current) return;
    const t = ((animate ? clock.getElapsedTime() : 0) * speed * 0.12) % 1;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    headRef.current.position.copy(p);
    headRef.current.lookAt(p.clone().add(tan));
          if (sparks && sparksRef.current) {
                // tiny randomized flicker near the head
                    const s = sparksRef.current;
                const r = 0.08 * (thickness * thicknessMult * 14);
                s.position.set(
                      p.x + (Math.random() - 0.5) * r,
                      p.y + (Math.random() - 0.5) * r,
                     p.z + (Math.random() - 0.5) * r
                   );
                s.material.opacity = 0.35 + Math.random() * 0.4;
                s.rotation.z += 0.2;
              }
  });

  return (
      <group>
        <mesh geometry={geom}>
          <meshPhysicalMaterial
              ref={matRef}
              color={color3}
              emissive={color3.clone().multiplyScalar(0.7)}
              emissiveIntensity={glow}
              roughness={0.25}
              metalness={0.0}
              transparent
              opacity={selected ? 1 : 0.98}
              side={THREE.DoubleSide}
          />
        </mesh>

        {trail && (
            <mesh ref={headRef}>
              <coneGeometry args={[thickness * 1.6, thickness * 5, 8]} />
              <meshBasicMaterial color={color3} transparent opacity={0.95} />
            </mesh>
        )}
                {sparks && (
                <mesh ref={sparksRef} rotation={[Math.PI/2, 0, 0]}>
                        <planeGeometry args={[0.06, 0.06]} />
                       <meshBasicMaterial transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
                     </mesh>)}
      </group>
  );
}

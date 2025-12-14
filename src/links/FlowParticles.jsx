import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

export default function FlowParticles({
                                        curve,
                                        count = 24,
                                        size = 0.06,
                                        color = "#cfe5ff",
                                        speed = 1,
                                        opacity = 1,
                                        waveAmp = 0.06,
                                        waveFreq = 2,
                                        shape = "sphere",
                                        selected = false,
                                        animate = true,
  sizeMult = 1,
      rainbow = false,
                                      }) {
  const matRef = useRef();
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color3 = useMemo(() => new THREE.Color(color), [color]);

  const seeds = useMemo(() => {
    const s = [];
    for (let i = 0; i < count; i++) {
      s.push({
        phase: Math.random(),
        jitter: THREE.MathUtils.lerp(0.85, 1.15, Math.random()),
        lane: Math.random() * Math.PI * 2,
      });
    }
    return s;
  }, [count]);

  const geom = useMemo(() => {
    if (shape === "box") return new THREE.BoxGeometry(size, size, size);
    if (shape === "octa") return new THREE.OctahedronGeometry(size * 0.75, 0);
    return new THREE.SphereGeometry(size * 0.5, 8, 8);
  }, [shape, size]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const tnow = clock.getElapsedTime();
      const hue = (tnow * (animate ? speed : 0) * 0.08) % 1;  // gentle hue tick
    const up = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const binormal = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      const t = (((animate ? tnow : 0) * speed * 0.15 * s.jitter) + s.phase) % 1;

      const p = curve.getPointAt(t);
      curve.getTangentAt(t, tangent);

      binormal.copy(tangent).cross(up);
      if (binormal.lengthSq() < 1e-4) binormal.set(1, 0, 0);
      else binormal.normalize();
      normal.copy(binormal).cross(tangent).normalize();

      const wave = waveAmp > 0 ? Math.sin(((animate ? tnow : 0) + s.lane) * waveFreq) * waveAmp : 0;
      p.addScaledVector(normal, wave);

      dummy.position.copy(p);
      dummy.lookAt(p.clone().add(tangent));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;

          if (matRef.current) {
                matRef.current.opacity = opacity * (selected ? 1 : 0.95);
                if (rainbow) {
                      const c = new THREE.Color().setHSL(hue, 0.9, 0.55);
                      matRef.current.color.copy(c);
                      matRef.current.emissive?.copy?.(c);
                    } else {
                      matRef.current.color.copy(color3);
                    }
              }
  });

     return (
           <instancedMesh
      ref={meshRef}
          args={[geom, null, count]}
          frustumCulled={false}
          renderOrder={5000}
           >
             <meshBasicMaterial
        ref={matRef}
            transparent
            depthWrite={false}
            depthTest={false}
           toneMapped={false}
              />
            </instancedMesh>
  );
}

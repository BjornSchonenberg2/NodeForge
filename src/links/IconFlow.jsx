import React, { useMemo } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

export default function IconFlow({
                                   curve,
                                   char = "▶",
                                   count = 4,
                                   size = 0.14,
                                   color = "#ffffff",
                                   speed = 1,
                                   opacity = 0.95,
                                   selected = false,
                                   animate = true,
 sizeMult = 1,
      rainbow = false
                                 }) {
  const items = useMemo(
      () =>
          new Array(count).fill(0).map((_, i) => ({
            id: `ic-${i}`,
            phase: i / count,
            jitter: THREE.MathUtils.lerp(0.85, 1.15, Math.random()),
          })),
      [count]
  );

  useFrame(({ clock }) => {
    const tnow = clock.getElapsedTime();
      const hue = (tnow * (animate ? speed : 0) * 0.08) % 1;
    items.forEach((it) => {
      const t = (((animate ? tnow : 0) * speed * 0.12 * it.jitter) + it.phase) % 1;
      const pos = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      it._obj?.position.copy(pos);
      it._obj?.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.clone().normalize());
              if (rainbow && it._obj?.material?.color) {
                    it._obj.material.color.setHSL(hue, 0.9, 0.55);
                 }
    });
  });

  return (
      <group>
        {items.map((it) => (
            <Text
                key={it.id}
                ref={(r) => (it._obj = r)}
                position={[0, 0, 0]}
                rotation={[Math.PI / 2, 0, 0]}
                fontSize={size * sizeMult}
                color={color}
                anchorX="center"
                anchorY="middle"
                depthOffset={-1}
                fillOpacity={opacity * (selected ? 1 : 0.98)}
            >
              {char}
            </Text>
        ))}
      </group>
  );
}

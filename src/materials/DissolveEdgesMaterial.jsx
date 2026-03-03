import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { clamp } from "../utils/math";

/**
 * Safe defaults so callers can pass nothing or a partial object.
 */
const GAP_DEFAULTS = {
  enabled: false,
  shape: "sphere",   // "sphere" | "box"
  center: [0, 0, 0], // vec3
  radius: 0,
  endRadius: 1,
  speed: 1,
  animate: false,
  loop: false,
};

export default function DissolveEdgesMaterial({ color = "#8aa1c3", gap = {} }) {
  const isWebGPU = useThree((s) => s.gl?.isWebGPURenderer);
  const g = { ...GAP_DEFAULTS, ...(gap || {}) };

  const mat = useMemo(() => {
    if (isWebGPU) {
      return new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 1,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
    }
    return new THREE.ShaderMaterial({
      transparent: true,
      depthTest: true,
      uniforms: {
        uEnabled: { value: g.enabled ? 1 : 0 },
        uUseBox: { value: g.shape === "box" ? 1 : 0 },
        uCenter: { value: new THREE.Vector3(...g.center) },
        uRadius: { value: g.radius },
        uColor: { value: new THREE.Color(color) },
        uFade: { value: 1.0 }
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: `
       uniform int uEnabled;
uniform int uUseBox;
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uColor;
uniform float uFade;

varying vec3 vWorld;

void main() {
  float outAlpha = 1.0;

  if (uEnabled == 1) {
    float d = length(vWorld - uCenter);
    outAlpha = step(uRadius, d);
  }

  outAlpha *= uFade;            // 🔑 THIS WAS MISSING
  gl_FragColor = vec4(uColor, outAlpha);
}
      `,
    });
    // only re-create shader if color changes
    // (gap changes are pushed via the effect below)
  }, [color, isWebGPU]);

  // Push uniform updates when gap or color changes
  useEffect(() => {
    if (!mat) return;
    if (isWebGPU) {
      mat.color?.set?.(color);
      mat.needsUpdate = true;
      return;
    }
    mat.uniforms.uEnabled.value = g.enabled ? 1 : 0;
    mat.uniforms.uUseBox.value = g.shape === "box" ? 1 : 0;
    mat.uniforms.uCenter.value.set(...g.center);
    mat.uniforms.uRadius.value = g.radius;
    mat.uniforms.uColor.value.set(color);
    mat.needsUpdate = true;
  }, [mat, isWebGPU, g.enabled, g.shape, g.center, g.radius, color]);

  // Animate radius if requested
  useFrame((_, dt) => {
    if (!g.animate || !mat) return;
    if (isWebGPU) return;
    const goingOut = mat.uniforms.uRadius.value < g.endRadius;
    const goingIn  = mat.uniforms.uRadius.value > g.endRadius;
    const canMove  = goingOut || (g.loop && goingIn);
    if (!canMove) return;

    const next = THREE.MathUtils.lerp(
        mat.uniforms.uRadius.value,
        g.endRadius,
        clamp(dt * g.speed, 0, 1)
    );
    mat.uniforms.uRadius.value = next;
  });

  return <primitive object={mat} attach="material" />;
}

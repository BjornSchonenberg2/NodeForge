import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

// NOTE
// This is a drop-in replacement for the project's SweepLine component.
// It is intentionally "tree-owned" (no manual scene adds), so when the parent
// unmounts during scene-fade, the sweep visuals are guaranteed to disappear.
// It also respects opacityMult/opacity/alpha so fades always hide it.

function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

function toColor(v, fallback = "#7cf") {
    try {
        if (v == null) return new THREE.Color(fallback);
        if (v && v.isColor) return v.clone();
        return new THREE.Color(v);
    } catch {
        return new THREE.Color(fallback);
    }
}

function safeNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

// Simple repeating timeline: forward sweep (duration) -> hold -> pause/reset
function sweepHeadU(t, {
    duration,
    hold,
    pause,
    resetGap,
    pingpong,
    durationBack,
    holdBack,
}) {
    const dF = Math.max(0.001, duration);
    const hF = Math.max(0, hold);
    const pF = Math.max(0, pause);
    const rF = Math.max(0, resetGap);

    if (!pingpong) {
        const cycle = dF + hF + pF + rF;
        const m = cycle <= 0 ? 0 : (t % cycle);
        if (m <= dF) return clamp01(m / dF);
        // during hold/pause/reset we keep head at 1 (end)
        return 1;
    }

    const dB = Math.max(0.001, durationBack ?? dF);
    const hB = Math.max(0, holdBack ?? 0);
    const cycle = dF + hF + pF + rF + dB + hB + pF + rF;
    const m = cycle <= 0 ? 0 : (t % cycle);

    // forward
    if (m <= dF) return clamp01(m / dF);
    if (m <= dF + hF + pF + rF) return 1;

    // backward
    const mb = m - (dF + hF + pF + rF);
    if (mb <= dB) return 1 - clamp01(mb / dB);
    return 0;
}

export default React.memo(function SweepLine({
                                                 curve,
                                                 // colors
                                                 color = "#7cf",
                                                 color2,
                                                 gradient = false,
                                                 rainbow = false, // accepted for back-compat (ignored here)
                                                 // geometry / style
                                                 thickness = 0.06,
                                                 thicknessMult = 1,
                                                 feather = 0.06,
                                                 glow = 1.15,
                                                 baseVisible = false,
                                                 fillMode = "trail",
                                                 trailLength = 0.18,
                                                 invert = false,
                                                 // timing
                                                 duration = 1.4,
                                                 hold = 0.12,
                                                 pause = 0.2,
                                                 resetGap = 0.05,
                                                 speed = 1,
                                                 pingpong = false,
                                                 durationBack,
                                                 holdBack = 0,
                                                 // fade controls
                                                 fadeEnabled = true,
                                                 fade = 0.6,
                                                 opacityMult = 1,
                                                 opacity,
                                                 alpha,
                                                 // misc
                                                 animate = true,
                                                 selected = false,
                                             }) {
    const isWebGPU = useThree((s) => s.gl?.isWebGPURenderer);

    // Compute effective opacity from all supported prop names.
    const effectiveOpacity = useMemo(() => {
        const a0 = opacityMult == null ? 1 : safeNum(opacityMult, 1);
        const a1 = opacity == null ? 1 : safeNum(opacity, 1);
        const a2 = alpha == null ? 1 : safeNum(alpha, 1);
        return clamp01(a0) * clamp01(a1) * clamp01(a2);
    }, [opacityMult, opacity, alpha]);

    const c1 = useMemo(() => toColor(color, "#7cf"), [color]);
    const c2 = useMemo(() => toColor(color2 ?? color, "#7cf"), [color2, color]);

    const radius = Math.max(0.0005, safeNum(thickness, 0.06) * safeNum(thicknessMult, 1));

    // Geometry: Tube around the curve. We assume curve is stable for typical links.
    // (This matches the existing behavior visually well enough and avoids per-frame rebuild.)
    const geom = useMemo(() => {
        if (!curve || typeof curve.getPointAt !== "function") return null;
        const tubularSegments = 96;
        const radialSegments = 6;
        try {
            return new THREE.TubeGeometry(curve, tubularSegments, radius * 0.5, radialSegments, false);
        } catch {
            return null;
        }
    }, [curve, radius]);

    const mat = useMemo(() => {
        if (isWebGPU) {
            return new THREE.MeshBasicMaterial({
                color: c1.clone(),
                transparent: true,
                opacity: clamp01(effectiveOpacity),
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                toneMapped: false,
            });
        }
        const uniforms = {
            uTime: { value: 0 },
            uOpacity: { value: 1 },
            uHead: { value: 0 },
            uTrail: { value: clamp01(safeNum(trailLength, 0.18)) },
            uFeather: { value: Math.max(0.0001, safeNum(feather, 0.06)) },
            uGlow: { value: Math.max(0, safeNum(glow, 1.15)) },
            uFadeEnabled: { value: fadeEnabled === false ? 0 : 1 },
            uFade: { value: clamp01(safeNum(fade, 0.6)) },
            uBase: { value: baseVisible ? 1 : 0 },
            uInvert: { value: invert ? 1 : 0 },
            uGrad: { value: gradient && color2 ? 1 : 0 },
            uC1: { value: c1.clone() },
            uC2: { value: c2.clone() },
            uSel: { value: selected ? 1 : 0 },
        };

        return new THREE.ShaderMaterial({
            uniforms,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            vertexShader: `
        varying float vU;
        varying float vV;
        void main(){
          vU = uv.x;
          vV = uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
            fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform float uHead;
        uniform float uTrail;
        uniform float uFeather;
        uniform float uGlow;
        uniform float uFadeEnabled;
        uniform float uFade;
        uniform float uBase;
        uniform float uInvert;
        uniform float uGrad;
        uniform vec3  uC1;
        uniform vec3  uC2;
        uniform float uSel;
        varying float vU;
        varying float vV;

        float sat(float x){ return clamp(x, 0.0, 1.0); }

        void main(){
          float head = sat(uHead);
          float u = sat(vU);

          // distance behind head along the curve (with wrap)
          float d;
          if (uInvert > 0.5) {
            // invert direction
            head = 1.0 - head;
          }

          // wrap-aware distance where d=0 at head and increases towards tail
          d = head - u;
          if (d < 0.0) d += 1.0;

          // trail mask
          float trail = max(0.0001, uTrail);
          float f = max(0.0001, uFeather);
          float inMask = 1.0 - smoothstep(trail, trail + f, d);
          float headBoost = 1.0 - smoothstep(0.0, f, d);
          float mask = inMask;

          // Optional base line
          float base = (uBase > 0.5) ? 0.12 : 0.0;
          float a = max(base, mask);

          // Slightly brighter head
          a *= mix(0.75, 1.1, headBoost);

          // Fade shaping (soften the tail)
          if (uFadeEnabled > 0.5) {
            float fadeK = sat(uFade);
            float k = sat(d / trail);
            a *= mix(1.0, (1.0 - k), fadeK);
          }

          // Color
          vec3 col = uC1;
          if (uGrad > 0.5) {
            float k = sat(d / trail);
            col = mix(uC1, uC2, k);
          }

          // subtle "selected" boost
          col *= (uSel > 0.5) ? 1.15 : 1.0;

          a *= uOpacity;
          a = sat(a);
          if (a <= 0.0001) discard;

          gl_FragColor = vec4(col * uGlow, a);
        }
      `,
        });
    }, [
        isWebGPU,
        c1,
        c2,
        trailLength,
        feather,
        glow,
        fadeEnabled,
        fade,
        baseVisible,
        invert,
        gradient,
        color2,
        selected,
    ]);

    // Keep material uniforms in sync (colors can change without rebuilding material).
    useEffect(() => {
        if (!mat) return;
        if (isWebGPU) {
            mat.color?.copy?.(c1);
            mat.opacity = clamp01(effectiveOpacity);
            mat.needsUpdate = true;
            return;
        }
        mat.uniforms.uC1.value.copy(c1);
        mat.uniforms.uC2.value.copy(c2);
        mat.uniforms.uGrad.value = gradient && !!color2 ? 1 : 0;
        mat.uniforms.uSel.value = selected ? 1 : 0;
        mat.uniforms.uTrail.value = clamp01(safeNum(trailLength, 0.18));
        mat.uniforms.uFeather.value = Math.max(0.0001, safeNum(feather, 0.06));
        mat.uniforms.uGlow.value = Math.max(0, safeNum(glow, 1.15));
        mat.uniforms.uFadeEnabled.value = fadeEnabled === false ? 0 : 1;
        mat.uniforms.uFade.value = clamp01(safeNum(fade, 0.6));
        mat.uniforms.uBase.value = baseVisible ? 1 : 0;
        mat.uniforms.uInvert.value = invert ? 1 : 0;
    }, [mat, isWebGPU, c1, c2, gradient, color2, selected, trailLength, feather, glow, fadeEnabled, fade, baseVisible, invert, effectiveOpacity]);

    // Ensure we dispose when unmounting (prevents any "lingering" visuals).
    useEffect(() => {
        return () => {
            try {
                geom?.dispose?.();
            } catch {}
            try {
                mat?.dispose?.();
            } catch {}
        };
    }, [geom, mat]);

    const timeRef = useRef(0);

    useFrame((_, dt) => {
        if (!mat) return;
        if (isWebGPU) {
            mat.opacity = clamp01(effectiveOpacity);
            return;
        }

        // Always drive uOpacity, even when animate=false, so fades work.
        mat.uniforms.uOpacity.value = clamp01(effectiveOpacity);

        // If effectively invisible, keep head at 0 and bail.
        if (effectiveOpacity <= 0.0001) {
            mat.uniforms.uHead.value = 0;
            return;
        }

        if (!animate) return;

        const spd = Math.max(0, safeNum(speed, 1));
        timeRef.current += dt * spd;
        mat.uniforms.uTime.value = timeRef.current;

        const head = sweepHeadU(timeRef.current, {
            duration: Math.max(0.001, safeNum(duration, 1.4)),
            hold: Math.max(0, safeNum(hold, 0.12)),
            pause: Math.max(0, safeNum(pause, 0.2)),
            resetGap: Math.max(0, safeNum(resetGap, 0.05)),
            pingpong: !!pingpong,
            durationBack: durationBack == null ? undefined : Math.max(0.001, safeNum(durationBack, 1.4)),
            holdBack: Math.max(0, safeNum(holdBack, 0)),
        });
        mat.uniforms.uHead.value = head;
    });

    // If we can't build geometry, render nothing.
    if (!geom) return null;

    // IMPORTANT: keep it "tree owned" (no manual adds), so it unmounts cleanly.
    // Also hide at object level to avoid any driver-specific additive artifacts.
    const visible = effectiveOpacity > 0.0001;

    return (
        <mesh geometry={geom} material={mat} visible={visible} />
    );
});

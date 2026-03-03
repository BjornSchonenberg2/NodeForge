import React, { useEffect, useMemo, useRef } from "react";
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
                                          spread = 0,
                                          twist = 0,
                                          jitter = 0,
                                          stretch = 1,
                                          pulseAmp = 0,
                                          pulseFreq = 2,
                                          fadeTail = 0,
                                          blend = "normal",
                                          perf = "high",
                                      }) {
    const matRef = useRef();
    const meshRef = useRef();
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const color3 = useMemo(() => new THREE.Color(color), [color]);
    const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
    const tangent = useMemo(() => new THREE.Vector3(), []);
    const normal = useMemo(() => new THREE.Vector3(), []);
    const binormal = useMemo(() => new THREE.Vector3(), []);
    const point = useMemo(() => new THREE.Vector3(), []);
    const lookTarget = useMemo(() => new THREE.Vector3(), []);
    const tmpColor = useMemo(() => new THREE.Color(), []);
    const frameRef = useRef(0);
    const needsStaticUpdateRef = useRef(true);
    const needsMatUpdateRef = useRef(true);

    const perfScale = perf === "low" ? 0.5 : perf === "med" ? 0.75 : 1;
    const effectiveCount = Math.max(1, Math.floor(count * perfScale));
    const frameStride = perf === "low" ? 2 : 1;

    useEffect(() => {
        needsStaticUpdateRef.current = true;
    }, [
        curve,
        effectiveCount,
        size,
        waveAmp,
        waveFreq,
        shape,
        spread,
        twist,
        jitter,
        stretch,
        pulseAmp,
        pulseFreq,
        fadeTail,
        sizeMult,
        animate,
    ]);

    useEffect(() => {
        needsMatUpdateRef.current = true;
    }, [opacity, selected, color, rainbow, blend]);

    const seeds = useMemo(() => {
        const s = [];
        for (let i = 0; i < effectiveCount; i++) {
            s.push({
                phase: Math.random(),
                jitter: THREE.MathUtils.lerp(0.85, 1.15, Math.random()),
                lane: Math.random() * Math.PI * 2,
            });
        }
        return s;
    }, [effectiveCount]);

    const geom = useMemo(() => {
        if (shape === "box") return new THREE.BoxGeometry(size, size, size);
        if (shape === "octa") return new THREE.OctahedronGeometry(size * 0.75, 0);
        return new THREE.SphereGeometry(size * 0.5, 8, 8);
    }, [shape, size]);

    useFrame(({ clock }) => {
        if (!meshRef.current) return;
        if (!animate && !needsStaticUpdateRef.current) {
            if (needsMatUpdateRef.current) {
                if (matRef.current) {
                    matRef.current.opacity = opacity * (selected ? 1 : 0.95);
                    if (rainbow) {
                        tmpColor.setHSL(0, 0.9, 0.55);
                        matRef.current.color.copy(tmpColor);
                        matRef.current.emissive?.copy?.(tmpColor);
                    } else {
                        matRef.current.color.copy(color3);
                    }
                    const blendMode = blend === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
                    if (matRef.current.blending !== blendMode) {
                        matRef.current.blending = blendMode;
                        matRef.current.needsUpdate = true;
                    }
                }
                needsMatUpdateRef.current = false;
            }
            return;
        }

        if (animate && frameStride > 1) {
            frameRef.current = (frameRef.current + 1) % frameStride;
            if (frameRef.current !== 0) {
                return;
            }
        }

        const tnow = clock.getElapsedTime();
        const hue = (tnow * (animate ? speed : 0) * 0.08) % 1;  // gentle hue tick

        for (let i = 0; i < effectiveCount; i++) {
            const s = seeds[i];
            const t = (((animate ? tnow : 0) * speed * 0.15 * s.jitter) + s.phase) % 1;

            curve.getPointAt(t, point);
            curve.getTangentAt(t, tangent);

            binormal.copy(tangent).cross(up);
            if (binormal.lengthSq() < 1e-4) binormal.set(1, 0, 0);
            else binormal.normalize();
            normal.copy(binormal).cross(tangent).normalize();

            const wave = waveAmp > 0 ? Math.sin(((animate ? tnow : 0) + s.lane) * waveFreq) * waveAmp : 0;
            point.addScaledVector(normal, wave);
            if (spread > 0 || jitter > 0 || twist !== 0) {
                const twistPhase = t * Math.PI * 2 * twist;
                const lane = s.lane + twistPhase;
                const radial = Math.max(0, spread * s.jitter + jitter * (s.jitter - 0.5));
                if (radial !== 0) {
                    point.addScaledVector(normal, Math.cos(lane) * radial);
                    point.addScaledVector(binormal, Math.sin(lane) * radial);
                }
            }

            dummy.position.copy(point);
            lookTarget.copy(point).add(tangent);
            dummy.lookAt(lookTarget);
            const pulse = pulseAmp > 0 ? (1 + Math.sin((animate ? tnow : 0) * pulseFreq + s.phase * Math.PI * 2) * pulseAmp) : 1;
            const tail = fadeTail > 0 ? Math.max(0.2, 1 - fadeTail * t) : 1;
            const scale = Math.max(0.01, sizeMult * pulse * tail);
            const stretchZ = Math.max(0.01, stretch);
            dummy.scale.set(scale, scale, scale * stretchZ);
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
        }
        meshRef.current.instanceMatrix.needsUpdate = true;
        needsStaticUpdateRef.current = false;

        if (matRef.current) {
            matRef.current.opacity = opacity * (selected ? 1 : 0.95);
            if (rainbow) {
                tmpColor.setHSL(hue, 0.9, 0.55);
                matRef.current.color.copy(tmpColor);
                matRef.current.emissive?.copy?.(tmpColor);
            } else {
                matRef.current.color.copy(color3);
            }
            const blendMode = blend === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
            if (matRef.current.blending !== blendMode) {
                matRef.current.blending = blendMode;
                matRef.current.needsUpdate = true;
            }
        }
        needsMatUpdateRef.current = false;
    });

    return (
        <instancedMesh
            ref={meshRef}
            args={[geom, null, effectiveCount]}
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

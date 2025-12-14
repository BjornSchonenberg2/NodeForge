// src/lights/LightBounds.jsx
import React, { useMemo } from "react";
import * as THREE from "three";

export default function LightBounds({ node, globalOn }) {
    const light = node.light || {};
    const show = globalOn ? true : !!((light?.showBounds ?? false) && (light?.enabled ?? true));

    // --- scalar params (no hooks) ---
    const dist = light.distance ?? 9;
    const angle = Math.min(Math.max(light.angle ?? 0.6, 0.01), 1.5);
    const safeDist = Math.max(0.001, dist);
    const radius = Math.tan(angle) * safeDist;
    const yaw = (light.yaw ?? 0) * (Math.PI / 180);
    const pitch = (light.pitch ?? -30) * (Math.PI / 180);
    const isSpot = light.type === "spot";
    const isPoint = light.type === "point";
    const color = light.color || "#ffffff";

    // --- hooks: ALWAYS called, return null when not needed ---
    const dir = useMemo(() => {
        // down -Y rotated by yaw/pitch
        const e = new THREE.Euler(pitch, yaw, 0, "YXZ");
        return new THREE.Vector3(0, -1, 0).applyEuler(e).normalize();
    }, [yaw, pitch]);

    const coneQuat = useMemo(() => {
        // rotate -Y to dir
        const from = new THREE.Vector3(0, -1, 0).normalize();
        const q = new THREE.Quaternion();
        q.setFromUnitVectors(from, dir);
        return q;
    }, [dir]);

    const coneGeom = useMemo(() => {
        if (!isSpot) return null;
        const height = safeDist;
        const r = Math.max(0.0001, radius);
        // open-ended cone so it reads like a bounds wireframe
        const g = new THREE.ConeGeometry(r, height, 32, 1, true);
        // move apex to origin so it starts at the light position
        g.translate(0, -height / 2, 0);
        return g;
    }, [isSpot, radius, safeDist]);

    const sphereGeom = useMemo(() => {
        if (!isPoint) return null;
        const g = new THREE.SphereGeometry(safeDist, 24, 16);
        return g;
    }, [isPoint, safeDist]);

    // --- render (conditional rendering is OK; hooks already ran) ---
    if (!show) return null;

    if (isPoint) {
         return (
             <group castShadow={false} receiveShadow={false} renderOrder={9999}>
                {sphereGeom && (
                    <mesh geometry={sphereGeom}>
                        <meshBasicMaterial wireframe transparent opacity={0.5} color={color} />
                    </mesh>
                )}
                {/* small stem so you can see origin */}
                <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.01, 0.01, 0.2, 8]} />
                    <meshBasicMaterial transparent opacity={0.8} color={color} />
                </mesh>
            </group>
        );
    }

    if (isSpot) {
         return (
               <group quaternion={coneQuat}>
                {coneGeom && (
                    <mesh geometry={coneGeom}>
                        <meshBasicMaterial wireframe transparent opacity={0.7} color={color} />
                    </mesh>
                )}
                                     {/* tip marker at the light origin (apex) */}
                                     <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.01, 0.01, 0.2, 8]} />
                    <meshBasicMaterial transparent opacity={0.8} color={color} />
                </mesh>
            </group>
        );
    }

    // directional/other types: nothing for now
    return null;
}

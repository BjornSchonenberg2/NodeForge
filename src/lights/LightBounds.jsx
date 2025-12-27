// src/lights/LightBounds.jsx
import React, { useMemo } from "react";
import * as THREE from "three";

function parseVec3(v) {
    if (!v) return null;
    if (Array.isArray(v) && v.length >= 3) {
        const x = Number(v[0]);
        const y = Number(v[1]);
        const z = Number(v[2]);
        if ([x, y, z].every(Number.isFinite)) return new THREE.Vector3(x, y, z);
        return null;
    }
    if (typeof v === "object") {
        const x = Number(v.x);
        const y = Number(v.y);
        const z = Number(v.z);
        if ([x, y, z].every(Number.isFinite)) return new THREE.Vector3(x, y, z);
    }
    return null;
}

function dirFromYawPitch(yawDeg = 0, pitchDeg = 0, basis = "forward") {
    const yaw = (Number(yawDeg) * Math.PI) / 180;
    const pitch = (Number(pitchDeg) * Math.PI) / 180;
    const e = new THREE.Euler(pitch, yaw, 0, "YXZ");

    const base = String(basis).toLowerCase() === "down"
        ? new THREE.Vector3(0, -1, 0)
        : new THREE.Vector3(0, 0, -1);

    return base.applyEuler(e).normalize();
}

export default function LightBounds({ node, globalOn }) {
    const light = node?.light || {};
    const ltype = String(light?.type || "none").toLowerCase();

    // Show bounds even if disabled (so you can still aim / debug)
    const show = !!(globalOn || light?.showBounds);
    if (!show) return null;

    const isSpot = ltype === "spot";
    const isPoint = ltype === "point";
    const isDir = ltype === "dir" || ltype === "directional";

    const color = light?.color || "#ffffff";

    // Range visualization (for spot/point)
    const dist = Number(light?.distance ?? (isSpot ? 10 : isPoint ? 8 : 0));
    const safeDist = Math.max(0.001, dist || 0.001);

    const angle = Math.min(Math.max(Number(light?.angle ?? 0.6), 0.01), 1.5);
    const radius = Math.tan(angle) * safeDist;

    // Aim visualization
    const targetV = useMemo(() => {
        const t = parseVec3(light?.target ?? light?.pointAt);
        if (t && t.length() > 1e-6) return t;

        // yaw/pitch fallback
        const yaw = Number(light?.yaw ?? 0);
        const pitch = Number(light?.pitch ?? 0);
        const basis = light?.yawPitchBasis ?? "forward";
        const dir = dirFromYawPitch(yaw, pitch, basis);
        const aimDist = Math.max(0.001, Number(light?.aimDistance ?? safeDist));
        return dir.multiplyScalar(aimDist);
    }, [
        light?.target,
        light?.pointAt,
        light?.yaw,
        light?.pitch,
        light?.yawPitchBasis,
        light?.aimDistance,
        safeDist,
    ]);

    const dir = useMemo(() => {
        const d = targetV.clone();
        if (d.length() < 1e-6) return new THREE.Vector3(0, 0, -1);
        return d.normalize();
    }, [targetV]);

    const coneQuat = useMemo(() => {
        // Cone geom is authored along -Y
        const from = new THREE.Vector3(0, -1, 0).normalize();
        const q = new THREE.Quaternion();
        q.setFromUnitVectors(from, dir);
        return q;
    }, [dir]);

    const coneGeom = useMemo(() => {
        if (!isSpot) return null;
        const height = safeDist;
        const r = Math.max(0.0001, radius);
        const g = new THREE.ConeGeometry(r, height, 32, 1, true);
        // apex at origin
        g.translate(0, -height / 2, 0);
        return g;
    }, [isSpot, radius, safeDist]);

    const sphereGeom = useMemo(() => {
        if (!isPoint) return null;
        return new THREE.SphereGeometry(safeDist, 24, 16);
    }, [isPoint, safeDist]);

    const lineGeom = useMemo(() => {
        if (!(isSpot || isDir)) return null;
        const g = new THREE.BufferGeometry();
        const p = new Float32Array([0, 0, 0, targetV.x, targetV.y, targetV.z]);
        g.setAttribute("position", new THREE.BufferAttribute(p, 3));
        return g;
    }, [isSpot, isDir, targetV.x, targetV.y, targetV.z]);

    return (
        <group castShadow={false} receiveShadow={false} renderOrder={9999}>
            {isPoint && sphereGeom && (
                <mesh geometry={sphereGeom}>
                    <meshBasicMaterial wireframe transparent opacity={0.5} color={color} />
                </mesh>
            )}

            {isSpot && coneGeom && (
                <group quaternion={coneQuat}>
                    <mesh geometry={coneGeom}>
                        <meshBasicMaterial wireframe transparent opacity={0.65} color={color} />
                    </mesh>
                </group>
            )}

            {(isSpot || isDir) && lineGeom && (
                <>
                    <line geometry={lineGeom}>
                        <lineBasicMaterial transparent opacity={0.8} color={color} />
                    </line>

                    {/* target marker */}
                    <mesh position={[targetV.x, targetV.y, targetV.z]}>
                        <sphereGeometry args={[0.05, 10, 10]} />
                        <meshBasicMaterial transparent opacity={0.9} color={color} />
                    </mesh>
                </>
            )}

            {/* origin marker */}
            <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.01, 0.01, 0.2, 8]} />
                <meshBasicMaterial transparent opacity={0.8} color={color} />
            </mesh>
        </group>
    );
}

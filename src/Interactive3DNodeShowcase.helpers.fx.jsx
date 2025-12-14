import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import RackListView from "./ui/RackListView.jsx";
import {
    listProducts,
    getProductById,
    listRacks,
    getRackById,
    upsertRack,
    deleteRack,
    addProductToRack,
    removeProductFromRack,
    moveRackItem,
} from "./data/products/store";

import { TAU } from "./utils/math.js";
import { Btn, Input, Select, Checkbox } from "./ui/Controls.jsx";

export function RingWave({ color = "#7cf", speed = 1, maxR = 0.7, thickness = 0.02 }) {
    const ref = useRef();
    useFrame(() => {
        if (!ref.current) return;
        const t = (performance.now() * 0.001 * speed) % 1;
        const r = 0.1 + t * maxR;
        const o = 1.0 - t;
        ref.current.scale.setScalar(r);
        ref.current.material.opacity = o * 0.6;
    });
    return (
        <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1 - thickness, 1, 32]} />
            <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
    );
}


export function StableStartupCamera({ pose, applyKey }) {
    const { camera } = useThree();
    const controls = useThree((s) => s.controls);
    const appliedFor = React.useRef(null);

    React.useEffect(() => {
        if (!controls || !pose) return;

        // Only apply when the "key" changes (e.g. user chose a new preset)
        if (appliedFor.current === applyKey) return;

        const p = pose.position || [6, 4.5, 6];
        const t = pose.target   || [0, 0.8, 0];
        const up = pose.up || [0, 1, 0];
        const fov = typeof pose.fov === "number" ? pose.fov : camera.fov;

        camera.position.set(p[0], p[1], p[2]);
        camera.up.set(up[0], up[1], up[2]);
        controls.target.set(t[0], t[1], t[2]);

        camera.fov = fov;
        camera.updateProjectionMatrix();
        controls.update();

        appliedFor.current = applyKey; // remember we've applied for this preset
    }, [applyKey, pose, camera, controls]);

    return null;
}

// put this near your other small helpers (RingWave/NodeSignals), before the default export


export function WarmupOnce({ enabled=true }) {
    const { gl, scene, camera } = useThree();
    const done = React.useRef(false);
    React.useEffect(() => {
        if (!enabled || done.current) return;
        done.current = true;
        requestAnimationFrame(() => {
            try { gl.compile(scene, camera); } catch {}
        });
    }, [enabled, gl, scene, camera]);
    return null;
}


export function NodeSignals({ node, linksTo, style = "waves", color, speed = 1, size = 1 }) {
    if (style === "none") return null;
    if (style === "waves")
        return (
            <group position={node.position}>
                {[0, 1].map((i) => (
                    <RingWave key={i} color={color || node.color || "#7cf"} speed={speed * (1 + i * 0.2)} maxR={0.6 * size} />
                ))}
            </group>
        );
    if (style === "rays")
        return (
            <group position={node.position}>
                {Array.from({ length: 6 }).map((_, i) => {
                    const a = (i / 6) * TAU + performance.now() * 0.001 * speed;
                    const x = Math.cos(a) * 0.35 * size;
                    const z = Math.sin(a) * 0.35 * size;
                    return (
                        <mesh key={i} position={[x, 0.05, z]} rotation={[-Math.PI / 2, 0, 0]}>
                            <planeGeometry args={[0.05, 0.25]} />
                            <meshBasicMaterial color={color || node.color || "#7cf"} transparent opacity={0.6} />
                        </mesh>
                    );
                })}
            </group>
        );
    return null;
}


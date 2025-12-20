// src/nodes/Node3D.jsx
import React, { memo, forwardRef, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Billboard, Text, Html } from "@react-three/drei";
import RackListView from "../ui/RackListView.jsx";

import GeometryForShape from "../geometry/GeometryForShape.jsx";
import LightBounds from "../lights/LightBounds.jsx";
import { clusterColor } from "../utils/clusters.js";
import { getProductById, getRackById } from "../data/products/store.js";
import { buildBundledProductPicturesIndex, buildDiskProductPicturesIndex, hasFs as hasPicsFs, resolvePictureRef } from "../data/products/productPicturesIndex.js";
import NodeTextBox from "./NodeTextBox.jsx";

/* -------------------------------- helpers -------------------------------- */


// Build picture indices once per module (fast to resolve @pp/... refs in 3D)
const __BUNDLED_PICS_INDEX = buildBundledProductPicturesIndex();
let __DISK_PICS_INDEX = null;
let __DISK_PICS_ROOT = null;
function __getDiskPicsIndex() {
    try {
        if (!hasPicsFs()) return null;
        const root =
            localStorage.getItem("epic3d.productPictures.diskRoot.v1") ||
            localStorage.getItem("epic3d.productPicturesRoot.v1") ||
            "";
        if (!root) return null;
        if (root !== __DISK_PICS_ROOT) {
            __DISK_PICS_ROOT = root;
            __DISK_PICS_INDEX = buildDiskProductPicturesIndex(root);
        }
        return __DISK_PICS_INDEX;
    } catch {
        return null;
    }
}


function dirFromYawPitch(yawDeg = 0, pitchDeg = -30) {
    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;
    const e = new THREE.Euler(pitch, yaw, 0, "YXZ");
    return new THREE.Vector3(0, -1, 0).applyEuler(e).normalize();
}

function Dim({ a, b, text }) {
    const geo = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute(
            "position",
            new THREE.BufferAttribute(new Float32Array([...a, ...b]), 3)
        );
        return g;
    }, [a[0], a[1], a[2], b[0], b[1], b[2]]);
    const mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];

    return (
        <group>
            <line geometry={geo}>
                <lineBasicMaterial transparent opacity={0.9} />
            </line>
            <Billboard position={mid}>
                <Text
                    fontSize={0.08}
                    anchorX="center"
                    anchorY="middle"
                    outlineWidth={0.004}
                    outlineColor="#000"
                >
                    {text}
                </Text>
            </Billboard>
        </group>
    );
}

/* --------------------------------- main ---------------------------------- */

const Node3D = memo(
    forwardRef(function Node3D(
        {
            node,
            productsVersion = 0,
            selected = false,
            onPointerDown,
            dragging = false,

            // lights
            showLights = true,
            showLightBoundsGlobal = false,

            // labels
            labelsOn = true,
            labelMode = "billboard",
            labelSize = 0.24,
            labelMaxWidth = 24,
            label3DLayers = 8,
            label3DStep = 0.01,
            shadowsOn = true,
        },
        ref
    ) {
        /* ---------- basic props ---------- */
        const position = node?.position || [0, 0, 0];
        const rotation = node?.rotation || [0, 0, 0];
        const baseColor = node?.color || clusterColor(node?.cluster);




        const visible = node?.visible !== false;
        const shapeHidden = !!(node?.hiddenMesh);
// representative (resolve what this node represents)
        const represent = node?.represent || null;
        const repUI = represent?.ui || {};
        const show3DInfo = repUI.show3DInfo ?? true;
        const useDimsForRack = repUI.useDims ?? true;   // used for rack dims
        const showDimsLocal = repUI.showDims ?? true;   // per-node toggle

        const sh = node?.shadows || {};
        const castShadow    = (sh.cast    ?? true);
        const receiveShadow = (sh.receive ?? true);
        const lightCasts    = (sh.light   ?? true); // whether this node's own light casts shadows
// Prefer representative’s product when in "product" mode; fallback to legacy node.product
        const productRef = React.useMemo(() => {
            if (represent?.enabled && represent?.kind === "product") {
                if (represent.productId) return { id: represent.productId };
                if (represent.product)   return represent.product; // inline/unsaved
                return null;
            }
            return node?.product || null;
        }, [represent?.enabled, represent?.kind, represent?.productId, represent?.product, node?.product]);

// Resolve catalog product (falls back to inline object when no id)
        const product = React.useMemo(() => {
            const pid = productRef?.id;
            return pid ? getProductById(pid) : (productRef || null);
        }, [productRef?.id, productRef, productsVersion]);




        const showRackPhotos = repUI.showRackPhotos ?? true;
        const infoFont = Math.max(10, Math.min(20, Number(repUI.infoFontSize ?? 12)));  // px
        const thumbSize = Math.max(40, Math.min(140, Number(repUI.thumbSize ?? 70)));   // px
        const infoYOffset = Number(repUI.infoYOffset ?? 0.25); // meters extra lift



        const rack = useMemo(() => {
            if (represent?.kind !== "rack") return null;
            if (represent?.rackId) return getRackById(represent.rackId);
            return represent?.rack || null; // inline unsaved rack
        }, [represent?.kind, represent?.rackId, represent?.rack, productsVersion]);

// label text (now safe to reference product)
        const labelText = node?.label || node?.name || node?.id;
        const labelFull = useMemo(() => {
            const pn = product?.name?.trim();
            const rn = rack?.name?.trim();
            let base = labelText || "";
            if (represent?.enabled) {
                if (represent.kind === "product" && pn) base = base ? `${base} — ${pn}` : pn;
                if (represent.kind === "rack" && rn)    base = base ? `${base} — Rack: ${rn}` : `Rack: ${rn}`;
            }
            return base || labelText;
        }, [labelText, product?.name, rack?.name, represent?.enabled, represent?.kind]);



        const productScale = Number(localStorage.getItem("epic3d.productScale.v1") || "1");
        const showDimsGlobal = localStorage.getItem("epic3d.showDimsGlobal.v1") === "1";
        const photoDefault = localStorage.getItem("epic3d.photoDefault.v1") !== "0";
        const productUnits = localStorage.getItem("epic3d.productUnits.v1") || "cm";
        const alwaysShow3DInfo = localStorage.getItem("epic3d.alwaysShow3DInfo.v1") === "1";

        const toMeters = React.useCallback((v) => {
            const n = Number(v || 0);
            if (productUnits === "mm") return n / 1000;
            if (productUnits === "cm") return n / 100;
            return n; // meters
        }, [productUnits]);

        const shapeToRender = useMemo(() => {
            if (represent?.enabled && represent?.kind === "rack" && rack && useDimsForRack) {
                const w = rack.width ?? 60;
                const h = rack.height ?? 200;
                const l = rack.length ?? 80;
                const sx = Math.max(0.001, toMeters(w) * productScale);
                const sy = Math.max(0.001, toMeters(h) * productScale);
                const sz = Math.max(0.001, toMeters(l) * productScale);
                return { type: "box", scale: [sx, sy, sz] };
            }
            if (product && productRef?.useDims && represent?.kind !== "rack") {
                const w = product.width ?? product?.dims?.w ?? 0.3;
                const h = product.height ?? product?.dims?.h ?? 0.2;
                const l = product.length ?? product?.dims?.l ?? 0.3;
                const sx = Math.max(0.001, toMeters(w) * productScale);
                const sy = Math.max(0.001, toMeters(h) * productScale);
                const sz = Math.max(0.001, toMeters(l) * productScale);
                return { type: "box", scale: [sx, sy, sz] };
            }
            return node.shape || { type: "sphere", radius: 0.32 };
        }, [node.shape, product, productRef?.useDims, productScale, toMeters, represent?.enabled, represent?.kind, rack, useDimsForRack]);


        // label vertical offset from the actual rendered shape
        const yOffset = useMemo(() => {
            const s = shapeToRender || {};
            const t = (s.type || "sphere").toLowerCase();
            if (t === "sphere") return (s.radius ?? 0.32) + 0.12;
            if (t === "cylinder") return (s.height ?? 0.6) / 2 + 0.12;
            if (t === "cone") return (s.height ?? 0.7) / 2 + 0.12;
            if (t === "disc" || t === "circle") return (s.height ?? 0.08) / 2 + 0.12;
            if (t === "hexagon") return (s.height ?? 0.5) / 2 + 0.12;
            if (t === "switch") return (s.h ?? 0.12) / 2 + 0.12;
            if (t === "box" || t === "square") return (s.scale?.[1] ?? 0.3) / 2 + 0.12;
            return 0.44;
        }, [shapeToRender]);

        /* ---------- lights ---------- */
        const light = node?.light || null;
        const enabled = light?.enabled ?? true;
        const ltype = (light?.type || "point").toLowerCase();
        const color = light?.color || "#ffffff";
        const intensity =
            light?.intensity ??
            (ltype === "spot" ? 1200 : ltype === "dir" || ltype === "directional" ? 4 : 800);
        const distance = light?.distance ?? (ltype === "spot" ? 10 : ltype === "point" ? 8 : 12);
        const decay = light?.decay ?? 2;
        const angle = light?.angle ?? 0.5;
        const penumbra = light?.penumbra ?? 0.4;
        const dir = useMemo(() => {
            const yaw = light?.yaw ?? 0;
            const pitch = light?.pitch ?? -30;
            return dirFromYawPitch(yaw, pitch);
        }, [light?.yaw, light?.pitch]);

        const lightRef = useRef();
        const targetRef = useRef();
        const targetPos = useMemo(
            () => [dir.x * distance, dir.y * distance, dir.z * distance],
            [dir, distance]
        );


        const targetLux = Number(light?.targetLux ?? 120); // tweak per light if you like
        const effectiveIntensity = useMemo(() => {

            if (light?.autoIntensity === false) return intensity;
            const d = Math.max(0.001, Number(distance || 0));
            const coneFactor = Math.max(0.35, Math.cos(Math.min(Math.max(angle, 0.05), 1.2)));
            const I = targetLux * d * d;
            const decayAdjust = Math.max(0.5, Number(decay || 2));
            const blend = 0.75; // 75% auto, 25% user
            return (1 - blend) * intensity + blend * (I * coneFactor / decayAdjust);
        }, [light?.autoIntensity, intensity, targetLux, distance, angle, decay]);


        const hasLight = !!(
            showLights &&
            enabled &&
            light &&
            (ltype === "spot" || ltype === "point" || ltype === "dir" || ltype === "directional")
        );

        useEffect(() => {
            const l = lightRef.current;
            const t = targetRef.current;
            if (!l || !t) return;

            // ensure target stays inside the same group and follows yaw/pitch
            t.position.set(targetPos[0], targetPos[1], targetPos[2]);
            t.updateMatrixWorld(true);

            // re-attach every time anything relevant changes
            l.target = t;
            l.updateMatrixWorld(true);
            if (l.shadow?.camera?.updateProjectionMatrix) {
                l.shadow.camera.updateProjectionMatrix();
            }
        }, [targetPos[0], targetPos[1], targetPos[2]]);

        /* ---------- dimension helpers (hooks must be before any return) ---------- */

        // half extents (for box only)
        const half = useMemo(() => {
            const s = shapeToRender;
            if (!s || (s.type !== "box" && s.type !== "square")) return null;
            const sx = s.scale?.[0] ?? 0.6;
            const sy = s.scale?.[1] ?? 0.3;
            const sz = s.scale?.[2] ?? 0.6;
            return [sx / 2, sy / 2, sz / 2];
        }, [shapeToRender]);

        // pretty raw dim labels from product
        const dimText = useMemo(() => {

            if (represent?.enabled && represent?.kind === "rack" && rack) {
                const w = Number(rack.width || 0);
                const h = Number(rack.height || 0);
                const l = Number(rack.length || 0);
                const unit = localStorage.getItem("epic3d.productUnits.v1") || "cm";
                return { w: `${w}${unit}`, h: `${h}${unit}`, l: `${l}${unit}` };
            }
            if (!product || !productRef?.useDims) return null;
            const w = Number(product.width ?? product?.dims?.w) || 0;
            const h = Number(product.height ?? product?.dims?.h) || 0;
            const l = Number(product.length ?? product?.dims?.l) || 0;

            const unit = localStorage.getItem("epic3d.productUnits.v1") || "cm";
            return { w: `${w}${unit}`, h: `${h}${unit}`, l: `${l}${unit}` };
        }, [product, productRef?.useDims, represent?.enabled, represent?.kind, rack]);
// same UI knobs the HUD uses
        const unit = localStorage.getItem("epic3d.productUnits.v1") || "cm";
        const ui = repUI || {};
        const panelWidth = Math.max(340, Math.min(720, Number(ui.panelWidth ?? 480)));

// pick the rack source and pre-resolve products
        const rackRaw = represent?.rackId ? getRackById(represent.rackId) : represent?.rack;
        const rackResolved = rackRaw ? {
            ...rackRaw,
            items: (rackRaw.items || []).map(it => {
                const p = it.productId ? getProductById(it.productId) : null;
                return { ...it, __product: p };
            }),
        } : null;

        // Resolve representative thumbnail (supports data URLs, @pp/ bundled refs, @media disk refs)
        const diskPicsIndex = React.useMemo(() => __getDiskPicsIndex(), [productsVersion]);
        const coverRef = (product?.image || (Array.isArray(product?.images) ? product.images[0] : "")) || "";
        const coverUrl = React.useMemo(
            () => (coverRef ? resolvePictureRef(coverRef, __BUNDLED_PICS_INDEX, diskPicsIndex) : ""),
            [coverRef, diskPicsIndex]
        );

        const showPhoto = (productRef?.showPhoto ?? photoDefault) && !!coverUrl;

// near labelSizeLocal / labelColorLocal
        const labelSizeLocal  = (node?.labelScale ?? 1) * (labelSize ?? 0.24);
        const labelColorLocal = node?.labelColor ?? "#ffffff";


// optional outline support from the inspector
        const labelOutlineOn    = !!node?.labelOutline;
        const labelOutlineWidth = labelOutlineOn ? (node?.labelOutlineWidth ?? 0.005) : 0;
        const labelOutlineColor = labelOutlineOn ? (node?.labelOutlineColor ?? "#000000") : "#000000";

        /* ---------- safe early return (after all hooks) ---------- */
        if (!visible) return null;

        /* ---------- events ---------- */
        const handlePointerDown = (e) => {
            e.stopPropagation();
            if (dragging) return;
            onPointerDown?.(node.id, e);
        };

        /* -------------------------------- render -------------------------------- */

        return (
            <group
                ref={ref}
                position={position}
                rotation={rotation}
                userData={{ ...(node?.userData || {}), __epicType: "node", __nodeId: node?.id }}
                onPointerDown={(e) => {
                    // Node should *always* win when it’s hit
                    e.stopPropagation();
                    onPointerDown?.(node.id, e);
                }}
                castShadow={castShadow && shadowsOn}        // <-- use global too (added in step 2)
                receiveShadow={receiveShadow && shadowsOn}
            >
                {/* main mesh */}
                {!shapeHidden && (
                    <mesh castShadow={castShadow && shadowsOn} receiveShadow={receiveShadow && shadowsOn}>
                        <GeometryForShape shape={shapeToRender} />
                        <meshStandardMaterial color={baseColor} roughness={0.35} metalness={0.05} />
                    </mesh>
                )}

                {/* selection halo */}
                {selected && !shapeHidden && (
                    <mesh renderOrder={9998}>
                        <GeometryForShape
                            shape={(function inflateShape(s) {
                                const t = (s.type || "sphere").toLowerCase();
                                if (t === "sphere") return { ...s, radius: (s.radius ?? 0.32) + 0.02 };
                                if (t === "cylinder" || t === "hexagon" || t === "disc" || t === "circle")
                                    return {
                                        ...s,
                                        radius: (s.radius ?? 0.35) + 0.02,
                                        height: (s.height ?? 0.6) + 0.02,
                                    };
                                if (t === "cone")
                                    return {
                                        ...s,
                                        radius: (s.radius ?? 0.35) + 0.02,
                                        height: (s.height ?? 0.7) + 0.02,
                                    };
                                if (t === "switch")
                                    return {
                                        ...s,
                                        w: (s.w ?? 0.9) + 0.02,
                                        h: (s.h ?? 0.12) + 0.02,
                                        d: (s.d ?? 0.35) + 0.02,
                                    };
                                if (t === "box" || t === "square")
                                    return { ...s, scale: (s.scale || [0.6, 0.3, 0.6]).map((v) => v + 0.02) };
                                return s;
                            })(shapeToRender)}
                        />
                        <meshBasicMaterial color="#ffffff" transparent opacity={0.18} depthWrite={false} />
                    </mesh>
                )}

                {/* lights */}
                {hasLight && (
                    <>
                        {ltype === "spot" && (
                            <>
                                <spotLight
                                    ref={lightRef}
                                    color={color}
                                    intensity={effectiveIntensity}
                                    distance={Math.max(0.01, distance)}
                                    decay={decay}
                                    angle={angle}
                                    penumbra={penumbra}
                                    castShadow={lightCasts && shadowsOn}     // <-- per-node + global
                                    shadow-normalBias={0.02}
                                />
                                <object3D ref={targetRef} position={targetPos} />
                            </>
                        )}
                        {ltype === "point" && (
                            <pointLight color={color}
                                        intensity={intensity}
                                        distance={distance}
                                        decay={decay}
                                        castShadow={lightCasts && shadowsOn}
                                        shadow-mapSize={[1024, 1024]}
                                        shadow-bias={-0.0002}
                            />
                        )}
                        {(ltype === "dir" || ltype === "directional") && (
                            <>
                                <directionalLight ref={lightRef} color={color} intensity={intensity} castShadow={lightCasts && shadowsOn} />
                                <object3D ref={targetRef} position={targetPos} />
                            </>
                        )}
                    </>
                )}

                {/* labels + optional product photo */}
                {labelsOn && labelFull && (
                    <>
                        {labelMode === "billboard" && (
                            <Billboard follow position={[0, yOffset, 0]}>
                                <group>
                                    <Text
                                        fontSize={labelSizeLocal}
                                        color={labelColorLocal}
                                        maxWidth={labelMaxWidth}
                                        anchorX="center"
                                        anchorY="bottom"
                                        outlineWidth={labelOutlineWidth}
                                        outlineColor={labelOutlineColor}
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                    >
                                        {labelFull}
                                    </Text>
                                    {showPhoto && (
                                        <Html
                                            transform
                                            position={[0, labelSize * 0.75, 0]}
                                            pointerEvents="none"
                                        >
                                            <div
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: 6,
                                                    background: "rgba(0,0,0,0.45)",
                                                    border: "1px solid rgba(255,255,255,0.2)",
                                                    padding: "4px 6px",
                                                    borderRadius: 8,
                                                    boxShadow: "0 6px 14px rgba(0,0,0,0.45)",
                                                    backdropFilter: "blur(4px)",
                                                }}
                                            >
                                                <img
                                                    src={coverUrl}
                                                    alt={product.name || "product"}
                                                    style={{
                                                        width: 120,   // larger for readability
                                                        height: 80,
                                                        objectFit: "cover",
                                                        borderRadius: 8,
                                                        imageRendering: "auto"
                                                    }}
                                                    draggable={false}
                                                />
                                            </div>
                                        </Html>
                                    )}
                                </group>
                            </Billboard>
                        )}

                        {labelMode === "3d" && (
                            <group position={[0, yOffset, 0]}>
                                {Array.from({ length: label3DLayers }).map((_, i) => (
                                    <Text
                                        key={`f${i}`}
                                        position={[0, 0, -i * label3DStep]}
                                        fontSize={labelSizeLocal}
                                        color={labelColorLocal}
                                        maxWidth={labelMaxWidth}
                                        anchorX="center"
                                        anchorY="bottom"
                                        outlineWidth={i === 0 ? labelOutlineWidth : 0}
                                        outlineColor={labelOutlineColor}
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                    >
                                        {labelFull}
                                    </Text>
                                ))}
                                <group rotation={[0, Math.PI, 0]}>
                                    {Array.from({ length: label3DLayers }).map((_, i) => (
                                        <Text
                                            key={`b${i}`}
                                            position={[0, 0, -i * label3DStep]}
                                            fontSize={labelSizeLocal}
                                            color={labelColorLocal}
                                            maxWidth={labelMaxWidth}
                                            anchorX="center"
                                            anchorY="bottom"
                                            outlineWidth={labelOutlineWidth}
                                            outlineColor={labelOutlineColor}
                                            depthTest={false}
                                            depthWrite={false}
                                            renderOrder={9999}
                                        >
                                            {labelFull}
                                        </Text>
                                    ))}
                                </group>
                            </group>
                        )}

                        {labelMode === "static" && (
                            <>
                                <group position={[0, yOffset, 0]} rotation={[0, 0, 0]}>
                                    <Text
                                        fontSize={labelSizeLocal}
                                        color={labelColorLocal}
                                        maxWidth={labelMaxWidth}
                                        anchorX="center"
                                        anchorY="bottom"
                                        outlineWidth={0.005}
                                        outlineColor="#000"
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                    >
                                        {labelFull}
                                    </Text>
                                </group>
                                <group position={[0, yOffset, 0]} rotation={[0, Math.PI, 0]}>
                                    <Text
                                        fontSize={labelSizeLocal}
                                        color={labelColorLocal}
                                        maxWidth={labelMaxWidth}
                                        anchorX="center"
                                        anchorY="bottom"
                                        outlineWidth={0.005}
                                        outlineColor="#000"
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                    >
                                        {labelFull}
                                    </Text>
                                </group>
                            </>
                        )}
                    </>
                )}
                {/* text box overlay */}
                {node.textBox?.enabled && (
                    <NodeTextBox
                        enabled={node.textBox.enabled !== false}
                        text={node.textBox.text || ""}

                        // timings
                        fadeIn={Number(node.textBox.fadeIn ?? 0)}
                        hold={Number(node.textBox.hold ?? 0)}
                        fadeOut={Number(node.textBox.fadeOut ?? 0)}
                        useTimers={!!node.textBox.useTimers}
                        autoTriggerId={Number(node.textBox.autoTriggerId ?? 0)}

                        // manual command channel
                        commandId={Number(node.textBox.commandId ?? 0)}
                        commandType={node.textBox.commandType || null} // "show" | "hide" | "fadeIn" | "fadeOut"
                        commandDuration={
                            node.textBox.commandDuration != null
                                ? Number(node.textBox.commandDuration)
                                : null
                        }

                        // visuals (convert old world-units to px if small)
                        bgColor={node.textBox.bgColor ?? "#000000"}
                        bgOpacity={Number(
                            node.textBox.bgOpacity ??
                            node.textBox.backgroundOpacity ?? // legacy
                            0.6
                        )}
                        color={node.textBox.color ?? node.textBox.textColor ?? "#ffffff"}
                        width={(() => {
                            const raw = Number(node.textBox.width ?? 0) || 0;
                            if (raw > 0 && raw <= 5) return raw * 220; // 1.6 → ~350px
                            return raw || 320;
                        })()}
                        height={(() => {
                            const raw = Number(node.textBox.height ?? 0) || 0;
                            if (raw > 0 && raw <= 3) return raw * 180; // 0.8 → ~140px
                            return raw || 140;
                        })()}
                        fontSize={(() => {
                            const raw = Number(node.textBox.fontSize ?? 0) || 0;
                            if (raw > 0 && raw <= 0.5) return raw * 64; // 0.18 → ~11.5px
                            return raw || 16;
                        })()}

                        mode={node.textBox.mode || "billboard"}
                        position={[0, yOffset + 0.4, 0]}
                    />
                )}



                {/* dimension overlays (when product dims are used) */}
                {half && product && productRef?.useDims && (showDimsGlobal || productRef?.showDims) && dimText && (
                    <group>
                        {/* length (Z) */}
                        <Dim
                            a={[-half[0], half[1] + 0.04, -half[2]]}
                            b={[-half[0], half[1] + 0.04, half[2]]}
                            text={`L ${dimText.l}`}
                        />
                        {/* width (X) */}
                        <Dim
                            a={[half[0], half[1] + 0.04, -half[2]]}
                            b={[-half[0], half[1] + 0.04, -half[2]]}
                            text={`W ${dimText.w}`}
                        />
                        {/* height (Y) */}
                        <Dim
                            a={[-half[0], -half[1], half[2]]}
                            b={[-half[0], half[1], half[2]]}
                            text={`H ${dimText.h}`}
                        />
                    </group>
                )}
                {/* overview card when selected and representative is set */}
                {represent?.enabled && (alwaysShow3DInfo || (selected && show3DInfo)) && (
                    <Html
                        transform
                        position={[0, yOffset + labelSize * 0.9 + infoYOffset, 0]}
                        pointerEvents="none"
                    >                        <div
                        style={{
                            minWidth: 260,
                            maxWidth: 380,
                            background: "linear-gradient(180deg, rgba(0,0,0,0.75), rgba(0,0,0,0.55))",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 12,
                            padding: 10,
                            boxShadow: "0 10px 28px rgba(0,0,0,0.55)",
                            color: "#e9f3ff",
                            fontSize: infoFont
                        }}
                    >
                        {represent.kind === "product" && product && (
                            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10 }}>
                                {coverUrl && (
                                    <img
                                        src={coverUrl}
                                        alt={product.name}
                                        style={{ width: 100, height: 70, objectFit: "cover", borderRadius: 8 }}
                                        draggable={false}
                                    />
                                )}
                                <div>
                                    <div style={{ fontWeight: 900, marginBottom: 2 }}>{product.name}</div>
                                    <div style={{ opacity: 0.8 }}>
                                        {[product.category, product.make, product.model].filter(Boolean).join(" › ")}
                                    </div>
                                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                                        <strong>W×H×L:</strong>{" "}
                                        {(product.width ?? product?.dims?.w) ?? 0} × {(product.height ?? product?.dims?.h) ?? 0} × {(product.length ?? product?.dims?.l) ?? 0} {localStorage.getItem("epic3d.productUnits.v1") || "cm"}
                                    </div>
                                </div>
                            </div>
                        )}

                        {represent.kind === "rack" && rackResolved && (
                            <RackListView
                                rack={rackResolved}
                                unit={unit}
                                ui={ui}
                                editable={false}
                            />
                        )}


                    </div>
                    </Html>
                )}


                {/* light bounds */}
                <LightBounds node={node} globalOn={showLightBoundsGlobal} />

            </group>
        );
    })
);

export default Node3D;

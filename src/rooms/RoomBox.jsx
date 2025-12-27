// rooms/RoomBox.jsx
import React, { memo, forwardRef, useMemo, useState } from "react";
import * as THREE from "three";
import { Billboard, Text } from "@react-three/drei";
import DissolveEdgesMaterial from "../materials/DissolveEdgesMaterial.jsx"; // adjust path if needed

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

const RoomBox = memo(
    forwardRef(function RoomBox(
        {
            room,
            selected,
            onPointerDown,
            dragging,                // ← when true we disable room raycasting entirely
            opacity = 0.12,

            // from SceneInner
            wireframeGlobal = false,

            // labels
            labelsOn = true,
            labelMode = "billboard", // "billboard" | "3d" | "static"
            labelSize = 0.24,
            labelMaxWidth = 24,
            label3DLayers = 8,
            label3DStep = 0.01,
            // NEW: room operator UI
            roomOperatorMode = false,
            onRoomAnchorClick,
            onRoomDelete,
            onRoomResize,
        },
        ref
    ) {
        const nodeBounds = room.nodeBounds || {};
        const boundsEnabled = nodeBounds.enabled ?? false;
        const boundsVisible =
            boundsEnabled && (nodeBounds.showBoundary ?? false);

        const isLocked = room.locked;
        const visible = room.visible !== false;
        const size = room.size || [3, 1.6, 2.2];
        const [w, h, d] = size;
        const center = room.center || [0, h * 0.5, 0];
        const [cx, cy, cz] = center;

        // 🔑 In Room Operator we never want to treat the room as "dragging"
        const rotation = room.rotation || [0, 0, 0];

        const halfW = size[0] / 2;
        const halfH = size[1] / 2;
        const halfD = size[2] / 2;
        const [resizeMode, setResizeMode] = useState(false);

        // floor / ceiling
        const showFloor   = room.floor   ?? true;
        const showCeiling = room.ceiling ?? true;

        // per-wall toggles
        const showWallN = room.wallN ?? true; // +Z
        const showWallS = room.wallS ?? true; // -Z
        const showWallE = room.wallE ?? true; // +X
        const showWallW = room.wallW ?? true; // -X

        // solid vs plane walls
        const wallsSolid    = room.wallsSolid ?? false;
        const wallThickness = clamp(room.wallThickness ?? 0.05, 0.005, Math.min(size[0], size[2]) / 4);

        // follow global wireframe?
        const wireWithGlobal = room.wireWithGlobal ?? false;
        const showSurfaces = !(wireframeGlobal && wireWithGlobal);

        // centered gap (“door”) on a chosen wall
        const gapEnabled = room.gap?.enabled ?? false;
        const gapWall    = room.gap?.wall    ?? "north"; // 'north'|'south'|'east'|'west'
        const gapWidth   = Math.max(0, room.gap?.width ?? Math.min(1, size[0] * 0.33));
        const gapHeight  = Math.max(0, room.gap?.height ?? Math.min(1, size[1] * 0.66));

        // neat outline edges (always shown)
        const boxGeo = useMemo(() => new THREE.BoxGeometry(size[0], size[1], size[2]), [size]);
        const edges  = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo]);
        const labelY = halfH + 0.12;

        const color = room.color || "#1b2a44";

        // Material tuning for better, more readable lighting on room surfaces
        const surfaceRoughness = Number(room.surface?.roughness ?? 0.75);
        const surfaceMetalness = Number(room.surface?.metalness ?? 0.02);
        const surfaceEnvIntensity = Number(room.surface?.envMapIntensity ?? 0.9);
        const insideOnly = !!(room.surface?.insideOnly ?? room.insideOnly);

        const surfaceMat = useMemo(() => {
            const mat = new THREE.MeshStandardMaterial({
                color,
                transparent: opacity < 1,
                opacity,
                roughness: Number.isFinite(surfaceRoughness) ? surfaceRoughness : 0.75,
                metalness: Number.isFinite(surfaceMetalness) ? surfaceMetalness : 0.02,
                envMapIntensity: Number.isFinite(surfaceEnvIntensity) ? surfaceEnvIntensity : 0.9,
                side: insideOnly ? THREE.BackSide : THREE.DoubleSide,
                // For transparent surfaces, depthWrite causes "sticking" artifacts.
                depthWrite: opacity >= 0.999,
                depthTest: true,
                blending: THREE.NormalBlending,
            });
            return mat;
        }, [color, opacity, surfaceRoughness, surfaceMetalness, surfaceEnvIntensity, insideOnly]);

        // ---- CORE FIX: block raycasting on *everything* during gizmo drag ----

        // ---- CORE FIX: control hit-testing for locked rooms & dragging ----
        // Large surfaces (floor, ceiling, walls) should be click-through when
        // the room is locked, so nodes behind them always win.
        // And while dragging the gizmo, nothing should be hit-testable.
        const noRaycast = dragging ? () => null : undefined;
        const effectiveDragging = dragging;
        const surfaceRaycast = effectiveDragging ? () => null : undefined;
        const overlayRaycast = effectiveDragging ? () => null : undefined;

// swallow hover/move while dragging so nothing lights up
        const swallow = effectiveDragging ? (e) => e.stopPropagation() : undefined;


        // Edges / labels stay clickable when locked (so you can still select the room),


        // --- WALL BUILDER ---
        function SolidOrPlane({ w, h, T }) {
            if (!showSurfaces) return null;

            if (!wallsSolid) {
                // Thin plane walls
                return (
                    <mesh
                        castShadow
                        receiveShadow
                        raycast={surfaceRaycast}      // ⬅️ use surfaceRaycast here
                        onPointerOver={swallow}
                        onPointerMove={swallow}
                    >
                        <planeGeometry args={[w, h]} />
                        <primitive attach="material" object={surfaceMat} />
                    </mesh>
                );
            }

            // Solid box walls
            return (
                <mesh
                    castShadow
                    receiveShadow
                    position={[0, 0, -T / 2]}
                    raycast={surfaceRaycast}          // ⬅️ and here
                    onPointerOver={swallow}
                    onPointerMove={swallow}
                >
                    <boxGeometry args={[w, h, T]} />
                    <primitive attach="material" object={surfaceMat} />
                </mesh>
            );
        }


        // version that composes 4 strips around a centered gap (width=gw, height=gh)
        function WithGap({ w, h, T, gw, gh }) {
            const lrW = clamp((w - gw) * 0.5, 0, w);       // left/right strip width
            const capH = clamp((h - gh) * 0.5, 0, h);      // top/bottom strip height
            const topY = gh * 0.5 + capH * 0.5;
            const botY = -topY;

            const VStrip = ({ width, x }) => {
                if (width <= 0) return null;
                if (!wallsSolid) {
                    return (
                        <mesh castShadow receiveShadow position={[x, 0, 0]} raycast={overlayRaycast} onPointerOver={swallow} onPointerMove={swallow}>
                            <planeGeometry args={[width, h]} />
                            <primitive attach="material" object={surfaceMat} />

                        </mesh>
                    );
                }
                return (
                    <mesh castShadow receiveShadow position={[x, 0, -T / 2]} raycast={overlayRaycast} onPointerOver={swallow} onPointerMove={swallow}>
                        <boxGeometry args={[width, h, T]} />
                        <primitive attach="material" object={surfaceMat} />

                    </mesh>
                );
            };

            const HStrip = ({ height, y }) => {
                if (height <= 0 || gw <= 0) return null;
                if (!wallsSolid) {
                    return (
                        <mesh castShadow receiveShadow position={[0, y, 0]} raycast={overlayRaycast} onPointerOver={swallow} onPointerMove={swallow}>
                            <planeGeometry args={[gw, height]} />
                            <primitive attach="material" object={surfaceMat} />

                        </mesh>
                    );
                }
                return (
                    <mesh castShadow receiveShadow position={[0, y, -T / 2]} raycast={overlayRaycast} onPointerOver={swallow} onPointerMove={swallow}>
                        <boxGeometry args={[gw, height, T]} />
                        <primitive attach="material" object={surfaceMat} />

                    </mesh>
                );
            };

            return (
                <group>
                    <VStrip width={lrW} x={-(gw * 0.5 + lrW * 0.5)} />
                    <VStrip width={lrW} x={(gw * 0.5 + lrW * 0.5)} />
                    <HStrip height={capH} y={topY} />
                    <HStrip height={capH} y={botY} />
                </group>
            );
        }

        function Wall({ length, height, thickness, withGap, gapW, gapH }) {
            if (!showSurfaces) return null;
            if (!withGap) return <SolidOrPlane w={length} h={height} T={thickness} />;
            return <WithGap w={length} h={height} T={thickness} gw={gapW} gh={gapH} />;
        }

        // Floor / Ceiling (planes)
        const Floor = () => showSurfaces && showFloor ? (
            <mesh
                rotation={[-Math.PI/2, 0, 0]}
                position={[0, -halfH, 0]}
                receiveShadow
                castShadow
                raycast={surfaceRaycast}
                onPointerOver={swallow}
                onPointerMove={swallow}
            >
                <planeGeometry args={[size[0], size[2]]} />
                <primitive attach="material" object={surfaceMat} />
            </mesh>
        ) : null;


        const Ceiling = () => showSurfaces && showCeiling ? (
            <mesh
                rotation={[ Math.PI/2, 0, 0]}
                position={[0, halfH, 0]}
                receiveShadow
                castShadow
                raycast={surfaceRaycast}
                onPointerOver={swallow}
                onPointerMove={swallow}
            >
                <planeGeometry args={[size[0], size[2]]} />
                <primitive attach="material" object={surfaceMat} />
            </mesh>
        ) : null;


        // Walls: groups stay on bounds; rotate groups to orient normals
        const WallNorth = () => showWallN ? (
            <group position={[0, 0,  halfD]}>
                <Wall length={size[0]} height={size[1]} thickness={wallThickness}
                      withGap={gapEnabled && gapWall === "north"} gapW={gapWidth} gapH={gapHeight} />
            </group>
        ) : null;

        const WallSouth = () => showWallS ? (
            <group position={[0, 0, -halfD]} rotation={[0, Math.PI, 0]}>
                <Wall length={size[0]} height={size[1]} thickness={wallThickness}
                      withGap={gapEnabled && gapWall === "south"} gapW={gapWidth} gapH={gapHeight} />
            </group>
        ) : null;

        const WallEast = () => showWallE ? (
            <group position={[ halfW, 0, 0]} rotation={[0, -Math.PI/2, 0]}>
                <Wall length={size[2]} height={size[1]} thickness={wallThickness}
                      withGap={gapEnabled && gapWall === "east"} gapW={gapWidth} gapH={gapHeight} />
            </group>
        ) : null;

        const WallWest = () => showWallW ? (
            <group position={[-halfW, 0, 0]} rotation={[0,  Math.PI/2, 0]}>
                <Wall length={size[2]} height={size[1]} thickness={wallThickness}
                      withGap={gapEnabled && gapWall === "west"} gapW={gapWidth} gapH={gapHeight} />
            </group>
        ) : null;

        return (
            <group
                ref={ref}
                position={center}
                rotation={rotation}
                onPointerDown={(e) => {
                    const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                    if (!isLeft) return;
                    // 1) block rooms during active drag
                    if (effectiveDragging) return;

                    // 2) if any intersection is a node, let the node handle it
                    const hasNodeHit = (e.intersections || []).some((hit) => {
                        if (hit.eventObject?.userData?.__epicType === "node") return true;
                        let o = hit.object;
                        while (o) {
                            if (o.userData?.__epicType === "node") return true;
                            o = o.parent;
                        }
                        return false;
                    });

                    if (hasNodeHit) return; // don't select the room

                    // 3) actually select the room
                    e.stopPropagation();
                    onPointerDown?.(room.id, e);
                }}
                onPointerOver={swallow}
                onPointerMove={swallow}
            >
                {/* Node boundary visualization */}
                {boundsVisible && (() => {
                    const roomSize = size;
                    const [rw, rh, rd] = roomSize;

                    const padding = nodeBounds.padding ?? 0;
                    const shape = nodeBounds.shape || "box";

                    let width  = Number(nodeBounds.width)  || rw;
                    let height = Number(nodeBounds.height) || rh;
                    let depth  = Number(nodeBounds.depth)  || rd;

                    const innerH = Math.max(0, height - padding * 2);

                    if (shape === "circle") {
                        let radius = Number(nodeBounds.radius);
                        const innerW = Math.max(0, width - padding * 2);
                        const innerD = Math.max(0, depth - padding * 2);
                        if (!Number.isFinite(radius) || radius <= 0) {
                            radius =
                                (Math.min(innerW, innerD) ||
                                    Math.min(rw, rd)) / 2;
                        }
                        if (radius <= 0) return null;

                        return (
                            <group>
                                {/* Top ring in XZ at top of boundary */}
                                <mesh
                                    rotation={[-Math.PI / 2, 0, 0]}
                                    position={[0, innerH / 2 || 0, 0]}
                                >
                                    <ringGeometry
                                        args={[radius * 0.98, radius, 64]}
                                    />
                                    <meshBasicMaterial
                                        color="#22ffff"
                                        transparent
                                        opacity={0.5}
                                        side={THREE.DoubleSide}
                                        depthWrite={false}
                                    />
                                </mesh>
                            </group>
                        );
                    }

                    // Box shape
                    const innerW = Math.max(0, width - padding * 2);
                    const innerD = Math.max(0, depth - padding * 2);

                    if (innerW <= 0 || innerD <= 0 || innerH <= 0) return null;

                    return (
                        <mesh>
                            <boxGeometry
                                args={[innerW, innerH, innerD]}
                            />
                            <meshBasicMaterial
                                color="#22ffff"
                                wireframe
                                transparent
                                opacity={0.35}
                                depthWrite={false}
                            />
                        </mesh>
                    );
                })()}

                <Floor />
                <Ceiling />
                <WallNorth />
                <WallSouth />
                <WallEast />
                <WallWest />
                {/* Room Operator magnet anchors */}
                {roomOperatorMode && onRoomAnchorClick && (
                    <group>
                        {[
                            { key: "north", pos: [0, 0.06,  halfD + 0.02] },  // Up (+Z)
                            { key: "south", pos: [0, 0.06, -halfD - 0.02] },  // Down (-Z)
                            { key: "east",  pos: [ halfW + 0.02, 0.06, 0] },  // Right (+X)
                            { key: "west",  pos: [-halfW - 0.02, 0.06, 0] },  // Left (-X)
                        ].map(({ key, pos }) => (
                            <mesh
                                key={key}
                                position={pos}
                                onPointerDown={(e) => {
                                    const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                    if (!isLeft) return;
                                    e.stopPropagation();
                                    console.log("[RoomBox] magnet clicked", {
                                        roomId: room.id,
                                        side: key,
                                    });
                                    if (!dragging && onRoomAnchorClick) {
                                        onRoomAnchorClick(room.id, key);
                                    }
                                }}
                            >
                                <sphereGeometry args={[0.08, 16, 16]} />
                                <meshBasicMaterial
                                    color="#22c55e"
                                    transparent
                                    opacity={0.95}
                                    depthWrite={false}
                                />
                            </mesh>
                        ))}
                    </group>
                )}



                {/* Edges — also non-raycast when dragging */}
                <lineSegments
                    geometry={edges}
                    raycast={overlayRaycast}
                    onPointerOver={swallow}
                    onPointerMove={swallow}
                >
                    <DissolveEdgesMaterial
                        color={selected ? "#00e1ff" : "#8aa1c3"}
                        gap={room.gapShader || { size: 0.14, falloff: 0.06, center: [0, 0, 0] }}
                    />
                </lineSegments>
                {/* ROOM OPERATOR: big clickable UI for floorplan editing */}
                {roomOperatorMode && (
                    <>
                        {/* DELETE + MODIFY icons (billboarded, with large invisible hitboxes) */}
                        <Billboard position={[0, halfH + 0.25, 0]}>
                            <group>
                                {/* Delete hit area */}
                                <mesh
                                    position={[-0.35, 0, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomDelete && onRoomDelete(room.id);
                                    }}
                                >
                                    {/* Big invisible box for easy clicking */}
                                    <boxGeometry args={[0.5, 0.3, 0.05]} />
                                    <meshBasicMaterial
                                        transparent
                                        opacity={0}  // invisible, only used for picking
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Visible delete icon */}
                                <Text
                                    position={[-0.35, 0, 0.02]}
                                    fontSize={0.18}
                                    color="#ef4444"
                                    depthWrite={false}
                                >
                                    ✕
                                </Text>

                                {/* Modify hit area */}
                                <mesh
                                    position={[0.35, 0, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        setResizeMode((v) => !v);
                                    }}
                                >
                                    <boxGeometry args={[0.5, 0.3, 0.05]} />
                                    <meshBasicMaterial
                                        transparent
                                        opacity={0}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Visible modify icon */}
                                <Text
                                    position={[0.35, 0, 0.02]}
                                    fontSize={0.18}
                                    color={resizeMode ? "#38bdf8" : "#0ea5e9"}
                                    depthWrite={false}
                                >
                                    ⇔
                                </Text>
                            </group>
                        </Billboard>

                        {/* SIDE HANDLES for new rooms: Up / Down / Left / Right */}
                        {onRoomAnchorClick && (
                            <group>
                                {/* Up (+Z) */}
                                <mesh
                                    position={[0, 0.02, halfD + 0.12]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomAnchorClick(room.id, "up");
                                    }}
                                >
                                    <boxGeometry args={[size[0] * 0.4, 2.04, 0.18]} />
                                    <meshBasicMaterial
                                        color="#22c55e"
                                        transparent
                                        opacity={0.9}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Down (-Z) */}
                                <mesh
                                    position={[0, 0.02, -halfD - 0.12]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomAnchorClick(room.id, "down");
                                    }}
                                >
                                    <boxGeometry args={[size[0] * 0.4, 2.04, 0.18]} />
                                    <meshBasicMaterial
                                        color="#22c55e"
                                        transparent
                                        opacity={0.9}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Right (+X) */}
                                <mesh
                                    position={[halfW + 0.12, 0.02, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomAnchorClick(room.id, "right");
                                    }}
                                >
                                    <boxGeometry args={[0.18, 2.04, size[2] * 0.4]} />
                                    <meshBasicMaterial
                                        color="#22c55e"
                                        transparent
                                        opacity={0.9}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Left (-X) */}
                                <mesh
                                    position={[-halfW - 0.12, 0.02, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomAnchorClick(room.id, "left");
                                    }}
                                >
                                    <boxGeometry args={[0.18, 2.04, size[2] * 0.4]} />
                                    <meshBasicMaterial
                                        color="#22c55e"
                                        transparent
                                        opacity={0.9}
                                        depthWrite={false}
                                    />
                                </mesh>
                            </group>
                        )}

                        {/* RESIZE HANDLES – only when Modify is active */}
                        {resizeMode && onRoomResize && (
                            <group>
                                {/* Grow to the right */}
                                <mesh
                                    position={[halfW * 0.6, 2.01, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomResize(room.id, "right");
                                    }}
                                >
                                    <boxGeometry args={[0.42, 0.03, size[2] * 0.5]} />
                                    <meshBasicMaterial
                                        color="#38bdf8"
                                        transparent
                                        opacity={0.85}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Grow to the left */}
                                <mesh
                                    position={[-halfW * 0.6, 2.01, 0]}
                                    onPointerDown={(e) => {
                                        const isLeft = (e?.button === 0 || e?.button === undefined) && (e?.buttons == null || (e.buttons & 1));
                                        if (!isLeft) return;
                                        e.stopPropagation();
                                        if (dragging) return;
                                        onRoomResize(room.id, "left");
                                    }}
                                >
                                    <boxGeometry args={[0.42, 0.03, size[2] * 0.5]} />
                                    <meshBasicMaterial
                                        color="#38bdf8"
                                        transparent
                                        opacity={0.85}
                                        depthWrite={false}
                                    />
                                </mesh>
                            </group>
                        )}
                    </>
                )}


                {/* Labels */}
                {labelsOn && room?.name && (
                    <>
                        {labelMode === "billboard" && (
                            <Billboard follow position={[0, labelY, 0]}>
                                <Text
                                    fontSize={labelSize}
                                    maxWidth={labelMaxWidth}
                                    anchorX="center"
                                    anchorY="bottom"
                                    color="white"
                                    outlineWidth={0.005}
                                    outlineColor="#000"
                                    depthTest={false}
                                    depthWrite={false}
                                    renderOrder={9999}
                                    raycast={overlayRaycast}
                                    onPointerOver={swallow}
                                    onPointerMove={swallow}
                                >
                                    {room.name}
                                </Text>
                            </Billboard>
                        )}

                        {labelMode === "3d" && (
                            <group position={[0, labelY, 0]}>
                                {Array.from({ length: label3DLayers }).map((_, i) => (
                                    <Text
                                        key={`rf${i}`}
                                        position={[0, 0, -i * label3DStep]}
                                        fontSize={labelSize}
                                        maxWidth={labelMaxWidth}
                                        anchorX="center"
                                        anchorY="bottom"
                                        color="white"
                                        depthTest={false}
                                        depthWrite={false}
                                        renderOrder={9999}
                                        raycast={overlayRaycast}
                                        onPointerOver={swallow}
                                        onPointerMove={swallow}
                                    >
                                        {room.name}
                                    </Text>
                                ))}
                            </group>
                        )}
                        {labelMode === "static" && (
                            <group position={[0, labelY, 0]}>
                                <Text
                                    fontSize={labelSize}
                                    maxWidth={labelMaxWidth}
                                    anchorX="center"
                                    anchorY="bottom"
                                    color="white"
                                    depthTest={false}
                                    depthWrite={false}
                                    renderOrder={9999}
                                    raycast={overlayRaycast}
                                    onPointerOver={swallow}
                                    onPointerMove={swallow}
                                >
                                    {room.name}
                                </Text>
                            </group>
                        )}
                    </>
                )}
            </group>
        );
    })
);

export default RoomBox;

import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { QuadraticBezierLine } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import FlowParticles from "./FlowParticles.jsx";
import IconFlow from "./IconFlow.jsx";
import EpicTube from "./EpicTube.jsx";
import SweepLine from "./SweepLine.jsx";

const UP = new THREE.Vector3(0, 1, 0);
const V0 = new THREE.Vector3();
const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
function hash01(n) {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
}

function midpoint(from, to, mode = "up", bend = 0.3) {
    const a = V0.set(from[0], from[1], from[2]);
    const b = V1.set(to[0], to[1], to[2]);
    const m = a.clone().lerp(b, 0.5);

    if (!bend || mode === "straight") return m;

    const dir = b.clone().sub(a);
    const side = dir.clone().cross(UP).normalize();
    const lift = UP.clone();

    if (mode === "up") m.addScaledVector(lift, dir.length() * bend * 0.6);
    else if (mode === "side") m.addScaledVector(side, dir.length() * bend * 0.6);
    else if (mode === "arc") {
        m.addScaledVector(lift, dir.length() * bend * 0.45);
        m.addScaledVector(side, dir.length() * bend * 0.45);
    }
    return m;
}

export default React.memo(function Link3D({
                                              link,
                                              from,
                                              to,
                                              selected,
                                              onPointerDown,
                                              animate = true,
                                              segmentIndex = 0,
                                              segmentCount = 1,
                                          }) {
    const style   = link?.style || "particles";
    const color   = link?.color || "#7cf";
    const width   = link?.width ?? 2;
    const active =
        (link?.isLinked === true ||
            link?.connected === true ||
            link?.status === "linked" ||
            link?.active === true) && (link?.active !== false);

    const speed   = link?.speed ?? 1;
    const kind    = link?.kind || null;           // NEW: "wifi" | "wired" | "fiber"
    const fx      = link?.effects || {};          // NEW: { rainbow, sparks, headPulse }
    const scale   = link?.scale ?? 1;             // NEW: multiplier for size across styles
    const mode     = link?.curve?.mode ?? "up";
    const bend     = link?.curve?.bend ?? 0.3;
    const noiseAmp = link?.curve?.noiseAmp ?? 0;
    const noiseFrq = link?.curve?.noiseFreq ?? 1.5;

    const byKind = (() => {
        if (kind === "wifi") {
            return {
                style: style === "icons" ? "icons" : "wavy",
                particles: { waveAmp: 0.18, waveFreq: 2.2, count: 28, size: 0.07 },
                icon: { char: "➤" },
                effects: { rainbow: true },
                width: 2,
                color: color || "#70eaff",
            };
        }
        if (kind === "wired") {
            return { style: style || "solid", width: Math.max(2, width), effects: { rainbow: false }, color: color || "#9bd0ff" };
        }
        if (kind === "fiber") {
            return { style: (style || "epic"), effects: { rainbow: true, sparks: true }, width: width, color: color || "#80d8ff" };
        }
        return {};
    })();

    const mergedStyle = byKind.style || style;
    const mergedColor = byKind.color || color;
    // Cable bundle config (style === "cable")
    const cableConf   = link?.cable || {};
    const cableCount  = Math.max(1, Math.min(32, Math.round(cableConf.count ?? 4)));
    const cableSpread = cableConf.spread ?? 0.12;
    const cableRough  = cableConf.roughness ?? 0.25;
    const cableAnchor = cableConf.anchor ?? 1;    // 1 = meet at node core, 0 = fully parallel at node
    const cableScram  = cableConf.scramble ?? 0;  // 0–1, messy / wavy

    // Base midpoint (parametric)
    const baseMid = useMemo(() => midpoint(from, to, mode, bend), [from, to, mode, bend]);
    // Base midpoint (parametric)
    // Radial offsets for each cable strand in a plane orthogonal to the link
    // Radial offsets for each cable strand in a plane orthogonal to the link
    const cableOffsets = useMemo(() => {
        const offsets = [];
        if (cableCount <= 0) return offsets;

        const dir = V0.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        if (dir.lengthSq() === 0) {
            offsets.push([0, 0, 0]);
            return offsets;
        }
        dir.normalize();

        const side = V1.copy(dir).cross(UP);
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        side.normalize();

        const up = V2.copy(dir).cross(side).normalize();

        // core strand in the middle
        offsets.push([0, 0, 0]);

        const outer = Math.max(0, cableCount - 1);
        const radiusBase = cableSpread;

        for (let i = 0; i < outer; i++) {
            const t = outer <= 1 ? 0 : i / outer;
            let angle = t * Math.PI * 2;

            if (cableRough > 0) {
                const jitter = (hash01(i + 1) - 0.5) * 2; // [-1,1]
                angle += jitter * 0.9 * cableRough;
            }

            let radius = radiusBase;
            if (cableRough > 0) {
                const rj = (hash01(100 + i) - 0.5) * 2;
                radius *= 1 + rj * 0.6 * cableRough;
            }

            const c = Math.cos(angle);
            const s = Math.sin(angle);

            let ox = side.x * c * radius + up.x * s * radius;
            let oy = side.y * c * radius + up.y * s * radius;
            let oz = side.z * c * radius + up.z * s * radius;

            // Extra “scramble” – push strands in random directions
            if (cableScram > 0) {
                const scrScale = cableScram * (radiusBase + 0.02);
                const j1 = hash01(200 + i) - 0.5;
                const j2 = hash01(300 + i) - 0.5;
                const j3 = hash01(400 + i) - 0.5;
                ox += (side.x * j1 + up.x * j2 + dir.x * j3) * scrScale;
                oy += (side.y * j1 + up.y * j2 + dir.y * j3) * scrScale;
                oz += (side.z * j1 + up.z * j2 + dir.z * j3) * scrScale;
            }

            offsets.push([ox, oy, oz]);
        }

        return offsets;
    }, [from, to, cableCount, cableSpread, cableRough, cableScram]);


    // Live "mid" we can wiggle per frame
    const midRef = useRef(baseMid.clone());
    useEffect(() => { midRef.current.copy(baseMid); }, [baseMid]);

    // A persistent bezier curve we mutate per-frame (so children always have same object ref)
    const bezierRef = useRef(
        new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(...from),
            baseMid.clone(),
            new THREE.Vector3(...to)
        )
    );

    // Keep endpoints up-to-date when from/to change
    useEffect(() => {
        const c = bezierRef.current;
        c.v0.set(from[0], from[1], from[2]);
        c.v1.copy(midRef.current);
        c.v2.set(to[0], to[1], to[2]);
    }, [from, to]);

    // Wiggle the midpoint (noise) + push into curve each frame
    useFrame(({ clock }) => {
        if (!animate) return;
        const c = bezierRef.current;
        if (!c) return;

        // Curve wiggle
        if (noiseAmp > 0) {
            const t = clock.getElapsedTime() * (noiseFrq || 1.5);
            midRef.current.set(
                baseMid.x + Math.sin(t * 1.13 + from[0]) * noiseAmp,
                baseMid.y + Math.cos(t * 0.87 + to[1]) * noiseAmp,
                baseMid.z + Math.sin(t * 1.41 + from[2]) * noiseAmp
            );
            c.v1.copy(midRef.current); // push new control point
        }
    });

// Dashed animation: directly mutate the LineMaterial dashOffset
    const dashedRef = useRef();
    const dashOffset = useRef(0);
    useFrame((_, delta) => {
        if (!animate || mergedStyle !== "dashed") return;
        if (link?.dash?.animate === false) return;

        const dashSpeed = link?.dash?.speed ?? 1; // NEW: per-link dash speed multiplier
        dashOffset.current -= (speed || 1) * dashSpeed * (delta * 0.8);

        const mat = dashedRef.current?.material;
        if (mat) {
            if (typeof mat.dashOffset !== "undefined") {
                mat.dashOffset = dashOffset.current;
            } else if (mat.uniforms?.dashOffset) {
                mat.uniforms.dashOffset.value = dashOffset.current;
            }
        }
    });


    if (!active) return null;

    const pointerProps = onPointerDown ? { onPointerDown } : {};





    return (
        <group {...pointerProps}>
            {mergedStyle === "solid" && (
                <QuadraticBezierLine
                    start={from}
                    end={to}
                    mid={[midRef.current.x, midRef.current.y, midRef.current.z]}
                    color={mergedColor}
                    lineWidth={width * scale}
                    transparent
                    opacity={selected ? 1 : 0.92}
                    depthWrite={false}
                />
            )}

            {mergedStyle === "dashed" && (
                <QuadraticBezierLine
                    ref={dashedRef}
                    start={from}
                    end={to}
                    mid={[midRef.current.x, midRef.current.y, midRef.current.z]}
                    color={mergedColor}
                    lineWidth={width * scale}
                    dashed
                    dashScale={link?.dash?.length ?? 1}
                    dashSize={link?.dash?.gap ?? 0.25}
                    // dashOffset is driven per-frame on the material
                    transparent
                    opacity={selected ? 1 : 0.96}
                    depthWrite={false}
                />
            )}

            {(mergedStyle === "particles" || mergedStyle === "wavy") && (
                <FlowParticles
                    curve={bezierRef.current}
                    count={link.particles?.count ?? 24}
                    size={link.particles?.size ?? 0.06}
                    color={link.particles?.color ?? mergedColor}
                    sizeMult={scale}
                    rainbow={(fx.rainbow ?? false) || (byKind.effects?.rainbow ?? false)}
                    speed={(speed || 1) * (mergedStyle === "wavy" ? 1.1 : 1)}
                    opacity={link.particles?.opacity ?? 1}
                    waveAmp={link.particles?.waveAmp ?? (mergedStyle === "wavy" ? 0.18 : 0.06)}
                    waveFreq={link.particles?.waveFreq ?? 2}
                    shape={link.particles?.shape || "sphere"}
                    selected={!!selected}
                    animate={animate}
                />
            )}

            {mergedStyle === "icons" && (
                <IconFlow
                    curve={bezierRef.current}
                    char={link.icon?.char ?? byKind.icon?.char ?? "▶"}
                    count={link.icon?.count ?? 4}
                    size={link.icon?.size ?? 0.14}
                    color={link.icon?.color ?? mergedColor}
                    sizeMult={scale}
                    rainbow={(fx.rainbow ?? false) || (byKind.effects?.rainbow ?? false)}
                    speed={speed || 1}
                    opacity={0.95}
                    selected={!!selected}
                    animate={animate}
                />
            )}

            {mergedStyle === "sweep" && (
                <SweepLine
                    curve={bezierRef.current}
                    // base look
                    color={link.sweep?.color ?? mergedColor}
                    color2={link.sweep?.color2}
                    gradient={link.sweep?.gradient ?? false}
                    thickness={link.sweep?.thickness ?? 0.06}
                    thicknessMult={scale}
                    // timings (big ranges supported)
                    duration={link.sweep?.duration ?? 1.4}
                    hold={link.sweep?.hold ?? 0.12}
                    fadeEnabled={link.sweep?.fadeEnabled ?? true}
                    fade={link.sweep?.fade ?? 0.6}
                    pause={link.sweep?.pause ?? 0.2}
                    resetGap={link.sweep?.resetGap ?? 0.05}
                    speed={link.sweep?.speed ?? speed ?? 1}
                    fadeCurve={link.sweep?.fadeCurve ?? "smooth"}
                    // motion modes
                    pingpong={link.sweep?.pingpong ?? false}
                    durationBack={link.sweep?.durationBack ?? link.sweep?.duration}
                    holdBack={link.sweep?.holdBack ?? 0}
                    // pulse-draw visibility
                    fillMode={link.sweep?.fillMode ?? "trail"}
                    trailLength={link.sweep?.trailLength ?? 0.18}
                    baseVisible={link.sweep?.baseVisible ?? false}
                    invert={link.sweep?.invert ?? false}   // fix “draw from start” vs reversed curves
                    // aesthetic extras
                    feather={link.sweep?.feather ?? 0.06}
                    glow={link.sweep?.glow ?? 1.15}
                    passes={link.sweep?.passes ?? 1}
                    passDelay={link.sweep?.passDelay ?? 0.25}
                    colors={link.sweep?.colors}
                    headSize={link.sweep?.headSize ?? 1}
                    headPulseAmp={link.sweep?.headPulseAmp ?? 0.2}
                    headPulseFreq={link.sweep?.headPulseFreq ?? 1.6}
                    pulseAmp={link.sweep?.pulseAmp ?? 0.0}
                    pulseFreq={link.sweep?.pulseFreq ?? 1.5}
                    // end FX: angle, ease, softness, size, duration
                    endFx={link.sweep?.endFx}
                    // shared flags
                    rainbow={(fx.rainbow ?? false) || (byKind.effects?.rainbow ?? false)}
                    selected={!!selected}
                    animate={animate}
                />
            )}
            {/* Cable bundle */}
            {mergedStyle === "cable" && (
                <group>
                    {cableOffsets.map((off, idx) => {
                        // 0 = fully detached parallel; 1 = converge at node center
                        const sOff = 1 - cableAnchor;

                        const start = [
                            from[0] + off[0] * sOff,
                            from[1] + off[1] * sOff,
                            from[2] + off[2] * sOff,
                        ];
                        const end = [
                            to[0] + off[0] * sOff,
                            to[1] + off[1] * sOff,
                            to[2] + off[2] * sOff,
                        ];

                        // mid = global curved mid + strand offset + a bit of scramble
                        let mx = midRef.current.x + off[0];
                        let my = midRef.current.y + off[1];
                        let mz = midRef.current.z + off[2];

                        if (cableScram > 0) {
                            const scrScale = cableScram * (cableSpread + 0.02);
                            const j1 = hash01(500 + idx) - 0.5;
                            const j2 = hash01(600 + idx) - 0.5;
                            const j3 = hash01(700 + idx) - 0.5;
                            mx += j1 * scrScale;
                            my += j2 * scrScale;
                            mz += j3 * scrScale;
                        }

                        return (
                            <QuadraticBezierLine
                                key={idx}
                                start={start}
                                end={end}
                                mid={[mx, my, mz]}
                                color={mergedColor}
                                lineWidth={
                                    width * scale *
                                    (idx === 0 ? 1.0 : 0.7) // core a bit thicker
                                }
                                transparent
                                opacity={selected ? 1 : 0.94}
                                depthWrite={false}
                            />
                        );
                    })}
                </group>
            )}


            {mergedStyle === "epic" && (
                <EpicTube
                    curve={bezierRef.current}
                    thickness={link.tube?.thickness ?? 0.07}
                    glow={link.tube?.glow ?? 1.4}
                    color={link.tube?.color ?? mergedColor}
                    speed={speed || 1}
                    trail={link.tube?.trail !== false}
                    selected={!!selected}
                    widthHint={width * scale}
                    animate={animate}
                    thicknessMult={scale}
                    rainbow={(fx.rainbow ?? false) || (byKind.effects?.rainbow ?? false)}
                    sparks={(fx.sparks ?? false) || (byKind.effects?.sparks ?? false)}
                />
            )}


            {mergedStyle === "epic" && (
                <EpicTube
                    curve={bezierRef.current}
                    thickness={link.tube?.thickness ?? 0.07}
                    glow={link.tube?.glow ?? 1.4}
                    color={link.tube?.color ?? mergedColor}
                    speed={speed || 1}
                    trail={link.tube?.trail !== false}
                    selected={!!selected}
                    widthHint={width * scale}
                    animate={animate}
                    thicknessMult={scale}
                    rainbow={(fx.rainbow ?? false) || (byKind.effects?.rainbow ?? false)}
                    sparks={(fx.sparks ?? false) || (byKind.effects?.sparks ?? false)}
                />
            )}
        </group>
    );
});

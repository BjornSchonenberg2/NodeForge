import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

const TAU = Math.PI * 2;

function clamp01(x) {
    return x < 0 ? 0 : (x > 1 ? 1 : x);
}

function ease01(x, curve = "linear") {
    x = clamp01(x);
    switch (curve) {
        case "linear":
            return x;
        case "smooth":
            return x * x * (3 - 2 * x);
        case "sine":
            return 0.5 - 0.5 * Math.cos(Math.PI * x);
        case "exp":
            return 1 - Math.exp(-5 * x);
        case "expo":
            return 1 - Math.pow(2, -10 * x);
        case "back": {
            const c1 = 1.70158;
            const c3 = c1 + 1;
            return c3 * x * x * x - c1 * x * x;
        }
        case "bounce": {
            const n1 = 7.5625;
            const d1 = 2.75;
            if (x < 1 / d1) return n1 * x * x;
            if (x < 2 / d1) { x -= 1.5 / d1; return n1 * x * x + 0.75; }
            if (x < 2.5 / d1) { x -= 2.25 / d1; return n1 * x * x + 0.9375; }
            x -= 2.625 / d1; return n1 * x * x + 0.984375;
        }
        default:
            return x;
    }
}

/**
 * SweepLine (ultra)
 * - Pulse draw: "trail" mode shows only a moving window (trailLength) behind the head.
 * - Direction: set invert to draw from end->start; otherwise start->end.
 * - Extended timings: very long durations/fades; reset gap; ping-pong back; easing.
 * - Multi-pass: multiple staggered flows with per-pass color list.
 * - Gradient: color -> color2 along the tube.
 * - Head/body pulses.
 * - End FX: "wave" | "ripple" | "burst" | "cone" | "sparkle" | "spiral" (+ angle, ease, softness, speed).
 */
function SweepPass({
                       curve,
                       geom,
                       color,
                       color2 = null,
                       gradient = false,
                       thickness = 0.06,
                       thicknessMult = 1,
                       duration = 1.4,
                       hold = 0.12,
                       fade = 0.6,
                       pause = 0.2,
                       speed = 1,
                       feather = 0.06,
                       glow = 1.15,
                       selected = false,
                       animate = true,
                       rainbow = false,
                       // visibility
                       fillMode = "trail",  // "trail"|"fill"
                       trailLength = 0.18,  // 0..1 window length
                       baseVisible = false,
                       // motion
                       pingpong = false,
                       durationBack = null,
                       holdBack = 0.0,
                       fadeEnabled = true,
                       fadeCurve = "smooth",
                       resetGap = 0.0,
                       // pulses
                       headSize = 1.0,
                       headPulseAmp = 0.2,
                       headPulseFreq = 1.6,
                       pulseAmp = 0.0,
                       pulseFreq = 1.5,
                       // motion shaping
                       moveCurve = "linear",
                       moveSteps = 0,
                       moveJitterAmp = 0.0,
                       moveJitterFreq = 1.5,
                       // draw pattern
                       drawStyle = "solid", // solid|dashed|strobe
                       dashFreq = 14.0,
                       dashDuty = 0.55,
                       dashSpeed = 0.55,
                       strobeFreq = 22.0,
                       strobeDuty = 0.28,
                       strobeSpeed = 1.2,
                       // fades & shimmer
                       tailFade = 0.0,
                       tailFadePow = 1.6,
                       startFade = 0.0,
                       startFadeLen = 0.12,
                       shimmerAmp = 0.0,
                       shimmerFreq = 1.0,
                       // end fx
                       endFx = { enabled: false, type: "wave", duration: 0.6, size: 1.0, speed: 1.0, color: null, angleDeg: 0, ease: "smooth", softness: 0.4 },
                       // direction
                       invert = false,
                       // offsets
                       timeOffset = 0,
                   }) {
    const mat = useMemo(() => {
        const uniforms = {
            uColor: { value: new THREE.Color(color) },
            uColor2: { value: new THREE.Color(color2 || color) },
            uUseGradient: { value: gradient ? 1 : 0 },
            uProg: { value: 0 },
            uGlobalFade: { value: 0 },
            uFeather: { value: Math.min(0.80, Math.max(0.0, feather)) },
            uEmissiveBoost: { value: glow },
            uPulse: { value: 1.0 },
            uTrail: { value: THREE.MathUtils.clamp(trailLength, 0, 1) },
            uFill: { value: fillMode === "fill" ? 1 : 0 },
            uInvert: { value: invert ? 1 : 0 },
            uTime: { value: 0 },
            uDrawMode: { value: drawStyle === "dashed" ? 1 : drawStyle === "strobe" ? 2 : 0 },
            uDashFreq: { value: dashFreq },
            uDashDuty: { value: dashDuty },
            uDashSpeed: { value: dashSpeed },
            uStrobeFreq: { value: strobeFreq },
            uStrobeDuty: { value: strobeDuty },
            uStrobeSpeed: { value: strobeSpeed },
            uTailFade: { value: THREE.MathUtils.clamp(tailFade, 0, 1) },
            uTailFadePow: { value: Math.max(0.1, tailFadePow) },
            uStartFade: { value: THREE.MathUtils.clamp(startFade, 0, 1) },
            uStartFadeLen: { value: Math.max(0.001, startFadeLen) },
            uShimmerAmp: { value: THREE.MathUtils.clamp(shimmerAmp, 0, 1) },
            uShimmerFreq: { value: Math.max(0.001, shimmerFreq) },
        };
        return new THREE.ShaderMaterial({
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            uniforms,
            vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
            fragmentShader: `
        uniform vec3 uColor, uColor2;
        uniform int uUseGradient;
        uniform float uProg, uGlobalFade, uFeather, uEmissiveBoost, uPulse;
        uniform float uTrail, uFill, uInvert;
        uniform float uTime;
        uniform float uTailFade, uTailFadePow;
        uniform float uStartFade, uStartFadeLen;
        uniform int uDrawMode; // 0 solid, 1 dashed, 2 strobe
        uniform float uDashFreq, uDashDuty, uDashSpeed;
        uniform float uStrobeFreq, uStrobeDuty, uStrobeSpeed;
        uniform float uShimmerAmp, uShimmerFreq;
        varying vec2 vUv;
        void main() {
          float sRaw = clamp(vUv.x, 0.0, 1.0);
          float s = (uInvert >= 0.5) ? (1.0 - sRaw) : sRaw;

          // Head mask
          float head = smoothstep(uProg - uFeather, uProg, s);

          // Body window (fill or trail)
          float body;
          if (uFill >= 0.5) {
            body = step(s, uProg);
          } else {
            float tail = smoothstep(uProg - uTrail, uProg, s);
            body = tail * step(s, uProg);
          }
          float alpha = body * head;

          // Tail fade: 0 at tail, 1 at head
          float denom = (uFill >= 0.5) ? max(uProg, 0.0001) : max(uTrail, 0.0001);
          float tailStart = (uFill >= 0.5) ? 0.0 : (uProg - uTrail);
          float localT = clamp((s - tailStart) / denom, 0.0, 1.0);
          float tailF = mix(1.0, pow(localT, uTailFadePow), uTailFade);
          alpha *= tailF;

          // Optional start fade (near source)
          float startF = mix(1.0, smoothstep(0.0, uStartFadeLen, s), uStartFade);
          alpha *= startF;

          // Draw patterns (dash/strobe)
          float pattern = 1.0;
          if (uDrawMode == 1) {
            float ph = fract(sRaw * uDashFreq + uTime * uDashSpeed);
            pattern = step(ph, uDashDuty);
          } else if (uDrawMode == 2) {
            float ph = fract(sRaw * uStrobeFreq + uTime * uStrobeSpeed);
            pattern = step(ph, uStrobeDuty);
          }
          alpha *= pattern;

          float vis = alpha * (1.0 - uGlobalFade);
          if (vis <= 0.0001) discard;

          vec3 col = (uUseGradient == 1) ? mix(uColor, uColor2, sRaw) : uColor;

          // Shimmer along the line
          float sh = 1.0 + uShimmerAmp * sin((sRaw * 3.0 + uTime * uShimmerFreq) * 6.2831853);
          col *= sh;

          col *= (1.0 + uEmissiveBoost * 0.65) * uPulse;
          gl_FragColor = vec4(col, vis);
        }
      `,
        });
    }, [color, color2, gradient, feather, glow, trailLength, fillMode, invert, drawStyle, dashFreq, dashDuty, dashSpeed, strobeFreq, strobeDuty, strobeSpeed, tailFade, tailFadePow, startFade, startFadeLen, shimmerAmp, shimmerFreq]);

    const baseMat = useMemo(
        () =>
            new THREE.MeshBasicMaterial({
                color: new THREE.Color(color),
                transparent: true,
                opacity: selected ? 0.38 : 0.3,
                depthWrite: false,
                toneMapped: false,
                side: THREE.DoubleSide,
            }),
        [color, selected]
    );

    const headRef = useRef();
    const endWaveRef = useRef();
    const endBurstRef = useRef();

    useFrame(({ clock }) => {
        if (!mat || !mat.uniforms) return;
        const t = animate ? clock.getElapsedTime() - timeOffset : 0;

        // long/slow timings supported
        const drawF = Math.max(0.08, duration) / Math.max(0.001, speed);
        const holdF = Math.max(0, hold) / Math.max(0.001, speed);
        const drawB = pingpong ? Math.max(0.08, (durationBack ?? duration)) / Math.max(0.001, speed) : 0;
        const holdB = pingpong ? Math.max(0, holdBack) / Math.max(0.001, speed) : 0;
        const fadeT = (fadeEnabled ? Math.max(0.0, fade) : 0.0) / Math.max(0.001, speed);
        const pauseT = Math.max(0, (pause + resetGap)) / Math.max(0.001, speed);
        const cycle = drawF + holdF + drawB + holdB + fadeT + pauseT;
        if (cycle <= 0.0001) return;

        const at = ((t % cycle) + cycle) % cycle;

        let uProg = 0.0, uFade = 1.0, dir = 1.0;

        if (at < drawF)              { uProg = at / drawF; uFade = 0.0; dir =  1.0; }
        else if (at < drawF + holdF) { uProg = 1.0;        uFade = 0.0; dir =  1.0; }
        else if (pingpong && at < drawF + holdF + drawB) {
            const tt = at - (drawF + holdF);
            uProg = 1.0 - (tt / drawB); uFade = 0.0; dir = -1.0;
        } else if (pingpong && at < drawF + holdF + drawB + holdB) {
            uProg = 0.0; uFade = 0.0; dir = -1.0;
        } else if (fadeT > 0 && at < drawF + holdF + drawB + holdB + fadeT) {
            uProg = pingpong ? 0.0 : 1.0;
            const ft = (at - (drawF + holdF + drawB + holdB)) / fadeT;
            let f = ft;
            if (fadeCurve === "smooth") f = ft * ft * (3.0 - 2.0 * ft);
            else if (fadeCurve === "exp") f = 1.0 - Math.exp(-5.0 * ft);
            else if (fadeCurve === "sine") f = 0.5 - 0.5 * Math.cos(Math.PI * ft);
            else if (fadeCurve === "expo") f = 1.0 - Math.pow(2.0, -10.0 * ft);
            uFade = THREE.MathUtils.clamp(f, 0, 1);
        } else {
            uProg = 0.0; uFade = 1.0;
        }

        // motion shaping
        if (moveCurve && moveCurve !== "linear") {
            if (dir >= 0) uProg = ease01(uProg, moveCurve);
            else uProg = 1.0 - ease01(1.0 - uProg, moveCurve);
        }
        if (moveSteps && moveSteps > 1) {
            uProg = Math.round(uProg * moveSteps) / moveSteps;
        }
        if ((moveJitterAmp || 0) > 0 && uFade <= 0.001) {
            const j = Math.sin(t * (moveJitterFreq || 1.5) * TAU) * moveJitterAmp;
            uProg = THREE.MathUtils.clamp(uProg + j, 0, 1);
        }

        // rainbow
        if (rainbow) {
            const h = (t * 0.08) % 1;
            const c1 = new THREE.Color().setHSL(h, 0.9, 0.55);
            mat.uniforms.uColor.value.copy(c1);
            baseMat.color.copy(c1);
            if (gradient) {
                const c2 = new THREE.Color().setHSL((h + 0.18) % 1, 0.9, 0.55);
                mat.uniforms.uColor2.value.copy(c2);
            }
        }

        // pulses
        const pulse = 1.0 + (pulseAmp || 0) * Math.sin(t * (pulseFreq || 1) * Math.PI * 2.0);
        mat.uniforms.uPulse.value = pulse;

        // uniforms
        mat.uniforms.uProg.value = uProg;
        mat.uniforms.uTrail.value = THREE.MathUtils.clamp(trailLength, 0, 1);
        mat.uniforms.uFill.value  = (fillMode === "fill") ? 1.0 : 0.0;
        mat.uniforms.uInvert.value = invert ? 1.0 : 0.0;

        // time for dash/strobe/shimmer
        mat.uniforms.uTime.value = t;
        mat.uniforms.uDrawMode.value = (drawStyle === "dashed") ? 1 : (drawStyle === "strobe") ? 2 : 0;
        mat.uniforms.uDashFreq.value = dashFreq;
        mat.uniforms.uDashDuty.value = dashDuty;
        mat.uniforms.uDashSpeed.value = dashSpeed;
        mat.uniforms.uStrobeFreq.value = strobeFreq;
        mat.uniforms.uStrobeDuty.value = strobeDuty;
        mat.uniforms.uStrobeSpeed.value = strobeSpeed;
        mat.uniforms.uTailFade.value = THREE.MathUtils.clamp(tailFade, 0, 1);
        mat.uniforms.uTailFadePow.value = Math.max(0.1, tailFadePow);
        mat.uniforms.uStartFade.value = THREE.MathUtils.clamp(startFade, 0, 1);
        mat.uniforms.uStartFadeLen.value = Math.max(0.001, startFadeLen);
        mat.uniforms.uShimmerAmp.value = THREE.MathUtils.clamp(shimmerAmp, 0, 1);
        mat.uniforms.uShimmerFreq.value = Math.max(0.001, shimmerFreq);
        mat.uniforms.uGlobalFade.value = THREE.MathUtils.clamp(uFade, 0, 1);

        const boost = (selected ? 1.25 : 1.0) * (glow || 1.0);
        baseMat.opacity = (baseVisible ? 1.0 : 0.0) * (selected ? 0.42 : 0.32) * (1.0 - mat.uniforms.uGlobalFade.value) * Math.min(1.6, boost);

        // head (respect invert for position)
        if (headRef.current) {
            const showHead = (uFade <= 0.001) && (uProg > 0.0) && (uProg <= 1.0);
            headRef.current.visible = showHead;
            const pProg = invert ? (1.0 - uProg) : uProg;
            const p = curve.getPointAt(THREE.MathUtils.clamp(pProg, 0, 1));
            const tAt = THREE.MathUtils.clamp(pProg + (dir < 0 ? -0.001 : 0.001), 0, 1);
            const n = curve.getTangentAt(tAt);
            headRef.current.position.copy(p);
            headRef.current.lookAt(p.clone().addScaledVector(n, dir));
            const sPulse = 1.0 + (headPulseAmp || 0) * Math.sin(t * (headPulseFreq || 1.6) * Math.PI * 2.0);
            const s = (0.35 * headSize + Math.sin(t * 6.28) * 0.15) * (thickness * thicknessMult * 14) * sPulse;
            headRef.current.scale.setScalar(Math.max(0.0001, s));
        }

        // End FX
        if (!pingpong && endFx?.enabled) {
            const rate = Math.max(0.001, endFx.speed ?? 1);
            const endDur = (Math.max(0.05, endFx.duration ?? 0.6) / Math.max(0.001, speed)) / rate;
            const endStart = drawF + holdF;
            const active = at >= endStart && at <= (endStart + endDur);

            const ep = curve.getPointAt(invert ? 0.0 : 1.0);
            const tg = curve.getTangentAt(invert ? 0.001 : 0.999);
            const raw = THREE.MathUtils.clamp((at - endStart) / endDur, 0, 1);
            let e = raw;
            switch (endFx.ease ?? "smooth") {
                case "linear": e = raw; break;
                case "smooth": e = raw * raw * (3 - 2 * raw); break;
                case "exp":    e = 1 - Math.exp(-5 * raw); break;
                case "expo":   e = 1 - Math.pow(2, -10 * raw); break;
                case "sine":   e = 0.5 - 0.5 * Math.cos(Math.PI * raw); break;
            }
            const soft = THREE.MathUtils.clamp(endFx.softness ?? 0.4, 0, 1);

            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), tg.clone().normalize());
            const spin = new THREE.Quaternion().setFromAxisAngle(tg, (endFx.angleDeg ?? 0) * Math.PI / 180);
            q.multiply(spin);

            // wave / ripple (ring)
            if (endWaveRef.current) {
                const mesh = endWaveRef.current;
                mesh.visible = active && (["wave","ripple","spiral"].includes(endFx.type));
                if (mesh.visible) {
                    mesh.position.copy(ep);
                    mesh.setRotationFromQuaternion(q);

                    // spiral: a little twist while growing
                    if (endFx.type === "spiral") {
                        const twist = new THREE.Quaternion().setFromAxisAngle(tg, e * Math.PI * 2.0);
                        mesh.quaternion.multiply(twist);
                    }

                    const base = (endFx.type === "ripple") ? (0.3 + e * 1.2) : (0.2 + e * 1.6);
                    const scl = (endFx.size ?? 1) * base;
                    mesh.scale.setScalar(scl);
                    const m = mesh.material;
                    m.color = new THREE.Color(endFx.color ?? color);
                    const fade = (endFx.type === "ripple") ? (1.0 - e * 0.8) : (1.0 - e);
                    m.opacity = Math.max(0, fade) * 0.85;
                }
            }

            // burst / cone / sparkle (soft sphere)
            if (endBurstRef.current) {
                const mesh = endBurstRef.current;
                mesh.visible = active && (["burst","cone","sparkle"].includes(endFx.type));
                if (mesh.visible) {
                    mesh.position.copy(ep);
                    mesh.setRotationFromQuaternion(q);
                    const base = (endFx.type === "cone") ? (0.25 + e * 1.8) : (0.2 + e * 1.6);
                    const scl = (endFx.size ?? 1) * base;
                    mesh.scale.setScalar(scl);
                    const m = mesh.material;
                    m.color = new THREE.Color(endFx.color ?? color);
                    const fall = Math.pow(1.0 - e, 1.0 - soft*0.85);
                    m.opacity = fall * 0.9;
                }
            }
        } else {
            if (endWaveRef.current) endWaveRef.current.visible = false;
            if (endBurstRef.current) endBurstRef.current.visible = false;
        }
    });

    return (
        <group>
            <mesh geometry={geom} material={baseMat} />
            <mesh geometry={geom} material={mat} />
            <mesh ref={headRef}>
                <sphereGeometry args={[0.04, 12, 12]} />
                <meshBasicMaterial color={new THREE.Color(color)} transparent opacity={0.7} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>

            {/* End FX meshes */}
            <mesh ref={endWaveRef} visible={false}>
                <ringGeometry args={[0.9, 1.0, 64]} />
                <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh ref={endBurstRef} visible={false}>
                <sphereGeometry args={[0.2, 24, 24]} />
                <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
    );
}

export default function SweepLine(props) {
    const {
        curve,
        color = "#7cf",
        thickness = 0.06,
        thicknessMult = 1,
        duration = 1.4,
        hold = 0.12,
        fade = 0.6,
        pause = 0.2,
        speed = 1,
        feather = 0.06,
        glow = 1.15,
        selected = false,
        animate = true,
        rainbow = false,
        passes = 1,
        passDelay = 0.25,
        pingpong = false,
        durationBack = null,
        holdBack = 0.0,
        fadeEnabled = true,
        fadeCurve = "smooth",
        resetGap = 0.0,
        gradient = false,
        color2 = null,
        headSize = 1.0,
        headPulseAmp = 0.2,
        headPulseFreq = 1.6,
        pulseAmp = 0.0,
        pulseFreq = 1.5,
        // motion shaping
        moveCurve = "linear",
        moveSteps = 0,
        moveJitterAmp = 0.0,
        moveJitterFreq = 1.5,
        // draw pattern
        drawStyle = "solid",
        dashFreq = 14.0,
        dashDuty = 0.55,
        dashSpeed = 0.55,
        strobeFreq = 22.0,
        strobeDuty = 0.28,
        strobeSpeed = 1.2,
        // fades & shimmer
        tailFade = 0.0,
        tailFadePow = 1.6,
        startFade = 0.0,
        startFadeLen = 0.12,
        shimmerAmp = 0.0,
        shimmerFreq = 1.0,
        // base time offset (useful to chain multi-segment links)
        timeOffset = 0,
        colors = null,
        // visibility & dir
        fillMode = "trail",
        trailLength = 0.18,
        baseVisible = false,
        invert = false,
        // fx
        endFx,
    } = props;

    const geom = useMemo(() => {
        const tubularSegments = 320;
        return new THREE.TubeGeometry(curve, tubularSegments, Math.max(0.002, thickness * thicknessMult), 12, false);
    }, [curve, thickness, thicknessMult]);

    const list = Array.from({ length: Math.max(1, Math.floor(passes)) }, (_, i) => ({
        key: i,
        color: colors?.[i % (colors?.length || 1)] || color,
        tOff: (timeOffset || 0) + i * Math.max(0, passDelay),
    }));

    return (
        <group>
            {list.map((it) => (
                <SweepPass
                    key={it.key}
                    curve={curve}
                    geom={geom}
                    color={it.color}
                    color2={color2}
                    gradient={gradient}
                    thickness={thickness}
                    thicknessMult={thicknessMult}
                    duration={duration}
                    hold={hold}
                    fade={fade}
                    pause={pause}
                    speed={speed}
                    feather={feather}
                    glow={glow}
                    selected={selected}
                    animate={animate}
                    rainbow={rainbow}
                    pingpong={pingpong}
                    durationBack={durationBack}
                    holdBack={holdBack}
                    fadeEnabled={fadeEnabled}
                    fadeCurve={fadeCurve}
                    resetGap={resetGap}
                    headSize={headSize}
                    headPulseAmp={headPulseAmp}
                    headPulseFreq={headPulseFreq}
                    pulseAmp={pulseAmp}
                    pulseFreq={pulseFreq}
                    moveCurve={moveCurve}
                    moveSteps={moveSteps}
                    moveJitterAmp={moveJitterAmp}
                    moveJitterFreq={moveJitterFreq}
                    drawStyle={drawStyle}
                    dashFreq={dashFreq}
                    dashDuty={dashDuty}
                    dashSpeed={dashSpeed}
                    strobeFreq={strobeFreq}
                    strobeDuty={strobeDuty}
                    strobeSpeed={strobeSpeed}
                    tailFade={tailFade}
                    tailFadePow={tailFadePow}
                    startFade={startFade}
                    startFadeLen={startFadeLen}
                    shimmerAmp={shimmerAmp}
                    shimmerFreq={shimmerFreq}
                    fillMode={fillMode}
                    trailLength={trailLength}
                    baseVisible={baseVisible}
                    invert={invert}
                    endFx={endFx}
                    timeOffset={it.tOff}
                />
            ))}
        </group>
    );
}

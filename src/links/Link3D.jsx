import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { QuadraticBezierLine } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import FlowParticles from "./FlowParticles.jsx";
import IconFlow from "./IconFlow.jsx";
import EpicTube from "./EpicTube.jsx";
import SweepLine from "./SweepLine.jsx";

const UP = new THREE.Vector3(0, 1, 0);
const TMP_V0 = new THREE.Vector3();
const TMP_V1 = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();

function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

function hash01(n) {
    // deterministic pseudo-random in [0..1]
    const x = Math.sin(n * 999.123) * 43758.5453;
    return x - Math.floor(x);
}

function toArr3(v) {
    if (Array.isArray(v)) return [Number(v[0] || 0), Number(v[1] || 0), Number(v[2] || 0)];
    if (v && typeof v === "object") {
        if (v.isVector3) return [v.x || 0, v.y || 0, v.z || 0];
        return [Number(v.x || 0), Number(v.y || 0), Number(v.z || 0)];
    }
    return [0, 0, 0];
}

function vec3From(v) {
    const a = toArr3(v);
    return new THREE.Vector3(a[0], a[1], a[2]);
}

function makePacketTextTexture(text, color = "#ffffff") {
    if (typeof document === "undefined") return null;
    const t = String(text ?? "").slice(0, 18) || "PKT";

    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // transparent BG
    ctx.clearRect(0, 0, size, size);

    // soft glow backdrop
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = "rgba(0,0,0,0.0)";
    ctx.restore();

    // text
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = color;
    ctx.shadowBlur = 28;
    ctx.fillStyle = "rgba(255,255,255,0.95)";

    // auto size: emoji tends to be wider
    const baseFont = 128;
    ctx.font = `900 ${baseFont}px system-ui, Segoe UI Emoji, Apple Color Emoji, sans-serif`;
    // shrink-to-fit
    const metrics = ctx.measureText(t);
    const w = metrics.width || 1;
    const scale = Math.min(1, (size * 0.78) / w);
    ctx.font = `900 ${Math.floor(baseFont * scale)}px system-ui, Segoe UI Emoji, Apple Color Emoji, sans-serif`;

    ctx.fillText(t, 0, 0);
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
}

function normalizePacket(link, mergedColor) {
    const p = link?.packet || {};
    const visual = p.visual || {};
    const pathIn = p.path || {};
    const timingIn = p.timing || {};
    const emit = p.emit || {};
    const successIn = p.success || {};

    // Back-compat: earlier flat keys + newer nested editor schema
    const styleRaw = p.style || p.packetStyle || visual.shape || p.packetShape || "orb";
    const text = p.text || p.label || visual.text || "PKT";

    // Normalize shape naming across editors
    let style = styleRaw;
    if (style === "square") style = "cube";
    if (style === "shard") style = "diamond";
    if (style === "static") style = "cube";
    if (style === "comet") style = "orb";

    // Path mode mapping (UI uses hidden|line|dashes|particles|pulse)
    let pathMode =
        pathIn.mode ||
        pathIn.style ||
        p.pathMode ||
        (p.showPath ? "line" : "hidden") ||
        "hidden";

    if (pathMode === "invisible") pathMode = "hidden";
    if (pathMode === "dashes" || pathMode === "dash") pathMode = "dashed";
    if (pathMode === "pulse") pathMode = "sweep";

    const mergedPacketColor = p.color || visual.color || mergedColor || "#7cf";

    const rawSuccessType = successIn.mode || successIn.type || p.successMode || "pulse";
    const successMode = (() => {
        if (rawSuccessType === "none") return "none";
        if (rawSuccessType === "burst") return "explosion";
        if (rawSuccessType === "sparkles") return "spark";
        return rawSuccessType;
    })();

    const intensity = Math.max(0, Number(successIn.intensity ?? p.successIntensity ?? 1) || 1);

    return {
        style,
        text,
        size: Number(p.size ?? visual.size ?? 0.14) || 0.14,
        opacity: Math.max(0, Math.min(1, Number(p.opacity ?? 1) || 1)),
        color: mergedPacketColor,
        pulseAmp: Number(p.pulseAmp ?? visual.pulse ?? 0.18) || 0,
        pulseFreq: Number(p.pulseFreq ?? 2.5) || 0,
        spin: Number(p.spin ?? visual.spin ?? 0.9) || 0,
        wobble: Number(p.wobble ?? 0.0) || 0,
        billboard: (p.billboard ?? true) === true,
        maxVisible: Math.max(8, Math.min(512, Number(p.maxVisible ?? 160) || 160)),

        path: {
            mode: pathMode,
            color: pathIn.color || p.pathColor || mergedPacketColor,
            opacity: Math.max(0, Math.min(1, Number(pathIn.opacity ?? 0.2) || 0.2)),
            width: Number(pathIn.width ?? 1) || 1,
            dashSize: Number(pathIn.dashSize ?? 0.15) || 0.15,
            gapSize: Number(pathIn.gapSize ?? 0.10) || 0.1,
            dashSpeed: Number(pathIn.dashSpeed ?? pathIn.speed ?? 1) || 1,
            particleCount: Math.max(1, Math.min(160, Number(pathIn.particleCount ?? 36) || 36)),
            particleSize: Number(pathIn.particleSize ?? 0.045) || 0.045,
            particleSpeed: Number(pathIn.particleSpeed ?? pathIn.speed ?? 1) || 1,
            showWhenSelected: (pathIn.showWhenSelected ?? true) === true,
            onlyWhenActive: (pathIn.onlyWhenActive ?? true) === true,
        },

        timing: {
            travel: Math.max(0.05, Number(timingIn.travel ?? timingIn.travelDuration ?? p.travel ?? 1.2) || 1.2),
            delay: Math.max(0, Number(timingIn.delay ?? timingIn.startDelay ?? p.delay ?? 0) || 0),
            count: Math.max(1, Math.floor(Number(timingIn.count ?? emit.count ?? p.count ?? 1) || 1)),
            interval: Math.max(0, Number(timingIn.interval ?? emit.interval ?? p.interval ?? 0.35) || 0.35),
            loop: (timingIn.loop ?? emit.loop ?? p.loop ?? false) === true,
            loopGap: Math.max(0, Number(timingIn.loopGap ?? emit.burstInterval ?? p.loopGap ?? 0.6) || 0.6),
            burstsLimit: Math.max(0, Math.floor(Number(timingIn.burstsLimit ?? emit.bursts ?? p.burstsLimit ?? 0) || 0)),
            clearOnStart: (timingIn.clearOnStart ?? emit.clearOnStart ?? p.clearOnStart ?? true) !== false,
            autoStart: (timingIn.autoStart ?? p.autoStart ?? false) === true,
        },

        success: {
            mode: successMode, // none | pulse | explosion | spark
            color: successIn.color || p.successColor || mergedPacketColor,
            size: Math.max(0.05, Number(successIn.size ?? p.successSize ?? 0.6) || 0.6),
            duration: Math.max(0.05, Number(successIn.duration ?? p.successDuration ?? 0.55) || 0.55),
            intensity,

            // Ring burst tuning
            ringCount: Math.max(0, Math.min(12, Math.floor(Number(successIn.ringCount ?? successIn.rings ?? 1) || 1))),
            ringThickness: Math.max(0.02, Math.min(0.35, Number(successIn.ringThickness ?? 0.10) || 0.10)),
            ringOpacity: Math.max(0, Math.min(1, Number(successIn.ringOpacity ?? 0.85) || 0.85)),
            ringDelay: Math.max(0, Math.min(0.6, Number(successIn.ringDelay ?? 0.04) || 0.04)),

            // Spark burst tuning
            sparkCount: Math.max(0, Math.min(96, Math.floor(Number(successIn.sparkCount ?? successIn.sparks ?? (successMode === "explosion" ? 16 : successMode === "spark" ? 10 : 0)) || 0))),
            sparkSpeed: Math.max(0, Number(successIn.sparkSpeed ?? 1.35) || 1.35),
            sparkSize: Math.max(0.02, Math.min(0.5, Number(successIn.sparkSize ?? 0.16) || 0.16)),
            sparkSpread: Math.max(0, Math.min(1, Number(successIn.sparkSpread ?? 1) || 1)),
            sparkDrag: Math.max(0, Math.min(1, Number(successIn.sparkDrag ?? 0.18) || 0.18)),
            sparkShape: String(successIn.sparkShape ?? "sphere"),
        },
    };
}

export default React.memo(function Link3D({
                                              link,
                                              from,
                                              to,
                                              points,
                                              selected,
                                              onPointerDown,
                                              animate = true,
                                              cableOffsets: cableOffsetsProp,
                                          }) {
    // Ensure stable numeric arrays for external components
    const fromArr = useMemo(() => toArr3(from), [from]);
    const toArr = useMemo(() => toArr3(to), [to]);

    const fromV = useMemo(() => new THREE.Vector3(fromArr[0], fromArr[1], fromArr[2]), [fromArr]);
    const toV = useMemo(() => new THREE.Vector3(toArr[0], toArr[1], toArr[2]), [toArr]);

    const style = link?.style || "particles";
    const mergedStyle = style;
    const speed = link?.speed ?? 0.9;
    const width = link?.width ?? 2;
    const scale = 1;
    const mergedColor = link?.color || "#7cf";

    const fx = link?.fx || {};
    const byKind = (link?.flowPreset && link.flowPreset[mergedStyle]) || {};

    // Links should render by default ("active" is an opt-out).
    // Some scenes don't set isLinked/connected/status, which previously caused links to vanish.
    const active = link?.active !== false;

    // Path curve for multi-breakpoint links
    const pathCurve = useMemo(() => {
        if (!Array.isArray(points) || points.length < 2) return null;
        const pts = points.map((p) => vec3From(p));
        try {
            const c = new THREE.CatmullRomCurve3(pts);
            c.curveType = "catmullrom";
            c.closed = false;
            c.tension = 0.2;
            return c;
        } catch {
            return null;
        }
    }, [
        // stable key
        Array.isArray(points) ? points.map((p) => toArr3(p).join(",")).join("|") : "",
    ]);

    const canUsePathCurve = !!pathCurve && new Set(["sweep", "particles", "wavy", "icons", "epic", "packet"]).has(mergedStyle);

    const curveMode = link?.curve?.mode || "up";
    const bend = Number(link?.curve?.bend ?? 0.3) || 0;

    const baseMid = useMemo(() => {
        // midpoint in world space
        const a = TMP_V0.set(fromArr[0], fromArr[1], fromArr[2]);
        const b = TMP_V1.set(toArr[0], toArr[1], toArr[2]);
        const mid = a.clone().add(b).multiplyScalar(0.5);

        if (!bend || curveMode === "straight") return mid;

        const dir = b.clone().sub(a);
        const dist = dir.length() || 0;
        if (!dist) return mid;
        dir.multiplyScalar(1 / dist);

        const k = dist * bend * 0.6;

        if (curveMode === "up") {
            mid.y += k;
        } else if (curveMode === "side") {
            const side = dir.clone().cross(UP).normalize();
            mid.add(side.multiplyScalar(k));
        } else if (curveMode === "arc") {
            const side = dir.clone().cross(UP).normalize();
            mid.y += k * 0.75;
            mid.add(side.multiplyScalar(k * 0.6));
        }
        return mid;
    }, [fromArr, toArr, curveMode, bend]);

    // Live midpoint for noise wiggle (shared for all styles)
    const midRef = useRef(baseMid.clone());
    useEffect(() => {
        midRef.current.copy(baseMid);
    }, [baseMid]);

    // Persistent quadratic curve (mutated per-frame if noise)
    const bezierRef = useRef(
        new THREE.QuadraticBezierCurve3(
            fromV.clone(),
            baseMid.clone(),
            toV.clone(),
        ),
    );

    // Keep endpoints in sync
    useEffect(() => {
        const c = bezierRef.current;
        c.v0.copy(fromV);
        c.v1.copy(midRef.current);
        c.v2.copy(toV);
    }, [fromV, toV]);

    // Optional noise on control point
    const noiseAmp = Number(link?.noise?.amp ?? 0) || 0;
    const noiseFrq = Number(link?.noise?.freq ?? 1.5) || 1.5;

    useFrame(({ clock }) => {
        if (!animate) return;
        if (noiseAmp <= 0) return;
        const t = clock.getElapsedTime() * noiseFrq;
        midRef.current.set(
            baseMid.x + Math.sin(t * 1.13 + fromArr[0]) * noiseAmp,
            baseMid.y + Math.cos(t * 0.87 + toArr[1]) * noiseAmp,
            baseMid.z + Math.sin(t * 1.41 + fromArr[2]) * noiseAmp,
        );
        bezierRef.current.v1.copy(midRef.current);
    });

    // Core curve used for FX
    const curveForFx = canUsePathCurve ? pathCurve : bezierRef.current;

    // Dash animation for dashed line style
    const dashedRef = useRef();
    const dashOffset = useRef(0);

    useFrame((_, delta) => {
        if (!animate || mergedStyle !== "dashed") return;
        if (link?.dash?.animate === false) return;
        const dashSpeed = link?.dash?.speed ?? 1;
        dashOffset.current -= (speed || 1) * dashSpeed * (delta * 0.8);

        const mat = dashedRef.current?.material;
        if (mat) {
            if (typeof mat.dashOffset !== "undefined") mat.dashOffset = dashOffset.current;
            else if (mat.uniforms?.dashOffset) mat.uniforms.dashOffset.value = dashOffset.current;
        }
    });

    // Sweep colors helper (existing behavior)
    const sweepColors = useMemo(() => {
        const list = (link?.sweep?.colors || []).filter(Boolean);
        return list.length ? list : null;
    }, [link?.sweep?.colors]);

    const sweepEndFx = useMemo(() => {
        const e = link?.sweep?.endFx || null;
        if (!e) return null;
        return {
            mode: e.mode || "pulse",
            size: e.size ?? 0.35,
            duration: e.duration ?? 0.35,
            soften: e.soften ?? 0.15,
        };
    }, [link?.sweep?.endFx]);

    // Cable bundle offsets (fallback if SceneInner did not precompute)
    const cableCount = Math.max(1, Math.floor(link?.cable?.count ?? 6));
    const cableSpread = Number(link?.cable?.spread ?? 0.12) || 0.12;
    const cableRough = Number(link?.cable?.roughness ?? 0.25) || 0;
    const cableScram = Number(link?.cable?.scramble ?? 0) || 0;
    const cableAnchor = Math.max(0, Math.min(1, Number(link?.cable?.anchor ?? 1) || 1));

    const cableOffsets = useMemo(() => {
        if (Array.isArray(cableOffsetsProp) && cableOffsetsProp.length) return cableOffsetsProp;
        if (mergedStyle !== "cable") return [];

        const A = TMP_V0.set(fromArr[0], fromArr[1], fromArr[2]);
        const B = TMP_V1.set(toArr[0], toArr[1], toArr[2]);
        const dir = TMP_V2.copy(B).sub(A).normalize();
        let side = dir.clone().cross(UP);
        if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0);
        side.normalize();
        const up = dir.clone().cross(side).normalize();

        const offsets = [];
        offsets.push([0, 0, 0]);

        const outer = Math.max(0, cableCount - 1);
        const radiusBase = cableSpread;

        for (let i = 0; i < outer; i++) {
            const t = outer <= 1 ? 0 : i / outer;
            let angle = t * Math.PI * 2;

            if (cableRough > 0) {
                const jitter = (hash01(i + 1) - 0.5) * 2;
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
    }, [cableOffsetsProp, mergedStyle, fromArr, toArr, cableCount, cableSpread, cableRough, cableScram]);

    // ---------------- Packet runtime (event-driven) ----------------
    const isPacket = mergedStyle === "packet";
    const pktCfg = useMemo(() => normalizePacket(link, mergedColor), [link, mergedColor]);
    const pktCfgRef = useRef(pktCfg);
    useEffect(() => {
        pktCfgRef.current = pktCfg;
    }, [pktCfg]);

    const pktRuntime = useRef({
        emitter: null,
        packets: [],
        rings: [],
        sparks: [],
        queuedStart: null,
        lastCurveId: 0,
        startedOnce: false,
    });

    const timeRef = useRef(0);

    const packetMeshRef = useRef();
    const ringMeshRef = useRef();
    const sparkMeshRef = useRef();

    const packetGeo = useMemo(() => {
        if (!isPacket) return null;
        const st = pktCfg.style;
        if (st === "cube") return new THREE.BoxGeometry(1, 1, 1);
        if (st === "diamond") return new THREE.OctahedronGeometry(0.75, 0);
        if (st === "ring" || st === "waves") return new THREE.TorusGeometry(0.6, 0.18, 10, 18);
        if (st === "spark") return new THREE.TetrahedronGeometry(0.8, 0);
        if (st === "text" || st === "envelope") return new THREE.PlaneGeometry(1, 1);
        return new THREE.SphereGeometry(0.6, 14, 12);
    }, [isPacket, pktCfg.style]);

    const packetTex = useMemo(() => {
        if (!isPacket) return null;
        if (pktCfg.style !== "text" && pktCfg.style !== "envelope") return null;
        const t = pktCfg.style === "envelope" ? "✉" : pktCfg.text;
        return makePacketTextTexture(t, pktCfg.color);
    }, [isPacket, pktCfg.style, pktCfg.text, pktCfg.color]);

    useEffect(() => {
        return () => {
            // dispose texture (avoid leaks when editing)
            if (packetTex) packetTex.dispose?.();
        };
    }, [packetTex]);

    const packetMat = useMemo(() => {
        if (!isPacket) return null;

        // For text/envelope: use texture with additive-ish glow
        if (pktCfg.style === "text" || pktCfg.style === "envelope") {
            const m = new THREE.MeshBasicMaterial({
                color: new THREE.Color(pktCfg.color),
                map: packetTex || null,
                transparent: true,
                opacity: pktCfg.opacity,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            return m;
        }

        const m = new THREE.MeshBasicMaterial({
            color: new THREE.Color(pktCfg.color),
            transparent: true,
            opacity: pktCfg.opacity,
            depthWrite: false,
        });
        return m;
    }, [isPacket, pktCfg.style, pktCfg.color, pktCfg.opacity, packetTex]);

    useEffect(() => {
        return () => {
            packetMat?.dispose?.();
            packetGeo?.dispose?.();
        };
    }, [packetMat, packetGeo]);

    // Success: pulse rings + optional sparks
    const ringGeo = useMemo(() => {
        if (!isPacket) return null;
        const inner = 0.35;
        const thick = Math.max(0.02, Math.min(0.35, Number(pktCfg.success.ringThickness ?? 0.10) || 0.10));
        const outer = inner + thick;
        return new THREE.RingGeometry(inner, outer, 32);
    }, [isPacket, pktCfg.success.ringThickness]);

    const ringMat = useMemo(() => {
        if (!isPacket) return null;
        return new THREE.MeshBasicMaterial({
            color: new THREE.Color(pktCfg.success.color || pktCfg.color),
            transparent: true,
            opacity: Math.max(0, Math.min(1, Number(pktCfg.success.ringOpacity ?? 0.85) || 0.85)),
            depthWrite: false,
            side: THREE.DoubleSide,
        });
    }, [isPacket, pktCfg.success.color, pktCfg.color, pktCfg.success.ringOpacity]);

    const sparkGeo = useMemo(() => {
        if (!isPacket) return null;
        const shape = String(pktCfg.success.sparkShape || "sphere").toLowerCase();
        if (shape === "tetra" || shape === "tetrahedron" || shape === "triangle") {
            return new THREE.TetrahedronGeometry(0.14, 0);
        }
        if (shape === "cube" || shape === "box" || shape === "square") {
            return new THREE.BoxGeometry(0.22, 0.22, 0.22);
        }
        return new THREE.SphereGeometry(0.13, 10, 8);
    }, [isPacket, pktCfg.success.sparkShape]);

    const sparkMat = useMemo(() => {
        if (!isPacket) return null;
        return new THREE.MeshBasicMaterial({
            color: new THREE.Color(pktCfg.success.color || pktCfg.color),
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
        });
    }, [isPacket, pktCfg.success.color, pktCfg.color]);

    useEffect(() => {
        return () => {
            ringGeo?.dispose?.();
            ringMat?.dispose?.();
            sparkGeo?.dispose?.();
            sparkMat?.dispose?.();
        };
    }, [ringGeo, ringMat, sparkGeo, sparkMat]);

    // Packet path preview geometry (for line/dashed)
    const pathGeom = useMemo(() => {
        if (!isPacket) return null;
        const c = curveForFx;
        if (!c?.getPoints) return null;
        const pts = c.getPoints(80);
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        return g;
    }, [isPacket, curveForFx]);

    useEffect(() => {
        return () => {
            pathGeom?.dispose?.();
        };
    }, [pathGeom]);

    const dashedPathLineRef = useRef();
    const dashedPathOffset = useRef(0);

    useEffect(() => {
        // compute dashed distances
        const line = dashedPathLineRef.current;
        if (line && typeof line.computeLineDistances === "function") {
            try {
                line.computeLineDistances();
            } catch {
                // ignore
            }
        }
    }, [pathGeom, isPacket]);

    // Event listener for start/stop from actions
    // Supports multiple payload shapes for backwards compatibility.
    useEffect(() => {
        if (typeof window === "undefined") return;

        const pickOverrides = (detail) => {
            const d = detail || {};
            const raw =
                (d.overrides && typeof d.overrides === "object" ? d.overrides : null) ||
                (d.options && typeof d.options === "object" ? d.options : null) ||
                (d.packet && typeof d.packet === "object" ? d.packet : null) ||
                (d.emit && typeof d.emit === "object" ? d.emit : null);

            const out = { ...(raw || {}) };

            // Also accept top-level keys (older callers) when overrides/options are absent.
            const allow = [
                "travel",
                "travelDuration",
                "duration",
                "delay",
                "startDelay",
                "count",
                "packets",
                "interval",
                "loop",
                "loopGap",
                "burstInterval",
                "bursts",
                "burstsLimit",
                "clearOnStart",
            ];
            for (const k of allow) {
                if (d[k] != null && out[k] == null) out[k] = d[k];
            }
            return out;
        };

        const handler = (ev) => {
            const d = ev?.detail || {};
            if (!d) return;
            if (!isPacket) return;

            const linkId = link?.id;
            if (!linkId) return;

            const matches = (() => {
                if (d.all === true) return true;
                if (d.linkId && d.linkId === linkId) return true;
                if (Array.isArray(d.linkIds) && d.linkIds.includes(linkId)) return true;
                if (d.fromId && d.toId && d.fromId === link?.from && d.toId === link?.to) return true;
                return false;
            })();

            if (!matches) return;

            // Event name based defaults
            const type = String(ev?.type || "");
            const action =
                String(d.action || d.type || "").toLowerCase() ||
                (type.includes("STOP") ? "stop" : "start");

            if (action === "stop") {
                pktRuntime.current.emitter = null;
                pktRuntime.current.packets = [];
                pktRuntime.current.rings = [];
                pktRuntime.current.sparks = [];
                return;
            }

            if (action === "start" || action === "send" || action === "run") {
                // queue start so the frame loop uses a consistent clock
                pktRuntime.current.queuedStart = {
                    at: timeRef.current,
                    overrides: pickOverrides(d),
                };
            }
        };

        const events = [
            "EPIC3D_PACKET_CTRL",
            "EPIC3D_PACKET_SEND",
            "EPIC3D_PACKET_START",
            "EPIC3D_PACKET_STOP",
        ];
        for (const n of events) window.addEventListener(n, handler);
        return () => {
            for (const n of events) window.removeEventListener(n, handler);
        };
    }, [isPacket, link?.id, link?.from, link?.to]);

    // Auto start (optional)
    useEffect(() => {
        if (!isPacket) return;
        if (!pktCfg.timing.autoStart) return;
        if (pktRuntime.current.startedOnce) return;
        pktRuntime.current.startedOnce = true;
        pktRuntime.current.queuedStart = { at: timeRef.current, overrides: {} };
    }, [isPacket, pktCfg.timing.autoStart]);

    // Packet animation loop
    useFrame(({ clock, camera }, delta) => {
        timeRef.current = clock.getElapsedTime();
        if (!isPacket) return;
        if (!animate) return;
        if (!active) return;

        const cfg = pktCfgRef.current;
        const rt = pktRuntime.current;

        // dashed path animation
        if (cfg.path.mode === "dashed") {
            dashedPathOffset.current -= (delta * 0.8) * cfg.path.dashSpeed * (speed || 1);
            const mat = dashedPathLineRef.current?.material;
            if (mat && typeof mat.dashOffset !== "undefined") {
                mat.dashOffset = dashedPathOffset.current;
            }
        }

        // Process queued start
        if (rt.queuedStart) {
            const overrides = rt.queuedStart.overrides || {};
            rt.queuedStart = null;

            const travel = Math.max(
                0.05,
                Number(overrides.travel ?? overrides.travelDuration ?? overrides.duration ?? cfg.timing.travel) || cfg.timing.travel,
            );
            const delay = Math.max(
                0,
                Number(overrides.delay ?? overrides.startDelay ?? cfg.timing.delay) || cfg.timing.delay,
            );
            const count = Math.max(
                1,
                Math.floor(Number(overrides.count ?? overrides.packets ?? cfg.timing.count) || cfg.timing.count),
            );
            const interval = Math.max(0, Number(overrides.interval ?? cfg.timing.interval) || cfg.timing.interval);
            const loop = (overrides.loop ?? cfg.timing.loop) === true;
            const loopGap = Math.max(
                0,
                Number(overrides.loopGap ?? overrides.burstInterval ?? cfg.timing.loopGap) || cfg.timing.loopGap,
            );
            const burstsLimit = Math.max(
                0,
                Math.floor(Number(overrides.burstsLimit ?? overrides.bursts ?? cfg.timing.burstsLimit) || cfg.timing.burstsLimit),
            );
            const clearOnStart = (overrides.clearOnStart ?? cfg.timing.clearOnStart) !== false;
            const burstsRemaining = loop && burstsLimit > 0 ? burstsLimit : null;

            rt.emitter = {
                loop,
                loopGap,
                count,
                interval,
                travel,
                delay,
                burstsRemaining,
                phase: 0,
                cycleRemaining: count,
                nextAt: timeRef.current + delay,
                pausedUntil: null,
            };
            if (clearOnStart) {
                rt.packets = [];
                rt.rings = [];
                rt.sparks = [];
            }
        }

        // Spawn packets
        const em = rt.emitter;
        if (em) {
            const now = timeRef.current;

            if (em.pausedUntil != null) {
                if (now >= em.pausedUntil) {
                    em.pausedUntil = null;
                    em.cycleRemaining = em.count;
                    em.nextAt = now;
                }
            }

            // emit as long as due (support interval=0)
            let guard = 0;
            while (em.pausedUntil == null && now >= em.nextAt - 1e-6 && guard++ < 64) {
                // spawn
                if (rt.packets.length < cfg.maxVisible) {
                    rt.packets.push({
                        t0: em.nextAt,
                        dur: em.travel,
                        seed: Math.floor(hash01(em.phase + 1) * 999999),
                        phase: em.phase,
                    });
                }

                em.phase += 1;
                em.cycleRemaining -= 1;

                if (em.cycleRemaining <= 0) {
                    if (em.loop) {
                        if (em.burstsRemaining != null) {
                            em.burstsRemaining -= 1;
                            if (em.burstsRemaining <= 0) {
                                // stop spawning, let existing packets finish
                                rt.emitter = null;
                                break;
                            }
                        }

                        em.pausedUntil = now + em.loopGap;
                        break;
                    }
                    // stop spawning, let existing packets finish
                    rt.emitter = null;
                    break;
                }

                em.nextAt += em.interval;
                if (em.interval <= 0) {
                    // avoid infinite loop
                    em.nextAt = now + 1e-3;
                }
            }
        }

        // Update packets + write instanced matrices
        const inst = packetMeshRef.current;
        if (inst && packetGeo && packetMat) {
            const tmp = new THREE.Object3D();
            const qTmp = new THREE.Quaternion();
            const zAxis = new THREE.Vector3(0, 0, 1);

            let write = 0;
            const now = timeRef.current;

            for (let i = rt.packets.length - 1; i >= 0; i--) {
                const p = rt.packets[i];
                const prog = (now - p.t0) / (p.dur || 1);

                if (prog >= 1) {
                    // arrived
                    rt.packets.splice(i, 1);

                    // Success FX
                    const sDur = cfg.success.duration;

                    // Rings (pulse / burst)
                    if (cfg.success.mode !== "none" && cfg.success.ringCount > 0) {
                        const ringCount = Math.max(
                            0,
                            Math.min(
                                12,
                                Math.round((cfg.success.ringCount || 0) * Math.max(0, cfg.success.intensity || 1)),
                            ),
                        );
                        for (let rIdx = 0; rIdx < ringCount; rIdx++) {
                            rt.rings.push({
                                t0: now + rIdx * (cfg.success.ringDelay || 0),
                                dur: sDur,
                                seed: p.seed + rIdx * 31,
                                mult: 1 + rIdx * 0.28,
                            });
                        }
                    }

                    // Sparks (burst / sparkles)
                    if (cfg.success.mode === "explosion" || cfg.success.mode === "spark") {
                        const base = Math.max(0, cfg.success.sparkCount || 0);
                        const sparkCount = Math.max(
                            0,
                            Math.min(96, Math.round(base * Math.max(0, cfg.success.intensity || 1))),
                        );

                        // Bias direction by end tangent; spread controls how "spherical" the burst becomes.
                        const spread = Math.max(0, Math.min(1, cfg.success.sparkSpread ?? 1));
                        const tangentEnd = curveForFx.getTangentAt(1).normalize();

                        const randUnit = (seed) => {
                            const u = hash01(seed * 1.913 + 0.17);
                            const v = hash01(seed * 3.117 + 0.29);
                            const theta = u * Math.PI * 2;
                            const z = v * 2 - 1;
                            const r = Math.sqrt(Math.max(0, 1 - z * z));
                            return new THREE.Vector3(r * Math.cos(theta), z, r * Math.sin(theta));
                        };

                        for (let k = 0; k < sparkCount; k++) {
                            const sSeed = p.seed + 101 + k * 17;
                            const rnd = randUnit(sSeed);
                            const dir = tangentEnd.clone().lerp(rnd, spread).normalize();
                            rt.sparks.push({
                                t0: now,
                                dur: Math.max(0.12, sDur * 0.75),
                                dir: dir.toArray(),
                                seed: sSeed,
                            });
                        }
                    }

                    continue;
                }

                if (prog < 0) continue;

                const t = clamp01(prog);
                const pos = curveForFx.getPointAt(t);

                // orientation
                if (cfg.billboard || cfg.style === "text" || cfg.style === "envelope") {
                    qTmp.copy(camera.quaternion);
                } else {
                    const tangent = curveForFx.getTangentAt(t).normalize();
                    qTmp.setFromUnitVectors(zAxis, tangent);
                }

                // size + pulse
                let s = cfg.size;
                if (cfg.pulseAmp > 0 && cfg.pulseFreq > 0) {
                    s *= 1 + Math.sin((now + p.seed * 0.0001) * cfg.pulseFreq * Math.PI * 2) * cfg.pulseAmp;
                }

                // wobble
                let wx = 0,
                    wy = 0,
                    wz = 0;
                if (cfg.wobble > 0) {
                    wx = (hash01(p.seed + 11) - 0.5) * 2 * cfg.wobble;
                    wy = (hash01(p.seed + 19) - 0.5) * 2 * cfg.wobble;
                    wz = (hash01(p.seed + 23) - 0.5) * 2 * cfg.wobble;
                }

                tmp.position.set(pos.x + wx, pos.y + wy, pos.z + wz);
                tmp.quaternion.copy(qTmp);

                if (cfg.spin) {
                    const ang = (now + p.phase * 0.1) * cfg.spin;
                    tmp.rotateZ(ang);
                }

                // text needs flatter look
                if (cfg.style === "text" || cfg.style === "envelope") tmp.scale.set(s * 1.35, s * 1.35, s * 1.35);
                else tmp.scale.set(s, s, s);

                tmp.updateMatrix();
                inst.setMatrixAt(write, tmp.matrix);
                write += 1;
                if (write >= inst.count) break;
            }

            // hide unused instances
            for (let i = write; i < inst.count; i++) {
                tmp.position.set(0, -9999, 0);
                tmp.scale.set(0.0001, 0.0001, 0.0001);
                tmp.quaternion.identity();
                tmp.updateMatrix();
                inst.setMatrixAt(i, tmp.matrix);
            }

            inst.instanceMatrix.needsUpdate = true;
        }

        // Update rings
        const ringInst = ringMeshRef.current;
        if (ringInst && ringGeo && ringMat) {
            const tmp = new THREE.Object3D();
            const now = timeRef.current;
            let write = 0;
            let alphaMax = 0;

            const endPos = curveForFx.getPointAt(1);

            for (let i = rt.rings.length - 1; i >= 0; i--) {
                const r = rt.rings[i];
                const prog = (now - r.t0) / (r.dur || 1);
                if (prog >= 1) {
                    rt.rings.splice(i, 1);
                    continue;
                }
                const t = clamp01(prog);
                const baseK = 1 + t * (cfg.success.size || 0.6) * 2;
                const k = baseK * (r.mult || 1);

                tmp.position.set(endPos.x, endPos.y, endPos.z);
                tmp.quaternion.copy(camera.quaternion);
                tmp.scale.setScalar(k);
                tmp.updateMatrix();

                ringInst.setMatrixAt(write, tmp.matrix);
                alphaMax = Math.max(alphaMax, (1 - t) * (cfg.success.ringOpacity ?? 0.85));

                write += 1;
                if (write >= ringInst.count) break;
            }

            // hide unused
            for (let i = write; i < ringInst.count; i++) {
                tmp.position.set(0, -9999, 0);
                tmp.scale.setScalar(0.0001);
                tmp.quaternion.identity();
                tmp.updateMatrix();
                ringInst.setMatrixAt(i, tmp.matrix);
            }

            ringInst.instanceMatrix.needsUpdate = true;

            // InstancedMesh has a single shared material; approximate by using the max ring alpha.
            const mat = ringInst.material;
            if (mat && mat.opacity != null) mat.opacity = alphaMax;
        }

        // Update sparks
        const sparkInst = sparkMeshRef.current;
        if (sparkInst && sparkGeo && sparkMat) {
            const tmp = new THREE.Object3D();
            const now = timeRef.current;
            let write = 0;
            let alphaMax = 0;

            const endPos = curveForFx.getPointAt(1);

            for (let i = rt.sparks.length - 1; i >= 0; i--) {
                const sp = rt.sparks[i];
                const prog = (now - sp.t0) / (sp.dur || 1);
                if (prog >= 1) {
                    rt.sparks.splice(i, 1);
                    continue;
                }
                const t = clamp01(prog);
                const dir = toArr3(sp.dir);
                const drag = Math.max(0, Math.min(1, Number(cfg.success.sparkDrag ?? 0.18) || 0.18));
                const ease = 1 - Math.pow(1 - t, 2 + drag * 4);
                const dist = (cfg.success.size || 0.6) * (0.15 + ease * (cfg.success.sparkSpeed || 1.35));

                tmp.position.set(endPos.x + dir[0] * dist, endPos.y + dir[1] * dist, endPos.z + dir[2] * dist);
                tmp.quaternion.copy(camera.quaternion);
                const s = (cfg.success.sparkSize || 0.16) * (0.75 + (1 - t) * 1.15);
                tmp.scale.setScalar(s);
                tmp.updateMatrix();
                sparkInst.setMatrixAt(write, tmp.matrix);

                alphaMax = Math.max(alphaMax, (1 - t) * 0.9);

                write += 1;
                if (write >= sparkInst.count) break;
            }

            for (let i = write; i < sparkInst.count; i++) {
                tmp.position.set(0, -9999, 0);
                tmp.scale.setScalar(0.0001);
                tmp.quaternion.identity();
                tmp.updateMatrix();
                sparkInst.setMatrixAt(i, tmp.matrix);
            }

            sparkInst.instanceMatrix.needsUpdate = true;

            const mat = sparkInst.material;
            if (mat && mat.opacity != null) mat.opacity = alphaMax;
        }
    });

    if (!active) return null;

    const pointerProps = onPointerDown ? { onPointerDown } : {};

    // Selected should be clickable even when packet path hidden
    const showPacketPath =
        isPacket &&
        (pktCfg.path.mode !== "hidden" || (selected && pktCfg.path.showWhenSelected));

    return (
        <group {...pointerProps}>
            {/* Standard styles */}
            {mergedStyle === "solid" && (
                <QuadraticBezierLine
                    start={fromV}
                    end={toV}
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
                    start={fromV}
                    end={toV}
                    mid={[midRef.current.x, midRef.current.y, midRef.current.z]}
                    color={mergedColor}
                    lineWidth={width * scale}
                    dashed
                    dashScale={link?.dash?.length ?? 1}
                    dashSize={link?.dash?.gap ?? 0.25}
                    transparent
                    opacity={selected ? 1 : 0.96}
                    depthWrite={false}
                />
            )}

            {(mergedStyle === "particles" || mergedStyle === "wavy") && (
                <FlowParticles
                    curve={curveForFx}
                    count={link?.particles?.count ?? 24}
                    size={link?.particles?.size ?? 0.06}
                    color={link?.particles?.color ?? mergedColor}
                    sizeMult={scale}
                    rainbow={(fx.rainbow ?? false) || (byKind.effects?.rainbow ?? false)}
                    speed={(speed || 1) * (mergedStyle === "wavy" ? 1.1 : 1)}
                    opacity={link?.particles?.opacity ?? 1}
                    waveAmp={link?.particles?.waveAmp ?? (mergedStyle === "wavy" ? 0.18 : 0.06)}
                    waveFreq={link?.particles?.waveFreq ?? 2}
                    shape={link?.particles?.shape || "sphere"}
                    selected={!!selected}
                    animate={animate}
                />
            )}

            {mergedStyle === "icons" && (
                <IconFlow
                    curve={curveForFx}
                    char={link?.icon?.char ?? byKind.icon?.char ?? "▶"}
                    count={link?.icon?.count ?? 4}
                    size={link?.icon?.size ?? 0.14}
                    color={link?.icon?.color ?? mergedColor}
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
                    curve={curveForFx}
                    color={link?.sweep?.color ?? mergedColor}
                    color2={link?.sweep?.color2}
                    gradient={link?.sweep?.gradient ?? false}
                    thickness={link?.sweep?.thickness ?? 0.06}
                    thicknessMult={scale}
                    duration={link?.sweep?.duration ?? 1.4}
                    hold={link?.sweep?.hold ?? 0.12}
                    fadeEnabled={link?.sweep?.fadeEnabled ?? true}
                    fade={link?.sweep?.fade ?? 0.6}
                    pause={link?.sweep?.pause ?? 0.2}
                    resetGap={link?.sweep?.resetGap ?? 0.05}
                    speed={link?.sweep?.speed ?? speed ?? 1}
                    fadeCurve={link?.sweep?.fadeCurve ?? "smooth"}
                    pingpong={link?.sweep?.pingpong ?? false}
                    durationBack={link?.sweep?.durationBack ?? link?.sweep?.duration}
                    holdBack={link?.sweep?.holdBack ?? 0}
                    fillMode={link?.sweep?.fillMode ?? "trail"}
                    trailLength={link?.sweep?.trailLength ?? 0.18}
                    baseVisible={link?.sweep?.baseVisible ?? false}
                    invert={link?.sweep?.invert ?? false}
                    feather={link?.sweep?.feather ?? 0.06}
                    glow={link?.sweep?.glow ?? 1.15}
                    passes={link?.sweep?.passes ?? 1}
                    passDelay={link?.sweep?.passDelay ?? 0.25}
                    colors={sweepColors}
                    headSize={link?.sweep?.headSize ?? 1}
                    headPulseAmp={link?.sweep?.headPulseAmp ?? 0.2}
                    headPulseFreq={link?.sweep?.headPulseFreq ?? 1.6}
                    pulseAmp={link?.sweep?.pulseAmp ?? 0.0}
                    pulseFreq={link?.sweep?.pulseFreq ?? 1.5}
                    endFx={sweepEndFx}
                    rainbow={(fx.rainbow ?? false) || (byKind.effects?.rainbow ?? false)}
                    selected={!!selected}
                    animate={animate}
                />
            )}

            {mergedStyle === "cable" && (
                <group>
                    {cableOffsets.map((off, idx) => {
                        const sOff = 1 - cableAnchor;
                        const startArr = [fromArr[0] + off[0] * sOff, fromArr[1] + off[1] * sOff, fromArr[2] + off[2] * sOff];
                        const endArr = [toArr[0] + off[0] * sOff, toArr[1] + off[1] * sOff, toArr[2] + off[2] * sOff];

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
                                start={vec3From(startArr)}
                                end={vec3From(endArr)}
                                mid={[mx, my, mz]}
                                color={mergedColor}
                                lineWidth={width * scale * (idx === 0 ? 1.0 : 0.7)}
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
                    curve={curveForFx}
                    thickness={link?.tube?.thickness ?? 0.07}
                    glow={link?.tube?.glow ?? 1.4}
                    color={link?.tube?.color ?? mergedColor}
                    speed={speed || 1}
                    trail={link?.tube?.trail !== false}
                    selected={!!selected}
                    widthHint={width * scale}
                    animate={animate}
                    thicknessMult={scale}
                    rainbow={(fx.rainbow ?? false) || (byKind.effects?.rainbow ?? false)}
                    sparks={(fx.sparks ?? false) || (byKind.effects?.sparks ?? false)}
                />
            )}

            {/* Packet style: path + instanced packets */}
            {isPacket && showPacketPath && (
                <group>
                    {/* Path modes */}
                    {pktCfg.path.mode === "line" && pathGeom && (
                        <line geometry={pathGeom}>
                            <lineBasicMaterial
                                color={pktCfg.path.color}
                                transparent
                                opacity={pktCfg.path.opacity}
                                depthWrite={false}
                            />
                        </line>
                    )}

                    {pktCfg.path.mode === "dashed" && pathGeom && (
                        <line ref={dashedPathLineRef} geometry={pathGeom}>
                            <lineDashedMaterial
                                color={pktCfg.path.color}
                                transparent
                                opacity={pktCfg.path.opacity}
                                dashSize={pktCfg.path.dashSize}
                                gapSize={pktCfg.path.gapSize}
                                depthWrite={false}
                            />
                        </line>
                    )}

                    {pktCfg.path.mode === "particles" && (
                        <FlowParticles
                            curve={curveForFx}
                            count={pktCfg.path.particleCount}
                            size={pktCfg.path.particleSize}
                            color={pktCfg.path.color}
                            sizeMult={scale}
                            rainbow={false}
                            speed={(speed || 1) * pktCfg.path.particleSpeed}
                            opacity={pktCfg.path.opacity}
                            waveAmp={0.0}
                            waveFreq={1.5}
                            shape={"sphere"}
                            selected={!!selected}
                            animate={animate}
                        />
                    )}

                    {pktCfg.path.mode === "sweep" && (
                        <SweepLine
                            curve={curveForFx}
                            color={pktCfg.path.color}
                            thickness={0.04}
                            thicknessMult={scale}
                            duration={Math.max(0.15, pktCfg.timing.travel)}
                            hold={0.02}
                            fadeEnabled
                            fade={0.75}
                            pause={Math.max(0, pktCfg.timing.interval * 0.2)}
                            resetGap={0.02}
                            speed={1}
                            fillMode={"trail"}
                            trailLength={0.22}
                            baseVisible={false}
                            feather={0.08}
                            glow={1.05}
                            passes={1}
                            passDelay={0}
                            rainbow={false}
                            selected={!!selected}
                            animate={animate}
                        />
                    )}
                </group>
            )}

            {isPacket && packetGeo && packetMat && (
                <group>
                    <instancedMesh
                        ref={packetMeshRef}
                        args={[packetGeo, packetMat, pktCfg.maxVisible]}
                        frustumCulled={false}
                    />

                    <instancedMesh
                        ref={ringMeshRef}
                        args={[ringGeo, ringMat, 64]}
                        frustumCulled={false}
                    />

                    <instancedMesh
                        ref={sparkMeshRef}
                        args={[sparkGeo, sparkMat, 192]}
                        frustumCulled={false}
                    />
                </group>
            )}
        </group>
    );
});

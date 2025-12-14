import React, { useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { OrbitControls, TransformControls, Grid, ContactShadows , Environment} from "@react-three/drei";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Match your project structure:
import ImportedModel from "./gltf/ImportedModel.jsx";
import RoomBox from "./rooms/RoomBox.jsx";
import Node3D from "./nodes/Node3D.jsx";
import Link3D from "./links/Link3D.jsx";
import InteractionLayer from "./interaction/InteractionLayer.jsx";

export default function SceneInner({
                                       perf,
                                       // scene/model
                                       modelDescriptor,
                                       wireframe,
                                       wireOpacity = 1,
                                       wireDetail = "high",
                                       wireHideSurfaces = false,
                                       wireStroke: wireStrokeProp, // NEW: preferred config for new reveal
                                       wireReveal,                 // Back-compat: old UI still uses this
                                       enableShadows = false,
                                       modelRef,
                                       showModel = true,
                                       roomOpacity = 0.4,
                                       modelScale = 1, // <-- NEW
                                       // data
                                       rooms = [],
                                       nodes = [],
                                       links = [],
                                       hiddenDeckIds = [],
                                       hiddenRoomIds = [],
                                       // selection
                                       selected,
                                       setSelected,
                                       onNodePointerDown,
                                       onRoomPointerDown,
                                       selectedMulti = [],
                                       selectedBreakpoint = null,   // NEW
                                       // transforms
                                       moveMode = false,
                                       transformMode = "translate",
                                       uiHidden = false,
                                       onEntityTransform,
                                       onEntityRotate,

                                       // visuals
                                       showLights = true,
                                       showLightBounds = false,
                                       shadowsOn = true,
                                       showGround = true,
                                       // labels
                                       labelsOn = true,
                                       labelMode = "billboard",
                                       labelSize = 0.24,
                                       labelMaxWidth = 24,
                                       label3DLayers = 8,
                                       label3DStep = 0.01,
                                       roomOperatorMode = false,
                                       onRoomAnchorClick,
                                       onRoomDelete,
                                       onRoomResize,
                                       // placement
                                       placement,
                                       onPlace,

                                       // animation toggle
                                       animate = true,

                                       // drag guard from parent
                                       dragState,
                                       missGuardRef,

                                       // scene ready callback
                                       onModelScene
                                   }) {
    // ---------- lookups ----------
    const nodeRefs = useRef({});
    const roomRefs = useRef({});
    const nodeMap = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
    const selectedNode = selected?.type === "node" ? nodeMap[selected?.id] : null;
    const selectedRoom = selected?.type === "room" ? rooms.find((r) => r.id === selected?.id) : null;
    const hiddenDeck = useMemo(() => new Set(hiddenDeckIds), [hiddenDeckIds]);
    const hiddenRooms = useMemo(() => new Set(hiddenRoomIds), [hiddenRoomIds]);
    // Bridge: prefer wireStroke prop; otherwise derive from legacy wireReveal UI
// Bridge: prefer wireStroke prop; otherwise derive from legacy wireReveal UI
    // Bridge: prefer wireStroke prop; otherwise derive from legacy wireReveal UI
    const mergedWireStroke = React.useMemo(() => {
        let stroke = wireStrokeProp;

        // Back-compat: if only the old wireReveal API is provided, convert it
        if (!stroke && wireReveal) {
            stroke = {
                enabled: !!wireReveal.enabled,
                mode: wireReveal.mode || "lr",
                // your "Duration (s)" slider drives both in/out
                duration: typeof wireReveal.duration === "number" ? wireReveal.duration : 1.2,
                feather: typeof wireReveal.feather === "number" ? wireReveal.feather : 0.08,
                surfaceFeather: typeof wireReveal.feather === "number" ? wireReveal.feather : 0.08,
            };
        }

        // No config at all → let ImportedModel use its defaults (no reveal)
        if (!stroke) return undefined;

        // If the REVEAL checkbox is off, don't run the effect at all
        if (!stroke.enabled) return undefined;

        // 🔑 IMPORTANT: never run the reveal effect when the wireframe overlay is off
        // This is what guarantees the solid textured model is fully visible.
        if (!wireframe) return undefined;

        return stroke;
    }, [wireStrokeProp, wireReveal, wireframe]);



// Fast lookup for multi-selection like "node:123" / "room:abc"
    const selectedMultiSet = useMemo(() => {
        const s = new Set();
        (selectedMulti || []).forEach((it) => {
            if (it?.type && it?.id) s.add(`${it.type}:${it.id}`);
        });
        return s;
    }, [selectedMulti]);
    // De-dupe multi-selection so an entity can never be updated twice per tick.
// This is a common cause of "teleport/fly" when selecting via a box.
    const uniqueSelectedMulti = useMemo(() => {
        const out = [];
        const seen = new Set();
        (selectedMulti || []).forEach((it) => {
            if (!it?.type || !it?.id) return;
            const k = `${it.type}:${it.id}`;
            if (seen.has(k)) return;
            seen.add(k);
            out.push(it);
        });
        return out;
    }, [selectedMulti]);

// --- DEMO LINKS (only used if no links were passed in) ---
    const demoLinks = (() => {
        // If you already know your node IDs, replace these:
        const preset = [
            { id: "l1", from: "A", to: "B", kind: "wifi",  style: "wavy", effects: { rainbow: true }, scale: 1.2 },
            { id: "l2", from: "B", to: "C", kind: "wired", style: "dashed", width: 3, speed: 1.2 },
            { id: "l3", from: "C", to: "D", kind: "fiber", style: "epic", effects: { rainbow: true, sparks: true }, tube: { glow: 1.8 }, scale: 1.3 },
            { id: "l4", from: "A", to: "C", kind: "wired", style: "sweep", speed: 1.1, sweep: { thickness: 0.06, glow: 1.25 } },
        ];

        // If you DON'T know your IDs, auto-wire the first 4 nodes:
        if (!nodes || nodes.length < 2) return [];
        const ids = nodes.slice(0, 4).map(n => n.id);
        const auto = [];
        if (ids[0] && ids[1]) auto.push({ id: "l1", from: ids[0], to: ids[1], kind: "wifi",  style: "wavy", effects:{ rainbow:true }, scale: 1.2 });
        if (ids[1] && ids[2]) auto.push({ id: "l2", from: ids[1], to: ids[2], kind: "wired", style: "dashed", width: 3, speed: 1.2 });
        if (ids[2] && ids[3]) auto.push({ id: "l3", from: ids[2], to: ids[3], kind: "fiber", style: "epic", effects:{ rainbow:true, sparks:true }, tube:{ glow:1.8 }, scale:1.3 });

        // Prefer auto if possible; otherwise fall back to the A/B/C/D preset.
        return auto.length ? auto : preset;
    })();

// Use demo links only if none were provided via props
    const allLinks = useMemo(() => (links && links.length ? links : demoLinks), [links, demoLinks]);

    // ---------- drei controls & camera ----------
    const tcRef = useRef();
    const controlsRef = useRef();
    const { gl, camera } = useThree();

    // ---------- config (tweak feel here) ----------
    const CFG = useRef({
        zoom: {
            min: 3.5,
            max: 180,
            lambda: 20,            // still used for some radius smoothing (tracks)
            wheelStrength: 0.0010,
            maxWheelStep: 0.75,
            zoomToCursor: true,

            // NEW: smooth scroll-zoom tuning
            scrollImpulse: 0.05,   // how strong each scroll tick is (higher = further)
            velLambda: 10,         // how fast zoom velocity decays (higher = snappier)
            maxZoomVel: 100        // cap on zoom velocity (world units / second)
        },

        fly: {
            lambda: 16,
            speedMin: 0.1,
            speedMax: 200,
            baseSpeed: 6,
            sprintMult: 3,
            verticalMult: 1.0,
            adjustRate: 1.2,
            speedSmooth: 10,
        },
    });


    // ---------- smoothed state ----------
    const s = useRef({
        // orbit radius
        radius: 8,
        radiusTarget: 8,
        zoomVel: 0,
        // fly velocity
        vel: new THREE.Vector3(),

        // dynamic fly speed (user adjustable)
        flySpeed: null,         // current speed
        flySpeedTarget: null,   // target speed (changes with +/-)

        // cursor for zoom anchoring
        ndc: new THREE.Vector2(0, 0),
        raycaster: new THREE.Raycaster(),

        // scratch
        tmp: {
            offset: new THREE.Vector3(),
            spherical: new THREE.Spherical(),
            dir: new THREE.Vector3(),
            right: new THREE.Vector3(),
            up: new THREE.Vector3(0, 1, 0),
            before: new THREE.Vector3(),
            after: new THREE.Vector3(),
            plane: new THREE.Plane(),
            move: new THREE.Vector3()
        }
    });

    const cameraTrackStateRef = useRef(new Map());
    const roomOperatorMoveRef = useRef(null);
    const prevRoomOperatorModeRef = useRef(roomOperatorMode);

    // ---------- helpers ----------
    const isTyping = () => {
        const ae = document.activeElement;
        return !!ae && (
            ae.tagName === "INPUT" ||
            ae.tagName === "TEXTAREA" ||
            ae.isContentEditable === true
        );
    };

    const dampScalar = (current, target, lambda, dt) =>
        current + (target - current) * (1 - Math.exp(-lambda * dt));

    const dampVec = (out, target, lambda, dt) => {
        const t = 1 - Math.exp(-lambda * dt);
        out.x += (target.x - out.x) * t;
        out.y += (target.y - out.y) * t;
        out.z += (target.z - out.z) * t;
        return out;
    };

    // track pointer (for zoom-to-cursor)
    useEffect(() => {
        const el = gl?.domElement;
        if (!el) return;
        const onMove = (e) => {
            const r = el.getBoundingClientRect();
            s.current.ndc.set(
                ((e.clientX - r.left) / r.width) * 2 - 1,
                -((e.clientY - r.top) / r.height) * 2 + 1
            );
        };
        el.addEventListener("pointermove", onMove);
        return () => el.removeEventListener("pointermove", onMove);
    }, [gl]);
    // When Room Operator mode is active, snap camera into a top-down view over the rooms/grid
    useEffect(() => {
        if (!roomOperatorMode) return;

        const ctrl = controlsRef.current;
        if (!ctrl || !camera) return;

        // Compute a simple average center of all rooms; fall back to origin.
        const c = new THREE.Vector3();
        let count = 0;
        (rooms || []).forEach((r) => {
            const center = r.center || [0, 0, 0];
            c.x += center[0];
            c.y += center[1];
            c.z += center[2];
            count++;
        });
        if (count > 0) {
            c.multiplyScalar(1 / count);
        }

        // Look mostly straight down, but with a tiny horizontal offset so we don't gimbal-lock
        const height = Math.max(8, s.current.radiusTarget || 8);
        const target = new THREE.Vector3(c.x, 0, c.z);
        const pos = new THREE.Vector3(c.x + 0.001, height, c.z + 0.001);

        ctrl.target.copy(target);
        camera.position.copy(pos);
        camera.updateProjectionMatrix();

        // Keep orbit smoothing in sync
        s.current.radius = height;
        s.current.radiusTarget = height;
    }, [roomOperatorMode, rooms, camera]);
// Smooth camera move into top-down Room Operator view
    useEffect(() => {
        const justEntered = roomOperatorMode && !prevRoomOperatorModeRef.current;
        prevRoomOperatorModeRef.current = roomOperatorMode;
        if (!justEntered) return;

        const ctrl = controlsRef.current;
        if (!ctrl || !camera) return;

        // 1) Find floorplan center (average of room centers)
        const center = new THREE.Vector3();
        let count = 0;
        (rooms || []).forEach((r) => {
            const c = r.center || [0, 0, 0];
            center.x += c[0];
            center.y += c[1];
            center.z += c[2];
            count++;
        });
        if (count > 0) center.multiplyScalar(1 / count);

        // 2) Estimate extents to choose a good height
        let maxExtent = 4;
        (rooms || []).forEach((r) => {
            const size = r.size || [3, 1.6, 2.2];
            const c = r.center || [0, 0, 0];
            const dx = Math.abs(c[0] - center.x) + size[0] * 0.5;
            const dz = Math.abs(c[2] - center.z) + size[2] * 0.5;
            maxExtent = Math.max(maxExtent, dx, dz);
        });
        const desiredRadius = Math.max(maxExtent * 1.4, 8);

        // 3) Build a "top-down, facing north" spherical offset
        const tmp = s.current.tmp;
        const spherical = tmp.spherical;
        spherical.radius = desiredRadius;
        spherical.phi = 0.0005;   // almost straight down from +Y
        spherical.theta = 0;      // fixed yaw (north-aligned)
        tmp.offset.setFromSpherical(spherical);

        const toTarget = new THREE.Vector3(center.x, 0, center.z);
        const toPos = toTarget.clone().add(tmp.offset);

        const fromPos = camera.position.clone();
        const fromTarget = ctrl.target.clone();

        const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
        roomOperatorMoveRef.current = {
            fromPos,
            fromTarget,
            toPos,
            toTarget,
            startMs: nowMs,
            endMs: nowMs + 700, // 0.7s tween
        };

        // Stop any fly velocity so we don't drift
        s.current.vel.set(0, 0, 0);

        // Keep zoom system in sync
        s.current.radiusTarget = desiredRadius;
    }, [roomOperatorMode, rooms, camera]);

    // initialize radius and fly speed from current camera/target
    useEffect(() => {
        const ctrl = controlsRef.current;
        if (!ctrl) return;
        const off = s.current.tmp.offset;
        off.copy(camera.position).sub(ctrl.target);
        s.current.tmp.spherical.setFromVector3(off);
        s.current.radius = s.current.tmp.spherical.radius;
        s.current.radiusTarget = s.current.radius;

        // init speed
        const base = CFG.current.fly.baseSpeed;
        s.current.flySpeed = base;
        s.current.flySpeedTarget = base;
    }, [camera]);

    // wheel -> set radiusTarget (movement is smoothed in frame loop)
    // wheel -> add zoom velocity impulse (smooth, inertial zoom along view direction)
    useEffect(() => {
        const el = gl?.domElement;
        if (!el) return;

        const onWheel = (e) => {
            const ctrl = controlsRef.current;
            const allowWhilePlacingRoom =
                roomOperatorMode && placement?.placeKind === "room";

            const allowed =
                ctrl &&
                !dragState?.active &&
                !isTyping() &&
                (!placement?.armed || allowWhilePlacingRoom);

            if (!allowed) return;

            e.preventDefault();

            const z = CFG.current.zoom;
            const f = CFG.current.fly;
            const base = s.current.flySpeed ?? f.baseSpeed;

            // how “hard” this scroll event is
            const dy = THREE.MathUtils.clamp(e.deltaY, -400, 400);

            // scroll up (dy < 0) => zoom in => positive forward velocity
            const impulse = -dy * z.scrollImpulse * base;

            const maxVel = z.maxZoomVel * base;
            const current = s.current.zoomVel || 0;
            const next = THREE.MathUtils.clamp(current + impulse, -maxVel, maxVel);

            s.current.zoomVel = next;
        };

        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [gl, placement, dragState, roomOperatorMode]);





    // WASD/QE keys + speed adjust keys (+ / - and numpad add/sub)
// WASD/QE keys + speed adjust keys (+ / - and numpad add/sub)
    const keys = useRef(new Set());
    useEffect(() => {
        const down = (e) => { if (!isTyping() && !e.altKey) keys.current.add(e.code); };
        const up   = (e) => { keys.current.delete(e.code); };
        const clearOnFocus = () => { if (isTyping()) keys.current.clear(); };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("focusin", clearOnFocus);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("focusin", clearOnFocus);
        };
    }, []);
// Camera view commands from top bar & hotkeys
    useEffect(() => {
        const handler = (ev) => {
            const detail = ev?.detail || {};
            const view = detail.view;
            if (!view) return;

            const ctrl = controlsRef.current;
            if (!ctrl) return;

            const tmp = s.current.tmp;
            const offset = tmp.offset;
            const target = ctrl.target || new THREE.Vector3(0, 0, 0);

            // current orbit radius from camera to target
            offset.copy(camera.position).sub(target);
            let radius = offset.length();
            if (!radius || radius < 0.0001) {
                radius = s.current.radius || 8;
            }

            const t = target.clone();

            if (view === "reset") {
                // Default startup pose: diagonal above front-right of origin
                const defaultTarget = new THREE.Vector3(0, 0, 0);
                camera.position.set(6, 4.5, 6);
                ctrl.target.copy(defaultTarget);
                camera.up.set(0, 1, 0);

                offset.copy(camera.position).sub(ctrl.target);
                tmp.spherical.setFromVector3(offset);
                s.current.radius = tmp.spherical.radius;
                s.current.radiusTarget = s.current.radius;

                camera.updateProjectionMatrix();
                ctrl.update();
                return;
            }

            switch (view) {
                case "front":
                    camera.up.set(0, 1, 0);
                    camera.position.set(t.x, t.y, t.z + radius);
                    break;
                case "back":
                    camera.up.set(0, 1, 0);
                    camera.position.set(t.x, t.y, t.z - radius);
                    break;
                case "left":
                    camera.up.set(0, 1, 0);
                    camera.position.set(t.x - radius, t.y, t.z);
                    break;
                case "right":
                    camera.up.set(0, 1, 0);
                    camera.position.set(t.x + radius, t.y, t.z);
                    break;
                case "top":
                    camera.up.set(0, 0, -1);
                    camera.position.set(t.x, t.y + radius, t.z);
                    break;
                case "bottom":
                    camera.up.set(0, 0, 1);
                    camera.position.set(t.x, t.y - radius, t.z);
                    break;
                default:
                    return;
            }

            // keep orbit radius in sync for a smooth handoff
            offset.copy(camera.position).sub(ctrl.target);
            tmp.spherical.setFromVector3(offset);
            s.current.radius = tmp.spherical.radius;
            s.current.radiusTarget = s.current.radius;

            camera.updateProjectionMatrix();
            ctrl.update();
        };

        if (typeof window !== "undefined") {
            window.addEventListener("EPIC3D_CAMERA_VIEW", handler);
        }
        return () => {
            if (typeof window !== "undefined") {
                window.removeEventListener("EPIC3D_CAMERA_VIEW", handler);
            }
        };
    }, [camera]);


    // main loop: smooth zoom + smooth fly (dt-clamped), live speed adjust
    useFrame((_, rawDt) => {
        const ctrl = controlsRef.current;
        if (!ctrl) return;

        // avoid jumps when tab regains focus
        const dt = Math.min(Math.max(rawDt, 0), 1 / 255);

        const tmp = s.current.tmp;

        // 🔥 NEW: make right-mouse panning feel the same at any zoom level
        if (ctrl.target) {
            // current orbit radius (distance camera <-> target)
            tmp.offset.copy(camera.position).sub(ctrl.target);

            const z = CFG.current.zoom;
            const minR = z.min;   // 0.25
            const maxR = z.max;   // 500

            const radius = THREE.MathUtils.clamp(tmp.offset.length() || 1, minR, maxR);

            const baseRadius    = 155;    // radius where panSpeed ≈ 1 feels good
            const basePanSpeed  = 1.0;  // default Drei/OrbitControls panSpeed

            // We want world movement per pixel to stay roughly constant:
            // panSpeed ∝ baseRadius / currentRadius
            const factor = baseRadius / radius;

            // Allow very strong boost when you are very close,
            // but keep it sane so it doesn't teleport.
            ctrl.panSpeed = THREE.MathUtils.clamp(
                basePanSpeed * factor,
                0.25,   // don't go slower than this when far away
                100.0   // strong enough when fully zoomed in at 0.25 units
            );
        }

        // --- Camera tracks (cinematic moves triggered from actions) ---
        const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
        const tracks = (typeof window !== "undefined" && window.__EPIC3D_CAMERA_TRACKS) || [];
        let activeTrack = null;

        if (tracks.length) {
            // pick the first track that is currently active
            for (let i = 0; i < tracks.length; i++) {
                const t = tracks[i];
                const start = t.startMs || 0;
                const end = start + (t.durationMs || 0);
                if (nowMs >= start && nowMs <= end) {
                    activeTrack = t;
                    break;
                }
            }

            // notify completion for finished tracks
            const doneCb = (typeof window !== "undefined" && window.__EPIC3D_ON_CAMERA_TRACK_DONE) || null;
            if (doneCb) {
                tracks.forEach((t) => {
                    const start = t.startMs || 0;
                    const end = start + (t.durationMs || 0);
                    if (nowMs > end + 16) { // small grace
                        try { doneCb(t.id); } catch (e) { /* ignore */ }
                        cameraTrackStateRef.current.delete(t.id);
                    }
                });
            }
        }

        if (activeTrack) {
            let st = cameraTrackStateRef.current.get(activeTrack.id);
            const presets = (typeof window !== "undefined" && window.__EPIC3D_CAMERA_PRESETS) || [];
            const findPreset = (id) => presets && Array.isArray(presets) ? presets.find((p) => p.id === id) || null : null;

            if (!st) {
                const fromPreset = activeTrack.fromPresetId ? findPreset(activeTrack.fromPresetId) : null;
                const toPreset = activeTrack.toPresetId ? findPreset(activeTrack.toPresetId) : null;
                if (!toPreset) return;

                const fromPos = fromPreset?.position
                    ? new THREE.Vector3(fromPreset.position[0], fromPreset.position[1], fromPreset.position[2])
                    : camera.position.clone();

                const fromTarget = fromPreset?.target && ctrl?.target
                    ? new THREE.Vector3(fromPreset.target[0], fromPreset.target[1], fromPreset.target[2])
                    : (ctrl?.target ? ctrl.target.clone() : new THREE.Vector3());

                const fromFov = typeof fromPreset?.fov === "number"
                    ? fromPreset.fov
                    : (camera.isPerspectiveCamera ? camera.fov : undefined);

                const toPosArr = toPreset.position || [6, 4.5, 6];
                const toTargetArr = toPreset.target || [0, 0, 0];
                const toFov = typeof toPreset.fov === "number" ? toPreset.fov : fromFov;

                const toPos = new THREE.Vector3(toPosArr[0], toPosArr[1], toPosArr[2]);
                const toTarget = new THREE.Vector3(toTargetArr[0], toTargetArr[1], toTargetArr[2]);

                st = {
                    fromPos,
                    fromTarget,
                    fromFov,
                    toPos,
                    toTarget,
                    toFov,
                    startMs: activeTrack.startMs || nowMs,
                    endMs: (activeTrack.startMs || nowMs) + (activeTrack.durationMs || 1),
                };
                cameraTrackStateRef.current.set(activeTrack.id, st);
            }

            const start = st.startMs;
            const end = st.endMs;
            const span = Math.max(1, end - start);
            const tNorm = THREE.MathUtils.clamp((nowMs - start) / span, 0, 1);
            const tSmooth = tNorm * tNorm * (3 - 2 * tNorm); // smoothstep easing

            camera.position.set(
                THREE.MathUtils.lerp(st.fromPos.x, st.toPos.x, tSmooth),
                THREE.MathUtils.lerp(st.fromPos.y, st.toPos.y, tSmooth),
                THREE.MathUtils.lerp(st.fromPos.z, st.toPos.z, tSmooth)
            );

            if (ctrl && ctrl.target) {
                ctrl.target.set(
                    THREE.MathUtils.lerp(st.fromTarget.x, st.toTarget.x, tSmooth),
                    THREE.MathUtils.lerp(st.fromTarget.y, st.toTarget.y, tSmooth),
                    THREE.MathUtils.lerp(st.fromTarget.z, st.toTarget.z, tSmooth)
                );
                ctrl.update();
            } else {
                camera.lookAt(st.toTarget.x, st.toTarget.y, st.toTarget.z);
            }

            if (camera.isPerspectiveCamera && typeof st.toFov === "number") {
                const fromFov = st.fromFov ?? camera.fov;
                camera.fov = THREE.MathUtils.lerp(fromFov, st.toFov, tSmooth);
                camera.updateProjectionMatrix();
            }

            // keep orbit radius in sync for a smooth handoff after the move
            if (ctrl && ctrl.target) {
                tmp.offset.copy(camera.position).sub(ctrl.target);
                tmp.spherical.setFromVector3(tmp.offset);
                s.current.radius = tmp.spherical.radius;
                s.current.radiusTarget = s.current.radius;
            }

            return; // skip manual zoom/fly while a track is active
        }
        if (roomOperatorMoveRef.current) {
            const mov = roomOperatorMoveRef.current;
            const nowMs2 = (typeof performance !== "undefined" ? performance.now() : Date.now());
            const start = mov.startMs;
            const end = mov.endMs;
            const span = Math.max(1, end - start);
            const tNorm = THREE.MathUtils.clamp((nowMs2 - start) / span, 0, 1);
            const tSmooth = tNorm * tNorm * (3 - 2 * tNorm); // smoothstep

            camera.position.set(
                THREE.MathUtils.lerp(mov.fromPos.x, mov.toPos.x, tSmooth),
                THREE.MathUtils.lerp(mov.fromPos.y, mov.toPos.y, tSmooth),
                THREE.MathUtils.lerp(mov.fromPos.z, mov.toPos.z, tSmooth)
            );

            if (ctrl && ctrl.target) {
                ctrl.target.set(
                    THREE.MathUtils.lerp(mov.fromTarget.x, mov.toTarget.x, tSmooth),
                    THREE.MathUtils.lerp(mov.fromTarget.y, mov.toTarget.y, tSmooth),
                    THREE.MathUtils.lerp(mov.fromTarget.z, mov.toTarget.z, tSmooth)
                );
                ctrl.update();
            } else {
                camera.lookAt(mov.toTarget.x, mov.toTarget.y, mov.toTarget.z);
            }

            // keep orbit radius in sync
            if (ctrl && ctrl.target) {
                tmp.offset.copy(camera.position).sub(ctrl.target);
                tmp.spherical.setFromVector3(tmp.offset);
                s.current.radius = tmp.spherical.radius;
                s.current.radiusTarget = s.current.radius;
            }

            if (nowMs2 >= end) {
                roomOperatorMoveRef.current = null; // tween done
            }
        }

        // --- Smooth Zoom (velocity-based, like free-roam) ---
        {
            const z = CFG.current.zoom;
            const v0 = s.current.zoomVel || 0;

            if (Math.abs(v0) > 1e-4) {
                // Damp velocity toward 0 (friction)
                const v = dampScalar(v0, 0, z.velLambda, dt);
                s.current.zoomVel = v;

                const dist = v * dt;
                if (Math.abs(dist) > 1e-6) {
                    // Move along view direction on ground plane
                    camera.getWorldDirection(tmp.dir);
                    tmp.dir.y = 0;
                    tmp.dir.normalize();

                    tmp.move.copy(tmp.dir).multiplyScalar(dist);
                    camera.position.add(tmp.move);
                    if (ctrl.target) {
                        ctrl.target.add(tmp.move);
                    }
                    ctrl.update();
                }
            } else {
                s.current.zoomVel = 0;
            }
        }



        // --- Speed adjust keys (+ / -) ---
        {
            const f = CFG.current.fly;
            const plusHeld = keys.current.has("Equal") || keys.current.has("NumpadAdd");       // '+' (or '=' key) & numpad
            const minusHeld = keys.current.has("Minus") || keys.current.has("NumpadSubtract");  // '-' & numpad

            let target = s.current.flySpeedTarget ?? f.baseSpeed;

            if (!isTyping()) {
                if (plusHeld) {
                    // multiplicative growth while held
                    target *= (1 + f.adjustRate * dt);
                }
                if (minusHeld) {
                    // multiplicative shrink while held
                    target /= (1 + f.adjustRate * dt);
                }
            }

            // clamp and smooth
            target = THREE.MathUtils.clamp(target, f.speedMin, f.speedMax);
            s.current.flySpeedTarget = target;
            s.current.flySpeed = dampScalar(s.current.flySpeed ?? target, target, f.speedSmooth, dt);
        }

        // --- Smooth Fly (WASD + QE with damping) ---
        const controlsEnabled = !placement?.armed && !dragState?.active && !isTyping();
        if (controlsEnabled) {
            const f = CFG.current.fly;
            const shift = keys.current.has("ShiftLeft") || keys.current.has("ShiftRight");
            const base = s.current.flySpeed ?? f.baseSpeed;
            const speed = base * (shift ? f.sprintMult : 1);

            camera.getWorldDirection(tmp.dir);
            tmp.dir.y = 0; tmp.dir.normalize();
// Right-handed: right = forward × up
            tmp.right.copy(tmp.dir).cross(tmp.up).normalize();


            tmp.move.set(0, 0, 0);
            if (keys.current.has("KeyW")) tmp.move.add(tmp.dir);
            if (keys.current.has("KeyS")) tmp.move.addScaledVector(tmp.dir, -1);
            if (keys.current.has("KeyA")) tmp.move.addScaledVector(tmp.right, -1);
            if (keys.current.has("KeyD")) tmp.move.add(tmp.right);
            if (keys.current.has("KeyQ")) tmp.move.addScaledVector(tmp.up, -f.verticalMult);
            if (keys.current.has("KeyE")) tmp.move.addScaledVector(tmp.up,  f.verticalMult);

            if (tmp.move.lengthSq() > 0) tmp.move.normalize().multiplyScalar(speed);

            dampVec(s.current.vel, tmp.move, f.lambda, dt);

            if (s.current.vel.lengthSq() > 1e-10) {
                const step = s.current.vel.clone().multiplyScalar(dt);
                camera.position.add(step);
                ctrl.target.add(step);
                ctrl.update();
            }
        } else {
            // bleed off velocity when disabled
            dampVec(s.current.vel, new THREE.Vector3(), CFG.current.fly.lambda, dt);
        }
    });

    // gizmo dragging guard
    useEffect(() => {
        if (!tcRef.current) return;
        const onDrag = (e) => {
            const dragging = !!e.value;
            dragState?.set?.(dragging);
            if (missGuardRef) missGuardRef.current = performance.now();
        };
        tcRef.current.addEventListener("dragging-changed", onDrag);
        return () => tcRef.current?.removeEventListener("dragging-changed", onDrag);
    }, [dragState, missGuardRef]);

    // when hiding model, clear ref so it doesn't raycast
    useEffect(() => {
        if (!showModel && modelRef) modelRef.current = null;
    }, [showModel, modelRef]);

    const stop = (e) => {
        e?.stopPropagation?.();
        if (missGuardRef) missGuardRef.current = performance.now();
    };
// put these just above your <TransformControls> JSX:
    const tSnap =
        transformMode === "translate" && (placement?.snap ?? 0) > 0
            ? (placement?.snap ?? 0)    // meters (world units)
            : undefined;

    const rSnap =
        transformMode === "rotate" && (placement?.snap ?? 0) > 0
            ? THREE.MathUtils.degToRad(placement?.snap ?? 0) // degrees -> radians
            : undefined;

    const sSnap =
        transformMode === "scale" && (placement?.snap ?? 0) > 0
            ? (placement?.snap ?? 0)    // unit steps
            : undefined;
// ----- Multi-move support -----
    const multiRef = useRef(new THREE.Object3D());
    const lastPos = useRef(new THREE.Vector3());

// Use refs so the "don't-sync pivot while dragging" guard flips immediately.
// (React state can lag a frame, which is enough to cause huge deltas.)
    const tcDraggingRef = useRef(false);

// Stable multi-drag snapshot (baseline pivot + start positions for each selected entity)
    const multiDragRef = useRef({
        active: false,
        baseline: new THREE.Vector3(),
        starts: new Map(), // key -> [x,y,z]
    });

    const bpRef = useRef(new THREE.Object3D());
    const bpMetaRef = useRef(null); // { linkId, index }
    useEffect(() => {
        if (!selectedBreakpoint) {
            bpMetaRef.current = null;
            return;
        }
        const { linkId, index } = selectedBreakpoint;
        const link = links.find(l => l.id === linkId);
        const bp = link?.breakpoints?.[index];
        if (!link || !Array.isArray(link.breakpoints) || !bp) {
            bpMetaRef.current = null;
            return;
        }
        bpRef.current.position.set(bp[0], bp[1], bp[2]);
        bpMetaRef.current = { linkId, index };
    }, [selectedBreakpoint?.linkId, selectedBreakpoint?.index, links]);
    const UP = new THREE.Vector3(0, 1, 0);
    const __v0 = new THREE.Vector3();
    const __v1 = new THREE.Vector3();
    const __v2 = new THREE.Vector3();
    function NodeSelectionPulse({ position }) {
        const groupRef = React.useRef();
        const ringARef = React.useRef();
        const ringBRef = React.useRef();
        const tRef = React.useRef(0);

        useFrame((_, delta) => {
            if (!groupRef.current) return;

            // Slow-ish, smooth pulse
            tRef.current += delta * 0.75;
            const t = tRef.current;

            const updateRing = (ref, offset) => {
                if (!ref.current) return;
                const phase = (t + offset) % 1;

                // scale: 1 → 1.7
                const s = 1 + phase * 0.7;
                // opacity: 0.7 → 0
                const o = 0.7 * (1 - phase);

                ref.current.scale.set(s, s, s);
                if (ref.current.material) {
                    ref.current.material.opacity = o;
                }
            };

            updateRing(ringARef, 0.0);  // first wave
            updateRing(ringBRef, 0.5);  // second wave, offset in time
        });

        if (!position) return null;

        return (
            <group
                ref={groupRef}
                position={[
                    position[0],
                    (position[1] || 0) + 0.03, // sits just above the floor / platform
                    position[2],
                ]}
                rotation={[-Math.PI / 2, 0, 0]}
                renderOrder={9998}
            >
                {/* inner pulse */}
                <mesh ref={ringARef}>
                    <ringGeometry args={[0.55, 0.75, 48]} />
                    <meshBasicMaterial
                        color="#38bdf8"
                        transparent
                        opacity={0.7}
                        depthWrite={false}
                    />
                </mesh>

                {/* outer pulse */}
                <mesh ref={ringBRef}>
                    <ringGeometry args={[0.55, 0.75, 48]} />
                    <meshBasicMaterial
                        color="#38bdf8"
                        transparent
                        opacity={0.7}
                        depthWrite={false}
                    />
                </mesh>
            </group>
        );
    }

    function computeCableOffsetsForLink(link, start, end) {
        const cable = link?.cable || {};
        const count = Math.max(1, Math.min(32, Math.round(cable.count ?? 4)));
        const spread = cable.spread ?? 0.12;
        const rough = cable.roughness ?? 0.25;

        if (count <= 0) return [];

        const dir = __v0.set(
            end[0] - start[0],
            end[1] - start[1],
            end[2] - start[2]
        );
        if (dir.lengthSq() === 0) return [[0, 0, 0]];
        dir.normalize();

        const side = __v1.copy(dir).cross(UP);
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        side.normalize();

        const up = __v2.copy(dir).cross(side).normalize();

        const offsets = [];
        // core in the middle
        offsets.push([0, 0, 0]);

        const outer = Math.max(0, count - 1);
        for (let i = 0; i < outer; i++) {
            const t = outer <= 1 ? 0 : i / outer;
            let angle = t * Math.PI * 2;

            if (rough > 0) {
                const jitter = (Math.sin((i + 1) * 31.7) * 43758.5453) % 1 - 0.5;
                angle += jitter * 0.8 * rough;
            }

            let radius = spread;
            if (rough > 0) {
                const rj = (Math.sin((100 + i) * 17.3) * 12345.6789) % 1 - 0.5;
                radius *= 1 + rj * 0.6 * rough;
            }

            const c = Math.cos(angle);
            const s = Math.sin(angle);

            const ox = side.x * c * radius + up.x * s * radius;
            const oy = side.y * c * radius + up.y * s * radius;
            const oz = side.z * c * radius + up.z * s * radius;

            offsets.push([ox, oy, oz]);
        }

        return offsets;
    }

    const multiPositions = useMemo(() => {
        return (uniqueSelectedMulti || [])
            .map((it) => {
                if (it.type === "node") {
                    const n = nodeMap[it.id];
                    return n?.position ? new THREE.Vector3(...n.position) : null;
                }
                if (it.type === "room") {
                    const r = rooms.find((x) => x.id === it.id);
                    if (!r || r.locked) return null;
                    return r.center ? new THREE.Vector3(...r.center) : null;
                }
                return null;
            })
            .filter(Boolean);
    }, [uniqueSelectedMulti, nodeMap, rooms]);


    const multiCentroid = useMemo(() => {
        if (!multiPositions.length) return null;
        const s = new THREE.Vector3();
        multiPositions.forEach((v) => s.add(v));
        s.multiplyScalar(1 / multiPositions.length);
        return s;
    }, [multiPositions]);

    useLayoutEffect(() => {
        if (!multiCentroid) return;

        // IMPORTANT: do NOT fight TransformControls while dragging.
        if (tcDraggingRef.current || dragState?.active) return;

        // Never write non-finite values into the pivot.
        if (![multiCentroid.x, multiCentroid.y, multiCentroid.z].every(Number.isFinite)) return;

        multiRef.current.position.copy(multiCentroid);
        lastPos.current.copy(multiCentroid);
    }, [multiCentroid?.x, multiCentroid?.y, multiCentroid?.z, dragState?.active]);



    // pick target for TransformControls
    // pick target for TransformControls
    const tcTarget = useMemo(() => {
        // In Room Operator we never want the gizmo
        if (roomOperatorMode) return null;

        // If move mode is off, no gizmo either
        if (!moveMode) return null;

        // ----- Multi-selection -----
        const multiCount = uniqueSelectedMulti?.length || 0;
        if (multiCount > 1) {
            // Only attach the gizmo if at least one selected item is movable
            const hasMovable = (selectedMulti || []).some((it) => {
                if (!it) return false;
                if (it.type === "node") return true;
                if (it.type === "room") {
                    const r = rooms.find((x) => x.id === it.id);
                    return r && !r.locked;
                }
                return false;
            });

            return hasMovable ? multiRef.current : null;
        }

        // ----- Single breakpoint -----
        if (selectedBreakpoint) {
            return bpRef.current;
        }

        // ----- Single node -----
        if (selectedNode?.id) {
            return nodeRefs.current[selectedNode.id]?.current || null;
        }

        // ----- Single room (only if not locked) -----
        if (selectedRoom?.id && !selectedRoom.locked) {
            return roomRefs.current[selectedRoom.id]?.current || null;
        }

        return null;
    }, [
        roomOperatorMode,
        moveMode,
        selectedMulti,
        selectedBreakpoint?.linkId,
        selectedBreakpoint?.index,
        selectedNode?.id,
        selectedRoom?.id,
        rooms,
    ]);



    return (
        <>
            {/* Global lighting */}
            {showLights ? (
                <>
                    {/* Image-based environment for nice PBR response */}
                    <Environment preset="warehouse" intensity={0.8} />

                    {/* Soft sky/ground ambient so nothing goes pitch black */}
                    <hemisphereLight
                        skyColor="#ffffff"
                        groundColor="#404040"
                        intensity={0.7}
                    />

                    {/* Main “sun” light */}
                    <directionalLight
                        color="#ffffff"
                        position={[6, 8, 6]}
                        intensity={2.4}
                        castShadow={shadowsOn && perf !== "low"}
                        shadow-bias={-0.0005}
                        shadow-normalBias={0.02}
                        shadow-mapSize={[2048, 2048]}
                    />

                    {/* Fill light from the opposite side to open up shadows */}
                    <directionalLight
                        color="#ffffff"
                        position={[-5, 4, -3]}
                        intensity={1.0}
                    />
                </>
            ) : (
                // Soft fallback so the scene isn't totally dark when lights are off
                <ambientLight intensity={0.4} />
            )}

            {/* Model */}
            {showModel && modelDescriptor && (
                <group ref={modelRef} scale={modelScale}>
                    <ImportedModel
                        descriptor={modelDescriptor}
                        wireframe={wireframe}
                        wireOpacity={wireOpacity}
                        wireDetail={wireDetail}
                        enableShadows={!!shadowsOn}
                        wireHideSurfaces={wireframe && wireHideSurfaces}
                        wireStroke={mergedWireStroke}
                        perf={perf}
                        shadingMode="leanPBR"
                        onScene={(scene) => {
                            if (modelRef) modelRef.current = scene;
                            if (typeof onModelScene === "function") onModelScene(scene);
                        }}
                    />
                </group>
            )}



            {/* Rooms */}
            {rooms.map((r) => {
                if (hiddenRooms.has(r.id) || (r.deckId && hiddenDeck.has(r.deckId))) return null;
                roomRefs.current[r.id] ||= React.createRef();
                return (
                    <RoomBox
                        ref={roomRefs.current[r.id]}
                        key={r.id}
                        room={r}
                        dragging={dragState.active}
                        selected={(selected?.type === "room" && selected.id === r.id) || selectedMultiSet.has(`room:${r.id}`)}
                        onPointerDown={(id, e) => {
                            // ---------- EXCLUSIVE SELECTION MODE ----------
                            // If a node is currently selected, do NOT allow rooms to be selected.
                            if (selected?.type === "node") return;

                            // If multi-selection contains any nodes, also disallow.
                            if ([...(selectedMulti || [])].some(s => s.type === "node")) return;

                            // If dragging, block selection (your current behavior)
                            if (dragState.active) return;

                            // ---------- ALLOW ROOM SELECTION ----------
                            if (onRoomPointerDown) onRoomPointerDown(id, e);
                            else setSelected?.({ type: "room", id });
                        }}

                        dragging={!!dragState?.active}
                        opacity={roomOpacity}
                        wireframeGlobal={wireframe}
                        labelsOn={labelsOn}
                        labelMode={labelMode}
                        labelSize={labelSize}
                        labelMaxWidth={labelMaxWidth}
                        label3DLayers={label3DLayers}
                        label3DStep={label3DStep}
                        roomOperatorMode={roomOperatorMode}
                        onRoomAnchorClick={(roomId, dir) => {
                            console.log("[SceneInner] onRoomAnchorClick", { roomId, dir, hasParent: !!onRoomAnchorClick });
                            if (onRoomAnchorClick) onRoomAnchorClick(roomId, dir);
                        }}
                        onRoomDelete={onRoomDelete}
                        onRoomResize={onRoomResize}

                    />
                );
            })}

            {/* Nodes */}
            {nodes.map((n) => {
                const nodeHidden =
                    (n.deckId && hiddenDeck.has(n.deckId)) ||
                    (n.roomId && hiddenRooms.has(n.roomId));
                if (nodeHidden) return null;
                nodeRefs.current[n.id] ||= React.createRef();
                return (
                    <Node3D
                        ref={nodeRefs.current[n.id]}
                        key={n.id}
                        node={n}

                        selected={(selected?.type === "node" && selected.id === n.id) || selectedMultiSet.has(`node:${n.id}`)}
                        onPointerDown={(id, e) => {
                            if (dragState?.active) return;
                            if (onNodePointerDown) onNodePointerDown(id, e);
                            else setSelected?.({ type: "node", id });
                        }}


                        showLights={showLights}
                        showLightBoundsGlobal={showLightBounds}
                        shadowsOn={shadowsOn}

                        dragging={!!dragState?.active}
                        labelsOn={labelsOn}
                        labelMode={labelMode}
                        labelSize={labelSize}
                        labelMaxWidth={labelMaxWidth}
                        label3DLayers={label3DLayers}
                        label3DStep={label3DStep}
                    />
                );
            })}

            /* Links */
            {allLinks.map((l) => {
                const a = nodeMap[l.from];
                const b = nodeMap[l.to];
                if (!a || !b) return null;
                // ... your established / hidden checks ...

                const points = [
                    a.position,
                    ...(Array.isArray(l.breakpoints) ? l.breakpoints : []),
                    b.position,
                ];
                if (points.length < 2) return null;

                const segCount = points.length - 1;

                // 👉 NEW: global strand offsets for this whole link
                const cableOffsets =
                    l.style === "cable"
                        ? computeCableOffsetsForLink(l, points[0], points[points.length - 1])
                        : null;

                const isSelected = selected?.type === "link" && selected.id === l.id;

                return points.slice(0, -1).map((p, idx) => (
                    <Link3D
                        key={`${l.id}-seg-${idx}`}
                        link={l}
                        from={p}
                        to={points[idx + 1]}
                        // NEW:
                        segmentIndex={idx}
                        segmentCount={segCount}
                        cableOffsets={cableOffsets}
                        selected={isSelected}
                        onPointerDown={() => setSelected?.({ type: "link", id: l.id })}
                        animate={animate}
                    />
                ));
            })}




            {/* Transform gizmo */}
            {moveMode && !roomOperatorMode && tcTarget && (
                <TransformControls
                    ref={tcRef}
                    object={tcTarget}
                    mode={transformMode}
                    onDragStart={() => {
                        tcDraggingRef.current = true;
                        dragState?.set?.(true);

                        const o = tcRef.current?.object;
                        const multiCount = uniqueSelectedMulti?.length || 0;

                        // Build a stable snapshot for multi-drag.
                        if (o && o === multiRef.current && multiCount > 1) {
                            const starts = new Map();

                            uniqueSelectedMulti.forEach((it) => {
                                if (it.type === "node") {
                                    const n = nodeMap[it.id];
                                    if (Array.isArray(n?.position)) starts.set(`node:${it.id}`, [...n.position]);
                                } else if (it.type === "room") {
                                    const r0 = rooms.find((rr) => rr.id === it.id);
                                    if (r0 && !r0.locked && Array.isArray(r0.center)) starts.set(`room:${it.id}`, [...r0.center]);
                                }
                            });

                            multiDragRef.current.active = true;
                            multiDragRef.current.baseline.copy(o.position);
                            multiDragRef.current.starts = starts;

                            // keep legacy lastPos in sync (fallback)
                            lastPos.current.copy(o.position);
                        } else {
                            multiDragRef.current.active = false;
                        }
                    }}

                    onDragEnd={() => {
                        tcDraggingRef.current = false;
                        dragState?.set?.(false);
                        multiDragRef.current.active = false;
                        if (missGuardRef) missGuardRef.current = performance.now();
                    }}

                    translationSnap={tSnap}
                    rotationSnap={rSnap}
                    scaleSnap={sSnap}
                    size={1.0}
                    space="world"
                    onMouseDown={stop}
                    onMouseUp={stop}
                    onPointerDown={stop}
                    onPointerUp={stop}
                    onObjectChange={() => {
                        const obj = tcRef.current?.object;
                        if (!obj) return;

                        const p = obj.position;
                        const r = obj.rotation;

                        // 1) Multi-move centroid
                        if ((selectedMulti?.length || 0) > 1 && obj === multiRef.current) {
                            const dx = p.x - lastPos.current.x;
                            const dy = p.y - lastPos.current.y;
                            const dz = p.z - lastPos.current.z;
                            lastPos.current.set(p.x, p.y, p.z);

                            selectedMulti.forEach((it) => {
                                if (it.type === "node") {
                                    const n = nodeMap[it.id];
                                    if (!n || !Array.isArray(n.position)) return;
                                    const np = [
                                        n.position[0] + dx,
                                        n.position[1] + dy,
                                        n.position[2] + dz,
                                    ];
                                    onEntityTransform?.({ type: "node", id: it.id }, np);
                                } else if (it.type === "room") {
                                    const r0 = rooms.find((rr) => rr.id === it.id);
                                    if (!r0 || r0.locked || !Array.isArray(r0.center)) return;
                                    const rp = [
                                        r0.center[0] + dx,
                                        r0.center[1] + dy,
                                        r0.center[2] + dz,
                                    ];
                                    onEntityTransform?.({ type: "room", id: it.id }, rp);
                                }

                            });

                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }

                        // 2) Single breakpoint – handle this BEFORE node/room
                        if (selectedBreakpoint && obj === bpRef.current) {
                            const meta = bpMetaRef.current || selectedBreakpoint;
                            onEntityTransform?.(
                                { type: "breakpoint", linkId: meta.linkId, index: meta.index },
                                [p.x, p.y, p.z],
                            );
                            if (missGuardRef) missGuardRef.current = performance.now();
                            return;
                        }

                        // 3) Single node / room
                        if (selectedNode) {
                            onEntityTransform?.(
                                { type: "node", id: selectedNode.id },
                                [p.x, p.y, p.z],
                            );
                            onEntityRotate?.(
                                { type: "node", id: selectedNode.id },
                                [r.x, r.y, r.z],
                            );
                        } else if (selectedRoom && !selectedRoom.locked) {
                            onEntityTransform?.(
                                { type: "room", id: selectedRoom.id },
                                [p.x, p.y, p.z],
                            );
                            onEntityRotate?.(
                                { type: "room", id: selectedRoom.id },
                                [r.x, r.y, r.z],
                            );
                        }


                        if (missGuardRef) missGuardRef.current = performance.now();
                    }}
                />
            )}
            {uiHidden && selectedNode?.position && (
                <NodeSelectionPulse position={selectedNode.position} />
            )}


            {/* Ground & shadows */}
            {showGround && (
                <>
                    {shadowsOn && (
                        <ContactShadows
                            opacity={0.35}
                            scale={12}
                            blur={1.75}
                            far={8}
                            resolution={1024}
                            frames={60}
                        />
                    )}
                    <Grid args={[20, 20]} sectionColor="#1f2a44" cellColor="#0f1628" infiniteGrid />
                    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
                        <planeGeometry args={[50, 50]} />
                        <meshStandardMaterial color="#0d1322" roughness={0.95} metalness={0.0} />
                    </mesh>
                </>
            )}

            {/* Orbit: rotate/pan only; zoom handled above */}
            <OrbitControls
                ref={controlsRef}
                makeDefault
                enabled={!placement?.armed && !dragState?.active}
                enableDamping
                dampingFactor={0.16}
                enableZoom={false} // still off: zoom is handled by our custom logic
                // minDistance={CFG.current.zoom.min}
                // maxDistance={CFG.current.zoom.max}
                enableRotate={!roomOperatorMode}
                minPolarAngle={roomOperatorMode ? 0.0005 : undefined}
                maxPolarAngle={roomOperatorMode ? 0.0005 : undefined}
                minAzimuthAngle={roomOperatorMode ? 0 : undefined}
                maxAzimuthAngle={roomOperatorMode ? 0 : undefined}
            />


            {/* Click-to-place */}
            <InteractionLayer
                armed={!!placement?.armed}
                placeKind={placement?.placeKind}
                multi={!!placement?.multi}
                snap={placement?.snap ?? 0.25}
                onPlace={onPlace}
                modelRef={modelRef}
            />
        </>
    );
}

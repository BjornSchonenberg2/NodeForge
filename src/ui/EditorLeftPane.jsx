import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Btn, IconBtn, Input, Select, Checkbox, Slider, Panel } from "./Controls.jsx";
import { Canvas, useFrame } from "@react-three/fiber";
import { NodeShapeAdvanced } from "../nodes/Node3D.jsx";
import { STATIC_SHAPES } from "../data/shapes/registry.js";
import { DEFAULT_CLUSTERS } from "../utils/clusters.js";
import { v4 as uuid } from "uuid";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));


// --- tiny inline icons (no external deps) ---
function EyeIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function EyeOffIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.85"
            />
            <path
                d="M9.5 9.5a3.2 3.2 0 0 0 4.8 4.2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M4 4l16 16"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function TrashIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 7h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M10 11v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M14 11v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path
                d="M6 7l1 14h10l1-14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
            />
            <path
                d="M9 7V4h6v3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function ChevronUpIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 14l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ChevronDownIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 10l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function PlusIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 5v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}

function TargetIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 4V7M12 17V20M4 12H7M17 12H20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}

function MinusIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}


function LockIcon({ size = 12 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <rect x="5" y="10" width="14" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 10V7.5A4 4 0 0 1 12 3.5a4 4 0 0 1 4 4V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}

function UnlockIcon({ size = 12 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <rect x="5" y="10" width="14" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 10V7.5A4 4 0 0 1 12 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M12 3.5a4 4 0 0 1 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.35" />
        </svg>
    );
}


function RoomBoxIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
        </svg>
    );
}

function RoomPointsIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M4 18l5-7 5 4 6-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="4" cy="18" r="1.6" fill="currentColor" />
            <circle cx="9" cy="11" r="1.6" fill="currentColor" />
            <circle cx="14" cy="15" r="1.6" fill="currentColor" />
            <circle cx="20" cy="7" r="1.6" fill="currentColor" />
        </svg>
    );
}

function FilterIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="7" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="16" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="12" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.4" />
        </svg>
    );
}

function MirrorIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 6v12M19 6v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
            <path d="M8 8l4-3v14l-4-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 8l-4-3v14l4-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ReshapeIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 7h9M4 12h6M4 17h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M15 6l5 3-5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20 15l-5 3v-6l5 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
        </svg>
    );
}

function GroupIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="17" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="15.5" r="2.6" stroke="currentColor" strokeWidth="1.6" />
            <path d="M4.5 16c0-1.8 1.9-3.2 4.2-3.2M19.5 16c0-1.8-1.9-3.2-4.2-3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    );
}

function SelectorIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
    );
}

function WizardHatIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M4 18c3.5-2 5.5-7 8-13 2 6 4.5 11 8 13H4Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
            />
            <path d="M8.5 10.2l1.5 1 1.5-1.2 1.2 1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M6 18h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}

function DeckStackIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 7l8-4 8 4-8 4-8-4Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 12l8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 17l8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function RoomHouseIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M4 11.5L12 5l8 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 10.5V19h10v-8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="10" y="13" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
        </svg>
    );
}

const ADVANCED_SHAPE_DEFAULTS = {
    tv: {
        type: "tv",
        scale: 4.95,
        w: 1.1,
        h: 0.7,
        d: 0.02,
        frame: 0,
        screenD: 0.02,
        screenInset: 0.006,
        screenW: 1,
        screenH: 0.63,
        cornerRadius: 0,
        hideScreen: false,
        colors: { frame: "#111827", screen: "#6b7280" },
    },
    remote: {
        type: "remote",
        scale: 1.15,
        w: 0.16,
        h: 0.55,
        d: 0.05,
        accentW: 0.06,
        accentH: 0.13,
        accentD: 0,
        accentOffsetY: -0.15,
        accentOffsetZ: -0.03,
        cornerRadius: 0.01,
        showScreen: true,
        screenW: 0.13,
        screenH: 0.14,
        screenD: 0,
        screenOffsetY: 0.19,
        screenOffsetZ: -0.025,
        dockEnabled: true,
        dockRadius: 0.18,
        dockHeight: 0.045,
        dockMidRadius: 0.19,
        dockMidHeight: 0.025,
        dockInnerRadius: 0.12,
        dockInnerHeight: 0.07,
        dockOffsetY: -0.33,
        dockOffsetZ: 0,
        colors: {
            body: "#111827",
            buttons: "#64748b",
            screen: "#334155",
            dockBase: "#0f172a",
            dockMid: "#1f2937",
            dockInner: "#334155",
        },
    },
    accesspoint: {
        type: "accesspoint",
        scale: 1,
        radius: 0.35,
        height: 0.12,
        overlapSpread: 1,
        overlapHeight: 0.06,
        colors: { body: "#e5e7eb", overlap: "#38bdf8" },
    },
    laviebox: {
        type: "laviebox",
        scale: 0.8,
        w: 0.96,
        h: 0.18,
        d: 1,
        cornerRadius: 0,
        textEnabled: true,
        textValue: "LAVIE",
        textFont: "helvetiker",
        textSize: 0.09,
        textDepth: 0.005,
        textSide: "back",
        textOffsetX: 0.15,
        textOffsetY: -0.05,
        textOffsetZ: -0.02,
        panelEnabled: true,
        panelW: 0.96,
        panelH: 0.18,
        panelD: 0.01,
        panelOffsetX: 0,
        panelOffsetY: 0,
        panelOffsetZ: -0.52,
        holeMode: "honeycomb",
        holeCountX: 28,
        holeCountY: 14,
        holeSize: 0.005,
        holeDepth: 0.01,
        holePadding: 0.025,
        ledBoxEnabled: true,
        ledBoxW: 0.96,
        ledBoxH: 0.18,
        ledBoxD: 0.02,
        ledBoxOffsetX: 0,
        ledBoxOffsetY: 0,
        ledBoxOffsetZ: -0.51,
        ledEnabled: true,
        ledIntensity: 1.5,
        ledStripW: 0.99,
        ledStripH: 0,
        ledStripD: 0.01,
        ledStripOffsetY: 0,
        ledStripOffsetZ: -0.01,
        colors: {
            body: "#030202",
            panel: "#1f2937",
            holes: "#0b1220",
            text: "#e2e8f0",
            led: "#38bdf8",
            ledBox: "#000000",
        },
    },
    amplifier: {
        type: "amplifier",
        scale: 1.95,
        w: 0.72,
        d: 0.4,
        baseH: 0.13,
        midH: 0.01,
        topH: 0.1,
        baseW: 0.78,
        baseD: 0.42,
        midW: 0.78,
        midD: 0.38,
        topW: 0.8,
        topD: 0.42,
        baseCorner: 0,
        midCorner: 0,
        topCorner: 0,
        displayW: 0.37,
        displayH: 0.08,
        displayD: 0.025,
        displayOffsetX: 0.01,
        displayOffsetY: 0,
        displayOffsetZ: 0.2,
        knobR: 0.04,
        knobD: 0.06,
        knobOffsetX: 0,
        knobOffsetY: 0,
        knobOffsetZ: 0.21,
        colors: {
            base: "#0f172a",
            mid: "#111827",
            top: "#1f2937",
            display: "#38bdf8",
            knob: "#e2e8f0",
        },
    },
    ipad: {
        type: "ipad",
        scale: 1,
        w: 0.5,
        h: 0.7,
        d: 0.03,
        bezel: 0,
        cornerRadius: 0.04,
        screenInset: 0.006,
        screenOffsetZ: 0.007,
        screenW: 0.44,
        screenH: 0.66,
        colors: { body: "#111827", bezel: "#1f2937", screen: "#334155" },
    },
    speaker: {
        type: "speaker",
        scale: 2,
        w: 0.5,
        h: 0.5,
        d: 0.09,
        orientation: "ceiling",
        cornerRadius: 0.1,
        inWall: false,
        frontDepth: 0.31,
        rimEnabled: true,
        rimW: 0,
        rimH: 0,
        rimD: 0,
        driverCount: 1,
        driverRadius: 0.22,
        driverDepth: 0.06,
        driverInset: 0.06,
        driverOffsetY: 0,
        grilleEnabled: false,
        grilleD: 0.985,
        colors: {
            body: "#141c2e",
            rim: "#1b294b",
            driver: "#1b1d22",
            grille: "#1f2937",
        },
    },
    speakerfloor: {
        type: "speakerfloor",
        scale: 2.2,
        w: 0.38,
        h: 0.8,
        d: 0.26,
        cornerRadius: 0.08,
        inWall: false,
        frontDepth: 0.4,
        rimEnabled: true,
        rimW: 0,
        rimH: 0,
        rimD: 0,
        driverCount: 2,
        driverRadius: 0.16,
        driverDepth: 0.06,
        driverInset: 0.06,
        driverOffsetY: 0.18,
        grilleEnabled: false,
        grilleD: 0.985,
        colors: {
            body: "#111827",
            rim: "#1b294b",
            driver: "#1b1d22",
            grille: "#1f2937",
        },
    },
    soundbar: {
        type: "soundbar",
        scale: 2.2,
        w: 1.2,
        h: 0.18,
        d: 0.16,
        cornerRadius: 0.07,
        frontDepth: 0.16,
        wooferRadius: 0.07,
        tweeterRadius: 0.032,
        wooferOffsetX: 0.36,
        tweeterOffsetY: 0.02,
        grilleEnabled: false,
        grilleD: 0.012,
        grilleInset: 0.01,
        colors: {
            body: "#111827",
            driver: "#1b1d22",
            driverRing: "#0b1220",
            grille: "#1f2937",
        },
    },
    headphones: {
        type: "headphones",
        scale: 2,
        w: 0.98,
        h: 0.84,
        d: 0.32,
        earR: 0.18,
        earD: 0.18,
        earInset: 0.014,
        earDriverRadius: 0.1,
        cushionRadius: 0.19,
        cushionTube: 0.035,
        bandRadius: 0.42,
        bandTube: 0.045,
        bandPadTube: 0.032,
        bandYOffset: 0.22,
        earYOffset: -0.06,
        colors: {
            body: "#111827",
            ear: "#1f2937",
            cushion: "#0f172a",
            driver: "#0b1220",
            driverRing: "#0b1220",
            bandPad: "#0b1220",
        },
    },
    subwoofer: {
        type: "subwoofer",
        scale: 2,
        w: 0.7,
        h: 0.7,
        d: 0.5,
        cornerRadius: 0.06,
        frontDepth: 0.5,
        driverRadius: 0.24,
        driverDepth: 0.06,
        driverInset: 0.01,
        portRadius: 0.05,
        portOffsetY: -0.18,
        colors: {
            body: "#0f172a",
            driver: "#111827",
            driverRing: "#0b1220",
            port: "#0b1220",
        },
    },
};

const getAdvancedShapeDefaults = (lavieRefDims) => {
    if (!lavieRefDims) return ADVANCED_SHAPE_DEFAULTS;
    const base = ADVANCED_SHAPE_DEFAULTS;
    return {
        ...base,
        laviebox: {
            ...base.laviebox,
            w: lavieRefDims.w,
            h: lavieRefDims.h,
            d: lavieRefDims.d,
            panelW: lavieRefDims.w,
            panelH: lavieRefDims.h,
            ledBoxW: lavieRefDims.w,
            ledBoxH: lavieRefDims.h,
            ledStripW: lavieRefDims.w,
        },
    };
};

function ShapePreviewMesh({ shapeKey = "sphere", advancedDefaults = ADVANCED_SHAPE_DEFAULTS }) {
    const key = String(shapeKey || "sphere").toLowerCase();
    const meshRef = useRef(null);
    useFrame((_, dt) => {
        if (!meshRef.current) return;
        meshRef.current.rotation.y += dt * 0.8;
        meshRef.current.rotation.x = 0.4;
    });

    const previewShape = (() => {
        if (advancedDefaults[key]) return advancedDefaults[key];
        if (key.startsWith("model:")) return { type: "box", scale: [0.8, 0.6, 0.8] };
        if (key === "sphere") return { type: "sphere", radius: 0.28 };
        if (key === "box") return { type: "box", scale: [0.6, 0.3, 0.6] };
        if (key === "cylinder") return { type: "cylinder", radius: 0.35, height: 0.6 };
        if (key === "cone") return { type: "cone", radius: 0.35, height: 0.7 };
        if (key === "disc") return { type: "disc", radius: 0.35, height: 0.08 };
        if (key === "hexagon") return { type: "hexagon", radius: 0.35, height: 0.5 };
        if (key === "switch") return { type: "switch", w: 1.1, h: 0.12, d: 0.35 };
        if (key === "mediahub") return { type: "box", scale: [0.6, 0.3, 0.6] };
        if (key === "lansocket") return { type: "switch", w: 0.7, h: 0.1, d: 0.25 };
        if (key === "transmitter") return { type: "sphere", radius: 0.28 };
        if (key === "receiver") return { type: "sphere", radius: 0.28 };
        return { type: "box", scale: [0.6, 0.3, 0.6] };
    })();
    const advancedTypes = ["tv", "remote", "accesspoint", "ipad", "amplifier", "laviebox", "speaker", "speakerfloor", "soundbar", "headphones", "subwoofer"];
    if (advancedTypes.includes(previewShape.type)) {
        return (
            <group ref={meshRef} scale={0.9}>
                <NodeShapeAdvanced
                    shape={previewShape}
                    baseColor="#7dd3fc"
                    opacity={1}
                    castShadow={false}
                    receiveShadow={false}
                />
            </group>
        );
    }
    const geometry = (() => {
        if (key === "sphere") return <sphereGeometry args={[0.5, 32, 32]} />;
        if (key === "box") return <boxGeometry args={[0.8, 0.6, 0.8]} />;
        if (key === "cylinder") return <cylinderGeometry args={[0.4, 0.4, 0.9, 24]} />;
        if (key === "cone") return <coneGeometry args={[0.45, 0.9, 24]} />;
        if (key === "disc") return <cylinderGeometry args={[0.55, 0.55, 0.18, 32]} />;
        if (key === "hexagon") return <cylinderGeometry args={[0.5, 0.5, 0.7, 6]} />;
        if (key === "mediahub" || key === "lansocket") return <boxGeometry args={[0.7, 0.35, 0.5]} />;
        if (key === "transmitter" || key === "receiver") return <sphereGeometry args={[0.45, 24, 24]} />;
        return <boxGeometry args={[0.8, 0.6, 0.8]} />;
    })();

    return (
        <mesh ref={meshRef}>
            {geometry}
            <meshStandardMaterial color="#7dd3fc" roughness={0.35} metalness={0.2} />
        </mesh>
    );
}

function GlobeIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
            <path d="M4.5 12h15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M12 4a8.5 8.5 0 0 1 0 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M12 4a8.5 8.5 0 0 0 0 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        </svg>
    );
}

function NodeGlyphIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <circle cx="6" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="18" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="18" cy="18" r="2.6" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8.5 11l7-4M8.5 13l7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

function CircleIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.6" />
        </svg>
    );
}

function SquareIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <rect x="5.5" y="5.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
    );
}

function SpeakerIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <rect x="7" y="3.5" width="10" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="9" r="2.6" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
        </svg>
    );
}

function HexIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M7 4h10l4 7-4 7H7L3 11l4-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
    );
}

function ConeIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M12 4l6 14H6l6-14Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
    );
}

function CylinderIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <ellipse cx="12" cy="6.5" rx="6.5" ry="3" stroke="currentColor" strokeWidth="1.6" />
            <path d="M5.5 6.5v9c0 1.7 3 3 6.5 3s6.5-1.3 6.5-3v-9" stroke="currentColor" strokeWidth="1.6" />
        </svg>
    );
}

function DiscIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
    );
}

function TileIcon({ size = 18 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <rect x="4" y="4" width="16" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M4 10h16M4 16h16M10 4v16M16 4v16" stroke="currentColor" strokeWidth="1.2" opacity="0.8" />
        </svg>
    );
}

function AnchorIcon({ size = 14 }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="5" r="2.5" />
            <path d="M12 8.5v7.5" />
            <path d="M6 12a6 6 0 0 0 12 0" />
            <path d="M6 12H3m15 0h3" />
        </svg>
    );
}

function FocusIcon({ size = 14 }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M4 12h4M16 12h4M12 4v4M12 16v4" />
        </svg>
    );
}

function SectionDetails({
                            title,
                            children,
                            defaultOpen = false,
                            expandAllToken,
                            collapseAllToken,
                        }) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    // Respond to global expand / collapse tokens
    useEffect(() => {
        setIsOpen(true);
    }, [expandAllToken]);

    useEffect(() => {
        setIsOpen(false);
    }, [collapseAllToken]);

    const handleSummaryClick = (e) => {
        // prevent native toggle; we fully control state here
        e.preventDefault();
        setIsOpen((open) => !open);
    };

    const summaryStyle = {
        cursor: "pointer",
        padding: "6px 8px",
        marginBottom: 4,
        borderRadius: 8,
        background:
            "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03))",
        fontSize: 10,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "0 8px 18px rgba(0,0,0,0.35)",
        backdropFilter: "blur(8px) saturate(1.08)",
    };

    return (
        <details open={isOpen}>
            <summary
                className="left-section-summary"
                style={summaryStyle}
                onClick={handleSummaryClick}
            >
                <span>{title}</span>
                <span style={{ fontSize: 11, opacity: 0.75 }}>
          {isOpen ? "v" : ">"}
        </span>
            </summary>
            {children}
        </details>
    );
}

function EditorLeftPane({
                            prodMode,
                            leftColRef,
                            uiStart,
                            uiStop,
                            stopAnchorDefault,

                            // selection (for model move UI)
                            selected,
                            onMoveModel,
                            onResetModelPosition,
                            modelPosition,
                            modelRotation,
                            setModelRotation,

                            // placement
                            placement,
                            setPlacement,

                            // tree / panels
                            LegendTree,
                            GroupsPanel,
                            GroupsMembersPanel,
                            DecksPanel,
                            LinksPanel,
                            FlowDefaultsPanel,
                            ActionsPanel,

                            // HUD layout
                            actionsHud,
                            setActionsHud,

                            // room FX
                            roomGap,
                            setRoomGap,
                            modelBounds,
                            roomOpacity,
                            setRoomOpacity,

                            // view / perf
                            perf,
                            setPerf,
                            bg,
                            setBg,
                            wireframe,
                            setWireframe,
                            showLights,
                            setShowLights,
                            showLightBounds,
                            setShowLightBounds,
                            showGround,
                            setShowGround,

                            // grid / floors
                            gridConfig,
                            setGridConfig,

                            autoFollowSelection,
                            setAutoFollowSelection,

                            animate,
                            setAnimate,
                            labelsOn,
                            setLabelsOn,
                            hudButtonsVisible = true,
                            setHudButtonsVisible,
                            roomTileCount = 4,

                            nodes,
                            setNodes,
                            setNodeById,
                            multiSel,
                            setMultiSel,
                            setSelected,
                            setLinks,
                            setRooms,
                            rooms,
                            groups,
                            decks,
                            copyRoomNodesToRoom,
                            onRenameOrganizer,
                            duplicateRoom,
                            duplicateNode,
                            addDeck,
                            setDecks,
                            setMoveMode,
                            setTransformMode,
                            setGroups,
                            lavieRefDims: lavieRefDimsProp,
                        }) {

    const [paneWidth, setPaneWidth] = useState(() => {
        if (typeof window === "undefined") return 440;
        try {
            const saved = Number(localStorage.getItem("epic3d.leftPaneWidth.v1"));
            if (Number.isFinite(saved) && saved > 260) return saved;
        } catch {}
        return Math.min(440, window.innerWidth - 80);
    });

    // OK plain React + JS
    const [expandAllToken, setExpandAllToken] = useState(0);
    const [collapseAllToken, setCollapseAllToken] = useState(0);
    const [activeTab, setActiveTab] = useState("editor");
    const [templaterWizardOpen, setTemplaterWizardOpen] = useState(false);
    const [templaterRooms, setTemplaterRooms] = useState([]);
    const [templaterDecks, setTemplaterDecks] = useState([]);
    const [templaterRoomQty, setTemplaterRoomQty] = useState(1);
    const [templaterRoomNames, setTemplaterRoomNames] = useState("");
    const [templaterRoomPrefix, setTemplaterRoomPrefix] = useState("Room ");
    const [templaterDeckName, setTemplaterDeckName] = useState("");
    const [templaterSelectedRoomId, setTemplaterSelectedRoomId] = useState("");
    const [templaterSelectedRoomIds, setTemplaterSelectedRoomIds] = useState([]);
    const [templaterEditRoomId, setTemplaterEditRoomId] = useState("");
    const [templaterEditRoomValue, setTemplaterEditRoomValue] = useState("");
    const [templaterCatalogDeckId, setTemplaterCatalogDeckId] = useState("");
    const [templaterCatalogRoomType, setTemplaterCatalogRoomType] = useState("");
    const [templaterRoomTypeDefault, setTemplaterRoomTypeDefault] = useState("");
    const [templaterRoomDeckDefault, setTemplaterRoomDeckDefault] = useState("");
    const [templaterGeneratedFilter, setTemplaterGeneratedFilter] = useState("");
    const templaterPrefsKey = "epic3d.templaterWizard.v1";
    const templaterFinalKey = "epic3d.templaterFinal.v1";
    const templaterPendingKey = "epic3d.templaterPending.v1";
    const [templaterLegendView, setTemplaterLegendView] = useState(false);
    const [templaterFinalRooms, setTemplaterFinalRooms] = useState([]);
    const [templaterSetupDialog, setTemplaterSetupDialog] = useState(false);
    const [templaterSetups, setTemplaterSetups] = useState([]);
    const [templaterSetupName, setTemplaterSetupName] = useState("");
    const [templaterSetupEditId, setTemplaterSetupEditId] = useState("");
    const [templaterSetupItems, setTemplaterSetupItems] = useState({});
    const [templaterApplySetup, setTemplaterApplySetup] = useState(null);
    const [templaterApplyClear, setTemplaterApplyClear] = useState(false);
    const [templaterApplyFilter, setTemplaterApplyFilter] = useState("");
    const templaterSetupsKey = "epic3d.templaterSetups.v1";
    const [templaterHoverShape, setTemplaterHoverShape] = useState("");
    const [templaterDeleteDialog, setTemplaterDeleteDialog] = useState(null);
    const [roomTemplateDialog, setRoomTemplateDialog] = useState(null);

    const reshaperShapes = useMemo(
        () => [
            { value: "sphere", label: "Sphere" },
            { value: "box", label: "Box" },
            { value: "cylinder", label: "Cylinder" },
            { value: "cone", label: "Cone" },
            { value: "disc", label: "Disc" },
            { value: "hexagon", label: "Hexagon" },
            { value: "switch", label: "Switch" },
            { value: "tv", label: "TV" },
            { value: "remote", label: "Remote" },
            { value: "accesspoint", label: "Access Point" },
            { value: "laviebox", label: "LAVIE Box" },
            { value: "amplifier", label: "Amplifier" },
            { value: "ipad", label: "iPad" },
            { value: "speaker", label: "Speaker Ceiling" },
            { value: "speakerfloor", label: "Speaker Ground" },
            { value: "soundbar", label: "Soundbar" },
            { value: "headphones", label: "Headphones" },
            { value: "subwoofer", label: "Subwoofer" },
            { value: "subwoofer", label: "Subwoofer" },
            { value: "transmitter", label: "Transmitter" },
            { value: "receiver", label: "Receiver" },
            { value: "mediahub", label: "Media Hub" },
            { value: "lansocket", label: "LAN Socket" },
        ],
        [],
    );

    const clusterOptions = useMemo(() => {
        const set = new Set(DEFAULT_CLUSTERS || []);
        (nodes || []).forEach((n) => {
            const c = String(n?.cluster || "").trim();
            if (c) set.add(c);
        });
        return Array.from(set).map((c) => ({ value: c, label: c }));
    }, [nodes]);
    const [selectShape, setSelectShape] = useState("sphere");
    const [selectCluster, setSelectCluster] = useState(() => (DEFAULT_CLUSTERS && DEFAULT_CLUSTERS[0]) || "AV");
    const [legendFilter, setLegendFilter] = useState("");
    const [shapeSearch, setShapeSearch] = useState("");
    const [shapeHoverPreview, setShapeHoverPreview] = useState(null);
    const [shiftDown, setShiftDown] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [editValue, setEditValue] = useState("");
    const [roomMasterQuery, setRoomMasterQuery] = useState({});
    const [roomMasterOpenId, setRoomMasterOpenId] = useState("");
    const roomMasterAnchorRef = useRef({});
    const [contextMenu, setContextMenu] = useState(null);
    const [reassignDialog, setReassignDialog] = useState(null);
    const [reassignRoomInput, setReassignRoomInput] = useState("");
    const [reassignDeckInput, setReassignDeckInput] = useState("");
    const [deleteDeckDialog, setDeleteDeckDialog] = useState(null);
    const [legendFiltersOpen, setLegendFiltersOpen] = useState(false);
    const [legendShapeFilters, setLegendShapeFilters] = useState([]);
    const [legendClusterFilters, setLegendClusterFilters] = useState([]);
    const [legendFilterMenuPos, setLegendFilterMenuPos] = useState(null);
    const legendFilterBtnRef = useRef(null);
    const [legendShowDecks, setLegendShowDecks] = useState(true);
    const [legendGroupView, setLegendGroupView] = useState(false);
    const [reshapeDialog, setReshapeDialog] = useState(null);
    const [reshapeShape, setReshapeShape] = useState("sphere");
    const [reshapeCluster, setReshapeCluster] = useState("");
    const [roomClipboard, setRoomClipboard] = useState(null);
    const [pasteDialog, setPasteDialog] = useState(null);
    const [roomScaleDialog, setRoomScaleDialog] = useState(null);
    const [roomScaleXYZ, setRoomScaleXYZ] = useState([1, 1, 1]);
    const [selectorDialog, setSelectorDialog] = useState(null);
    const [selectorTarget, setSelectorTarget] = useState("nodes");
    const [selectorShape, setSelectorShape] = useState("");
    const [selectorCluster, setSelectorCluster] = useState("");
    const [selectorDimMode, setSelectorDimMode] = useState("none");
    const [selectorDimXYZ, setSelectorDimXYZ] = useState([1, 1, 1]);
    const [selectorDimNodeId, setSelectorDimNodeId] = useState("");
    const [selectorRoomFilter, setSelectorRoomFilter] = useState("");
    const [selectorDeckFilter, setSelectorDeckFilter] = useState("");
    const [selectorGroupFilter, setSelectorGroupFilter] = useState("");
    const [selectorSelectedRooms, setSelectorSelectedRooms] = useState([]);
    const [selectorSelectedDecks, setSelectorSelectedDecks] = useState([]);
    const [selectorSelectedGroups, setSelectorSelectedGroups] = useState([]);
    const [selectorCreateGroup, setSelectorCreateGroup] = useState(false);
    const [selectorGroupName, setSelectorGroupName] = useState("");
    const [reshaperDialogOpen, setReshaperDialogOpen] = useState(false);
    const [tileDefaults, setTileDefaults] = useState(() => {
        try {
            const raw = localStorage.getItem("epic3d.tileDefaults.v1");
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    });
    const defaultsImportRef = useRef(null);
    const [tileDialog, setTileDialog] = useState(null);
    const [tileDragOverIdx, setTileDragOverIdx] = useState(null);
    const [tileBehaviorDialog, setTileBehaviorDialog] = useState(null);
    const tileBehaviorPreviewIdRef = useRef(null);
    const [simulateDialog, setSimulateDialog] = useState(null);
    const simPreviewIdsRef = useRef({ nodes: [], links: [] });
    const simPreviewSigRef = useRef("");
    const simPreviewTimerRef = useRef(null);
    const simulatePrefsKey = "epic3d.simulateRoomPrefs.v1";
    const simulatePresetsKey = "epic3d.simulatePresets.v1";
    const simulateDefaultKey = "epic3d.simulateDefault.v1";
    const [simulatePresets, setSimulatePresets] = useState(() => {
        try {
            const raw = localStorage.getItem(simulatePresetsKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    });
    const [defaultSimId, setDefaultSimId] = useState(() => {
        try {
            const raw = localStorage.getItem(simulateDefaultKey);
            if (!raw) return "";
            const parsed = JSON.parse(raw);
            return parsed?.id || "";
        } catch {
            return "";
        }
    });
    const [defaultSimEnabled, setDefaultSimEnabled] = useState(() => {
        try {
            const raw = localStorage.getItem(simulateDefaultKey);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            return !!parsed?.enabled;
        } catch {
            return false;
        }
    });
    const [simulatePresetName, setSimulatePresetName] = useState("");
    const readSimulatePrefs = () => {
        try {
            const raw = localStorage.getItem(simulatePrefsKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    };
    const tileDialogPrefsKey = "epic3d.tileDialogPrefs.v1";
    const readTileDialogPrefs = () => {
        try {
            const raw = localStorage.getItem(tileDialogPrefsKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    };
    const tilePreviewIdRef = useRef(null);
    const tilePreviewVisRef = useRef(new Map());
    const tilePreviewRoomRef = useRef(null);
    const [reshaperTargetShape, setReshaperTargetShape] = useState("");
    const [reshaperOnlyDims, setReshaperOnlyDims] = useState(false);
    const [reshaperDims, setReshaperDims] = useState([1, 1, 1]);
    const [reshaperToShape, setReshaperToShape] = useState("");
    const [reshaperCustom, setReshaperCustom] = useState(false);
    const [reshaperScale, setReshaperScale] = useState(1);
    const [reshaperColor, setReshaperColor] = useState("");
    const [reshaperConfirm, setReshaperConfirm] = useState(null);
    const roomTypeOptions = useMemo(
        () => ["Owner", "Guest", "Crew", "Rack Room"],
        [],
    );

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const onKeyDown = (e) => {
            if (e.key === "Shift") setShiftDown(true);
        };
        const onKeyUp = (e) => {
            if (e.key === "Shift") setShiftDown(false);
        };
        const onBlur = () => setShiftDown(false);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onDown = (e) => {
            if (!roomMasterOpenId) return;
            const anchors = roomMasterAnchorRef.current?.[roomMasterOpenId];
            if (!anchors) {
                setRoomMasterOpenId("");
                return;
            }
            const { left, top, right, bottom } = anchors;
            const x = e.clientX;
            const y = e.clientY;
            const inAnchor = x >= left && x <= right && y >= top && y <= bottom;
            if (!inAnchor) {
                setRoomMasterOpenId("");
            }
        };
        window.addEventListener("mousedown", onDown);
        return () => window.removeEventListener("mousedown", onDown);
    }, [roomMasterOpenId]);

    useEffect(() => {
        if (!legendFiltersOpen) {
            setLegendFilterMenuPos(null);
            return;
        }
        if (typeof window === "undefined") return;
        const pane = leftColRef?.current?.getBoundingClientRect?.();
        const btn = legendFilterBtnRef.current?.getBoundingClientRect?.();
        if (!pane || !btn) return;
        const left = pane.left + 8;
        const top = btn.bottom + 6;
        const width = Math.max(240, pane.width - 16);
        const maxHeight = Math.max(200, Math.min(pane.height - (top - pane.top) - 16, window.innerHeight - top - 16));
        setLegendFilterMenuPos({ left, top, width, maxHeight });
    }, [legendFiltersOpen, leftColRef]);

    const getShapeType = (shape) => String(shape?.type || "sphere").toLowerCase();
    const multiPlacementActive = shiftDown && placement?.armed && (placement?.placeKind === "node" || placement?.placeKind === "switch");
    const mirrorRoomEnabled = placement?.armed && placement?.placeKind === "room" && (placement?.roomDrawMode || "box") === "points";
    const focusTarget = (target, radius) => {
        if (typeof window === "undefined") return;
        if (!Array.isArray(target) || target.length < 3) return;
        window.dispatchEvent(new CustomEvent("EPIC3D_CAMERA_FOCUS", { detail: { target, radius } }));
    };
    const focusFromPoints = (points, pad = 2) => {
        if (!points?.length) return;
        let minX = Infinity; let minY = Infinity; let minZ = Infinity;
        let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
        points.forEach((p) => {
            if (!Array.isArray(p) || p.length < 3) return;
            minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
            minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
            minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
        });
        if (!Number.isFinite(minX)) return;
        const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
        const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.6 + pad;
        focusTarget(center, radius);
    };

    const startEdit = (type, id, label) => {
        setEditTarget({ type, id });
        setEditValue(String(label || "").trim());
    };

    const commitEdit = () => {
        if (!editTarget) return;
        const next = String(editValue || "").trim();
        if (editTarget.type === "node" && setNodeById) {
            setNodeById(editTarget.id, { label: next });
        }
        if (editTarget.type === "room" && setRooms) {
            setRooms((prev) => (prev || []).map((r) => (r.id === editTarget.id ? { ...r, name: next } : r)));
        }
        if (editTarget.type === "deck" && setDecks) {
            setDecks((prev) => (prev || []).map((d) => (d.id === editTarget.id ? { ...d, name: next } : d)));
        }
        setEditTarget(null);
    };

    const cancelEdit = () => {
        setEditTarget(null);
        setEditValue("");
    };

    const selectedNodeIds = new Set([
        ...(Array.isArray(multiSel) ? multiSel.filter((it) => it?.type === "node" && it.id).map((it) => it.id) : []),
        ...(selected?.type === "node" && selected.id ? [selected.id] : []),
    ]);
    const selectedRoomId = selected?.type === "room" ? selected.id : null;
    const selectedDeckId = selected?.type === "deck" ? selected.id : null;
    const selectedDeckIds = useMemo(() => {
        const ids = new Set();
        if (selectedDeckId) ids.add(selectedDeckId);
        (Array.isArray(multiSel) ? multiSel : []).forEach((it) => {
            if (it?.type === "deck" && it.id) ids.add(it.id);
        });
        return ids;
    }, [selectedDeckId, multiSel]);
    const legendShapeOptions = useMemo(() => {
        const set = new Set();
        (nodes || []).forEach((n) => {
            const t = String(n?.shape?.type || "sphere").toLowerCase();
            if (t) set.add(t);
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [nodes]);
    const legendClusterOptions = useMemo(() => {
        const set = new Set();
        (nodes || []).forEach((n) => {
            const c = String(n?.cluster || "").trim();
            if (c) set.add(c);
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [nodes]);
    const roomOptions = useMemo(() => {
        const list = (rooms || []).map((r) => ({
            id: r.id,
            label: r.name || r.label || r.id,
        }));
        return list.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" }));
    }, [rooms]);
    const deckOptions = useMemo(() => {
        const list = (decks || []).map((d) => ({
            id: d.id,
            label: d.name || d.label || d.id,
        }));
        return list.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" }));
    }, [decks]);

    const resolveRoomId = (input) => {
        const raw = String(input || "").trim();
        if (!raw) return null;
        if (["none", "unassigned", "null", "clear"].includes(raw.toLowerCase())) return null;
        const byId = (rooms || []).find((r) => String(r?.id) === raw);
        if (byId) return byId.id;
        const byName = (rooms || []).find((r) => String(r?.name || r?.label || "").toLowerCase() === raw.toLowerCase());
        return byName ? byName.id : raw;
    };

    const resolveDeckId = (input) => {
        const raw = String(input || "").trim();
        if (!raw) return null;
        if (["none", "unassigned", "null", "clear"].includes(raw.toLowerCase())) return null;
        const byId = (decks || []).find((d) => String(d?.id) === raw);
        if (byId) return byId.id;
        const byName = (decks || []).find((d) => String(d?.name || d?.label || "").toLowerCase() === raw.toLowerCase());
        return byName ? byName.id : raw;
    };

    const applyNodeReassign = (nodeIds, roomInput, deckInput) => {
        if (!nodeIds || !nodeIds.length) return;
        const roomId = resolveRoomId(roomInput);
        const deckProvided = String(deckInput || "").trim().length > 0;
        let deckId = resolveDeckId(deckInput);
        if (!deckProvided && roomId) {
            const room = (rooms || []).find((r) => r.id === roomId);
            if (room?.deckId) deckId = room.deckId;
        }
        nodeIds.forEach((id) => {
            const patch = { roomId: roomId || null };
            if (deckProvided || roomId) patch.deckId = deckId;
            setNodeById?.(id, patch);
        });
    };

    const applyRoomReassign = (roomIds, deckInput) => {
        if (!roomIds || !roomIds.length) return;
        const deckProvided = String(deckInput || "").trim().length > 0;
        const deckId = resolveDeckId(deckInput);
        if (!deckProvided && deckId == null) return;
        if (!setRooms) return;
        setRooms((prev) => (prev || []).map((room) => {
            if (!roomIds.includes(room.id)) return room;
            return { ...room, deckId: deckId || null };
        }));
    };

    const openContextMenu = (e, payload) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, ...payload });
    };

    const [deckLayerDialog, setDeckLayerDialog] = useState(null);
    const [deckLayerPreview, setDeckLayerPreview] = useState(false);
    const [deckLayerSpacing, setDeckLayerSpacing] = useState(2);
    const [deckLayerOrder, setDeckLayerOrder] = useState([]);
    const [deckLayerDragId, setDeckLayerDragId] = useState(null);
    const deckLayerSnapshotRef = useRef(null);

    const openDeckLayerDialog = (ids) => {
        if (!ids || ids.length < 2) return;
        const ordered = ids.slice();
        setDeckLayerOrder(ordered);
        setDeckLayerSpacing(2);
        setDeckLayerPreview(false);
        deckLayerSnapshotRef.current = null;
        setDeckLayerDialog({ ids: ordered });
    };

    const restoreDeckLayering = () => {
        const snapshot = deckLayerSnapshotRef.current;
        if (!snapshot) return;
        const { rooms: roomPositions, nodes: nodePositions } = snapshot;
        if (setRooms) {
            setRooms((prev) => (prev || []).map((r) => {
                if (!r?.id || !roomPositions.has(r.id)) return r;
                return { ...r, center: roomPositions.get(r.id) };
            }));
        }
        nodePositions.forEach((pos, id) => {
            setNodeById?.(id, { position: pos });
        });
        deckLayerSnapshotRef.current = null;
    };

    const captureDeckLayering = (ids) => {
        if (deckLayerSnapshotRef.current) return;
        const roomPositions = new Map();
        (rooms || []).forEach((r) => {
            if (!r?.deckId || !ids.includes(r.deckId)) return;
            roomPositions.set(r.id, [r.center?.[0] ?? 0, r.center?.[1] ?? 0, r.center?.[2] ?? 0]);
        });
        const nodePositions = new Map();
        (nodes || []).forEach((n) => {
            const deckId = n.deckId || (n.roomId && (rooms || []).find((r) => r.id === n.roomId)?.deckId);
            if (!deckId || !ids.includes(deckId)) return;
            nodePositions.set(n.id, [n.position?.[0] ?? 0, n.position?.[1] ?? 0, n.position?.[2] ?? 0]);
        });
        deckLayerSnapshotRef.current = { rooms: roomPositions, nodes: nodePositions };
    };

    const computeDeckLayerTargets = (ids, spacing) => {
        const roomById = new Map((rooms || []).map((r) => [r.id, r]));
        const nodesList = nodes || [];
        const deckBounds = new Map();
        const getBounds = (deckId) => {
            if (deckBounds.has(deckId)) return deckBounds.get(deckId);
            let minY = Infinity;
            let maxY = -Infinity;
            let minX = Infinity;
            let maxX = -Infinity;
            let minZ = Infinity;
            let maxZ = -Infinity;
            (rooms || []).forEach((r) => {
                if (r.deckId !== deckId) return;
                const size = r.size || [1, 1, 1];
                const centerY = Number(r.center?.[1] ?? 0);
                const centerX = Number(r.center?.[0] ?? 0);
                const centerZ = Number(r.center?.[2] ?? 0);
                const halfY = (Number(size[1]) || 0) * 0.5;
                const halfX = (Number(size[0]) || 0) * 0.5;
                const halfZ = (Number(size[2]) || 0) * 0.5;
                const floorY = centerY - halfY;
                const ceilY = centerY + halfY;
                minY = Math.min(minY, floorY);
                maxY = Math.max(maxY, ceilY);
                minX = Math.min(minX, centerX - halfX);
                maxX = Math.max(maxX, centerX + halfX);
                minZ = Math.min(minZ, centerZ - halfZ);
                maxZ = Math.max(maxZ, centerZ + halfZ);
            });
            nodesList.forEach((n) => {
                const inDeck = n.deckId === deckId || (n.roomId && roomById.get(n.roomId)?.deckId === deckId);
                if (!inDeck) return;
                const x = Number(n.position?.[0] ?? 0);
                const y = Number(n.position?.[1] ?? 0);
                const z = Number(n.position?.[2] ?? 0);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minZ = Math.min(minZ, z);
                maxZ = Math.max(maxZ, z);
            });
            if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
                minY = 0;
                maxY = 0;
            }
            if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
                minX = 0;
                maxX = 0;
            }
            if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
                minZ = 0;
                maxZ = 0;
            }
            const height = Math.max(0.1, maxY - minY);
            const centerX = (minX + maxX) * 0.5;
            const centerZ = (minZ + maxZ) * 0.5;
            const out = { minY, maxY, height, centerX, centerZ };
            deckBounds.set(deckId, out);
            return out;
        };

        const targetById = new Map();
        let prevTop = null;
        const baseBounds = getBounds(ids[0]);
        const baseX = baseBounds.centerX;
        const baseZ = baseBounds.centerZ;
        ids.forEach((id, idx) => {
            const bounds = getBounds(id);
            if (idx === 0) {
                targetById.set(id, {
                    y: bounds.minY,
                    dx: baseX - bounds.centerX,
                    dz: baseZ - bounds.centerZ,
                    baseMinY: bounds.minY,
                    height: bounds.height,
                });
                prevTop = bounds.minY + bounds.height;
                return;
            }
            const targetMin = (prevTop ?? bounds.minY) + spacing;
            targetById.set(id, {
                y: targetMin,
                dx: baseX - bounds.centerX,
                dz: baseZ - bounds.centerZ,
                baseMinY: bounds.minY,
                height: bounds.height,
            });
            prevTop = targetMin + bounds.height;
        });
        return targetById;
    };

    const applyDeckLayering = ({ preview = false } = {}) => {
        if (!deckLayerDialog?.ids?.length) return;
        const ids = deckLayerOrder.length ? deckLayerOrder.slice() : deckLayerDialog.ids.slice();
        const spacing = Number(deckLayerSpacing) || 0;
        const roomById = new Map((rooms || []).map((r) => [r.id, r]));
        const targetById = computeDeckLayerTargets(ids, spacing);

        if (setRooms) {
            setRooms((prev) => (prev || []).map((r) => {
                if (!r?.deckId || !targetById.has(r.deckId)) return r;
                const size = r.size || [1, 1, 1];
                const floorY = (r.center?.[1] ?? 0) - (Number(size[1]) || 0) * 0.5;
                const target = targetById.get(r.deckId);
                const delta = target.y - floorY;
                return {
                    ...r,
                    center: [
                        (r.center?.[0] ?? 0) + target.dx,
                        (r.center?.[1] ?? 0) + delta,
                        (r.center?.[2] ?? 0) + target.dz,
                    ],
                };
            }));
        }

        nodesList.forEach((n) => {
            const deckId = n.deckId || (n.roomId && roomById.get(n.roomId)?.deckId);
            if (!deckId || !targetById.has(deckId)) return;
            const target = targetById.get(deckId);
            const currentY = Number(n.position?.[1] ?? 0);
            const deltaY = target.y - (target.baseMinY ?? 0);
            const dx = target.dx;
            const dz = target.dz;
            if (Math.abs(deltaY) < 1e-6 && Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return;
            setNodeById?.(n.id, {
                position: [
                    (n.position?.[0] ?? 0) + dx,
                    currentY + deltaY,
                    (n.position?.[2] ?? 0) + dz,
                ],
            });
        });

        if (!preview) {
            deckLayerSnapshotRef.current = null;
            setDeckLayerDialog(null);
        }
    };

    const openReassignDialog = (type, ids) => {
        if (!ids || !ids.length) return;
        setContextMenu(null);
        const firstId = ids[0];
        if (type === "node") {
            const node = (nodes || []).find((n) => n.id === firstId);
            const room = node?.roomId ? (rooms || []).find((r) => r.id === node.roomId) : null;
            const deckId = node?.deckId || room?.deckId || null;
            const deck = deckId ? (decks || []).find((d) => d.id === deckId) : null;
            setReassignRoomInput(room?.name || room?.label || room?.id || "");
            setReassignDeckInput(deck?.name || deck?.label || deck?.id || "");
        } else {
            const room = (rooms || []).find((r) => r.id === firstId);
            const deckId = room?.deckId || null;
            const deck = deckId ? (decks || []).find((d) => d.id === deckId) : null;
            setReassignRoomInput("");
            setReassignDeckInput(deck?.name || deck?.label || deck?.id || "");
        }
        setReassignDialog({ type, ids });
    };

    const handleDuplicate = (type, ids) => {
        setContextMenu(null);
        if (!ids || !ids.length) return;
        if (type === "room" && typeof duplicateRoom === "function") {
            ids.forEach((id) => duplicateRoom(id));
        }
        if (type === "node" && typeof duplicateNode === "function") {
            ids.forEach((id) => duplicateNode(id));
        }
    };

    const openReshapeDialog = (ids) => {
        if (!ids || !ids.length) return;
        const first = (nodes || []).find((n) => n.id === ids[0]);
        const shape = String(first?.shape?.type || "sphere").toLowerCase();
        const cluster = String(first?.cluster || "").trim();
        setReshapeShape(shape);
        setReshapeCluster(cluster);
        setReshapeDialog({ ids });
    };

    const applyReshape = (ids, shape, cluster) => {
        if (!ids || !ids.length) return;
        ids.forEach((id) => {
            setNodeById?.(id, (cur) => {
                const nextShape = buildShape(shape, cur?.shape);
                const next = { shape: nextShape };
                if (cluster !== undefined) next.cluster = cluster;
                return next;
            });
        });
    };

    const copyRoomContents = (roomId) => {
        if (!roomId) return;
        const count = (nodes || []).filter((n) => n.roomId === roomId).length;
        setRoomClipboard({ roomId, count });
    };

    const pasteRoomContents = (targetRoomId) => {
        if (!roomClipboard?.roomId || !targetRoomId) return;
        copyRoomNodesToRoom?.(roomClipboard.roomId, targetRoomId);
    };

    const replaceRoomContents = (targetRoomId) => {
        if (!roomClipboard?.roomId || !targetRoomId) return;
        const removeIds = new Set((nodes || []).filter((n) => n.roomId === targetRoomId).map((n) => n.id));
        if (removeIds.size > 0) {
            setNodes?.((prev) => (prev || []).filter((n) => !removeIds.has(n.id)));
            setLinks?.((prev) => (prev || []).filter((l) => !removeIds.has(l.from) && !removeIds.has(l.to)));
        }
        copyRoomNodesToRoom?.(roomClipboard.roomId, targetRoomId);
    };

    const openRoomScaleDialog = (roomId) => {
        if (!roomId) return;
        const room = (rooms || []).find((r) => r.id === roomId);
        const size = Array.isArray(room?.size) ? room.size : [3, 1.6, 2.2];
        setRoomScaleXYZ([1, 1, 1]);
        setRoomScaleDialog({ roomId, baseSize: size });
    };

    const applyRoomScale = (roomId, scale) => {
        if (!roomId || !setRooms) return;
        const sx = Number(scale?.[0]) || 1;
        const sy = Number(scale?.[1]) || 1;
        const sz = Number(scale?.[2]) || 1;
        setRooms((prev) => (prev || []).map((r) => {
            if (r.id !== roomId) return r;
            const size = Array.isArray(r.size) ? r.size : [3, 1.6, 2.2];
            return { ...r, size: [size[0] * sx, size[1] * sy, size[2] * sz] };
        }));
    };

    const getNodeDims = (n) => {
        const shape = n?.shape || {};
        const t = String(shape.type || "sphere").toLowerCase();
        if (t === "sphere") {
            const r = Number(shape.radius ?? 0.32) || 0.32;
            return [r * 2, r * 2, r * 2];
        }
        if (t === "box" || t === "square") {
            const s = Array.isArray(shape.scale) ? shape.scale : [0.6, 0.3, 0.6];
            return [Number(s[0]) || 0.6, Number(s[1]) || 0.3, Number(s[2]) || 0.6];
        }
        if (t === "cylinder" || t === "cone" || t === "disc" || t === "circle" || t === "hexagon") {
            const r = Number(shape.radius ?? 0.28) || 0.28;
            const h = Number(shape.height ?? 0.6) || 0.6;
            return [r * 2, h, r * 2];
        }
        if (t === "switch") {
            return [Number(shape.w ?? 1.1) || 1.1, Number(shape.h ?? 0.12) || 0.12, Number(shape.d ?? 0.35) || 0.35];
        }
        if (t === "tv") {
            return [Number(shape.w ?? 1.2) || 1.2, Number(shape.h ?? 0.7) || 0.7, Number(shape.d ?? 0.08) || 0.08];
        }
        if (t === "remote") {
            return [Number(shape.w ?? 0.16) || 0.16, Number(shape.h ?? 0.55) || 0.55, Number(shape.d ?? 0.05) || 0.05];
        }
        return [1, 1, 1];
    };

    const applySelector = () => {
        const next = [];
        if (selectorTarget === "nodes") {
            const shapeFilter = String(selectorShape || "").toLowerCase();
            const clusterFilter = String(selectorCluster || "").toLowerCase();
            let targetDims = null;
            if (selectorDimMode === "manual") {
                targetDims = selectorDimXYZ.map((v) => Number(v) || 0);
            } else if (selectorDimMode === "from-node" && selectorDimNodeId) {
                const refNode = (nodes || []).find((n) => n.id === selectorDimNodeId);
                if (refNode) targetDims = getNodeDims(refNode);
            }
            const tol = 0.001;
            (nodes || []).forEach((n) => {
                const t = String(n?.shape?.type || "sphere").toLowerCase();
                const c = String(n?.cluster || "").toLowerCase();
                if (shapeFilter && t !== shapeFilter) return;
                if (clusterFilter && c !== clusterFilter) return;
                if (targetDims) {
                    const d = getNodeDims(n);
                    if (Math.abs(d[0] - targetDims[0]) > tol ||
                        Math.abs(d[1] - targetDims[1]) > tol ||
                        Math.abs(d[2] - targetDims[2]) > tol) return;
                }
                next.push({ type: "node", id: n.id });
            });
        } else if (selectorTarget === "rooms") {
            selectorSelectedRooms.forEach((id) => next.push({ type: "room", id }));
        } else if (selectorTarget === "decks") {
            selectorSelectedDecks.forEach((id) => next.push({ type: "deck", id }));
        } else if (selectorTarget === "groups") {
            selectorSelectedGroups.forEach((id) => next.push({ type: "group", id }));
        }

        if (next.length) {
            setMultiSel?.(next);
            setSelected?.(next[0]);
            setMoveMode?.(true);
            setTransformMode?.("translate");
        } else {
            setMultiSel?.([]);
            setSelected?.(null);
        }

        if (selectorCreateGroup && next.length && setGroups) {
            const newId =
                (typeof crypto !== "undefined" && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const name = String(selectorGroupName || "").trim() || `Group ${new Date().getHours()}:${new Date().getMinutes()}`;
            setGroups((prev) => [...(prev || []), { id: newId, name, hidden: false, hideRooms: false }]);
            setRooms?.((prev) => (prev || []).map((r) => (next.some((it) => it.type === "room" && it.id === r.id) ? { ...r, groupId: newId } : r)));
            setNodes?.((prev) => (prev || []).map((n) => (next.some((it) => it.type === "node" && it.id === n.id) ? { ...n, groupId: newId } : n)));
        }
    };

    const deleteDeck = (deckId) => {
        if (!deckId || !setDecks) return;
        setRooms?.((prev) => (prev || []).map((r) => (r.deckId === deckId ? { ...r, deckId: null } : r)));
        (nodes || []).forEach((n) => {
            if (n.deckId === deckId) {
                setNodeById?.(n.id, { deckId: null });
            }
        });
        setDecks((prev) => (prev || []).filter((d) => d.id !== deckId));
    };

    const advancedShapeDefaults = useMemo(
        () => getAdvancedShapeDefaults(lavieRefDimsProp),
        [lavieRefDimsProp],
    );

    const buildShape = (type, prev) => {
        const t = String(type || "sphere").toLowerCase();
        const base = prev && typeof prev === "object" ? { ...prev } : {};
        if (advancedShapeDefaults[t]) {
            return { ...advancedShapeDefaults[t], ...base, type: advancedShapeDefaults[t].type };
        }
        if (t.startsWith("model:")) return { type: "model", id: t.slice(6) };
        if (t === "sphere") return { type: "sphere", radius: base.radius ?? 0.32 };
        if (t === "box") return { type: "box", scale: base.scale ?? [0.6, 0.3, 0.6] };
        if (t === "cylinder") return { type: "cylinder", radius: base.radius ?? 0.28, height: base.height ?? 0.6 };
        if (t === "cone") return { type: "cone", radius: base.radius ?? 0.28, height: base.height ?? 0.7 };
        if (t === "disc") return { type: "disc", radius: base.radius ?? 0.3, height: base.height ?? 0.08 };
        if (t === "hexagon") return { type: "hexagon", radius: base.radius ?? 0.3, height: base.height ?? 0.5 };
        if (t === "switch") return { type: "switch", w: base.w ?? 1.1, h: base.h ?? 0.12, d: base.d ?? 0.35 };
        if (t === "tv") return { type: "tv", w: base.w ?? 1.2, h: base.h ?? 0.7, d: base.d ?? 0.08 };
        if (t === "remote") return { type: "remote", w: base.w ?? 0.16, h: base.h ?? 0.55, d: base.d ?? 0.05 };
        if (t === "accesspoint") return { type: "accesspoint", radius: base.radius ?? 0.35, height: base.height ?? 0.12 };
        if (t === "laviebox") return {
            type: "laviebox",
            w: base.w ?? lavieRefDimsProp?.w ?? 0.8,
            h: base.h ?? lavieRefDimsProp?.h ?? 0.4,
            d: base.d ?? lavieRefDimsProp?.d ?? 0.35,
        };
        if (t === "amplifier") return { type: "amplifier", w: base.w ?? 0.8, d: base.d ?? 0.4, baseH: base.baseH ?? 0.18 };
        if (t === "ipad") return { type: "ipad", w: base.w ?? 0.5, h: base.h ?? 0.7, d: base.d ?? 0.03 };
        if (t === "speaker") return { type: "speaker", w: base.w ?? 0.6, h: base.h ?? 0.9, d: base.d ?? 0.25, orientation: "ceiling" };
        if (t === "speakerfloor") return { type: "speakerfloor", w: base.w ?? 0.38, h: base.h ?? 0.8, d: base.d ?? 0.26 };
        if (t === "soundbar") return { type: "soundbar", w: base.w ?? 1.2, h: base.h ?? 0.18, d: base.d ?? 0.16 };
        if (t === "headphones") return { type: "headphones", w: base.w ?? 0.9, h: base.h ?? 0.75, d: base.d ?? 0.28 };
        if (t === "subwoofer") return { type: "subwoofer", w: base.w ?? 0.7, h: base.h ?? 0.7, d: base.d ?? 0.5 };
        if (t === "rack") return { type: "rack", w: base.w ?? 0.6, h: base.h ?? 1.8, d: base.d ?? 0.6, bar: base.bar ?? 0.04, rail: base.rail ?? 0.03, slotH: base.slotH ?? 0.25 };
        return { type: t };
    };

    const getShapeDims = (shape) => {
        const type = getShapeType(shape);
        let dims = null;
        if (type === "sphere") {
            const r = Number(shape?.radius ?? 0.32);
            dims = { w: r * 2, h: r * 2, d: r * 2 };
        } else if (type === "cylinder" || type === "cone" || type === "disc" || type === "hexagon" || type === "accesspoint") {
            const r = Number(shape?.radius ?? 0.3);
            const h = Number(shape?.height ?? 0.6);
            dims = { w: r * 2, h, d: r * 2 };
        } else if (type === "box") {
            const s = Array.isArray(shape?.scale) ? shape.scale : [0.6, 0.3, 0.6];
            dims = { w: Number(s[0]) || 0.6, h: Number(s[1]) || 0.3, d: Number(s[2]) || 0.6 };
        } else if (type === "switch" || type === "tv" || type === "remote" || type === "laviebox" || type === "speaker" || type === "speakerfloor" || type === "soundbar" || type === "headphones" || type === "subwoofer" || type === "ipad") {
            dims = { w: Number(shape?.w ?? 0.6), h: Number(shape?.h ?? 0.3), d: Number(shape?.d ?? 0.3) };
        } else if (type === "amplifier") {
            dims = { w: Number(shape?.w ?? 0.8), h: Number(shape?.baseH ?? 0.18), d: Number(shape?.d ?? 0.4) };
        }
        if (!dims) return null;
        const scale = shape?.scale;
        if (Array.isArray(scale)) {
            const sx = Number(scale[0]) || 1;
            const sy = Number(scale[1]) || 1;
            const sz = Number(scale[2]) || 1;
            return { w: dims.w * sx, h: dims.h * sy, d: dims.d * sz };
        }
        if (Number.isFinite(scale)) {
            const s = Number(scale);
            return { w: dims.w * s, h: dims.h * s, d: dims.d * s };
        }
        return dims;
    };

    const applyDimsToShape = (type, shape, dims) => {
        const t = String(type || "").toLowerCase();
        const next = { ...(shape || {}) };
        if (!dims) return next;
        if (t === "sphere") {
            const r = Math.max(0.01, Number(dims.w ?? dims.h ?? dims.d) / 2);
            next.radius = r;
            return next;
        }
        if (t === "cylinder" || t === "cone" || t === "disc" || t === "hexagon" || t === "accesspoint") {
            const r = Math.max(0.01, Number(dims.w ?? dims.d) / 2);
            next.radius = r;
            if (Number.isFinite(dims.h)) next.height = Math.max(0.01, Number(dims.h));
            return next;
        }
        if (t === "box") {
            next.scale = [
                Math.max(0.01, Number(dims.w ?? 0.6)),
                Math.max(0.01, Number(dims.h ?? 0.3)),
                Math.max(0.01, Number(dims.d ?? 0.6)),
            ];
            return next;
        }
        if (t === "switch" || t === "tv" || t === "remote" || t === "laviebox" || t === "speaker" || t === "speakerfloor" || t === "soundbar" || t === "headphones" || t === "subwoofer" || t === "ipad") {
            if (Number.isFinite(dims.w)) next.w = Math.max(0.01, Number(dims.w));
            if (Number.isFinite(dims.h)) next.h = Math.max(0.01, Number(dims.h));
            if (Number.isFinite(dims.d)) next.d = Math.max(0.01, Number(dims.d));
            return next;
        }
        if (t === "amplifier") {
            if (Number.isFinite(dims.w)) next.w = Math.max(0.01, Number(dims.w));
            if (Number.isFinite(dims.h)) next.baseH = Math.max(0.01, Number(dims.h));
            if (Number.isFinite(dims.d)) next.d = Math.max(0.01, Number(dims.d));
            return next;
        }
        return next;
    };

    const applyReshaperDialog = () => {
        if (!setNodes) return;
        const target = String(reshaperTargetShape || "");
        const to = String(reshaperToShape || "");
        const onlyDims = !!reshaperOnlyDims;
        const dimsFilter = {
            w: Number(reshaperDims?.[0]),
            h: Number(reshaperDims?.[1]),
            d: Number(reshaperDims?.[2]),
        };
        const tol = 0.02;
        const matchesDims = (shape) => {
            const d0 = getShapeDims(shape);
            if (!d0) return false;
            if (Number.isFinite(dimsFilter.w) && Math.abs(d0.w - dimsFilter.w) > tol) return false;
            if (Number.isFinite(dimsFilter.h) && Math.abs(d0.h - dimsFilter.h) > tol) return false;
            if (Number.isFinite(dimsFilter.d) && Math.abs(d0.d - dimsFilter.d) > tol) return false;
            return true;
        };
        const ids = (nodes || [])
            .filter((n) => {
                if (!n?.id) return false;
                if (target && getShapeKey(n.shape) !== target) return false;
                if (onlyDims && !matchesDims(n.shape)) return false;
                return true;
            })
            .map((n) => n.id);
        const count = ids.length;
        if (!count) return;
        const toLabel = shapeLabelMap.get(to) || to || "Shape";
        const fromLabel = shapeLabelMap.get(target) || target || "Any";
        setReshaperConfirm({
            count,
            fromLabel,
            toLabel,
            custom: reshaperCustom,
            dims: reshaperCustom ? {
                scale: reshaperScale,
                w: reshaperDims?.[0],
                h: reshaperDims?.[1],
                d: reshaperDims?.[2],
                color: reshaperColor,
            } : null,
            ids,
            to,
        });
    };

    const confirmReshaper = () => {
        if (!reshaperConfirm || !setNodes) return;
        const { ids, to, custom, dims } = reshaperConfirm;
        const idSet = new Set(ids || []);
        const scale = Math.max(0.01, Number(dims?.scale ?? 1));
        setNodes((prev) => (prev || []).map((n) => {
            if (!n?.id || !idSet.has(n.id)) return n;
            let nextShape = buildShape(to, n.shape);
            if (custom) {
                const baseDims = getShapeDims(nextShape) || { w: 0.6, h: 0.3, d: 0.6 };
                const w = Number.isFinite(Number(dims?.w)) ? Number(dims.w) : baseDims.w;
                const h = Number.isFinite(Number(dims?.h)) ? Number(dims.h) : baseDims.h;
                const d = Number.isFinite(Number(dims?.d)) ? Number(dims.d) : baseDims.d;
                const scaled = { w: w * scale, h: h * scale, d: d * scale };
                nextShape = applyDimsToShape(to, nextShape, scaled);
            }
            const patch = { shape: nextShape };
            if (custom && dims?.color) patch.color = dims.color;
            return { ...n, ...patch };
        }));
        setReshaperConfirm(null);
        setReshaperDialogOpen(false);
    };

    const applyTileDefaults = () => {
        if (!tileDialog?.shapeKey) return;
        const list = Array.isArray(tileDialog.tileCodes)
            ? tileDialog.tileCodes.filter((c) => String(c || "").trim())
            : [];
        const primary = list[0] || tileDialog.tileCode || "F-A1";
        setTileDefaults((prev) => ({
            ...(prev || {}),
            [tileDialog.shapeKey]: {
                tileCode: primary,
                tileCodes: list.length ? list : undefined,
                align: tileDialog.align || "center",
                rotation: Number(tileDialog.rotation || 0) || 0,
                offsetX: Number(tileDialog.offsetX ?? 0) || 0,
                offsetY: Number(tileDialog.offsetY ?? 0) || 0,
                offsetZ: Number(tileDialog.offsetZ ?? 0) || 0,
            },
        }));
    };

    const selectByShape = () => {
        if (!setMultiSel) return;
        const target = String(selectShape || "sphere").toLowerCase();
        const ids = (nodes || []).filter((n) => getShapeType(n.shape) === target).map((n) => ({ type: "node", id: n.id }));
        setMultiSel(ids);
        setSelected?.(null);
    };

    const selectByCluster = () => {
        if (!setMultiSel) return;
        const target = String(selectCluster || "").toLowerCase();
        const ids = (nodes || []).filter((n) => String(n?.cluster || "").toLowerCase() === target).map((n) => ({ type: "node", id: n.id }));
        setMultiSel(ids);
        setSelected?.(null);
    };

    const handleModelHeading = (yaw) => {
        if (!setModelRotation) return;
        const base = Array.isArray(modelRotation) ? modelRotation : [0, 0, 0];
        const next = [base[0] ?? 0, yaw ?? 0, base[2] ?? 0];
        setModelRotation(next);
    };

    const handleResizeDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = paneWidth;

        const onMove = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const dx = ev.clientX - startX;
            const vw = typeof window !== "undefined" ? window.innerWidth : 1400;
            const maxWidth = Math.min(720, vw - 80);
            const minWidth = 320;
            const next = clamp(startWidth + dx, minWidth, maxWidth);
            setPaneWidth(next);
            try {
                localStorage.setItem("epic3d.leftPaneWidth.v1", String(next));
            } catch {}
        };

        const onUp = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
    };


    // Safe HUD layout defaults
    const hud = actionsHud || {
        gridLayout: false,
        moveMode: false,
        cellSize: 90,
        rowHeight: 56,
        snapThreshold: 0.4,
    };

    const patchHud = (patch) => {
        if (!setActionsHud) return;
        setActionsHud((prev) => ({
            ...(prev || hud),
            ...patch,
        }));
    };


    // ----- Ground Grid + Floors helpers -----
    const patchGrid = (patch) => {
        if (!setGridConfig) return;
        setGridConfig((prev) => ({ ...(prev || {}), ...(patch || {}) }));
    };

    const safeNum = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const floorsManual = Array.isArray(gridConfig?.floorsManual) ? gridConfig.floorsManual : [];
    const baseShapeOptions = useMemo(
        () => [
            { value: "sphere", label: "Sphere" },
            { value: "box", label: "Box" },
            { value: "cylinder", label: "Cylinder" },
            { value: "cone", label: "Cone" },
            { value: "disc", label: "Disc" },
            { value: "hexagon", label: "Hexagon" },
            { value: "switch", label: "Switch" },
            { value: "tv", label: "TV" },
            { value: "remote", label: "Remote" },
            { value: "accesspoint", label: "Access Point" },
            { value: "laviebox", label: "LAVIE Box" },
            { value: "amplifier", label: "Amplifier" },
            { value: "ipad", label: "iPad" },
            { value: "speaker", label: "Speaker Ceiling" },
            { value: "speakerfloor", label: "Speaker Ground" },
            { value: "soundbar", label: "Soundbar" },
            { value: "headphones", label: "Headphones" },
            { value: "subwoofer", label: "Subwoofer" },
            { value: "rack", label: "Rack" },
            { value: "transmitter", label: "Transmitter" },
            { value: "receiver", label: "Receiver" },
            { value: "mediahub", label: "Media Hub" },
            { value: "lansocket", label: "LAN Socket" },
        ],
        [],
    );
    const modelShapeOptions = useMemo(
        () => (STATIC_SHAPES || []).map((s) => ({
            value: `model:${s.id}`,
            label: `Model: ${s.name}`,
        })),
        [],
    );
    const shapeOptions = useMemo(
        () => [...baseShapeOptions, ...modelShapeOptions],
        [baseShapeOptions, modelShapeOptions],
    );
    const shapePalette = useMemo(() => {
        const iconMap = {
            sphere: CircleIcon,
            box: SquareIcon,
            disc: DiscIcon,
            cylinder: CylinderIcon,
            cone: ConeIcon,
            hexagon: HexIcon,
            speaker: SpeakerIcon,
            speakerfloor: SpeakerIcon,
            soundbar: SpeakerIcon,
            headphones: SpeakerIcon,
            subwoofer: SpeakerIcon,
            rack: SquareIcon,
            switch: SquareIcon,
            tv: SquareIcon,
            remote: SquareIcon,
            accesspoint: CircleIcon,
            laviebox: SquareIcon,
            amplifier: SquareIcon,
            ipad: SquareIcon,
            transmitter: CircleIcon,
            receiver: CircleIcon,
            mediahub: SquareIcon,
            lansocket: SquareIcon,
        };
        const seen = new Set();
        return (shapeOptions || []).filter((opt) => {
            if (!opt?.value) return false;
            if (seen.has(opt.value)) return false;
            seen.add(opt.value);
            return true;
        }).map((opt) => {
            const key = opt.value;
            const Icon = iconMap[key] || SquareIcon;
            return { key, label: opt.label || key, Icon };
        });
    }, [shapeOptions]);
    const shapeLabelMap = useMemo(
        () => new Map((shapeOptions || []).map((opt) => [opt.value, opt.label])),
        [shapeOptions],
    );
    const getShapeKey = (shape) => {
        if (typeof shape === "string") return shape;
        if (shape && typeof shape === "object") {
            if (typeof shape.type === "string") {
                if (shape.type === "model" && shape.id) return `model:${shape.id}`;
                return shape.type;
            }
            if (typeof shape.id === "string") return shape.id;
        }
        return "sphere";
    };
    const shapeOptionsInUse = useMemo(() => {
        const map = new Map();
        (nodes || []).forEach((n) => {
            const key = getShapeKey(n?.shape);
            if (!map.has(key)) {
                map.set(key, shapeLabelMap.get(key) || key);
            }
        });
        return Array.from(map, ([value, label]) => ({ value, label }));
    }, [nodes, shapeLabelMap]);
    const roomBehaviorShapes = shapeOptions;
    useEffect(() => {
        if (!reshaperTargetShape && shapeOptionsInUse.length) {
            setReshaperTargetShape(shapeOptionsInUse[0]?.value || "");
        }
    }, [shapeOptionsInUse, reshaperTargetShape]);
    useEffect(() => {
        if (!reshaperToShape && shapeOptions.length) {
            setReshaperToShape(shapeOptions[0]?.value || "");
        }
    }, [shapeOptions, reshaperToShape]);
    const [rescaleMode, setRescaleMode] = useState("match");
    const [rescaleMasterId, setRescaleMasterId] = useState("");
    const [rescaleMasterFilter, setRescaleMasterFilter] = useState("");
    const [rescaleTargetShape, setRescaleTargetShape] = useState("");
    const [rescaleValue, setRescaleValue] = useState(1);
    const [copyCatMasterRoomId, setCopyCatMasterRoomId] = useState("");
    const [copyCatTargetRoomId, setCopyCatTargetRoomId] = useState("");
    const [flowAdoptMasterId, setFlowAdoptMasterId] = useState("");
    const [flowAdoptTargetId, setFlowAdoptTargetId] = useState("");
    const [flowAdoptMasterFilter, setFlowAdoptMasterFilter] = useState("");
    const [flowAdoptTargetFilter, setFlowAdoptTargetFilter] = useState("");
    const [signalBulkMode, setSignalBulkMode] = useState("disable");
    const [roomShapeRoles, setRoomShapeRoles] = useState(() => {
        try {
            const raw = localStorage.getItem("epic3d.roomShapeRoles.v1");
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    });
    const [roomBehaviorQuery, setRoomBehaviorQuery] = useState("");
    const [autoFocusSelection, setAutoFocusSelection] = useState(false);
    const [cableKindDefaults, setCableKindDefaults] = useState(() => {
        const fallback = {
            "": "#94a3b8",
            wifi: "#38bdf8",
            wired: "#94a3b8",
            poe: "#f97316",
            cat5e: "#22c55e",
            cat6: "#3b82f6",
            cat6a: "#6366f1",
            cat7: "#8b5cf6",
            speaker: "#f43f5e",
            fiber: "#eab308",
        };
        try {
            const raw = localStorage.getItem("epic3d.cableKindDefaults.v1");
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : fallback;
        } catch {
            return fallback;
        }
    });
    const getRoomRole = (key) => roomShapeRoles?.[key]?.role || "master";
    const getRoomMaster = (key) => roomShapeRoles?.[key]?.master || "";
    const getRoomLinkStyle = (key) => roomShapeRoles?.[key]?.linkStyle || "particles";
    const getRoomLinkKind = (key) => roomShapeRoles?.[key]?.linkKind || "cat6";
    const getRoomAnchorEnabled = (key) => roomShapeRoles?.[key]?.anchorEnabled === true;
    useEffect(() => {
        try {
            localStorage.setItem("epic3d.roomShapeRoles.v1", JSON.stringify(roomShapeRoles || {}));
        } catch {}
    }, [roomShapeRoles]);
    useEffect(() => {
        try {
            localStorage.setItem("epic3d.tileDefaults.v1", JSON.stringify(tileDefaults || {}));
        } catch {}
    }, [tileDefaults]);
    useEffect(() => {
        try {
            localStorage.setItem("epic3d.cableKindDefaults.v1", JSON.stringify(cableKindDefaults || {}));
        } catch {}
    }, [cableKindDefaults]);

    const exportDefaults = () => {
        const payload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            roomShapeRoles: roomShapeRoles || {},
            tileDefaults: tileDefaults || {},
            cableKindDefaults: cableKindDefaults || {},
            linkDefaults: (() => {
                try {
                    const raw = localStorage.getItem("epic3d.linkDefaults.v1");
                    return raw ? JSON.parse(raw) : null;
                } catch {
                    return null;
                }
            })(),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `epic3d-defaults-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const importDefaults = async (file) => {
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (parsed?.tileDefaults && typeof parsed.tileDefaults === "object") {
                setTileDefaults(parsed.tileDefaults);
                try {
                    localStorage.setItem("epic3d.tileDefaults.v1", JSON.stringify(parsed.tileDefaults));
                } catch {}
            }
            if (parsed?.roomShapeRoles) {
                let roles = parsed.roomShapeRoles;
                if (typeof roles === "string") {
                    try { roles = JSON.parse(roles); } catch {}
                }
                if (roles && typeof roles === "object") {
                    const nextRoles = { ...roles };
                    setRoomShapeRoles(nextRoles);
                    try {
                        localStorage.setItem("epic3d.roomShapeRoles.v1", JSON.stringify(nextRoles));
                    } catch {}
                }
            }
            if (parsed?.cableKindDefaults && typeof parsed.cableKindDefaults === "object") {
                setCableKindDefaults(parsed.cableKindDefaults);
                try {
                    localStorage.setItem("epic3d.cableKindDefaults.v1", JSON.stringify(parsed.cableKindDefaults));
                } catch {}
            }
            if (parsed?.linkDefaults && typeof parsed.linkDefaults === "object") {
                try {
                    localStorage.setItem("epic3d.linkDefaults.v1", JSON.stringify(parsed.linkDefaults));
                } catch {}
                try {
                    window.dispatchEvent(new CustomEvent("EPIC3D_LINK_DEFAULTS_SET", { detail: parsed.linkDefaults }));
                } catch {}
            }
        } catch {}
    };
    const setRoomRole = (key, role) => {
        setRoomShapeRoles((prev) => ({
            ...(prev || {}),
            [key]: {
                ...(prev?.[key] || {}),
                role,
                master: role === "master" ? "" : (prev?.[key]?.master || ""),
            },
        }));
    };
    const setRoomMaster = (key, master) => {
        setRoomShapeRoles((prev) => ({
            ...(prev || {}),
            [key]: {
                ...(prev?.[key] || {}),
                role: "slave",
                master,
            },
        }));
    };
    const setRoomLinkStyle = (key, linkStyle) => {
        setRoomShapeRoles((prev) => ({
            ...(prev || {}),
            [key]: {
                ...(prev?.[key] || {}),
                linkStyle,
                linkKind: linkStyle === "cable" ? (prev?.[key]?.linkKind || "cat6") : prev?.[key]?.linkKind,
            },
        }));
    };
    const setRoomLinkKind = (key, linkKind) => {
        setRoomShapeRoles((prev) => ({
            ...(prev || {}),
            [key]: {
                ...(prev?.[key] || {}),
                linkKind,
            },
        }));
    };

    const parseTileCode = (raw) => {
        const txt = String(raw || "").trim().toUpperCase();
        const match = txt.match(/^([FCNSEW])(?:[-\s]*)?([A-Z]+)(\d+)$/);
        if (!match) return null;
        const face = match[1];
        const letters = match[2];
        const row = Math.max(1, Number(match[3] || 1));
        return { face, letters, row };
    };

    const lettersToIndex = (letters) => {
        const s = String(letters || "").toUpperCase();
        let n = 0;
        for (let i = 0; i < s.length; i += 1) {
            const code = s.charCodeAt(i);
            if (code < 65 || code > 90) continue;
            n = n * 26 + (code - 64);
        }
        return Math.max(0, n - 1);
    };

    const pickWallGrid = (total, aspect) => {
        const t = Math.max(1, Math.round(Number(total) || 1));
        let best = { cols: 1, rows: t, score: Number.POSITIVE_INFINITY };
        for (let cols = 1; cols <= t; cols += 1) {
            if (t % cols !== 0) continue;
            const rows = t / cols;
            const ratio = cols / rows;
            const score = Math.abs(ratio - (Number.isFinite(aspect) ? aspect : 1));
            if (score < best.score) best = { cols, rows, score };
        }
        return { cols: best.cols, rows: best.rows };
    };

    const computeTilePlacement = (room, code, align, offset) => {
        const parsed = parseTileCode(code);
        if (!parsed || !room) return null;
        const face = parsed.face;
        const off = offset || { x: 0, y: 0, z: 0 };
        const colIdx = lettersToIndex(parsed.letters);
        const rowIdx = Math.max(0, parsed.row - 1);
        const size = Array.isArray(room.size) ? room.size : [2, 1.6, 2];
        const halfW = size[0] * 0.5;
        const halfH = size[1] * 0.5;
        const halfD = size[2] * 0.5;
        const alignMap = {
            center: [0, 0],
            top: [0, 0.45],
            bottom: [0, -0.45],
            left: [-0.45, 0],
            right: [0.45, 0],
            "top-left": [-0.45, 0.45],
            "top-center": [0, 0.45],
            "top-right": [0.45, 0.45],
            "center-left": [-0.45, 0],
            "center-right": [0.45, 0],
            "bottom-left": [-0.45, -0.45],
            "bottom-center": [0, -0.45],
            "bottom-right": [0.45, -0.45],
        };
        const alignPair = alignMap[align] || alignMap.center;
        if (face === "F" || face === "C") {
            const cols = Math.max(1, Math.round(Number(roomTileCount) || 4));
            const rows = cols;
            const stepX = size[0] / cols;
            const stepZ = size[2] / rows;
            const col = Math.min(cols - 1, Math.max(0, colIdx));
            const row = Math.min(rows - 1, Math.max(0, rowIdx));
            const x = -halfW + (col + 0.5) * stepX + alignPair[0] * stepX + (Number(off.x) || 0);
            const z = -halfD + (row + 0.5) * stepZ + alignPair[1] * stepZ + (Number(off.z) || 0);
            const y = (face === "F" ? -halfH : halfH) + (Number(off.y) || 0);
            const normal = face === "F" ? [0, 1, 0] : [0, -1, 0];
            return { pos: [x, y, z], face, normal };
        }
        const wallTotal = Math.max(1, Math.round(Number(roomTileCount) || 4));
        if (face === "N" || face === "S") {
            const grid = pickWallGrid(wallTotal, size[0] / (size[1] || 1));
            const cols = grid.cols;
            const rows = grid.rows;
            const stepX = size[0] / cols;
            const stepY = size[1] / rows;
            const col = Math.min(cols - 1, Math.max(0, colIdx));
            const row = Math.min(rows - 1, Math.max(0, rowIdx));
            const x = -halfW + (col + 0.5) * stepX + alignPair[0] * stepX + (Number(off.x) || 0);
            const y = -halfH + (row + 0.5) * stepY + alignPair[1] * stepY + (Number(off.y) || 0);
            const z = (face === "N" ? halfD : -halfD) + (Number(off.z) || 0);
            const normal = face === "N" ? [0, 0, 1] : [0, 0, -1];
            return { pos: [x, y, z], face, normal };
        }
        if (face === "E" || face === "W") {
            const grid = pickWallGrid(wallTotal, size[2] / (size[1] || 1));
            const cols = grid.cols;
            const rows = grid.rows;
            const stepZ = size[2] / cols;
            const stepY = size[1] / rows;
            const col = Math.min(cols - 1, Math.max(0, colIdx));
            const row = Math.min(rows - 1, Math.max(0, rowIdx));
            const z = -halfD + (col + 0.5) * stepZ + alignPair[0] * stepZ + (Number(off.z) || 0);
            const y = -halfH + (row + 0.5) * stepY + alignPair[1] * stepY + (Number(off.y) || 0);
            const x = (face === "E" ? halfW : -halfW) + (Number(off.x) || 0);
            const normal = face === "E" ? [1, 0, 0] : [-1, 0, 0];
            return { pos: [x, y, z], face, normal };
        }
        return null;
    };

    const applyTileSurfaceOffset = (placement, shape) => {
        if (!placement || !placement.pos) return placement;
        const normal = placement.normal || [0, 1, 0];
        const dims = getShapeDims(shape) || { w: 0.6, h: 0.3, d: 0.6 };
        let offset = 0.01;
        const t = getShapeType(shape);
        if (t === "remote") offset += 0.05;
        if (t === "tv") offset -= (Number(dims.h) || 0.6) * 0.5;
        const nx = Math.abs(normal[0]);
        const ny = Math.abs(normal[1]);
        const nz = Math.abs(normal[2]);
        if (ny > 0.5) offset += (Number(dims.h) || 0.3) * 0.5;
        else if (nx > 0.5) offset += (Number(dims.w) || 0.6) * 0.5;
        else offset += (Number(dims.d) || 0.6) * 0.5;
        return {
            ...placement,
            pos: [
                placement.pos[0] + normal[0] * offset,
                placement.pos[1] + normal[1] * offset,
                placement.pos[2] + normal[2] * offset,
            ],
        };
    };

    const removeTilePreview = React.useCallback((shapeKey) => {
        if (!setNodes) return;
        const key = shapeKey ? String(shapeKey) : null;
        setNodes((prev) => (prev || []).filter((n) => {
            if (!n?.__tilePreview) return true;
            if (!key) return false;
            return n.__tilePreviewFor !== key;
        }));
        tilePreviewIdRef.current = null;
    }, [setNodes]);
    const removeTileBehaviorPreview = React.useCallback(() => {
        if (!setNodes) return;
        if (!tileBehaviorPreviewIdRef.current) return;
        setNodes((prev) => (prev || []).filter((n) => !n?.__tileBehaviorPreview));
        tileBehaviorPreviewIdRef.current = null;
    }, [setNodes]);
    const removeSimPreview = React.useCallback(() => {
        if (!setNodes || !setLinks) return;
        if (!simPreviewIdsRef.current?.nodes?.length && !simPreviewIdsRef.current?.links?.length) return;
        const nodeIds = new Set(simPreviewIdsRef.current?.nodes || []);
        const linkIds = new Set(simPreviewIdsRef.current?.links || []);
        setLinks((prev) => (prev || []).filter((l) => !linkIds.has(l.id)));
        setNodes((prev) => (prev || []).filter((n) => !nodeIds.has(n.id) && !n?.__simPreview));
        simPreviewIdsRef.current = { nodes: [], links: [] };
    }, [setNodes, setLinks]);

    useEffect(() => {
        if (!tileDialog) return;
        if (!tileDialog?.preview) {
            removeTilePreview(tileDialog?.shapeKey);
            return;
        }
        const codes = (tileDialog.multiPick && Array.isArray(tileDialog.tileCodes) && tileDialog.tileCodes.length)
            ? tileDialog.tileCodes
            : [tileDialog.tileCode].filter(Boolean);
        const effectiveRoomId = tileDialog?.roomId || selectedRoomId || (rooms || [])[0]?.id || "";
        if (!effectiveRoomId || !codes.length) {
            removeTilePreview(tileDialog?.shapeKey);
            return;
        }
        const room = (rooms || []).find((r) => r.id === effectiveRoomId);
        if (!room) {
            removeTilePreview(tileDialog?.shapeKey);
            return;
        }
        const center = Array.isArray(room.center) ? room.center : [0, 0, 0];
        const yaw = Number(tileDialog.rotation || 0) * (Math.PI / 180);
        const cx = Math.cos(Number(room.rotation?.[1] || 0));
        const sx = Math.sin(Number(room.rotation?.[1] || 0));
        const baseShape = buildShape(tileDialog.shapeKey);
        const safeKey = String(tileDialog.shapeKey || "shape").replace(/[^a-z0-9_-]/gi, "_");
        const ids = codes.map((code) => `tile-preview-${safeKey}-${String(code).replace(/[^a-z0-9_-]/gi, "_")}`);
        tilePreviewIdRef.current = ids;
        const previews = codes.map((code, idx) => {
            const placement = applyTileSurfaceOffset(
                computeTilePlacement(room, code, tileDialog.align, {
                    x: tileDialog.offsetX ?? 0,
                    y: tileDialog.offsetY ?? 0,
                    z: tileDialog.offsetZ ?? 0,
                }),
                baseShape
            );
            if (!placement) return null;
            const basePos = placement.pos;
            const lx = basePos[0] * cx - basePos[2] * sx;
            const lz = basePos[0] * sx + basePos[2] * cx;
            const worldPos = [center[0] + lx, center[1] + basePos[1], center[2] + lz];
            return {
                id: ids[idx],
                kind: "node",
                label: `Preview ${idx + 1}`,
                position: worldPos,
                rotation: [0, yaw, 0],
                color: "#94a3b8",
                glowOn: false,
                glow: 0.2,
                cluster: "Preview",
                shape: baseShape,
                __tilePreview: true,
                __tilePreviewFor: String(tileDialog.shapeKey),
                __tilePreviewOrder: idx + 1,
                __tilePreviewCode: code,
                roomId: room.id,
            };
        }).filter(Boolean);
        setNodes((prev) => {
            const list = Array.isArray(prev)
                ? prev.filter((n) => !(n?.__tilePreview && n?.__tilePreviewFor === String(tileDialog.shapeKey)))
                : [];
            return [...list, ...previews];
        });
    }, [tileDialog, rooms, setNodes, buildShape, computeTilePlacement, removeTilePreview, selectedRoomId]);

    useEffect(() => {
        if (!tileBehaviorDialog) return;
        if (!tileBehaviorDialog?.preview) {
            removeTileBehaviorPreview();
            return;
        }
        const activeRoomId = tileBehaviorDialog?.roomId || selectedRoomId || "";
        if (!activeRoomId) {
            removeTileBehaviorPreview();
            return;
        }
        const shapes = [tileBehaviorDialog?.shapeA, tileBehaviorDialog?.shapeB].filter(Boolean);
        if (!shapes.length) {
            removeTileBehaviorPreview();
            return;
        }
        const room = (rooms || []).find((r) => r.id === activeRoomId);
        if (!room) {
            removeTileBehaviorPreview();
            return;
        }
        const center = Array.isArray(room.center) ? room.center : [0, 0, 0];
        const cx = Math.cos(Number(room.rotation?.[1] || 0));
        const sx = Math.sin(Number(room.rotation?.[1] || 0));
        const spacing = Math.max(0, Number(tileBehaviorDialog.spacing ?? 0.1) || 0);
        const roomSize = room.size || [3, 1.6, 2.2];
        const minY = (center[1] - roomSize[1] / 2) + 0.01;
        const maxY = (center[1] + roomSize[1] / 2) - 0.01;
        const byTile = new Map();
        shapes.forEach((shapeKey) => {
            const def = tileDefaults?.[shapeKey] || {};
            const code = def.tileCodes?.[0] || def.tileCode || "F-A1";
            if (!code) return;
            if (!byTile.has(code)) byTile.set(code, { keys: [], align: def.align || "center", rotation: def.rotation || 0 });
            byTile.get(code).keys.push(shapeKey);
        });
        const previews = [];
        byTile.forEach((group, code) => {
            const align = group.align || "center";
            const yaw = Number(group.rotation || 0) * (Math.PI / 180);
            const baseShapeForPlacement = buildShape(group.keys?.[0]);
            const placement = applyTileSurfaceOffset(computeTilePlacement(room, code, align), baseShapeForPlacement);
            if (!placement) return;
            const basePos = placement.pos;
            const lx = basePos[0] * cx - basePos[2] * sx;
            const lz = basePos[0] * sx + basePos[2] * cx;
            const baseWorld = [center[0] + lx, center[1] + basePos[1], center[2] + lz];
            let currentY = baseWorld[1];
            group.keys.forEach((shapeKey, idx) => {
                const shape = buildShape(shapeKey);
                const dims = getShapeDims(shape) || { w: 0.6, h: 0.3, d: 0.6 };
                const halfH = (Number(dims.h) || 0.3) / 2;
                if (idx === 0) {
                    currentY = Math.max(minY + halfH, currentY);
                } else {
                    currentY += halfH + spacing;
                }
                const y = Math.min(maxY - halfH, currentY);
                currentY = y + halfH;
                previews.push({
                    id: `tile-beh-preview-${code}-${idx}-${shapeKey}`,
                    kind: "node",
                    label: `Stack ${idx + 1}`,
                    position: [baseWorld[0], y, baseWorld[2]],
                    rotation: [0, yaw, 0],
                    color: "#94a3b8",
                    glowOn: false,
                    glow: 0.2,
                    cluster: "Preview",
                    shape,
                    __tileBehaviorPreview: true,
                    __tileBehaviorOrder: idx + 1,
                    __tileBehaviorTile: code,
                    roomId: room.id,
                });
            });
        });
        tileBehaviorPreviewIdRef.current = true;
        setNodes((prev) => {
            const list = Array.isArray(prev) ? prev.filter((n) => !n?.__tileBehaviorPreview) : [];
            return [...list, ...previews];
        });
    }, [tileBehaviorDialog, rooms, selectedRoomId, setNodes, buildShape, computeTilePlacement, removeTileBehaviorPreview]);

    useEffect(() => {
        const activeSim = simulateDialog || (defaultSimEnabled ? (() => {
            if (!defaultSimId) return null;
            const preset = (simulatePresets || []).find((p) => p.id === defaultSimId);
            if (!preset) return null;
            return {
                preview: true,
                roomId: selectedRoomId || preset.roomId || "",
                items: Array.isArray(preset.items) ? preset.items : [],
            };
        })() : null);
        if (!activeSim) return;
        if (!activeSim?.preview) {
            removeSimPreview();
            simPreviewSigRef.current = "";
            if (simPreviewTimerRef.current) {
                clearTimeout(simPreviewTimerRef.current);
                simPreviewTimerRef.current = null;
            }
            return;
        }
        const roomId = activeSim.roomId || selectedRoomId || "";
        if (!roomId) {
            removeSimPreview();
            simPreviewSigRef.current = "";
            if (simPreviewTimerRef.current) {
                clearTimeout(simPreviewTimerRef.current);
                simPreviewTimerRef.current = null;
            }
            return;
        }
        const room = (rooms || []).find((r) => r.id === roomId);
        if (!room) {
            removeSimPreview();
            return;
        }
        const items = Array.isArray(activeSim.items) ? activeSim.items : [];
        if (!items.length) {
            removeSimPreview();
            return;
        }
        const shapesInList = items.map((it) => it.shape).filter(Boolean);
        const sigShapes = Array.from(new Set(shapesInList)).sort();
        const sigItems = items
            .map((it) => ({ shape: it.shape, qty: Math.max(1, Math.floor(Number(it.qty) || 1)) }))
            .sort((a, b) => String(a.shape).localeCompare(String(b.shape)))
            .map((it) => `${it.shape}:${it.qty}`)
            .join("|");
        const sigTiles = sigShapes
            .map((shapeKey) => {
                const def = tileDefaults?.[shapeKey] || {};
                const codes = Array.isArray(def.tileCodes) && def.tileCodes.length ? def.tileCodes : [def.tileCode || "F-A1"];
                return `${shapeKey}:${codes.join(",")}:${def.align || "center"}:${Number(def.rotation || 0) || 0}`;
            })
            .join("|");
        const sigRoles = sigShapes
            .map((shapeKey) => {
                const role = getRoomRole(shapeKey);
                const master = getRoomMaster(shapeKey);
                const linkStyle = getRoomLinkStyle(shapeKey);
                const linkKind = getRoomLinkKind(shapeKey);
                const anchorEnabled = getRoomAnchorEnabled(shapeKey) ? "1" : "0";
                return `${shapeKey}:${role}:${master}:${linkStyle}:${linkKind}:${anchorEnabled}`;
            })
            .join("|");
        const sigColors = sigShapes
            .map((shapeKey) => {
                const kind = getRoomLinkKind(shapeKey);
                return `${shapeKey}:${kind}:${cableKindDefaults?.[kind] || ""}`;
            })
            .join("|");
        const sig = `${roomId}|${sigItems}|${sigTiles}|${sigRoles}|${sigColors}`;
        if (simPreviewSigRef.current === sig) return;
        simPreviewSigRef.current = sig;
        if (simPreviewTimerRef.current) clearTimeout(simPreviewTimerRef.current);
        simPreviewTimerRef.current = setTimeout(() => {
            const center = Array.isArray(room.center) ? room.center : [0, 0, 0];
            const cx = Math.cos(Number(room.rotation?.[1] || 0));
            const sx = Math.sin(Number(room.rotation?.[1] || 0));
            const newNodes = [];
            const masterByShape = new Map();
            const allByShape = new Map();
            const slaveEntries = [];
            items.forEach((it) => {
                const shapeKey = it.shape;
                if (!shapeKey) return;
                const qty = Math.max(1, Math.min(200, Math.floor(Number(it.qty) || 1)));
                const def = tileDefaults?.[shapeKey] || {};
                const codes = Array.isArray(def.tileCodes) && def.tileCodes.length
                    ? def.tileCodes
                    : [def.tileCode || "F-A1"];
                const align = def.align || "center";
                const yaw = Number(def.rotation || 0) * (Math.PI / 180);
                for (let i = 0; i < qty; i++) {
                    const code = codes[i % codes.length];
                    const shape = buildShape(shapeKey);
            const placement = applyTileSurfaceOffset(
                computeTilePlacement(room, code, align, {
                    x: def.offsetX ?? 0,
                    y: def.offsetY ?? 0,
                    z: def.offsetZ ?? 0,
                }),
                shape
            );
                    const basePos = placement?.pos || [0, -(room.size?.[1] || 1.6) * 0.5 + 0.1, 0];
                    const lx = basePos[0] * cx - basePos[2] * sx;
                    const lz = basePos[0] * sx + basePos[2] * cx;
                    const worldPos = [center[0] + lx, center[1] + basePos[1], center[2] + lz];
                    const id = `sim-${room.id}-${shapeKey}-${code}-${i}`;
                    const anchorEnabled = getRoomAnchorEnabled(shapeKey);
                    const anchorSetId = "fas-default";
                    const defaultAnchorSet = {
                        id: anchorSetId,
                        name: "Default",
                        anchors: [],
                        globalBendDeg: 90,
                        dynamicBreakpoints: true,
                        noDiagonal: true,
                        spreadPaths: 0,
                        spreadIgnoreBreakpoints: 0,
                        hideRings: false,
                    };
                    const node = {
                        id,
                        kind: "node",
                        label: `${shapeKey} ${i + 1}`,
                        position: worldPos,
                        rotation: [0, yaw, 0],
                        color: "#94a3b8",
                        glowOn: false,
                        glow: 0.2,
                        cluster: "Simulation",
                        shape,
                        roomId: room.id,
                        __simPreview: true,
                        ...(anchorEnabled ? {
                            flowAnchorsEnabled: true,
                            flowAnchorSets: [defaultAnchorSet],
                            flowAnchorActiveSetId: anchorSetId,
                            flowAnchorGlobalBendDeg: 90,
                            flowAnchorDynamicBreakpoints: true,
                            flowAnchorNoDiagonal: true,
                        } : {}),
                    };
                    newNodes.push(node);
                    const role = getRoomRole(shapeKey);
                    if (!allByShape.has(shapeKey)) allByShape.set(shapeKey, []);
                    allByShape.get(shapeKey).push(node);
                    if (role === "master") {
                        if (!masterByShape.has(shapeKey)) masterByShape.set(shapeKey, []);
                        masterByShape.get(shapeKey).push(node);
                    } else {
                        slaveEntries.push({ node, shapeKey });
                    }
                }
            });
            const newLinks = [];
            const dist2 = (a, b) => {
                const dx = (a[0] || 0) - (b[0] || 0);
                const dy = (a[1] || 0) - (b[1] || 0);
                const dz = (a[2] || 0) - (b[2] || 0);
                return dx * dx + dy * dy + dz * dz;
            };
            slaveEntries.forEach(({ node, shapeKey }) => {
                const masterKey = getRoomMaster(shapeKey);
                if (!masterKey) return;
                const masters = masterByShape.get(masterKey) || allByShape.get(masterKey) || [];
                if (!masters.length) return;
                let closest = masters[0];
                let best = dist2(node.position, closest.position);
                for (let i = 1; i < masters.length; i++) {
                    const d = dist2(node.position, masters[i].position);
                    if (d < best) {
                        best = d;
                        closest = masters[i];
                    }
                }
                const style = getRoomLinkStyle(shapeKey);
                const kind = getRoomLinkKind(shapeKey);
                const color = cableKindDefaults?.[kind] || undefined;
                const linkId = `sim-link-${node.id}-${closest.id}`;
                const link = {
                    id: linkId,
                    from: node.id,
                    to: closest.id,
                    label: "",
                    description: "",
                    style,
                };
                if (style === "cable") {
                    link.cable = { kind };
                    if (color) link.color = color;
                } else if (color) {
                    link.color = color;
                }
                newLinks.push(link);
            });
            setNodes((prev) => {
                const list = Array.isArray(prev) ? prev.slice() : [];
                const nextIds = new Set(newNodes.map((n) => n.id));
                const kept = list.filter((n) => !(n?.__simPreview && !nextIds.has(n.id)));
                const byId = new Map(kept.map((n) => [n.id, n]));
                newNodes.forEach((n) => {
                    byId.set(n.id, { ...(byId.get(n.id) || {}), ...n, __simPreview: true });
                });
                return Array.from(byId.values());
            });
            setLinks?.((prev) => {
                const list = Array.isArray(prev) ? prev.slice() : [];
                const nextIds = new Set(newLinks.map((l) => l.id));
                const kept = list.filter((l) => !(l?.__simPreview && !nextIds.has(l.id)));
                const byId = new Map(kept.map((l) => [l.id, l]));
                newLinks.forEach((l) => {
                    byId.set(l.id, { ...(byId.get(l.id) || {}), ...l, __simPreview: true });
                });
                return Array.from(byId.values());
            });
            simPreviewIdsRef.current = { nodes: newNodes.map((n) => n.id), links: newLinks.map((l) => l.id) };
        }, 120);
    }, [
        simulateDialog,
        defaultSimEnabled,
        defaultSimId,
        simulatePresets,
        selectedRoomId,
        rooms,
        setNodes,
        setLinks,
        buildShape,
        computeTilePlacement,
        removeSimPreview,
        tileDefaults,
        roomShapeRoles,
        cableKindDefaults,
    ]);
    useEffect(() => {
        if (!simulateDialog) return;
        const prefs = {
            preview: !!simulateDialog.preview,
            roomId: simulateDialog.roomId || "",
            items: Array.isArray(simulateDialog.items) ? simulateDialog.items : [],
        };
        try {
            localStorage.setItem(simulatePrefsKey, JSON.stringify(prefs));
        } catch {}
    }, [simulateDialog, simulateDialog?.preview, simulateDialog?.roomId, simulateDialog?.items]);

    useEffect(() => {
        try {
            localStorage.setItem(simulatePresetsKey, JSON.stringify(simulatePresets || []));
        } catch {}
    }, [simulatePresets]);

    useEffect(() => {
        try {
            localStorage.setItem(simulateDefaultKey, JSON.stringify({ id: defaultSimId || "", enabled: !!defaultSimEnabled }));
        } catch {}
    }, [defaultSimId, defaultSimEnabled]);

    useEffect(() => {
        return () => {
            removeTilePreview(tileDialog?.shapeKey);
        };
    }, [removeTilePreview, tileDialog?.shapeKey]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const fallbackRoomId = (rooms || [])[0]?.id || "";
        const active = !!tileDialog?.pickMode && !!tileDialog?.preview && !!(tileDialog?.roomId || selectedRoomId || fallbackRoomId);
        window.dispatchEvent(
            new CustomEvent("EPIC3D_TILE_PICK_MODE", {
                detail: {
                    active,
                    roomId: tileDialog?.roomId || selectedRoomId || fallbackRoomId || null,
                },
            })
        );
    }, [tileDialog?.pickMode, tileDialog?.roomId, tileDialog?.preview, selectedRoomId, rooms]);
    useEffect(() => {
        if (typeof window === "undefined") return;
        const active = !!tileDialog?.pickRoomMode && !!tileDialog?.preview;
        window.dispatchEvent(
            new CustomEvent("EPIC3D_ROOM_PICK_MODE", {
                detail: {
                    active,
                },
            })
        );
    }, [tileDialog?.pickRoomMode, tileDialog?.preview]);
    useEffect(() => {
        if (!tileDialog) return;
        const prefs = {
            align: tileDialog.align || "center",
            rotation: Number(tileDialog.rotation ?? 0) || 0,
            offsetX: Number(tileDialog.offsetX ?? 0) || 0,
            offsetY: Number(tileDialog.offsetY ?? 0) || 0,
            offsetZ: Number(tileDialog.offsetZ ?? 0) || 0,
            preview: !!tileDialog.preview,
            roomId: tileDialog.roomId || "",
            previewShowFloor: tileDialog.previewShowFloor !== false,
            previewShowCeiling: tileDialog.previewShowCeiling !== false,
            previewShowWalls: tileDialog.previewShowWalls !== false,
            multiPick: !!tileDialog.multiPick,
        };
        try {
            localStorage.setItem(tileDialogPrefsKey, JSON.stringify(prefs));
        } catch {}
    }, [
        tileDialog,
        tileDialog?.align,
        tileDialog?.rotation,
        tileDialog?.preview,
        tileDialog?.roomId,
        tileDialog?.previewShowFloor,
        tileDialog?.previewShowCeiling,
        tileDialog?.previewShowWalls,
        tileDialog?.multiPick,
        tileDialog?.offsetX,
        tileDialog?.offsetY,
        tileDialog?.offsetZ,
    ]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onPick = (e) => {
            const d = e?.detail || {};
        if (!d.code) return;
        setTileDialog((prev) => {
            if (!prev) return prev;
            let nextCodes = Array.isArray(prev.tileCodes) ? [...prev.tileCodes] : [];
            if (prev.multiPick) {
                if (!nextCodes.some((c) => c === d.code)) nextCodes.push(d.code);
            } else {
                nextCodes = [];
            }
            const next = {
                ...prev,
                tileCode: prev.multiPick ? (nextCodes[0] || d.code) : d.code,
                tileCodes: prev.multiPick ? nextCodes : [],
            };
            setTileDefaults((cur) => ({
                ...(cur || {}),
                [next.shapeKey]: {
                    tileCode: next.tileCode || "F-A1",
                        tileCodes: next.tileCodes?.length ? next.tileCodes : undefined,
                        align: next.align || "center",
                        rotation: Number(next.rotation || 0) || 0,
                    },
                }));
                return next;
            });
        };
        window.addEventListener("EPIC3D_TILE_PICKED", onPick);
        return () => window.removeEventListener("EPIC3D_TILE_PICKED", onPick);
    }, []);
    useEffect(() => {
        if (!tileDialog?.pickRoomMode) return;
        if (!tileDialog?.preview) return;
        if (!selectedRoomId) return;
        setTileDialog((prev) => {
            if (!prev || prev.roomId === selectedRoomId) return prev;
            return { ...prev, roomId: selectedRoomId };
        });
    }, [tileDialog?.pickRoomMode, tileDialog?.preview, selectedRoomId]);
    useEffect(() => {
        if (!tileDialog?.preview) return;
        if (tileDialog?.roomId) return;
        const fallbackRoomId = selectedRoomId || (rooms || [])[0]?.id || "";
        if (!fallbackRoomId) return;
        setTileDialog((prev) => {
            if (!prev || prev.roomId) return prev;
            return { ...prev, roomId: fallbackRoomId };
        });
    }, [tileDialog?.preview, tileDialog?.roomId, selectedRoomId, rooms]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const effectiveRoomId = tileDialog?.roomId || selectedRoomId || (rooms || [])[0]?.id || "";
        const room = (rooms || []).find((r) => r.id === effectiveRoomId);
        const prevRoomId = tilePreviewRoomRef.current;
        const restoreRoom = (roomId) => {
            if (!roomId) return;
            const prev = tilePreviewVisRef.current.get(String(roomId));
            if (!prev) return;
            tilePreviewVisRef.current.delete(String(roomId));
            try {
                window.dispatchEvent(new CustomEvent("EPIC3D_ROOM_TILE_PREVIEW_VIS", { detail: { roomId, patch: prev } }));
            } catch {}
        };

        if (!tileDialog?.preview || !effectiveRoomId || !room) {
            if (prevRoomId) {
                restoreRoom(prevRoomId);
                tilePreviewRoomRef.current = null;
            }
            return;
        }

        if (prevRoomId && String(prevRoomId) !== String(effectiveRoomId)) {
            restoreRoom(prevRoomId);
            tilePreviewRoomRef.current = null;
        }

        if (!tilePreviewVisRef.current.has(String(effectiveRoomId))) {
            tilePreviewVisRef.current.set(String(effectiveRoomId), {
                floor: room.floor ?? true,
                ceiling: room.ceiling ?? true,
                wallN: room.wallN ?? true,
                wallS: room.wallS ?? true,
                wallE: room.wallE ?? true,
                wallW: room.wallW ?? true,
            });
        }
        tilePreviewRoomRef.current = effectiveRoomId;

        const patch = {
            floor: tileDialog.previewShowFloor !== false,
            ceiling: tileDialog.previewShowCeiling !== false,
        };
        if (tileDialog.previewShowWalls === false) {
            patch.wallN = false;
            patch.wallS = false;
            patch.wallE = false;
            patch.wallW = false;
        } else {
            patch.wallN = true;
            patch.wallS = true;
            patch.wallE = true;
            patch.wallW = true;
        }
        window.dispatchEvent(new CustomEvent("EPIC3D_ROOM_TILE_PREVIEW_VIS", { detail: { roomId: effectiveRoomId, patch } }));
    }, [
        tileDialog?.preview,
        tileDialog?.roomId,
        tileDialog?.previewShowFloor,
        tileDialog?.previewShowCeiling,
        tileDialog?.previewShowWalls,
        selectedRoomId,
        rooms,
    ]);

    useEffect(() => {
        return () => {
            const lastRoomId = tilePreviewRoomRef.current;
            if (!lastRoomId) return;
            const prev = tilePreviewVisRef.current.get(String(lastRoomId));
            if (!prev) return;
            tilePreviewVisRef.current.delete(String(lastRoomId));
            try {
                window.dispatchEvent(new CustomEvent("EPIC3D_ROOM_TILE_PREVIEW_VIS", { detail: { roomId: lastRoomId, patch: prev } }));
            } catch {}
        };
    }, []);
    const setRoomAnchorEnabled = (key, enabled) => {
        setRoomShapeRoles((prev) => ({
            ...(prev || {}),
            [key]: {
                ...(prev?.[key] || {}),
                anchorEnabled: !!enabled,
            },
        }));
    };
    useEffect(() => {
        if (!nodes?.length) {
            if (rescaleMasterId) setRescaleMasterId("");
            if (rescaleTargetShape) setRescaleTargetShape("");
            return;
        }
        if (!nodes.some((n) => n.id === rescaleMasterId)) {
            setRescaleMasterId(nodes[0]?.id || "");
        }
        if (!shapeOptionsInUse.some((opt) => opt.value === rescaleTargetShape)) {
            setRescaleTargetShape(shapeOptionsInUse[0]?.value || "");
        }
    }, [nodes, rescaleMasterId, rescaleTargetShape, shapeOptionsInUse]);
    useEffect(() => {
        const list = rooms || [];
        if (!list.length) {
            if (copyCatMasterRoomId) setCopyCatMasterRoomId("");
            if (copyCatTargetRoomId) setCopyCatTargetRoomId("");
            return;
        }
        if (!list.some((r) => r.id === copyCatMasterRoomId)) {
            setCopyCatMasterRoomId(list[0]?.id || "");
        }
        if (!list.some((r) => r.id === copyCatTargetRoomId)) {
            const fallback = list.length > 1 ? list[1]?.id || list[0]?.id : list[0]?.id;
            setCopyCatTargetRoomId(fallback || "");
        }
    }, [rooms, copyCatMasterRoomId, copyCatTargetRoomId]);
    useEffect(() => {
        const list = nodes || [];
        if (!list.length) {
            if (flowAdoptMasterId) setFlowAdoptMasterId("");
            if (flowAdoptTargetId) setFlowAdoptTargetId("");
            return;
        }
        if (!list.some((n) => n.id === flowAdoptMasterId)) {
            setFlowAdoptMasterId(list[0]?.id || "");
        }
        if (!list.some((n) => n.id === flowAdoptTargetId)) {
            const fallback = list.length > 1 ? list[1]?.id || list[0]?.id : list[0]?.id;
            setFlowAdoptTargetId(fallback || "");
        }
    }, [nodes, flowAdoptMasterId, flowAdoptTargetId]);
    const readNodeScale = (node) => {
        const shape = node?.shape;
        if (shape && typeof shape === "object" && shape.scale != null) return shape.scale;
        if (node?.scale != null) return node.scale;
        return 1;
    };
    const applyScaleToNode = (nodeId, scale) => {
        if (!setNodeById) return;
        const s = Number(scale);
        if (!Number.isFinite(s) || s <= 0) return;
        setNodeById(nodeId, (cur) => {
            if (!cur) return cur;
            if (cur.shape && typeof cur.shape === "object") {
                return { ...cur, shape: { ...cur.shape, scale: s } };
            }
            return { ...cur, scale: s };
        });
    };
    const executeRescale = () => {
        if (!nodes?.length) return;
        if (!rescaleTargetShape) return;
        if (rescaleMode === "match") {
            const master = nodes.find((n) => n.id === rescaleMasterId);
            if (!master) return;
            const s = readNodeScale(master);
            nodes.forEach((n) => {
                if (n.id === master.id) return;
                if (getShapeKey(n.shape) !== rescaleTargetShape) return;
                applyScaleToNode(n.id, s);
            });
            return;
        }
        const s = Number(rescaleValue);
        if (!Number.isFinite(s) || s <= 0) return;
        nodes.forEach((n) => {
            if (getShapeKey(n.shape) !== rescaleTargetShape) return;
            applyScaleToNode(n.id, s);
        });
    };
    const executeFlowAdoption = () => {
        if (!setLinks) return;
        if (!flowAdoptMasterId || !flowAdoptTargetId) return;
        if (flowAdoptMasterId === flowAdoptTargetId) return;
        setLinks((prev) =>
            (prev || []).map((l) => (l?.from === flowAdoptMasterId ? { ...l, from: flowAdoptTargetId } : l)),
        );
    };
    const executeSignalBulk = () => {
        if (!setNodeById || !nodes?.length) return;
        const enable = signalBulkMode === "enable";
        nodes.forEach((n) => {
            if (!n?.id) return;
            setNodeById(n.id, (cur) => {
                if (!cur) return cur;
                const signal = { ...(cur.signal || {}) };
                if (enable) {
                    const style = signal.style || cur.signal?.style;
                    if (!style || style === "none") signal.style = "waves";
                } else {
                    signal.style = "none";
                }
                return { signal };
            });
        });
    };

    const nodesList = Array.isArray(nodes) ? nodes : [];
    const getNodeLabel = (n) => n?.label || n?.name || n?.id || "";
    const filterNodes = (list, query) => {
        const q = (query || "").trim().toLowerCase();
        if (!q) return list;
        return list.filter((n) => getNodeLabel(n).toLowerCase().includes(q));
    };
    const withSelectedNode = (list, id) => {
        if (!id) return list;
        if (list.some((n) => n?.id === id)) return list;
        const selectedNode = nodesList.find((n) => n?.id === id);
        return selectedNode ? [selectedNode, ...list] : list;
    };
    const rescaleMasterOptions = useMemo(() => {
        return withSelectedNode(filterNodes(nodesList, rescaleMasterFilter), rescaleMasterId);
    }, [nodesList, rescaleMasterFilter, rescaleMasterId]);
    const flowAdoptMasterOptions = useMemo(() => {
        return withSelectedNode(filterNodes(nodesList, flowAdoptMasterFilter), flowAdoptMasterId);
    }, [nodesList, flowAdoptMasterFilter, flowAdoptMasterId]);
    const flowAdoptTargetOptions = useMemo(() => {
        return withSelectedNode(filterNodes(nodesList, flowAdoptTargetFilter), flowAdoptTargetId);
    }, [nodesList, flowAdoptTargetFilter, flowAdoptTargetId]);

    const buildTemplateRoomNames = (qty, namesCsv, prefix) => {
        const count = Math.max(0, Math.min(999, Math.floor(Number(qty) || 0)));
        const names = String(namesCsv || "")
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean);
        const out = [];
        if (names.length) {
            for (let i = 0; i < count; i += 1) {
                out.push(names[i] || `${prefix}${i + 1}`);
            }
            return out;
        }
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        if (count <= letters.length) {
            for (let i = 0; i < count; i += 1) {
                out.push(`${prefix}${letters[i]}`);
            }
            return out;
        }
        for (let i = 0; i < count; i += 1) {
            out.push(`${prefix}${i + 1}`);
        }
        return out;
    };

    const templaterNameCount = useMemo(() => {
        const count = String(templaterRoomNames || "")
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean).length;
        return Math.min(count, Math.max(0, Number(templaterRoomQty) || 0));
    }, [templaterRoomNames, templaterRoomQty]);

    const templaterDeckOptions = useMemo(() => {
        const list = [];
        (decks || []).forEach((d) => {
            if (!d?.id) return;
            list.push({ id: d.id, label: d.name || d.label || d.id });
        });
        (templaterDecks || []).forEach((d) => {
            if (!d?.id) return;
            list.push({ id: d.id, label: `${d.name || d.id} (templated)` });
        });
        return list;
    }, [decks, templaterDecks]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(templaterPrefsKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.rooms)) setTemplaterRooms(parsed.rooms);
            if (Array.isArray(parsed?.decks)) setTemplaterDecks(parsed.decks);
        } catch {}
    }, []);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(templaterSetupsKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) setTemplaterSetups(parsed);
        } catch {}
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(templaterPrefsKey, JSON.stringify({
                rooms: templaterRooms || [],
                decks: templaterDecks || [],
            }));
        } catch {}
    }, [templaterRooms, templaterDecks]);

    useEffect(() => {
        try {
            localStorage.setItem(templaterSetupsKey, JSON.stringify(templaterSetups || []));
        } catch {}
    }, [templaterSetups]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(templaterFinalKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.rooms)) setTemplaterFinalRooms(parsed.rooms);
        } catch {}
    }, []);

    const addTemplateRooms = () => {
        const names = buildTemplateRoomNames(templaterRoomQty, templaterRoomNames, templaterRoomPrefix);
        if (!names.length) return;
        const roomType = templaterRoomTypeDefault || "";
        const deckId = templaterRoomDeckDefault || "";
        setTemplaterRooms((prev) => [
            ...(prev || []),
            ...names.map((name) => ({
                id: `tpl_room_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
                name,
                tag: "unplaced",
                items: {},
                roomType,
                deckId,
            })),
        ]);
    };

    const addTemplateDeck = () => {
        const name = String(templaterDeckName || "").trim();
        if (!name) return;
        setTemplaterDecks((prev) => [
            ...(prev || []),
            {
                id: `tpl_deck_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`,
                name,
                tag: "unplaced",
            },
        ]);
        setTemplaterDeckName("");
    };

    const templateRoomItemCount = (room) => {
        if (!room?.items) return 0;
        return Object.values(room.items).reduce((acc, v) => acc + (Number(v) || 0), 0);
    };

    const updateTemplateRoomItems = (targetId, shapeKey, delta) => {
        if (!shapeKey) return;
        setTemplaterRooms((prev) => (prev || []).map((room) => {
            if (targetId !== "__all__" && room.id !== targetId) return room;
            const items = { ...(room.items || {}) };
            const next = Math.max(0, (Number(items[shapeKey]) || 0) + delta);
            if (next <= 0) delete items[shapeKey];
            else items[shapeKey] = next;
            return { ...room, items };
        }));
    };

    const updateSetupItems = (shapeKey, delta) => {
        if (!shapeKey) return;
        setTemplaterSetupItems((prev) => {
            const items = { ...(prev || {}) };
            const next = Math.max(0, (Number(items[shapeKey]) || 0) + delta);
            if (next <= 0) delete items[shapeKey];
            else items[shapeKey] = next;
            return items;
        });
    };

    const applySetupToRooms = (setup, roomIds, clearFirst) => {
        if (!setup || !Array.isArray(roomIds) || !roomIds.length) return;
        setTemplaterRooms((prev) => (prev || []).map((room) => {
            if (!roomIds.includes(room.id)) return room;
            const base = clearFirst ? {} : { ...(room.items || {}) };
            const items = { ...base, ...(setup.items || {}) };
            return { ...room, items, setupId: setup.id };
        }));
    };

    const startNewSetup = () => {
        setTemplaterSetupEditId("");
        setTemplaterSetupName("");
        setTemplaterSetupItems({});
    };

    const loadSetupForEdit = (setup) => {
        if (!setup) return;
        setTemplaterSetupEditId(setup.id);
        setTemplaterSetupName(setup.name || "");
        setTemplaterSetupItems({ ...(setup.items || {}) });
    };

    const saveTemplaterSetup = () => {
        const name = String(templaterSetupName || "").trim();
        if (!name) return;
        const items = { ...(templaterSetupItems || {}) };
        const nextId =
            templaterSetupEditId ||
            ((typeof crypto !== "undefined" && crypto.randomUUID)
                ? crypto.randomUUID()
                : `tpl_setup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
        setTemplaterSetups((prev) => {
            const list = prev || [];
            if (templaterSetupEditId) {
                return list.map((s) => (s.id === templaterSetupEditId ? { ...s, name, items } : s));
            }
            return [...list, { id: nextId, name, items }];
        });
        setTemplaterSetupEditId(nextId);
    };

    const updateTemplateRoomDeck = (targetId, deckId) => {
        setTemplaterRooms((prev) => (prev || []).map((room) => {
            if (targetId !== "__all__" && room.id !== targetId) return room;
            return { ...room, deckId: deckId || "" };
        }));
    };

    const deleteTemplaterRoom = (roomId) => {
        if (!roomId) return;
        setTemplaterRooms((prev) => (prev || []).filter((room) => room.id !== roomId));
        setTemplaterFinalRooms((prev) => (prev || []).filter((room) => room.id !== roomId));
        setTemplaterSelectedRoomIds((prev) => (prev || []).filter((id) => id !== roomId));
        if (templaterSelectedRoomId === roomId) setTemplaterSelectedRoomId("");
    };

    const updateTemplateRoomType = (targetId, roomType) => {
        setTemplaterRooms((prev) => (prev || []).map((room) => {
            if (targetId !== "__all__" && room.id !== targetId) return room;
            return { ...room, roomType: roomType || "" };
        }));
    };

    const openTemplaterApplyMenu = (e, roomId) => {
        if (!roomId) return;
        e.preventDefault();
        e.stopPropagation();
        const selectedIds = Array.isArray(templaterSelectedRoomIds) ? templaterSelectedRoomIds : [];
        const ids = selectedIds.includes(roomId) && selectedIds.length
            ? selectedIds
            : [roomId];
        setTemplaterSelectedRoomIds(ids);
        setTemplaterSelectedRoomId(roomId);
        setTemplaterApplyClear(false);
        const firstSetupId = (templaterSetups || [])[0]?.id || "";
        setTemplaterApplySetup({
            x: e.clientX,
            y: e.clientY,
            roomIds: ids,
            setupId: templaterApplySetup?.setupId || firstSetupId,
        });
    };

    const startTemplateDraw = (roomId) => {
        if (!roomId) return;
        try {
            localStorage.setItem(templaterPendingKey, JSON.stringify({ id: roomId }));
        } catch {}
        setPlacement?.((p) => ({
            ...(p || {}),
            placeKind: "room",
            roomDrawMode: "box",
            armed: true,
        }));
        setActiveTab("editor");
    };

    const addManualFloor = () => {
        const id = `manual_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
        const baseY = safeNum(gridConfig?.y, 0);
        const next = {
            id,
            name: `Deck ${floorsManual.length + 1}`,
            y: baseY + (floorsManual.length + 1) * 2,
            visible: true,
            color: gridConfig?.color || "#4aa3ff",
            opacity: Number.isFinite(Number(gridConfig?.opacity)) ? Number(gridConfig?.opacity) : 0.35,
        };
        patchGrid({ floorsEnabled: true, floorsManual: [...floorsManual, next] });
        if (!gridConfig?.activeFloorId) patchGrid({ activeFloorId: id });
    };

    const updateManualFloor = (id, patch) => {
        const next = floorsManual.map((f) => (f?.id === id ? { ...(f || {}), ...(patch || {}) } : f));
        patchGrid({ floorsManual: next });
    };

    const deleteManualFloor = (id) => {
        const next = floorsManual.filter((f) => f?.id !== id);
        patchGrid({ floorsManual: next });
        if (gridConfig?.activeFloorId === id) {
            patchGrid({ activeFloorId: next?.[0]?.id || "ground" });
        }
    };

    const moveManualFloor = (id, dir) => {
        const idx = floorsManual.findIndex((f) => f?.id === id);
        if (idx < 0) return;
        const j = idx + (dir === "up" ? -1 : 1);
        if (j < 0 || j >= floorsManual.length) return;
        const next = [...floorsManual];
        const tmp = next[idx];
        next[idx] = next[j];
        next[j] = tmp;
        patchGrid({ floorsManual: next });
    };

    const bumpManualFloorY = (id, delta) => {
        const f = floorsManual.find((x) => x?.id === id);
        if (!f) return;
        const y = safeNum(f.y, 0) + delta;
        updateManualFloor(id, { y });
    };

    const baseFloorY = safeNum(gridConfig?.y, 0);
    const floorsAutoEnabled = !!gridConfig?.floorsAutoEnabled;
    const floorsAutoCount = Math.max(0, Math.min(64, Math.round(safeNum(gridConfig?.floorsAutoCount, 0))));
    const floorsAutoStep = Math.max(0.05, safeNum(gridConfig?.floorsAutoStep, 2));
    const floorsAutoBaseY = safeNum(gridConfig?.floorsAutoBaseY, baseFloorY);

    const allFloorsForSelect = (() => {
        const out = [{ id: "ground", label: `Ground (y=${baseFloorY.toFixed(2)})`, name: "Ground", y: baseFloorY }];
        if (floorsAutoEnabled && floorsAutoCount > 0) {
            for (let i = 0; i < floorsAutoCount; i++) {
                const y = floorsAutoBaseY + i * floorsAutoStep;
                out.push({ id: `auto_${i}`, label: `Auto ${i + 1} (y=${y.toFixed(2)})`, name: `Auto ${i + 1}`, y });
            }
        }
        for (const f of floorsManual) {
            if (!f?.id) continue;
            const y = safeNum(f.y, 0);
            out.push({ id: f.id, label: `${f.name || f.id} (y=${y.toFixed(2)})`, name: f.name || f.id, y });
        }
        return out;
    })();

    if (prodMode) return null;

    const containerStyle = {
        position: "absolute",
        left: 16,
        top: 200,
        bottom: 16,
        zIndex: 20,
        width: paneWidth,
        minWidth: 320,
        maxWidth: 720,
        pointerEvents: "auto",

        display: "flex",
        flexDirection: "column",

        // Glassy, dark, TopBar-ish
        borderRadius: 12,
        background:
            "linear-gradient(145deg, rgba(5,16,28,0.95), rgba(15,23,42,0.98))",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 14px 32px rgba(0,0,0,0.6)",
        backdropFilter: "blur(10px) saturate(1.05)",
        overflow: "hidden",
    };

    return (
        <div
            ref={leftColRef}
            onPointerDown={(e) => {
                e.stopPropagation();
                uiStart();
            }}
            onPointerUp={uiStop}
            onPointerCancel={uiStop}
            onPointerLeave={uiStop}
            onClickCapture={stopAnchorDefault}
            style={containerStyle}
        >
            {/* Header */}
            <div
                style={{
                    padding: "8px 10px 7px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid rgba(148,163,184,0.45)",
                    background:
                        "linear-gradient(130deg, rgba(15,23,42,0.98), rgba(56,189,248,0.18))",
                    boxShadow: "0 10px 20px rgba(0,0,0,0.45)",
                }}
            >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div
                        style={{
                            fontSize: 10,
                            letterSpacing: "0.22em",
                            textTransform: "uppercase",
                            color: "rgba(226,241,255,0.9)",
                        }}
                    >
                        {activeTab === "commander"
                            ? "Commander"
                            : activeTab === "actions"
                                ? "Actions"
                                : activeTab === "defaults"
                                    ? "Defaults"
                                    : activeTab === "filters"
                                        ? "Filters"
                                        : activeTab === "templater"
                                            ? "Templater"
                                        : "Editor"}
                    </div>
                    <div
                        style={{
                            fontSize: 11,
                            opacity: 0.82,
                            color: "rgba(191,219,254,0.96)",
                        }}
                    >
                        {activeTab === "commander"
                            ? "Sequences - Automation"
                            : activeTab === "actions"
                                ? "Action Logic - HUD Layout"
                                : activeTab === "defaults"
                                    ? "Flow Defaults"
                                    : activeTab === "filters"
                                        ? "View Filters - Rooms FX"
                                        : activeTab === "templater"
                                            ? "Room & Deck Templates"
                                        : "Rooms - Legend - HUD"}
                    </div>
                </div>

                {/* nicer, but still subtle, expand/collapse icons */}
                {activeTab === "editor" && (
                    <div style={{ display: "flex", gap: 3 }}>
                        <IconBtn
                            label="++"
                            title="Expand all sections"
                            onClick={() => setExpandAllToken((t) => t + 1)}
                        />
                        <IconBtn
                            label="--"
                            title="Collapse all sections"
                            onClick={() => setCollapseAllToken((t) => t + 1)}
                        />
                    </div>
                )}
            </div>

            <div
                style={{
                    display: "flex",
                    gap: 6,
                    padding: "6px 10px",
                    borderBottom: "1px solid rgba(148,163,184,0.18)",
                    background: "rgba(15,23,42,0.55)",
                }}
            >
                {[
                    { key: "editor", label: "Editor" },
                    { key: "actions", label: "Actions" },
                    { key: "defaults", label: "Defaults" },
                    { key: "filters", label: "Filters" },
                    { key: "templater", label: "Templater" },
                    { key: "commander", label: "Commander" },
                ].map((tab) => {
                    const active = activeTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            style={{
                                border: "1px solid rgba(148,163,184,0.28)",
                                background: active ? "rgba(56,189,248,0.18)" : "rgba(15,23,42,0.4)",
                                color: active ? "rgba(226,241,255,0.95)" : "rgba(203,213,225,0.85)",
                                padding: "6px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                cursor: "pointer",
                            }}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Scrollable content */}
            <div
                className="glass-scroll"
                style={{
                    flex: 1,
                    padding: "8px 10px 10px",
                    overflowY: "auto",
                    display: "grid",
                    gap: 10,
                }}
            >
                {activeTab === "commander" && (
                    <Panel title="Commander">
                        <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>
                                Re-scaler
                            </div>
                            <label>
                                Mode
                                <Select
                                    value={rescaleMode}
                                    onChange={(e) => setRescaleMode(e.target.value)}
                                >
                                    <option value="match">Match master node</option>
                                    <option value="value">Reshape shape type</option>
                                </Select>
                            </label>
                            {rescaleMode === "match" ? (
                                <>
                                    <label>
                                        Filter nodes
                                        <Input
                                            value={rescaleMasterFilter}
                                            placeholder="Type to filter..."
                                            onChange={(e) => setRescaleMasterFilter(e.target.value)}
                                        />
                                    </label>
                                    <label>
                                        Master Node
                                        <Select
                                            value={rescaleMasterId}
                                            onChange={(e) => setRescaleMasterId(e.target.value)}
                                        >
                                            {rescaleMasterOptions.map((n) => (
                                                <option key={n.id} value={n.id}>
                                                    {n.label || n.name || n.id}
                                                </option>
                                            ))}
                                        </Select>
                                    </label>
                                    <label>
                                        Target Shape
                                        <Select
                                            value={rescaleTargetShape}
                                            onChange={(e) => setRescaleTargetShape(e.target.value)}
                                        >
                                            {shapeOptionsInUse.length ? (
                                                shapeOptionsInUse.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))
                                            ) : (
                                                <option value="">No shapes</option>
                                            )}
                                        </Select>
                                    </label>
                                </>
                            ) : (
                                <>
                                    <label>
                                        Target Shape
                                        <Select
                                            value={rescaleTargetShape}
                                            onChange={(e) => setRescaleTargetShape(e.target.value)}
                                        >
                                            {shapeOptionsInUse.length ? (
                                                shapeOptionsInUse.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))
                                            ) : (
                                                <option value="">No shapes</option>
                                            )}
                                        </Select>
                                    </label>
                                    <label>
                                        Scale
                                        <Input
                                            type="number"
                                            step="0.05"
                                            min="0.01"
                                            value={rescaleValue}
                                            onChange={(e) => setRescaleValue(Number(e.target.value) || 0)}
                                        />
                                    </label>
                                </>
                            )}
                            <Btn
                                variant="primary"
                                glow
                                disabled={!nodes?.length || !rescaleTargetShape || (rescaleMode === "match" && !rescaleMasterId)}
                                onClick={executeRescale}
                            >
                                Execute
                            </Btn>
                            <div style={{ height: 6 }} />
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>
                                Copy That Copy Cat
                            </div>
                            <label>
                                Master Room
                                <Select
                                    value={copyCatMasterRoomId}
                                    onChange={(e) => setCopyCatMasterRoomId(e.target.value)}
                                >
                                    {(rooms || []).map((r) => (
                                        <option key={r.id} value={r.id}>
                                            {r.name || r.id}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <label>
                                Target Room
                                <Select
                                    value={copyCatTargetRoomId}
                                    onChange={(e) => setCopyCatTargetRoomId(e.target.value)}
                                >
                                    {(rooms || []).map((r) => (
                                        <option key={r.id} value={r.id}>
                                            {r.name || r.id}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <Btn
                                variant="primary"
                                glow
                                disabled={
                                    !copyRoomNodesToRoom ||
                                    !copyCatMasterRoomId ||
                                    !copyCatTargetRoomId ||
                                    copyCatMasterRoomId === copyCatTargetRoomId
                                }
                                onClick={() =>
                                    copyRoomNodesToRoom &&
                                    copyRoomNodesToRoom(copyCatMasterRoomId, copyCatTargetRoomId)
                                }
                            >
                                Execute
                            </Btn>
                            <div style={{ height: 6 }} />
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>
                                Re-name Organizer
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.7 }}>
                                Renames nodes to "Room Name Type N" (or "Type N" when unassigned).
                            </div>
                            <Btn
                                variant="primary"
                                glow
                                disabled={!nodes?.length || !onRenameOrganizer}
                                onClick={() => onRenameOrganizer && onRenameOrganizer()}
                            >
                                Execute
                            </Btn>
                            <div style={{ height: 6 }} />
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>
                                Flow Adoption
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.7 }}>
                                Moves all outgoing flow links from the master node to the target node.
                            </div>
                            <label>
                                Filter master
                                <Input
                                    value={flowAdoptMasterFilter}
                                    placeholder="Type to filter..."
                                    onChange={(e) => setFlowAdoptMasterFilter(e.target.value)}
                                />
                            </label>
                            <label>
                                Master Node
                                <Select
                                    value={flowAdoptMasterId}
                                    onChange={(e) => setFlowAdoptMasterId(e.target.value)}
                                >
                                    {flowAdoptMasterOptions.map((n) => (
                                        <option key={n.id} value={n.id}>
                                            {n.label || n.name || n.id}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <label>
                                Filter target
                                <Input
                                    value={flowAdoptTargetFilter}
                                    placeholder="Type to filter..."
                                    onChange={(e) => setFlowAdoptTargetFilter(e.target.value)}
                                />
                            </label>
                            <label>
                                Target Node
                                <Select
                                    value={flowAdoptTargetId}
                                    onChange={(e) => setFlowAdoptTargetId(e.target.value)}
                                >
                                    {flowAdoptTargetOptions.map((n) => (
                                        <option key={n.id} value={n.id}>
                                            {n.label || n.name || n.id}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <Btn
                                variant="primary"
                                glow
                                disabled={
                                    !setLinks ||
                                    !flowAdoptMasterId ||
                                    !flowAdoptTargetId ||
                                    flowAdoptMasterId === flowAdoptTargetId
                                }
                                onClick={executeFlowAdoption}
                            >
                                Execute
                            </Btn>
                            <div style={{ height: 6 }} />
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>
                                Signals Commander
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.7 }}>
                                Bulk enable or disable node signals.
                            </div>
                            <label>
                                Mode
                                <Select value={signalBulkMode} onChange={(e) => setSignalBulkMode(e.target.value)}>
                                    <option value="enable">Enable</option>
                                    <option value="disable">Disable</option>
                                </Select>
                            </label>
                            <Btn
                                variant="primary"
                                glow
                                disabled={!nodes?.length}
                                onClick={executeSignalBulk}
                            >
                                Execute
                            </Btn>
                        </div>
                    </Panel>
                )}

                {activeTab === "actions" && (
                    <>
                        {ActionsPanel && (
                            <SectionDetails
                                title="Action Buttons (Logic)"
                                expandAllToken={expandAllToken}
                                collapseAllToken={collapseAllToken}
                            >
                                <ActionsPanel />
                            </SectionDetails>
                        )}

                        <SectionDetails
                            title="Action Buttons - HUD Grid Layout"
                            expandAllToken={expandAllToken}
                            collapseAllToken={collapseAllToken}
                        >
                            <Panel title="HUD Grid Layout">
                                <div style={{ display: "grid", gap: 8 }}>
                                    <Checkbox
                                        label="Enable grid layout mode"
                                        checked={!!hud.gridLayout}
                                        onChange={(v) => patchHud({ gridLayout: !!v })}
                                    />
                                    <Checkbox
                                        label="Move / arrange mode"
                                        checked={!!hud.moveMode}
                                        onChange={(v) => patchHud({ moveMode: !!v })}
                                    />
                                    <div
                                        style={{
                                            fontSize: 11,
                                            opacity: 0.8,
                                            marginTop: -4,
                                        }}
                                    >
                                        When move mode is on, drag HUD buttons to reposition instead of
                                        triggering them.
                                    </div>

                                    <label>
                                        Cell width (px)
                                        <Slider
                                            min={60}
                                            max={180}
                                            step={2}
                                            value={hud.cellSize}
                                            onChange={(v) => patchHud({ cellSize: v })}
                                        />
                                        <div style={{ fontSize: 11, opacity: 0.8 }}>
                                            {hud.cellSize.toFixed(0)} px
                                        </div>
                                    </label>

                                    <label>
                                        Row height (px)
                                        <Slider
                                            min={40}
                                            max={96}
                                            step={2}
                                            value={hud.rowHeight}
                                            onChange={(v) => patchHud({ rowHeight: v })}
                                        />
                                        <div style={{ fontSize: 11, opacity: 0.8 }}>
                                            {hud.rowHeight.toFixed(0)} px
                                        </div>
                                    </label>

                                    <label>
                                        Snap sensitivity
                                        <Slider
                                            min={0.05}
                                            max={0.95}
                                            step={0.05}
                                            value={hud.snapThreshold}
                                            onChange={(v) => patchHud({ snapThreshold: v })}
                                        />
                                        <div style={{ fontSize: 11, opacity: 0.8 }}>
                                            Snap at&nbsp;
                                            {(hud.snapThreshold * 100).toFixed(0)}% of cell
                                        </div>
                                    </label>

                                    <Btn
                                        variant="ghost"
                                        onClick={() =>
                                            patchHud({
                                                gridLayout: true,
                                                moveMode: false,
                                                cellSize: 90,
                                                rowHeight: 56,
                                                snapThreshold: 0.4,
                                            })
                                        }
                                    >
                                        Reset HUD grid defaults
                                    </Btn>
                                </div>
                            </Panel>
                        </SectionDetails>
                    </>
                )}

                {activeTab === "defaults" && (
                    <>
                        <div
                            style={{
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: 12,
                                padding: 12,
                                display: "grid",
                                gap: 10,
                            }}
                        >
                        <div
                            style={{
                                fontSize: 12,
                                fontWeight: 800,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: "rgba(226,232,240,0.85)",
                            }}
                        >
                            Room Behaviour
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <button
                                type="button"
                                onClick={() => defaultsImportRef.current?.click()}
                                style={{
                                    border: "1px solid rgba(56,189,248,0.45)",
                                    background: "rgba(14,116,144,0.22)",
                                    color: "rgba(224,242,254,0.95)",
                                    padding: "6px 10px",
                                    borderRadius: 8,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                            >
                                Import Defaults
                            </button>
                            <button
                                type="button"
                                onClick={exportDefaults}
                                style={{
                                    border: "1px solid rgba(34,197,94,0.45)",
                                    background: "rgba(34,197,94,0.2)",
                                    color: "rgba(220,252,231,0.95)",
                                    padding: "6px 10px",
                                    borderRadius: 8,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                            >
                                Export Defaults
                            </button>
                            <button
                                type="button"
                                onClick={() => setDefaultSimEnabled((v) => !v)}
                                style={{
                                    border: defaultSimEnabled
                                        ? "1px solid rgba(59,130,246,0.6)"
                                        : "1px solid rgba(255,255,255,0.14)",
                                    background: defaultSimEnabled
                                        ? "rgba(59,130,246,0.18)"
                                        : "rgba(15,23,42,0.6)",
                                    color: "rgba(226,232,240,0.9)",
                                    padding: "6px 10px",
                                    borderRadius: 8,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                            >
                                Default Simulation {defaultSimEnabled ? "On" : "Off"}
                            </button>
                            <Select
                                value={defaultSimId || ""}
                                onChange={(e) => setDefaultSimId(e.target.value)}
                                style={{
                                    minWidth: 180,
                                    background: "rgba(15,23,42,0.6)",
                                    color: "rgba(226,232,240,0.9)",
                                    border: "1px solid rgba(148,163,184,0.35)",
                                }}
                            >
                                <option value="">Select simulation...</option>
                                {(simulatePresets || []).map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name || p.id}
                                    </option>
                                ))}
                            </Select>
                            <input
                                ref={defaultsImportRef}
                                type="file"
                                accept="application/json"
                                style={{ display: "none" }}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) importDefaults(file);
                                    e.target.value = "";
                                }}
                            />
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <button
                                    type="button"
                                    title="Tile behaviour"
                                    onClick={() => {
                                        setTileBehaviorDialog({
                                            preview: false,
                                            roomId: "",
                                            align: "center",
                                            rotation: 0,
                                            shapeA: "",
                                            shapeB: "",
                                            spacing: 0.12,
                                        });
                                    }}
                                    style={{
                                        width: 34,
                                        height: 34,
                                        borderRadius: 10,
                                        display: "grid",
                                        placeItems: "center",
                                        border: "1px solid rgba(56,189,248,0.45)",
                                        background: "linear-gradient(145deg, rgba(56,189,248,0.2), rgba(15,23,42,0.6))",
                                        color: "rgba(226,232,240,0.9)",
                                        cursor: "pointer",
                                    }}
                                >
                                    <TileIcon size={16} />
                                </button>
                                <button
                                type="button"
                                title="Simulate room"
                                onClick={() => {
                                    const prefs = readSimulatePrefs();
                                    setSimulateDialog({
                                        preview: !!prefs.preview,
                                        roomId: prefs.roomId || "",
                                        items: Array.isArray(prefs.items) ? prefs.items : [],
                                    });
                                }}
                                    style={{
                                        width: 34,
                                        height: 34,
                                        borderRadius: 10,
                                        display: "grid",
                                        placeItems: "center",
                                        border: "1px solid rgba(34,197,94,0.45)",
                                        background: "linear-gradient(145deg, rgba(34,197,94,0.2), rgba(15,23,42,0.6))",
                                        color: "rgba(226,232,240,0.9)",
                                        cursor: "pointer",
                                    }}
                                >
                                    <GroupIcon size={16} />
                                </button>
                            </div>
                            <label style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 11, opacity: 0.7 }}>Search shapes</div>
                                <Input
                                    value={roomBehaviorQuery}
                                    onChange={(e) => setRoomBehaviorQuery(e.target.value)}
                                    placeholder="Type to filter shapes..."
                                />
                            </label>
                            <div style={{ display: "grid", gap: 6 }}>
                                {(roomBehaviorShapes
                                    .filter((shape) => {
                                        const q = String(roomBehaviorQuery || "").trim().toLowerCase();
                                        if (!q) return true;
                                        const name = String(shape.label || shape.value || "").toLowerCase();
                                        return name.includes(q) || String(shape.value || "").toLowerCase().includes(q);
                                    }))
                                    .map((shape) => {
                                    const role = getRoomRole(shape.value);
                                    const currentMaster = getRoomMaster(shape.value);
                                    const linkStyle = getRoomLinkStyle(shape.value);
                                    const linkKind = getRoomLinkKind(shape.value);
                                    const anchorEnabled = getRoomAnchorEnabled(shape.value);
                                    const targetOptions = roomBehaviorShapes
                                        .filter((opt) => opt.value !== shape.value)
                                        .slice()
                                        .sort((a, b) => String(a.label || a.value).localeCompare(String(b.label || b.value), undefined, { sensitivity: "base" }));
                                    const shapeLabel = String(shape.label || shape.value || "");
                                    let shortLabel = shapeLabel;
                                    const modelMatch = shapeLabel.match(/^Model:\\s*([^\\s]+)/i) || shapeLabel.match(/^Model\\s+([^\\s]+)/i);
                                    if (modelMatch) {
                                        shortLabel = `Model ${modelMatch[1]}`;
                                    }
                                    return (
                                        <div
                                            key={shape.value}
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "1fr auto auto auto auto auto auto",
                                                gap: 10,
                                                alignItems: "center",
                                                padding: "8px 6px",
                                                borderBottom: "1px solid rgba(148,163,184,0.18)",
                                                borderRadius: 10,
                                                background: "linear-gradient(90deg, rgba(30,41,59,0.25), rgba(15,23,42,0.05))",
                                            }}
                                        >
                                            <div
                                                title={shapeLabel}
                                                style={{
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                    color: "rgba(226,232,240,0.95)",
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                }}
                                            >
                                                {shortLabel}
                                            </div>
                                            <div style={{ display: "flex", gap: 6 }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setRoomRole(shape.value, "master")}
                                                    style={{
                                                        border: role === "master"
                                                            ? "1px solid rgba(59,130,246,0.6)"
                                                            : "1px solid rgba(255,255,255,0.12)",
                                                        background: role === "master"
                                                            ? "rgba(59,130,246,0.18)"
                                                            : "rgba(15,23,42,0.45)",
                                                        color: "rgba(226,232,240,0.9)",
                                                        padding: "4px 8px",
                                                        borderRadius: 8,
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    Master
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setRoomRole(shape.value, "slave")}
                                                    style={{
                                                        border: role === "slave"
                                                            ? "1px solid rgba(56,189,248,0.6)"
                                                            : "1px solid rgba(255,255,255,0.12)",
                                                        background: role === "slave"
                                                            ? "rgba(56,189,248,0.18)"
                                                            : "rgba(15,23,42,0.45)",
                                                        color: "rgba(226,232,240,0.9)",
                                                        padding: "4px 8px",
                                                        borderRadius: 8,
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    Slave
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                title={anchorEnabled ? "Anchors: On" : "Anchors: Off"}
                                                onClick={() => setRoomAnchorEnabled(shape.value, !anchorEnabled)}
                                                style={{
                                                    width: 28,
                                                    height: 28,
                                                    borderRadius: 8,
                                                    display: "grid",
                                                    placeItems: "center",
                                                    border: anchorEnabled
                                                        ? "1px solid rgba(56,189,248,0.6)"
                                                        : "1px solid rgba(255,255,255,0.12)",
                                                    background: anchorEnabled
                                                        ? "radial-gradient(circle at 35% 30%, rgba(56,189,248,0.65), rgba(8,47,73,0.55))"
                                                        : "rgba(15,23,42,0.45)",
                                                    color: anchorEnabled ? "#e0f2fe" : "rgba(226,232,240,0.8)",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <AnchorIcon size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                title={`Default tile: ${tileDefaults?.[shape.value]?.tileCode || "F-A1"}`}
                                            onClick={() => {
                                                const saved = tileDefaults?.[shape.value] || {};
                                                const prefs = readTileDialogPrefs();
                                                setTileDialog({
                                                    shapeKey: shape.value,
                                                    shapeLabel,
                                                    tileCode: saved.tileCode || "F-A1",
                                                    tileCodes: Array.isArray(saved.tileCodes)
                                                        ? saved.tileCodes
                                                        : (saved.tileCode ? [saved.tileCode] : []),
                                                    align: saved.align || prefs.align || "center",
                                                    rotation: Number(saved.rotation ?? prefs.rotation ?? 0) || 0,
                                                    offsetX: Number(saved.offsetX ?? prefs.offsetX ?? 0) || 0,
                                                    offsetY: Number(saved.offsetY ?? prefs.offsetY ?? 0) || 0,
                                                    offsetZ: Number(saved.offsetZ ?? prefs.offsetZ ?? 0) || 0,
                                                    preview: !!prefs.preview,
                                                    roomId: prefs.roomId || "",
                                                    previewShowFloor: prefs.previewShowFloor !== false,
                                                    previewShowCeiling: prefs.previewShowCeiling !== false,
                                                    previewShowWalls: prefs.previewShowWalls !== false,
                                                    multiPick: Array.isArray(saved.tileCodes) && saved.tileCodes.length > 1 ? true : !!prefs.multiPick,
                                                });
                                            }}
                                                style={{
                                                    width: 36,
                                                    height: 36,
                                                    borderRadius: 999,
                                                    display: "grid",
                                                    placeItems: "center",
                                                    border: (tileDefaults?.[shape.value]?.tileCodes?.length > 1)
                                                        ? "1px solid rgba(34,197,94,0.6)"
                                                        : "1px solid rgba(56,189,248,0.45)",
                                                    background: (tileDefaults?.[shape.value]?.tileCodes?.length > 1)
                                                        ? "radial-gradient(circle at 30% 25%, rgba(34,197,94,0.35), rgba(15,23,42,0.75))"
                                                        : "radial-gradient(circle at 30% 25%, rgba(56,189,248,0.35), rgba(15,23,42,0.75))",
                                                    color: "rgba(226,232,240,0.95)",
                                                    cursor: "pointer",
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    letterSpacing: "0.04em",
                                                }}
                                            >
                                                {(tileDefaults?.[shape.value]?.tileCode || "F-A1")}
                                            </button>
                                            <label style={{ display: "grid", gap: 4 }}>
                                                <div style={{ fontSize: 10, opacity: 0.7 }}>Master target</div>
                                                <div style={{ position: "relative" }}>
                                                    <input
                                                        value={roomMasterQuery?.[shape.value] ?? currentMaster}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setRoomMasterQuery((prev) => ({ ...(prev || {}), [shape.value]: val }));
                                                            if (role === "slave") {
                                                                const rect = e.target.getBoundingClientRect();
                                                                roomMasterAnchorRef.current = {
                                                                    ...(roomMasterAnchorRef.current || {}),
                                                                    [shape.value]: {
                                                                        left: rect.left,
                                                                        right: rect.right,
                                                                        top: rect.top,
                                                                        bottom: rect.bottom,
                                                                        width: rect.width,
                                                                    },
                                                                };
                                                                setRoomMasterOpenId(shape.value);
                                                            }
                                                        }}
                                                        onFocus={(e) => {
                                                            if (role === "slave") {
                                                                const rect = e.target.getBoundingClientRect();
                                                                roomMasterAnchorRef.current = {
                                                                    ...(roomMasterAnchorRef.current || {}),
                                                                    [shape.value]: {
                                                                        left: rect.left,
                                                                        right: rect.right,
                                                                        top: rect.top,
                                                                        bottom: rect.bottom,
                                                                        width: rect.width,
                                                                    },
                                                                };
                                                                setRoomMasterOpenId(shape.value);
                                                            }
                                                        }}
                                                        placeholder="Type to filter..."
                                                        disabled={role !== "slave"}
                                                        style={{
                                                            height: 28,
                                                            borderRadius: 6,
                                                            border: "1px solid rgba(148,163,184,0.35)",
                                                            background: role !== "slave" ? "rgba(148,163,184,0.08)" : "rgba(15,23,42,0.6)",
                                                            color: role !== "slave" ? "rgba(148,163,184,0.6)" : "#e2e8f0",
                                                            padding: "0 8px",
                                                            fontSize: 11,
                                                            width: "100%",
                                                        }}
                                                    />
                                                    {role === "slave" && roomMasterOpenId === shape.value && typeof document !== "undefined" && createPortal(
                                                        <div
                                                            onMouseDown={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                            }}
                                                            style={{
                                                                position: "fixed",
                                                                left: (roomMasterAnchorRef.current?.[shape.value]?.left ?? 0),
                                                                top: (roomMasterAnchorRef.current?.[shape.value]?.bottom ?? 0) + 8,
                                                                width: roomMasterAnchorRef.current?.[shape.value]?.width ?? 240,
                                                                maxHeight: 200,
                                                                overflow: "auto",
                                                                borderRadius: 8,
                                                                border: "1px solid rgba(148,163,184,0.35)",
                                                                background: "rgb(10,15,26)",
                                                                boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
                                                                zIndex: 10020,
                                                                pointerEvents: "auto",
                                                            }}
                                                        >
                                                            <button
                                                                type="button"
                                                                onMouseDown={(e) => e.preventDefault()}
                                                                onClick={() => {
                                                                    setRoomMaster(shape.value, "");
                                                                    setRoomMasterQuery((prev) => ({ ...(prev || {}), [shape.value]: "" }));
                                                                    setRoomMasterOpenId("");
                                                                }}
                                                                style={{
                                                                    width: "100%",
                                                                    textAlign: "left",
                                                                    padding: "6px 8px",
                                                                    fontSize: 11,
                                                                    background: "transparent",
                                                                    border: "none",
                                                                    color: "rgba(226,232,240,0.8)",
                                                                    cursor: "pointer",
                                                                }}
                                                            >
                                                                (none)
                                                            </button>
                                                            {targetOptions
                                                                .filter((opt) => {
                                                                    const q = String(roomMasterQuery?.[shape.value] ?? "").trim().toLowerCase();
                                                                    if (!q) return true;
                                                                    const name = String(opt.label || opt.value || "").toLowerCase();
                                                                    return name.includes(q);
                                                                })
                                                                .map((opt) => (
                                                                    <button
                                                                        key={opt.value}
                                                                        type="button"
                                                                        onMouseDown={(e) => e.preventDefault()}
                                                                        onClick={() => {
                                                                            setRoomMaster(shape.value, opt.value);
                                                                            setRoomMasterQuery((prev) => ({ ...(prev || {}), [shape.value]: opt.label || opt.value }));
                                                                            setRoomMasterOpenId("");
                                                                        }}
                                                                        style={{
                                                                            width: "100%",
                                                                            textAlign: "left",
                                                                            padding: "6px 8px",
                                                                            fontSize: 11,
                                                                            background: "transparent",
                                                                            border: "none",
                                                                            color: "rgba(226,232,240,0.95)",
                                                                            cursor: "pointer",
                                                                        }}
                                                                    >
                                                                        {opt.label}
                                                                    </button>
                                                                ))}
                                                        </div>,
                                                        document.body
                                                    )}
                                                </div>
                                            </label>
                                            <label style={{ display: "grid", gap: 4 }}>
                                                <div style={{ fontSize: 10, opacity: 0.7 }}>Link style</div>
                                                <Select
                                                    value={linkStyle}
                                                    onChange={(e) => setRoomLinkStyle(shape.value, e.target.value)}
                                                >
                                                    <option value="particles">Particles</option>
                                                    <option value="wavy">Wavy</option>
                                                    <option value="icons">Icons</option>
                                                    <option value="sweep">Sweep</option>
                                                    <option value="packet">Packet</option>
                                                    <option value="dashed">Dashed</option>
                                                    <option value="solid">Solid</option>
                                                    <option value="epic">Epic</option>
                                                    <option value="cable">Cable</option>
                                                </Select>
                                            </label>
                                            <label style={{ display: "grid", gap: 4 }}>
                                                <div style={{ fontSize: 10, opacity: 0.7 }}>Cable kind</div>
                                                <Select
                                                    value={linkKind}
                                                    onChange={(e) => setRoomLinkKind(shape.value, e.target.value)}
                                                    disabled={linkStyle !== "cable"}
                                                    style={{
                                                        background: linkStyle !== "cable" ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.14)",
                                                        color: linkStyle !== "cable" ? "rgba(148,163,184,0.6)" : "rgba(226,232,240,0.85)",
                                                        border: "1px solid rgba(148,163,184,0.35)",
                                                    }}
                                                >
                                                    <option value="">(none)</option>
                                                    <option value="wifi">Wi-Fi</option>
                                                    <option value="wired">Wired</option>
                                                    <option value="poe">PoE</option>
                                                    <option value="cat5e">Cat5e</option>
                                                    <option value="cat6">Cat6</option>
                                                    <option value="cat6a">Cat6a</option>
                                                    <option value="cat7">Cat7</option>
                                                    <option value="speaker">Speaker</option>
                                                    <option value="subwoofer">Subwoofer</option>
                                                    <option value="fiber">Fiber</option>
                                                </Select>
                                            </label>
                                        </div>
                                    );
                                })}
                                {roomBehaviorShapes.length === 0 && (
                                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                                        No shapes available.
                                    </div>
                                )}
                                {roomBehaviorShapes.length > 0 &&
                                    roomBehaviorShapes.filter((shape) => {
                                        const q = String(roomBehaviorQuery || "").trim().toLowerCase();
                                        if (!q) return true;
                                        const name = String(shape.label || shape.value || "").toLowerCase();
                                        return name.includes(q) || String(shape.value || "").toLowerCase().includes(q);
                                    }).length === 0 && (
                                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                                        No shapes match the search.
                                    </div>
                                )}
                            </div>
                        </div>
                        <div
                            style={{
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: 12,
                                padding: 12,
                                display: "grid",
                                gap: 10,
                            }}
                        >
                            <div
                                style={{
                                    fontSize: 12,
                                    fontWeight: 800,
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                    color: "rgba(226,232,240,0.85)",
                                }}
                            >
                                Cable Defaults
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                                {[
                                    { key: "", label: "(none)" },
                                    { key: "wifi", label: "Wi-Fi" },
                                    { key: "wired", label: "Wired" },
                                    { key: "poe", label: "PoE" },
                                    { key: "cat5e", label: "Cat5e" },
                                    { key: "cat6", label: "Cat6" },
                                    { key: "cat6a", label: "Cat6a" },
                                    { key: "cat7", label: "Cat7" },
                                    { key: "speaker", label: "Speaker" },
                                    { key: "subwoofer", label: "Subwoofer" },
                                    { key: "fiber", label: "Fiber" },
                                ].map((kind) => (
                                    <div
                                        key={kind.key || "none"}
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr auto",
                                            gap: 10,
                                            alignItems: "center",
                                            padding: "8px 6px",
                                            borderBottom: "1px solid rgba(148,163,184,0.18)",
                                            borderRadius: 10,
                                            background: "linear-gradient(90deg, rgba(30,41,59,0.25), rgba(15,23,42,0.05))",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <div
                                                style={{
                                                    width: 18,
                                                    height: 18,
                                                    borderRadius: 6,
                                                    background: cableKindDefaults?.[kind.key] || "#94a3b8",
                                                    border: "1px solid rgba(255,255,255,0.2)",
                                                    boxShadow: "0 0 0 2px rgba(15,23,42,0.6)",
                                                }}
                                            />
                                            <div>
                                                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(226,232,240,0.95)" }}>
                                                    {kind.label}
                                                </div>
                                                <div style={{ fontSize: 11, opacity: 0.7 }}>
                                                    {String(cableKindDefaults?.[kind.key] || "#94a3b8").toUpperCase()}
                                                </div>
                                            </div>
                                        </div>
                                        <Input
                                            type="color"
                                            aria-label={`Color for ${kind.label}`}
                                            value={cableKindDefaults?.[kind.key] || "#94a3b8"}
                                            onChange={(e) =>
                                                setCableKindDefaults((prev) => ({
                                                    ...(prev || {}),
                                                    [kind.key]: e.target.value,
                                                }))
                                            }
                                            style={{
                                                width: 32,
                                                height: 28,
                                                padding: 0,
                                                borderRadius: 8,
                                                border: "1px solid rgba(255,255,255,0.2)",
                                                background: "transparent",
                                                cursor: "pointer",
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                        {FlowDefaultsPanel && (
                            <SectionDetails
                                title="Flow Defaults"
                                expandAllToken={expandAllToken}
                                collapseAllToken={collapseAllToken}
                            >
                                <FlowDefaultsPanel />
                            </SectionDetails>
                        )}
                    </>
                )}

                {activeTab === "filters" && (
                    <>
                        {/* Rooms FX */}
                        <SectionDetails
                            title="Rooms FX (Wireframe Gap / Dissolve)"
                            expandAllToken={expandAllToken}
                            collapseAllToken={collapseAllToken}
                        >
                            <Panel title="Rooms FX (Wireframe Gap / Dissolve)">
                                <div style={{ display: "grid", gap: 8 }}>
                            <Checkbox
                                checked={roomGap.enabled}
                                onChange={(v) => setRoomGap((g) => ({ ...g, enabled: v }))}
                                label="enabled"
                            />
                            <label>
                                Shape
                                <Select
                                    value={roomGap.shape}
                                    onChange={(e) =>
                                        setRoomGap((g) => ({ ...g, shape: e.target.value }))
                                    }
                                >
                                    <option value="sphere">sphere</option>
                                    <option value="box">box</option>
                                </Select>
                            </label>
                            <label>
                                Center (x,y,z)
                                <Input
                                    value={roomGap.center.join(", ")}
                                    onChange={(e) => {
                                        const parts = e.target.value
                                            .split(",")
                                            .map((v) => Number(v.trim()));
                                        if (
                                            parts.length === 3 &&
                                            parts.every((v) => !Number.isNaN(v))
                                        )
                                            setRoomGap((g) => ({ ...g, center: parts }));
                                    }}
                                />
                            </label>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: 8,
                                }}
                            >
                                <label>
                                    Start radius
                                    <Slider
                                        value={roomGap.radius}
                                        min={0}
                                        max={6}
                                        step={0.01}
                                        onChange={(v) =>
                                            setRoomGap((g) => ({ ...g, radius: v }))
                                        }
                                    />
                                </label>
                                <label>
                                    End radius
                                    <Slider
                                        value={roomGap.endRadius}
                                        min={0}
                                        max={10}
                                        step={0.01}
                                        onChange={(v) =>
                                            setRoomGap((g) => ({ ...g, endRadius: v }))
                                        }
                                    />
                                </label>
                            </div>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: 8,
                                }}
                            >
                                <Checkbox
                                    checked={roomGap.animate}
                                    onChange={(v) =>
                                        setRoomGap((g) => ({ ...g, animate: v }))
                                    }
                                    label="animate"
                                />
                                <Checkbox
                                    checked={roomGap.loop}
                                    onChange={(v) =>
                                        setRoomGap((g) => ({ ...g, loop: v }))
                                    }
                                    label="loop"
                                />
                            </div>
                            <label>
                                Speed
                                <Slider
                                    value={roomGap.speed}
                                    min={0.05}
                                    max={3}
                                    step={0.05}
                                    onChange={(v) =>
                                        setRoomGap((g) => ({ ...(g || {}), speed: v }))
                                    }
                                />
                            </label>
                            <Btn
                                onClick={() => {
                                    if (modelBounds?.center) {
                                        setRoomGap((g) => ({
                                            ...(g || {}),
                                            center: modelBounds.center,
                                        }));
                                    }
                                }}
                            >
                                Center to model
                            </Btn>

                            <label>
                                Room base opacity
                                <Slider
                                    value={roomOpacity}
                                    min={0.02}
                                    max={0.5}
                                    step={0.01}
                                    onChange={(v) => setRoomOpacity(v)}
                                />
                            </label>
                        </div>
                    </Panel>
                </SectionDetails>

                {/* Filters & View */}
                <SectionDetails
                    title="Filters & View"
                    expandAllToken={expandAllToken}
                    collapseAllToken={collapseAllToken}
                >
                    <Panel title="Filters & View">
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, 1fr)",
                                gap: 8,
                            }}
                        >
                            <Btn onClick={() => setWireframe((v) => !v)}>
                                {wireframe ? "Wireframe: On" : "Wireframe: Off"}
                            </Btn>
                            <Btn onClick={() => setShowLights((v) => !v)}>
                                {showLights ? "Lights: On" : "Lights: Off"}
                            </Btn>
                            <Btn onClick={() => setShowLightBounds((v) => !v)}>
                                {showLightBounds ? "Light Bounds: On" : "Light Bounds: Off"}
                            </Btn>
                            <Btn onClick={() => setShowGround((v) => !v)}>
                                {showGround ? "Ground: On" : "Ground: Off"}
                            </Btn>
                            <Btn onClick={() => setAnimate((v) => !v)}>
                                {animate ? "Anim: On" : "Anim: Off"}
                            </Btn>
                            <Btn onClick={() => setLabelsOn((v) => !v)}>
                                {labelsOn ? "Labels: On" : "Labels: Off"}
                            </Btn>
                            <Btn onClick={() => setHudButtonsVisible && setHudButtonsVisible((v) => !v)}>
                                {hudButtonsVisible ? "HUD Actions: Shown" : "HUD Actions: Hidden"}
                            </Btn>
                        </div>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 8,
                                marginTop: 8,
                            }}
                        >
                            <label>
                                <div style={{ fontSize: 10, opacity: 0.8 }}>Perf</div>
                                <Select
                                    value={perf}
                                    onChange={(e) => setPerf(e.target.value)}
                                >
                                    <option value="low">Low</option>
                                    <option value="med">Medium</option>
                                    <option value="high">High</option>
                                </Select>
                            </label>
                            <label>
                                <div style={{ fontSize: 10, opacity: 0.8 }}>BG</div>
                                <Input
                                    type="color"
                                    value={bg}
                                    onChange={(e) => setBg(e.target.value)}
                                />
                            </label>
                        </div>
                    </Panel>

                    {/* Ground grid controls */}
                    {setGridConfig && (
                        <Panel title="Ground Grid">
                            <div style={{ display: "grid", gap: 10 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                                    <Checkbox
                                        label="Enable grid"
                                        checked={gridConfig?.enabled ?? true}
                                        onChange={(v) => patchGrid({ enabled: !!v })}
                                    />
                                    <Checkbox
                                        label="3D grid space"
                                        checked={!!gridConfig?.space3D}
                                        onChange={(v) => patchGrid({ space3D: !!v })}
                                    />
                                    <Checkbox
                                        label="Follow camera"
                                        checked={!!gridConfig?.followCamera}
                                        onChange={(v) => patchGrid({ followCamera: !!v })}
                                    />
                                    <Checkbox
                                        label="Show origin axes"
                                        checked={!!gridConfig?.showAxes}
                                        onChange={(v) => patchGrid({ showAxes: !!v })}
                                    />
                                    <Checkbox
                                        label="Show ground plane"
                                        checked={gridConfig?.showPlane ?? true}
                                        onChange={(v) => patchGrid({ showPlane: !!v })}
                                    />
                                    <Checkbox
                                        label="Highlight selection tiles"
                                        checked={!!gridConfig?.highlightSelection}
                                        onChange={(v) => patchGrid({ highlightSelection: !!v })}
                                    />
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Grid Color</div>
                                        <Input
                                            type="color"
                                            value={gridConfig?.color || "#4aa3ff"}
                                            onChange={(e) => patchGrid({ color: e.target.value })}
                                        />
                                    </label>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Grid Transparency</div>
                                        <Slider
                                            value={Number.isFinite(Number(gridConfig?.opacity)) ? Number(gridConfig?.opacity) : 0.35}
                                            min={0}
                                            max={1}
                                            step={0.01}
                                            onChange={(v) => patchGrid({ opacity: v })}
                                        />
                                        <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
                                            {Math.round((Number.isFinite(Number(gridConfig?.opacity)) ? Number(gridConfig?.opacity) : 0.35) * 100)}%
                                        </div>
                                    </label>
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Cell Size</div>
                                        <Input
                                            type="number"
                                            step="0.05"
                                            min="0.01"
                                            value={Number.isFinite(Number(gridConfig?.cellSize)) ? Number(gridConfig?.cellSize) : (placement?.snap ?? 0.25)}
                                            onChange={(e) => {
                                                const v = Math.max(0.01, Number(e.target.value) || 0.25);
                                                patchGrid({ cellSize: v });
                                                if ((gridConfig?.linkSnap ?? true) && setPlacement) {
                                                    setPlacement((p) => ({ ...(p || {}), snap: v }));
                                                }
                                            }}
                                        />
                                    </label>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Major line every (cells)</div>
                                        <Input
                                            type="number"
                                            step="1"
                                            min="1"
                                            value={Number.isFinite(Number(gridConfig?.majorEvery)) ? Number(gridConfig?.majorEvery) : 10}
                                            onChange={(e) => {
                                                const v = Math.max(1, Math.round(Number(e.target.value) || 10));
                                                patchGrid({ majorEvery: v });
                                            }}
                                        />
                                    </label>
                                </div>

                                <label>
                                    <div style={{ fontSize: 10, opacity: 0.8 }}>Grid Reach (fade distance)</div>
                                    <Slider
                                        value={Number.isFinite(Number(gridConfig?.fadeDistance)) ? Number(gridConfig?.fadeDistance) : 100}
                                        min={5}
                                        max={800}
                                        step={1}
                                        onChange={(v) => patchGrid({ fadeDistance: v })}
                                    />
                                </label>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Cell thickness</div>
                                        <Slider
                                            value={Number.isFinite(Number(gridConfig?.cellThickness)) ? Number(gridConfig?.cellThickness) : 0.85}
                                            min={0.05}
                                            max={3.0}
                                            step={0.05}
                                            onChange={(v) => patchGrid({ cellThickness: v })}
                                        />
                                    </label>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Section thickness</div>
                                        <Slider
                                            value={Number.isFinite(Number(gridConfig?.sectionThickness)) ? Number(gridConfig?.sectionThickness) : 1.15}
                                            min={0.05}
                                            max={4.0}
                                            step={0.05}
                                            onChange={(v) => patchGrid({ sectionThickness: v })}
                                        />
                                    </label>
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                                    <Checkbox
                                        label="Link snap to grid"
                                        checked={gridConfig?.linkSnap ?? true}
                                        onChange={(v) => {
                                            patchGrid({ linkSnap: !!v });
                                            if (!!v && setPlacement) {
                                                const cell = Number(gridConfig?.cellSize);
                                                if (Number.isFinite(cell) && cell > 0) setPlacement((p) => ({ ...(p || {}), snap: cell }));
                                            }
                                        }}
                                    />
                                    <Checkbox
                                        label="Snap preview ghost"
                                        checked={gridConfig?.snapGhostEnabled ?? true}
                                        onChange={(v) => patchGrid({ snapGhostEnabled: !!v })}
                                    />
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Snap Mode</div>
                                        <Select
                                            value={String(gridConfig?.snapMode || "vertices")}
                                            onChange={(e) => patchGrid({ snapMode: e.target.value })}
                                        >
                                            <option value="off">off</option>
                                            <option value="vertices">grid vertices</option>
                                            <option value="tiles">grid tiles</option>
                                        </Select>
                                    </label>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Tile centering</div>
                                        <Select
                                            value={String(gridConfig?.snapTilesCenterMove || "auto")}
                                            onChange={(e) => patchGrid({ snapTilesCenterMove: e.target.value })}
                                        >
                                            <option value="auto">auto</option>
                                            <option value="off">off</option>
                                        </Select>
                                    </label>
                                </div>

                                {!!gridConfig?.snapGhostEnabled && (
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            <div style={{ fontSize: 10, opacity: 0.8 }}>Ghost color</div>
                                            <Input
                                                type="color"
                                                value={gridConfig?.snapGhostColor || "#7dd3fc"}
                                                onChange={(e) => patchGrid({ snapGhostColor: e.target.value })}
                                            />
                                        </label>
                                        <label>
                                            <div style={{ fontSize: 10, opacity: 0.8 }}>Ghost opacity</div>
                                            <Slider
                                                value={Number.isFinite(Number(gridConfig?.snapGhostOpacity)) ? Number(gridConfig?.snapGhostOpacity) : 0.22}
                                                min={0.02}
                                                max={0.8}
                                                step={0.01}
                                                onChange={(v) => patchGrid({ snapGhostOpacity: v })}
                                            />
                                        </label>
                                    </div>
                                )}

                                {!!gridConfig?.space3D && (
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            <div style={{ fontSize: 10, opacity: 0.8 }}>3D count (each side)</div>
                                            <Input
                                                type="number"
                                                step="1"
                                                min="0"
                                                value={Number.isFinite(Number(gridConfig?.space3DCount)) ? Number(gridConfig?.space3DCount) : 4}
                                                onChange={(e) => patchGrid({ space3DCount: Math.max(0, Math.min(24, Math.round(Number(e.target.value) || 0))) })}
                                            />
                                        </label>
                                        <label>
                                            <div style={{ fontSize: 10, opacity: 0.8 }}>3D step</div>
                                            <Input
                                                type="number"
                                                step="0.25"
                                                min="0.1"
                                                value={Number.isFinite(Number(gridConfig?.space3DStep)) ? Number(gridConfig?.space3DStep) : 5}
                                                onChange={(e) => patchGrid({ space3DStep: Math.max(0.1, Number(e.target.value) || 5) })}
                                            />
                                        </label>
                                        <Checkbox
                                            label="Show XY walls"
                                            checked={gridConfig?.space3DXY ?? true}
                                            onChange={(v) => patchGrid({ space3DXY: !!v })}
                                        />
                                        <Checkbox
                                            label="Show YZ walls"
                                            checked={gridConfig?.space3DYZ ?? true}
                                            onChange={(v) => patchGrid({ space3DYZ: !!v })}
                                        />
                                    </div>
                                )}

                                {!!gridConfig?.highlightSelection && (
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Selection highlight opacity</div>
                                        <Slider
                                            value={Number.isFinite(Number(gridConfig?.highlightOpacity)) ? Number(gridConfig?.highlightOpacity) : 0.18}
                                            min={0.02}
                                            max={0.85}
                                            step={0.01}
                                            onChange={(v) => patchGrid({ highlightOpacity: v })}
                                        />
                                    </label>
                                )}

                                <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.35 }}>
                                    Tip: Cell size controls how big each grid square is. With "Link snap to grid" enabled,
                                    placement snapping uses the same value.
                                </div>
                            </div>
                        </Panel>
                    )}

                    {setGridConfig && (
                        <Panel title="Floors / Decks">
                            <div style={{ display: "grid", gap: 10 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                                    <Checkbox
                                        label="Enable floors"
                                        checked={!!gridConfig?.floorsEnabled}
                                        onChange={(v) => patchGrid({ floorsEnabled: !!v })}
                                    />
                                    <Checkbox
                                        label="Snap vertical to floors"
                                        checked={!!gridConfig?.snapToFloors}
                                        onChange={(v) => patchGrid({ snapToFloors: !!v })}
                                    />
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Snap floor mode</div>
                                        <Select
                                            value={String(gridConfig?.snapFloorMode || "nearest")}
                                            onChange={(e) => patchGrid({ snapFloorMode: e.target.value })}
                                        >
                                            <option value="nearest">nearest</option>
                                            <option value="active">active</option>
                                        </Select>
                                    </label>
                                    <label>
                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Vertical align</div>
                                        <Select
                                            value={String(gridConfig?.floorSnapAlign || "base")}
                                            onChange={(e) => patchGrid({ floorSnapAlign: e.target.value })}
                                        >
                                            <option value="base">base to floor</option>
                                            <option value="center">center to floor</option>
                                        </Select>
                                    </label>
                                </div>

                                <label>
                                    <div style={{ fontSize: 10, opacity: 0.8 }}>Active floor</div>
                                    <Select
                                        value={String(gridConfig?.activeFloorId || "ground")}
                                        onChange={(e) => patchGrid({ activeFloorId: e.target.value })}
                                    >
                                        {allFloorsForSelect.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                </label>

                                <div
                                    style={{
                                        padding: 10,
                                        borderRadius: 12,
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        background: "rgba(255,255,255,0.03)",
                                        display: "grid",
                                        gap: 8,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div style={{ fontSize: 12, fontWeight: 800 }}>Auto floors</div>
                                        <Checkbox
                                            label="enabled"
                                            checked={!!gridConfig?.floorsAutoEnabled}
                                            onChange={(v) => patchGrid({ floorsAutoEnabled: !!v, floorsEnabled: true })}
                                        />
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            <div style={{ fontSize: 10, opacity: 0.8 }}>Base Y</div>
                                            <Input
                                                type="number"
                                                step="0.25"
                                                value={Number.isFinite(Number(gridConfig?.floorsAutoBaseY)) ? Number(gridConfig?.floorsAutoBaseY) : baseFloorY}
                                                onChange={(e) => patchGrid({ floorsAutoBaseY: Number(e.target.value) || 0, floorsEnabled: true })}
                                            />
                                        </label>
                                        <label>
                                            <div style={{ fontSize: 10, opacity: 0.8 }}>Step</div>
                                            <Input
                                                type="number"
                                                step="0.25"
                                                min="0.1"
                                                value={Number.isFinite(Number(gridConfig?.floorsAutoStep)) ? Number(gridConfig?.floorsAutoStep) : 2}
                                                onChange={(e) => patchGrid({ floorsAutoStep: Math.max(0.1, Number(e.target.value) || 2), floorsEnabled: true })}
                                            />
                                        </label>
                                        <label>
                                            <div style={{ fontSize: 10, opacity: 0.8 }}>Count</div>
                                            <Input
                                                type="number"
                                                step="1"
                                                min="0"
                                                max="64"
                                                value={Number.isFinite(Number(gridConfig?.floorsAutoCount)) ? Number(gridConfig?.floorsAutoCount) : 0}
                                                onChange={(e) => patchGrid({ floorsAutoCount: Math.max(0, Math.min(64, Math.round(Number(e.target.value) || 0))), floorsEnabled: true })}
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div
                                    style={{
                                        padding: 10,
                                        borderRadius: 12,
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        background: "rgba(255,255,255,0.03)",
                                        display: "grid",
                                        gap: 8,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div style={{ fontSize: 12, fontWeight: 800 }}>Manual decks</div>
                                        <Btn onClick={addManualFloor}>
                                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><PlusIcon size={14} /> Add</span>
                                        </Btn>
                                    </div>

                                    {!floorsManual.length && (
                                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                                            No manual decks yet. Add one to create a named floor layer.
                                        </div>
                                    )}

                                    {floorsManual.map((f, idx) => {
                                        const vis = f?.visible !== false;
                                        const y = Number.isFinite(Number(f?.y)) ? Number(f.y) : 0;
                                        return (
                                            <div
                                                key={f.id}
                                                style={{
                                                    borderRadius: 12,
                                                    border: "1px solid rgba(255,255,255,0.10)",
                                                    background: "rgba(0,0,0,0.22)",
                                                    padding: 10,
                                                    display: "grid",
                                                    gap: 8,
                                                }}
                                            >
                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                                                        <IconBtn
                                                            title={vis ? "Hide" : "Show"}
                                                            onClick={() => updateManualFloor(f.id, { visible: !vis })}
                                                        >
                                                            {vis ? <EyeIcon /> : <EyeOffIcon />}
                                                        </IconBtn>
                                                        <Input
                                                            value={f.name || ""}
                                                            placeholder={`Deck ${idx + 1}`}
                                                            onChange={(e) => updateManualFloor(f.id, { name: e.target.value })}
                                                        />
                                                    </div>

                                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                        <IconBtn
                                                            title="Move up"
                                                            disabled={idx === 0}
                                                            onClick={() => moveManualFloor(f.id, "up")}
                                                        >
                                                            <ChevronUpIcon />
                                                        </IconBtn>
                                                        <IconBtn
                                                            title="Move down"
                                                            disabled={idx === floorsManual.length - 1}
                                                            onClick={() => moveManualFloor(f.id, "down")}
                                                        >
                                                            <ChevronDownIcon />
                                                        </IconBtn>
                                                        <IconBtn title="Delete" onClick={() => deleteManualFloor(f.id)}>
                                                            <TrashIcon />
                                                        </IconBtn>
                                                    </div>
                                                </div>

                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                                    <label>
                                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Y</div>
                                                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                            <IconBtn title="Down" onClick={() => bumpManualFloorY(f.id, -floorsAutoStep)}><MinusIcon size={14} /></IconBtn>
                                                            <Input
                                                                type="number"
                                                                step="0.25"
                                                                value={y}
                                                                onChange={(e) => updateManualFloor(f.id, { y: Number(e.target.value) || 0 })}
                                                            />
                                                            <IconBtn title="Up" onClick={() => bumpManualFloorY(f.id, floorsAutoStep)}><PlusIcon size={14} /></IconBtn>
                                                        </div>
                                                    </label>
                                                    <label>
                                                        <div style={{ fontSize: 10, opacity: 0.8 }}>Color</div>
                                                        <Input
                                                            type="color"
                                                            value={f.color || gridConfig?.color || "#4aa3ff"}
                                                            onChange={(e) => updateManualFloor(f.id, { color: e.target.value })}
                                                        />
                                                    </label>
                                                </div>

                                                <label>
                                                    <div style={{ fontSize: 10, opacity: 0.8 }}>Opacity</div>
                                                    <Slider
                                                        value={Number.isFinite(Number(f?.opacity)) ? Number(f.opacity) : (Number.isFinite(Number(gridConfig?.opacity)) ? Number(gridConfig.opacity) : 0.35)}
                                                        min={0}
                                                        max={1}
                                                        step={0.01}
                                                        onChange={(v) => updateManualFloor(f.id, { opacity: v })}
                                                    />
                                                </label>

                                                <div style={{ fontSize: 11, opacity: 0.7 }}>
                                                    Use this as a named "deck" layer. Toggle visibility to declutter.
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </Panel>
                    )}

                </SectionDetails>
                    </>
                )}

                {activeTab === "templater" && (
                    <Panel title="Templater">
                        <style>{`
                            .wizard-btn {
                                position: relative;
                                display: inline-flex;
                                align-items: center;
                                gap: 8px;
                                padding: 8px 12px;
                                border-radius: 10px;
                                border: 1px solid rgba(56,189,248,0.45);
                                background: linear-gradient(135deg, rgba(14,116,144,0.35), rgba(15,23,42,0.8));
                                color: #e2f2ff;
                                font-weight: 700;
                                letter-spacing: 0.04em;
                                cursor: pointer;
                                overflow: hidden;
                                transition: transform 0.15s ease, box-shadow 0.2s ease;
                            }
                            .wizard-btn:hover {
                                transform: translateY(-1px);
                                box-shadow: 0 10px 20px rgba(56,189,248,0.25);
                            }
                            .wizard-spark {
                                position: absolute;
                                width: 6px;
                                height: 6px;
                                border-radius: 999px;
                                background: radial-gradient(circle, rgba(253,224,71,0.95), rgba(56,189,248,0.15));
                                opacity: 0;
                                animation: wizard-spark 1.6s ease-in-out infinite;
                                pointer-events: none;
                            }
                            .wizard-spark.s1 { left: 10px; top: 6px; animation-delay: 0s; }
                            .wizard-spark.s2 { right: 12px; top: 10px; animation-delay: 0.4s; }
                            .wizard-spark.s3 { left: 50%; bottom: 6px; animation-delay: 0.8s; }
                            .wizard-btn:hover .wizard-spark { opacity: 1; }
                            @keyframes wizard-spark {
                                0% { transform: translateY(4px) scale(0.7); opacity: 0; }
                                50% { transform: translateY(-2px) scale(1); opacity: 0.9; }
                                100% { transform: translateY(6px) scale(0.6); opacity: 0; }
                            }
                        `}</style>
                        <div style={{ display: "grid", gap: 10 }}>
                            <div style={{ fontSize: 12, opacity: 0.8 }}>
                                Build unplaced rooms/decks before you draw them. Items created here are tagged as <b>unplaced</b>.
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <button type="button" className="wizard-btn" onClick={() => setTemplaterWizardOpen(true)}>
                                    <WizardHatIcon size={16} />
                                    Wizard
                                    <span className="wizard-spark s1" />
                                    <span className="wizard-spark s2" />
                                    <span className="wizard-spark s3" />
                                </button>
                                <button
                                    type="button"
                                    className="wizard-btn"
                                    onClick={() => setTemplaterSetupDialog(true)}
                                    style={{
                                        border: "1px solid rgba(167,139,250,0.55)",
                                        background: "linear-gradient(135deg, rgba(99,102,241,0.35), rgba(15,23,42,0.85))",
                                    }}
                                >
                                    <TargetIcon size={16} />
                                    Set-ups
                                    <span className="wizard-spark s1" />
                                    <span className="wizard-spark s2" />
                                    <span className="wizard-spark s3" />
                                </button>
                                <div style={{ fontSize: 11, opacity: 0.7 }}>
                                    Create a building shopping list.
                                </div>
                            </div>
                        </div>
                    </Panel>
                )}

                {activeTab === "editor" && (
                    <>
                    <div style={{ display: "grid", gap: 8 }}>
                        <div style={{
                            fontSize: 10,
                            letterSpacing: "0.22em",
                            textTransform: "uppercase",
                            color: "rgba(226,232,240,0.7)",
                        }}>
                            Room Shapes
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 6 }}>
                            {[
                                {
                                    key: "room_box",
                                    label: "Room Box",
                                    Icon: RoomBoxIcon,
                                    active: placement.placeKind === "room" && (placement.roomDrawMode || "box") === "box" && placement.armed,
                                    onClick: () => setPlacement((p) => {
                                        const same = p.placeKind === "room" && (p.roomDrawMode || "box") === "box" && p.armed;
                                        return { ...p, placeKind: "room", roomDrawMode: "box", armed: !same };
                                    })
                                },
                                {
                                    key: "room_points",
                                    label: "Room Points",
                                    Icon: RoomPointsIcon,
                                    active: placement.placeKind === "room" && (placement.roomDrawMode || "box") === "points" && placement.armed,
                                    onClick: () => setPlacement((p) => {
                                        const same = p.placeKind === "room" && (p.roomDrawMode || "box") === "points" && p.armed;
                                        return { ...p, placeKind: "room", roomDrawMode: "points", armed: !same };
                                    })
                                },
                                {
                                    key: "room_mirror",
                                    label: "Mirror",
                                    Icon: MirrorIcon,
                                    active: false,
                                    disabled: !mirrorRoomEnabled,
                                    onClick: () => {
                                        if (!mirrorRoomEnabled) return;
                                        window.dispatchEvent(new Event("EPIC3D_MIRROR_ROOM_POINTS"));
                                    },
                                },
                            ].map((item) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={item.onClick}
                                    title={item.label}
                                    disabled={!!item.disabled}
                                    style={{
                                        borderRadius: 10,
                                        border: item.active
                                            ? "1px solid rgba(56,189,248,0.8)"
                                            : "1px solid rgba(255,255,255,0.14)",
                                        background: item.active
                                            ? "radial-gradient(circle at 30% 25%, rgba(94,234,212,0.45), rgba(15,23,42,0.85))"
                                            : "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                        color: item.active ? "rgba(224,242,254,0.98)" : "rgba(226,232,240,0.82)",
                                        opacity: item.disabled ? 0.35 : 1,
                                        padding: "6px",
                                        display: "grid",
                                        placeItems: "center",
                                        gap: 4,
                                        boxShadow: item.active
                                            ? "0 8px 18px rgba(56,189,248,0.4)"
                                            : "none",
                                        cursor: item.disabled ? "not-allowed" : "pointer",
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 24,
                                            height: 24,
                                            borderRadius: 8,
                                            display: "grid",
                                            placeItems: "center",
                                            background: item.active
                                                ? "radial-gradient(circle at 35% 30%, rgba(94,234,212,0.7), rgba(8,47,73,0.65))"
                                                : "linear-gradient(160deg, rgba(8,13,22,0.95), rgba(12,20,36,0.95))",
                                            border: item.active ? "1px solid rgba(94,234,212,0.5)" : "1px solid rgba(255,255,255,0.12)",
                                        }}
                                    >
                                        <item.Icon size={14} />
                                    </div>
                                    <span
                                        style={{
                                            fontSize: 9,
                                            lineHeight: 1.1,
                                            textAlign: "center",
                                            letterSpacing: "0.08em",
                                            textTransform: "uppercase",
                                            opacity: 0.75,
                                            maxWidth: "100%",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {item.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <button
                                type="button"
                                onClick={() => setPlacement((p) => ({ ...p, roomHeightScale: !(p?.roomHeightScale !== false) }))}
                                style={{
                                    borderRadius: 10,
                                    border: (placement?.roomHeightScale !== false)
                                        ? "1px solid rgba(56,189,248,0.6)"
                                        : "1px solid rgba(255,255,255,0.14)",
                                    background: (placement?.roomHeightScale !== false)
                                        ? "rgba(56,189,248,0.18)"
                                        : "rgba(15,23,42,0.6)",
                                    color: "rgba(226,232,240,0.9)",
                                    padding: "6px 10px",
                                    fontSize: 10,
                                    fontWeight: 700,
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                    cursor: "pointer",
                                }}
                                title="Toggle height scaling while drawing room boxes"
                            >
                                Height Scale {placement?.roomHeightScale === false ? "Off" : "On"}
                            </button>
                            {placement?.roomHeightScale === false && (
                                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                                    <span style={{ opacity: 0.75 }}>Height</span>
                                    <Input
                                        type="number"
                                        min={0.2}
                                        step={0.1}
                                        value={Number(placement?.roomHeightValue ?? 1.6)}
                                        onChange={(e) => {
                                            const val = Math.max(0.2, Number(e.target.value) || 0.2);
                                            setPlacement((p) => ({ ...(p || {}), roomHeightValue: val }));
                                        }}
                                        style={{ width: 80 }}
                                    />
                                </label>
                            )}
                        </div>
                    <div style={{
                        fontSize: 10,
                        letterSpacing: "0.22em",
                        textTransform: "uppercase",
                        color: "rgba(226,232,240,0.7)",
                        marginTop: 2,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }}>
                        <span>Shapes</span>
                        {multiPlacementActive && (
                            <span
                                style={{
                                    fontSize: 9,
                                    letterSpacing: "0.18em",
                                    color: "rgba(56,189,248,0.7)",
                                    border: "1px solid rgba(56,189,248,0.35)",
                                    borderRadius: 999,
                                    padding: "2px 6px",
                                    textTransform: "uppercase",
                                }}
                            >
                                Multi Placement ON
                            </span>
                        )}
                    </div>
                    <Input
                        value={shapeSearch}
                        onChange={(e) => setShapeSearch(e.target.value)}
                        placeholder="Search shapes"
                    />
                        <div style={{ position: "relative" }}>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(6, minmax(0,1fr))",
                                    gap: 6,
                                    position: "relative",
                                }}
                            >
                                {shapePalette.filter((shape) => {
                                    const q = String(shapeSearch || "").trim().toLowerCase();
                                    if (!q) return true;
                                    return String(shape.label || "").toLowerCase().includes(q);
                                }).map((shape) => {
                                const active = placement.placeKind === "node" && placement.armed && placement.nodeShape === shape.key;
                                const Icon = shape.Icon;
                                return (
                                    <button
                                        key={shape.key}
                                        type="button"
                                        onClick={() =>
                                            setPlacement((p) => {
                                                const same = p.placeKind === "node" && p.nodeShape === shape.key && p.armed;
                                                return { ...p, placeKind: "node", nodeShape: shape.key, armed: !same };
                                            })
                                        }
                                        title={`Place ${shape.label}`}
                                        onMouseEnter={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setShapeHoverPreview({
                                                key: shape.key,
                                                label: shape.label,
                                                Icon,
                                                x: rect.right + 8,
                                                y: rect.top + rect.height / 2,
                                            });
                                        }}
                                        onMouseMove={(e) => {
                                            if (!shapeHoverPreview) return;
                                            setShapeHoverPreview((prev) => ({
                                                ...(prev || {}),
                                                x: e.clientX + 12,
                                                y: e.clientY,
                                            }));
                                        }}
                                        onMouseLeave={() => setShapeHoverPreview(null)}
                                        style={{
                                            borderRadius: 10,
                                            border: active ? "1px solid rgba(56,189,248,0.8)" : "1px solid rgba(255,255,255,0.14)",
                                            background: active
                                                ? "radial-gradient(circle at 30% 25%, rgba(125,211,252,0.4), rgba(15,23,42,0.85))"
                                                : "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                            color: active ? "rgba(224,242,254,0.98)" : "rgba(226,232,240,0.82)",
                                            padding: "6px",
                                            display: "grid",
                                            placeItems: "center",
                                            gap: 4,
                                            boxShadow: active
                                                ? "0 8px 18px rgba(56,189,248,0.4)"
                                                : "none",
                                            cursor: "pointer",
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: 24,
                                                height: 24,
                                                borderRadius: 8,
                                                display: "grid",
                                                placeItems: "center",
                                                background: active
                                                ? "radial-gradient(circle at 35% 30%, rgba(125,211,252,0.75), rgba(8,47,73,0.65))"
                                                : "linear-gradient(160deg, rgba(8,13,22,0.95), rgba(12,20,36,0.95))",
                                            border: active ? "1px solid rgba(125,211,252,0.45)" : "1px solid rgba(255,255,255,0.12)",
                                            }}
                                        >
                                            <Icon size={14} />
                                        </div>
                                        <span
                                            style={{
                                                fontSize: 9,
                                                lineHeight: 1.1,
                                                textAlign: "center",
                                                letterSpacing: "0.08em",
                                                textTransform: "uppercase",
                                                opacity: 0.75,
                                                maxWidth: "100%",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {shape.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        </div>
                    </div>

                
                {/* Legend */}
                <div style={{ display: "grid", gap: 0 }}>
                    <div style={{
                        fontSize: 10,
                        letterSpacing: "0.22em",
                        textTransform: "uppercase",
                        color: "rgba(226,232,240,0.7)",
                        marginTop: 0,
                        marginBottom: 0,
                    }}>
                        Legend{legendGroupView ? " (Group view)" : ""}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 0, marginTop: 0 }}>
                            <button
                                type="button"
                                title="Create a new deck"
                                onClick={() => addDeck?.()}
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 10,
                                    display: "grid",
                                    placeItems: "center",
                                background: "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                border: "1px solid rgba(148,163,184,0.25)",
                                color: "rgba(226,232,240,0.75)",
                                cursor: "pointer",
                            }}
                        >
                            <PlusIcon size={14} />
                        </button>
                        <button
                            type="button"
                            title={`Auto follow selection: ${autoFollowSelection ? "On" : "Off"}`}
                            onClick={() => setAutoFollowSelection?.(!autoFollowSelection)}
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                display: "grid",
                                placeItems: "center",
                                background: autoFollowSelection
                                    ? "radial-gradient(circle at 35% 30%, rgba(56,189,248,0.85), rgba(8,47,73,0.65))"
                                    : "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                border: autoFollowSelection ? "1px solid rgba(56,189,248,0.6)" : "1px solid rgba(148,163,184,0.25)",
                                color: autoFollowSelection ? "#e0f2fe" : "rgba(226,232,240,0.75)",
                                boxShadow: autoFollowSelection ? "0 0 14px rgba(56,189,248,0.35)" : "0 0 0 rgba(0,0,0,0)",
                                cursor: "pointer",
                            }}
                        >
                            <TargetIcon size={14} />
                        </button>
                        <button
                            type="button"
                            title={`Auto focus camera: ${autoFocusSelection ? "On" : "Off"}`}
                            onClick={() => setAutoFocusSelection((v) => !v)}
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                display: "grid",
                                placeItems: "center",
                                background: autoFocusSelection
                                    ? "radial-gradient(circle at 35% 30%, rgba(250,204,21,0.7), rgba(120,53,15,0.4))"
                                    : "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                border: autoFocusSelection ? "1px solid rgba(250,204,21,0.6)" : "1px solid rgba(148,163,184,0.25)",
                                color: autoFocusSelection ? "rgba(254,243,199,0.95)" : "rgba(226,232,240,0.75)",
                                boxShadow: autoFocusSelection ? "0 0 14px rgba(250,204,21,0.35)" : "0 0 0 rgba(0,0,0,0)",
                                cursor: "pointer",
                            }}
                        >
                            <FocusIcon size={14} />
                        </button>
                        <button
                            type="button"
                            title={legendGroupView ? "Disable group view" : "Enable group view"}
                            onClick={() => setLegendGroupView((v) => !v)}
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                display: "grid",
                                placeItems: "center",
                                background: legendGroupView
                                    ? "radial-gradient(circle at 35% 30%, rgba(52,211,153,0.75), rgba(16,85,69,0.45))"
                                    : "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                border: legendGroupView ? "1px solid rgba(52,211,153,0.6)" : "1px solid rgba(148,163,184,0.25)",
                                color: legendGroupView ? "rgba(209,250,229,0.95)" : "rgba(226,232,240,0.75)",
                                cursor: "pointer",
                            }}
                        >
                            <GroupIcon size={14} />
                        </button>
                        <button
                            type="button"
                            title="Selection configurator"
                            onClick={() => setSelectorDialog({})}
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                display: "grid",
                                placeItems: "center",
                                background: "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                border: "1px solid rgba(148,163,184,0.25)",
                                color: "rgba(226,232,240,0.75)",
                                cursor: "pointer",
                            }}
                        >
                            <SelectorIcon size={14} />
                        </button>
                        <button
                            type="button"
                            title="Reshaper"
                            onClick={() => setReshaperDialogOpen(true)}
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                display: "grid",
                                placeItems: "center",
                                background: reshaperDialogOpen
                                    ? "radial-gradient(circle at 35% 30%, rgba(56,189,248,0.6), rgba(8,47,73,0.45))"
                                    : "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                border: reshaperDialogOpen ? "1px solid rgba(56,189,248,0.55)" : "1px solid rgba(148,163,184,0.25)",
                                color: reshaperDialogOpen ? "rgba(224,242,254,0.95)" : "rgba(226,232,240,0.75)",
                                cursor: "pointer",
                            }}
                        >
                            <ReshapeIcon size={14} />
                        </button>
                        <button
                            type="button"
                            title="Templater list"
                            onClick={() => setTemplaterLegendView((v) => !v)}
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                display: "grid",
                                placeItems: "center",
                                background: templaterLegendView
                                    ? "radial-gradient(circle at 35% 30%, rgba(129,140,248,0.7), rgba(55,48,163,0.45))"
                                    : "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                border: templaterLegendView ? "1px solid rgba(129,140,248,0.6)" : "1px solid rgba(148,163,184,0.25)",
                                color: templaterLegendView ? "rgba(224,231,255,0.95)" : "rgba(226,232,240,0.75)",
                                cursor: "pointer",
                            }}
                        >
                            <WizardHatIcon size={14} />
                        </button>
                        <button
                            type="button"
                            title={legendShowDecks ? "Hide deck hierarchy" : "Show deck hierarchy"}
                            onClick={() => setLegendShowDecks((v) => !v)}
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                display: "grid",
                                placeItems: "center",
                                background: legendShowDecks
                                    ? "radial-gradient(circle at 35% 30%, rgba(56,189,248,0.7), rgba(30,64,175,0.45))"
                                    : "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                border: legendShowDecks ? "1px solid rgba(56,189,248,0.6)" : "1px solid rgba(148,163,184,0.25)",
                                color: legendShowDecks ? "rgba(224,242,254,0.95)" : "rgba(226,232,240,0.75)",
                                cursor: "pointer",
                            }}
                        >
                            <DeckStackIcon size={14} />
                        </button>
                        <div style={{ position: "relative" }}>
                            <button
                                type="button"
                                title="Filter legend by shape/cluster"
                                onClick={() => setLegendFiltersOpen((v) => !v)}
                                ref={legendFilterBtnRef}
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 10,
                                    display: "grid",
                                    placeItems: "center",
                                    background: (legendShapeFilters.length || legendClusterFilters.length)
                                        ? "radial-gradient(circle at 35% 30%, rgba(250,204,21,0.6), rgba(124,45,18,0.35))"
                                        : "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.9))",
                                    border: (legendShapeFilters.length || legendClusterFilters.length)
                                        ? "1px solid rgba(250,204,21,0.55)"
                                        : "1px solid rgba(148,163,184,0.25)",
                                    color: (legendShapeFilters.length || legendClusterFilters.length)
                                        ? "rgba(254,243,199,0.95)"
                                        : "rgba(226,232,240,0.75)",
                                    cursor: "pointer",
                                }}
                            >
                                <FilterIcon size={14} />
                            </button>
                            {legendFiltersOpen && legendFilterMenuPos && typeof document !== "undefined" && createPortal(
                                <div
                                    onPointerDown={(e) => e.stopPropagation()}
                                    style={{
                                        position: "fixed",
                                        left: legendFilterMenuPos.left,
                                        top: legendFilterMenuPos.top,
                                        width: legendFilterMenuPos.width,
                                        maxHeight: legendFilterMenuPos.maxHeight,
                                        padding: 10,
                                        borderRadius: 12,
                                        background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        boxShadow: "0 16px 30px rgba(0,0,0,0.55)",
                                        display: "grid",
                                        gap: 10,
                                        zIndex: 10001,
                                        overflow: "auto",
                                    }}
                                >
                                    <div style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(226,232,240,0.7)" }}>
                                        Filters
                                    </div>
                                    <div style={{ display: "grid", gap: 6 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>Shapes</div>
                                        <div style={{ display: "grid", gap: 4, maxHeight: 120, overflow: "auto" }}>
                                            {legendShapeOptions.map((shape) => {
                                                const active = legendShapeFilters.includes(shape);
                                                return (
                                                    <label key={shape} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={active}
                                                            onChange={() => {
                                                                setLegendShapeFilters((prev) =>
                                                                    prev.includes(shape) ? prev.filter((s) => s !== shape) : [...prev, shape]
                                                                );
                                                            }}
                                                        />
                                                        <span style={{ textTransform: "capitalize" }}>{shape}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div style={{ display: "grid", gap: 6 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>Clusters</div>
                                        <div style={{ display: "grid", gap: 4, maxHeight: 120, overflow: "auto" }}>
                                            {legendClusterOptions.map((cluster) => {
                                                const active = legendClusterFilters.includes(cluster);
                                                return (
                                                    <label key={cluster} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={active}
                                                            onChange={() => {
                                                                setLegendClusterFilters((prev) =>
                                                                    prev.includes(cluster) ? prev.filter((c) => c !== cluster) : [...prev, cluster]
                                                                );
                                                            }}
                                                        />
                                                        <span style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{cluster}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <Btn
                                        variant="ghost"
                                        onClick={() => {
                                            setLegendShapeFilters([]);
                                            setLegendClusterFilters([]);
                                        }}
                                    >
                                        Clear filters
                                    </Btn>
                                </div>,
                                document.body
                            )}
                        </div>
                    </div>
                    <div style={{ display: "grid", gap: 2 }}>
                            <Input
                                value={legendFilter}
                                onChange={(e) => setLegendFilter(e.target.value)}
                                placeholder="Filter rooms / nodes"
                            />
                            <div style={{ display: "grid", gap: 6, maxHeight: 345, overflow: "auto", paddingRight: 4 }}>
                                {(() => {
                                    const templaterBlock = templaterLegendView ? (() => {
                                        const list = Array.isArray(templaterFinalRooms) ? templaterFinalRooms : [];
                                        const placedIds = new Set((rooms || []).map((r) => r.templateId || r.id));
                                        if (!list.length) {
                                            return (
                                                <div style={{ fontSize: 11, opacity: 0.6 }}>
                                                    No templated rooms. Use the wizard and click Finalize.
                                                </div>
                                            );
                                        }
                                        const deckLabel = (id) => {
                                            if (!id) return "No Deck";
                                            const fromLive = (decks || []).find((d) => d?.id === id);
                                            if (fromLive) return fromLive.name || fromLive.label || fromLive.id;
                                            const fromTpl = (templaterDecks || []).find((d) => d?.id === id);
                                            return fromTpl ? `${fromTpl.name || fromTpl.id} (templated)` : id;
                                        };
                                        const byDeck = new Map();
                                        list.forEach((r) => {
                                            const did = r.deckId || "";
                                            if (!byDeck.has(did)) byDeck.set(did, []);
                                            byDeck.get(did).push(r);
                                        });
                                        const deckIds = Array.from(byDeck.keys()).sort((a, b) => deckLabel(a).localeCompare(deckLabel(b)));
                                        return (
                                            <div style={{ display: "grid", gap: 6, maxHeight: 300, overflow: "auto" }} className="templater-scroll">
                                                {templaterDecks && templaterDecks.length > 0 && (
                                                    <div style={{ display: "grid", gap: 4 }}>
                                                        <div style={{ fontSize: 10, opacity: 0.7 }}>Templated decks</div>
                                                        {templaterDecks.map((d) => (
                                                            <div
                                                                key={d.id}
                                                                style={{
                                                                    display: "flex",
                                                                    alignItems: "center",
                                                                    gap: 8,
                                                                    padding: "4px 6px",
                                                                    borderRadius: 8,
                                                                    border: "1px solid rgba(148,163,184,0.25)",
                                                                    background: "rgba(15,23,42,0.45)",
                                                                    fontSize: 12,
                                                                }}
                                                            >
                                                                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(226,232,240,0.6)" }}>
                                                                    Deck
                                                                </span>
                                                                <span>{d.name || d.id}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {legendShowDecks ? deckIds.map((did) => {
                                                    const deckRooms = byDeck.get(did) || [];
                                                    const deckAllPlaced = deckRooms.length > 0 && deckRooms.every((room) => placedIds.has(room.id));
                                                    return (
                                                        <div key={did || "nodeck"} style={{ display: "grid", gap: 6 }}>
                                                            <div
                                                                style={{
                                                                    display: "flex",
                                                                    alignItems: "center",
                                                                    gap: 8,
                                                                    padding: "4px 6px",
                                                                    borderRadius: 8,
                                                                    border: deckAllPlaced ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(148,163,184,0.25)",
                                                                    background: deckAllPlaced ? "rgba(34,197,94,0.2)" : "rgba(15,23,42,0.45)",
                                                                    fontSize: 11,
                                                                    fontWeight: 700,
                                                                    letterSpacing: "0.04em",
                                                                }}
                                                            >
                                                                <DeckStackIcon size={12} />
                                                                <span>{deckLabel(did)}</span>
                                                                <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 10 }}>{deckRooms.length}</span>
                                                            </div>
                                                            <div style={{ display: "grid", gap: 4, paddingLeft: 10 }}>
                                                                {deckRooms.map((r) => (
                                                                    <div
                                                                        key={r.id}
                                                                        onContextMenu={(e) => {
                                                                            e.preventDefault();
                                                                            e.stopPropagation();
                                                                            setTemplaterSelectedRoomIds([r.id]);
                                                                            setTemplaterSelectedRoomId(r.id);
                                                                            openTemplaterApplyMenu(e, r.id);
                                                                        }}
                                                                        style={{
                                                                            display: "flex",
                                                                            alignItems: "center",
                                                                            gap: 8,
                                                                            padding: "6px 8px",
                                                                            borderRadius: 8,
                                                                            border: placedIds.has(r.id) ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(255,255,255,0.08)",
                                                                            background: placedIds.has(r.id) ? "rgba(34,197,94,0.18)" : "rgba(15,23,42,0.45)",
                                                                        }}
                                                                    >
                                                                        <div style={{ flex: 1, fontSize: 12 }}>
                                                                            {templaterEditRoomId === r.id ? (
                                                                                <input
                                                                                    autoFocus
                                                                                    value={templaterEditRoomValue}
                                                                                    onChange={(e) => setTemplaterEditRoomValue(e.target.value)}
                                                                                    onBlur={() => {
                                                                                        setTemplaterFinalRooms((prev) => (prev || []).map((room) => (
                                                                                            room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                                        )));
                                                                                        setTemplaterRooms((prev) => (prev || []).map((room) => (
                                                                                            room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                                        )));
                                                                                        setTemplaterEditRoomId("");
                                                                                    }}
                                                                                    onKeyDown={(e) => {
                                                                                        if (e.key === "Enter") {
                                                                                            setTemplaterFinalRooms((prev) => (prev || []).map((room) => (
                                                                                                room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                                            )));
                                                                                            setTemplaterRooms((prev) => (prev || []).map((room) => (
                                                                                                room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                                            )));
                                                                                            setTemplaterEditRoomId("");
                                                                                        }
                                                                                        if (e.key === "Escape") setTemplaterEditRoomId("");
                                                                                    }}
                                                                                    style={{
                                                                                        width: "100%",
                                                                                        background: "rgba(15,23,42,0.6)",
                                                                                        color: "#e2e8f0",
                                                                                        border: "1px solid rgba(148,163,184,0.35)",
                                                                                        borderRadius: 6,
                                                                                        padding: "2px 6px",
                                                                                        fontSize: 12,
                                                                                    }}
                                                                                />
                                                                            ) : (
                                                                                <span
                                                                                    onDoubleClick={() => {
                                                                                        setTemplaterEditRoomId(r.id);
                                                                                        setTemplaterEditRoomValue(r.name || "");
                                                                                    }}
                                                                                >
                                                                                    {r.name}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div style={{ fontSize: 10, opacity: 0.7 }}>{r.roomType || ""}</div>
                                                                        <div style={{ fontSize: 10, opacity: 0.7 }}>{r.tag || ""}</div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                startTemplateDraw(r.id);
                                                                            }}
                                                                            style={{
                                                                                border: "1px solid rgba(56,189,248,0.45)",
                                                                                background: "rgba(56,189,248,0.16)",
                                                                                color: "#e2f2ff",
                                                                                borderRadius: 8,
                                                                                padding: "4px 8px",
                                                                                fontSize: 11,
                                                                                cursor: "pointer",
                                                                            }}
                                                                        >
                                                                            Draw
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                const count = templateRoomItemCount(r);
                                                                                if (count > 0) {
                                                                                    setTemplaterDeleteDialog({
                                                                                        id: r.id,
                                                                                        name: r.name || r.id,
                                                                                        count,
                                                                                    });
                                                                                    return;
                                                                                }
                                                                                deleteTemplaterRoom(r.id);
                                                                            }}
                                                                            style={{
                                                                                width: 22,
                                                                                height: 22,
                                                                                borderRadius: 6,
                                                                                border: "1px solid rgba(248,113,113,0.45)",
                                                                                background: "rgba(127,29,29,0.35)",
                                                                                color: "rgba(254,226,226,0.9)",
                                                                                cursor: "pointer",
                                                                            }}
                                                                        >
                                                                            <MinusIcon size={10} />
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    );
                                                }) : list.map((r) => {
                                                    const isPlaced = placedIds.has(r.id);
                                                    const editing = templaterEditRoomId === r.id;
                                                    return (
                                                        <div
                                                            key={r.id}
                                                            onContextMenu={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                setTemplaterSelectedRoomIds([r.id]);
                                                                setTemplaterSelectedRoomId(r.id);
                                                                openTemplaterApplyMenu(e, r.id);
                                                            }}
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: 8,
                                                                padding: "6px 8px",
                                                                borderRadius: 8,
                                                                border: isPlaced ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(255,255,255,0.08)",
                                                                background: isPlaced ? "rgba(34,197,94,0.18)" : "rgba(15,23,42,0.45)",
                                                            }}
                                                        >
                                                            <div style={{ flex: 1, fontSize: 12 }}>
                                                                {editing ? (
                                                                    <input
                                                                        autoFocus
                                                                        value={templaterEditRoomValue}
                                                                        onChange={(e) => setTemplaterEditRoomValue(e.target.value)}
                                                                        onBlur={() => {
                                                                            setTemplaterFinalRooms((prev) => (prev || []).map((room) => (
                                                                                room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                            )));
                                                                            setTemplaterRooms((prev) => (prev || []).map((room) => (
                                                                                room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                            )));
                                                                            setTemplaterEditRoomId("");
                                                                        }}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === "Enter") {
                                                                                setTemplaterFinalRooms((prev) => (prev || []).map((room) => (
                                                                                    room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                                )));
                                                                                setTemplaterRooms((prev) => (prev || []).map((room) => (
                                                                                    room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                                )));
                                                                                setTemplaterEditRoomId("");
                                                                            }
                                                                            if (e.key === "Escape") setTemplaterEditRoomId("");
                                                                        }}
                                                                        style={{
                                                                            width: "100%",
                                                                            background: "rgba(15,23,42,0.6)",
                                                                            color: "#e2e8f0",
                                                                            border: "1px solid rgba(148,163,184,0.35)",
                                                                            borderRadius: 6,
                                                                            padding: "2px 6px",
                                                                            fontSize: 12,
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <span
                                                                        onDoubleClick={() => {
                                                                            setTemplaterEditRoomId(r.id);
                                                                            setTemplaterEditRoomValue(r.name || "");
                                                                        }}
                                                                    >
                                                                        {r.name || r.id}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => startTemplateDraw(r.id)}
                                                                style={{
                                                                    border: "1px solid rgba(56,189,248,0.45)",
                                                                    background: "rgba(56,189,248,0.16)",
                                                                    color: "#e2f2ff",
                                                                    borderRadius: 8,
                                                                    padding: "4px 8px",
                                                                    fontSize: 11,
                                                                    cursor: "pointer",
                                                                }}
                                                            >
                                                                Draw
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const count = templateRoomItemCount(r);
                                                                    if (count > 0) {
                                                                        setTemplaterDeleteDialog({
                                                                            id: r.id,
                                                                            name: r.name || r.id,
                                                                            count,
                                                                        });
                                                                        return;
                                                                    }
                                                                    deleteTemplaterRoom(r.id);
                                                                }}
                                                                style={{
                                                                    width: 24,
                                                                    height: 24,
                                                                    borderRadius: 6,
                                                                    border: "1px solid rgba(248,113,113,0.45)",
                                                                    background: "rgba(127,29,29,0.35)",
                                                                    color: "rgba(254,226,226,0.9)",
                                                                    cursor: "pointer",
                                                                    display: "grid",
                                                                    placeItems: "center",
                                                                }}
                                                                title="Delete templated room"
                                                            >
                                                                <TrashIcon size={12} />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })() : null;
                                    const q = String(legendFilter || "").trim().toLowerCase();
                                    const match = (v) => !q || String(v || "").toLowerCase().includes(q);
                                    const shapeFilterSet = new Set((legendShapeFilters || []).map((s) => String(s).toLowerCase()));
                                    const clusterFilterSet = new Set((legendClusterFilters || []).map((c) => String(c).toLowerCase()));
                                    const filtersActive = shapeFilterSet.size > 0 || clusterFilterSet.size > 0;
                                    const nodeMatches = (n) => {
                                        const nName = n?.label || n?.name || n?.id;
                                        if (q && !match(nName)) return false;
                                        const shapeType = String(n?.shape?.type || "sphere").toLowerCase();
                                        const cluster = String(n?.cluster || "").toLowerCase();
                                        if (shapeFilterSet.size > 0 && !shapeFilterSet.has(shapeType)) return false;
                                        if (clusterFilterSet.size > 0 && !clusterFilterSet.has(cluster)) return false;
                                        return true;
                                    };
                                    const roomList = (rooms || []).slice().sort((a, b) => {
                                        const an = String(a.name || a.label || a.id || "");
                                        const bn = String(b.name || b.label || b.id || "");
                                        return an.localeCompare(bn, undefined, { sensitivity: "base" });
                                    });
                                    const deckList = (decks || []).slice().sort((a, b) => {
                                        const an = String(a.name || a.label || a.id || "");
                                        const bn = String(b.name || b.label || b.id || "");
                                        return an.localeCompare(bn, undefined, { sensitivity: "base" });
                                    });
                                    const nodeList = nodes || [];
                                    const nodesByRoom = new Map();
                                    const roomsByDeck = new Map();
                                    const nodesNoRoomByDeck = new Map();
                                    nodeList.forEach((n) => {
                                        const rid = n.roomId || "__none__";
                                        if (!nodesByRoom.has(rid)) nodesByRoom.set(rid, []);
                                        nodesByRoom.get(rid).push(n);
                                        if (!n.roomId) {
                                            const did = n.deckId || "__no_deck__";
                                            if (!nodesNoRoomByDeck.has(did)) nodesNoRoomByDeck.set(did, []);
                                            nodesNoRoomByDeck.get(did).push(n);
                                        }
                                    });
                                    roomList.forEach((r) => {
                                        const did = r.deckId || "__no_deck__";
                                        if (!roomsByDeck.has(did)) roomsByDeck.set(did, []);
                                        roomsByDeck.get(did).push(r);
                                    });

                                    const renderNodeRow = (n) => {
                                        if (!nodeMatches(n)) return null;
                                        const nName = n.label || n.name || n.id;
                                        return (
                                            <button
                                                key={n.id}
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const additive = e.ctrlKey || e.metaKey;
                                                    if (additive) {
                                                        setMultiSel?.((prev) => {
                                                            const has = prev.some((x) => x.type === "node" && x.id === n.id);
                                                            const next = has
                                                                ? prev.filter((x) => !(x.type === "node" && x.id === n.id))
                                                                : [...prev, { type: "node", id: n.id }];
                                                            const last = next[next.length - 1];
                                                            setSelected?.(last || null);
                                                            return next;
                                                        });
                                                    } else {
                                                        setMultiSel?.([]);
                                                        setSelected?.({ type: "node", id: n.id });
                                                    }
                                                    if (autoFocusSelection) {
                                                        focusTarget(n.position || [0, 0, 0], 2);
                                                    }
                                                    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                                                        focusTarget(n.position || [0, 0, 0], 2);
                                                    }
                                                }}
                                                onDoubleClick={(e) => {
                                                    e.stopPropagation();
                                                    startEdit("node", n.id, nName);
                                                }}
                                                onContextMenu={(e) => {
                                                    const ids = selectedNodeIds.has(n.id)
                                                        ? Array.from(selectedNodeIds)
                                                        : [n.id];
                                                    openContextMenu(e, { type: "node", ids });
                                                }}
                                                style={{
                                                    textAlign: "left",
                                                    border: selectedNodeIds.has(n.id) ? "1px solid rgba(56,189,248,0.6)" : "1px solid rgba(255,255,255,0.08)",
                                                    background: selectedNodeIds.has(n.id) ? "rgba(56,189,248,0.18)" : "rgba(15,23,42,0.45)",
                                                    color: "rgba(226,232,240,0.9)",
                                                    padding: "6px 8px",
                                                    borderRadius: 8,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: 18,
                                                        height: 18,
                                                        borderRadius: 6,
                                                        display: "grid",
                                                        placeItems: "center",
                                                        background: "rgba(5,150,105,0.18)",
                                                        color: "rgba(110,231,183,0.95)",
                                                        border: "1px solid rgba(16,185,129,0.35)",
                                                        marginLeft: 10,
                                                    }}
                                                >
                                                    <NodeGlyphIcon size={12} />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setNodeById?.(n.id, { hidden: !n.hidden });
                                                    }}
                                                    title={n.hidden ? "Show node" : "Hide node"}
                                                    style={{
                                                        border: "1px solid rgba(255,255,255,0.12)",
                                                        background: "rgba(15,23,42,0.45)",
                                                        color: n.hidden ? "#fbbf24" : "rgba(226,232,240,0.7)",
                                                        width: 18,
                                                        height: 18,
                                                        borderRadius: 6,
                                                        display: "grid",
                                                        placeItems: "center",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    {n.hidden ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setNodeById?.(n.id, { locked: !n.locked });
                                                    }}
                                                    title={n.locked ? "Unlock node" : "Lock node"}
                                                    style={{
                                                        border: "1px solid rgba(255,255,255,0.12)",
                                                        background: "rgba(15,23,42,0.45)",
                                                        color: n.locked ? "#fbbf24" : "rgba(226,232,240,0.7)",
                                                        width: 18,
                                                        height: 18,
                                                        borderRadius: 6,
                                                        display: "grid",
                                                        placeItems: "center",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    {n.locked ? <LockIcon size={11} /> : <UnlockIcon size={11} />}
                                                </button>
                                                {editTarget && editTarget.type === "node" && editTarget.id === n.id ? (
                                                    <input
                                                        value={editValue}
                                                        onChange={(e) => setEditValue(e.target.value)}
                                                        onBlur={commitEdit}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") {
                                                                e.preventDefault();
                                                                commitEdit();
                                                            } else if (e.key === "Escape") {
                                                                e.preventDefault();
                                                                cancelEdit();
                                                            }
                                                        }}
                                                        autoFocus
                                                        style={{
                                                            fontSize: 12,
                                                            background: "rgba(15,23,42,0.6)",
                                                            border: "1px solid rgba(255,255,255,0.16)",
                                                            color: "#fff",
                                                            borderRadius: 6,
                                                            padding: "2px 6px",
                                                            width: "100%",
                                                        }}
                                                    />
                                                ) : (
                                                    <>
                                                        <span style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nName}</span>
                                                        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                                                            {n.shape?.type && (
                                                                <span
                                                                    style={{
                                                                        fontSize: 10,
                                                                        padding: "2px 6px",
                                                                        borderRadius: 999,
                                                                        border: "1px solid rgba(59,130,246,0.4)",
                                                                        color: "rgba(191,219,254,0.95)",
                                                                        background: "rgba(30,64,175,0.2)",
                                                                        textTransform: "capitalize",
                                                                        letterSpacing: "0.03em",
                                                                    }}
                                                                >
                                                                    {String(n.shape.type)}
                                                                </span>
                                                            )}
                                                            {n.cluster && (
                                                                <span
                                                                    style={{
                                                                        fontSize: 10,
                                                                        padding: "2px 6px",
                                                                        borderRadius: 999,
                                                                        border: "1px solid rgba(16,185,129,0.4)",
                                                                        color: "rgba(167,243,208,0.95)",
                                                                        background: "rgba(5,150,105,0.18)",
                                                                        textTransform: "uppercase",
                                                                        letterSpacing: "0.08em",
                                                                    }}
                                                                >
                                                                    {String(n.cluster)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </button>
                                        );
                                    };

                                    const rowsOut = [];
                                    const templaterStats = templaterLegendView ? (() => {
                                        const list = Array.isArray(templaterFinalRooms) ? templaterFinalRooms : [];
                                        const placedIds = new Set((rooms || []).map((r) => r.templateId || r.id));
                                        const byDeck = new Map();
                                        list.forEach((r) => {
                                            const did = r.deckId || "";
                                            if (!byDeck.has(did)) byDeck.set(did, []);
                                            byDeck.get(did).push(r);
                                        });
                                        const deckIds = Array.from(byDeck.keys());
                                        const drawnRooms = list.filter((r) => placedIds.has(r.id)).length;
                                        const drawnDecks = deckIds.filter((did) => {
                                            const roomsInDeck = byDeck.get(did) || [];
                                            return roomsInDeck.length > 0 && roomsInDeck.every((r) => placedIds.has(r.id));
                                        }).length;
                                        return {
                                            drawnRooms,
                                            totalRooms: list.length,
                                            drawnDecks,
                                            totalDecks: deckIds.length,
                                        };
                                    })() : null;
                                    if (templaterBlock) {
                                        rowsOut.push(
                                            <div key="templater-block" style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                                                <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.7 }}>
                                                    Templater Rooms
                                                </div>
                                                {templaterStats && (
                                                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                                                        {templaterStats.drawnRooms}/{templaterStats.totalRooms} rooms drawn{" "}
                                                        {"\u2022"} {templaterStats.drawnDecks}/{templaterStats.totalDecks} decks drawn
                                                    </div>
                                                )}
                                                {templaterBlock}
                                            </div>
                                        );
                                    }

                                    if (legendGroupView) {
                                        const groupList = (groups || [])
                                            .slice()
                                            .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, { sensitivity: "base" }));
                                        const groupRows = groupList
                                            .filter((g) => match(g.name || g.id))
                                            .map((g) => {
                                                const gName = g.name || g.id;
                                                const gRooms = (rooms || []).filter((r) => r.groupId === g.id);
                                                const gNodes = (nodes || []).filter((n) => n.groupId === g.id);
                                                const total = gRooms.length + gNodes.length;
                                                return (
                                                    <details key={g.id} open={!!q} style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(12,20,32,0.45)" }}>
                                                        <summary
                                                            onContextMenu={(e) => openContextMenu(e, { type: "group", ids: [g.id] })}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setMultiSel?.([]);
                                                                setSelected?.({ type: "group", id: g.id });
                                                                if (autoFocusSelection) {
                                                                    const points = [
                                                                        ...gRooms.map((r) => r.center || [0, 0, 0]),
                                                                        ...gNodes.map((n) => n.position || [0, 0, 0]),
                                                                    ];
                                                                    focusFromPoints(points, 3);
                                                                }
                                                            }}
                                                            style={{
                                                                cursor: "pointer",
                                                                listStyle: "none",
                                                                padding: "6px 8px",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: 8,
                                                                borderRadius: 8,
                                                                background: selected?.type === "group" && selected.id === g.id ? "rgba(34,197,94,0.16)" : "rgba(15,23,42,0.35)",
                                                                border: selected?.type === "group" && selected.id === g.id ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(255,255,255,0.06)",
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    width: 18,
                                                                    height: 18,
                                                                    borderRadius: 6,
                                                                    display: "grid",
                                                                    placeItems: "center",
                                                                    background: "rgba(34,197,94,0.2)",
                                                                    color: "rgba(187,247,208,0.95)",
                                                                    border: "1px solid rgba(34,197,94,0.35)",
                                                                }}
                                                            >
                                                                <GroupIcon size={12} />
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setGroups?.((prev) => (prev || []).map((x) => (x.id === g.id ? { ...x, hidden: !x.hidden } : x)));
                                                                }}
                                                                title={g.hidden ? "Show group" : "Hide group"}
                                                                style={{
                                                                    border: "1px solid rgba(255,255,255,0.12)",
                                                                    background: "rgba(15,23,42,0.45)",
                                                                    color: g.hidden ? "#fbbf24" : "rgba(226,232,240,0.7)",
                                                                    width: 18,
                                                                    height: 18,
                                                                    borderRadius: 6,
                                                                    display: "grid",
                                                                    placeItems: "center",
                                                                    cursor: "pointer",
                                                                }}
                                                            >
                                                                {g.hidden ? <EyeOffIcon size={11} /> : <EyeIcon size={11} />}
                                                            </button>
                                                            <span style={{ fontSize: 12, fontWeight: 700 }}>{gName}</span>
                                                            <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>{total}</span>
                                                        </summary>
                                                        <div style={{ display: "grid", gap: 4, padding: "4px 8px 8px", paddingLeft: 16 }}>
                                                            {gRooms.map((r) => (
                                                                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(15,23,42,0.45)" }}>
                                                                    <div style={{ width: 16, height: 16, borderRadius: 6, display: "grid", placeItems: "center", background: "rgba(30,64,175,0.22)", color: "rgba(147,197,253,0.95)", border: "1px solid rgba(59,130,246,0.35)" }}>
                                                                        <RoomHouseIcon size={10} />
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        title={(r.nodeBounds?.enabled ?? false) ? "Disable room boundary" : "Enable room boundary"}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setRooms?.((prev) => (prev || []).map((room) => (
                                                                                room.id === r.id
                                                                                    ? {
                                                                                        ...room,
                                                                                        nodeBounds: {
                                                                                            ...(room.nodeBounds || {}),
                                                                                            enabled: !(room.nodeBounds?.enabled ?? false),
                                                                                        },
                                                                                    }
                                                                                    : room
                                                                            )));
                                                                        }}
                                                                        style={{
                                                                            width: 16,
                                                                            height: 16,
                                                                            borderRadius: 6,
                                                                            display: "grid",
                                                                            placeItems: "center",
                                                                            border: "1px solid rgba(255,255,255,0.12)",
                                                                            background: "rgba(15,23,42,0.45)",
                                                                            color: (r.nodeBounds?.enabled ?? false) ? "rgba(251,146,60,0.95)" : "rgba(226,232,240,0.5)",
                                                                            boxShadow: (r.nodeBounds?.enabled ?? false) ? "0 0 10px rgba(251,146,60,0.35)" : "none",
                                                                            cursor: "pointer",
                                                                        }}
                                                                    >
                                                                        <GlobeIcon size={10} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setRooms?.((prev) => (prev || []).map((room) => (room.id === r.id ? { ...room, hidden: !room.hidden } : room)));
                                                                        }}
                                                                        title={r.hidden ? "Show room" : "Hide room"}
                                                                        style={{
                                                                            border: "1px solid rgba(255,255,255,0.12)",
                                                                            background: "rgba(15,23,42,0.45)",
                                                                            color: r.hidden ? "#fbbf24" : "rgba(226,232,240,0.7)",
                                                                            width: 18,
                                                                            height: 18,
                                                                            borderRadius: 6,
                                                                            display: "grid",
                                                                            placeItems: "center",
                                                                            cursor: "pointer",
                                                                        }}
                                                                    >
                                                                        {r.hidden ? <EyeOffIcon size={11} /> : <EyeIcon size={11} />}
                                                                    </button>
                                                                    <span style={{ fontSize: 12 }}>{r.name || r.label || r.id}</span>
                                                                </div>
                                                            ))}
                                                            {gNodes.map((n) => (
                                                                <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(15,23,42,0.45)" }}>
                                                                    <div style={{ width: 16, height: 16, borderRadius: 6, display: "grid", placeItems: "center", background: "rgba(5,150,105,0.18)", color: "rgba(110,231,183,0.95)", border: "1px solid rgba(16,185,129,0.35)" }}>
                                                                        <NodeGlyphIcon size={10} />
                                                                    </div>
                                                                    <span style={{ fontSize: 12 }}>{n.label || n.name || n.id}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </details>
                                                );
                                            });
                                        if (!groupRows.length && !rowsOut.length) {
                                            return <div style={{ fontSize: 12, opacity: 0.6 }}>No matching groups.</div>;
                                        }
                                        return [...rowsOut, ...groupRows];
                                    }

                                    const renderRoomBlock = (r) => {
                                        const rName = r.name || r.label || r.id;
                                        const roomNodes = nodesByRoom.get(r.id) || [];
                                        const matchingNodes = roomNodes.filter((n) => nodeMatches(n));
                                        if (filtersActive && matchingNodes.length === 0) return null;
                                        if (!filtersActive && !match(rName) && matchingNodes.length === 0 && q) return null;
                                        return (
                                            <details key={r.id} open={!!q} style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(15,23,42,0.35)" }}>
                                                <summary
                                                    style={{
                                                        cursor: "pointer",
                                                        listStyle: "none",
                                                        padding: "6px 8px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 8,
                                                        borderRadius: 8,
                                                        background: selectedRoomId === r.id ? "rgba(56,189,248,0.15)" : "transparent",
                                                        border: selectedRoomId === r.id ? "1px solid rgba(56,189,248,0.45)" : "1px solid rgba(255,255,255,0.0)",
                                                    }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setMultiSel?.([]);
                                                        setSelected?.({ type: "room", id: r.id });
                                                        if (autoFocusSelection) {
                                                            const size = Array.isArray(r.size) ? r.size : [3, 1.6, 2.2];
                                                            const radius = Math.max(Number(size[0]) || 0, Number(size[2]) || 0) * 0.8 + 1;
                                                            focusTarget(r.center || [0, 0, 0], radius);
                                                        }
                                                        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                                                            const size = Array.isArray(r.size) ? r.size : [3, 1.6, 2.2];
                                                            const radius = Math.max(Number(size[0]) || 0, Number(size[2]) || 0) * 0.8 + 1;
                                                            focusTarget(r.center || [0, 0, 0], radius);
                                                        }
                                                    }}
                                                    onDoubleClick={(e) => {
                                                        e.stopPropagation();
                                                        startEdit("room", r.id, rName);
                                                    }}
                                                    onContextMenu={(e) => {
                                                        openContextMenu(e, { type: "room", ids: [r.id] });
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: 18,
                                                            height: 18,
                                                            borderRadius: 6,
                                                            display: "grid",
                                                            placeItems: "center",
                                                            background: "rgba(30,64,175,0.22)",
                                                            color: "rgba(147,197,253,0.95)",
                                                            border: "1px solid rgba(59,130,246,0.35)",
                                                        }}
                                                    >
                                                        <RoomHouseIcon size={12} />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        title={(r.nodeBounds?.enabled ?? false) ? "Disable room boundary" : "Enable room boundary"}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (setRooms) {
                                                                setRooms((prev) => (prev || []).map((room) => (
                                                                    room.id === r.id
                                                                        ? {
                                                                            ...room,
                                                                            nodeBounds: {
                                                                                ...(room.nodeBounds || {}),
                                                                                enabled: !(room.nodeBounds?.enabled ?? false),
                                                                            },
                                                                        }
                                                                        : room
                                                                )));
                                                            }
                                                        }}
                                                        style={{
                                                            width: 18,
                                                            height: 18,
                                                            borderRadius: 6,
                                                            display: "grid",
                                                            placeItems: "center",
                                                            border: "1px solid rgba(255,255,255,0.12)",
                                                            background: "rgba(15,23,42,0.45)",
                                                            color: (r.nodeBounds?.enabled ?? false) ? "rgba(251,146,60,0.95)" : "rgba(226,232,240,0.5)",
                                                            boxShadow: (r.nodeBounds?.enabled ?? false) ? "0 0 10px rgba(251,146,60,0.35)" : "none",
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        <GlobeIcon size={12} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (setRooms) {
                                                                setRooms((prev) => (prev || []).map((room) => (room.id === r.id ? { ...room, hidden: !room.hidden } : room)));
                                                            }
                                                        }}
                                                        title={r.hidden ? "Show room" : "Hide room"}
                                                        style={{
                                                            border: "1px solid rgba(255,255,255,0.12)",
                                                            background: "rgba(15,23,42,0.45)",
                                                            color: r.hidden ? "#fbbf24" : "rgba(226,232,240,0.7)",
                                                            width: 18,
                                                            height: 18,
                                                            borderRadius: 6,
                                                            display: "grid",
                                                            placeItems: "center",
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        {r.hidden ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (setRooms) {
                                                                setRooms((prev) => (prev || []).map((room) => (room.id === r.id ? { ...room, locked: !room.locked } : room)));
                                                            }
                                                        }}
                                                        title={r.locked ? "Unlock room" : "Lock room"}
                                                        style={{
                                                            border: "1px solid rgba(255,255,255,0.12)",
                                                            background: "rgba(15,23,42,0.45)",
                                                            color: r.locked ? "#fbbf24" : "rgba(226,232,240,0.7)",
                                                            width: 18,
                                                            height: 18,
                                                            borderRadius: 6,
                                                            display: "grid",
                                                            placeItems: "center",
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        {r.locked ? <LockIcon size={11} /> : <UnlockIcon size={11} />}
                                                    </button>
                                                    {editTarget && editTarget.type === "room" && editTarget.id === r.id ? (
                                                        <input
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            onBlur={commitEdit}
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Enter") {
                                                                    e.preventDefault();
                                                                    commitEdit();
                                                                } else if (e.key === "Escape") {
                                                                    e.preventDefault();
                                                                    cancelEdit();
                                                                }
                                                            }}
                                                            autoFocus
                                                            onClick={(e) => e.stopPropagation()}
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                            style={{
                                                                fontSize: 12,
                                                                fontWeight: 700,
                                                                background: "rgba(15,23,42,0.6)",
                                                                border: "1px solid rgba(255,255,255,0.16)",
                                                                color: "#fff",
                                                                borderRadius: 6,
                                                                padding: "2px 6px",
                                                                width: "100%",
                                                            }}
                                                        />
                                                    ) : (
                                                        <>
                                                            <span style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rName}</span>
                                                            {r.templateId && (
                                                                <span
                                                                    style={{
                                                                        fontSize: 9,
                                                                        padding: "2px 6px",
                                                                        borderRadius: 999,
                                                                        border: "1px solid rgba(59,130,246,0.4)",
                                                                        color: "rgba(191,219,254,0.95)",
                                                                        background: "rgba(30,64,175,0.2)",
                                                                        textTransform: "uppercase",
                                                                        letterSpacing: "0.12em",
                                                                    }}
                                                                >
                                                                    Template
                                                                </span>
                                                            )}
                                                        </>
                                                    )}
                                                    <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>{roomNodes.length}</span>
                                                </summary>
                                                <div style={{ display: "grid", gap: 4, padding: "4px 8px 8px", paddingLeft: 16 }}>
                                                    {(matchingNodes.length ? matchingNodes : roomNodes).map((n) => renderNodeRow(n))}
                                                </div>
                                            </details>
                                        );
                                    };

                                    const rows = [];
                                    const roomHasMatch = (r) => {
                                        const rName = r.name || r.label || r.id;
                                        const roomNodes = nodesByRoom.get(r.id) || [];
                                        const matchingNodes = roomNodes.filter((n) => nodeMatches(n));
                                        if (filtersActive) return matchingNodes.length > 0 || match(rName);
                                        if (!q) return true;
                                        return match(rName) || matchingNodes.length > 0;
                                    };

                                    if (!legendShowDecks) {
                                        roomList.forEach((r) => {
                                            if (!roomHasMatch(r)) return;
                                            rows.push(renderRoomBlock(r));
                                        });
                                        const looseNodes = Array.from(nodesNoRoomByDeck.values()).flat();
                                        const visibleLoose = looseNodes.filter((n) => nodeMatches(n));
                                        if (visibleLoose.length > 0) {
                                            rows.push(
                                                <div key="legend-loose-nodes" style={{ borderRadius: 10, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(15,23,42,0.3)" }}>
                                                    <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 8 }}>
                                                        <span style={{ fontSize: 12, fontWeight: 700 }}>Unassigned</span>
                                                        <span style={{ fontSize: 11, opacity: 0.6 }}>Nodes without room</span>
                                                        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>{visibleLoose.length}</span>
                                                    </div>
                                                    <div style={{ display: "grid", gap: 4, padding: "4px 8px 8px" }}>
                                                        {visibleLoose.map((n) => renderNodeRow(n))}
                                                    </div>
                                                </div>
                                            );
                                        }
                                    } else {
                                        const allDecks = [
                                            ...deckList.map((d) => ({ id: d.id, label: d.name || d.label || d.id })),
                                            ...(templaterDecks || []).map((d) => ({ id: d.id, label: `${d.name || d.id} (templated)`, templated: true })),
                                            { id: "__no_deck__", label: "No Deck" },
                                        ];

                                        allDecks.forEach((deck) => {
                                            const deckRooms = roomsByDeck.get(deck.id) || [];
                                            const noRoomNodes = nodesNoRoomByDeck.get(deck.id) || [];
                                            const deckMatches = match(deck.label);
                                            const hasMatchingRoom = deckRooms.some((r) => roomHasMatch(r));
                                            const hasMatchingLooseNodes = noRoomNodes.some((n) => nodeMatches(n));
                                            if (filtersActive) {
                                                if (!hasMatchingRoom && !hasMatchingLooseNodes) return;
                                            } else if (q && !deckMatches && !hasMatchingRoom && !hasMatchingLooseNodes) {
                                                return;
                                            }

                                            const isTemplatedDeck = !!deck.templated;
                                            rows.push(
                                                <details key={`deck-${deck.id}`} open={!!q} style={{ borderRadius: 12, border: "1px solid rgba(59,130,246,0.22)", background: "linear-gradient(160deg, rgba(8,15,28,0.55), rgba(12,20,36,0.75))", padding: 6 }}>
                                                    <summary
                                                        onContextMenu={(e) => {
                                                            if (deck.id === "__no_deck__") return;
                                                            const ids = selectedDeckIds.has(deck.id)
                                                                ? Array.from(selectedDeckIds)
                                                                : [deck.id];
                                                            openContextMenu(e, { type: "deck", ids });
                                                        }}
                                                        onClick={(e) => {
                                                            if (deck.id === "__no_deck__") return;
                                                            const additive = e.ctrlKey || e.metaKey;
                                                            if (additive) {
                                                                e.preventDefault();
                                                            }
                                                            if (additive) {
                                                                setMultiSel?.((prev) => {
                                                                    const has = prev.some((x) => x.type === "deck" && x.id === deck.id);
                                                                    const next = has
                                                                        ? prev.filter((x) => !(x.type === "deck" && x.id === deck.id))
                                                                        : [...prev, { type: "deck", id: deck.id }];
                                                                    const last = next[next.length - 1];
                                                                    setSelected?.(last || null);
                                                                    return next;
                                                                });
                                                            } else {
                                                                setMultiSel?.([]);
                                                                setSelected?.({ type: "deck", id: deck.id });
                                                            }
                                                            if (autoFocusSelection) {
                                                                const points = [
                                                                    ...deckRooms.map((r) => r.center || [0, 0, 0]),
                                                                    ...noRoomNodes.map((n) => n.position || [0, 0, 0]),
                                                                ];
                                                                focusFromPoints(points, 4);
                                                            }
                                                        }}
                                                        onDoubleClick={(e) => {
                                                            if (deck.id === "__no_deck__") return;
                                                            e.stopPropagation();
                                                            if (isTemplatedDeck) {
                                                                setTemplaterDecks((prev) => (prev || []).map((d) => (
                                                                    d.id === deck.id ? { ...d, name: deck.label } : d
                                                                )));
                                                                startEdit("deck", deck.id, deck.label);
                                                            } else {
                                                                startEdit("deck", deck.id, deck.label);
                                                            }
                                                        }}
                                                        style={{
                                                            listStyle: "none",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 6,
                                                            padding: "4px 6px",
                                                            borderRadius: 9,
                                                            background: selectedDeckIds.has(deck.id) ? "rgba(56,189,248,0.16)" : "rgba(15,23,42,0.45)",
                                                            border: selectedDeckIds.has(deck.id) ? "1px solid rgba(56,189,248,0.45)" : "1px solid rgba(255,255,255,0.08)",
                                                            cursor: deck.id === "__no_deck__" ? "default" : "pointer",
                                                        }}
                                                    >
                                                        <div style={{ width: 4, height: 16, borderRadius: 999, background: deck.id === "__no_deck__" ? "linear-gradient(180deg, rgba(251,146,60,0.95), rgba(234,88,12,0.6))" : "linear-gradient(180deg, rgba(56,189,248,0.9), rgba(37,99,235,0.5))" }} />
                                                        {deck.id !== "__no_deck__" && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (!setDecks) return;
                                                                    setDecks((prev) => (prev || []).map((d) => (d.id === deck.id ? { ...d, visible: d.visible === false } : d)));
                                                                }}
                                                                title={(deck.visible === false) ? "Show deck" : "Hide deck"}
                                                                style={{
                                                                    border: "1px solid rgba(255,255,255,0.12)",
                                                                    background: "rgba(15,23,42,0.45)",
                                                                    color: (deck.visible === false) ? "#fbbf24" : "rgba(226,232,240,0.7)",
                                                                    width: 18,
                                                                    height: 18,
                                                                    borderRadius: 6,
                                                                    display: "grid",
                                                                    placeItems: "center",
                                                                    cursor: "pointer",
                                                                }}
                                                            >
                                                                {(deck.visible === false) ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
                                                            </button>
                                                        )}
                                                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(226,232,240,0.6)" }}>Deck</span>
                                                        {editTarget && editTarget.type === "deck" && editTarget.id === deck.id ? (
                                                            <input
                                                                value={editValue}
                                                                onChange={(e) => setEditValue(e.target.value)}
                                                                onBlur={() => {
                                                                    if (isTemplatedDeck) {
                                                                        setTemplaterDecks((prev) => (prev || []).map((d) => (
                                                                            d.id === deck.id ? { ...d, name: editValue.trim() || d.name } : d
                                                                        )));
                                                                        setEditTarget(null);
                                                                    } else {
                                                                        commitEdit();
                                                                    }
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter") {
                                                                        e.preventDefault();
                                                                        if (isTemplatedDeck) {
                                                                            setTemplaterDecks((prev) => (prev || []).map((d) => (
                                                                                d.id === deck.id ? { ...d, name: editValue.trim() || d.name } : d
                                                                            )));
                                                                            setEditTarget(null);
                                                                        } else {
                                                                            commitEdit();
                                                                        }
                                                                    } else if (e.key === "Escape") {
                                                                        e.preventDefault();
                                                                        cancelEdit();
                                                                    }
                                                                }}
                                                                autoFocus
                                                                onClick={(e) => e.stopPropagation()}
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                style={{
                                                                    fontSize: 12,
                                                                    fontWeight: 700,
                                                                    background: "rgba(15,23,42,0.6)",
                                                                    border: "1px solid rgba(255,255,255,0.16)",
                                                                    color: "#fff",
                                                                    borderRadius: 6,
                                                                    padding: "2px 6px",
                                                                    width: "100%",
                                                                }}
                                                            />
                                                        ) : (
                                                            <span style={{ fontSize: 12, fontWeight: 700 }}>{deck.label}</span>
                                                        )}
                                                        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>{deckRooms.length + noRoomNodes.length}</span>
                                                    </summary>
                                                    <div style={{ display: "grid", gap: 6, paddingLeft: 4, paddingTop: 6 }}>
                                                        {deckRooms.map((r) => renderRoomBlock(r))}
                                                        {noRoomNodes.length > 0 && (
                                                            <div style={{ borderRadius: 10, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(15,23,42,0.3)" }}>
                                                                <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 8 }}>
                                                                    <span style={{ fontSize: 12, fontWeight: 700 }}>Unassigned</span>
                                                                    <span style={{ fontSize: 11, opacity: 0.6 }}>Nodes without room</span>
                                                                    <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>{noRoomNodes.length}</span>
                                                                </div>
                                                                <div style={{ display: "grid", gap: 4, padding: "4px 8px 8px" }}>
                                                                    {noRoomNodes.map((n) => renderNodeRow(n))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </details>
                                            );
                                        });
                                    }

                                    if (!rows.length && !rowsOut.length) {
                                        return <div style={{ fontSize: 12, opacity: 0.6 }}>No matching rooms or nodes.</div>;
                                    }
                                    return [...rowsOut, ...rows];
                                })()}
                            </div>
                        </div>
                    </div>

                {/* Rooms & Nodes removed: Legend now lives in the main pane */}

                {/* Groups panels removed: Legend group view handles grouping */}

                {/* Decks panel removed: Legend now manages deck hierarchy */}

                {/* Links panel removed */}

                {/* Flow defaults moved to Defaults tab */}
                </>
            )}
            </div>

            {contextMenu && typeof document !== "undefined" && createPortal(
                (
                    <div
                    onPointerDown={() => setContextMenu(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10000,
                    }}
                    >
                        <div
                            onPointerDown={(e) => e.stopPropagation()}
                            style={{
                                position: "fixed",
                                left: Math.min(
                                    contextMenu.x,
                                    (typeof window !== "undefined" ? window.innerWidth : 1200) - 220
                                ),
                                top: Math.min(
                                    contextMenu.y,
                                    (typeof window !== "undefined" ? window.innerHeight : 800) - 140
                                ),
                                minWidth: 180,
                                display: "grid",
                                gap: 6,
                                padding: 10,
                                borderRadius: 10,
                            background: "linear-gradient(160deg, rgba(12,17,28,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 12px 26px rgba(0,0,0,0.55)",
                            color: "#e2e8f0",
                        }}
                    >
                        {contextMenu.type === "room" && (
                            <button
                                type="button"
                                onClick={() => {
                                    setContextMenu(null);
                                    copyRoomContents(contextMenu.ids?.[0]);
                                }}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Copy Contents
                            </button>
                        )}
                        {contextMenu.type === "room" && (templaterFinalRooms || []).length > 0 && (() => {
                            const roomId = contextMenu.ids?.[0];
                            const room = (rooms || []).find((r) => r.id === roomId);
                            if (!room || room.templateId) return null;
                            return (
                            <button
                                type="button"
                                onClick={() => {
                                    const ids = contextMenu.ids || [];
                                    setContextMenu(null);
                                    setRoomTemplateDialog({
                                        x: contextMenu.x,
                                        y: contextMenu.y,
                                        roomIds: ids,
                                        templateId: (templaterFinalRooms[0] || {}).id || "",
                                    });
                                }}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Apply Template...
                            </button>
                        );
                        })()}
                        {contextMenu.type === "room" && (
                            <button
                                type="button"
                                onClick={() => {
                                    setContextMenu(null);
                                    openRoomScaleDialog(contextMenu.ids?.[0]);
                                }}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Scale Room...
                            </button>
                        )}
                        {contextMenu.type === "room" && roomClipboard?.roomId && (
                            <button
                                type="button"
                                onClick={() => {
                                    setContextMenu(null);
                                    setPasteDialog({ targetRoomId: contextMenu.ids?.[0] });
                                }}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                {(() => {
                                    const src = (rooms || []).find((r) => r.id === roomClipboard.roomId);
                                    const label = src?.name || src?.label || src?.id || roomClipboard.roomId;
                                    return `Paste Contents (${roomClipboard.count || 0} nodes from ${label})`;
                                })()}
                            </button>
                        )}
                        {contextMenu.type === "node" && (
                            <button
                                type="button"
                                onClick={() => {
                                    setContextMenu(null);
                                    openReshapeDialog(contextMenu.ids);
                                }}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Re-shape...
                            </button>
                        )}
                        {contextMenu.type !== "deck" && contextMenu.type !== "group" && (
                            <button
                                type="button"
                                onClick={() => openReassignDialog(contextMenu.type, contextMenu.ids)}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Reassign...
                            </button>
                        )}
                        {contextMenu.type !== "deck" && (
                            <button
                                type="button"
                                onClick={() => handleDuplicate(contextMenu.type, contextMenu.ids)}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                {contextMenu.type === "room" ? "Duplicate Room" : "Duplicate Node"}
                            </button>
                        )}
                        {contextMenu.type === "group" && (
                            <button
                                type="button"
                                onClick={() => {
                                    setContextMenu(null);
                                    const id = contextMenu.ids?.[0];
                                    if (!id) return;
                                    setGroups?.((prev) => (prev || []).filter((g) => g.id !== id));
                                }}
                                style={{
                                    border: "1px solid rgba(248,113,113,0.4)",
                                    background: "rgba(88,28,28,0.5)",
                                    color: "rgba(254,226,226,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Delete Group
                            </button>
                        )}
                        {contextMenu.type === "group" && (
                            <button
                                type="button"
                                onClick={() => {
                                    const id = contextMenu.ids?.[0];
                                    setContextMenu(null);
                                    if (!id) return;
                                    const groupRoomIds = new Set((rooms || []).filter((r) => r.groupId === id).map((r) => r.id));
                                    const groupNodeIds = new Set((nodes || []).filter((n) => n.groupId === id).map((n) => n.id));
                                    const next = [
                                        ...Array.from(groupRoomIds).map((rid) => ({ type: "room", id: rid })),
                                        ...Array.from(groupNodeIds).map((nid) => ({ type: "node", id: nid })),
                                    ];
                                    if (next.length) {
                                        setMultiSel?.(next);
                                        setSelected?.(next[0]);
                                    } else {
                                        setMultiSel?.([]);
                                        setSelected?.({ type: "group", id });
                                    }
                                    setMoveMode?.(true);
                                    setTransformMode?.("translate");
                                }}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Move Group (Gizmo)
                            </button>
                        )}
                        {contextMenu.type === "deck" && (
                            <button
                                type="button"
                                onClick={() => {
                                    const id = contextMenu.ids?.[0];
                                    setContextMenu(null);
                                    if (!id) return;
                                    const deckRoomIds = new Set((rooms || []).filter((r) => r.deckId === id).map((r) => r.id));
                                    const roomItems = Array.from(deckRoomIds).map((rid) => ({ type: "room", id: rid }));
                                    const nodeIds = new Set();
                                    (nodes || []).forEach((n) => {
                                        if (n.roomId && deckRoomIds.has(n.roomId)) {
                                            nodeIds.add(n.id);
                                        } else if (n.deckId === id) {
                                            nodeIds.add(n.id);
                                        }
                                    });
                                    const nodeItems = Array.from(nodeIds).map((nid) => ({ type: "node", id: nid }));
                                    const next = [...roomItems, ...nodeItems];
                                    if (next.length) {
                                        setMultiSel?.(next);
                                        setSelected?.(next[0]);
                                    } else {
                                        setMultiSel?.([]);
                                        setSelected?.({ type: "deck", id });
                                    }
                                    setMoveMode?.(true);
                                    setTransformMode?.("translate");
                                }}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Move Deck (Gizmo)
                            </button>
                        )}
                        {contextMenu.type === "deck" && (contextMenu.ids?.length || 0) > 1 && (
                            <button
                                type="button"
                                onClick={() => {
                                    const ids = contextMenu.ids || [];
                                    setContextMenu(null);
                                    openDeckLayerDialog(ids);
                                }}
                                style={{
                                    border: "1px solid rgba(56,189,248,0.35)",
                                    background: "rgba(15,23,42,0.55)",
                                    color: "rgba(226,232,240,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Layer Decks...
                            </button>
                        )}
                        {contextMenu.type === "deck" && (
                            <button
                                type="button"
                                onClick={() => {
                                    setContextMenu(null);
                                    setDeleteDeckDialog({ id: contextMenu.ids?.[0] });
                                }}
                                style={{
                                    border: "1px solid rgba(248,113,113,0.4)",
                                    background: "rgba(88,28,28,0.5)",
                                    color: "rgba(254,226,226,0.95)",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                Delete Deck...
                            </button>
                        )}
                    </div>
                </div>
            ),
                document.body
            )}

            {deckLayerDialog && (
                <div
                    onPointerDown={() => {
                        if (deckLayerPreview) restoreDeckLayering();
                        setDeckLayerPreview(false);
                        setDeckLayerDialog(null);
                    }}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10005,
                        background: "rgba(2,6,23,0.55)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 420,
                            maxWidth: "92vw",
                            borderRadius: 14,
                            padding: 14,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 10,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Layer Decks
                        </div>
                        {(() => {
                            const ids = deckLayerOrder.length ? deckLayerOrder.slice() : deckLayerDialog.ids.slice();
                            const spacing = Number(deckLayerSpacing) || 0;
                            const targets = computeDeckLayerTargets(ids, spacing);
                            const list = ids.map((id, idx) => {
                                const deck = (decks || []).find((d) => d.id === id);
                                const t = targets.get(id);
                                return {
                                    id,
                                    name: deck?.name || deck?.label || id,
                                    minY: t?.y ?? 0,
                                    height: t?.height ?? 0,
                                    gap: idx === 0 ? 0 : spacing,
                                };
                            });
                            return (
                                <div style={{ display: "grid", gap: 6, padding: "6px 8px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(12,18,30,0.65)" }}>
                                    <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.7 }}>Preview Stack</div>
                                    {list.map((item, idx) => (
                                        <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", fontSize: 11 }}>
                                            <div style={{ fontWeight: 700 }}>{idx + 1}. {item.name}</div>
                                            <div style={{ opacity: 0.7 }}>Y {item.minY.toFixed(2)}</div>
                                            <div style={{ opacity: 0.7 }}>H {item.height.toFixed(2)}</div>
                                        </div>
                                    ))}
                                    {list.length > 1 && (
                                        <div style={{ fontSize: 10, opacity: 0.7 }}>Gap between decks: {spacing.toFixed(2)}</div>
                                    )}
                                </div>
                            );
                        })()}
                        <div style={{ display: "grid", gap: 6 }}>
                            {deckLayerOrder.map((id) => {
                                const deck = (decks || []).find((d) => d.id === id);
                                return (
                                    <div
                                        key={id}
                                        draggable
                                        onDragStart={() => setDeckLayerDragId(id)}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            if (!deckLayerDragId || deckLayerDragId === id) return;
                                            const next = deckLayerOrder.slice();
                                            const from = next.indexOf(deckLayerDragId);
                                            const to = next.indexOf(id);
                                            if (from === -1 || to === -1) return;
                                            next.splice(from, 1);
                                            next.splice(to, 0, deckLayerDragId);
                                            setDeckLayerOrder(next);
                                            if (deckLayerPreview) {
                                                applyDeckLayering({ preview: true });
                                            }
                                            setDeckLayerDragId(null);
                                        }}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            padding: "6px 8px",
                                            borderRadius: 10,
                                            border: "1px solid rgba(255,255,255,0.12)",
                                            background: "rgba(15,23,42,0.6)",
                                        }}
                                    >
                                        <div style={{ cursor: "grab", fontSize: 12, opacity: 0.7 }}>::</div>
                                        <div style={{ fontSize: 12, fontWeight: 700 }}>{deck?.name || deck?.label || id}</div>
                                    </div>
                                );
                            })}
                        </div>
                        <label>
                            Spacing between decks
                            <Input
                                type="number"
                                value={deckLayerSpacing}
                                step={0.1}
                                min={0}
                                onChange={(e) => {
                                    setDeckLayerSpacing(Number(e.target.value));
                                    if (deckLayerPreview) {
                                        applyDeckLayering({ preview: true });
                                    }
                                }}
                            />
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                            <input
                                type="checkbox"
                                checked={deckLayerPreview}
                                onChange={(e) => {
                                    const next = e.target.checked;
                                    setDeckLayerPreview(next);
                                    if (next) {
                                        captureDeckLayering(deckLayerOrder.length ? deckLayerOrder : deckLayerDialog.ids);
                                        applyDeckLayering({ preview: true });
                                    } else {
                                        restoreDeckLayering();
                                    }
                                }}
                            />
                            Live preview in scene
                        </label>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <Btn
                                variant="ghost"
                                onClick={() => {
                                    if (deckLayerPreview) restoreDeckLayering();
                                    setDeckLayerPreview(false);
                                    setDeckLayerDialog(null);
                                }}
                            >
                                Cancel
                            </Btn>
                            <Btn
                                onClick={() => {
                                    if (!deckLayerPreview) {
                                        captureDeckLayering(deckLayerOrder.length ? deckLayerOrder : deckLayerDialog.ids);
                                        applyDeckLayering({ preview: true });
                                    }
                                    setDeckLayerPreview(false);
                                    deckLayerSnapshotRef.current = null;
                                    setDeckLayerDialog(null);
                                }}
                            >
                                Apply
                            </Btn>
                        </div>
                    </div>
                </div>
            )}

            {deleteDeckDialog && (
                <div
                    onPointerDown={() => setDeleteDeckDialog(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10002,
                        background: "rgba(2,6,23,0.55)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 320,
                            maxWidth: "90vw",
                            borderRadius: 14,
                            padding: 14,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Delete Deck
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                            This will unassign all rooms and nodes from this deck.
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <Btn variant="ghost" onClick={() => setDeleteDeckDialog(null)}>Cancel</Btn>
                            <Btn
                                variant="primary"
                                onClick={() => {
                                    const id = deleteDeckDialog?.id;
                                    setDeleteDeckDialog(null);
                                    if (id) deleteDeck(id);
                                }}
                            >
                                Delete
                            </Btn>
                        </div>
                    </div>
                </div>
            )}
            {/* moved into templater wizard overlay */}
            {roomTemplateDialog && typeof document !== "undefined" && createPortal(
                <div
                    onPointerDown={() => setRoomTemplateDialog(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10003,
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            position: "fixed",
                            left: Math.min(
                                roomTemplateDialog.x || 0,
                                (typeof window !== "undefined" ? window.innerWidth : 1200) - 320
                            ),
                            top: Math.min(
                                roomTemplateDialog.y || 0,
                                (typeof window !== "undefined" ? window.innerHeight : 800) - 260
                            ),
                            width: 320,
                            borderRadius: 12,
                            border: "1px solid rgba(148,163,184,0.3)",
                            background: "rgba(15,23,42,0.95)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
                            padding: 12,
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 10,
                        }}
                    >
                        <div style={{ fontSize: 11, opacity: 0.8 }}>
                            Apply template to {roomTemplateDialog.roomIds?.length || 1} room(s)
                        </div>
                        <Select
                            value={roomTemplateDialog.templateId}
                            onChange={(e) => setRoomTemplateDialog((prev) => ({ ...(prev || {}), templateId: e.target.value }))}
                        >
                            {(templaterFinalRooms || []).map((tpl) => (
                                <option key={tpl.id} value={tpl.id}>
                                    {tpl.name || tpl.id}
                                </option>
                            ))}
                        </Select>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <Btn variant="ghost" onClick={() => setRoomTemplateDialog(null)}>Cancel</Btn>
                            <Btn
                                glow
                                className="templater-add-btn"
                                onClick={() => {
                                    const detail = {
                                        roomIds: roomTemplateDialog.roomIds || [],
                                        templateId: roomTemplateDialog.templateId,
                                    };
                                    window.dispatchEvent(new CustomEvent("EPIC3D_APPLY_TEMPLATE_TO_ROOM", { detail }));
                                    setRoomTemplateDialog(null);
                                }}
                            >
                                Apply
                            </Btn>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {pasteDialog && (
                <div
                    onPointerDown={() => setPasteDialog(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10003,
                        background: "rgba(2,6,23,0.55)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 380,
                            maxWidth: "90vw",
                            borderRadius: 14,
                            padding: 14,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Paste Room Contents
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                            Choose how to paste the copied room contents.
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <Btn variant="ghost" onClick={() => setPasteDialog(null)}>Cancel</Btn>
                            <Btn
                                variant="ghost"
                                onClick={() => {
                                    const target = pasteDialog?.targetRoomId;
                                    setPasteDialog(null);
                                    if (target) pasteRoomContents(target);
                                }}
                            >
                                Paste (Add)
                            </Btn>
                            <Btn
                                variant="primary"
                                onClick={() => {
                                    const target = pasteDialog?.targetRoomId;
                                    setPasteDialog(null);
                                    if (target) replaceRoomContents(target);
                                }}
                            >
                                Replace Existing
                            </Btn>
                        </div>
                    </div>
                </div>
            )}

            {selectorDialog && typeof document !== "undefined" && createPortal(
                <div
                    onPointerDown={() => setSelectorDialog(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10005,
                        background: "rgba(2,6,23,0.55)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 520,
                            maxWidth: "92vw",
                            borderRadius: 14,
                            padding: 14,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Selector
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {[
                                { key: "nodes", label: "Nodes" },
                                { key: "rooms", label: "Rooms" },
                                { key: "decks", label: "Decks" },
                                { key: "groups", label: "Groups" },
                            ].map((opt) => (
                                <button
                                    key={opt.key}
                                    type="button"
                                    onClick={() => setSelectorTarget(opt.key)}
                                    style={{
                                        border: selectorTarget === opt.key ? "1px solid rgba(56,189,248,0.55)" : "1px solid rgba(255,255,255,0.12)",
                                        background: selectorTarget === opt.key ? "rgba(56,189,248,0.18)" : "rgba(15,23,42,0.45)",
                                        color: "rgba(226,232,240,0.9)",
                                        padding: "6px 10px",
                                        borderRadius: 8,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                    }}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        {selectorTarget === "nodes" && (
                            <div style={{ display: "grid", gap: 10 }}>
                                <label style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Shape</div>
                                    <Select value={selectorShape} onChange={(e) => setSelectorShape(e.target.value)}>
                                        <option value="">(any)</option>
                                        {legendShapeOptions.map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </Select>
                                </label>
                                <label style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Cluster</div>
                                    <Select value={selectorCluster} onChange={(e) => setSelectorCluster(e.target.value)}>
                                        <option value="">(any)</option>
                                        {legendClusterOptions.map((c) => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </Select>
                                </label>
                                <label style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Dimensions</div>
                                    <Select value={selectorDimMode} onChange={(e) => setSelectorDimMode(e.target.value)}>
                                        <option value="none">(ignore)</option>
                                        <option value="manual">Manual</option>
                                        <option value="from-node">From node</option>
                                    </Select>
                                </label>
                                {selectorDimMode === "manual" && (
                                    <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
                                        {["X", "Y", "Z"].map((axis, idx) => (
                                            <label key={axis} style={{ display: "grid", gap: 4 }}>
                                                <div style={{ fontSize: 11, opacity: 0.7 }}>{axis}</div>
                                                <Input
                                                    value={String(selectorDimXYZ[idx] ?? "")}
                                                    onChange={(e) => {
                                                        const next = [...selectorDimXYZ];
                                                        next[idx] = e.target.value;
                                                        setSelectorDimXYZ(next);
                                                    }}
                                                    placeholder="0"
                                                />
                                            </label>
                                        ))}
                                    </div>
                                )}
                                {selectorDimMode === "from-node" && (
                                    <label style={{ display: "grid", gap: 6 }}>
                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Reference node</div>
                                        <Select value={selectorDimNodeId} onChange={(e) => setSelectorDimNodeId(e.target.value)}>
                                            <option value="">Select node</option>
                                            {(nodes || []).map((n) => (
                                                <option key={n.id} value={n.id}>{n.label || n.name || n.id}</option>
                                            ))}
                                        </Select>
                                    </label>
                                )}
                            </div>
                        )}

                        {selectorTarget === "rooms" && (
                            <div style={{ display: "grid", gap: 8 }}>
                                <Input
                                    value={selectorRoomFilter}
                                    onChange={(e) => setSelectorRoomFilter(e.target.value)}
                                    placeholder="Filter rooms..."
                                />
                                <div style={{ maxHeight: 160, overflow: "auto", display: "grid", gap: 4 }}>
                                    {(rooms || [])
                                        .filter((r) => String(r.name || r.label || r.id).toLowerCase().includes(String(selectorRoomFilter || "").toLowerCase()))
                                        .map((r) => (
                                            <label key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectorSelectedRooms.includes(r.id)}
                                                    onChange={() => {
                                                        setSelectorSelectedRooms((prev) =>
                                                            prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]
                                                        );
                                                    }}
                                                />
                                                <span>{r.name || r.label || r.id}</span>
                                            </label>
                                        ))}
                                </div>
                            </div>
                        )}

                        {selectorTarget === "decks" && (
                            <div style={{ display: "grid", gap: 8 }}>
                                <Input
                                    value={selectorDeckFilter}
                                    onChange={(e) => setSelectorDeckFilter(e.target.value)}
                                    placeholder="Filter decks..."
                                />
                                <div style={{ maxHeight: 160, overflow: "auto", display: "grid", gap: 4 }}>
                                    {(decks || [])
                                        .filter((d) => String(d.name || d.label || d.id).toLowerCase().includes(String(selectorDeckFilter || "").toLowerCase()))
                                        .map((d) => (
                                            <label key={d.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectorSelectedDecks.includes(d.id)}
                                                    onChange={() => {
                                                        setSelectorSelectedDecks((prev) =>
                                                            prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                                                        );
                                                    }}
                                                />
                                                <span>{d.name || d.label || d.id}</span>
                                            </label>
                                        ))}
                                </div>
                            </div>
                        )}

                        {selectorTarget === "groups" && (
                            <div style={{ display: "grid", gap: 8 }}>
                                <Input
                                    value={selectorGroupFilter}
                                    onChange={(e) => setSelectorGroupFilter(e.target.value)}
                                    placeholder="Filter groups..."
                                />
                                <div style={{ maxHeight: 160, overflow: "auto", display: "grid", gap: 4 }}>
                                    {(groups || [])
                                        .filter((g) => String(g.name || g.id).toLowerCase().includes(String(selectorGroupFilter || "").toLowerCase()))
                                        .map((g) => (
                                            <label key={g.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectorSelectedGroups.includes(g.id)}
                                                    onChange={() => {
                                                        setSelectorSelectedGroups((prev) =>
                                                            prev.includes(g.id) ? prev.filter((x) => x !== g.id) : [...prev, g.id]
                                                        );
                                                    }}
                                                />
                                                <span>{g.name || g.id}</span>
                                            </label>
                                        ))}
                                </div>
                            </div>
                        )}

                        <div style={{ display: "grid", gap: 8 }}>
                            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}>
                                <input
                                    type="checkbox"
                                    checked={selectorCreateGroup}
                                    onChange={(e) => setSelectorCreateGroup(e.target.checked)}
                                />
                                Create group from selection
                            </label>
                            {selectorCreateGroup && (
                                <Input
                                    value={selectorGroupName}
                                    onChange={(e) => setSelectorGroupName(e.target.value)}
                                    placeholder="Group name..."
                                />
                            )}
                        </div>

                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <Btn variant="ghost" onClick={() => setSelectorDialog(null)}>Cancel</Btn>
                            <Btn
                                variant="primary"
                                onClick={() => {
                                    applySelector();
                                    setSelectorDialog(null);
                                }}
                            >
                                Select
                            </Btn>
                        </div>
                    </div>
                    </div>,
                document.body
            )}
            {tileDialog && typeof document !== "undefined" && createPortal(
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10006,
                        background: "transparent",
                        pointerEvents: "none",
                    }}
                >
                    <div
                        style={{
                            position: "fixed",
                            left: 24,
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: 420,
                            maxWidth: "92vw",
                            borderRadius: 14,
                            padding: 16,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                            pointerEvents: "auto",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                Default Tile
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    applyTileDefaults();
                                    setTileDialog(null);
                                }}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 10,
                                    border: "1px solid rgba(148,163,184,0.3)",
                                    background: "rgba(15,23,42,0.6)",
                                    color: "rgba(226,232,240,0.85)",
                                    cursor: "pointer",
                                }}
                            >
                                x
                            </button>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {tileDialog.shapeLabel || tileDialog.shapeKey}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.75 }}>
                            Format: F-A1, C-A1, N-A1, S-A1, E-A1, W-A1
                        </div>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.75 }}>Default tile</div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input
                                    value={tileDialog.tileCode || ""}
                                    onChange={(e) => setTileDialog((d) => ({ ...d, tileCode: e.target.value }))}
                                    placeholder="F-A1"
                                    style={{
                                        flex: 1,
                                        height: 30,
                                        borderRadius: 8,
                                        border: "1px solid rgba(148,163,184,0.35)",
                                        background: "rgba(15,23,42,0.6)",
                                        color: "#e2e8f0",
                                        padding: "0 10px",
                                    }}
                                />
                                <button
                                    type="button"
                                    title="Pick tile from room"
                                    onClick={() => {
                                        setTileDialog((d) => {
                                            const fallbackRoomId = (rooms || [])[0]?.id || "";
                                            const roomId = d.roomId || selectedRoomId || fallbackRoomId;
                                            return {
                                                ...d,
                                                preview: true,
                                                roomId,
                                                pickMode: !d.pickMode,
                                            };
                                        });
                                    }}
                                    disabled={!((tileDialog.roomId || selectedRoomId || (rooms || [])[0]?.id) && (tileDialog.preview || selectedRoomId || (rooms || [])[0]?.id))}
                                    style={{
                                        width: 30,
                                        height: 30,
                                        borderRadius: 8,
                                        display: "grid",
                                        placeItems: "center",
                                        border: tileDialog.pickMode
                                            ? "1px solid rgba(56,189,248,0.6)"
                                            : "1px solid rgba(148,163,184,0.35)",
                                        background: tileDialog.pickMode
                                            ? "rgba(56,189,248,0.18)"
                                            : "rgba(15,23,42,0.6)",
                                        color: tileDialog.pickMode ? "#e0f2fe" : "rgba(226,232,240,0.85)",
                                        cursor: (tileDialog.roomId || selectedRoomId || (rooms || [])[0]?.id) ? "pointer" : "not-allowed",
                                        opacity: (tileDialog.roomId || selectedRoomId || (rooms || [])[0]?.id) ? 1 : 0.5,
                                    }}
                                >
                                    <TileIcon size={14} />
                                </button>
                                <label
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        letterSpacing: "0.06em",
                                        color: "rgba(226,232,240,0.75)",
                                        textTransform: "uppercase",
                                        padding: "0 6px",
                                        borderRadius: 8,
                                        border: "1px solid rgba(148,163,184,0.2)",
                                        background: "rgba(15,23,42,0.45)",
                                        height: 30,
                                        cursor: "pointer",
                                        userSelect: "none",
                                    }}
                                    title="Pick multiple tiles in order"
                                >
                                    <input
                                        type="checkbox"
                                        checked={!!tileDialog.multiPick}
                                        onChange={(e) => setTileDialog((d) => ({ ...d, multiPick: e.target.checked }))}
                                    />
                                    Multi
                                </label>
                            </div>
                        </label>
                        {!!(tileDialog.multiPick || (tileDialog.tileCodes && tileDialog.tileCodes.length > 1)) && (
                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 11, opacity: 0.75 }}>Tile order</div>
                                <div style={{ display: "grid", gap: 6 }}>
                                    {(tileDialog.tileCodes || []).map((code, idx) => (
                                        <div
                                            key={`${code}-${idx}`}
                                            draggable
                                            onDragStart={(e) => {
                                                e.dataTransfer.setData("text/plain", String(idx));
                                                e.dataTransfer.effectAllowed = "move";
                                                setTileDragOverIdx(idx);
                                            }}
                                            onDragEnter={(e) => {
                                                e.preventDefault();
                                                setTileDragOverIdx(idx);
                                            }}
                                            onDragLeave={(e) => {
                                                e.preventDefault();
                                                setTileDragOverIdx((cur) => (cur === idx ? null : cur));
                                            }}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = "move";
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                const fromIdx = Number(e.dataTransfer.getData("text/plain"));
                                                if (!Number.isFinite(fromIdx)) return;
                                                if (fromIdx === idx) return;
                                                setTileDialog((d) => {
                                                    const list = Array.isArray(d.tileCodes) ? [...d.tileCodes] : [];
                                                    const [moved] = list.splice(fromIdx, 1);
                                                    if (moved == null) return d;
                                                    list.splice(idx, 0, moved);
                                                    return { ...d, tileCodes: list, tileCode: list[0] || d.tileCode };
                                                });
                                                setTileDragOverIdx(null);
                                            }}
                                            onDragEnd={() => setTileDragOverIdx(null)}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6,
                                                padding: "4px 8px",
                                                borderRadius: 999,
                                                border: tileDragOverIdx === idx
                                                    ? "1px solid rgba(250,204,21,0.75)"
                                                    : "1px solid rgba(56,189,248,0.35)",
                                                background: tileDragOverIdx === idx
                                                    ? "rgba(250,204,21,0.12)"
                                                    : "rgba(15,23,42,0.55)",
                                                color: "rgba(226,232,240,0.9)",
                                                fontSize: 10,
                                                fontWeight: 700,
                                                letterSpacing: "0.04em",
                                            }}
                                        >
                                            <span
                                                title="Drag to reorder"
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    width: 18,
                                                    height: 18,
                                                    borderRadius: 6,
                                                    border: "1px solid rgba(148,163,184,0.35)",
                                                    background: "rgba(15,23,42,0.55)",
                                                    cursor: "grab",
                                                    fontSize: 11,
                                                }}
                                            >
                                                ::
                                            </span>
                                            <span style={{ opacity: 0.7 }}>{idx + 1}.</span>
                                            <span>{code}</span>
                                            <button
                                                type="button"
                                                title="Move up"
                                                onClick={() => {
                                                    if (idx === 0) return;
                                                    setTileDialog((d) => {
                                                        const list = Array.isArray(d.tileCodes) ? [...d.tileCodes] : [];
                                                        const tmp = list[idx - 1];
                                                        list[idx - 1] = list[idx];
                                                        list[idx] = tmp;
                                                        return { ...d, tileCodes: list, tileCode: list[0] || d.tileCode };
                                                    });
                                                }}
                                                style={{
                                                    width: 18,
                                                    height: 18,
                                                    borderRadius: 6,
                                                    border: "1px solid rgba(148,163,184,0.3)",
                                                    background: "rgba(15,23,42,0.55)",
                                                    color: "rgba(226,232,240,0.8)",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <ChevronUpIcon size={10} />
                                            </button>
                                            <button
                                                type="button"
                                                title="Move down"
                                                onClick={() => {
                                                    setTileDialog((d) => {
                                                        const list = Array.isArray(d.tileCodes) ? [...d.tileCodes] : [];
                                                        if (idx >= list.length - 1) return d;
                                                        const tmp = list[idx + 1];
                                                        list[idx + 1] = list[idx];
                                                        list[idx] = tmp;
                                                        return { ...d, tileCodes: list, tileCode: list[0] || d.tileCode };
                                                    });
                                                }}
                                                style={{
                                                    width: 18,
                                                    height: 18,
                                                    borderRadius: 6,
                                                    border: "1px solid rgba(148,163,184,0.3)",
                                                    background: "rgba(15,23,42,0.55)",
                                                    color: "rgba(226,232,240,0.8)",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <ChevronDownIcon size={10} />
                                            </button>
                                            <button
                                                type="button"
                                                title="Remove"
                                                onClick={() => {
                                                    setTileDialog((d) => {
                                                        const list = Array.isArray(d.tileCodes) ? [...d.tileCodes] : [];
                                                        list.splice(idx, 1);
                                                        return { ...d, tileCodes: list, tileCode: list[0] || d.tileCode };
                                                    });
                                                }}
                                                style={{
                                                    width: 18,
                                                    height: 18,
                                                    borderRadius: 6,
                                                    border: "1px solid rgba(148,163,184,0.3)",
                                                    background: "rgba(239,68,68,0.18)",
                                                    color: "rgba(254,226,226,0.9)",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <MinusIcon size={10} />
                                            </button>
                                        </div>
                                    ))}
                                    {!((tileDialog.tileCodes || []).length) && (
                                        <div style={{ fontSize: 11, opacity: 0.65 }}>
                                            Pick tiles in order to build a sequence.
                                        </div>
                                    )}
                                </div>
                                {((tileDialog.tileCodes || []).length > 1) && (
                                    <button
                                        type="button"
                                        onClick={() => setTileDialog((d) => ({ ...d, tileCodes: [], tileCode: d.tileCode }))}
                                        style={{
                                            alignSelf: "flex-start",
                                            border: "1px solid rgba(148,163,184,0.25)",
                                            background: "rgba(15,23,42,0.45)",
                                            color: "rgba(226,232,240,0.8)",
                                            borderRadius: 8,
                                            padding: "4px 8px",
                                            fontSize: 10,
                                            fontWeight: 700,
                                            letterSpacing: "0.06em",
                                            textTransform: "uppercase",
                                            cursor: "pointer",
                                        }}
                                    >
                                        Clear order
                                    </button>
                                )}
                            </div>
                        )}
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.75 }}>Alignment</div>
                            <Select
                                value={tileDialog.align || "center"}
                                onChange={(e) => setTileDialog((d) => ({ ...d, align: e.target.value }))}
                            >
                                <option value="center">Center</option>
                                <option value="top">Top</option>
                                <option value="bottom">Bottom</option>
                                <option value="left">Left</option>
                                <option value="right">Right</option>
                                <option value="top-left">Top Left</option>
                                <option value="top-center">Top Center</option>
                                <option value="top-right">Top Right</option>
                                <option value="center-left">Center Left</option>
                                <option value="center-right">Center Right</option>
                                <option value="bottom-left">Bottom Left</option>
                                <option value="bottom-center">Bottom Center</option>
                                <option value="bottom-right">Bottom Right</option>
                            </Select>
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.75, display: "flex", alignItems: "center", gap: 8 }}>
                                Offset (X / Y / Z)
                                <button
                                    type="button"
                                    title="Use move gizmo on preview"
                                    onClick={() => {
                                        if (!tileDialog?.preview) {
                                            setTileDialog((d) => ({ ...d, preview: true }));
                                        }
                                        const ids = tilePreviewIdRef.current || [];
                                        const id = Array.isArray(ids) ? ids[0] : ids;
                                        if (!id) return;
                                        setSelected?.({ type: "node", id });
                                        setMoveMode?.(true);
                                        setTransformMode?.("translate");
                                    }}
                                    style={{
                                        width: 26,
                                        height: 26,
                                        borderRadius: 6,
                                        border: "1px solid rgba(148,163,184,0.35)",
                                        background: "rgba(15,23,42,0.6)",
                                        color: "rgba(226,232,240,0.9)",
                                        cursor: "pointer",
                                        fontSize: 11,
                                        fontWeight: 700,
                                    }}
                                >
                                    ↔
                                </button>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                <input
                                    type="number"
                                    value={tileDialog.offsetX ?? 0}
                                    onChange={(e) => setTileDialog((d) => ({ ...d, offsetX: Number(e.target.value) }))}
                                    style={{
                                        height: 28,
                                        borderRadius: 8,
                                        border: "1px solid rgba(148,163,184,0.35)",
                                        background: "rgba(15,23,42,0.6)",
                                        color: "#e2e8f0",
                                        padding: "0 8px",
                                        fontSize: 11,
                                    }}
                                />
                                <input
                                    type="number"
                                    value={tileDialog.offsetY ?? 0}
                                    onChange={(e) => setTileDialog((d) => ({ ...d, offsetY: Number(e.target.value) }))}
                                    style={{
                                        height: 28,
                                        borderRadius: 8,
                                        border: "1px solid rgba(148,163,184,0.35)",
                                        background: "rgba(15,23,42,0.6)",
                                        color: "#e2e8f0",
                                        padding: "0 8px",
                                        fontSize: 11,
                                    }}
                                />
                                <input
                                    type="number"
                                    value={tileDialog.offsetZ ?? 0}
                                    onChange={(e) => setTileDialog((d) => ({ ...d, offsetZ: Number(e.target.value) }))}
                                    style={{
                                        height: 28,
                                        borderRadius: 8,
                                        border: "1px solid rgba(148,163,184,0.35)",
                                        background: "rgba(15,23,42,0.6)",
                                        color: "#e2e8f0",
                                        padding: "0 8px",
                                        fontSize: 11,
                                    }}
                                />
                            </div>
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.75 }}>Rotation (degrees)</div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input
                                    type="number"
                                    value={tileDialog.rotation ?? 0}
                                    onChange={(e) => setTileDialog((d) => ({ ...d, rotation: Number(e.target.value) }))}
                                    style={{
                                        height: 30,
                                        borderRadius: 8,
                                        border: "1px solid rgba(148,163,184,0.35)",
                                        background: "rgba(15,23,42,0.6)",
                                        color: "#e2e8f0",
                                        padding: "0 10px",
                                        flex: 1,
                                    }}
                                />
                                <button
                                    type="button"
                                    title="Rotate -15deg"
                                    onClick={() => setTileDialog((d) => ({ ...d, rotation: (Number(d.rotation) || 0) - 15 }))}
                                    style={{
                                        width: 34,
                                        height: 30,
                                        borderRadius: 8,
                                        border: "1px solid rgba(148,163,184,0.35)",
                                        background: "rgba(15,23,42,0.6)",
                                        color: "rgba(226,232,240,0.9)",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                    }}
                                >
                                    -15deg
                                </button>
                                <button
                                    type="button"
                                    title="Rotate +15deg"
                                    onClick={() => setTileDialog((d) => ({ ...d, rotation: (Number(d.rotation) || 0) + 15 }))}
                                    style={{
                                        width: 34,
                                        height: 30,
                                        borderRadius: 8,
                                        border: "1px solid rgba(148,163,184,0.35)",
                                        background: "rgba(15,23,42,0.6)",
                                        color: "rgba(226,232,240,0.9)",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                    }}
                                >
                                    +15deg
                                </button>
                            </div>
                        </label>
                            <div style={{ display: "grid", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <button
                                    type="button"
                                    title="Preview in room"
                                    onClick={() => setTileDialog((d) => {
                                        const nextPreview = !d.preview;
                                        return {
                                            ...d,
                                            preview: nextPreview,
                                            pickMode: nextPreview ? d.pickMode : false,
                                            pickRoomMode: nextPreview ? d.pickRoomMode : false,
                                        };
                                    })}
                                    style={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: 8,
                                        display: "grid",
                                        placeItems: "center",
                                        border: tileDialog.preview
                                            ? "1px solid rgba(56,189,248,0.6)"
                                            : "1px solid rgba(148,163,184,0.35)",
                                        background: tileDialog.preview
                                            ? "rgba(56,189,248,0.18)"
                                            : "rgba(15,23,42,0.6)",
                                        color: tileDialog.preview ? "#e0f2fe" : "rgba(226,232,240,0.85)",
                                        cursor: "pointer",
                                    }}
                                >
                                    <EyeIcon size={14} />
                                </button>
                                <Select
                                    value={tileDialog.roomId || ""}
                                    onChange={(e) => setTileDialog((d) => ({ ...d, roomId: e.target.value }))}
                                    disabled={!tileDialog.preview}
                                    style={{
                                        flex: 1,
                                        background: tileDialog.preview ? "rgba(15,23,42,0.6)" : "rgba(148,163,184,0.1)",
                                        color: tileDialog.preview ? "#e2e8f0" : "rgba(148,163,184,0.75)",
                                        border: "1px solid rgba(148,163,184,0.35)",
                                    }}
                                >
                                    <option value="">Select room...</option>
                                    {(rooms || []).map((r) => (
                                        <option key={r.id} value={r.id}>
                                            {r.name || r.label || r.id}
                                        </option>
                                    ))}
                                </Select>
                                <button
                                    type="button"
                                    title={tileDialog.preview ? "Pick room from scene" : "Enable preview to pick a room"}
                                    onClick={() => {
                                        if (!tileDialog.preview) return;
                                        setTileDialog((d) => ({ ...d, pickRoomMode: !d.pickRoomMode }));
                                    }}
                                    disabled={!tileDialog.preview}
                                    style={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: 8,
                                        display: "grid",
                                        placeItems: "center",
                                        border: tileDialog.pickRoomMode
                                            ? "1px solid rgba(56,189,248,0.6)"
                                            : "1px solid rgba(148,163,184,0.35)",
                                        background: tileDialog.pickRoomMode
                                            ? "rgba(56,189,248,0.18)"
                                            : tileDialog.preview
                                                ? "rgba(15,23,42,0.6)"
                                                : "rgba(148,163,184,0.1)",
                                        color: tileDialog.pickRoomMode ? "#e0f2fe" : "rgba(226,232,240,0.85)",
                                        cursor: tileDialog.preview ? "pointer" : "not-allowed",
                                        opacity: tileDialog.preview ? 1 : 0.5,
                                    }}
                                >
                                    <TargetIcon size={14} />
                                </button>
                            </div>
                            {tileDialog.preview && tileDialog.roomId && (
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                                        Preview tiles: {(tileDialog.multiPick && tileDialog.tileCodes?.length) ? tileDialog.tileCodes.length : 1}
                                    </div>
                                    <div style={{ display: "grid", gap: 6 }}>
                                        {((tileDialog.multiPick && tileDialog.tileCodes?.length)
                                            ? tileDialog.tileCodes
                                            : [tileDialog.tileCode || "F-A1"]).map((code, idx) => (
                                            <div
                                                key={`preview-${code}-${idx}`}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    gap: 8,
                                                    padding: "6px 10px",
                                                    borderRadius: 10,
                                                    border: "1px solid rgba(148,163,184,0.18)",
                                                    background: "rgba(15,23,42,0.45)",
                                                    color: "rgba(226,232,240,0.9)",
                                                    fontSize: 11,
                                                }}
                                            >
                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                    <div
                                                        style={{
                                                            width: 22,
                                                            height: 22,
                                                            borderRadius: 999,
                                                            display: "grid",
                                                            placeItems: "center",
                                                            fontSize: 10,
                                                            fontWeight: 800,
                                                            color: "#0f172a",
                                                            background: "rgba(56,189,248,0.85)",
                                                        }}
                                                    >
                                                        {idx + 1}
                                                    </div>
                                                    <div>{code}</div>
                                                </div>
                                                <div style={{ fontSize: 10, opacity: 0.7 }}>priority</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: tileDialog.preview ? 0.95 : 0.5 }}>
                                    <input
                                        type="checkbox"
                                        checked={tileDialog.previewShowFloor !== false}
                                        onChange={(e) => setTileDialog((d) => ({ ...d, previewShowFloor: e.target.checked }))}
                                        disabled={!tileDialog.preview}
                                    />
                                    Floor
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: tileDialog.preview ? 0.95 : 0.5 }}>
                                    <input
                                        type="checkbox"
                                        checked={tileDialog.previewShowCeiling !== false}
                                        onChange={(e) => setTileDialog((d) => ({ ...d, previewShowCeiling: e.target.checked }))}
                                        disabled={!tileDialog.preview}
                                    />
                                    Ceiling
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: tileDialog.preview ? 0.95 : 0.5 }}>
                                    <input
                                        type="checkbox"
                                        checked={tileDialog.previewShowWalls !== false}
                                        onChange={(e) => setTileDialog((d) => ({ ...d, previewShowWalls: e.target.checked }))}
                                        disabled={!tileDialog.preview}
                                    />
                                    Walls
                                </label>
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.7 }}>
                                Preview updates live while this dialog stays open.
                            </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <Btn
                                variant="ghost"
                                onClick={() => {
                                    applyTileDefaults();
                                    setTileDialog(null);
                                }}
                            >
                                Close
                            </Btn>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {tileBehaviorDialog && typeof document !== "undefined" && createPortal(
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10005,
                        background: "transparent",
                        pointerEvents: "none",
                    }}
                >
                    <div
                        style={{
                            position: "fixed",
                            left: 24,
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: 420,
                            maxWidth: "92vw",
                            borderRadius: 14,
                            padding: 16,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                            pointerEvents: "auto",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                Tile Behaviour
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    removeTileBehaviorPreview();
                                    setTileBehaviorDialog(null);
                                }}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 10,
                                    border: "1px solid rgba(148,163,184,0.3)",
                                    background: "rgba(15,23,42,0.6)",
                                    color: "rgba(226,232,240,0.85)",
                                    cursor: "pointer",
                                }}
                            >
                                x
                            </button>
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.75 }}>
                            Configure how multiple shapes stack on a shared tile.
                        </div>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.75 }}>Shape / Node 1</div>
                            <Select
                                value={tileBehaviorDialog.shapeA || ""}
                                onChange={(e) => setTileBehaviorDialog((d) => ({ ...d, shapeA: e.target.value }))}
                                style={{
                                    background: "rgba(15,23,42,0.6)",
                                    color: "#e2e8f0",
                                    border: "1px solid rgba(148,163,184,0.35)",
                                }}
                            >
                                <option value="">Select shape...</option>
                                {shapeOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </Select>
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.75 }}>Shape / Node 2</div>
                            <Select
                                value={tileBehaviorDialog.shapeB || ""}
                                onChange={(e) => setTileBehaviorDialog((d) => ({ ...d, shapeB: e.target.value }))}
                                style={{
                                    background: "rgba(15,23,42,0.6)",
                                    color: "#e2e8f0",
                                    border: "1px solid rgba(148,163,184,0.35)",
                                }}
                            >
                                <option value="">Select shape...</option>
                                {shapeOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </Select>
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.75 }}>Spacing</div>
                            <input
                                type="number"
                                value={tileBehaviorDialog.spacing ?? 0}
                                onChange={(e) => setTileBehaviorDialog((d) => ({ ...d, spacing: Number(e.target.value) }))}
                                style={{
                                    height: 30,
                                    borderRadius: 8,
                                    border: "1px solid rgba(148,163,184,0.35)",
                                    background: "rgba(15,23,42,0.6)",
                                    color: "#e2e8f0",
                                    padding: "0 10px",
                                }}
                            />
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <button
                                type="button"
                                title="Preview in room"
                                onClick={() => setTileBehaviorDialog((d) => ({ ...d, preview: !d.preview }))}
                                style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 8,
                                    display: "grid",
                                    placeItems: "center",
                                    border: tileBehaviorDialog.preview
                                        ? "1px solid rgba(56,189,248,0.6)"
                                        : "1px solid rgba(148,163,184,0.35)",
                                    background: tileBehaviorDialog.preview
                                        ? "rgba(56,189,248,0.18)"
                                        : "rgba(15,23,42,0.6)",
                                    color: tileBehaviorDialog.preview ? "#e0f2fe" : "rgba(226,232,240,0.85)",
                                    cursor: "pointer",
                                }}
                            >
                                <EyeIcon size={14} />
                            </button>
                            <Select
                                value={tileBehaviorDialog.roomId || ""}
                                onChange={(e) => setTileBehaviorDialog((d) => ({ ...d, roomId: e.target.value }))}
                                disabled={!tileBehaviorDialog.preview}
                                style={{
                                    flex: 1,
                                    background: tileBehaviorDialog.preview ? "rgba(15,23,42,0.6)" : "rgba(148,163,184,0.1)",
                                    color: tileBehaviorDialog.preview ? "#e2e8f0" : "rgba(148,163,184,0.75)",
                                    border: "1px solid rgba(148,163,184,0.35)",
                                }}
                            >
                                <option value="">Select room...</option>
                                {(rooms || []).map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.name || r.label || r.id}
                                    </option>
                                ))}
                            </Select>
                            <button
                                type="button"
                                title={tileBehaviorDialog.preview ? "Use selected room" : "Enable preview to pick a room"}
                                onClick={() => {
                                    if (!tileBehaviorDialog.preview) return;
                                    if (!selectedRoomId) return;
                                    setTileBehaviorDialog((d) => ({ ...d, roomId: selectedRoomId }));
                                }}
                                disabled={!tileBehaviorDialog.preview}
                                style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 8,
                                    display: "grid",
                                    placeItems: "center",
                                    border: "1px solid rgba(148,163,184,0.35)",
                                    background: tileBehaviorDialog.preview ? "rgba(15,23,42,0.6)" : "rgba(148,163,184,0.1)",
                                    color: tileBehaviorDialog.preview ? "rgba(226,232,240,0.9)" : "rgba(148,163,184,0.6)",
                                    cursor: tileBehaviorDialog.preview ? "pointer" : "not-allowed",
                                    opacity: tileBehaviorDialog.preview ? 1 : 0.5,
                                }}
                            >
                                <TargetIcon size={14} />
                            </button>
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.65 }}>
                            Preview uses each shape's default tile and stacks if multiple share the same tile.
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {simulateDialog && typeof document !== "undefined" && createPortal(
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10005,
                        background: "transparent",
                        pointerEvents: "none",
                    }}
                >
                    <div
                        style={{
                            position: "fixed",
                            left: 24,
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: 600,
                            maxWidth: "94vw",
                            borderRadius: 16,
                            padding: 16,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                            pointerEvents: "auto",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                Simulate Room
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!defaultSimEnabled) {
                                        removeSimPreview();
                                    }
                                    setSimulateDialog(null);
                                }}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 10,
                                    border: "1px solid rgba(148,163,184,0.3)",
                                    background: "rgba(15,23,42,0.6)",
                                    color: "rgba(226,232,240,0.85)",
                                    cursor: "pointer",
                                }}
                            >
                                x
                            </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 11, opacity: 0.7 }}>Shapes</div>
                                <div style={{
                                    border: "1px solid rgba(148,163,184,0.2)",
                                    borderRadius: 10,
                                    padding: 6,
                                    height: 260,
                                    maxHeight: 260,
                                    overflow: "auto",
                                    scrollbarWidth: "thin",
                                    scrollbarColor: "rgba(148,163,184,0.45) rgba(15,23,42,0.5)",
                                }}>
                                    {(shapeOptions || []).map((opt) => (
                                        <div
                                            key={opt.value}
                                            onDoubleClick={() => {
                                                setSimulateDialog((d) => {
                                                    const items = Array.isArray(d.items) ? [...d.items] : [];
                                                    const existing = items.find((it) => it.shape === opt.value);
                                                    if (existing) {
                                                        existing.qty = Math.min(999, (existing.qty || 1) + 1);
                                                    } else {
                                                        items.push({ shape: opt.value, qty: 1 });
                                                    }
                                                    return { ...d, items };
                                                });
                                            }}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                gap: 8,
                                                padding: "6px 8px",
                                                borderRadius: 8,
                                                cursor: "pointer",
                                                background: "rgba(15,23,42,0.45)",
                                                border: "1px solid rgba(255,255,255,0.04)",
                                                marginBottom: 6,
                                                fontSize: 12,
                                            }}
                                        >
                                            <span>{opt.label}</span>
                                            <span style={{ fontSize: 10, opacity: 0.6 }}>dbl click</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 11, opacity: 0.7 }}>Shopping list</div>
                                <div style={{
                                    border: "1px solid rgba(148,163,184,0.2)",
                                    borderRadius: 10,
                                    padding: 6,
                                    height: 260,
                                    maxHeight: 260,
                                    overflow: "auto",
                                    scrollbarWidth: "thin",
                                    scrollbarColor: "rgba(148,163,184,0.45) rgba(15,23,42,0.5)",
                                }}>
                                    {(simulateDialog.items || []).map((it, idx) => (
                                        <div
                                            key={`${it.shape}-${idx}`}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                                padding: "6px 8px",
                                                borderRadius: 8,
                                                background: "rgba(15,23,42,0.55)",
                                                border: "1px solid rgba(255,255,255,0.06)",
                                                marginBottom: 6,
                                            }}
                                        >
                                            <div style={{ flex: 1, fontSize: 12 }}>{shapeLabelMap.get(it.shape) || it.shape}</div>
                                            <input
                                                type="number"
                                                min={1}
                                                value={it.qty ?? 1}
                                                onChange={(e) => {
                                                    const v = Math.max(1, Math.min(999, Math.floor(Number(e.target.value) || 1)));
                                                    setSimulateDialog((d) => {
                                                        const items = Array.isArray(d.items) ? [...d.items] : [];
                                                        if (!items[idx]) return d;
                                                        items[idx] = { ...items[idx], qty: v };
                                                        return { ...d, items };
                                                    });
                                                }}
                                                style={{
                                                    width: 60,
                                                    height: 26,
                                                    borderRadius: 6,
                                                    border: "1px solid rgba(148,163,184,0.35)",
                                                    background: "rgba(15,23,42,0.6)",
                                                    color: "#e2e8f0",
                                                    padding: "0 6px",
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSimulateDialog((d) => {
                                                        const items = Array.isArray(d.items) ? [...d.items] : [];
                                                        items.splice(idx, 1);
                                                        return { ...d, items };
                                                    });
                                                }}
                                                style={{
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: 6,
                                                    border: "1px solid rgba(248,113,113,0.45)",
                                                    background: "rgba(127,29,29,0.35)",
                                                    color: "rgba(254,226,226,0.9)",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                <MinusIcon size={12} />
                                            </button>
                                        </div>
                                    ))}
                                    {(!simulateDialog.items || !simulateDialog.items.length) && (
                                        <div style={{ fontSize: 11, opacity: 0.6, padding: "6px 8px" }}>
                                            Double click shapes to add them.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <button
                                type="button"
                                title="Preview in room"
                                onClick={() => setSimulateDialog((d) => ({ ...d, preview: !d.preview }))}
                                style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 8,
                                    display: "grid",
                                    placeItems: "center",
                                    border: simulateDialog.preview
                                        ? "1px solid rgba(56,189,248,0.6)"
                                        : "1px solid rgba(148,163,184,0.35)",
                                    background: simulateDialog.preview
                                        ? "rgba(56,189,248,0.18)"
                                        : "rgba(15,23,42,0.6)",
                                    color: simulateDialog.preview ? "#e0f2fe" : "rgba(226,232,240,0.85)",
                                    cursor: "pointer",
                                }}
                            >
                                <EyeIcon size={14} />
                            </button>
                            <Select
                                value={simulateDialog.roomId || ""}
                                onChange={(e) => setSimulateDialog((d) => ({ ...d, roomId: e.target.value }))}
                                disabled={!simulateDialog.preview}
                                style={{
                                    flex: 1,
                                    background: simulateDialog.preview ? "rgba(15,23,42,0.6)" : "rgba(148,163,184,0.1)",
                                    color: simulateDialog.preview ? "#e2e8f0" : "rgba(148,163,184,0.75)",
                                    border: "1px solid rgba(148,163,184,0.35)",
                                }}
                            >
                                <option value="">Select room...</option>
                                {(rooms || []).map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.name || r.label || r.id}
                                    </option>
                                ))}
                            </Select>
                            <button
                                type="button"
                                title={simulateDialog.preview ? "Use selected room" : "Enable preview to pick a room"}
                                onClick={() => {
                                    if (!simulateDialog.preview) return;
                                    if (!selectedRoomId) return;
                                    setSimulateDialog((d) => ({ ...d, roomId: selectedRoomId }));
                                }}
                                disabled={!simulateDialog.preview}
                                style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 8,
                                    display: "grid",
                                    placeItems: "center",
                                    border: "1px solid rgba(148,163,184,0.35)",
                                    background: simulateDialog.preview ? "rgba(15,23,42,0.6)" : "rgba(148,163,184,0.1)",
                                    color: simulateDialog.preview ? "rgba(226,232,240,0.9)" : "rgba(148,163,184,0.6)",
                                    cursor: simulateDialog.preview ? "pointer" : "not-allowed",
                                    opacity: simulateDialog.preview ? 1 : 0.5,
                                }}
                            >
                                <TargetIcon size={14} />
                            </button>
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.65 }}>
                            Preview uses Room Behaviour defaults (tiles, anchors, and link styles).
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                            Preview room: {simulateDialog.roomId || selectedRoomId || "none"} - Items: {(simulateDialog.items || []).length}
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input
                                    type="text"
                                    value={simulatePresetName}
                                    onChange={(e) => setSimulatePresetName(e.target.value)}
                                    placeholder="Preset name"
                                    style={{
                                        flex: 1,
                                        height: 30,
                                        borderRadius: 8,
                                        border: "1px solid rgba(148,163,184,0.35)",
                                        background: "rgba(15,23,42,0.6)",
                                        color: "#e2e8f0",
                                        padding: "0 10px",
                                        fontSize: 12,
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const name = String(simulatePresetName || "").trim();
                                        if (!name) return;
                                        const payload = {
                                            id: `${name.toLowerCase().replace(/\s+/g, "_")}_${Date.now().toString(36)}`,
                                            name,
                                            roomId: simulateDialog.roomId || "",
                                            items: Array.isArray(simulateDialog.items) ? simulateDialog.items : [],
                                        };
                                        setSimulatePresets((prev) => [...(prev || []), payload]);
                                        setSimulatePresetName("");
                                    }}
                                    style={{
                                        border: "1px solid rgba(34,197,94,0.45)",
                                        background: "rgba(34,197,94,0.2)",
                                        color: "rgba(220,252,231,0.95)",
                                        padding: "6px 10px",
                                        borderRadius: 8,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                    }}
                                >
                                    Save preset
                                </button>
                            </div>
                            {(simulatePresets || []).length > 0 && (
                                <Select
                                    value=""
                                    onChange={(e) => {
                                        const id = e.target.value;
                                        if (!id) return;
                                        const preset = (simulatePresets || []).find((p) => p.id === id);
                                        if (!preset) return;
                                        setSimulateDialog((d) => ({
                                            ...(d || {}),
                                            items: Array.isArray(preset.items) ? preset.items : [],
                                            roomId: preset.roomId || d?.roomId || "",
                                        }));
                                    }}
                                    style={{
                                        background: "rgba(15,23,42,0.6)",
                                        color: "rgba(226,232,240,0.9)",
                                        border: "1px solid rgba(148,163,184,0.35)",
                                    }}
                                >
                                    <option value="">Load saved preset...</option>
                                    {(simulatePresets || []).map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name || p.id}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </div>
                        {simulateDialog.preview && !(simulateDialog.roomId || selectedRoomId) && (
                            <div style={{ fontSize: 11, color: "rgba(248,113,113,0.95)" }}>
                                Select a room to preview.
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}

            {templaterWizardOpen && typeof document !== "undefined" && createPortal(
                <div
                    onPointerDown={() => setTemplaterWizardOpen(false)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10006,
                        background: "rgba(2,6,23,0.6)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 1520,
                            maxWidth: "94vw",
                            height: "78vh",
                            maxHeight: "88vh",
                            position: "relative",
                            borderRadius: 16,
                            padding: 16,
                            background: "linear-gradient(160deg, rgba(7,12,22,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 44px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gridTemplateRows: "auto 1fr",
                            gap: 12,
                        }}
                    >
                        {templaterDeleteDialog && (
                            <div
                                onPointerDown={() => setTemplaterDeleteDialog(null)}
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    zIndex: 12,
                                    background: "rgba(2,6,23,0.6)",
                                    display: "grid",
                                    placeItems: "center",
                                    borderRadius: 16,
                                }}
                            >
                                <div
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            const ids = templaterDeleteDialog?.ids;
                                            const id = templaterDeleteDialog?.id;
                                            setTemplaterDeleteDialog(null);
                                            if (Array.isArray(ids) && ids.length) {
                                                ids.forEach((rid) => deleteTemplaterRoom(rid));
                                            } else if (id) {
                                                deleteTemplaterRoom(id);
                                            }
                                        }
                                    }}
                                    tabIndex={0}
                                    style={{
                                        width: 420,
                                        maxWidth: "92vw",
                                        borderRadius: 14,
                                        padding: 14,
                                        background: "linear-gradient(160deg, rgba(12,17,28,0.98), rgba(15,23,42,0.98))",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                                        color: "rgba(226,232,240,0.95)",
                                        display: "grid",
                                        gap: 10,
                                    }}
                                >
                                    <div style={{ fontSize: 12, fontWeight: 700 }}>Delete templated room?</div>
                                    <div style={{ fontSize: 11, opacity: 0.75 }}>
                                        "{templaterDeleteDialog.name}" has {templaterDeleteDialog.count} item(s). This cannot be undone.
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                                        <Btn variant="ghost" onClick={() => setTemplaterDeleteDialog(null)}>Cancel</Btn>
                                        <Btn
                                            glow
                                            className="templater-add-btn"
                                            onClick={() => {
                                                const ids = templaterDeleteDialog?.ids;
                                                const id = templaterDeleteDialog?.id;
                                                setTemplaterDeleteDialog(null);
                                                if (Array.isArray(ids) && ids.length) {
                                                    ids.forEach((rid) => deleteTemplaterRoom(rid));
                                                } else if (id) {
                                                    deleteTemplaterRoom(id);
                                                }
                                            }}
                                        >
                                            Delete
                                        </Btn>
                                    </div>
                                </div>
                            </div>
                        )}
                        <style>{`
                            .templater-add-btn {
                                border: 1px solid rgba(56,189,248,0.5);
                                background: linear-gradient(130deg, rgba(56,189,248,0.25), rgba(15,23,42,0.8));
                                color: #e2f2ff;
                                font-weight: 700;
                                box-shadow: 0 10px 18px rgba(14,116,144,0.25);
                            }
                            .generate-btn {
                                position: relative;
                                overflow: hidden;
                                border: 1px solid rgba(56,189,248,0.65);
                                background: linear-gradient(135deg, rgba(56,189,248,0.35), rgba(14,116,144,0.25), rgba(15,23,42,0.9));
                                box-shadow: 0 16px 28px rgba(56,189,248,0.28), inset 0 0 18px rgba(56,189,248,0.18);
                            }
                            .generate-btn::before {
                                content: "";
                                position: absolute;
                                inset: -40% -20%;
                                background: radial-gradient(circle, rgba(56,189,248,0.6), rgba(14,116,144,0.0));
                                opacity: 0.0;
                                animation: generate-glow 2.4s ease-in-out infinite;
                                pointer-events: none;
                            }
                            .generate-btn::after {
                                content: "";
                                position: absolute;
                                inset: -30% -10%;
                                background: radial-gradient(circle, rgba(253,224,71,0.5), rgba(15,23,42,0));
                                opacity: 0;
                                animation: generate-spark 2.6s ease-in-out infinite;
                                pointer-events: none;
                            }
                            .generate-btn span.sparkle {
                                position: absolute;
                                width: 6px;
                                height: 6px;
                                border-radius: 999px;
                                background: radial-gradient(circle, rgba(253,224,71,0.95), rgba(56,189,248,0.1));
                                opacity: 0;
                                animation: wizard-spark 1.6s ease-in-out infinite;
                                pointer-events: none;
                            }
                            .generate-btn span.sparkle.s1 { left: 12px; top: 8px; animation-delay: 0s; }
                            .generate-btn span.sparkle.s2 { right: 16px; top: 10px; animation-delay: 0.5s; }
                            .generate-btn span.sparkle.s3 { left: 50%; bottom: 8px; animation-delay: 0.9s; }
                            @keyframes generate-glow {
                                0% { opacity: 0; transform: translateX(-20%) scale(0.85); }
                                50% { opacity: 0.7; transform: translateX(0%) scale(1); }
                                100% { opacity: 0; transform: translateX(20%) scale(0.9); }
                            }
                            @keyframes generate-spark {
                                0% { opacity: 0; transform: translateY(10%) scale(0.8); }
                                50% { opacity: 0.9; transform: translateY(-5%) scale(1); }
                                100% { opacity: 0; transform: translateY(10%) scale(0.8); }
                            }
                            .bulk-btn {
                                position: relative;
                                overflow: hidden;
                                border: 1px solid rgba(167,139,250,0.5);
                                background: linear-gradient(135deg, rgba(167,139,250,0.18), rgba(15,23,42,0.85));
                                color: #f1f5f9;
                            }
                            .bulk-btn::after {
                                content: "";
                                position: absolute;
                                inset: -40% -20%;
                                background: radial-gradient(circle, rgba(253,224,71,0.5), rgba(15,23,42,0));
                                opacity: 0;
                                transition: opacity 0.2s ease;
                                animation: bulk-pulse 2.2s ease-in-out infinite;
                                pointer-events: none;
                            }
                            .bulk-btn:hover::after { opacity: 0.8; }
                            @keyframes bulk-pulse {
                                0% { transform: translateX(-30%) scale(0.8); opacity: 0; }
                                50% { transform: translateX(0%) scale(1); opacity: 0.7; }
                                100% { transform: translateX(30%) scale(0.9); opacity: 0; }
                            }
                            .templater-scroll {
                                scrollbar-width: thin;
                                scrollbar-color: rgba(148,163,184,0.6) rgba(15,23,42,0.4);
                            }
                            .templater-scroll::-webkit-scrollbar {
                                width: 8px;
                                height: 8px;
                            }
                            .templater-scroll::-webkit-scrollbar-track {
                                background: rgba(15,23,42,0.4);
                                border-radius: 999px;
                            }
                            .templater-scroll::-webkit-scrollbar-thumb {
                                background: linear-gradient(180deg, rgba(56,189,248,0.65), rgba(99,102,241,0.65));
                                border-radius: 999px;
                                border: 2px solid rgba(15,23,42,0.6);
                            }
                        `}</style>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                                Templater Wizard
                            </div>
                            <button
                                type="button"
                                onClick={() => setTemplaterWizardOpen(false)}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 8,
                                    border: "1px solid rgba(148,163,184,0.35)",
                                    background: "rgba(15,23,42,0.6)",
                                    color: "rgba(226,232,240,0.9)",
                                    cursor: "pointer",
                                }}
                            >
                                x
                            </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr 1.1fr 1.2fr", gap: 14, minHeight: 0 }}>
                            <div style={{
                                border: "1px solid rgba(148,163,184,0.2)",
                                borderRadius: 12,
                                padding: 10,
                                overflow: "auto",
                                minHeight: 0,
                            }}>
                                <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>Existing decks</div>
                                {(decks || []).map((d) => (
                                    <div key={d.id} style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, background: "rgba(15,23,42,0.55)", marginBottom: 4 }}>
                                        {d.name || d.label || d.id}
                                    </div>
                                ))}
                                {(!decks || !decks.length) && (
                                    <div style={{ fontSize: 11, opacity: 0.6 }}>No decks yet.</div>
                                )}
                                {templaterDecks && templaterDecks.length > 0 && (
                                    <>
                                        <div style={{ fontSize: 11, opacity: 0.7, margin: "10px 0 6px" }}>Templated decks</div>
                                        {templaterDecks.map((d) => (
                                            <div key={d.id} style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, background: "rgba(15,23,42,0.55)", marginBottom: 4 }}>
                                                {d.name || d.id} (templated)
                                            </div>
                                        ))}
                                    </>
                                )}
                                <div style={{ fontSize: 11, opacity: 0.7, margin: "10px 0 6px" }}>Existing rooms</div>
                                {(rooms || []).map((r) => (
                                    <div key={r.id} style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, background: "rgba(15,23,42,0.55)", marginBottom: 4 }}>
                                        {r.name || r.label || r.id}
                                    </div>
                                ))}
                                {(!rooms || !rooms.length) && (
                                    <div style={{ fontSize: 11, opacity: 0.6 }}>No rooms yet.</div>
                                )}
                            </div>
                            <div style={{
                                border: "1px solid rgba(148,163,184,0.2)",
                                borderRadius: 12,
                                padding: 14,
                                display: "grid",
                                gap: 12,
                                overflow: "auto",
                                minHeight: 0,
                                background: "linear-gradient(160deg, rgba(8,13,22,0.9), rgba(15,23,42,0.92))",
                            }}>
                                <div
                                    style={{
                                        borderRadius: 12,
                                        border: "1px solid rgba(148,163,184,0.25)",
                                        background: "linear-gradient(160deg, rgba(10,15,26,0.92), rgba(15,23,42,0.95))",
                                        padding: 10,
                                        display: "grid",
                                        gap: 10,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                            Add rooms
                                        </div>
                                        <span style={{ fontSize: 10, opacity: 0.6 }}>
                                            Defaults + naming
                                        </span>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 11, opacity: 0.7 }}>Quantity</div>
                                            <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 28px", gap: 6 }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setTemplaterRoomQty((v) => Math.max(1, (Number(v) || 1) - 1))}
                                                    style={{
                                                        height: 32,
                                                        borderRadius: 8,
                                                        border: "1px solid rgba(148,163,184,0.35)",
                                                        background: "rgba(15,23,42,0.6)",
                                                        color: "rgba(226,232,240,0.9)",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    <MinusIcon size={12} />
                                                </button>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    max={999}
                                                    value={templaterRoomQty}
                                                    onChange={(e) => setTemplaterRoomQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setTemplaterRoomQty((v) => Math.min(999, (Number(v) || 1) + 1))}
                                                    style={{
                                                        height: 32,
                                                        borderRadius: 8,
                                                        border: "1px solid rgba(56,189,248,0.45)",
                                                        background: "rgba(56,189,248,0.16)",
                                                        color: "#e2f2ff",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    <PlusIcon size={12} />
                                                </button>
                                            </div>
                                        </label>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 11, opacity: 0.7 }}>Prefix</div>
                                            <Input
                                                value={templaterRoomPrefix}
                                                onChange={(e) => setTemplaterRoomPrefix(e.target.value)}
                                                placeholder="Room "
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 11, opacity: 0.7 }}>Room type</div>
                                            <Select
                                                value={templaterRoomTypeDefault}
                                                onChange={(e) => setTemplaterRoomTypeDefault(e.target.value)}
                                            >
                                                <option value="">Unspecified</option>
                                                {roomTypeOptions.map((opt) => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                ))}
                                            </Select>
                                        </label>
                                        <label style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 11, opacity: 0.7 }}>Deck assignment</div>
                                            <Select
                                                value={templaterRoomDeckDefault}
                                                onChange={(e) => setTemplaterRoomDeckDefault(e.target.value)}
                                            >
                                                <option value="">No deck</option>
                                                {templaterDeckOptions.map((opt) => (
                                                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                                                ))}
                                            </Select>
                                        </label>
                                    </div>
                                    <label style={{ display: "grid", gap: 6 }}>
                                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                                            Optional names (comma separated)
                                            <span style={{ marginLeft: 6, opacity: 0.65 }}>
                                                ({templaterNameCount}/{templaterRoomQty || 0})
                                            </span>
                                        </div>
                                        <Input
                                            value={templaterRoomNames}
                                            onChange={(e) => setTemplaterRoomNames(e.target.value)}
                                            placeholder="Crew Mess, Captain's Cabin..."
                                        />
                                    </label>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                        <div style={{ fontSize: 10, opacity: 0.6 }}>
                                            Rooms generate as templates until placed.
                                        </div>
                                        <Btn
                                            onClick={addTemplateRooms}
                                            glow
                                            className="templater-add-btn generate-btn"
                                            style={{ fontSize: 11, padding: "6px 10px", borderRadius: 10, minWidth: 150 }}
                                        >
                                            Generate Rooms
                                            <span className="sparkle s1" />
                                            <span className="sparkle s2" />
                                            <span className="sparkle s3" />
                                        </Btn>
                                    </div>
                                </div>
                                <div style={{ height: 1, background: "rgba(148,163,184,0.2)" }} />
                                <div
                                    style={{
                                        borderRadius: 12,
                                        border: "1px solid rgba(148,163,184,0.25)",
                                        background: "linear-gradient(160deg, rgba(10,15,26,0.92), rgba(15,23,42,0.95))",
                                        padding: 10,
                                        display: "grid",
                                        gap: 10,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                            Add decks
                                        </div>
                                        <span style={{ fontSize: 10, opacity: 0.6 }}>Create deck templates</span>
                                    </div>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <Input
                                            value={templaterDeckName}
                                            onChange={(e) => setTemplaterDeckName(e.target.value)}
                                            placeholder="Deck name..."
                                            style={{ flex: 1 }}
                                        />
                                        <button
                                            type="button"
                                            onClick={addTemplateDeck}
                                            title="Add deck"
                                            style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 8,
                                                border: "1px solid rgba(56,189,248,0.45)",
                                                background: "rgba(56,189,248,0.16)",
                                                color: "#e2f2ff",
                                                cursor: "pointer",
                                            }}
                                        >
                                            <PlusIcon size={12} />
                                        </button>
                                    </div>
                                </div>
                                <div style={{ fontSize: 11, opacity: 0.6 }}>
                                    Rooms are created as unplaced templates. You can later place them in the scene.
                                </div>
                            </div>
                            <div style={{
                                border: "1px solid rgba(148,163,184,0.2)",
                                borderRadius: 12,
                                padding: 10,
                                overflow: "hidden",
                                minHeight: 0,
                                display: "grid",
                                gridTemplateRows: "auto auto 1fr",
                                gap: 8,
                            }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2, gap: 8 }}>
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>Generated rooms</div>
                                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                        {(Array.isArray(templaterSelectedRoomIds) && templaterSelectedRoomIds.length > 0) && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const ids = Array.isArray(templaterSelectedRoomIds) ? templaterSelectedRoomIds : [];
                                                    if (!ids.length) return;
                                                    const count = ids.reduce((acc, id) => {
                                                        const room = (templaterRooms || []).find((r) => r.id === id);
                                                        return acc + (room ? templateRoomItemCount(room) : 0);
                                                    }, 0);
                                                    if (count > 0) {
                                                        setTemplaterDeleteDialog({
                                                            ids,
                                                            name: `${ids.length} rooms`,
                                                            count,
                                                        });
                                                    } else {
                                                        ids.forEach((id) => deleteTemplaterRoom(id));
                                                    }
                                                }}
                                                style={{
                                                    padding: "4px 8px",
                                                    borderRadius: 8,
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    cursor: "pointer",
                                                    border: "1px solid rgba(248,113,113,0.45)",
                                                    background: "rgba(127,29,29,0.35)",
                                                    color: "rgba(254,226,226,0.9)",
                                                }}
                                            >
                                                Delete selected
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="bulk-btn"
                                            onClick={() => {
                                                const roomsList = Array.isArray(templaterRooms) ? templaterRooms : [];
                                                const ids = roomsList.map((room) => room.id);
                                                setTemplaterSelectedRoomIds(ids);
                                                setTemplaterSelectedRoomId("__all__");
                                            }}
                                            style={{
                                                padding: "4px 8px",
                                                borderRadius: 8,
                                                fontSize: 10,
                                                fontWeight: 700,
                                                cursor: "pointer",
                                            }}
                                        >
                                            Select all
                                        </button>
                                    </div>
                                </div>
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 10, opacity: 0.65 }}>Search</div>
                                    <Input
                                        value={templaterGeneratedFilter}
                                        onChange={(e) => setTemplaterGeneratedFilter(e.target.value)}
                                        placeholder="Search generated rooms..."
                                        type="search"
                                        style={{ fontSize: 11, width: "100%" }}
                                    />
                                </div>
                                <div style={{ overflow: "auto", minHeight: 0 }} className="templater-scroll">
                                    {(() => {
                                        const roomsList = Array.isArray(templaterRooms) ? templaterRooms : [];
                                        const selectedIds = new Set(Array.isArray(templaterSelectedRoomIds) ? templaterSelectedRoomIds : []);
                                        const setupLabel = (id) => {
                                            if (!id) return "No setup";
                                            const setup = (templaterSetups || []).find((s) => s?.id === id);
                                            return setup ? setup.name || setup.id : "Unknown setup";
                                        };
                                        const deckLabel = (id) => {
                                            if (!id) return "No Deck";
                                            const fromLive = (decks || []).find((d) => d?.id === id);
                                            if (fromLive) return fromLive.name || fromLive.label || fromLive.id;
                                            const fromTpl = (templaterDecks || []).find((d) => d?.id === id);
                                            return fromTpl ? `${fromTpl.name || fromTpl.id} (templated)` : id;
                                        };
                                        const filterValue = String(templaterGeneratedFilter || "").trim().toLowerCase();
                                        const filteredRooms = filterValue
                                            ? roomsList.filter((room) => {
                                                const haystack = [
                                                    room?.name,
                                                    room?.label,
                                                    room?.title,
                                                    room?.id,
                                                    room?.tag,
                                                    room?.roomType,
                                                    deckLabel(room?.deckId),
                                                    setupLabel(room?.setupId),
                                                ]
                                                    .filter(Boolean)
                                                    .join(" ")
                                                    .toLowerCase();
                                                return haystack.includes(filterValue);
                                            })
                                            : roomsList;
                                        const byDeck = new Map();
                                        filteredRooms.forEach((room) => {
                                            const deckId = room?.deckId || "";
                                            if (!byDeck.has(deckId)) byDeck.set(deckId, []);
                                            byDeck.get(deckId).push(room);
                                        });
                                        const sortedDeckIds = Array.from(byDeck.keys()).sort((a, b) => deckLabel(a).localeCompare(deckLabel(b)));
                                        const placedIds = new Set((rooms || []).map((r) => r.templateId || r.id));
                                        return sortedDeckIds.map((deckId) => (
                                            <div key={deckId || "nodeck"} style={{ marginBottom: 8 }}>
                                                <div
                                                    style={{
                                                        fontSize: 11,
                                                        fontWeight: 800,
                                                        letterSpacing: "0.08em",
                                                        textTransform: "uppercase",
                                                        color: "#f8fafc",
                                                        marginBottom: 6,
                                                        padding: "4px 8px",
                                                        borderRadius: 8,
                                                        background: "rgba(15,23,42,0.85)",
                                                        border: "1px solid rgba(148,163,184,0.35)",
                                                        boxShadow: "0 6px 12px rgba(0,0,0,0.25)",
                                                    }}
                                                >
                                                    {deckLabel(deckId)}
                                                </div>
                                                {(() => {
                                                    const roomsInDeck = byDeck.get(deckId) || [];
                                                    const bySetup = new Map();
                                                    roomsInDeck.forEach((room) => {
                                                        const setupId = room?.setupId || "";
                                                        if (!bySetup.has(setupId)) bySetup.set(setupId, []);
                                                        bySetup.get(setupId).push(room);
                                                    });
                                                    const sortedSetupIds = Array.from(bySetup.keys()).sort((a, b) => setupLabel(a).localeCompare(setupLabel(b)));
                                                    return sortedSetupIds.map((setupId) => (
                                                        <div key={`${deckId || "nodeck"}_${setupId || "nosetup"}`} style={{ marginBottom: 6 }}>
                                                            <div
                                                                title={(() => {
                                                                    const setup = (templaterSetups || []).find((s) => s?.id === setupId);
                                                                    const entries = Object.entries(setup?.items || {});
                                                                    if (!entries.length) return "No hardware in this profile.";
                                                                    return entries
                                                                        .map(([key, value]) => {
                                                                            const label = (shapeOptions || []).find((opt) => opt.value === key)?.label || key;
                                                                            return `${label} x${value}`;
                                                                        })
                                                                        .join(", ");
                                                                })()}
                                                                style={{
                                                                    fontSize: 10,
                                                                    fontWeight: 700,
                                                                    color: "#e2e8f0",
                                                                    marginBottom: 4,
                                                                    display: "flex",
                                                                    alignItems: "center",
                                                                    gap: 6,
                                                                    padding: "3px 8px",
                                                                    marginLeft: 12,
                                                                    borderRadius: 999,
                                                                    border: "1px solid rgba(148,163,184,0.35)",
                                                                    background: "rgba(30,41,59,0.6)",
                                                                    boxShadow: "inset 3px 0 0 rgba(148,163,184,0.45)",
                                                                }}
                                                            >
                                                                <span style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}>{setupLabel(setupId)}</span>
                                                                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.3)", opacity: 0.8 }}>
                                                                    {bySetup.get(setupId).length}
                                                                </span>
                                                            </div>
                                                            {bySetup.get(setupId).map((r) => {
                                                                const count = templateRoomItemCount(r);
                                                                const editing = templaterEditRoomId === r.id;
                                                                const isPlaced = placedIds.has(r.id);
                                                                const isSelected = selectedIds.has(r.id);
                                                                return (
                                                                    <div
                                                                        key={r.id}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const additive = e.ctrlKey || e.metaKey;
                                                                            if (additive) {
                                                                                setTemplaterSelectedRoomIds((prev) => {
                                                                                    const list = Array.isArray(prev) ? prev : [];
                                                                                    const has = list.includes(r.id);
                                                                                    const next = has ? list.filter((id) => id !== r.id) : [...list, r.id];
                                                                                    if (!next.length) {
                                                                                        setTemplaterSelectedRoomId("");
                                                                                    } else if (!has) {
                                                                                        setTemplaterSelectedRoomId(r.id);
                                                                                    } else if (templaterSelectedRoomId === r.id) {
                                                                                        setTemplaterSelectedRoomId(next[0] || "");
                                                                                    }
                                                                                    return next;
                                                                                });
                                                                            } else {
                                                                                setTemplaterSelectedRoomIds([r.id]);
                                                                                setTemplaterSelectedRoomId(r.id);
                                                                            }
                                                                        }}
                                                                        onDoubleClick={() => {
                                                                            setTemplaterEditRoomId(r.id);
                                                                            setTemplaterEditRoomValue(r.name || "");
                                                                        }}
                                                                        onContextMenu={(e) => openTemplaterApplyMenu(e, r.id)}
                                                                        style={{
                                                                            display: "flex",
                                                                            alignItems: "center",
                                                                            gap: 8,
                                                                            padding: "4px 6px",
                                                                            borderRadius: 6,
                                                                            background: isPlaced
                                                                                ? "rgba(34,197,94,0.18)"
                                                                                : (isSelected ? "rgba(56,189,248,0.18)" : "rgba(15,23,42,0.55)"),
                                                                            border: isPlaced
                                                                                ? "1px solid rgba(34,197,94,0.45)"
                                                                                : (isSelected ? "1px solid rgba(56,189,248,0.35)" : "1px solid transparent"),
                                                                            marginBottom: 4,
                                                                            cursor: "pointer",
                                                                        }}
                                                                    >
                                                                        <div style={{ flex: 1, fontSize: 12 }}>
                                                                            {editing ? (
                                                                                <input
                                                                                    autoFocus
                                                                                    value={templaterEditRoomValue}
                                                                                    onChange={(e) => setTemplaterEditRoomValue(e.target.value)}
                                                                                    onBlur={() => {
                                                                                        setTemplaterRooms((prev) => (prev || []).map((room) => (
                                                                                            room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                                        )));
                                                                                        setTemplaterEditRoomId("");
                                                                                    }}
                                                                                    onKeyDown={(e) => {
                                                                                        if (e.key === "Enter") {
                                                                                            setTemplaterRooms((prev) => (prev || []).map((room) => (
                                                                                                room.id === r.id ? { ...room, name: templaterEditRoomValue.trim() || room.name } : room
                                                                                            )));
                                                                                            setTemplaterEditRoomId("");
                                                                                        }
                                                                                        if (e.key === "Escape") setTemplaterEditRoomId("");
                                                                                    }}
                                                                                    style={{
                                                                                        width: "100%",
                                                                                        background: "rgba(15,23,42,0.6)",
                                                                                        color: "#e2e8f0",
                                                                                        border: "1px solid rgba(148,163,184,0.35)",
                                                                                        borderRadius: 6,
                                                                                        padding: "2px 6px",
                                                                                        fontSize: 12,
                                                                                    }}
                                                                                />
                                                                            ) : (
                                                                                r.name
                                                                            )}
                                                                        </div>
                                                                        {r.roomType && (
                                                                            <span
                                                                                style={{
                                                                                    fontSize: 9,
                                                                                    padding: "2px 6px",
                                                                                    borderRadius: 999,
                                                                                    border: "1px solid rgba(148,163,184,0.35)",
                                                                                    color: "rgba(226,232,240,0.75)",
                                                                                    background: "rgba(15,23,42,0.6)",
                                                                                    textTransform: "uppercase",
                                                                                    letterSpacing: "0.08em",
                                                                                }}
                                                                            >
                                                                                {r.roomType}
                                                                            </span>
                                                                        )}
                                                                        <div style={{ fontSize: 10, opacity: 0.7 }}>{count}</div>
                                                                        <div style={{ fontSize: 10, opacity: 0.6 }}>{r.tag}</div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                const count = templateRoomItemCount(r);
                                                                                if (count > 0) {
                                                                                    setTemplaterDeleteDialog({
                                                                                        id: r.id,
                                                                                        name: r.name || r.id,
                                                                                        count,
                                                                                    });
                                                                                    return;
                                                                                }
                                                                                deleteTemplaterRoom(r.id);
                                                                            }}
                                                                            style={{
                                                                                width: 22,
                                                                                height: 22,
                                                                                borderRadius: 6,
                                                                                border: "1px solid rgba(248,113,113,0.45)",
                                                                                background: "rgba(127,29,29,0.35)",
                                                                                color: "rgba(254,226,226,0.9)",
                                                                                cursor: "pointer",
                                                                            }}
                                                                        >
                                                                            <MinusIcon size={10} />
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ));
                                                })()}
                                            </div>
                                        ));
                                    })()}
                                    {(templaterRooms || []).length > 0 && (() => {
                                        const filterValue = String(templaterGeneratedFilter || "").trim();
                                        if (!filterValue) return null;
                                        const roomsList = Array.isArray(templaterRooms) ? templaterRooms : [];
                                        if (!roomsList.length) return null;
                                        const deckLabel = (id) => {
                                            if (!id) return "No Deck";
                                            const fromLive = (decks || []).find((d) => d?.id === id);
                                            if (fromLive) return fromLive.name || fromLive.label || fromLive.id;
                                            const fromTpl = (templaterDecks || []).find((d) => d?.id === id);
                                            return fromTpl ? `${fromTpl.name || fromTpl.id} (templated)` : id;
                                        };
                                        const setupLabel = (id) => {
                                            if (!id) return "No setup";
                                            const setup = (templaterSetups || []).find((s) => s?.id === id);
                                            return setup ? setup.name || setup.id : "Unknown setup";
                                        };
                                        const hasMatch = roomsList.some((room) => {
                                            const haystack = [
                                                room?.name,
                                                room?.id,
                                                room?.tag,
                                                room?.roomType,
                                                deckLabel(room?.deckId),
                                                setupLabel(room?.setupId),
                                            ]
                                                .filter(Boolean)
                                                .join(" ")
                                                .toLowerCase();
                                            return haystack.includes(filterValue.toLowerCase());
                                        });
                                        return hasMatch ? null : (
                                            <div style={{ fontSize: 11, opacity: 0.6 }}>No matching generated rooms.</div>
                                        );
                                    })()}
                                    {(!templaterRooms || !templaterRooms.length) && (
                                        <div style={{ fontSize: 11, opacity: 0.6 }}>No templated rooms yet.</div>
                                    )}
                                </div>
                            </div>
                            <div style={{
                                border: "1px solid rgba(148,163,184,0.2)",
                                borderRadius: 12,
                                padding: 10,
                                overflow: "hidden",
                                minHeight: 0,
                                display: "grid",
                                gridTemplateRows: "auto auto 1fr",
                                gap: 8,
                            }}>
                                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                                    {templaterSelectedRoomId === "__all__" ? "Bulk edit (all rooms)" : "Room contents"}
                                </div>
                                {templaterSelectedRoomId ? (
                                    <div style={{ display: "grid", gap: 6 }}>
                                        <div style={{ fontSize: 10, opacity: 0.7 }}>Set-up (optional)</div>
                                        <Select
                                            value={templaterSelectedRoomId === "__all__"
                                                ? ""
                                                : (templaterRooms.find((r) => r.id === templaterSelectedRoomId)?.setupId || "")}
                                            onChange={(e) => {
                                                const setupId = e.target.value;
                                                const setup = (templaterSetups || []).find((s) => s.id === setupId);
                                                if (!setup) return;
                                                applySetupToRooms(setup, templaterSelectedRoomId === "__all__"
                                                    ? (templaterRooms || []).map((r) => r.id)
                                                    : [templaterSelectedRoomId], false);
                                            }}
                                        >
                                            <option value="">None</option>
                                            {(templaterSetups || []).map((setup) => (
                                                <option key={setup.id} value={setup.id}>
                                                    {setup.name || setup.id}
                                                </option>
                                            ))}
                                        </Select>
                                        <div style={{ fontSize: 10, opacity: 0.7 }}>Room type</div>
                                        <Select
                                            value={templaterSelectedRoomId === "__all__"
                                                ? templaterCatalogRoomType
                                                : (templaterRooms.find((r) => r.id === templaterSelectedRoomId)?.roomType || "")}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setTemplaterCatalogRoomType(val);
                                                updateTemplateRoomType(templaterSelectedRoomId, val);
                                            }}
                                        >
                                            <option value="">Unspecified</option>
                                            {roomTypeOptions.map((opt) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </Select>
                                        <div style={{ fontSize: 10, opacity: 0.7 }}>Deck assignment</div>
                                        <Select
                                            value={templaterSelectedRoomId === "__all__"
                                                ? templaterCatalogDeckId
                                                : (templaterRooms.find((r) => r.id === templaterSelectedRoomId)?.deckId || "")}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setTemplaterCatalogDeckId(val);
                                                updateTemplateRoomDeck(templaterSelectedRoomId, val);
                                            }}
                                        >
                                            <option value="">No deck</option>
                                            {templaterDeckOptions.map((opt) => (
                                                <option key={opt.id} value={opt.id}>{opt.label}</option>
                                            ))}
                                        </Select>
                                        {templaterSelectedRoomId === "__all__" && (
                                            <div style={{ fontSize: 10, opacity: 0.6 }}>Bulk mode applies to all rooms.</div>
                                        )}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: 11, opacity: 0.6 }}>Select a room to assign a deck.</div>
                                )}
                                <div style={{ overflow: "auto", minHeight: 0, borderRadius: 10, border: "1px solid rgba(148,163,184,0.2)", padding: 6 }} className="templater-scroll">
                                    {templaterSelectedRoomId ? (
                                        (shapeOptions || [])
                                            .slice()
                                            .sort((a, b) => String(a.label || a.value).localeCompare(String(b.label || b.value), undefined, { sensitivity: "base" }))
                                            .map((opt) => {
                                            const key = opt.value;
                                            const room = templaterRooms.find((r) => r.id === templaterSelectedRoomId);
                                            const count = templaterSelectedRoomId === "__all__"
                                                ? templaterRooms.reduce((acc, r) => acc + (Number(r.items?.[key]) || 0), 0)
                                                : Number(room?.items?.[key]) || 0;
                                            const hovered = templaterHoverShape === key;
                                            return (
                                                <div
                                                    key={key}
                                                    onMouseEnter={() => setTemplaterHoverShape(key)}
                                                    onMouseLeave={() => setTemplaterHoverShape("")}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                        marginBottom: 6,
                                                        padding: "3px 6px",
                                                        borderRadius: 8,
                                                        background: hovered ? "rgba(56,189,248,0.14)" : "transparent",
                                                        border: hovered ? "1px solid rgba(56,189,248,0.35)" : "1px solid transparent",
                                                        transition: "all 0.12s ease",
                                                    }}
                                                >
                                                    <div style={{ flex: 1, fontSize: 10 }}>{opt.label}</div>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateTemplateRoomItems(templaterSelectedRoomId, key, -1)}
                                                        style={{
                                                            width: 20,
                                                            height: 20,
                                                            borderRadius: 6,
                                                            border: "1px solid rgba(148,163,184,0.35)",
                                                            background: "rgba(15,23,42,0.6)",
                                                            color: "rgba(226,232,240,0.85)",
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        <MinusIcon size={10} />
                                                    </button>
                                                    <div style={{ width: 22, textAlign: "center", fontSize: 10 }}>{count}</div>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateTemplateRoomItems(templaterSelectedRoomId, key, 1)}
                                                        style={{
                                                            width: 20,
                                                            height: 20,
                                                            borderRadius: 6,
                                                            border: "1px solid rgba(56,189,248,0.45)",
                                                            background: "rgba(56,189,248,0.16)",
                                                            color: "#e2f2ff",
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        <PlusIcon size={10} />
                                                    </button>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div style={{ fontSize: 11, opacity: 0.6 }}>
                                            Click a room to edit its contents.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <Btn variant="ghost" onClick={() => setTemplaterWizardOpen(false)}>Close</Btn>
                            <Btn
                                glow
                                className="templater-add-btn generate-btn"
                                onClick={() => {
                                    const payload = { rooms: templaterRooms || [] };
                                    try {
                                        localStorage.setItem(templaterFinalKey, JSON.stringify(payload));
                                    } catch {}
                                    setTemplaterFinalRooms(payload.rooms || []);
                                    setTemplaterWizardOpen(false);
                                }}
                            >
                                Finalize
                                <span className="sparkle s1" />
                                <span className="sparkle s2" />
                                <span className="sparkle s3" />
                            </Btn>
                        </div>
                    </div>
                    {templaterApplySetup && (
                        <div
                            onPointerDown={(e) => {
                                e.stopPropagation();
                            }}
                            style={{
                                position: "fixed",
                                inset: 0,
                                zIndex: 10008,
                            }}
                        >
                            <div
                                onPointerDown={(e) => e.stopPropagation()}
                                style={{
                                    position: "absolute",
                                    left: Math.min(
                                        templaterApplySetup.x || 0,
                                        (typeof window !== "undefined" ? window.innerWidth : 1400) - 720
                                    ),
                                    top: Math.min(
                                        templaterApplySetup.y || 0,
                                        (typeof window !== "undefined" ? window.innerHeight : 900) - 520
                                    ),
                                    width: 720,
                                    maxWidth: "calc(100vw - 24px)",
                                    borderRadius: 12,
                                    border: "1px solid rgba(148,163,184,0.3)",
                                    background: "rgba(15,23,42,0.95)",
                                    boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
                                    padding: 16,
                                    color: "rgba(226,232,240,0.95)",
                                    display: "grid",
                                    gap: 10,
                                }}
                            >
                                <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.95 }}>
                                    Apply Set-up to {templaterApplySetup.roomIds?.length || 1} room(s)
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 10, minHeight: 0 }}>
                                    <div style={{ display: "grid", gap: 8 }}>
                                        <Input
                                            value={templaterApplyFilter}
                                            onChange={(e) => setTemplaterApplyFilter(e.target.value)}
                                            placeholder="Filter profiles..."
                                            type="search"
                                            style={{ fontSize: 13 }}
                                        />
                                        <div style={{ border: "1px solid rgba(148,163,184,0.2)", borderRadius: 10, padding: 8, maxHeight: 420, overflow: "auto" }}>
                                            {(templaterSetups || [])
                                                .filter((setup) => {
                                                    const q = String(templaterApplyFilter || "").trim().toLowerCase();
                                                    if (!q) return true;
                                                    return String(setup?.name || setup?.id || "").toLowerCase().includes(q);
                                                })
                                                .map((setup) => (
                                            <button
                                                key={setup.id}
                                                type="button"
                                                onClick={() => setTemplaterApplySetup((prev) => ({ ...(prev || {}), setupId: setup.id }))}
                                                style={{
                                                    width: "100%",
                                                    textAlign: "left",
                                                    padding: "8px 10px",
                                                    borderRadius: 10,
                                                    border: templaterApplySetup.setupId === setup.id ? "1px solid rgba(56,189,248,0.6)" : "1px solid transparent",
                                                    background: templaterApplySetup.setupId === setup.id ? "rgba(56,189,248,0.2)" : "rgba(15,23,42,0.45)",
                                                    color: "rgba(226,232,240,0.9)",
                                                    cursor: "pointer",
                                                    marginBottom: 4,
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                }}
                                            >
                                                {setup.name || setup.id}
                                            </button>
                                            ))}
                                            {(!templaterSetups || !templaterSetups.length) && (
                                                <div style={{ fontSize: 12, opacity: 0.6 }}>No setups yet.</div>
                                            )}
                                            {(templaterSetups || []).length > 0 && String(templaterApplyFilter || "").trim() && (
                                                (templaterSetups || []).filter((setup) => {
                                                    const q = String(templaterApplyFilter || "").trim().toLowerCase();
                                                    if (!q) return true;
                                                    return String(setup?.name || setup?.id || "").toLowerCase().includes(q);
                                                }).length === 0 && (
                                                    <div style={{ fontSize: 12, opacity: 0.6 }}>No matching profiles.</div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ border: "1px solid rgba(148,163,184,0.2)", borderRadius: 10, padding: 8, maxHeight: 420, overflow: "auto" }}>
                                        {(() => {
                                            const setup = (templaterSetups || []).find((s) => s.id === templaterApplySetup.setupId);
                                            if (!setup) return <div style={{ fontSize: 12, opacity: 0.6 }}>Select a profile.</div>;
                                            const entries = Object.entries(setup.items || {});
                                            if (!entries.length) return <div style={{ fontSize: 12, opacity: 0.6 }}>No components.</div>;
                                            return entries.map(([key, value]) => {
                                                const label = (shapeOptions || []).find((opt) => opt.value === key)?.label || key;
                                                return (
                                                    <div key={key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                                                        <span>{label}</span>
                                                        <span style={{ opacity: 0.8, fontWeight: 700 }}>{value}</span>
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                                    <input
                                        type="checkbox"
                                        checked={templaterApplyClear}
                                        onChange={(e) => setTemplaterApplyClear(e.target.checked)}
                                    />
                                    Clear room contents before apply
                                </label>
                                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                                    <Btn variant="ghost" onClick={() => setTemplaterApplySetup(null)}>Cancel</Btn>
                                    <Btn
                                        glow
                                        className="templater-add-btn"
                                        onClick={() => {
                                            const setup = (templaterSetups || []).find((s) => s.id === templaterApplySetup.setupId);
                                            if (!setup) return;
                                            applySetupToRooms(setup, templaterApplySetup.roomIds || [], templaterApplyClear);
                                            setTemplaterApplySetup(null);
                                        }}
                                    >
                                        Apply
                                    </Btn>
                                </div>
                            </div>
                        </div>
                    )}
                </div>,
                document.body
            )}

            {templaterSetupDialog && typeof document !== "undefined" && createPortal(
                <div
                    onPointerDown={() => setTemplaterSetupDialog(false)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10010,
                        background: "rgba(2,6,23,0.6)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 980,
                            maxWidth: "92vw",
                            height: "72vh",
                            borderRadius: 16,
                            padding: 16,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gridTemplateRows: "auto 1fr",
                            gap: 12,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                                Set-ups
                            </div>
                            <button
                                type="button"
                                onClick={() => setTemplaterSetupDialog(false)}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 8,
                                    border: "1px solid rgba(148,163,184,0.35)",
                                    background: "rgba(15,23,42,0.6)",
                                    color: "rgba(226,232,240,0.9)",
                                    cursor: "pointer",
                                }}
                            >
                                x
                            </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 12, minHeight: 0 }}>
                            <div style={{
                                border: "1px solid rgba(148,163,184,0.2)",
                                borderRadius: 12,
                                padding: 10,
                                overflow: "auto",
                                minHeight: 0,
                            }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>Saved setups</div>
                                    <button
                                        type="button"
                                        onClick={startNewSetup}
                                        style={{
                                            fontSize: 10,
                                            padding: "2px 8px",
                                            borderRadius: 999,
                                            border: "1px solid rgba(56,189,248,0.45)",
                                            background: "rgba(56,189,248,0.16)",
                                            color: "#e2f2ff",
                                            cursor: "pointer",
                                        }}
                                    >
                                        New
                                    </button>
                                </div>
                                {(templaterSetups || []).map((setup) => {
                                    const count = Object.values(setup.items || {}).reduce((acc, v) => acc + (Number(v) || 0), 0);
                                    const active = templaterSetupEditId === setup.id;
                                    return (
                                        <button
                                            key={setup.id}
                                            type="button"
                                            onClick={() => loadSetupForEdit(setup)}
                                            style={{
                                                width: "100%",
                                                textAlign: "left",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                                padding: "6px 8px",
                                                borderRadius: 8,
                                                border: active ? "1px solid rgba(56,189,248,0.6)" : "1px solid rgba(255,255,255,0.08)",
                                                background: active ? "rgba(56,189,248,0.2)" : "rgba(15,23,42,0.55)",
                                                color: "rgba(226,232,240,0.9)",
                                                cursor: "pointer",
                                                marginBottom: 6,
                                            }}
                                        >
                                            <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{setup.name || setup.id}</div>
                                            <span style={{ fontSize: 10, opacity: 0.7 }}>{count}</span>
                                        </button>
                                    );
                                })}
                                {(!templaterSetups || !templaterSetups.length) && (
                                    <div style={{ fontSize: 11, opacity: 0.6 }}>No setups saved yet.</div>
                                )}
                            </div>
                            <div style={{
                                border: "1px solid rgba(148,163,184,0.2)",
                                borderRadius: 12,
                                padding: 12,
                                display: "grid",
                                gridTemplateRows: "auto auto 1fr",
                                gap: 10,
                                minHeight: 0,
                            }}>
                                <label style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>Set-up name</div>
                                    <Input
                                        value={templaterSetupName}
                                        onChange={(e) => setTemplaterSetupName(e.target.value)}
                                        placeholder="Cinema Lounge A"
                                    />
                                </label>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <Btn glow className="templater-add-btn" onClick={saveTemplaterSetup}>
                                        Save setup
                                    </Btn>
                                    <Btn variant="ghost" onClick={startNewSetup}>Clear</Btn>
                                </div>
                                <div style={{ overflow: "auto", minHeight: 0, borderRadius: 10, border: "1px solid rgba(148,163,184,0.2)", padding: 8 }}>
                                    {(shapeOptions || [])
                                        .slice()
                                        .sort((a, b) => String(a.label || a.value).localeCompare(String(b.label || b.value), undefined, { sensitivity: "base" }))
                                        .map((opt) => {
                                            const key = opt.value;
                                            const count = Number(templaterSetupItems?.[key]) || 0;
                                            return (
                                                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                                    <div style={{ flex: 1, fontSize: 11 }}>{opt.label}</div>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateSetupItems(key, -1)}
                                                        style={{
                                                            width: 22,
                                                            height: 22,
                                                            borderRadius: 6,
                                                            border: "1px solid rgba(148,163,184,0.35)",
                                                            background: "rgba(15,23,42,0.6)",
                                                            color: "rgba(226,232,240,0.85)",
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        <MinusIcon size={10} />
                                                    </button>
                                                    <div style={{ width: 26, textAlign: "center", fontSize: 11 }}>{count}</div>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateSetupItems(key, 1)}
                                                        style={{
                                                            width: 22,
                                                            height: 22,
                                                            borderRadius: 6,
                                                            border: "1px solid rgba(56,189,248,0.45)",
                                                            background: "rgba(56,189,248,0.16)",
                                                            color: "#e2f2ff",
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        <PlusIcon size={10} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {reshaperDialogOpen && typeof document !== "undefined" && createPortal(
                <div
                    onPointerDown={() => setReshaperDialogOpen(false)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10006,
                        background: "rgba(2,6,23,0.55)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 520,
                            maxWidth: "92vw",
                            borderRadius: 14,
                            padding: 14,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Reshaper
                        </div>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.8 }}>Target Shape</div>
                            <Select value={reshaperTargetShape} onChange={(e) => setReshaperTargetShape(e.target.value)}>
                                {shapeOptionsInUse.length ? (
                                    shapeOptionsInUse.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))
                                ) : (
                                    <option value="">No shapes in scene</option>
                                )}
                            </Select>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                            <input
                                type="checkbox"
                                checked={reshaperOnlyDims}
                                onChange={(e) => setReshaperOnlyDims(e.target.checked)}
                            />
                            Only of dimensions
                        </label>
                        {reshaperOnlyDims && (
                            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
                                {["Width", "Height", "Depth"].map((label, idx) => (
                                    <label key={label} style={{ display: "grid", gap: 6 }}>
                                        <div style={{ fontSize: 11, opacity: 0.8 }}>{label}</div>
                                        <Input
                                            type="number"
                                            step="0.05"
                                            min="0.01"
                                            value={reshaperDims[idx]}
                                            onChange={(e) => {
                                                const next = reshaperDims.slice();
                                                next[idx] = Number(e.target.value) || 0;
                                                setReshaperDims(next);
                                            }}
                                        />
                                    </label>
                                ))}
                            </div>
                        )}
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.8 }}>Target Shape becomes</div>
                            <Select value={reshaperToShape} onChange={(e) => setReshaperToShape(e.target.value)}>
                                {shapeOptions.length ? (
                                    shapeOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))
                                ) : (
                                    <option value="">No shapes</option>
                                )}
                            </Select>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                            <input
                                type="checkbox"
                                checked={reshaperCustom}
                                onChange={(e) => setReshaperCustom(e.target.checked)}
                            />
                            Custom transforms
                        </label>
                        {reshaperCustom && (
                            <div style={{ display: "grid", gap: 10 }}>
                                <label style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Scale</div>
                                    <Input
                                        type="number"
                                        step="0.05"
                                        min="0.01"
                                        value={reshaperScale}
                                        onChange={(e) => setReshaperScale(Number(e.target.value) || 1)}
                                    />
                                </label>
                                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
                                    {["Width", "Height", "Depth"].map((label, idx) => (
                                        <label key={label} style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontSize: 11, opacity: 0.8 }}>{label}</div>
                                            <Input
                                                type="number"
                                                step="0.05"
                                                min="0.01"
                                                value={reshaperDims[idx]}
                                                onChange={(e) => {
                                                    const next = reshaperDims.slice();
                                                    next[idx] = Number(e.target.value) || 0;
                                                    setReshaperDims(next);
                                                }}
                                            />
                                        </label>
                                    ))}
                                </div>
                                <label style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Color</div>
                                    <Input
                                        type="color"
                                        value={reshaperColor || "#38bdf8"}
                                        onChange={(e) => setReshaperColor(e.target.value)}
                                    />
                                </label>
                            </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <Btn variant="ghost" onClick={() => setReshaperDialogOpen(false)}>Cancel</Btn>
                            <Btn variant="primary" glow onClick={applyReshaperDialog}>Apply</Btn>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {reshaperConfirm && typeof document !== "undefined" && createPortal(
                <div
                    onPointerDown={() => setReshaperConfirm(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10007,
                        background: "rgba(2,6,23,0.6)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 520,
                            maxWidth: "92vw",
                            borderRadius: 14,
                            padding: 14,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Confirm Reshaper
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>
                            You are about to transform <b>{reshaperConfirm.count}</b> {reshaperConfirm.fromLabel} node(s) to <b>{reshaperConfirm.toLabel}</b>.
                        </div>
                        {reshaperConfirm.custom && (
                            <div style={{ fontSize: 12, opacity: 0.85 }}>
                                Custom: scale {reshaperConfirm.dims?.scale || 1}, w {reshaperConfirm.dims?.w}, h {reshaperConfirm.dims?.h}, d {reshaperConfirm.dims?.d}
                                {reshaperConfirm.dims?.color ? `, color ${reshaperConfirm.dims.color}` : ""}
                            </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <Btn variant="ghost" onClick={() => setReshaperConfirm(null)}>Cancel</Btn>
                            <Btn variant="primary" glow onClick={confirmReshaper}>Confirm</Btn>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {shapeHoverPreview && typeof document !== "undefined" && createPortal(
                <div
                    style={{
                        position: "fixed",
                        left: Math.min(
                            Math.max(8, shapeHoverPreview.x),
                            (typeof window !== "undefined" ? window.innerWidth : 1200) - 160
                        ),
                        top: Math.min(
                            Math.max(8, shapeHoverPreview.y - 40),
                            (typeof window !== "undefined" ? window.innerHeight : 800) - 120
                        ),
                        transform: "translateY(-50%)",
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                        border: "1px solid rgba(255,255,255,0.14)",
                        boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                        color: "rgba(226,232,240,0.95)",
                        display: "grid",
                        gap: 6,
                        placeItems: "center",
                        minWidth: 120,
                        pointerEvents: "none",
                        zIndex: 10008,
                    }}
                >
                    <div
                        style={{
                            width: 64,
                            height: 64,
                            borderRadius: 16,
                            background: "radial-gradient(circle at 35% 30%, rgba(56,189,248,0.35), rgba(8,47,73,0.65))",
                            border: "1px solid rgba(56,189,248,0.35)",
                            overflow: "hidden",
                        }}
                    >
                        <Canvas
                            camera={{ position: [0.2, 0.25, 1.5], fov: 50 }}
                            style={{ width: "100%", height: "100%" }}
                        >
                            <ambientLight intensity={0.7} />
                            <directionalLight position={[2, 3, 2]} intensity={1.1} />
                            <hemisphereLight intensity={0.4} color="#93c5fd" groundColor="#0f172a" />
                            <ShapePreviewMesh shapeKey={shapeHoverPreview.key} advancedDefaults={advancedShapeDefaults} />
                        </Canvas>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        {shapeHoverPreview.label}
                    </div>
                </div>,
                document.body
            )}

            {roomScaleDialog && (
                <div
                    onPointerDown={() => setRoomScaleDialog(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10004,
                        background: "rgba(2,6,23,0.55)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 360,
                            maxWidth: "90vw",
                            borderRadius: 14,
                            padding: 14,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Scale Room
                        </div>
                        <div style={{ display: "grid", gap: 8 }}>
                            {["X", "Y", "Z"].map((axis, idx) => (
                                <label key={axis} style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Scale {axis}</div>
                                    <Input
                                        value={String(roomScaleXYZ[idx] ?? 1)}
                                        onChange={(e) => {
                                            const next = [...roomScaleXYZ];
                                            next[idx] = e.target.value;
                                            setRoomScaleXYZ(next);
                                        }}
                                        placeholder="1.0"
                                    />
                                </label>
                            ))}
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <Btn variant="ghost" onClick={() => setRoomScaleDialog(null)}>Cancel</Btn>
                            <Btn
                                variant="primary"
                                onClick={() => {
                                    const id = roomScaleDialog?.roomId;
                                    setRoomScaleDialog(null);
                                    if (id) applyRoomScale(id, roomScaleXYZ);
                                }}
                            >
                                Apply
                            </Btn>
                        </div>
                    </div>
                </div>
            )}

            {reshapeDialog && (
                <div
                    onPointerDown={() => setReshapeDialog(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10003,
                        background: "rgba(2,6,23,0.55)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 360,
                            maxWidth: "90vw",
                            borderRadius: 14,
                            padding: 14,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            Re-shape Nodes
                        </div>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.8 }}>Shape</div>
                            <Select value={reshapeShape} onChange={(e) => setReshapeShape(e.target.value)}>
                                {reshaperShapes.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </Select>
                        </label>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.8 }}>Cluster</div>
                            <Select value={reshapeCluster} onChange={(e) => setReshapeCluster(e.target.value)}>
                                <option value="">(leave unchanged)</option>
                                {clusterOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </Select>
                        </label>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <Btn variant="ghost" onClick={() => setReshapeDialog(null)}>Cancel</Btn>
                            <Btn
                                variant="primary"
                                onClick={() => {
                                    applyReshape(reshapeDialog.ids, reshapeShape, reshapeCluster);
                                    setReshapeDialog(null);
                                }}
                            >
                                Apply
                            </Btn>
                        </div>
                    </div>
                </div>
            )}

            {reassignDialog && (
                <div
                    onPointerDown={() => setReassignDialog(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10001,
                        background: "rgba(2,6,23,0.5)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    <div
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            width: 360,
                            maxWidth: "90vw",
                            borderRadius: 14,
                            padding: 14,
                            background: "linear-gradient(160deg, rgba(10,15,26,0.98), rgba(15,23,42,0.98))",
                            border: "1px solid rgba(255,255,255,0.12)",
                            boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                            color: "rgba(226,232,240,0.95)",
                            display: "grid",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            {reassignDialog.type === "room" ? "Reassign Room" : "Reassign Nodes"}
                        </div>

                        {reassignDialog.type === "node" && (
                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 11, opacity: 0.7 }}>Room</div>
                                <Input
                                    value={reassignRoomInput}
                                    onChange={(e) => setReassignRoomInput(e.target.value)}
                                    placeholder="Type to filter rooms..."
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            applyNodeReassign(reassignDialog.ids, reassignRoomInput, reassignDeckInput);
                                            setReassignDialog(null);
                                        } else if (e.key === "Escape") {
                                            e.preventDefault();
                                            setReassignDialog(null);
                                        }
                                    }}
                                />
                                <div style={{ maxHeight: 120, overflow: "auto", display: "grid", gap: 4 }}>
                                    <button
                                        type="button"
                                        onClick={() => setReassignRoomInput("none")}
                                        style={{
                                            border: "1px dashed rgba(255,255,255,0.12)",
                                            background: "rgba(15,23,42,0.4)",
                                            color: "rgba(226,232,240,0.75)",
                                            padding: "6px 8px",
                                            borderRadius: 8,
                                            textAlign: "left",
                                            cursor: "pointer",
                                        }}
                                    >
                                        Unassigned
                                    </button>
                                    {roomOptions
                                        .filter((r) => String(r.label).toLowerCase().includes(String(reassignRoomInput || "").toLowerCase()))
                                        .slice(0, 12)
                                        .map((r) => (
                                            <button
                                                key={r.id}
                                                type="button"
                                                onClick={() => setReassignRoomInput(r.label)}
                                                style={{
                                                    border: "1px solid rgba(255,255,255,0.12)",
                                                    background: "rgba(15,23,42,0.4)",
                                                    color: "rgba(226,232,240,0.85)",
                                                    padding: "6px 8px",
                                                    borderRadius: 8,
                                                    textAlign: "left",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                {r.label}
                                            </button>
                                        ))}
                                </div>
                            </div>
                        )}

                        <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 11, opacity: 0.7 }}>Deck</div>
                            <Input
                                value={reassignDeckInput}
                                onChange={(e) => setReassignDeckInput(e.target.value)}
                                placeholder="Type to filter decks..."
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        if (reassignDialog.type === "node") {
                                            applyNodeReassign(reassignDialog.ids, reassignRoomInput, reassignDeckInput);
                                        } else {
                                            applyRoomReassign(reassignDialog.ids, reassignDeckInput);
                                        }
                                        setReassignDialog(null);
                                    } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        setReassignDialog(null);
                                    }
                                }}
                            />
                            <div style={{ maxHeight: 120, overflow: "auto", display: "grid", gap: 4 }}>
                                <button
                                    type="button"
                                    onClick={() => setReassignDeckInput("none")}
                                    style={{
                                        border: "1px dashed rgba(255,255,255,0.12)",
                                        background: "rgba(15,23,42,0.4)",
                                        color: "rgba(226,232,240,0.75)",
                                        padding: "6px 8px",
                                        borderRadius: 8,
                                        textAlign: "left",
                                        cursor: "pointer",
                                    }}
                                >
                                    No deck
                                </button>
                                {deckOptions
                                    .filter((d) => String(d.label).toLowerCase().includes(String(reassignDeckInput || "").toLowerCase()))
                                    .slice(0, 12)
                                    .map((d) => (
                                        <button
                                            key={d.id}
                                            type="button"
                                            onClick={() => setReassignDeckInput(d.label)}
                                            style={{
                                                border: "1px solid rgba(255,255,255,0.12)",
                                                background: "rgba(15,23,42,0.4)",
                                                color: "rgba(226,232,240,0.85)",
                                                padding: "6px 8px",
                                                borderRadius: 8,
                                                textAlign: "left",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {d.label}
                                        </button>
                                    ))}
                            </div>
                        </div>

                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <Btn variant="ghost" onClick={() => setReassignDialog(null)}>Cancel</Btn>
                            <Btn
                                variant="primary"
                                onClick={() => {
                                    if (reassignDialog.type === "node") {
                                        applyNodeReassign(reassignDialog.ids, reassignRoomInput, reassignDeckInput);
                                    } else {
                                        applyRoomReassign(reassignDialog.ids, reassignDeckInput);
                                    }
                                    setReassignDialog(null);
                                }}
                            >
                                Apply
                            </Btn>
                        </div>
                    </div>
                </div>
            )}

            {/* Resize handle */}
            <div
                onPointerDown={handleResizeDown}
                style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    right: -4,
                    width: 8,
                    cursor: "ew-resize",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    pointerEvents: "auto",
                    touchAction: "none",
                }}
            >
                <div
                    style={{
                        width: 2,
                        height: 48,
                        borderRadius: 999,
                        background: "rgba(148,163,184,0.75)",
                    }}
                />
            </div>
        </div>
    );
}

export { EditorLeftPane };
export default EditorLeftPane;
















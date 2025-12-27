import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { v4 as uuid } from "uuid";

import { Html, Text, StatsGl, PerformanceMonitor, AdaptiveDpr, Preload } from "@react-three/drei";

import SceneInner from "./SceneInner.jsx";

import logoImg from "./data/logo/logo.png";
import { STATIC_MODELS } from "./data/models/registry";
import { LOCAL_PICTURES, resolveLocalPictureSrc, LOCAL_PICTURES_DEBUG } from "./data/pictures/registry";

import ProductManager from "./ui/ProductManager.jsx";
import { Btn, IconBtn, Input, Select, Checkbox, Slider, Panel } from "./ui/Controls.jsx";
import HudButtonsLayer from "./ui/HudButtonsLayer.jsx";
import { EditorLeftPane } from "./ui/EditorLeftPane.jsx";
import EditorRightPane from "./ui/EditorRightPane.jsx";

import {
    listProducts,
    upsertProduct,
    deleteProduct,
    importProductsFile, // optional, used only for old zips with products.db.json
} from "./data/products/store"; // use the SAME path you use in ProductManager.jsx

import { DEFAULT_CLUSTERS, clusterColor } from "./utils/clusters.js";
import { TAU, snapValue } from "./utils/math.js";

import {
    ProductSelectInline,
    RackItemsEditor,
    RingWave,
    StableStartupCamera,
    WarmupOnce,
    ProductHUD,
    RackHUD,
    NodeSignals,
    RackBinding,
    RepresentativePanel,
    ProductBinding,
    OutgoingLinksEditor,
} from "./Interactive3DNodeShowcase.helpers.jsx";
// ------------------------------------------------------------
// Floorplan / reference pictures rendered as flat 2D planes
// inside the 3D canvas (for GA / room tracing workflows).
// - non-interactive (doesn't block raycasts)
// - centered at world origin, laid flat on the ground (XZ)
// - per-picture visibility + scaling
// ------------------------------------------------------------
const FLOORPLAN_BASE_SIZE = 10; // world units (meters-ish) when scale=1
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// --- UI helpers for smooth numeric editing (prevents focus loss on each tick) ---
function useDraftNumber(commitFn, initialValue) {
    const [draft, setDraft] = React.useState(() => String(initialValue ?? ""));
    const [editing, setEditing] = React.useState(false);

    React.useEffect(() => {
        // When not actively editing, keep draft synced to external value.
        if (!editing) setDraft(String(initialValue ?? ""));
    }, [initialValue, editing]);

    const commitDraft = React.useCallback(() => {
        const s = String(draft ?? "").trim();
        if (!s) {
            // empty input: revert
            setDraft(String(initialValue ?? ""));
            return;
        }
        const n = Number.parseFloat(s);
        if (!Number.isFinite(n)) {
            // revert to last known good value
            setDraft(String(initialValue ?? ""));
            return;
        }
        commitFn(n);
    }, [commitFn, draft, initialValue]);

    const onChange = React.useCallback((e) => {
        setDraft(e?.target?.value ?? "");
    }, []);

    const onBlur = React.useCallback(() => {
        setEditing(false);
        commitDraft();
    }, [commitDraft]);

    const onFocus = React.useCallback(() => setEditing(true), []);

    const onKeyDown = React.useCallback(
        (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                // commit happens on blur
                e.currentTarget.blur();
            } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(String(initialValue ?? ""));
                e.currentTarget.blur();
            }
        },
        [initialValue],
    );

    return { draft, onChange, onBlur, onFocus, onKeyDown };
}

// --- UI helpers for smooth text editing (prevents focus loss on each tick) ---
function useDraftText(commitFn, initialValue) {
    const [draft, setDraft] = React.useState(() => String(initialValue ?? ""));
    const [editing, setEditing] = React.useState(false);

    React.useEffect(() => {
        if (!editing) setDraft(String(initialValue ?? ""));
    }, [initialValue, editing]);

    const commitDraft = React.useCallback(() => {
        commitFn(String(draft ?? ""));
    }, [commitFn, draft]);

    const onChange = React.useCallback((e) => {
        setDraft(e?.target?.value ?? "");
    }, []);

    const onBlur = React.useCallback(() => {
        setEditing(false);
        commitDraft();
    }, [commitDraft]);

    const onFocus = React.useCallback(() => setEditing(true), []);

    const onKeyDown = React.useCallback((e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
        } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(String(initialValue ?? ""));
            e.currentTarget.blur();
        }
    }, [initialValue]);

    return { draft, onChange, onBlur, onFocus, onKeyDown };
}

function SmoothTextInput({ value, onCommit, style, title, placeholder, ...rest }) {
    const { draft, onChange, onBlur, onFocus, onKeyDown } = useDraftText(onCommit, value);
    return (
        <input
            type="text"
            {...rest}
            value={draft}
            placeholder={placeholder}
            onChange={onChange}
            onBlur={onBlur}
            onFocus={onFocus}
            onKeyDown={(e) => { e.stopPropagation(); onKeyDown(e); }}
            onPointerDownCapture={(e) => e.stopPropagation()}
            onPointerMoveCapture={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            style={{
                boxSizing: "border-box",
                minWidth: 0,
                height: 32,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                padding: "0 10px",
                color: "#fff",
                fontSize: 12,
                width: "100%",
                ...(style || {}),
            }}
            title={title}
        />
    );
}

function SmoothRange({ min, max, step, value, onChange, title }) {
    return (
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            title={title}
            onInput={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onChange(v);
            }}
            onChange={(e) => {
                // Safari sometimes only fires onChange on release; keep both.
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onChange(v);
            }}
            // Prevent canvas selection / drag handlers from stealing the pointer or focus.
            onPointerDownCapture={(e) => e.stopPropagation()}
            onPointerMoveCapture={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            style={{ width: "100%" }}
        />
    );
}

function SmoothNumberInput({ value, min, max, step, onCommit, style, title, ...rest }) {
    const { draft, onChange, onBlur, onFocus, onKeyDown } = useDraftNumber(onCommit, value);
    return (
        <input
            type="number"
            {...rest}
            value={draft}
            min={min}
            max={max}
            step={step}
            onChange={onChange}
            onBlur={onBlur}
            onFocus={onFocus}
            onKeyDown={(e) => { e.stopPropagation(); onKeyDown(e); }}
            // Prevent canvas selection / drag handlers from stealing the pointer or focus.
            onPointerDownCapture={(e) => e.stopPropagation()}
            onPointerMoveCapture={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            style={{
                boxSizing: "border-box",
                minWidth: 0,
                height: 32,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                padding: "0 10px",
                color: "#fff",
                fontSize: 12,
                width: "100%",
                ...(style || {}),
            }}
            title={title}
        />
    );
}

function useDraftNumberNullable(commitFn, initialValue) {
    const isEmpty = initialValue === '' || initialValue === null || initialValue === undefined;
    const [draft, setDraft] = React.useState(() => (isEmpty ? '' : String(initialValue)));
    const [editing, setEditing] = React.useState(false);

    React.useEffect(() => {
        if (!editing) {
            const emptyNow = initialValue === '' || initialValue === null || initialValue === undefined;
            setDraft(emptyNow ? '' : String(initialValue));
        }
    }, [initialValue, editing]);

    const commitDraft = React.useCallback(() => {
        const s = String(draft ?? '').trim();
        if (s === '') {
            commitFn('');
            return;
        }
        const n = Number.parseFloat(s);
        if (!Number.isFinite(n)) {
            // revert
            const emptyNow = initialValue === '' || initialValue === null || initialValue === undefined;
            setDraft(emptyNow ? '' : String(initialValue));
            return;
        }
        commitFn(n);
    }, [commitFn, draft, initialValue]);

    const onChange = React.useCallback((e) => {
        setDraft(e?.target?.value ?? '');
    }, []);

    const onBlur = React.useCallback(() => {
        setEditing(false);
        commitDraft();
    }, [commitDraft]);

    const onFocus = React.useCallback(() => setEditing(true), []);

    const onKeyDown = React.useCallback((e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            const emptyNow = initialValue === '' || initialValue === null || initialValue === undefined;
            setDraft(emptyNow ? '' : String(initialValue));
            e.currentTarget.blur();
        }
    }, [initialValue]);

    return { draft, onChange, onBlur, onFocus, onKeyDown };
}

function SmoothNumberInputNullable({ value, min, max, step, onCommit, style, title, ...rest }) {
    const { draft, onChange, onBlur, onFocus, onKeyDown } = useDraftNumberNullable(onCommit, value);
    return (
        <input
            type="number"
            {...rest}
            value={draft}
            min={min}
            max={max}
            step={step}
            onChange={onChange}
            onBlur={onBlur}
            onFocus={onFocus}
            onKeyDown={(e) => { e.stopPropagation(); onKeyDown(e); }}
            onPointerDownCapture={(e) => e.stopPropagation()}
            onPointerMoveCapture={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            style={{
                boxSizing: 'border-box',
                minWidth: 0,
                height: 32,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.05)',
                padding: '0 10px',
                color: '#fff',
                fontSize: 12,
                width: '100%',
                ...(style || {}),
            }}
            title={title}
        />
    );
}




// ------------------------------------------------------------
// Picture rendering safety:
// - Local library images are webpack URLs (often /static/media/...)
// - Imported images are data: URLs
// Drei's useTexture will throw if given an empty/invalid URL.
// We therefore validate src and skip rendering invalid pictures (and mark them hidden in state elsewhere).
// ------------------------------------------------------------
const isValidPictureSrc = (src) => {
    if (!src || typeof src !== "string") return false;
    if (/^(blob:|https?:)/i.test(src)) return true;
    if (src.startsWith("/")) return true;
    if (src.startsWith("static/")) return true;
    if (src.startsWith("data:image/")) {
        const idx = src.indexOf(",");
        return idx >= 0 && src.length > idx + 8; // require some payload
    }
    // Anything else (relative) is still okay for webpack in dev
    return true;
}

const getRuntimeBasePathForAssets = (() => {
    let cached = null;
    return () => {
        if (cached !== null) return cached;
        try {
            const scripts = Array.from(document?.scripts || []);
            const src =
                scripts.map((s) => s?.src).find((u) => typeof u === "string" && u.includes("/static/js/")) ||
                scripts.map((s) => s?.src).find((u) => typeof u === "string" && u.includes("/static/")) ||
                "";
            if (!src) {
                cached = "";
                return cached;
            }
            const u = new URL(src, window.location.href);
            const p = u.pathname || "";
            const idx = p.indexOf("/static/");
            cached = idx > 0 ? p.slice(0, idx) : "";
            return cached;
        } catch {
            cached = "";
            return cached;
        }
    };
})();

const isProbablyWindowsPath = (s) =>
    typeof s === "string" && (/^[a-zA-Z]:[\\/]/.test(s) || s.includes("\\"));

const normalizePictureKey = (val) => {
    if (!val || typeof val !== "string") return "";
    let s = String(val).trim();

    // Strip common URL-ish prefixes that are not meaningful as keys.
    s = s.replace(/^file:\/\//i, "");

    // If it's clearly a URL/data/blob, it's not a local-key.
    if (/^(data:|blob:|https?:)/i.test(s)) return "";

    // Windows / POSIX path basename
    const parts = s.split(/[\\/]/).filter(Boolean);
    let base = parts.length ? parts[parts.length - 1] : s;

    // "./foo.png" -> "foo.png"
    base = base.replace(/^\.\//, "");
    return base;
};

const pictureSrcCandidates = (src) => {
    const out = [];
    const add = (u) => {
        if (!u || typeof u !== "string") return;
        if (!out.includes(u)) out.push(u);
    };

    if (!src || typeof src !== "string") return out;
    const raw = String(src);

    // If the src is a Windows path or a bare filename like "LowerDeckPSD.png",
    // browsers cannot load it directly. Try resolving to a bundled local picture.
    const key = normalizePictureKey(raw);
    const looksLikeImageKey = !!(key && /\.(png|jpe?g|webp|gif|svg)$/i.test(key));
    const resolvedLocal = looksLikeImageKey ? resolveLocalPictureSrc(key) : "";

    const rawIsWindows = isProbablyWindowsPath(raw);
    const rawIsBareFilename = looksLikeImageKey && !raw.includes("/") && !raw.includes("\\") && !raw.startsWith("static/") && !raw.startsWith("/");

    // Prefer the resolved local URL first when the raw value is very unlikely to load.
    if ((rawIsWindows || rawIsBareFilename) && resolvedLocal) add(resolvedLocal);

    add(raw);

    if (!(rawIsWindows || rawIsBareFilename) && resolvedLocal) add(resolvedLocal);

    if (/^(data:|blob:|https?:)/i.test(raw)) return out;

    const pubEnv = String(process.env.PUBLIC_URL || "").replace(/\/$/, "");
    const base = pubEnv || (typeof window !== "undefined" ? getRuntimeBasePathForAssets() : "");

    // If this is a plain CRA /static URL but the app is mounted under a base (e.g. /NodeForge), try prefixed.
    if (raw.startsWith("/static/") && base) add(`${base}${raw}`);

    // If we already have a base-prefixed /static URL, also try the root /static variant.
    if (base && raw.startsWith(`${base}/static/`)) add(raw.slice(base.length));

    // Bare "static/..." forms
    if (raw.startsWith("static/")) {
        add(`/${raw}`);
        if (base) add(`${base}/${raw}`);
    }

    // If it's an absolute path but not /static, we can still try base-prefix in case routes mount under base.
    if (raw.startsWith("/") && base && !raw.startsWith(`${base}/`)) add(`${base}${raw}`);

    return out;
};



// ------------------------------------------------------------
// Thumbnail + URL resolving helpers
// - React re-renders can overwrite DOM-mutation fallbacks, so we keep fallback src in component state.
// - When adding a local picture, we resolve to the first working URL candidate so the placed picture works reliably.
// ------------------------------------------------------------
const __pictureUrlResolveCache = new Map();

const probeImageUrl = (url) =>
    new Promise((resolve) => {
        try {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        } catch {
            resolve(false);
        }
    });

async function resolveWorkingPictureSrc(src) {
    if (!src || typeof src !== "string") return "";
    const key = String(src);
    if (__pictureUrlResolveCache.has(key)) return __pictureUrlResolveCache.get(key);

    const cands = pictureSrcCandidates(key);
    for (const u of cands) {
        if (!u) continue;
        // eslint-disable-next-line no-await-in-loop
        const ok = await probeImageUrl(u);
        if (ok) {
            __pictureUrlResolveCache.set(key, u);
            return u;
        }
    }

    __pictureUrlResolveCache.set(key, key);
    return key;
}

const SmartThumb = React.memo(function SmartThumb({ src, alt, style }) {
    const baseSrc = typeof src === "string" ? src : "";
    const cands = useMemo(() => pictureSrcCandidates(baseSrc), [baseSrc]);

    const [cur, setCur] = useState(() => cands[0] || baseSrc);
    const [failed, setFailed] = useState(false);
    const idxRef = useRef(0);

    useEffect(() => {
        idxRef.current = 0;
        setFailed(false);
        setCur(cands[0] || baseSrc);
    }, [baseSrc, cands]);

    const onError = useCallback(() => {
        const idx = idxRef.current;
        if (idx < cands.length - 1) {
            idxRef.current = idx + 1;
            setCur(cands[idx + 1]);
        } else {
            setFailed(true);
        }
    }, [cands]);

    return (
        <img
            src={cur}
            alt={alt || ""}
            onError={onError}
            style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                opacity: failed ? 0.25 : 1,
                ...(style || {}),
            }}
        />
    );
});


const FloorplanPicturePlaneInner = React.forwardRef(function FloorplanPicturePlaneInner(
    { id, src, scale = 1, opacity = 1, rotX = 0, rotY = 0, rotZ = 0, x = 0, y = 0.01, z = 0, order = 0, onAspect },
    ref,
) {
    const candidates = useMemo(() => pictureSrcCandidates(src), [src]);
    const [tex, setTex] = useState(null);

    useEffect(() => {
        let cancelled = false;
        let currentTex = null;

        // dispose previous texture held in state
        setTex((prev) => {
            try { prev?.dispose?.(); } catch {}
            return null;
        });

        const loader = new THREE.TextureLoader();
        let idx = 0;

        const tryLoad = () => {
            if (cancelled) return;
            const url = candidates[idx++];
            if (!url) return;

            loader.load(
                url,
                (t) => {
                    if (cancelled) {
                        try { t?.dispose?.(); } catch {}
                        return;
                    }
                    currentTex = t;
                    try {
                        t.colorSpace = THREE.SRGBColorSpace;
                    } catch {}
                    t.wrapS = THREE.ClampToEdgeWrapping;
                    t.wrapT = THREE.ClampToEdgeWrapping;
                    t.anisotropy = 8;
                    t.needsUpdate = true;
                    setTex(t);
                },
                undefined,
                () => {
                    // try next candidate
                    tryLoad();
                },
            );
        };

        tryLoad();

        return () => {
            cancelled = true;
            try { currentTex?.dispose?.(); } catch {}
        };
    }, [candidates]);

    const aspect = useMemo(() => {
        const img = tex?.image;
        if (!img) return 1;
        const w = img.width || img.naturalWidth || 1;
        const h = img.height || img.naturalHeight || 1;
        if (!w || !h) return 1;
        return h / w;
    }, [tex]);

    useEffect(() => {
        if (!onAspect || !id) return;
        if (!Number.isFinite(aspect) || aspect <= 0) return;
        onAspect(id, aspect);
    }, [onAspect, id, aspect]);

    if (!tex) return null;

    const s = clamp(Number(scale) || 1, 0.01, 500);
    const w = FLOORPLAN_BASE_SIZE * s;
    const h = w * aspect;

    const rx = THREE.MathUtils.degToRad(Number(rotX) || 0);
    const ry = THREE.MathUtils.degToRad(Number(rotY) || 0);
    const rz = THREE.MathUtils.degToRad(Number(rotZ) || 0);
    const o = (() => {
        const op = Number(opacity);
        return Number.isFinite(op) ? clamp(op, 0, 1) : 1;
    })();

    return (
        <mesh
            ref={ref}
            rotation={[-Math.PI / 2 + rx, ry, rz]}
            position={[Number(x) || 0, Number(y) || 0, Number(z) || 0]}
            raycast={() => null}
        >
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial
                map={tex}
                side={THREE.DoubleSide}
                transparent
                opacity={o}
                depthWrite={o >= 0.999}
                toneMapped={false}
                polygonOffset
                polygonOffsetFactor={-1}
                polygonOffsetUnits={-(Number(order) || 0) - 1}
            />
        </mesh>
    );
});

const FloorplanPicturePlane = React.forwardRef(function FloorplanPicturePlane(props, ref) {
    const src = props?.src;
    if (!isValidPictureSrc(src)) return null;
    return <FloorplanPicturePlaneInner {...props} ref={ref} />;
});

function FloorplanPictures({ pictures, pictureRefs, onAspect }) {
    const visible = useMemo(
        () =>
            (Array.isArray(pictures) ? pictures : [])
                .filter((p) => p && p.src && isValidPictureSrc(p.src) && p.visible)
                .map((p, i) => ({ ...p, _i: i })),
        [pictures],
    );

    if (!visible.length) return null;

    return (
        <group>
            {visible.map((p, i) => {
                if (p?.id && pictureRefs?.current) {
                    pictureRefs.current[p.id] ||= React.createRef();
                }
                return (
                    <FloorplanPicturePlane
                        key={p.id || `${p.name || "pic"}-${i}`}
                        ref={p?.id && pictureRefs?.current ? pictureRefs.current[p.id] : undefined}
                        id={p.id}
                        src={p.src}
                        scale={p.scale ?? 1}
                        rotX={p.rotX ?? 0}
                        rotY={p.rotY ?? 0}
                        rotZ={p.rotZ ?? 0}
                        x={p.x ?? 0}
                        y={p.y ?? 0.01}
                        z={p.z ?? 0}
                        order={i}
                        opacity={p.opacity ?? 1}
                        onAspect={onAspect}
                    />
                );
            })}
        </group>
    );
}

/* Top bar */
/* ---------------- TopBar (2 rows, evenly spaced, accessible) ---------------- */
/* ---------------- TopBar (header + 2 rows + HUD layout) ---------------- */
const TopBar = React.memo(function TopBar({ ctx, shadowsOn, setShadowsOn, uiStart, uiStop }) {
    const H = 26; // compact height
    const uid = () => uuid();
    const {
        // Header / counts / logo
        projectName,
        setProjectName,
        rooms,
        nodes,
        links,
        logoHot,
        setLogoHot,
        logoFlash,
        goToSelectedViewFromLogo,

        // Project / file
        prodMode,
        setProdMode,
        fileRef,
        importPackage,
        onModelFiles,
        exportZip,
        openMergeDialog,
        modelBlob,

        // Undo / redo
        undo,
        redo,
        canUndo,
        canRedo,

        // Views
        cameraSnapshotRef,
        cameraPresets,
        setCameraPresets,
        cameraPresetId,
        setCameraPresetId,

        // Model / products
        currentModelId,
        setCurrentModelId,
        modelVisible,
        setModelVisible,
        setProductsOpen,
        modelScale,
        setModelScale,
        productScale,
        setProductScale,
        productUnits,
        setProductUnits,

        // Quick scene config
        wireOpacity,
        setWireOpacity,
        wireDetail,
        setWireDetail,
        roomOpacity,
        setRoomOpacity,
        bg,
        setBg,

        // Scene toggles
        wireframe,
        setWireframe,
        showLights,
        setShowLights,
        showLightBounds,
        setShowLightBounds,
        showGround,
        setShowGround,
        animate,
        setAnimate,
        labelsOn,
        setLabelsOn,

        // Reveal FX
        wireStroke,
        setWireStroke,
        revealOpen,
        setRevealOpen,
        roomOperatorMode,
        toggleRoomOperatorMode,

        // Transform / selection
        moveMode,
        setMoveMode,
        selectionMode,
        setSelectionMode,
        transformMode,
        setTransformMode,
        selected,
        setSelected,
        multiSel,
        setMultiSel,
        setSelectedBreakpoint,
        setLinkFromId,
        setMode,

        // Snapping
        snapRoomsEnabled,
        setSnapRoomsEnabled,
        snapRoomsDistance,
        setSnapRoomsDistance,

        // Globals
        showDimsGlobal,
        setShowDimsGlobal,
        photoDefault,
        setPhotoDefault,
        alwaysShow3DInfo,
        setAlwaysShow3DInfo,

        // Pictures
        picturesOpen,
        setPicturesOpen,
        importedPictures,
        setImportedPictures,
        picturesTab,
        setPicturesTab,
        picturesSearch,
        setPicturesSearch,
        localPicturesSearch,
        setLocalPicturesSearch,
        localPictures,
        addLocalPicture,
        picturesInputRef,
        importPicturesFromFiles,
        setPictureVisible,
        setPictureSolid,
        setPictureScale,
        setPictureOpacity,
        setPicturePosition,
        setPictureRotation,
        deletePicture,
        pictureValuesClipboardRef,
        setPictureClipboardTick,
    } = ctx || {};

    // Picture overlay manager popover
    const picturesMenuRef = useRef(null);
    const picturesBtnRef = useRef(null);

    // Keep menu open while interacting; close only when clicking outside (or Esc).
    useEffect(() => {
        if (!picturesOpen) return;
        if (typeof document === "undefined") return;

        const onPointerDown = (e) => {
            const menuEl = picturesMenuRef.current;
            const btnEl = picturesBtnRef.current;

            // Robust "inside" detection (works with range-input thumbs / shadow DOM)
            const path = typeof e.composedPath === "function" ? e.composedPath() : [];
            const target = e.target;

            const insideMenu =
                !!menuEl && (menuEl.contains(target) || path.includes(menuEl));
            const insideBtn =
                !!btnEl && (btnEl.contains(target) || path.includes(btnEl));

            if (insideMenu || insideBtn) return;

            setPicturesOpen(false);
        };

        const onKeyDown = (e) => {
            if (e.key === "Escape") setPicturesOpen(false);
        };

        // Capture keeps it reliable even if the canvas or other layers stop bubbling.
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, [picturesOpen]);

    // Small local HUD layout UI state that drives HudButtonsLayer via window events
    const [hudEdit, setHudEdit] = useState(false);
    const [hudSnap, setHudSnap] = useState(8);
    const [hudMagnet, setHudMagnet] = useState(8);
    const sendHudConfig = useCallback((patch) => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
            new CustomEvent("EPIC3D_HUD_CONFIG", { detail: patch })
        );
    }, []);
    const sendCameraView = useCallback((view) => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
            new CustomEvent("EPIC3D_CAMERA_VIEW", { detail: { view } })
        );
    }, []);

    useEffect(() => {
        // Keep HudButtonsLayer cfg in sync with the top-bar HUD controls
        sendHudConfig({
            edit: hudEdit,
            snap: hudSnap,
            magnet: hudMagnet,
        });
    }, [hudEdit, hudSnap, hudMagnet, sendHudConfig]);



    useEffect(() => {
        // Keep HudButtonsLayer cfg in sync with the top-bar HUD controls
        sendHudConfig({
            edit: hudEdit,
            snap: hudSnap,
            magnet: hudMagnet,
        });
    }, [hudEdit, hudSnap, hudMagnet, sendHudConfig]);

    const labelStyle = {
        fontSize: 10,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: "rgba(226,238,255,0.8)",
        whiteSpace: "nowrap",
    };

    const rowStyle = {
        display: "grid",
        gridTemplateColumns: "auto auto auto 1fr",            gap: 10,
        alignItems: "center",
        justifyContent: "start",
        padding: 6,
        borderRadius: 10,
        background: "rgba(8,13,24,0.96)",
        backdropFilter: "blur(8px)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
        border: "1px solid rgba(148,163,184,0.55)",
        position: "relative",
    };

    const row2Style = {
        ...rowStyle,
        gridTemplateColumns: "auto auto auto 1fr",            alignItems: "center",
        position: "relative",
    };

    const Section = ({ title, children }) => (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                flexWrap: "nowrap",
                whiteSpace: "nowrap",
            }}
        >
            <span style={labelStyle}>{title}</span>
            {children}
        </div>
    );

    const Toggle = ({ label, on, onClick, title, style }) => (
        <Btn
            onClick={onClick}
            title={title}
            variant={on ? "primary" : "ghost"}
            style={{
                height: H,
                padding: "0 8px",
                borderRadius: 8,
                fontSize: 11,
                minWidth: 48,
                ...style,
            }}
        >
            {label}
        </Btn>
    );

    return (
        <div
            onPointerDown={(e) => {
                e.stopPropagation();
                uiStart();
            }}
            onPointerUp={uiStop}
            onPointerCancel={uiStop}
            onPointerLeave={uiStop}
            style={{
                position: "absolute",
                top: 8,
                left: 8,
                right: 8,
                zIndex: 2147483647,
                pointerEvents: "auto",
                display: "grid",
                gridAutoRows: "min-content",
                rowGap: 6,
            }}
        >
            {/* HEADER — logo + title + totals */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(148,163,184,0.6)",
                    background:
                        "linear-gradient(130deg, rgba(15,23,42,0.98), rgba(56,189,248,0.25))",
                    boxShadow: "0 10px 24px rgba(0,0,0,0.6)",
                }}
            >
                {/* Left: logo + text */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        minWidth: 0,
                    }}
                >
                    {typeof logoImg !== "undefined" && (
                        <button
                            type="button"
                            title="Go to selected View"
                            aria-label="Go to selected View"
                            onClick={(e) => {
                                e.stopPropagation();
                                goToSelectedViewFromLogo();
                            }}
                            onPointerDownCapture={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseEnter={() => setLogoHot(true)}
                            onMouseLeave={() => setLogoHot(false)}
                            onFocus={() => setLogoHot(true)}
                            onBlur={() => setLogoHot(false)}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                                margin: 0,
                                border: "none",
                                background: "transparent",
                                borderRadius: 8,
                                cursor: "pointer",
                            }}
                        >
                            <img
                                src={logoImg}
                                alt="Logo"
                                style={{
                                    width: 35,
                                    height: 35,
                                    borderRadius: 6,
                                    objectFit: "contain",
                                    boxShadow:
                                        logoHot || logoFlash
                                            ? "0 0 0 1px rgba(70,220,255,0.55), 0 0 18px rgba(70,220,255,0.65)"
                                            : "0 0 0 1px rgba(15,23,42,0.9)",
                                    filter:
                                        logoHot || logoFlash
                                            ? "brightness(1.18) saturate(1.2)"
                                            : "none",
                                    transform: logoHot
                                        ? "scale(1.04)"
                                        : logoFlash
                                            ? "scale(1.03)"
                                            : "scale(1)",
                                    transition:
                                        "box-shadow 260ms ease, filter 260ms ease, transform 260ms ease",
                                }}
                            />
                        </button>
                    )}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                fontSize: 10,
                                letterSpacing: "0.22em",
                                textTransform: "uppercase",
                                color: "rgba(226,241,255,0.9)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            Node Forge 4.0
                        </div>
                        <div
                            style={{
                                fontSize: 12,
                                color: "#e5e7eb",
                                opacity: 0.9,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {projectName || "Untitled project"}
                        </div>
                    </div>
                </div>

                {/* Right: totals */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 14,
                        fontSize: 11,
                        color: "rgba(226,232,240,0.9)",
                        flexShrink: 0,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span style={{ opacity: 0.7 }}>Rooms</span>
                        <span style={{ fontWeight: 600 }}>{rooms.length}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span style={{ opacity: 0.7 }}>Nodes</span>
                        <span style={{ fontWeight: 600 }}>{nodes.length}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span style={{ opacity: 0.7 }}>Links</span>
                        <span style={{ fontWeight: 600 }}>{links.length}</span>
                    </div>
                </div>
            </div>

            {/* ROW 1 — Project / File · Views · Model & Products */}
            <div style={rowStyle}>
                {/* Project / File */}
                <Section title="Project / File">

                    <SmoothTextInput
                        style={{
                            width: 140,
                            height: H,
                        }}
                        value={projectName}
                        onCommit={setProjectName}
                        title="Project name"
                        placeholder="Project"
                    />
                    <Toggle
                        label={prodMode ? "Prod" : "UI"}
                        on={prodMode}
                        onClick={() => setProdMode((v) => !v)}
                        title="Toggle production / presentation mode"
                        style={{ minWidth: 52 }}
                    />
                    <Btn
                        onClick={() => fileRef.current?.click()}
                        style={{ height: H, padding: "0 8px", minWidth: 52 }}
                        title="Import .zip/.json/.glb/.gltf"
                    >
                        Import
                    </Btn>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".zip,.json,.glb,.gltf"
                        style={{
                            position: "absolute",
                            left: -9999,
                            width: 1,
                            height: 1,
                            opacity: 0,
                        }}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            /\.(zip|json)$/i.test(f.name)
                                ? importPackage(f)
                                : onModelFiles(f);
                            e.target.value = "";
                        }}
                    />
                    <Btn
                        onClick={exportZip}
                        style={{ height: H, padding: "0 8px", minWidth: 52 }}
                        title="Export project (.zip)"
                        variant={
                            !!(nodes?.length || modelBlob) ? "primary" : "ghost"
                        }
                    >
                        Export
                    </Btn>
                    <Btn
                        onClick={openMergeDialog}
                        style={{ height: H, padding: "0 8px", minWidth: 58 }}
                        title="Merge another backup into this project"
                        variant={"ghost"}
                    >
                        Merge
                    </Btn>
                    <span ref={picturesBtnRef} style={{ display: "inline-flex" }}>
                        <Btn
                            onClick={() => setPicturesOpen((v) => !v)}
                            style={{ height: H, padding: "0 8px", minWidth: 78 }}
                            title="Import / show / scale reference pictures"
                            variant={
                                picturesOpen || (importedPictures && importedPictures.length)
                                    ? "primary"
                                    : "ghost"
                            }
                        >
                            Pictures{importedPictures?.length ? ` (${importedPictures.length})` : ""}
                        </Btn>
                    </span>
                    <span
                        aria-hidden="true"
                        style={{
                            width: 1,
                            height: H,
                            background: "rgba(148,163,184,0.35)",
                            margin: "0 6px",
                            display: "inline-block",
                        }}
                    />
                    <IconBtn
                        label="↶"
                        title="Undo (Ctrl+Z)"
                        onClick={undo}
                        disabled={!canUndo}
                    />
                    <IconBtn
                        label="↷"
                        title="Redo (Ctrl+Y)"
                        onClick={redo}
                        disabled={!canRedo}
                    />
                </Section>

                {/* Views / Camera presets */}
                <Section title="Views">
                    <Btn
                        onClick={() => {
                            const snap = cameraSnapshotRef.current?.();
                            if (!snap) return;
                            const name =
                                window.prompt(
                                    "Name this view:",
                                    `View ${
                                        (cameraPresets?.length || 0) + 1
                                    }`,
                                ) || "View";
                            const id = uid();
                            setCameraPresets((prev) => [
                                ...prev,
                                { id, name, ...snap },
                            ]);
                            setCameraPresetId(id);
                        }}
                        style={{ height: H, padding: "0 8px", minWidth: 52 }}
                        title="Save current camera as view"
                    >
                        Save
                    </Btn>
                    <Select
                        value={cameraPresetId}
                        onChange={(e) => setCameraPresetId(e.target.value)}
                        style={{
                            minWidth: 140,
                            maxWidth: 190,
                            height: H,
                        }}
                        title="Select a saved view"
                    >
                        <option value="">Default</option>
                        {cameraPresets.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </Select>
                    <Btn
                        onClick={() => {
                            if (!cameraPresetId) return;
                            setCameraPresets((prev) =>
                                prev.filter((p) => p.id !== cameraPresetId),
                            );
                            setCameraPresetId("");
                        }}
                        style={{ height: H, padding: "0 6px", minWidth: 44 }}
                        title="Delete selected view"
                        variant={cameraPresetId ? "primary" : "ghost"}
                    >
                        Del
                    </Btn>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            marginLeft: 8,
                        }}
                    >
                        <IconBtn
                            label="⟳"
                            title="Reset view"
                            onClick={() => sendCameraView("reset")}
                        />
                        <IconBtn
                            label="F"
                            title="Front (Alt+W)"
                            onClick={() => sendCameraView("front")}
                        />
                        <IconBtn
                            label="B"
                            title="Back (Alt+S)"
                            onClick={() => sendCameraView("back")}
                        />
                        <IconBtn
                            label="L"
                            title="Left (Alt+A)"
                            onClick={() => sendCameraView("left")}
                        />
                        <IconBtn
                            label="R"
                            title="Right (Alt+D)"
                            onClick={() => sendCameraView("right")}
                        />
                        <IconBtn
                            label="⊤"
                            title="Top (Alt+Q)"
                            onClick={() => sendCameraView("top")}
                        />
                        <IconBtn
                            label="⊥"
                            title="Bottom (Alt+E)"
                            onClick={() => sendCameraView("bottom")}
                        />
                    </div>
                </Section>

                {/* Model & Products */}
                <Section title="Model / Products">
                    <Select
                        style={{
                            flex: 1,
                            minWidth: 120,
                            maxWidth: 180,
                            height: H,
                        }}
                        value={currentModelId}
                        onChange={(e) => setCurrentModelId(e.target.value)}
                        title="Static model"
                    >
                        <option value="">(none)</option>
                        {STATIC_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </Select>
                    <Toggle
                        label={modelVisible ? "Hide" : "Show"}
                        on={modelVisible}
                        onClick={() => setModelVisible((v) => !v)}
                        title={modelVisible ? "Hide model" : "Show model"}
                        style={{ minWidth: 60 }}
                    />
                    <Btn
                        onClick={() => setProductsOpen(true)}
                        style={{ height: H, padding: "0 8px", minWidth: 80 }}
                        title="Open product manager"
                    >
                        Products
                    </Btn>

                    {/* 🔁 NEW: Model scale in top bar */}
                    <SmoothNumberInput
                        value={modelScale}
                        step="0.1"
                        min="0.1"
                        max="5"
                        onCommit={(v) => setModelScale(clamp(v, 0.1, 500))}
                        title="Model scale"
                        style={{ width: 64, height: H, textAlign: "center" }}
                    />

                    {/* Existing: Product scale */}
                    <SmoothNumberInput
                        value={productScale}
                        step="0.1"
                        min="0.1"
                        max="5"
                        onCommit={(v) => setProductScale(clamp(v, 0.1, 5))}
                        title="Product scale"
                        style={{ width: 64, height: H, textAlign: "center" }}
                    />
                    <Select
                        value={productUnits}
                        onChange={(e) => setProductUnits(e.target.value)}
                        style={{ width: 64, height: H }}
                        title="Units"
                    >
                        <option value="cm">cm</option>
                        <option value="mm">mm</option>
                        <option value="m">m</option>
                        <option value="in">in</option>
                        <option value="ft">ft</option>
                    </Select>
                </Section>


                {/* QUICK SCENE SLIDERS */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>SCENE Configs</span>

                    {/* Wireframe opacity */}
                    <span style={{ fontSize: 11, color: "#b6c8e6" }}>Wire</span>
                    <div style={{ width: 120 }}>
                        <Slider
                            value={wireOpacity}
                            min={0}
                            max={1}
                            step={0.02}
                            onChange={setWireOpacity}
                        />
                    </div>

                    {/* 🔁 NEW: Wireframe quality */}
                    <span style={{ fontSize: 11, color: "#b6c8e6" }}>Quality</span>
                    <Select
                        value={wireDetail}
                        onChange={(e) => setWireDetail(e.target.value)}
                        style={{ width: 80, height: H }}
                        title="Wireframe quality"
                    >
                        <option value="ultra">Wire: Ultra (full mesh)</option>
                        <option value="high">Wire: High</option>
                        <option value="med">Wire: Medium</option>
                        <option value="low">Wire: Low</option>
                        <option value="bbox">Wire: BBox only</option>
                    </Select>

                    {/* Room opacity */}
                    <span style={{ fontSize: 11, color: "#b6c8e6" }}>Room</span>
                    <div style={{ width: 120 }}>
                        <Slider
                            value={roomOpacity}
                            min={0}
                            max={1}
                            step={0.02}
                            onChange={setRoomOpacity}
                        />
                    </div>

                    {/* Background color */}
                    <span style={{ fontSize: 11, color: "#b6c8e6" }}>BG</span>
                    <Input
                        type="color"
                        value={bg}
                        onChange={(e) => setBg(e.target.value)}
                        style={{ width: 36, height: H, padding: 0 }}
                        title="Background color"
                    />
                </div>

                {/* Pictures popover (hangs under row 1) */}
                {picturesOpen && (
                    <div
                        ref={picturesMenuRef}
                        style={{
                            position: "absolute",
                            top: "400%",
                            left: 10,
                            marginTop: 6,
                            zIndex: 2147483647,
                        }}
                        onPointerDownCapture={(e) => e.stopPropagation()}
                        onPointerMoveCapture={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <Panel title="Pictures">
                            <div style={{ display: "grid", gap: 10, minWidth: 520, maxWidth: 820 }}>
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <Btn
                                            variant="primary"
                                            onClick={() => picturesInputRef.current?.click()}
                                            style={{ height: 28, padding: "0 10px" }}
                                            title="Import one or more images from disk"
                                        >
                                            Import (Disk)…
                                        </Btn>

                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <Btn
                                                variant={picturesTab === "placed" ? "primary" : "ghost"}
                                                onClick={() => setPicturesTab("placed")}
                                                style={{ height: 28, padding: "0 10px" }}
                                                title="Pictures already placed in this scene"
                                            >
                                                Placed{importedPictures?.length ? ` (${importedPictures.length})` : ""}
                                            </Btn>
                                            <Btn
                                                variant={picturesTab === "local" ? "primary" : "ghost"}
                                                onClick={() => setPicturesTab("local")}
                                                style={{ height: 28, padding: "0 10px" }}
                                                title="Add from the bundled library (src/data/pictures)"
                                            >
                                                Local add{localPictures?.length ? ` (${localPictures.length})` : ""}
                                            </Btn>
                                        </div>

                                        <Btn
                                            variant="ghost"
                                            onClick={() => setImportedPictures([])}
                                            disabled={!importedPictures?.length}
                                            style={{ height: 28, padding: "0 10px" }}
                                            title="Remove all placed pictures"
                                        >
                                            Clear all
                                        </Btn>

                                        <div style={{ flex: 1 }} />

                                        <Input
                                            value={picturesTab === "local" ? localPicturesSearch : picturesSearch}
                                            onChange={(e) => {
                                                const v = e?.target?.value ?? "";
                                                if (picturesTab === "local") setLocalPicturesSearch(v);
                                                else setPicturesSearch(v);
                                            }}
                                            placeholder={picturesTab === "local" ? "Search local library…" : "Search placed pictures…"}
                                            style={{ width: 240, height: 28 }}
                                        />

                                        <input
                                            ref={picturesInputRef}
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            style={{
                                                position: "absolute",
                                                left: -9999,
                                                width: 1,
                                                height: 1,
                                                opacity: 0,
                                            }}
                                            onChange={async (e) => {
                                                const files = e.target.files;
                                                if (!files || !files.length) return;
                                                await importPicturesFromFiles(files);
                                                e.target.value = "";
                                                setPicturesTab("placed");
                                            }}
                                        />
                                    </div>

                                    <div style={{ fontSize: 11, opacity: 0.75 }}>
                                        Tip: pictures are flat ground planes. Enable <b>Solid</b> to use them as decks (nodes/rooms can't go below). Use <b>Move</b> to drag via gizmo.
                                        {picturesTab === "local" ? (
                                            <span style={{ marginLeft: 8, opacity: 0.75 }}>
                (If you add files to <b>src/data/pictures</b>, restart the dev server to refresh the library.)
            </span>
                                        ) : null}
                                    </div>
                                </div>

                                <div
                                    style={{
                                        display: "grid",
                                        gap: 10,
                                        maxHeight: 360,
                                        overflow: "auto",
                                        paddingRight: 6,
                                    }}
                                >

                                    {picturesTab === "local" ? (
                                        <div style={{ display: "grid", gap: 10 }}>
                                            {!localPictures?.length ? (
                                                <div style={{ fontSize: 12, opacity: 0.75, display: "grid", gap: 6 }}>
                                                    <div>
                                                        No local pictures found in <b>src/data/pictures</b>.
                                                    </div>
                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>
                                                        Debug: webpack discovered <b>{LOCAL_PICTURES_DEBUG?.webpackCount ?? 0}</b> files
                                                        {LOCAL_PICTURES_DEBUG?.webpackSample?.length ? (
                                                            <span>
                                                                {" "}({LOCAL_PICTURES_DEBUG.webpackSample.slice(0, 3).join(", ")}…)
                                                            </span>
                                                        ) : null}
                                                        {" "}— vite discovered <b>{LOCAL_PICTURES_DEBUG?.viteCount ?? 0}</b> files
                                                        {" "}— resolved <b>{LOCAL_PICTURES_DEBUG?.resolvedCount ?? (localPictures?.length ?? 0)}</b> usable.
                                                    </div>
                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>
                                                        If webpackCount is 0, CRA is not seeing the images at build time. Double-check the files are under
                                                        {" "}<b>src/data/pictures</b> (not <b>public</b> and not outside <b>src</b>), and restart the dev server.
                                                    </div>
                                                    {(LOCAL_PICTURES_DEBUG?.webpackCount ?? 0) > 0 && (LOCAL_PICTURES_DEBUG?.resolvedCount ?? 0) === 0 ? (
                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>
                                                            Webpack sees files, but none resolved to a usable URL. This usually means the asset loader is exporting a
                                                            non-string shape; update <b>src/data/pictures/registry.js</b> to extract URLs from <code>default</code>/<code>src</code>/<code>url</code>.
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div
                                                    style={{
                                                        display: "grid",
                                                        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                                        gap: 10,
                                                    }}
                                                >
                                                    {localPictures
                                                        .filter((it) => {
                                                            const q = (localPicturesSearch || "").trim().toLowerCase();
                                                            if (!q) return true;
                                                            return String(it?.name || "").toLowerCase().includes(q);
                                                        })
                                                        .map((it) => (
                                                            <div
                                                                key={it.key}
                                                                role="button"
                                                                tabIndex={0}
                                                                onClick={() => {
                                                                    void addLocalPicture(it);
                                                                    setPicturesTab("placed");
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter" || e.key === " ") {
                                                                        e.preventDefault();
                                                                        void addLocalPicture(it);
                                                                        setPicturesTab("placed");
                                                                    }
                                                                }}
                                                                style={{
                                                                    cursor: "pointer",
                                                                    padding: 8,
                                                                    borderRadius: 12,
                                                                    border: "1px solid rgba(148,163,184,0.28)",
                                                                    background: "rgba(10,16,30,0.45)",
                                                                    display: "grid",
                                                                    gap: 8,
                                                                }}
                                                                title="Click to add to scene"
                                                            >
                                                                <div
                                                                    style={{
                                                                        height: 90,
                                                                        borderRadius: 10,
                                                                        overflow: "hidden",
                                                                        background: "rgba(2,6,23,0.6)",
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        justifyContent: "center",
                                                                    }}
                                                                >
                                                                    <SmartThumb src={it.src} alt={it.name} />
                                                                </div>
                                                                <div
                                                                    style={{
                                                                        fontSize: 11,
                                                                        opacity: 0.9,
                                                                        whiteSpace: "nowrap",
                                                                        overflow: "hidden",
                                                                        textOverflow: "ellipsis",
                                                                    }}
                                                                >
                                                                    {it.name}
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        !importedPictures?.length ? (
                                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                                                No pictures imported yet.
                                            </div>
                                        ) : (
                                            importedPictures
                                                .slice()
                                                .filter((p) => {
                                                    const q = (picturesSearch || "").trim().toLowerCase();
                                                    if (!q) return true;
                                                    return String(p?.name || "").toLowerCase().includes(q);
                                                })
                                                .reverse()
                                                .map((p) => {
                                                    const hasClipboard = !!pictureValuesClipboardRef.current;
                                                    const snapNodeId =
                                                        (selected?.type === "node" && selected.id) ||
                                                        (Array.isArray(multiSel) ? multiSel.find((it) => it?.type === "node")?.id : null);
                                                    const snapRoomId =
                                                        (selected?.type === "room" && selected.id) ||
                                                        (Array.isArray(multiSel) ? multiSel.find((it) => it?.type === "room")?.id : null);
                                                    const snapNode = snapNodeId ? nodes.find((n) => n.id === snapNodeId) : null;
                                                    const snapRoom = snapRoomId ? rooms.find((r) => r.id === snapRoomId) : null;

                                                    return (
                                                        <div
                                                            key={p.id}
                                                            style={{
                                                                display: "grid",
                                                                gridTemplateColumns: "120px 1fr 420px 180px",
                                                                alignItems: "start",
                                                                gap: 10,
                                                                padding: "8px 10px",
                                                                borderRadius: 10,
                                                                border: "1px solid rgba(148,163,184,0.35)",
                                                                background: "rgba(10,16,30,0.55)",
                                                            }}
                                                        >
                                                            <div style={{ display: "grid", gap: 6 }}>

                                                                <div
                                                                    style={{
                                                                        height: 72,
                                                                        borderRadius: 10,
                                                                        overflow: "hidden",
                                                                        background: "rgba(2,6,23,0.55)",
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        justifyContent: "center",
                                                                        border: "1px solid rgba(148,163,184,0.18)",
                                                                    }}
                                                                >
                                                                    <SmartThumb src={p.src} alt={p.name} />
                                                                </div>
                                                                <Checkbox
                                                                    checked={!!p.visible}
                                                                    onChange={(v) => setPictureVisible(p.id, v)}
                                                                    label="Show"
                                                                    style={{ fontSize: 11 }}
                                                                />
                                                                <Checkbox
                                                                    checked={!!p.solid}
                                                                    onChange={(v) => setPictureSolid(p.id, v)}
                                                                    label="Solid"
                                                                    style={{ fontSize: 11 }}
                                                                    title="When enabled (and Show is on), nodes/rooms can't go below this picture plane"
                                                                />
                                                            </div>

                                                            <div
                                                                title={p.name}
                                                                style={{
                                                                    overflow: "hidden",
                                                                    textOverflow: "ellipsis",
                                                                    whiteSpace: "nowrap",
                                                                    fontSize: 12,
                                                                    opacity: 0.92,
                                                                }}
                                                            >
                                                                {p.name || "(unnamed)"}
                                                            </div>

                                                            <div style={{ display: "grid", gap: 8 }}>
                                                                {/* Scale */}
                                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                    <span style={{ fontSize: 11, opacity: 0.75, minWidth: 46 }}>Scale</span>
                                                                    <div style={{ flex: 1, minWidth: 120 }}>
                                                                        <SmoothRange
                                                                            min={0.01}
                                                                            max={500}
                                                                            step={0.25}
                                                                            value={Number(p.scale) || 1}
                                                                            onChange={(v) => setPictureScale(p.id, v)}
                                                                            title="Scale"
                                                                        />
                                                                    </div>
                                                                    <SmoothNumberInput
                                                                        value={Number(p.scale) || 1}
                                                                        step="0.1"
                                                                        min="0.01"
                                                                        max="500"
                                                                        onCommit={(v) => setPictureScale(p.id, v)}
                                                                        style={{ width: 78, height: 28, textAlign: "center" }}
                                                                        title="Scale"
                                                                    />
                                                                </div>
                                                                {/* Opacity */}
                                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                    <span style={{ fontSize: 11, opacity: 0.75, minWidth: 46 }}>Opacity</span>
                                                                    <div style={{ flex: 1, minWidth: 120 }}>
                                                                        <SmoothRange
                                                                            min={0}
                                                                            max={1}
                                                                            step={0.01}
                                                                            value={(() => { const op = Number(p.opacity); return Number.isFinite(op) ? clamp(op, 0, 1) : 1; })()}
                                                                            onChange={(v) => setPictureOpacity(p.id, v)}
                                                                            title="Opacity"
                                                                        />
                                                                    </div>
                                                                    <SmoothNumberInput
                                                                        value={(() => { const op = Number(p.opacity); return Number.isFinite(op) ? clamp(op, 0, 1) : 1; })()}
                                                                        step="0.01"
                                                                        min="0"
                                                                        max="1"
                                                                        onCommit={(v) => setPictureOpacity(p.id, v)}
                                                                        style={{ width: 78, height: 28, textAlign: "center" }}
                                                                        title="Opacity"
                                                                    />
                                                                </div>
                                                                {/* Position XYZ */}
                                                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                                    <span style={{ fontSize: 11, opacity: 0.75, minWidth: 46 }}>Pos</span>
                                                                    <span style={{ fontSize: 11, opacity: 0.7 }}>X</span>
                                                                    <SmoothNumberInput
                                                                        value={Number(p.x) || 0}
                                                                        step="0.05"
                                                                        min="-5000"
                                                                        max="5000"
                                                                        onCommit={(v) => setPicturePosition(p.id, { x: v })}
                                                                        style={{ width: 74, height: 28, textAlign: "center" }}
                                                                        title="X"
                                                                    />
                                                                    <span style={{ fontSize: 11, opacity: 0.7 }}>Y</span>
                                                                    <SmoothNumberInput
                                                                        value={Number(p.y) || 0}
                                                                        step="0.01"
                                                                        min="-500"
                                                                        max="500"
                                                                        onCommit={(v) => setPicturePosition(p.id, { y: v })}
                                                                        style={{ width: 74, height: 28, textAlign: "center" }}
                                                                        title="Y"
                                                                    />
                                                                    <span style={{ fontSize: 11, opacity: 0.7 }}>Z</span>
                                                                    <SmoothNumberInput
                                                                        value={Number(p.z) || 0}
                                                                        step="0.05"
                                                                        min="-5000"
                                                                        max="5000"
                                                                        onCommit={(v) => setPicturePosition(p.id, { z: v })}
                                                                        style={{ width: 74, height: 28, textAlign: "center" }}
                                                                        title="Z"
                                                                    />
                                                                </div>

                                                                {/* Quick rotate (degrees on Y / yaw) */}
                                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                    <span style={{ fontSize: 11, opacity: 0.75, minWidth: 46 }}>Rotate</span>
                                                                    <div style={{ flex: 1, minWidth: 120 }}>
                                                                        <SmoothRange
                                                                            min={-180}
                                                                            max={180}
                                                                            step={1}
                                                                            value={Number(p.rotY) || 0}
                                                                            onChange={(v) => setPictureRotation(p.id, { rotY: v })}
                                                                            title="Rotate Y (deg)"
                                                                        />
                                                                    </div>
                                                                    <SmoothNumberInput
                                                                        value={Number(p.rotY) || 0}
                                                                        step="1"
                                                                        min="-360"
                                                                        max="360"
                                                                        onCommit={(v) => setPictureRotation(p.id, { rotY: v })}
                                                                        style={{ width: 78, height: 28, textAlign: "center" }}
                                                                        title="Rotation (deg)"
                                                                    />
                                                                </div>

                                                                {/* Advanced XYZ rotation (degrees) */}
                                                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                                    <span style={{ fontSize: 11, opacity: 0.75, minWidth: 46 }}>XYZ</span>
                                                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                                        <span style={{ fontSize: 11, opacity: 0.7 }}>X</span>
                                                                        <SmoothNumberInput
                                                                            value={Number(p.rotX) || 0}
                                                                            step="1"
                                                                            min="-360"
                                                                            max="360"
                                                                            onCommit={(v) => setPictureRotation(p.id, { rotX: v })}
                                                                            style={{ width: 64, height: 28, textAlign: "center" }}
                                                                            title="Rotate X (deg)"
                                                                        />
                                                                        <span style={{ fontSize: 11, opacity: 0.7 }}>Y</span>
                                                                        <SmoothNumberInput
                                                                            value={Number(p.rotY) || 0}
                                                                            step="1"
                                                                            min="-360"
                                                                            max="360"
                                                                            onCommit={(v) => setPictureRotation(p.id, { rotY: v })}
                                                                            style={{ width: 64, height: 28, textAlign: "center" }}
                                                                            title="Rotate Y (deg)"
                                                                        />
                                                                        <span style={{ fontSize: 11, opacity: 0.7 }}>Z</span>
                                                                        <SmoothNumberInput
                                                                            value={Number(p.rotZ) || 0}
                                                                            step="1"
                                                                            min="-360"
                                                                            max="360"
                                                                            onCommit={(v) => setPictureRotation(p.id, { rotZ: v })}
                                                                            style={{ width: 64, height: 28, textAlign: "center" }}
                                                                            title="Rotate Z (deg)"
                                                                        />
                                                                    </div>
                                                                    <span style={{ fontSize: 10, opacity: 0.55 }}>(X/Z tilt the plane)</span>
                                                                </div>
                                                            </div>

                                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                                                                <Btn
                                                                    variant="primary"
                                                                    onClick={() => {
                                                                        // ensure it exists in scene for gizmo
                                                                        setPictureVisible(p.id, true);
                                                                        setSelected({ type: "picture", id: p.id });
                                                                        setMultiSel([]);
                                                                        setMode("select");
                                                                        setMoveMode(true);
                                                                        setTransformMode("translate");
                                                                    }}
                                                                    style={{ height: 28, padding: "0 10px" }}
                                                                    title="Move this picture with gizmo"
                                                                >
                                                                    Move
                                                                </Btn>

                                                                <Btn
                                                                    variant="ghost"
                                                                    onClick={() => deletePicture(p.id)}
                                                                    style={{ height: 28, padding: "0 10px" }}
                                                                    title="Delete"
                                                                >
                                                                    Del
                                                                </Btn>

                                                                <Btn
                                                                    variant="ghost"
                                                                    disabled={!snapNode}
                                                                    onClick={() => {
                                                                        if (!snapNode?.position) return;
                                                                        setPicturePosition(p.id, { x: snapNode.position[0], z: snapNode.position[2] });
                                                                        const yaw = Number(snapNode?.rotation?.[1]) || 0;
                                                                        setPictureRotation(p.id, { rotY: THREE.MathUtils.radToDeg(yaw) });
                                                                    }}
                                                                    style={{ height: 28, padding: "0 10px" }}
                                                                    title="Snap this picture to selected node"
                                                                >
                                                                    Snap N
                                                                </Btn>

                                                                <Btn
                                                                    variant="ghost"
                                                                    disabled={!snapRoom}
                                                                    onClick={() => {
                                                                        if (!snapRoom?.center) return;
                                                                        setPicturePosition(p.id, { x: snapRoom.center[0], z: snapRoom.center[2] });
                                                                        const yaw = Number(snapRoom?.rotation?.[1]) || 0;
                                                                        setPictureRotation(p.id, { rotY: THREE.MathUtils.radToDeg(yaw) });
                                                                    }}
                                                                    style={{ height: 28, padding: "0 10px" }}
                                                                    title="Snap this picture to selected room"
                                                                >
                                                                    Snap R
                                                                </Btn>

                                                                <Btn
                                                                    variant="ghost"
                                                                    onClick={() => {
                                                                        pictureValuesClipboardRef.current = {
                                                                            scale: Number(p.scale) || 1,
                                                                            opacity: (() => { const op = Number(p.opacity); return Number.isFinite(op) ? clamp(op, 0, 1) : 1; })(),
                                                                            x: Number(p.x) || 0,
                                                                            y: Number(p.y) || 0,
                                                                            z: Number(p.z) || 0,
                                                                            rotX: Number(p.rotX) || 0,
                                                                            rotY: Number(p.rotY) || 0,
                                                                            rotZ: Number(p.rotZ) || 0,
                                                                            solid: !!p.solid,
                                                                        };
                                                                        setPictureClipboardTick((t) => t + 1);
                                                                    }}
                                                                    style={{ height: 28, padding: "0 10px" }}
                                                                    title="Copy scale/pos/rot/solid"
                                                                >
                                                                    Copy
                                                                </Btn>

                                                                <Btn
                                                                    variant="ghost"
                                                                    disabled={!hasClipboard}
                                                                    onClick={() => {
                                                                        const clip = pictureValuesClipboardRef.current;
                                                                        if (!clip) return;
                                                                        setImportedPictures((prev) =>
                                                                            (Array.isArray(prev) ? prev : []).map((pp) =>
                                                                                pp.id === p.id
                                                                                    ? {
                                                                                        ...pp,
                                                                                        scale: Number(clip.scale) || 1,
                                                                                        x: Number(clip.x) || 0,
                                                                                        y: Number(clip.y) || 0,
                                                                                        z: Number(clip.z) || 0,
                                                                                        rotX: Number(clip.rotX) || 0,
                                                                                        rotY: Number(clip.rotY) || 0,
                                                                                        rotZ: Number(clip.rotZ) || 0,
                                                                                        solid: !!clip.solid,
                                                                                    }
                                                                                    : pp,
                                                                            ),
                                                                        );
                                                                    }}
                                                                    style={{ height: 28, padding: "0 10px" }}
                                                                    title="Paste copied values onto this picture"
                                                                >
                                                                    Paste
                                                                </Btn>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                        ))}
                                </div>
                            </div>
                        </Panel>
                    </div>
                )}




            </div>

            {/* ROW 2 — Scene · HUD Layout · Reveal FX · Transform / Info */}
            <div style={row2Style}>
                {/* Scene toggles */}
                <Section title="Scene">
                    <Toggle
                        label="Wire"
                        on={wireframe}
                        onClick={() => setWireframe((v) => !v)}
                        title={`Wireframe: ${wireframe ? "On" : "Off"}`}
                    />
                    <Toggle
                        label="Lights"
                        on={showLights}
                        onClick={() => setShowLights((v) => !v)}
                        title={`Lights: ${showLights ? "On" : "Off"}`}
                    />
                    <Toggle
                        label="Bounds"
                        on={showLightBounds}
                        onClick={() => setShowLightBounds((v) => !v)}
                        title={`Light bounds: ${
                            showLightBounds ? "On" : "Off"
                        }`}
                    />
                    <Toggle
                        label="Ground"
                        on={showGround}
                        onClick={() => setShowGround((v) => !v)}
                        title={`Ground grid: ${showGround ? "On" : "Off"}`}
                    />
                    <Toggle
                        label="Shadows"
                        on={shadowsOn}
                        onClick={() => setShadowsOn((v) => !v)}
                        title={`Shadows: ${shadowsOn ? "On" : "Off"}`}
                    />
                    <Toggle
                        label="Anim"
                        on={animate}
                        onClick={() => setAnimate((v) => !v)}
                        title={`Animation: ${animate ? "On" : "Off"}`}
                    />
                    <Toggle
                        label="Labels"
                        on={labelsOn}
                        onClick={() => setLabelsOn((v) => !v)}
                        title={`Labels: ${labelsOn ? "On" : "Off"}`}
                    />

                </Section>
                {/* HUD Layout – in the middle of row 2 */}
                <Section title="HUD Layout">
                    <Toggle
                        label={hudEdit ? "Edit ON" : "Edit OFF"}
                        on={hudEdit}
                        onClick={() => setHudEdit((v) => !v)}
                        title="Toggle HUD grid layout edit mode"
                        style={{ minWidth: 80 }}
                    />
                    <label
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                        }}
                    >
                        <span style={{ opacity: 0.8 }}>Snap</span>
                        <SmoothNumberInput
                            value={hudSnap}
                            min={1}
                            max={32}
                            step={1}
                            onCommit={(v) => setHudSnap(Math.max(1, Math.min(32, Number.isFinite(v) ? v : 1)))}
                            style={{ width: 56, height: H, textAlign: "center" }}
                            title="HUD snap grid size"
                        />
                    </label>
                    <label
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                        }}
                    >
                        <span style={{ opacity: 0.8 }}>Magnet</span>
                        <SmoothNumberInput
                            value={hudMagnet}
                            min={0}
                            max={64}
                            step={1}
                            onCommit={(v) => setHudMagnet(Math.max(0, Math.min(64, Number.isFinite(v) ? v : 0)))}
                            style={{ width: 56, height: H, textAlign: "center" }}
                            title="HUD magnet strength"
                        />
                    </label>
                    <Btn
                        onClick={() => {
                            if (typeof window !== "undefined") {
                                window.dispatchEvent(
                                    new CustomEvent(
                                        "EPIC3D_HUD_RESET_LAYOUT",
                                    ),
                                );
                            }
                        }}
                        style={{
                            height: H,
                            padding: "0 10px",
                            borderRadius: 999,
                            minWidth: 90,
                        }}
                        title="Reset all HUD buttons into a neat row"
                        variant="ghost"
                    >
                        Reset layout
                    </Btn>
                </Section>

                {/* Reveal FX */}
                <Section title="Reveal FX">
                    <Toggle
                        label="FX"
                        on={wireStroke.enabled}
                        onClick={() =>
                            setWireStroke((s) => ({
                                ...s,
                                enabled: !s.enabled,
                            }))
                        }
                        title="Toggle reveal wireframe sweep"
                        style={{ minWidth: 44 }}
                    />
                    <Select
                        value={wireStroke.mode}
                        onChange={(e) =>
                            setWireStroke((s) => ({
                                ...s,
                                mode: e.target.value,
                            }))
                        }
                        style={{ width: 110, height: H }}
                        title="Sweep direction"
                    >
                        <option value="lr">Left → Right</option>
                        <option value="rl">Right → Left</option>
                        <option value="tb">Top → Bottom</option>
                        <option value="bt">Bottom → Top</option>
                    </Select>
                    <Btn
                        onClick={() => setRevealOpen((o) => !o)}
                        style={{ height: H, padding: "0 8px", minWidth: 60 }}
                        title="Fine-tune reveal stroke"
                        variant={revealOpen ? "primary" : "ghost"}
                    >
                        Settings
                    </Btn>
                    <Btn
                        variant={roomOperatorMode ? "primary" : "ghost"}
                        glow={roomOperatorMode}
                        onClick={toggleRoomOperatorMode}
                        style={{ height: H, minWidth: 130 }}
                        title={
                            roomOperatorMode
                                ? "Exit Room Operator mode"
                                : "Enter top-down Room Operator mode"
                        }
                    >
                        {roomOperatorMode ? "Exit Room Operator" : "Room Operator"}
                    </Btn>
                </Section>

                {/* Transform & Global */}
                {/* Transform & Global */}
                <Section title="Transform / Info">
                    <Toggle
                        label="Move"
                        on={moveMode}
                        onClick={() => {
                            setMoveMode((v) => {
                                const next = !v;

                                // Turning Move OFF should unlock box selection again.
                                // Clear selection so the next drag starts a fresh selection.
                                if (!next) {
                                    setSelected(null);
                                    setMultiSel([]);
                                    setSelectedBreakpoint(null);
                                }

                                return next;
                            });
                        }}
                        title={`Move mode: ${moveMode ? "On" : "Off"}`}
                    />
                    <Select
                        disabled={!moveMode}
                        value={transformMode}
                        onChange={(e) => setTransformMode(e.target.value)}
                        style={{
                            width: 120,
                            height: H,
                            opacity: moveMode ? 1 : 0.5,
                        }}
                        title="Transform gizmo"
                    >
                        <option value="translate">Move</option>
                        <option value="rotate">Rotate</option>
                        <option value="scale">Scale</option>
                    </Select>

                    {/* Selection modes + Move selected */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flexWrap: "nowrap",
                            marginLeft: 8,
                        }}
                    >
                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                            Selection
                        </span>
                        <Btn
                            size="xs"
                            variant={
                                selectionMode === "single"
                                    ? "primary"
                                    : "ghost"
                            }
                            onClick={() => {
                                setSelectionMode("single");
                                setMoveMode(true);
                                setTransformMode("translate");
                            }}
                        >
                            Single
                        </Btn>


                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 10, flexWrap: "nowrap" }}>
                            <Checkbox
                                checked={snapRoomsEnabled}
                                onChange={setSnapRoomsEnabled}
                                label="Snap rooms"
                            />
                            <span style={{ fontSize: 11, opacity: 0.75 }}>Strength</span>
                            <SmoothNumberInput
                                value={snapRoomsDistance}
                                step="0.05"
                                min="0.01"
                                onCommit={(v) => setSnapRoomsDistance(Math.max(0.01, Number.isFinite(v) ? v : 0.5))}
                                style={{ width: 72, height: H, textAlign: "center" }}
                                title="Snap distance threshold (world units)"
                                disabled={!snapRoomsEnabled}
                            />
                        </div>
                        <Btn
                            size="xs"
                            variant={
                                selectionMode === "multi"
                                    ? "primary"
                                    : "ghost"
                            }
                            onClick={() => {
                                setSelectionMode("multi");
                                setMoveMode(true);
                                setTransformMode("translate");
                            }}
                        >
                            Multi
                        </Btn>
                        <Btn
                            size="xs"
                            variant={
                                selectionMode === "box"
                                    ? "primary"
                                    : "ghost"
                            }
                            onClick={() => {
                                setSelectionMode("box");
                                setMoveMode(false);          // allow drawing the first marquee
                                setTransformMode("translate");
                                // optional, but usually feels best:
                                setSelected(null);
                                setMultiSel([]);
                                setSelectedBreakpoint(null);
                                setLinkFromId(null);
                                setMode("select");
                            }}
                        >
                            Box
                        </Btn>

                        <Btn
                            size="xs"
                            variant={
                                selected || (multiSel && multiSel.length)
                                    ? "primary"
                                    : "ghost"
                            }
                            disabled={
                                !selected &&
                                (!multiSel || !multiSel.length)
                            }
                            onClick={() => {
                                const all =
                                    multiSel && multiSel.length
                                        ? multiSel
                                        : selected
                                            ? [selected]
                                            : [];
                                if (!all.length) return;

                                // Ensure gizmo is active and we have an anchor
                                setMoveMode(true);
                                const main =
                                    selected ||
                                    all[all.length - 1] ||
                                    null;
                                if (main) setSelected(main);
                            }}
                        >
                            Move selected
                            {multiSel && multiSel.length > 1
                                ? ` (${multiSel.length})`
                                : ""}
                        </Btn>
                    </div>

                    {/* Global product display toggles */}
                    <Checkbox
                        checked={showDimsGlobal}
                        onChange={setShowDimsGlobal}
                        label="Show dimensions"
                        style={{ fontSize: 11 }}
                    />
                    <Checkbox
                        checked={photoDefault}
                        onChange={setPhotoDefault}
                        label="Product photos default"
                        style={{ fontSize: 11 }}
                    />
                    <Checkbox
                        checked={alwaysShow3DInfo}
                        onChange={setAlwaysShow3DInfo}
                        label="3D info"
                        style={{ fontSize: 11 }}
                    />
                </Section>




                {/* Reveal FX settings popover (still hangs under row 2, not a 3rd row) */}
                {revealOpen && (
                    <div
                        style={{
                            position: "absolute",
                            top: "100%",
                            right: "40%",
                            marginTop: 6,
                            zIndex: 2147483647,
                        }}
                        onMouseLeave={() => setRevealOpen(false)}
                    >
                        <Panel title="Reveal FX stroke">
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                        "140px minmax(180px, 1fr)",
                                    gap: 8,
                                    minWidth: 380,
                                }}
                            >
                                <label>Duration (s)</label>
                                <Slider
                                    min={0.2}
                                    max={4}
                                    step={0.05}
                                    value={wireStroke.duration}
                                    onChange={(v) =>
                                        setWireStroke((s) => ({
                                            ...s,
                                            duration: v,
                                        }))
                                    }
                                />
                                <label>Line feather</label>
                                <Slider
                                    min={0}
                                    max={0.3}
                                    step={0.01}
                                    value={wireStroke.feather}
                                    onChange={(v) =>
                                        setWireStroke((s) => ({
                                            ...s,
                                            feather: v,
                                        }))
                                    }
                                />
                                <label>Surface feather</label>
                                <Slider
                                    min={0}
                                    max={0.3}
                                    step={0.01}
                                    value={wireStroke.surfaceFeather}
                                    onChange={(v) =>
                                        setWireStroke((s) => ({
                                            ...s,
                                            surfaceFeather: v,
                                        }))
                                    }
                                />
                            </div>
                        </Panel>
                    </div>
                )}
            </div>
        </div>
    );
});



// ---------------- ActionsPanel (stable, collapsible, smooth inputs) ----------------
const ActionsPanelInner = React.memo(function ActionsPanelInner({ ctx }) {
    const {
        actions = [],
        setActions,
        rooms = [],
        nodes = [],
        links = [],
        groups = [],
        cameraPresets = [],
        runAction,
        keepLeftScroll,
    } = ctx || {};

    const preserve = useCallback((fn) => {
        if (typeof keepLeftScroll === 'function') return keepLeftScroll(fn);
        return fn?.();
    }, [keepLeftScroll]);

    const [working, setWorking] = useState({ label: '' });
    const [justAddedId, setJustAddedId] = useState(null);
    const [justAddedLabel, setJustAddedLabel] = useState('');
    const [openMap, setOpenMap] = useState(() => ({}));

    const [actionSearch, setActionSearch] = useState("");

    const stepTypeOptions = useMemo(() => ([
        { value: 'toggleLight', label: 'Toggle Light' },
        { value: 'toggleGlow', label: 'Toggle Glow' },
        { value: 'setSignalStyle', label: 'Set Signal Style' },
        { value: 'textBox', label: 'Text Box' },
        { value: 'textBoxFade', label: 'Text Box Fade (manual)' },
        { value: 'setWireframe', label: 'Wireframe On/Off (Global)' },
        { value: 'cameraMove', label: 'Camera Move / Track' },
        { value: 'hudFade', label: 'HUD: Fade Button' },
        { value: 'setTextBox', label: 'Text Box On/Off (Node)' },
        { value: 'setRoomVisible', label: 'Room: Show/Hide/Toggle' },
        { value: 'setGroupVisible', label: 'Group: Show/Hide/Toggle' },
        { value: 'packetSend', label: 'Packet: Send / Start' },
        { value: 'packetStop', label: 'Packet: Stop' },
    ]), []);

    const linkLabelById = useMemo(() => {
        const out = {};
        for (const l of (links || [])) {
            const fromName = nodes.find((n) => n.id === l.from)?.label || l.from;
            const toName = nodes.find((n) => n.id === l.to)?.label || l.to;
            out[l.id] = `${fromName} → ${toName}`;
        }
        return out;
    }, [links, nodes]);

    const filteredActions = useMemo(() => {
        const q = (actionSearch || '').trim().toLowerCase();
        if (!q) return actions;
        return (actions || []).filter((a) => {
            const lbl = (a.label || '').toLowerCase();
            const id = (a.id || '').toLowerCase();
            return lbl.includes(q) || id.includes(q);
        });
    }, [actions, actionSearch]);


    const patchAction = useCallback((id, patch) =>
            preserve(() => setActions(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))),
        [preserve, setActions]
    );

    const deleteAction = useCallback((id) =>
            preserve(() => setActions(prev => prev.filter(a => a.id !== id))),
        [preserve, setActions]
    );

    const duplicateAction = useCallback((id) =>
            preserve(() => {
                let newId = null;
                let newLabel = '';

                setActions((prev) => {
                    const idx = (prev || []).findIndex((a) => a.id === id);
                    if (idx < 0) return prev;
                    const base = prev[idx];
                    const copy = JSON.parse(JSON.stringify(base));
                    newId = uuid();
                    copy.id = newId;
                    copy.label = `${base.label || 'Action'} Copy`;
                    newLabel = copy.label;
                    return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
                });

                if (newId) {
                    setJustAddedId(newId);
                    setJustAddedLabel(newLabel);
                    setOpenMap((m) => ({ ...(m || {}), [newId]: true }));
                }
            }),
        [preserve, setActions]
    );

    const addAction = useCallback((e) => {
        e?.preventDefault?.();
        const newId = uuid();
        const newLabel = (working?.label || '').trim() || `Action ${actions.length + 1}`;

        preserve(() =>
            setActions(prev => [
                ...prev,
                { id: newId, label: newLabel, showOnHUD: true, steps: [] },
            ])
        );

        setWorking(w => ({ ...(w || {}), label: '' }));
        setJustAddedId(newId);
        setJustAddedLabel(newLabel);
        setOpenMap(m => ({ ...(m || {}), [newId]: true }));

        setTimeout(() => {
            setJustAddedId((current) => (current === newId ? null : current));
        }, 1000);
    }, [actions.length, preserve, setActions, working]);

    const toggleOpen = useCallback((id) => {
        setOpenMap(m => ({ ...(m || {}), [id]: !(m?.[id] ?? false) }));
    }, []);

    const addStep = useCallback((actId, tpl) =>
            preserve(() =>
                setActions(prev => prev.map(a =>
                    a.id === actId
                        ? { ...a, steps: [...a.steps, (tpl || { type: 'toggleLight', nodeId: null, delay: 0 })] }
                        : a
                ))
            ),
        [preserve, setActions]
    );

    const addChildStep = useCallback((actId, parentIdx, tpl) =>
            preserve(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = a.steps.map((s, i) => {
                        if (i !== parentIdx) return s;
                        const children = Array.isArray(s.children) ? [...s.children] : [];
                        children.push(tpl || { type: 'toggleLight', nodeId: null, delay: 0 });
                        return { ...s, children };
                    });
                    return { ...a, steps };
                }))
            ),
        [preserve, setActions]
    );

    const patchChildStep = useCallback((actId, parentIdx, childIdx, patch) =>
            preserve(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = a.steps.map((s, i) => {
                        if (i !== parentIdx) return s;
                        const children = (s.children || []).map((c, j) => j === childIdx ? { ...c, ...patch } : c);
                        return { ...s, children };
                    });
                    return { ...a, steps };
                }))
            ),
        [preserve, setActions]
    );

    const delChildStep = useCallback((actId, parentIdx, childIdx) =>
            preserve(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = a.steps.map((s, i) => {
                        if (i !== parentIdx) return s;
                        const children = (s.children || []).filter((_, j) => j !== childIdx);
                        return { ...s, children };
                    });
                    return { ...a, steps };
                }))
            ),
        [preserve, setActions]
    );

    const moveChildStep = useCallback((actId, parentIdx, childIdx, dir) =>
            preserve(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = a.steps.map((s, i) => {
                        if (i !== parentIdx) return s;
                        const children = [...(s.children || [])];
                        const j = childIdx + dir;
                        if (j < 0 || j >= children.length) return s;
                        [children[childIdx], children[j]] = [children[j], children[childIdx]];
                        return { ...s, children };
                    });
                    return { ...a, steps };
                }))
            ),
        [preserve, setActions]
    );

    const patchStep = useCallback((actId, idx, patch) =>
            preserve(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = a.steps.map((s, i) => i == idx ? { ...s, ...patch } : s);
                    return { ...a, steps };
                }))
            ),
        [preserve, setActions]
    );

    const delStep = useCallback((actId, idx) =>
            preserve(() =>
                setActions(prev => prev.map(a =>
                    a.id === actId
                        ? { ...a, steps: a.steps.filter((_, i) => i !== idx) }
                        : a
                ))
            ),
        [preserve, setActions]
    );

    const moveStep = useCallback((actId, idx, dir) =>
            preserve(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = [...a.steps];
                    const j = idx + dir;
                    if (j < 0 || j >= steps.length) return a;
                    [steps[idx], steps[j]] = [steps[j], steps[idx]];
                    return { ...a, steps };
                }))
            ),
        [preserve, setActions]
    );



    const duplicateStep = useCallback(
        (actId, idx) =>
            preserve(() =>
                setActions((prev) =>
                    prev.map((a) => {
                        if (a.id !== actId) return a;
                        const steps = [...(a.steps || [])];
                        if (idx < 0 || idx >= steps.length) return a;
                        const copy = JSON.parse(JSON.stringify(steps[idx]));
                        steps.splice(idx + 1, 0, copy);
                        return { ...a, steps };
                    })
                )
            ),
        [preserve, setActions]
    );

    const duplicateChildStep = useCallback(
        (actId, parentIdx, childIdx) =>
            preserve(() =>
                setActions((prev) =>
                    prev.map((a) => {
                        if (a.id !== actId) return a;
                        const steps = (a.steps || []).map((s, i) => {
                            if (i !== parentIdx) return s;
                            const children = [...(s.children || [])];
                            if (childIdx < 0 || childIdx >= children.length) return s;
                            const copy = JSON.parse(JSON.stringify(children[childIdx]));
                            children.splice(childIdx + 1, 0, copy);
                            return { ...s, children };
                        });
                        return { ...a, steps };
                    })
                )
            ),
        [preserve, setActions]
    );
    const stopToggle = useCallback((e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
    }, []);

    return (
        <Panel title="Actions / On-screen Buttons">
            <div style={{ display: 'grid', gap: 10 }}
                 onPointerDownCapture={(e) => e.stopPropagation()}
                 onPointerMoveCapture={(e) => e.stopPropagation()}
            >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
                >
                    <div style={{ flex: 1, minWidth: 180 }}
                    >
                        <Input
                            value={actionSearch}
                            onChange={(e) => setActionSearch(e.target.value)}
                            placeholder="Search actions…"
                        />
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.75, whiteSpace: 'nowrap' }}
                    >
                        Showing {filteredActions.length} / {actions.length}
                    </div>
                </div>

                {/* Create */}
                <div
                    style={{
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 14,
                        padding: 10,
                        background: 'rgba(255,255,255,0.03)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}
                    >
                        <div style={{ fontSize: 12, opacity: 0.9, fontWeight: 600 }}>Create button</div>
                        <div style={{ fontSize: 11, opacity: 0.65 }}>Buttons can run multiple steps.</div>
                    </div>
                    <form
                        onSubmit={addAction}
                        style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}
                    >
                        <label style={{ minWidth: 0 }}
                        >
                            <div style={{ fontSize: 11, opacity: 0.8 }}>Name</div>
                            <Input
                                value={working.label}
                                onChange={(e) => setWorking((w) => ({ ...(w || {}), label: e.target.value }))}
                                placeholder="New action name…"
                            />
                        </label>
                        <Btn type="submit" variant="primary" glow>+ Add</Btn>
                    </form>
                    {justAddedLabel && (
                        <div style={{ fontSize: 11, opacity: 0.85, color: '#a6d4ff', marginTop: 8 }}>
                            Added “{justAddedLabel}”
                        </div>
                    )}
                </div>

                {/* List */}
                <div style={{ display: 'grid', gap: 8 }}
                >
                    {actions.length === 0 && (
                        <div style={{ opacity: 0.7, fontSize: 12 }}>No actions yet. Create one above.</div>
                    )}

                    {actions.length > 0 && filteredActions.length === 0 && (
                        <div style={{ opacity: 0.7, fontSize: 12 }}>No actions match “{actionSearch}”.</div>
                    )}

                    {filteredActions.map((a) => {
                        const isOpen = (openMap?.[a.id] ?? false) === true;
                        const highlight = a.id === justAddedId;
                        return (
                            <div
                                key={a.id}
                                style={{
                                    border: '1px solid rgba(255,255,255,0.14)',
                                    borderRadius: 14,
                                    padding: 10,
                                    background: highlight ? 'rgba(80,160,255,0.08)' : 'rgba(255,255,255,0.02)',
                                    boxShadow: highlight ? '0 0 0 1px rgba(120,190,255,0.35) inset' : 'none',
                                }}
                            >
                                {/* Header */}
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr auto',
                                        gap: 10,
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => toggleOpen(a.id)}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}
                                    >
                                        <div style={{ width: 18, textAlign: 'center', opacity: 0.8 }}
                                        >
                                            {isOpen ? '▾' : '▸'}
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0 }}
                                             onClick={stopToggle}
                                             onPointerDownCapture={(e) => e.stopPropagation()}
                                        >
                                            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>Button label</div>
                                            <SmoothTextInput
                                                value={a.label || ''}
                                                onCommit={(txt) => patchAction(a.id, { label: txt })}
                                            />
                                        </div>

                                        <div
                                            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                                            onClick={stopToggle}
                                            onPointerDownCapture={(e) => e.stopPropagation()}
                                        >
                                            <Checkbox
                                                checked={(a.showOnHUD ?? true) === true}
                                                onChange={(v) => patchAction(a.id, { showOnHUD: v })}
                                                label="HUD"
                                            />
                                            <div
                                                style={{
                                                    fontSize: 11,
                                                    opacity: 0.75,
                                                    padding: '4px 8px',
                                                    borderRadius: 999,
                                                    border: '1px solid rgba(255,255,255,0.12)',
                                                    background: 'rgba(255,255,255,0.03)',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {a.steps?.length || 0} step{(a.steps?.length || 0) === 1 ? '' : 's'}
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                                        onClick={stopToggle}
                                        onPointerDownCapture={(e) => e.stopPropagation()}
                                    >
                                        <IconBtn label="▶" title="Run" onClick={(e) => { e.preventDefault(); runAction?.(a); }} />
                                        <IconBtn label={isOpen ? '▴' : '✎'} title={isOpen ? 'Collapse' : 'Edit'} onClick={(e) => { e.preventDefault(); toggleOpen(a.id); }} />
                                    </div>
                                </div>

                                {/* Body */}
                                {isOpen && (
                                    <div
                                        style={{
                                            marginTop: 10,
                                            paddingTop: 10,
                                            borderTop: '1px solid rgba(255,255,255,0.10)',
                                            display: 'grid',
                                            gap: 10,
                                        }}
                                        onClick={stopToggle}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
                                        >
                                            <div style={{ fontSize: 12, opacity: 0.9, fontWeight: 600 }}>Steps</div>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
                                            >
                                                <IconBtn label="⧉" title="Duplicate button" onClick={(e) => { e.preventDefault(); duplicateAction(a.id); }} />
                                                <IconBtn label="🗑️" title="Delete button" onClick={(e) => { e.preventDefault(); deleteAction(a.id); }} />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gap: 8 }}
                                        >
                                            {(a.steps?.length || 0) === 0 && (
                                                <div style={{ opacity: 0.7, fontSize: 12 }}>No steps yet.</div>
                                            )}

                                            {(a.steps || []).map((s, i) => {
                                                const isCamera = s.type === 'cameraMove';
                                                const isWire = s.type === 'setWireframe';
                                                const isHudFade = s.type === 'hudFade';
                                                const isTextBox = s.type === 'setTextBox';
                                                const isRoomVis = s.type === 'setRoomVisible';
                                                const isGroupVis = s.type === 'setGroupVisible';
                                                const isPacketSend = s.type === 'packetSend';
                                                const isPacketStop = s.type === 'packetStop';
                                                const isPacket = isPacketSend || isPacketStop;

                                                return (
                                                    <div
                                                        key={i}
                                                        style={{
                                                            padding: 8,
                                                            borderRadius: 12,
                                                            background: 'rgba(255,255,255,0.02)',
                                                            border: '1px solid rgba(255,255,255,0.08)',
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: '1.2fr 1.5fr 1.7fr auto',
                                                                gap: 8,
                                                                alignItems: 'end',
                                                            }}
                                                        >
                                                            <label>
                                                                <div style={{ fontSize: 11, opacity: 0.8 }}>Type</div>
                                                                <Select
                                                                    value={s.type}
                                                                    onChange={(e) => {
                                                                        const type = e.target.value;
                                                                        const patch = { type };
                                                                        if (type === 'cameraMove') {
                                                                            patch.nodeId = null;
                                                                            patch.fromPresetId = s.fromPresetId || '';
                                                                            patch.toPresetId = s.toPresetId || '';
                                                                            patch.delay = s.delay ?? 0;
                                                                            patch.duration = s.duration ?? 1.5;
                                                                        } else if (type === 'setWireframe') {
                                                                            patch.nodeId = null;
                                                                            patch.value = s.value || 'on';
                                                                            patch.delay = s.delay ?? 0;
                                                                            patch.duration = undefined;
                                                                            patch.fromPresetId = undefined;
                                                                            patch.toPresetId = undefined;
                                                                        } else if (type === 'setTextBox') {
                                                                            patch.value = s.value || 'on';
                                                                        } else if (type === 'setRoomVisible') {
                                                                            patch.nodeId = null;
                                                                            patch.roomId = s.roomId || '';
                                                                            patch.mode = s.mode || 'toggle';
                                                                            patch.value = undefined;
                                                                            patch.duration = undefined;
                                                                            patch.fromPresetId = undefined;
                                                                            patch.toPresetId = undefined;
                                                                            patch.hudTargetId = undefined;
                                                                            patch.hudMode = undefined;
                                                                            patch.hudDuration = undefined;
                                                                            patch.linkId = undefined;
                                                                            patch.count = undefined;
                                                                            patch.interval = undefined;
                                                                            patch.loop = undefined;
                                                                            patch.burstInterval = undefined;
                                                                            patch.burstsLimit = undefined;
                                                                            patch.clearExisting = undefined;
                                                                            patch.stopLoopsOnly = undefined;
                                                                            patch.clearInFlight = undefined;
                                                                        } else if (type === 'setGroupVisible') {
                                                                            patch.nodeId = null;
                                                                            patch.roomId = undefined;
                                                                            patch.groupId = s.groupId || '';
                                                                            patch.mode = s.mode || 'toggle';
                                                                            patch.value = undefined;
                                                                            patch.duration = undefined;
                                                                            patch.fromPresetId = undefined;
                                                                            patch.toPresetId = undefined;
                                                                            patch.hudTargetId = undefined;
                                                                            patch.hudMode = undefined;
                                                                            patch.hudDuration = undefined;
                                                                            patch.linkId = undefined;
                                                                            patch.count = undefined;
                                                                            patch.interval = undefined;
                                                                            patch.loop = undefined;
                                                                            patch.burstInterval = undefined;
                                                                            patch.burstsLimit = undefined;
                                                                            patch.clearExisting = undefined;
                                                                            patch.stopLoopsOnly = undefined;
                                                                            patch.clearInFlight = undefined;
                                                                        } else if (type === 'packetSend') {
                                                                            patch.nodeId = null;
                                                                            patch.linkId = s.linkId || '__ALL_PACKET__';
                                                                            patch.delay = s.delay ?? 0;
                                                                            patch.count = (s.count ?? 1);
                                                                            patch.interval = (s.interval ?? 0.15);
                                                                            patch.loop = !!s.loop;
                                                                            patch.burstInterval = (s.burstInterval ?? 1.0);
                                                                            patch.burstsLimit = (s.burstsLimit ?? 0);
                                                                            patch.clearExisting = !!s.clearExisting;
                                                                            patch.duration = undefined;
                                                                            patch.fromPresetId = undefined;
                                                                            patch.toPresetId = undefined;
                                                                            patch.hudTargetId = undefined;
                                                                            patch.hudMode = undefined;
                                                                            patch.hudDuration = undefined;
                                                                            patch.value = undefined;
                                                                        } else if (type === 'packetStop') {
                                                                            patch.nodeId = null;
                                                                            patch.linkId = s.linkId || '__ALL_PACKET__';
                                                                            patch.delay = s.delay ?? 0;
                                                                            patch.stopLoopsOnly = !!s.stopLoopsOnly;
                                                                            patch.clearInFlight = (s.clearInFlight ?? true);
                                                                            patch.duration = undefined;
                                                                            patch.fromPresetId = undefined;
                                                                            patch.toPresetId = undefined;
                                                                            patch.hudTargetId = undefined;
                                                                            patch.hudMode = undefined;
                                                                            patch.hudDuration = undefined;
                                                                            patch.value = undefined;
                                                                        }
                                                                        patchStep(a.id, i, patch);
                                                                    }}
                                                                >
                                                                    {stepTypeOptions.map((opt) => (
                                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                                    ))}
                                                                </Select>
                                                            </label>

                                                            {isCamera ? (
                                                                <label>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>From View</div>
                                                                    <Select
                                                                        value={s.fromPresetId || ''}
                                                                        onChange={(e) => patchStep(a.id, i, { fromPresetId: e.target.value || '' })}
                                                                    >
                                                                        <option value=''> (current) </option>
                                                                        {cameraPresets.map((p) => (
                                                                            <option key={p.id} value={p.id}>{p.name}</option>
                                                                        ))}
                                                                    </Select>
                                                                </label>
                                                            ) : isWire ? (
                                                                <label>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target</div>
                                                                    <div style={{
                                                                        fontSize: 12,
                                                                        opacity: 0.8,
                                                                        padding: '7px 10px',
                                                                        borderRadius: 10,
                                                                        border: '1px solid rgba(255,255,255,0.12)',
                                                                        background: 'rgba(255,255,255,0.04)',
                                                                    }}>Global: Wireframe</div>
                                                                </label>
                                                            ) : isHudFade ? (
                                                                <label>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target Button</div>
                                                                    <Select
                                                                        value={s.hudTargetId || ''}
                                                                        onChange={(e) => patchStep(a.id, i, { hudTargetId: e.target.value || '' })}
                                                                    >
                                                                        <option value=''> (none) </option>
                                                                        {actions
                                                                            .filter((act) => (act.showOnHUD ?? true) === true)
                                                                            .map((act) => (
                                                                                <option key={act.id} value={act.id}>{act.label || '(unnamed button)'}</option>
                                                                            ))}
                                                                    </Select>
                                                                </label>
                                                            ) : isPacket ? (
                                                                <label>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target Link</div>
                                                                    <Select
                                                                        value={s.linkId || '__ALL_PACKET__'}
                                                                        onChange={(e) => patchStep(a.id, i, { linkId: e.target.value || '__ALL_PACKET__' })}
                                                                    >
                                                                        <option value='__ALL_PACKET__'>(all packet links)</option>
                                                                        {(links || []).map((lnk) => (
                                                                            <option key={lnk.id} value={lnk.id}>{linkLabelById?.[lnk.id] || lnk.id}</option>
                                                                        ))}
                                                                    </Select>
                                                                </label>
                                                            ) : isGroupVis ? (
                                                                <label>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target Group</div>
                                                                    <Select
                                                                        value={s.groupId || ''}
                                                                        onChange={(e) => patchStep(a.id, i, { groupId: e.target.value || '' })}
                                                                    >
                                                                        <option value=''> (none) </option>
                                                                        <option value='__ALL__'>(all groups)</option>
                                                                        {groups.map((gg) => (
                                                                            <option key={gg.id} value={gg.id}>{gg.name || gg.id}</option>
                                                                        ))}
                                                                    </Select>
                                                                </label>
                                                            ) : isRoomVis ? (
                                                                <label>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target Room</div>
                                                                    <Select
                                                                        value={s.roomId || ''}
                                                                        onChange={(e) => patchStep(a.id, i, { roomId: e.target.value || '' })}
                                                                    >
                                                                        <option value=''> (none) </option>
                                                                        {rooms.map((r) => (
                                                                            <option key={r.id} value={r.id}>{r.name || r.id}</option>
                                                                        ))}
                                                                    </Select>
                                                                </label>
                                                            ) : (
                                                                <label>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target Node</div>
                                                                    <Select
                                                                        value={s.nodeId || ''}
                                                                        onChange={(e) => patchStep(a.id, i, { nodeId: e.target.value || null })}
                                                                    >
                                                                        <option value=''> (none) </option>
                                                                        {nodes.map((n) => (
                                                                            <option key={n.id} value={n.id}>{n.label}</option>
                                                                        ))}
                                                                    </Select>
                                                                </label>
                                                            )}

                                                            {isCamera ? (
                                                                <div style={{ display: 'grid', gap: 6 }}
                                                                >
                                                                    <label>
                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>To View</div>
                                                                        <Select
                                                                            value={s.toPresetId || ''}
                                                                            onChange={(e) => patchStep(a.id, i, { toPresetId: e.target.value || '' })}
                                                                        >
                                                                            <option value=''> (pick a view) </option>
                                                                            {cameraPresets.map((p) => (
                                                                                <option key={p.id} value={p.id}>{p.name}</option>
                                                                            ))}
                                                                        </Select>
                                                                    </label>
                                                                    <div style={{ display: 'flex', gap: 6 }}
                                                                    >
                                                                        <label style={{ flex: 1 }}>
                                                                            <div style={{ fontSize: 11, opacity: 0.8 }}>Delay (s)</div>
                                                                            <SmoothNumberInput
                                                                                step={0.1}
                                                                                value={s.delay ?? 0}
                                                                                onCommit={(v) => patchStep(a.id, i, { delay: v })}
                                                                            />
                                                                        </label>
                                                                        <label style={{ flex: 1 }}>
                                                                            <div style={{ fontSize: 11, opacity: 0.8 }}>Duration (s)</div>
                                                                            <SmoothNumberInput
                                                                                step={0.1}
                                                                                value={s.duration ?? 1.5}
                                                                                onCommit={(v) => patchStep(a.id, i, { duration: v })}
                                                                            />
                                                                        </label>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div style={{ display: 'grid', gap: 6 }}
                                                                >
                                                                    <label>
                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Delay (s)</div>
                                                                        <SmoothNumberInput
                                                                            step={0.1}
                                                                            value={s.delay ?? 0}
                                                                            onCommit={(v) => patchStep(a.id, i, { delay: v })}
                                                                        />
                                                                    </label>

                                                                    {(isRoomVis || isGroupVis) && (
                                                                        <label>
                                                                            <div style={{ fontSize: 11, opacity: 0.8 }}>Visibility</div>
                                                                            <Select
                                                                                value={s.mode || 'toggle'}
                                                                                onChange={(e) => patchStep(a.id, i, { mode: e.target.value || 'toggle' })}
                                                                            >
                                                                                <option value='toggle'>Toggle</option>
                                                                                <option value='show'>Show</option>
                                                                                <option value='hide'>Hide</option>
                                                                            </Select>
                                                                        </label>
                                                                    )}

                                                                    {isPacketSend && (
                                                                        <div style={{ display: 'grid', gap: 6 }}>
                                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                                                                <label>
                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Count</div>
                                                                                    <SmoothNumberInput
                                                                                        step={1}
                                                                                        value={s.count ?? 1}
                                                                                        onCommit={(v) => patchStep(a.id, i, { count: Math.max(1, Math.round(Number(v) || 1)) })}
                                                                                    />
                                                                                </label>
                                                                                <label>
                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Interval (s)</div>
                                                                                    <SmoothNumberInput
                                                                                        step={0.05}
                                                                                        value={s.interval ?? 0.15}
                                                                                        onCommit={(v) => patchStep(a.id, i, { interval: Math.max(0, Number(v) || 0) })}
                                                                                    />
                                                                                </label>
                                                                            </div>

                                                                            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                                <input
                                                                                    type='checkbox'
                                                                                    checked={!!s.loop}
                                                                                    onChange={(e) => patchStep(a.id, i, { loop: e.target.checked })}
                                                                                />
                                                                                <span style={{ fontSize: 11, opacity: 0.85 }}>Loop</span>
                                                                            </label>

                                                                            {s.loop && (
                                                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                                                                    <label>
                                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Burst Interval (s)</div>
                                                                                        <SmoothNumberInput
                                                                                            step={0.1}
                                                                                            value={s.burstInterval ?? 1.0}
                                                                                            onCommit={(v) => patchStep(a.id, i, { burstInterval: Math.max(0, Number(v) || 0) })}
                                                                                        />
                                                                                    </label>
                                                                                    <label>
                                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Bursts Limit (0=∞)</div>
                                                                                        <SmoothNumberInput
                                                                                            step={1}
                                                                                            value={s.burstsLimit ?? 0}
                                                                                            onCommit={(v) => patchStep(a.id, i, { burstsLimit: Math.max(0, Math.round(Number(v) || 0)) })}
                                                                                        />
                                                                                    </label>
                                                                                </div>
                                                                            )}

                                                                            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                                <input
                                                                                    type='checkbox'
                                                                                    checked={!!s.clearExisting}
                                                                                    onChange={(e) => patchStep(a.id, i, { clearExisting: e.target.checked })}
                                                                                />
                                                                                <span style={{ fontSize: 11, opacity: 0.85 }}>Clear existing packets on start</span>
                                                                            </label>
                                                                        </div>
                                                                    )}

                                                                    {isPacketStop && (
                                                                        <div style={{ display: 'grid', gap: 6 }}>
                                                                            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                                <input
                                                                                    type='checkbox'
                                                                                    checked={!!s.stopLoopsOnly}
                                                                                    onChange={(e) => patchStep(a.id, i, { stopLoopsOnly: e.target.checked })}
                                                                                />
                                                                                <span style={{ fontSize: 11, opacity: 0.85 }}>Stop loop only (let in-flight finish)</span>
                                                                            </label>
                                                                            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                                <input
                                                                                    type='checkbox'
                                                                                    checked={(s.clearInFlight ?? true) !== false}
                                                                                    onChange={(e) => patchStep(a.id, i, { clearInFlight: e.target.checked })}
                                                                                />
                                                                                <span style={{ fontSize: 11, opacity: 0.85 }}>Clear in-flight packets</span>
                                                                            </label>
                                                                        </div>
                                                                    )}

                                                                    {s.type === 'setSignalStyle' && (
                                                                        <label>
                                                                            <div style={{ fontSize: 11, opacity: 0.8 }}>Value</div>
                                                                            <Select
                                                                                value={s.value || 'waves'}
                                                                                onChange={(e) => patchStep(a.id, i, { value: e.target.value })}
                                                                            >
                                                                                <option value='waves'>waves</option>
                                                                                <option value='rays'>rays</option>
                                                                                <option value='none'>none</option>
                                                                            </Select>
                                                                        </label>
                                                                    )}

                                                                    {s.type === 'hudFade' && (
                                                                        <div style={{ display: 'flex', gap: 6 }}
                                                                        >
                                                                            <label style={{ flex: 1 }}>
                                                                                <div style={{ fontSize: 11, opacity: 0.8 }}>Fade</div>
                                                                                <Select
                                                                                    value={s.hudMode || 'out'}
                                                                                    onChange={(e) => patchStep(a.id, i, { hudMode: e.target.value || 'out' })}
                                                                                >
                                                                                    <option value='in'>Fade In</option>
                                                                                    <option value='out'>Fade Out</option>
                                                                                </Select>
                                                                            </label>
                                                                            <label style={{ flex: 1 }}>
                                                                                <div style={{ fontSize: 11, opacity: 0.8 }}>Duration (s)</div>
                                                                                <SmoothNumberInput
                                                                                    step={0.1}
                                                                                    value={s.hudDuration ?? 0.35}
                                                                                    onCommit={(v) => patchStep(a.id, i, { hudDuration: v })}
                                                                                />
                                                                            </label>
                                                                        </div>
                                                                    )}

                                                                    {s.type === 'textBox' && (
                                                                        <label>
                                                                            <div style={{ fontSize: 11, opacity: 0.8 }}>Text Box Action</div>
                                                                            <Select
                                                                                value={s.mode || 'toggle'}
                                                                                onChange={(e) => patchStep(a.id, i, { mode: e.target.value })}
                                                                            >
                                                                                <option value='toggle'>Toggle on/off</option>
                                                                                <option value='on'>Force ON</option>
                                                                                <option value='off'>Force OFF</option>
                                                                                <option value='fade'>Timed fade (use node timers)</option>
                                                                            </Select>
                                                                        </label>
                                                                    )}

                                                                    {s.type === 'textBoxFade' && (
                                                                        <>
                                                                            <label>
                                                                                <div style={{ fontSize: 11, opacity: 0.8 }}>Fade Type</div>
                                                                                <Select
                                                                                    value={s.fadeMode || 'in'}
                                                                                    onChange={(e) => patchStep(a.id, i, { fadeMode: e.target.value })}
                                                                                >
                                                                                    <option value='in'>Fade In (stay visible)</option>
                                                                                    <option value='out'>Fade Out (hide)</option>
                                                                                    <option value='show'>Show instantly</option>
                                                                                    <option value='hide'>Hide instantly</option>
                                                                                </Select>
                                                                            </label>
                                                                            <label>
                                                                                <div style={{ fontSize: 11, opacity: 0.8 }}>Duration (s)</div>
                                                                                <SmoothNumberInputNullable
                                                                                    step={0.1}
                                                                                    value={(s.duration ?? '')}
                                                                                    onCommit={(v) => patchStep(a.id, i, { duration: v })}
                                                                                />
                                                                            </label>
                                                                        </>
                                                                    )}

                                                                    {isWire && (
                                                                        <label>
                                                                            <div style={{ fontSize: 11, opacity: 0.8 }}>Wireframe</div>
                                                                            <Select
                                                                                value={s.value || 'on'}
                                                                                onChange={(e) => patchStep(a.id, i, { value: e.target.value })}
                                                                            >
                                                                                <option value='on'>On</option>
                                                                                <option value='off'>Off</option>
                                                                            </Select>
                                                                        </label>
                                                                    )}

                                                                    {isTextBox && (
                                                                        <label>
                                                                            <div style={{ fontSize: 11, opacity: 0.8 }}>Text Box</div>
                                                                            <Select
                                                                                value={s.value || 'on'}
                                                                                onChange={(e) => patchStep(a.id, i, { value: e.target.value })}
                                                                            >
                                                                                <option value='on'>On</option>
                                                                                <option value='off'>Off</option>
                                                                            </Select>
                                                                        </label>
                                                                    )}
                                                                </div>
                                                            )}

                                                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}
                                                            >
                                                                <IconBtn label="↑" title="Move up" onClick={(e) => { e.preventDefault(); moveStep(a.id, i, -1); }} />
                                                                <IconBtn label="↓" title="Move down" onClick={(e) => { e.preventDefault(); moveStep(a.id, i, +1); }} />
                                                                <IconBtn label="⧉" title="Duplicate step" onClick={(e) => { e.preventDefault(); duplicateStep(a.id, i); }} />
                                                                <IconBtn label="🗑️" title="Delete step" onClick={(e) => { e.preventDefault(); delStep(a.id, i); }} />
                                                            </div>
                                                        </div>

                                                        {Array.isArray(s.children) && s.children.length > 0 && (
                                                            <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: '2px solid rgba(255,255,255,0.08)', display: 'grid', gap: 8 }}
                                                            >
                                                                {(s.children || []).map((c, ci) => {
                                                                    const cIsWire = c.type === 'setWireframe';
                                                                    const cIsTextBox = c.type === 'setTextBox';
                                                                    const cIsPacketSend = c.type === 'packetSend';
                                                                    const cIsPacketStop = c.type === 'packetStop';
                                                                    const cIsPacket = cIsPacketSend || cIsPacketStop;
                                                                    const cIsRoomVis = c.type === 'setRoomVisible';
                                                                    const cIsGroupVis = c.type === 'setGroupVisible';
                                                                    return (
                                                                        <div
                                                                            key={ci}
                                                                            style={{
                                                                                padding: 8,
                                                                                borderRadius: 12,
                                                                                background: 'rgba(255,255,255,0.015)',
                                                                                border: '1px solid rgba(255,255,255,0.06)',
                                                                                display: 'grid',
                                                                                gridTemplateColumns: '1.3fr 1.6fr 1.3fr auto',
                                                                                gap: 8,
                                                                                alignItems: 'end',
                                                                            }}
                                                                        >
                                                                            <label>
                                                                                <div style={{ fontSize: 11, opacity: 0.8 }}>Type</div>
                                                                                <Select
                                                                                    value={c.type}
                                                                                    onChange={(e) => {
                                                                                        const type = e.target.value;
                                                                                        const patch = { type };
                                                                                        if (type === 'setWireframe') {
                                                                                            patch.nodeId = null;
                                                                                            patch.value = c.value || 'on';
                                                                                        } else if (type === 'setTextBox') {
                                                                                            patch.value = c.value || 'on';
                                                                                        } else if (type === 'setRoomVisible') {
                                                                                            patch.nodeId = null;
                                                                                            patch.roomId = c.roomId || '';
                                                                                            patch.mode = c.mode || 'toggle';
                                                                                            patch.value = undefined;
                                                                                            patch.linkId = undefined;
                                                                                            patch.count = undefined;
                                                                                            patch.interval = undefined;
                                                                                            patch.loop = undefined;
                                                                                            patch.burstInterval = undefined;
                                                                                            patch.burstsLimit = undefined;
                                                                                            patch.clearExisting = undefined;
                                                                                            patch.stopLoopsOnly = undefined;
                                                                                            patch.clearInFlight = undefined;
                                                                                        } else if (type === 'setGroupVisible') {
                                                                                            patch.nodeId = null;
                                                                                            patch.groupId = c.groupId || '';
                                                                                            patch.mode = c.mode || 'toggle';
                                                                                            patch.value = undefined;
                                                                                            patch.roomId = undefined;
                                                                                            patch.linkId = undefined;
                                                                                            patch.count = undefined;
                                                                                            patch.interval = undefined;
                                                                                            patch.loop = undefined;
                                                                                            patch.burstInterval = undefined;
                                                                                            patch.burstsLimit = undefined;
                                                                                            patch.clearExisting = undefined;
                                                                                            patch.stopLoopsOnly = undefined;
                                                                                            patch.clearInFlight = undefined;
                                                                                        } else if (type === 'packetSend') {
                                                                                            patch.nodeId = null;
                                                                                            patch.linkId = c.linkId || '__ALL_PACKET__';
                                                                                            patch.delay = c.delay ?? 0;
                                                                                            patch.count = (c.count ?? 1);
                                                                                            patch.interval = (c.interval ?? 0.15);
                                                                                            patch.loop = !!c.loop;
                                                                                            patch.burstInterval = (c.burstInterval ?? 1.0);
                                                                                            patch.burstsLimit = (c.burstsLimit ?? 0);
                                                                                            patch.clearExisting = !!c.clearExisting;
                                                                                        } else if (type === 'packetStop') {
                                                                                            patch.nodeId = null;
                                                                                            patch.linkId = c.linkId || '__ALL_PACKET__';
                                                                                            patch.delay = c.delay ?? 0;
                                                                                            patch.stopLoopsOnly = !!c.stopLoopsOnly;
                                                                                            patch.clearInFlight = (c.clearInFlight ?? true);
                                                                                        }
                                                                                        patchChildStep(a.id, i, ci, patch);
                                                                                    }}
                                                                                >
                                                                                    {stepTypeOptions
                                                                                        .filter((opt) => opt.value !== 'cameraMove')
                                                                                        .map((opt) => (
                                                                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                                                        ))}
                                                                                </Select>
                                                                            </label>

                                                                            {cIsWire ? (
                                                                                <label>
                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target</div>
                                                                                    <div style={{
                                                                                        fontSize: 12,
                                                                                        opacity: 0.8,
                                                                                        padding: '5px 8px',
                                                                                        borderRadius: 10,
                                                                                        border: '1px solid rgba(255,255,255,0.12)',
                                                                                        background: 'rgba(255,255,255,0.03)',
                                                                                    }}>Global: Wireframe</div>
                                                                                </label>
                                                                            ) : cIsPacket ? (
                                                                                <label>
                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target Link</div>
                                                                                    <Select
                                                                                        value={c.linkId || '__ALL_PACKET__'}
                                                                                        onChange={(e) => patchChildStep(a.id, i, ci, { linkId: e.target.value || '__ALL_PACKET__' })}
                                                                                    >
                                                                                        <option value='__ALL_PACKET__'>(all packet links)</option>
                                                                                        {(links || []).map((lnk) => (
                                                                                            <option key={lnk.id} value={lnk.id}>{linkLabelById?.[lnk.id] || lnk.id}</option>
                                                                                        ))}
                                                                                    </Select>
                                                                                </label>
                                                                            ) : cIsGroupVis ? (
                                                                                <label>
                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target Group</div>
                                                                                    <Select
                                                                                        value={c.groupId || ''}
                                                                                        onChange={(e) => patchChildStep(a.id, i, ci, { groupId: e.target.value || '' })}
                                                                                    >
                                                                                        <option value=''> (none) </option>
                                                                                        <option value='__ALL_GROUP__'>(all groups)</option>
                                                                                        {(groups || []).map((g) => (
                                                                                            <option key={g.id} value={g.id}>{g.name || g.id}</option>
                                                                                        ))}
                                                                                    </Select>
                                                                                </label>
                                                                            ) : cIsRoomVis ? (
                                                                                <label>
                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target Room</div>
                                                                                    <Select
                                                                                        value={c.roomId || ''}
                                                                                        onChange={(e) => patchChildStep(a.id, i, ci, { roomId: e.target.value || '' })}
                                                                                    >
                                                                                        <option value=''> (none) </option>
                                                                                        {rooms.map((r) => (
                                                                                            <option key={r.id} value={r.id}>{r.name || r.id}</option>
                                                                                        ))}
                                                                                    </Select>
                                                                                </label>
                                                                            ) : (
                                                                                <label>
                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Target Node</div>
                                                                                    <Select
                                                                                        value={c.nodeId || ''}
                                                                                        onChange={(e) => patchChildStep(a.id, i, ci, { nodeId: e.target.value || null })}
                                                                                    >
                                                                                        <option value=''> (none) </option>
                                                                                        {nodes.map((n) => (
                                                                                            <option key={n.id} value={n.id}>{n.label}</option>
                                                                                        ))}
                                                                                    </Select>
                                                                                </label>
                                                                            )}

                                                                            <div style={{ display: 'grid', gap: 6 }}
                                                                            >
                                                                                <label>
                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Delay (s)</div>
                                                                                    <SmoothNumberInput
                                                                                        step={0.1}
                                                                                        value={c.delay ?? 0}
                                                                                        onCommit={(v) => patchChildStep(a.id, i, ci, { delay: v })}
                                                                                    />
                                                                                </label>

                                                                                {(cIsRoomVis || cIsGroupVis) && (
                                                                                    <label>
                                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Visibility</div>
                                                                                        <Select
                                                                                            value={c.mode || 'toggle'}
                                                                                            onChange={(e) => patchChildStep(a.id, i, ci, { mode: e.target.value || 'toggle' })}
                                                                                        >
                                                                                            <option value='toggle'>Toggle</option>
                                                                                            <option value='show'>Show</option>
                                                                                            <option value='hide'>Hide</option>
                                                                                        </Select>
                                                                                    </label>
                                                                                )}

                                                                                {cIsPacketSend && (
                                                                                    <div style={{ display: 'grid', gap: 6 }}>
                                                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                                                                            <label>
                                                                                                <div style={{ fontSize: 11, opacity: 0.8 }}>Count</div>
                                                                                                <SmoothNumberInput
                                                                                                    step={1}
                                                                                                    value={c.count ?? 1}
                                                                                                    onCommit={(v) => patchChildStep(a.id, i, ci, { count: Math.max(1, Math.round(Number(v) || 1)) })}
                                                                                                />
                                                                                            </label>
                                                                                            <label>
                                                                                                <div style={{ fontSize: 11, opacity: 0.8 }}>Interval (s)</div>
                                                                                                <SmoothNumberInput
                                                                                                    step={0.05}
                                                                                                    value={c.interval ?? 0.15}
                                                                                                    onCommit={(v) => patchChildStep(a.id, i, ci, { interval: Math.max(0, Number(v) || 0) })}
                                                                                                />
                                                                                            </label>
                                                                                        </div>

                                                                                        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                                            <input
                                                                                                type='checkbox'
                                                                                                checked={!!c.loop}
                                                                                                onChange={(e) => patchChildStep(a.id, i, ci, { loop: e.target.checked })}
                                                                                            />
                                                                                            <span style={{ fontSize: 11, opacity: 0.85 }}>Loop</span>
                                                                                        </label>

                                                                                        {c.loop && (
                                                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                                                                                <label>
                                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Burst Interval (s)</div>
                                                                                                    <SmoothNumberInput
                                                                                                        step={0.1}
                                                                                                        value={c.burstInterval ?? 1.0}
                                                                                                        onCommit={(v) => patchChildStep(a.id, i, ci, { burstInterval: Math.max(0, Number(v) || 0) })}
                                                                                                    />
                                                                                                </label>
                                                                                                <label>
                                                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Bursts Limit (0=∞)</div>
                                                                                                    <SmoothNumberInput
                                                                                                        step={1}
                                                                                                        value={c.burstsLimit ?? 0}
                                                                                                        onCommit={(v) => patchChildStep(a.id, i, ci, { burstsLimit: Math.max(0, Math.round(Number(v) || 0)) })}
                                                                                                    />
                                                                                                </label>
                                                                                            </div>
                                                                                        )}

                                                                                        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                                            <input
                                                                                                type='checkbox'
                                                                                                checked={!!c.clearExisting}
                                                                                                onChange={(e) => patchChildStep(a.id, i, ci, { clearExisting: e.target.checked })}
                                                                                            />
                                                                                            <span style={{ fontSize: 11, opacity: 0.85 }}>Clear existing packets on start</span>
                                                                                        </label>
                                                                                    </div>
                                                                                )}

                                                                                {cIsPacketStop && (
                                                                                    <div style={{ display: 'grid', gap: 6 }}>
                                                                                        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                                            <input
                                                                                                type='checkbox'
                                                                                                checked={!!c.stopLoopsOnly}
                                                                                                onChange={(e) => patchChildStep(a.id, i, ci, { stopLoopsOnly: e.target.checked })}
                                                                                            />
                                                                                            <span style={{ fontSize: 11, opacity: 0.85 }}>Stop loop only (let in-flight finish)</span>
                                                                                        </label>
                                                                                        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                                            <input
                                                                                                type='checkbox'
                                                                                                checked={(c.clearInFlight ?? true) !== false}
                                                                                                onChange={(e) => patchChildStep(a.id, i, ci, { clearInFlight: e.target.checked })}
                                                                                            />
                                                                                            <span style={{ fontSize: 11, opacity: 0.85 }}>Clear in-flight packets</span>
                                                                                        </label>
                                                                                    </div>
                                                                                )}

                                                                                {c.type === 'setSignalStyle' && (
                                                                                    <label>
                                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Value</div>
                                                                                        <Select
                                                                                            value={c.value || 'waves'}
                                                                                            onChange={(e) => patchChildStep(a.id, i, ci, { value: e.target.value })}
                                                                                        >
                                                                                            <option value='waves'>waves</option>
                                                                                            <option value='rays'>rays</option>
                                                                                            <option value='none'>none</option>
                                                                                        </Select>
                                                                                    </label>
                                                                                )}

                                                                                {cIsWire && (
                                                                                    <label>
                                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Wireframe</div>
                                                                                        <Select
                                                                                            value={c.value || 'on'}
                                                                                            onChange={(e) => patchChildStep(a.id, i, ci, { value: e.target.value })}
                                                                                        >
                                                                                            <option value='on'>On</option>
                                                                                            <option value='off'>Off</option>
                                                                                        </Select>
                                                                                    </label>
                                                                                )}

                                                                                {cIsTextBox && (
                                                                                    <label>
                                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Text Box</div>
                                                                                        <Select
                                                                                            value={c.value || 'on'}
                                                                                            onChange={(e) => patchChildStep(a.id, i, ci, { value: e.target.value })}
                                                                                        >
                                                                                            <option value='on'>On</option>
                                                                                            <option value='off'>Off</option>
                                                                                        </Select>
                                                                                    </label>
                                                                                )}
                                                                            </div>

                                                                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}
                                                                            >
                                                                                <IconBtn label="↑" title="Move up" onClick={(e) => { e.preventDefault(); moveChildStep(a.id, i, ci, -1); }} />
                                                                                <IconBtn label="↓" title="Move down" onClick={(e) => { e.preventDefault(); moveChildStep(a.id, i, ci, +1); }} />
                                                                                <IconBtn label="⧉" title="Duplicate sub-step" onClick={(e) => { e.preventDefault(); duplicateChildStep(a.id, i, ci); }} />
                                                                                <IconBtn label="🗑️" title="Delete sub-step" onClick={(e) => { e.preventDefault(); delChildStep(a.id, i, ci); }} />
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}

                                                        <div style={{ marginTop: 8 }}
                                                        >
                                                            <Btn
                                                                onClick={(e) => { e.preventDefault(); addChildStep(a.id, i, { type: 'toggleLight', nodeId: null, delay: 0 }); }}
                                                                style={{ fontSize: 11, padding: '4px 8px' }}
                                                            >
                                                                + Add Sub-step
                                                            </Btn>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}
                                            >
                                                <Btn
                                                    onClick={(e) => { e.preventDefault(); addStep(a.id, { type: 'toggleLight', nodeId: null, delay: 0 }); }}
                                                >
                                                    + Add Step
                                                </Btn>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </Panel>
    );
});





// ---------------- DecksPanel (stable, expandable, counts, add/remove by click) ----------------
const DecksPanelInner = React.memo(function DecksPanelInner({ ctx }) {
    const {
        decks = [],
        rooms = [],
        nodes = [],
        links = [],
        addDeck,
        setDeck,
        deleteDeck,
        setSelected,
        deckAddModeId,
        setDeckAddModeId,
        deckAddLast,
        setDeckAddLast,
        removeRoomFromDeck,
        removeNodeFromDeck,
    } = ctx || {};

    const deckById = useMemo(() => Object.fromEntries(decks.map((d) => [d.id, d])), [decks]);
    const roomById = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms]);

    const perDeck = useMemo(() => {
        const out = {};
        for (const d of decks) {
            const roomList = rooms.filter((r) => r.deckId === d.id);
            const roomIds = new Set(roomList.map((r) => r.id));

            // Nodes inside rooms on this deck are treated as *inherited* membership
            const roomNodes = nodes.filter((n) => roomIds.has(n.roomId));
            const roomNodeIds = new Set(roomNodes.map((n) => n.id));

            // Direct nodes = explicitly assigned to the deck, but NOT already covered by a room on the deck
            const directNodes = nodes.filter((n) => n.deckId === d.id && !roomNodeIds.has(n.id));
            const directNodeIds = new Set(directNodes.map((n) => n.id));

            const inheritedNodes = roomNodes;
            const allNodeIds = new Set([...directNodeIds]);
            for (const n of roomNodes) allNodeIds.add(n.id);

            const internalLinks = links.filter((l) => allNodeIds.has(l.from) && allNodeIds.has(l.to));
            const touchingLinks = links.filter((l) => allNodeIds.has(l.from) || allNodeIds.has(l.to));

            out[d.id] = {
                rooms: roomList,
                directNodes,
                inheritedNodes,
                allNodeIds,
                internalLinksCount: internalLinks.length,
                touchingLinksCount: touchingLinks.length,
            };
        }
        return out;
    }, [decks, rooms, nodes, links]);

    const activeDeck = deckAddModeId ? deckById[deckAddModeId] : null;

    const stopAddMode = useCallback(() => {
        setDeckAddModeId?.(null);
        setDeckAddLast?.("");
    }, [setDeckAddModeId, setDeckAddLast]);

    // Expand/collapse per deck (kept local so it doesn't spam global state)
    const [openById, setOpenById] = React.useState(() => ({}));
    React.useEffect(() => {
        if (deckAddModeId) {
            setOpenById((prev) => ({ ...prev, [deckAddModeId]: true }));
        }
    }, [deckAddModeId]);

    const toggleOpen = React.useCallback((id) => {
        setOpenById((prev) => ({ ...prev, [id]: !prev?.[id] }));
    }, []);

    const deckCardStyle = {
        padding: 10,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
        boxShadow: "0 10px 18px rgba(0,0,0,0.35)",
    };

    const chipStyle = {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(0,0,0,0.18)",
        opacity: 0.95,
        whiteSpace: "nowrap",
    };

    const pillStyle = {
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
        cursor: "pointer",
        userSelect: "none",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    };

    const summarizeNames = React.useCallback((arr, getName, max = 3) => {
        const names = (arr || []).map(getName).filter(Boolean);
        const shown = names.slice(0, max);
        const rest = Math.max(0, names.length - shown.length);
        return { shown, rest, total: names.length };
    }, []);

    return (
        <Panel title="Decks">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                <Btn onClick={addDeck}>+ Add Deck</Btn>
                {activeDeck ? (
                    <div
                        style={{
                            flex: 1,
                            marginLeft: 8,
                            padding: "6px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(56,189,248,0.45)",
                            background: "rgba(56,189,248,0.12)",
                            fontSize: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                        }}
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <div style={{ fontWeight: 800 }}>Adding to: {activeDeck.name}</div>
                            <div style={{ opacity: 0.85 }}>
                                Click any room or node in the scene. Esc cancels.
                                {deckAddLast ? <span style={{ opacity: 0.9 }}> · {deckAddLast}</span> : null}
                            </div>
                        </div>
                        <Btn onClick={stopAddMode}>Done</Btn>
                    </div>
                ) : (
                    <div style={{ opacity: 0.75, fontSize: 12 }}>Tip: Use “Add” on a deck to click-add rooms/nodes.</div>
                )}
            </div>

            {decks.length === 0 ? <div style={{ opacity: 0.8 }}>No decks yet. Click “Add Deck”.</div> : null}

            <div style={{ display: "grid", gap: 10 }}>
                {decks.map((deck) => {
                    const info =
                        perDeck[deck.id] || { rooms: [], directNodes: [], inheritedNodes: [], internalLinksCount: 0, touchingLinksCount: 0 };
                    const isAdding = deckAddModeId === deck.id;
                    const open = !!openById?.[deck.id];

                    const roomsSum = summarizeNames(info.rooms, (r) => r?.name || r?.id, 3);
                    const nodesAll = [...(info.directNodes || []), ...(info.inheritedNodes || [])];
                    const nodesSum = summarizeNames(nodesAll, (n) => n?.label || n?.name || n?.id, 4);

                    const linkLabel = info.internalLinksCount === info.touchingLinksCount
                        ? `${info.internalLinksCount}`
                        : `${info.internalLinksCount} (touch ${info.touchingLinksCount})`;

                    return (
                        <div
                            key={deck.id}
                            style={{
                                ...deckCardStyle,
                                outline: isAdding ? "2px solid rgba(56,189,248,0.65)" : "none",
                            }}
                        >
                            {/* Header (click to expand) */}
                            <div
                                onClick={() => toggleOpen(deck.id)}
                                style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    cursor: "pointer",
                                    userSelect: "none",
                                }}
                                title={open ? "Collapse" : "Expand"}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <div
                                            title="Deck color"
                                            style={{
                                                width: 14,
                                                height: 14,
                                                borderRadius: 4,
                                                background: deck.color || "#2c3959",
                                                border: "1px solid rgba(255,255,255,0.25)",
                                                boxShadow: "0 6px 14px rgba(0,0,0,0.35)",
                                                flex: "0 0 auto",
                                            }}
                                        />
                                        <div
                                            style={{ flex: 1, minWidth: 0 }}
                                            onClick={(e) => e.stopPropagation()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                        >
                                            <SmoothTextInput
                                                value={deck.name || "Deck"}
                                                placeholder="Deck name"
                                                onCommit={(v) => {
                                                    const name = (v || "").trim();
                                                    if (name && name !== deck.name) setDeck(deck.id, { name });
                                                }}
                                                style={{ width: "100%" }}
                                            />
                                        </div>

                                        <div style={{ opacity: 0.8, fontSize: 14, padding: "0 6px" }}>{open ? "▾" : "▸"}</div>
                                    </div>

                                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                                        <span style={chipStyle} title="Rooms on this deck">
                                            🧱 Rooms: <b>{info.rooms.length}</b>
                                        </span>
                                        <span style={chipStyle} title="Nodes on this deck (direct + from rooms)">
                                            ⚙️ Nodes: <b>{info.directNodes.length + info.inheritedNodes.length}</b>
                                            <span style={{ opacity: 0.75 }}>(direct {info.directNodes.length})</span>
                                        </span>
                                        <span style={chipStyle} title="Links between nodes in this deck">
                                            🔗 Links: <b>{linkLabel}</b>
                                        </span>
                                    </div>

                                    {/* Quick preview (better at-a-glance) */}
                                    <div style={{ marginTop: 8, display: "grid", gap: 6, fontSize: 12, opacity: 0.9 }}>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                            <span style={{ opacity: 0.75, fontWeight: 800 }}>Rooms:</span>
                                            {roomsSum.total === 0 ? (
                                                <span style={{ opacity: 0.7 }}>—</span>
                                            ) : (
                                                <>
                                                    {roomsSum.shown.map((nm, i) => (
                                                        <span key={`${deck.id}-rprev-${i}`} style={{ ...pillStyle, cursor: "default" }} title={nm}>
                                                            {nm}
                                                        </span>
                                                    ))}
                                                    {roomsSum.rest ? <span style={{ opacity: 0.75 }}>+{roomsSum.rest} more</span> : null}
                                                </>
                                            )}
                                        </div>

                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                            <span style={{ opacity: 0.75, fontWeight: 800 }}>Nodes:</span>
                                            {nodesSum.total === 0 ? (
                                                <span style={{ opacity: 0.7 }}>—</span>
                                            ) : (
                                                <>
                                                    {nodesSum.shown.map((nm, i) => (
                                                        <span key={`${deck.id}-nprev-${i}`} style={{ ...pillStyle, cursor: "default" }} title={nm}>
                                                            {nm}
                                                        </span>
                                                    ))}
                                                    {nodesSum.rest ? <span style={{ opacity: 0.75 }}>+{nodesSum.rest} more</span> : null}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Header controls */}
                                <div
                                    style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                >
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <Checkbox
                                            checked={deck.visible !== false}
                                            onChange={(v) => setDeck(deck.id, { visible: v })}
                                            label={deck.visible !== false ? "visible" : "hidden"}
                                        />
                                    </div>

                                    <div style={{ display: "flex", gap: 8 }}>
                                        <Btn
                                            onClick={() => {
                                                if (isAdding) {
                                                    setDeckAddModeId(null);
                                                    setDeckAddLast("");
                                                } else {
                                                    setDeckAddModeId(deck.id);
                                                    setDeckAddLast("");
                                                }
                                            }}
                                        >
                                            {isAdding ? "Stop" : "Add"}
                                        </Btn>
                                        <Btn onClick={() => deleteDeck(deck.id)}>Delete</Btn>
                                    </div>
                                </div>
                            </div>

                            {/* Expandable contents */}
                            {open ? (
                                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed rgba(255,255,255,0.14)", display: "grid", gap: 10 }}>
                                    <details open style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,0.18)", padding: 8 }}>
                                        <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 900 }}>
                                            Rooms in this deck ({info.rooms.length})
                                        </summary>
                                        <div style={{ marginTop: 8 }}>
                                            {info.rooms.length === 0 ? (
                                                <div style={{ opacity: 0.7, fontSize: 12 }}>—</div>
                                            ) : (
                                                <div style={{ display: "grid", gap: 6 }}>
                                                    {info.rooms.map((r) => (
                                                        <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                                            <a
                                                                onClick={() => setSelected?.({ type: "room", id: r.id })}
                                                                style={{
                                                                    cursor: "pointer",
                                                                    fontSize: 12,
                                                                    fontWeight: 800,
                                                                    overflow: "hidden",
                                                                    textOverflow: "ellipsis",
                                                                    whiteSpace: "nowrap",
                                                                }}
                                                                title={r.name || r.id}
                                                            >
                                                                {r.name || r.id}
                                                            </a>
                                                            <Btn
                                                                onClick={() => removeRoomFromDeck?.(deck.id, r.id)}
                                                                title="Remove this room (and its nodes) from the deck"
                                                            >
                                                                Remove
                                                            </Btn>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </details>

                                    <details open style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,0.18)", padding: 8 }}>
                                        <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 900 }}>
                                            Nodes in this deck ({info.directNodes.length + info.inheritedNodes.length})
                                            <span style={{ opacity: 0.75, marginLeft: 6 }}>(direct {info.directNodes.length})</span>
                                        </summary>
                                        <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
                                            <div>
                                                <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6, opacity: 0.9 }}>
                                                    Direct nodes ({info.directNodes.length})
                                                </div>
                                                {info.directNodes.length === 0 ? (
                                                    <div style={{ opacity: 0.7, fontSize: 12 }}>—</div>
                                                ) : (
                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        {info.directNodes.map((n) => (
                                                            <div key={n.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                                                <a
                                                                    onClick={() => setSelected?.({ type: "node", id: n.id })}
                                                                    style={{
                                                                        cursor: "pointer",
                                                                        fontSize: 12,
                                                                        fontWeight: 800,
                                                                        overflow: "hidden",
                                                                        textOverflow: "ellipsis",
                                                                        whiteSpace: "nowrap",
                                                                    }}
                                                                    title={n.label || n.name || n.id}
                                                                >
                                                                    {n.label || n.name || n.id}
                                                                </a>
                                                                <Btn onClick={() => removeNodeFromDeck?.(deck.id, n.id)} title="Remove this node from the deck">
                                                                    Remove
                                                                </Btn>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div>
                                                <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6, opacity: 0.9 }}>
                                                    Nodes via rooms ({info.inheritedNodes.length})
                                                </div>
                                                {info.inheritedNodes.length === 0 ? (
                                                    <div style={{ opacity: 0.7, fontSize: 12 }}>—</div>
                                                ) : (
                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        {info.inheritedNodes.map((n) => {
                                                            const r = roomById[n.roomId];
                                                            return (
                                                                <div key={n.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                                                    <a
                                                                        onClick={() => setSelected?.({ type: "node", id: n.id })}
                                                                        style={{
                                                                            cursor: "pointer",
                                                                            fontSize: 12,
                                                                            fontWeight: 800,
                                                                            overflow: "hidden",
                                                                            textOverflow: "ellipsis",
                                                                            whiteSpace: "nowrap",
                                                                        }}
                                                                        title={n.label || n.name || n.id}
                                                                    >
                                                                        {n.label || n.name || n.id}
                                                                    </a>
                                                                    <span
                                                                        style={{ opacity: 0.75, fontSize: 11, whiteSpace: "nowrap" }}
                                                                        title="This node is included because its room is on the deck"
                                                                    >
                                                                        via room: {r?.name || n.roomId}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </details>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </Panel>
    );
});


export default function Interactive3DNodeShowcase() {
    // Model & scene
    const [projectName, setProjectName] = useState("Showcase");
    const [modelDescriptor, setModelDescriptor] = useState(null);
    const [modelBlob, setModelBlob] = useState(null);
    const [modelFilename, setModelFilename] = useState("");
    const [modelBounds, setModelBounds] = useState(null);
    const modelRef = useRef();
    const [wireReveal, setWireReveal] = useState({ enabled:false, mode:"lr", duration:1.0, feather:0.08 });
    const [revealOpen, setRevealOpen] = useState(false);
    const [moreOpen, setMoreOpen]   = useState(false);

    // ------------------------------------------------------------
    // Picture overlays (GA importing / floorplan ref)
    // Stored in localStorage and automatically included in project export
    // via the existing epic3d.* prefs exporter.
    // ------------------------------------------------------------
    const PICTURES_KEY = "epic3d.importedPictures.v1";
    const [importedPictures, setImportedPictures] = useState(() => {
        try {
            const raw = localStorage.getItem(PICTURES_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    });


    // ------------------------------------------------------------
    // Picture "Deck" collisions (Solid pictures)
    // If a picture is Visible + Solid, nodes/rooms cannot go below its plane
    // when overlapping its XZ footprint.
    // Hidden pictures are ignored.
    // ------------------------------------------------------------
    const pointInOBB2D = (x, z, obb) => {
        const dx = x - obb.cx;
        const dz = z - obb.cz;
        const c = Math.cos(obb.angle);
        const s = Math.sin(obb.angle);
        // inverse rotate by angle
        const lx = dx * c + dz * s;
        const lz = -dx * s + dz * c;
        return Math.abs(lx) <= obb.hx && Math.abs(lz) <= obb.hz;
    };

    const obbOverlap2D = (a, b) => {
        // a,b: {cx,cz,hx,hz,angle}
        const uA = [Math.cos(a.angle), Math.sin(a.angle)];
        const vA = [-Math.sin(a.angle), Math.cos(a.angle)];
        const uB = [Math.cos(b.angle), Math.sin(b.angle)];
        const vB = [-Math.sin(b.angle), Math.cos(b.angle)];
        const axes = [uA, vA, uB, vB];

        for (const axis of axes) {
            const ax = axis[0];
            const az = axis[1];

            const cA = a.cx * ax + a.cz * az;
            const cB = b.cx * ax + b.cz * az;

            const rA =
                a.hx * Math.abs(uA[0] * ax + uA[1] * az) +
                a.hz * Math.abs(vA[0] * ax + vA[1] * az);
            const rB =
                b.hx * Math.abs(uB[0] * ax + uB[1] * az) +
                b.hz * Math.abs(vB[0] * ax + vB[1] * az);

            if (Math.abs(cA - cB) > rA + rB) return false;
        }
        return true;
    };

    const getNodeHalfHeight = (node) => {
        const sh = node?.shape || {};
        if (sh.type === "sphere") {
            const r = Number(sh.radius);
            return Number.isFinite(r) && r > 0 ? r : 0.28;
        }
        if (Number.isFinite(sh.h)) {
            return Math.max(0.01, Number(sh.h) / 2);
        }
        // fallback
        return 0.28;
    };

    const clampNodeToPictureDecks = useCallback(
        (node, pos) => {
            const p = Array.isArray(pos)
                ? [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0]
                : (pos?.toArray ? pos.toArray() : [pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0]);

            const pics = (Array.isArray(importedPictures) ? importedPictures : []).filter(
                (pic) => pic && pic.src && pic.visible && pic.solid,
            );
            if (!pics.length) return p;

            const hh = getNodeHalfHeight(node);
            let [x, y, z] = p;
            let minY = -Infinity;

            for (const pic of pics) {
                const s = clamp(Number(pic.scale) || 1, 0.01, 500);
                const w = FLOORPLAN_BASE_SIZE * s;
                const aspect = Number.isFinite(pic.aspect) && pic.aspect > 0 ? pic.aspect : 1;
                const h = w * aspect;
                const obb = {
                    cx: Number(pic.x) || 0,
                    cz: Number(pic.z) || 0,
                    hx: w / 2,
                    hz: h / 2,
                    angle: THREE.MathUtils.degToRad(Number(pic.rotY) || 0),
                };

                if (!pointInOBB2D(x, z, obb)) continue;

                const deckY = Number(pic.y) || 0;
                minY = Math.max(minY, deckY + hh);
            }

            if (Number.isFinite(minY) && minY !== -Infinity && y < minY) y = minY;
            return [x, y, z];
        },
        [importedPictures],
    );

    const clampRoomToPictureDecks = useCallback(
        (room, centerPos) => {
            const c = Array.isArray(centerPos)
                ? [centerPos[0] ?? 0, centerPos[1] ?? 0, centerPos[2] ?? 0]
                : (centerPos?.toArray ? centerPos.toArray() : [centerPos?.x ?? 0, centerPos?.y ?? 0, centerPos?.z ?? 0]);

            const pics = (Array.isArray(importedPictures) ? importedPictures : []).filter(
                (pic) => pic && pic.src && pic.visible && pic.solid,
            );
            if (!pics.length) return c;

            const size = room?.size || [1, 1, 1];
            const hy = (Number(size[1]) || 1) / 2;

            const roomObb = {
                cx: c[0],
                cz: c[2],
                hx: (Number(size[0]) || 1) / 2,
                hz: (Number(size[2]) || 1) / 2,
                angle: Number(room?.rotation?.[1]) || 0,
            };

            let y = c[1];
            let minCenterY = -Infinity;

            for (const pic of pics) {
                const s = clamp(Number(pic.scale) || 1, 0.01, 500);
                const w = FLOORPLAN_BASE_SIZE * s;
                const aspect = Number.isFinite(pic.aspect) && pic.aspect > 0 ? pic.aspect : 1;
                const h = w * aspect;
                const picObb = {
                    cx: Number(pic.x) || 0,
                    cz: Number(pic.z) || 0,
                    hx: w / 2,
                    hz: h / 2,
                    angle: THREE.MathUtils.degToRad(Number(pic.rotY) || 0),
                };

                if (!obbOverlap2D(roomObb, picObb)) continue;
                const deckY = Number(pic.y) || 0;
                minCenterY = Math.max(minCenterY, deckY + hy);
            }

            if (Number.isFinite(minCenterY) && minCenterY !== -Infinity && y < minCenterY) y = minCenterY;
            return [c[0], y, c[2]];
        },
        [importedPictures],
    );

    useEffect(() => {
        try {
            localStorage.setItem(PICTURES_KEY, JSON.stringify(importedPictures || []));
        } catch {}
    }, [importedPictures]);

    // One-time normalization for older saved payloads
    // v2 schema adds: x,z,solid,aspect
    useEffect(() => {

        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            return list.map((p) => {let localKey =
                p?.localKey ||
                p?.local_picture_key ||
                p?.localPictureKey ||
                p?.localKeyPath ||
                null;

                const srcStr = typeof p?.src === "string" ? p.src : "";
                const derivedKey = normalizePictureKey(localKey || srcStr);
                if (!localKey && derivedKey) localKey = derivedKey;
                if (localKey) localKey = normalizePictureKey(localKey) || localKey;

                let src = srcStr;

// Raw Windows filesystem paths can never be loaded by the browser. If we can't map them to a bundled
// local picture, treat them as invalid so the scene doesn't silently "render nothing".
                const srcLooksWindows = isProbablyWindowsPath(srcStr);

                if (localKey) {
                    const resolved = resolveLocalPictureSrc(localKey);
                    if (resolved) src = resolved;
                    else if (srcLooksWindows) src = "";
                } else if (srcLooksWindows) {
                    src = "";
                }

                // Guard against empty/broken data URLs that would crash drei's useTexture
                const validSrc = isValidPictureSrc(src);

                return {
                    ...p,
                    localKey: localKey || undefined,
                    src: validSrc ? src : "",
                    // default to visible ON unless explicitly false, but never render invalid sources
                    visible: validSrc ? (p?.visible !== false) : false,
                    solid: !!p?.solid,
                    aspect: Number.isFinite(p?.aspect) && p.aspect > 0 ? p.aspect : 1,
                    scale: Number(p?.scale) || 1,
                    rotX: Number(p?.rotX) || 0,
                    rotY: Number(p?.rotY) || 0,
                    rotZ: Number(p?.rotZ) || 0,
                    // picture position is now real XYZ; older saves only had y
                    x: Number(p?.x) || 0,
                    y: Number(p?.y) || 0.01,
                    z: Number(p?.z) || 0,
                    opacity: p?.opacity !== undefined ? p.opacity : 1,
                };
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const picturesInputRef = useRef(null);
    const [picturesOpen, setPicturesOpen] = useState(false);

    const [picturesTab, setPicturesTab] = useState("placed"); // "placed" | "local"
    const [picturesSearch, setPicturesSearch] = useState("");
    const [localPicturesSearch, setLocalPicturesSearch] = useState("");
    const localPictures = useMemo(() => LOCAL_PICTURES, []);

    // Refs to picture meshes in the scene (used by TransformControls for gizmo movement)
    const pictureRefs = useRef({}); // { [pictureId]: React.RefObject<THREE.Mesh> }

    // Copy/Paste picture transforms
    const pictureValuesClipboardRef = useRef(null);
    // bump this state to re-render when clipboard updates (ref changes don't)
    const [, setPictureClipboardTick] = useState(0);

    const readFileAsDataURL = useCallback((file) => {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result || ""));
            fr.onerror = () => reject(fr.error || new Error("Failed to read file"));
            fr.readAsDataURL(file);
        });
    }, []);


    const importPicturesFromFiles = useCallback(async (files, extra) => {
        const arr = Array.from(files || []).filter(Boolean);
        if (!arr.length) return;

        // Read in parallel; keep order.
        const urls = await Promise.all(
            arr.map((f) => readFileAsDataURL(f).catch(() => null)),
        );

        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const next = list.map((p) => ({
                ...p,
                // keep existing state; just normalize
                visible: p?.visible !== false,
                solid: !!p?.solid,
                aspect: Number.isFinite(p?.aspect) && p.aspect > 0 ? p.aspect : 1,
                scale: Number(p?.scale) || 1,
                rotX: Number(p?.rotX) || 0,
                rotY: Number(p?.rotY) || 0,
                rotZ: Number(p?.rotZ) || 0,
                x: Number(p?.x) || 0,
                y: Number(p?.y) || 0.01,
                z: Number(p?.z) || 0,
            }));

            urls.forEach((src, i) => {
                if (!src) return;
                next.push({
                    id: uuid(),
                    name: arr[i]?.name || `Picture ${next.length + 1}`,
                    src,
                    visible: true,
                    // optional polygon footprint for future polygon room rendering
                    poly: Array.isArray(extra?.poly) ? extra.poly : undefined,
                    drawMode: extra?.drawMode || undefined,  // default ON
                    solid: false,
                    aspect: 1,
                    scale: 1,
                    x: 0,
                    y: 0.01,
                    z: 0,
                    rotX: 0,
                    rotY: 0,
                    rotZ: 0,
                });
            });

            return next;
        });
    }, [readFileAsDataURL]);




    const addLocalPicture = useCallback(async (entry) => {
        const localKeyRaw = entry?.key || entry?.path || entry?.name || "";
        const localKey = normalizePictureKey(localKeyRaw) || localKeyRaw || "";
        const resolved = (localKey && resolveLocalPictureSrc(localKey)) || entry?.src || "";
        const rawSrc = typeof resolved === "string" ? resolved : "";

        if (!isValidPictureSrc(rawSrc)) {
            // eslint-disable-next-line no-console
            console.warn("Local picture has invalid src; not adding.", entry);
            return;
        }

        // Resolve to a working URL (tries /static, /NodeForge/static, etc.)
        const best = await resolveWorkingPictureSrc(rawSrc);
        const src = isValidPictureSrc(best) ? best : rawSrc;

        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            return [
                ...list,
                {
                    id: uuid(),
                    name:
                        entry?.name ||
                        (localKey ? String(localKey).split("/").pop() : "") ||
                        `Picture ${list.length + 1}`,
                    src,
                    localKey: localKey || undefined,
                    visible: true,
                    solid: false,
                    aspect: 1,
                    scale: 1,
                    x: 0,
                    y: 0.01,
                    z: 0,
                    rotX: 0,
                    rotY: 0,
                    rotZ: 0,
                    opacity: 1,
                },
            ];
        });
    }, [setImportedPictures]);



    const setPictureVisible = useCallback((id, visible) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (!id) return list;
            return list.map((p) => (p.id === id ? { ...p, visible: !!visible } : p));
        });
    }, []);

    const setPictureSolid = useCallback((id, solid) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (!id) return list;
            return list.map((p) => (p.id === id ? { ...p, solid: !!solid } : p));
        });
    }, []);

    // patch: {x?,y?,z?}
    const setPicturePosition = useCallback((id, patch) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (!id) return list;
            return list.map((p) => {
                if (p.id !== id) return p;
                const nx = patch?.x !== undefined ? clamp(Number(patch.x) || 0, -5000, 5000) : (Number(p.x) || 0);
                const ny = patch?.y !== undefined ? clamp(Number(patch.y) || 0, -500, 500) : (Number(p.y) || 0.01);
                const nz = patch?.z !== undefined ? clamp(Number(patch.z) || 0, -5000, 5000) : (Number(p.z) || 0);
                return { ...p, x: nx, y: ny, z: nz };
            });
        });
    }, []);

    const setPictureAspect = useCallback((id, aspect) => {
        const a = Number(aspect);
        if (!id || !Number.isFinite(a) || a <= 0) return;
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            return list.map((p) => (p.id === id ? { ...p, aspect: a } : p));
        });
    }, []);


    const setPictureScale = useCallback((id, scale) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const s = clamp(Number(scale) || 1, 0.01, 500);
            return list.map((p) => (p.id === id ? { ...p, scale: s } : p));
        });
    }, []);
    const setPictureOpacity = useCallback((id, opacity) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (!id) return list;
            const o = Number(opacity);
            const oo = Number.isFinite(o) ? clamp(o, 0, 1) : 1;
            return list.map((p) => (p.id === id ? { ...p, opacity: oo } : p));
        });
    }, []);
    const setPictureRotation = useCallback((id, patch) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const clampDeg = (v) => clamp(Number(v) || 0, -360, 360);
            return list.map((p) => {
                if (p.id !== id) return p;
                const nx = patch?.rotX !== undefined ? clampDeg(patch.rotX) : (Number(p.rotX) || 0);
                const ny = patch?.rotY !== undefined ? clampDeg(patch.rotY) : (Number(p.rotY) || 0);
                const nz = patch?.rotZ !== undefined ? clampDeg(patch.rotZ) : (Number(p.rotZ) || 0);
                return { ...p, rotX: nx, rotY: ny, rotZ: nz };
            });
        });
    }, []);

    const setPictureY = useCallback((id, y) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const yy = clamp(Number(y) || 0, -50, 50);
            return list.map((p) => (p.id === id ? { ...p, y: yy } : p));
        });
    }, []);

    const deletePicture = useCallback((id) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            return list.filter((p) => p.id !== id);
        });
    }, []);
    const H = 28; // unified control height for consistent bar sizing
    const [modelVisible, setModelVisible] = useState(true);
    const [currentModelId, setCurrentModelId] = useState(localStorage.getItem("epic3d.static.current") || (STATIC_MODELS[0]?.id || ""));
    const [productsOpen, setProductsOpen] = useState(false);
    const [productScale, setProductScale] = useState(() => Number(localStorage.getItem("epic3d.productScale.v1") || 1));
    const [showDimsGlobal, setShowDimsGlobal] = useState(() => localStorage.getItem("epic3d.showDimsGlobal.v1") === "1");
    const [photoDefault, setPhotoDefault] = useState(() => localStorage.getItem("epic3d.photoDefault.v1") !== "0");
    const [productUnits, setProductUnits] = useState(() => localStorage.getItem("epic3d.productUnits.v1") || "cm");
    const [alwaysShow3DInfo, setAlwaysShow3DInfo] = useState(
        () => localStorage.getItem("epic3d.alwaysShow3DInfo.v1") === "1"
    );
    useEffect(() => {
        localStorage.setItem("epic3d.alwaysShow3DInfo.v1", alwaysShow3DInfo ? "1" : "0");
    }, [alwaysShow3DInfo]);
    const [wireStroke, setWireStroke] = useState({
        enabled: true,
        mode: "lr",         // "lr" | "rl" | "tb" | "bt"
        duration: 1.2,      // seconds; used for both in/out unless you add separate sliders
        feather: 0.08,      // line head softness
        surfaceFeather: 0.08
    });

// near other model-related state
    const [modelScale, setModelScale] = useState(
        () => Number(localStorage.getItem("epic3d.modelScale.v1") || 1)
    );
    useEffect(() => {
        localStorage.setItem("epic3d.modelScale.v1", String(modelScale));
    }, [modelScale]);

    const [modelPosition, setModelPosition] = useState(() => {
        if (typeof window === "undefined") return [0, 0, 0];
        try {
            const raw = window.localStorage.getItem("epic3d.modelPosition.v1");
            if (raw) {
                const v = JSON.parse(raw);
                if (Array.isArray(v) && v.length >= 3) {
                    return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
                }
            }
        } catch {}
        return [0, 0, 0];
    });
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem("epic3d.modelPosition.v1", JSON.stringify(modelPosition));
        } catch {}
    }, [modelPosition]);

    useEffect(() => localStorage.setItem("epic3d.productScale.v1", String(productScale)), [productScale]);
    useEffect(() => localStorage.setItem("epic3d.showDimsGlobal.v1", showDimsGlobal ? "1" : "0"), [showDimsGlobal]);
    useEffect(() => localStorage.setItem("epic3d.photoDefault.v1", photoDefault ? "1" : "0"), [photoDefault]);
    useEffect(() => localStorage.setItem("epic3d.productUnits.v1", productUnits), [productUnits]);
    // Entities
    const [rooms, setRooms] = useState(() => {
        const saved = localStorage.getItem("epic3d.rooms.v7");
        if (saved) return JSON.parse(saved);
        return [
            {
                id: uuid(),
                name: "Room A",
                center: [0, 0.6, 0],
                size: [4, 1.6, 3],
                color: "#274064",
                visible: true,
                // optional polygon footprint for future polygon room rendering
                poly: undefined,
                drawMode: undefined,
                rotation: [0, 0, 0],
                locked: false,
            },
            {
                id: uuid(),
                name: "Room B",
                center: [5, 0.6, 0],
                size: [3, 1.6, 2.2],
                color: "#3a3359",
                visible: true,
                // optional polygon footprint for future polygon room rendering
                poly: undefined,
                drawMode: undefined,
                rotation: [0, 0, 0],
                locked: false,
            },
        ];
    });


    // Clamp node motion within its parent room bounds (optional per-room setting)
    const clampNodeToRoomBounds = useCallback(
        (node, pos) => {
            const p = Array.isArray(pos)
                ? [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0]
                : (pos?.toArray ? pos.toArray() : [pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0]);

            if (!node?.roomId) return p;

            const room = rooms.find((r) => r.id === node.roomId);
            if (!room) return p;

            // IMPORTANT: never return undefined
            if (room.locked) return p;

            const cfg = room.nodeBounds || {};
            if (!cfg.enabled) return p;

            const shape = cfg.shape || "box";

            // numeric + safe padding
            const padding = Number(cfg.padding ?? 0) || 0;

            const center = room.center || [0, 0, 0];
            const roomSize = room.size || [3, 1.6, 2.2];

            const [cx, cy, cz] = center;
            const [rw, rh, rd] = roomSize;

            // Use configured bounds if present, otherwise fall back to room size
            const width  = Number.isFinite(cfg.width)  ? cfg.width  : rw;
            const height = Number.isFinite(cfg.height) ? cfg.height : rh;
            const depth  = Number.isFinite(cfg.depth)  ? cfg.depth  : rd;

            // Inner (playable) box, shrunk by padding on all sides
            const innerW = Math.max(0, width  - padding * 2);
            const innerH = Math.max(0, height - padding * 2);
            const innerD = Math.max(0, depth  - padding * 2);

            let [x, y, z] = p;

            // Degenerate – just stick to center in XZ, clamp Y to room height
            if (innerW <= 0 || innerD <= 0 || innerH <= 0) {
                const minY0 = cy - rh / 2;
                const maxY0 = cy + rh / 2;
                const yClamped = Math.max(minY0, Math.min(maxY0, y));
                return [cx, yClamped, cz];
            }

            // Clamp Y inside the inner height volume
            const minY = cy - innerH / 2;
            const maxY = cy + innerH / 2;
            y = Math.max(minY, Math.min(maxY, y));

            if (shape === "circle") {
                // Circle in XZ with optional custom radius
                let radius = Number(cfg.radius);
                if (!Number.isFinite(radius) || radius <= 0) {
                    radius = Math.min(innerW, innerD) / 2;
                }
                if (radius <= 0) return [cx, y, cz];

                const dx = x - cx;
                const dz = z - cz;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > radius && dist > 1e-4) {
                    const k = radius / dist;
                    x = cx + dx * k;
                    z = cz + dz * k;
                }
            } else {
                // Box in XZ
                const minX = cx - innerW / 2;
                const maxX = cx + innerW / 2;
                const minZ = cz - innerD / 2;
                const maxZ = cz + innerD / 2;
                x = Math.max(minX, Math.min(maxX, x));
                z = Math.max(minZ, Math.min(maxZ, z));
            }

            return [x, y, z];
        },
        [rooms]
    );


    // ------------------------------------------------------------
    // Room snapping (optional): when moving rooms near each other,
    // edges can snap together within a configurable distance.
    // ------------------------------------------------------------
    const [snapRoomsEnabled, setSnapRoomsEnabled] = useState(() => {
        try { return localStorage.getItem("epic3d.snapRooms.enabled.v1") === "1"; } catch { return false; }
    });
    const [snapRoomsDistance, setSnapRoomsDistance] = useState(() => {
        try {
            const v = Number(localStorage.getItem("epic3d.snapRooms.distance.v1") || 0.5);
            return Number.isFinite(v) && v > 0 ? v : 0.5;
        } catch {
            return 0.5;
        }
    });
    useEffect(() => {
        try { localStorage.setItem("epic3d.snapRooms.enabled.v1", snapRoomsEnabled ? "1" : "0"); } catch {}
    }, [snapRoomsEnabled]);
    useEffect(() => {
        const v = Math.max(0.01, Number(snapRoomsDistance) || 0.5);
        try { localStorage.setItem("epic3d.snapRooms.distance.v1", String(v)); } catch {}
    }, [snapRoomsDistance]);

// Global Shadows (persist)
    const [shadowsOn, setShadowsOn] = useState(
        () => localStorage.getItem("epic3d.shadowsOn.v1") !== "0"
    );
    useEffect(() => {
        try { localStorage.setItem("epic3d.shadowsOn.v1", shadowsOn ? "1" : "0"); } catch {}
    }, [shadowsOn]);
// Force-remount HUD when we import a scene so it reloads layout/styles from localStorage
    const [hudVersion, setHudVersion] = useState(0);

    const [nodes, setNodes] = useState(() => {
        const saved = localStorage.getItem("epic3d.nodes.v7");
        if (saved) return JSON.parse(saved);
        return [
            {
                id: uuid(),
                kind: "node",
                label: "Sender A",
                position: [-1, 0.4, 0],
                rotation: [0,0,0],
                role: "sender",
                cluster: "AV",
                color: "#54eec8",
                glowOn: true,
                glow: 0.6,
                shape: { type: "sphere", radius: 0.32 },
                light: { type: "none", enabled: false },
                anim: { spin: true, spinY: 0.6 },
                signal: { style: "waves", speed: 1, size: 1 },
            },
            {
                id: uuid(),
                kind: "node",
                label: "Light 01",
                position: [0.5, 0.5, 0.5],
                rotation: [0,0,0],
                role: "receiver",
                cluster: "Lights",
                color: "#fff3a1",
                glowOn: false,
                glow: 0.2,
                shape: { type: "cone", radius: 0.28, height: 0.6 },
                light: { type: "spot", enabled: false, intensity: 300, distance: 10, yaw: 0, pitch: -25, showBounds: false, color: "#ffffff", angle: 0.6, penumbra: 0.35 },
                anim: { bob: true, bobAmp: 0.2, bobSpeed: 1 },
                signal: { style: "rays", speed: 1, size: 1 },
            },
            {
                id: uuid(),
                kind: "node",
                label: "Receiver B",
                position: [1.1, 0.4, -0.4],
                rotation: [0,0,0],
                role: "receiver",
                cluster: "Network",
                color: "#7fbaff",
                glowOn: false,
                glow: 0.3,
                shape: { type: "box", scale: [0.5, 0.5, 0.5] },
                light: { type: "none", enabled: false },
                anim: {},
                signal: { style: "waves", speed: 0.8, size: 0.8 },
            },
            {
                id: uuid(),
                kind: "switch",
                label: "Switch A",
                position: [-0.2, 0.35, 1.0],
                rotation: [0,0,0],
                role: "bidir",
                cluster: "Network",
                color: "#9bd0ff",
                glowOn: true,
                glow: 0.4,
                shape: { type: "switch", w: 1.1, h: 0.12, d: 0.35 },
                light: { type: "none", enabled: false },
                switch: {
                    buttonsCount: 2,
                    physical: false,
                    physicalHeight: 0.028,
                    margin: 0.03,
                    gap: 0.02,
                    pressDepth: 0.014,
                    pressAnimMs: 160,
                    pressHoldMs: 60,
                    pressMs: 140,
                    textColor: "#e2e8f0",
                    textScale: 1,
                    textRotationDeg: 0,
                    textAlign: "center",
                    textOffset: { x: 0, y: 0 },
                    backlight: {
                        enabled: false,
                        color: "#00b7ff",
                        pressedColor: "#00b7ff",
                        intensity: 1.6,
                        opacity: 0.35,
                        padding: 0.012,
                    },
                    textGlow: {
                        enabled: false,
                        color: "#ffffff",
                        pressedColor: "#ffffff",
                        intensity: 1,
                        outlineWidth: 0.02,
                        outlineOpacity: 0.8,
                    },
                    buttonColor: "#22314d",
                    pressedColor: "#101a2d",
                    hoverEmissive: "#ffffff",
                    buttons: [
                        { name: "On", actionIds: [] },
                        { name: "Off", actionIds: [] },
                    ],
                },
                anim: {},
                signal: { style: "rays", speed: 1.2, size: 1 },
            },
        ];
    });

    const [links, setLinks] = useState(() => {
        const saved = localStorage.getItem("epic3d.links.v7");
        return saved ? JSON.parse(saved) : [];
    });

// --- Decks ---
    const [decks, setDecks] = useState(() => {
        try {
            const saved = localStorage.getItem("epic3d.decks.v1");
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    // --- Groups (rooms + nodes) ---
    const [groups, setGroups] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem("epic3d.groups.v1") || "[]");
        } catch {
            return [];
        }
    });
    useEffect(() => {
        try { localStorage.setItem("epic3d.groups.v1", JSON.stringify(groups)); } catch {}
    }, [groups]);

    // When active, clicking nodes/rooms toggles membership to this group id
    const [groupAddModeId, setGroupAddModeId] = useState(null);

    // When active, clicking a room or node in the scene adds it to this deck
    const [deckAddModeId, setDeckAddModeId] = useState(null);
    const [deckAddLast, setDeckAddLast] = useState("");

    useEffect(() => {
        if (!deckAddModeId) return;
        const onKey = (e) => {
            if (e.key === "Escape") {
                setDeckAddModeId(null);
                setDeckAddLast("");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [deckAddModeId]);


// --- Group helpers & filtering ---
    const groupById = useMemo(() => Object.fromEntries(groups.map(g => [g.id, g])), [groups]);
    const isGroupHidden = useCallback((gid) => !!gid && !!groupById[gid]?.hidden, [groupById]);

    const renderRooms = useMemo(() => rooms.filter(r => !isGroupHidden(r.groupId)), [rooms, isGroupHidden]);
    const renderNodes = useMemo(() => nodes.filter(n => !isGroupHidden(n.groupId)), [nodes, isGroupHidden]);
    const renderNodeIds = useMemo(() => new Set(renderNodes.map(n => n.id)), [renderNodes]);
    const renderLinks = useMemo(() => links.filter(l => renderNodeIds.has(l.from) && renderNodeIds.has(l.to)), [links, renderNodeIds]);

    const getGroupMembers = useCallback((gid) => {
        const gRooms = rooms.filter(r => r.groupId === gid);
        const gNodes = nodes.filter(n => n.groupId === gid);
        return { gRooms, gNodes };
    }, [rooms, nodes]);

    const toggleEntityGroup = useCallback((type, id, groupId) => {
        if (!groupId) return;
        if (type === "node") {
            setNodes(prev => prev.map(n => n.id === id ? { ...n, groupId: n.groupId === groupId ? null : groupId } : n));
        } else if (type === "room") {
            setRooms(prev => prev.map(r => r.id === id ? { ...r, groupId: r.groupId === groupId ? null : groupId } : r));
        }
    }, []);

    const setGroupHidden = useCallback((gid, hidden) => {
        setGroups(prev => prev.map(g => g.id === gid ? { ...g, hidden } : g));
        if (hidden) {
            // clear selection that falls within the group
            setSelected(sel => {
                if (!sel) return sel;
                if (sel.type === "node") {
                    const n = nodes.find(x => x.id === sel.id);
                    return n?.groupId === gid ? null : sel;
                }
                if (sel.type === "room") {
                    const r = rooms.find(x => x.id === sel.id);
                    return r?.groupId === gid ? null : sel;
                }
                return sel;
            });
            setMultiSel(prev => prev.filter(it => {
                if (it.type === "node") return nodes.find(n => n.id === it.id)?.groupId !== gid;
                if (it.type === "room") return rooms.find(r => r.id === it.id)?.groupId !== gid;
                return true;
            }));
        }
    }, [nodes, rooms]);

    // --- Group CRUD helpers (used by Groups – Members panel) ---
    const renameGroup = useCallback((gid, name) => {
        if (!gid) return;
        keepLeftScroll(() => {
            setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, name } : g)));
        });
    }, []);

    const deleteGroup = useCallback((gid) => {
        if (!gid) return;
        keepLeftScroll(() => {
            // Remove group record
            setGroups((prev) => prev.filter((g) => g.id !== gid));
            // Ungroup rooms/nodes that were in this group
            setRooms((prev) => prev.map((r) => (r.groupId === gid ? { ...r, groupId: null } : r)));
            setNodes((prev) => prev.map((n) => (n.groupId === gid ? { ...n, groupId: null } : n)));
            // Exit add-mode if it was pointing to this group
            setGroupAddModeId((cur) => (cur === gid ? null : cur));
            // Clear selection/multisel that was in this group (best-effort)
            setSelected((sel) => {
                if (!sel) return sel;
                if (sel.type === "node") {
                    const n = nodes.find((x) => x.id === sel.id);
                    return n?.groupId === gid ? null : sel;
                }
                if (sel.type === "room") {
                    const r = rooms.find((x) => x.id === sel.id);
                    return r?.groupId === gid ? null : sel;
                }
                return sel;
            });
            setMultiSel((prev) =>
                (prev || []).filter((it) => {
                    if (it.type === "node") return nodes.find((n) => n.id === it.id)?.groupId !== gid;
                    if (it.type === "room") return rooms.find((r) => r.id === it.id)?.groupId !== gid;
                    return true;
                })
            );
        });
    }, [nodes, rooms]);

    const removeRoomFromGroup = useCallback((gid, roomId, opts = {}) => {
        if (!roomId) return;
        const removeNodesInRoom = opts.removeNodesInRoom !== false;
        keepLeftScroll(() => {
            setRooms((prev) => prev.map((r) => (r.id === roomId && (!gid || r.groupId === gid) ? { ...r, groupId: null } : r)));
            if (removeNodesInRoom) {
                setNodes((prev) =>
                    prev.map((n) => (n.roomId === roomId && (!gid || n.groupId === gid) ? { ...n, groupId: null } : n))
                );
            }
        });
    }, []);

    const removeNodeFromGroup = useCallback((nodeId) => {
        if (!nodeId) return;
        keepLeftScroll(() => {
            setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, groupId: null } : n)));
        });
    }, []);


    const moveGroup = useCallback((gid) => {
        const { gRooms, gNodes } = getGroupMembers(gid);
        const items = [
            ...gRooms.map(r => ({ type: "room", id: r.id })),
            ...gNodes.map(n => ({ type: "node", id: n.id })),
        ];
        if (!items.length) return;
        setMode("select");
        setLinkFromId(null);
        setMoveMode(true);
        setTransformMode("translate");
        setMultiSel(items);
        setSelected(items[0]);
    }, [getGroupMembers]);
    const moveRoomPack = useCallback((roomId) => {
        const r = rooms.find((x) => x.id === roomId);
        if (!r) return;

        const roomNodes = nodes.filter((n) => n.roomId === roomId);

        const items = [
            { type: "room", id: roomId },
            ...roomNodes.map((n) => ({ type: "node", id: n.id })),
        ];

        if (!items.length) return;

        setMode("select");
        setLinkFromId(null);
        setMoveMode(true);
        setTransformMode("translate");

        // Clear any rotate-pivot override
        setMultiPivotOverride(null);

        // ✅ Treat it as multi-select
        setSelectionMode("multi");

        setMultiSel(items);
        setSelected(items[0] || null);
    }, [rooms, nodes]);

    const rotateRoomPack = useCallback((roomId) => {
        const r = rooms.find((x) => x.id === roomId);
        if (!r) return;
        if (r.locked) return;

        const roomNodes = nodes.filter((n) => n.roomId === roomId);

        const items = [
            { type: 'room', id: roomId },
            ...roomNodes.map((n) => ({ type: 'node', id: n.id })),
        ];

        if (!items.length) return;

        setMode('select');
        setLinkFromId(null);
        setMoveMode(true);
        setTransformMode('rotate');

        // ✅ Treat it as multi-select
        setSelectionMode('multi');
        setMultiSel(items);
        setSelected(items[0] || null);

        // Pivot at the room center so rotate-all spins around the room
        const c = r.center || [0, 0, 0];
        setMultiPivotOverride({ pos: [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0], reason: 'room-pack', roomId });
    }, [rooms, nodes]);

    const scaleRoomWithContents = useCallback((roomId) => {
        const r = rooms.find((x) => x.id === roomId);
        if (!r) return;
        if (r.locked) return;

        setMode('select');
        setLinkFromId(null);
        setMoveMode(true);
        setTransformMode('scale');

        // Scale is a single-room operation (the scene handles scaling its contents as a pack)
        setSelectionMode('single');
        setMultiSel([]);
        setSelected({ type: 'room', id: roomId });

        // No pivot override needed for scale
        setMultiPivotOverride(null);
    }, [rooms]);


    const duplicateGroup = useCallback((gid) => {
        const srcGroup = groups.find(g => g.id === gid);
        const { gRooms, gNodes } = getGroupMembers(gid);
        const nodeIdMap = new Map();
        const roomIdMap = new Map();

        // Compute bounds in XZ to offset copy safely
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        const roomHalfSize = (r) => {
            const s = r.size || r.dims || r.dimensions || [2, 2, 2];
            return [Math.abs(s[0] || 0)/2, Math.abs(s[2] || 0)/2];
        };
        gRooms.forEach(r => {
            const c = r.center || [0,0,0];
            const [hx, hz] = roomHalfSize(r);
            minX = Math.min(minX, c[0]-hx); maxX = Math.max(maxX, c[0]+hx);
            minZ = Math.min(minZ, c[2]-hz); maxZ = Math.max(maxZ, c[2]+hz);
        });
        gNodes.forEach(n => {
            const p = n.position || [0,0,0];
            minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
            minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
        });
        const width = isFinite(minX) ? (maxX - minX) : 0;
        const pad = 2;
        const dx = Math.max(pad, width + pad);

        const newGroupId = uuid();
        const newGroupName = srcGroup?.name ? `Copy of ${srcGroup.name}` : "Group Copy";

        // copy rooms
        const newRooms = gRooms.map(r => {
            const id = uuid();
            roomIdMap.set(r.id, id);
            const c = r.center || [0,0,0];
            return { ...r, id, name: `${r.name || "Room"} (Copy)`, center: [c[0]+dx, c[1], c[2]], groupId: newGroupId };
        });

        // copy nodes & fix roomId
        const newNodes = gNodes.map(n => {
            const id = uuid();
            nodeIdMap.set(n.id, id);
            const p = n.position || [0,0,0];
            return { ...n, id, label: `${n.label || "Node"} (Copy)`, position: [p[0]+dx, p[1], p[2]], roomId: (n.roomId && roomIdMap.get(n.roomId)) || n.roomId, groupId: newGroupId };
        });

        // duplicate internal links
        const nodeSet = new Set(gNodes.map(n => n.id));
        const newLinks = links
            .filter(l => nodeSet.has(l.from) && nodeSet.has(l.to))
            .map(l => {
                const bps = Array.isArray(l.breakpoints) ? l.breakpoints : null;
                const nextBps = bps ? bps.map(bp => [(bp?.[0] ?? 0)+dx, (bp?.[1] ?? 0), (bp?.[2] ?? 0)]) : undefined;
                const out = { ...l, id: uuid(), from: nodeIdMap.get(l.from), to: nodeIdMap.get(l.to) };
                if (nextBps) out.breakpoints = nextBps;
                return out;
            });

        setGroups(prev => [...prev, { id: newGroupId, name: newGroupName, hidden: false }]);
        setRooms(prev => [...prev, ...newRooms]);
        setNodes(prev => [...prev, ...newNodes]);
        setLinks(prev => [...prev, ...newLinks]);

        // auto-select copies
        const items = [
            ...newRooms.map(r => ({ type: "room", id: r.id })),
            ...newNodes.map(n => ({ type: "node", id: n.id })),
        ];
        setMultiSel(items);
        setSelected(items[0] || null);
    }, [groups, links, getGroupMembers]);

    const mergeGroups = useCallback((intoGid, fromGid, opts = {}) => {
        if (!intoGid || !fromGid || intoGid === fromGid) return;
        const removeSource = !!opts.removeSource;

        setRooms(prev => prev.map(r => r.groupId === fromGid ? { ...r, groupId: intoGid } : r));
        setNodes(prev => prev.map(n => n.groupId === fromGid ? { ...n, groupId: intoGid } : n));

        if (removeSource) {
            setGroups(prev => prev.filter(g => g.id !== fromGid));
            // If user was in add-to-group mode for the removed group, stop it.
            setGroupAddModeId((cur) => (cur === fromGid ? null : cur));
        }
    }, [setRooms, setNodes, setGroups]);

    useEffect(() => {
        try { localStorage.setItem("epic3d.decks.v1", JSON.stringify(decks)); } catch {}
    }, [decks]);


    const addDeck = () => {
        keepLeftScroll(() => {
            const name = `Deck ${decks.length + 1}`;
            const d = { id: uuid(), name, color: "#2c3959", visible: true };
            setDecks(prev => [...prev, d]);
        });
    };

    const setDeck = (id, patch) => {
        keepLeftScroll(() => {
            setDecks(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
        });
    };

    const deleteDeck = (id) => {
        keepLeftScroll(() => {
            setDecks(prev => prev.filter(d => d.id !== id));
        });
    };


    const addRoomToDeck = useCallback((deckId, roomId) => {
        if (!deckId || !roomId) return;
        keepLeftScroll(() => {
            setRooms((prev) => prev.map((r) => r.id === roomId ? { ...r, deckId } : r));
            // Also assign all nodes in this room to the deck (keeps deck membership explicit)
            setNodes((prev) => prev.map((n) => n.roomId === roomId ? { ...n, deckId } : n));
        });
    }, []);

    const addNodeToDeck = useCallback((deckId, nodeId) => {
        if (!deckId || !nodeId) return;
        keepLeftScroll(() => {
            setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, deckId } : n));
        });
    }, []);

    const removeRoomFromDeck = useCallback((deckId, roomId) => {
        if (!deckId || !roomId) return;
        keepLeftScroll(() => {
            setRooms((prev) => prev.map((r) => (r.id === roomId && r.deckId === deckId) ? { ...r, deckId: null } : r));
            // Remove deck from nodes in the room *if they were on this deck*
            setNodes((prev) => prev.map((n) => (n.roomId === roomId && n.deckId === deckId) ? { ...n, deckId: null } : n));
        });
    }, []);

    const removeNodeFromDeck = useCallback((deckId, nodeId) => {
        if (!deckId || !nodeId) return;
        keepLeftScroll(() => {
            setNodes((prev) => prev.map((n) => (n.id === nodeId && n.deckId === deckId) ? { ...n, deckId: null } : n));
        });
    }, []);



// Derived hidden sets (used by SceneInner)
    const hiddenDeckIds = useMemo(
        () => new Set(decks.filter((d) => d.visible === false).map((d) => d.id)),
        [decks]
    );
    const hiddenRoomIds = useMemo(
        () => new Set(rooms
            .filter((r) => (r.hidden === true) || (r.deckId && hiddenDeckIds.has(r.deckId)))
            .map((r) => r.id)),
        [rooms, hiddenDeckIds]
    );
    // Nodes visible in-scene should also be the only ones that render signal VFX.
    // When a deck is hidden, rooms/nodes in that deck are hidden in SceneInner, so we
    // must also hide their signals here (signals are rendered outside SceneInner).
    const visibleSignalNodes = useMemo(() => {
        const hd = hiddenDeckIds;
        const hr = hiddenRoomIds;
        return renderNodes.filter((n) => {
            if (n.hidden) return false;
            if (n.role === "none") return false;
            if (n.deckId && hd.has(n.deckId)) return false;
            if (n.roomId && hr.has(n.roomId)) return false;
            return true;
        });
    }, [renderNodes, hiddenDeckIds, hiddenRoomIds]);





// Link defaults (kept for your create-link flow)
    const [linkDefaults, setLinkDefaults] = useState(() => {
        const saved = localStorage.getItem("epic3d.linkDefaults.v1");
        return (
            (saved && JSON.parse(saved)) || {
                style: "particles",
                speed: 0.9,
                width: 2,
                color: "#7cf",
                active: true,
                particles: { count: 12, size: 0.06, opacity: 1, waveAmp: 0.0, waveFreq: 1.5, shape: "sphere" },
                tube: { thickness: 0.07, glow: 1.4, color: "#9bf", trail: true },
                icon: { char: "▶", size: 0.12, count: 4, color: "#fff" },
                curve: { mode: "up", bend: 0.3 },
            }
        );
    });

// Actions HUD
    const [actions, setActions] = useState(() => {
        const saved = localStorage.getItem("epic3d.actions.v7");
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                // fallthrough
            }
        }
        // legacy default
        return [
            {
                id: uuid(),
                label: "Toggle Light 01",
                showOnHUD: true,
                hud: {
                    gridX: 0,
                    gridY: 0,
                    gridW: 1,
                    gridH: 1,
                    fontSize: 13,
                    textColor: "#eaffff",
                    bgColor: "#46dcff",
                    borderColor: "rgba(70,220,255,0.35)",
                    embossed: true,
                    hidden: false,
                    fadeDuration: 0.4,
                },
                steps: [{ type: "toggleLight", nodeId: null }],
            },
        ];
    });

// persist whenever actions change
    useEffect(() => {
        try {
            localStorage.setItem("epic3d.actions.v7", JSON.stringify(actions));
        } catch {}
    }, [actions]);

// Global HUD layout options for the action buttons
    const [actionsHud, setActionsHud] = useState(() => {
        try {
            const saved = localStorage.getItem("epic3d.actionsHud.v1");
            if (saved) return JSON.parse(saved);
        } catch {}
        return {
            gridLayout: false,   // when true: free grid layout based on per-button positions
            moveMode: false,     // when true: dragging instead of triggering actions
            cellSize: 90,        // px per column
            rowHeight: 56,       // px per row
            snapThreshold: 0.4,  // cell fraction before snapping to next cell
        };
    });

    useEffect(() => {
        try {
            localStorage.setItem("epic3d.actionsHud.v1", JSON.stringify(actionsHud));
        } catch {}
    }, [actionsHud]);
    const [linkFromId, setLinkFromId] = useState(null);
    // Align mode: pick a "master" node in the inspector, then click a target node to copy one axis.
    const [levelFromNodeId, setLevelFromNodeId] = useState(null);
    const [levelAxis, setLevelAxis] = useState("y");

    const [moveMode, setMoveMode] = useState(true);
    const [transformMode, setTransformMode] = useState("translate"); // 'translate' | 'rotate' | 'scale'
// Production mode: hide all UI except bottom action buttons
    const [prodMode, setProdMode] = useState(false);

// Show/hide on-screen Action Buttons layer (HUD) – handy to clear the view while editing
    const [hudButtonsVisible, setHudButtonsVisible] = useState(() => {
        try {
            const v = localStorage.getItem("epic3d.hudButtonsVisible.v1");
            if (v === "0") return false;
            if (v === "1") return true;
        } catch {}
        return true;
    });

    useEffect(() => {
        try {
            localStorage.setItem("epic3d.hudButtonsVisible.v1", hudButtonsVisible ? "1" : "0");
        } catch {}
    }, [hudButtonsVisible]);


// Runtime animation / visibility state for each button
    const [buttonStates, setButtonStates] = useState(() => ({}));
// shape: { [actionId]: { opacity: 0..1, hidden: bool } }
    const [selected, setSelected] = useState(null); // { type:'node'|'room'|'link', id }
    const [mode, setMode] = useState("select"); // 'select' | 'link'
    const [multiSel, setMultiSel] = useState([]); // array of { type, id }

    // Optional override for the multi-selection pivot (used for "Rotate all" so the gizmo pivots at the room center)
    const [multiPivotOverride, setMultiPivotOverride] = useState(null); // { pos:[x,y,z], reason?:string, roomId?:string }

    // Auto-clear pivot override when it no longer applies
    useEffect(() => {
        if (!multiPivotOverride) return;
        const multiLen = Array.isArray(multiSel) ? multiSel.length : 0;

        if (!moveMode || transformMode !== 'rotate' || multiLen <= 1) {
            setMultiPivotOverride(null);
            return;
        }

        if (multiPivotOverride?.reason === 'room-pack') {
            const keep = (multiSel || []).some((it) => it?.type === 'room' && it.id === multiPivotOverride.roomId);
            if (!keep) setMultiPivotOverride(null);
        }
    }, [multiPivotOverride, moveMode, transformMode, multiSel]);


// Explicit selection mode for the cursor
//  - "single": only one thing selected
//  - "multi":  click toggles things in/out of selection
//  - "box":    drag on empty space to marquee-select
    const [selectionMode, setSelectionMode] = useState("single");

// Current box-select rectangle (screen space)
    const [marquee, setMarquee] = useState(null); // { x, y, w, h, canvasRect }
    // Marquee guards: prevent pointer-up from instantly starting a new box after one finishes
    const marqueeGuardRef = useRef({ active: false, endMs: 0 });

// Live snapshots of rooms/nodes for box-select projection
    const nodesRef = useRef(nodes);
    const roomsRef = useRef(rooms);
    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);
    useEffect(() => {
        roomsRef.current = rooms;
    }, [rooms]);

    const linksRef = useRef(links);
    useEffect(() => {
        linksRef.current = links;
    }, [links]);

// NEW: currently selected breakpoint (in a link), for gizmo movement
    const [selectedBreakpoint, setSelectedBreakpoint] = useState(null);
// helper: get a normalized hud config for an action
    const getHudCfg = useCallback((a) => {
        const h = a?.hud || {};
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

        return {
            gridX: Number.isFinite(h.gridX) ? h.gridX : 0,
            gridY: Number.isFinite(h.gridY) ? h.gridY : 0,
            gridW: clamp(Number(h.gridW ?? 1) || 1, 1, 8),
            gridH: clamp(Number(h.gridH ?? 1) || 1, 1, 4),
            fontSize: clamp(Number(h.fontSize ?? 13) || 13, 9, 26),
            textColor: h.textColor || "#eaffff",
            bgColor: h.bgColor || "#46dcff",
            borderColor: h.borderColor || "rgba(70,220,255,0.35)",
            embossed: h.embossed ?? true,
            hidden: !!h.hidden,
            fadeDuration: Number(h.fadeDuration ?? 0.4) || 0.4,
        };
    }, []);
// Auto-enter Move mode after a box selection creates a selection
    const prevMultiLenRef = useRef(0);

    useEffect(() => {
        const prevLen = prevMultiLenRef.current;
        const curLen = Array.isArray(multiSel) ? multiSel.length : 0;
        prevMultiLenRef.current = curLen;

        // If we were NOT in move mode and we just got a multi-selection, jump into Move mode.
        // (This is the "after first drag, go to movement mode" behavior.)
        if (!moveMode && curLen > 0 && prevLen === 0) {
            setMoveMode(true);
            setTransformMode("translate");
        }
    }, [multiSel, moveMode]);

// very simple “group” helper: take all buttons in the same row that touch horizontally
    const getRowGroupForAction = useCallback(
        (rootId) => {
            const list = actions.filter((a) => a.showOnHUD ?? true);
            const byId = new Map(list.map((a) => [a.id, getHudCfg(a)]));
            const rootHud = byId.get(rootId);
            if (!rootHud) return [rootId];

            const sameRow = list.filter((a) => {
                const h = byId.get(a.id);
                return h && h.gridY === rootHud.gridY;
            });

            const sorted = sameRow
                .slice()
                .sort((a, b) => byId.get(a.id).gridX - byId.get(b.id).gridX);

            const groupIds = [];
            let chain = [];
            for (const a of sorted) {
                const h = byId.get(a.id);
                if (chain.length === 0) {
                    chain.push(a);
                    continue;
                }
                const prev = byId.get(chain[chain.length - 1].id);
                const touches =
                    h.gridX <= prev.gridX + prev.gridW &&
                    h.gridX + h.gridW >= prev.gridX; // simple overlap / adjacency
                if (touches) {
                    chain.push(a);
                } else {
                    if (chain.some((x) => x.id === rootId)) {
                        groupIds.push(...chain.map((x) => x.id));
                    }
                    chain = [a];
                }
            }
            if (chain.some((x) => x.id === rootId)) {
                groupIds.push(...chain.map((x) => x.id));
            }
            return groupIds.length ? groupIds : [rootId];
        },
        [actions, getHudCfg]
    );
    const cameraSnapshotRef = useRef(null);
    const keyOf = (it) => `${it.type}:${it.id}`;

    const applyBoxSelection = useCallback(
        (rect, canvasRect) => {
            if (!rect || !canvasRect) return;
            if (!cameraSnapshotRef?.current) return;

            const snap = cameraSnapshotRef.current();
            if (!snap || !snap.position || !snap.target) return;

            const width = canvasRect.width || 1;
            const height = canvasRect.height || 1;
            const aspect = width / Math.max(1, height);

            const { position, target, fov } = snap;

            const cam = new THREE.PerspectiveCamera(
                typeof fov === "number" ? fov : 50,
                aspect,
                0.1,
                2000
            );
            cam.position.set(position[0], position[1], position[2]);
            cam.up.set(0, 1, 0);
            cam.lookAt(target[0], target[1], target[2]);
            cam.updateMatrixWorld();
            cam.updateProjectionMatrix();

            const v = new THREE.Vector3();
            const project = (p) => {
                v.set(p[0], p[1], p[2]);
                v.project(cam);
                const sx =
                    canvasRect.left + (v.x * 0.5 + 0.5) * canvasRect.width;
                const sy =
                    canvasRect.top + (-v.y * 0.5 + 0.5) * canvasRect.height;
                return { x: sx, y: sy, z: v.z };
            };

            const inRect = (p) =>
                p.x >= rect.x &&
                p.x <= rect.x + rect.w &&
                p.y >= rect.y &&
                p.y <= rect.y + rect.h;

            const nextSel = [];

            const curNodes = nodesRef.current || [];
            for (const n of curNodes) {
                const pos = n.position || [0, 0, 0];
                const pt = project(pos);
                if (pt.z > 1) continue; // behind camera
                if (inRect(pt)) nextSel.push({ type: "node", id: n.id });
            }

            const curRooms = roomsRef.current || [];
            for (const r of curRooms) {
                if (r.locked) continue; // 🔒 ignore locked rooms completely
                const size = r.size || [3, 1.6, 2.2];
                const center = r.center || [0, size[1] * 0.5, 0];
                const pt = project(center);
                if (pt.z > 1) continue;
                if (inRect(pt)) nextSel.push({ type: "room", id: r.id });
            }

            if (!nextSel.length) {
                setSelected(null);
                setMultiSel([]);
                setSelectedBreakpoint(null);
                setLinkFromId(null);
                setLevelFromNodeId(null);
                setMode("select");
                return;
            }

            // Deduplicate by type:id
            const seen = new Set();
            const unique = [];
            for (const it of nextSel) {
                const k = keyOf(it);
                if (seen.has(k)) continue;
                seen.add(k);
                unique.push(it);
            }

            // --- BOX SELECTION DONE ---
// Freeze selection
            setMode("select");
            setSelectedBreakpoint(null);
            setLinkFromId(null);
            setMultiSel(unique);

// ❗ DO NOT set selected to any actual node/room
// ❗ Force TransformControls to stay on the pivot
            setSelected({ type: "pivot", id: "__pivot__" });

            setMoveMode(true);
            setTransformMode("translate");


            const firstNode = unique.find((it) => it.type === "node");
            if (firstNode) setLevelFromNodeId(firstNode.id);
        },
        [
            cameraSnapshotRef,
            keyOf,
            setSelected,
            setMultiSel,
            setSelectedBreakpoint,
            setLinkFromId,
            setMode,
            setLevelFromNodeId,
        ]
    );
// Selection & modes
// Selection & modes

// shape: { linkId, index } | null




// Apply add-to-group by assigning current selection to the active group
    const applyGroupAddMode = useCallback(() => {
        const gid = groupAddModeId;
        if (!gid) return;

        const roomIds = new Set();
        const nodeIds = new Set();
        const push = (it) => {
            if (!it || !it.type || !it.id) return;
            if (it.type === 'room') roomIds.add(it.id);
            if (it.type === 'node') nodeIds.add(it.id);
        };
        push(selected);
        (multiSel || []).forEach(push);

        if (roomIds.size === 0 && nodeIds.size === 0) {
            setGroupAddModeId(null);
            return;
        }

        // Assign rooms, and also assign ALL nodes inside any selected rooms
        setRooms(prev => prev.map(r => roomIds.has(r.id) ? { ...r, groupId: gid } : r));
        setNodes(prev => prev.map(n => (nodeIds.has(n.id) || (n.roomId && roomIds.has(n.roomId))) ? { ...n, groupId: gid } : n));

        setGroupAddModeId(null);
    }, [groupAddModeId, selected, multiSel, setRooms, setNodes]);

    const addRoomToGroup = useCallback((gid, roomId, includeRoomNodes = true) => {
        if (!gid || !roomId) return;
        setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, groupId: gid } : r)));
        if (includeRoomNodes) {
            setNodes((prev) => prev.map((n) => (n.roomId === roomId ? { ...n, groupId: gid } : n)));
        }
    }, [setRooms, setNodes]);

    const addNodeToGroup = useCallback((gid, nodeId) => {
        if (!gid || !nodeId) return;
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, groupId: gid } : n)));
    }, [setNodes]);

    // Adds the current selection (single + multi) to a group immediately.
    // If any rooms are included, all nodes in those rooms are also added.
    const addSelectionToGroup = useCallback((gid) => {
        if (!gid) return;

        const roomIds = new Set();
        const nodeIds = new Set();
        const push = (it) => {
            if (!it || !it.type || !it.id) return;
            if (it.type === 'room') roomIds.add(it.id);
            if (it.type === 'node') nodeIds.add(it.id);
        };
        push(selected);
        (multiSel || []).forEach(push);

        if (roomIds.size === 0 && nodeIds.size === 0) return;

        setRooms((prev) => prev.map((r) => (roomIds.has(r.id) ? { ...r, groupId: gid } : r)));
        setNodes((prev) =>
            prev.map((n) =>
                (nodeIds.has(n.id) || (n.roomId && roomIds.has(n.roomId))) ? { ...n, groupId: gid } : n
            )
        );
    }, [selected, multiSel, setRooms, setNodes]);


    const toggleSel = (list, item) =>
        list.some((x) => x.type === item.type && x.id === item.id)
            ? list.filter((x) => !(x.type === item.type && x.id === item.id))
            : [...list, item];
// Use the camera snapshot from CameraPoseBridge (already used by view presets)


    const startMarquee = useCallback(
        (ev) => {
            if (selectionMode !== "box" || moveMode) return;
            const e = ev?.nativeEvent || ev;
            if (!e || e.button !== 0) return;

            const canvasRect = e.target?.getBoundingClientRect?.();
            if (!canvasRect) return;

            const startX = e.clientX;
            const startY = e.clientY;

            setMarquee({
                x: startX,
                y: startY,
                w: 0,
                h: 0,
                canvasRect,
            });
// Don't start a new box while Move mode is ON, or immediately after finishing one
            const now = performance.now();
            if (moveMode) return;
            if (marqueeGuardRef.current.active) return;
            if (now - (marqueeGuardRef.current.endMs || 0) < 250) return;
            marqueeGuardRef.current.active = true;

            const onMove = (evt) => {
                const x1 = evt.clientX;
                const y1 = evt.clientY;
                const x = Math.min(startX, x1);
                const y = Math.min(startY, y1);
                const w = Math.abs(x1 - startX);
                const h = Math.abs(y1 - startY);
                setMarquee((prev) =>
                    prev
                        ? { ...prev, x, y, w, h }
                        : null
                );
            };

            const finish = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", finish);
                window.removeEventListener("pointercancel", finish);

                setMarquee((prev) => {
                    if (!prev) return null;
                    if (prev.w > 3 && prev.h > 3) {
                        applyBoxSelection(
                            {
                                x: prev.x,
                                y: prev.y,
                                w: prev.w,
                                h: prev.h,
                            },
                            prev.canvasRect
                        );
                    }
                    return null;
                });
            };

            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", finish);
            window.addEventListener("pointercancel", finish);
            marqueeGuardRef.current.active = false;
            marqueeGuardRef.current.endMs = performance.now();
        },
        // Mark marquee as finished so we ignore the Canvas' immediate onPointerMissed from this pointer-up


        [selectionMode, applyBoxSelection, moveMode]
    );

    const DEFAULT_PRESET_ID = "__default__";



// Track Esc times to exit prod mode (3 presses within 3s)
    const escTimesRef = useRef([]);
// ---- Camera Presets (persisted) ----
    const [cameraPresets, setCameraPresets] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem("epic3d.cameraPresets.v1") || "[]");
        } catch { return []; }
    });

    useEffect(() => {
        try { localStorage.setItem("epic3d.cameraPresets.v1", JSON.stringify(cameraPresets)); } catch {}
    }, [cameraPresets]);

    const [cameraPresetId, setCameraPresetId] = useState(
        () => localStorage.getItem("epic3d.cameraPresetId.v1") || ""
    );


    useEffect(() => {
        try { localStorage.setItem("epic3d.cameraPresetId.v1", cameraPresetId || ""); } catch {}
    }, [cameraPresetId]);

// Default startup if nothing selected/saved
    const sanitizePose = React.useCallback((p) => {
        const fallback = { position: [6, 4.5, 6], target: [0, 0, 0], fov: 55 };
        if (!p || typeof p !== "object") return fallback;
        const pos = Array.isArray(p.position) && p.position.length === 3 ? p.position.map(Number) : fallback.position;
        const tgt = Array.isArray(p.target) && p.target.length === 3 ? p.target.map(Number) : fallback.target;
        const fov = Number.isFinite(Number(p.fov)) ? Number(p.fov) : fallback.fov;
        return {
            position: pos.every(Number.isFinite) ? pos : fallback.position,
            target: tgt.every(Number.isFinite) ? tgt : fallback.target,
            fov,
        };
    }, []);

    const [defaultPose, setDefaultPose] = useState(() => {
        // Persisted so imports/merges that change it survive reloads.
        try {
            const raw = localStorage.getItem("epic3d.cameraDefaultPose.v1");
            if (!raw) return { position: [6, 4.5, 6], target: [0, 0, 0], fov: 55 };
            return sanitizePose(JSON.parse(raw));
        } catch {
            return { position: [6, 4.5, 6], target: [0, 0, 0], fov: 55 };
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem("epic3d.cameraDefaultPose.v1", JSON.stringify(defaultPose));
        } catch {}
    }, [defaultPose]);
    const currentPose = useMemo(
        () => cameraPresets.find(p => p.id === cameraPresetId) || null,
        [cameraPresets, cameraPresetId]
    );
// Which pose to use, and a stable key for "apply-once"
    const activePose = currentPose || defaultPose;
    const activePresetKey = cameraPresetId || "default";

// Canvas camera prop (position + fov at creation)
    const canvasCamera = useMemo(() => ({
        position: currentPose?.position || defaultPose.position,
        fov: currentPose?.fov ?? defaultPose.fov
    }), [currentPose, defaultPose]);

// A ref we can call to snapshot the *current* camera+target from inside Canvas

// Camera tracks (queued cinematic moves from Actions HUD)
    const [cameraTracks, setCameraTracks] = useState([]);

// Schedule a camera move between two saved views
    const scheduleCameraMove = React.useCallback((opts) => {
        if (!opts || !opts.toPresetId) return;
        const delay = Math.max(0, Number(opts.startDelay || 0));
        const duration = Math.max(0.001, Number(opts.duration || 0.001));
        const now = (typeof performance !== "undefined" ? performance.now() : Date.now());

        setCameraTracks(prev => [
            ...prev,
            {
                id: uuid(),
                fromPresetId: opts.fromPresetId || null,
                toPresetId: opts.toPresetId,
                startMs: now + delay * 1000,
                durationMs: duration * 1000,
            }
        ]);
    }, []);

// Called from the 3D scene when a track finishes
    const handleCameraTrackDone = React.useCallback((id) => {
        setCameraTracks(prev => prev.filter(t => t.id !== id));
    }, []);

// Simple global bridge so SceneInner can read camera presets + tracks
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.__EPIC3D_CAMERA_PRESETS = cameraPresets;
        window.__EPIC3D_CAMERA_TRACKS = cameraTracks;
        window.__EPIC3D_ON_CAMERA_TRACK_DONE = handleCameraTrackDone;
    }, [cameraPresets, cameraTracks, handleCameraTrackDone]);


// View & perf
    const [wireframe, setWireframe] = useState(() => localStorage.getItem("epic3d.wireframe.v1") === "1");
    useEffect(() => {
        try { localStorage.setItem("epic3d.wireframe.v1", wireframe ? "1" : "0"); } catch {}
    }, [wireframe]);
// persist wireframe opacity
    const [wireOpacity, setWireOpacity] = useState(() => {
        const v = localStorage.getItem("epic3d.wireOpacity.v1");
        return v === null ? 0.6 : Math.min(1, Math.max(0, Number(v)));
    });

    useEffect(() => {
        try { localStorage.setItem("epic3d.wireOpacity.v1", String(wireOpacity)); } catch {}
    }, [wireOpacity]);

    const [wireDetail, setWireDetail] = useState(() => localStorage.getItem("epic3d.wireDetail.v1") || "high");
    useEffect(() => { try { localStorage.setItem("epic3d.wireDetail.v1", wireDetail); } catch {} }, [wireDetail]);

    const [wireHideSurfaces, setWireHideSurfaces] = useState(() => localStorage.getItem("epic3d.wireHideSurfaces.v1") === "1");
    useEffect(() => { try { localStorage.setItem("epic3d.wireHideSurfaces.v1", wireHideSurfaces ? "1" : "0"); } catch {} }, [wireHideSurfaces]);

    const [labelsOn, setLabelsOn] = useState(true);
    const [labelMode, setLabelMode] = useState("billboard"); // "billboard" | "3d" | "static"
    const [labelSize, setLabelSize] = useState(0.24);        // world units

    const [showLights, setShowLights] = useState(true);
    const [showLightBounds, setShowLightBounds] = useState(false);
    const [showGround, setShowGround] = useState(() => {
        try {
            return localStorage.getItem("epic3d.showGround.v1") !== "0";
        } catch {
            return true;
        }
    });
    const [roomOpacity, setRoomOpacity] = useState(0.12);

    // Ground grid (visual + snapping helpers)
    const defaultGridConfig = useMemo(() => ({
        enabled: true,
        color: "#4aa3ff",
        // This is "visual opacity" implemented as a blend-strength toward the grid color
        opacity: 0.35,
        cellSize: 0.25,
        majorEvery: 10,
        fadeDistance: 100,
        fadeStrength: 1,
        cellThickness: 0.85,
        sectionThickness: 1.15,

        infiniteGrid: true,
        followCamera: false,
        showPlane: true,
        showAxes: false,

        // 3D grid space (extra wall planes)
        space3D: false,
        planeOffsetX: 0,
        planeOffsetZ: 0,
        space3DCount: 4,
        space3DStep: 5,
        space3DXY: true,
        space3DYZ: true,

        // selection highlight
        highlightSelection: true,
        highlightColor: "#a78bfa",
        highlightOpacity: 0.18,

        // snapping
        linkSnap: true,
        snapMode: "vertices", // "off" | "vertices" | "tiles"
        snapTilesCenterMove: "auto", // "auto" | "off"
        tileCenterResize: true,

        // snap preview ghost
        snapGhostEnabled: true,
        snapGhostColor: "#7dd3fc",
        snapGhostOpacity: 0.22,

        // Floors / Decks (horizontal layers)
        floorsEnabled: false,
        floorsAutoEnabled: false,
        floorsAutoBaseY: 0,
        floorsAutoStep: 2,
        floorsAutoCount: 0,
        floorsManual: [],
        snapToFloors: false,
        snapFloorMode: "nearest", // "nearest" | "active"
        activeFloorId: "ground",
        floorSnapAlign: "base", // "base" | "center"

        // optional: where to blend the grid color from
        blendBase: "#0d1322",
    }), []);

    const [gridConfig, setGridConfig] = useState(() => {
        if (typeof window === "undefined") return defaultGridConfig;
        try {
            const raw = localStorage.getItem("epic3d.gridConfig.v1");
            if (!raw) return defaultGridConfig;
            const parsed = JSON.parse(raw);
            return { ...defaultGridConfig, ...(parsed || {}) };
        } catch {
            return defaultGridConfig;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem("epic3d.gridConfig.v1", JSON.stringify(gridConfig));
        } catch {}
    }, [gridConfig]);


    const [animate, setAnimate] = useState(true);
    const [perf, setPerf] = useState("med"); // 'low' | 'med' | 'high'

// Canvas background colour (persisted)
    const [bg, setBg] = useState(() => {
        try {
            return localStorage.getItem("epic3d.bgColor.v1") || "#0b1020";
        } catch {
            return "#0b1020";
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem("epic3d.bgColor.v1", bg);
        } catch {}
    }, [bg]);

    useEffect(() => {
        try {
            localStorage.setItem("epic3d.showGround.v1", showGround ? "1" : "0");
        } catch {}
    }, [showGround]);

// Room gap FX (global)
    const [roomGap, setRoomGap] = useState({
        enabled: false,
        shape: "sphere", // 'sphere' | 'box'
        center: [0, 0.8, 0],
        radius: 0.0,
        endRadius: 1.5,
        speed: 0.6,
        animate: false,
        loop: false,
    });

// Placement
    const [placement, setPlacement] = useState({
        armed: false,
        multi: false,
        snap: 0.25,
        placeKind: "node", // 'node' | 'switch' | 'room'
        roomDrawMode: "box", // "single" | "box" | "points"
    });

    // If desired, keep snapping aligned with the grid cell size (one source of truth)
    useEffect(() => {
        if (!(gridConfig?.linkSnap ?? true)) return;
        const cell = Number(gridConfig?.cellSize);
        if (!Number.isFinite(cell) || cell <= 0) return;
        setPlacement((p) => {
            const cur = Number(p?.snap ?? 0);
            if (Number.isFinite(cur) && Math.abs(cur - cell) < 1e-9) return p;
            return { ...(p || {}), snap: cell };
        });
    }, [gridConfig?.cellSize, gridConfig?.linkSnap]);

    // If the user edits the snap in the Placement panel while linked, mirror it back into the grid
    useEffect(() => {
        if (!(gridConfig?.linkSnap ?? true)) return;
        const s = Number(placement?.snap);
        if (!Number.isFinite(s) || s <= 0) return;
        setGridConfig((prev) => {
            const cur = Number(prev?.cellSize);
            if (Number.isFinite(cur) && Math.abs(cur - s) < 1e-9) return prev;
            return { ...(prev || {}), cellSize: s };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [placement?.snap, gridConfig?.linkSnap]);


    // ---------- Grid snapping + floor snapping (data mutation) ----------
    const _safeNum = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const _effectiveSnapMode = () => {
        const m = String(gridConfig?.snapMode || "").trim();
        if (m === "off" || m === "vertices" || m === "tiles") return m;
        return (gridConfig?.linkSnap ?? true) ? "vertices" : "off";
    };

    const _gridCell = () => {
        const cell = _safeNum(gridConfig?.cellSize, _safeNum(placement?.snap, 0.25));
        return Math.max(0.01, cell);
    };

    const _gridOffsets = () => {
        return {
            ox: _safeNum(gridConfig?.planeOffsetX, 0),
            oz: _safeNum(gridConfig?.planeOffsetZ, 0),
        };
    };

    const _computeFloors = () => {
        const baseY = _safeNum(gridConfig?.y, 0);
        const wantFloors = !!gridConfig?.floorsEnabled || !!gridConfig?.snapToFloors;
        const out = [{ id: "ground", y: baseY }];
        if (!wantFloors) return out;

        const autoEnabled = !!gridConfig?.floorsAutoEnabled;
        const autoCount = Math.max(0, Math.min(64, Math.round(_safeNum(gridConfig?.floorsAutoCount, 0))));
        const autoStep = Math.max(0.05, _safeNum(gridConfig?.floorsAutoStep, 2));
        const autoBase = _safeNum(gridConfig?.floorsAutoBaseY, baseY);
        if (autoEnabled && autoCount > 0) {
            for (let i = 0; i < autoCount; i++) {
                out.push({ id: `auto_${i}`, y: autoBase + i * autoStep });
            }
        }

        const manual = Array.isArray(gridConfig?.floorsManual) ? gridConfig.floorsManual : [];
        for (const f of manual) {
            if (!f?.id) continue;
            out.push({ id: f.id, y: _safeNum(f.y, 0) });
        }
        return out;
    };

    const _pickFloorY = (y) => {
        const floors = _computeFloors();
        const mode = String(gridConfig?.snapFloorMode || "nearest");
        const preferId = String(gridConfig?.activeFloorId || "").trim();

        if (mode === "active" && preferId) {
            const f = floors.find((ff) => ff.id === preferId);
            if (f) return f.y;
        }

        // nearest
        let best = floors[0]?.y ?? 0;
        let bestD = Math.abs((floors[0]?.y ?? 0) - y);
        for (let i = 1; i < floors.length; i++) {
            const fy = floors[i]?.y ?? 0;
            const d = Math.abs(fy - y);
            if (d < bestD) {
                bestD = d;
                best = fy;
            }
        }
        return best;
    };

    const _snapAxis = (v, cell, offset = 0) => {
        return Math.round((v - offset) / cell) * cell + offset;
    };

    const _snapAxisTiles = (v, cell, offset = 0, span = 1) => {
        const odd = (Math.round(span) % 2) === 1;
        const tileOffset = odd ? cell * 0.5 : 0;
        return Math.round((v - offset - tileOffset) / cell) * cell + offset + tileOffset;
    };

    const _applyGridSnapXZ = (x, z, spanX = 1, spanZ = 1) => {
        const mode = _effectiveSnapMode();
        if (mode === "off") return [x, z];
        const cell = _gridCell();
        const { ox, oz } = _gridOffsets();

        if (mode === "tiles" && String(gridConfig?.snapTilesCenterMove || "auto") !== "off") {
            return [_snapAxisTiles(x, cell, ox, spanX), _snapAxisTiles(z, cell, oz, spanZ)];
        }
        // vertices
        return [_snapAxis(x, cell, ox), _snapAxis(z, cell, oz)];
    };

    const _nodeFootprintXZ = (node) => {
        const sh = node?.shape || {};
        const t = sh.type;
        if (t === "switch") {
            return { w: _safeNum(sh.w, 1.1), d: _safeNum(sh.d, 0.35) };
        }
        if (t === "sphere") {
            const r = _safeNum(sh.radius, 0.35);
            return { w: r * 2, d: r * 2 };
        }
        if (t === "cylinder" || t === "cone" || t === "circle" || t === "disc" || t === "hexagon") {
            const r = _safeNum(sh.radius, 0.45);
            return { w: r * 2, d: r * 2 };
        }
        if (t === "box" || t === "square") {
            const sc = Array.isArray(sh.scale) ? sh.scale : [0.6, 0.6, 0.6];
            return { w: _safeNum(sc[0], 0.6), d: _safeNum(sc[2], 0.6) };
        }
        // fallback
        return { w: 0.6, d: 0.6 };
    };

    const _nodeHalfHeight = (node) => {
        const sh = node?.shape || {};
        const t = sh.type;
        if (t === "switch") return _safeNum(sh.h, 0.28) * 0.5;
        if (t === "sphere") return _safeNum(sh.radius, 0.35);
        if (t === "cylinder" || t === "cone") return _safeNum(sh.height, 0.8) * 0.5;
        if (t === "box" || t === "square") {
            const sc = Array.isArray(sh.scale) ? sh.scale : [0.6, 0.6, 0.6];
            return _safeNum(sc[1], 0.6) * 0.5;
        }
        return 0.3;
    };

    const applyGridSnapToNode = (node, pos) => {
        const p = Array.isArray(pos) ? pos : [0, 0, 0];
        const cell = _gridCell();
        const fp = _nodeFootprintXZ(node);
        const spanX = Math.max(1, Math.round(fp.w / cell));
        const spanZ = Math.max(1, Math.round(fp.d / cell));
        const [sx, sz] = _applyGridSnapXZ(p[0], p[2], spanX, spanZ);

        let sy = p[1];
        if ((gridConfig?.snapToFloors ?? false) && !node?.roomId) {
            const fy = _pickFloorY(sy);
            const align = String(gridConfig?.floorSnapAlign || "base");
            sy = align === "center" ? fy : (fy + _nodeHalfHeight(node));
        }
        return [sx, sy, sz];
    };

    const applyGridSnapToRoom = (room, center) => {
        const c = Array.isArray(center) ? center : (room?.center || [0, 0, 0]);
        const cell = _gridCell();
        const size = Array.isArray(room?.size) ? room.size : [1.8, 1, 1.8];
        const spanX = Math.max(1, Math.round(_safeNum(size[0], 1.8) / cell));
        const spanZ = Math.max(1, Math.round(_safeNum(size[2], 1.8) / cell));
        const [sx, sz] = _applyGridSnapXZ(c[0], c[2], spanX, spanZ);

        let sy = c[1];
        if (gridConfig?.snapToFloors ?? false) {
            const fy = _pickFloorY(sy);
            const align = String(gridConfig?.floorSnapAlign || "base");
            sy = align === "center" ? fy : (fy + _safeNum(size[1], 1) * 0.5);
        }
        return [sx, sy, sz];
    };
    const placingNode = placement.armed && placement.placeKind === "node";
    const placingSwitch = placement.armed && placement.placeKind === "switch";
    const placingRoom = placement.armed && placement.placeKind === "room";
    // Room Operator mode (top-down floorplan builder)
    const [roomOperatorMode, setRoomOperatorMode] = useState(false);

    const toggleRoomOperatorMode = React.useCallback(() => {
        setRoomOperatorMode((prev) => {
            const next = !prev;
            // When entering operator: arm room placement, when leaving: disarm
            setPlacement((p) =>
                next
                    ? { ...(p || {}), armed: true, multi: false, placeKind: "room" }
                    : { ...(p || {}), armed: false }
            );
            return next;
        });
    }, [setPlacement]);
    // Room Operator: click on magnet anchor on a room edge to spawn a new attached room


// Drag state & deselect guard
    const [dragActive, setDragActive] = useState(false);
    const dragState = useMemo(() => ({ active: dragActive, set: setDragActive }), [dragActive]);
    const missGuardRef = useRef(0);
    const missGuardMS = 220;
// Put this near your other helpers (right after `const setNode = `)
    const updateSelectedNode = React.useCallback((patchOrFn) => {
        setNodes(prev =>
            prev.map(n => {
                if (selected?.type !== "node" || n.id !== selected.id) return n;
                const patch = typeof patchOrFn === "function" ? patchOrFn(n) : patchOrFn;
                return { ...n, ...patch };
            })
        );
    }, [selected, setNodes]);

// UI interaction flag
    const [uiInteracting, setUiInteracting] = useState(false);
    const uiStart = () => setUiInteracting(true);
    const uiStop = () => setUiInteracting(false);
// put near other callbacks in Interactive3DNodeShowcase.jsx
    const duplicateNode = React.useCallback((id, offset = [0.4, 0, 0.4]) => {
        setNodes(prev => {
            const src = prev.find(n => n.id === id);
            if (!src) return prev;

            const copy = JSON.parse(JSON.stringify(src));
            copy.id = uuid();

            // unique-ish label
            const base = src.label || "Node";
            const labels = new Set(prev.map(n => n.label));
            let name = base;
            let i = 2;
            while (labels.has(name)) name = `${base} (${i++})`;
            copy.label = name;

            // offset position
            const p = src.position || [0, 0, 0];
            copy.position = [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];

            return [...prev, copy];
        });
    }, []);

    // ---------------------------------------------------------------------
    // Undo / Redo (Ctrl+Z / Ctrl+Y)
    // ---------------------------------------------------------------------
    const HISTORY_LIMIT = 80;

    const historyRef = useRef({
        past: [],
        future: [],
        current: null,
        currentHash: null,
        dragStart: null,
    });
    const restoringHistoryRef = useRef(false);
    const historyCommitTimerRef = useRef(null);
    const [, forceHistoryTick] = useState(0); // re-render when stacks change

    const deepClone = useCallback((v) => {
        try {
            return JSON.parse(JSON.stringify(v));
        } catch {
            return v;
        }
    }, []);

    const makeHistorySnapshot = useCallback(() => {
        return deepClone({
            rooms,
            nodes,
            links,
            decks,
            groups,
            actions,
            actionsHud,
            importedPictures,
            linkDefaults,
            roomGap,
            roomOpacity,
        });
    }, [
        deepClone,
        rooms,
        nodes,
        links,
        decks,
        groups,
        actions,
        actionsHud,
        importedPictures,
        linkDefaults,
        roomGap,
        roomOpacity,
    ]);

    const applyHistorySnapshot = useCallback(
        (snap) => {
            if (!snap) return;

            // Don't record this change back into history
            restoringHistoryRef.current = true;
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }

            setRooms(deepClone(snap.rooms || []));
            setNodes(deepClone(snap.nodes || []));
            setLinks(deepClone(snap.links || []));
            setDecks(deepClone(snap.decks || []));
            setGroups(deepClone(snap.groups || []));
            setActions(deepClone(snap.actions || []));
            setActionsHud(deepClone(snap.actionsHud || {}));
            setImportedPictures(deepClone(snap.importedPictures || []));
            setLinkDefaults(deepClone(snap.linkDefaults || linkDefaults));
            setRoomGap(deepClone(snap.roomGap || roomGap));
            setRoomOpacity(
                typeof snap.roomOpacity === "number" && !Number.isNaN(snap.roomOpacity)
                    ? snap.roomOpacity
                    : roomOpacity
            );

            // Selection might reference deleted items; clear it for safety.
            setSelected(null);
            setMultiSel([]);
            setSelectedBreakpoint(null);
            setMode("select");
            setLinkFromId(null);
            setLevelFromNodeId(null);

            // Allow history recording again after the restore render flushes.
            setTimeout(() => {
                restoringHistoryRef.current = false;
            }, 0);
        },
        [
            deepClone,
            setRooms,
            setNodes,
            setLinks,
            setDecks,
            setGroups,
            setActions,
            setActionsHud,
            setImportedPictures,
            setLinkDefaults,
            setRoomGap,
            setRoomOpacity,
            setSelected,
            setMultiSel,
            setMode,
            setLinkFromId,
            setLevelFromNodeId,
            setSelectedBreakpoint,
            linkDefaults,
            roomGap,
            roomOpacity,
        ]
    );

    const commitHistorySnapshot = useCallback(() => {
        if (restoringHistoryRef.current) return;

        const h = historyRef.current;
        const nextSnap = makeHistorySnapshot();
        let nextHash = null;
        try {
            nextHash = JSON.stringify(nextSnap);
        } catch {
            nextHash = String(Date.now());
        }

        // init
        if (!h.current) {
            h.current = nextSnap;
            h.currentHash = nextHash;
            h.past = [];
            h.future = [];
            forceHistoryTick((t) => t + 1);
            return;
        }

        // no change
        if (h.currentHash === nextHash) return;

        h.past.push(h.current);
        if (h.past.length > HISTORY_LIMIT) h.past.shift();

        h.current = nextSnap;
        h.currentHash = nextHash;
        h.future = [];

        forceHistoryTick((t) => t + 1);
    }, [makeHistorySnapshot]);

    const undo = useCallback(() => {
        const h = historyRef.current;
        if (!h.past.length) return;

        const prev = h.past.pop();
        if (!prev) return;

        h.future.push(h.current);
        h.current = prev;

        try {
            h.currentHash = JSON.stringify(prev);
        } catch {
            h.currentHash = String(Date.now());
        }

        forceHistoryTick((t) => t + 1);
        applyHistorySnapshot(prev);
    }, [applyHistorySnapshot]);

    const redo = useCallback(() => {
        const h = historyRef.current;
        if (!h.future.length) return;

        const next = h.future.pop();
        if (!next) return;

        h.past.push(h.current);
        if (h.past.length > HISTORY_LIMIT) h.past.shift();

        h.current = next;
        try {
            h.currentHash = JSON.stringify(next);
        } catch {
            h.currentHash = String(Date.now());
        }

        forceHistoryTick((t) => t + 1);
        applyHistorySnapshot(next);
    }, [applyHistorySnapshot]);

    const canUndo = historyRef.current.past.length > 0;
    const canRedo = historyRef.current.future.length > 0;

    // Initialize a baseline snapshot immediately (so the very first edit can be undone).
    useEffect(() => {
        const h = historyRef.current;
        if (h.current) return;

        const snap = makeHistorySnapshot();
        h.current = snap;
        try {
            h.currentHash = JSON.stringify(snap);
        } catch {
            h.currentHash = String(Date.now());
        }
        h.past = [];
        h.future = [];
        forceHistoryTick((x) => x + 1);
    }, [makeHistorySnapshot]);

// Auto-commit scene changes (debounced). Dragging uses a separate "commit on drag end".
    useEffect(() => {
        if (restoringHistoryRef.current) return;

        // If a gizmo drag is active, skip debounced commits.
        if (dragActive) return;

        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }

        historyCommitTimerRef.current = setTimeout(() => {
            commitHistorySnapshot();
        }, 250);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [
        rooms,
        nodes,
        links,
        decks,
        groups,
        actions,
        actionsHud,
        importedPictures,
        linkDefaults,
        roomGap,
        roomOpacity,
        dragActive,
        commitHistorySnapshot,
    ]);

    // Flush history at drag start and commit one step at drag end.
    const dragActivePrevRef = useRef(dragActive);
    useEffect(() => {
        const was = dragActivePrevRef.current;
        const now = dragActive;

        dragActivePrevRef.current = now;

        if (!was && now) {
            // drag start: commit any pending edits so the drag becomes its own undo step
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            commitHistorySnapshot();
            historyRef.current.dragStart = historyRef.current.current;
        }

        if (was && !now) {
            // drag end: commit once (will push dragStart -> past, and current -> after)
            if (historyRef.current.dragStart) {
                commitHistorySnapshot();
                historyRef.current.dragStart = null;
            }
        }
    }, [dragActive, commitHistorySnapshot]);
    useEffect(() => {
        const onKey = (e) => {
            // ✅ If user is typing somewhere, ignore all global shortcuts
            if (isTypingInFormField()) return;
            // Undo / Redo (don't steal browser undo when typing)
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
                e.preventDefault();
                undo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
                e.preventDefault();
                redo();
                return;
            }
            // Common alternative: Ctrl+Shift+Z => Redo
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "z" || e.key === "Z")) {
                e.preventDefault();
                redo();
                return;
            }


            // Arrow keys: nudge selection in the XZ plane (Shift = 10×)
            if (
                (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey
            ) {
                const raw = (Array.isArray(multiSel) && multiSel.length)
                    ? multiSel
                    : (selected ? [selected] : []);

                const hasAnySelection = (raw && raw.length) || !!selectedBreakpoint;
                if (!hasAnySelection) {
                    // Let the browser handle arrows (scroll) if nothing is selected
                } else {
                    e.preventDefault();

                    const baseSnap = Number(placement?.snap);
                    const step = (Number.isFinite(baseSnap) && baseSnap > 0) ? baseSnap : 0.1;
                    const amt = e.shiftKey ? (step * 10) : step;

                    let dx = 0;
                    let dz = 0;
                    if (e.key === "ArrowLeft") dx = -amt;
                    if (e.key === "ArrowRight") dx = amt;
                    if (e.key === "ArrowUp") dz = -amt;
                    if (e.key === "ArrowDown") dz = amt;

                    // Breakpoint nudge (if a breakpoint is selected)
                    if (selectedBreakpoint?.linkId != null) {
                        const linkId = selectedBreakpoint.linkId;
                        const bpIndex = selectedBreakpoint.index;
                        setLinks((prev) => prev.map((l) => {
                            if (l.id !== linkId) return l;
                            const bps = Array.isArray(l.breakpoints) ? [...l.breakpoints] : [];
                            const cur = bps[bpIndex] || [0, 0, 0];
                            bps[bpIndex] = [Number(cur[0]) + dx, Number(cur[1]) || 0, Number(cur[2]) + dz];
                            return { ...l, breakpoints: bps };
                        }));
                    }

                    // Build selection sets
                    const roomIds = new Set();
                    const nodeIds = new Set();
                    const pictureIds = new Set();
                    let wantsModel = false;
                    for (const it of (raw || [])) {
                        if (!it || !it.type) continue;
                        if (it.type === "room" && it.id) roomIds.add(it.id);
                        if (it.type === "node" && it.id) nodeIds.add(it.id);
                        if (it.type === "picture" && it.id) pictureIds.add(it.id);
                        if (it.type === "model") wantsModel = true;
                    }
                    if (selected?.type === "model") wantsModel = true;

                    // Respect locked rooms (don't move them, and don't move their nodes)
                    const movableRoomIds = new Set();
                    try {
                        const nowRooms = roomsRef?.current || [];
                        for (const id of roomIds) {
                            const r = nowRooms.find((x) => x.id === id);
                            if (r && !r.locked) movableRoomIds.add(id);
                        }
                    } catch {}

                    // Move rooms (and their contents)
                    if (movableRoomIds.size) {
                        setRooms((prev) => prev.map((r) => {
                            if (!movableRoomIds.has(r.id)) return r;
                            const c = r.center || [0, 0, 0];
                            const next = [Number(c[0]) + dx, Number(c[1]) || 0, Number(c[2]) + dz];
                            return { ...r, center: clampRoomToPictureDecks ? clampRoomToPictureDecks({ ...r, center: next }, next) : next };
                        }));

                        // Shift nodes that belong to moved rooms (same delta)
                        setNodes((prev) => prev.map((n) => {
                            if (!n?.roomId || !movableRoomIds.has(n.roomId)) return n;
                            const p = n.position || [0, 0, 0];
                            let next = [Number(p[0]) + dx, Number(p[1]) || 0, Number(p[2]) + dz];
                            if (clampNodeToPictureDecks) next = clampNodeToPictureDecks(n, next);
                            return { ...n, position: next };
                        }));
                    }

                    // Move nodes (skip nodes that belong to moved rooms to avoid double move)
                    if (nodeIds.size) {
                        setNodes((prev) => prev.map((n) => {
                            if (!n || !nodeIds.has(n.id)) return n;
                            if (n.roomId && movableRoomIds.has(n.roomId)) return n;
                            const p = n.position || [0, 0, 0];
                            let next = [Number(p[0]) + dx, Number(p[1]) || 0, Number(p[2]) + dz];
                            if (clampNodeToRoomBounds) next = clampNodeToRoomBounds(n, next);
                            if (clampNodeToPictureDecks) next = clampNodeToPictureDecks(n, next);
                            return { ...n, position: next };
                        }));
                    }

                    // Move pictures (if selected)
                    if (pictureIds.size) {
                        setImportedPictures((prev) => prev.map((pic) => {
                            if (!pic || !pictureIds.has(pic.id)) return pic;
                            return { ...pic, x: (Number(pic.x) || 0) + dx, z: (Number(pic.z) || 0) + dz };
                        }));
                    }

                    // Move the imported model
                    if (wantsModel) {
                        setModelPosition((prev) => {
                            const p = Array.isArray(prev) ? prev : [0, 0, 0];
                            return [Number(p[0]) + dx, Number(p[1]) || 0, Number(p[2]) + dz];
                        });
                    }

                    return; // don't fall through
                }
            }


            if (e.altKey) {
                const key = e.key.toLowerCase();
                let view = null;
                if (key === "w") view = "front";
                else if (key === "s") view = "back";
                else if (key === "a") view = "left";
                else if (key === "d") view = "right";
                else if (key === "q") view = "top";
                else if (key === "e") view = "bottom";

                if (view) {
                    e.preventDefault();
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(
                            new CustomEvent("EPIC3D_CAMERA_VIEW", { detail: { view } })
                        );
                    }
                    return; // don't fall through to other shortcuts
                }
            }
            if (e.key === "Escape") {
                const now = performance.now();
                const arr = escTimesRef.current.filter((t) => now - t < 3000);
                arr.push(now);
                escTimesRef.current = arr;

                if (prodMode && arr.length >= 3) {
                    setProdMode(false);
                    escTimesRef.current = [];
                    return;
                }
                setMoveMode(false);
                setTransformMode("translate");
                setSelected(null);
                setMultiSel([]);
                setSelectedBreakpoint(null);
                // Always cancel placement + selection + room operator
                setPlacement((p) => ({ ...p, armed: false }));
                setSelected(null);
                setMultiSel([]);
                setMode("select");
                setLinkFromId(null);
                setSelectedBreakpoint(null);
                setLevelFromNodeId(null);
                setRoomOperatorMode(false);
                setMarquee(null);
            }




            if (e.key === "Delete" && selected && selected.type !== "model") {
                e.preventDefault();
                requestDelete(selected);
            }

            if (
                (e.key === "d" || e.key === "D") &&
                (e.ctrlKey || e.metaKey) &&
                selected?.type === "node"
            ) {
                e.preventDefault();
                duplicateNode(selected.id);
            }
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selected, multiSel, selectedBreakpoint, placement, prodMode, duplicateNode, moveMode, undo, redo, clampNodeToRoomBounds, clampNodeToPictureDecks, clampRoomToPictureDecks]);

// Autosave
    useEffect(() => localStorage.setItem("epic3d.rooms.v7", JSON.stringify(rooms)), [rooms]);
    useEffect(() => localStorage.setItem("epic3d.nodes.v7", JSON.stringify(nodes)), [nodes]);
    useEffect(() => localStorage.setItem("epic3d.links.v7", JSON.stringify(links)), [links]);
    useEffect(() => localStorage.setItem("epic3d.actions.v7", JSON.stringify(actions)), [actions]);
    useEffect(() => localStorage.setItem("epic3d.linkDefaults.v1", JSON.stringify(linkDefaults)), [linkDefaults]);
    useEffect(() => {
        const meta = STATIC_MODELS.find(m => m.id === currentModelId);
        if (!meta) {
            if (STATIC_MODELS[0]) {
                // fallback so a model *always* shows
                setCurrentModelId(STATIC_MODELS[0].id);
            } else {
                setModelDescriptor(null);
                setModelBlob(null);
                setModelFilename("");
            }
            return;
        }
        setModelDescriptor({ type: meta.type, url: meta.url });
        setModelBlob(null);
        setModelFilename(`${meta.name}.${meta.type}`);
        localStorage.setItem("epic3d.static.current", meta.id);
    }, [currentModelId]);


    useEffect(() => {
        const stop = () => setUiInteracting(false);
        window.addEventListener("pointerup", stop);
        window.addEventListener("blur", stop);
        return () => {
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("blur", stop);
        };
    }, []);
// Helper: don't fire global shortcuts while typing in a form field
    const isTypingInFormField = () => {
        if (typeof document === "undefined") return false;
        const ae = document.activeElement;
        if (!ae) return false;
        const tag = ae.tagName;
        return (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            ae.isContentEditable
        );
    };
// Global keys




    const selectedNode = selected?.type === "node" ? nodes.find((n) => n.id === selected.id) : null;
    const selectedRoom = selected?.type === "room" ? rooms.find((r) => r.id === selected.id) : null;
    const selectedLink = selected?.type === "link" ? links.find((l) => l.id === selected.id) : null;

    const roomsNodesSubtitle = useMemo(() => {
        if (!selected) return "";
        if (selected.type === "room" && selectedRoom) {
            return `Selected: ${selectedRoom.name || selectedRoom.id} → Room`;
        }
        if (selected.type === "node" && selectedNode) {
            const roomName =
                selectedNode.roomId && rooms.find((r) => r.id === selectedNode.roomId)
                    ? rooms.find((r) => r.id === selectedNode.roomId).name
                    : "Unassigned";
            const cat = selectedNode.cluster || "Uncategorized";
            const label = selectedNode.label || selectedNode.id;
            return `Selected: ${roomName} → ${cat} → ${label}`;
        }
        return "";
    }, [selected, selectedRoom, selectedNode, rooms]);

    const linksSubtitle = useMemo(() => {
        if (!selected) return "";
        if (selected.type !== "link" || !selectedLink) return "";
        const a = nodes.find((n) => n.id === selectedLink.from);
        const b = nodes.find((n) => n.id === selectedLink.to);
        const aLabel = a?.label || selectedLink.from;
        const bLabel = b?.label || selectedLink.to;
        return `Selected: ${aLabel} → ${bLabel}`;
    }, [selected, selectedLink, nodes]);

    const setNode = (id, patch) => setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    const setNodeById = React.useCallback((id, patchOrFn) => {
        setNodes(prev =>
            prev.map(n => {
                if (n.id !== id) return n;
                const patch = typeof patchOrFn === "function" ? patchOrFn(n) : patchOrFn;
                return { ...n, ...patch };
            })
        );
    }, [setNodes]);

    // Daisy-chained light helpers
    // If a light has light.daisyChained=true, toggling/setting enabled will propagate
    // across the linked light graph (slaves + masters).
    const setLightEnabled = React.useCallback((startId, enabled) => {
        if (!startId) return;
        setNodes((prevNodes) => {
            const byId = new Map(prevNodes.map((n) => [n.id, n]));
            const start = byId.get(startId);
            if (!start) return prevNodes;

            const targetEnabled = !!enabled;
            const daisy = !!start.light?.daisyChained;

            // Non-daisy: only update the requested node
            if (!daisy) {
                return prevNodes.map((n) => {
                    if (n.id !== startId) return n;
                    if ((n.light?.type || "none") === "none") return n;
                    return {
                        ...n,
                        light: {
                            ...(n.light || {}),
                            enabled: targetEnabled,
                        },
                    };
                });
            }

            // Build undirected adjacency from links
            const adj = new Map();
            const L = Array.isArray(links) ? links : [];
            for (const l of L) {
                if (!l || !l.from || !l.to) continue;
                const a = l.from;
                const b = l.to;
                if (!adj.has(a)) adj.set(a, new Set());
                if (!adj.has(b)) adj.set(b, new Set());
                adj.get(a).add(b);
                adj.get(b).add(a);
            }

            // BFS across linked LIGHT nodes
            const visited = new Set();
            const q = [startId];
            visited.add(startId);
            const MAX = 512;

            while (q.length && visited.size < MAX) {
                const id = q.shift();
                const neigh = adj.get(id);
                if (!neigh) continue;
                for (const nb of neigh) {
                    if (visited.has(nb)) continue;
                    const nn = byId.get(nb);
                    if (!nn) continue;
                    if ((nn.light?.type || "none") === "none") continue;
                    visited.add(nb);
                    q.push(nb);
                    if (visited.size >= MAX) break;
                }
            }

            return prevNodes.map((n) => {
                if (!visited.has(n.id)) return n;
                if ((n.light?.type || "none") === "none") return n;
                return {
                    ...n,
                    light: {
                        ...(n.light || {}),
                        enabled: targetEnabled,
                    },
                };
            });
        });
    }, [links, setNodes]);

    const toggleLightEnabled = React.useCallback((startId) => {
        if (!startId) return;
        setNodes((prevNodes) => {
            const byId = new Map(prevNodes.map((n) => [n.id, n]));
            const start = byId.get(startId);
            if (!start) return prevNodes;

            // If the node isn't a light yet, create a sensible default (keeps Actions usable).
            const startLight = start.light || {};
            const startType = startLight.type && startLight.type !== "none" ? startLight.type : "point";
            const curEnabled = !!startLight.enabled;
            const targetEnabled = !curEnabled;

            const daisy = !!startLight.daisyChained;

            // Non-daisy: only update the requested node
            if (!daisy) {
                return prevNodes.map((n) => {
                    if (n.id !== startId) return n;
                    return {
                        ...n,
                        light: {
                            ...(n.light || {}),
                            type: startType,
                            intensity: (n.light?.intensity ?? 200),
                            distance: (n.light?.distance ?? 8),
                            enabled: targetEnabled,
                        },
                    };
                });
            }

            // Build undirected adjacency from links
            const adj = new Map();
            const L = Array.isArray(links) ? links : [];
            for (const l of L) {
                if (!l || !l.from || !l.to) continue;
                const a = l.from;
                const b = l.to;
                if (!adj.has(a)) adj.set(a, new Set());
                if (!adj.has(b)) adj.set(b, new Set());
                adj.get(a).add(b);
                adj.get(b).add(a);
            }

            const visited = new Set();
            const q = [startId];
            visited.add(startId);
            const MAX = 512;

            while (q.length && visited.size < MAX) {
                const id = q.shift();
                const neigh = adj.get(id);
                if (!neigh) continue;
                for (const nb of neigh) {
                    if (visited.has(nb)) continue;
                    const nn = byId.get(nb);
                    if (!nn) continue;
                    if ((nn.light?.type || "none") === "none") continue;
                    visited.add(nb);
                    q.push(nb);
                    if (visited.size >= MAX) break;
                }
            }

            return prevNodes.map((n) => {
                if (!visited.has(n.id)) return n;

                // Start node: ensure it becomes a light when toggling
                if (n.id === startId) {
                    return {
                        ...n,
                        light: {
                            ...(n.light || {}),
                            type: startType,
                            intensity: (n.light?.intensity ?? 200),
                            distance: (n.light?.distance ?? 8),
                            enabled: targetEnabled,
                        },
                    };
                }

                if ((n.light?.type || "none") === "none") return n;
                return {
                    ...n,
                    light: {
                        ...(n.light || {}),
                        enabled: targetEnabled,
                    },
                };
            });
        });
    }, [links, setNodes]);


    const handleSwitchPress = React.useCallback((nodeId, buttonIndex) => {
        if (!nodeId && nodeId !== 0) return;
        const idx = Math.max(0, Number(buttonIndex) || 0);

        const n = nodes.find((x) => x.id === nodeId);
        if (!n) return;
        if ((n.kind || "node") !== "switch") return;

        const sw = n.switch || {};
        const btn = (Array.isArray(sw.buttons) ? sw.buttons[idx] : null) || null;
        const ids = btn && Array.isArray(btn.actionIds) ? btn.actionIds : [];
        if (!ids.length) return;

        for (const aid of ids) {
            const a = actions.find((x) => x.id === aid);
            if (a) runAction(a);
        }
    }, [nodes, actions, runAction]);



    const setRoom = (id, patch) => setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    /* Import / Export */
    const onModelFiles = useCallback(async (fileOrList) => {
        const file = (fileOrList && fileOrList[0]) || fileOrList;
        if (!file) return;
        const ext = file.name.toLowerCase().split(".").pop();
        if (ext === "glb" || ext === "gltf") {
            const url = URL.createObjectURL(file);
            setModelDescriptor({ type: ext, url, cleanup: () => URL.revokeObjectURL(url) });
            setModelBlob(file);
            setModelFilename(file.name);
            return;
        }
        if (ext === "zip") {
            const zip = await JSZip.loadAsync(file);

            // Ignore macOS resource fork entries (e.g. __MACOSX/._model.gltf) which can be tiny and break parsing.
            const normalizeEntryName = (name) =>
                String(name || "")
                    .replace(/\\/g, "/")
                    .replace(/^\/+/, "");

            const isJunkEntry = (name) => {
                const n = normalizeEntryName(name).toLowerCase();
                if (!n) return true;
                if (n.startsWith("__macosx/")) return true;
                if (n.split("/").some((seg) => seg.startsWith("._"))) return true;
                if (n.endsWith(".ds_store") || n.endsWith("thumbs.db")) return true;
                return false;
            };

            const gltfCandidates = Object.values(zip.files).filter(
                (f) => !f.dir && f.name && f.name.toLowerCase().endsWith(".gltf") && !isJunkEntry(f.name),
            );
            const glbCandidates = Object.values(zip.files).filter(
                (f) => !f.dir && f.name && f.name.toLowerCase().endsWith(".glb") && !isJunkEntry(f.name),
            );

            const gltfEntry = gltfCandidates[0] || null;
            const glbEntry = glbCandidates[0] || null;

            const blobMap = new Map();
            const keyByLower = new Map();

            await Promise.all(
                Object.values(zip.files).map(async (f) => {
                    if (!f || f.dir) return;
                    if (isJunkEntry(f.name)) return;
                    const key = normalizeEntryName(f.name);
                    const b = await f.async("blob");
                    blobMap.set(key, b);
                    const lc = key.toLowerCase();
                    if (!keyByLower.has(lc)) keyByLower.set(lc, key);
                }),
            );

            const createdUrls = new Set();
            const urlCache = new Map();

            const resolveKey = (k) => {
                if (!k) return null;
                const key = normalizeEntryName(k);
                if (blobMap.has(key)) return key;
                const lc = key.toLowerCase();
                return keyByLower.get(lc) || null;
            };

            const makeURL = (nameOrKey) => {
                const key = resolveKey(nameOrKey);
                if (!key) return null;
                if (urlCache.has(key)) return urlCache.get(key);
                const b = blobMap.get(key);
                if (!b) return null;
                const u = URL.createObjectURL(b);
                urlCache.set(key, u);
                createdUrls.add(u);
                return u;
            };

            const cleanupAll = () => {
                createdUrls.forEach((u) => {
                    try {
                        URL.revokeObjectURL(u);
                    } catch {}
                });
                createdUrls.clear();
                urlCache.clear();
            };

            if (gltfEntry) {
                const gltfKey = resolveKey(gltfEntry.name);
                const gltfUrl = makeURL(gltfKey);
                if (!gltfUrl) {
                    alert("Could not read .gltf from zip");
                    return;
                }

                const base = (() => {
                    const n = normalizeEntryName(gltfEntry.name);
                    const parts = n.split("/");
                    parts.pop();
                    return parts.length ? parts.join("/") + "/" : "";
                })();

                const normalizePath = (p) => {
                    const parts = [];
                    String(p || "")
                        .replace(/\\/g, "/")
                        .split("/")
                        .forEach((seg) => {
                            if (!seg || seg === ".") return;
                            if (seg === "..") parts.pop();
                            else parts.push(seg);
                        });
                    return parts.join("/");
                };

                const urlModifier = (url) => {
                    if (!url) return url;
                    if (url.startsWith("blob:") || url.startsWith("data:")) return url;

                    let clean = url;
                    try {
                        clean = decodeURIComponent(url);
                    } catch {}
                    clean = clean.split(/[?#]/)[0].replace(/\\/g, "/");
                    clean = clean.replace(/^\/+/, "");
                    clean = clean.replace(/^(\.\/)+/, "");

                    const rel = clean;
                    const justName = rel.split("/").pop();

                    const candidates = [];
                    if (base) candidates.push(normalizePath(base + rel));
                    candidates.push(normalizePath(rel));
                    if (base && justName) candidates.push(normalizePath(base + justName));
                    if (justName) candidates.push(justName);

                    // If we still can't find it, try a suffix match by basename (helps when gltf paths differ from zip folders).
                    const trySuffixMatch = () => {
                        const baseName = (justName || "").toLowerCase();
                        if (!baseName) return null;
                        const matches = [];
                        for (const k of blobMap.keys()) {
                            const kl = k.toLowerCase();
                            if (kl === baseName || kl.endsWith("/" + baseName)) matches.push(k);
                        }
                        if (matches.length === 1) return matches[0];
                        return null;
                    };

                    for (const cand of candidates) {
                        const key = resolveKey(cand);
                        if (key && blobMap.has(key)) {
                            const u = makeURL(key);
                            if (u) return u;
                        }
                    }

                    const suffixKey = trySuffixMatch();
                    if (suffixKey) {
                        const u = makeURL(suffixKey);
                        if (u) return u;
                    }

                    return url;
                };

                // IMPORTANT: keep descriptor.type compatible with existing loader logic.
                setModelDescriptor({ type: "zip:gltf", url: gltfUrl, urlModifier, cleanup: cleanupAll });
                setModelBlob(file);
                setModelFilename(file.name);
                return;
            }

            if (glbEntry) {
                const url = makeURL(glbEntry.name);
                if (!url) {
                    alert("Could not read .glb from zip");
                    return;
                }
                setModelDescriptor({ type: "zip:glb", url, cleanup: cleanupAll });
                setModelBlob(file);
                setModelFilename(file.name);
                return;
            }

            alert("Zip must contain a .gltf or .glb");
            return;
        }
        alert("Unsupported model type (use .glb/.gltf or .zip)");
    }, []);

    const fileRef = useRef(null);

    // ---------------------------------------------------------------------
    // Merge (non-destructive import)
    // ---------------------------------------------------------------------
    const [mergeOpen, setMergeOpen] = useState(false);
    const mergeFileRef = useRef(null);
    const [mergeIncoming, setMergeIncoming] = useState(null); // { file, ext, obj, zip, hasBundledModel, modelEntryName }
    const [mergeOptions, setMergeOptions] = useState(() => ({
        graph: true,
        decks: true,
        groups: true,
        actions: true,
        pictures: true,
        settings: true,
        hud: true,
        prefs: true,
        products: true,
        model: false,
    }));
    const [mergeFlags, setMergeFlags] = useState(() => ({
        overwrite: false,
        addNew: true,
    }));
    const [mergePlan, setMergePlan] = useState(null);

    const MergeToggle = useCallback(({ label, on, onClick, title, style }) => (
        <Btn
            onClick={onClick}
            title={title}
            variant={on ? "primary" : "ghost"}
            style={{
                height: 34,
                padding: "0 10px",
                borderRadius: 10,
                fontSize: 12,
                minWidth: 64,
                ...style,
            }}
        >
            {label}
        </Btn>
    ), []);

    const openMergeDialog = useCallback(() => {
        setMergeIncoming(null);
        setMergePlan(null);
        setMergeFlags({ overwrite: false, addNew: true });
        setMergeOptions({
            graph: true,
            decks: true,
            groups: true,
            actions: true,
            pictures: true,
            settings: true,
            hud: true,
            prefs: true,
            products: true,
            model: false,
        });
        setMergeOpen(true);
    }, []);

    const normalizeForCompare = useCallback((v) => {
        if (v == null) return v;
        if (typeof v !== "object") return v;

        if (Array.isArray(v)) {
            // If it's an array of identifiable objects, sort by id for stable comparison.
            const allHaveId = v.every((x) => x && typeof x === "object" && ("id" in x) && x.id != null);
            const arr = allHaveId
                ? [...v].sort((a, b) => String(a.id).localeCompare(String(b.id)))
                : [...v];
            return arr.map((x) => normalizeForCompare(x));
        }

        const out = {};
        Object.keys(v)
            .sort()
            .forEach((k) => {
                out[k] = normalizeForCompare(v[k]);
            });
        return out;
    }, []);

    const stableStringify = useCallback((v) => {
        try {
            return JSON.stringify(normalizeForCompare(v));
        } catch {
            return String(v);
        }
    }, [normalizeForCompare]);

    const deepEqualStable = useCallback((a, b) => {
        return stableStringify(a) === stableStringify(b);
    }, [stableStringify]);

    const entityKey = useCallback((item, idx = 0) => {
        if (!item) return `__nil__${idx}`;
        if (item.id != null) return String(item.id);
        if (item.key != null) return String(item.key);
        if (item.uuid != null) return String(item.uuid);
        if (typeof item.url === "string" && item.url) return `url:${item.url}`;
        if (typeof item.name === "string" && item.name) return `name:${item.name}`;
        return `obj:${stableStringify(item)}:${idx}`;
    }, [stableStringify]);

    const diffArray = useCallback((currentArr, incomingArr, keyFn) => {
        const cur = Array.isArray(currentArr) ? currentArr : [];
        const inc = Array.isArray(incomingArr) ? incomingArr : [];

        const curMap = new Map();
        cur.forEach((it, i) => curMap.set(keyFn(it, i), it));

        let same = 0;
        let changed = 0;
        let added = 0;

        inc.forEach((it, i) => {
            const k = keyFn(it, i);
            if (!curMap.has(k)) {
                added++;
                return;
            }
            const curIt = curMap.get(k);
            if (deepEqualStable(curIt, it)) same++;
            else changed++;
        });

        return { totalIncoming: inc.length, same, changed, added };
    }, [deepEqualStable]);

    const mergeArray = useCallback((currentArr, incomingArr, { addNew, overwriteChanges, keyFn }) => {
        const cur = Array.isArray(currentArr) ? currentArr : [];
        const inc = Array.isArray(incomingArr) ? incomingArr : [];

        const map = new Map();
        const order = [];
        cur.forEach((it, i) => {
            const k = keyFn(it, i);
            if (!map.has(k)) order.push(k);
            map.set(k, it);
        });

        inc.forEach((it, i) => {
            const k = keyFn(it, i);
            if (!map.has(k)) {
                if (addNew) {
                    map.set(k, it);
                    order.push(k);
                }
                return;
            }
            const curIt = map.get(k);
            if (deepEqualStable(curIt, it)) return; // identical → skip
            if (overwriteChanges) {
                map.set(k, it);
            }
        });

        return order.map((k) => map.get(k));
    }, [deepEqualStable]);

    const parseScenePackage = useCallback(async (file) => {
        const ext = String(file?.name || "").toLowerCase().split(".").pop();
        if (ext !== "zip" && ext !== "json") {
            throw new Error("Unsupported merge file. Use .zip or .json export.");
        }

        if (ext === "json") {
            const txt = await file.text();
            const obj = JSON.parse(txt || "{}");
            return { ext, file, obj, zip: null, hasBundledModel: false, modelEntryName: null };
        }

        const zip = await JSZip.loadAsync(file);
        const sceneFile = zip.file("scene.json");
        if (!sceneFile) {
            throw new Error("scene.json not found in zip.");
        }
        const txt = await sceneFile.async("string");
        const obj = JSON.parse(txt || "{}");

        const modelEntry = Object.values(zip.files).find((f) => f.name.startsWith("models/") && !f.dir);
        const hasBundledModel = !!modelEntry;
        const modelEntryName = modelEntry ? modelEntry.name : null;

        return { ext, file, obj, zip, hasBundledModel, modelEntryName };
    }, []);

    const computeMergePlan = useCallback((incomingObj, options) => {
        if (!incomingObj) return null;
        const obj = incomingObj.obj || {};

        const incRooms = obj.rooms || [];
        const incNodes = obj.nodes || [];
        const incLinks = obj.links || [];
        const incDecks = obj.decks || [];
        const incGroups = obj.groups || [];
        const incActions = obj.actions || [];
        const incPics = Array.isArray(obj.pictures) ? obj.pictures : (Array.isArray(obj.pictures?.items) ? obj.pictures.items : []);

        const plan = {
            meta: {
                fileName: incomingObj.file?.name || "",
                projectName: obj.project?.name || "",
                version: obj.version ?? "",
            },
            graph: options.graph ? {
                rooms: diffArray(rooms, incRooms, entityKey),
                nodes: diffArray(nodes, incNodes, entityKey),
                links: diffArray(links, incLinks, entityKey),
            } : null,
            decks: options.decks ? diffArray(decks, incDecks, entityKey) : null,
            groups: options.groups ? diffArray(groups, incGroups, entityKey) : null,
            actions: options.actions ? diffArray(actions, incActions, entityKey) : null,
            pictures: options.pictures ? diffArray(importedPictures, incPics, (p, i) => {
                // pictures can be id-less → best-effort stable key
                if (p && p.id != null) return String(p.id);
                if (p && p.url) return `url:${p.url}`;
                if (p && p.src) return `src:${p.src}`;
                return entityKey(p, i);
            }) : null,
            settings: null,
            prefs: null,
            hud: null,
            products: null,
            model: null,
        };

        if (options.settings) {
            const changedSections = [];
            const sectionDiff = (name, a, b) => {
                if (!deepEqualStable(a, b)) changedSections.push(name);
            };
            sectionDiff("view", {
                bg,
                roomOpacity,
                wireframe,
                wireOpacity,
                wireDetail,
                wireHideSurfaces,
                wireStroke,
                showLights,
                showLightBounds,
                showGround,
                animate,
                perf,
                shadowsOn,
                wireReveal,
            }, obj.view || {});
            sectionDiff("productsView", {
                productScale,
                showDimsGlobal,
                photoDefault,
                productUnits,
            }, obj.productsView || {});
            sectionDiff("linkDefaults", linkDefaults, obj.linkDefaults || null);
            sectionDiff("roomGap", roomGap, obj.roomGap || null);
            sectionDiff("placement", placement, obj.placement || null);
            sectionDiff("camera", { presets: cameraPresets, activePresetId: cameraPresetId, defaultPose }, obj.camera || null);
            sectionDiff("actionsHud", actionsHud, obj.actionsHud || null);
            sectionDiff("buttonStates", buttonStates, obj.buttonStates || null);
            sectionDiff("ui", {
                prodMode,
                modelVisible,
                modelScale,
                modelPosition,
                alwaysShow3DInfo,
                currentModelId,
                snapRoomsEnabled,
                snapRoomsDistance,
                labelsOn,
                labelMode,
                labelSize,
                mode,
                selectionMode,
                moveMode,
                transformMode,
            }, obj.ui || null);

            plan.settings = {
                changedSections,
                changedCount: changedSections.length,
            };
        }

        if (options.prefs) {
            const incomingPrefs = obj.epicPrefs || {};
            let same = 0;
            let changed = 0;
            let added = 0;
            try {
                if (typeof window !== "undefined" && window.localStorage) {
                    const ls = window.localStorage;
                    Object.entries(incomingPrefs).forEach(([k, v]) => {
                        const cur = ls.getItem(k);
                        if (cur == null) { added++; return; }
                        if (String(cur) === String(v ?? "")) same++;
                        else changed++;
                    });
                }
            } catch {}
            plan.prefs = { totalIncoming: Object.keys(incomingPrefs).length, same, changed, added };
        }

        if (options.hud) {
            // HUD is stored in localStorage keys; compare against incoming hud block if present.
            const incomingHud = obj.hud || null;
            let changed = 0;
            if (incomingHud) {
                try {
                    const ls = typeof window !== "undefined" ? window.localStorage : null;
                    const curCfg = ls ? JSON.parse(ls.getItem("epic3d.hudConfig.v1") || "null") : null;
                    const curLayout = ls ? JSON.parse(ls.getItem("epic3d.hudLayout.v3") || "null") : null;
                    const curVisible = ls ? JSON.parse(ls.getItem("epic3d.hudVisible.v1") || "null") : null;
                    const curStyles = ls ? JSON.parse(ls.getItem("epic3d.hudStyles.v1") || "null") : null;

                    if (!deepEqualStable(curCfg || {}, incomingHud.cfg || {})) changed++;
                    if (!deepEqualStable(curLayout || {}, incomingHud.layout || {})) changed++;
                    if (!deepEqualStable(curVisible || {}, incomingHud.visibleMap || {})) changed++;
                    if (!deepEqualStable(curStyles || {}, incomingHud.stylePresets || {})) changed++;
                } catch {
                    // if parsing fails, treat as changed
                    changed = 4;
                }
            }
            plan.hud = { hasIncoming: !!incomingHud, changedBlocks: changed };
        }

        if (options.products) {
            const incomingProducts = obj.products?.items || [];
            let currentProducts = [];
            try {
                const all = listProducts && listProducts();
                if (Array.isArray(all)) currentProducts = all;
            } catch {}
            plan.products = diffArray(currentProducts, incomingProducts, (p, i) => (p && p.id != null ? String(p.id) : entityKey(p, i)));
        }

        if (options.model) {
            plan.model = {
                hasBundledModel: !!incomingObj.hasBundledModel,
                incomingStaticId: obj.model?.staticId || obj.ui?.currentModelId || "",
                incomingFilename: obj.model?.filename || "",
            };
        }

        return plan;
    }, [
        rooms,
        nodes,
        links,
        decks,
        groups,
        actions,
        importedPictures,
        entityKey,
        diffArray,
        deepEqualStable,
        bg,
        roomOpacity,
        wireframe,
        wireOpacity,
        wireDetail,
        wireHideSurfaces,
        wireStroke,
        showLights,
        showLightBounds,
        showGround,
        animate,
        perf,
        shadowsOn,
        wireReveal,
        productScale,
        showDimsGlobal,
        photoDefault,
        productUnits,
        linkDefaults,
        roomGap,
        placement,
        cameraPresets,
        cameraPresetId,
        defaultPose,
        actionsHud,
        buttonStates,
        prodMode,
        modelVisible,
        modelScale,
        alwaysShow3DInfo,
        currentModelId,
        snapRoomsEnabled,
        snapRoomsDistance,
        labelsOn,
        labelMode,
        labelSize,
        mode,
        selectionMode,
        moveMode,
        transformMode,
    ]);

    const loadMergeFile = useCallback(async (file) => {
        const incoming = await parseScenePackage(file);
        setMergeIncoming(incoming);
        setMergePlan(computeMergePlan(incoming, mergeOptions));
    }, [parseScenePackage, computeMergePlan, mergeOptions]);

    useEffect(() => {
        if (!mergeIncoming) return;
        setMergePlan(computeMergePlan(mergeIncoming, mergeOptions));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mergeOptions, mergeIncoming]);

    const applyMerge = useCallback(async () => {
        if (!mergeIncoming) return;

        const obj = mergeIncoming.obj || {};
        const addNew = !!mergeFlags.addNew;
        const overwriteChanges = !!mergeFlags.overwrite;

        // --- Core graph ---
        if (mergeOptions.graph) {
            setRooms((prev) => mergeArray(prev, obj.rooms || [], { addNew, overwriteChanges, keyFn: entityKey }));
            setNodes((prev) => mergeArray(prev, obj.nodes || [], { addNew, overwriteChanges, keyFn: entityKey }));
            setLinks((prev) => mergeArray(prev, obj.links || [], { addNew, overwriteChanges, keyFn: entityKey }));
        }

        if (mergeOptions.decks) {
            setDecks((prev) => mergeArray(prev, obj.decks || [], { addNew, overwriteChanges, keyFn: entityKey }));
        }
        if (mergeOptions.groups) {
            setGroups((prev) => mergeArray(prev, obj.groups || [], { addNew, overwriteChanges, keyFn: entityKey }));
        }
        if (mergeOptions.actions) {
            setActions((prev) => mergeArray(prev, obj.actions || [], { addNew, overwriteChanges, keyFn: entityKey }));
        }
        if (mergeOptions.pictures) {
            const picKey = (p, i) => {
                if (p && p.id != null) return String(p.id);
                if (p && p.url) return `url:${p.url}`;
                if (p && p.src) return `src:${p.src}`;
                return entityKey(p, i);
            };
            setImportedPictures((prev) => {
                const mergedPics = mergeArray(prev, obj.pictures || [], { addNew, overwriteChanges, keyFn: picKey });
                try {
                    window.localStorage.setItem(PICTURES_KEY, JSON.stringify(mergedPics));
                } catch {}
                return mergedPics;
            });
        }

        // --- Settings ---
        if (mergeOptions.settings) {
            // Overwrite-only for settings (unless current section is missing and addNew is enabled)
            const canApply = overwriteChanges;

            if (obj.view && canApply) {
                const v = obj.view;
                if (v.bg !== undefined) setBg(v.bg);
                if (v.roomOpacity !== undefined) setRoomOpacity(v.roomOpacity);
                if (v.wireframe !== undefined) setWireframe(v.wireframe);
                if (v.wireOpacity !== undefined) setWireOpacity(v.wireOpacity);
                if (v.wireDetail !== undefined && setWireDetail) setWireDetail(v.wireDetail);
                if (v.wireHideSurfaces !== undefined) setWireHideSurfaces(v.wireHideSurfaces);
                if (v.wireStroke && typeof v.wireStroke === "object") setWireStroke((d) => ({ ...(d || {}), ...v.wireStroke }));
                if (v.showLights !== undefined) setShowLights(v.showLights);
                if (v.showLightBounds !== undefined) setShowLightBounds(v.showLightBounds);
                if (v.showGround !== undefined) setShowGround(v.showGround);
                if (v.animate !== undefined) setAnimate(v.animate);
                if (v.perf !== undefined) setPerf(v.perf);
                if (v.shadowsOn !== undefined) setShadowsOn(v.shadowsOn);
                if (v.wireReveal !== undefined) setWireReveal(v.wireReveal);
            }

            if (obj.productsView && canApply) {
                const pv = obj.productsView;
                if (pv.productScale !== undefined) setProductScale(pv.productScale);
                if (pv.showDimsGlobal !== undefined) setShowDimsGlobal(pv.showDimsGlobal);
                if (pv.photoDefault !== undefined) setPhotoDefault(pv.photoDefault);
                if (pv.productUnits !== undefined) setProductUnits(pv.productUnits);
            }

            if (obj.linkDefaults && canApply) setLinkDefaults(obj.linkDefaults);
            if (obj.roomGap && canApply) setRoomGap(obj.roomGap);
            if (obj.placement && canApply) setPlacement(obj.placement);

            if (obj.camera && canApply) {
                const cam = obj.camera;
                if (Array.isArray(cam.presets)) setCameraPresets(cam.presets);
                if (cam.activePresetId !== undefined) setCameraPresetId(cam.activePresetId || "");
                if (cam.defaultPose !== undefined) setDefaultPose(cam.defaultPose);
            }

            if (obj.actionsHud && canApply) setActionsHud(obj.actionsHud);
            if (obj.buttonStates && canApply) setButtonStates(obj.buttonStates);

            if (obj.ui && canApply) {
                const u = obj.ui;
                if (u.prodMode !== undefined) setProdMode(!!u.prodMode);
                if (u.modelVisible !== undefined) setModelVisible(!!u.modelVisible);
                if (u.modelScale !== undefined) setModelScale(Number(u.modelScale) || 1);
                if (u.modelPosition && Array.isArray(u.modelPosition) && u.modelPosition.length >= 3) setModelPosition([Number(u.modelPosition[0]) || 0, Number(u.modelPosition[1]) || 0, Number(u.modelPosition[2]) || 0]);
                if (u.alwaysShow3DInfo !== undefined) setAlwaysShow3DInfo(!!u.alwaysShow3DInfo);
                if (u.currentModelId) setCurrentModelId(u.currentModelId);
                if (u.snapRooms) {
                    if (u.snapRooms.enabled !== undefined) setSnapRoomsEnabled(!!u.snapRooms.enabled);
                    if (u.snapRooms.distance !== undefined) setSnapRoomsDistance(Number(u.snapRooms.distance) || 0.5);
                }
                if (u.labels) {
                    if (u.labels.on !== undefined) setLabelsOn(!!u.labels.on);
                    if (u.labels.mode) setLabelMode(u.labels.mode);
                    if (u.labels.size !== undefined) setLabelSize(Number(u.labels.size) || 0.24);
                }
                if (u.wire) {
                    if (u.wire.hideSurfaces !== undefined) setWireHideSurfaces(!!u.wire.hideSurfaces);
                    if (u.wire.stroke && typeof u.wire.stroke === "object") setWireStroke((d) => ({ ...(d || {}), ...u.wire.stroke }));
                }
                if (u.editor) {
                    if (u.editor.mode) setMode(u.editor.mode);
                    if (u.editor.selectionMode) setSelectionMode(u.editor.selectionMode);
                    if (u.editor.moveMode !== undefined) setMoveMode(!!u.editor.moveMode);
                    if (u.editor.transformMode) setTransformMode(u.editor.transformMode);
                }
            }

            // If they disabled overwrite but want to addNew and some setting section is missing (rare), allow it.
            if (!canApply && addNew) {
                // no-op for now; settings are always present in this app
            }
        }

        // --- HUD block (localStorage)
        if (mergeOptions.hud && obj.hud && typeof window !== "undefined" && window.localStorage) {
            if (overwriteChanges) {
                try {
                    const h = obj.hud;
                    const ls = window.localStorage;
                    if (h.cfg !== undefined) ls.setItem("epic3d.hudConfig.v1", JSON.stringify(h.cfg));
                    if (h.layout !== undefined) ls.setItem("epic3d.hudLayout.v3", JSON.stringify(h.layout));
                    if (h.visibleMap !== undefined) ls.setItem("epic3d.hudVisible.v1", JSON.stringify(h.visibleMap));
                    if (h.stylePresets !== undefined) ls.setItem("epic3d.hudStyles.v1", JSON.stringify(h.stylePresets));
                } catch (err) {
                    console.warn("Failed to merge HUD layout/styles", err);
                }
            }
        }

        // --- epic3d.* prefs (localStorage)
        if (mergeOptions.prefs && obj.epicPrefs && typeof window !== "undefined" && window.localStorage) {
            try {
                const ls = window.localStorage;
                Object.entries(obj.epicPrefs).forEach(([k, v]) => {
                    const cur = ls.getItem(k);
                    const incomingVal = String(v ?? "");
                    if (cur == null) {
                        if (addNew) ls.setItem(k, incomingVal);
                        return;
                    }
                    if (String(cur) === incomingVal) return;
                    if (overwriteChanges) ls.setItem(k, incomingVal);
                });
            } catch (err) {
                console.warn("Failed to merge epic3d.* prefs", err);
            }
        }

        // --- products DB
        if (mergeOptions.products && obj.products && Array.isArray(obj.products.items)) {
            let currentProducts = [];
            try {
                const all = listProducts && listProducts();
                if (Array.isArray(all)) currentProducts = all;
            } catch {}
            const curMap = new Map();
            currentProducts.forEach((p, i) => curMap.set(p && p.id != null ? String(p.id) : entityKey(p, i), p));

            obj.products.items.forEach((p, i) => {
                const k = p && p.id != null ? String(p.id) : entityKey(p, i);
                if (!curMap.has(k)) {
                    if (addNew && upsertProduct) upsertProduct(p);
                    return;
                }
                const curP = curMap.get(k);
                if (deepEqualStable(curP, p)) return;
                if (overwriteChanges && upsertProduct) upsertProduct(p);
            });
        }

        // --- model bytes (optional)
        if (mergeOptions.model) {
            try {
                const incomingStaticId = obj.model?.staticId || obj.ui?.currentModelId || "";

                if (mergeIncoming.ext === "zip" && mergeIncoming.zip && mergeIncoming.modelEntryName) {
                    const shouldLoadBundled = overwriteChanges || (addNew && !modelBlob && !modelDescriptor);
                    if (shouldLoadBundled) {
                        const entry = mergeIncoming.zip.file(mergeIncoming.modelEntryName);
                        if (entry) {
                            const blob = await entry.async("blob");
                            const fname = mergeIncoming.modelEntryName.split("/").pop() || "model.glb";
                            let fileLike = blob;
                            if (typeof File !== "undefined") {
                                fileLike = new File([blob], fname, { type: blob.type || "application/octet-stream" });
                            } else {
                                fileLike = Object.assign(blob, { name: fname });
                            }
                            await onModelFiles(fileLike);
                        }
                    }
                } else if (incomingStaticId) {
                    const shouldApplyStatic = overwriteChanges || (addNew && !currentModelId && !modelBlob);
                    if (shouldApplyStatic) setCurrentModelId(incomingStaticId);
                }
            } catch (err) {
                console.warn("Failed to merge model", err);
            }
        }

        // Remount HUD if we touched LS-based layout.
        if ((mergeOptions.hud && obj.hud) || (mergeOptions.prefs && obj.epicPrefs)) {
            setHudVersion((v) => v + 1);
        }

        setMergeOpen(false);
    }, [
        mergeIncoming,
        mergeFlags,
        mergeOptions,
        mergeArray,
        entityKey,
        importedPictures,
        deepEqualStable,
        setRooms,
        setNodes,
        setLinks,
        setDecks,
        setGroups,
        setActions,
        setImportedPictures,
        setBg,
        setRoomOpacity,
        setWireframe,
        setWireOpacity,
        setWireDetail,
        setWireHideSurfaces,
        setWireStroke,
        setShowLights,
        setShowLightBounds,
        setShowGround,
        setAnimate,
        setPerf,
        setShadowsOn,
        setWireReveal,
        setProductScale,
        setShowDimsGlobal,
        setPhotoDefault,
        setProductUnits,
        setLinkDefaults,
        setRoomGap,
        setPlacement,
        setCameraPresets,
        setCameraPresetId,
        setDefaultPose,
        setActionsHud,
        setButtonStates,
        setProdMode,
        setModelVisible,
        setModelScale,
        setAlwaysShow3DInfo,
        setCurrentModelId,
        setSnapRoomsEnabled,
        setSnapRoomsDistance,
        setLabelsOn,
        setLabelMode,
        setLabelSize,
        setMode,
        setSelectionMode,
        setMoveMode,
        setTransformMode,
        setHudVersion,
        modelBlob,
        modelDescriptor,
        currentModelId,
        onModelFiles,
    ]);

    const exportZip = async () => {
        const zip = new JSZip();

        // --- live camera snapshot (if SceneInner wired it up) ---
        let liveCamera = null;
        try {
            if (cameraSnapshotRef.current) {
                // expected: { position:[x,y,z], target:[x,y,z], fov:number }
                liveCamera = cameraSnapshotRef.current();
            }
        } catch (err) {
            console.warn("Camera snapshot failed, continuing without liveCamera", err);
        }

        // --- HUD layout / styles / visibility (bottom action HUD) ---
        let hudCfg = null;
        let hudLayout = null;
        let hudVisible = null;
        let hudStyles = null;
        try {
            if (typeof window !== "undefined" && window.localStorage) {
                const ls = window.localStorage;
                hudCfg     = JSON.parse(ls.getItem("epic3d.hudConfig.v1")  || "null");
                hudLayout  = JSON.parse(ls.getItem("epic3d.hudLayout.v3")  || "null");
                hudVisible = JSON.parse(ls.getItem("epic3d.hudVisible.v1") || "null");
                hudStyles  = JSON.parse(ls.getItem("epic3d.hudStyles.v1")  || "null");
            }
        } catch (err) {
            console.warn("Failed to read HUD layout/styles from localStorage", err);
        }

        // --- Capture ALL persistent epic3d.* prefs (top bar, model scale, panel widths, etc) ---
        let epicPrefs = {};
        try {
            if (typeof window !== "undefined" && window.localStorage) {
                const ls = window.localStorage;
                for (let i = 0; i < ls.length; i++) {
                    const key = ls.key(i);
                    if (key && key.startsWith("epic3d.")) {
                        // store raw string; we restore it as-is
                        epicPrefs[key] = ls.getItem(key);
                    }
                }
            }
        } catch (err) {
            console.warn("Failed to read epic3d.* prefs from localStorage", err);
        }

        // --- Capture full product DB (names, images, dims, etc.) ---
        let productsDump = [];
        try {
            const all = listProducts && listProducts();
            if (Array.isArray(all)) {
                productsDump = all;
            }
        } catch (err) {
            console.warn("Failed to list products for export", err);
        }

        const payload = {
            version: 14,                          // bump version so you know this format
            project: { name: projectName || "Showcase" },

            // --- core graph ---
            nodes,
            rooms,
            links,
            decks,
            groups,
            actions,
            pictures: importedPictures,

            // --- “classic” Actions HUD (right pane grid) ---
            actionsHud,
            buttonStates,

            // --- bottom HUD layout/styles/visibility ---
            hud: {
                cfg: hudCfg || {},
                layout: hudLayout || {},
                visibleMap: hudVisible || {},
                stylePresets: hudStyles || {},
            },

            // --- linking defaults & room FX ---
            linkDefaults,
            roomGap,
            placement,

            // --- camera & cinematic system ---
            camera: {
                presets: cameraPresets,
                activePresetId: cameraPresetId || "",
                defaultPose: defaultPose,
                liveSnapshot: liveCamera,
            },

            // --- view & performance flags ---
            view: {
                bg,
                roomOpacity,
                wireframe,
                wireOpacity,
                wireDetail,
                wireHideSurfaces,
                wireStroke,
                showLights,
                showLightBounds,
                showGround,
                animate,
                perf,
                shadowsOn,
                wireReveal,
            },

            // --- product display prefs (used by Node3D / racks) ---
            productsView: {
                productScale,
                showDimsGlobal,
                photoDefault,
                productUnits,
            },

            // --- UI / prefs (non-graph state that still matters for a full restore) ---
            ui: {
                prodMode,
                modelVisible,
                modelScale,
                modelPosition,
                alwaysShow3DInfo,
                currentModelId,
                snapRooms: { enabled: snapRoomsEnabled, distance: snapRoomsDistance },
                labels: { on: labelsOn, mode: labelMode, size: labelSize },
                wire: { hideSurfaces: wireHideSurfaces, stroke: wireStroke },
                editor: { mode, selectionMode, moveMode, transformMode },
            },

            // --- model descriptor (not the bytes; bytes are added below) ---
            model: {
                filename: modelFilename,
                type: modelDescriptor?.type || null,
                source: modelBlob ? "file" : (modelDescriptor ? "static" : null),
                staticId: currentModelId || "",
                visible: modelVisible,
                scale: modelScale,
                position: modelPosition,
            },

            // --- NEW: all epic3d.* prefs (top bar, model scale, panel widths, etc) ---
            epicPrefs,

            // --- NEW: full product DB dump (names, images, dims, etc.) ---
            products: {
                items: productsDump,
            },
        };

        // main scene.json
        zip.file("scene.json", JSON.stringify(payload, null, 2));

        // --- bundle the model, if any ---
        if (modelBlob) {
            const modelsFolder = zip.folder("models");
            if (modelsFolder) {
                modelsFolder.file(modelFilename || "model.glb", modelBlob);
            }
        }

        // (optional backwards compat: still allow products.db.json if you want)
        // NOT required anymore, but kept in case you have existing tools that use it:
        /*
        try {
          const productsBlob = exportProductsBlob && exportProductsBlob();
          if (productsBlob) {
            zip.file("products.db.json", productsBlob);
          }
        } catch (err) {
          console.warn("Failed to export products DB; continuing without products.db.json", err);
        }
        */

        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, (projectName || "showcase") + ".zip");
    };




    const importPackage = async (file) => {
        const ext = file.name.toLowerCase().split(".").pop();
        try {
            if (ext === "zip") {
                const zip = await JSZip.loadAsync(file);
                const sceneFile = zip.file("scene.json");
                if (!sceneFile) {
                    alert("scene.json not found in package");
                    return;
                }

                const txt = await sceneFile.async("string");
                const obj = JSON.parse(txt || "{}");

                // --- bundled model (if any) ---
                const modelEntry = Object.values(zip.files).find((f) => f.name.startsWith("models/") && !f.dir);
                const hasBundledModel = !!modelEntry;

                // --- core graph ---
                setRooms(obj.rooms || []);
                setNodes(obj.nodes || []);
                setLinks(obj.links || []);
                setDecks(obj.decks || []);
                setGroups(obj.groups || []);
                setActions(obj.actions || []);

                // --- classic Actions HUD (grid/snap) ---
                if (obj.actionsHud) setActionsHud(obj.actionsHud);
                if (obj.buttonStates) setButtonStates(obj.buttonStates);

                // --- bottom HUD layout/styles/visibility ---
                if (obj.hud && typeof window !== "undefined" && window.localStorage) {
                    const h = obj.hud;
                    const ls = window.localStorage;
                    try {
                        if (h.cfg !== undefined)        ls.setItem("epic3d.hudConfig.v1",  JSON.stringify(h.cfg));
                        if (h.layout !== undefined)     ls.setItem("epic3d.hudLayout.v3",  JSON.stringify(h.layout));
                        if (h.visibleMap !== undefined) ls.setItem("epic3d.hudVisible.v1", JSON.stringify(h.visibleMap));
                        if (h.stylePresets !== undefined) ls.setItem("epic3d.hudStyles.v1", JSON.stringify(h.stylePresets));
                    } catch (err) {
                        console.warn("Failed to restore HUD layout/styles from scene", err);
                    }
                }

                // --- Restore ALL epic3d.* prefs (top bar, model scale, panel widths, etc) ---
                if (obj.epicPrefs && typeof window !== "undefined" && window.localStorage) {
                    const ls = window.localStorage;
                    try {
                        Object.entries(obj.epicPrefs).forEach(([key, value]) => {
                            if (typeof value === "string" || value == null) {
                                ls.setItem(key, value ?? "");
                            } else {
                                ls.setItem(key, JSON.stringify(value));
                            }
                        });
                    } catch (err) {
                        console.warn("Failed to restore epic3d.* prefs", err);
                    }
                }

                // --- Refresh picture overlays from restored localStorage ---
                try {
                    if (typeof window !== "undefined" && window.localStorage) {
                        const raw = window.localStorage.getItem(PICTURES_KEY);
                        const parsed = raw ? JSON.parse(raw) : [];
                        setImportedPictures(Array.isArray(parsed) ? parsed : []);
                    }
                } catch (err) {
                    console.warn("Failed to restore imported pictures", err);
                }

                // --- link defaults & room FX ---
                if (obj.linkDefaults) setLinkDefaults(obj.linkDefaults);
                if (obj.roomGap)      setRoomGap(obj.roomGap);
                if (obj.placement)    setPlacement(obj.placement);

                // --- camera & cinematic system ---
                if (obj.camera) {
                    const cam = obj.camera;

                    if (Array.isArray(cam.presets)) {
                        setCameraPresets(cam.presets);
                    }
                    if (cam.activePresetId !== undefined) {
                        setCameraPresetId(cam.activePresetId || "");
                    }

                    if ((!cam.presets || !cam.presets.length) && cam.liveSnapshot) {
                        const presetId = uuid();
                        const preset = {
                            id: presetId,
                            name: "Imported View",
                            position: cam.liveSnapshot.position || [6, 4.5, 6],
                            target: cam.liveSnapshot.target || [0, 0, 0],
                            fov: cam.liveSnapshot.fov ?? 55,
                        };
                        setCameraPresets([preset]);
                        setCameraPresetId(presetId);
                    }
                }

                // --- view & perf flags ---
                if (obj.view) {
                    const v = obj.view;

                    if (v.bg !== undefined) setBg(v.bg);
                    if (v.roomOpacity !== undefined) setRoomOpacity(v.roomOpacity);

                    if (v.wireframe !== undefined) setWireframe(v.wireframe);
                    if (v.wireOpacity !== undefined) setWireOpacity(v.wireOpacity);
                    if (v.wireDetail !== undefined && setWireDetail) setWireDetail(v.wireDetail);
                    if (v.wireHideSurfaces !== undefined) setWireHideSurfaces(v.wireHideSurfaces);
                    if (v.wireStroke && typeof v.wireStroke === "object") setWireStroke((d) => ({ ...(d || {}), ...v.wireStroke }));

                    if (v.showLights !== undefined) setShowLights(v.showLights);
                    if (v.showLightBounds !== undefined) setShowLightBounds(v.showLightBounds);
                    if (v.showGround !== undefined) setShowGround(v.showGround);

                    if (v.animate !== undefined) setAnimate(v.animate);
                    if (v.perf !== undefined) setPerf(v.perf);

                    if (v.shadowsOn !== undefined) setShadowsOn(v.shadowsOn);
                    if (v.wireReveal !== undefined) setWireReveal(v.wireReveal);
                }

                // --- product display prefs ---
                if (obj.productsView) {
                    const pv = obj.productsView;

                    if (pv.productScale !== undefined) setProductScale(pv.productScale);
                    if (pv.showDimsGlobal !== undefined) setShowDimsGlobal(pv.showDimsGlobal);
                    if (pv.photoDefault !== undefined) setPhotoDefault(pv.photoDefault);
                    if (pv.productUnits !== undefined) setProductUnits(pv.productUnits);
                }

                // --- extra UI / render prefs (labels, model visibility/scale, snap settings, wire stroke, etc.) ---
                {
                    const prefs = obj.epicPrefs || {};
                    const prefGet = (k) => (prefs && Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : null);
                    const toBool = (v) => v === true || v === 1 || v === "1";
                    const toNum = (v, d) => {
                        const n = Number(v);
                        return Number.isFinite(n) ? n : d;
                    };

                    let appliedModelScale = false;
                    let appliedModelVisible = false;
                    let appliedCurrentModel = false;
                    let appliedAlwaysInfo = false;
                    let appliedSnapEnabled = false;
                    let appliedSnapDist = false;
                    let appliedWireHide = false;

                    if (obj.model) {
                        const m = obj.model;
                        if (m.visible !== undefined) { setModelVisible(!!m.visible); appliedModelVisible = true; }
                        if (m.scale !== undefined) { setModelScale(toNum(m.scale, 1)); appliedModelScale = true; }
                        if (m.position && Array.isArray(m.position) && m.position.length >= 3) {
                            setModelPosition([toNum(m.position[0], 0), toNum(m.position[1], 0), toNum(m.position[2], 0)]);
                        }
                        if (!hasBundledModel && m.staticId) { setCurrentModelId(m.staticId); appliedCurrentModel = true; }
                    }

                    if (obj.ui) {
                        const u = obj.ui;
                        if (u.prodMode !== undefined) setProdMode(!!u.prodMode);
                        if (u.modelVisible !== undefined) { setModelVisible(!!u.modelVisible); appliedModelVisible = true; }
                        if (u.modelScale !== undefined) { setModelScale(toNum(u.modelScale, 1)); appliedModelScale = true; }
                        if (!hasBundledModel && u.currentModelId) { setCurrentModelId(u.currentModelId); appliedCurrentModel = true; }
                        if (u.alwaysShow3DInfo !== undefined) { setAlwaysShow3DInfo(!!u.alwaysShow3DInfo); appliedAlwaysInfo = true; }
                        if (u.snapRooms) {
                            if (u.snapRooms.enabled !== undefined) { setSnapRoomsEnabled(!!u.snapRooms.enabled); appliedSnapEnabled = true; }
                            if (u.snapRooms.distance !== undefined) { setSnapRoomsDistance(toNum(u.snapRooms.distance, 0.5)); appliedSnapDist = true; }
                        }
                        if (u.labels) {
                            if (u.labels.on !== undefined) setLabelsOn(!!u.labels.on);
                            if (u.labels.mode) setLabelMode(u.labels.mode);
                            if (u.labels.size !== undefined) setLabelSize(toNum(u.labels.size, 0.24));
                        }
                        if (u.wire) {
                            if (u.wire.hideSurfaces !== undefined) { setWireHideSurfaces(!!u.wire.hideSurfaces); appliedWireHide = true; }
                            if (u.wire.stroke && typeof u.wire.stroke === "object") {
                                setWireStroke((d) => ({ ...(d || {}), ...u.wire.stroke }));
                            }
                        }
                        if (u.editor) {
                            if (u.editor.mode) setMode(u.editor.mode);
                            if (u.editor.selectionMode) setSelectionMode(u.editor.selectionMode);
                            if (u.editor.moveMode !== undefined) setMoveMode(!!u.editor.moveMode);
                            if (u.editor.transformMode) setTransformMode(u.editor.transformMode);
                        }
                    }

                    // Back-compat: some prefs were historically only in epicPrefs/localStorage and are init-only.
                    if (!appliedModelScale) {
                        const ms = prefGet("epic3d.modelScale.v1");
                        if (ms != null) setModelScale(toNum(ms, 1));
                    }
                    if (!appliedAlwaysInfo) {
                        const ai = prefGet("epic3d.alwaysShow3DInfo.v1");
                        if (ai != null) setAlwaysShow3DInfo(toBool(ai));
                    }
                    if (!appliedSnapEnabled) {
                        const se = prefGet("epic3d.snapRooms.enabled.v1");
                        if (se != null) setSnapRoomsEnabled(toBool(se));
                    }
                    if (!appliedSnapDist) {
                        const sd = prefGet("epic3d.snapRooms.distance.v1");
                        if (sd != null) setSnapRoomsDistance(toNum(sd, 0.5));
                    }
                    if (!appliedWireHide) {
                        const wh = prefGet("epic3d.wireHideSurfaces.v1");
                        if (wh != null) setWireHideSurfaces(toBool(wh));
                    }
                    if (!appliedCurrentModel && !hasBundledModel) {
                        const cm = prefGet("epic3d.static.current");
                        if (cm) setCurrentModelId(cm);
                    }
                    if (!appliedModelVisible) {
                        // default is true; if older scenes relied on that, nothing to do
                    }
                }

                // --- project / name ---
                if (obj.project && obj.project.name) {
                    setProjectName(obj.project.name);
                }

                // --- model descriptor & file (if bundled) ---
                if (modelEntry) {
                    const blob = await modelEntry.async("blob");
                    const fname = modelEntry.name.split("/").pop() || "model.glb";

                    // Clean up any previous model URLs
                    if (modelDescriptor?.cleanup) {
                        try { modelDescriptor.cleanup(); } catch {}
                    }

                    // Reuse the normal model loader so .glb/.gltf/.zip all work (incl. textured zips)
                    try {
                        let fileLike = blob;
                        if (typeof File !== "undefined") {
                            fileLike = new File([blob], fname, { type: blob.type || "application/octet-stream" });
                        } else {
                            // Fallback: attach a name field for environments without File()
                            fileLike = Object.assign(blob, { name: fname });
                        }
                        await onModelFiles(fileLike);
                    } catch (err) {
                        console.warn("Failed to restore bundled model from package", err);
                    }
                }
                if (Array.isArray(obj.pictures)) {
                    setImportedPictures(obj.pictures);
                    try {
                        window.localStorage.setItem(PICTURES_KEY, JSON.stringify(obj.pictures));
                    } catch {}
                }
                // --- Restore full product DB from scene (names, images, etc.) ---
                let productsLoaded = false;
                if (obj.products && Array.isArray(obj.products.items)) {
                    try {
                        // 1) Clear existing DB
                        const existing = listProducts && listProducts();
                        if (Array.isArray(existing)) {
                            existing.forEach((p) => {
                                if (p && p.id != null && deleteProduct) {
                                    deleteProduct(p.id);
                                }
                            });
                        }

                        // 2) Rebuild DB from exported items
                        obj.products.items.forEach((p) => {
                            if (!p || p.id == null || !upsertProduct) return;
                            upsertProduct(p);  // keep full object: name, image, dims, metadata…
                        });

                        productsLoaded = true;
                    } catch (err) {
                        console.warn("Failed to import products from scene", err);
                    }
                }

                // --- Fallback for old zips: products.db.json (only if no products in scene.json) ---
                if (!productsLoaded) {
                    const prodFile = zip.file("products.db.json");
                    if (prodFile && importProductsFile) {
                        try {
                            const prodBlob = await prodFile.async("blob");
                            await importProductsFile(prodBlob);
                        } catch (err) {
                            console.warn("Failed to import products DB from package", err);
                        }
                    }
                }

                // 🔁 Remount HUD so it picks up imported layout/styles from localStorage
                setHudVersion((v) => v + 1);

            } else if (ext === "json") {
                // legacy: plain scene.json
                const txt = await file.text();
                const obj = JSON.parse(txt || "{}");

                setRooms(obj.rooms || []);
                setNodes(obj.nodes || []);
                setLinks(obj.links || []);
                setDecks(obj.decks || []);
                setGroups(obj.groups || []);
                setActions(obj.actions || []);

                if (obj.actionsHud) setActionsHud(obj.actionsHud);
                if (obj.buttonStates) setButtonStates(obj.buttonStates);

                if (obj.hud && typeof window !== "undefined" && window.localStorage) {
                    const h = obj.hud;
                    const ls = window.localStorage;
                    try {
                        if (h.cfg !== undefined)        ls.setItem("epic3d.hudConfig.v1",  JSON.stringify(h.cfg));
                        if (h.layout !== undefined)     ls.setItem("epic3d.hudLayout.v3",  JSON.stringify(h.layout));
                        if (h.visibleMap !== undefined) ls.setItem("epic3d.hudVisible.v1", JSON.stringify(h.visibleMap));
                        if (h.stylePresets !== undefined) ls.setItem("epic3d.hudStyles.v1", JSON.stringify(h.stylePresets));
                    } catch (err) {
                        console.warn("Failed to restore HUD layout/styles from JSON scene", err);
                    }
                }
                if (Array.isArray(obj.pictures)) {
                    setImportedPictures(obj.pictures);
                    try {
                        window.localStorage.setItem(PICTURES_KEY, JSON.stringify(obj.pictures));
                    } catch {}
                }

                // epic3d.* prefs for JSON scenes too
                if (obj.epicPrefs && typeof window !== "undefined" && window.localStorage) {
                    const ls = window.localStorage;
                    try {
                        Object.entries(obj.epicPrefs).forEach(([key, value]) => {
                            if (typeof value === "string" || value == null) {
                                ls.setItem(key, value ?? "");
                            } else {
                                ls.setItem(key, JSON.stringify(value));
                            }
                        });
                    } catch (err) {
                        console.warn("Failed to restore epic3d.* prefs (json)", err);
                    }
                }

                // --- Refresh picture overlays from restored localStorage ---
                try {
                    if (typeof window !== "undefined" && window.localStorage) {
                        const raw = window.localStorage.getItem(PICTURES_KEY);
                        const parsed = raw ? JSON.parse(raw) : [];
                        setImportedPictures(Array.isArray(parsed) ? parsed : []);
                    }
                } catch (err) {
                    console.warn("Failed to restore imported pictures", err);
                }

                if (obj.view) {
                    const v = obj.view;
                    if (v.bg !== undefined) setBg(v.bg);
                    if (v.roomOpacity !== undefined) setRoomOpacity(v.roomOpacity);
                    if (v.wireframe !== undefined) setWireframe(v.wireframe);
                    if (v.wireOpacity !== undefined) setWireOpacity(v.wireOpacity);
                    if (v.wireDetail !== undefined && setWireDetail) setWireDetail(v.wireDetail);
                    if (v.wireHideSurfaces !== undefined) setWireHideSurfaces(v.wireHideSurfaces);
                    if (v.wireStroke && typeof v.wireStroke === "object") setWireStroke((d) => ({ ...(d || {}), ...v.wireStroke }));
                    if (v.showLights !== undefined) setShowLights(v.showLights);
                    if (v.showLightBounds !== undefined) setShowLightBounds(v.showLightBounds);
                    if (v.showGround !== undefined) setShowGround(v.showGround);
                    if (v.animate !== undefined) setAnimate(v.animate);
                    if (v.perf !== undefined) setPerf(v.perf);
                    if (v.shadowsOn !== undefined) setShadowsOn(v.shadowsOn);
                    if (v.wireReveal !== undefined) setWireReveal(v.wireReveal);
                }

                if (obj.productsView) {
                    const pv = obj.productsView;
                    if (pv.productScale !== undefined) setProductScale(pv.productScale);
                    if (pv.showDimsGlobal !== undefined) setShowDimsGlobal(pv.showDimsGlobal);
                    if (pv.photoDefault !== undefined) setPhotoDefault(pv.photoDefault);
                    if (pv.productUnits !== undefined) setProductUnits(pv.productUnits);
                }

                // --- extra UI / render prefs (labels, model visibility/scale, snap settings, wire stroke, etc.) ---
                {
                    const hasBundledModel = false;
                    const prefs = obj.epicPrefs || {};
                    const prefGet = (k) => (prefs && Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : null);
                    const toBool = (v) => v === true || v === 1 || v === "1";
                    const toNum = (v, d) => {
                        const n = Number(v);
                        return Number.isFinite(n) ? n : d;
                    };

                    let appliedModelScale = false;
                    let appliedModelVisible = false;
                    let appliedCurrentModel = false;
                    let appliedAlwaysInfo = false;
                    let appliedSnapEnabled = false;
                    let appliedSnapDist = false;
                    let appliedWireHide = false;

                    if (obj.model) {
                        const m = obj.model;
                        if (m.visible !== undefined) { setModelVisible(!!m.visible); appliedModelVisible = true; }
                        if (m.scale !== undefined) { setModelScale(toNum(m.scale, 1)); appliedModelScale = true; }
                        if (m.position && Array.isArray(m.position) && m.position.length >= 3) {
                            setModelPosition([toNum(m.position[0], 0), toNum(m.position[1], 0), toNum(m.position[2], 0)]);
                        }
                        if (!hasBundledModel && m.staticId) { setCurrentModelId(m.staticId); appliedCurrentModel = true; }
                    }

                    if (obj.ui) {
                        const u = obj.ui;
                        if (u.prodMode !== undefined) setProdMode(!!u.prodMode);
                        if (u.modelVisible !== undefined) { setModelVisible(!!u.modelVisible); appliedModelVisible = true; }
                        if (u.modelScale !== undefined) { setModelScale(toNum(u.modelScale, 1)); appliedModelScale = true; }
                        if (u.modelPosition && Array.isArray(u.modelPosition) && u.modelPosition.length >= 3) {
                            setModelPosition([toNum(u.modelPosition[0], 0), toNum(u.modelPosition[1], 0), toNum(u.modelPosition[2], 0)]);
                        }
                        if (!hasBundledModel && u.currentModelId) { setCurrentModelId(u.currentModelId); appliedCurrentModel = true; }
                        if (u.alwaysShow3DInfo !== undefined) { setAlwaysShow3DInfo(!!u.alwaysShow3DInfo); appliedAlwaysInfo = true; }
                        if (u.snapRooms) {
                            if (u.snapRooms.enabled !== undefined) { setSnapRoomsEnabled(!!u.snapRooms.enabled); appliedSnapEnabled = true; }
                            if (u.snapRooms.distance !== undefined) { setSnapRoomsDistance(toNum(u.snapRooms.distance, 0.5)); appliedSnapDist = true; }
                        }
                        if (u.labels) {
                            if (u.labels.on !== undefined) setLabelsOn(!!u.labels.on);
                            if (u.labels.mode) setLabelMode(u.labels.mode);
                            if (u.labels.size !== undefined) setLabelSize(toNum(u.labels.size, 0.24));
                        }
                        if (u.wire) {
                            if (u.wire.hideSurfaces !== undefined) { setWireHideSurfaces(!!u.wire.hideSurfaces); appliedWireHide = true; }
                            if (u.wire.stroke && typeof u.wire.stroke === "object") {
                                setWireStroke((d) => ({ ...(d || {}), ...u.wire.stroke }));
                            }
                        }
                        if (u.editor) {
                            if (u.editor.mode) setMode(u.editor.mode);
                            if (u.editor.selectionMode) setSelectionMode(u.editor.selectionMode);
                            if (u.editor.moveMode !== undefined) setMoveMode(!!u.editor.moveMode);
                            if (u.editor.transformMode) setTransformMode(u.editor.transformMode);
                        }
                    }

                    // Back-compat: some prefs were historically only in epicPrefs/localStorage and are init-only.
                    if (!appliedModelScale) {
                        const ms = prefGet("epic3d.modelScale.v1");
                        if (ms != null) setModelScale(toNum(ms, 1));
                    }
                    if (!appliedAlwaysInfo) {
                        const ai = prefGet("epic3d.alwaysShow3DInfo.v1");
                        if (ai != null) setAlwaysShow3DInfo(toBool(ai));
                    }
                    if (!appliedSnapEnabled) {
                        const se = prefGet("epic3d.snapRooms.enabled.v1");
                        if (se != null) setSnapRoomsEnabled(toBool(se));
                    }
                    if (!appliedSnapDist) {
                        const sd = prefGet("epic3d.snapRooms.distance.v1");
                        if (sd != null) setSnapRoomsDistance(toNum(sd, 0.5));
                    }
                    if (!appliedWireHide) {
                        const wh = prefGet("epic3d.wireHideSurfaces.v1");
                        if (wh != null) setWireHideSurfaces(toBool(wh));
                    }
                    if (!appliedCurrentModel && !hasBundledModel) {
                        const cm = prefGet("epic3d.static.current");
                        if (cm) setCurrentModelId(cm);
                    }
                    if (!appliedModelVisible) {
                        // default is true; if older scenes relied on that, nothing to do
                    }
                }

                if (obj.project && obj.project.name) {
                    setProjectName(obj.project.name);
                }

                // products for plain JSON scenes as well
                if (obj.products && Array.isArray(obj.products.items)) {
                    try {
                        const existing = listProducts && listProducts();
                        if (Array.isArray(existing)) {
                            existing.forEach((p) => {
                                if (p && p.id != null && deleteProduct) {
                                    deleteProduct(p.id);
                                }
                            });
                        }
                        obj.products.items.forEach((p) => {
                            if (!p || p.id == null || !upsertProduct) return;
                            upsertProduct(p);
                        });
                    } catch (err) {
                        console.warn("Failed to import products from JSON scene", err);
                    }
                }

                // re-mount HUD here too
                setHudVersion((v) => v + 1);

            } else {
                alert("Unsupported package type (use .zip or .json scene)");
            }
        } catch (err) {
            console.error("Failed to import package", err);
            alert("Import failed: " + (err?.message || String(err)));
        }
    };
// Accept BOTH [x,y,z] and THREE.Vector3-ish inputs
    const toArr3 = (v) => {
        if (!v) return null;
        if (Array.isArray(v)) return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];

        // THREE.Vector3
        if (typeof v.toArray === "function") {
            const a = v.toArray();
            return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
        }

        // Plain object {x,y,z}
        if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") {
            return [v.x, v.y, v.z];
        }

        // Typed arrays etc.
        if (typeof v.length === "number" && v.length >= 3) {
            return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
        }

        return null;
    };

    // --- Group transform stabilizer (prevents multi-select from "flying" when moving, especially after box selection) ---
// We snapshot start positions for the whole selection and move everything by the same delta.
// If the gizmo is mounted on a group pivot (centroid), incoming position won't match the anchor start;
// we detect that and use a pivot-baseline to avoid huge jumps.
    // --- Group transform stabilizer (prevents multi-select from "flying" after box selection) ---
    // --- Multi-move snapshot (used when multiSel length > 1) ---
    const multiMoveRef = useRef({
        active: false,
        driverKey: null,
        lastAt: 0,
        baseline: [0, 0, 0],
        lastPos: null,
        accum: [0, 0, 0],
        startedAt: 0,
        starts: new Map(),
        roomChildStarts: new Map(),
        movedRoomIds: new Set(),
        selectedNodeIds: new Set(),
        linkBpStarts: new Map(),
    });


    // --- Multi-rotate snapshot (used when multiSel length > 1 and transformMode === 'rotate') ---
    const multiRotateRef = useRef({
        active: false,
        baselineQuat: new THREE.Quaternion(),
        pivot: [0, 0, 0],
        starts: new Map(),          // key -> { pos:[x,y,z], rot:[x,y,z] }
        roomChildStarts: new Map(), // nodeId -> { pos:[x,y,z], rot:[x,y,z] }
        movedRoomIds: new Set(),
        selectedNodeIds: new Set(),
        linkBpStarts: new Map(),    // linkId -> [[x,y,z], ...]
    });


// reset drag baseline when selection/mode changes
    useEffect(() => {
        const r = multiMoveRef.current;
        r.active = false;
        r.driverKey = null;
    }, [moveMode, transformMode, selected?.type, selected?.id, multiSel]);

// reset rotate drag baseline when selection/mode changes
    useEffect(() => {
        const r = multiRotateRef.current;
        r.active = false;
    }, [moveMode, transformMode, selected?.type, selected?.id, multiSel]);

// stop a drag when pointer is released (so the next drag re-snapshots correctly)
    useEffect(() => {
        if (typeof window === "undefined") return;
        const end = () => { multiMoveRef.current.active = false; multiRotateRef.current.active = false; };
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        return () => {
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
    }, []);


    /* Selection & Linking */
    const onEntityTransform = (target, position) => {
        const toArr3 = (v) => {
            if (Array.isArray(v)) return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
            if (v?.toArray) return v.toArray();
            return [v?.x ?? 0, v?.y ?? 0, v?.z ?? 0];
        };

        const pos = toArr3(position);
        if (!pos) return;

        // ----- SINGLE PICTURE (gizmo translate) -----
        if (target?.type === "picture") {
            setPicturePosition(target.id, { x: pos[0], y: pos[1], z: pos[2] });
            return;
        }

        // ----- MODEL (gizmo translate) -----
        if (target?.type === "model") {
            setModelPosition([pos[0], pos[1], pos[2]]);
            return;
        }



        // ----- GROUP MOVE (multi selection) -----
        const raw = (Array.isArray(multiSel) && multiSel.length)
            ? multiSel
            : (selected ? [selected] : []);

        const seen = new Set();
        const selection = [];
        for (const it of raw) {
            if (!it || (it.type !== "node" && it.type !== "room") || it.id == null) continue;
            const k = `${it.type}:${it.id}`;
            if (seen.has(k)) continue;
            seen.add(k);
            selection.push(it);
        }
        const isGroupMove =
            moveMode &&
            transformMode === "translate" &&
            selection.length > 1 &&
            target?.type === "pivot";




        if (isGroupMove) {
            const ref = multiMoveRef.current;

            // 🎯 Always use pivot as driver for group movement
            const driverKey = "pivot";

            const curNodes = nodesRef.current || [];
            const curRooms = roomsRef.current || [];

            // --- START OF DRAG ---
            if (!ref.active) {
                ref.active = true;
                ref.driverKey = "pivot";

                // 🎯 PIVOT (centroid) IS ALWAYS THE CORRECT BASELINE
                ref.baseline = [...pos];

                // Initialize maps
                ref.starts = new Map();
                ref.roomChildStarts = new Map();
                ref.movedRoomIds = new Set();
                ref.selectedNodeIds = new Set();

                // Snapshot selected items
                for (const it of selection) {
                    const key = `${it.type}:${it.id}`;
                    if (it.type === "node") {
                        const n = curNodes.find(x => x.id === it.id);
                        if (n?.position) ref.starts.set(key, [...n.position]);
                        ref.selectedNodeIds.add(it.id);
                    } else {
                        const r = curRooms.find(x => x.id === it.id);
                        if (r?.center) ref.starts.set(key, [...r.center]);
                        ref.movedRoomIds.add(r.id);
                    }
                }

                // Snapshot nodes inside moved rooms
                for (const n of curNodes) {
                    if (!n.roomId) continue;
                    if (!ref.movedRoomIds.has(n.roomId)) continue;
                    if (ref.selectedNodeIds.has(n.id)) continue;

                    ref.roomChildStarts.set(n.id, [...n.position]);
                }
                // Snapshot breakpoints for links connected to any moving node
                // (selected nodes + nodes inside moved rooms). We translate them by the same dx/dy/dz
                // so they don't get left behind when moving room packs.
                ref.linkBpStarts = new Map();
                const curLinks = linksRef.current || [];
                const movingNodeIds = new Set(ref.selectedNodeIds);
                for (const [nid] of ref.roomChildStarts) movingNodeIds.add(nid);

                for (const l of curLinks) {
                    if (!l) continue;
                    if (!movingNodeIds.has(l.from) && !movingNodeIds.has(l.to)) continue;
                    const bps = Array.isArray(l.breakpoints) ? l.breakpoints : null;
                    if (!bps || !bps.length) continue;
                    ref.linkBpStarts.set(
                        l.id,
                        bps.map((bp) => [bp?.[0] ?? 0, bp?.[1] ?? 0, bp?.[2] ?? 0])
                    );
                }

            }

            // --- MOVEMENT PHASE ---
            const dx = pos[0] - ref.baseline[0];
            const dy = pos[1] - ref.baseline[1];
            const dz = pos[2] - ref.baseline[2];

            const movingRooms = ref.movedRoomIds.size > 0;

            // Move rooms
            if (movingRooms) {
                setRooms(prev =>
                    prev.map(r => {
                        if (!ref.movedRoomIds.has(r.id)) return r;
                        const s = ref.starts.get(`room:${r.id}`);
                        const next = [s[0] + dx, s[1] + dy, s[2] + dz];
                        const clamped = clampRoomToPictureDecks(r, next);
                        return { ...r, center: clamped };
                    })
                );
            }

            // Move nodes (selected + inside rooms)
            setNodes(prev =>
                prev.map(n => {
                    const key = `node:${n.id}`;

                    if (ref.starts.has(key)) {
                        const s = ref.starts.get(key);
                        const next = [s[0] + dx, s[1] + dy, s[2] + dz];
                        // If node is constrained inside a room that is NOT moving, keep it constrained.
                        const roomClamped = (n.roomId && !ref.movedRoomIds.has(n.roomId))
                            ? clampNodeToRoomBounds(n, next)
                            : next;
                        const deckClamped = clampNodeToPictureDecks(n, roomClamped);
                        return { ...n, position: deckClamped };
                    }

                    if (ref.roomChildStarts.has(n.id)) {
                        const s = ref.roomChildStarts.get(n.id);
                        const next = [s[0] + dx, s[1] + dy, s[2] + dz];
                        const deckClamped = clampNodeToPictureDecks(n, next);
                        return { ...n, position: deckClamped };
                    }

                    return n;
                })
            );

            // Move link breakpoints for any affected links (keep relative while pack-moving)
            if (ref.linkBpStarts && ref.linkBpStarts.size) {
                setLinks((prev) =>
                    prev.map((l) => {
                        const starts = ref.linkBpStarts.get(l.id);
                        if (!starts) return l;
                        const next = starts.map((bp) => [bp[0] + dx, bp[1] + dy, bp[2] + dz]);
                        return { ...l, breakpoints: next };
                    })
                );
            }


            return;
        }

        // ----- SINGLE MOVE -----
        if (target?.type === "node") {
            const node = nodes.find((n) => n.id === target.id) || null;
            const roomClamped = clampNodeToRoomBounds(node, pos);
            const deckClamped = clampNodeToPictureDecks(node, roomClamped);
            setNode(target.id, { position: deckClamped });
            return;
        }

        if (target?.type === "room") {
            const room = rooms.find((r) => r.id === target.id) || null;
            const deckClamped = clampRoomToPictureDecks(room, pos);
            setRoom(target.id, { center: deckClamped });
            return;
        }

        if (target?.type === "breakpoint") {
            setLinks((prev) =>
                prev.map((l) => {
                    if (l.id !== target.linkId) return l;
                    const existing = Array.isArray(l.breakpoints) ? l.breakpoints : [];
                    if (!existing[target.index]) return l;
                    const next = existing.map((bp, i) => (i === target.index ? pos : bp));
                    return { ...l, breakpoints: next };
                })
            );
        }
    };






    const onEntityRotate = (target, rotation) => {
        const toArr3 = (v) => {
            if (Array.isArray(v)) return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
            if (v?.toArray) return v.toArray();
            return [v?.x ?? 0, v?.y ?? 0, v?.z ?? 0];
        };

        const rot = toArr3(rotation);
        if (!rot) return;

        // ----- GROUP ROTATE (multi selection) -----
        const raw = (Array.isArray(multiSel) && multiSel.length)
            ? multiSel
            : (selected ? [selected] : []);

        const seen = new Set();
        const selection = [];
        for (const it of raw) {
            if (!it || (it.type !== 'node' && it.type !== 'room') || it.id == null) continue;
            const k = `${it.type}:${it.id}`;
            if (seen.has(k)) continue;
            seen.add(k);
            selection.push(it);
        }

        const isGroupRotate =
            moveMode &&
            transformMode === 'rotate' &&
            selection.length > 1 &&
            target?.type === 'pivot';

        if (isGroupRotate) {
            const ref = multiRotateRef.current;

            const curNodes = nodesRef.current || [];
            const curRooms = roomsRef.current || [];

            // Pick pivot (room-pack override uses room center)
            let pivot = null;
            const o = multiPivotOverride?.pos;
            if (Array.isArray(o) && o.length >= 3 && [o[0], o[1], o[2]].every(Number.isFinite)) {
                pivot = [o[0], o[1], o[2]];
            }

            if (!pivot) {
                // centroid of selection
                let sx = 0, sy = 0, sz = 0, c = 0;
                for (const it of selection) {
                    if (it.type === 'node') {
                        const n = curNodes.find((x) => x.id === it.id);
                        const p = n?.position;
                        if (!p) continue;
                        sx += p[0] ?? 0; sy += p[1] ?? 0; sz += p[2] ?? 0; c++;
                    } else {
                        const r = curRooms.find((x) => x.id === it.id);
                        const p = r?.center;
                        if (!p) continue;
                        sx += p[0] ?? 0; sy += p[1] ?? 0; sz += p[2] ?? 0; c++;
                    }
                }
                pivot = c ? [sx / c, sy / c, sz / c] : [0, 0, 0];
            }

            const curQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));

            // --- START OF DRAG ---
            if (!ref.active) {
                ref.active = true;
                ref.baselineQuat.copy(curQuat);
                ref.pivot = pivot;
                ref.starts = new Map();
                ref.roomChildStarts = new Map();
                ref.movedRoomIds = new Set();
                ref.selectedNodeIds = new Set();
                ref.linkBpStarts = new Map();

                // Snapshot selected items
                for (const it of selection) {
                    const key = `${it.type}:${it.id}`;
                    if (it.type === 'node') {
                        const n = curNodes.find((x) => x.id === it.id);
                        if (n?.position) {
                            ref.starts.set(key, {
                                pos: [...n.position],
                                rot: Array.isArray(n.rotation) ? [...n.rotation] : [0, 0, 0],
                            });
                        }
                        ref.selectedNodeIds.add(it.id);
                    } else {
                        const r = curRooms.find((x) => x.id === it.id);
                        if (r?.center) {
                            ref.starts.set(key, {
                                pos: [...r.center],
                                rot: Array.isArray(r.rotation) ? [...r.rotation] : [0, 0, 0],
                            });
                        }
                        if (r?.id) ref.movedRoomIds.add(r.id);
                    }
                }

                // Snapshot nodes inside rotated rooms (so room-rotate behaves like pack-rotate)
                for (const n of curNodes) {
                    if (!n.roomId) continue;
                    if (!ref.movedRoomIds.has(n.roomId)) continue;
                    if (ref.selectedNodeIds.has(n.id)) continue;
                    ref.roomChildStarts.set(n.id, {
                        pos: [...(n.position || [0, 0, 0])],
                        rot: Array.isArray(n.rotation) ? [...n.rotation] : [0, 0, 0],
                    });
                }

                // Snapshot breakpoints for links fully inside the rotating node set
                const curLinks = linksRef.current || [];
                const rotatingNodeIds = new Set(ref.selectedNodeIds);
                for (const [nid] of ref.roomChildStarts) rotatingNodeIds.add(nid);

                for (const l of curLinks) {
                    if (!l) continue;
                    if (!rotatingNodeIds.has(l.from) || !rotatingNodeIds.has(l.to)) continue;
                    const bps = Array.isArray(l.breakpoints) ? l.breakpoints : null;
                    if (!bps || !bps.length) continue;
                    ref.linkBpStarts.set(
                        l.id,
                        bps.map((bp) => [bp?.[0] ?? 0, bp?.[1] ?? 0, bp?.[2] ?? 0])
                    );
                }

                return; // baseline only
            }

            // --- ROTATION PHASE ---
            const invBase = ref.baselineQuat.clone().invert();
            const delta = curQuat.clone().multiply(invBase);

            const pv = new THREE.Vector3(ref.pivot[0] ?? 0, ref.pivot[1] ?? 0, ref.pivot[2] ?? 0);
            const v = new THREE.Vector3();

            const applyRotPos = (posArr) => {
                v.set((posArr[0] ?? 0) - pv.x, (posArr[1] ?? 0) - pv.y, (posArr[2] ?? 0) - pv.z);
                v.applyQuaternion(delta);
                return [pv.x + v.x, pv.y + v.y, pv.z + v.z];
            };

            const applyRotEuler = (rotArr) => {
                const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotArr[0] ?? 0, rotArr[1] ?? 0, rotArr[2] ?? 0, 'XYZ'));
                const q1 = delta.clone().multiply(q0);
                const e1 = new THREE.Euler().setFromQuaternion(q1, 'XYZ');
                return [e1.x, e1.y, e1.z];
            };

            // Rotate rooms (center + rotation)
            if (ref.movedRoomIds.size > 0) {
                setRooms((prev) =>
                    prev.map((r) => {
                        if (!ref.movedRoomIds.has(r.id)) return r;
                        const s = ref.starts.get(`room:${r.id}`);
                        if (!s?.pos) return r;
                        const nextCenter = applyRotPos(s.pos);
                        const nextRot = applyRotEuler(s.rot || r.rotation || [0, 0, 0]);
                        const deckClamped = clampRoomToPictureDecks({ ...r, size: r.size || [1, 1, 1] }, nextCenter);
                        return { ...r, center: deckClamped, rotation: nextRot };
                    })
                );
            }

            // Rotate nodes (selected + inside rotated rooms)
            setNodes((prev) =>
                prev.map((n) => {
                    const key = `node:${n.id}`;

                    if (ref.starts.has(key)) {
                        const s = ref.starts.get(key);
                        const nextPos = applyRotPos(s.pos);
                        const nextRot = applyRotEuler(s.rot || n.rotation || [0, 0, 0]);
                        const deckClamped = clampNodeToPictureDecks(n, nextPos);
                        return { ...n, position: deckClamped, rotation: nextRot };
                    }

                    if (ref.roomChildStarts.has(n.id)) {
                        const s = ref.roomChildStarts.get(n.id);
                        const nextPos = applyRotPos(s.pos);
                        const nextRot = applyRotEuler(s.rot || n.rotation || [0, 0, 0]);
                        const deckClamped = clampNodeToPictureDecks(n, nextPos);
                        return { ...n, position: deckClamped, rotation: nextRot };
                    }

                    return n;
                })
            );

            // Rotate breakpoints for internal links
            if (ref.linkBpStarts && ref.linkBpStarts.size) {
                setLinks((prev) =>
                    prev.map((l) => {
                        const starts = ref.linkBpStarts.get(l.id);
                        if (!starts) return l;
                        const next = starts.map((bp) => applyRotPos(bp));
                        return { ...l, breakpoints: next };
                    })
                );
            }

            return;
        }

        // ----- SINGLE ROTATE -----
        if (target?.type === 'node') setNode(target.id, { rotation: rot });
        if (target?.type === 'room') setRoom(target.id, { rotation: rot });
    };


    const computeSnappedRoomCenter = useCallback((roomId, center) => {
        if (!snapRoomsEnabled) return center;
        const snapDist = Math.max(0.01, Number(snapRoomsDistance) || 0.5);

        const moving = rooms.find((r) => r.id === roomId);
        if (!moving) return center;

        const mc = center || moving.center || [0, 0, 0];
        const ms = moving.size || [1, 1, 1];
        const mw = Math.abs(ms[0] || 0) || 0;
        const md = Math.abs(ms[2] || 0) || 0;

        const mLeft = mc[0] - mw / 2;
        const mRight = mc[0] + mw / 2;
        const mBack = mc[2] - md / 2;
        const mFront = mc[2] + md / 2;

        const overlaps = (a0, a1, b0, b1) => Math.max(a0, b0) <= Math.min(a1, b1);

        let bestDx = null;
        let bestDz = null;

        for (const other of rooms) {
            if (!other || other.id === roomId) continue;
            if (other.visible === false) continue;

            const oc = other.center || [0, 0, 0];
            const os = other.size || [1, 1, 1];
            const ow = Math.abs(os[0] || 0) || 0;
            const od = Math.abs(os[2] || 0) || 0;

            const oLeft = oc[0] - ow / 2;
            const oRight = oc[0] + ow / 2;
            const oBack = oc[2] - od / 2;
            const oFront = oc[2] + od / 2;

            // Snap in X if Z overlaps (or nearly overlaps)
            const zOverlap = overlaps(mBack, mFront, oBack - snapDist, oFront + snapDist);
            if (zOverlap) {
                const candidates = [
                    oRight - mLeft,
                    oLeft - mRight,
                ];
                for (const dx of candidates) {
                    const adx = Math.abs(dx);
                    if (adx <= snapDist && (bestDx === null || adx < Math.abs(bestDx))) bestDx = dx;
                }
            }

            // Snap in Z if X overlaps (or nearly overlaps)
            const xOverlap = overlaps(mLeft, mRight, oLeft - snapDist, oRight + snapDist);
            if (xOverlap) {
                const candidates = [
                    oFront - mBack,
                    oBack - mFront,
                ];
                for (const dz of candidates) {
                    const adz = Math.abs(dz);
                    if (adz <= snapDist && (bestDz === null || adz < Math.abs(bestDz))) bestDz = dz;
                }
            }
        }

        if (bestDx === null && bestDz === null) return mc;

        return [
            mc[0] + (bestDx ?? 0),
            mc[1],
            mc[2] + (bestDz ?? 0),
        ];
    }, [rooms, snapRoomsEnabled, snapRoomsDistance]);

    const roomDragRef = useRef({ id: null, startCenter: [0, 0, 0], nodeStarts: [] });
    const onRoomDragPack = (room) => {
        roomDragRef.current = {
            id: room.id,
            startCenter: [...(room.center || [0, 0, 0])],
            nodeStarts: nodes
                .filter((n) => n.roomId === room.id)
                .map((n) => ({ id: n.id, pos: [...(n.position || [0, 0, 0])] })),
        };
    };

    const onRoomDragApply = (roomId, newCenter) => {
        const pack = roomDragRef.current;
        if (!pack || pack.id !== roomId) return;

        const snapped = computeSnappedRoomCenter(roomId, newCenter);
        const roomObj = rooms.find((r) => r.id === roomId) || null;
        const finalCenter = clampRoomToPictureDecks(roomObj, snapped);

        const dx = finalCenter[0] - pack.startCenter[0];
        const dy = finalCenter[1] - pack.startCenter[1];
        const dz = finalCenter[2] - pack.startCenter[2];

        setRoom(roomId, { center: finalCenter });
        if (pack.nodeStarts.length) {
            setNodes((prev) =>
                prev.map((n) =>
                    n.roomId === roomId
                        ? (() => {
                            const s = pack.nodeStarts.find((ss) => ss.id === n.id);
                            const next = [
                                (s?.pos?.[0] ?? n.position?.[0] ?? 0) + dx,
                                (s?.pos?.[1] ?? n.position?.[1] ?? 0) + dy,
                                (s?.pos?.[2] ?? n.position?.[2] ?? 0) + dz,
                            ];
                            const deckClamped = clampNodeToPictureDecks(n, next);
                            return { ...n, position: deckClamped };
                        })()
                        : n
                )
            );
        }
    };

    // --- Room scale pack (scale room + everything inside it) ---
    const roomScalePackRef = useRef({
        id: null,
        startCenter: [0, 0, 0],
        startSize: [1, 1, 1],
        startRot: [0, 0, 0],
        startBottomY: 0,
        nodeStarts: [],
        linkBpStarts: new Map(),
    });

    const onRoomScalePack = (roomId) => {
        const room = rooms.find((r) => r.id === roomId);
        if (!room || room.locked) return;

        const startCenter = [...(room.center || [0, 0, 0])];
        const startSize = [...(room.size || [3, 1.6, 2.2])];
        const startRot = [...(room.rotation || [0, 0, 0])];
        const startBottomY = (startCenter[1] ?? 0) - (startSize[1] ?? 1) / 2;

        // nodes inside room
        const nodeStarts = nodes
            .filter((n) => n.roomId === roomId)
            .map((n) => ({
                id: n.id,
                pos: [...(n.position || [0, 0, 0])],
            }));

        // breakpoints for internal links (both endpoints inside room)
        const inRoomNodeIds = new Set(nodeStarts.map((s) => s.id));
        const linkBpStarts = new Map();
        for (const l of links) {
            if (!l) continue;
            if (!inRoomNodeIds.has(l.from) || !inRoomNodeIds.has(l.to)) continue;
            const bps = Array.isArray(l.breakpoints) ? l.breakpoints : null;
            if (!bps || !bps.length) continue;
            linkBpStarts.set(
                l.id,
                bps.map((bp) => [bp?.[0] ?? 0, bp?.[1] ?? 0, bp?.[2] ?? 0])
            );
        }

        roomScalePackRef.current = {
            id: roomId,
            startCenter,
            startSize,
            startRot,
            startBottomY,
            nodeStarts,
            linkBpStarts,
        };
    };

    const onRoomScaleApply = (roomId, scaleVec) => {
        const pack = roomScalePackRef.current;
        if (!pack || pack.id !== roomId) return;

        const s = Array.isArray(scaleVec) ? scaleVec : [scaleVec?.[0], scaleVec?.[1], scaleVec?.[2]];
        const sx = Number(s?.[0]);
        const sy = Number(s?.[1]);
        const sz = Number(s?.[2]);
        if (![sx, sy, sz].every((v) => Number.isFinite(v) && v > 0)) return;

        // clamp scale factors to avoid exploding
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const kx = clamp(sx, 0.05, 50);
        const ky = clamp(sy, 0.05, 50);
        const kz = clamp(sz, 0.05, 50);

        // New room size
        const base = pack.startSize || [1, 1, 1];
        const newSize = [
            clamp((base[0] ?? 1) * kx, 0.2, 500),
            clamp((base[1] ?? 1) * ky, 0.2, 500),
            clamp((base[2] ?? 1) * kz, 0.2, 500),
        ];

        // Keep bottom Y stable (so it stays on the floor/deck)
        const rawCenter = [
            pack.startCenter[0] ?? 0,
            (pack.startBottomY ?? 0) + newSize[1] / 2,
            pack.startCenter[2] ?? 0,
        ];

        const roomObj = rooms.find((r) => r.id === roomId) || null;
        const finalCenter = clampRoomToPictureDecks({ ...(roomObj || {}), size: newSize, rotation: pack.startRot }, rawCenter);

        // Rotation basis (room-local scaling)
        const e = pack.startRot || [0, 0, 0];
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0, 'XYZ'));
        const qInv = q.clone().invert();
        const v = new THREE.Vector3();
        const c0 = new THREE.Vector3(pack.startCenter[0] ?? 0, pack.startCenter[1] ?? 0, pack.startCenter[2] ?? 0);
        const c1 = new THREE.Vector3(finalCenter[0] ?? 0, finalCenter[1] ?? 0, finalCenter[2] ?? 0);

        const scaleLocalPoint = (p) => {
            v.set((p[0] ?? 0) - c0.x, (p[1] ?? 0) - c0.y, (p[2] ?? 0) - c0.z);
            v.applyQuaternion(qInv);
            v.set(v.x * kx, v.y * ky, v.z * kz);
            v.applyQuaternion(q);
            return [c1.x + v.x, c1.y + v.y, c1.z + v.z];
        };

        // Apply room size + (possibly lifted) center
        setRooms((prev) =>
            prev.map((r) =>
                r.id === roomId ? { ...r, size: newSize, center: finalCenter } : r
            )
        );

        // Scale nodes inside
        if (pack.nodeStarts?.length) {
            const byId = new Map(pack.nodeStarts.map((x) => [x.id, x.pos]));
            setNodes((prev) =>
                prev.map((n) => {
                    if (n.roomId !== roomId) return n;
                    const p0 = byId.get(n.id) || n.position || [0, 0, 0];
                    const p1 = scaleLocalPoint(p0);
                    const deckClamped = clampNodeToPictureDecks(n, p1);
                    return { ...n, position: deckClamped };
                })
            );
        }

        // Scale internal link breakpoints
        if (pack.linkBpStarts && pack.linkBpStarts.size) {
            setLinks((prev) =>
                prev.map((l) => {
                    const starts = pack.linkBpStarts.get(l.id);
                    if (!starts) return l;
                    const next = starts.map((bp) => scaleLocalPoint(bp));
                    return { ...l, breakpoints: next };
                })
            );
        }
    };
// Duplicate a room; offsets it on X so it's not overlapping the original
    const duplicateRoom = (roomId) => {
        const orig = rooms.find((r) => r.id === roomId);
        if (!orig) return;

        // place copy next to original (X offset by width + padding)
        const dx = Math.max(1, (orig.size?.[0] ?? 1)) + 0.5;
        const dy = 0;
        const dz = 0;

        const newRoomId = uuid();
        const copyRoom = {
            ...orig,
            id: newRoomId,
            name: `${orig.name} Copy`,
            center: [ (orig.center?.[0] ?? 0) + dx, (orig.center?.[1] ?? 0) + dy, (orig.center?.[2] ?? 0) + dz ],
        };

        // Duplicate nodes that belong to this room
        const oldNodes = nodes.filter((n) => n.roomId === roomId);
        const nodeIdMap = new Map();
        const newNodes = oldNodes.map((n) => {
            const newId = uuid();
            nodeIdMap.set(n.id, newId);
            const p = n.position || [0, 0, 0];
            return {
                ...n,
                id: newId,
                label: n.label ? `${n.label} (Copy)` : `Node (Copy)`,
                position: [ (p[0] ?? 0) + dx, (p[1] ?? 0) + dy, (p[2] ?? 0) + dz ],
                roomId: newRoomId,
            };
        });

        // Duplicate internal links between those nodes (and offset breakpoints)
        const oldNodeIdSet = new Set(oldNodes.map((n) => n.id));
        const newLinks = links
            .filter((l) => oldNodeIdSet.has(l.from) && oldNodeIdSet.has(l.to))
            .map((l) => {
                const bps = Array.isArray(l.breakpoints) ? l.breakpoints : null;
                const nextBps = bps
                    ? bps.map((bp) => [ (bp?.[0] ?? 0) + dx, (bp?.[1] ?? 0) + dy, (bp?.[2] ?? 0) + dz ])
                    : undefined;
                const out = {
                    ...l,
                    id: uuid(),
                    from: nodeIdMap.get(l.from),
                    to: nodeIdMap.get(l.to),
                };
                if (nextBps) out.breakpoints = nextBps;
                return out;
            });

        // Apply
        setRooms((prev) => [...prev, copyRoom]);
        if (newNodes.length) setNodes((prev) => [...prev, ...newNodes]);
        if (newLinks.length) setLinks((prev) => [...prev, ...newLinks]);

        // Select the new room + all its duplicated nodes
        const sel = [{ type: 'room', id: newRoomId }, ...newNodes.map((n) => ({ type: 'node', id: n.id }))];
        setMultiSel(sel);
        setSelected(sel[0] || null);
    };

    const onPlace = (kind, p, multi, extra) => {
        if (kind === "room") {
            // Always place rooms on the ground grid, using only X/Z
            const size = (extra?.size && Array.isArray(extra.size) && extra.size.length >= 3)
                ? [Number(extra.size[0]) || 3, Number(extra.size[1]) || 1.6, Number(extra.size[2]) || 2.2]
                : [3, 1.6, 2.2];        // default room: [width, height, depth]
            const [w, h, d] = size;
            const [x, , z] = p;                // ignore incoming Y – we want it floor aligned
            const center = [x, h * 0.5, z];    // bottom sits at y=0

            const r = {
                id: uuid(),
                name: "Room " + (rooms.length + 1),
                center,
                rotation: [0, 0, 0],
                size,
                color: "#253454",
                visible: true,
                // optional polygon footprint for future polygon room rendering
                poly: Array.isArray(extra?.poly) ? extra.poly : undefined,
                drawMode: extra?.drawMode || undefined,
            };

            setRooms((prev) => [...prev, r]);
            setSelected({ type: "room", id: r.id });
            if (!multi) setPlacement((pv) => ({ ...pv, armed: false }));
            return;
        }


        const isSwitch = kind === "switch";
        const n = {
            id: uuid(),
            kind,
            label: (isSwitch ? "Switch " : "Node ") + (nodes.length + 1),
            position: p,
            rotation: [0,0,0],
            role: isSwitch ? "bidir" : "sender",
            cluster: isSwitch ? "Network" : "AV",
            color: isSwitch ? "#9bd0ff" : "#6ee7d8",
            glowOn: false,
            glow: 0.3,
            shape: isSwitch ? { type: "switch", w: 1.1, h: 0.12, d: 0.35 } : { type: "sphere", radius: 0.28 },
            light: { type: "none", enabled: false },
            anim: {},
            signal: { style: isSwitch ? "rays" : "waves", speed: 1, size: 1 },
            switch: isSwitch ? {
                buttonsCount: 2,
                physical: false,
                physicalHeight: 0.028,
                margin: 0.03,
                gap: 0.02,
                pressDepth: 0.014,
                pressMs: 140,
                textColor: "#e2e8f0",
                textScale: 1,
                buttonColor: "#22314d",
                pressedColor: "#101a2d",
                hoverEmissive: "#ffffff",
                buttons: [
                    { name: "On", actionIds: [] },
                    { name: "Off", actionIds: [] },
                ],
            } : undefined,
        };
        // assign to room if inside one
        const roomHit = rooms.find(
            (r) =>
                Math.abs(p[0] - r.center[0]) <= r.size[0] / 2 &&
                Math.abs(p[1] - r.center[1]) <= r.size[1] / 2 &&
                Math.abs(p[2] - r.center[2]) <= r.size[2] / 2
        );
        if (roomHit) n.roomId = roomHit.id;

        setNodes((prev) => [...prev, n]);
        setSelected({ type: "node", id: n.id });
        if (!multi) setPlacement((pv) => ({ ...pv, armed: false }));
    };
// keep panel scroll position across action edits
    const leftColRef = useRef(null);
    const keepLeftScroll = React.useCallback((fn) => {
        const el = leftColRef.current;
        const y = el ? el.scrollTop : 0;
        fn();
        requestAnimationFrame(() => { if (el) el.scrollTop = y; });
    }, []);
// Stops only <a href="#"> clicks</a> from scrolling to top
    const stopAnchorDefault = (e) => {
        const a = e.target.closest && e.target.closest('a[href="#"]');
        if (a) e.preventDefault();
    };






    const requestDelete = (target) => {
        if (!target) return;
        if (target.type === "model") return;
        if (target.type === "node") {
            const linked = links.filter((l) => l.from === target.id || l.to === target.id);
            if (linked.length) setConfirm({ open: true, payload: target, text: `Delete node and ${linked.length} linked connection(s)?` });
            else setNodes((prev) => prev.filter((n) => n.id !== target.id));
        }
        if (target.type === "link") setLinks((prev) => prev.filter((l) => l.id !== target.id));
        if (target.type === "room") {
            const inRoom = nodes.filter((n) => n.roomId === target.id).length;
            setConfirm({ open: true, payload: target, text: inRoom ? `Delete room and ${inRoom} node(s) inside?` : `Delete room?` });
        }
    };

    const applyConfirmDelete = () => {
        const t = confirm.payload;
        if (!t) return;
        if (t.type === "node") {
            setLinks((prev) => prev.filter((l) => l.from !== t.id && l.to !== t.id));
            setNodes((prev) => prev.filter((n) => n.id !== t.id));
        }
        if (t.type === "room") {
            const ids = nodes.filter((n) => n.roomId === t.id).map((n) => n.id);
            setLinks((prev) => prev.filter((l) => !ids.includes(l.from) && !ids.includes(l.to)));
            setNodes((prev) => prev.filter((n) => n.roomId !== t.id));
            setRooms((prev) => prev.filter((r) => r.id !== t.id));
        }
        setSelected(null);
        setConfirm({ open: false, payload: null, text: "" });
    };


    // Logo: click -> smooth camera move to the currently selected View (same logic as Action: Camera Move / Track)
    const [logoHot, setLogoHot] = useState(false);
    const [logoFlash, setLogoFlash] = useState(false);

    useEffect(() => {
        if (!logoFlash) return;
        const t = setTimeout(() => setLogoFlash(false), 900);
        return () => clearTimeout(t);
    }, [logoFlash]);

    const goToSelectedViewFromLogo = useCallback(() => {
        const toPresetId = cameraPresetId || DEFAULT_PRESET_ID;

        // Visual confirmation
        setLogoFlash(true);

        // Avoid stacking logo clicks; keep other (action) tracks intact.
        setCameraTracks((prev) =>
            Array.isArray(prev) ? prev.filter((t) => t?.tag !== "logo") : []
        );

        // If we're already basically at the destination, don't waste time animating.
        try {
            const snap = cameraSnapshotRef?.current?.();
            const toPose =
                toPresetId === DEFAULT_PRESET_ID
                    ? defaultPose
                    : (cameraPresets || []).find((p) => p?.id === toPresetId);

            if (snap && toPose?.position && toPose?.target) {
                const dp = Math.hypot(
                    (snap.position?.[0] ?? 0) - (toPose.position?.[0] ?? 0),
                    (snap.position?.[1] ?? 0) - (toPose.position?.[1] ?? 0),
                    (snap.position?.[2] ?? 0) - (toPose.position?.[2] ?? 0)
                );
                const dt = Math.hypot(
                    (snap.target?.[0] ?? 0) - (toPose.target?.[0] ?? 0),
                    (snap.target?.[1] ?? 0) - (toPose.target?.[1] ?? 0),
                    (snap.target?.[2] ?? 0) - (toPose.target?.[2] ?? 0)
                );
                if (dp < 0.02 && dt < 0.02) return;
            }
        } catch {}

        // Smooth track from current → selected (2s)
        scheduleCameraMove({
            fromPresetId: null,
            toPresetId,
            startDelay: 0,
            duration: 2,
            tag: "logo",
        });
    }, [cameraPresetId, scheduleCameraMove, cameraPresets, defaultPose, setCameraTracks, cameraSnapshotRef]);

// Handles clicking a ROOM (single select for now)
// ✅ multi-select aware node click (also respects link mode)
    const handleNodeDown = (id, e) => {
        if (dragActive) return;
        setSelectedBreakpoint(null);

        // Deck add mode: click nodes to add them to the active deck
        if (deckAddModeId) {
            addNodeToDeck(deckAddModeId, id);
            const n = nodes.find((x) => x.id === id);
            setDeckAddLast(n ? `Added node: ${n.label || n.name || n.id}` : "Added node");
            setMultiSel([]);
            setSelected({ type: "node", id });
            return;
        }


        // Add-to-Group mode: selection only; apply on "Done"
        if (groupAddModeId) {
            const additive = e?.ctrlKey || e?.metaKey;
            if (additive) {
                setMultiSel((prev) => toggleSel(prev, { type: "node", id }));
            } else {
                setMultiSel([{ type: "node", id }]);
                setSelected({ type: "node", id });
            }
            return;
        }

        // 🔹 Align mode (pick a master node in the inspector, then click a target node)
        if (levelFromNodeId) {
            // Clicking the source again just cancels
            if (levelFromNodeId === id) {
                setLevelFromNodeId(null);
                return;
            }

            const src = nodes.find((n) => n.id === levelFromNodeId);
            const dst = nodes.find((n) => n.id === id);

            if (src && dst) {
                const srcPos = src.position || [0, 0, 0];
                const dstPos = dst.position || [0, 0, 0];
                const ax = (levelAxis || "y").toLowerCase();

                // Copy the chosen axis from the master (src) onto the target (dst)
                const nextPos =
                    ax === "x"
                        ? [srcPos[0], dstPos[1], dstPos[2]]
                        : ax === "z"
                            ? [dstPos[0], dstPos[1], srcPos[2]]
                            : [dstPos[0], srcPos[1], dstPos[2]]; // default: Y

                setNodes((prev) =>
                    prev.map((n) =>
                        n.id === dst.id ? { ...n, position: nextPos } : n,
                    ),
                );
            }

            // Done: clear mode and select the leveled node
            setLevelFromNodeId(null);
            setSelected({ type: "node", id });
            return;
        }

        // Existing link logic
        if (mode === "link") {
            if (!linkFromId) {
                setLinkFromId(id);
                setSelected({ type: "node", id });
                return;
            }
            if (linkFromId === id) {
                setLinkFromId(null);
                return;
            }
            const a = nodes.find((n) => n.id === linkFromId);
            const b = nodes.find((n) => n.id === id);
            const epic = (a && a.kind === "switch") || (b && b.kind === "switch");
            const base = { ...linkDefaults };
            if (epic) base.style = "epic";
            setLinks((prev) => [
                ...prev,
                { id: uuid(), from: linkFromId, to: id, ...base },
            ]);
            setMode("select");
            setLinkFromId(null);
            setSelected({ type: "node", id });
            return;
        }


        const item = { type: "node", id };
        const multiClick =
            selectionMode === "multi" ||
            selectionMode === "box" ||
            e?.ctrlKey ||
            e?.metaKey;

        if (multiClick) {
            setMultiSel((prev) => {
                const has = prev.some(
                    (x) => x.type === "node" && x.id === id
                );
                const next = has
                    ? prev.filter(
                        (x) => !(x.type === "node" && x.id === id)
                    )
                    : [...prev, item];

                setSelected(
                    has
                        ? next[next.length - 1] || null
                        : item
                );
                return next;
            });
        } else {
            setMultiSel([]);
            setSelected(item);
        }
    };




// ✅ multi-select aware room click
    const handleRoomDown = (id, e) => {
        if (dragActive) return;
        const room = rooms.find((r) => r.id === id);
        if (!room) return;
        if (room.locked) return;   // ❌ Never return pos, it does not exist


        // Deck add mode: click rooms to add them (and their nodes) to the active deck
        if (deckAddModeId) {
            addRoomToDeck(deckAddModeId, id);
            const count = nodes.filter((n) => n.roomId === id).length;
            setDeckAddLast(`Added room: ${room.name || room.id} (+${count} nodes)`);
            setMultiSel([]);
            setSelected({ type: "room", id });
            return;
        }


        // Add-to-Group mode: selection only; apply on "Done"
        if (groupAddModeId) {
            const additive = e?.ctrlKey || e?.metaKey;
            if (additive) {
                setMultiSel((prev) => toggleSel(prev, { type: "room", id }));
            } else {
                setMultiSel([{ type: "room", id }]);
                setSelected({ type: "room", id });
            }
            return;
        }

        const item = { type: "room", id };
        const multiClick =
            selectionMode === "multi" ||
            selectionMode === "box" ||
            e?.ctrlKey ||
            e?.metaKey;

        if (multiClick) {
            setMultiSel((prev) => {
                const has = prev.some(
                    (x) => x.type === "room" && x.id === id
                );
                const next = has
                    ? prev.filter(
                        (x) => !(x.type === "room" && x.id === id)
                    )
                    : [...prev, item];

                setSelected(
                    has
                        ? next[next.length - 1] || null
                        : item
                );
                return next;
            });
        } else {
            setMultiSel([]);
            setSelected(item);
        }
    };


// Delete a room (used by central "delete" icon)
    const handleRoomDelete = useCallback(
        (roomId) => {
            setRooms((prev) => prev.filter((r) => r.id !== roomId));

            // Clean up selection
            setSelected((sel) =>
                sel?.type === "room" && sel.id === roomId ? null : sel
            );
            setMultiSel((prev) =>
                prev.filter((s) => !(s.type === "room" && s.id === roomId))
            );
        },
        [setRooms, setSelected, setMultiSel]
    );

// Resize room from a side (used by left/right resize handles)
    const handleRoomResize = useCallback(
        (roomId, dir) => {
            setRooms((prev) =>
                prev.map((r) => {
                    if (r.id !== roomId) return r;

                    const size = r.size || [3, 1.6, 2.2];
                    let [w, h, d] = size;
                    const center = r.center || [0, h * 0.5, 0];
                    let [cx, cy, cz] = center;

                    const step = ROOM_GRID_STEP;

                    // Width (X)
                    if (dir === "left") {
                        // keep right side fixed, grow to the left
                        const rightX = cx + w / 2;
                        w = Math.max(step, w + step);
                        cx = rightX - w / 2;
                    } else if (dir === "right") {
                        // keep left side fixed, grow to the right
                        const leftX = cx - w / 2;
                        w = Math.max(step, w + step);
                        cx = leftX + w / 2;
                    }
                    // Depth (Z) — not used yet but nice to have
                    else if (dir === "up") {
                        const backZ = cz + d / 2;
                        d = Math.max(step, d + step);
                        cz = backZ - d / 2;
                    } else if (dir === "down") {
                        const frontZ = cz - d / 2;
                        d = Math.max(step, d + step);
                        cz = frontZ + d / 2;
                    }

                    return {
                        ...r,
                        size: [w, h, d],
                        center: [cx, cy, cz],
                    };
                })
            );
        },
        [setRooms]
    );

// Create a new room snapped to the selected side (up/down/left/right)
    // grid step used for floorplan snapping (already declared above for resize)

    // Create a new room snapped to the selected side (up/down/left/right or north/south/east/west)
    const ROOM_GRID_STEP = 1; // already present above

// Create a new room snapped to the selected side (up/down/left/right or north/south/east/west)
    const handleRoomAnchorClick = useCallback(
        (roomId, dirRaw) => {
            console.log("[Showcase] handleRoomAnchorClick called", { roomId, dirRaw });

            let created = null;

            setRooms((prev) => {
                const src = prev.find((r) => r.id === roomId);
                if (!src) return prev;

                const size = src.size || [3, 1.6, 2.2];
                const [w, h, d] = size;
                const center = src.center || [0, h * 0.5, 0];
                const [cx, , cz] = center;

                const cy = src.center?.[1] ?? h * 0.5;

                // Map north/south/east/west → up/down/left/right
                const dir =
                    dirRaw === "north" ? "up" :
                        dirRaw === "south" ? "down" :
                            dirRaw === "east"  ? "right" :
                                dirRaw === "west"  ? "left" :
                                    dirRaw;

                let nx = cx;
                let nz = cz;

                if (dir === "right") {
                    nx = cx + w;
                } else if (dir === "left") {
                    nx = cx - w;
                } else if (dir === "up") {
                    nz = cz + d;
                } else if (dir === "down") {
                    nz = cz - d;
                } else {
                    // unknown dir: do nothing
                    console.warn("[Showcase] Unknown anchor dir", dirRaw);
                    return prev;
                }

                const newRoom = {
                    ...src,
                    id: uuid(),
                    name: (src.name || "Room") + " +",
                    center: [nx, cy, nz],
                    size,
                };

                created = newRoom;
                return [...prev, newRoom];
            });

            if (created) {
                setSelected({ type: "room", id: created.id });
            }
        },
        [setRooms, setSelected]
    );



// Confirm delete modal
    const [confirm, setConfirm] = useState({ open: false, payload: null, text: "" });

    // Links map for per-node signals
    const signalMap = useMemo(() => {
        const m = {};
        renderNodes.forEach((n) => (m[n.id] = []));
        renderLinks.forEach((l) => {
            if (m[l.from]) m[l.from].push(l.to);
            if (m[l.to]) m[l.to].push(l.from);
        });
        return m;
    }, [renderNodes, renderLinks]);

    /* Drag & drop for import */
    const [dragOver, setDragOver] = useState(false);
    useEffect(() => {
        const onDragOver = (e) => {
            if (window.__UI_DROP_GUARD) return; // a modal wants exclusive DnD
            e.preventDefault(); setDragOver(true);
        };
        const onDragLeave = () => { if (window.__UI_DROP_GUARD) return; setDragOver(false); };
        const onDrop = (e) => {


            if (window.__UI_DROP_GUARD) return; // don’t handle if a modal is open
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer?.files?.[0]; if (!f) return;
            const name = (f.name || "").toLowerCase();
            const isModel = /\.(glb|gltf)$/i.test(name);
            const isZip = /\.zip$/i.test(name);
            const isJson = /\.json$/i.test(name);
            const isImage = /^image\//.test(f.type) || /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(name);
            if (isImage) return; // ignore images entirely (handled by modals/widgets)
            if (isZip || isJson) return importPackage(f);
            if (isModel) return onModelFiles(f);
            // unknown type: do nothing





        };
        window.addEventListener("dragover", onDragOver);
        window.addEventListener("dragleave", onDragLeave);
        window.addEventListener("drop", onDrop);
        return () => {
            window.removeEventListener("dragover", onDragOver);
            window.removeEventListener("dragleave", onDragLeave);
            window.removeEventListener("drop", onDrop);
        };
    }, [onModelFiles]);

    function ShadowController({ enabled }) {
        const { gl } = useThree();
        useEffect(() => {
            gl.shadowMap.enabled = !!enabled;
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }, [gl, enabled]);
        return null;
    }

    function CameraPoseBridge({ startupPose, snapshotRef }) {
        const { camera } = useThree();
        // OrbitControls with makeDefault registers here:
        const controls = useThree((s) => s.controls);

        // Apply pose whenever selection changes or controls become ready
        useEffect(() => {
            if (!startupPose) return;
            const { position, target, fov } = startupPose;

            if (Array.isArray(position)) camera.position.set(position[0], position[1], position[2]);
            if (typeof fov === "number" && camera.isPerspectiveCamera) {
                camera.fov = fov;
                camera.updateProjectionMatrix();
            }

            if (controls && target && Array.isArray(target)) {
                // set the orbit target and update controls
                controls.target.set(target[0], target[1], target[2]);
                controls.update();
            } else if (Array.isArray(target)) {
                camera.lookAt(target[0], target[1], target[2]);
            }
        }, [startupPose?.position?.[0], startupPose?.position?.[1], startupPose?.position?.[2],
            startupPose?.target?.[0], startupPose?.target?.[1], startupPose?.target?.[2],
            startupPose?.fov, controls, camera]);

        // Expose a snapshot function back to the top bar
        useEffect(() => {
            if (!snapshotRef) return;
            snapshotRef.current = () => {
                const pos = camera.position.toArray();
                let tgt = [0, 0, 0];
                if (controls && controls.target) {
                    // toArray may not exist on THREE.Vector3 in all builds; grab components:
                    const t = controls.target;
                    tgt = [t.x, t.y, t.z];
                }
                const fov = camera.isPerspectiveCamera ? camera.fov : undefined;
                return { position: pos, target: tgt, fov };
            };
        }, [snapshotRef, controls, camera]);

        return null;
    }

    const LegendTree = () => {
        const [filter, setFilter] = useState("");
        const grouped = useMemo(() => {
            const result = {};
            rooms.forEach((r) => {
                result[r.id] = { room: r, cats: {} };
                DEFAULT_CLUSTERS.forEach((c) => (result[r.id].cats[c] = []));
            });
            const unassigned = { id: "__no_room__", name: "Unassigned", center: [0, 0, 0], size: [0, 0, 0] };
            result[unassigned.id] = { room: unassigned, cats: {} };
            DEFAULT_CLUSTERS.forEach((c) => (result[unassigned.id].cats[c] = []));
            nodes.forEach((n) => {
                const bucket = n.roomId && result[n.roomId] ? result[n.roomId] : result[unassigned.id];
                if (!bucket.cats[n.cluster]) bucket.cats[n.cluster] = [];
                bucket.cats[n.cluster].push(n);
            });
            return result;
        }, [nodes, rooms]);

        const quickLink = (id) => {
            setMode("link");
            setLinkFromId(id);
            setSelected({ type: "node", id });
        };

        const selectionKey = selected ? `${selected.type}:${selected.id}` : "";

        const focus = useMemo(() => {
            const out = { roomId: null, cat: null, nodeId: null };
            if (!selected) return out;

            if (selected.type === "room") {
                out.roomId = selected.id;
                return out;
            }

            if (selected.type === "node") {
                const n = nodes.find((x) => x.id === selected.id);
                if (!n) return out;
                out.nodeId = n.id;
                out.cat = n.cluster || null;
                out.roomId = n.roomId || "__no_room__";
                return out;
            }

            if (selected.type === "link") {
                const l = links.find((x) => x.id === selected.id);
                if (!l) return out;
                const a = nodes.find((x) => x.id === l.from);
                out.nodeId = null;
                out.cat = null;
                out.roomId = a?.roomId || "__no_room__";
                return out;
            }

            return out;
        }, [selected, nodes, links]);

        const [openRooms, setOpenRooms] = useState(() => ({}));
        const [openCats, setOpenCats] = useState(() => ({}));

        const roomHeaderRefs = useRef(new Map());
        const nodeRowRefs = useRef(new Map());

        // Auto-unfold the selected room/category
        useEffect(() => {
            if (!focus.roomId) return;
            setOpenRooms((prev) => ({ ...prev, [focus.roomId]: true }));
        }, [selectionKey, focus.roomId]);

        useEffect(() => {
            if (!focus.roomId || !focus.cat) return;
            const key = `${focus.roomId}|${focus.cat}`;
            setOpenCats((prev) => ({ ...prev, [key]: true }));
        }, [selectionKey, focus.roomId, focus.cat]);

        // Scroll the left tree so the selection is always visible
        useEffect(() => {
            if (!selectionKey) return;
            const raf = requestAnimationFrame(() => {
                const nodeEl = focus.nodeId ? nodeRowRefs.current.get(focus.nodeId) : null;
                const roomEl = focus.roomId ? roomHeaderRefs.current.get(focus.roomId) : null;
                const el = nodeEl || roomEl;
                if (el && typeof el.scrollIntoView === "function") {
                    el.scrollIntoView({ block: "center", behavior: "smooth" });
                }
            });
            return () => cancelAnimationFrame(raf);
        }, [selectionKey, focus.roomId, focus.nodeId]);

        return (
            <Panel title="Legend / Tree">
                <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                    <Input value={filter} placeholder="Filter…" onChange={(e) => setFilter(e.target.value)} />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Btn
                            variant={placingRoom ? "primary" : "ghost"}
                            glow={placingRoom}
                            onClick={() =>
                                setPlacement((p) => (p.placeKind === "room" ? { ...p, armed: !p.armed } : { ...p, armed: true, placeKind: "room" }))
                            }
                        >
                            {placingRoom ? "Placing Room (ON)" : "Place Room"}
                        </Btn>

                        {placingRoom && (
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <span style={{ opacity: 0.8, fontSize: 12 }}>Room draw:</span>
                                <Btn
                                    variant={(placement.roomDrawMode || "box") === "box" ? "primary" : "ghost"}
                                    onClick={() => setPlacement((p) => ({ ...p, roomDrawMode: "box" }))}
                                    title="2-click square draw"
                                >
                                    Box
                                </Btn>
                                <Btn
                                    variant={(placement.roomDrawMode || "box") === "points" ? "primary" : "ghost"}
                                    onClick={() => setPlacement((p) => ({ ...p, roomDrawMode: "points" }))}
                                    title="Click points, then Enter or Finalize"
                                >
                                    Points
                                </Btn>

                                {(placement.roomDrawMode || "box") === "points" && (
                                    <Btn
                                        variant="primary"
                                        onClick={() => window.dispatchEvent(new Event("EPIC3D_FINALIZE_ROOM_POINTS"))}
                                        title="Finalize polygon points (Enter)"
                                    >
                                        Finalize
                                    </Btn>
                                )}

                                <Btn
                                    variant="ghost"
                                    onClick={() => {
                                        const mode = placement.roomDrawMode || "box";
                                        window.dispatchEvent(new Event(mode === "points" ? "EPIC3D_CLEAR_ROOM_POINTS" : "EPIC3D_CANCEL_ROOM_BOX"));
                                    }}
                                    title="Clear points / cancel box"
                                >
                                    Clear
                                </Btn>
                            </div>
                        )}


                        <Btn
                            variant={placingNode ? "primary" : "ghost"}
                            glow={placingNode}
                            onClick={() =>
                                setPlacement((p) => (p.placeKind === "node" ? { ...p, armed: !p.armed } : { ...p, armed: true, placeKind: "node" }))
                            }
                        >
                            {placingNode ? "Placing Node (ON)" : "Place Node"}
                        </Btn>

                        <Btn
                            variant={placingSwitch ? "primary" : "ghost"}
                            glow={placingSwitch}
                            onClick={() =>
                                setPlacement((p) => (p.placeKind === "switch" ? { ...p, armed: !p.armed } : { ...p, armed: true, placeKind: "switch" }))
                            }
                        >
                            {placingSwitch ? "Placing Switch (ON)" : "Place Switch"}
                        </Btn>

                        <Btn
                            variant={mode === "link" ? "primary" : "ghost"}
                            glow={mode === "link"}
                            onClick={() => {
                                setLinkFromId(null);
                                setMode((m) => (m === "link" ? "select" : "link"));
                            }}
                        >
                            {mode === "link" ? "Link Mode (ON)" : "Link Mode"}
                        </Btn>

                        <Checkbox checked={placement.multi} onChange={(v) => setPlacement((p) => ({ ...p, multi: v, armed: v || p.armed }))} label="multi" />
                    </div>
                </div>

                {Object.values(grouped).map((bucket) => {
                    const rid = bucket.room.id;
                    const itemsByCat = bucket.cats;
                    const focusedRoom = focus.roomId === rid;

                    const roomOpen = Object.prototype.hasOwnProperty.call(openRooms, rid)
                        ? !!openRooms[rid]
                        : focusedRoom;

                    const toggleRoom = (e) => {
                        e.preventDefault();
                        setOpenRooms((prev) => {
                            const current = Object.prototype.hasOwnProperty.call(prev, rid)
                                ? !!prev[rid]
                                : focusedRoom;
                            return { ...prev, [rid]: !current };
                        });
                    };

                    return (
                        <div
                            key={rid}
                            style={{
                                marginBottom: 10,
                                borderTop: "1px dashed rgba(255,255,255,0.1)",
                                paddingTop: 8,
                            }}
                        >
                            <details open={roomOpen}>
                                <summary
                                    ref={(el) => {
                                        if (el) roomHeaderRefs.current.set(rid, el);
                                        else roomHeaderRefs.current.delete(rid);
                                    }}
                                    onClick={toggleRoom}
                                    style={{
                                        listStyle: "none",
                                        cursor: "pointer",
                                        userSelect: "none",
                                        padding: "6px 8px",
                                        borderRadius: 12,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        background: focusedRoom
                                            ? "linear-gradient(180deg, rgba(56,189,248,0.18), rgba(255,255,255,0.03))"
                                            : "rgba(255,255,255,0.04)",
                                        border: focusedRoom
                                            ? "1px solid rgba(56,189,248,0.55)"
                                            : "1px solid rgba(255,255,255,0.10)",
                                        boxShadow: focusedRoom
                                            ? "0 10px 22px rgba(0,0,0,0.45), 0 0 0 2px rgba(56,189,248,0.12)"
                                            : "0 8px 18px rgba(0,0,0,0.28)",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            minWidth: 0,
                                        }}
                                    >
                                        <a
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setSelected({ type: "room", id: rid });
                                                setOpenRooms((prev) => ({ ...prev, [rid]: true }));
                                            }}
                                            style={{
                                                fontWeight: 800,
                                                color: focusedRoom
                                                    ? "rgba(224,247,255,0.98)"
                                                    : "#a8c0ff",
                                                cursor: "pointer",
                                                textDecoration: "none",
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {bucket.room.name}
                                        </a>

                                        {focusedRoom && (
                                            <span
                                                style={{
                                                    fontSize: 10,
                                                    padding: "2px 6px",
                                                    borderRadius: 999,
                                                    background: "rgba(56,189,248,0.18)",
                                                    border:
                                                        "1px solid rgba(56,189,248,0.45)",
                                                    color: "rgba(226,241,255,0.95)",
                                                }}
                                            >
                                                Selected
                                            </span>
                                        )}
                                    </div>
                                    <span style={{ opacity: 0.8, fontSize: 12 }}>
                                        {roomOpen ? "▾" : "▸"}
                                    </span>
                                </summary>

                                <div
                                    style={{
                                        marginTop: 8,
                                        padding: 8,
                                        borderRadius: 12,
                                        background: focusedRoom
                                            ? "rgba(0,0,0,0.16)"
                                            : "rgba(0,0,0,0.10)",
                                        border: focusedRoom
                                            ? "1px solid rgba(56,189,248,0.22)"
                                            : "1px solid rgba(255,255,255,0.06)",
                                    }}
                                >
                                    {rid !== "__no_room__" && (
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                gap: 8,
                                                flexWrap: "wrap",
                                                marginBottom: 8,
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    gap: 8,
                                                    alignItems: "center",
                                                    flexWrap: "wrap",
                                                }}
                                            >
                                                <Checkbox
                                                    checked={!!rooms.find((r) => r.id === rid)?.locked}
                                                    onChange={(v) =>
                                                        setRooms((prev) =>
                                                            prev.map((r) =>
                                                                r.id === rid
                                                                    ? { ...r, locked: v }
                                                                    : r,
                                                            ),
                                                        )
                                                    }
                                                    label="lock"
                                                />
                                                <Checkbox
                                                    checked={rooms.find((r) => r.id === rid)?.visible !== false}
                                                    onChange={(v) =>
                                                        setRooms((prev) =>
                                                            prev.map((r) =>
                                                                r.id === rid
                                                                    ? { ...r, visible: v }
                                                                    : r,
                                                            ),
                                                        )
                                                    }
                                                    label="visible"
                                                />
                                            </div>

                                            <div
                                                style={{
                                                    display: "flex",
                                                    gap: 6,
                                                    alignItems: "center",
                                                    flexWrap: "wrap",
                                                }}
                                            >
                                                <Btn onClick={() => duplicateRoom(rid)}>
                                                    Duplicate
                                                </Btn>
                                                <Btn onClick={() => moveRoomPack(rid)}>
                                                    Move all
                                                </Btn>
                                                <Btn onClick={() => rotateRoomPack(rid)} disabled={!!rooms.find((r) => r.id === rid)?.locked}>
                                                    Rotate all
                                                </Btn>
                                                <Btn onClick={() => scaleRoomWithContents(rid)} disabled={!!rooms.find((r) => r.id === rid)?.locked}>
                                                    Scale
                                                </Btn>
                                                <Btn
                                                    onClick={() =>
                                                        requestDelete({
                                                            type: "room",
                                                            id: rid,
                                                        })
                                                    }
                                                >
                                                    Delete
                                                </Btn>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        {DEFAULT_CLUSTERS.map((cat) => {
                                            const list = (itemsByCat[cat] || []).filter(
                                                (n) =>
                                                    !filter ||
                                                    n.label
                                                        .toLowerCase()
                                                        .includes(filter.toLowerCase()),
                                            );
                                            const catKey = `${rid}|${cat}`;
                                            const focusedCat = focusedRoom && focus.cat === cat;
                                            const catOpen = Object.prototype.hasOwnProperty.call(
                                                openCats,
                                                catKey,
                                            )
                                                ? !!openCats[catKey]
                                                : (focusedCat || focusedRoom);

                                            const toggleCat = (e) => {
                                                e.preventDefault();
                                                setOpenCats((prev) => {
                                                    const cur = Object.prototype.hasOwnProperty.call(
                                                        prev,
                                                        catKey,
                                                    )
                                                        ? !!prev[catKey]
                                                        : focusedCat;
                                                    return {
                                                        ...prev,
                                                        [catKey]: !cur,
                                                    };
                                                });
                                            };

                                            return (
                                                <details
                                                    key={cat}
                                                    open={catOpen}
                                                    style={{ marginLeft: 4, marginBottom: 8 }}
                                                >
                                                    <summary
                                                        onClick={toggleCat}
                                                        style={{
                                                            listStyle: "none",
                                                            cursor: "pointer",
                                                            userSelect: "none",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "space-between",
                                                            gap: 8,
                                                            padding: "4px 6px",
                                                            borderRadius: 10,
                                                            background: focusedCat
                                                                ? "rgba(56,189,248,0.12)"
                                                                : "rgba(255,255,255,0.03)",
                                                            border: focusedCat
                                                                ? "1px solid rgba(56,189,248,0.35)"
                                                                : "1px solid rgba(255,255,255,0.08)",
                                                            color: focusedCat
                                                                ? "rgba(226,241,255,0.95)"
                                                                : "#9fb6d8",
                                                            fontWeight: 800,
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: 8,
                                                                minWidth: 0,
                                                            }}
                                                        >
                                                            <span
                                                                style={{
                                                                    overflow: "hidden",
                                                                    textOverflow: "ellipsis",
                                                                    whiteSpace: "nowrap",
                                                                }}
                                                            >
                                                                {cat}
                                                            </span>
                                                            <span style={{ opacity: 0.6 }}>
                                                                ({list.length})
                                                            </span>
                                                        </span>
                                                        <span style={{ opacity: 0.7 }}>
                                                            {catOpen ? "▾" : "▸"}
                                                        </span>
                                                    </summary>

                                                    <div
                                                        style={{
                                                            marginLeft: 10,
                                                            marginTop: 6,
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: 4,
                                                        }}
                                                    >
                                                        {list.map((n) => (
                                                            <div
                                                                key={n.id}
                                                                ref={(el) => {
                                                                    if (el)
                                                                        nodeRowRefs.current.set(
                                                                            n.id,
                                                                            el,
                                                                        );
                                                                    else
                                                                        nodeRowRefs.current.delete(
                                                                            n.id,
                                                                        );
                                                                }}
                                                                style={{
                                                                    display: "flex",
                                                                    alignItems: "center",
                                                                    justifyContent: "space-between",
                                                                    border: focusedRoom && selected?.type === "node" && selected?.id === n.id
                                                                        ? "1px solid rgba(56,189,248,0.55)"
                                                                        : "1px solid rgba(255,255,255,0.08)",
                                                                    borderRadius: 10,
                                                                    padding: "5px 7px",
                                                                    background:
                                                                        selected?.type === "node" &&
                                                                        selected?.id === n.id
                                                                            ? "rgba(0,225,255,0.14)"
                                                                            : "rgba(255,255,255,0.04)",
                                                                }}
                                                            >
                                                                <div
                                                                    style={{
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        gap: 6,
                                                                        minWidth: 0,
                                                                    }}
                                                                >
                                                                    <span
                                                                        style={{
                                                                            width: 10,
                                                                            height: 10,
                                                                            borderRadius: 3,
                                                                            background:
                                                                                n.color ||
                                                                                clusterColor(
                                                                                    n.cluster,
                                                                                ),
                                                                        }}
                                                                    />
                                                                    <a
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            setSelected({
                                                                                type: "node",
                                                                                id: n.id,
                                                                            });
                                                                        }}
                                                                        style={{
                                                                            color: "#fff",
                                                                            cursor: "pointer",
                                                                            textDecoration:
                                                                                "none",
                                                                            overflow: "hidden",
                                                                            textOverflow:
                                                                                "ellipsis",
                                                                            whiteSpace:
                                                                                "nowrap",
                                                                        }}
                                                                    >
                                                                        {n.label}
                                                                    </a>
                                                                    {n.kind === "switch" && (
                                                                        <span
                                                                            style={{
                                                                                opacity: 0.7,
                                                                                fontSize: 11,
                                                                            }}
                                                                        >
                                                                            (switch)
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div
                                                                    style={{
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        gap: 6,
                                                                    }}
                                                                >
                                                                    <IconBtn
                                                                        label="⚭"
                                                                        title="Link from this node"
                                                                        onClick={() =>
                                                                            quickLink(
                                                                                n.id,
                                                                            )
                                                                        }
                                                                    />
                                                                    <IconBtn
                                                                        label="⧉"
                                                                        title="Duplicate"
                                                                        onClick={() =>
                                                                            duplicateNode(
                                                                                n.id,
                                                                            )
                                                                        }
                                                                    />
                                                                    {n.light?.type !==
                                                                        "none" && (
                                                                            <Checkbox
                                                                                checked={
                                                                                    !!n.light
                                                                                        .enabled
                                                                                }
                                                                                onChange={(v) => setLightEnabled(n.id, v)}
                                                                                label="light"
                                                                            />
                                                                        )}

                                                                    <Btn
                                                                        onClick={() =>
                                                                            requestDelete(
                                                                                {
                                                                                    type: "node",
                                                                                    id: n.id,
                                                                                },
                                                                            )
                                                                        }
                                                                    >
                                                                        ✕
                                                                    </Btn>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </details>
                                            );
                                        })}
                                    </div>
                                </div>
                            </details>
                        </div>
                    );
                })}
            </Panel>
        );
    };

    // --- Groups UI helpers (local, scoped to the editor) ---
    const NFCard = ({ children, style, onClick, title }) => (
        <div
            title={title}
            onClick={onClick}
            style={{
                padding: 12,
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.12)",
                background:
                    "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025))",
                boxShadow:
                    "inset 0 0 0 1px rgba(255,255,255,0.03), 0 18px 50px rgba(0,0,0,0.35)",
                ...style,
            }}
        >
            {children}
        </div>
    );

    const NFTag = ({ children, tone = "neutral", style }) => {
        const bg =
            tone === "blue"
                ? "rgba(59,130,246,0.18)"
                : tone === "teal"
                    ? "rgba(20,184,166,0.18)"
                    : "rgba(255,255,255,0.08)";
        const bd =
            tone === "blue"
                ? "rgba(59,130,246,0.30)"
                : tone === "teal"
                    ? "rgba(20,184,166,0.30)"
                    : "rgba(255,255,255,0.16)";
        return (
            <span
                style={{
                    padding: "3px 8px",
                    borderRadius: 999,
                    border: `1px solid ${bd}`,
                    background: bg,
                    fontSize: 11,
                    fontWeight: 750,
                    opacity: 0.95,
                    ...style,
                }}
            >
                {children}
            </span>
        );
    };
    const EyeOpenIcon = ({ size = 16 }) => (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ display: 'block' }}
        >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );

    const EyeClosedIcon = ({ size = 16 }) => (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ display: 'block' }}
        >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
            <path d="M3 3l18 18" />
        </svg>
    );

    const NFIconBtn = ({ icon, title, onClick, danger, active }) => (
        <button
            type="button"
            title={title}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
                e.stopPropagation();
                onClick && onClick(e);
            }}
            style={{
                width: 30,
                height: 30,
                display: "grid",
                placeItems: "center",
                borderRadius: 12,
                border: active
                    ? "1px solid rgba(255,255,255,0.26)"
                    : "1px solid rgba(255,255,255,0.14)",
                background: danger
                    ? "rgba(239,68,68,0.14)"
                    : active
                        ? "rgba(255,255,255,0.10)"
                        : "rgba(255,255,255,0.06)",
                color: danger ? "#fecaca" : "#fff",
                cursor: "pointer",
                boxShadow:
                    "0 10px 26px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.03)",
            }}
        >
            {typeof icon === "string" ? (
                <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
            ) : (
                icon
            )}
        </button>
    );

    const NFSubLabel = ({ children, style }) => (
        <div
            style={{
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                fontSize: 9,
                fontWeight: 800,
                opacity: 0.65,
                marginBottom: 6,
                ...style,
            }}
        >
            {children}
        </div>
    );

    const GroupsPanel = () => {
        const [mergePick, setMergePick] = useState({});
        const [mergeRemove, setMergeRemove] = useState({});
        const [addRoomPick, setAddRoomPick] = useState({});
        const [addNodePick, setAddNodePick] = useState({});
        const [groupSearch, setGroupSearch] = useState("");

        const createGroup = () => {
            const id = uuid();
            const base = "Group";
            const used = new Set(groups.map((g) => (g.name || "").toLowerCase()));
            let name = base,
                i = 2;
            while (used.has(name.toLowerCase())) name = `${base} ${i++}`;
            setGroups((prev) => [...prev, { id, name, hidden: false }]);
        };

        const getSelKeys = () => {
            const s = new Set();
            const push = (it) => {
                if (!it || !it.type || !it.id) return;
                if (it.type !== "room" && it.type !== "node") return;
                s.add(`${it.type}:${it.id}`);
            };
            push(selected);
            (multiSel || []).forEach(push);
            return s;
        };
        const selKeys = getSelKeys();
        const selCount = selKeys.size;

        const visibleGroups = useMemo(() => {
            const q = (groupSearch || "").trim().toLowerCase();
            if (!q) return groups;
            return (groups || []).filter((g) => {
                const name = (g.name || "").toLowerCase();
                const id = (g.id || "").toLowerCase();
                return name.includes(q) || id.includes(q);
            });
        }, [groups, groupSearch]);

        return (
            <Panel title="Groups">
                <div style={{ display: "grid", gap: 12 }}>
                    <div
                        style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                        }}
                    >
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <Btn onClick={createGroup} variant="primary">
                                New group
                            </Btn>
                            <div style={{ minWidth: 220, maxWidth: 320 }}>
                                <Input
                                    value={groupSearch}
                                    onChange={(e) => setGroupSearch(e.target.value)}
                                    placeholder="Search groups…"
                                />
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.75 }}>Tip: rooms + nodes inherit group hide / show.</div>
                        </div>

                        {groupAddModeId && (
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <NFTag tone="blue">Add-to-group active</NFTag>
                                <div style={{ fontSize: 11, opacity: 0.85 }}>Select rooms/nodes in the scene, then press Done.</div>
                                <Btn onClick={applyGroupAddMode} variant="primary">
                                    Done
                                </Btn>
                            </div>
                        )}
                    </div>

                    {groups.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>No groups yet.</div>
                    ) : visibleGroups.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>No groups match “{groupSearch}”.</div>
                    ) : (
                        <div style={{ display: "grid", gap: 12 }}>
                            {visibleGroups.map((g) => {
                                const roomCount = rooms.filter((r) => r.groupId === g.id).length;
                                const nodeCount = nodes.filter((n) => n.groupId === g.id).length;

                                return (
                                    <NFCard key={g.id}>
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: 10,
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                flexWrap: "wrap",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    gap: 10,
                                                    alignItems: "center",
                                                    flexWrap: "wrap",
                                                    flex: 1,
                                                    minWidth: 240,
                                                }}
                                            >
                                                <Input
                                                    value={g.name || ""}
                                                    onChange={(e) =>
                                                        setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))
                                                    }
                                                    style={{ maxWidth: 260 }}
                                                />
                                                <NFTag tone="blue">{roomCount} rooms</NFTag>
                                                <NFTag tone="teal">{nodeCount} nodes</NFTag>
                                                {g.hidden && <NFTag>hidden</NFTag>}
                                            </div>

                                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                                <NFIconBtn
                                                    icon={groupAddModeId === g.id ? "✅" : "➕"}
                                                    title={
                                                        groupAddModeId === g.id
                                                            ? "Finish adding (press Done at top)"
                                                            : "Add by clicking items in the scene"
                                                    }
                                                    onClick={() => setGroupAddModeId((prev) => (prev === g.id ? null : g.id))}
                                                    active={groupAddModeId === g.id}
                                                />
                                                <Btn
                                                    onClick={() => addSelectionToGroup(g.id)}
                                                    disabled={selCount === 0}
                                                    title={selCount === 0 ? "Select one or more rooms/nodes first" : "Add current selection to this group"}
                                                    variant="primary"
                                                    style={{ padding: "8px 10px" }}
                                                >
                                                    Add selected{selCount ? ` (${selCount})` : ""}
                                                </Btn>

                                                <NFIconBtn
                                                    icon={g.hidden ? <EyeClosedIcon /> : <EyeOpenIcon />}
                                                    title={g.hidden ? "Show group" : "Hide group"}
                                                    onClick={() => setGroupHidden(g.id, !g.hidden)}
                                                    active={!!g.hidden}
                                                />
                                                <NFIconBtn icon="⧉" title="Duplicate group" onClick={() => duplicateGroup(g.id)} />
                                                <NFIconBtn icon="↕️" title="Move group" onClick={() => moveGroup(g.id)} />
                                            </div>
                                        </div>

                                        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                                <div>
                                                    <NFSubLabel>Add room</NFSubLabel>
                                                    <Select
                                                        value={addRoomPick[g.id] || ""}
                                                        onChange={(e) => {
                                                            const roomId = e.target.value;
                                                            setAddRoomPick((m) => ({ ...(m || {}), [g.id]: "" }));
                                                            if (roomId) addRoomToGroup(g.id, roomId, true);
                                                        }}
                                                        title="Add a room to this group (also adds all nodes inside the room)"
                                                    >
                                                        <option value="" disabled>
                                                            Select a room…
                                                        </option>
                                                        {rooms.map((r) => (
                                                            <option key={r.id} value={r.id}>
                                                                {r.name || r.id}
                                                            </option>
                                                        ))}
                                                    </Select>
                                                </div>

                                                <div>
                                                    <NFSubLabel>Add node</NFSubLabel>
                                                    <Select
                                                        value={addNodePick[g.id] || ""}
                                                        onChange={(e) => {
                                                            const nodeId = e.target.value;
                                                            setAddNodePick((m) => ({ ...(m || {}), [g.id]: "" }));
                                                            if (nodeId) addNodeToGroup(g.id, nodeId);
                                                        }}
                                                        title="Add a single node to this group"
                                                    >
                                                        <option value="" disabled>
                                                            Select a node…
                                                        </option>
                                                        {nodes.map((n) => (
                                                            <option key={n.id} value={n.id}>
                                                                {n.label || n.id}
                                                            </option>
                                                        ))}
                                                    </Select>
                                                </div>
                                            </div>

                                            <div
                                                style={{
                                                    display: "flex",
                                                    gap: 10,
                                                    alignItems: "center",
                                                    flexWrap: "wrap",
                                                    paddingTop: 10,
                                                    borderTop: "1px dashed rgba(255,255,255,0.16)",
                                                }}
                                            >
                                                <Checkbox
                                                    checked={!!mergeRemove[g.id]}
                                                    onChange={(v) => setMergeRemove((m) => ({ ...(m || {}), [g.id]: v }))}
                                                    label="Delete src"
                                                    title="When merging, also remove the source group (leaves no empty groups behind)"
                                                />

                                                <div style={{ flex: 1, minWidth: 220 }}>
                                                    <NFSubLabel style={{ marginBottom: 6 }}>Merge into this group</NFSubLabel>
                                                    <Select
                                                        value={mergePick[g.id] || ""}
                                                        onChange={(e) => {
                                                            const from = e.target.value;
                                                            setMergePick((m) => ({ ...m, [g.id]: "" }));
                                                            if (from) mergeGroups(g.id, from, { removeSource: !!mergeRemove[g.id] });
                                                        }}
                                                        title="Merge another group into this one"
                                                    >
                                                        <option value="" disabled>
                                                            Pick a source group…
                                                        </option>
                                                        {groups
                                                            .filter((x) => x.id !== g.id)
                                                            .map((x) => (
                                                                <option key={x.id} value={x.id}>
                                                                    {x.name || x.id}
                                                                </option>
                                                            ))}
                                                    </Select>
                                                </div>
                                            </div>
                                        </div>
                                    </NFCard>
                                );
                            })}
                        </div>
                    )}
                </div>
            </Panel>
        );
    };


    const GroupsMembersPanel = () => {
        const [memberSearch, setMemberSearch] = useState("");
        const [openRoomsByGroup, setOpenRoomsByGroup] = useState(() => ({}));
        const [openNodesByGroup, setOpenNodesByGroup] = useState(() => ({}));

        const grouped = useMemo(
            () =>
                (groups || []).map((g) => {
                    const gRooms = (rooms || []).filter((r) => r.groupId === g.id);
                    const gNodes = (nodes || []).filter((n) => n.groupId === g.id);
                    return { group: g, rooms: gRooms, nodes: gNodes };
                }),
            [groups, rooms, nodes]
        );

        const q = (memberSearch || "").trim().toLowerCase();

        const filteredGrouped = useMemo(() => {
            if (!q) return grouped;
            const out = [];
            for (const it of grouped) {
                const g = it.group;
                const gName = (g.name || "").toLowerCase();
                const gId = (g.id || "").toLowerCase();
                const groupMatch = gName.includes(q) || gId.includes(q);

                const rFiltered = groupMatch
                    ? it.rooms
                    : it.rooms.filter((r) => ((r.name || r.id || "").toLowerCase().includes(q)));

                const nFiltered = groupMatch
                    ? it.nodes
                    : it.nodes.filter((n) => ((n.label || n.id || "").toLowerCase().includes(q)));

                if (groupMatch || rFiltered.length || nFiltered.length) {
                    out.push({ group: g, rooms: rFiltered, nodes: nFiltered, _fullRooms: it.rooms, _fullNodes: it.nodes });
                }
            }
            return out;
        }, [grouped, q]);

        const selectRoom = (id) => {
            setSelected({ type: "room", id });
            setMultiSel([]);
        };
        const selectNode = (id) => {
            setSelected({ type: "node", id });
            setMultiSel([]);
        };

        const rowStyle = {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 10px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.045)",
            cursor: "pointer",
        };

        const summaryStyle = {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 10px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.03)",
            cursor: "pointer",
            listStyle: "none",
        };

        const metaStyle = { fontSize: 10, opacity: 0.65, marginTop: 1 };

        if (!grouped.length) {
            return (
                <Panel title="Groups – Members">
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                        No groups yet. Create a group in <b>Groups</b> and then add rooms/nodes.
                    </div>
                </Panel>
            );
        }

        return (
            <Panel title="Groups – Members">
                <div style={{ display: "grid", gap: 10 }}>
                    <Input
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        placeholder="Search groups / members…"
                    />

                    {filteredGrouped.length === 0 ? (
                        <div style={{ opacity: 0.7, fontSize: 12 }}>No matches for “{memberSearch}”.</div>
                    ) : (
                        <div style={{ display: "grid", gap: 12 }}>
                            {filteredGrouped.map(({ group: g, rooms: gRooms, nodes: gNodes, _fullRooms, _fullNodes }) => {
                                const fullRooms = _fullRooms || gRooms;
                                const fullNodes = _fullNodes || gNodes;
                                const hasMembers = fullRooms.length + fullNodes.length > 0;

                                const roomsOpen = q ? true : (openRoomsByGroup[g.id] ?? false);
                                const nodesOpen = q ? true : (openNodesByGroup[g.id] ?? false);

                                return (
                                    <NFCard key={g.id}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                gap: 10,
                                                flexWrap: "wrap",
                                            }}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1, minWidth: 240 }}>
                                                <Input
                                                    value={g.name || ""}
                                                    onChange={(e) => renameGroup(g.id, e.target.value)}
                                                    style={{ maxWidth: 260 }}
                                                />
                                                <NFTag tone="blue">{fullRooms.length} rooms</NFTag>
                                                <NFTag tone="teal">{fullNodes.length} nodes</NFTag>
                                                {g.hidden && <NFTag>hidden</NFTag>}
                                            </div>

                                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                <NFIconBtn
                                                    icon={g.hidden ? <EyeClosedIcon /> : <EyeOpenIcon />}
                                                    title={g.hidden ? "Show group" : "Hide group"}
                                                    onClick={() => setGroupHidden(g.id, !g.hidden)}
                                                    active={!!g.hidden}
                                                />
                                                <NFIconBtn
                                                    icon="🕳️"
                                                    title="Delete group (keeps rooms/nodes, just ungroups them)"
                                                    danger
                                                    onClick={() => {
                                                        const ok = window.confirm(
                                                            `Delete group “${g.name || "Group"}”?

This will UNGROUP its rooms/nodes (it won’t delete them).`
                                                        );
                                                        if (ok) deleteGroup(g.id);
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        <div style={{ marginTop: 12 }}>
                                            {hasMembers ? (
                                                <div style={{ display: "grid", gap: 10 }}>
                                                    <details
                                                        open={roomsOpen}
                                                        onToggle={(e) => {
                                                            if (q) return;
                                                            setOpenRoomsByGroup((m) => ({ ...(m || {}), [g.id]: !!e.currentTarget.open }));
                                                        }}
                                                    >
                                                        <summary style={summaryStyle}>
                                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                <span style={{ opacity: 0.75 }}>Rooms</span>
                                                                <NFTag tone="blue">{gRooms.length}</NFTag>
                                                            </div>
                                                            <span style={{ opacity: 0.7, fontSize: 12 }}>{roomsOpen ? "▾" : "▸"}</span>
                                                        </summary>
                                                        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                                                            {gRooms.length === 0 ? (
                                                                <div style={{ fontSize: 11, opacity: 0.7 }}>No rooms match.</div>
                                                            ) : (
                                                                gRooms.map((r) => {
                                                                    const nodesInRoom = (nodes || []).filter((n) => n.roomId === r.id).length;
                                                                    return (
                                                                        <div
                                                                            key={r.id}
                                                                            onClick={() => selectRoom(r.id)}
                                                                            role="button"
                                                                            title="Select room"
                                                                            style={rowStyle}
                                                                        >
                                                                            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                                                                <div
                                                                                    style={{
                                                                                        width: 26,
                                                                                        height: 26,
                                                                                        borderRadius: 12,
                                                                                        display: "grid",
                                                                                        placeItems: "center",
                                                                                        border: "1px solid rgba(255,255,255,0.14)",
                                                                                        background: "rgba(59,130,246,0.14)",
                                                                                        flex: "0 0 auto",
                                                                                    }}
                                                                                >
                                                                                    🏠
                                                                                </div>
                                                                                <div style={{ minWidth: 0 }}>
                                                                                    <div
                                                                                        style={{
                                                                                            fontSize: 12,
                                                                                            fontWeight: 800,
                                                                                            whiteSpace: "nowrap",
                                                                                            overflow: "hidden",
                                                                                            textOverflow: "ellipsis",
                                                                                        }}
                                                                                    >
                                                                                        {r.name || "Room"}
                                                                                    </div>
                                                                                    <div style={metaStyle}>{nodesInRoom} nodes in room</div>
                                                                                </div>
                                                                            </div>

                                                                            <NFIconBtn
                                                                                icon="🗑️"
                                                                                title="Remove room from group (also removes nodes inside the room that belong to this group)"
                                                                                danger
                                                                                onClick={() => removeRoomFromGroup(g.id, r.id, { removeNodesInRoom: true })}
                                                                            />
                                                                        </div>
                                                                    );
                                                                })
                                                            )}
                                                        </div>
                                                    </details>

                                                    <details
                                                        open={nodesOpen}
                                                        onToggle={(e) => {
                                                            if (q) return;
                                                            setOpenNodesByGroup((m) => ({ ...(m || {}), [g.id]: !!e.currentTarget.open }));
                                                        }}
                                                    >
                                                        <summary style={summaryStyle}>
                                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                <span style={{ opacity: 0.75 }}>Nodes</span>
                                                                <NFTag tone="teal">{gNodes.length}</NFTag>
                                                            </div>
                                                            <span style={{ opacity: 0.7, fontSize: 12 }}>{nodesOpen ? "▾" : "▸"}</span>
                                                        </summary>
                                                        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                                                            {gNodes.length === 0 ? (
                                                                <div style={{ fontSize: 11, opacity: 0.7 }}>No nodes match.</div>
                                                            ) : (
                                                                gNodes.map((n) => {
                                                                    const roomName = n.roomId
                                                                        ? (rooms || []).find((r) => r.id === n.roomId)?.name
                                                                        : null;
                                                                    return (
                                                                        <div
                                                                            key={n.id}
                                                                            onClick={() => selectNode(n.id)}
                                                                            role="button"
                                                                            title="Select node"
                                                                            style={rowStyle}
                                                                        >
                                                                            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                                                                <div
                                                                                    style={{
                                                                                        width: 10,
                                                                                        height: 10,
                                                                                        borderRadius: 999,
                                                                                        background: n.color || "#22c55e",
                                                                                        boxShadow: "0 0 0 3px rgba(255,255,255,0.06)",
                                                                                        flex: "0 0 auto",
                                                                                    }}
                                                                                />
                                                                                <div style={{ minWidth: 0 }}>
                                                                                    <div
                                                                                        style={{
                                                                                            fontSize: 12,
                                                                                            fontWeight: 800,
                                                                                            whiteSpace: "nowrap",
                                                                                            overflow: "hidden",
                                                                                            textOverflow: "ellipsis",
                                                                                        }}
                                                                                    >
                                                                                        {n.label || "Node"}
                                                                                    </div>
                                                                                    <div style={metaStyle}>{roomName ? `Room: ${roomName}` : "No room"}</div>
                                                                                </div>
                                                                            </div>

                                                                            <NFIconBtn
                                                                                icon="🗑️"
                                                                                title="Remove node from group"
                                                                                danger
                                                                                onClick={() => removeNodeFromGroup(n.id)}
                                                                            />
                                                                        </div>
                                                                    );
                                                                })
                                                            )}
                                                        </div>
                                                    </details>
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: 11, opacity: 0.7 }}>No rooms or nodes in this group yet.</div>
                                            )}
                                        </div>
                                    </NFCard>
                                );
                            })}
                        </div>
                    )}
                </div>
            </Panel>
        );
    };

    const LinksPanel = () => (
        <Panel title="Links">
            <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Btn onClick={() => setMode(mode === "link" ? "select" : "link")} glow={mode === "link"} variant={mode === "link" ? "primary" : "ghost"}>
                        {mode === "link" ? "Link Mode: ON" : "Link Mode: OFF"}
                    </Btn>
                    {linkFromId && <span style={{ fontSize: 12, opacity: 0.85 }}>From: {nodes.find((n) => n.id === linkFromId)?.label || linkFromId} → pick target…</span>}
                </div>
                {selectedLink && <Btn onClick={() => requestDelete({ type: "link", id: selectedLink.id })}>Delete Selected Link</Btn>}
                <div style={{ fontSize: 11, opacity: 0.8 }}>Tip: Click first node, then second. Switch in pair ⇒ glowing tube.</div>
            </div>
        </Panel>
    );


    const FlowDefaultsPanel = () => (
        <Panel title="Flow / Link Defaults">
            <div style={{ display: "grid", gap: 8 }}>
                <label>
                    Style
                    <Select
                        value={linkDefaults.style}
                        onChange={(e) => setLinkDefaults((d) => ({ ...d, style: e.target.value }))}
                    >
                        <option value="particles">particles</option>
                        <option value="wavy">wavy</option>
                        <option value="icons">icons</option>
                        <option value="dashed">dashed</option>
                        <option value="solid">solid</option>
                        <option value="epic">epic</option>
                    </Select>
                </label>
                <label>
                    Active <Checkbox checked={!!linkDefaults.active} onChange={(v) => setLinkDefaults((d) => ({ ...d, active: v }))} />
                </label>
                <label>
                    Speed
                    <Slider value={linkDefaults.speed ?? 0.9} min={0} max={4} step={0.05} onChange={(v) => setLinkDefaults((d) => ({ ...d, speed: v }))} />
                </label>
                <label>
                    Width (for lines)
                    <Slider value={linkDefaults.width ?? 2} min={1} max={6} step={0.1} onChange={(v) => setLinkDefaults((d) => ({ ...d, width: v }))} />
                </label>
                <label>
                    Color
                    <Input type="color" value={linkDefaults.color || "#7cf"} onChange={(e) => setLinkDefaults((d) => ({ ...d, color: e.target.value }))} />
                </label>

                {/* Curve */}
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed rgba(255,255,255,0.2)" }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Curve</div>
                    <label>
                        Mode
                        <Select
                            value={linkDefaults.curve?.mode || "up"}
                            onChange={(e) => setLinkDefaults((d) => ({ ...d, curve: { ...(d.curve || {}), mode: e.target.value } }))}
                        >
                            <option value="straight">straight</option>
                            <option value="up">up</option>
                            <option value="side">side</option>
                        </Select>
                    </label>
                    <label>
                        Bend
                        <Slider
                            value={linkDefaults.curve?.bend ?? 0.3}
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={(v) => setLinkDefaults((d) => ({ ...d, curve: { ...(d.curve || {}), bend: v } }))}
                        />
                    </label>
                </div>

                {(linkDefaults.style === "particles" || linkDefaults.style === "wavy") && (
                    <>
                        <label>
                            Particle Count
                            <Slider
                                value={linkDefaults.particles?.count ?? 12}
                                min={1}
                                max={80}
                                step={1}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, particles: { ...(d.particles || {}), count: v } }))}
                            />
                        </label>
                        <label>
                            Particle Size
                            <Slider
                                value={linkDefaults.particles?.size ?? 0.06}
                                min={0.02}
                                max={0.3}
                                step={0.01}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, particles: { ...(d.particles || {}), size: v } }))}
                            />
                        </label>
                        <label>
                            Opacity
                            <Slider
                                value={linkDefaults.particles?.opacity ?? 0.8}
                                min={0}
                                max={1}
                                step={0.01}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, particles: { ...(d.particles || {}), opacity: v } }))}
                            />
                        </label>
                    </>
                )}

                {linkDefaults.style === "icons" && (
                    <>
                        <label>
                            Icon
                            <Input
                                value={linkDefaults.icons?.icon ?? "⬤"}
                                onChange={(e) => setLinkDefaults((d) => ({ ...d, icons: { ...(d.icons || {}), icon: e.target.value } }))}
                                placeholder="e.g. ⬤, ✦, →"
                            />
                        </label>
                        <label>
                            Icon Size
                            <Slider
                                value={linkDefaults.icons?.size ?? 16}
                                min={8}
                                max={48}
                                step={1}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, icons: { ...(d.icons || {}), size: v } }))}
                            />
                        </label>
                        <label>
                            Spacing
                            <Slider
                                value={linkDefaults.icons?.spacing ?? 0.7}
                                min={0.2}
                                max={3}
                                step={0.05}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, icons: { ...(d.icons || {}), spacing: v } }))}
                            />
                        </label>
                    </>
                )}

                {linkDefaults.style === "dashed" && (
                    <>
                        <label>
                            Dash size
                            <Slider
                                value={linkDefaults.dashed?.dash ?? 0.2}
                                min={0.02}
                                max={1}
                                step={0.01}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, dashed: { ...(d.dashed || {}), dash: v } }))}
                            />
                        </label>
                        <label>
                            Gap
                            <Slider
                                value={linkDefaults.dashed?.gap ?? 0.2}
                                min={0.02}
                                max={1}
                                step={0.01}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, dashed: { ...(d.dashed || {}), gap: v } }))}
                            />
                        </label>
                    </>
                )}
            </div>
        </Panel>
    );


    function runAction(action) {
        if (!action || !Array.isArray(action.steps)) return;

        // Camera timeline cursor in seconds (camera moves still chain)
        let cameraCursor = 0;

        const scheduleWireStep = (step, startSec) => {
            const targetOn = (step.value || "on") === "on";

            const runWire = () => {
                setWireframe((cur) => {
                    const curBool = !!cur;
                    // no-op if already in desired state
                    if (curBool === targetOn) return cur;
                    return targetOn;
                });
            };

            if (startSec <= 0) runWire();
            else setTimeout(runWire, startSec * 1000);
        };



        const schedulePacketStep = (step, startSec) => {

            const runPkt = () => {

                const linkId = step.linkId || "__ALL_PACKET__";

                const isAll = linkId === "__ALL_PACKET__" || linkId === "__ALL__" || linkId === "*";

                try {

                    if (step.type === "packetSend") {

                        const overrides = {

                            count: Math.max(1, Math.round(Number(step.count ?? 1) || 1)),

                            interval: Math.max(0, Number(step.interval ?? 0.15) || 0),

                            loop: !!step.loop,

                            loopGap: Math.max(0, Number(step.burstInterval ?? 1.0) || 0),

                            burstsLimit: Math.max(0, Math.round(Number(step.burstsLimit ?? 0) || 0)),

                            clearExisting: !!step.clearExisting,

                        };

                        window.dispatchEvent(

                            new CustomEvent("EPIC3D_PACKET_CTRL", {

                                detail: {

                                    action: "start",

                                    ...(isAll ? { all: true } : { linkId }),

                                    overrides,

                                },

                            })

                        );

                        // Back-compat: legacy events (harmless if unused)

                        window.dispatchEvent(

                            new CustomEvent("EPIC3D_PACKET_SEND", {

                                detail: { linkId, ...overrides, burstInterval: overrides.loopGap },

                            })

                        );

                    } else if (step.type === "packetStop") {

                        const clear = step.stopLoopsOnly ? false : (step.clearInFlight ?? true) !== false;

                        window.dispatchEvent(

                            new CustomEvent("EPIC3D_PACKET_CTRL", {

                                detail: {

                                    action: "stop",

                                    ...(isAll ? { all: true } : { linkId }),

                                    clear,

                                },

                            })

                        );

                        // Back-compat: legacy events

                        window.dispatchEvent(

                            new CustomEvent("EPIC3D_PACKET_STOP", {

                                detail: {

                                    linkId,

                                    stopLoopsOnly: !!step.stopLoopsOnly,

                                    clearInFlight: (step.clearInFlight ?? true) !== false,

                                },

                            })

                        );

                    }

                } catch (err) {

                    if (process.env.NODE_ENV !== "production") console.warn("Packet action dispatch failed", err);

                }

            };

            if (startSec <= 0) runPkt();

            else setTimeout(runPkt, startSec * 1000);

        };

        const scheduleNodeStep = (step, startSec) => {
            if (!step.nodeId) {
                if (process.env.NODE_ENV !== "production") {
                    console.warn("Action step has no nodeId:", step);
                }
                return;
            }

            const runNode = () => {
                const n = nodes.find((x) => x.id === step.nodeId);
                if (!n) return;

                if (step.type === "toggleLight") {
                    toggleLightEnabled(n.id);
                } else if (step.type === "toggleGlow") {
                    setNode(n.id, {glowOn: !n.glowOn});
                } else if (step.type === "setSignalStyle") {
                    setNode(n.id, {
                        signal: {
                            ...(n.signal || {}),
                            style: step.value || "waves",
                        },
                    });
                } else if (step.type === "setTextBox") {            // 👈 NEW
                    const tb = n.textBox || {};
                    const targetOn = (step.value || "on") === "on";

                    // bump triggerId when turning on, so animation restarts
                    const nextTrigger = (tb.triggerId || 0) + 1;

                    setNode(n.id, {
                        textBox: {
                            ...tb,
                            enabled: targetOn,
                            triggerId: targetOn ? nextTrigger : (tb.triggerId || 0),
                        },
                    });

                } else if (step.type === "textBoxFade") {
                    const tb = n.textBox || {};
                    const rawMode = step.fadeMode || "in"; // "in" | "out" | "show" | "hide"
                    const duration =
                        step.duration === "" || step.duration == null
                            ? null
                            : Number(step.duration) || 0;

                    let commandType = null;
                    if (rawMode === "in" || rawMode === "fadeIn") commandType = "fadeIn";
                    else if (rawMode === "out" || rawMode === "fadeOut") commandType = "fadeOut";
                    else if (rawMode === "show") commandType = "show";
                    else if (rawMode === "hide") commandType = "hide";

                    if (!commandType) return;

                    setNode(n.id, {
                        textBox: {
                            ...tb,
                            enabled: true,
                            useTimers: false, // manual mode
                            commandType,
                            commandDuration: duration,
                            commandId: (tb.commandId || 0) + 1, // bump so NodeTextBox runs it
                        },
                    });
                } else if (step.type === "textBox") {
                    const n = nodes.find((x) => x.id === step.nodeId);
                    if (!n) return;

                    const tb = n.textBox || {};
                    const mode = step.mode || "toggle"; // "on" | "off" | "fade" | "toggle"

                    if (mode === "fade") {
                        // Trigger the fade sequence (manual fade)
                        setNode(n.id, {
                            textBox: {
                                ...tb,
                                // make sure the textbox exists
                                enabled: true,
                                // bump triggerId so NodeTextBox runs its fade animation
                                triggerId: (tb.triggerId || 0) + 1,
                            },
                        });
                    } else {
                        // Simple visibility control
                        let enabled;
                        if (mode === "on") {
                            enabled = true;
                        } else if (mode === "off") {
                            enabled = false;
                        } else {
                            // toggle
                            enabled = !tb.enabled;
                        }

                        setNode(n.id, {
                            textBox: {
                                ...tb,
                                enabled,
                            },
                        });
                    }
                }
            };

            if (startSec <= 0) runNode();
            else setTimeout(runNode, startSec * 1000);
        };


        const scheduleRoomStep = (step, startSec) => {
            if (!step.roomId) {
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('Action step has no roomId:', step);
                }
                return;
            }

            const runRoom = () => {
                const r = rooms.find((x) => x.id === step.roomId);
                if (!r) return;
                const mode = step.mode || step.value || 'toggle';
                const nextHidden = (mode === 'hide') ? true : (mode === 'show') ? false : !r.hidden;

                setRooms((prev) => prev.map((rm) => (rm.id === r.id ? { ...rm, hidden: nextHidden } : rm)));

                if (nextHidden) {
                    // clear selection if it becomes hidden
                    setSelected((sel) => {
                        if (!sel) return sel;
                        if (sel.type === 'room' && sel.id === r.id) return null;
                        if (sel.type === 'node') {
                            const n = nodes.find((x) => x.id === sel.id);
                            if (n && n.roomId === r.id) return null;
                        }
                        return sel;
                    });
                    setMultiSel((prev) =>
                        (prev || []).filter((it) => {
                            if (it.type === 'room') return it.id !== r.id;
                            if (it.type === 'node') {
                                const n = nodes.find((x) => x.id === it.id);
                                return !(n && n.roomId === r.id);
                            }
                            return true;
                        })
                    );
                }
            };

            if (startSec <= 0) runRoom();
            else setTimeout(runRoom, startSec * 1000);
        };


        const scheduleGroupStep = (step, startSec) => {
            if (!step.groupId) {
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('Action step has no groupId:', step);
                }
                return;
            }

            const runGroup = () => {
                const mode = step.mode || step.value || 'toggle';

                // Determine which group IDs will be hidden after this step (best-effort)
                let willHideIds = new Set();
                if (step.groupId === '__ALL__') {
                    for (const g of (groups || [])) {
                        const nextHidden = (mode === 'hide') ? true : (mode === 'show') ? false : !g.hidden;
                        if (nextHidden) willHideIds.add(g.id);
                    }
                } else {
                    const g = (groups || []).find((x) => x.id === step.groupId);
                    if (!g) return;
                    const nextHidden = (mode === 'hide') ? true : (mode === 'show') ? false : !g.hidden;
                    if (nextHidden) willHideIds.add(g.id);
                }

                setGroups((prev) => {
                    const list = prev || [];
                    if (step.groupId === '__ALL__') {
                        return list.map((g) => {
                            const nextHidden = (mode === 'hide') ? true : (mode === 'show') ? false : !g.hidden;
                            return { ...g, hidden: nextHidden };
                        });
                    }
                    const cur = list.find((x) => x.id === step.groupId);
                    if (!cur) return prev;
                    const nextHidden = (mode === 'hide') ? true : (mode === 'show') ? false : !cur.hidden;
                    return list.map((g) => (g.id === step.groupId ? { ...g, hidden: nextHidden } : g));
                });

                if (willHideIds.size > 0) {
                    // Clear selection if it becomes hidden
                    setSelected((sel) => {
                        if (!sel) return sel;
                        if (sel.type === 'room') {
                            const r = rooms.find((x) => x.id === sel.id);
                            if (r && r.groupId && willHideIds.has(r.groupId)) return null;
                        }
                        if (sel.type === 'node') {
                            const n = nodes.find((x) => x.id === sel.id);
                            if (n && n.groupId && willHideIds.has(n.groupId)) return null;
                        }
                        return sel;
                    });

                    setMultiSel((prev) =>
                        (prev || []).filter((it) => {
                            if (it.type === 'room') {
                                const r = rooms.find((x) => x.id === it.id);
                                return !(r && r.groupId && willHideIds.has(r.groupId));
                            }
                            if (it.type === 'node') {
                                const n = nodes.find((x) => x.id === it.id);
                                return !(n && n.groupId && willHideIds.has(n.groupId));
                            }
                            return true;
                        })
                    );
                }
            };

            if (startSec <= 0) runGroup();
            else setTimeout(runGroup, startSec * 1000);
        };

        (action.steps || []).forEach((s) => {
            if (!s) return;

            const delay = Math.max(0, Number(s.delay || 0));
            let parentStart = 0;
            // --- HUD fade step (buttons) ---
            if (s.type === "hudFade") {
                const targetId = s.hudTargetId || "";
                if (targetId) {
                    const mode = (s.hudMode || "out") === "in" ? "in" : "out";
                    const duration = Math.max(0.01, Number(s.hudDuration || 0.35));
                    try {
                        window.dispatchEvent(
                            new CustomEvent("EPIC3D_HUD_FADE", {
                                detail: { targetIds: [targetId], mode, duration },
                            })
                        );
                    } catch (err) {
                        if (process.env.NODE_ENV !== "production") {
                            console.warn("Failed to dispatch HUD fade event", err);
                        }
                    }
                }
                return;
            }

            // ---------- Camera track step (top-level, chained) ----------
            if (s.type === "cameraMove") {
                const duration = Math.max(0.001, Number(s.duration || 0));
                const fromPresetId = s.fromPresetId || null;
                const toPresetId = s.toPresetId || null;
                if (!toPresetId) return; // need a destination view

                parentStart = cameraCursor + delay;

                // Schedule on the camera queue; SceneInner will read + animate
                scheduleCameraMove({
                    fromPresetId,
                    toPresetId,
                    startDelay: parentStart,
                    duration,
                });

                // Next camera move starts after this one
                cameraCursor = parentStart + duration;
            }
            // ---------- Global wireframe step (absolute timing) ----------
            else if (s.type === "setWireframe") {
                parentStart = delay;
                scheduleWireStep(s, parentStart);
            }
            // ---------- Packet steps (absolute timing) ----------
            else if (s.type === "packetSend" || s.type === "packetStop") {
                parentStart = delay;
                schedulePacketStep(s, parentStart);
            }
            // ---------- Room visibility steps (absolute timing) ----------
            else if (s.type === 'setRoomVisible') {
                parentStart = delay;
                scheduleRoomStep(s, parentStart);
            }
            // ---------- Group visibility steps (absolute timing) ----------
            else if (s.type === 'setGroupVisible') {
                parentStart = delay;
                scheduleGroupStep(s, parentStart);
            }
            // ---------- Node-targeted steps (absolute timing) ----------
            else {
                parentStart = delay;
                scheduleNodeStep(s, parentStart);
            }
            // ---------- Child steps: run relative to parentStart ----------
            if (Array.isArray(s.children) && s.children.length > 0) {
                s.children.forEach((c) => {
                    if (!c) return;
                    const childDelay = Math.max(0, Number(c.delay || 0));
                    const childStart = parentStart + childDelay;

                    if (c.type === "cameraMove") {
                        // For now, ignore camera moves as children (UI disallows this).
                        return;
                    } else if (c.type === "setWireframe") {
                        scheduleWireStep(c, childStart);
                    } else if (c.type === "packetSend" || c.type === "packetStop") {
                        schedulePacketStep(c, childStart);
                    } else if (c.type === 'setRoomVisible') {
                        scheduleRoomStep(c, childStart);
                    } else if (c.type === 'setGroupVisible') {
                        scheduleGroupStep(c, childStart);
                    } else {
                        scheduleNodeStep(c, childStart);
                    }
                });
            }
        });
    }






    // Actions panel: stable component wrapper to prevent unmount/remount while editing
    const actionsPanelCtxRef = useRef(null);
    actionsPanelCtxRef.current = {
        actions,
        setActions,
        rooms,
        nodes,
        links,
        groups,
        cameraPresets,
        runAction,
        keepLeftScroll,
    };

    const ActionsPanel = useMemo(() => {
        return function ActionsPanelWrapper() {
            return <ActionsPanelInner ctx={actionsPanelCtxRef.current} />;
        };
    }, []);



    // Decks panel: stable component wrapper to prevent unmount/remount while editing
    const decksPanelCtxRef = useRef(null);
    decksPanelCtxRef.current = {
        decks,
        rooms,
        nodes,
        links,
        addDeck,
        setDeck,
        deleteDeck,
        setSelected,
        deckAddModeId,
        setDeckAddModeId,
        deckAddLast,
        setDeckAddLast,
        addRoomToDeck,
        addNodeToDeck,
        removeRoomFromDeck,
        removeNodeFromDeck,
        keepLeftScroll,
    };

    const DecksPanel = useMemo(() => {
        return function DecksPanelWrapper() {
            return <DecksPanelInner ctx={decksPanelCtxRef.current} />;
        };
    }, []);



// NOTE: TopBar is hoisted to module scope to prevent unmount/remount during slider drags.
    // Pass everything it needs via a single ctx object.
    const topBarCtx = {
        // Header / counts / logo
        projectName,
        setProjectName,
        rooms,
        nodes,
        links,
        logoHot,
        setLogoHot,
        logoFlash,
        goToSelectedViewFromLogo,

        // Project / file
        prodMode,
        setProdMode,
        fileRef,
        importPackage,
        onModelFiles,
        exportZip,
        openMergeDialog,
        modelBlob,

        // Undo / redo
        undo,
        redo,
        canUndo,
        canRedo,

        // Views
        cameraSnapshotRef,
        cameraPresets,
        setCameraPresets,
        cameraPresetId,
        setCameraPresetId,

        // Model / products
        currentModelId,
        setCurrentModelId,
        modelVisible,
        setModelVisible,
        setProductsOpen,
        modelScale,
        setModelScale,
        productScale,
        setProductScale,
        productUnits,
        setProductUnits,

        // Quick scene config
        wireOpacity,
        setWireOpacity,
        wireDetail,
        setWireDetail,
        roomOpacity,
        setRoomOpacity,
        bg,
        setBg,

        // Scene toggles
        wireframe,
        setWireframe,
        showLights,
        setShowLights,
        showLightBounds,
        setShowLightBounds,
        showGround,
        setShowGround,
        animate,
        setAnimate,
        labelsOn,
        setLabelsOn,

        // Reveal FX
        wireStroke,
        setWireStroke,
        revealOpen,
        setRevealOpen,
        roomOperatorMode,
        toggleRoomOperatorMode,

        // Transform / selection
        moveMode,
        setMoveMode,
        selectionMode,
        setSelectionMode,
        transformMode,
        setTransformMode,
        selected,
        setSelected,
        multiSel,
        setMultiSel,
        setSelectedBreakpoint,
        setLinkFromId,
        setMode,

        // Snapping
        snapRoomsEnabled,
        setSnapRoomsEnabled,
        snapRoomsDistance,
        setSnapRoomsDistance,

        // Globals
        showDimsGlobal,
        setShowDimsGlobal,
        photoDefault,
        setPhotoDefault,
        alwaysShow3DInfo,
        setAlwaysShow3DInfo,

        // Pictures
        picturesOpen,
        setPicturesOpen,
        importedPictures,
        setImportedPictures,
        picturesTab,
        setPicturesTab,
        picturesSearch,
        setPicturesSearch,
        localPicturesSearch,
        setLocalPicturesSearch,
        localPictures,
        addLocalPicture,
        picturesInputRef,
        importPicturesFromFiles,
        setPictureVisible,
        setPictureSolid,
        setPictureScale,
        setPictureOpacity,
        setPicturePosition,
        setPictureRotation,
        deletePicture,
        pictureValuesClipboardRef,
        setPictureClipboardTick,
    };

    const onMoveModel = useCallback(() => {
        // Cancel placement/linking and open gizmo for the imported model
        setPlacement((p) => ({ ...(p || {}), armed: false }));
        setSelectedBreakpoint(null);
        setMultiSel([]);
        setLinkFromId(null);
        setMode("select");
        setModelVisible(true);
        setMoveMode(true);
        setTransformMode("translate");
        setSelected((prev) => (prev?.type === "model" ? null : ({ type: "model" })));
    }, [setPlacement, setSelectedBreakpoint, setMultiSel, setLinkFromId, setMode, setModelVisible, setMoveMode, setTransformMode, setSelected]);

    const onResetModelPosition = useCallback(() => {
        setModelPosition([0, 0, 0]);
    }, [setModelPosition]);




    return (
        <div style={{ position: "fixed", inset: 0, background: "radial-gradient(1200px 800px at 20% 0%, #15203a, #0b1020)", color: "#fff" }}>
            <ProductManager open={productsOpen} onClose={() => setProductsOpen(false)} />

            {!prodMode && (
                <TopBar
                    ctx={topBarCtx}
                    shadowsOn={shadowsOn}
                    setShadowsOn={setShadowsOn}
                    uiStart={uiStart}
                    uiStop={uiStop}
                />
            )}



            <EditorLeftPane
                prodMode={prodMode}
                leftColRef={leftColRef}
                uiStart={uiStart}
                uiStop={uiStop}
                stopAnchorDefault={stopAnchorDefault}
                selected={selected}
                onMoveModel={onMoveModel}
                onResetModelPosition={onResetModelPosition}
                modelPosition={modelPosition}
                roomsNodesSubtitle={roomsNodesSubtitle}
                linksSubtitle={linksSubtitle}
                placement={placement}
                setPlacement={setPlacement}
                LegendTree={LegendTree}
                GroupsPanel={GroupsPanel}
                GroupsMembersPanel={GroupsMembersPanel}
                DecksPanel={DecksPanel}
                LinksPanel={LinksPanel}
                FlowDefaultsPanel={FlowDefaultsPanel}
                ActionsPanel={ActionsPanel}
                actionsHud={actionsHud}
                setActionsHud={setActionsHud}
                roomGap={roomGap}
                setRoomGap={setRoomGap}
                modelBounds={modelBounds}
                roomOpacity={roomOpacity}
                setRoomOpacity={setRoomOpacity}
                perf={perf}
                setPerf={setPerf}
                bg={bg}
                setBg={setBg}
                wireframe={wireframe}
                setWireframe={setWireframe}
                showLights={showLights}
                setShowLights={setShowLights}
                showLightBounds={showLightBounds}
                setShowLightBounds={setShowLightBounds}
                showGround={showGround}
                setShowGround={setShowGround}
                animate={animate}
                setAnimate={setAnimate}
                labelsOn={labelsOn}
                setLabelsOn={setLabelsOn}
                hudButtonsVisible={hudButtonsVisible}
                setHudButtonsVisible={setHudButtonsVisible}

                gridConfig={gridConfig}
                setGridConfig={setGridConfig}
            />



            {/* RIGHT column – Inspector */}
            <EditorRightPane
                prodMode={prodMode}
                uiStart={uiStart}
                uiStop={uiStop}
                stopAnchorDefault={stopAnchorDefault}
                selectedNode={selectedNode}
                selectedRoom={selectedRoom}
                selectedLink={selectedLink}
                rooms={rooms}
                decks={decks}
                nodes={nodes}
                links={links}
                setNode={setNode}
                setNodeById={setNodeById}
                setLightEnabled={setLightEnabled}
                setRoom={setRoom}
                duplicateRoom={duplicateRoom}
                requestDelete={requestDelete}
                mode={mode}
                setMode={setMode}
                roomOpacity={roomOpacity}
                setRoomOpacity={setRoomOpacity}
                setLinks={setLinks}
                selectedBreakpoint={selectedBreakpoint}
                setSelectedBreakpoint={setSelectedBreakpoint}
                setLinkFromId={setLinkFromId}   // 🔹 NEW
                levelFromNodeId={levelFromNodeId}
                setLevelFromNodeId={setLevelFromNodeId}
                levelAxis={levelAxis}
                setLevelAxis={setLevelAxis}

                actions={actions}
                ActionsPanel={ActionsPanel}
            />

            {selectedNode && <RackHUD node={selectedNode} setNodeById={setNodeById} />}
            {selectedNode && <ProductHUD node={selectedNode} />}

            {/* On-screen Actions (Grid Layout layer) */}
            {hudButtonsVisible && (
                <HudButtonsLayer
                    actions={actions}
                    setActions={setActions}
                    runAction={runAction}
                    key={hudVersion}
                    uiHidden={prodMode}
                    actionsHud={actionsHud}
                    setActionsHud={setActionsHud}
                />
            )}




            {/* DRAG overlay */}
            {dragOver && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 15,
                        display: "grid",
                        placeItems: "center",
                        background: "rgba(10,15,25,0.55)",
                        border: "3px dashed rgba(80,227,194,0.6)",
                        color: "#fff",
                        fontWeight: 900,
                        letterSpacing: 0.5,
                    }}
                >
                    Drop to import (.glb/.gltf/.zip)
                </div>
            )}

            {/* 3D canvas fills behind */}
            <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
                <Canvas

                    shadows={shadowsOn && perf !== "low"}
                    camera={canvasCamera}
                    dpr={perf === "low" ? 1 : perf === "med" ? [1, 1.6] : [1.25, 2]}
                    gl={{ powerPreference: "high-performance", antialias: perf !== "low", stencil: false, depth: true, alpha: false }}
                    onCreated={({ gl }) => {
                        gl.setClearColor(bg);
                        gl.outputColorSpace = THREE.SRGBColorSpace;
                        gl.toneMapping = THREE.ACESFilmicToneMapping;
                        gl.physicallyCorrectLights = true;
                        gl.shadowMap.type = THREE.PCFSoftShadowMap;
                        gl.oncontextmenu = (e) => e.preventDefault();
                    }}
                    onPointerMissed={(e) => {
                        const justDragged =
                            performance.now() - (missGuardRef.current || 0) < missGuardMS;
                        if (uiInteracting) return;

                        if (dragActive || justDragged) return;

                        const isLeft = e.button === 0 || e.button === undefined;
                        if (!isLeft) return;

                        // Box mode → start marquee drag on empty space
                        // Box mode → start marquee drag on empty space (only when Move mode is OFF)
                        if (selectionMode === "box") {
                            const now = performance.now();
                            if (marqueeGuardRef.current.active) return;
                            if (now - (marqueeGuardRef.current.endMs || 0) < 250) return;
                            if (!moveMode) startMarquee(e);
                            return; // don't clear selection while Box mode is active
                        }


                        // Other modes → clear selection
                        setSelected(null);
                        setMultiSel([]);
                        setMode("select");
                        setLinkFromId(null);
                        setSelectedBreakpoint(null);
                        setLevelFromNodeId(null);
                    }}



                    frameloop={animate ? "always" : "demand"}>
                    <color attach="background" args={[bg]} />

                    <ShadowController enabled={shadowsOn && perf !== "low"} />



                    {/* Adaptive performance */}
                    <PerformanceMonitor
                        onDecline={() => setPerf("low")}
                        onIncline={() => setPerf(p => (p === "low" ? "med" : "high"))}
                    />
                    <AdaptiveDpr pixelated />

                    <StableStartupCamera pose={activePose} applyKey={activePresetKey} />
                    <CameraPoseBridge startupPose={null} snapshotRef={cameraSnapshotRef} />

                    <FloorplanPictures
                        pictures={importedPictures}
                        pictureRefs={pictureRefs}
                        onAspect={setPictureAspect}
                    />

                    <SceneInner
                        pictureRefs={pictureRefs}
                        modelDescriptor={modelDescriptor}
                        perf={perf}
                        uiHidden={prodMode}
                        wireframe={wireframe}
                        wireOpacity={wireOpacity}
                        wireDetail={wireDetail}
                        wireHideSurfaces={wireHideSurfaces}
                        showModel={modelVisible}
                        wireStroke={wireStroke}
                        modelScale={modelScale}
                        modelPosition={modelPosition}
                        labelsOn={labelsOn}
                        labelMode={labelMode}
                        labelSize={labelSize}
                        rooms={renderRooms}
                        nodes={renderNodes}
                        hiddenDeckIds={[...hiddenDeckIds]}
                        hiddenRoomIds={[...hiddenRoomIds]}
                        links={renderLinks}
                        selected={selected}
                        setSelected={setSelected}
                        selectedMulti={multiSel}
                        selectedBreakpoint={selectedBreakpoint}
                        onEntityTransform={onEntityTransform}
                        onEntityRotate={onEntityRotate}
                        transformMode={transformMode}
                        onRoomDragPack={onRoomDragPack}
                        onRoomDragApply={onRoomDragApply}
                        onRoomScalePack={onRoomScalePack}
                        onRoomScaleApply={onRoomScaleApply}
                        placement={placement}
                        onPlace={onPlace}
                        multiPivotOverride={multiPivotOverride}
                        showLights={showLights}
                        showLightBounds={showLightBounds}
                        showGround={showGround}
                        gridConfig={gridConfig}
                        roomOpacity={roomOpacity}
                        modelRef={modelRef}
                        animate={animate}
                        dragState={dragState}
                        signalMap={signalMap}
                        bg={bg}
                        missGuardRef={missGuardRef}
                        onNodePointerDown={handleNodeDown}
                        onSwitchPress={handleSwitchPress}
                        onRoomPointerDown={handleRoomDown}
                        moveMode={moveMode}
                        roomGap={roomGap}
                        shadowsOn={shadowsOn}
                        roomOperatorMode={roomOperatorMode}
                        onRoomAnchorClick={handleRoomAnchorClick}
                        onRoomDelete={handleRoomDelete}
                        onRoomResize={handleRoomResize}
                        onModelScene={(scene) => {
                            const box = new THREE.Box3().setFromObject(scene);
                            const c = box.getCenter(new THREE.Vector3());
                            setModelBounds({ min: box.min.toArray(), max: box.max.toArray(), center: c.toArray() });
                            if (!roomGap.center || roomGap.center.join(",") === "0,0.8,0") {
                                setRoomGap((g) => ({ ...g, center: c.toArray() }));
                            }
                        }}
                    />
                    {/* One-shot shader/material warmup once the model is defined */}
                    {/*<WarmupOnce enabled={!!modelDescriptor} />*/}
                    <WarmupOnce enabled={!!modelBounds} />
                    {perf === "high" && <StatsGl showPanel={0} className="stats" />}
                    <Preload all />

                    {/* Render node signal effects */}
                    {visibleSignalNodes.map((n) => (
                        signalMap[n.id] && (
                            <NodeSignals
                                key={`sig-${n.id}`}
                                node={n}
                                linksTo={signalMap[n.id]}
                                style={n.signal?.style || "waves"}
                                color={n.signal?.color || n.color}
                                speed={n.signal?.speed || 1}
                                size={n.signal?.size || 1}
                            />
                        )
                    ))}
                </Canvas>
            </div>

            {/* Merge modal */}
            {mergeOpen && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.62)",
                        display: "grid",
                        placeItems: "center",
                        zIndex: 1100,
                    }}
                    onMouseDown={() => {
                        // click outside closes
                        setMergeOpen(false);
                    }}
                >
                    <div
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                            width: 860,
                            maxWidth: "94vw",
                            background: "#0f1524",
                            border: "1px solid rgba(255,255,255,0.14)",
                            borderRadius: 16,
                            boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
                            color: "#fff",
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                padding: 16,
                                borderBottom: "1px solid rgba(255,255,255,0.12)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                            }}
                        >
                            <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>Merge Backup</div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <Btn
                                    onClick={() => mergeFileRef.current?.click()}
                                    title="Select a backup .zip or .json"
                                    variant={mergeIncoming ? "ghost" : "primary"}
                                >
                                    {mergeIncoming ? "Change file" : "Select file"}
                                </Btn>
                                <Btn onClick={() => setMergeOpen(false)}>Close</Btn>
                            </div>
                        </div>

                        <input
                            ref={mergeFileRef}
                            type="file"
                            accept=".zip,.json"
                            style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
                            onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                try {
                                    await loadMergeFile(f);
                                } catch (err) {
                                    console.error("Merge file load failed", err);
                                    alert("Could not read merge file: " + (err?.message || String(err)));
                                }
                                e.target.value = "";
                            }}
                        />

                        <div style={{ padding: 16, display: "grid", gap: 14 }}>
                            {!mergeIncoming && (
                                <div
                                    style={{
                                        padding: 14,
                                        border: "1px dashed rgba(148,163,184,0.55)",
                                        borderRadius: 14,
                                        background: "rgba(2,6,23,0.35)",
                                        color: "rgba(226,238,255,0.9)",
                                    }}
                                >
                                    Select a backup export first. We’ll preview what would be added/changed and then you can merge.
                                </div>
                            )}

                            {mergePlan && (
                                <div
                                    style={{
                                        padding: 14,
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        borderRadius: 14,
                                        background: "rgba(2,6,23,0.35)",
                                        display: "grid",
                                        gap: 10,
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                        <div style={{ opacity: 0.92 }}>
                                            <div style={{ fontSize: 12, opacity: 0.75 }}>File</div>
                                            <div style={{ fontWeight: 700 }}>{mergePlan.meta.fileName}</div>
                                        </div>
                                        <div style={{ opacity: 0.92 }}>
                                            <div style={{ fontSize: 12, opacity: 0.75 }}>Project</div>
                                            <div style={{ fontWeight: 700 }}>{mergePlan.meta.projectName || "(unnamed)"}</div>
                                        </div>
                                        <div style={{ opacity: 0.92 }}>
                                            <div style={{ fontSize: 12, opacity: 0.75 }}>Format</div>
                                            <div style={{ fontWeight: 700 }}>{mergePlan.meta.version ? `v${mergePlan.meta.version}` : "(legacy)"}</div>
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        <MergeToggle
                                            label={mergeFlags.addNew ? "Add additions ✓" : "Add additions"}
                                            on={mergeFlags.addNew}
                                            onClick={() => setMergeFlags((f) => ({ ...f, addNew: !f.addNew }))}
                                            title="Add items that don’t exist in the current canvas"
                                            style={{ minWidth: 124 }}
                                        />
                                        <MergeToggle
                                            label={mergeFlags.overwrite ? "Overwrite changes ✓" : "Overwrite changes"}
                                            on={mergeFlags.overwrite}
                                            onClick={() => setMergeFlags((f) => ({ ...f, overwrite: !f.overwrite }))}
                                            title="Overwrite existing items that differ"
                                            style={{ minWidth: 148 }}
                                        />
                                        <span style={{ fontSize: 12, opacity: 0.75, alignSelf: "center" }}>
                                            Identical values are always skipped.
                                        </span>
                                    </div>
                                </div>
                            )}

                            <div style={{ display: "grid", gap: 10 }}>
                                <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                    What to merge
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    <MergeToggle label="Graph" on={mergeOptions.graph} onClick={() => setMergeOptions((o) => ({ ...o, graph: !o.graph }))} title="Rooms / Nodes / Links" style={{ minWidth: 70 }} />
                                    <MergeToggle label="Decks" on={mergeOptions.decks} onClick={() => setMergeOptions((o) => ({ ...o, decks: !o.decks }))} title="Deck definitions" style={{ minWidth: 70 }} />
                                    <MergeToggle label="Groups" on={mergeOptions.groups} onClick={() => setMergeOptions((o) => ({ ...o, groups: !o.groups }))} title="Groups" style={{ minWidth: 74 }} />
                                    <MergeToggle label="Actions" on={mergeOptions.actions} onClick={() => setMergeOptions((o) => ({ ...o, actions: !o.actions }))} title="Actions" style={{ minWidth: 74 }} />
                                    <MergeToggle label="Pictures" on={mergeOptions.pictures} onClick={() => setMergeOptions((o) => ({ ...o, pictures: !o.pictures }))} title="Reference pictures" style={{ minWidth: 82 }} />
                                    <MergeToggle label="Settings" on={mergeOptions.settings} onClick={() => setMergeOptions((o) => ({ ...o, settings: !o.settings }))} title="View, editor, camera, link defaults" style={{ minWidth: 82 }} />
                                    <MergeToggle label="HUD" on={mergeOptions.hud} onClick={() => setMergeOptions((o) => ({ ...o, hud: !o.hud }))} title="Bottom HUD layout/styles" style={{ minWidth: 64 }} />
                                    <MergeToggle label="Prefs" on={mergeOptions.prefs} onClick={() => setMergeOptions((o) => ({ ...o, prefs: !o.prefs }))} title="epic3d.* localStorage prefs" style={{ minWidth: 64 }} />
                                    <MergeToggle label="Products" on={mergeOptions.products} onClick={() => setMergeOptions((o) => ({ ...o, products: !o.products }))} title="Product DB" style={{ minWidth: 82 }} />
                                    <MergeToggle label="Model" on={mergeOptions.model} onClick={() => setMergeOptions((o) => ({ ...o, model: !o.model }))} title="Bundled model / static model id" style={{ minWidth: 70 }} />
                                </div>
                            </div>

                            {mergePlan && (
                                <div
                                    style={{
                                        padding: 14,
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        borderRadius: 14,
                                        background: "rgba(2,6,23,0.35)",
                                        display: "grid",
                                        gap: 10,
                                    }}
                                >
                                    <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                        Preview
                                    </div>

                                    {mergePlan.graph && (
                                        <div style={{ display: "grid", gap: 6 }}>
                                            <div style={{ fontWeight: 800, opacity: 0.92 }}>Graph</div>
                                            {(["rooms", "nodes", "links"]).map((k) => {
                                                const d = mergePlan.graph[k];
                                                const willAdd = mergeFlags.addNew ? d.added : 0;
                                                const willOverwrite = mergeFlags.overwrite ? d.changed : 0;
                                                return (
                                                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                                        <span style={{ opacity: 0.9, textTransform: "capitalize" }}>{k}</span>
                                                        <span style={{ opacity: 0.85 }}>
                                                            incoming {d.totalIncoming} · same {d.same} · changed {d.changed} · new {d.added}
                                                            <span style={{ opacity: 0.75 }}> — will add {willAdd}, overwrite {willOverwrite}</span>
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {mergePlan.decks && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                            <span style={{ opacity: 0.9 }}>Decks</span>
                                            <span style={{ opacity: 0.85 }}>
                                                incoming {mergePlan.decks.totalIncoming} · same {mergePlan.decks.same} · changed {mergePlan.decks.changed} · new {mergePlan.decks.added}
                                                <span style={{ opacity: 0.75 }}> — will add {mergeFlags.addNew ? mergePlan.decks.added : 0}, overwrite {mergeFlags.overwrite ? mergePlan.decks.changed : 0}</span>
                                            </span>
                                        </div>
                                    )}

                                    {mergePlan.groups && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                            <span style={{ opacity: 0.9 }}>Groups</span>
                                            <span style={{ opacity: 0.85 }}>
                                                incoming {mergePlan.groups.totalIncoming} · same {mergePlan.groups.same} · changed {mergePlan.groups.changed} · new {mergePlan.groups.added}
                                                <span style={{ opacity: 0.75 }}> — will add {mergeFlags.addNew ? mergePlan.groups.added : 0}, overwrite {mergeFlags.overwrite ? mergePlan.groups.changed : 0}</span>
                                            </span>
                                        </div>
                                    )}

                                    {mergePlan.actions && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                            <span style={{ opacity: 0.9 }}>Actions</span>
                                            <span style={{ opacity: 0.85 }}>
                                                incoming {mergePlan.actions.totalIncoming} · same {mergePlan.actions.same} · changed {mergePlan.actions.changed} · new {mergePlan.actions.added}
                                                <span style={{ opacity: 0.75 }}> — will add {mergeFlags.addNew ? mergePlan.actions.added : 0}, overwrite {mergeFlags.overwrite ? mergePlan.actions.changed : 0}</span>
                                            </span>
                                        </div>
                                    )}

                                    {mergePlan.pictures && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                            <span style={{ opacity: 0.9 }}>Pictures</span>
                                            <span style={{ opacity: 0.85 }}>
                                                incoming {mergePlan.pictures.totalIncoming} · same {mergePlan.pictures.same} · changed {mergePlan.pictures.changed} · new {mergePlan.pictures.added}
                                                <span style={{ opacity: 0.75 }}> — will add {mergeFlags.addNew ? mergePlan.pictures.added : 0}, overwrite {mergeFlags.overwrite ? mergePlan.pictures.changed : 0}</span>
                                            </span>
                                        </div>
                                    )}

                                    {mergePlan.settings && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                            <span style={{ opacity: 0.9 }}>Settings</span>
                                            <span style={{ opacity: 0.85 }}>
                                                sections changed: {mergePlan.settings.changedCount}
                                                {mergePlan.settings.changedCount ? (
                                                    <span style={{ opacity: 0.7 }}> ({mergePlan.settings.changedSections.join(", ")})</span>
                                                ) : null}
                                                <span style={{ opacity: 0.75 }}> — will apply {mergeFlags.overwrite ? mergePlan.settings.changedCount : 0}</span>
                                            </span>
                                        </div>
                                    )}

                                    {mergePlan.hud && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                            <span style={{ opacity: 0.9 }}>HUD</span>
                                            <span style={{ opacity: 0.85 }}>
                                                {mergePlan.hud.hasIncoming ? `changed blocks: ${mergePlan.hud.changedBlocks}/4` : "(no HUD data in file)"}
                                                <span style={{ opacity: 0.75 }}> — will apply {mergeFlags.overwrite ? mergePlan.hud.changedBlocks : 0}</span>
                                            </span>
                                        </div>
                                    )}

                                    {mergePlan.prefs && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                            <span style={{ opacity: 0.9 }}>Prefs</span>
                                            <span style={{ opacity: 0.85 }}>
                                                incoming keys {mergePlan.prefs.totalIncoming} · same {mergePlan.prefs.same} · changed {mergePlan.prefs.changed} · new {mergePlan.prefs.added}
                                                <span style={{ opacity: 0.75 }}> — will add {mergeFlags.addNew ? mergePlan.prefs.added : 0}, overwrite {mergeFlags.overwrite ? mergePlan.prefs.changed : 0}</span>
                                            </span>
                                        </div>
                                    )}

                                    {mergePlan.products && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                            <span style={{ opacity: 0.9 }}>Products</span>
                                            <span style={{ opacity: 0.85 }}>
                                                incoming {mergePlan.products.totalIncoming} · same {mergePlan.products.same} · changed {mergePlan.products.changed} · new {mergePlan.products.added}
                                                <span style={{ opacity: 0.75 }}> — will add {mergeFlags.addNew ? mergePlan.products.added : 0}, overwrite {mergeFlags.overwrite ? mergePlan.products.changed : 0}</span>
                                            </span>
                                        </div>
                                    )}

                                    {mergePlan.model && (
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                            <span style={{ opacity: 0.9 }}>Model</span>
                                            <span style={{ opacity: 0.85 }}>
                                                {mergePlan.model.hasBundledModel
                                                    ? "Bundled model in file"
                                                    : (mergePlan.model.incomingStaticId ? `Static model: ${mergePlan.model.incomingStaticId}` : "(no model info)")}
                                                <span style={{ opacity: 0.75 }}> — will apply {(mergeFlags.overwrite || (mergeFlags.addNew && !modelBlob && !modelDescriptor)) ? "maybe" : "no"}</span>
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div
                            style={{
                                padding: 16,
                                borderTop: "1px solid rgba(255,255,255,0.12)",
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: 8,
                            }}
                        >
                            <Btn onClick={() => setMergeOpen(false)}>Cancel</Btn>
                            <Btn
                                variant="primary"
                                glow
                                disabled={!mergeIncoming}
                                onClick={async () => {
                                    try {
                                        await applyMerge();
                                    } catch (err) {
                                        console.error("Merge failed", err);
                                        alert("Merge failed: " + (err?.message || String(err)));
                                    }
                                }}
                                title={!mergeIncoming ? "Select a file first" : "Merge the selected backup"}
                            >
                                Merge
                            </Btn>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm delete modal */}
            {confirm.open && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 1000 }}>
                    <div
                        style={{
                            width: 780,
                            maxWidth: "94vw",
                            background: "#0f1524",
                            border: "1px solid rgba(255,255,255,0.14)",
                            borderRadius: 16,
                            boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
                            color: "#fff",
                        }}
                    >
                        <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.12)", fontWeight: 900 }}>Confirm Delete</div>
                        <div style={{ padding: 16 }}>{confirm.text}</div>
                        <div style={{ padding: 16, display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                            <Btn onClick={() => setConfirm({ open: false, payload: null, text: "" })}>Cancel</Btn>
                            <Btn variant="primary" glow onClick={applyConfirmDelete}>
                                Delete
                            </Btn>
                        </div>
                    </div>

                </div>
            )}
            {marquee && (
                <div
                    style={{
                        position: "fixed",
                        left: marquee.x,
                        top: marquee.y,
                        width: marquee.w,
                        height: marquee.h,
                        border: "1px solid rgba(96,165,250,0.95)",
                        background: "rgba(37,99,235,0.16)",
                        boxShadow: "0 0 0 1px rgba(15,23,42,0.55)",
                        pointerEvents: "none",
                        zIndex: 18,
                    }}
                />
            )}
        </div>
    );
}

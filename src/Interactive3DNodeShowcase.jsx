import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { v4 as uuid } from "uuid";

import { Html, Text, StatsGl, PerformanceMonitor, AdaptiveDpr, Preload, useTexture } from "@react-three/drei";

import SceneInner from "./SceneInner.jsx";

import logoImg from "./data/logo/logo.png";
import { STATIC_MODELS } from "./data/models/registry";

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

function FloorplanPicturePlane({ src, scale = 1, rotX = 0, rotY = 0, rotZ = 0, y = 0.01 }) {
    const tex = useTexture(src);

    useEffect(() => {
        if (!tex) return;
        try {
            tex.colorSpace = THREE.SRGBColorSpace;
        } catch {}
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
    }, [tex]);

    const aspect = useMemo(() => {
        const img = tex?.image;
        if (!img) return 1;
        const w = img.width || img.naturalWidth || 1;
        const h = img.height || img.naturalHeight || 1;
        if (!w || !h) return 1;
        return h / w;
    }, [tex]);

    const s = clamp(Number(scale) || 1, 0.05, 50);
    const w = FLOORPLAN_BASE_SIZE * s;
    const h = w * aspect;

    // Rotation is user-facing degrees. Base orientation lays the image flat on XZ.
    // Tip: rotY rotates on the ground (most common). rotX/rotZ will tilt the plane.
    const rx = THREE.MathUtils.degToRad(Number(rotX) || 0);
    const ry = THREE.MathUtils.degToRad(Number(rotY) || 0);
    const rz = THREE.MathUtils.degToRad(Number(rotZ) || 0);

    return (
        <mesh
            rotation={[-Math.PI / 2 + rx, ry, rz]}
            position={[0, y, 0]}
            raycast={() => null} // do NOT block scene interactions
        >
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial
                map={tex}
                side={THREE.DoubleSide}
                transparent
                opacity={1}
                toneMapped={false}
            />
        </mesh>
    );
}

function FloorplanPictures({ pictures }) {
    const visible = useMemo(
        () =>
            (Array.isArray(pictures) ? pictures : [])
                .filter((p) => p && p.src && p.visible)
                .map((p, i) => ({ ...p, _i: i })),
        [pictures],
    );

    if (!visible.length) return null;

    return (
        <group>
            {visible.map((p, i) => (
                <FloorplanPicturePlane
                    key={p.id || `${p.name || "pic"}-${i}`}
                    src={p.src}
                    scale={p.scale ?? 1}
                    rotX={p.rotX ?? 0}
                    rotY={p.rotY ?? 0}
                    rotZ={p.rotZ ?? 0}
                    // tiny stacking so multiple pictures don't z-fight
                    y={0.01 + i * 0.002}
                />
            ))}
        </group>
    );
}

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
    useEffect(() => {
        try {
            localStorage.setItem(PICTURES_KEY, JSON.stringify(importedPictures || []));
        } catch {}
    }, [importedPictures]);

    // One-time normalization for older saved payloads
    useEffect(() => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            return list.map((p) => ({
                ...p,
                visible: !!p.visible,
                scale: Number(p.scale) || 1,
                rotX: Number(p.rotX) || 0,
                rotY: Number(p.rotY) || 0,
                rotZ: Number(p.rotZ) || 0,
            }));
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const picturesInputRef = useRef(null);
    const [picturesOpen, setPicturesOpen] = useState(false);

    const readFileAsDataURL = useCallback((file) => {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result || ""));
            fr.onerror = () => reject(fr.error || new Error("Failed to read file"));
            fr.readAsDataURL(file);
        });
    }, []);


    const importPicturesFromFiles = useCallback(async (files) => {
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
                visible: !!p.visible,
                scale: Number(p.scale) || 1,
                rotX: Number(p.rotX) || 0,
                rotY: Number(p.rotY) || 0,
                rotZ: Number(p.rotZ) || 0,
            }));

            urls.forEach((src, i) => {
                if (!src) return;
                next.push({
                    id: uuid(),
                    name: arr[i]?.name || `Picture ${next.length + 1}`,
                    src,
                    visible: true,  // default ON
                    scale: 1,
                    rotX: 0,
                    rotY: 0,
                    rotZ: 0,
                });
            });

            return next;
        });
    }, [readFileAsDataURL]);



    const setPictureVisible = useCallback((id, visible) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            if (!id) return list;
            return list.map((p) => (p.id === id ? { ...p, visible: !!visible } : p));
        });
    }, []);


    const setPictureScale = useCallback((id, scale) => {
        setImportedPictures((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const s = clamp(Number(scale) || 1, 0.05, 50);
            return list.map((p) => (p.id === id ? { ...p, scale: s } : p));
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
                rotation: [0, 0, 0],
                locked: false,
            },
        ];
    });

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
            .map(l => ({ ...l, id: uuid(), from: nodeIdMap.get(l.from), to: nodeIdMap.get(l.to) }));

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

    const mergeGroups = useCallback((intoGid, fromGid) => {
        if (!intoGid || !fromGid || intoGid === fromGid) return;
        setRooms(prev => prev.map(r => r.groupId === fromGid ? { ...r, groupId: intoGid } : r));
        setNodes(prev => prev.map(n => n.groupId === fromGid ? { ...n, groupId: intoGid } : n));
    }, []);

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


// Derived hidden sets (used by SceneInner)
    const hiddenDeckIds = useMemo(
        () => new Set(decks.filter((d) => d.visible === false).map((d) => d.id)),
        [decks]
    );
    const hiddenRoomIds = useMemo(
        () => new Set(rooms.filter((r) => r.deckId && hiddenDeckIds.has(r.deckId)).map((r) => r.id)),
        [rooms, hiddenDeckIds]
    );




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
    const [levelFromNodeId, setLevelFromNodeId] = useState(null);  // 👈 NEW

    const [moveMode, setMoveMode] = useState(true);
    const [transformMode, setTransformMode] = useState("translate"); // 'translate' | 'rotate' | 'scale'
// Production mode: hide all UI except bottom action buttons
    const [prodMode, setProdMode] = useState(false);

// Runtime animation / visibility state for each button
    const [buttonStates, setButtonStates] = useState(() => ({}));
// shape: { [actionId]: { opacity: 0..1, hidden: bool } }
    const [selected, setSelected] = useState(null); // { type:'node'|'room'|'link', id }
    const [mode, setMode] = useState("select"); // 'select' | 'link'
    const [multiSel, setMultiSel] = useState([]); // array of { type, id }

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

        // gather picked ids from selection state
        const picked = new Set();
        if (selected) picked.add(`${selected.type}:${selected.id}`);
        multiSel.forEach(it => picked.add(`${it.type}:${it.id}`));

        if (picked.size === 0) {
            setGroupAddModeId(null);
            return;
        }

        setRooms(prev => prev.map(r => picked.has(`room:${r.id}`) ? { ...r, groupId: gid } : r));
        setNodes(prev => prev.map(n => picked.has(`node:${n.id}`) ? { ...n, groupId: gid } : n));

        setGroupAddModeId(null);
    }, [groupAddModeId, selected, multiSel, setRooms, setNodes]);

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
    const defaultPose = useMemo(() => ({ position: [6, 4.5, 6], target: [0, 0, 0], fov: 55 }), []);
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
    });
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
    useEffect(() => {
        const onKey = (e) => {
            // ✅ If user is typing somewhere, ignore all global shortcuts
            if (isTypingInFormField()) return;
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
                setSelectedBreakpoint?.(null);
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




            if (e.key === "Delete" && selected) {
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
    }, [selected, prodMode, duplicateNode, moveMode]);

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
            const gltfEntry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith(".gltf"));
            const glbEntry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith(".glb"));
            const blobMap = new Map();
            await Promise.all(
                Object.values(zip.files).map(async (f) => {
                    if (f.dir) return;
                    const b = await f.async("blob");
                    blobMap.set(f.name, b);
                })
            );
            const makeURL = (name) => URL.createObjectURL(blobMap.get(name));

            if (gltfEntry) {
                const base = gltfEntry.name.split("/").slice(0, -1).join("/") + (gltfEntry.name.includes("/") ? "/" : "");
                const gltfUrl = makeURL(gltfEntry.name);
                const urlModifier = (url) => {
                    if (url.startsWith("blob:") || url.startsWith("data:")) return url;
                    const rel = decodeURIComponent(url).replace(/^[^#?]*\//, "");
                    const full = base + rel;
                    if (blobMap.has(full)) return makeURL(full);
                    if (blobMap.has(rel)) return makeURL(rel);
                    return url;
                };
                setModelDescriptor({ type: "zip:gltf", url: gltfUrl, urlModifier, cleanup: () => URL.revokeObjectURL(gltfUrl) });
                setModelBlob(file);
                setModelFilename(file.name);
                return;
            }
            if (glbEntry) {
                const blob = blobMap.get(glbEntry.name);
                const url = URL.createObjectURL(blob);
                setModelDescriptor({ type: "zip:glb", url, cleanup: () => URL.revokeObjectURL(url) });
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
            version: 13,                          // bump version so you know this format
            project: { name: projectName || "Showcase" },

            // --- core graph ---
            nodes,
            rooms,
            links,
            decks,
            groups,
            actions,

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

            // --- model descriptor (not the bytes; bytes are added below) ---
            model: {
                filename: modelFilename,
                type: modelDescriptor?.type || null,
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

                // --- project / name ---
                if (obj.project && obj.project.name) {
                    setProjectName(obj.project.name);
                }

                // --- model descriptor & file (if bundled) ---
                const modelEntry = Object
                    .values(zip.files)
                    .find((f) => f.name.startsWith("models/") && !f.dir);

                if (modelEntry) {
                    const blob = await modelEntry.async("blob");
                    const fname = modelEntry.name.split("/").pop() || "model.glb";
                    const url = URL.createObjectURL(blob);

                    if (modelDescriptor?.cleanup) {
                        try { modelDescriptor.cleanup(); } catch {}
                    }

                    setModelDescriptor({ type: "zip:glb", url, cleanup: () => URL.revokeObjectURL(url) });
                    setModelBlob(blob);
                    setModelFilename(fname);
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
    });


// reset drag baseline when selection/mode changes
    useEffect(() => {
        const r = multiMoveRef.current;
        r.active = false;
        r.driverKey = null;
    }, [moveMode, transformMode, selected?.type, selected?.id, multiSel]);

// stop a drag when pointer is released (so the next drag re-snapshots correctly)
    useEffect(() => {
        if (typeof window === "undefined") return;
        const end = () => { multiMoveRef.current.active = false; };
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
                        return { ...r, center: [s[0] + dx, s[1] + dy, s[2] + dz] };
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
                        return { ...n, position: next };
                    }

                    if (ref.roomChildStarts.has(n.id)) {
                        const s = ref.roomChildStarts.get(n.id);
                        return { ...n, position: [s[0] + dx, s[1] + dy, s[2] + dz] };
                    }

                    return n;
                })
            );

            return;
        }

        // ----- SINGLE MOVE -----
        if (target?.type === "node") {
            const node = nodes.find((n) => n.id === target.id) || null;
            const clamped = clampNodeToRoomBounds(node, pos);
            setNode(target.id, { position: clamped });
            return;
        }

        if (target?.type === "room") {
            setRoom(target.id, { center: pos });
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
        if (target.type === "node") setNode(target.id, { rotation });
        if (target.type === "room") setRoom(target.id, { rotation });
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

        const finalCenter = computeSnappedRoomCenter(roomId, newCenter);

        const dx = finalCenter[0] - pack.startCenter[0];
        const dy = finalCenter[1] - pack.startCenter[1];
        const dz = finalCenter[2] - pack.startCenter[2];

        setRoom(roomId, { center: finalCenter });
        if (pack.nodeStarts.length) {
            setNodes((prev) =>
                prev.map((n) =>
                    n.roomId === roomId
                        ? {
                            ...n,
                            position: [
                                pack.nodeStarts.find((s) => s.id === n.id).pos[0] + dx,
                                pack.nodeStarts.find((s) => s.id === n.id).pos[1] + dy,
                                pack.nodeStarts.find((s) => s.id === n.id).pos[2] + dz,
                            ],
                        }
                        : n
                )
            );
        }
    };
// Duplicate a room; offsets it on X so it's not overlapping the original
    const duplicateRoom = (roomId) => {
        const orig = rooms.find((r) => r.id === roomId);
        if (!orig) return;

        const offX = Math.max(1, (orig.size?.[0] ?? 1)) + 0.5;
        const offset = [offX, 0, 0];

        const newRoomId = uuid();
        const copy = {
            ...orig,
            id: newRoomId,
            name: `${orig.name} Copy`,
            center: [
                (orig.center?.[0] ?? 0) + offset[0],
                (orig.center?.[1] ?? 0) + offset[1],
                (orig.center?.[2] ?? 0) + offset[2],
            ],
        };

        // Duplicate nodes in this room and keep relative positions.
        const origNodes = nodes.filter((n) => n.roomId === roomId);
        const idMap = new Map();
        const newNodes = origNodes.map((n) => {
            const newId = uuid();
            idMap.set(n.id, newId);
            const p = n.position || [0, 0, 0];
            return {
                ...n,
                id: newId,
                label: `${n.label || "Node"} Copy`,
                roomId: newRoomId,
                position: [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]],
            };
        });

        // Duplicate links where both endpoints are inside the duplicated room.
        const origNodeIds = new Set(origNodes.map((n) => n.id));
        const newLinks = links
            .filter((l) => origNodeIds.has(l.from) && origNodeIds.has(l.to))
            .map((l) => {
                const bp = Array.isArray(l.breakpoints) ? l.breakpoints : [];
                const shifted = bp.map((b) => [
                    (b?.[0] ?? 0) + offset[0],
                    (b?.[1] ?? 0) + offset[1],
                    (b?.[2] ?? 0) + offset[2],
                ]);
                return {
                    ...l,
                    id: uuid(),
                    from: idMap.get(l.from) || l.from,
                    to: idMap.get(l.to) || l.to,
                    breakpoints: shifted,
                };
            });

        setRooms((prev) => [...prev, copy]);
        if (newNodes.length) setNodes((prev) => [...prev, ...newNodes]);
        if (newLinks.length) setLinks((prev) => [...prev, ...newLinks]);

        setSelected({ type: "room", id: copy.id });
    };

    const onPlace = (kind, p, multi) => {
        if (kind === "room") {
            // Always place rooms on the ground grid, using only X/Z
            const size = [3, 1.6, 2.2];        // default room: [width, height, depth]
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






    const requestDelete = (target) => {
        if (!target) return;
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
// Handles clicking a ROOM (single select for now)
// ✅ multi-select aware node click (also respects link mode)
    const handleNodeDown = (id, e) => {
        if (dragActive) return;
        setSelectedBreakpoint(null);

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

        // 🔹 NEW: Level Target mode
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

                // Keep X and Z from target, copy Y from source
                const nextPos = [dstPos[0], srcPos[1], dstPos[2]];

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

    /* Top bar */
    /* ---------------- TopBar (2 rows, evenly spaced, accessible) ---------------- */
    /* ---------------- TopBar (header + 2 rows + HUD layout) ---------------- */
    const TopBar = ({ shadowsOn, setShadowsOn }) => {
        const H = 26; // compact height
        const uid = () => uuid();
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
            gridTemplateColumns:
                "minmax(200px, 1fr) minmax(200px, 1fr) minmax(200px, 1fr) minmax(220px, 1.2fr)",            gap: 8,
            alignItems: "center",
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
            gridTemplateColumns:
                "minmax(200px, 1fr) minmax(200px, 1fr) minmax(200px, 1fr) minmax(220px, 1.2fr)",            alignItems: "flex-start",
            position: "relative",
        };

        const Section = ({ title, children }) => (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                    flexWrap: "wrap",
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
                            <img
                                src={logoImg}
                                alt="Logo"
                                style={{
                                    width: 35,
                                    height: 35,
                                    borderRadius: 6,
                                    objectFit: "contain",
                                    boxShadow: "0 0 0 1px rgba(15,23,42,0.9)",
                                    pointerEvents: "none",
                                }}
                            />
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
                                Node Forge 1.2
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

                        <Input
                            style={{
                                width: 140,
                                height: H,
                            }}
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
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
                        <Input
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="5"
                            value={modelScale}
                            onChange={(e) =>
                                setModelScale(Number(e.target.value) || 1)
                            }
                            title="Model scale"
                            style={{
                                width: 64,
                                height: H,
                                textAlign: "center",
                            }}
                        />

                        {/* Existing: Product scale */}
                        <Input
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="5"
                            value={productScale}
                            onChange={(e) =>
                                setProductScale(Number(e.target.value) || 1)
                            }
                            title="Product scale"
                            style={{
                                width: 64,
                                height: H,
                                textAlign: "center",
                            }}
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
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            <Panel title="Imported pictures">
                                <div style={{ display: "grid", gap: 10, minWidth: 520, maxWidth: 820 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <Btn
                                            variant="primary"
                                            onClick={() => picturesInputRef.current?.click()}
                                            style={{ height: 28, padding: "0 10px" }}
                                            title="Add one or more images"
                                        >
                                            Add…
                                        </Btn>
                                        <Btn
                                            variant="ghost"
                                            onClick={() => setImportedPictures([])}
                                            disabled={!importedPictures?.length}
                                            style={{ height: 28, padding: "0 10px" }}
                                            title="Remove all imported pictures"
                                        >
                                            Clear all
                                        </Btn>
                                        <span style={{ fontSize: 11, opacity: 0.75 }}>
                                            Tip: pictures render as flat 2D planes on the ground at the origin. You can show multiple at once.
                                        </span>

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
                                            }}
                                        />
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
                                        {!importedPictures?.length ? (
                                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                                                No pictures imported yet.
                                            </div>
                                        ) : (
                                            importedPictures
                                                .slice()
                                                .reverse()
                                                .map((p) => (
                                                    <div
                                                        key={p.id}
                                                        style={{
                                                            display: "grid",
                                                            gridTemplateColumns: "110px 1fr 360px 64px",
                                                            alignItems: "start",
                                                            gap: 10,
                                                            padding: "8px 10px",
                                                            borderRadius: 10,
                                                            border: "1px solid rgba(148,163,184,0.35)",
                                                            background: "rgba(10,16,30,0.55)",
                                                        }}
                                                    >
                                                        <Checkbox
                                                            checked={!!p.visible}
                                                            onChange={(v) => setPictureVisible(p.id, v)}
                                                            label="Show"
                                                            style={{ fontSize: 11 }}
                                                        />

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
                                                                <span style={{ fontSize: 11, opacity: 0.75, minWidth: 46 }}>
                                                                    Scale
                                                                </span>
                                                                <div style={{ flex: 1, minWidth: 120 }}>
                                                                    <Slider
                                                                        min={0.05}
                                                                        max={20}
                                                                        step={0.05}
                                                                        value={Number(p.scale) || 1}
                                                                        onChange={(v) => setPictureScale(p.id, v)}
                                                                    />
                                                                </div>
                                                                <Input
                                                                    type="number"
                                                                    step="0.05"
                                                                    min="0.05"
                                                                    max="50"
                                                                    value={Number(p.scale) || 1}
                                                                    onChange={(e) => setPictureScale(p.id, e.target.value)}
                                                                    style={{ width: 78, height: 28, textAlign: "center" }}
                                                                    title="Scale"
                                                                />
                                                            </div>

                                                            {/* Quick rotate (degrees on Y / yaw) */}
                                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                <span style={{ fontSize: 11, opacity: 0.75, minWidth: 46 }}>
                                                                    Rotate
                                                                </span>
                                                                <div style={{ flex: 1, minWidth: 120 }}>
                                                                    <Slider
                                                                        min={-180}
                                                                        max={180}
                                                                        step={1}
                                                                        value={Number(p.rotY) || 0}
                                                                        onChange={(v) => setPictureRotation(p.id, { rotY: v })}
                                                                    />
                                                                </div>
                                                                <Input
                                                                    type="number"
                                                                    step="1"
                                                                    min="-360"
                                                                    max="360"
                                                                    value={Number(p.rotY) || 0}
                                                                    onChange={(e) => setPictureRotation(p.id, { rotY: e.target.value })}
                                                                    style={{ width: 78, height: 28, textAlign: "center" }}
                                                                    title="Rotation (deg)"
                                                                />
                                                            </div>

                                                            {/* Advanced XYZ rotation (degrees) */}
                                                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                                <span style={{ fontSize: 11, opacity: 0.75, minWidth: 46 }}>
                                                                    XYZ
                                                                </span>
                                                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                                    <span style={{ fontSize: 11, opacity: 0.7 }}>X</span>
                                                                    <Input
                                                                        type="number"
                                                                        step="1"
                                                                        min="-360"
                                                                        max="360"
                                                                        value={Number(p.rotX) || 0}
                                                                        onChange={(e) => setPictureRotation(p.id, { rotX: e.target.value })}
                                                                        style={{ width: 64, height: 28, textAlign: "center" }}
                                                                        title="Rotate X (deg)"
                                                                    />
                                                                    <span style={{ fontSize: 11, opacity: 0.7 }}>Y</span>
                                                                    <Input
                                                                        type="number"
                                                                        step="1"
                                                                        min="-360"
                                                                        max="360"
                                                                        value={Number(p.rotY) || 0}
                                                                        onChange={(e) => setPictureRotation(p.id, { rotY: e.target.value })}
                                                                        style={{ width: 64, height: 28, textAlign: "center" }}
                                                                        title="Rotate Y (deg)"
                                                                    />
                                                                    <span style={{ fontSize: 11, opacity: 0.7 }}>Z</span>
                                                                    <Input
                                                                        type="number"
                                                                        step="1"
                                                                        min="-360"
                                                                        max="360"
                                                                        value={Number(p.rotZ) || 0}
                                                                        onChange={(e) => setPictureRotation(p.id, { rotZ: e.target.value })}
                                                                        style={{ width: 64, height: 28, textAlign: "center" }}
                                                                        title="Rotate Z (deg)"
                                                                    />
                                                                </div>
                                                                <span style={{ fontSize: 10, opacity: 0.55 }}>
                                                                    (X/Z tilt the plane)
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <Btn
                                                            variant="ghost"
                                                            onClick={() => deletePicture(p.id)}
                                                            style={{ height: 28, padding: "0 10px" }}
                                                            title="Delete"
                                                        >
                                                            Del
                                                        </Btn>
                                                    </div>
                                                ))
                                        )}
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
                            <Input
                                type="number"
                                min={1}
                                max={32}
                                step={1}
                                value={hudSnap}
                                onChange={(e) =>
                                    setHudSnap(
                                        Math.max(
                                            1,
                                            Number(e.target.value) || 1,
                                        ),
                                    )
                                }
                                style={{
                                    width: 56,
                                    height: H,
                                    textAlign: "center",
                                }}
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
                            <Input
                                type="number"
                                min={0}
                                max={64}
                                step={1}
                                value={hudMagnet}
                                onChange={(e) =>
                                    setHudMagnet(
                                        Math.max(
                                            0,
                                            Number(e.target.value) || 0,
                                        ),
                                    )
                                }
                                style={{
                                    width: 56,
                                    height: H,
                                    textAlign: "center",
                                }}
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
                                        setSelectedBreakpoint?.(null);
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
                                flexWrap: "wrap",
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


                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 10, flexWrap: "wrap" }}>
                                <Checkbox
                                    checked={snapRoomsEnabled}
                                    onChange={setSnapRoomsEnabled}
                                    label="Snap rooms"
                                />
                                <span style={{ fontSize: 11, opacity: 0.75 }}>Strength</span>
                                <Input
                                    type="number"
                                    step="0.05"
                                    min="0.01"
                                    value={snapRoomsDistance}
                                    onChange={(e) => setSnapRoomsDistance(Number(e.target.value) || 0.5)}
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
    };

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
                    return (
                        <div key={rid} style={{ marginBottom: 10, borderTop: "1px dashed rgba(255,255,255,0.1)", paddingTop: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                <div
                                    style={{ fontWeight: 800, color: "#a8c0ff", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                                    onClick={() => setSelected({ type: "room", id: rid })}
                                >
                                    {bucket.room.name}
                                </div>
                                {rid !== "__no_room__" && (
                                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                        <Checkbox
                                            checked={!!rooms.find((r) => r.id === rid)?.locked}
                                            onChange={(v) =>
                                                setRooms((prev) =>
                                                    prev.map((r) =>
                                                        r.id === rid ? { ...r, locked: v } : r,
                                                    ),
                                                )
                                            }
                                            label="lock"
                                        />
                                        <Checkbox
                                            checked={rooms.find((r) => r.id === rid)?.visible !== false}
                                            onChange={(v) => setRooms((prev) => prev.map((r) => (r.id === rid ? { ...r, visible: v } : r)))}
                                            label="visible"
                                        />
                                        <Btn onClick={() => duplicateRoom(rid)}>Duplicate</Btn>
                                        <Btn onClick={() => requestDelete({ type: "room", id: rid })}>Delete</Btn>
                                    </div>
                                )}
                            </div>

                            <div>
                                {DEFAULT_CLUSTERS.map((cat) => {
                                    const list = (itemsByCat[cat] || []).filter((n) => !filter || n.label.toLowerCase().includes(filter.toLowerCase()));
                                    return (
                                        <div key={cat} style={{ marginLeft: 8, marginBottom: 6 }}>
                                            <div style={{ color: "#9fb6d8", fontWeight: 700 }}>
                                                {cat} <span style={{ opacity: 0.6 }}>({list.length})</span>
                                            </div>
                                            <div style={{ marginLeft: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                                                {list.map((n) => (
                                                    <div
                                                        key={n.id}
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "space-between",
                                                            border: "1px solid rgba(255,255,255,0.08)",
                                                            borderRadius: 10,
                                                            padding: "5px 7px",
                                                            background: selected?.type === "node" && selected?.id === n.id ? "rgba(0,225,255,0.12)" : "rgba(255,255,255,0.04)",
                                                        }}
                                                    >
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            <span style={{ width: 10, height: 10, borderRadius: 3, background: n.color || clusterColor(n.cluster) }} />
                                                            <a onClick={() => setSelected({ type: "node", id: n.id })} style={{ color: "#fff", cursor: "pointer", textDecoration: "none" }}>
                                                                {n.label}
                                                            </a>
                                                            {n.kind === "switch" && <span style={{ opacity: 0.7, fontSize: 11 }}>(switch)</span>}
                                                        </div>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            <IconBtn label="⚭" title="Link from this node" onClick={() => quickLink(n.id)} />
                                                            <IconBtn label="⧉" title="Duplicate" onClick={() => duplicateNode(n.id)} />
                                                            {n.light?.type !== "none" && (
                                                                <Checkbox
                                                                    checked={!!n.light.enabled}
                                                                    onChange={(v) =>
                                                                        setNode(n.id, {
                                                                            light: { ...(n.light || {}), enabled: v },
                                                                        })
                                                                    }
                                                                    label="light"
                                                                />
                                                            )}

                                                            <Btn onClick={() => requestDelete({ type: "node", id: n.id })}>✕</Btn>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </Panel>
        );
    };

    const GroupsPanel = () => {
        const [mergePick, setMergePick] = useState({});

        const createGroup = () => {
            const id = uuid();
            const base = "Group";
            const used = new Set(groups.map((g) => (g.name || "").toLowerCase()));
            let name = base, i = 2;
            while (used.has(name.toLowerCase())) name = `${base} ${i++}`;
            setGroups((prev) => [...prev, { id, name, hidden: false }]);
        };

        return (
            <Panel title="Groups">
                <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Btn onClick={createGroup}>New group</Btn>
                        {groupAddModeId && (
                            <div style={{ fontSize: 12, opacity: 0.85 }}>
                                Add-to-group active: select nodes/rooms in the scene, then press Done to add them
                                <Btn style={{ marginLeft: 8 }} onClick={applyGroupAddMode}>Done</Btn>
                            </div>
                        )}
                    </div>

                    {groups.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>No groups yet.</div>
                    ) : (
                        groups.map((g) => {
                            const roomCount = rooms.filter((r) => r.groupId === g.id).length;
                            const nodeCount = nodes.filter((n) => n.groupId === g.id).length;

                            return (
                                <div key={g.id} style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                            <Input
                                                value={g.name || ""}
                                                onChange={(e) =>
                                                    setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))
                                                }
                                                style={{ width: 220 }}
                                            />
                                            <span style={{ fontSize: 12, opacity: 0.75 }}>
                                                {roomCount} rooms · {nodeCount} nodes
                                            </span>
                                        </div>

                                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                            <Btn
                                                onClick={() => setGroupAddModeId((prev) => (prev === g.id ? null : g.id))}
                                                variant={groupAddModeId === g.id ? "primary" : undefined}
                                            >
                                                {groupAddModeId === g.id ? "Adding…" : "Click to add"}
                                            </Btn>

                                            <Btn onClick={() => moveGroup(g.id)}>Move</Btn>

                                            <Btn onClick={() => setGroupHidden(g.id, !g.hidden)}>
                                                {g.hidden ? "Show" : "Hide"}
                                            </Btn>

                                            <Btn onClick={() => duplicateGroup(g.id)}>Duplicate</Btn>

                                            <Select
                                                value={mergePick[g.id] || ""}
                                                onChange={(e) => {
                                                    const from = e.target.value;
                                                    setMergePick((m) => ({ ...m, [g.id]: "" }));
                                                    mergeGroups(g.id, from);
                                                }}
                                                style={{ width: 160 }}
                                                title="Merge another group into this one"
                                            >
                                                <option value="" disabled>Merge from…</option>
                                                {groups.filter((x) => x.id !== g.id).map((x) => (
                                                    <option key={x.id} value={x.id}>{x.name || x.id}</option>
                                                ))}
                                            </Select>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </Panel>
        );
    };
    const DecksPanel = () => {
        const byDeck = useMemo(() => {
            const map = {};
            decks.forEach((d) => (map[d.id] = { deck: d, rooms: [], nodes: [] }));
            // Rooms directly assigned to a deck
            rooms.forEach((r) => {
                if (r.deckId && map[r.deckId]) map[r.deckId].rooms.push(r);
            });
            // Nodes: either directly assigned OR inside a room that’s on the deck
            const roomDeck = Object.fromEntries(rooms.map((r) => [r.id, r.deckId || null]));
            nodes.forEach((n) => {
                const did = n.deckId || roomDeck[n.roomId] || null;
                if (did && map[did]) map[did].nodes.push(n);
            });
            return Object.values(map);
        }, [decks, rooms, nodes]);

        return (
            <Panel title="Decks">
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <Btn onClick={addDeck}>+ Add Deck</Btn>
                </div>
                {byDeck.length === 0 && <div style={{opacity:0.8}}>No decks yet. Click “Add Deck”.</div>}
                {byDeck.map(({ deck, rooms, nodes }) => (
                    <div key={deck.id} style={{ borderTop: "1px dashed rgba(255,255,255,0.1)", paddingTop: 8, marginTop: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <input
                                defaultValue={deck.name}
                                onBlur={(e) => {
                                    const v = e.target.value.trim();
                                    if (v && v !== deck.name) setDeck(deck.id, { name: v });
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        e.currentTarget.blur(); // commits via onBlur
                                    }
                                }}
                                spellCheck={false}
                                autoComplete="off"
                            />

                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <Checkbox
                                    checked={deck.visible !== false}
                                    onChange={(v) => setDeck(deck.id, { visible: v })}   // wrapped -> no jump
                                    label={deck.visible !== false ? "visible" : "hidden"}
                                />

                                <Btn onClick={() => deleteDeck(deck.id)}>Delete</Btn>   // wrapped -> no jump
                            </div>
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 6 }}>
                            <div style={{ marginBottom: 4, fontWeight: 800 }}>Rooms ({rooms.length})</div>
                            {rooms.length === 0 ? (
                                <div style={{ opacity: 0.7, marginBottom: 6 }}>—</div>
                            ) : rooms.map((r) => (
                                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                    <a onClick={() => setSelected({ type: "room", id: r.id })} style={{ cursor: "pointer" }}>{r.name}</a>
                                </div>
                            ))}

                            <div style={{ marginTop: 8, marginBottom: 4, fontWeight: 800 }}>Nodes ({nodes.length})</div>
                            {nodes.length === 0 ? (
                                <div style={{ opacity: 0.7 }}>—</div>
                            ) : nodes.map((n) => (
                                <div key={n.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                    <a onClick={() => setSelected({ type: "node", id: n.id })} style={{ cursor: "pointer" }}>
                                        {n.label}
                                    </a>
                                    <span style={{ opacity: 0.7, fontSize: 11 }}>{n.cluster}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </Panel>
        );
    };

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
                                value={linkDefaults.particles?.opacity ?? 1}
                                min={0.1}
                                max={1}
                                step={0.05}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, particles: { ...(d.particles || {}), opacity: v } }))}
                            />
                        </label>
                        <label>
                            Wave Amplitude
                            <Slider
                                value={linkDefaults.particles?.waveAmp ?? (linkDefaults.style === "wavy" ? 0.15 : 0)}
                                min={0}
                                max={0.6}
                                step={0.01}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, particles: { ...(d.particles || {}), waveAmp: v } }))}
                            />
                        </label>
                        <label>
                            Wave Frequency
                            <Slider
                                value={linkDefaults.particles?.waveFreq ?? 2}
                                min={0.2}
                                max={8}
                                step={0.05}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, particles: { ...(d.particles || {}), waveFreq: v } }))}
                            />
                        </label>
                        <label>
                            Shape
                            <Select
                                value={linkDefaults.particles?.shape || "sphere"}
                                onChange={(e) => setLinkDefaults((d) => ({ ...d, particles: { ...(d.particles || {}), shape: e.target.value } }))}
                            >
                                <option value="sphere">sphere</option>
                                <option value="box">box</option>
                                <option value="octa">octa</option>
                            </Select>
                        </label>
                    </>
                )}

                {linkDefaults.style === "epic" && (
                    <>
                        <label>
                            Tube Thickness
                            <Slider
                                value={linkDefaults.tube?.thickness ?? 0.06}
                                min={0.02}
                                max={0.25}
                                step={0.005}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, tube: { ...(d.tube || {}), thickness: v } }))}
                            />
                        </label>
                        <label>
                            Tube Glow
                            <Slider
                                value={linkDefaults.tube?.glow ?? 1.3}
                                min={0}
                                max={3}
                                step={0.05}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, tube: { ...(d.tube || {}), glow: v } }))}
                            />
                        </label>
                        <label>
                            Trail Particles
                            <Checkbox
                                checked={(linkDefaults.tube?.trail ?? true) === true}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, tube: { ...(d.tube || {}), trail: v } }))}
                                label="enabled"
                            />
                        </label>
                    </>
                )}

                {linkDefaults.style === "icons" && (
                    <>
                        <label>
                            Icon (emoji or char)
                            <Input
                                value={linkDefaults.icon?.char ?? "▶"}
                                onChange={(e) => setLinkDefaults((d) => ({ ...d, icon: { ...(d.icon || {}), char: e.target.value } }))}
                            />
                        </label>
                        <label>
                            Icon Count
                            <Slider
                                value={linkDefaults.icon?.count ?? 4}
                                min={1}
                                max={8}
                                step={1}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, icon: { ...(d.icon || {}), count: v } }))}
                            />
                        </label>
                        <label>
                            Icon Size
                            <Slider
                                value={linkDefaults.icon?.size ?? 0.12}
                                min={0.06}
                                max={0.4}
                                step={0.01}
                                onChange={(v) => setLinkDefaults((d) => ({ ...d, icon: { ...(d.icon || {}), size: v } }))}
                            />
                        </label>
                    </>
                )}
            </div>
        </Panel>
    );


    const GroupsMembersPanel = () => {
        const grouped = useMemo(
            () =>
                (groups || []).map((g) => {
                    const gRooms = (rooms || []).filter((r) => r.groupId === g.id);
                    const gNodes = (nodes || []).filter((n) => n.groupId === g.id);
                    return { group: g, rooms: gRooms, nodes: gNodes };
                }),
            [groups, rooms, nodes]
        );

        const selectRoom = (id) => {
            setSelected({ type: "room", id });
            setMultiSel([]);
        };
        const selectNode = (id) => {
            setSelected({ type: "node", id });
            setMultiSel([]);
        };

        if (!grouped.length) {
            return (
                <Panel title="Groups – Members">
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                        No groups yet. Create a group and assign rooms or nodes to see them here.
                    </div>
                </Panel>
            );
        }

        return (
            <Panel title="Groups – Members">
                <div style={{ display: "grid", gap: 8 }}>
                    {grouped.map(({ group: g, rooms: gRooms, nodes: gNodes }) => {
                        const hasMembers = gRooms.length || gNodes.length;
                        const color = g.color || "#38bdf8";
                        return (
                            <div
                                key={g.id}
                                style={{
                                    borderRadius: 10,
                                    padding: 8,
                                    background:
                                        "radial-gradient(260px 180px at 0% 0%, rgba(30,64,175,0.35), rgba(15,23,42,0.95))",
                                    border: "1px solid rgba(148,163,184,0.35)",
                                    boxShadow: `0 10px 30px rgba(15,23,42,0.85)`,
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        marginBottom: 6,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <div
                                            style={{
                                                width: 10,
                                                height: 10,
                                                borderRadius: 999,
                                                background: color,
                                                boxShadow: `0 0 10px ${color}`,
                                            }}
                                        />
                                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                                            {g.name || "Unnamed group"}
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 11,
                                            opacity: 0.8,
                                            display: "flex",
                                            gap: 8,
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        <span>Rooms: {gRooms.length}</span>
                                        <span>Nodes: {gNodes.length}</span>
                                    </div>
                                </div>

                                {hasMembers ? (
                                    <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
                                        {gRooms.length > 0 && (
                                            <div>
                                                <div
                                                    style={{
                                                        textTransform: "uppercase",
                                                        letterSpacing: "0.16em",
                                                        fontSize: 9,
                                                        opacity: 0.7,
                                                        marginBottom: 4,
                                                    }}
                                                >
                                                    ROOMS
                                                </div>
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                                    {gRooms.map((r) => (
                                                        <button
                                                            key={r.id}
                                                            type="button"
                                                            onClick={() => selectRoom(r.id)}
                                                            style={{
                                                                borderRadius: 999,
                                                                border: "1px solid rgba(148,163,184,0.55)",
                                                                padding: "3px 8px",
                                                                fontSize: 11,
                                                                background:
                                                                    "radial-gradient(120px 120px at 0% 0%, rgba(59,130,246,0.4), rgba(15,23,42,0.95))",
                                                                color: "#e5e7eb",
                                                                cursor: "pointer",
                                                            }}
                                                        >
                                                            {r.name || "Room"}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {gNodes.length > 0 && (
                                            <div>
                                                <div
                                                    style={{
                                                        textTransform: "uppercase",
                                                        letterSpacing: "0.16em",
                                                        fontSize: 9,
                                                        opacity: 0.7,
                                                        marginBottom: 4,
                                                    }}
                                                >
                                                    NODES
                                                </div>
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                                    {gNodes.map((n) => (
                                                        <button
                                                            key={n.id}
                                                            type="button"
                                                            onClick={() => selectNode(n.id)}
                                                            style={{
                                                                borderRadius: 999,
                                                                border: "1px solid rgba(148,163,184,0.55)",
                                                                padding: "3px 8px",
                                                                fontSize: 11,
                                                                background:
                                                                    "radial-gradient(120px 120px at 0% 0%, rgba(45,212,191,0.4), rgba(15,23,42,0.95))",
                                                                color: "#e5e7eb",
                                                                cursor: "pointer",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: 4,
                                                            }}
                                                        >
                                                            <span
                                                                style={{
                                                                    width: 6,
                                                                    height: 6,
                                                                    borderRadius: 999,
                                                                    background: n.color || "#22c55e",
                                                                }}
                                                            />
                                                            <span>{n.label || "Node"}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                                        No rooms or nodes in this group yet.
                                    </div>
                                )}
                            </div>
                        );
                    })}
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


    const runAction = (action) => {
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
                    const cur = !!n.light?.enabled;
                    setNode(n.id, {
                        light: {
                            ...(n.light || {type: "point", intensity: 200, distance: 8}),
                            enabled: !cur,
                        },
                    });
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
                    } else {
                        scheduleNodeStep(c, childStart);
                    }
                });
            }
        });
    };





    const ActionsPanel = () => {
        const [working, setWorking] = useState({ label: "", stepType: "toggleLight", nodeId: "", value: "waves" });
        const [justAddedId, setJustAddedId] = useState(null);
        const [justAddedLabel, setJustAddedLabel] = useState("");

        const stepTypeOptions = [
            { value: "toggleLight", label: "Toggle Light" },
            { value: "toggleGlow", label: "Toggle Glow" },
            { value: "setSignalStyle", label: "Set Signal Style" },
            { value: "textBox", label: "Text Box" },
            { value: "textBoxFade", label: "Text Box Fade (manual)" }, // manual fade / show / hide
            { value: "setWireframe",  label: "Wireframe On/Off (Global)" },
            { value: "cameraMove", label: "Camera Move / Track" },
            { value: "hudFade", label: "HUD: Fade Button" },   // <-- new

        ];

        // helpers that preserve left panel scroll
        const patchAction = (id, patch) =>
            keepLeftScroll(() => setActions(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a)));

        const deleteAction = (id) =>
            keepLeftScroll(() => setActions(prev => prev.filter(a => a.id !== id)));

        const duplicateAction = (id) =>
            keepLeftScroll(() => setActions(prev => prev.map(a => {
                if (a.id !== id) return a;
                const copy = JSON.parse(JSON.stringify(a));
                copy.id = uuid();
                copy.label = `${a.label || "Action"} Copy`;
                return copy;
            })));

        const addAction = (e) => {
            e?.preventDefault?.();

            // Compute id + label once so we can highlight + message
            const newId = uuid();
            const newLabel = working.label || `Action ${actions.length + 1}`;

            keepLeftScroll(() =>
                setActions(prev => [
                    ...prev,
                    { id: newId, label: newLabel, showOnHUD: true, steps: [] }
                ])
            );

            setWorking(w => ({ ...w, label: "" }));
            setJustAddedId(newId);
            setJustAddedLabel(newLabel);

            // Fade the highlight after a short delay
            setTimeout(() => {
                setJustAddedId((current) => (current === newId ? null : current));
            }, 1000);
        };


        const addStep = (actId, tpl) =>
            keepLeftScroll(() =>
                setActions(prev => prev.map(a =>
                    a.id === actId
                        ? { ...a, steps: [...a.steps, tpl || { type: "toggleLight", nodeId: null }] }
                        : a
                ))
            );
        const hudActions = actions.filter((a) => (a.showOnHUD ?? true) === true);
        const addChildStep = (actId, parentIdx, tpl) =>
            keepLeftScroll(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = a.steps.map((s, i) => {
                        if (i !== parentIdx) return s;
                        const children = Array.isArray(s.children) ? [...s.children] : [];
                        children.push(
                            tpl || { type: "toggleLight", nodeId: null, delay: 0 }
                        );
                        return { ...s, children };
                    });
                    return { ...a, steps };
                }))
            );

        const patchChildStep = (actId, parentIdx, childIdx, patch) =>
            keepLeftScroll(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = a.steps.map((s, i) => {
                        if (i !== parentIdx) return s;
                        const children = (s.children || []).map((c, j) =>
                            j === childIdx ? { ...c, ...patch } : c
                        );
                        return { ...s, children };
                    });
                    return { ...a, steps };
                }))
            );

        const delChildStep = (actId, parentIdx, childIdx) =>
            keepLeftScroll(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = a.steps.map((s, i) => {
                        if (i !== parentIdx) return s;
                        const children = (s.children || []).filter((_, j) => j !== childIdx);
                        return { ...s, children };
                    });
                    return { ...a, steps };
                }))
            );

        const moveChildStep = (actId, parentIdx, childIdx, dir) =>
            keepLeftScroll(() =>
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
            );

        const patchStep = (actId, idx, patch) =>
            keepLeftScroll(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = a.steps.map((s, i) => i === idx ? { ...s, ...patch } : s);
                    return { ...a, steps };
                }))
            );

        const delStep = (actId, idx) =>
            keepLeftScroll(() =>
                setActions(prev => prev.map(a =>
                    a.id === actId
                        ? { ...a, steps: a.steps.filter((_, i) => i !== idx) }
                        : a
                ))
            );
// Small numeric input helper reused in node inspector (shape, textbox, etc.)


        const moveStep = (actId, idx, dir) =>
            keepLeftScroll(() =>
                setActions(prev => prev.map(a => {
                    if (a.id !== actId) return a;
                    const steps = [...a.steps];
                    const j = idx + dir;
                    if (j < 0 || j >= steps.length) return a;
                    [steps[idx], steps[j]] = [steps[j], steps[idx]];
                    return { ...a, steps };
                }))
            );

        return (
            <Panel title="Actions / On-screen Buttons">
                <div style={{ display: "grid", gap: 10 }}>
                    {/* New action header */}
                    <form
                        onSubmit={addAction}
                        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}
                    >
                        <label style={{ flex: 1, minWidth: 140 }}>
                            Name
                            <Input
                                value={working.label}
                                onChange={(e) => setWorking((w) => ({ ...(w || {}), label: e.target.value }))}
                                placeholder="New action name…"
                            />

                        </label>
                        <Btn type="submit" variant="primary" glow>+ Add Action</Btn>
                    </form>
                    {justAddedLabel && (
                        <div style={{ fontSize: 11, opacity: 0.85, color: "#a6d4ff", marginTop: -4 }}>
                            Added “{justAddedLabel}” at the bottom of the list.
                        </div>
                    )}

                    {/* Actions list */}
                    <div style={{ display: "grid", gap: 8 }}>
                        {actions.length === 0 && (
                            <div style={{ opacity: 0.7, fontSize: 12 }}>No actions yet. Create one above.</div>
                        )}

                        {actions.map((a) => (
                            <div
                                key={a.id}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.14)",
                                    borderRadius: 12,
                                    padding: 10,
                                    marginBottom: 10
                                }}
                            >
                                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                                    <label>
                                        Label
                                        <Input
                                            value={a.label}
                                            onChange={(e) => patchAction(a.id, { label: e.target.value })}
                                        />
                                    </label>
                                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                        <Checkbox
                                            checked={(a.showOnHUD ?? true) === true}
                                            onChange={(v) => patchAction(a.id, { showOnHUD: v })}
                                            label="Show on HUD"
                                        />
                                        <Btn onClick={(e) => { e.preventDefault(); runAction(a); }}>Run</Btn>
                                        <Btn onClick={(e) => { e.preventDefault(); duplicateAction(a.id); }}>Duplicate</Btn>
                                        <Btn onClick={(e) => { e.preventDefault(); deleteAction(a.id); }}>Delete</Btn>
                                    </div>
                                </div>

                                {/* steps */}
                                {/* steps */}
                                <div style={{ marginTop: 8 }}>
                                    {a.steps.length === 0 && (
                                        <div style={{ opacity: 0.7, fontSize: 12 }}>No steps yet.</div>
                                    )}

                                    {a.steps.map((s, i) => {
                                        const isCamera = s.type === "cameraMove";
                                        const isWire   = s.type === "setWireframe";
                                        const isHudFade = s.type === "hudFade";

                                        return (
                                            <div
                                                key={i}
                                                style={{
                                                    marginBottom: 8,
                                                    padding: 6,
                                                    borderRadius: 10,
                                                    background: "rgba(255,255,255,0.02)",
                                                    border: "1px solid rgba(255,255,255,0.08)",
                                                }}
                                            >
                                                {/* Main step row */}
                                                <div
                                                    style={{
                                                        display: "grid",
                                                        gridTemplateColumns: "1.2fr 1.4fr 1.6fr auto",
                                                        gap: 6,
                                                        alignItems: "end",
                                                    }}
                                                >
                                                    {/* Type */}
                                                    <label>
                                                        Type
                                                        <Select
                                                            value={s.type}
                                                            onChange={(e) => {
                                                                const type = e.target.value;
                                                                const patch = { type };
                                                                if (type === "cameraMove") {
                                                                    patch.nodeId = null;
                                                                    patch.fromPresetId = s.fromPresetId || "";
                                                                    patch.toPresetId = s.toPresetId || "";
                                                                    patch.delay = s.delay ?? 0;
                                                                    patch.duration = s.duration ?? 1.5;
                                                                } else if (type === "setWireframe") {
                                                                    patch.nodeId = null;
                                                                    patch.value = s.value || "on";
                                                                    patch.delay = s.delay ?? 0;
                                                                    patch.duration = undefined;
                                                                    patch.fromPresetId = undefined;
                                                                    patch.toPresetId = undefined;
                                                                } else if (type === "setTextBox") {              // 👈 NEW
                                                                    // Node-targeted; keep nodeId, just give it a value
                                                                    patch.value = s.value || "on";              // "on" | "off"
                                                                }

                                                                patchStep(a.id, i, patch);
                                                            }}
                                                        >
                                                            {stepTypeOptions.map((opt) => (
                                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                            ))}
                                                        </Select>
                                                    </label>

                                                    {/* Target (node or camera from-view) */}
                                                    {isCamera ? (
                                                        <label>
                                                            From View
                                                            <Select
                                                                value={s.fromPresetId || ""}
                                                                onChange={(e) => patchStep(a.id, i, { fromPresetId: e.target.value || "" })}
                                                            >
                                                                <option value="">(current)</option>
                                                                {cameraPresets.map((p) => (
                                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                                ))}
                                                            </Select>
                                                        </label>
                                                    ) : isWire ? (
                                                        <label>
                                                            Target
                                                            <div
                                                                style={{
                                                                    fontSize: 12,
                                                                    opacity: 0.8,
                                                                    padding: "7px 10px",
                                                                    borderRadius: 10,
                                                                    border: "1px solid rgba(255,255,255,0.12)",
                                                                    background: "rgba(255,255,255,0.04)",
                                                                }}
                                                            >
                                                                Global: Wireframe
                                                            </div>
                                                        </label>
                                                    ) : isHudFade ? (
                                                        <label>
                                                            Target Button
                                                            <Select
                                                                value={s.hudTargetId || ""}
                                                                onChange={(e) =>
                                                                    patchStep(a.id, i, {
                                                                        hudTargetId: e.target.value || "",
                                                                    })
                                                                }
                                                            >
                                                                <option value="">(none)</option>
                                                                {actions
                                                                    .filter((act) => act.showOnHUD ?? true)
                                                                    .map((act) => (
                                                                        <option key={act.id} value={act.id}>
                                                                            {act.label || "(unnamed button)"}
                                                                        </option>
                                                                    ))}
                                                            </Select>
                                                        </label>
                                                    ) : (
                                                        <label>
                                                            Target Node
                                                            <Select
                                                                value={s.nodeId || ""}
                                                                onChange={(e) => patchStep(a.id, i, { nodeId: e.target.value || null })}
                                                            >
                                                                <option value="">(none)</option>
                                                                {nodes.map((n) => (
                                                                    <option key={n.id} value={n.id}>{n.label}</option>
                                                                ))}
                                                            </Select>
                                                        </label>
                                                    )}

                                                    {/* Value / timing */}
                                                    {isCamera ? (
                                                        <div style={{ display: "grid", gap: 4 }}>
                                                            <label>
                                                                To View
                                                                <Select
                                                                    value={s.toPresetId || ""}
                                                                    onChange={(e) =>
                                                                        patchStep(a.id, i, { toPresetId: e.target.value || "" })
                                                                    }
                                                                >
                                                                    <option value="">(pick a view)</option>
                                                                    {cameraPresets.map((p) => (
                                                                        <option key={p.id} value={p.id}>
                                                                            {p.name}
                                                                        </option>
                                                                    ))}
                                                                </Select>
                                                            </label>
                                                            <div style={{ display: "flex", gap: 4 }}>
                                                                <label style={{ flex: 1 }}>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Delay (s)</div>
                                                                    <Input
                                                                        type="number"
                                                                        step="0.1"
                                                                        value={s.delay ?? 0}
                                                                        onChange={(e) =>
                                                                            patchStep(a.id, i, { delay: Number(e.target.value) || 0 })
                                                                        }
                                                                    />
                                                                </label>
                                                                <label style={{ flex: 1 }}>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Duration (s)</div>
                                                                    <Input
                                                                        type="number"
                                                                        step="0.1"
                                                                        value={s.duration ?? 1.5}
                                                                        onChange={(e) =>
                                                                            patchStep(a.id, i, { duration: Number(e.target.value) || 0 })
                                                                        }
                                                                    />
                                                                </label>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: "grid", gap: 4 }}>
                                                            {/* Shared delay for non-camera steps */}
                                                            <label>
                                                                <div style={{ fontSize: 11, opacity: 0.8 }}>Delay (s)</div>
                                                                <Input
                                                                    type="number"
                                                                    step="0.1"
                                                                    value={s.delay ?? 0}
                                                                    onChange={(e) =>
                                                                        patchStep(a.id, i, { delay: Number(e.target.value) || 0 })
                                                                    }
                                                                />
                                                            </label>

                                                            {/* Signal style value */}
                                                            {s.type === "setSignalStyle" && (
                                                                <label>
                                                                    Value
                                                                    <Select
                                                                        value={s.value || "waves"}
                                                                        onChange={(e) =>
                                                                            patchStep(a.id, i, { value: e.target.value })
                                                                        }
                                                                    >
                                                                        <option value="waves">waves</option>
                                                                        <option value="rays">rays</option>
                                                                        <option value="none">none</option>
                                                                    </Select>
                                                                </label>
                                                            )}

                                                            {/* HUD fade controls (mode + duration) */}
                                                            {s.type === "hudFade" && (
                                                                <div style={{ display: "flex", gap: 6 }}>
                                                                    <label style={{ flex: 1 }}>
                                                                        Fade
                                                                        <Select
                                                                            value={s.hudMode || "out"}
                                                                            onChange={(e) =>
                                                                                patchStep(a.id, i, {
                                                                                    hudMode: e.target.value || "out",
                                                                                })
                                                                            }
                                                                        >
                                                                            <option value="in">Fade In</option>
                                                                            <option value="out">Fade Out</option>
                                                                        </Select>
                                                                    </label>
                                                                    <label style={{ flex: 1 }}>
                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Duration (s)</div>
                                                                        <Input
                                                                            type="number"
                                                                            step="0.1"
                                                                            value={s.hudDuration ?? 0.35}
                                                                            onChange={(e) =>
                                                                                patchStep(a.id, i, {
                                                                                    hudDuration: Number(e.target.value) || 0.35,
                                                                                })
                                                                            }
                                                                        />
                                                                    </label>
                                                                </div>
                                                            )}

                                                            {/* TextBox mode selector */}
                                                            {s.type === "textBox" && (
                                                                <label>
                                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>Text Box Action</div>
                                                                    <Select
                                                                        value={s.mode || "toggle"}
                                                                        onChange={(e) =>
                                                                            patchStep(a.id, i, { mode: e.target.value })
                                                                        }
                                                                    >
                                                                        <option value="toggle">Toggle on/off</option>
                                                                        <option value="on">Force ON</option>
                                                                        <option value="off">Force OFF</option>
                                                                        <option value="fade">Timed fade (use node timers)</option>
                                                                    </Select>
                                                                </label>
                                                            )}


                                                            {s.type === "textBoxFade" && (
                                                                <>
                                                                    <label>
                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Fade Type</div>
                                                                        <Select
                                                                            value={s.fadeMode || "in"}
                                                                            onChange={(e) =>
                                                                                patchStep(a.id, i, { fadeMode: e.target.value })
                                                                            }
                                                                        >
                                                                            <option value="in">Fade In (stay visible)</option>
                                                                            <option value="out">Fade Out (hide)</option>
                                                                            <option value="show">Show instantly</option>
                                                                            <option value="hide">Hide instantly</option>
                                                                        </Select>
                                                                    </label>
                                                                    <label>
                                                                        <div style={{ fontSize: 11, opacity: 0.8 }}>Duration (s)</div>
                                                                        <Input
                                                                            type="number"
                                                                            step="0.1"
                                                                            value={s.duration ?? ""}
                                                                            onChange={(e) =>
                                                                                patchStep(a.id, i, {
                                                                                    duration:
                                                                                        e.target.value === ""
                                                                                            ? ""
                                                                                            : Number(e.target.value) || 0,
                                                                                })
                                                                            }
                                                                        />
                                                                    </label>
                                                                </>
                                                            )}
                                                            {isWire && (
                                                                <label>
                                                                    Wireframe
                                                                    <Select
                                                                        value={s.value || "on"}
                                                                        onChange={(e) => patchStep(a.id, i, { value: e.target.value })}
                                                                    >
                                                                        <option value="on">On</option>
                                                                        <option value="off">Off</option>
                                                                    </Select>
                                                                </label>
                                                            )}
                                                            {s.type === "setTextBox" && (
                                                                <label>
                                                                    Text Box
                                                                    <Select
                                                                        value={s.value || "on"}
                                                                        onChange={(e) => patchStep(a.id, i, { value: e.target.value })}
                                                                    >
                                                                        <option value="on">On</option>
                                                                        <option value="off">Off</option>
                                                                    </Select>
                                                                </label>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Step controls */}
                                                    <div style={{ display: "flex", gap: 6 }}>
                                                        <Btn onClick={(e) => { e.preventDefault(); moveStep(a.id, i, -1); }}>↑</Btn>
                                                        <Btn onClick={(e) => { e.preventDefault(); moveStep(a.id, i, +1); }}>↓</Btn>
                                                        <Btn onClick={(e) => { e.preventDefault(); delStep(a.id, i); }}>✕</Btn>
                                                    </div>
                                                </div>

                                                {/* Sub-steps */}
                                                {Array.isArray(s.children) && s.children.length > 0 && (
                                                    <div
                                                        style={{
                                                            marginTop: 6,
                                                            marginLeft: 8,
                                                            paddingLeft: 8,
                                                            borderLeft: "1px dashed rgba(255,255,255,0.3)",
                                                            display: "grid",
                                                            gap: 4,
                                                        }}
                                                    >
                                                        {s.children.map((c, ci) => {
                                                            const cIsWire = c.type === "setWireframe";
                                                            const cIsTextBox = c.type === "setTextBox";   // 👈 NEW

                                                            return (
                                                                <div
                                                                    key={ci}
                                                                    style={{
                                                                        display: "grid",
                                                                        gridTemplateColumns: "1.3fr 1.4fr 1.4fr auto",
                                                                        gap: 6,
                                                                        alignItems: "end",
                                                                    }}
                                                                >
                                                                    {/* Child Type */}
                                                                    <label>
                                                                        Type
                                                                        <Select
                                                                            value={c.type}
                                                                            onChange={(e) => {
                                                                                const type = e.target.value;
                                                                                const patch = { type };
                                                                                if (type === "setWireframe") {
                                                                                    patch.nodeId = null;
                                                                                    patch.value = c.value || "on";
                                                                                } else if (type === "setTextBox") {      // 👈 NEW
                                                                                    patch.value = c.value || "on";
                                                                                }

                                                                                patchChildStep(a.id, i, ci, patch);
                                                                            }}
                                                                        >
                                                                            {stepTypeOptions
                                                                                .filter((opt) => opt.value !== "cameraMove")
                                                                                .map((opt) => (
                                                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                                                ))}
                                                                        </Select>
                                                                    </label>

                                                                    {/* Child target */}
                                                                    {cIsWire ? (
                                                                        <label>
                                                                            Target
                                                                            <div
                                                                                style={{
                                                                                    fontSize: 12,
                                                                                    opacity: 0.8,
                                                                                    padding: "5px 8px",
                                                                                    borderRadius: 8,
                                                                                    border: "1px solid rgba(255,255,255,0.12)",
                                                                                    background: "rgba(255,255,255,0.03)",
                                                                                }}
                                                                            >
                                                                                Global: Wireframe
                                                                            </div>
                                                                        </label>
                                                                    ) : (
                                                                        <label>
                                                                            Target Node
                                                                            <Select
                                                                                value={c.nodeId || ""}
                                                                                onChange={(e) => patchChildStep(a.id, i, ci, { nodeId: e.target.value || null })}
                                                                            >
                                                                                <option value="">(none)</option>
                                                                                {nodes.map((n) => (
                                                                                    <option key={n.id} value={n.id}>{n.label}</option>
                                                                                ))}
                                                                            </Select>
                                                                        </label>
                                                                    )}

                                                                    {/* Child delay + value */}
                                                                    <div style={{ display: "grid", gap: 4 }}>
                                                                        <label>
                                                                            <div style={{ fontSize: 11, opacity: 0.8 }}>Delay (s)</div>
                                                                            <Input
                                                                                type="number"
                                                                                step="0.1"
                                                                                value={c.delay ?? 0}
                                                                                onChange={(e) =>
                                                                                    patchChildStep(a.id, i, ci, { delay: Number(e.target.value) || 0 })
                                                                                }
                                                                            />
                                                                        </label>

                                                                        {c.type === "setSignalStyle" && (
                                                                            <label>
                                                                                Value
                                                                                <Select
                                                                                    value={c.value || "waves"}
                                                                                    onChange={(e) => patchChildStep(a.id, i, ci, { value: e.target.value })}
                                                                                >
                                                                                    <option value="waves">waves</option>
                                                                                    <option value="rays">rays</option>
                                                                                    <option value="none">none</option>
                                                                                </Select>
                                                                            </label>
                                                                        )}

                                                                        {cIsWire && (
                                                                            <label>
                                                                                Wireframe
                                                                                <Select
                                                                                    value={c.value || "on"}
                                                                                    onChange={(e) =>
                                                                                        patchChildStep(a.id, i, ci, { value: e.target.value })
                                                                                    }
                                                                                >
                                                                                    <option value="on">On</option>
                                                                                    <option value="off">Off</option>
                                                                                </Select>
                                                                            </label>
                                                                        )}
                                                                        {cIsTextBox && (                               // 👈 NEW
                                                                            <label>
                                                                                Text Box
                                                                                <Select
                                                                                    value={c.value || "on"}
                                                                                    onChange={(e) =>
                                                                                        patchChildStep(a.id, i, ci, { value: e.target.value })
                                                                                    }
                                                                                >
                                                                                    <option value="on">On</option>
                                                                                    <option value="off">Off</option>
                                                                                </Select>
                                                                            </label>
                                                                        )}
                                                                    </div>

                                                                    {/* Child controls */}
                                                                    <div style={{ display: "flex", gap: 4 }}>
                                                                        <Btn onClick={(e) => { e.preventDefault(); moveChildStep(a.id, i, ci, -1); }}>↑</Btn>
                                                                        <Btn onClick={(e) => { e.preventDefault(); moveChildStep(a.id, i, ci, +1); }}>↓</Btn>
                                                                        <Btn onClick={(e) => { e.preventDefault(); delChildStep(a.id, i, ci); }}>✕</Btn>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                {/* Add sub-step button */}
                                                <div style={{ marginTop: 6 }}>
                                                    <Btn
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            addChildStep(a.id, i, { type: "toggleLight", nodeId: null, delay: 0 });
                                                        }}
                                                        style={{ fontSize: 11, padding: "4px 8px" }}
                                                    >
                                                        + Add Sub-step
                                                    </Btn>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Add step button for this action */}
                                    <div style={{ marginTop: 6 }}>
                                        <Btn
                                            onClick={(e) => {
                                                e.preventDefault();
                                                addStep(a.id, { type: "toggleLight", nodeId: null, delay: 0 });
                                            }}
                                        >
                                            + Add Step
                                        </Btn>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Panel>
        );
    };


    return (
        <div style={{ position: "fixed", inset: 0, background: "radial-gradient(1200px 800px at 20% 0%, #15203a, #0b1020)", color: "#fff" }}>
            <ProductManager open={productsOpen} onClose={() => setProductsOpen(false)} />

            {!prodMode && (
                <TopBar
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
            />

            {selectedNode && <RackHUD node={selectedNode} setNodeById={setNodeById} />}
            {selectedNode && <ProductHUD node={selectedNode} />}

            {/* On-screen Actions (Grid Layout layer) */}
            <HudButtonsLayer
                actions={actions}
                setActions={setActions}
                runAction={runAction}
                key={hudVersion}
                uiHidden={prodMode}
                actionsHud={actionsHud}
                setActionsHud={setActionsHud}
            />




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

                    <FloorplanPictures pictures={importedPictures} />

                    <SceneInner
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
                        placement={placement}
                        onPlace={onPlace}
                        showLights={showLights}
                        showLightBounds={showLightBounds}
                        showGround={showGround}
                        roomOpacity={roomOpacity}
                        modelRef={modelRef}
                        animate={animate}
                        dragState={dragState}
                        signalMap={signalMap}
                        bg={bg}
                        missGuardRef={missGuardRef}
                        onNodePointerDown={handleNodeDown}
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
                    {renderNodes.filter((n) => !n.hidden && n.role !== "none").map((n) => (
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
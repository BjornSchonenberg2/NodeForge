// ui/EditorRightPane.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Panel, Btn, Input, Select, Checkbox, Slider } from "./Controls.jsx";
import { DEFAULT_CLUSTERS } from "../utils/clusters.js";
import { OutgoingLinksEditor } from "../Interactive3DNodeShowcase.helpers.hud.jsx";
import { RepresentativePanel } from "../Interactive3DNodeShowcase.helpers.editor.jsx";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ---------------- Light profile clipboard (Copy/Paste) ----------------
// Stored in memory + localStorage so you can copy on one node and paste on another.
const LIGHT_PROFILE_CLIPBOARD_KEY = "epic3d.lightProfileClipboard.v1";
let __lightProfileClipboard = null;

function __deepClone(obj) {
    if (obj == null) return obj;
    try {
        // structuredClone is supported in modern browsers
        // eslint-disable-next-line no-undef
        return structuredClone(obj);
    } catch {
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch {
            return null;
        }
    }
}

function __loadLightProfileClipboard() {
    if (__lightProfileClipboard) return __lightProfileClipboard;
    try {
        const raw = localStorage.getItem(LIGHT_PROFILE_CLIPBOARD_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        __lightProfileClipboard = parsed;
        return parsed;
    } catch {
        return null;
    }
}

function __saveLightProfileClipboard(profile) {
    __lightProfileClipboard = profile ? __deepClone(profile) : null;
    try {
        if (!profile) {
            localStorage.removeItem(LIGHT_PROFILE_CLIPBOARD_KEY);
        } else {
            localStorage.setItem(LIGHT_PROFILE_CLIPBOARD_KEY, JSON.stringify(profile));
        }
    } catch {}
}

function __pickLightProfileFromNode(node) {
    const l = node?.light || {};
    const light = {};
    // Always include type so pasting can create lights on nodes that had none
    light.type = l.type || "none";

    const copyKeys = [
        "enabled",
        "daisyChained",
        "color",
        "autoIntensity",
        "targetLux",
        "intensity",
        "distance",
        "decay",
        "angle",
        "penumbra",
        "aimMode",
        "yaw",
        "pitch",
        "yawPitchBasis",
        "aimDistance",
        "target",
        "pointAt", // legacy alias
        "showBounds",
        "fadeIn",
        "fadeOut",
        "shadowMapSize",
        "shadowBias",
        "shadowNormalBias",
    ];

    for (const k of copyKeys) {
        if (l[k] !== undefined) light[k] = __deepClone(l[k]);
    }

    // Shadows integration (per-node light casting toggle)
    const shadows = node?.shadows || {};
    const profile = {
        __kind: "lightProfile",
        __v: 1,
        light,
        shadows: {
            light: shadows.light ?? true,
        },
    };

    return profile;
}

function __applyLightProfileToNode({ nodeId, profile, setNodeById }) {
    if (!nodeId || !profile || typeof profile !== "object") return;
    const light = profile.light || null;
    const shadowPatch = profile.shadows || null;

    setNodeById(nodeId, (cur) => {
        const next = {};
        if (light) {
            next.light = __deepClone(light);
        }
        if (shadowPatch) {
            next.shadows = { ...(cur.shadows || {}), ...__deepClone(shadowPatch) };
        }
        return next;
    });
}

function __computeDownstreamChain(startId, links, maxHops = 64) {
    if (!startId) return [];
    const chain = [];
    const visited = new Set([startId]);
    let cur = startId;
    for (let i = 0; i < maxHops; i++) {
        const out = (Array.isArray(links) ? links : []).find((l) => l && l.from === cur && l.to);
        if (!out) break;
        const nextId = out.to;
        if (!nextId || visited.has(nextId)) break;
        chain.push(nextId);
        visited.add(nextId);
        cur = nextId;
    }
    return chain;
}


// ---------------- Switch profile clipboard (Copy/Paste) ----------------
const SWITCH_PROFILE_CLIPBOARD_KEY = "epic3d.switchProfileClipboard.v1";
let __switchProfileClipboard = null;

function __loadSwitchProfileClipboard() {
    if (__switchProfileClipboard) return __switchProfileClipboard;
    try {
        const raw = localStorage.getItem(SWITCH_PROFILE_CLIPBOARD_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        __switchProfileClipboard = parsed;
        return parsed;
    } catch {
        return null;
    }
}

function __saveSwitchProfileClipboard(profile) {
    __switchProfileClipboard = profile ? __deepClone(profile) : null;
    try {
        if (!profile) localStorage.removeItem(SWITCH_PROFILE_CLIPBOARD_KEY);
        else localStorage.setItem(SWITCH_PROFILE_CLIPBOARD_KEY, JSON.stringify(profile));
    } catch {}
}

function __pickSwitchProfileFromNode(node) {
    const sw = node?.switch || {};
    const shape = node?.shape || null;
    return {
        __kind: "switchProfile",
        __v: 1,
        kind: "switch",
        shape: shape ? __deepClone(shape) : null,
        switch: __deepClone(sw) || {},
    };
}

function __applySwitchProfileToNode({ nodeId, profile, setNodeById }) {
    if (!nodeId || !profile || typeof profile !== "object") return;
    const sw = profile.switch || {};
    const shape = profile.shape || null;
    setNodeById(nodeId, (cur) => {
        const next = { kind: "switch" };
        if (shape) next.shape = __deepClone(shape);
        next.switch = __deepClone(sw) || {};
        return next;
    });
}

const NumberInput = ({ value, onChange, step = 0.05, min = 0.0 }) => {
    const safeVal =
        typeof value === "number" && !Number.isNaN(value) ? value : min ?? 0;

    return (
        <Input
            type="number"
            step={step}
            value={safeVal}
            onChange={(e) => {
                const raw = Number(e.target.value);
                const v = Number.isNaN(raw) ? min : raw;
                onChange(Math.max(min, v));
            }}
            onWheel={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const dir = e.deltaY < 0 ? 1 : -1;
                const next = Math.max(
                    min,
                    +(safeVal + dir * step).toFixed(3),
                );
                onChange(next);
            }}
        />
    );
};

export default function EditorRightPane({
                                            prodMode,
                                            uiStart,
                                            uiStop,
                                            stopAnchorDefault,
                                            selectedNode,
                                            selectedRoom,
                                            selectedLink,
                                            rooms,
                                            decks,
                                            nodes,
                                            links,
                                            setNode,
                                            setNodeById,
                                            setLightEnabled,
                                            setRoom,
                                            duplicateRoom,
                                            requestDelete,
                                            mode,
                                            setMode,
                                            roomOpacity,
                                            setRoomOpacity,
                                            setLinks,
                                            selectedBreakpoint,
                                            setSelectedBreakpoint,
                                            setLinkFromId,   // 🔹 NEW
                                            multiLinkMode,
                                            setMultiLinkMode,
                                            levelFromNodeId,       // 👈 NEW
                                            setLevelFromNodeId,    // 👈 NEW
                                            levelAxis,             // 👈 NEW
                                            setLevelAxis,          // 👈 NEW
                                            actions,
                                            ActionsPanel,
                                        }) {

    const [paneWidth, setPaneWidth] = useState(() => {
        if (typeof window === "undefined") return 380;
        try {
            const saved = Number(
                localStorage.getItem("epic3d.rightPaneWidth.v1"),
            );
            if (Number.isFinite(saved) && saved >= 320 && saved <= 720) {
                return saved;
            }
        } catch {}
        const vw = window.innerWidth || 1400;
        return clamp(vw * 0.26, 320, 480);
    });

    if (prodMode) return null;


    const handleResizeDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = paneWidth;

        const onMove = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            // Dragging LEFT should make the pane wider, RIGHT narrower
            const dx = startX - ev.clientX;
            const vw = typeof window !== "undefined" ? window.innerWidth : 1400;
            const minW = 320;
            const maxW = Math.min(720, vw - 80);
            const next = clamp(startW + dx, minW, maxW);
            setPaneWidth(next);
            try {
                localStorage.setItem(
                    "epic3d.rightPaneWidth.v1",
                    String(next),
                );
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

    let headerSubtitle = "Select a node, room, or link";
    let typePill = "None";

    if (selectedNode) {
        typePill = selectedNode.kind === "switch" ? "Switch" : "Node";
        headerSubtitle = selectedNode.label || "Unnamed node";
    } else if (selectedRoom) {
        typePill = "Room";
        headerSubtitle = selectedRoom.name || "Room";
    } else if (selectedLink) {
        typePill = "Link";
        headerSubtitle = `${selectedLink.style || "link"} link`;
    }

    const containerStyle = {
        position: "absolute",
        right: 16,
        top: 200,
        bottom: 16,
        zIndex: 20,
        width: paneWidth,
        minWidth: 320,
        maxWidth: 720,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        background:
            "linear-gradient(145deg, rgba(5,16,28,0.96), rgba(15,23,42,0.99))",
        border: "1px solid rgba(148,163,184,0.45)",
        boxShadow:
            "0 18px 45px rgba(15,23,42,0.95), 0 0 0 1px rgba(15,23,42,0.9)",
        overflow: "hidden",
        backdropFilter: "blur(14px) saturate(1.08)",
    };

    const headerStyle = {
        padding: "9px 12px 8px",
        borderBottom: "1px solid rgba(148,163,184,0.5)",
        background:
            "linear-gradient(130deg, rgba(15,23,42,0.98), rgba(56,189,248,0.18))",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    };

    const bodyStyle = {
        flex: 1,
        padding: 10,
        overflowY: "auto",
        display: "grid",
        gap: 10,
    };

    return (
        <div
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
            <div style={headerStyle}>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                    }}
                >
                    <div
                        style={{
                            fontSize: 10,
                            letterSpacing: "0.22em",
                            textTransform: "uppercase",
                            color: "rgba(226,232,240,0.9)",
                            opacity: 0.9,
                        }}
                    >
                        Inspector
                    </div>
                    <div
                        style={{
                            fontSize: 12,
                            color: "#e5e7eb",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            overflow: "hidden",
                            maxWidth: 220,
                        }}
                        title={headerSubtitle}
                    >
                        {headerSubtitle}
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                        style={{
                            padding: "3px 8px",
                            borderRadius: 999,
                            border: "1px solid rgba(148,163,184,0.9)",
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: "0.16em",
                            color: "#cbd5f5",
                            background:
                                "radial-gradient(120px 120px at 0% 0%, rgba(59,130,246,0.28), rgba(15,23,42,1))",
                        }}
                    >
                        {typePill}
                    </div>
                </div>
            </div>

            {/* Scrollable content */}
            <div className="glass-scroll" style={bodyStyle}>
                {!selectedNode && !selectedRoom && !selectedLink && (
                    <Panel title="Inspector">
                        <div style={{ fontSize: 13, opacity: 0.85 }}>
                            Select a node, room, or link in the scene to edit
                            its properties here.
                        </div>
                    </Panel>
                )}

                {selectedNode && (
                    <NodeInspector
                        node={selectedNode}
                        rooms={rooms}
                        decks={decks}
                        nodes={nodes}
                        links={links}
                        setNode={setNode}
                        setNodeById={setNodeById}
                        setLightEnabled={setLightEnabled}
                        setLinks={setLinks}
                        mode={mode}
                        setMode={setMode}
                        requestDelete={requestDelete}
                        selectedBreakpoint={selectedBreakpoint}
                        setSelectedBreakpoint={setSelectedBreakpoint}
                        setLinkFromId={setLinkFromId}   // 🔹 NEW
                        levelFromNodeId={levelFromNodeId}         // 👈 NEW
                        setLevelFromNodeId={setLevelFromNodeId}   // 👈 NEW
                        levelAxis={levelAxis}                     // 👈 NEW
                        setLevelAxis={setLevelAxis}               // 👈 NEW
                        actions={actions}
                        ActionsPanel={ActionsPanel}
                    />
                )}

                {selectedRoom && !selectedNode && (
                    <RoomInspector
                        room={selectedRoom}
                        decks={decks}
                        roomOpacity={roomOpacity}
                        setRoomOpacity={setRoomOpacity}
                        setRoom={setRoom}
                        duplicateRoom={duplicateRoom}
                        requestDelete={requestDelete}
                    />
                )}

                {selectedLink && !selectedNode && !selectedRoom && (
                    <LinkInspector
                        link={selectedLink}
                        setLinks={setLinks}
                        requestDelete={requestDelete}
                    />
                )}
            </div>

            {/* Resize handle (left edge) */}
            <div
                onPointerDown={handleResizeDown}
                style={{
                    position: "absolute",
                    left: -4,
                    top: 0,
                    bottom: 0,
                    width: 8,
                    cursor: "ew-resize",
                    background:
                        "linear-gradient(to right, transparent, rgba(56,189,248,0.3), transparent)",
                    opacity: 0.6,
                }}
            />
        </div>
    );
}

/* ---------- NODE INSPECTOR ---------- */

function NodeInspector({
                           node: n,
                           rooms,
                           decks,
                           nodes,
                           links,
                           setNode,
                           setNodeById,
                           setLightEnabled,
                           setLinks,
                           mode,
                           setMode,
                           requestDelete,
                           selectedBreakpoint,
                           setSelectedBreakpoint,
                           setLinkFromId,   // 🔹 NEW
                           multiLinkMode,
                           setMultiLinkMode,
                           levelFromNodeId,        // 👈 NEW
                           setLevelFromNodeId,     // 👈 NEW
                           levelAxis,              // 👈 NEW
                           setLevelAxis,           // 👈 NEW
                           actions,
                           ActionsPanel,
                       }) {

    const [openMasterId, setOpenMasterId] = useState(null);
    const [lightProfileClipboard, setLightProfileClipboard] = useState(() => __loadLightProfileClipboard());
    const [switchProfileClipboard, setSwitchProfileClipboard] = useState(() => __loadSwitchProfileClipboard());


    // Downstream chain (daisy-chain) starting at this node.
    // Used by “Paste to chain” to speed up applying the same light profile across linked nodes.
    const downstreamChainIds = useMemo(
        () => __computeDownstreamChain(n?.id, links, 96),
        [n?.id, links],
    );

    const canPasteLightProfile = !!(
        lightProfileClipboard &&
        typeof lightProfileClipboard === "object" &&
        lightProfileClipboard.__kind === "lightProfile"
    );

    const copyLightProfile = () => {
        const prof = __pickLightProfileFromNode(n);
        __saveLightProfileClipboard(prof);
        setLightProfileClipboard(prof);
    };

    const pasteLightProfile = (nodeId) => {
        if (!canPasteLightProfile) return;
        __applyLightProfileToNode({ nodeId, profile: lightProfileClipboard, setNodeById });
    };

    const pasteLightProfileToChain = () => {
        if (!canPasteLightProfile) return;
        const ids = Array.isArray(downstreamChainIds) ? downstreamChainIds : [];
        if (!ids.length) return;
        // Apply to linked node(s) and continue down the chain.
        for (const id of ids) {
            pasteLightProfile(id);
        }
    };

    // Keep clipboard in sync if something else updates localStorage.
    useEffect(() => {
        const onStorage = (e) => {
            if (!e) return;
            if (e.key === LIGHT_PROFILE_CLIPBOARD_KEY) {
                setLightProfileClipboard(__loadLightProfileClipboard());
            }
            if (e.key === SWITCH_PROFILE_CLIPBOARD_KEY) {
                setSwitchProfileClipboard(__loadSwitchProfileClipboard());
            }
        };
        window.addEventListener?.("storage", onStorage);
        return () => window.removeEventListener?.("storage", onStorage);
    }, []);
    if (!n) return null;

    // "Master links" = incoming links where this node is the target.
    // This lets you edit flows "vice versa" without hunting for the source node.
    const incomingToThis = Array.isArray(links) ? links.filter((l) => l?.to === n.id) : [];

    const masterGroups = (() => {
        const byFrom = new Map();
        for (const l of incomingToThis) {
            const fromId = l?.from;
            if (!fromId) continue;
            const arr = byFrom.get(fromId) || [];
            arr.push(l);
            byFrom.set(fromId, arr);
        }

        const groups = [];
        for (const [fromId, ls] of byFrom.entries()) {
            const fromNode = nodes?.find((x) => x.id === fromId) || { id: fromId, label: fromId };
            const allowedIds = new Set((ls || []).map((x) => x.id).filter(Boolean));

            // Prevent edits from this embedded editor affecting other links from the master node.
            const setLinksScoped = (updater) => {
                setLinks((prev) => {
                    const next = typeof updater === "function" ? updater(prev) : updater;
                    if (!Array.isArray(next)) return prev;

                    const nextById = new Map(next.map((x) => [x.id, x]));
                    const out = [];

                    for (const x of prev) {
                        const id = x?.id;
                        const isAllowed = !!id && allowedIds.has(id);

                        if (!isAllowed) {
                            out.push(x);
                            continue;
                        }

                        // allow delete within scope
                        if (!nextById.has(id)) continue;

                        out.push(nextById.get(id));
                    }
                    return out;
                });
            };

            // Render only the links that go from master -> this node
            const scopedLinks = (ls || []).slice();

            groups.push({
                fromId,
                fromNode,
                fromLabel: fromNode?.label || fromId,
                links: scopedLinks,
                setLinksScoped,
            });
        }

        // stable order
        groups.sort((a, b) => (a.fromLabel || "").localeCompare(b.fromLabel || ""));
        return groups;
    })();


    return (
        <Panel
            title={n.kind === "switch" ? "Switch Inspector" : "Node Inspector"}
        >
            <div style={{ display: "grid", gap: 8 }}>
                {/* Basics */}
                <label>
                    Name
                    <Input
                        value={n.label}
                        onChange={(e) =>
                            setNode(n.id, { label: e.target.value })
                        }
                    />
                </label>

                <label>
                    Node Type
                    <Select
                        value={(n.kind || "node").toLowerCase()}
                        onChange={(e) => {
                            const kind = String(e.target.value || "node").toLowerCase();
                            if (kind === "switch") {
                                setNodeById(n.id, (cur) => {
                                    const curShape = cur.shape || {};
                                    const shape = (curShape.type || "").toLowerCase() === "switch" ? curShape : { type: "switch", w: 1.1, h: 0.12, d: 0.35 };
                                    const sw = (function ensureSwitch(cfg) {
                                        const c0 = cfg || {};
                                        const raw = c0.buttonsCount ?? (Array.isArray(c0.buttons) ? c0.buttons.length : 2) ?? 2;
                                        const count = Math.max(1, Math.min(12, Math.floor(Number(raw) || 2)));
                                        const out = {
                                            buttonsCount: count,
                                            physical: !!c0.physical,
                                            physicalHeight: Number(c0.physicalHeight ?? 0.028) || 0.028,
                                            margin: Number(c0.margin ?? 0.03) || 0.03,
                                            gap: Number(c0.gap ?? 0.02) || 0.02,
                                            pressDepth: Number(c0.pressDepth ?? 0.014) || 0.014,

                                            // ✅ fluid press animation (same timing in + out) + optional hold
                                            pressAnimMs: Math.max(40, Math.floor(Number(c0.pressAnimMs ?? c0.pressMs ?? 160) || 160)),
                                            pressHoldMs: Math.max(0, Math.floor(Number(c0.pressHoldMs ?? 60) || 60)),

                                            // legacy compatibility
                                            pressMs: Math.max(40, Math.floor(Number(c0.pressMs ?? c0.pressAnimMs ?? 160) || 160)),

                                            textColor: c0.textColor ?? "#e2e8f0",
                                            textScale: Number(c0.textScale ?? 1) || 1,

                                            // ✅ text layout defaults
                                            textRotationDeg: Number(c0.textRotationDeg ?? 0) || 0,
                                            textAlign: c0.textAlign ?? "center",
                                            textOffset: (() => {
                                                const o = c0.textOffset || { x: 0, y: 0 };
                                                if (Array.isArray(o) && o.length >= 2) return { x: Number(o[0]) || 0, y: Number(o[1]) || 0 };
                                                return { x: Number(o?.x) || 0, y: Number(o?.y) || 0 };
                                            })(),

                                            buttonColor: c0.buttonColor ?? "#22314d",
                                            pressedColor: c0.pressedColor ?? "#101a2d",
                                            hoverEmissive: c0.hoverEmissive ?? "#ffffff",

                                            // ✅ defaults for button backlight + text glow
                                            backlight: {
                                                enabled: !!(c0.backlight?.enabled ?? false),
                                                color: c0.backlight?.color ?? "#00b7ff",
                                                pressedColor: c0.backlight?.pressedColor ?? (c0.backlight?.color ?? "#00b7ff"),
                                                intensity: Number(c0.backlight?.intensity ?? 1.6) || 1.6,
                                                opacity: Number(c0.backlight?.opacity ?? 0.35) || 0.35,
                                                padding: Number(c0.backlight?.padding ?? 0.012) || 0.012,
                                            },
                                            textGlow: {
                                                enabled: !!(c0.textGlow?.enabled ?? false),
                                                color: c0.textGlow?.color ?? "#ffffff",
                                                pressedColor: c0.textGlow?.pressedColor ?? (c0.textGlow?.color ?? "#ffffff"),
                                                intensity: Number(c0.textGlow?.intensity ?? 1) || 1,
                                                outlineWidth: Number(c0.textGlow?.outlineWidth ?? 0.02) || 0.02,
                                                outlineOpacity: Number(c0.textGlow?.outlineOpacity ?? 0.8) || 0.8,
                                            },

                                            buttons: Array.isArray(c0.buttons) ? c0.buttons.slice(0, count) : [],
                                        };
                                        while (out.buttons.length < count) out.buttons.push({ name: `Btn ${out.buttons.length + 1}`, actionIds: [] });
                                        out.buttons = out.buttons.map((b, i) => ({
                                            ...b,
                                            name: b?.name ?? b?.label ?? `Btn ${i + 1}`,
                                            color: b?.color,
                                            pressedColor: b?.pressedColor,
                                            textColor: b?.textColor,
                                            textScale: b?.textScale,
                                            textRotationDeg: b?.textRotationDeg,
                                            textAlign: b?.textAlign,
                                            textOffset: b?.textOffset,
                                            backlight: b?.backlight,
                                            textGlow: b?.textGlow,
                                            actionIds: Array.isArray(b?.actionIds) ? b.actionIds : [],
                                        }));
                                        return out;
                                    })(cur.switch || {});
                                    return { kind: "switch", shape, switch: sw };
                                });
                            } else {
                                setNode(n.id, { kind: "node" });
                            }
                        }}
                    >
                        <option value="node">Node</option>
                        <option value="switch">Switch</option>
                    </Select>
                </label>


                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-start",
                        gap: 8,
                        flexWrap: "wrap",
                        marginTop: 0,
                        marginBottom: 8,
                    }}
                >
                    {/* Link toggle, starting from this node */}
                    <Btn
                        onClick={() => {
                            if (mode === "link") {
                                // Turn link mode OFF
                                setMode("select");
                                setLinkFromId?.(null);
                                setMultiLinkMode?.(false);
                            } else {
                                // Turn link mode ON and start from this node
                                setMode("link");
                                setLinkFromId?.(n.id);
                            }
                            // Link button implies single-link mode
                            setMultiLinkMode?.(false);
                            // Whenever we toggle link mode, cancel leveling
                            setLevelFromNodeId?.(null);
                        }}
                        glow={mode === "link"}
                    >
                        {mode === "link" ? "Link: ON" : "Link: OFF"}
                    </Btn>

                    <Btn
                        onClick={() => {
                            const next = !(multiLinkMode && mode === "link");
                            // Turn multi-link ON: enter link mode from this node
                            if (next) {
                                setMode("link");
                                setLinkFromId?.(n.id);
                            } else {
                                // Turn multi-link OFF: exit link mode
                                setMode("select");
                                setLinkFromId?.(null);
                            }
                            setMultiLinkMode?.(next);
                            // Cancel leveling when using linking
                            setLevelFromNodeId?.(null);
                        }}
                        glow={!!multiLinkMode && mode === "link"}
                    >
                        {multiLinkMode && mode === "link" ? "Multi Link: ON" : "Multi Link"}
                    </Btn>


                    {/* Align axis buttons (pick master → click target) */}
                    <Btn
                        onClick={() => {
                            // Always be in normal select mode for align
                            setMode("select");
                            setLinkFromId?.(null);

                            const ax = (levelAxis || "y").toLowerCase();
                            const active = levelFromNodeId === n.id && ax === "x";
                            if (active) {
                                setLevelFromNodeId?.(null);
                                return;
                            }
                            setLevelAxis?.("x");
                            setLevelFromNodeId?.(n.id);
                        }}
                        glow={levelFromNodeId === n.id && (levelAxis || "y").toLowerCase() === "x"}
                    >
                        {levelFromNodeId === n.id && (levelAxis || "y").toLowerCase() === "x"
                            ? "Align X (pick…)"
                            : "Align X"}
                    </Btn>

                    <Btn
                        onClick={() => {
                            setMode("select");
                            setLinkFromId?.(null);

                            const ax = (levelAxis || "y").toLowerCase();
                            const active = levelFromNodeId === n.id && ax === "y";
                            if (active) {
                                setLevelFromNodeId?.(null);
                                return;
                            }
                            setLevelAxis?.("y");
                            setLevelFromNodeId?.(n.id);
                        }}
                        glow={levelFromNodeId === n.id && (levelAxis || "y").toLowerCase() === "y"}
                    >
                        {levelFromNodeId === n.id && (levelAxis || "y").toLowerCase() === "y"
                            ? "Align Y (pick…)"
                            : "Align Y"}
                    </Btn>

                    <Btn
                        onClick={() => {
                            setMode("select");
                            setLinkFromId?.(null);

                            const ax = (levelAxis || "y").toLowerCase();
                            const active = levelFromNodeId === n.id && ax === "z";
                            if (active) {
                                setLevelFromNodeId?.(null);
                                return;
                            }
                            setLevelAxis?.("z");
                            setLevelFromNodeId?.(n.id);
                        }}
                        glow={levelFromNodeId === n.id && (levelAxis || "y").toLowerCase() === "z"}
                    >
                        {levelFromNodeId === n.id && (levelAxis || "y").toLowerCase() === "z"
                            ? "Align Z (pick…)"
                            : "Align Z"}
                    </Btn>

                    {/* Delete node */}
                    <Btn
                        onClick={() =>
                            requestDelete({
                                type: "node",
                                id: n.id,
                            })
                        }
                    >
                        Delete
                    </Btn>
                </div>


                <label
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                    <input
                        type="checkbox"
                        checked={!!n.hiddenMesh}
                        onChange={(e) =>
                            setNode(n.id, { hiddenMesh: e.target.checked })
                        }
                    />
                    <span>Hide Node Mesh (keep links/animations)</span>
                </label>

                <label>
                    Label Scale
                    <input
                        type="range"
                        min={0.5}
                        max={13}
                        step={0.01}
                        value={n.labelScale ?? 1}
                        onChange={(e) =>
                            setNode(n.id, {
                                labelScale: Number(e.target.value),
                            })
                        }
                    />
                </label>

                {/* Label appearance */}
                <div style={{ marginTop: 10, fontWeight: 700 }}>Label</div>

                <label style={{ display: "block" }}>
                    Label Text Color
                    <input
                        type="color"
                        value={n.labelColor ?? "#ffffff"}
                        onChange={(e) =>
                            setNode(n.id, { labelColor: e.target.value })
                        }
                    />
                </label>

                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 6,
                    }}
                >
                    <input
                        type="checkbox"
                        checked={!!n.labelOutline}
                        onChange={(e) =>
                            setNode(n.id, { labelOutline: e.target.checked })
                        }
                    />
                    <span>Outline</span>
                </label>

                {n.labelOutline && (
                    <>
                        <label
                            style={{ display: "block", marginTop: 6 }}
                        >
                            Outline Color
                            <input
                                type="color"
                                value={n.labelOutlineColor ?? "#000000"}
                                onChange={(e) =>
                                    setNode(n.id, {
                                        labelOutlineColor: e.target.value,
                                    })
                                }
                            />
                        </label>

                        <label
                            style={{ display: "block", marginTop: 6 }}
                        >
                            Outline Width
                            <input
                                type="range"
                                min={0}
                                max={0.1}
                                step={0.001}
                                value={n.labelOutlineWidth ?? 0.02}
                                onChange={(e) =>
                                    setNode(n.id, {
                                        labelOutlineWidth: Number(
                                            e.target.value,
                                        ),
                                    })
                                }
                            />
                        </label>
                    </>
                )}

                {/* Text Box */}
                <fieldset
                    style={{
                        marginTop: 10,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.18)",
                    }}
                >
                    <legend style={{ opacity: 0.8 }}>Text Box</legend>

                    <div style={{ display: "grid", gap: 8 }}>
                        <Checkbox
                            checked={n.textBox?.enabled ?? false}
                            onChange={(v) =>
                                setNode(n.id, {
                                    textBox: {
                                        ...(n.textBox || {}),
                                        enabled: v,
                                    },
                                })
                            }
                            label="Enable text box"
                        />

                        {n.textBox?.enabled && (
                            <>
                                {/* Text content */}
                                <label>
                                    Text
                                    <textarea
                                        value={n.textBox?.text || ""}
                                        onChange={(e) =>
                                            setNode(n.id, {
                                                textBox: {
                                                    ...(n.textBox || {}),
                                                    text: e.target.value,
                                                },
                                            })
                                        }
                                        style={{
                                            width: "100%",
                                            minHeight: 80,
                                            resize: "vertical",
                                            borderRadius: 8,
                                            border: "1px solid rgba(255,255,255,0.18)",
                                            background: "rgba(2,10,24,0.9)",
                                            color: "#fff",
                                            padding: 6,
                                            fontSize: 12,
                                        }}
                                    />
                                </label>

                                {/* TIMER MODE TOGGLE */}
                                <Checkbox
                                    checked={!!n.textBox?.useTimers}
                                    onChange={(v) =>
                                        setNode(n.id, {
                                            textBox: {
                                                ...(n.textBox || {}),
                                                useTimers: v,
                                            },
                                        })
                                    }
                                    label="Use timers (auto fade in / hold / fade out)"
                                />

                                {/* Timings (in seconds) */}
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns:
                                            "repeat(3, 1fr)",
                                        gap: 8,
                                    }}
                                >
                                    <label>
                                        Fade In (s)
                                        <NumberInput
                                            value={n.textBox?.fadeIn ?? 0}
                                            step={0.1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox || {}),
                                                        fadeIn:
                                                            Number(v || 0),
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Hold (s)
                                        <NumberInput
                                            value={n.textBox?.hold ?? 0}
                                            step={0.1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox || {}),
                                                        hold:
                                                            Number(v || 0),
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Fade Out (s)
                                        <NumberInput
                                            value={n.textBox?.fadeOut ?? 0}
                                            step={0.1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox || {}),
                                                        fadeOut:
                                                            Number(v || 0),
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </div>

                                {/* Size */}
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns:
                                            "repeat(2, 1fr)",
                                        gap: 8,
                                    }}
                                >
                                    <label>
                                        Width
                                        <NumberInput
                                            value={n.textBox?.width ?? 1.6}
                                            step={0.1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox || {}),
                                                        width:
                                                            Number(v || 0),
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Height
                                        <NumberInput
                                            value={n.textBox?.height ?? 0.8}
                                            step={0.1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox || {}),
                                                        height:
                                                            Number(v || 0),
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </div>

                                <label>
                                    Font Size
                                    <NumberInput
                                        value={n.textBox?.fontSize ?? 0.18}
                                        step={0.02}
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                textBox: {
                                                    ...(n.textBox || {}),
                                                    fontSize:
                                                        Number(v || 0),
                                                },
                                            })
                                        }
                                    />
                                </label>

                                {/* Colors */}
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns:
                                            "repeat(2, 1fr)",
                                        gap: 8,
                                    }}
                                >
                                    <label>
                                        Text Color
                                        <Input
                                            type="color"
                                            value={
                                                n.textBox?.color ??
                                                n.textBox?.textColor ??
                                                "#ffffff"
                                            }
                                            onChange={(e) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox ||
                                                            {}),
                                                        color:
                                                        e.target
                                                            .value,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Background
                                        <Input
                                            type="color"
                                            value={
                                                n.textBox?.bgColor ??
                                                n.textBox
                                                    ?.backgroundColor ??
                                                "#000000"
                                            }
                                            onChange={(e) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox ||
                                                            {}),
                                                        bgColor:
                                                        e.target
                                                            .value,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </div>

                                {/* Background opacity */}
                                <label>
                                    Background Opacity
                                    <NumberInput
                                        min={0}
                                        step={0.05}
                                        value={
                                            n.textBox?.bgOpacity ??
                                            n.textBox
                                                ?.backgroundOpacity ??
                                            0.7
                                        }
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                textBox: {
                                                    ...(n.textBox || {}),
                                                    bgOpacity:
                                                        Number(
                                                            v ?? 0.7,
                                                        ),
                                                },
                                            })
                                        }
                                    />
                                </label>

                                {/* Mode + test timed fade */}
                                <div
                                    style={{
                                        display: "flex",
                                        gap: 8,
                                        alignItems: "center",
                                        marginTop: 4,
                                    }}
                                >
                                    <label style={{ flex: 1 }}>
                                        Mode
                                        <Select
                                            value={
                                                n.textBox?.mode ||
                                                "billboard"
                                            }
                                            onChange={(e) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox ||
                                                            {}),
                                                        mode: e.target
                                                            .value,
                                                    },
                                                })
                                            }
                                        >
                                            <option value="billboard">
                                                Billboard
                                            </option>
                                            <option value="3d">3D</option>
                                            <option value="hud">HUD</option>
                                        </Select>
                                    </label>
                                    <Btn
                                        onClick={(e) => {
                                            e.preventDefault();
                                            const tb = n.textBox || {};
                                            setNode(n.id, {
                                                textBox: {
                                                    ...tb,
                                                    enabled: true,
                                                    useTimers: true,
                                                    autoTriggerId:
                                                        (tb.autoTriggerId ||
                                                            0) + 1,
                                                },
                                            });
                                        }}
                                    >
                                        ▶ Test Timed Fade
                                    </Btn>
                                </div>
                            </>
                        )}
                    </div>
                </fieldset>

                {/* Indicator */}
                <fieldset
                    style={{
                        border: "1px dashed rgba(255,255,255,0.15)",
                        padding: 8,
                        borderRadius: 8,
                    }}
                >
                    <legend style={{ opacity: 0.8 }}>Indicator</legend>
                    <label
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={!!n.indicator?.enabled}
                            onChange={(e) =>
                                setNode(n.id, {
                                    indicator: {
                                        ...(n.indicator || {}),
                                        enabled: e.target.checked,
                                    },
                                })
                            }
                        />
                        <span>Enable</span>
                    </label>
                    <label>
                        Color
                        <input
                            type="color"
                            value={n.indicator?.color ?? "#7cf"}
                            onChange={(e) =>
                                setNode(n.id, {
                                    indicator: {
                                        ...(n.indicator || {}),
                                        color: e.target.value,
                                    },
                                })
                            }
                        />
                    </label>
                    <label>
                        Inner Radius
                        <input
                            type="range"
                            min={0.05}
                            max={1}
                            step={0.01}
                            value={n.indicator?.inner ?? 0.18}
                            onChange={(e) =>
                                setNode(n.id, {
                                    indicator: {
                                        ...(n.indicator || {}),
                                        inner: Number(e.target.value),
                                    },
                                })
                            }
                        />
                    </label>
                    <label>
                        Outer Radius
                        <input
                            type="range"
                            min={0.06}
                            max={1.2}
                            step={0.01}
                            value={n.indicator?.outer ?? 0.22}
                            onChange={(e) =>
                                setNode(n.id, {
                                    indicator: {
                                        ...(n.indicator || {}),
                                        outer: Number(e.target.value),
                                    },
                                })
                            }
                        />
                    </label>
                </fieldset>

                {/* Role / cluster / appearance */}
                <label>
                    Role
                    <Select
                        value={n.role || "none"}
                        onChange={(e) =>
                            setNode(n.id, { role: e.target.value })
                        }
                    >
                        <option value="none">none</option>
                        <option value="sender">sender</option>
                        <option value="receiver">receiver</option>
                        <option value="bidir">bidir</option>
                    </Select>
                </label>

                <label>
                    Cluster
                    <Select
                        value={n.cluster}
                        onChange={(e) =>
                            setNode(n.id, { cluster: e.target.value })
                        }
                    >
                        {DEFAULT_CLUSTERS.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </Select>
                </label>

                <label>
                    Color
                    <Input
                        type="color"
                        value={n.color || "#ffffff"}
                        onChange={(e) =>
                            setNode(n.id, { color: e.target.value })
                        }
                    />
                </label>

                <label>
                    Room
                    <Select
                        value={n.roomId || ""}
                        onChange={(e) =>
                            setNode(n.id, {
                                roomId: e.target.value || undefined,
                            })
                        }
                    >
                        <option value="">No room</option>
                        {rooms.map((rr) => (
                            <option key={rr.id} value={rr.id}>
                                {rr.name}
                            </option>
                        ))}
                    </Select>
                </label>

                <label>
                    Deck
                    <Select
                        value={n.deckId || ""}
                        onChange={(e) =>
                            setNode(n.id, {
                                deckId: e.target.value || undefined,
                            })
                        }
                    >
                        <option value="">No deck</option>
                        {decks.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.name}
                            </option>
                        ))}
                    </Select>
                </label>

                {/* Transform */}
                <label>
                    Position (x,y,z)
                    <Input
                        value={(n.position || [0, 0, 0]).join(", ")}
                        onChange={(e) => {
                            const parts = e.target.value
                                .split(",")
                                .map((v) => Number(v.trim()));
                            if (
                                parts.length === 3 &&
                                parts.every((v) => !Number.isNaN(v))
                            )
                                setNode(n.id, { position: parts });
                        }}
                    />
                </label>

                <label>
                    Rotation (x,y,z radians)
                    <Input
                        value={(n.rotation || [0, 0, 0])
                            .map((v) => +v.toFixed(3))
                            .join(", ")}
                        onChange={(e) => {
                            const parts = e.target.value
                                .split(",")
                                .map((v) => Number(v.trim()));
                            if (
                                parts.length === 3 &&
                                parts.every((v) => !Number.isNaN(v))
                            )
                                setNode(n.id, { rotation: parts });
                        }}
                    />
                </label>

                {/* Shape & size */}
                {(() => {
                    const shape = n.shape || {
                        type: "sphere",
                        radius: 0.32,
                    };
                    const setShape = (patch) =>
                        setNode(n.id, {
                            shape: { ...shape, ...patch },
                        });

                    const setShapeType = (type) => {
                        const defaults = {
                            sphere: { type: "sphere", radius: 0.32 },
                            box: {
                                type: "box",
                                scale: [0.6, 0.3, 0.6],
                            },
                            square: {
                                type: "square",
                                scale: [0.6, 0.3, 0.6],
                            },
                            disc: {
                                type: "disc",
                                radius: 0.35,
                                height: 0.08,
                            },
                            circle: {
                                type: "circle",
                                radius: 0.35,
                                height: 0.08,
                            },
                            cylinder: {
                                type: "cylinder",
                                radius: 0.3,
                                height: 0.6,
                            },
                            hexagon: {
                                type: "hexagon",
                                radius: 0.35,
                                height: 0.5,
                            },
                            cone: {
                                type: "cone",
                                radius: 0.35,
                                height: 0.7,
                            },
                            switch: {
                                type: "switch",
                                w: 0.9,
                                h: 0.12,
                                d: 0.35,
                            },
                        };
                        setNode(n.id, {
                            shape: defaults[type] || { type },
                        });
                    };

                    return (
                        <>
                            <div
                                style={{
                                    borderTop:
                                        "1px dashed rgba(255,255,255,0.15)",
                                    paddingTop: 8,
                                    marginTop: 8,
                                }}
                            >
                                <div
                                    style={{
                                        fontWeight: 900,
                                        marginBottom: 6,
                                    }}
                                >
                                    Shape
                                </div>
                                <Select
                                    value={
                                        (shape.type || "sphere").toLowerCase()
                                    }
                                    onChange={(e) =>
                                        setShapeType(e.target.value)
                                    }
                                >
                                    <option value="sphere">Sphere</option>
                                    <option value="square">
                                        Square (Box)
                                    </option>
                                    <option value="disc">
                                        Circle (Disc)
                                    </option>
                                    <option value="cylinder">
                                        Cylinder
                                    </option>
                                    <option value="hexagon">
                                        Hexagon
                                    </option>
                                    <option value="cone">Cone</option>
                                    <option value="switch">Switch</option>
                                </Select>
                            </div>

                            {/* Per-shape size controls */}
                            {["sphere"].includes(shape.type) && (
                                <label>
                                    Radius
                                    <NumberInput
                                        value={shape.radius ?? 0.32}
                                        step={0.02}
                                        onChange={(v) =>
                                            setShape({ radius: v })
                                        }
                                    />
                                </label>
                            )}

                            {["box", "square"].includes(shape.type) && (
                                <div>
                                    <div
                                        style={{
                                            fontSize: 12,
                                            opacity: 0.85,
                                            marginBottom: 4,
                                        }}
                                    >
                                        Scale (x,y,z)
                                    </div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns:
                                                "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            X
                                            <NumberInput
                                                value={
                                                    shape.scale?.[0] ?? 0.6
                                                }
                                                onChange={(v) =>
                                                    setShape({
                                                        scale: [
                                                            v,
                                                            shape
                                                                .scale?.[1] ??
                                                            0.3,
                                                            shape
                                                                .scale?.[2] ??
                                                            0.6,
                                                        ],
                                                    })
                                                }
                                                step={0.05}
                                            />
                                        </label>
                                        <label>
                                            Y
                                            <NumberInput
                                                value={
                                                    shape.scale?.[1] ?? 0.3
                                                }
                                                onChange={(v) =>
                                                    setShape({
                                                        scale: [
                                                            shape
                                                                .scale?.[0] ??
                                                            0.6,
                                                            v,
                                                            shape
                                                                .scale?.[2] ??
                                                            0.6,
                                                        ],
                                                    })
                                                }
                                                step={0.05}
                                            />
                                        </label>
                                        <label>
                                            Z
                                            <NumberInput
                                                value={
                                                    shape.scale?.[2] ?? 0.6
                                                }
                                                onChange={(v) =>
                                                    setShape({
                                                        scale: [
                                                            shape
                                                                .scale?.[0] ??
                                                            0.6,
                                                            shape
                                                                .scale?.[1] ??
                                                            0.3,
                                                            v,
                                                        ],
                                                    })
                                                }
                                                step={0.05}
                                            />
                                        </label>
                                    </div>
                                </div>
                            )}

                            {[
                                "disc",
                                "circle",
                                "cylinder",
                                "hexagon",
                                "cone",
                            ].includes(shape.type) && (
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns:
                                            "1fr 1fr",
                                        gap: 8,
                                    }}
                                >
                                    <label>
                                        Radius
                                        <NumberInput
                                            value={shape.radius ?? 0.35}
                                            step={0.02}
                                            onChange={(v) =>
                                                setShape({ radius: v })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Height
                                        <NumberInput
                                            value={
                                                shape.height ??
                                                (shape.type === "disc" ||
                                                shape.type === "circle"
                                                    ? 0.08
                                                    : 0.6)
                                            }
                                            step={0.02}
                                            onChange={(v) =>
                                                setShape({ height: v })
                                            }
                                        />
                                    </label>
                                </div>
                            )}

                            {shape.type === "switch" && (
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns:
                                            "1fr 1fr 1fr",
                                        gap: 8,
                                    }}
                                >
                                    <label>
                                        W
                                        <NumberInput
                                            value={shape.w ?? 0.9}
                                            step={0.02}
                                            onChange={(v) =>
                                                setShape({ w: v })
                                            }
                                        />
                                    </label>
                                    <label>
                                        H
                                        <NumberInput
                                            value={shape.h ?? 0.12}
                                            step={0.02}
                                            onChange={(v) =>
                                                setShape({ h: v })
                                            }
                                        />
                                    </label>
                                    <label>
                                        D
                                        <NumberInput
                                            value={shape.d ?? 0.35}
                                            step={0.02}
                                            onChange={(v) =>
                                                setShape({ d: v })
                                            }
                                        />
                                    </label>
                                </div>
                            )}
                        </>
                    );
                })()}

                <RepresentativePanel
                    node={n}
                    setNodeById={setNodeById}
                />

                {/* Switch */}
                {((n.kind || "node") === "switch") && (() => {
                    const ensureSwitch = (cfg, countOverride) => {
                        const c0 = cfg || {};
                        const raw = countOverride ?? c0.buttonsCount ?? (Array.isArray(c0.buttons) ? c0.buttons.length : 2) ?? 2;
                        const count = Math.max(1, Math.min(12, Math.floor(Number(raw) || 2)));
                        const out = {
                            buttonsCount: count,
                            physical: !!c0.physical,
                            physicalHeight: Number(c0.physicalHeight ?? 0.028) || 0.028,
                            margin: Number(c0.margin ?? 0.03) || 0.03,
                            gap: Number(c0.gap ?? 0.02) || 0.02,
                            pressDepth: Number(c0.pressDepth ?? 0.014) || 0.014,

                            // ✅ fluid press animation (same timing in + out) + optional hold
                            pressAnimMs: Math.max(40, Math.floor(Number(c0.pressAnimMs ?? c0.pressMs ?? 160) || 160)),
                            pressHoldMs: Math.max(0, Math.floor(Number(c0.pressHoldMs ?? 60) || 60)),

                            // legacy compatibility
                            pressMs: Math.max(40, Math.floor(Number(c0.pressMs ?? c0.pressAnimMs ?? 160) || 160)),

                            textColor: c0.textColor ?? "#e2e8f0",
                            textScale: Number(c0.textScale ?? 1) || 1,

                            // ✅ text layout defaults
                            textRotationDeg: Number(c0.textRotationDeg ?? 0) || 0,
                            textAlign: c0.textAlign ?? "center",
                            textOffset: (() => {
                                const o = c0.textOffset || { x: 0, y: 0 };
                                if (Array.isArray(o) && o.length >= 2) return { x: Number(o[0]) || 0, y: Number(o[1]) || 0 };
                                return { x: Number(o?.x) || 0, y: Number(o?.y) || 0 };
                            })(),

                            buttonColor: c0.buttonColor ?? "#22314d",
                            pressedColor: c0.pressedColor ?? "#101a2d",
                            hoverEmissive: c0.hoverEmissive ?? "#ffffff",

                            // ✅ defaults for button backlight + text glow
                            backlight: {
                                enabled: !!(c0.backlight?.enabled ?? false),
                                color: c0.backlight?.color ?? "#00b7ff",
                                pressedColor: c0.backlight?.pressedColor ?? (c0.backlight?.color ?? "#00b7ff"),
                                intensity: Number(c0.backlight?.intensity ?? 1.6) || 1.6,
                                opacity: Number(c0.backlight?.opacity ?? 0.35) || 0.35,
                                padding: Number(c0.backlight?.padding ?? 0.012) || 0.012,
                            },
                            textGlow: {
                                enabled: !!(c0.textGlow?.enabled ?? false),
                                color: c0.textGlow?.color ?? "#ffffff",
                                pressedColor: c0.textGlow?.pressedColor ?? (c0.textGlow?.color ?? "#ffffff"),
                                intensity: Number(c0.textGlow?.intensity ?? 1) || 1,
                                outlineWidth: Number(c0.textGlow?.outlineWidth ?? 0.02) || 0.02,
                                outlineOpacity: Number(c0.textGlow?.outlineOpacity ?? 0.8) || 0.8,
                            },

                            buttons: Array.isArray(c0.buttons) ? c0.buttons.slice(0, count) : [],
                        };
                        while (out.buttons.length < count) out.buttons.push({ name: `Btn ${out.buttons.length + 1}`, actionIds: [] });
                        out.buttons = out.buttons.map((b, i) => ({
                            ...b,
                            name: b?.name ?? b?.label ?? `Btn ${i + 1}`,
                            color: b?.color,
                            pressedColor: b?.pressedColor,
                            textColor: b?.textColor,
                            textScale: b?.textScale,
                            textRotationDeg: b?.textRotationDeg,
                            textAlign: b?.textAlign,
                            textOffset: b?.textOffset,
                            backlight: b?.backlight,
                            textGlow: b?.textGlow,
                            actionIds: Array.isArray(b?.actionIds) ? b.actionIds : [],
                        }));
                        return out;
                    };

                    const sw0 = ensureSwitch(n.switch || {}, null);
                    const canPasteSwitchProfile = !!(switchProfileClipboard && switchProfileClipboard.__kind === "switchProfile");

                    const copySwitchProfile = () => {
                        const prof = __pickSwitchProfileFromNode(n);
                        __saveSwitchProfileClipboard(prof);
                        setSwitchProfileClipboard(prof);
                    };

                    const pasteSwitchProfile = () => {
                        if (!canPasteSwitchProfile) return;
                        __applySwitchProfileToNode({ nodeId: n.id, profile: switchProfileClipboard, setNodeById });
                    };

                    const setSwitch = (patchOrFn) => {
                        setNodeById(n.id, (cur) => {
                            const base = ensureSwitch(cur.switch || {}, null);
                            const patch = typeof patchOrFn === "function" ? patchOrFn(base) : patchOrFn;
                            return { switch: { ...base, ...(patch || {}) } };
                        });
                    };

                    const setButton = (idx, patch) => {
                        setSwitch((base) => {
                            const btns = (base.buttons || []).slice();
                            const curB = btns[idx] || { name: `Btn ${idx + 1}`, actionIds: [] };
                            btns[idx] = { ...curB, ...(patch || {}) };
                            return { buttons: btns };
                        });
                    };

                    const toggleButtonAction = (idx, actionId, on) => {
                        setButton(idx, {
                            actionIds: (() => {
                                const cur = (sw0.buttons[idx]?.actionIds || []).slice();
                                const has = cur.includes(actionId);
                                if (on && !has) cur.push(actionId);
                                if (!on && has) return cur.filter((x) => x !== actionId);
                                return cur;
                            })(),
                        });
                    };

                    return (
                        <div
                            style={{
                                borderTop: "1px dashed rgba(255,255,255,0.15)",
                                paddingTop: 8,
                                marginTop: 8,
                            }}
                        >
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Switch</div>

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}
                            >
                                <Btn onClick={copySwitchProfile} style={{ padding: "8px 10px" }} title="Copy this switch button layout + styles + actions">
                                    Copy profile
                                </Btn>
                                <Btn disabled={!canPasteSwitchProfile} onClick={pasteSwitchProfile} style={{ padding: "8px 10px" }} title="Paste the copied switch profile onto this node">
                                    Paste profile
                                </Btn>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "end" }}>
                                <label>
                                    Buttons
                                    <NumberInput
                                        value={sw0.buttonsCount}
                                        step={1}
                                        min={1}
                                        onChange={(v) => {
                                            const cnt = Math.max(1, Math.min(12, Math.floor(Number(v) || 1)));
                                            setSwitch((base) => ensureSwitch(base, cnt));
                                        }}
                                    />
                                </label>
                                <div style={{ display: "grid", gap: 6 }}>
                                    <Checkbox
                                        checked={!!sw0.physical}
                                        onChange={(v) => setSwitch({ physical: v })}
                                        label="physical buttons (3D)"
                                    />
                                </div>
                            </div>

                            {sw0.physical && (
                                <label>
                                    Physical height
                                    <NumberInput
                                        value={sw0.physicalHeight}
                                        step={0.002}
                                        min={0.001}
                                        onChange={(v) => setSwitch({ physicalHeight: v })}
                                    />
                                </label>
                            )}

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                <label>
                                    Margin
                                    <NumberInput
                                        value={sw0.margin}
                                        step={0.005}
                                        min={0}
                                        onChange={(v) => setSwitch({ margin: v })}
                                    />
                                </label>
                                <label>
                                    Gap
                                    <NumberInput
                                        value={sw0.gap}
                                        step={0.005}
                                        min={0}
                                        onChange={(v) => setSwitch({ gap: v })}
                                    />
                                </label>
                                <label>
                                    Press depth
                                    <NumberInput
                                        value={sw0.pressDepth}
                                        step={0.002}
                                        min={0}
                                        onChange={(v) => setSwitch({ pressDepth: v })}
                                    />
                                </label>
                                <label>
                                    Press anim (ms)
                                    <NumberInput
                                        value={sw0.pressAnimMs ?? sw0.pressMs}
                                        step={10}
                                        min={40}
                                        onChange={(v) => setSwitch({ pressAnimMs: v, pressMs: v })}
                                    />
                                </label>
                                <label>
                                    Hold (ms)
                                    <NumberInput
                                        value={sw0.pressHoldMs ?? 60}
                                        step={10}
                                        min={0}
                                        onChange={(v) => setSwitch({ pressHoldMs: v })}
                                    />
                                </label>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                                <label>
                                    Default button
                                    <Input
                                        type="color"
                                        value={sw0.buttonColor || "#22314d"}
                                        onChange={(e) => setSwitch({ buttonColor: e.target.value })}
                                    />
                                </label>
                                <label>
                                    Pressed
                                    <Input
                                        type="color"
                                        value={sw0.pressedColor || "#101a2d"}
                                        onChange={(e) => setSwitch({ pressedColor: e.target.value })}
                                    />
                                </label>
                                <label>
                                    Text color
                                    <Input
                                        type="color"
                                        value={sw0.textColor || "#e2e8f0"}
                                        onChange={(e) => setSwitch({ textColor: e.target.value })}
                                    />
                                </label>
                                <label>
                                    Text scale
                                    <NumberInput
                                        value={sw0.textScale ?? 1}
                                        step={0.05}
                                        min={0.2}
                                        onChange={(v) => setSwitch({ textScale: v })}
                                    />
                                </label>


                                <div style={{
                                    marginTop: 10,
                                    padding: 10,
                                    borderRadius: 12,
                                    background: "rgba(255,255,255,0.04)",
                                    border: "1px solid rgba(255,255,255,0.08)"
                                }}>
                                    <div style={{ fontWeight: 900, marginBottom: 8 }}>Text layout defaults</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Rotation (deg)
                                            <NumberInput
                                                value={sw0.textRotationDeg ?? 0}
                                                step={5}
                                                onChange={(v) => setSwitch({ textRotationDeg: v })}
                                            />
                                        </label>
                                        <label>
                                            Align
                                            <Select
                                                value={sw0.textAlign ?? "center"}
                                                onChange={(e) => setSwitch({ textAlign: e.target.value })}
                                            >
                                                <option value="left">Left</option>
                                                <option value="center">Center</option>
                                                <option value="right">Right</option>
                                            </Select>
                                        </label>
                                        <label>
                                            Offset X
                                            <NumberInput
                                                value={(sw0.textOffset?.x ?? 0)}
                                                step={0.005}
                                                onChange={(v) => setSwitch((cur) => ({ textOffset: { ...(cur.textOffset || { x: 0, y: 0 }), x: v } }))}
                                            />
                                        </label>
                                        <label>
                                            Offset Y
                                            <NumberInput
                                                value={(sw0.textOffset?.y ?? 0)}
                                                step={0.005}
                                                onChange={(v) => setSwitch((cur) => ({ textOffset: { ...(cur.textOffset || { x: 0, y: 0 }), y: v } }))}
                                            />
                                        </label>
                                    </div>
                                </div>

                                <details style={{ marginTop: 8 }}>
                                    <summary style={{ cursor: "pointer", fontWeight: 900 }}>Backlight defaults</summary>
                                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                                        <Checkbox
                                            checked={!!sw0.backlight?.enabled}
                                            onChange={(on) => setSwitch((cur) => ({ backlight: { ...(cur.backlight || {}), enabled: on } }))}
                                            label="Enabled"
                                        />
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                            <label>
                                                Color
                                                <Input
                                                    type="color"
                                                    value={sw0.backlight?.color ?? "#00b7ff"}
                                                    onChange={(e) => setSwitch((cur) => ({ backlight: { ...(cur.backlight || {}), color: e.target.value } }))}
                                                />
                                            </label>
                                            <label>
                                                Pressed
                                                <Input
                                                    type="color"
                                                    value={sw0.backlight?.pressedColor ?? (sw0.backlight?.color ?? "#00b7ff")}
                                                    onChange={(e) => setSwitch((cur) => ({ backlight: { ...(cur.backlight || {}), pressedColor: e.target.value } }))}
                                                />
                                            </label>
                                            <label>
                                                Intensity
                                                <NumberInput
                                                    value={sw0.backlight?.intensity ?? 1.6}
                                                    step={0.1}
                                                    min={0}
                                                    onChange={(v) => setSwitch((cur) => ({ backlight: { ...(cur.backlight || {}), intensity: v } }))}
                                                />
                                            </label>
                                            <label>
                                                Opacity
                                                <NumberInput
                                                    value={sw0.backlight?.opacity ?? 0.35}
                                                    step={0.05}
                                                    min={0}
                                                    max={1}
                                                    onChange={(v) => setSwitch((cur) => ({ backlight: { ...(cur.backlight || {}), opacity: v } }))}
                                                />
                                            </label>
                                            <label>
                                                Padding
                                                <NumberInput
                                                    value={sw0.backlight?.padding ?? 0.012}
                                                    step={0.002}
                                                    min={0}
                                                    onChange={(v) => setSwitch((cur) => ({ backlight: { ...(cur.backlight || {}), padding: v } }))}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                </details>

                                <details style={{ marginTop: 8 }}>
                                    <summary style={{ cursor: "pointer", fontWeight: 900 }}>Text glow defaults</summary>
                                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                                        <Checkbox
                                            checked={!!sw0.textGlow?.enabled}
                                            onChange={(on) => setSwitch((cur) => ({ textGlow: { ...(cur.textGlow || {}), enabled: on } }))}
                                            label="Enabled"
                                        />
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                            <label>
                                                Color
                                                <Input
                                                    type="color"
                                                    value={sw0.textGlow?.color ?? "#ffffff"}
                                                    onChange={(e) => setSwitch((cur) => ({ textGlow: { ...(cur.textGlow || {}), color: e.target.value } }))}
                                                />
                                            </label>
                                            <label>
                                                Pressed
                                                <Input
                                                    type="color"
                                                    value={sw0.textGlow?.pressedColor ?? (sw0.textGlow?.color ?? "#ffffff")}
                                                    onChange={(e) => setSwitch((cur) => ({ textGlow: { ...(cur.textGlow || {}), pressedColor: e.target.value } }))}
                                                />
                                            </label>
                                            <label>
                                                Intensity
                                                <NumberInput
                                                    value={sw0.textGlow?.intensity ?? 1}
                                                    step={0.1}
                                                    min={0}
                                                    onChange={(v) => setSwitch((cur) => ({ textGlow: { ...(cur.textGlow || {}), intensity: v } }))}
                                                />
                                            </label>
                                            <label>
                                                Outline width
                                                <NumberInput
                                                    value={sw0.textGlow?.outlineWidth ?? 0.02}
                                                    step={0.005}
                                                    min={0}
                                                    onChange={(v) => setSwitch((cur) => ({ textGlow: { ...(cur.textGlow || {}), outlineWidth: v } }))}
                                                />
                                            </label>
                                            <label>
                                                Outline opacity
                                                <NumberInput
                                                    value={sw0.textGlow?.outlineOpacity ?? 0.8}
                                                    step={0.05}
                                                    min={0}
                                                    max={1}
                                                    onChange={(v) => setSwitch((cur) => ({ textGlow: { ...(cur.textGlow || {}), outlineOpacity: v } }))}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                </details>

                            </div>

                            <details style={{ marginTop: 8 }} open>
                                <summary style={{ cursor: "pointer", fontWeight: 800, marginBottom: 6 }}>Buttons</summary>
                                <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                                    {sw0.buttons.map((b, i) => {
                                        const btn = b || {};
                                        const effBacklight = { ...(sw0.backlight || {}), ...(btn.backlight || {}) };
                                        const effTextGlow = { ...(sw0.textGlow || {}), ...(btn.textGlow || {}) };
                                        return (
                                            <details key={i} style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 10 }} open={i === 0}>
                                                <summary style={{ cursor: "pointer", fontWeight: 800 }}>
                                                    {`Button ${i + 1}: ${btn.name || `Btn ${i + 1}`}`}
                                                </summary>
                                                <div style={{ display: "grid", gap: 8, marginTop: 10 }}
                                                >
                                                    <label>
                                                        Name (shown on button)
                                                        <Input
                                                            value={btn.name || ""}
                                                            onChange={(e) => setButton(i, { name: e.target.value })}
                                                        />
                                                    </label>

                                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                                        <label>
                                                            Color
                                                            <Input
                                                                type="color"
                                                                value={btn.color || sw0.buttonColor || "#22314d"}
                                                                onChange={(e) => setButton(i, { color: e.target.value })}
                                                            />
                                                        </label>
                                                        <label>
                                                            Pressed
                                                            <Input
                                                                type="color"
                                                                value={btn.pressedColor || sw0.pressedColor || "#101a2d"}
                                                                onChange={(e) => setButton(i, { pressedColor: e.target.value })}
                                                            />
                                                        </label>
                                                        <label>
                                                            Text color
                                                            <Input
                                                                type="color"
                                                                value={btn.textColor || sw0.textColor || "#e2e8f0"}
                                                                onChange={(e) => setButton(i, { textColor: e.target.value })}
                                                            />
                                                        </label>
                                                        <label>
                                                            Text scale
                                                            <NumberInput
                                                                value={btn.textScale ?? 1}
                                                                step={0.05}
                                                                min={0.2}
                                                                onChange={(v) => setButton(i, { textScale: v })}
                                                            />
                                                        </label>
                                                    </div>


                                                    <div style={{
                                                        padding: 10,
                                                        borderRadius: 12,
                                                        background: "rgba(0,0,0,0.18)",
                                                        border: "1px solid rgba(255,255,255,0.08)"
                                                    }}>
                                                        <div style={{ fontWeight: 900, marginBottom: 6 }}>Text layout</div>
                                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                                            <label>
                                                                Rotation (deg)
                                                                <NumberInput
                                                                    value={btn.textRotationDeg ?? sw0.textRotationDeg ?? 0}
                                                                    step={5}
                                                                    onChange={(v) => setButton(i, { textRotationDeg: v })}
                                                                />
                                                            </label>
                                                            <label>
                                                                Align
                                                                <Select
                                                                    value={btn.textAlign ?? sw0.textAlign ?? "center"}
                                                                    onChange={(e) => setButton(i, { textAlign: e.target.value })}
                                                                >
                                                                    <option value="left">Left</option>
                                                                    <option value="center">Center</option>
                                                                    <option value="right">Right</option>
                                                                </Select>
                                                            </label>
                                                            <label>
                                                                Offset X
                                                                <NumberInput
                                                                    value={(btn.textOffset?.x ?? sw0.textOffset?.x ?? 0)}
                                                                    step={0.005}
                                                                    onChange={(v) => setButton(i, { textOffset: { ...(btn.textOffset || sw0.textOffset || { x: 0, y: 0 }), x: v } })}
                                                                />
                                                            </label>
                                                            <label>
                                                                Offset Y
                                                                <NumberInput
                                                                    value={(btn.textOffset?.y ?? sw0.textOffset?.y ?? 0)}
                                                                    step={0.005}
                                                                    onChange={(v) => setButton(i, { textOffset: { ...(btn.textOffset || sw0.textOffset || { x: 0, y: 0 }), y: v } })}
                                                                />
                                                            </label>
                                                        </div>
                                                    </div>

                                                    <details style={{ marginTop: 8 }}>
                                                        <summary style={{ cursor: "pointer", fontWeight: 900 }}>Backlight</summary>
                                                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                                                            <Checkbox
                                                                checked={!!btn.backlight}
                                                                onChange={(on) => setButton(i, { backlight: on ? { ...(sw0.backlight || {}) } : undefined })}
                                                                label="Override for this button"
                                                            />
                                                            <div
                                                                style={{
                                                                    display: "grid",
                                                                    gridTemplateColumns: "1fr 1fr",
                                                                    gap: 8,
                                                                    opacity: btn.backlight ? 1 : 0.55,
                                                                    pointerEvents: btn.backlight ? "auto" : "none",
                                                                }}
                                                            >
                                                                <Checkbox
                                                                    checked={!!effBacklight.enabled}
                                                                    onChange={(on) => setButton(i, { backlight: { ...(btn.backlight || sw0.backlight || {}), enabled: on } })}
                                                                    label="Enabled"
                                                                />
                                                                <div />
                                                                <label>
                                                                    Color
                                                                    <Input
                                                                        type="color"
                                                                        value={effBacklight.color ?? "#00b7ff"}
                                                                        onChange={(e) => setButton(i, { backlight: { ...(btn.backlight || sw0.backlight || {}), color: e.target.value } })}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Pressed
                                                                    <Input
                                                                        type="color"
                                                                        value={effBacklight.pressedColor ?? (effBacklight.color ?? "#00b7ff")}
                                                                        onChange={(e) => setButton(i, { backlight: { ...(btn.backlight || sw0.backlight || {}), pressedColor: e.target.value } })}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Intensity
                                                                    <NumberInput
                                                                        value={effBacklight.intensity ?? 1.6}
                                                                        step={0.1}
                                                                        min={0}
                                                                        onChange={(v) => setButton(i, { backlight: { ...(btn.backlight || sw0.backlight || {}), intensity: v } })}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Opacity
                                                                    <NumberInput
                                                                        value={effBacklight.opacity ?? 0.35}
                                                                        step={0.05}
                                                                        min={0}
                                                                        max={1}
                                                                        onChange={(v) => setButton(i, { backlight: { ...(btn.backlight || sw0.backlight || {}), opacity: v } })}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Padding
                                                                    <NumberInput
                                                                        value={effBacklight.padding ?? 0.012}
                                                                        step={0.002}
                                                                        min={0}
                                                                        onChange={(v) => setButton(i, { backlight: { ...(btn.backlight || sw0.backlight || {}), padding: v } })}
                                                                    />
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </details>

                                                    <details style={{ marginTop: 8 }}>
                                                        <summary style={{ cursor: "pointer", fontWeight: 900 }}>Text glow</summary>
                                                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                                                            <Checkbox
                                                                checked={!!btn.textGlow}
                                                                onChange={(on) => setButton(i, { textGlow: on ? { ...(sw0.textGlow || {}) } : undefined })}
                                                                label="Override for this button"
                                                            />
                                                            <div
                                                                style={{
                                                                    display: "grid",
                                                                    gridTemplateColumns: "1fr 1fr",
                                                                    gap: 8,
                                                                    opacity: btn.textGlow ? 1 : 0.55,
                                                                    pointerEvents: btn.textGlow ? "auto" : "none",
                                                                }}
                                                            >
                                                                <Checkbox
                                                                    checked={!!effTextGlow.enabled}
                                                                    onChange={(on) => setButton(i, { textGlow: { ...(btn.textGlow || sw0.textGlow || {}), enabled: on } })}
                                                                    label="Enabled"
                                                                />
                                                                <div />
                                                                <label>
                                                                    Color
                                                                    <Input
                                                                        type="color"
                                                                        value={effTextGlow.color ?? "#ffffff"}
                                                                        onChange={(e) => setButton(i, { textGlow: { ...(btn.textGlow || sw0.textGlow || {}), color: e.target.value } })}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Pressed
                                                                    <Input
                                                                        type="color"
                                                                        value={effTextGlow.pressedColor ?? (effTextGlow.color ?? "#ffffff")}
                                                                        onChange={(e) => setButton(i, { textGlow: { ...(btn.textGlow || sw0.textGlow || {}), pressedColor: e.target.value } })}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Intensity
                                                                    <NumberInput
                                                                        value={effTextGlow.intensity ?? 1}
                                                                        step={0.1}
                                                                        min={0}
                                                                        onChange={(v) => setButton(i, { textGlow: { ...(btn.textGlow || sw0.textGlow || {}), intensity: v } })}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Outline width
                                                                    <NumberInput
                                                                        value={effTextGlow.outlineWidth ?? 0.02}
                                                                        step={0.005}
                                                                        min={0}
                                                                        onChange={(v) => setButton(i, { textGlow: { ...(btn.textGlow || sw0.textGlow || {}), outlineWidth: v } })}
                                                                    />
                                                                </label>
                                                                <label>
                                                                    Outline opacity
                                                                    <NumberInput
                                                                        value={effTextGlow.outlineOpacity ?? 0.8}
                                                                        step={0.05}
                                                                        min={0}
                                                                        max={1}
                                                                        onChange={(v) => setButton(i, { textGlow: { ...(btn.textGlow || sw0.textGlow || {}), outlineOpacity: v } })}
                                                                    />
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </details>

                                                    <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                                                        Actions to run when this button is pressed
                                                    </div>
                                                    {(Array.isArray(actions) && actions.length > 0) ? (
                                                        <div style={{ display: "grid", gap: 6 }}>
                                                            {actions.map((a) => {
                                                                const checked = (btn.actionIds || []).includes(a.id);
                                                                return (
                                                                    <Checkbox
                                                                        key={a.id}
                                                                        checked={checked}
                                                                        onChange={(v) => toggleButtonAction(i, a.id, v)}
                                                                        label={a.label || a.name || a.id}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div style={{ fontSize: 12, opacity: 0.8 }}>No actions yet. Add one below.</div>
                                                    )}
                                                </div>
                                            </details>
                                        );
                                    })}
                                </div>
                            </details>

                            {ActionsPanel && (
                                <details style={{ marginTop: 10 }}>
                                    <summary style={{ cursor: "pointer", fontWeight: 800 }}>Manage Actions</summary>
                                    <div style={{ marginTop: 8 }}>
                                        <ActionsPanel />
                                    </div>
                                </details>
                            )}
                        </div>
                    );
                })()}

                {/* Light */}
                <div
                    style={{
                        borderTop: "1px dashed rgba(255,255,255,0.15)",
                        paddingTop: 8,
                        marginTop: 8,
                    }}
                >
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Light</div>

                    {/* Copy / Paste light profile */}
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            alignItems: "center",
                            marginBottom: 8,
                        }}
                    >
                        <Btn
                            onClick={copyLightProfile}
                            style={{ padding: "8px 10px" }}
                            title="Copy this node's light profile (type, intensity, aim, dimmer, shadows)"
                        >
                            Copy profile
                        </Btn>
                        <Btn
                            disabled={!canPasteLightProfile}
                            onClick={() => pasteLightProfile(n.id)}
                            style={{ padding: "8px 10px" }}
                            title="Paste the copied light profile onto this node"
                        >
                            Paste profile
                        </Btn>
                        <Btn
                            disabled={!canPasteLightProfile || downstreamChainIds.length === 0}
                            onClick={pasteLightProfileToChain}
                            style={{ padding: "8px 10px" }}
                            title="Paste the copied light profile onto the linked node and continue down the chain"
                        >
                            Paste → chain{downstreamChainIds.length ? ` (${downstreamChainIds.length})` : ""}
                        </Btn>
                    </div>

                    <label>
                        Type
                        <Select
                            value={n.light?.type || "none"}
                            onChange={(e) =>
                                setNode(n.id, {
                                    light: {
                                        ...(n.light || {}),
                                        type: e.target.value,
                                    },
                                })
                            }
                        >
                            <option value="none">none</option>
                            <option value="point">point</option>
                            <option value="spot">spot</option>
                            <option value="directional">directional</option>
                        </Select>
                    </label>

                    {n.light?.type !== "none" && (
                        <>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: 8,
                                    alignItems: "end",
                                }}
                            >
                                <label>
                                    Color
                                    <Input
                                        type="color"
                                        value={n.light?.color || "#ffffff"}
                                        onChange={(e) =>
                                            setNode(n.id, {
                                                light: {
                                                    ...(n.light || {}),
                                                    color: e.target.value,
                                                },
                                            })
                                        }
                                    />
                                </label>

                                <div style={{ display: "grid", gap: 6 }}>
                                    <Checkbox
                                        checked={n.light?.enabled ?? true}
                                        onChange={(v) => {
                                            if (typeof setLightEnabled === "function") {
                                                setLightEnabled(n.id, v);
                                            } else {
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        enabled: v,
                                                    },
                                                });
                                            }
                                        }}
                                        label="enabled (dimmer)"
                                    />
                                    <Checkbox
                                        checked={!!n.light?.daisyChained}
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                light: {
                                                    ...(n.light || {}),
                                                    daisyChained: v,
                                                },
                                            })
                                        }
                                        label="daisy chained"
                                    />
                                    <Checkbox
                                        checked={!!n.light?.showBounds}
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                light: {
                                                    ...(n.light || {}),
                                                    showBounds: v,
                                                },
                                            })
                                        }
                                        label="show bounds"
                                    />
                                </div>
                            </div>

                            {/* Intensity / units */}
                            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                                <Checkbox
                                    checked={n.light?.autoIntensity ?? (n.light?.type === "spot" || n.light?.type === "point")}
                                    onChange={(v) =>
                                        setNode(n.id, {
                                            light: {
                                                ...(n.light || {}),
                                                autoIntensity: v,
                                            },
                                        })
                                    }
                                    label={
                                        n.light?.type === "directional"
                                            ? "Auto intensity (lux)"
                                            : "Auto intensity (target lux @ distance)"
                                    }
                                />

                                {(n.light?.autoIntensity ?? (n.light?.type === "spot" || n.light?.type === "point")) ? (
                                    <label>
                                        Target Lux
                                        <Slider
                                            value={n.light?.targetLux ?? (n.light?.type === "directional" ? 30 : 120)}
                                            min={0}
                                            max={2000}
                                            step={1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        targetLux: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                ) : (
                                    <label>
                                        Intensity
                                        <Slider
                                            value={n.light?.intensity ?? (n.light?.type === "spot" ? 1200 : n.light?.type === "directional" ? 30 : 800)}
                                            min={0}
                                            max={20000}
                                            step={1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        intensity: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                )}

                                {/* Manual numeric input for intensity (always available) */}
                                <label>
                                    {n.light?.type === "directional" ? "Intensity (lux)" : "Intensity (candela)"}
                                    <NumberInput
                                        value={
                                            (n.light?.autoIntensity ?? (n.light?.type === "spot" || n.light?.type === "point"))
                                                ? (n.light?.targetLux ?? (n.light?.type === "directional" ? 30 : 120))
                                                : (n.light?.intensity ?? (n.light?.type === "spot" ? 1200 : n.light?.type === "directional" ? 30 : 800))
                                        }
                                        step={1}
                                        min={0}
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                light: {
                                                    ...(n.light || {}),
                                                    ...( (n.light?.autoIntensity ?? (n.light?.type === "spot" || n.light?.type === "point"))
                                                            ? { targetLux: v }
                                                            : { intensity: v }
                                                    ),
                                                },
                                            })
                                        }
                                    />
                                    <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                                        {n.light?.type === "directional"
                                            ? "Directional light uses lux. Auto mode sets lux directly."
                                            : "Point/Spot light uses candela. Auto mode sets target lux and derives candela from distance."}
                                    </div>
                                </label>
                            </div>

                            {/* Range */}
                            {(n.light?.type === "point" || n.light?.type === "spot") && (
                                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                                    <label>
                                        Distance (range)
                                        <Slider
                                            value={n.light?.distance ?? (n.light?.type === "spot" ? 10 : 8)}
                                            min={0}
                                            max={60}
                                            step={0.1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        distance: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Decay
                                        <Slider
                                            value={n.light?.decay ?? 2}
                                            min={0}
                                            max={2}
                                            step={0.01}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        decay: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </div>
                            )}

                            {/* Spot options */}
                            {n.light?.type === "spot" && (
                                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                                    <label>
                                        Angle
                                        <Slider
                                            value={n.light?.angle ?? 0.6}
                                            min={0.05}
                                            max={1.5}
                                            step={0.01}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        angle: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Penumbra
                                        <Slider
                                            value={n.light?.penumbra ?? 0.35}
                                            min={0}
                                            max={1}
                                            step={0.01}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        penumbra: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </div>
                            )}

                            {/* Aim / target */}
                            {(n.light?.type === "spot" || n.light?.type === "directional") && (
                                <div
                                    style={{
                                        borderTop: "1px dashed rgba(255,255,255,0.15)",
                                        paddingTop: 8,
                                        marginTop: 8,
                                    }}
                                >
                                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Aim</div>

                                    <label>
                                        Aim mode
                                        <Select
                                            value={n.light?.aimMode || (n.light?.target ? "target" : "yawPitch")}
                                            onChange={(e) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        aimMode: e.target.value,
                                                        ...(e.target.value === "target"
                                                            ? { target: n.light?.target || { x: 0, y: 0, z: -2 } }
                                                            : {}),
                                                    },
                                                })
                                            }
                                        >
                                            <option value="target">Target point (x,y,z)</option>
                                            <option value="yawPitch">Yaw / Pitch (legacy)</option>
                                        </Select>
                                    </label>

                                    {(n.light?.aimMode || (n.light?.target ? "target" : "yawPitch")) === "target" && (
                                        <>
                                            <div
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "repeat(3, 1fr)",
                                                    gap: 8,
                                                }}
                                            >
                                                <label>
                                                    X
                                                    <NumberInput
                                                        value={n.light?.target?.x ?? 0}
                                                        step={0.1}
                                                        min={-999}
                                                        onChange={(v) =>
                                                            setNode(n.id, {
                                                                light: {
                                                                    ...(n.light || {}),
                                                                    target: {
                                                                        ...(n.light?.target || { x: 0, y: 0, z: -2 }),
                                                                        x: v,
                                                                    },
                                                                },
                                                            })
                                                        }
                                                    />
                                                </label>
                                                <label>
                                                    Y
                                                    <NumberInput
                                                        value={n.light?.target?.y ?? 0}
                                                        step={0.1}
                                                        min={-999}
                                                        onChange={(v) =>
                                                            setNode(n.id, {
                                                                light: {
                                                                    ...(n.light || {}),
                                                                    target: {
                                                                        ...(n.light?.target || { x: 0, y: 0, z: -2 }),
                                                                        y: v,
                                                                    },
                                                                },
                                                            })
                                                        }
                                                    />
                                                </label>
                                                <label>
                                                    Z
                                                    <NumberInput
                                                        value={n.light?.target?.z ?? -2}
                                                        step={0.1}
                                                        min={-999}
                                                        onChange={(v) =>
                                                            setNode(n.id, {
                                                                light: {
                                                                    ...(n.light || {}),
                                                                    target: {
                                                                        ...(n.light?.target || { x: 0, y: 0, z: -2 }),
                                                                        z: v,
                                                                    },
                                                                },
                                                            })
                                                        }
                                                    />
                                                </label>
                                            </div>

                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                                                <Btn
                                                    onClick={() =>
                                                        setNode(n.id, {
                                                            light: {
                                                                ...(n.light || {}),
                                                                aimMode: "target",
                                                                target: { x: 0, y: 0, z: -2 },
                                                            },
                                                        })
                                                    }
                                                    style={{ padding: "8px 10px" }}
                                                    title="Aim forward"
                                                >
                                                    Aim forward
                                                </Btn>
                                                <Btn
                                                    onClick={() =>
                                                        setNode(n.id, {
                                                            light: {
                                                                ...(n.light || {}),
                                                                aimMode: "target",
                                                                target: { x: 0, y: -2, z: 0 },
                                                            },
                                                        })
                                                    }
                                                    style={{ padding: "8px 10px" }}
                                                    title="Aim down"
                                                >
                                                    Aim down
                                                </Btn>
                                                <Btn
                                                    onClick={() =>
                                                        setNode(n.id, {
                                                            light: {
                                                                ...(n.light || {}),
                                                                aimMode: "target",
                                                                target: { x: 0, y: 2, z: 0 },
                                                            },
                                                        })
                                                    }
                                                    style={{ padding: "8px 10px" }}
                                                    title="Aim up"
                                                >
                                                    Aim up
                                                </Btn>
                                            </div>

                                            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6 }}>
                                                Target is in <strong>local</strong> space (relative to the light position on this node).
                                            </div>
                                        </>
                                    )}

                                    {(n.light?.aimMode || (n.light?.target ? "target" : "yawPitch")) === "yawPitch" && (
                                        <>
                                            <label>
                                                Yaw (°)
                                                <Slider
                                                    value={n.light?.yaw ?? 0}
                                                    min={-180}
                                                    max={180}
                                                    step={1}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            light: {
                                                                ...(n.light || {}),
                                                                yaw: v,
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>
                                            <label>
                                                Pitch (°)
                                                <Slider
                                                    value={n.light?.pitch ?? 0}
                                                    min={-89}
                                                    max={89}
                                                    step={1}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            light: {
                                                                ...(n.light || {}),
                                                                pitch: v,
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>
                                            <label>
                                                Yaw/Pitch basis
                                                <Select
                                                    value={n.light?.yawPitchBasis || "forward"}
                                                    onChange={(e) =>
                                                        setNode(n.id, {
                                                            light: {
                                                                ...(n.light || {}),
                                                                yawPitchBasis: e.target.value,
                                                            },
                                                        })
                                                    }
                                                >
                                                    <option value="forward">forward (-Z) — recommended</option>
                                                    <option value="down">legacy down (-Y)</option>
                                                </Select>
                                            </label>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Dimmer timing */}
                            <div
                                style={{
                                    borderTop: "1px dashed rgba(255,255,255,0.15)",
                                    paddingTop: 8,
                                    marginTop: 8,
                                }}
                            >
                                <div style={{ fontWeight: 900, marginBottom: 6 }}>Dimmer</div>
                                <label>
                                    Fade in (s)
                                    <Slider
                                        value={n.light?.fadeIn ?? 0.25}
                                        min={0}
                                        max={2}
                                        step={0.01}
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                light: {
                                                    ...(n.light || {}),
                                                    fadeIn: v,
                                                },
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    Fade out (s)
                                    <Slider
                                        value={n.light?.fadeOut ?? 0.25}
                                        min={0}
                                        max={2}
                                        step={0.01}
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                light: {
                                                    ...(n.light || {}),
                                                    fadeOut: v,
                                                },
                                            })
                                        }
                                    />
                                </label>
                            </div>

                            {/* Shadows */}
                            <div
                                style={{
                                    borderTop: "1px dashed rgba(255,255,255,0.15)",
                                    paddingTop: 8,
                                    marginTop: 8,
                                }}
                            >
                                <div style={{ fontWeight: 900, marginBottom: 6 }}>Shadows</div>

                                <label style={{ display: "block", marginTop: 6 }}>
                                    <input
                                        type="checkbox"
                                        checked={n.shadows?.cast ?? true}
                                        onChange={(e) =>
                                            setNode(n.id, {
                                                shadows: {
                                                    ...(n.shadows || {}),
                                                    cast: e.target.checked,
                                                },
                                            })
                                        }
                                    />{" "}
                                    Cast shadows
                                </label>

                                <label style={{ display: "block", marginTop: 6 }}>
                                    <input
                                        type="checkbox"
                                        checked={n.shadows?.receive ?? true}
                                        onChange={(e) =>
                                            setNode(n.id, {
                                                shadows: {
                                                    ...(n.shadows || {}),
                                                    receive: e.target.checked,
                                                },
                                            })
                                        }
                                    />{" "}
                                    Receive shadows
                                </label>

                                <label style={{ display: "block", marginTop: 6 }}>
                                    <input
                                        type="checkbox"
                                        checked={n.shadows?.light ?? true}
                                        onChange={(e) =>
                                            setNode(n.id, {
                                                shadows: {
                                                    ...(n.shadows || {}),
                                                    light: e.target.checked,
                                                },
                                            })
                                        }
                                    />{" "}
                                    Node light casts
                                </label>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                                    <label>
                                        Shadow map
                                        <Select
                                            value={String(n.light?.shadowMapSize ?? 1024)}
                                            onChange={(e) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        shadowMapSize: Number(e.target.value),
                                                    },
                                                })
                                            }
                                        >
                                            <option value="256">256</option>
                                            <option value="512">512</option>
                                            <option value="1024">1024</option>
                                            <option value="2048">2048</option>
                                            <option value="4096">4096</option>
                                        </Select>
                                    </label>
                                    <label>
                                        Normal bias
                                        <NumberInput
                                            value={n.light?.shadowNormalBias ?? 0.02}
                                            step={0.005}
                                            min={0}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light || {}),
                                                        shadowNormalBias: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </div>
                                <label>
                                    Bias
                                    <NumberInput
                                        value={n.light?.shadowBias ?? -0.0002}
                                        step={0.0001}
                                        min={-0.01}
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                light: {
                                                    ...(n.light || {}),
                                                    shadowBias: v,
                                                },
                                            })
                                        }
                                    />
                                </label>
                            </div>
                        </>
                    )}
                </div>

                {/* Signals */}
                <div
                    style={{
                        borderTop: "1px dashed rgba(255,255,255,0.15)",
                        paddingTop: 8,
                        marginTop: 8,
                    }}
                >
                    <div
                        style={{
                            fontWeight: 900,
                            marginBottom: 6,
                        }}
                    >
                        Signals
                    </div>
                    <label>
                        Style
                        <Select
                            value={n.signal?.style || "waves"}
                            onChange={(e) =>
                                setNode(n.id, {
                                    signal: {
                                        ...(n.signal || {}),
                                        style: e.target.value,
                                    },
                                })
                            }
                        >
                            <option value="none">none</option>
                            <option value="waves">waves</option>
                            <option value="rays">rays</option>
                        </Select>
                    </label>
                    <label>
                        Color
                        <Input
                            type="color"
                            value={
                                n.signal?.color || n.color || "#7cf"
                            }
                            onChange={(e) =>
                                setNode(n.id, {
                                    signal: {
                                        ...(n.signal || {}),
                                        color: e.target.value,
                                    },
                                })
                            }
                        />
                    </label>
                    <label>
                        Speed
                        <Slider
                            value={n.signal?.speed ?? 1}
                            min={0.2}
                            max={4}
                            step={0.05}
                            onChange={(v) =>
                                setNode(n.id, {
                                    signal: {
                                        ...(n.signal || {}),
                                        speed: v,
                                    },
                                })
                            }
                        />
                    </label>
                    <label>
                        Size
                        <Slider
                            value={n.signal?.size ?? 1}
                            min={0.5}
                            max={2}
                            step={0.05}
                            onChange={(v) =>
                                setNode(n.id, {
                                    signal: {
                                        ...(n.signal || {}),
                                        size: v,
                                    },
                                })
                            }
                        />
                    </label>
                </div>

                {/* Per-node outgoing link flow editor */}
                <OutgoingLinksEditor
                    node={n}
                    nodes={nodes}
                    links={links}
                    setLinks={setLinks}
                    selectedBreakpoint={selectedBreakpoint}
                    setSelectedBreakpoint={setSelectedBreakpoint}
                />

                {/* Master Links (incoming flows) */}
                <div
                    style={{
                        marginTop: 10,
                        padding: 10,
                        borderRadius: 14,
                        background: "rgba(2,6,23,0.32)",
                        border: "1px solid rgba(148,163,184,0.18)",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "baseline",
                            justifyContent: "space-between",
                            gap: 10,
                            marginBottom: 8,
                        }}
                    >
                        <div
                            style={{
                                fontWeight: 800,
                                fontSize: 12,
                                letterSpacing: "0.14em",
                                textTransform: "uppercase",
                                opacity: 0.9,
                            }}
                        >
                            Master Links
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                            Incoming flows to this node
                        </div>
                    </div>

                    {masterGroups.length === 0 ? (
                        <div style={{ fontSize: 13, opacity: 0.75 }}>
                            No incoming links.
                        </div>
                    ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                            {masterGroups.map((g) => (
                                <div
                                    key={g.fromId}
                                    style={{
                                        borderRadius: 12,
                                        border: "1px solid rgba(148,163,184,0.16)",
                                        background: "rgba(15,23,42,0.28)",
                                        overflow: "hidden",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 10,
                                            padding: "8px 10px",
                                        }}
                                    >
                                        <div style={{ minWidth: 0 }}>
                                            <div
                                                style={{
                                                    fontWeight: 750,
                                                    fontSize: 13,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                }}
                                            >
                                                {g.fromLabel}
                                            </div>
                                            <div style={{ fontSize: 12, opacity: 0.72 }}>
                                                {g.links.length} link{g.links.length === 1 ? "" : "s"} →{" "}
                                                {n.label || n.id}
                                            </div>
                                        </div>

                                        <Btn
                                            onClick={() =>
                                                setOpenMasterId((cur) =>
                                                    cur === g.fromId ? null : g.fromId,
                                                )
                                            }
                                            glow={openMasterId === g.fromId}
                                        >
                                            {openMasterId === g.fromId ? "Hide" : "Edit"}
                                        </Btn>
                                    </div>

                                    {openMasterId === g.fromId && (
                                        <div
                                            style={{
                                                padding: 10,
                                                borderTop: "1px solid rgba(148,163,184,0.14)",
                                            }}
                                        >
                                            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
                                                Editing flows from <b>{g.fromLabel}</b> to{" "}
                                                <b>{n.label || n.id}</b>
                                            </div>

                                            <OutgoingLinksEditor
                                                node={g.fromNode}
                                                nodes={nodes}
                                                links={g.links}
                                                setLinks={g.setLinksScoped}
                                                selectedBreakpoint={selectedBreakpoint}
                                                setSelectedBreakpoint={setSelectedBreakpoint}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>



            </div>
        </Panel>
    );
}

/* ---------- ROOM INSPECTOR ---------- */

function RoomInspector({
                           room: r,
                           decks,
                           roomOpacity,
                           setRoomOpacity,
                           setRoom,
                           duplicateRoom,
                           requestDelete,
                       }) {
    if (!r) return null;

    return (
        <Panel title="Room Inspector">
            <div style={{ display: "grid", gap: 8 }}>
                <label>
                    Name
                    <Input
                        value={r.name}
                        onChange={(e) =>
                            setRoom(r.id, { name: e.target.value })
                        }
                    />
                </label>

                <label>
                    Visible{" "}
                    <Checkbox
                        checked={r.visible !== false}
                        onChange={(v) =>
                            setRoom(r.id, { visible: v })
                        }
                    />
                </label>
                <label>
                    Lock movement{" "}
                    <Checkbox
                        checked={!!r.locked}
                        onChange={(v) => setRoom(r.id, { locked: v })}
                    />
                </label>

                <label>
                    Center (x,y,z)
                    <Input
                        value={(r.center || [0, 0, 0]).join(", ")}
                        onChange={(e) => {
                            const parts = e.target.value
                                .split(",")
                                .map(
                                    (v) =>
                                        Number(v.trim()) || 0,
                                );
                            if (parts.length === 3)
                                setRoom(r.id, { center: parts });
                        }}
                    />
                </label>

                <label>
                    Deck
                    <Select
                        value={r.deckId || ""}
                        onChange={(e) =>
                            setRoom(r.id, {
                                deckId: e.target.value || undefined,
                            })
                        }
                    >
                        <option value="">No deck</option>
                        {decks.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.name}
                            </option>
                        ))}
                    </Select>
                </label>

                <label>
                    Rotation (x,y,z radians)
                    <Input
                        value={(r.rotation || [0, 0, 0])
                            .map((v) => +v.toFixed(3))
                            .join(", ")}
                        onChange={(e) => {
                            const parts = e.target.value
                                .split(",")
                                .map(
                                    (v) =>
                                        Number(v.trim()) || 0,
                                );
                            if (parts.length === 3)
                                setRoom(r.id, { rotation: parts });
                        }}
                    />
                </label>

                <div>
                    <div
                        style={{
                            fontSize: 12,
                            opacity: 0.85,
                            marginBottom: 4,
                        }}
                    >
                        Size (x,y,z)
                    </div>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns:
                                "1fr 1fr 1fr",
                            gap: 8,
                        }}
                    >
                        <label>
                            X
                            <Input
                                type="number"
                                step="0.1"
                                value={r.size?.[0] ?? 1}
                                onChange={(e) => {
                                    const nx = Math.max(
                                        0.1,
                                        Number(e.target.value) ||
                                        0.1,
                                    );
                                    setRoom(r.id, {
                                        size: [
                                            nx,
                                            r.size?.[1] ?? 1,
                                            r.size?.[2] ?? 1,
                                        ],
                                    });
                                }}
                                onWheel={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const dir =
                                        e.deltaY < 0 ? 1 : -1;
                                    const nx = Math.max(
                                        0.1,
                                        +(
                                            (r.size?.[0] ?? 1) +
                                            dir * 0.1
                                        ).toFixed(2),
                                    );
                                    setRoom(r.id, {
                                        size: [
                                            nx,
                                            r.size?.[1] ?? 1,
                                            r.size?.[2] ?? 1,
                                        ],
                                    });
                                }}
                            />
                        </label>
                        <label>
                            Y
                            <Input
                                type="number"
                                step="0.1"
                                value={r.size?.[1] ?? 1}
                                onChange={(e) => {
                                    const ny = Math.max(
                                        0.1,
                                        Number(e.target.value) ||
                                        0.1,
                                    );
                                    setRoom(r.id, {
                                        size: [
                                            r.size?.[0] ?? 1,
                                            ny,
                                            r.size?.[2] ?? 1,
                                        ],
                                    });
                                }}
                                onWheel={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const dir =
                                        e.deltaY < 0 ? 1 : -1;
                                    const ny = Math.max(
                                        0.1,
                                        +(
                                            (r.size?.[1] ?? 1) +
                                            dir * 0.1
                                        ).toFixed(2),
                                    );
                                    setRoom(r.id, {
                                        size: [
                                            r.size?.[0] ?? 1,
                                            ny,
                                            r.size?.[2] ?? 1,
                                        ],
                                    });
                                }}
                            />
                        </label>
                        <label>
                            Z
                            <Input
                                type="number"
                                step="0.1"
                                value={r.size?.[2] ?? 1}
                                onChange={(e) => {
                                    const nz = Math.max(
                                        0.1,
                                        Number(e.target.value) ||
                                        0.1,
                                    );
                                    setRoom(r.id, {
                                        size: [
                                            r.size?.[0] ?? 1,
                                            r.size?.[1] ?? 1,
                                            nz,
                                        ],
                                    });
                                }}
                                onWheel={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const dir =
                                        e.deltaY < 0 ? 1 : -1;
                                    const nz = Math.max(
                                        0.1,
                                        +(
                                            (r.size?.[2] ?? 1) +
                                            dir * 0.1
                                        ).toFixed(2),
                                    );
                                    setRoom(r.id, {
                                        size: [
                                            r.size?.[0] ?? 1,
                                            r.size?.[1] ?? 1,
                                            nz,
                                        ],
                                    });
                                }}
                            />
                        </label>
                    </div>
                </div>

                <label>
                    Opacity
                    <Slider
                        value={roomOpacity}
                        min={0.02}
                        max={0.5}
                        step={0.01}
                        onChange={(v) => setRoomOpacity(v)}
                    />
                </label>
                {/* Node Boundaries */}
                <Panel title="Node Boundaries">
                    <Checkbox
                        label="Enable Boundaries"
                        checked={r.nodeBounds?.enabled ?? false}
                        onChange={(v) =>
                            setRoom(r.id, {
                                nodeBounds: {
                                    ...(r.nodeBounds || {}),
                                    enabled: v,
                                },
                            })
                        }
                    />

                    {(r.nodeBounds?.enabled ?? false) && (
                        <>
                            <Select
                                label="Shape"
                                value={r.nodeBounds?.shape ?? "box"}
                                onChange={(e) =>
                                    setRoom(r.id, {
                                        nodeBounds: {
                                            ...(r.nodeBounds || {}),
                                            shape: e.target.value,
                                        },
                                    })
                                }
                            >
                                <option value="box">Box</option>
                                <option value="circle">Circle</option>
                            </Select>

                            {/* Box shape fields */}
                            {(r.nodeBounds?.shape ?? "box") === "box" && (
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                                        gap: 6,
                                    }}
                                >
                                    <label>
                                        Width
                                        <NumberInput
                                            value={r.nodeBounds?.width ?? r.size?.[0] ?? 3}
                                            onChange={(v) =>
                                                setRoom(r.id, {
                                                    nodeBounds: {
                                                        ...(r.nodeBounds || {}),
                                                        width: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Height
                                        <NumberInput
                                            value={r.nodeBounds?.height ?? r.size?.[1] ?? 1.6}
                                            onChange={(v) =>
                                                setRoom(r.id, {
                                                    nodeBounds: {
                                                        ...(r.nodeBounds || {}),
                                                        height: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Depth
                                        <NumberInput
                                            value={r.nodeBounds?.depth ?? r.size?.[2] ?? 2.2}
                                            onChange={(v) =>
                                                setRoom(r.id, {
                                                    nodeBounds: {
                                                        ...(r.nodeBounds || {}),
                                                        depth: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </div>
                            )}

                            {/* Circle shape */}
                            {(r.nodeBounds?.shape ?? "box") === "circle" && (
                                <label>
                                    Radius
                                    <NumberInput
                                        value={
                                            r.nodeBounds?.radius ??
                                            Math.min(...(r.size || [3, 1.6, 2.2])) / 2
                                        }
                                        onChange={(v) =>
                                            setRoom(r.id, {
                                                nodeBounds: {
                                                    ...(r.nodeBounds || {}),
                                                    radius: v,
                                                },
                                            })
                                        }
                                    />
                                </label>
                            )}

                            <label>
                                Padding
                                <NumberInput
                                    value={r.nodeBounds?.padding ?? 0}
                                    onChange={(v) =>
                                        setRoom(r.id, {
                                            nodeBounds: {
                                                ...(r.nodeBounds || {}),
                                                padding: v,
                                            },
                                        })
                                    }
                                />
                            </label>

                            <Checkbox
                                label="Show Boundary"
                                checked={r.nodeBounds?.showBoundary ?? false}
                                onChange={(v) =>
                                    setRoom(r.id, {
                                        nodeBounds: {
                                            ...(r.nodeBounds || {}),
                                            showBoundary: v,
                                        },
                                    })
                                }
                            />
                        </>
                    )}
                </Panel>

                {/* Room Surfaces */}
                <div
                    style={{
                        borderTop: "1px dashed rgba(255,255,255,0.2)",
                        paddingTop: 8,
                        marginTop: 8,
                    }}
                >
                    <div
                        style={{
                            fontWeight: 800,
                            marginBottom: 6,
                        }}
                    >
                        Room Surfaces
                    </div>

                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, 1fr)",
                            gap: 8,
                        }}
                    >
                        <label>
                            Floor{" "}
                            <Checkbox
                                checked={r.floor ?? true}
                                onChange={(v) =>
                                    setRoom(r.id, { floor: v })
                                }
                            />
                        </label>
                        <label>
                            Ceiling{" "}
                            <Checkbox
                                checked={r.ceiling ?? true}
                                onChange={(v) =>
                                    setRoom(r.id, { ceiling: v })
                                }
                            />
                        </label>
                    </div>

                    <div
                        style={{
                            fontWeight: 700,
                            marginTop: 8,
                        }}
                    >
                        Walls
                    </div>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(4, 1fr)",
                            gap: 8,
                        }}
                    >
                        <label>
                            N{" "}
                            <Checkbox
                                checked={r.wallN ?? true}
                                onChange={(v) =>
                                    setRoom(r.id, { wallN: v })
                                }
                            />
                        </label>
                        <label>
                            S{" "}
                            <Checkbox
                                checked={r.wallS ?? true}
                                onChange={(v) =>
                                    setRoom(r.id, { wallS: v })
                                }
                            />
                        </label>
                        <label>
                            E{" "}
                            <Checkbox
                                checked={r.wallE ?? true}
                                onChange={(v) =>
                                    setRoom(r.id, { wallE: v })
                                }
                            />
                        </label>
                        <label>
                            W{" "}
                            <Checkbox
                                checked={r.wallW ?? true}
                                onChange={(v) =>
                                    setRoom(r.id, { wallW: v })
                                }
                            />
                        </label>
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
                            Solid 3D walls
                            <Checkbox
                                checked={r.wallsSolid ?? false}
                                onChange={(v) =>
                                    setRoom(r.id, {
                                        wallsSolid: v,
                                    })
                                }
                            />
                        </label>
                        <label>
                            Thickness
                            <Slider
                                value={r.wallThickness ?? 0.05}
                                min={0.005}
                                max={Math.max(
                                    0.2,
                                    (r.size?.[0] ?? 1) / 4,
                                    (r.size?.[2] ?? 1) / 4,
                                )}
                                step={0.005}
                                onChange={(v) =>
                                    setRoom(r.id, {
                                        wallThickness: v,
                                    })
                                }
                            />
                        </label>
                    </div>

                    <label style={{ marginTop: 8 }}>
                        Wireframe with Global
                        <Checkbox
                            checked={r.wireWithGlobal ?? false}
                            onChange={(v) =>
                                setRoom(r.id, {
                                    wireWithGlobal: v,
                                })
                            }
                        />
                    </label>
                </div>

                {/* Door Gap */}
                <div
                    style={{
                        borderTop: "1px dashed rgba(255,255,255,0.2)",
                        paddingTop: 8,
                        marginTop: 8,
                    }}
                >
                    <div
                        style={{
                            fontWeight: 800,
                            marginBottom: 6,
                        }}
                    >
                        Door Gap
                    </div>

                    <label>
                        Enabled
                        <Checkbox
                            checked={r.gap?.enabled ?? false}
                            onChange={(v) =>
                                setRoom(r.id, {
                                    gap: { ...(r.gap || {}), enabled: v },
                                })
                            }
                        />
                    </label>

                    {r.gap?.enabled && (
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 8,
                            }}
                        >
                            <label>
                                Wall
                                <Select
                                    value={r.gap?.wall ?? "north"}
                                    onChange={(e) =>
                                        setRoom(r.id, {
                                            gap: {
                                                ...(r.gap || {}),
                                                wall: e.target.value,
                                            },
                                        })
                                    }
                                >
                                    <option value="north">
                                        north
                                    </option>
                                    <option value="south">
                                        south
                                    </option>
                                    <option value="east">east</option>
                                    <option value="west">west</option>
                                </Select>
                            </label>
                            {(() => {
                                const wall = r.gap?.wall ?? "north";
                                const wallLength =
                                    wall === "north" ||
                                    wall === "south"
                                        ? r.size?.[0] ?? 1
                                        : r.size?.[2] ?? 1;
                                const maxW = Math.max(
                                    0.01,
                                    wallLength - 0.01,
                                );
                                const maxH = Math.max(
                                    0.01,
                                    (r.size?.[1] ?? 1) - 0.01,
                                );
                                return (
                                    <>
                                        <label>
                                            Width
                                            <Slider
                                                value={
                                                    r.gap?.width ??
                                                    Math.min(
                                                        1,
                                                        wallLength *
                                                        0.33,
                                                    )
                                                }
                                                min={0}
                                                max={maxW}
                                                step={0.01}
                                                onChange={(v) =>
                                                    setRoom(r.id, {
                                                        gap: {
                                                            ...(r.gap ||
                                                                {}),
                                                            width: v,
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Height
                                            <Slider
                                                value={
                                                    r.gap?.height ??
                                                    Math.min(
                                                        1,
                                                        (r.size?.[1] ??
                                                            1) * 0.66,
                                                    )
                                                }
                                                min={0}
                                                max={maxH}
                                                step={0.01}
                                                onChange={(v) =>
                                                    setRoom(r.id, {
                                                        gap: {
                                                            ...(r.gap ||
                                                                {}),
                                                            height: v,
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </div>

                {r.wallsSolid && (
                    <label>
                        Wall Thickness
                        <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={r.wallThickness ?? 0.06}
                            onChange={(e) =>
                                setRoom(r.id, {
                                    wallThickness: Math.max(
                                        0.01,
                                        Number(e.target.value) ||
                                        0.06,
                                    ),
                                })
                            }
                        />
                    </label>
                )}

                <Btn onClick={() => duplicateRoom(r.id)}>
                    Duplicate Room
                </Btn>

                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: 8,
                    }}
                >
                    <Btn
                        onClick={() =>
                            requestDelete({
                                type: "room",
                                id: r.id,
                            })
                        }
                    >
                        Delete Room
                    </Btn>
                </div>
            </div>
        </Panel>
    );
}

/* ---------- LINK INSPECTOR ---------- */

function LinkInspector({ link: l, setLinks, requestDelete }) {
    if (!l) return null;

    const update = (patch) => {
        setLinks((prev) =>
            prev.map((x) =>
                x.id === l.id ? { ...x, ...patch } : x,
            ),
        );
    };

    return (
        <Panel title="Link Inspector">
            <div style={{ display: "grid", gap: 8 }}>
                <label>
                    Style
                    <Select
                        value={l.style || "particles"}
                        onChange={(e) =>
                            update({ style: e.target.value })
                        }
                    >
                        <option value="particles">particles</option>
                        <option value="wavy">wavy</option>
                        <option value="icons">icons</option>
                        <option value="sweep">sweep</option>
                        <option value="packet">packet</option>
                        <option value="dashed">dashed</option>
                        <option value="solid">solid</option>
                        <option value="epic">epic</option>
                        <option value="cable">cable</option>
                    </Select>
                </label>

                <label>
                    Active{" "}
                    <Checkbox
                        checked={!!l.active}
                        onChange={(v) => update({ active: v })}
                    />
                </label>

                <label>
                    Speed
                    <Slider
                        value={l.speed ?? 0.9}
                        min={0}
                        max={4}
                        step={0.05}
                        onChange={(v) => update({ speed: v })}
                    />
                </label>

                <label>
                    Width (for lines)
                    <Slider
                        value={l.width ?? 2}
                        min={1}
                        max={6}
                        step={0.1}
                        onChange={(v) => update({ width: v })}
                    />
                </label>

                <label>
                    Color
                    <Input
                        type="color"
                        value={l.color || "#7cf"}
                        onChange={(e) =>
                            update({ color: e.target.value })
                        }
                    />
                </label>

                {/* Curve */}
                <div
                    style={{
                        borderTop: "1px dashed rgba(255,255,255,0.2)",
                        paddingTop: 6,
                        marginTop: 6,
                    }}
                >
                    <div
                        style={{
                            fontWeight: 800,
                            marginBottom: 6,
                        }}
                    >
                        Curve
                    </div>
                    <label>
                        Mode
                        <Select
                            value={l.curve?.mode || "up"}
                            onChange={(e) =>
                                update({
                                    curve: {
                                        ...(l.curve || {}),
                                        mode: e.target.value,
                                    },
                                })
                            }
                        >
                            <option value="straight">
                                straight
                            </option>
                            <option value="up">up</option>
                            <option value="side">side</option>
                        </Select>
                    </label>
                    <label>
                        Bend
                        <Slider
                            value={l.curve?.bend ?? 0.3}
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={(v) =>
                                update({
                                    curve: {
                                        ...(l.curve || {}),
                                        bend: v,
                                    },
                                })
                            }
                        />
                    </label>
                </div>

                {(l.style === "particles" ||
                    l.style === "wavy") && (
                    <>
                        <label>
                            Particle Count
                            <Slider
                                value={l.particles?.count ?? 10}
                                min={1}
                                max={80}
                                step={1}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            count: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Particle Size
                            <Slider
                                value={l.particles?.size ?? 0.06}
                                min={0.02}
                                max={0.3}
                                step={0.01}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            size: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Opacity
                            <Slider
                                value={l.particles?.opacity ?? 1}
                                min={0.1}
                                max={1}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            opacity: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Wave Amplitude
                            <Slider
                                value={
                                    l.particles?.waveAmp ??
                                    (l.style === "wavy"
                                        ? 0.15
                                        : 0)
                                }
                                min={0}
                                max={0.6}
                                step={0.01}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            waveAmp: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Wave Frequency
                            <Slider
                                value={l.particles?.waveFreq ?? 2}
                                min={0.2}
                                max={8}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            waveFreq: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Shape
                            <Select
                                value={
                                    l.particles?.shape || "sphere"
                                }
                                onChange={(e) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            shape: e.target.value,
                                        },
                                    })
                                }
                            >
                                <option value="sphere">
                                    sphere
                                </option>
                                <option value="box">box</option>
                                <option value="octa">octa</option>
                            </Select>
                        </label>
                    </>
                )}

                {l.style === "epic" && (
                    <>
                        <label>
                            Tube Thickness
                            <Slider
                                value={l.tube?.thickness ?? 0.06}
                                min={0.02}
                                max={0.25}
                                step={0.005}
                                onChange={(v) =>
                                    update({
                                        tube: {
                                            ...(l.tube || {}),
                                            thickness: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Tube Glow
                            <Slider
                                value={l.tube?.glow ?? 1.3}
                                min={0}
                                max={3}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        tube: {
                                            ...(l.tube || {}),
                                            glow: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Trail Particles
                            <Checkbox
                                checked={
                                    (l.tube?.trail ?? true) === true
                                }
                                onChange={(v) =>
                                    update({
                                        tube: {
                                            ...(l.tube || {}),
                                            trail: v,
                                        },
                                    })
                                }
                                label="enabled"
                            />
                        </label>
                    </>
                )}

                {l.style === "packet" && (
                    <>
                        <div style={{
                            marginTop: 10,
                            paddingTop: 10,
                            borderTop: "1px dashed rgba(255,255,255,0.15)",
                            fontWeight: 900,
                        }}>
                            Packet
                        </div>

                        <label>
                            Packet Style
                            <Select
                                value={l.packet?.style || "orb"}
                                onChange={(e) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            style: e.target.value,
                                        },
                                    })
                                }
                            >
                                <option value="orb">orb</option>
                                <option value="cube">cube</option>
                                <option value="diamond">diamond</option>
                                <option value="ring">ring</option>
                                <option value="spark">spark</option>
                                <option value="waves">waves</option>
                                <option value="envelope">envelope</option>
                                <option value="text">text</option>
                            </Select>
                        </label>

                        {(l.packet?.style === "text" || l.packet?.style === "envelope") && (
                            <label>
                                Packet Text
                                <input
                                    value={l.packet?.text ?? "PKT"}
                                    onChange={(e) =>
                                        update({
                                            packet: {
                                                ...(l.packet || {}),
                                                text: e.target.value,
                                            },
                                        })
                                    }
                                    style={{ width: "100%" }}
                                />
                            </label>
                        )}

                        <label>
                            Color
                            <input
                                type="color"
                                value={l.packet?.color || l.color || "#7cf"}
                                onChange={(e) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            color: e.target.value,
                                        },
                                    })
                                }
                            />
                        </label>

                        <label>
                            Size
                            <Slider
                                value={l.packet?.size ?? 0.14}
                                min={0.03}
                                max={0.6}
                                step={0.01}
                                onChange={(v) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            size: v,
                                        },
                                    })
                                }
                            />
                        </label>

                        <label>
                            Opacity
                            <Slider
                                value={l.packet?.opacity ?? 1}
                                min={0}
                                max={1}
                                step={0.02}
                                onChange={(v) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            opacity: v,
                                        },
                                    })
                                }
                            />
                        </label>

                        <label>
                            Billboard
                            <Checkbox
                                checked={(l.packet?.billboard ?? true) === true}
                                onChange={(v) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            billboard: v,
                                        },
                                    })
                                }
                                label="face camera"
                            />
                        </label>

                        <div style={{
                            marginTop: 10,
                            paddingTop: 10,
                            borderTop: "1px dashed rgba(255,255,255,0.15)",
                            fontWeight: 900,
                        }}>
                            Packet Path
                        </div>

                        <label>
                            Path Mode
                            <Select
                                value={l.packet?.path?.mode || "hidden"}
                                onChange={(e) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            path: {
                                                ...((l.packet || {}).path || {}),
                                                mode: e.target.value,
                                            },
                                        },
                                    })
                                }
                            >
                                <option value="hidden">hidden</option>
                                <option value="line">line</option>
                                <option value="dashed">dashed</option>
                                <option value="particles">particles</option>
                                <option value="sweep">sweep</option>
                            </Select>
                        </label>

                        <label>
                            Path Color
                            <input
                                type="color"
                                value={l.packet?.path?.color || l.packet?.color || l.color || "#7cf"}
                                onChange={(e) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            path: {
                                                ...((l.packet || {}).path || {}),
                                                color: e.target.value,
                                            },
                                        },
                                    })
                                }
                            />
                        </label>

                        <label>
                            Path Opacity
                            <Slider
                                value={l.packet?.path?.opacity ?? 0.2}
                                min={0}
                                max={1}
                                step={0.02}
                                onChange={(v) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            path: {
                                                ...((l.packet || {}).path || {}),
                                                opacity: v,
                                            },
                                        },
                                    })
                                }
                            />
                        </label>

                        <label>
                            Show path when selected
                            <Checkbox
                                checked={(l.packet?.path?.showWhenSelected ?? true) === true}
                                onChange={(v) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            path: {
                                                ...((l.packet || {}).path || {}),
                                                showWhenSelected: v,
                                            },
                                        },
                                    })
                                }
                                label="preview"
                            />
                        </label>

                        <div style={{
                            marginTop: 10,
                            paddingTop: 10,
                            borderTop: "1px dashed rgba(255,255,255,0.15)",
                            fontWeight: 900,
                        }}>
                            Timing
                        </div>

                        <label>
                            Travel time (s)
                            <Slider
                                value={l.packet?.timing?.travel ?? l.packet?.travel ?? 1.2}
                                min={0.05}
                                max={10}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            timing: {
                                                ...((l.packet || {}).timing || {}),
                                                travel: v,
                                            },
                                        },
                                    })
                                }
                            />
                        </label>

                        <label>
                            Start delay (s)
                            <Slider
                                value={l.packet?.timing?.delay ?? l.packet?.delay ?? 0}
                                min={0}
                                max={10}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            timing: {
                                                ...((l.packet || {}).timing || {}),
                                                delay: v,
                                            },
                                        },
                                    })
                                }
                            />
                        </label>

                        <div style={{ display: "flex", gap: 8 }}>
                            <label style={{ flex: 1 }}>
                                Packets
                                <Slider
                                    value={l.packet?.timing?.count ?? l.packet?.count ?? 1}
                                    min={1}
                                    max={50}
                                    step={1}
                                    onChange={(v) =>
                                        update({
                                            packet: {
                                                ...(l.packet || {}),
                                                timing: {
                                                    ...((l.packet || {}).timing || {}),
                                                    count: Math.round(v),
                                                },
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label style={{ flex: 1 }}>
                                Interval (s)
                                <Slider
                                    value={l.packet?.timing?.interval ?? l.packet?.interval ?? 0.35}
                                    min={0}
                                    max={5}
                                    step={0.05}
                                    onChange={(v) =>
                                        update({
                                            packet: {
                                                ...(l.packet || {}),
                                                timing: {
                                                    ...((l.packet || {}).timing || {}),
                                                    interval: v,
                                                },
                                            },
                                        })
                                    }
                                />
                            </label>
                        </div>

                        <div style={{ display: "flex", gap: 8 }}>
                            <label style={{ flex: 1 }}>
                                Loop
                                <Checkbox
                                    checked={(l.packet?.timing?.loop ?? l.packet?.loop ?? false) === true}
                                    onChange={(v) =>
                                        update({
                                            packet: {
                                                ...(l.packet || {}),
                                                timing: {
                                                    ...((l.packet || {}).timing || {}),
                                                    loop: v,
                                                },
                                            },
                                        })
                                    }
                                    label="repeat"
                                />
                            </label>
                            <label style={{ flex: 1 }}>
                                Loop gap (s)
                                <Slider
                                    value={l.packet?.timing?.loopGap ?? l.packet?.loopGap ?? 0.6}
                                    min={0}
                                    max={10}
                                    step={0.05}
                                    onChange={(v) =>
                                        update({
                                            packet: {
                                                ...(l.packet || {}),
                                                timing: {
                                                    ...((l.packet || {}).timing || {}),
                                                    loopGap: v,
                                                },
                                            },
                                        })
                                    }
                                />
                            </label>
                        </div>

                        <div style={{
                            marginTop: 10,
                            paddingTop: 10,
                            borderTop: "1px dashed rgba(255,255,255,0.15)",
                            fontWeight: 900,
                        }}>
                            On Arrival
                        </div>

                        <label>
                            Success Effect
                            <Select
                                value={l.packet?.success?.mode || "pulse"}
                                onChange={(e) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            success: {
                                                ...((l.packet || {}).success || {}),
                                                mode: e.target.value,
                                            },
                                        },
                                    })
                                }
                            >
                                <option value="pulse">pulse</option>
                                <option value="spark">spark</option>
                                <option value="explosion">explosion</option>
                            </Select>
                        </label>

                        <label>
                            Success Color
                            <input
                                type="color"
                                value={l.packet?.success?.color || l.packet?.color || l.color || "#7cf"}
                                onChange={(e) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            success: {
                                                ...((l.packet || {}).success || {}),
                                                color: e.target.value,
                                            },
                                        },
                                    })
                                }
                            />
                        </label>

                        <label>
                            Success Size
                            <Slider
                                value={l.packet?.success?.size ?? 0.6}
                                min={0.05}
                                max={3}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            success: {
                                                ...((l.packet || {}).success || {}),
                                                size: v,
                                            },
                                        },
                                    })
                                }
                            />
                        </label>

                        <label>
                            Success Duration (s)
                            <Slider
                                value={l.packet?.success?.duration ?? 0.5}
                                min={0.05}
                                max={4}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        packet: {
                                            ...(l.packet || {}),
                                            success: {
                                                ...((l.packet || {}).success || {}),
                                                duration: v,
                                            },
                                        },
                                    })
                                }
                            />
                        </label>

                        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                            <Btn
                                onClick={() => {
                                    try {
                                        window.dispatchEvent(
                                            new CustomEvent("EPIC3D_PACKET_CTRL", {
                                                detail: { action: "start", linkId: l.id, overrides: {} },
                                            }),
                                        );
                                    } catch {}
                                }}
                            >
                                Start Packet
                            </Btn>
                            <Btn
                                onClick={() => {
                                    try {
                                        window.dispatchEvent(
                                            new CustomEvent("EPIC3D_PACKET_CTRL", {
                                                detail: { action: "stop", linkId: l.id },
                                            }),
                                        );
                                    } catch {}
                                }}
                            >
                                Stop Packet
                            </Btn>
                        </div>
                    </>
                )}

                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: 8,
                    }}
                >
                    <Btn
                        onClick={() =>
                            requestDelete({
                                type: "link",
                                id: l.id,
                            })
                        }
                    >
                        Delete Link
                    </Btn>
                </div>
            </div>
        </Panel>
    );
}

// ui/EditorRightPane.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { Panel, Btn, Input as BaseInput, Select, Checkbox, Slider } from "./Controls.jsx";
import { DEFAULT_CLUSTERS } from "../utils/clusters.js";
import { OutgoingLinksEditor } from "../Interactive3DNodeShowcase.helpers.hud.jsx";
import { RepresentativePanel } from "../Interactive3DNodeShowcase.helpers.editor.jsx";
import { STATIC_SHAPES } from "../data/shapes/registry.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ---------------- Light profile clipboard (Copy/Paste) ----------------
// Stored in memory + localStorage so you can copy on one node and paste on another.
const LIGHT_PROFILE_CLIPBOARD_KEY = "epic3d.lightProfileClipboard.v1";
let __lightProfileClipboard = null;
const NODE_INSPECTOR_TAB_KEY = "epic3d.nodeInspectorTab.v1";
let __nodeInspectorTab = "node";
const LINK_SET_DEFAULT_ID = "ls-a";
const LINK_SET_DEFAULT_NAME = "Set A";
const ROOM_TYPE_OPTIONS = ["Owner", "Guest", "Crew", "Rack Room"];
const INSPECTOR_TEXT_DEFER_MS = 120;
const normalizeAnchorBendDeg = (v) => {
    const n = Number(v) || 0;
    if (n <= 0) return 0;
    return n >= 67.5 ? 90 : 45;
};

const __isTextLikeInputType = (type) => {
    const t = String(type || "text").toLowerCase();
    return (
        t === "text" ||
        t === "search" ||
        t === "email" ||
        t === "url" ||
        t === "tel" ||
        t === "password"
    );
};

const Input = React.memo(function InspectorInput({
    deferText = true,
    deferTextMs = INSPECTOR_TEXT_DEFER_MS,
    onChange,
    onBlur,
    onFocus,
    onCompositionStart,
    onCompositionEnd,
    value,
    ...props
}) {
    const textLike = deferText && __isTextLikeInputType(props?.type);
    const [draft, setDraft] = useState(() => (value == null ? "" : String(value)));
    const draftRef = useRef(value == null ? "" : String(value));
    const timerRef = useRef(null);
    const focusedRef = useRef(false);
    const composingRef = useRef(false);
    const onChangeRef = useRef(onChange);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!textLike || focusedRef.current) return;
        const next = value == null ? "" : String(value);
        draftRef.current = next;
        setDraft(next);
    }, [textLike, value]);

    const emitChange = useCallback((nextValue, sourceEvent) => {
        const cb = onChangeRef.current;
        if (!cb) return;
        const eventLike = {
            ...sourceEvent,
            target: { ...(sourceEvent?.target || {}), value: nextValue },
            currentTarget: { ...(sourceEvent?.currentTarget || {}), value: nextValue },
        };
        if (typeof React.startTransition === "function") {
            React.startTransition(() => cb(eventLike));
        } else {
            cb(eventLike);
        }
    }, []);

    const flushPending = useCallback((sourceEvent) => {
        if (!textLike) return;
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (composingRef.current) return;
        emitChange(draftRef.current, sourceEvent);
    }, [emitChange, textLike]);

    const handleChange = useCallback((e) => {
        if (!textLike) {
            onChange && onChange(e);
            return;
        }
        const next = e?.target?.value ?? "";
        draftRef.current = next;
        setDraft(next);
        if (composingRef.current) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            emitChange(next, e);
        }, Math.max(0, Number(deferTextMs) || 0));
    }, [deferTextMs, emitChange, onChange, textLike]);

    const handleFocus = useCallback((e) => {
        focusedRef.current = true;
        onFocus && onFocus(e);
    }, [onFocus]);

    const handleBlur = useCallback((e) => {
        focusedRef.current = false;
        flushPending(e);
        onBlur && onBlur(e);
    }, [flushPending, onBlur]);

    const handleCompositionStart = useCallback((e) => {
        composingRef.current = true;
        onCompositionStart && onCompositionStart(e);
    }, [onCompositionStart]);

    const handleCompositionEnd = useCallback((e) => {
        composingRef.current = false;
        if (textLike) {
            const next = e?.target?.value ?? draftRef.current;
            draftRef.current = next;
            setDraft(next);
            flushPending(e);
        }
        onCompositionEnd && onCompositionEnd(e);
    }, [flushPending, onCompositionEnd, textLike]);

    const effectiveValue = textLike ? draft : value;

    return (
        <BaseInput
            {...props}
            value={effectiveValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
        />
    );
});

const __linkAlphaLabel = (index) => {
    let n = Math.max(0, Number(index) || 0);
    if (!n) return "A";
    let label = "";
    while (n > 0) {
        n -= 1;
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26);
    }
    return label || "A";
};

const __normalizeLinkSetLabel = (label) => String(label || "").trim().toLowerCase();

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


// ---------------- Text box clipboard (Copy/Paste) ----------------
const TEXTBOX_CLIPBOARD_KEY = "epic3d.textBoxClipboard.v1";
let __textBoxClipboard = null;

function __loadTextBoxClipboard() {
    if (__textBoxClipboard) return __textBoxClipboard;
    try {
        const raw = localStorage.getItem(TEXTBOX_CLIPBOARD_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        __textBoxClipboard = parsed;
        return parsed;
    } catch {
        return null;
    }
}

function __saveTextBoxClipboard(profile) {
    __textBoxClipboard = profile ? __deepClone(profile) : null;
    try {
        if (!profile) localStorage.removeItem(TEXTBOX_CLIPBOARD_KEY);
        else localStorage.setItem(TEXTBOX_CLIPBOARD_KEY, JSON.stringify(profile));
    } catch {}
}

function __pickTextBoxProfileFromNode(node) {
    const tb = node?.textBox && typeof node.textBox === "object" ? node.textBox : {};
    return {
        __kind: "textBoxProfile",
        __v: 1,
        textBox: __deepClone(tb) || {},
    };
}

function __applyTextBoxProfileToNode({ nodeId, profile, setNodeById }) {
    if (!nodeId || !profile || typeof profile !== "object") return;
    const tb = profile.textBox && typeof profile.textBox === "object" ? profile.textBox : {};
    setNodeById(nodeId, () => {
        return {
            textBox: { ...(__deepClone(tb) || {}), enabled: true },
        };
    });
}

// ---------------- Room label style clipboard (Copy/Paste) ----------------
const ROOM_LABEL_PROFILE_CLIPBOARD_KEY = "epic3d.roomLabelProfileClipboard.v1";
let __roomLabelProfileClipboard = null;

function __loadRoomLabelProfileClipboard() {
    if (__roomLabelProfileClipboard) return __roomLabelProfileClipboard;
    try {
        const raw = localStorage.getItem(ROOM_LABEL_PROFILE_CLIPBOARD_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        __roomLabelProfileClipboard = parsed;
        return parsed;
    } catch {
        return null;
    }
}

function __saveRoomLabelProfileClipboard(profile) {
    __roomLabelProfileClipboard = profile ? __deepClone(profile) : null;
    try {
        if (!profile) localStorage.removeItem(ROOM_LABEL_PROFILE_CLIPBOARD_KEY);
        else localStorage.setItem(ROOM_LABEL_PROFILE_CLIPBOARD_KEY, JSON.stringify(profile));
    } catch {}
}

function __pickRoomLabelProfileFromRoom(room) {
    if (!room || typeof room !== "object") return null;
    const keys = [
        "labelMode",
        "labelSize",
        "labelMaxWidth",
        "labelWrap",
        "labelAlign",
        "labelColor",
        "labelOutline",
        "labelOutlineWidth",
        "labelOutlineColor",
        "labelOutlineBlur",
        "labelFillOpacity",
        "labelFont",
        "labelLetterSpacing",
        "labelLineHeight",
        "label3DLayers",
        "label3DStep",
    ];
    const label = {};
    for (const k of keys) {
        if (room[k] !== undefined) label[k] = __deepClone(room[k]);
    }
    return {
        __kind: "roomLabelProfile",
        __v: 1,
        label,
    };
}

function __applyRoomLabelProfileToRoom({ roomId, profile, setRoom }) {
    if (!roomId || !profile || typeof profile !== "object") return;
    const label = profile.label && typeof profile.label === "object" ? profile.label : null;
    if (!label) return;
    setRoom(roomId, __deepClone(label));
}

// ---------------- Node profile clipboard (Copy/Paste) ----------------
const NODE_PROFILE_CLIPBOARD_KEY = "epic3d.nodeProfileClipboard.v1";
let __nodeProfileClipboard = null;

function __loadNodeProfileClipboard() {
    if (__nodeProfileClipboard) return __nodeProfileClipboard;
    try {
        const raw = localStorage.getItem(NODE_PROFILE_CLIPBOARD_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        __nodeProfileClipboard = parsed;
        return parsed;
    } catch {
        return null;
    }
}

function __saveNodeProfileClipboard(profile) {
    __nodeProfileClipboard = profile ? __deepClone(profile) : null;
    try {
        if (!profile) localStorage.removeItem(NODE_PROFILE_CLIPBOARD_KEY);
        else localStorage.setItem(NODE_PROFILE_CLIPBOARD_KEY, JSON.stringify(profile));
    } catch {}
}

function __pickNodeProfileFromNode(node) {
    if (!node || typeof node !== "object") return null;
    const clone = __deepClone(node) || {};
    delete clone.id;
    return {
        __kind: "nodeProfile",
        __v: 1,
        node: clone,
    };
}

function __applyNodeProfileToNode({ nodeId, profile, setNodeById, includeLocation }) {
    if (!nodeId || !profile || typeof profile !== "object") return;
    const data = profile.node && typeof profile.node === "object" ? __deepClone(profile.node) : null;
    if (!data) return;
    delete data.id;
    if (!includeLocation) {
        delete data.position;
    }
    setNodeById(nodeId, (cur) => {
        const base = cur || {};
        const next = { ...base, ...data };
        if (!includeLocation) {
            next.position = base.position;
        }
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
                                            selectedMulti,
                                            selectionMode,
                                            selectedFlowAnchor,
                                            rooms,
                                            decks,
                                            nodes,
                                            links,
                                            setNode,
                                            setNodeById,
                                            setLightEnabled,
                                            setRoom,
                                            addRoomNodes,
                                            duplicateRoom,
                                            duplicateNodeWithLinks,
                                            requestDelete,
                                            mode,
                                            setMode,
                                            setMoveMode,
                                            setTransformMode,
                                            setSelected,
                                            roomOpacity,
                                            setRoomOpacity,
                                            setLinks,
                                            selectedBreakpoint,
                                            setSelectedBreakpoint,
                                            setLinkFromId,   // 🔹 NEW
                                            multiLinkMode,
                                            setMultiLinkMode,
                                            setSelectedFlowAnchor,
                                            levelFromNodeId,       // 👈 NEW
                                            setLevelFromNodeId,    // 👈 NEW
                                            levelAxis,             // 👈 NEW
                                            setLevelAxis,          // 👈 NEW
                                            reassignFlowLinkId,
                                            startReassignFlow,
                                            cancelReassignFlow,
                                            onMultiMasterChange,
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

    const multiSelection = Array.isArray(selectedMulti) ? selectedMulti : [];
    const multiNodes = multiSelection.filter((it) => it?.type === "node");
    const multiRooms = multiSelection.filter((it) => it?.type === "room");
    const hasMultiSelection =
        multiSelection.length > 1 && (multiNodes.length > 0 || multiRooms.length > 0);


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

    if (hasMultiSelection) {
        typePill = "Multi";
        headerSubtitle = `Multi selection: ${multiNodes.length} node(s), ${multiRooms.length} room(s)`;
    } else if (selectedNode) {
        typePill = (String(selectedNode.kind || "node").toLowerCase() === "switch") ? "Switch" : (String(selectedNode.kind || "node").toLowerCase() === "dissolver" ? "Dissolver" : "Node");
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
        maxWidth: "min(980px, calc(100vw - 32px))",
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
                {!hasMultiSelection && !selectedNode && !selectedRoom && !selectedLink && (
                    <Panel title="Inspector">
                        <div style={{ fontSize: 13, opacity: 0.85 }}>
                            Select a node, room, or link in the scene to edit
                            its properties here.
                        </div>
                    </Panel>
                )}

                {hasMultiSelection && (
                    <MultiInspector
                        multiNodes={multiNodes}
                        multiRooms={multiRooms}
                        selectionMode={selectionMode}
                        nodes={nodes}
                        links={links}
                        rooms={rooms}
                        decks={decks}
                        setRoom={setRoom}
                        setNodeById={setNodeById}
                        setLinks={setLinks}
                        setSelected={setSelected}
                        mode={mode}
                        setMode={setMode}
                        setLinkFromId={setLinkFromId}
                        multiLinkMode={multiLinkMode}
                        setMultiLinkMode={setMultiLinkMode}
                        onMultiMasterChange={onMultiMasterChange}
                    />
                )}

                {!hasMultiSelection && selectedNode && (
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
                        duplicateNodeWithLinks={duplicateNodeWithLinks}
                        mode={mode}
                        setMode={setMode}
                        setMoveMode={setMoveMode}
                        setTransformMode={setTransformMode}
                        setSelected={setSelected}
                        requestDelete={requestDelete}
                        selectedBreakpoint={selectedBreakpoint}
                        setSelectedBreakpoint={setSelectedBreakpoint}
                        selectedFlowAnchor={selectedFlowAnchor}
                        setSelectedFlowAnchor={setSelectedFlowAnchor}
                        setLinkFromId={setLinkFromId}   // 🔹 NEW
                        levelFromNodeId={levelFromNodeId}         // 👈 NEW
                        setLevelFromNodeId={setLevelFromNodeId}   // 👈 NEW
                        levelAxis={levelAxis}                     // 👈 NEW
                        setLevelAxis={setLevelAxis}               // 👈 NEW
                        reassignFlowLinkId={reassignFlowLinkId}
                        startReassignFlow={startReassignFlow}
                        cancelReassignFlow={cancelReassignFlow}
                        actions={actions}
                        ActionsPanel={ActionsPanel}
                    />
                )}

                {!hasMultiSelection && selectedRoom && !selectedNode && (
                    <RoomInspector
                        room={selectedRoom}
                        decks={decks}
                        roomOpacity={roomOpacity}
                        setRoomOpacity={setRoomOpacity}
                        setRoom={setRoom}
                        addRoomNodes={addRoomNodes}
                        duplicateRoom={duplicateRoom}
                        requestDelete={requestDelete}
                        nodes={nodes}
                        setNodeById={setNodeById}
                    />
                )}

                {!hasMultiSelection && selectedLink && !selectedNode && !selectedRoom && (
                    <LinkInspector
                        link={selectedLink}
                        nodes={nodes}
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

/* ---------- MULTI INSPECTOR ---------- */
function MultiInspector({
                           multiNodes,
                           multiRooms,
                           selectionMode,
                           nodes,
                           links,
                            rooms,
                            decks,
                            setRoom,
                            setNodeById,
                            setLinks,
                            setSelected,
                            mode,
                            setMode,
                            setLinkFromId,
                            multiLinkMode,
                            setMultiLinkMode,
                            onMultiMasterChange,
}) {
    const [showReassign, setShowReassign] = useState(false);
    const [assignRoomId, setAssignRoomId] = useState("");
    const [assignDeckId, setAssignDeckId] = useState("");

    const linkActive = !!multiLinkMode && mode === "link";
    const canLink = (multiNodes || []).length > 0;
    const isBoxSelection = selectionMode === "box";
    const selectedNodeIds = useMemo(
        () => (multiNodes || []).map((n) => n?.id).filter(Boolean),
        [multiNodes],
    );
    const selectedNodes = useMemo(
        () => (selectedNodeIds || []).map((id) => (nodes || []).find((n) => n?.id === id)).filter(Boolean),
        [selectedNodeIds, nodes],
    );
    const shapeKindOf = useCallback((shape) => {
        const raw = typeof shape === "string" ? shape : shape?.type;
        return String(raw || "sphere").toLowerCase();
    }, []);
    const selectedShapeKinds = useMemo(() => {
        const set = new Set();
        (selectedNodes || []).forEach((n) => {
            const kind = shapeKindOf(n?.shape);
            if (kind) set.add(kind);
        });
        return Array.from(set);
    }, [selectedNodes, shapeKindOf]);
    const applyBulkRotation = (axis, degrees) => {
        if (!setNodeById) return;
        const val = Number(degrees);
        if (!Number.isFinite(val)) return;
        const rad = (val * Math.PI) / 180;
        (selectedNodeIds || []).forEach((id) => {
            if (!id) return;
            setNodeById(id, (cur) => {
                const r = Array.isArray(cur?.rotation) ? [...cur.rotation] : [0, 0, 0];
                r[axis] = rad;
                return { rotation: r };
            });
        });
    };

    const applyBulkScale = () => {
        if (!setNodeById) return;
        const val = Number(bulkScale);
        if (!Number.isFinite(val)) return;
        (selectedNodeIds || []).forEach((id) => {
            if (!id) return;
            setNodeById(id, (cur) => ({
                ...(cur || {}),
                shape: {
                    ...(cur?.shape || {}),
                    scale: val,
                },
            }));
        });
    };

    const applyBulkDimensions = (targetKind) => {
        if (!setNodeById) return;
        const kindTarget = String(targetKind || "").toLowerCase();
        const w = bulkDimsDirty.w ? Number(bulkDims.w) : null;
        const h = bulkDimsDirty.h ? Number(bulkDims.h) : null;
        const d = bulkDimsDirty.d ? Number(bulkDims.d) : null;
        const r = bulkRadiusDirty ? Number(bulkRadius) : null;
        const h2 = bulkHeightDirty ? Number(bulkHeight) : null;
        if (bulkDimsDirty.w && !Number.isFinite(w)) return;
        if (bulkDimsDirty.h && !Number.isFinite(h)) return;
        if (bulkDimsDirty.d && !Number.isFinite(d)) return;
        if (bulkRadiusDirty && !Number.isFinite(r)) return;
        if (bulkHeightDirty && !Number.isFinite(h2)) return;
        if (!bulkDimsDirty.w && !bulkDimsDirty.h && !bulkDimsDirty.d && !bulkRadiusDirty && !bulkHeightDirty) return;

        (selectedNodeIds || []).forEach((id) => {
            if (!id) return;
            setNodeById(id, (cur) => {
                const base = cur || {};
                const shapeRaw = base.shape;
                const shape = typeof shapeRaw === "object" && shapeRaw ? { ...shapeRaw } : (shapeRaw ? { type: shapeRaw } : null);
                if (!shape) return base;
                const kind = shapeKindOf(shape);
                if (kindTarget && kind !== kindTarget) return base;
                const isSphere = kind === "sphere";
                const isRadial = ["cylinder", "cone", "disc", "hexagon", "accesspoint"].includes(kind);
                const isBox = kind === "box";
                const isWHd = ["box", "switch", "tv", "remote", "laviebox", "ipad", "speaker", "speakerfloor", "soundbar", "headphones", "subwoofer", "amplifier"].includes(kind);
                const isAmplifier = kind === "amplifier";

                if (isSphere) {
                    if (bulkRadiusDirty) shape.radius = r;
                }
                if (isRadial) {
                    if (bulkRadiusDirty) shape.radius = r;
                    if (bulkHeightDirty) shape.height = h2;
                }

                if (isBox) {
                    const current = Array.isArray(shape.scale)
                        ? [...shape.scale]
                        : [
                            shape.w ?? shape.width ?? 0.6,
                            shape.h ?? shape.height ?? 0.3,
                            shape.d ?? shape.depth ?? 0.6,
                        ];
                    if (bulkDimsDirty.w) current[0] = w;
                    if (bulkDimsDirty.h) current[1] = h;
                    if (bulkDimsDirty.d) current[2] = d;
                    shape.scale = current;
                }

                if (isWHd) {
                    if (bulkDimsDirty.w) {
                        if ("w" in shape) shape.w = w;
                        if ("width" in shape) shape.width = w;
                    }
                    if (bulkDimsDirty.h) {
                        if ("h" in shape) shape.h = h;
                        if ("height" in shape) shape.height = h;
                        if (isAmplifier) shape.baseH = h;
                    }
                    if (bulkDimsDirty.d) {
                        if ("d" in shape) shape.d = d;
                        if ("depth" in shape) shape.depth = d;
                    }
                }

                return { ...base, shape };
            });
        });
    };
    const getNodeLinkSets = useCallback((node) => {
        const sets = Array.isArray(node?.linkSets) ? node.linkSets : [];

        if (sets.length) return sets;
        return [{ id: LINK_SET_DEFAULT_ID, name: LINK_SET_DEFAULT_NAME }];
    }, []);
    const getNodeAnchorSets = useCallback((node) => {
        if (!node) return [];
        const sets = Array.isArray(node.flowAnchorSets) ? node.flowAnchorSets : [];
        if (sets.length) return sets;
        const legacy = Array.isArray(node.flowAnchors) ? node.flowAnchors : [];
        if (legacy.length) {
            return [{
                id: node.flowAnchorActiveSetId || "fas-default",
                name: "Default",
            }];
        }
        return [];
    }, []);
    const linkSetLabel = useCallback((set, idx) => {
        const name = String(set?.name ?? set?.label ?? "").trim();
        if (name) return name;
        if (set?.id === LINK_SET_DEFAULT_ID) return LINK_SET_DEFAULT_NAME;
        return `Set ${__linkAlphaLabel(idx + 1)}`;
    }, []);
    const anchorSetLabel = useCallback((set, idx) => {
        const name = String(set?.name ?? set?.label ?? "").trim();
        if (name) return name;
        if (set?.id) return `Anchor Set ${idx + 1}`;
        return "Anchor Set";
    }, []);
    const allLinkSetLabels = useMemo(() => {
        const labels = new Set();
        selectedNodes.forEach((node) => {
            const sets = getNodeLinkSets(node);
            sets.forEach((set, idx) => {
                const label = linkSetLabel(set, idx);
                if (label) labels.add(label);
            });
        });
        return Array.from(labels).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    }, [selectedNodes, getNodeLinkSets, linkSetLabel]);
    const allAnchorSetLabels = useMemo(() => {
        const labels = new Set();
        const nodeById = new Map((nodes || []).map((n) => [n?.id, n]));
        const selectedIds = new Set(selectedNodeIds);
        if (!selectedIds.size) return [];
        const candidateIds = new Set(selectedIds);
        (links || []).forEach((l) => {
            if (!l) return;
            if (selectedIds.has(l.from) || selectedIds.has(l.to)) {
                if (l.from) candidateIds.add(l.from);
                if (l.to) candidateIds.add(l.to);
            }
        });
        candidateIds.forEach((id) => {
            const node = nodeById.get(id);
            const sets = getNodeAnchorSets(node);
            sets.forEach((set, idx) => {
                const label = anchorSetLabel(set, idx);
                if (label) labels.add(label);
            });
        });
        return Array.from(labels).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    }, [nodes, links, selectedNodeIds, getNodeAnchorSets, anchorSetLabel]);
    const [multiLinkScope, setMultiLinkScope] = useState("all");
    const [multiLinkSetLabel, setMultiLinkSetLabel] = useState("");
    const [newLinkSetName, setNewLinkSetName] = useState("");
    const [reassignSetLabel, setReassignSetLabel] = useState("");
    const [bulkAnchorSetChoice, setBulkAnchorSetChoice] = useState("");
    const [bulkStyle, setBulkStyle] = useState("particles");
    const [bulkActive, setBulkActive] = useState(true);
    const [bulkSpeed, setBulkSpeed] = useState(0.9);
    const [bulkWidth, setBulkWidth] = useState(2);
    const [bulkColor, setBulkColor] = useState("#7cf");
    const [bulkCurveMode, setBulkCurveMode] = useState("up");
    const [bulkCurveBend, setBulkCurveBend] = useState(0.3);
    const [bulkParticlesCount, setBulkParticlesCount] = useState(10);
    const [bulkParticlesSize, setBulkParticlesSize] = useState(0.12);
    const [bulkParticlesOpacity, setBulkParticlesOpacity] = useState(1);
    const [bulkDashLength, setBulkDashLength] = useState(0.4);
    const [bulkDashGap, setBulkDashGap] = useState(0.25);
    const [bulkDashSpeed, setBulkDashSpeed] = useState(0.6);
    const [bulkDashOpacity, setBulkDashOpacity] = useState(1);
    const [bulkIconChar, setBulkIconChar] = useState("");
    const [bulkIconSize, setBulkIconSize] = useState(0.18);
    const [bulkIconSpacing, setBulkIconSpacing] = useState(0.35);
    const [bulkCableCount, setBulkCableCount] = useState(1);
    const [bulkCableSpread, setBulkCableSpread] = useState(0.12);
    const [bulkCableRough, setBulkCableRough] = useState(0.25);
    const [bulkCableScramble, setBulkCableScramble] = useState(0);
    const [bulkCableAnchor, setBulkCableAnchor] = useState(1);
    const [unlinkScope, setUnlinkScope] = useState("outgoing");
    const [bulkRoomWidth, setBulkRoomWidth] = useState("");
    const [bulkRoomHeight, setBulkRoomHeight] = useState("");
    const [bulkRoomLength, setBulkRoomLength] = useState("");
    const [bulkRoomDeckId, setBulkRoomDeckId] = useState("");
    const [bulkRoomDirty, setBulkRoomDirty] = useState({ x: false, y: false, z: false });
    const [useAlternateMaster, setUseAlternateMaster] = useState(false);
    const [alternateMasterId, setAlternateMasterId] = useState("");
    const [alternateMasterFilter, setAlternateMasterFilter] = useState("");
    const [multiTab, setMultiTab] = useState("links");
    const [alignAxis, setAlignAxis] = useState({ x: true, y: false, z: true });
    const [bulkRotateDeg, setBulkRotateDeg] = useState({ x: "", y: "", z: "" });
    const [bulkScale, setBulkScale] = useState("");
    const [bulkDims, setBulkDims] = useState({ w: "", h: "", d: "" });
    const [bulkDimsDirty, setBulkDimsDirty] = useState({ w: false, h: false, d: false });
    const [bulkDimShapeKind, setBulkDimShapeKind] = useState("");
    const [bulkRadius, setBulkRadius] = useState("");
    const [bulkHeight, setBulkHeight] = useState("");
    const [bulkRadiusDirty, setBulkRadiusDirty] = useState(false);
    const [bulkHeightDirty, setBulkHeightDirty] = useState(false);
    useEffect(() => {
        if (!selectedShapeKinds.length) return;
        if (!bulkDimShapeKind || !selectedShapeKinds.includes(bulkDimShapeKind)) {
            setBulkDimShapeKind(selectedShapeKinds[0]);
        }
    }, [selectedShapeKinds, bulkDimShapeKind]);
    const roomById = useMemo(() => new Map((rooms || []).map((room) => [room?.id, room])), [rooms]);

    const onApplyReassign = () => {
        const roomId = assignRoomId || null;
        const deckId = assignDeckId || null;
        if (!roomId && !deckId) return;

        (multiNodes || []).forEach((n) => {
            if (!n?.id) return;
            setNodeById(n.id, () => {
                const next = {};
                if (roomId) next.roomId = roomId;
                if (deckId) next.deckId = deckId;
                return next;
            });
        });

        if (deckId) {
            (multiRooms || []).forEach((r) => {
                if (!r?.id) return;
                setRoom(r.id, { deckId });
            });
        }
    };

    const applyActiveLinkSet = (label) => {
        const targetLabel = __normalizeLinkSetLabel(label);
        if (!targetLabel) return;
        selectedNodes.forEach((node) => {
            if (!node?.id) return;
            const sets = getNodeLinkSets(node);
            const found = sets.find((set, idx) => __normalizeLinkSetLabel(linkSetLabel(set, idx)) === targetLabel);
            if (!found?.id) return;
            setNodeById(node.id, {
                linkSets: sets,
                activeLinkSetId: found.id,
            });
        });
    };

    const getActiveSetId = useCallback((node) => {
        const sets = getNodeLinkSets(node);
        return node?.activeLinkSetId || sets[0]?.id || LINK_SET_DEFAULT_ID;
    }, [getNodeLinkSets]);

    const applyLinkPatch = useCallback((patch) => {
        const nodeIds = new Set(selectedNodeIds);
        if (!nodeIds.size || !setLinks) return;
        const nodeById = new Map((nodes || []).map((n) => [n?.id, n]));
        const normalizedPatch = { ...(patch || {}) };
        const cableCount =
            normalizedPatch.cableCount ??
            (normalizedPatch.cable && typeof normalizedPatch.cable === "object" ? normalizedPatch.cable.count : undefined);
        if (cableCount != null) {
            normalizedPatch.cableCount = cableCount;
            normalizedPatch.cable = {
                ...(normalizedPatch.cable || {}),
                count: cableCount,
            };
        }
        const shouldApply = (link) => {
            if (!link) return false;
            if (!nodeIds.has(link.from) && !nodeIds.has(link.to)) return false;
            if (multiLinkScope !== "active") return true;
            const node = nodeById.get(link.from) || nodeById.get(link.to);
            const activeSetId = getActiveSetId(node);
            const linkSetId = link.linkSetId || activeSetId;
            return linkSetId === activeSetId;
        };
        const merge = (base, next) => {
            const out = { ...(base || {}) };
            Object.entries(next || {}).forEach(([key, value]) => {
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    out[key] = merge(out[key], value);
                } else {
                    out[key] = value;
                }
            });
            return out;
        };
        setLinks((prev) =>
            prev.map((l) => {
                if (!shouldApply(l)) return l;
                return merge(l, normalizedPatch);
            }),
        );
    }, [selectedNodeIds, nodes, setLinks, multiLinkScope, getActiveSetId]);
    const applyAnchorSetChoice = useCallback((value) => {
        const nodeIds = new Set(selectedNodeIds);
        if (!nodeIds.size || !setLinks) return;
        const nodeById = new Map((nodes || []).map((n) => [n?.id, n]));
        const parsed = String(value || "");
        const shouldApply = (link) => {
            if (!link) return false;
            if (!nodeIds.has(link.from) && !nodeIds.has(link.to)) return false;
            if (multiLinkScope !== "active") return true;
            const node = nodeById.get(link.from) || nodeById.get(link.to);
            const activeSetId = getActiveSetId(node);
            const linkSetId = link.linkSetId || activeSetId;
            return linkSetId === activeSetId;
        };
        if (!parsed) {
            setLinks((prev) =>
                prev.map((l) => {
                    if (!shouldApply(l)) return l;
                    if (l.flowAnchorSetId == null && l.flowAnchorSetOwnerId == null) return l;
                    return { ...l, flowAnchorSetId: undefined, flowAnchorSetOwnerId: undefined };
                }),
            );
            return;
        }
        const parts = parsed.split("::");
        if (parts.length !== 2) return;
        const ownerKind = parts[0];
        const targetLabel = __normalizeLinkSetLabel(parts[1]);
        if (!targetLabel || (ownerKind !== "from" && ownerKind !== "to")) return;
        setLinks((prev) =>
            prev.map((l) => {
                if (!shouldApply(l)) return l;
                const ownerId = ownerKind === "from" ? l.from : l.to;
                if (!ownerId) return l;
                const node = nodeById.get(ownerId);
                const sets = getNodeAnchorSets(node);
                if (!sets.length) return l;
                const found = sets.find((set, idx) => __normalizeLinkSetLabel(anchorSetLabel(set, idx)) === targetLabel);
                if (!found?.id) return l;
                if (l.flowAnchorSetOwnerId === ownerId && l.flowAnchorSetId === found.id) return l;
                return { ...l, flowAnchorSetOwnerId: ownerId, flowAnchorSetId: found.id };
            }),
        );
    }, [selectedNodeIds, nodes, setLinks, multiLinkScope, getActiveSetId, getNodeAnchorSets, anchorSetLabel]);

    const addLinkSetToAll = () => {
        if (!selectedNodes.length) return;
        const trimmed = String(newLinkSetName || "").trim();
        const maxCount = Math.max(0, ...selectedNodes.map((n) => getNodeLinkSets(n).length));
        const nextLabel = trimmed || `Set ${__linkAlphaLabel(maxCount + 1)}`;
        const nextNorm = __normalizeLinkSetLabel(nextLabel);
        selectedNodes.forEach((node) => {
            if (!node?.id) return;
            const sets = getNodeLinkSets(node).slice();
            const exists = sets.find((set, idx) => __normalizeLinkSetLabel(linkSetLabel(set, idx)) === nextNorm);
            if (exists) return;
            sets.push({ id: `ls-${uuid()}`, name: nextLabel });
            setNodeById(node.id, { linkSets: sets });
        });
        if (trimmed) setNewLinkSetName("");
    };

    const ensureSetForNode = (node, label) => {
        if (!node?.id) return null;
        const norm = __normalizeLinkSetLabel(label);
        if (!norm) return null;
        const sets = getNodeLinkSets(node).slice();
        let found = sets.find((set, idx) => __normalizeLinkSetLabel(linkSetLabel(set, idx)) === norm);
        if (!found) {
            found = { id: `ls-${uuid()}`, name: label };
            sets.push(found);
            setNodeById(node.id, { linkSets: sets });
        }
        return found.id;
    };

    const reassignOutgoingLinks = () => {
        const label = String(reassignSetLabel || "").trim();
        if (!label) return;
        const nodeIds = new Set(selectedNodeIds);
        if (!nodeIds.size) return;
        const nodeById = new Map((nodes || []).map((n) => [n?.id, n]));
        const setIdByNode = new Map();
        nodeIds.forEach((id) => {
            const node = nodeById.get(id);
            const setId = ensureSetForNode(node, label);
            if (setId) setIdByNode.set(id, setId);
        });
        if (!setLinks) return;
        setLinks((prev) =>
            prev.map((l) => {
                if (!l || !nodeIds.has(l.from)) return l;
                const targetSetId = setIdByNode.get(l.from);
                if (!targetSetId) return l;
                if (l.linkSetId === targetSetId) return l;
                return { ...l, linkSetId: targetSetId };
            }),
        );
    };

    const unlinkSelectedNodes = () => {
        const nodeIds = new Set(selectedNodeIds);
        if (!nodeIds.size || !setLinks) return;
        setLinks((prev) => {
            if (unlinkScope === "outgoing") {
                return prev.filter((l) => !nodeIds.has(l?.from));
            }
            if (unlinkScope === "incoming") {
                return prev.filter((l) => !nodeIds.has(l?.to));
            }
            return prev.filter((l) => !(nodeIds.has(l?.from) || nodeIds.has(l?.to)));
        });
    };

    const applyRoomSize = (axis, value, shouldApply = true) => {
        if (!shouldApply) return;
        if (value == null || value === "") return;
        const v = Number(value);
        if (!Number.isFinite(v)) return;
        (multiRooms || []).forEach((room) => {
            if (!room?.id) return;
            const roomData = roomById.get(room.id) || room;
            if (!Array.isArray(roomData?.size) || roomData.size.length < 3) return;
            const cur = roomData.size;
            const next = [...cur];
            if (axis === "x") next[0] = v;
            if (axis === "y") next[1] = v;
            if (axis === "z") next[2] = v;
            setRoom?.(room.id, { size: next });
        });
        setBulkRoomDirty((prev) => ({ ...prev, [axis]: false }));
    };

    const masterNode = useMemo(() => {
        if (useAlternateMaster && alternateMasterId) {
            return (nodes || []).find((n) => n?.id === alternateMasterId) || null;
        }
        return selectedNodes[0] || null;
    }, [useAlternateMaster, alternateMasterId, nodes, selectedNodes]);

    useEffect(() => {
        if (!onMultiMasterChange) return;
        if (selectedNodes.length <= 1) {
            onMultiMasterChange({ id: null, isAlternate: false, enabled: false });
            return;
        }
        onMultiMasterChange({
            id: masterNode?.id || null,
            isAlternate: !!(useAlternateMaster && alternateMasterId),
            enabled: true,
        });
    }, [onMultiMasterChange, selectedNodes.length, masterNode?.id, useAlternateMaster, alternateMasterId]);

    const masterCandidates = useMemo(() => {
        const list = (nodes || []).filter((n) => n?.id);
        const filter = String(alternateMasterFilter || "").trim().toLowerCase();
        const filtered = filter
            ? list.filter((n) =>
                String(n.label || n.name || n.id || "")
                    .toLowerCase()
                    .includes(filter),
            )
            : list;
        return filtered
            .slice()
            .sort((a, b) =>
                String(a.label || a.name || a.id || "").localeCompare(
                    String(b.label || b.name || b.id || ""),
                    undefined,
                    { numeric: true, sensitivity: "base" },
                ),
            );
    }, [nodes, alternateMasterFilter]);

    const applyAlignment = (axis) => {
        if (!masterNode || !setNodeById) return;
        const masterPos = Array.isArray(masterNode.position) ? masterNode.position : [0, 0, 0];
        const targetValue = Number(masterPos[axis] ?? 0) || 0;
        const ids = new Set(selectedNodeIds);
        ids.forEach((id) => {
            if (!id) return;
            if (masterNode?.id && id === masterNode.id) return;
            setNodeById(id, (cur) => {
                const pos = Array.isArray(cur.position) ? [...cur.position] : [0, 0, 0];
                pos[axis] = targetValue;
                return { position: pos };
            });
        });
    };

    const applyAlignmentAxes = () => {
        if (!masterNode || !setNodeById) return;
        const masterPos = Array.isArray(masterNode.position) ? masterNode.position : [0, 0, 0];
        const ids = new Set(selectedNodeIds);
        ids.forEach((id) => {
            if (!id) return;
            if (masterNode?.id && id === masterNode.id) return;
            setNodeById(id, (cur) => {
                const pos = Array.isArray(cur.position) ? [...cur.position] : [0, 0, 0];
                if (alignAxis.x) pos[0] = Number(masterPos[0] ?? 0) || 0;
                if (alignAxis.y) pos[1] = Number(masterPos[1] ?? 0) || 0;
                if (alignAxis.z) pos[2] = Number(masterPos[2] ?? 0) || 0;
                return { position: pos };
            });
        });
    };

    const copyProfileFromMaster = () => {
        if (!masterNode || !setNodeById) return;
        const profile = __pickNodeProfileFromNode(masterNode);
        const data = profile?.node && typeof profile.node === "object" ? __deepClone(profile.node) : null;
        if (!data) return;
        delete data.id;
        delete data.name;
        delete data.label;
        delete data.position;
        // keep rotation/scale so it matches master orientation/profile
        const ids = new Set(selectedNodeIds);
        ids.forEach((id) => {
            if (!id) return;
            if (masterNode?.id && id === masterNode.id) return;
            setNodeById(id, (cur) => ({ ...(cur || {}), ...data }));
        });

        if (!setLinks) return;
        const masterOutgoing = (links || []).filter((l) => l?.from === masterNode.id);
        if (!masterOutgoing.length) return;
        const activeSetId = getActiveSetId(masterNode);
        const preferred = masterOutgoing.find((l) => (l.linkSetId || activeSetId) === activeSetId) || masterOutgoing[0];
        if (!preferred) return;
        const patch = {};
        const allowedKeys = [
            "style",
            "speed",
            "width",
            "color",
            "curve",
            "particles",
            "dash",
            "dashed",
            "icon",
            "sweep",
            "packet",
            "cable",
            "noise",
            "fx",
            "flowPreset",
            "active",
            "opacity",
        ];
        allowedKeys.forEach((key) => {
            if (preferred[key] !== undefined) patch[key] = __deepClone(preferred[key]);
        });
        if (Object.keys(patch).length) {
            applyLinkPatch(patch);
        }
    };

    const multiTabs = useMemo(() => {
        const tabs = [];
        if (selectedNodes.length > 0) {
            tabs.push({ id: "links", label: "Links" });
        }
        if (selectedNodes.length > 1) {
            tabs.push({ id: "align", label: "Align & Profile" });
        }
        if (multiRooms.length > 0) {
            tabs.push({ id: "rooms", label: "Rooms" });
        }
        if (isBoxSelection) {
            tabs.push({ id: "reassign", label: "Re-assign" });
        }
        return tabs;
    }, [selectedNodes.length, multiRooms.length, isBoxSelection]);

    useEffect(() => {
        if (!multiTabs.length) return;
        if (!multiTabs.some((t) => t.id === multiTab)) {
            setMultiTab(multiTabs[0].id);
        } else if (!selectedNodes.length && multiRooms.length && multiTab !== "rooms") {
            setMultiTab("rooms");
        }
    }, [multiTabs, multiTab, selectedNodes.length, multiRooms.length]);

    return (
        <Panel title="Multi Inspector">
            <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                    Selected: {(multiNodes || []).length} node(s), {(multiRooms || []).length} room(s)
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Btn
                        variant={linkActive ? "primary" : "ghost"}
                        glow={linkActive}
                        disabled={!canLink}
                        onClick={() => {
                            const next = !linkActive;
                            if (next) {
                                setMode("link");
                                setLinkFromId?.(null);
                            } else {
                                setMode("select");
                                setLinkFromId?.(null);
                            }
                            setMultiLinkMode?.(next);
                        }}
                    >
                        {linkActive ? "Link: ON" : "Link: OFF"}
                    </Btn>
                    <div style={{ fontSize: 11, opacity: 0.75 }}>
                        {canLink
                            ? `Click a target node to link all ${multiNodes.length} selected nodes.`
                            : "Select at least one node to enable linking."}
                    </div>
                </div>
                {multiTabs.length > 1 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {multiTabs.map((tab) => (
                            <Btn
                                key={tab.id}
                                variant={multiTab === tab.id ? "primary" : "ghost"}
                                onClick={() => setMultiTab(tab.id)}
                            >
                                {tab.label}
                            </Btn>
                        ))}
                    </div>
                )}
                {selectedNodes.length > 0 && multiTab === "links" && (
                    <div style={{ display: "grid", gap: 8, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>Links</div>
                        <label>
                            Scope
                            <Select value={multiLinkScope} onChange={(e) => setMultiLinkScope(e.target.value)}>
                                <option value="all">All</option>
                                <option value="active">Active Set Only</option>
                            </Select>
                        </label>
                        <label>
                            Active Set (all selected)
                            <Select
                                value={multiLinkSetLabel}
                                onChange={(e) => {
                                    const label = e.target.value || "";
                                    setMultiLinkSetLabel(label);
                                    applyActiveLinkSet(label);
                                }}
                            >
                                <option value="">(select)</option>
                                {allLinkSetLabels.map((label) => (
                                    <option key={label} value={label}>{label}</option>
                                ))}
                            </Select>
                        </label>
                        <div style={{ display: "grid", gap: 8, padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(15,23,42,0.35)" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>Bulk Link Options</div>
                            <label>
                                Style
                                <Select
                                    value={bulkStyle}
                                    onChange={(e) => {
                                        const v = e.target.value || "particles";
                                        setBulkStyle(v);
                                        applyLinkPatch({ style: v });
                                    }}
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
                                Anchor set
                                <Select
                                    value={bulkAnchorSetChoice}
                                    onChange={(e) => {
                                        const v = e.target.value || "";
                                        setBulkAnchorSetChoice(v);
                                        applyAnchorSetChoice(v);
                                    }}
                                >
                                    <option value="">Auto (default)</option>
                                    {allAnchorSetLabels.length > 0 && (
                                        <>
                                            <optgroup label="From node">
                                                {allAnchorSetLabels.map((label) => (
                                                    <option key={`from-${label}`} value={`from::${label}`}>
                                                        {label}
                                                    </option>
                                                ))}
                                            </optgroup>
                                            <optgroup label="To node">
                                                {allAnchorSetLabels.map((label) => (
                                                    <option key={`to-${label}`} value={`to::${label}`}>
                                                        {label}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        </>
                                    )}
                                </Select>
                            </label>
                            <label>
                                Active{" "}
                                <Checkbox
                                    checked={bulkActive}
                                    onChange={(v) => {
                                        setBulkActive(v);
                                        applyLinkPatch({ active: v });
                                    }}
                                />
                            </label>
                            <label>
                                Speed
                                <Slider
                                    value={bulkSpeed}
                                    min={0}
                                    max={4}
                                    step={0.05}
                                    onChange={(v) => {
                                        setBulkSpeed(v);
                                        applyLinkPatch({ speed: v });
                                    }}
                                />
                            </label>
                            <label>
                                Width
                                <Slider
                                    value={bulkWidth}
                                    min={1}
                                    max={6}
                                    step={0.1}
                                    onChange={(v) => {
                                        setBulkWidth(v);
                                        applyLinkPatch({ width: v });
                                    }}
                                />
                            </label>
                            <label>
                                Color
                                <Input
                                    type="color"
                                    value={bulkColor}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setBulkColor(v);
                                        applyLinkPatch({ color: v });
                                    }}
                                />
                            </label>
                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 12, opacity: 0.7 }}>Curve</div>
                                <label>
                                    Mode
                                    <Select
                                        value={bulkCurveMode}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setBulkCurveMode(v);
                                            applyLinkPatch({ curve: { mode: v } });
                                        }}
                                    >
                                        <option value="straight">straight</option>
                                        <option value="up">up</option>
                                        <option value="side">side</option>
                                    </Select>
                                </label>
                                <label>
                                    Bend
                                    <Slider
                                        value={bulkCurveBend}
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        onChange={(v) => {
                                            setBulkCurveBend(v);
                                            applyLinkPatch({ curve: { bend: v } });
                                        }}
                                    />
                                </label>
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 12, opacity: 0.7 }}>Particles</div>
                                <label>
                                    Count
                                    <Slider
                                        value={bulkParticlesCount}
                                        min={1}
                                        max={80}
                                        step={1}
                                        onChange={(v) => {
                                            const val = Math.round(v);
                                            setBulkParticlesCount(val);
                                            applyLinkPatch({ particles: { count: val } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Size
                                    <Slider
                                        value={bulkParticlesSize}
                                        min={0.02}
                                        max={0.6}
                                        step={0.01}
                                        onChange={(v) => {
                                            setBulkParticlesSize(v);
                                            applyLinkPatch({ particles: { size: v } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Opacity
                                    <Slider
                                        value={bulkParticlesOpacity}
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        onChange={(v) => {
                                            setBulkParticlesOpacity(v);
                                            applyLinkPatch({ particles: { opacity: v } });
                                        }}
                                    />
                                </label>
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 12, opacity: 0.7 }}>Dash</div>
                                <label>
                                    Length
                                    <Slider
                                        value={bulkDashLength}
                                        min={0.05}
                                        max={2}
                                        step={0.05}
                                        onChange={(v) => {
                                            setBulkDashLength(v);
                                            applyLinkPatch({ dash: { length: v } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Gap
                                    <Slider
                                        value={bulkDashGap}
                                        min={0.05}
                                        max={2}
                                        step={0.05}
                                        onChange={(v) => {
                                            setBulkDashGap(v);
                                            applyLinkPatch({ dash: { gap: v } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Speed
                                    <Slider
                                        value={bulkDashSpeed}
                                        min={0}
                                        max={4}
                                        step={0.05}
                                        onChange={(v) => {
                                            setBulkDashSpeed(v);
                                            applyLinkPatch({ dash: { speed: v } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Opacity
                                    <Slider
                                        value={bulkDashOpacity}
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        onChange={(v) => {
                                            setBulkDashOpacity(v);
                                            applyLinkPatch({ dash: { opacity: v } });
                                        }}
                                    />
                                </label>
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 12, opacity: 0.7 }}>Icons</div>
                                <label>
                                    Icon
                                    <Input
                                        placeholder="⚡"
                                        value={bulkIconChar}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setBulkIconChar(v);
                                            applyLinkPatch({ icons: { icon: v } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Size
                                    <Slider
                                        value={bulkIconSize}
                                        min={0.05}
                                        max={0.6}
                                        step={0.01}
                                        onChange={(v) => {
                                            setBulkIconSize(v);
                                            applyLinkPatch({ icons: { size: v } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Spacing
                                    <Slider
                                        value={bulkIconSpacing}
                                        min={0.1}
                                        max={1.5}
                                        step={0.05}
                                        onChange={(v) => {
                                            setBulkIconSpacing(v);
                                            applyLinkPatch({ icons: { spacing: v } });
                                        }}
                                    />
                                </label>
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 12, opacity: 0.7 }}>Cable</div>
                                <label>
                                    Count
                                    <Slider
                                        value={bulkCableCount}
                                        min={1}
                                        max={32}
                                        step={1}
                                        onChange={(v) => {
                                            const val = Math.round(v);
                                            setBulkCableCount(val);
                                            applyLinkPatch({ cable: { count: val } });
                                            applyLinkPatch({ cableCount: val });
                                        }}
                                    />
                                </label>
                                <label>
                                    Spread
                                    <Slider
                                        value={bulkCableSpread}
                                        min={0}
                                        max={0.8}
                                        step={0.01}
                                        onChange={(v) => {
                                            setBulkCableSpread(v);
                                            applyLinkPatch({ cable: { spread: v } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Roughness
                                    <Slider
                                        value={bulkCableRough}
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        onChange={(v) => {
                                            setBulkCableRough(v);
                                            applyLinkPatch({ cable: { roughness: v } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Scramble
                                    <Slider
                                        value={bulkCableScramble}
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        onChange={(v) => {
                                            setBulkCableScramble(v);
                                            applyLinkPatch({ cable: { scramble: v } });
                                        }}
                                    />
                                </label>
                                <label>
                                    Anchor
                                    <Slider
                                        value={bulkCableAnchor}
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        onChange={(v) => {
                                            setBulkCableAnchor(v);
                                            applyLinkPatch({ cable: { anchor: v } });
                                        }}
                                    />
                                </label>
                            </div>
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                            <label>
                                Add Set (all selected)
                                <Input
                                    placeholder="Set name (optional)"
                                    value={newLinkSetName}
                                    onChange={(e) => setNewLinkSetName(e.target.value)}
                                />
                            </label>
                            <Btn onClick={addLinkSetToAll}>Add Set</Btn>
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                            <label>
                                Reassign Outgoing Links to Set
                                <Select
                                    value={reassignSetLabel}
                                    onChange={(e) => setReassignSetLabel(e.target.value || "")}
                                >
                                    <option value="">(select)</option>
                                    {allLinkSetLabels.map((label) => (
                                        <option key={label} value={label}>{label}</option>
                                    ))}
                                </Select>
                            </label>
                            <Btn onClick={reassignOutgoingLinks}>Reassign Links</Btn>
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                            <label>
                                Unlink scope
                                <Select value={unlinkScope} onChange={(e) => setUnlinkScope(e.target.value)}>
                                    <option value="outgoing">Outgoing only</option>
                                    <option value="incoming">Incoming only</option>
                                    <option value="both">Incoming + outgoing</option>
                                </Select>
                            </label>
                            <Btn onClick={unlinkSelectedNodes}>Unlink Selected Nodes</Btn>
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>Selected Nodes</div>
                            {(selectedNodes || []).map((node) => {
                                const outgoing = (links || []).filter((l) => l?.from === node.id);
                                const activeSetId = getActiveSetId(node);
                                const activeOutgoing = outgoing.filter((l) => (l.linkSetId || activeSetId) === activeSetId);
                                return (
                                    <div
                                        key={node.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 8,
                                            padding: "6px 8px",
                                            borderRadius: 10,
                                            border: "1px solid rgba(255,255,255,0.08)",
                                            background: "rgba(15,23,42,0.35)",
                                        }}
                                    >
                                        <Btn
                                            size="xs"
                                            onClick={() => setSelected?.({ type: "node", id: node.id })}
                                        >
                                            {node.label || node.id}
                                        </Btn>
                                        <div style={{ display: "flex", gap: 8, fontSize: 11, opacity: 0.8 }}>
                                            <span>Links: {outgoing.length}</span>
                                            <span>Active set: {activeOutgoing.length}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
                {isBoxSelection && multiTab === "reassign" && (
                    <div style={{ display: "grid", gap: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        <Btn onClick={() => setShowReassign((v) => !v)}>
                            {showReassign ? "Re-assign: Hide" : "Re-assign"}
                        </Btn>
                        {showReassign && (
                            <div style={{ display: "grid", gap: 8 }}>
                                <label>
                                    Room
                                    <Select
                                        value={assignRoomId}
                                        onChange={(e) => setAssignRoomId(e.target.value)}
                                    >
                                        <option value="">Keep current</option>
                                        {(rooms || []).map((r) => (
                                            <option key={r.id} value={r.id}>
                                                {r.name || r.id}
                                            </option>
                                        ))}
                                    </Select>
                                </label>
                                <label>
                                    Deck
                                    <Select
                                        value={assignDeckId}
                                        onChange={(e) => setAssignDeckId(e.target.value)}
                                    >
                                        <option value="">Keep current</option>
                                        {(decks || []).map((d) => (
                                            <option key={d.id} value={d.id}>
                                                {d.name || d.label || d.id}
                                            </option>
                                        ))}
                                    </Select>
                                </label>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <Btn
                                        disabled={!assignRoomId && !assignDeckId}
                                        onClick={onApplyReassign}
                                    >
                                        Apply Re-assign
                                    </Btn>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {multiRooms.length > 0 && multiTab === "rooms" && (
                    <div style={{ display: "grid", gap: 8, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>Rooms</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            <label>
                                Width (X)
                                <Input
                                    type="number"
                                    step={0.1}
                                    min={0.1}
                                    value={bulkRoomWidth}
                                    onChange={(e) => {
                                        setBulkRoomWidth(e.target.value);
                                        setBulkRoomDirty((prev) => ({ ...prev, x: true }));
                                    }}
                                    onBlur={() => {
                                        applyRoomSize("x", bulkRoomWidth, bulkRoomDirty.x);
                                        if (bulkRoomDirty.x) setBulkRoomWidth("");
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            applyRoomSize("x", bulkRoomWidth, bulkRoomDirty.x);
                                            if (bulkRoomDirty.x) setBulkRoomWidth("");
                                        }
                                    }}
                                />
                            </label>
                            <label>
                                Height (Y)
                                <Input
                                    type="number"
                                    step={0.1}
                                    min={0.1}
                                    value={bulkRoomHeight}
                                    onChange={(e) => {
                                        setBulkRoomHeight(e.target.value);
                                        setBulkRoomDirty((prev) => ({ ...prev, y: true }));
                                    }}
                                    onBlur={() => {
                                        applyRoomSize("y", bulkRoomHeight, bulkRoomDirty.y);
                                        if (bulkRoomDirty.y) setBulkRoomHeight("");
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            applyRoomSize("y", bulkRoomHeight, bulkRoomDirty.y);
                                            if (bulkRoomDirty.y) setBulkRoomHeight("");
                                        }
                                    }}
                                />
                            </label>
                            <label>
                                Length (Z)
                                <Input
                                    type="number"
                                    step={0.1}
                                    min={0.1}
                                    value={bulkRoomLength}
                                    onChange={(e) => {
                                        setBulkRoomLength(e.target.value);
                                        setBulkRoomDirty((prev) => ({ ...prev, z: true }));
                                    }}
                                    onBlur={() => {
                                        applyRoomSize("z", bulkRoomLength, bulkRoomDirty.z);
                                        if (bulkRoomDirty.z) setBulkRoomLength("");
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            applyRoomSize("z", bulkRoomLength, bulkRoomDirty.z);
                                            if (bulkRoomDirty.z) setBulkRoomLength("");
                                        }
                                    }}
                                />
                            </label>
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                            Enter a value to apply that dimension to all selected rooms.
                        </div>
                        <div style={{ display: "grid", gap: 8 }}>
                            <label>
                                Deck
                                <Select
                                    value={bulkRoomDeckId}
                                    onChange={(e) => setBulkRoomDeckId(e.target.value)}
                                >
                                    <option value="">Keep current</option>
                                    <option value="__none__">No deck</option>
                                    {(decks || []).map((d) => (
                                        <option key={d.id} value={d.id}>
                                            {d.name || d.label || d.id}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <div style={{ display: "flex", gap: 8 }}>
                                <Btn
                                    disabled={!bulkRoomDeckId}
                                    onClick={() => {
                                        const nextDeck = bulkRoomDeckId === "__none__" ? undefined : bulkRoomDeckId;
                                        (multiRooms || []).forEach((room) => {
                                            if (!room?.id) return;
                                            setRoom?.(room.id, { deckId: nextDeck });
                                        });
                                    }}
                                >
                                    Apply Deck
                                </Btn>
                            </div>
                        </div>
                    </div>
                )}
                {selectedNodes.length > 1 && multiTab === "align" && (
                    <div style={{ display: "grid", gap: 8, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>Align & Profile</div>
                        <label style={{ display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <Checkbox
                                    checked={useAlternateMaster}
                                    onChange={(v) => setUseAlternateMaster(!!v)}
                                />
                                <span style={{ fontSize: 12, opacity: 0.8 }}>Alternate master</span>
                            </div>
                            {useAlternateMaster && (
                                <div style={{ display: "grid", gap: 6 }}>
                                    <Input
                                        placeholder="Filter nodes..."
                                        value={alternateMasterFilter}
                                        onChange={(e) => setAlternateMasterFilter(e.target.value)}
                                    />
                                    <Select
                                        value={alternateMasterId}
                                        onChange={(e) => setAlternateMasterId(e.target.value)}
                                    >
                                        <option value="">(select master)</option>
                                        {masterCandidates.map((n) => (
                                            <option key={n.id} value={n.id}>
                                                {n.label || n.name || n.id}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                            )}
                        </label>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ fontSize: 12, opacity: 0.75 }}>Align axes</span>
                            <Checkbox
                                checked={alignAxis.x}
                                onChange={(v) => setAlignAxis((prev) => ({ ...prev, x: v }))}
                                label="X"
                            />
                            <Checkbox
                                checked={alignAxis.y}
                                onChange={(v) => setAlignAxis((prev) => ({ ...prev, y: v }))}
                                label="Y"
                            />
                            <Checkbox
                                checked={alignAxis.z}
                                onChange={(v) => setAlignAxis((prev) => ({ ...prev, z: v }))}
                                label="Z"
                            />
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <Btn onClick={applyAlignmentAxes} disabled={!masterNode}>
                                Apply Alignment
                            </Btn>
                            <Btn onClick={() => applyAlignment(0)} disabled={!masterNode}>
                                Align X
                            </Btn>
                            <Btn onClick={() => applyAlignment(1)} disabled={!masterNode}>
                                Align Y
                            </Btn>
                            <Btn onClick={() => applyAlignment(2)} disabled={!masterNode}>
                                Align Z
                            </Btn>
                            <Btn onClick={copyProfileFromMaster} disabled={!masterNode}>
                                Apply Master Profile
                            </Btn>
                        </div>
                        <div style={{ display: "grid", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>Rotation</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                <label>
                                    X (deg)
                                    <NumberInput
                                        value={bulkRotateDeg.x}
                                        step={5}
                                        onChange={(v) => {
                                            setBulkRotateDeg((prev) => ({ ...prev, x: v }));
                                            applyBulkRotation(0, v);
                                        }}
                                    />
                                </label>
                                <label>
                                    Y (deg)
                                    <NumberInput
                                        value={bulkRotateDeg.y}
                                        step={5}
                                        onChange={(v) => {
                                            setBulkRotateDeg((prev) => ({ ...prev, y: v }));
                                            applyBulkRotation(1, v);
                                        }}
                                    />
                                </label>
                                <label>
                                    Z (deg)
                                    <NumberInput
                                        value={bulkRotateDeg.z}
                                        step={5}
                                        onChange={(v) => {
                                            setBulkRotateDeg((prev) => ({ ...prev, z: v }));
                                            applyBulkRotation(2, v);
                                        }}
                                    />
                                </label>
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <Btn onClick={() => applyBulkRotation(0, -90)}>Face Up</Btn>
                                <Btn onClick={() => applyBulkRotation(0, 90)}>Face Down</Btn>
                                <Btn onClick={() => applyBulkRotation(1, -90)}>Face Left</Btn>
                                <Btn onClick={() => applyBulkRotation(1, 90)}>Face Right</Btn>
                                <Btn onClick={() => applyBulkRotation(1, 0)}>Face Forward</Btn>
                                <Btn onClick={() => applyBulkRotation(1, 180)}>Face Back</Btn>
                            </div>
                        </div>
                        <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>Size</div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <NumberInput
                                    value={bulkScale}
                                    step={0.1}
                                    min={0.05}
                                    onChange={(v) => setBulkScale(v)}
                                />
                                <Btn onClick={applyBulkScale}>Apply Scale</Btn>
                            </div>
                        </div>
                        <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>Dimensions</div>
                            {selectedShapeKinds.length > 1 && (
                                <label>
                                    Shape type
                                    <Select
                                        value={bulkDimShapeKind || selectedShapeKinds[0]}
                                        onChange={(e) => setBulkDimShapeKind(e.target.value)}
                                    >
                                        {selectedShapeKinds.map((k) => (
                                            <option key={k} value={k}>
                                                {k}
                                            </option>
                                        ))}
                                    </Select>
                                </label>
                            )}
                            {selectedShapeKinds.length === 1 && bulkDimShapeKind && (
                                <div style={{ fontSize: 11, opacity: 0.7 }}>Shape: {bulkDimShapeKind}</div>
                            )}
                            {["sphere", "cylinder", "cone", "disc", "hexagon", "accesspoint"].includes(bulkDimShapeKind) && (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                    <label>
                                        Radius
                                        <Input
                                            type="number"
                                            step="0.05"
                                            value={bulkRadius}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setBulkRadius(v);
                                                setBulkRadiusDirty(v !== "");
                                            }}
                                        />
                                    </label>
                                    {["cylinder", "cone", "disc", "hexagon", "accesspoint"].includes(bulkDimShapeKind) && (
                                        <label>
                                            Height
                                            <Input
                                                type="number"
                                                step="0.05"
                                                value={bulkHeight}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    setBulkHeight(v);
                                                    setBulkHeightDirty(v !== "");
                                                }}
                                            />
                                        </label>
                                    )}
                                </div>
                            )}
                            {["box", "switch", "tv", "remote", "laviebox", "ipad", "speaker", "speakerfloor", "soundbar", "headphones", "subwoofer", "amplifier", "rack"].includes(bulkDimShapeKind) && (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                    <label>
                                        W
                                        <Input
                                            type="number"
                                            step="0.05"
                                            value={bulkDims.w}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setBulkDims((prev) => ({ ...prev, w: v }));
                                                setBulkDimsDirty((prev) => ({ ...prev, w: v !== "" }));
                                            }}
                                        />
                                    </label>
                                    <label>
                                        H
                                        <Input
                                            type="number"
                                            step="0.05"
                                            value={bulkDims.h}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setBulkDims((prev) => ({ ...prev, h: v }));
                                                setBulkDimsDirty((prev) => ({ ...prev, h: v !== "" }));
                                            }}
                                        />
                                    </label>
                                    <label>
                                        L
                                        <Input
                                            type="number"
                                            step="0.05"
                                            value={bulkDims.d}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setBulkDims((prev) => ({ ...prev, d: v }));
                                                setBulkDimsDirty((prev) => ({ ...prev, d: v !== "" }));
                                            }}
                                        />
                                    </label>
                                </div>
                            )}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <Btn
                                    onClick={() =>
                                        applyBulkDimensions(bulkDimShapeKind || selectedShapeKinds[0] || "")
                                    }
                                    disabled={!bulkDimShapeKind && !selectedShapeKinds.length}
                                >
                                    Apply Dimensions
                                </Btn>
                                <Btn
                                    variant="ghost"
                                    onClick={() => {
                                        setBulkDims({ w: "", h: "", d: "" });
                                        setBulkDimsDirty({ w: false, h: false, d: false });
                                        setBulkRadius("");
                                        setBulkHeight("");
                                        setBulkRadiusDirty(false);
                                        setBulkHeightDirty(false);
                                    }}
                                >
                                    Clear
                                </Btn>
                            </div>
                        </div>

                        {masterNode && (
                            <div style={{ fontSize: 11, opacity: 0.7 }}>
                                Master: {masterNode.label || masterNode.name || masterNode.id}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Panel>
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
                           duplicateNodeWithLinks,
                           mode,
                           setMode,
                           setMoveMode,
                           setTransformMode,
                           setSelected,
                           requestDelete,
                           selectedBreakpoint,
                           setSelectedBreakpoint,
                           selectedFlowAnchor,
                           setSelectedFlowAnchor,
                           setLinkFromId,   // 🔹 NEW
                           multiLinkMode,
                           setMultiLinkMode,
                           levelFromNodeId,        // 👈 NEW
                           setLevelFromNodeId,     // 👈 NEW
                           levelAxis,              // 👈 NEW
                           setLevelAxis,           // 👈 NEW
                           actions,
                           reassignFlowLinkId,
                           startReassignFlow,
                           cancelReassignFlow,
                           ActionsPanel,
                       }) {
    const rotateDegRef = useRef(null);
    const [rackAddNodeId, setRackAddNodeId] = useState("");
    const [rackSearch, setRackSearch] = useState("");
    const [rackDragId, setRackDragId] = useState(null);

    const [openMasterId, setOpenMasterId] = useState(null);
    const [lightProfileClipboard, setLightProfileClipboard] = useState(() => __loadLightProfileClipboard());
    const [switchProfileClipboard, setSwitchProfileClipboard] = useState(() => __loadSwitchProfileClipboard());
    const [textBoxClipboard, setTextBoxClipboard] = useState(() => __loadTextBoxClipboard());
    const [nodeProfileClipboard, setNodeProfileClipboard] = useState(() => __loadNodeProfileClipboard());
    const [includeNodeProfileLocation, setIncludeNodeProfileLocation] = useState(false);
    const [inspectorTab, setInspectorTab] = useState(() => {
        try {
            const saved = localStorage.getItem(NODE_INSPECTOR_TAB_KEY);
            if (saved) {
                __nodeInspectorTab = saved;
                return saved;
            }
        } catch {}
        return __nodeInspectorTab || "node";
    });
    useEffect(() => {
        __nodeInspectorTab = inspectorTab || "node";
        try { localStorage.setItem(NODE_INSPECTOR_TAB_KEY, __nodeInspectorTab); } catch {}
    }, [inspectorTab]);

    const linkSets = useMemo(() => {
        const sets = Array.isArray(n?.linkSets) ? n.linkSets : [];
        return sets.length ? sets : [{ id: "ls-a", name: "Set A" }];
    }, [n?.linkSets]);
    const activeLinkSetId = n?.activeLinkSetId || linkSets[0]?.id || "ls-a";
    const outgoingLinks = useMemo(
        () => (Array.isArray(links) && n?.id
            ? links.filter((l) => l?.from === n.id)
                .filter((l) => (l?.linkSetId || activeLinkSetId) === activeLinkSetId)
            : []),
        [links, n?.id, activeLinkSetId],
    );
    const [selectedOutgoingLinkId, setSelectedOutgoingLinkId] = useState("");
    useEffect(() => {
        if (!n?.id) return;
        const keep = outgoingLinks.some((l) => l.id === selectedOutgoingLinkId);
        if (keep) return;
        setSelectedOutgoingLinkId(outgoingLinks[0]?.id || "");
    }, [n?.id, outgoingLinks, selectedOutgoingLinkId]);
    const selectedOutgoingLink = outgoingLinks.find((l) => l.id === selectedOutgoingLinkId) || outgoingLinks[0] || null;

    const flowAnchorsEnabled = n?.flowAnchorsEnabled === true;
    const anchorSets = Array.isArray(n?.flowAnchorSets) ? n.flowAnchorSets : [];
    const legacyFlowAnchors = Array.isArray(n?.flowAnchors) ? n.flowAnchors : [];
    const [newAnchorSetName, setNewAnchorSetName] = useState("");
    const allAnchorSets = useMemo(() => {
        const map = new Map();
        (nodes || []).forEach((node) => {
            const sets = Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets : [];
            sets.forEach((set) => {
                if (!set?.id || map.has(set.id)) return;
                map.set(set.id, {
                    id: set.id,
                    name: set.name || "Anchor Set",
                    set,
                    nodeId: node.id,
                    nodeLabel: node.label || node.name || node.id,
                });
            });
        });
        return Array.from(map.values());
    }, [nodes]);

    useEffect(() => {
        setNewAnchorSetName("");
    }, [n?.id]);

                    useEffect(() => {
        if (!n?.id) return;
        if ((anchorSets?.length || 0) > 0) return;
        if (!legacyFlowAnchors.length) return;
        const defaultId = n?.flowAnchorActiveSetId || "fas-default";
        setNodeById(n.id, {
            flowAnchorSets: [
                {
                    id: defaultId,
                    name: "Default",
                    anchors: legacyFlowAnchors,
                    globalBendDeg: n?.flowAnchorGlobalBendDeg ?? 0,
                    dynamicBreakpoints: n?.flowAnchorDynamicBreakpoints ?? false,
                    noDiagonal: n?.flowAnchorNoDiagonal ?? false,
                    spreadPaths: n?.flowAnchorSpreadPaths ?? 0,
                    hideRings: n?.flowAnchorsHideRings ?? false,
                },
            ],
            flowAnchorActiveSetId: defaultId,
            flowAnchors: [],
        });
    }, [
        n?.id,
        anchorSets?.length,
        legacyFlowAnchors.length,
        n?.flowAnchorActiveSetId,
        n?.flowAnchorDynamicBreakpoints,
        n?.flowAnchorGlobalBendDeg,
        n?.flowAnchorNoDiagonal,
        n?.flowAnchorsHideRings,
        setNodeById,
    ]);

    const fallbackLegacySetId = n?.flowAnchorActiveSetId || "fas-default";
    const activeAnchorSetId =
        n?.flowAnchorActiveSetId ||
        anchorSets?.[0]?.id ||
        (legacyFlowAnchors.length ? fallbackLegacySetId : null);
    const activeAnchorSet =
        anchorSets.find((s) => s?.id === activeAnchorSetId) ||
        anchorSets[0] ||
        (legacyFlowAnchors.length
            ? {
                id: fallbackLegacySetId,
                name: "Default",
                anchors: legacyFlowAnchors,
                globalBendDeg: n?.flowAnchorGlobalBendDeg ?? 0,
                dynamicBreakpoints: n?.flowAnchorDynamicBreakpoints ?? false,
                noDiagonal: n?.flowAnchorNoDiagonal ?? false,
                spreadPaths: n?.flowAnchorSpreadPaths ?? 0,
                hideRings: n?.flowAnchorsHideRings ?? false,
            }
            : null);
    const flowAnchors = Array.isArray(activeAnchorSet?.anchors) ? activeAnchorSet.anchors : [];
    const flowAnchorGlobalBend = normalizeAnchorBendDeg(activeAnchorSet?.globalBendDeg ?? n?.flowAnchorGlobalBendDeg ?? 0);
    const flowAnchorDynamicBreakpoints = activeAnchorSet?.dynamicBreakpoints ?? n?.flowAnchorDynamicBreakpoints ?? false;
    const flowAnchorNoDiagonal = activeAnchorSet?.noDiagonal ?? n?.flowAnchorNoDiagonal ?? false;
    const flowAnchorsHideRings = activeAnchorSet?.hideRings ?? n?.flowAnchorsHideRings ?? false;

    const updateFlowAnchorSets = (updater) => {
        setNodeById(n.id, (cur) => {
            const prev = Array.isArray(cur.flowAnchorSets) ? cur.flowAnchorSets : [];
            const next = typeof updater === "function" ? updater(prev) : updater;
            return { ...cur, flowAnchorSets: Array.isArray(next) ? next : prev };
        });
    };
    const importAnchorSetById = (setId) => {
        if (!setId) return;
        const entry = allAnchorSets.find((s) => s.id === setId);
        if (!entry?.set) return;
        const cloned = {
            ...(entry.set || {}),
            anchors: Array.isArray(entry.set?.anchors)
                ? entry.set.anchors.map((a) => ({ ...(a || {}) }))
                : [],
        };
        updateFlowAnchorSets((prev) => {
            const exists = prev.some((s) => s?.id === setId);
            return exists ? prev : [...prev, cloned];
        });
        setNodeById(n.id, { flowAnchorActiveSetId: setId });
    };

    const updateActiveAnchorSet = (patch) => {
        if (!activeAnchorSetId) return;
        updateFlowAnchorSets((prev) =>
            prev.map((s) => (s?.id === activeAnchorSetId ? { ...(s || {}), ...patch } : s)),
        );
    };

    const updateFlowAnchors = (updater) => {
        if (!activeAnchorSetId) return;
        updateFlowAnchorSets((prev) =>
            prev.map((s) => {
                if (s?.id !== activeAnchorSetId) return s;
                const prevAnchors = Array.isArray(s.anchors) ? s.anchors : [];
                const nextAnchors = typeof updater === "function" ? updater(prevAnchors) : updater;
                return { ...s, anchors: Array.isArray(nextAnchors) ? nextAnchors : prevAnchors };
            }),
        );
    };
    const updateFlowAnchor = (idx, patch) => {
        updateFlowAnchors((prev) =>
            prev.map((anchor, i) => (i === idx ? { ...(anchor || {}), ...patch } : anchor)),
        );
    };
    const moveFlowAnchorToSet = (fromSetId, idx, toSetId) => {
        if (!fromSetId || !toSetId || fromSetId === toSetId) return;
        let nextIndex = null;
        updateFlowAnchorSets((prev) => {
            const next = prev.map((s) => ({
                ...(s || {}),
                anchors: Array.isArray(s?.anchors) ? [...s.anchors] : [],
            }));
            const from = next.find((s) => s?.id === fromSetId);
            const to = next.find((s) => s?.id === toSetId);
            if (!from || !to) return prev;
            const moved = from.anchors.splice(idx, 1)[0];
            if (!moved) return prev;
            nextIndex = to.anchors.length;
            to.anchors.push(moved);
            return next;
        });
        if (
            nextIndex != null &&
            selectedFlowAnchor?.nodeId === n?.id &&
            selectedFlowAnchor?.setId === fromSetId &&
            selectedFlowAnchor?.index === idx
        ) {
            setSelectedFlowAnchor?.({ nodeId: n.id, setId: toSetId, index: nextIndex });
            setSelected?.({ type: "flowAnchor", id: `${n.id}:${toSetId}:${nextIndex}` });
        }
    };
    const moveAnchorSetRef = useRef({});

    // Duplicate controls
    const [dupLinks, setDupLinks] = useState(false);
    const [dupAlsoNeighbours, setDupAlsoNeighbours] = useState(false);
    const textBoxTextAreaRef = useRef(null);
    useEffect(() => {
        if (!dupLinks) setDupAlsoNeighbours(false);
    }, [dupLinks]);


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

    const canPasteTextBoxProfile = !!(
        textBoxClipboard &&
        typeof textBoxClipboard === "object" &&
        textBoxClipboard.__kind === "textBoxProfile"
    );

    const canPasteNodeProfile = !!(
        nodeProfileClipboard &&
        typeof nodeProfileClipboard === "object" &&
        nodeProfileClipboard.__kind === "nodeProfile"
    );

    const copyTextBoxProfile = () => {
        const prof = __pickTextBoxProfileFromNode(n);
        __saveTextBoxClipboard(prof);
        setTextBoxClipboard(prof);
    };

    const copyNodeProfile = () => {
        const prof = __pickNodeProfileFromNode(n);
        if (!prof) return;
        __saveNodeProfileClipboard(prof);
        setNodeProfileClipboard(prof);
    };

    const pasteNodeProfile = (nodeId) => {
        const prof = __loadNodeProfileClipboard();
        if (!prof) return;
        __applyNodeProfileToNode({
            nodeId,
            profile: prof,
            setNodeById,
            includeLocation: includeNodeProfileLocation,
        });
        setNodeProfileClipboard(prof);
    };

    const pasteTextBoxProfile = (nodeId) => {
        if (!canPasteTextBoxProfile) return;
        __applyTextBoxProfileToNode({ nodeId, profile: textBoxClipboard, setNodeById });
    };

    const copyLightProfile = () => {
        const prof = __pickLightProfileFromNode(n);
        __saveLightProfileClipboard(prof);
        setLightProfileClipboard(prof);
    };

    const rackContents = Array.isArray(n?.rackContents) ? n.rackContents : [];
    const rackContentSet = new Set(rackContents);
    const availableRackNodes = useMemo(
        () =>
            (nodes || [])
                .filter((x) => x?.id && x.id !== n.id)
                .filter((x) => String(x?.shape?.type || "").toLowerCase() !== "rack")
                .map((x) => ({ id: x.id, label: x.label || x.name || x.id, shape: x.shape })),
        [nodes, n.id],
    );
    const isRackShape = String(n?.shape?.type || "").toLowerCase() === "rack";
    const rackCentralizedAll = rackContents.length > 0 && rackContents.every((id) => {
        const node = (nodes || []).find((x) => x.id === id);
        return !!node?.centralized;
    });

    useEffect(() => {
        if (!isRackShape && inspectorTab === "rack") {
            setInspectorTab("node");
        }
    }, [isRackShape, inspectorTab]);

    const removeNodeFromOtherRacks = useCallback((nodeId) => {
        (nodes || []).forEach((r) => {
            if (r?.id === n.id) return;
            if (String(r?.shape?.type || "").toLowerCase() !== "rack") return;
            const list = Array.isArray(r?.rackContents) ? r.rackContents : [];
            if (!list.includes(nodeId)) return;
            setNodeById(r.id, { rackContents: list.filter((id) => id !== nodeId) });
        });
    }, [nodes, n.id, setNodeById]);

    const rewireLinksToRack = useCallback((nodeId, rackId) => {
        if (!setLinks) return;
        const node = (nodes || []).find((x) => x?.id === nodeId);
        const activeSetId = node?.flowAnchorActiveSetId || (Array.isArray(node?.flowAnchorSets) ? node.flowAnchorSets[0]?.id : undefined);
        const shouldUseAnchors = !!(
            node?.flowAnchorsEnabled ||
            (Array.isArray(node?.flowAnchorSets) && node.flowAnchorSets.length) ||
            Array.isArray(node?.flowAnchors) && node.flowAnchors.length ||
            node?.flowAnchorNoDiagonal
        );
        setLinks((prev) => (prev || []).map((l) => {
            if (!l || !l.id) return l;
            const touches = l.from === nodeId || l.to === nodeId;
            if (!touches) return l;
            return {
                ...l,
                __rackOriginNodeId: nodeId,
                __rackViaId: rackId,
                __rackOriginalFrom: l.__rackOriginalFrom ?? l.from,
                __rackOriginalTo: l.__rackOriginalTo ?? l.to,
                __rackOriginalFlowOwnerId: l.__rackOriginalFlowOwnerId ?? l.flowAnchorSetOwnerId,
                __rackOriginalFlowSetId: l.__rackOriginalFlowSetId ?? l.flowAnchorSetId,
                from: l.from === nodeId ? rackId : l.from,
                to: l.to === nodeId ? rackId : l.to,
                ...(shouldUseAnchors ? {
                    flowAnchorSetOwnerId: nodeId,
                    flowAnchorSetId: activeSetId,
                } : {}),
            };
        }));
    }, [setLinks, nodes]);

    const restoreLinksFromRack = useCallback((nodeId, rackId) => {
        if (!setLinks) return;
        setLinks((prev) => (prev || []).map((l) => {
            if (!l || l.__rackOriginNodeId !== nodeId || l.__rackViaId !== rackId) return l;
            return {
                ...l,
                from: l.__rackOriginalFrom ?? l.from,
                to: l.__rackOriginalTo ?? l.to,
                flowAnchorSetOwnerId: l.__rackOriginalFlowOwnerId ?? l.flowAnchorSetOwnerId,
                flowAnchorSetId: l.__rackOriginalFlowSetId ?? l.flowAnchorSetId,
                __rackOriginNodeId: undefined,
                __rackViaId: undefined,
                __rackOriginalFrom: undefined,
                __rackOriginalTo: undefined,
                __rackOriginalFlowOwnerId: undefined,
                __rackOriginalFlowSetId: undefined,
            };
        }));
    }, [setLinks]);

    function updateRackHeight(nextContents) {
        const list = Array.isArray(nextContents) ? nextContents : [];
        setNodeById(n.id, (cur) => {
            if (!cur) return cur;
            const shape = cur.shape || {};
            const slotH = Number(shape.slotH ?? 0.25) || 0.25;
            const slots = Math.max(1, Math.floor(Number(shape.slots ?? 12) || 12));
            const rows = Math.min(list.length || 0, slots);
            const target = Math.max(0.2, Math.max(1, rows) * slotH + slotH * 0.1);
            const columns = Math.max(1, Math.ceil((list.length || 0) / slots));
            const colGap = Number(shape.columnGap ?? Math.max(0.08, (shape.w ?? 0.6) * 0.2)) || 0.12;
            const nextShape = {
                ...shape,
                h: target,
                columns,
                columnGap: colGap,
            };
            const changed =
                Math.abs(target - (shape.h ?? 0)) >= 0.001 ||
                shape.columns !== columns ||
                Math.abs((shape.columnGap ?? 0) - colGap) >= 0.001;
            if (!changed) return cur;
            return { ...cur, shape: nextShape };
        });
    }

    useEffect(() => {
        if (!isRackShape) return;
        updateRackHeight(rackContents);
    }, [isRackShape, rackContents.length, n?.shape?.slots, n?.shape?.slotH]);

    const addNodesToRack = useCallback((nodeIds) => {
        const ids = Array.isArray(nodeIds) ? nodeIds.filter(Boolean) : [];
        if (!ids.length) return;
        ids.forEach((id) => removeNodeFromOtherRacks(id));
        const unique = Array.from(new Set([...rackContents, ...ids]));
        setNodeById(n.id, { rackContents: unique });
        ids.forEach((nodeId) => {
            setNodeById(nodeId, (cur) => {
                const next = { ...(cur || {}), rackId: n.id, centralized: true };
                if (!next.rackOriginalPosition) next.rackOriginalPosition = cur?.position;
                return next;
            });
            restoreLinksFromRack(nodeId, n.id);
        });
        updateRackHeight(unique);
        setRackAddNodeId("");
        setRackSearch("");
    }, [rackContents, n.id, setNodeById, removeNodeFromOtherRacks, restoreLinksFromRack]);

    const addNodeToRack = useCallback((nodeId) => {
        if (!nodeId) return;
        addNodesToRack([nodeId]);
    }, [addNodesToRack]);

    const removeNodeFromRack = useCallback((nodeId) => {
        if (!nodeId) return;
        const nextContents = rackContents.filter((id) => id !== nodeId);
        setNodeById(n.id, { rackContents: nextContents });
        setNodeById(nodeId, (cur) => {
            const next = { ...(cur || {}) };
            if (next.rackOriginalPosition) next.position = next.rackOriginalPosition;
            next.rackId = undefined;
            return next;
        });
        updateRackHeight(nextContents);
    }, [rackContents, n.id, setNodeById]);

    const setRackCentralized = useCallback((value) => {
        const ids = Array.isArray(rackContents) ? rackContents : [];
        ids.forEach((nodeId) => {
            setNodeById(nodeId, (cur) => {
                const next = { ...(cur || {}), centralized: value, rackId: n.id };
                if (value && !next.rackOriginalPosition) next.rackOriginalPosition = cur?.position;
                if (!value && next.rackOriginalPosition) next.position = next.rackOriginalPosition;
                return next;
            });
            restoreLinksFromRack(nodeId, n.id);
        });
    }, [rackContents, setNodeById, n.id, restoreLinksFromRack]);

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
            if (e.key === TEXTBOX_CLIPBOARD_KEY) {
                setTextBoxClipboard(__loadTextBoxClipboard());
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
            title={(String(n.kind || "node").toLowerCase() === "switch") ? "Switch Inspector" : (String(n.kind || "node").toLowerCase() === "dissolver" ? "Dissolver Inspector" : "Node Inspector")}
        >
            <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[
                        { id: "node", label: "Node" },
                        { id: "links", label: "Links" },
                        { id: "rack", label: "Rack", disabled: !isRackShape },
                        { id: "tidy", label: "Tidy", disabled: String(n?.kind || "node").toLowerCase() !== "tidy" },
                    ].map((tab) => {
                        const isActive = inspectorTab === tab.id;
                        return (
                            <Btn
                                key={tab.id}
                                onClick={() => {
                                    if (tab.disabled) return;
                                    setInspectorTab(tab.id);
                                }}
                                variant={isActive ? "primary" : "ghost"}
                                style={{
                                    padding: "6px 10px",
                                    opacity: tab.disabled ? 0.4 : 1,
                                    pointerEvents: tab.disabled ? "none" : "auto",
                                }}
                            >
                                {tab.label}
                            </Btn>
                        );
                    })}
                </div>

                {inspectorTab === "node" && (
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
                            } else if (kind === "tidy") {
                                setNodeById(n.id, (cur) => ({
                                    ...cur,
                                    kind: "tidy",
                                    shape: cur?.shape || { type: "box", scale: [0.6, 0.4, 0.6] },
                                    tidy: cur?.tidy || {
                                        enabled: true,
                                        vertical: { w: 1.2, h: 1.6, d: 0.12 },
                                        horizontal: { w: 1.2, h: 0.12, d: 1.2 },
                                        offset: { x: 0, y: 0, z: 0 },
                                        spread: 0.15,
                                    },
                                }));
                            } else if (kind === "dissolver") {
                                setNodeById(n.id, (cur) => {
                                    const d0 = (cur && typeof cur.dissolver === "object") ? cur.dissolver : {};
                                    const b0 = (d0 && typeof d0.boundary === "object") ? d0.boundary : {};
                                    const dissolve0 = (d0 && typeof d0.dissolve === "object") ? d0.dissolve : {};
                                    const restore0 = (d0 && typeof d0.restore === "object") ? d0.restore : {};
                                    const dissolver = {
                                        enabled: d0.enabled !== false,
                                        showBoundary: (d0.showBoundary ?? true) !== false,
                                        boundary: {
                                            type: String(b0.type || "sphere").toLowerCase(),
                                            radius: Number(b0.radius ?? 1.0) || 1.0,
                                            height: Number(b0.height ?? 2.0) || 2.0,
                                            thickness: Number(b0.thickness ?? 0.2) || 0.2,
                                            feather: Number(b0.feather ?? 0.15) || 0.15,
                                            opacity: b0.opacity ?? 0.35,
                                            color: b0.color ?? "#c084fc",
                                        },
                                        dissolve: {
                                            effect: String(dissolve0.effect || "graceful"),
                                            duration: Number(dissolve0.duration ?? 1.0) || 1.0,
                                        },
                                        restore: {
                                            effect: String(restore0.effect || "graceful"),
                                            duration: Number(restore0.duration ?? 1.0) || 1.0,
                                        },
                                    };

                                    // Keep existing shape if present; otherwise pick a small sphere.
                                    const shape = cur?.shape || { type: "sphere", radius: 0.32 };

                                    return {
                                        kind: "dissolver",
                                        role: cur?.role || "dissolver",
                                        cluster: cur?.cluster || "FX",
                                        color: cur?.color || "#c084fc",
                                        shape,
                                        dissolver,
                                    };
                                });
                            } else {
                                setNode(n.id, { kind: "node" });
                            }
                        }}
                    >
                    <option value="node">Node</option>
                    <option value="switch">Switch</option>
                    <option value="tidy">Tidy Cables</option>
                    <option value="dissolver">Dissolver</option>
                </Select>
            </label>

            <div
                style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,0.16)",
                    background: "rgba(15,23,42,0.28)",
                    display: "grid",
                    gap: 8,
                }}
            >
                <div style={{ fontWeight: 700, fontSize: 12 }}>Node Profile</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Btn onClick={copyNodeProfile}>Copy Node Profile</Btn>
                    <Btn
                        disabled={!canPasteNodeProfile}
                        onClick={() => pasteNodeProfile(n.id)}
                    >
                        Paste Node Profile
                    </Btn>
                </div>
                <Checkbox
                    checked={includeNodeProfileLocation}
                    onChange={setIncludeNodeProfileLocation}
                    label="Include location (position + rotation)"
                />
            </div>



            {/* Dissolver controls */}
            {String(n.kind || "node").toLowerCase() === "dissolver" && (
                    <div
                        style={{
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 12,
                            padding: 10,
                            marginTop: 6,
                            marginBottom: 6,
                        }}
                    >
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <Checkbox
                                    checked={n.dissolver?.enabled !== false}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                enabled: !!e.target.checked,
                                            },
                                        }))
                                    }
                                />
                                Enabled
                            </label>

                            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <Checkbox
                                    checked={(n.dissolver?.showBoundary ?? true) !== false}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                showBoundary: !!e.target.checked,
                                            },
                                        }))
                                    }
                                />
                                Show boundary
                            </label>
                        </div>

                        <label style={{ marginTop: 8 }}>
                            Boundary type
                            <Select
                                value={String(n.dissolver?.boundary?.type || "sphere").toLowerCase()}
                                onChange={(e) =>
                                    setNodeById(n.id, (cur) => ({
                                        dissolver: {
                                            ...(cur.dissolver || {}),
                                            boundary: {
                                                ...(cur.dissolver?.boundary || {}),
                                                type: String(e.target.value || "sphere").toLowerCase(),
                                            },
                                        },
                                    }))
                                }
                            >
                                <option value="sphere">Sphere</option>
                                <option value="plane">Plane (slab)</option>
                                <option value="cylinder">Cylinder</option>
                                <option value="circle">Circle (thin cylinder)</option>
                            </Select>
                        </label>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                            <label>
                                Radius
                                <Input
                                    type="number"
                                    step="0.05"
                                    min="0.01"
                                    value={Number(n.dissolver?.boundary?.radius ?? 1.0)}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                boundary: {
                                                    ...(cur.dissolver?.boundary || {}),
                                                    radius: Math.max(0.01, Number(e.target.value || 0)),
                                                },
                                            },
                                        }))
                                    }
                                />
                            </label>

                            <label>
                                Height
                                <Input
                                    type="number"
                                    step="0.05"
                                    min="0.01"
                                    value={Number(n.dissolver?.boundary?.height ?? 2.0)}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                boundary: {
                                                    ...(cur.dissolver?.boundary || {}),
                                                    height: Math.max(0.01, Number(e.target.value || 0)),
                                                },
                                            },
                                        }))
                                    }
                                />
                            </label>

                            <label>
                                Thickness
                                <Input
                                    type="number"
                                    step="0.01"
                                    min="0.001"
                                    value={Number(n.dissolver?.boundary?.thickness ?? 0.2)}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                boundary: {
                                                    ...(cur.dissolver?.boundary || {}),
                                                    thickness: Math.max(0.001, Number(e.target.value || 0)),
                                                },
                                            },
                                        }))
                                    }
                                />
                            </label>

                            <label>
                                Feather
                                <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={Number(n.dissolver?.boundary?.feather ?? 0.15)}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                boundary: {
                                                    ...(cur.dissolver?.boundary || {}),
                                                    feather: Math.max(0, Number(e.target.value || 0)),
                                                },
                                            },
                                        }))
                                    }
                                />
                            </label>
                        </div>

                        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "10px 0" }} />

                        <div style={{ fontWeight: 700, opacity: 0.9, marginBottom: 6 }}>
                            Triggers
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <label>
                                Dissolve duration (s)
                                <Input
                                    type="number"
                                    step="0.05"
                                    min="0"
                                    value={Number(n.dissolver?.dissolve?.duration ?? 1.0)}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                dissolve: {
                                                    ...(cur.dissolver?.dissolve || {}),
                                                    duration: Math.max(0, Number(e.target.value || 0)),
                                                },
                                            },
                                        }))
                                    }
                                />
                            </label>

                            <label>
                                Restore duration (s)
                                <Input
                                    type="number"
                                    step="0.05"
                                    min="0"
                                    value={Number(n.dissolver?.restore?.duration ?? 1.0)}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                restore: {
                                                    ...(cur.dissolver?.restore || {}),
                                                    duration: Math.max(0, Number(e.target.value || 0)),
                                                },
                                            },
                                        }))
                                    }
                                />
                            </label>

                            <label>
                                Dissolve effect
                                <Select
                                    value={String(n.dissolver?.dissolve?.effect || "graceful")}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                dissolve: {
                                                    ...(cur.dissolver?.dissolve || {}),
                                                    effect: String(e.target.value || "graceful"),
                                                },
                                            },
                                        }))
                                    }
                                >
                                    <option value="graceful">Graceful</option>
                                    <option value="hide">Hide</option>
                                    <option value="particles">Particles</option>
                                    <option value="explosion">Explosion</option>
                                </Select>
                            </label>

                            <label>
                                Restore effect
                                <Select
                                    value={String(n.dissolver?.restore?.effect || "graceful")}
                                    onChange={(e) =>
                                        setNodeById(n.id, (cur) => ({
                                            dissolver: {
                                                ...(cur.dissolver || {}),
                                                restore: {
                                                    ...(cur.dissolver?.restore || {}),
                                                    effect: String(e.target.value || "graceful"),
                                                },
                                            },
                                        }))
                                    }
                                >
                                    <option value="graceful">Graceful</option>
                                    <option value="show">Show</option>
                                    <option value="particles">Particles</option>
                                    <option value="explosion">Explosion</option>
                                </Select>
                            </label>
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                            <Btn
                                onClick={() =>
                                    window.dispatchEvent(
                                        new CustomEvent("EPIC3D_DISSOLVER_CTRL", {
                                            detail: { dissolverId: n.id, action: "dissolve" },
                                        })
                                    )
                                }
                            >
                                Dissolve
                            </Btn>
                            <Btn
                                onClick={() =>
                                    window.dispatchEvent(
                                        new CustomEvent("EPIC3D_DISSOLVER_CTRL", {
                                            detail: { dissolverId: n.id, action: "restore" },
                                        })
                                    )
                                }
                            >
                                Restore
                            </Btn>
                        </div>
                    </div>
                )}


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

                <Panel title="Flow Anchors">
                    <div style={{ display: "grid", gap: 8 }}>
                        <Checkbox
                            checked={flowAnchorsEnabled}
                            onChange={(v) => setNodeById(n.id, { flowAnchorsEnabled: v })}
                            label="Enable anchors for outgoing flows"
                        />
                        <label>
                            Anchor set
                            <Select
                                value={activeAnchorSetId || ""}
                                onChange={(e) => setNodeById(n.id, { flowAnchorActiveSetId: e.target.value })}
                            >
                                {anchorSets.length > 0 ? (
                                    anchorSets.map((set) => (
                                        <option key={set.id} value={set.id}>
                                            {set.name || "Anchor Set"}
                                        </option>
                                    ))
                                ) : (
                                    <option value="">(none)</option>
                                )}
                            </Select>
                        </label>
                        <label>
                            Import anchor set
                            <Select
                                value=""
                                onChange={(e) => {
                                    importAnchorSetById(e.target.value);
                                    e.target.value = "";
                                }}
                            >
                                <option value="">Select a set...</option>
                                {allAnchorSets.map((set) => (
                                    <option key={`import-${set.id}`} value={set.id}>
                                        {set.name} — {set.nodeLabel}
                                    </option>
                                ))}
                            </Select>
                        </label>
                        {activeAnchorSet && (
                            <label>
                                Set name
                                <Input
                                    value={activeAnchorSet?.name || ""}
                                    placeholder="Anchor set name"
                                    onChange={(e) => updateActiveAnchorSet({ name: e.target.value })}
                                />
                            </label>
                        )}
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <Input
                                value={newAnchorSetName}
                                placeholder="New anchor set"
                                onChange={(e) => setNewAnchorSetName(e.target.value)}
                            />
                            <Btn
                                onClick={() => {
                                    const fallbackName = `Anchor Set ${anchorSets.length + 1}`;
                                    const name = (newAnchorSetName || fallbackName).trim();
                                    const id = `fas-${Math.random().toString(36).slice(2, 8)}`;
                                    updateFlowAnchorSets((prev) => ([
                                        ...(prev || []),
                                        {
                                            id,
                                            name,
                                            anchors: [],
                                            globalBendDeg: 90,
                                            dynamicBreakpoints: true,
                                            noDiagonal: true,
                                            spreadPaths: 0,
                                            spreadIgnoreBreakpoints: 0,
                                            hideRings: false,
                                        },
                                    ]));
                                    setNodeById(n.id, {
                                        flowAnchorActiveSetId: id,
                                        flowAnchorsEnabled: true,
                                        flowAnchorGlobalBendDeg: 90,
                                        flowAnchorDynamicBreakpoints: true,
                                        flowAnchorNoDiagonal: true,
                                    });
                                    setNewAnchorSetName("");
                                }}
                            >
                                Add Set
                            </Btn>
                            <Btn
                                disabled={!activeAnchorSetId}
                                onClick={() => {
                                    if (!activeAnchorSetId) return;
                                    updateFlowAnchorSets((prev) => prev.filter((s) => s?.id !== activeAnchorSetId));
                                    const nextId = anchorSets.find((s) => s?.id !== activeAnchorSetId)?.id || "";
                                    setNodeById(n.id, { flowAnchorActiveSetId: nextId || undefined });
                                }}
                            >
                                Delete Set
                            </Btn>
                        </div>
                        <Checkbox
                            checked={flowAnchorsHideRings === true}
                            onChange={(v) => updateActiveAnchorSet({ hideRings: v })}
                            label="Hide anchor rings"
                        />
                        <label>
                            Global bend (deg)
                            <NumberInput
                                value={flowAnchorGlobalBend}
                                step={45}
                                min={0}
                                onChange={(v) => updateActiveAnchorSet({ globalBendDeg: normalizeAnchorBendDeg(v) })}
                            />
                        </label>
                        <Checkbox
                            checked={flowAnchorDynamicBreakpoints === true}
                            onChange={(v) => updateActiveAnchorSet({ dynamicBreakpoints: v })}
                            label="Dynamic bend breakpoints"
                        />
                        {flowAnchorDynamicBreakpoints === true && (
                            <Checkbox
                                checked={flowAnchorNoDiagonal === true}
                                onChange={(v) => updateActiveAnchorSet({ noDiagonal: v })}
                                label="No diagonal paths"
                            />
                        )}
                        <label>
                            Spread paths
                            <NumberInput
                                value={Number(activeAnchorSet?.spreadPaths ?? 0) || 0}
                                step={0.05}
                                min={0}
                                onChange={(v) => updateActiveAnchorSet({ spreadPaths: v })}
                            />
                        </label>
                        <label>
                            Spread ignore breakpoints
                            <NumberInput
                                value={Number(activeAnchorSet?.spreadIgnoreBreakpoints ?? 0) || 0}
                                step={1}
                                min={0}
                                onChange={(v) => updateActiveAnchorSet({ spreadIgnoreBreakpoints: Math.max(0, Math.round(v || 0)) })}
                            />
                        </label>
                        <Btn
                            onClick={() => {
                                if (!activeAnchorSetId) return;
                                const id = `fa-${Math.random().toString(36).slice(2, 8)}`;
                                const last = flowAnchors.length ? flowAnchors[flowAnchors.length - 1] : null;
                                const basePos = Array.isArray(last?.pos) ? last.pos : [0, 0.2, 0];
                                const nextPos = [basePos[0] + 0.12, basePos[1], basePos[2]];
                                updateFlowAnchors((prev) => ([
                                    ...(prev || []),
                                    { id, enabled: true, pos: nextPos, bendDeg: null },
                                ]));
                            }}
                            disabled={!activeAnchorSetId}
                        >
                            Add Anchor
                        </Btn>
                        {!activeAnchorSetId && (
                            <div style={{ fontSize: 12, opacity: 0.7 }}>Create an anchor set to add anchors.</div>
                        )}
                        {activeAnchorSetId && !flowAnchors.length && (
                            <div style={{ fontSize: 12, opacity: 0.7 }}>No anchors yet.</div>
                        )}
                        {flowAnchors.map((anchor, idx) => {
                            const pos = Array.isArray(anchor?.pos) ? anchor.pos : [0, 0, 0];
                            const hasOverride = anchor?.bendDeg != null;
                            const isSelectedAnchor =
                                selectedFlowAnchor?.nodeId === n?.id &&
                                selectedFlowAnchor?.index === idx &&
                                (!selectedFlowAnchor?.setId || selectedFlowAnchor?.setId === activeAnchorSetId);
                            return (
                                <div
                                    key={anchor?.id || `fa-${idx}`}
                                    style={{
                                        border: "1px solid rgba(255,255,255,0.08)",
                                        borderRadius: 8,
                                        padding: 8,
                                        display: "grid",
                                        gap: 6,
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div style={{ fontWeight: 700 }}>Anchor {idx + 1}</div>
                                        <div style={{ display: "flex", gap: 6 }}>
                                            <Btn
                                                variant={isSelectedAnchor ? "primary" : "ghost"}
                                                glow={isSelectedAnchor}
                                                onClick={() => {
                                                    setSelected?.({ type: "flowAnchor", id: `${n.id}:${activeAnchorSetId || "default"}:${idx}` });
                                                    setSelectedFlowAnchor?.({ nodeId: n.id, setId: activeAnchorSetId, index: idx });
                                                    setSelectedBreakpoint?.(null);
                                                    setMode?.("select");
                                                    setMoveMode?.(true);
                                                    setTransformMode?.("translate");
                                                }}
                                            >
                                                {isSelectedAnchor ? "Selected" : "Select"}
                                            </Btn>
                                            <Btn
                                                onClick={() => updateFlowAnchors((prev) => {
                                                    if (idx <= 0) return prev;
                                                    const next = [...prev];
                                                    const t = next[idx - 1];
                                                    next[idx - 1] = next[idx];
                                                    next[idx] = t;
                                                    return next;
                                                })}
                                            >
                                                Up
                                            </Btn>
                                            <Btn
                                                onClick={() => updateFlowAnchors((prev) => {
                                                    if (idx >= prev.length - 1) return prev;
                                                    const next = [...prev];
                                                    const t = next[idx + 1];
                                                    next[idx + 1] = next[idx];
                                                    next[idx] = t;
                                                    return next;
                                                })}
                                            >
                                                Down
                                            </Btn>
                                            <Btn
                                                onClick={() => updateFlowAnchors((prev) => prev.filter((_, i) => i !== idx))}
                                            >
                                                Delete
                                            </Btn>
                                        </div>
                                    </div>
                                    <Checkbox
                                        checked={(anchor?.enabled ?? true) === true}
                                        onChange={(v) => updateFlowAnchor(idx, { enabled: v })}
                                        label="Enabled"
                                    />
                                    {anchorSets.length > 1 && activeAnchorSetId && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ fontSize: 12, opacity: 0.8 }}>Move to set</span>
                                            <Select
                                                defaultValue=""
                                                onChange={(e) => {
                                                    const key = `${activeAnchorSetId}:${idx}`;
                                                    moveAnchorSetRef.current[key] = e.target.value;
                                                }}
                                            >
                                                <option value="">Select set…</option>
                                                {anchorSets
                                                    .filter((set) => set?.id && set.id !== activeAnchorSetId)
                                                    .map((set) => (
                                                        <option key={set.id} value={set.id}>
                                                            {set.name || "Anchor Set"}
                                                        </option>
                                                    ))}
                                            </Select>
                                            <Btn
                                                onClick={() => {
                                                    const key = `${activeAnchorSetId}:${idx}`;
                                                    const targetId = moveAnchorSetRef.current[key];
                                                    if (!targetId) return;
                                                    moveFlowAnchorToSet(activeAnchorSetId, idx, targetId);
                                                    moveAnchorSetRef.current[key] = "";
                                                }}
                                            >
                                                Move
                                            </Btn>
                                        </div>
                                    )}
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                                        <label>
                                            X
                                            <NumberInput
                                                value={pos[0] ?? 0}
                                                step={0.05}
                                                min={-999}
                                                onChange={(v) => updateFlowAnchor(idx, { pos: [v, pos[1] ?? 0, pos[2] ?? 0] })}
                                            />
                                        </label>
                                        <label>
                                            Y
                                            <NumberInput
                                                value={pos[1] ?? 0}
                                                step={0.05}
                                                min={-999}
                                                onChange={(v) => updateFlowAnchor(idx, { pos: [pos[0] ?? 0, v, pos[2] ?? 0] })}
                                            />
                                        </label>
                                        <label>
                                            Z
                                            <NumberInput
                                                value={pos[2] ?? 0}
                                                step={0.05}
                                                min={-999}
                                                onChange={(v) => updateFlowAnchor(idx, { pos: [pos[0] ?? 0, pos[1] ?? 0, v] })}
                                            />
                                        </label>
                                    </div>
                                    <Checkbox
                                        checked={hasOverride}
                                        onChange={(v) => updateFlowAnchor(idx, { bendDeg: v ? normalizeAnchorBendDeg(flowAnchorGlobalBend) : null })}
                                        label="Override bend (deg)"
                                    />
                                    {hasOverride && (
                                        <label>
                                            Bend (deg)
                                            <NumberInput
                                                value={Number(anchor?.bendDeg ?? flowAnchorGlobalBend) || 0}
                                                step={45}
                                                min={0}
                                                onChange={(v) => updateFlowAnchor(idx, { bendDeg: normalizeAnchorBendDeg(v) })}
                                            />
                                        </label>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </Panel>

                <Panel title="Duplicate">
                    <div style={{ display: "grid", gap: 8 }}>
                        <Checkbox
                            checked={dupLinks}
                            onChange={(v) => setDupLinks(!!v)}
                            label="Duplicate links"
                        />
                        {dupLinks && (
                            <Checkbox
                                checked={dupAlsoNeighbours}
                                onChange={(v) => setDupAlsoNeighbours(!!v)}
                                label="Also neighbours (duplicate linked nodes)"
                            />
                        )}

                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <Btn
                                variant="primary"
                                disabled={!duplicateNodeWithLinks}
                                onClick={() =>
                                    duplicateNodeWithLinks?.(n.id, {
                                        duplicateLinks: dupLinks,
                                        alsoNeighbours: dupAlsoNeighbours,
                                    })
                                }
                            >
                                Duplicate
                            </Btn>
                            <div style={{ fontSize: 11, opacity: 0.75 }}>Snaps to nearest free grid space.</div>
                        </div>
                    </div>
                </Panel>


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
                        min={0}
                        max={50}
                        step={0.05}
                        value={n.labelScale ?? 1}
                        onChange={(e) =>
                            setNode(n.id, {
                                labelScale: Number(e.target.value),
                            })
                        }
                    />
                </label>
                <label>
                    Label X Offset
                    <input
                        type="range"
                        min={-3}
                        max={3}
                        step={0.01}
                        value={n.labelXOffset ?? 0}
                        onChange={(e) =>
                            setNode(n.id, {
                                labelXOffset: Number(e.target.value),
                            })
                        }
                    />
                </label>
                <label>
                    Label Y Offset
                    <input
                        type="range"
                        min={-3}
                        max={3}
                        step={0.01}
                        value={n.labelYOffset ?? 0}
                        onChange={(e) =>
                            setNode(n.id, {
                                labelYOffset: Number(e.target.value),
                            })
                        }
                    />
                    </label>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                        marginTop: 6,
                    }}
                >
                    <label>
                        Scale (numeric)
                        <NumberInput
                            min={0}
                            step={0.1}
                            value={n.labelScale ?? 1}
                            onChange={(v) =>
                                setNode(n.id, { labelScale: Number(v || 0) })
                            }
                        />
                    </label>

                    <label>
                        Label X Offset
                        <NumberInput
                            step={0.05}
                            value={n.labelXOffset ?? 0}
                            onChange={(v) =>
                                setNode(n.id, { labelXOffset: Number(v || 0) })
                            }
                        />
                    </label>
                    <label>
                        Label Y Offset
                        <NumberInput
                            step={0.05}
                            value={n.labelYOffset ?? 0}
                            onChange={(v) =>
                                setNode(n.id, { labelYOffset: Number(v || 0) })
                            }
                        />
                    </label>

                    <label>
                        Label Max Width (0 = no wrap)
                        <NumberInput
                            min={0}
                            step={1}
                            value={n.labelMaxWidth ?? 24}
                            onChange={(v) =>
                                setNode(n.id, {
                                    labelMaxWidth: Number(v || 0),
                                })
                            }
                        />
                    </label>
                </div>

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
                        checked={n.labelWrap ?? true}
                        onChange={(e) =>
                            setNode(n.id, { labelWrap: e.target.checked })
                        }
                    />
                    <span>Wrap label text</span>
                </label>

                <label style={{ display: "block", marginTop: 6 }}>
                    Alignment
                    <select
                        value={n.labelAlign ?? "center"}
                        onChange={(e) =>
                            setNode(n.id, { labelAlign: e.target.value })
                        }
                        style={{ width: "100%", marginTop: 4 }}
                    >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                    </select>
                </label>

                <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", opacity: 0.85 }}>
                        Advanced Label Style
                    </summary>

                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                        <label style={{ display: "block" }}>
                            Font URL (optional)
                            <Input
                                value={n.labelFont ?? ""}
                                placeholder="https://…/font.woff"
                                onChange={(e) =>
                                    setNode(n.id, {
                                        labelFont: e.target.value || null,
                                    })
                                }
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
                                Fill Opacity
                                <NumberInput
                                    min={0}
                                    step={0.05}
                                    value={n.labelFillOpacity ?? 1}
                                    onChange={(v) =>
                                        setNode(n.id, {
                                            labelFillOpacity: Number(v ?? 1),
                                        })
                                    }
                                />
                            </label>

                            <label>
                                Outline Blur
                                <NumberInput
                                    min={0}
                                    step={0.1}
                                    value={n.labelOutlineBlur ?? 0}
                                    onChange={(v) =>
                                        setNode(n.id, {
                                            labelOutlineBlur: Number(v ?? 0),
                                        })
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
                            <label>
                                Letter Spacing
                                <NumberInput
                                    step={0.01}
                                    value={n.labelLetterSpacing ?? 0}
                                    onChange={(v) =>
                                        setNode(n.id, {
                                            labelLetterSpacing: Number(v ?? 0),
                                        })
                                    }
                                />
                            </label>

                            <label>
                                Line Height
                                <NumberInput
                                    min={0.5}
                                    step={0.05}
                                    value={n.labelLineHeight ?? 1}
                                    onChange={(v) =>
                                        setNode(n.id, {
                                            labelLineHeight: Number(v ?? 1),
                                        })
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
                            <label>
                                Stroke Width
                                <NumberInput
                                    min={0}
                                    step={0.001}
                                    value={n.labelStrokeWidth ?? 0}
                                    onChange={(v) =>
                                        setNode(n.id, {
                                            labelStrokeWidth: Number(v ?? 0),
                                        })
                                    }
                                />
                            </label>

                            <label style={{ display: "block" }}>
                                Stroke Color
                                <input
                                    type="color"
                                    value={n.labelStrokeColor ?? "#000000"}
                                    onChange={(e) =>
                                        setNode(n.id, {
                                            labelStrokeColor: e.target.value,
                                        })
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
                            <label>
                                3D Layers
                                <NumberInput
                                    min={1}
                                    step={1}
                                    value={n.label3DLayers ?? 8}
                                    onChange={(v) =>
                                        setNode(n.id, {
                                            label3DLayers: Number(v ?? 8),
                                        })
                                    }
                                />
                            </label>

                            <label>
                                3D Step
                                <NumberInput
                                    min={0}
                                    step={0.005}
                                    value={n.label3DStep ?? 0.01}
                                    onChange={(v) =>
                                        setNode(n.id, {
                                            label3DStep: Number(v ?? 0.01),
                                        })
                                    }
                                />
                            </label>
                        </div>
                    </div>
                </details>

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

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <Btn
                                onClick={(e) => {
                                    e.preventDefault();
                                    copyTextBoxProfile();
                                }}
                            >
                                Copy text box
                            </Btn>
                            <Btn
                                disabled={!canPasteTextBoxProfile}
                                onClick={(e) => {
                                    e.preventDefault();
                                    pasteTextBoxProfile(n.id);
                                }}
                            >
                                Paste text box
                            </Btn>
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                            Paste includes content + styling/timers (use SHIFT+wheel to scroll inside a textbox).
                        </div>

                        {n.textBox?.enabled && (
                            <>
                                {/* Text content */}
                                <label>
                                    Text
                                    <textarea
                                        ref={textBoxTextAreaRef}
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

                                {/* Rich text + sizing */}
                                <div style={{ display: "grid", gap: 6 }}>
                                    <Checkbox
                                        checked={!!n.textBox?.richText}
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                textBox: {
                                                    ...(n.textBox || {}),
                                                    richText: v,
                                                },
                                            })
                                        }
                                        label="Rich text (Markdown)"
                                    />

                                    <Checkbox
                                        checked={!!n.textBox?.fitContent}
                                        onChange={(v) =>
                                            setNode(n.id, {
                                                textBox: {
                                                    ...(n.textBox || {}),
                                                    fitContent: v,
                                                },
                                            })
                                        }
                                        label="Fit size to content"
                                    />

                                    {n.textBox?.richText && (
                                        <div style={{ display: "grid", gap: 8 }}>
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                                {[
                                                    { label: "B", wrap: ["**", "**"], ph: "bold" },
                                                    { label: "I", wrap: ["*", "*"], ph: "italic" },
                                                    { label: "U", wrap: ["__", "__"], ph: "underline" },
                                                    { label: "S", wrap: ["~~", "~~"], ph: "strike" },
                                                    { label: "`", wrap: ["`", "`"], ph: "code" },
                                                    { label: "Link", wrap: ["[", "](https://)"], ph: "label" },
                                                    { label: "• List", list: "ul" },
                                                    { label: "1. List", list: "ol" },
                                                    { label: "```", wrap: ["```\n", "\n```"], ph: "code block" },
                                                ].map((b) => (
                                                    <Btn
                                                        key={b.label}
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            const tb = n.textBox || {};
                                                            const cur = tb.text || "";
                                                            const ta = textBoxTextAreaRef.current;

                                                            const setText = (next) =>
                                                                setNode(n.id, {
                                                                    textBox: { ...tb, text: next },
                                                                });

                                                            // Fallback: append if we can't read selection
                                                            if (!ta) {
                                                                if (b.list === "ul") {
                                                                    return setText(
                                                                        cur + (cur ? "\n" : "") + "- item",
                                                                    );
                                                                }
                                                                if (b.list === "ol") {
                                                                    return setText(
                                                                        cur + (cur ? "\n" : "") + "1. item",
                                                                    );
                                                                }
                                                                const pre = b.wrap?.[0] || "";
                                                                const post = b.wrap?.[1] || "";
                                                                const inner = b.ph || "text";
                                                                return setText(cur + (cur ? " " : "") + pre + inner + post);
                                                            }

                                                            const start = ta.selectionStart ?? 0;
                                                            const end = ta.selectionEnd ?? 0;
                                                            const selected = cur.slice(start, end);
                                                            const hasSel = selected.length > 0;

                                                            if (b.list) {
                                                                const block = hasSel ? selected : "item";
                                                                const lines = block.split("\n");
                                                                const nextBlock =
                                                                    b.list === "ul"
                                                                        ? lines
                                                                            .map((ln) =>
                                                                                ln.trim()
                                                                                    ? `- ${ln}`
                                                                                    : ln,
                                                                            )
                                                                            .join("\n")
                                                                        : lines
                                                                            .map((ln, i) =>
                                                                                ln.trim()
                                                                                    ? `${i + 1}. ${ln}`
                                                                                    : ln,
                                                                            )
                                                                            .join("\n");

                                                                const next =
                                                                    cur.slice(0, start) +
                                                                    nextBlock +
                                                                    cur.slice(end);
                                                                setText(next);
                                                                requestAnimationFrame(() => {
                                                                    ta.focus();
                                                                    ta.setSelectionRange(
                                                                        start,
                                                                        start + nextBlock.length,
                                                                    );
                                                                });
                                                                return;
                                                            }

                                                            const pre = b.wrap?.[0] || "";
                                                            const post = b.wrap?.[1] || "";
                                                            const inner = hasSel ? selected : b.ph || "text";
                                                            const next =
                                                                cur.slice(0, start) +
                                                                pre +
                                                                inner +
                                                                post +
                                                                cur.slice(end);
                                                            setText(next);
                                                            requestAnimationFrame(() => {
                                                                ta.focus();
                                                                ta.setSelectionRange(
                                                                    start + pre.length,
                                                                    start + pre.length + inner.length,
                                                                );
                                                            });
                                                        }}
                                                    >
                                                        {b.label}
                                                    </Btn>
                                                ))}
                                            </div>

                                            <div style={{ fontSize: 11, opacity: 0.7 }}>
                                                Supported: <code>**bold**</code>, <code>*italic*</code>,{" "}
                                                <code>__underline__</code>, <code>~~strike~~</code>,{" "}
                                                <code>`code`</code>, <code>[label](url)</code>, lists, code blocks.
                                            </div>
                                        </div>
                                    )}
                                </div>

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
                                        Width (0 = auto)
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
                                        Height (0 = auto)
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

                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(2, 1fr)",
                                        gap: 8,
                                    }}
                                >
                                    <label>
                                        Max Width (0 = none)
                                        <NumberInput
                                            value={n.textBox?.maxWidth ?? 0}
                                            step={0.1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox || {}),
                                                        maxWidth: Number(v || 0),
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Max Height (0 = none)
                                        <NumberInput
                                            value={n.textBox?.maxHeight ?? 0}
                                            step={0.1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    textBox: {
                                                        ...(n.textBox || {}),
                                                        maxHeight: Number(v || 0),
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

                                <details style={{ marginTop: 8 }}>
                                    <summary style={{ cursor: "pointer", opacity: 0.85 }}>
                                        Advanced Style
                                    </summary>

                                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                                        <label style={{ display: "block" }}>
                                            Text Align
                                            <select
                                                value={n.textBox?.align ?? "left"}
                                                onChange={(e) =>
                                                    setNode(n.id, {
                                                        textBox: {
                                                            ...(n.textBox || {}),
                                                            align: e.target.value,
                                                        },
                                                    })
                                                }
                                                style={{ width: "100%", marginTop: 4 }}
                                            >
                                                <option value="left">Left</option>
                                                <option value="center">Center</option>
                                                <option value="right">Right</option>
                                            </select>
                                        </label>

                                        <label style={{ display: "block" }}>
                                            Wrap / White-space
                                            <select
                                                value={n.textBox?.wrap ?? "pre-wrap"}
                                                onChange={(e) =>
                                                    setNode(n.id, {
                                                        textBox: {
                                                            ...(n.textBox || {}),
                                                            wrap: e.target.value,
                                                        },
                                                    })
                                                }
                                                style={{ width: "100%", marginTop: 4 }}
                                            >
                                                <option value="pre-wrap">Preserve line breaks (pre-wrap)</option>
                                                <option value="normal">Normal wrapping</option>
                                                <option value="nowrap">No wrap (horizontal scroll)</option>
                                            </select>
                                        </label>

                                        <label style={{ display: "block" }}>
                                            Font Family (CSS)
                                            <Input
                                                value={n.textBox?.fontFamily ?? ""}
                                                placeholder='e.g. "Inter", system-ui'
                                                onChange={(e) =>
                                                    setNode(n.id, {
                                                        textBox: {
                                                            ...(n.textBox || {}),
                                                            fontFamily: e.target.value,
                                                        },
                                                    })
                                                }
                                            />
                                        </label>

                                        <label
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={n.textBox?.forwardWheelToCanvas !== false}
                                                onChange={(e) =>
                                                    setNode(n.id, {
                                                        textBox: {
                                                            ...(n.textBox || {}),
                                                            forwardWheelToCanvas: e.target.checked,
                                                        },
                                                    })
                                                }
                                            />
                                            <span>Keep zoom while hovering (forward wheel to canvas)</span>
                                        </label>

                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "1fr 1fr",
                                                gap: 8,
                                            }}
                                        >
                                            <label style={{ display: "block" }}>
                                                Font Weight
                                                <select
                                                    value={n.textBox?.fontWeight ?? "normal"}
                                                    onChange={(e) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                fontWeight: e.target.value,
                                                            },
                                                        })
                                                    }
                                                    style={{ width: "100%", marginTop: 4 }}
                                                >
                                                    <option value="normal">Normal</option>
                                                    <option value="bold">Bold</option>
                                                    <option value="100">100</option>
                                                    <option value="200">200</option>
                                                    <option value="300">300</option>
                                                    <option value="400">400</option>
                                                    <option value="500">500</option>
                                                    <option value="600">600</option>
                                                    <option value="700">700</option>
                                                    <option value="800">800</option>
                                                    <option value="900">900</option>
                                                </select>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Font Style
                                                <select
                                                    value={n.textBox?.fontStyle ?? "normal"}
                                                    onChange={(e) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                fontStyle: e.target.value,
                                                            },
                                                        })
                                                    }
                                                    style={{ width: "100%", marginTop: 4 }}
                                                >
                                                    <option value="normal">Normal</option>
                                                    <option value="italic">Italic</option>
                                                </select>
                                            </label>
                                        </div>

                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "1fr 1fr",
                                                gap: 8,
                                            }}
                                        >
                                            <label>
                                                Letter Spacing (px)
                                                <NumberInput
                                                    step={0.25}
                                                    value={n.textBox?.letterSpacing ?? 0}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                letterSpacing: Number(v ?? 0),
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>

                                            <label>
                                                Line Height
                                                <NumberInput
                                                    min={0.5}
                                                    step={0.05}
                                                    value={n.textBox?.lineHeight ?? 1.4}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                lineHeight: Number(v ?? 1.4),
                                                            },
                                                        })
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
                                            <label>
                                                Padding (px)
                                                <NumberInput
                                                    min={0}
                                                    step={1}
                                                    value={n.textBox?.padding ?? 10}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                padding: Number(v ?? 10),
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>

                                            <label>
                                                Border Radius (px)
                                                <NumberInput
                                                    min={0}
                                                    step={1}
                                                    value={n.textBox?.borderRadius ?? 10}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                borderRadius: Number(v ?? 10),
                                                            },
                                                        })
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
                                            <label>
                                                Border Width (px)
                                                <NumberInput
                                                    min={0}
                                                    step={1}
                                                    value={n.textBox?.borderWidth ?? 0}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                borderWidth: Number(v ?? 0),
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>

                                            <label>
                                                Border Opacity
                                                <NumberInput
                                                    min={0}
                                                    step={0.05}
                                                    value={n.textBox?.borderOpacity ?? 1}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                borderOpacity: Number(v ?? 1),
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>
                                        </div>

                                        <label style={{ display: "block" }}>
                                            Border Color
                                            <input
                                                type="color"
                                                value={n.textBox?.borderColor ?? "#ffffff"}
                                                onChange={(e) =>
                                                    setNode(n.id, {
                                                        textBox: {
                                                            ...(n.textBox || {}),
                                                            borderColor: e.target.value,
                                                        },
                                                    })
                                                }
                                            />
                                        </label>

                                        <label
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={n.textBox?.shadow ?? true}
                                                onChange={(e) =>
                                                    setNode(n.id, {
                                                        textBox: {
                                                            ...(n.textBox || {}),
                                                            shadow: e.target.checked,
                                                        },
                                                    })
                                                }
                                            />
                                            <span>Shadow</span>
                                        </label>

                                        <label
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                // Default ON so clicking the textbox selects the node.
                                                checked={n.textBox?.allowPointerEvents !== false}
                                                onChange={(e) =>
                                                    setNode(n.id, {
                                                        textBox: {
                                                            ...(n.textBox || {}),
                                                            allowPointerEvents: e.target.checked,
                                                        },
                                                    })
                                                }
                                            />
                                            <span>Allow mouse interaction</span>
                                        </label>

                                        <label
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={n.textBox?.forwardWheelToCanvas !== false}
                                                onChange={(e) =>
                                                    setNode(n.id, {
                                                        textBox: {
                                                            ...(n.textBox || {}),
                                                            forwardWheelToCanvas: e.target.checked,
                                                        },
                                                    })
                                                }
                                            />
                                            <span>Keep zoom working on hover (Wheel ➜ canvas)</span>
                                        </label>

                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "1fr 1fr",
                                                gap: 8,
                                            }}
                                        >
                                            <label>
                                                Backdrop Blur (px)
                                                <NumberInput
                                                    min={0}
                                                    step={1}
                                                    value={n.textBox?.backdropBlur ?? 0}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                backdropBlur: Number(v ?? 0),
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>

                                            <label>
                                                Backdrop Saturate (%)
                                                <NumberInput
                                                    min={0}
                                                    step={5}
                                                    value={n.textBox?.backdropSaturate ?? 100}
                                                    onChange={(v) =>
                                                        setNode(n.id, {
                                                            textBox: {
                                                                ...(n.textBox || {}),
                                                                backdropSaturate: Number(v ?? 100),
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>
                                        </div>

                                        <label>
                                            Distance Factor (optional)
                                            <NumberInput
                                                min={0}
                                                step={0.1}
                                                value={n.textBox?.distanceFactor ?? 0}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        textBox: {
                                                            ...(n.textBox || {}),
                                                            distanceFactor: Number(v ?? 0),
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                </details>


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
                <label>
                    Centralized
                    <Checkbox
                        checked={!!n.centralized}
                        onChange={(v) => {
                            if (!v && n.rackOriginalPosition) {
                                setNode(n.id, { centralized: false, position: n.rackOriginalPosition });
                            } else if (v && !n.rackOriginalPosition) {
                                setNode(n.id, { centralized: true, rackOriginalPosition: n.position });
                            } else {
                                setNode(n.id, { centralized: v });
                            }
                        }}
                    />
                </label>

                {/* Transform */}
                <div>
                    <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>
                        Position
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        <label>
                            X
                            <NumberInput
                                value={n.position?.[0] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setNode(n.id, { position: [v, n.position?.[1] ?? 0, n.position?.[2] ?? 0] })
                                }
                            />
                        </label>
                        <label>
                            Y
                            <NumberInput
                                value={n.position?.[1] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setNode(n.id, { position: [n.position?.[0] ?? 0, v, n.position?.[2] ?? 0] })
                                }
                            />
                        </label>
                        <label>
                            Z
                            <NumberInput
                                value={n.position?.[2] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setNode(n.id, { position: [n.position?.[0] ?? 0, n.position?.[1] ?? 0, v] })
                                }
                            />
                        </label>
                    </div>
                </div>

                <div>
                    <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>
                        Rotation (radians)
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        <label>
                            X
                            <NumberInput
                                value={n.rotation?.[0] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setNode(n.id, { rotation: [v, n.rotation?.[1] ?? 0, n.rotation?.[2] ?? 0] })
                                }
                            />
                        </label>
                        <label>
                            Y
                            <NumberInput
                                value={n.rotation?.[1] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setNode(n.id, { rotation: [n.rotation?.[0] ?? 0, v, n.rotation?.[2] ?? 0] })
                                }
                            />
                        </label>
                        <label>
                            Z
                            <NumberInput
                                value={n.rotation?.[2] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setNode(n.id, { rotation: [n.rotation?.[0] ?? 0, n.rotation?.[1] ?? 0, v] })
                                }
                            />
                        </label>
                    </div>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>Quick rotate</div>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr",
                            gap: 6,
                            alignItems: "center",
                        }}
                    >
                        <Btn
                            onClick={() =>
                                setNode(n.id, {
                                    rotation: [-Math.PI / 2, n.rotation?.[1] ?? 0, n.rotation?.[2] ?? 0],
                                })
                            }
                        >
                            Face Up
                        </Btn>
                        <Btn
                            onClick={() =>
                                setNode(n.id, {
                                    rotation: [n.rotation?.[0] ?? 0, 0, n.rotation?.[2] ?? 0],
                                })
                            }
                        >
                            Up
                        </Btn>
                        <Btn
                            onClick={() =>
                                setNode(n.id, {
                                    rotation: [Math.PI / 2, n.rotation?.[1] ?? 0, n.rotation?.[2] ?? 0],
                                })
                            }
                        >
                            Face Down
                        </Btn>
                        <Btn
                            onClick={() =>
                                setNode(n.id, {
                                    rotation: [
                                        n.rotation?.[0] ?? 0,
                                        -Math.PI / 2,
                                        n.rotation?.[2] ?? 0,
                                    ],
                                })
                            }
                        >
                            Left
                        </Btn>
                        <Btn
                            onClick={() =>
                                setNode(n.id, {
                                    rotation: [
                                        n.rotation?.[0] ?? 0,
                                        Math.PI,
                                        n.rotation?.[2] ?? 0,
                                    ],
                                })
                            }
                        >
                            Down
                        </Btn>
                        <Btn
                            onClick={() =>
                                setNode(n.id, {
                                    rotation: [
                                        n.rotation?.[0] ?? 0,
                                        Math.PI / 2,
                                        n.rotation?.[2] ?? 0,
                                    ],
                                })
                            }
                        >
                            Right
                        </Btn>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                        <label style={{ flex: 1 }}>
                            Degrees
                            <input
                                key={String(n.rotation?.[1] ?? 0)}
                                ref={rotateDegRef}
                                type="number"
                                step="1"
                                defaultValue={Math.round(((n.rotation?.[1] ?? 0) * 180) / Math.PI)}
                            />
                        </label>
                        <Btn
                            onClick={() => {
                                const raw = Number(rotateDegRef.current?.value);
                                if (!Number.isFinite(raw)) return;
                                const rad = (raw * Math.PI) / 180;
                                setNode(n.id, {
                                    rotation: [n.rotation?.[0] ?? 0, rad, n.rotation?.[2] ?? 0],
                                });
                            }}
                        >
                            Set
                        </Btn>
                    </div>
                </div>

                {/* Shape & size */}
                {(() => {
                    const shape = n.shape || {
                        type: "sphere",
                        radius: 0.32,
                    };
                    const shapeTypeValue = (() => {
                        const t = (shape.type || "sphere").toLowerCase();
                        if (t === "model") {
                            const id = shape.modelId || shape.modelName || shape.name;
                            if (id) return `model:${id}`;
                        }
                        return t;
                    })();
                    const setShape = (patch) =>
                        setNode(n.id, {
                            shape: { ...shape, ...patch },
                        });

                    const setShapeType = (type) => {
                        if (String(type || "").startsWith("model:")) {
                            const id = String(type).slice(6);
                            const model = STATIC_SHAPES.find((m) => m.id === id || m.name === id);
                            if (model) {
                                setNode(n.id, {
                                    shape: {
                                        type: "model",
                                        modelId: model.id,
                                        modelName: model.name,
                                        url: model.url,
                                        scale: shape.scale || [1, 1, 1],
                                    },
                                });
                                return;
                            }
                        }
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
                            rack: {
                                type: "rack",
                                w: 0.6,
                                h: 1.8,
                                d: 0.6,
                                bar: 0.04,
                                rail: 0.03,
                                slotH: 0.25,
                                slots: 12,
                                columnGap: 0.12,
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
                                    value={shapeTypeValue}
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
                                    <option value="tv">TV</option>
                                    <option value="remote">Remote</option>
                                    <option value="accesspoint">Access Point</option>
                                    <option value="laviebox">LAVIE Box</option>
                                    <option value="amplifier">Amplifier</option>
                                    <option value="ipad">iPad</option>
                                    <option value="speaker">Speaker Ceiling</option>
                                    <option value="speakerfloor">Speaker Ground</option>
                                    <option value="soundbar">Soundbar</option>
                                    <option value="headphones">Headphones</option>
                                    <option value="subwoofer">Subwoofer</option>
                                    <option value="rack">Rack</option>
                                    <option value="transmitter">Transmitter</option>
                                    <option value="receiver">Receiver</option>
                                    <option value="mediahub">Media Hub</option>
                                    <option value="lansocket">LAN Socket</option>
                                    <option value="dissolver">Dissolver</option>
                                    {STATIC_SHAPES.map((m) => (
                                        <option key={m.id} value={`model:${m.id}`}>
                                            {m.name}
                                        </option>
                                    ))}
                                </Select>
                            </div>

                            {/* Per-shape size controls */}
                            {["tv", "remote", "accesspoint", "ipad", "amplifier", "laviebox", "speaker", "speakerfloor", "soundbar", "headphones", "subwoofer", "rack"].includes(shape.type) && (
                                <label>
                                    Scale
                                    <NumberInput
                                        value={shape.scale ?? 1}
                                        min={0.01}
                                        step={0.05}
                                        onChange={(v) => setShape({ scale: v })}
                                    />
                                </label>
                            )}
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

                            {shape.type === "rack" && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Rack Dimensions</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.w ?? 0.6}
                                                step={0.05}
                                                onChange={(v) => setShape({ w: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.h ?? 1.8}
                                                step={0.05}
                                                onChange={(v) => setShape({ h: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.d ?? 0.6}
                                                step={0.05}
                                                onChange={(v) => setShape({ d: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Bar Thickness
                                            <NumberInput
                                                value={shape.bar ?? 0.04}
                                                step={0.005}
                                                onChange={(v) => setShape({ bar: v })}
                                            />
                                        </label>
                                        <label>
                                            Rail Thickness
                                            <NumberInput
                                                value={shape.rail ?? 0.03}
                                                step={0.005}
                                                onChange={(v) => setShape({ rail: v })}
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Slot Height
                                        <NumberInput
                                            value={shape.slotH ?? 0.25}
                                            step={0.01}
                                            onChange={(v) => setShape({ slotH: v })}
                                        />
                                    </label>
                                </div>
                            )}

                            {shape.type === "model" && (
                                <div>
                                    <div
                                        style={{
                                            fontSize: 12,
                                            opacity: 0.85,
                                            marginBottom: 4,
                                        }}
                                    >
                                        Model Scale (x,y,z)
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
                                                value={shape.scale?.[0] ?? 1}
                                                onChange={(v) =>
                                                    setShape({
                                                        scale: [
                                                            v,
                                                            shape.scale?.[1] ?? 1,
                                                            shape.scale?.[2] ?? 1,
                                                        ],
                                                    })
                                                }
                                                step={0.05}
                                            />
                                        </label>
                                        <label>
                                            Y
                                            <NumberInput
                                                value={shape.scale?.[1] ?? 1}
                                                onChange={(v) =>
                                                    setShape({
                                                        scale: [
                                                            shape.scale?.[0] ?? 1,
                                                            v,
                                                            shape.scale?.[2] ?? 1,
                                                        ],
                                                    })
                                                }
                                                step={0.05}
                                            />
                                        </label>
                                        <label>
                                            Z
                                            <NumberInput
                                                value={shape.scale?.[2] ?? 1}
                                                onChange={(v) =>
                                                    setShape({
                                                        scale: [
                                                            shape.scale?.[0] ?? 1,
                                                            shape.scale?.[1] ?? 1,
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

                            {shape.type === "tv" && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>TV Size</div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.w ?? 1.2}
                                                step={0.05}
                                                onChange={(v) => setShape({ w: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.h ?? 0.7}
                                                step={0.05}
                                                onChange={(v) => setShape({ h: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.d ?? 0.08}
                                                step={0.01}
                                                onChange={(v) => setShape({ d: v })}
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Frame Thickness
                                        <NumberInput
                                            value={shape.frame ?? 0.06}
                                            step={0.01}
                                            onChange={(v) => setShape({ frame: v })}
                                        />
                                    </label>
                                    <label>
                                        Corner Radius
                                        <NumberInput
                                            value={shape.cornerRadius ?? 0}
                                            step={0.01}
                                            onChange={(v) => setShape({ cornerRadius: v })}
                                        />
                                    </label>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Screen W
                                            <NumberInput
                                                value={shape.screenW ?? (shape.w ?? 1.1) - (shape.frame ?? 0.05) * 2}
                                                step={0.05}
                                                onChange={(v) => setShape({ screenW: v })}
                                            />
                                        </label>
                                        <label>
                                            Screen H
                                            <NumberInput
                                                value={shape.screenH ?? (shape.h ?? 0.7) - (shape.frame ?? 0.05) * 2}
                                                step={0.05}
                                                onChange={(v) => setShape({ screenH: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Screen D
                                            <NumberInput
                                                value={shape.screenD ?? 0.02}
                                                step={0.01}
                                                onChange={(v) => setShape({ screenD: v })}
                                            />
                                        </label>
                                        <label>
                                            Screen Inset
                                            <NumberInput
                                                value={shape.screenInset ?? 0.004}
                                                step={0.002}
                                                onChange={(v) => setShape({ screenInset: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            Frame Offset X
                                            <NumberInput
                                                value={shape.frameOffsetX ?? 0}
                                                step={0.01}
                                                onChange={(v) => setShape({ frameOffsetX: v })}
                                            />
                                        </label>
                                        <label>
                                            Frame Offset Y
                                            <NumberInput
                                                value={shape.frameOffsetY ?? 0}
                                                step={0.01}
                                                onChange={(v) => setShape({ frameOffsetY: v })}
                                            />
                                        </label>
                                        <label>
                                            Frame Offset Z
                                            <NumberInput
                                                value={shape.frameOffsetZ ?? 0}
                                                step={0.01}
                                                onChange={(v) => setShape({ frameOffsetZ: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            Screen Offset X
                                            <NumberInput
                                                value={shape.screenOffsetX ?? 0}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ screenOffsetX: v })}
                                            />
                                        </label>
                                        <label>
                                            Screen Offset Y
                                            <NumberInput
                                                value={shape.screenOffsetY ?? 0}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ screenOffsetY: v })}
                                            />
                                        </label>
                                        <label>
                                            Screen Offset Z
                                            <NumberInput
                                                value={shape.screenOffsetZ ?? 0}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ screenOffsetZ: v })}
                                            />
                                        </label>
                                    </div>
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!shape.hideScreen}
                                            onChange={(e) => setShape({ hideScreen: e.target.checked })}
                                        />
                                        Hide Screen
                                    </label>
                                    <label>
                                        Frame Color
                                        <input
                                            type="color"
                                            value={(shape.colors?.frame ?? "#111827")}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), frame: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Screen Color
                                        <input
                                            type="color"
                                            value={(shape.colors?.screen ?? "#6b7280")}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), screen: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                </div>
                            )}

                            {shape.type === "remote" && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Remote Size</div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.w ?? 0.16}
                                                step={0.01}
                                                onChange={(v) => setShape({ w: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.h ?? 0.55}
                                                step={0.02}
                                                onChange={(v) => setShape({ h: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.d ?? 0.05}
                                                step={0.01}
                                                onChange={(v) => setShape({ d: v })}
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Corner Radius
                                        <NumberInput
                                            value={shape.cornerRadius ?? 0}
                                            step={0.01}
                                            onChange={(v) => setShape({ cornerRadius: v })}
                                        />
                                    </label>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Accent Plate</div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.accentW ?? 0.06}
                                                step={0.01}
                                                onChange={(v) => setShape({ accentW: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.accentH ?? 0.13}
                                                step={0.01}
                                                onChange={(v) => setShape({ accentH: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.accentD ?? 0}
                                                step={0.005}
                                                onChange={(v) => setShape({ accentD: v })}
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
                                        <label>
                                            Accent Offset Y
                                            <NumberInput
                                                value={shape.accentOffsetY ?? -0.15}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ accentOffsetY: v })}
                                            />
                                        </label>
                                        <label>
                                            Accent Offset Z
                                            <NumberInput
                                                value={shape.accentOffsetZ ?? -0.03}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ accentOffsetZ: v })}
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Body Color
                                        <input
                                            type="color"
                                            value={(shape.colors?.body ?? "#111827")}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), body: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Accent Color
                                        <input
                                            type="color"
                                            value={(shape.colors?.buttons ?? "#64748b")}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), buttons: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={shape.showScreen ?? true}
                                            onChange={(e) => setShape({ showScreen: e.target.checked })}
                                        />
                                        Show Screen
                                    </label>
                                    {(shape.showScreen ?? true) && (
                                        <div style={{ display: "grid", gap: 8 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Screen</div>
                                            <div
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "1fr 1fr 1fr",
                                                    gap: 8,
                                                }}
                                            >
                                                <label>
                                                    W
                                                    <NumberInput
                                                        value={shape.screenW ?? 0.13}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ screenW: v })}
                                                    />
                                                </label>
                                                <label>
                                                    H
                                                    <NumberInput
                                                        value={shape.screenH ?? 0.14}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ screenH: v })}
                                                    />
                                                </label>
                                                <label>
                                                    D
                                                    <NumberInput
                                                        value={shape.screenD ?? 0}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ screenD: v })}
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
                                                <label>
                                                    Offset Y
                                                    <NumberInput
                                                        value={shape.screenOffsetY ?? 0.19}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ screenOffsetY: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Offset Z
                                                    <NumberInput
                                                        value={shape.screenOffsetZ ?? -0.025}
                                                        min={-2}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ screenOffsetZ: v })}
                                                    />
                                                </label>
                                            </div>
                                            <label>
                                                Screen Color
                                                <input
                                                    type="color"
                                                    value={(shape.colors?.screen ?? "#334155")}
                                                    onChange={(e) =>
                                                        setShape({
                                                            colors: {
                                                                ...(shape.colors || {}),
                                                                screen: e.target.value,
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>
                                        </div>
                                    )}
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!shape.dockEnabled}
                                            onChange={(e) => setShape({ dockEnabled: e.target.checked })}
                                        />
                                        Docking Station
                                    </label>
                                    {shape.dockEnabled && (
                                        <div style={{ display: "grid", gap: 8 }}>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Dock Size</div>
                                            <div
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "1fr 1fr",
                                                    gap: 8,
                                                }}
                                            >
                                                <label>
                                                    Radius
                                                    <NumberInput
                                                        value={shape.dockRadius ?? 0.18}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ dockRadius: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Height
                                                    <NumberInput
                                                        value={shape.dockHeight ?? 0.045}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ dockHeight: v })}
                                                    />
                                                </label>
                                            </div>
                                            <div style={{ fontSize: 12, opacity: 0.85 }}>Dock Layers</div>
                                            <div
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "1fr 1fr 1fr",
                                                    gap: 8,
                                                }}
                                            >
                                                <label>
                                                    Mid R
                                                    <NumberInput
                                                        value={shape.dockMidRadius ?? 0.19}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ dockMidRadius: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Mid H
                                                    <NumberInput
                                                        value={shape.dockMidHeight ?? 0.025}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ dockMidHeight: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Inner R
                                                    <NumberInput
                                                        value={shape.dockInnerRadius ?? 0.12}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ dockInnerRadius: v })}
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
                                                <label>
                                                    Inner H
                                                    <NumberInput
                                                        value={shape.dockInnerHeight ?? 0.07}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ dockInnerHeight: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Offset Y
                                                    <NumberInput
                                                        value={shape.dockOffsetY ?? -0.33}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ dockOffsetY: v })}
                                                    />
                                                </label>
                                            </div>
                                            <label>
                                                Offset Z
                                                <NumberInput
                                                    value={shape.dockOffsetZ ?? 0}
                                                    min={-2}
                                                    step={0.01}
                                                    onChange={(v) => setShape({ dockOffsetZ: v })}
                                                />
                                            </label>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    Base Color
                                                    <input
                                                        type="color"
                                                        value={(shape.colors?.dockBase ?? "#0f172a")}
                                                        onChange={(e) =>
                                                            setShape({
                                                                colors: {
                                                                    ...(shape.colors || {}),
                                                                    dockBase: e.target.value,
                                                                },
                                                            })
                                                        }
                                                    />
                                                </label>
                                                <label>
                                                    Mid Color
                                                    <input
                                                        type="color"
                                                        value={(shape.colors?.dockMid ?? "#1f2937")}
                                                        onChange={(e) =>
                                                            setShape({
                                                                colors: {
                                                                    ...(shape.colors || {}),
                                                                    dockMid: e.target.value,
                                                                },
                                                            })
                                                        }
                                                    />
                                                </label>
                                                <label>
                                                    Inner Color
                                                    <input
                                                        type="color"
                                                        value={(shape.colors?.dockInner ?? "#334155")}
                                                        onChange={(e) =>
                                                            setShape({
                                                                colors: {
                                                                    ...(shape.colors || {}),
                                                                    dockInner: e.target.value,
                                                                },
                                                            })
                                                        }
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    )}
                                    <Btn
                                        onClick={() => {
                                            const payload = JSON.stringify(shape, null, 2);
                                            try {
                                                navigator.clipboard?.writeText(payload);
                                            } catch {}
                                        }}
                                    >
                                        Copy Remote Info
                                    </Btn>
                                </div>
                            )}

                            {shape.type === "accesspoint" && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <label>
                                        Height
                                        <NumberInput
                                            value={shape.height ?? 0.12}
                                            step={0.02}
                                            onChange={(v) => setShape({ height: v })}
                                        />
                                    </label>
                                    <label>
                                        Radius
                                        <NumberInput
                                            value={shape.radius ?? 0.35}
                                            step={0.02}
                                            onChange={(v) => setShape({ radius: v })}
                                        />
                                    </label>
                                    <label>
                                        Overlap Spread
                                        <NumberInput
                                            value={shape.overlapSpread ?? 1}
                                            step={0.05}
                                            onChange={(v) => setShape({ overlapSpread: v })}
                                        />
                                    </label>
                                    <label>
                                        Overlap Height
                                        <NumberInput
                                            value={shape.overlapHeight ?? 0.06}
                                            step={0.01}
                                            onChange={(v) => setShape({ overlapHeight: v })}
                                        />
                                    </label>
                                    <label>
                                        Shell Color
                                        <input
                                            type="color"
                                            value={(shape.colors?.body ?? "#e5e7eb")}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), body: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Overlap Color
                                        <input
                                            type="color"
                                            value={(shape.colors?.overlap ?? "#38bdf8")}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), overlap: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                </div>
                            )}

                            {shape.type === "amplifier" && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Amplifier Size</div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.w ?? 0.8}
                                                step={0.02}
                                                onChange={(v) => setShape({ w: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.d ?? 0.4}
                                                step={0.02}
                                                onChange={(v) => setShape({ d: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Stacks</div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            Base H
                                            <NumberInput
                                                value={shape.baseH ?? 0.18}
                                                step={0.01}
                                                onChange={(v) => setShape({ baseH: v })}
                                            />
                                        </label>
                                        <label>
                                            Mid H
                                            <NumberInput
                                                value={shape.midH ?? 0.16}
                                                step={0.01}
                                                onChange={(v) => setShape({ midH: v })}
                                            />
                                        </label>
                                        <label>
                                            Top H
                                            <NumberInput
                                                value={shape.topH ?? 0.12}
                                                step={0.01}
                                                onChange={(v) => setShape({ topH: v })}
                                            />
                                        </label>
                                    </div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            Base W
                                            <NumberInput
                                                value={shape.baseW ?? (shape.w ?? 0.8)}
                                                step={0.02}
                                                onChange={(v) => setShape({ baseW: v })}
                                            />
                                        </label>
                                        <label>
                                            Mid W
                                            <NumberInput
                                                value={shape.midW ?? (shape.w ?? 0.8) * 0.92}
                                                step={0.02}
                                                onChange={(v) => setShape({ midW: v })}
                                            />
                                        </label>
                                        <label>
                                            Top W
                                            <NumberInput
                                                value={shape.topW ?? (shape.w ?? 0.8) * 0.88}
                                                step={0.02}
                                                onChange={(v) => setShape({ topW: v })}
                                            />
                                        </label>
                                    </div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            Base D
                                            <NumberInput
                                                value={shape.baseD ?? (shape.d ?? 0.4)}
                                                step={0.02}
                                                onChange={(v) => setShape({ baseD: v })}
                                            />
                                        </label>
                                        <label>
                                            Mid D
                                            <NumberInput
                                                value={shape.midD ?? (shape.d ?? 0.4) * 0.9}
                                                step={0.02}
                                                onChange={(v) => setShape({ midD: v })}
                                            />
                                        </label>
                                        <label>
                                            Top D
                                            <NumberInput
                                                value={shape.topD ?? (shape.d ?? 0.4) * 0.85}
                                                step={0.02}
                                                onChange={(v) => setShape({ topD: v })}
                                            />
                                        </label>
                                    </div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            Base Corner
                                            <NumberInput
                                                value={shape.baseCorner ?? 0}
                                                step={0.01}
                                                onChange={(v) => setShape({ baseCorner: v })}
                                            />
                                        </label>
                                        <label>
                                            Mid Corner
                                            <NumberInput
                                                value={shape.midCorner ?? 0}
                                                step={0.01}
                                                onChange={(v) => setShape({ midCorner: v })}
                                            />
                                        </label>
                                        <label>
                                            Top Corner
                                            <NumberInput
                                                value={shape.topCorner ?? 0}
                                                step={0.01}
                                                onChange={(v) => setShape({ topCorner: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Display</div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.displayW ?? 0.35}
                                                step={0.01}
                                                onChange={(v) => setShape({ displayW: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.displayH ?? 0.04}
                                                step={0.01}
                                                onChange={(v) => setShape({ displayH: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.displayD ?? 0.01}
                                                step={0.005}
                                                onChange={(v) => setShape({ displayD: v })}
                                            />
                                        </label>
                                    </div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            Offset X
                                            <NumberInput
                                                value={shape.displayOffsetX ?? 0}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ displayOffsetX: v })}
                                            />
                                        </label>
                                        <label>
                                            Offset Y
                                            <NumberInput
                                                value={shape.displayOffsetY ?? 0.01}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ displayOffsetY: v })}
                                            />
                                        </label>
                                        <label>
                                            Offset Z
                                            <NumberInput
                                                value={shape.displayOffsetZ ?? 0.16}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ displayOffsetZ: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Knob</div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            Radius
                                            <NumberInput
                                                value={shape.knobR ?? 0.03}
                                                step={0.01}
                                                onChange={(v) => setShape({ knobR: v })}
                                            />
                                        </label>
                                        <label>
                                            Depth
                                            <NumberInput
                                                value={shape.knobD ?? 0.02}
                                                step={0.01}
                                                onChange={(v) => setShape({ knobD: v })}
                                            />
                                        </label>
                                        <label>
                                            Offset X
                                            <NumberInput
                                                value={shape.knobOffsetX ?? -0.2}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ knobOffsetX: v })}
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
                                        <label>
                                            Offset Y
                                            <NumberInput
                                                value={shape.knobOffsetY ?? -0.02}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ knobOffsetY: v })}
                                            />
                                        </label>
                                        <label>
                                            Offset Z
                                            <NumberInput
                                                value={shape.knobOffsetZ ?? 0.22}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ knobOffsetZ: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            Base Color
                                            <input
                                                type="color"
                                                value={(shape.colors?.base ?? "#0f172a")}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), base: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Mid Color
                                            <input
                                                type="color"
                                                value={(shape.colors?.mid ?? "#111827")}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), mid: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Top Color
                                            <input
                                                type="color"
                                                value={(shape.colors?.top ?? "#1f2937")}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), top: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Display Color
                                            <input
                                                type="color"
                                                value={(shape.colors?.display ?? "#38bdf8")}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), display: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Knob Color
                                            <input
                                                type="color"
                                                value={(shape.colors?.knob ?? "#e2e8f0")}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), knob: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                    <Btn
                                        onClick={() => {
                                            const payload = JSON.stringify(shape, null, 2);
                                            try {
                                                navigator.clipboard?.writeText(payload);
                                            } catch {}
                                        }}
                                    >
                                        Copy Amplifier Info
                                    </Btn>
                                </div>
                            )}

                            {shape.type === "laviebox" && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>LAVIE Box Size</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.w ?? 0.8}
                                                step={0.02}
                                                onChange={(v) => setShape({ w: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.h ?? 0.4}
                                                step={0.02}
                                                onChange={(v) => setShape({ h: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.d ?? 0.35}
                                                step={0.02}
                                                onChange={(v) => setShape({ d: v })}
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Corner Radius
                                        <NumberInput
                                            value={shape.cornerRadius ?? 0.02}
                                            step={0.01}
                                            onChange={(v) => setShape({ cornerRadius: v })}
                                        />
                                    </label>
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!shape.textEnabled}
                                            onChange={(e) => setShape({ textEnabled: e.target.checked })}
                                        />
                                        Enable 3D Text
                                    </label>
                                    {shape.textEnabled && (
                                        <div style={{ display: "grid", gap: 8 }}>
                                            <label>
                                                Text
                                                <input
                                                    value={shape.textValue ?? "LAVIE"}
                                                    onChange={(e) => setShape({ textValue: e.target.value })}
                                                />
                                            </label>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    Font
                                                    <Select
                                                        value={shape.textFont ?? "helvetiker"}
                                                        onChange={(e) => setShape({ textFont: e.target.value })}
                                                    >
                                                        <option value="helvetiker">Helvetiker</option>
                                                        <option value="optimer">Optimer</option>
                                                        <option value="gentilis">Gentilis</option>
                                                    </Select>
                                                </label>
                                                <label>
                                                    Size
                                                    <NumberInput
                                                        value={shape.textSize ?? 0.12}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ textSize: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Thickness
                                                    <NumberInput
                                                        value={shape.textDepth ?? 0.02}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ textDepth: v })}
                                                    />
                                                </label>
                                            </div>
                                            <label>
                                                Side
                                                <Select
                                                    value={shape.textSide ?? "front"}
                                                    onChange={(e) => setShape({ textSide: e.target.value })}
                                                >
                                                    <option value="front">Front</option>
                                                    <option value="back">Back</option>
                                                    <option value="left">Left</option>
                                                    <option value="right">Right</option>
                                                    <option value="top">Top</option>
                                                    <option value="bottom">Bottom</option>
                                                </Select>
                                            </label>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    Offset X
                                                    <NumberInput
                                                        value={shape.textOffsetX ?? 0}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ textOffsetX: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Offset Y
                                                    <NumberInput
                                                        value={shape.textOffsetY ?? 0}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ textOffsetY: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Offset Z
                                                    <NumberInput
                                                        value={shape.textOffsetZ ?? 0}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ textOffsetZ: v })}
                                                    />
                                                </label>
                                            </div>
                                            <label>
                                                Text Color
                                                <input
                                                    type="color"
                                                    value={shape.colors?.text ?? "#e2e8f0"}
                                                    onChange={(e) =>
                                                        setShape({
                                                            colors: { ...(shape.colors || {}), text: e.target.value },
                                                        })
                                                    }
                                                />
                                            </label>
                                        </div>
                                    )}
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!shape.panelEnabled}
                                            onChange={(e) => setShape({ panelEnabled: e.target.checked })}
                                        />
                                        Enable Hole Panel
                                    </label>
                                    {shape.panelEnabled && (
                                        <div style={{ display: "grid", gap: 8 }}>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    W
                                                    <NumberInput
                                                        value={shape.panelW ?? 0.7}
                                                        step={0.02}
                                                        onChange={(v) => setShape({ panelW: v })}
                                                    />
                                                </label>
                                                <label>
                                                    H
                                                    <NumberInput
                                                        value={shape.panelH ?? 0.22}
                                                        step={0.02}
                                                        onChange={(v) => setShape({ panelH: v })}
                                                    />
                                                </label>
                                                <label>
                                                    D
                                                    <NumberInput
                                                        value={shape.panelD ?? 0.03}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ panelD: v })}
                                                    />
                                                </label>
                                            </div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    Offset X
                                                    <NumberInput
                                                        value={shape.panelOffsetX ?? 0}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ panelOffsetX: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Offset Y
                                                    <NumberInput
                                                        value={shape.panelOffsetY ?? 0}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ panelOffsetY: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Offset Z
                                                    <NumberInput
                                                        value={shape.panelOffsetZ ?? 0.16}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ panelOffsetZ: v })}
                                                    />
                                                </label>
                                            </div>
                                            <label>
                                                Hole Mode
                                                <Select
                                                    value={shape.holeMode ?? "circle"}
                                                    onChange={(e) => setShape({ holeMode: e.target.value })}
                                                >
                                                    <option value="circle">Circle</option>
                                                    <option value="honeycomb">Honeycomb</option>
                                                </Select>
                                            </label>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    Count X
                                                    <NumberInput
                                                        value={shape.holeCountX ?? 4}
                                                        step={1}
                                                        onChange={(v) => setShape({ holeCountX: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Count Y
                                                    <NumberInput
                                                        value={shape.holeCountY ?? 3}
                                                        step={1}
                                                        onChange={(v) => setShape({ holeCountY: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Size
                                                    <NumberInput
                                                        value={shape.holeSize ?? 0.015}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ holeSize: v })}
                                                    />
                                                </label>
                                            </div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    Depth
                                                    <NumberInput
                                                        value={shape.holeDepth ?? 0.02}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ holeDepth: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Padding
                                                    <NumberInput
                                                        value={shape.holePadding ?? 0.01}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ holePadding: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Panel Color
                                                    <input
                                                        type="color"
                                                        value={shape.colors?.panel ?? "#1f2937"}
                                                        onChange={(e) =>
                                                            setShape({
                                                                colors: { ...(shape.colors || {}), panel: e.target.value },
                                                            })
                                                        }
                                                    />
                                                </label>
                                            </div>
                                            <label>
                                                Hole Color
                                                <input
                                                    type="color"
                                                    value={shape.colors?.holes ?? "#0b1220"}
                                                    onChange={(e) =>
                                                        setShape({
                                                            colors: { ...(shape.colors || {}), holes: e.target.value },
                                                        })
                                                    }
                                                />
                                            </label>
                                        </div>
                                    )}
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!shape.ledBoxEnabled}
                                            onChange={(e) => setShape({ ledBoxEnabled: e.target.checked })}
                                        />
                                        Enable LED Box
                                    </label>
                                    {shape.ledBoxEnabled && (
                                        <div style={{ display: "grid", gap: 8 }}>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    W
                                                    <NumberInput
                                                        value={shape.ledBoxW ?? 0.45}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledBoxW: v })}
                                                    />
                                                </label>
                                                <label>
                                                    H
                                                    <NumberInput
                                                        value={shape.ledBoxH ?? 0.08}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledBoxH: v })}
                                                    />
                                                </label>
                                                <label>
                                                    D
                                                    <NumberInput
                                                        value={shape.ledBoxD ?? 0.03}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledBoxD: v })}
                                                    />
                                                </label>
                                            </div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    Offset X
                                                    <NumberInput
                                                        value={shape.ledBoxOffsetX ?? 0}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledBoxOffsetX: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Offset Y
                                                    <NumberInput
                                                        value={shape.ledBoxOffsetY ?? -0.08}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledBoxOffsetY: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Offset Z
                                                    <NumberInput
                                                        value={shape.ledBoxOffsetZ ?? 0.16}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledBoxOffsetZ: v })}
                                                    />
                                                </label>
                                            </div>
                                            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                <input
                                                    type="checkbox"
                                                    checked={!!shape.ledEnabled}
                                                    onChange={(e) => setShape({ ledEnabled: e.target.checked })}
                                                />
                                                Enable LED Strip
                                            </label>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    Strip W
                                                    <NumberInput
                                                        value={shape.ledStripW ?? 0.4}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledStripW: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Strip H
                                                    <NumberInput
                                                        value={shape.ledStripH ?? 0.03}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledStripH: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Strip D
                                                    <NumberInput
                                                        value={shape.ledStripD ?? 0.01}
                                                        step={0.005}
                                                        onChange={(v) => setShape({ ledStripD: v })}
                                                    />
                                                </label>
                                            </div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                                <label>
                                                    Strip Offset Y
                                                    <NumberInput
                                                        value={shape.ledStripOffsetY ?? 0}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledStripOffsetY: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Strip Offset Z
                                                    <NumberInput
                                                        value={shape.ledStripOffsetZ ?? 0}
                                                        min={-2}
                                                        step={0.01}
                                                        onChange={(v) => setShape({ ledStripOffsetZ: v })}
                                                    />
                                                </label>
                                                <label>
                                                    Intensity
                                                    <NumberInput
                                                        value={shape.ledIntensity ?? 1.4}
                                                        step={0.1}
                                                        onChange={(v) => setShape({ ledIntensity: v })}
                                                    />
                                                </label>
                                            </div>
                                            <label>
                                                LED Color
                                                <input
                                                    type="color"
                                                    value={shape.colors?.led ?? "#38bdf8"}
                                                    onChange={(e) =>
                                                        setShape({
                                                            colors: { ...(shape.colors || {}), led: e.target.value },
                                                        })
                                                    }
                                                />
                                            </label>
                                            <label>
                                                LED Box Color
                                                <input
                                                    type="color"
                                                    value={shape.colors?.ledBox ?? "#111827"}
                                                    onChange={(e) =>
                                                        setShape({
                                                            colors: { ...(shape.colors || {}), ledBox: e.target.value },
                                                        })
                                                    }
                                                />
                                            </label>
                                        </div>
                                    )}
                                    <label>
                                        Body Color
                                        <input
                                            type="color"
                                            value={shape.colors?.body ?? "#111827"}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), body: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                    <Btn
                                        onClick={() => {
                                            const payload = JSON.stringify(shape, null, 2);
                                            try {
                                                navigator.clipboard?.writeText(payload);
                                            } catch {}
                                        }}
                                    >
                                        Copy LAVIE Box Info
                                    </Btn>
                                </div>
                            )}

                            {shape.type === "ipad" && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>iPad Size</div>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr 1fr",
                                            gap: 8,
                                        }}
                                    >
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.w ?? 0.5}
                                                step={0.02}
                                                onChange={(v) => setShape({ w: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.h ?? 0.7}
                                                step={0.02}
                                                onChange={(v) => setShape({ h: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.d ?? 0.03}
                                                step={0.01}
                                                onChange={(v) => setShape({ d: v })}
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Bezel
                                        <NumberInput
                                            value={shape.bezel ?? 0}
                                            step={0.01}
                                            onChange={(v) => setShape({ bezel: v })}
                                        />
                                    </label>
                                    <label>
                                        Corner Radius
                                        <NumberInput
                                            value={shape.cornerRadius ?? 0.04}
                                            step={0.01}
                                            onChange={(v) => setShape({ cornerRadius: v })}
                                        />
                                    </label>
                                    <label>
                                        Screen Inset
                                        <NumberInput
                                            value={shape.screenInset ?? 0.006}
                                            step={0.001}
                                            onChange={(v) => setShape({ screenInset: v })}
                                        />
                                    </label>
                                    <label>
                                        Screen Offset Z
                                        <NumberInput
                                            value={shape.screenOffsetZ ?? 0.007}
                                            min={-2}
                                            step={0.001}
                                            onChange={(v) => setShape({ screenOffsetZ: v })}
                                        />
                                    </label>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Screen W
                                            <NumberInput
                                                value={shape.screenW ?? 0.44}
                                                step={0.02}
                                                onChange={(v) => setShape({ screenW: v })}
                                            />
                                        </label>
                                        <label>
                                            Screen H
                                            <NumberInput
                                                value={shape.screenH ?? 0.66}
                                                step={0.02}
                                                onChange={(v) => setShape({ screenH: v })}
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Body Color
                                        <input
                                            type="color"
                                            value={(shape.colors?.body ?? "#111827")}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), body: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Bezel Color
                                        <input
                                            type="color"
                                            value={(shape.colors?.bezel ?? "#1f2937")}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), bezel: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Screen Color
                                        <input
                                            type="color"
                                            value={(shape.colors?.screen ?? "#334155")}
                                            onChange={(e) =>
                                                setShape({
                                                    colors: { ...(shape.colors || {}), screen: e.target.value },
                                                })
                                            }
                                        />
                                    </label>
                                    <Btn
                                        onClick={() => {
                                            const payload = JSON.stringify(shape, null, 2);
                                            try {
                                                navigator.clipboard?.writeText(payload);
                                            } catch {}
                                        }}
                                    >
                                        Copy iPad Info
                                    </Btn>
                                </div>
                            )}

                            {["speaker", "speakerfloor", "subwoofer"].includes(shape.type) && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Speaker Size</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.w ?? 0.6}
                                                min={0.01}
                                                step={0.01}
                                                onChange={(v) => setShape({ w: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.h ?? 0.9}
                                                min={0.01}
                                                step={0.01}
                                                onChange={(v) => setShape({ h: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.d ?? 0.25}
                                                min={0.01}
                                                step={0.01}
                                                onChange={(v) => setShape({ d: v })}
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Corner Radius
                                        <NumberInput
                                            value={shape.cornerRadius ?? 0.03}
                                            step={0.01}
                                            onChange={(v) => setShape({ cornerRadius: v })}
                                        />
                                    </label>
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!shape.inWall}
                                            onChange={(e) => setShape({ inWall: e.target.checked })}
                                        />
                                        In-wall Mode
                                    </label>
                                    <label>
                                        Front Depth
                                        <NumberInput
                                            value={shape.frontDepth ?? 0.25}
                                            min={0.005}
                                            step={0.005}
                                            onChange={(v) => setShape({ frontDepth: v })}
                                        />
                                    </label>
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!shape.rimEnabled}
                                            onChange={(e) => setShape({ rimEnabled: e.target.checked })}
                                        />
                                        Enable Rim
                                    </label>
                                    {shape.rimEnabled && (
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                            <label>
                                                Rim W
                                                <NumberInput
                                                    value={shape.rimW ?? 0.64}
                                                    step={0.02}
                                                    onChange={(v) => setShape({ rimW: v })}
                                                />
                                            </label>
                                            <label>
                                                Rim H
                                                <NumberInput
                                                    value={shape.rimH ?? 0.96}
                                                    step={0.02}
                                                    onChange={(v) => setShape({ rimH: v })}
                                                />
                                            </label>
                                            <label>
                                                Rim D
                                                <NumberInput
                                                    value={shape.rimD ?? 0.03}
                                                    step={0.01}
                                                    onChange={(v) => setShape({ rimD: v })}
                                                />
                                            </label>
                                        </div>
                                    )}
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Drivers</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            Count
                                            <NumberInput
                                                value={shape.driverCount ?? 2}
                                                step={1}
                                                onChange={(v) => setShape({ driverCount: v })}
                                            />
                                        </label>
                                        <label>
                                            Radius
                                            <NumberInput
                                                value={shape.driverRadius ?? 0.12}
                                                step={0.01}
                                                onChange={(v) => setShape({ driverRadius: v })}
                                            />
                                        </label>
                                        <label>
                                            Depth
                                            <NumberInput
                                                value={shape.driverDepth ?? 0.04}
                                                step={0.01}
                                                onChange={(v) => setShape({ driverDepth: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Inset
                                            <NumberInput
                                                value={shape.driverInset ?? 0.01}
                                                step={0.005}
                                                onChange={(v) => setShape({ driverInset: v })}
                                            />
                                        </label>
                                        <label>
                                            Offset Y
                                            <NumberInput
                                                value={shape.driverOffsetY ?? 0}
                                                min={-2}
                                                step={0.01}
                                                onChange={(v) => setShape({ driverOffsetY: v })}
                                            />
                                        </label>
                                    </div>
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!shape.grilleEnabled}
                                            onChange={(e) => setShape({ grilleEnabled: e.target.checked })}
                                        />
                                        Enable Grille
                                    </label>
                                    {shape.grilleEnabled && (
                                        <label>
                                            Grille Depth
                                            <NumberInput
                                                value={shape.grilleD ?? 0.01}
                                                step={0.005}
                                                onChange={(v) => setShape({ grilleD: v })}
                                            />
                                        </label>
                                    )}
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Body Color
                                            <input
                                                type="color"
                                                value={shape.colors?.body ?? "#111827"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), body: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Rim Color
                                            <input
                                                type="color"
                                                value={shape.colors?.rim ?? "#0f172a"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), rim: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Driver Color
                                            <input
                                                type="color"
                                                value={shape.colors?.driver ?? "#0f172a"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), driver: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Grille Color
                                            <input
                                                type="color"
                                                value={shape.colors?.grille ?? "#1f2937"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), grille: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                    <Btn
                                        onClick={() => {
                                            const payload = JSON.stringify(shape, null, 2);
                                            try {
                                                navigator.clipboard?.writeText(payload);
                                            } catch {}
                                        }}
                                    >
                                        Copy Speaker Info
                                    </Btn>
                                </div>
                            )}

                            {shape.type === "soundbar" && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Soundbar Size</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.w ?? 1.2}
                                                min={0.01}
                                                step={0.01}
                                                onChange={(v) => setShape({ w: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.h ?? 0.18}
                                                min={0.01}
                                                step={0.01}
                                                onChange={(v) => setShape({ h: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.d ?? 0.16}
                                                min={0.01}
                                                step={0.01}
                                                onChange={(v) => setShape({ d: v })}
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Corner Radius
                                        <NumberInput
                                            value={shape.cornerRadius ?? 0.07}
                                            step={0.01}
                                            onChange={(v) => setShape({ cornerRadius: v })}
                                        />
                                    </label>
                                    <label>
                                        Front Depth
                                        <NumberInput
                                            value={shape.frontDepth ?? 0.16}
                                            min={0.005}
                                            step={0.005}
                                            onChange={(v) => setShape({ frontDepth: v })}
                                        />
                                    </label>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Drivers</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Woofer Radius
                                            <NumberInput
                                                value={shape.wooferRadius ?? 0.07}
                                                step={0.01}
                                                onChange={(v) => setShape({ wooferRadius: v })}
                                            />
                                        </label>
                                        <label>
                                            Tweeter Radius
                                            <NumberInput
                                                value={shape.tweeterRadius ?? 0.032}
                                                step={0.01}
                                                onChange={(v) => setShape({ tweeterRadius: v })}
                                            />
                                        </label>
                                        <label>
                                            Woofer Offset X
                                            <NumberInput
                                                value={shape.wooferOffsetX ?? 0.36}
                                                step={0.01}
                                                onChange={(v) => setShape({ wooferOffsetX: v })}
                                            />
                                        </label>
                                        <label>
                                            Tweeter Offset Y
                                            <NumberInput
                                                value={shape.tweeterOffsetY ?? 0.02}
                                                step={0.01}
                                                onChange={(v) => setShape({ tweeterOffsetY: v })}
                                            />
                                        </label>
                                    </div>
                                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!shape.grilleEnabled}
                                            onChange={(e) => setShape({ grilleEnabled: e.target.checked })}
                                        />
                                        Enable Grille
                                    </label>
                                    {shape.grilleEnabled && (
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                            <label>
                                                Grille Depth
                                                <NumberInput
                                                    value={shape.grilleD ?? 0.012}
                                                    step={0.005}
                                                    onChange={(v) => setShape({ grilleD: v })}
                                                />
                                            </label>
                                            <label>
                                                Grille Inset
                                                <NumberInput
                                                    value={shape.grilleInset ?? 0.01}
                                                    step={0.005}
                                                    onChange={(v) => setShape({ grilleInset: v })}
                                                />
                                            </label>
                                        </div>
                                    )}
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Body Color
                                            <input
                                                type="color"
                                                value={shape.colors?.body ?? "#111827"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), body: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Driver Color
                                            <input
                                                type="color"
                                                value={shape.colors?.driver ?? "#1b1d22"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), driver: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Driver Ring
                                            <input
                                                type="color"
                                                value={shape.colors?.driverRing ?? "#0b1220"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), driverRing: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Grille Color
                                            <input
                                                type="color"
                                                value={shape.colors?.grille ?? "#1f2937"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), grille: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                    <Btn
                                        onClick={() => {
                                            const payload = JSON.stringify(shape, null, 2);
                                            try {
                                                navigator.clipboard?.writeText(payload);
                                            } catch {}
                                        }}
                                    >
                                        Copy Soundbar Info
                                    </Btn>
                                </div>
                            )}

                            {shape.type === "headphones" && (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Headphones Size</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            W
                                            <NumberInput
                                                value={shape.w ?? 0.98}
                                                min={0.01}
                                                step={0.01}
                                                onChange={(v) => setShape({ w: v })}
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={shape.h ?? 0.84}
                                                min={0.01}
                                                step={0.01}
                                                onChange={(v) => setShape({ h: v })}
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={shape.d ?? 0.32}
                                                min={0.01}
                                                step={0.01}
                                                onChange={(v) => setShape({ d: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Ear Pads</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            Ear R
                                            <NumberInput
                                                value={shape.earR ?? 0.18}
                                                step={0.01}
                                                onChange={(v) => setShape({ earR: v })}
                                            />
                                        </label>
                                        <label>
                                            Ear D
                                            <NumberInput
                                                value={shape.earD ?? 0.18}
                                                step={0.01}
                                                onChange={(v) => setShape({ earD: v })}
                                            />
                                        </label>
                                        <label>
                                            Ear Inset
                                            <NumberInput
                                                value={shape.earInset ?? 0.014}
                                                step={0.005}
                                                onChange={(v) => setShape({ earInset: v })}
                                            />
                                        </label>
                                        <label>
                                            Driver R
                                            <NumberInput
                                                value={shape.earDriverRadius ?? 0.1}
                                                step={0.01}
                                                onChange={(v) => setShape({ earDriverRadius: v })}
                                            />
                                        </label>
                                        <label>
                                            Cushion R
                                            <NumberInput
                                                value={shape.cushionRadius ?? 0.19}
                                                step={0.01}
                                                onChange={(v) => setShape({ cushionRadius: v })}
                                            />
                                        </label>
                                        <label>
                                            Cushion Tube
                                            <NumberInput
                                                value={shape.cushionTube ?? 0.035}
                                                step={0.005}
                                                onChange={(v) => setShape({ cushionTube: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>Band</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            Band Radius
                                            <NumberInput
                                                value={shape.bandRadius ?? 0.42}
                                                step={0.01}
                                                onChange={(v) => setShape({ bandRadius: v })}
                                            />
                                        </label>
                                        <label>
                                            Band Tube
                                            <NumberInput
                                                value={shape.bandTube ?? 0.045}
                                                step={0.005}
                                                onChange={(v) => setShape({ bandTube: v })}
                                            />
                                        </label>
                                        <label>
                                            Band Pad
                                            <NumberInput
                                                value={shape.bandPadTube ?? 0.032}
                                                step={0.005}
                                                onChange={(v) => setShape({ bandPadTube: v })}
                                            />
                                        </label>
                                        <label>
                                            Band Y
                                            <NumberInput
                                                value={shape.bandYOffset ?? 0.22}
                                                step={0.01}
                                                onChange={(v) => setShape({ bandYOffset: v })}
                                            />
                                        </label>
                                        <label>
                                            Ear Y
                                            <NumberInput
                                                value={shape.earYOffset ?? -0.06}
                                                step={0.01}
                                                onChange={(v) => setShape({ earYOffset: v })}
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Band Color
                                            <input
                                                type="color"
                                                value={shape.colors?.body ?? "#111827"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), body: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Ear Color
                                            <input
                                                type="color"
                                                value={shape.colors?.ear ?? "#1f2937"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), ear: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Cushion
                                            <input
                                                type="color"
                                                value={shape.colors?.cushion ?? "#0f172a"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), cushion: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Driver Color
                                            <input
                                                type="color"
                                                value={shape.colors?.driver ?? "#0f172a"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), driver: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Ring Color
                                            <input
                                                type="color"
                                                value={shape.colors?.driverRing ?? "#0b1220"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), driverRing: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Band Pad
                                            <input
                                                type="color"
                                                value={shape.colors?.bandPad ?? "#0b1220"}
                                                onChange={(e) =>
                                                    setShape({
                                                        colors: { ...(shape.colors || {}), bandPad: e.target.value },
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                    <Btn
                                        onClick={() => {
                                            const payload = JSON.stringify(shape, null, 2);
                                            try {
                                                navigator.clipboard?.writeText(payload);
                                            } catch {}
                                        }}
                                    >
                                        Copy Headphones Info
                                    </Btn>
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
                            portsEnabled: (c0.portsEnabled ?? true) !== false,
                            portsCount: [8, 16, 24, 48].includes(Number(c0.portsCount ?? c0.portCount)) ? Number(c0.portsCount ?? c0.portCount) : 24,
                            sfpCount: [0, 1, 2, 4].includes(Number(c0.sfpCount ?? c0.sfpPorts)) ? Number(c0.sfpCount ?? c0.sfpPorts) : 0,
                            showButtons: !!(c0.showButtons ?? false),
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

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                                <label>
                                    Ports
                                    <Select
                                        value={String(sw0.portsCount || 24)}
                                        onChange={(e) => setSwitch({ portsCount: Number(e.target.value) || 24 })}
                                    >
                                        {[8, 16, 24, 48].map((v) => (
                                            <option key={v} value={v}>{v}</option>
                                        ))}
                                    </Select>
                                </label>
                                <label>
                                    SFP
                                    <Select
                                        value={String(sw0.sfpCount || 0)}
                                        onChange={(e) => setSwitch({ sfpCount: Number(e.target.value) || 0 })}
                                    >
                                        {[0, 1, 2, 4].map((v) => (
                                            <option key={v} value={v}>{v}</option>
                                        ))}
                                    </Select>
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
                                    <input
                                        type="checkbox"
                                        checked={!!sw0.showButtons}
                                        onChange={(e) => setSwitch({ showButtons: e.target.checked })}
                                    />
                                    Show Buttons
                                </label>
                            </div>

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
                    </div>
                )}

                {inspectorTab === "rack" && (
                    <div style={{ display: "grid", gap: 8 }}>
                        {isRackShape ? (
                            <div style={{ display: "grid", gap: 8 }}>
                                <div
                                    style={{
                                        display: "grid",
                                        gap: 8,
                                        padding: "10px 12px",
                                        borderRadius: 14,
                                        background: "linear-gradient(135deg, rgba(15,23,42,0.65), rgba(2,6,23,0.7))",
                                        border: "1px solid rgba(148,163,184,0.2)",
                                        boxShadow: "0 10px 24px rgba(2,6,23,0.35) inset",
                                    }}
                                >
                                    <div
                                        style={{
                                            fontSize: 12,
                                            fontWeight: 900,
                                            letterSpacing: "0.14em",
                                            textTransform: "uppercase",
                                            opacity: 0.85,
                                        }}
                                    >
                                        Rack Dimensions
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            W
                                            <NumberInput
                                                value={n.shape?.w ?? 0.6}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNodeById(n.id, (cur) => ({
                                                        ...cur,
                                                        shape: { ...(cur?.shape || {}), type: "rack", w: v },
                                                    }))
                                                }
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={n.shape?.h ?? 1.8}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNodeById(n.id, (cur) => ({
                                                        ...cur,
                                                        shape: { ...(cur?.shape || {}), type: "rack", h: v },
                                                    }))
                                                }
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={n.shape?.d ?? 0.6}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNodeById(n.id, (cur) => ({
                                                        ...cur,
                                                        shape: { ...(cur?.shape || {}), type: "rack", d: v },
                                                    }))
                                                }
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Bar Thickness
                                            <NumberInput
                                                value={n.shape?.bar ?? 0.04}
                                                step={0.005}
                                                onChange={(v) =>
                                                    setNodeById(n.id, (cur) => ({
                                                        ...cur,
                                                        shape: { ...(cur?.shape || {}), type: "rack", bar: v },
                                                    }))
                                                }
                                            />
                                        </label>
                                        <label>
                                            Rail Thickness
                                            <NumberInput
                                                value={n.shape?.rail ?? 0.03}
                                                step={0.005}
                                                onChange={(v) =>
                                                    setNodeById(n.id, (cur) => ({
                                                        ...cur,
                                                        shape: { ...(cur?.shape || {}), type: "rack", rail: v },
                                                    }))
                                                }
                                            />
                                        </label>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <label>
                                            Slot Height
                                            <NumberInput
                                                value={n.shape?.slotH ?? 0.25}
                                                step={0.01}
                                                onChange={(v) =>
                                                    setNodeById(n.id, (cur) => ({
                                                        ...cur,
                                                        shape: { ...(cur?.shape || {}), type: "rack", slotH: v },
                                                    }))
                                                }
                                            />
                                        </label>
                                        <label>
                                            Slots
                                            <NumberInput
                                                value={n.shape?.slots ?? 12}
                                                step={1}
                                                min={1}
                                                onChange={(v) =>
                                                    setNodeById(n.id, (cur) => ({
                                                        ...cur,
                                                        shape: { ...(cur?.shape || {}), type: "rack", slots: Math.max(1, Math.floor(Number(v) || 1)) },
                                                    }))
                                                }
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                    <div style={{ fontWeight: 900 }}>Rack Contents</div>
                                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                                        <Checkbox
                                            checked={rackCentralizedAll}
                                            onChange={(v) => setRackCentralized(v)}
                                        />
                                        Global Centralize
                                    </label>
                                </div>

                                <div style={{ display: "grid", gap: 8 }}>
                                    <label>
                                        Search
                                        <Input
                                            placeholder="Type name (use * to add all matches)..."
                                            value={rackSearch}
                                            onChange={(e) => setRackSearch(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key !== "Enter") return;
                                                const raw = rackSearch.trim();
                                                if (!raw && rackAddNodeId) {
                                                    addNodeToRack(rackAddNodeId);
                                                    return;
                                                }
                                                if (raw.endsWith("*")) {
                                                    const prefix = raw.slice(0, -1).trim().toLowerCase();
                                                    const matches = availableRackNodes
                                                        .filter((opt) => opt.label.toLowerCase().startsWith(prefix))
                                                        .map((opt) => opt.id);
                                                    addNodesToRack(matches);
                                                    return;
                                                }
                                                const exact = availableRackNodes.find(
                                                    (opt) => opt.label.toLowerCase() === raw.toLowerCase(),
                                                );
                                                if (exact) {
                                                    addNodeToRack(exact.id);
                                                }
                                            }}
                                        />
                                    </label>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <Select
                                            value={rackAddNodeId}
                                            onChange={(e) => setRackAddNodeId(e.target.value)}
                                            style={{ flex: 1 }}
                                        >
                                            <option value="">Select node...</option>
                                            {availableRackNodes
                                                .filter((opt) => {
                                                    const q = rackSearch.trim();
                                                    if (!q) return true;
                                                    const query = q.endsWith("*") ? q.slice(0, -1).trim() : q;
                                                    if (!query) return true;
                                                    return opt.label.toLowerCase().includes(query.toLowerCase());
                                                })
                                                .map((opt) => (
                                                    <option key={opt.id} value={opt.id}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                        </Select>
                                        <Btn
                                            onClick={() => {
                                                const raw = rackSearch.trim();
                                                if (raw.endsWith("*")) {
                                                    const prefix = raw.slice(0, -1).trim().toLowerCase();
                                                    const matches = availableRackNodes
                                                        .filter((opt) => opt.label.toLowerCase().startsWith(prefix))
                                                        .map((opt) => opt.id);
                                                    addNodesToRack(matches);
                                                    return;
                                                }
                                                if (rackAddNodeId) addNodeToRack(rackAddNodeId);
                                            }}
                                            disabled={!rackAddNodeId && !rackSearch.trim()}
                                        >
                                            Add
                                        </Btn>
                                    </div>
                                </div>

                                {rackContents.length === 0 && (
                                    <div style={{ fontSize: 12, opacity: 0.7 }}>No nodes in rack yet.</div>
                                )}
                                <div style={{ display: "grid", gap: 6 }}>
                                    {rackContents.map((id, idx) => {
                                        const node = (nodes || []).find((x) => x.id === id);
                                        const roomName = rooms.find((rr) => rr.id === node?.roomId)?.name;
                                        const deckName = decks.find((dd) => dd.id === node?.deckId)?.name;
                                        return (
                                            <div
                                                key={id}
                                                draggable
                                                onDragStart={() => setRackDragId(id)}
                                                onDragOver={(e) => e.preventDefault()}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    if (!rackDragId || rackDragId === id) return;
                                                    const next = rackContents.slice();
                                                    const from = next.indexOf(rackDragId);
                                                    const to = next.indexOf(id);
                                                    if (from === -1 || to === -1) return;
                                                    next.splice(from, 1);
                                                    next.splice(to, 0, rackDragId);
                                                    setNodeById(n.id, { rackContents: next });
                                                    setRackDragId(null);
                                                }}
                                                onMouseEnter={() => {
                                                    window.dispatchEvent(new CustomEvent("EPIC3D_RACK_HOVER", { detail: { nodeId: id } }));
                                                }}
                                                onMouseLeave={() => {
                                                    window.dispatchEvent(new CustomEvent("EPIC3D_RACK_HOVER_CLEAR", { detail: { nodeId: id } }));
                                                }}
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "24px 1fr auto",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    padding: "6px 8px",
                                                    borderRadius: 10,
                                                    background: "rgba(2,6,23,0.28)",
                                                    border: "1px solid rgba(148,163,184,0.14)",
                                                }}
                                            >
                                                <div style={{ textAlign: "center", fontSize: 11, opacity: 0.7, cursor: "grab" }}>≡</div>
                                                <div style={{ display: "grid", gap: 2 }}>
                                                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                                                        {node?.label || node?.name || id}
                                                    </div>
                                                    <div style={{ fontSize: 10, opacity: 0.65 }}>
                                                        {roomName ? `Room: ${roomName}` : "Room: —"}
                                                        {deckName ? `  ·  Deck: ${deckName}` : ""}
                                                    </div>
                                                </div>
                                                <Btn variant="ghost" onClick={() => removeNodeFromRack(id)}>Remove</Btn>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div style={{ fontSize: 12, opacity: 0.7 }}>
                                Rack options are available when the node shape is set to Rack.
                            </div>
                        )}
                    </div>
                )}

                {inspectorTab === "tidy" && (
                    <div style={{ display: "grid", gap: 10 }}>
                        {String(n?.kind || "node").toLowerCase() === "tidy" ? (
                            <div style={{ display: "grid", gap: 10 }}>
                                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <Checkbox
                                        checked={!!n.tidy?.enabled}
                                        onChange={(v) => setNode(n.id, { tidy: { ...(n.tidy || {}), enabled: v } })}
                                    />
                                    Enable Cable Tidy
                                </label>
                                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <Checkbox
                                        checked={!!n.tidy?.showWalls}
                                        onChange={(v) => setNode(n.id, { tidy: { ...(n.tidy || {}), showWalls: v } })}
                                    />
                                    Show Tidy Walls
                                </label>
                                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <Checkbox
                                        checked={!!n.tidy?.forceAll}
                                        onChange={(v) => setNode(n.id, { tidy: { ...(n.tidy || {}), forceAll: v } })}
                                    />
                                    Force All Links Through Tidy
                                </label>
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>Trigger Wall: Vertical</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            W
                                            <NumberInput
                                                value={n.tidy?.vertical?.w ?? 1.2}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        tidy: {
                                                            ...(n.tidy || {}),
                                                            vertical: { ...(n.tidy?.vertical || {}), w: v },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={n.tidy?.vertical?.h ?? 1.6}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        tidy: {
                                                            ...(n.tidy || {}),
                                                            vertical: { ...(n.tidy?.vertical || {}), h: v },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={n.tidy?.vertical?.d ?? 0.12}
                                                step={0.02}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        tidy: {
                                                            ...(n.tidy || {}),
                                                            vertical: { ...(n.tidy?.vertical || {}), d: v },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                </div>
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>Trigger Wall: Horizontal</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            W
                                            <NumberInput
                                                value={n.tidy?.horizontal?.w ?? 1.2}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        tidy: {
                                                            ...(n.tidy || {}),
                                                            horizontal: { ...(n.tidy?.horizontal || {}), w: v },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            H
                                            <NumberInput
                                                value={n.tidy?.horizontal?.h ?? 0.12}
                                                step={0.02}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        tidy: {
                                                            ...(n.tidy || {}),
                                                            horizontal: { ...(n.tidy?.horizontal || {}), h: v },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            D
                                            <NumberInput
                                                value={n.tidy?.horizontal?.d ?? 1.2}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        tidy: {
                                                            ...(n.tidy || {}),
                                                            horizontal: { ...(n.tidy?.horizontal || {}), d: v },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                </div>
                                <div style={{ display: "grid", gap: 8 }}>
                                    <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>Routing</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                        <label>
                                            Offset X
                                            <NumberInput
                                                value={n.tidy?.offset?.x ?? 0}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        tidy: {
                                                            ...(n.tidy || {}),
                                                            offset: { ...(n.tidy?.offset || {}), x: v },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Offset Y
                                            <NumberInput
                                                value={n.tidy?.offset?.y ?? 0}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        tidy: {
                                                            ...(n.tidy || {}),
                                                            offset: { ...(n.tidy?.offset || {}), y: v },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Offset Z
                                            <NumberInput
                                                value={n.tidy?.offset?.z ?? 0}
                                                step={0.05}
                                                onChange={(v) =>
                                                    setNode(n.id, {
                                                        tidy: {
                                                            ...(n.tidy || {}),
                                                            offset: { ...(n.tidy?.offset || {}), z: v },
                                                        },
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Spread
                                        <NumberInput
                                            value={n.tidy?.spread ?? 0.15}
                                            step={0.01}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    tidy: {
                                                        ...(n.tidy || {}),
                                                        spread: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </div>
                            </div>
                        ) : (
                            <div style={{ fontSize: 12, opacity: 0.7 }}>
                                Cable Tidy options are available when the node type is set to Tidy.
                            </div>
                        )}
                    </div>
                )}

                {inspectorTab === "links" && (
                    <div style={{ display: "grid", gap: 8 }}>
                        {outgoingLinks.length > 0 && (
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
                                        fontWeight: 800,
                                        fontSize: 12,
                                        letterSpacing: "0.14em",
                                        textTransform: "uppercase",
                                        opacity: 0.9,
                                        marginBottom: 8,
                                    }}
                                >
                                    Link Status
                                </div>
                                <div style={{ display: "grid", gap: 8 }}>
                                    <label>
                                        Link
                                        <Select
                                            value={selectedOutgoingLink?.id || ""}
                                            onChange={(e) => setSelectedOutgoingLinkId(e.target.value || "")}
                                        >
                                            <option value="">(none)</option>
                                            {outgoingLinks.map((l, idx) => {
                                                const toName = nodes.find((nn) => nn.id === l.to)?.label || l.to;
                                                const label = (l.label || "").trim();
                                                const displayLabel = label ? ` ${label}` : ` ${idx + 1}`;
                                                const desc = (l.description || "").trim();
                                                const meta = desc ? `${displayLabel} - ${desc}` : displayLabel;
                                                return (
                                                    <option key={l.id} value={l.id}>
                                                        {toName}{meta ? ` (${meta.trim()})` : ""}
                                                    </option>
                                                );
                                            })}
                                        </Select>
                                    </label>

                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        <Btn
                                            variant={(selectedOutgoingLink?.active ?? true) ? "primary" : "ghost"}
                                            onClick={() => {
                                                if (!selectedOutgoingLink) return;
                                                setLinks((prev) =>
                                                    prev.map((l) =>
                                                        l.id === selectedOutgoingLink.id ? { ...l, active: true } : l,
                                                    ),
                                                );
                                            }}
                                        >
                                            Active
                                        </Btn>
                                        <Btn
                                            variant={(selectedOutgoingLink?.active === false) ? "primary" : "ghost"}
                                            onClick={() => {
                                                if (!selectedOutgoingLink) return;
                                                setLinks((prev) =>
                                                    prev.map((l) =>
                                                        l.id === selectedOutgoingLink.id ? { ...l, active: false } : l,
                                                    ),
                                                );
                                            }}
                                        >
                                            Inactive
                                        </Btn>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Per-node outgoing link flow editor */}
                        <OutgoingLinksEditor
                            node={n}
                            nodes={nodes}
                            links={links}
                            setLinks={setLinks}
                            setNodeById={setNodeById}
                            selectedBreakpoint={selectedBreakpoint}
                            setSelectedBreakpoint={setSelectedBreakpoint}
                            reassignFlowLinkId={reassignFlowLinkId}
                            onStartReassignFlow={startReassignFlow}
                            onCancelReassignFlow={cancelReassignFlow}
                            reverseTargetNodeId={n.id}
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
                                                        {g.links.length} link{g.links.length === 1 ? "" : "s"} → {n.label || n.id}
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
                                                        Editing flows from <b>{g.fromLabel}</b> to <b>{n.label || n.id}</b>
                                                    </div>

                                                    <OutgoingLinksEditor
                                                        node={g.fromNode}
                                                        nodes={nodes}
                                                        links={g.links}
                                                        setLinks={g.setLinksScoped}
                                                        setNodeById={setNodeById}
                                                        selectedBreakpoint={selectedBreakpoint}
                                                        setSelectedBreakpoint={setSelectedBreakpoint}
                                                        reassignFlowLinkId={reassignFlowLinkId}
                                                        onStartReassignFlow={startReassignFlow}
                                                        onCancelReassignFlow={cancelReassignFlow}
                                                        reverseTargetNodeId={n.id}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
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
                           addRoomNodes,
                           duplicateRoom,
                           requestDelete,
                           nodes,
                           setNodeById,
                       }) {
    const [selectedVerts, setSelectedVerts] = useState([]);
    const deckOptions = Array.isArray(decks) ? decks : [];
    useEffect(() => {
        if (!r?.id) return;
        const onSel = (ev) => {
            const d = ev?.detail || {};
            if (d.roomId !== r.id) return;
            if (!Array.isArray(d.indices)) return;
            const next = d.indices.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n));
            setSelectedVerts(next);
        };
        window.addEventListener?.("EPIC3D_ROOM_VERTS_SELECTION_CHANGED", onSel);
        return () => window.removeEventListener?.("EPIC3D_ROOM_VERTS_SELECTION_CHANGED", onSel);
    }, [r?.id]);

    const [roomLabelClipboard, setRoomLabelClipboard] = useState(() => __loadRoomLabelProfileClipboard());
    const canPasteRoomLabel = !!roomLabelClipboard?.label;
    const copyRoomLabelStyle = () => {
        const prof = __pickRoomLabelProfileFromRoom(r);
        if (!prof) return;
        __saveRoomLabelProfileClipboard(prof);
        setRoomLabelClipboard(prof);
    };
    const pasteRoomLabelStyle = () => {
        if (!canPasteRoomLabel) return;
        __applyRoomLabelProfileToRoom({ roomId: r.id, profile: roomLabelClipboard, setRoom });
    };

    useEffect(() => {
        const onStorage = (e) => {
            if (!e) return;
            if (e.key === ROOM_LABEL_PROFILE_CLIPBOARD_KEY) {
                setRoomLabelClipboard(__loadRoomLabelProfileClipboard());
            }
        };
        window.addEventListener?.("storage", onStorage);
        return () => window.removeEventListener?.("storage", onStorage);
    }, []);

    const configIdRef = useRef(0);
    const roomConfigStorageKey = r?.id ? `epic3d.roomConfigList.v1:${r.id}` : null;
    const [configDraft, setConfigDraft] = useState(() => ({
        quantity: 4,
        shape: "sphere",
        linkTo: "",
        linkToItemId: "",
        linkToName: "",
        linkStyle: "particles",
        linkCount: "",
        linkColor: "",
    }));
    const [configItems, setConfigItems] = useState(() => []);
    useEffect(() => {
        if (!roomConfigStorageKey) return;
        try {
            const raw = localStorage.getItem(roomConfigStorageKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed?.draft) setConfigDraft((d) => ({ ...d, ...parsed.draft }));
            if (Array.isArray(parsed?.items)) setConfigItems(parsed.items);
        } catch {}
    }, [roomConfigStorageKey]);
    useEffect(() => {
        if (!roomConfigStorageKey) return;
        try {
            localStorage.setItem(
                roomConfigStorageKey,
                JSON.stringify({ draft: configDraft, items: configItems })
            );
        } catch {}
    }, [roomConfigStorageKey, configDraft, configItems]);
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
    const [organiseMasterId, setOrganiseMasterId] = useState("");
    const [organiseTargetMode, setOrganiseTargetMode] = useState("all");
    const [organiseTargetNodeId, setOrganiseTargetNodeId] = useState("");
    const [organiseTargetShape, setOrganiseTargetShape] = useState("");
    const getShapeKey = useCallback((shape) => {
        if (typeof shape === "string") return shape;
        if (shape && typeof shape === "object") {
            if (typeof shape.type === "string") {
                if (shape.type === "model" && shape.id) return `model:${shape.id}`;
                return shape.type;
            }
            if (typeof shape.id === "string") return shape.id;
        }
        return "sphere";
    }, []);
    const roomNodes = useMemo(
        () => (nodes || []).filter((n) => n.roomId === r?.id),
        [nodes, r?.id],
    );
    const shapeLabelMap = useMemo(
        () => new Map((shapeOptions || []).map((opt) => [opt.value, opt.label])),
        [shapeOptions],
    );
    const roomShapeOptions = useMemo(() => {
        const map = new Map();
        for (const n of roomNodes) {
            const shape = getShapeKey(n?.shape);
            if (!map.has(shape)) {
                map.set(shape, shapeLabelMap.get(shape) || shape);
            }
        }
        return Array.from(map, ([value, label]) => ({ value, label }));
    }, [roomNodes, shapeLabelMap, getShapeKey]);
    const allNodeOptions = useMemo(
        () =>
            (nodes || []).map((n) => ({
                id: n.id,
                label: n.label || n.name || n.id,
            })),
        [nodes],
    );
    const defaultClusterForShape = useCallback((shapeValue) => {
        const t = (shapeValue || "").toLowerCase();
        if (t === "switch") return "Network";
        return "AV";
    }, []);
    const addConfigItem = (shapeValue, linkTo, linkToItemId, linkToName, linkStyle, linkCount, linkColor) => {
        const shape = shapeValue || "sphere";
        setConfigItems((prev) => [
            ...prev,
            {
                id: ++configIdRef.current,
                shape,
                name: "",
                cluster: defaultClusterForShape(shape),
                linkTo: linkTo || "",
                linkToItemId: linkToItemId || "",
                linkToName: (linkToName || "").trim(),
                linkStyle: linkStyle || "particles",
                linkCount: linkCount ?? "",
                linkColor: linkColor || "",
            },
        ]);
    };

    const buildConfigList = () => {
        const qty = Math.max(1, Math.floor(Number(configDraft.quantity) || 1));
        const shape = configDraft.shape || "sphere";
        const linkTo = configDraft.linkTo || "";
        const linkToItemId = configDraft.linkToItemId || "";
        const linkToName = (configDraft.linkToName || "").trim();
        const linkStyle = configDraft.linkStyle || "particles";
        const linkCount = configDraft.linkCount ?? "";
        const linkColor = configDraft.linkColor || "";
        setConfigItems((prev) => [
            ...prev,
            ...Array.from({ length: qty }).map(() => ({
                id: ++configIdRef.current,
                shape,
                name: "",
                cluster: defaultClusterForShape(shape),
                linkTo,
                linkToItemId,
                linkToName,
                linkStyle,
                linkCount,
                linkColor,
            })),
        ]);
    };
    const updateConfigItem = (id, patch) => {
        setConfigItems((prev) =>
            prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        );
    };
    const removeConfigItem = (id) => {
        setConfigItems((prev) => prev.filter((it) => it.id !== id));
    };
    const applyRoomConfig = () => {
        if (!addRoomNodes) return;
        const items = (configItems || []).map((it) => ({
            quantity: 1,
            shape: it.shape || "sphere",
            name: (it.name || "").trim(),
            cluster: it.cluster || defaultClusterForShape(it.shape),
            linkTo: it.linkTo || "",
            listId: it.id,
            linkToItemId: it.linkToItemId || "",
            linkToName: (it.linkToName || "").trim(),
            linkStyle: it.linkStyle || "particles",
            linkCount: it.linkCount ?? "",
            linkColor: it.linkColor || "",
        }));
        addRoomNodes(r.id, items);
    };
    useEffect(() => {
        if (!r?.id) return;
        if (!roomNodes.length) {
            if (organiseMasterId) setOrganiseMasterId("");
            if (organiseTargetNodeId) setOrganiseTargetNodeId("");
            if (organiseTargetShape) setOrganiseTargetShape("");
            return;
        }
        if (!roomNodes.some((n) => n.id === organiseMasterId)) {
            setOrganiseMasterId(roomNodes[0]?.id || "");
        }
        if (organiseTargetMode === "single") {
            const valid = roomNodes.some(
                (n) => n.id === organiseTargetNodeId && n.id !== organiseMasterId,
            );
            if (!valid) {
                const fallback = roomNodes.find((n) => n.id !== organiseMasterId)?.id || "";
                setOrganiseTargetNodeId(fallback);
            }
        }
        if (organiseTargetMode === "all") {
            if (!roomShapeOptions.some((opt) => opt.value === organiseTargetShape)) {
                setOrganiseTargetShape(roomShapeOptions[0]?.value || "");
            }
        }
    }, [
        r?.id,
        roomNodes,
        organiseMasterId,
        organiseTargetMode,
        organiseTargetNodeId,
        organiseTargetShape,
        roomShapeOptions,
    ]);
    const alignAndSpread = () => {
        if (!setNodeById || !r) return;
        const master = roomNodes.find((n) => n.id === organiseMasterId);
        if (!master) return;
        let targets = [];
        if (organiseTargetMode === "single") {
            const t = roomNodes.find((n) => n.id === organiseTargetNodeId);
            if (t) targets = [t];
        } else {
            const shape = organiseTargetShape || "";
            if (!shape) return;
            targets = roomNodes.filter((n) => getShapeKey(n.shape) === shape);
        }
        targets = targets.filter((n) => n.id !== master.id);
        if (!targets.length) return;

        const center = Array.isArray(r.center) ? r.center : [0, 0, 0];
        const yaw = Number(r.rotation?.[1] ?? 0) || 0;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        const cX = Number(center[0]) || 0;
        const cZ = Number(center[2]) || 0;
        const polyLocal = Array.isArray(polyPoints) && polyPoints.length >= 3
            ? polyPoints
            : rectFromSize(r.size);
        const polyWorld = polyLocal.map(([x, z]) => {
            const rx = x * cos - z * sin;
            const rz = x * sin + z * cos;
            return [rx + cX, rz + cZ];
        });
        const perimeter = polyWorld.reduce((acc, p, i) => {
            const n = polyWorld[(i + 1) % polyWorld.length];
            const dx = n[0] - p[0];
            const dz = n[1] - p[1];
            return acc + Math.hypot(dx, dz);
        }, 0);
        if (perimeter <= 0.0001) return;

        const mPos = Array.isArray(master.position) ? master.position : [0, 0, 0];
        const mRot = Array.isArray(master.rotation) ? master.rotation : [0, 0, 0];
        const mX = Number(mPos[0]) || 0;
        const mY = Number(mPos[1]) || 0;
        const mZ = Number(mPos[2]) || 0;
        const findClosestOnPerimeter = () => {
            let best = { dist2: Infinity, t: 0, segIdx: 0, segLen: 0, along: 0 };
            let walked = 0;
            for (let i = 0; i < polyWorld.length; i++) {
                const a = polyWorld[i];
                const b = polyWorld[(i + 1) % polyWorld.length];
                const vx = b[0] - a[0];
                const vz = b[1] - a[1];
                const segLen = Math.hypot(vx, vz);
                if (segLen <= 0.000001) continue;
                const wx = mX - a[0];
                const wz = mZ - a[1];
                let t = (wx * vx + wz * vz) / (segLen * segLen);
                t = Math.max(0, Math.min(1, t));
                const px = a[0] + vx * t;
                const pz = a[1] + vz * t;
                const dx = mX - px;
                const dz = mZ - pz;
                const dist2 = dx * dx + dz * dz;
                if (dist2 < best.dist2) {
                    best = { dist2, t, segIdx: i, segLen, along: walked + segLen * t };
                }
                walked += segLen;
            }
            return best.along;
        };
        const sampleAt = (dist) => {
            let d = dist % perimeter;
            if (d < 0) d += perimeter;
            for (let i = 0; i < polyWorld.length; i++) {
                const a = polyWorld[i];
                const b = polyWorld[(i + 1) % polyWorld.length];
                const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (segLen <= 0.000001) continue;
                if (d <= segLen) {
                    const t = d / segLen;
                    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
                }
                d -= segLen;
            }
            return polyWorld[0];
        };

        const startDist = findClosestOnPerimeter();
        const step = perimeter / (targets.length + 1);
        targets.forEach((t, idx) => {
            const dist = startDist + step * (idx + 1);
            const [x, z] = sampleAt(dist);
            setNodeById(t.id, (cur) => ({
                ...cur,
                position: [x, mY, z],
                rotation: Array.isArray(mRot) ? [...mRot] : mRot,
            }));
        });
    };
    if (!r) return null;
    const organiseHasMaster = !!organiseMasterId;
    const organiseHasTarget =
        organiseTargetMode === "single"
            ? !!organiseTargetNodeId
            : !!organiseTargetShape;
    const organiseDisabled = !organiseHasMaster || !organiseHasTarget;
    const rectFromSize = (size) => {
        const w = Number(size?.[0] ?? 3) || 3;
        const d = Number(size?.[2] ?? 2.2) || 2.2;
        const hw = w * 0.5;
        const hd = d * 0.5;
        return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    };
    const normalizePolyPoints = (poly) => {
        if (!Array.isArray(poly) || poly.length < 3) return null;
        const out = [];
        for (const p of poly) {
            if (Array.isArray(p) && p.length >= 2) {
                const x = Number(p[0]);
                const z = Number(p[1]);
                if (Number.isFinite(x) && Number.isFinite(z)) out.push([x, z]);
            } else if (p && typeof p === "object") {
                const x = Number(p.x ?? p[0]);
                const z = Number(p.z ?? p.y ?? p[1]);
                if (Number.isFinite(x) && Number.isFinite(z)) out.push([x, z]);
            }
        }
        return out.length >= 3 ? out : null;
    };
    const polyPoints = normalizePolyPoints(r.poly) || rectFromSize(r.size);
    const applyPoly = (next) => {
        const pts = normalizePolyPoints(next);
        if (!pts) return;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [x, z] of pts) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }
        const w = Math.max(0.05, maxX - minX);
        const d = Math.max(0.05, maxZ - minZ);
        const h = Number(r.size?.[1] ?? 1.6) || 1.6;
        setRoom(r.id, { poly: pts, size: [w, h, d] });
    };
    const setRoomVertSelection = (indices) => {
        const next = Array.isArray(indices) ? indices : [];
        setSelectedVerts(next);
        try {
            window.dispatchEvent(new CustomEvent("EPIC3D_ROOM_VERTS_SET_SELECTION", {
                detail: { roomId: r.id, indices: next },
            }));
        } catch {}
    };
    const mirrorPoly = (axis) => {
        const pts = polyPoints;
        if (!pts || pts.length < 3) return;
        const mirrorOf = (p) => (axis === "x" ? [-p[0], p[1]] : [p[0], -p[1]]);
        const next = pts.map((p) => [p[0], p[1]]);
        const sel = Array.isArray(selectedVerts) ? selectedVerts.filter((i) => Number.isFinite(i)) : [];
        if (!sel.length) {
            applyPoly(pts.map(mirrorOf).reverse());
            return;
        }
        const used = new Set();
        for (const idx of sel) {
            const src = pts[idx];
            if (!src) continue;
            const mirrored = mirrorOf(src);
            let best = -1;
            let bestDist = Infinity;
            for (let j = 0; j < pts.length; j++) {
                if (j === idx) continue;
                if (used.has(j)) continue;
                const p = pts[j];
                const s = axis === "x" ? p[0] : p[1];
                const ss = axis === "x" ? src[0] : src[1];
                if (s === 0 || ss === 0) continue;
                if ((s > 0 && ss > 0) || (s < 0 && ss < 0)) continue;
                const dx = p[0] - mirrored[0];
                const dz = p[1] - mirrored[1];
                const dist = dx * dx + dz * dz;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = j;
                }
            }
            if (best >= 0) {
                next[best] = mirrored;
                used.add(best);
            }
        }
        applyPoly(next);
    };

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
                        {deckOptions.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.name}
                            </option>
                        ))}
                    </Select>
                </label>
                <label>
                    Room Type
                    <Select
                        value={r.roomType || ""}
                        onChange={(e) => setRoom(r.id, { roomType: e.target.value || "" })}
                    >
                        <option value="">Unspecified</option>
                        {ROOM_TYPE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                                {opt}
                            </option>
                        ))}
                    </Select>
                </label>

                <fieldset
                    style={{
                        marginTop: 8,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.18)",
                    }}
                >
                    <legend style={{ opacity: 0.8 }}>Room Label</legend>
                    <div style={{ display: "grid", gap: 8 }}>
                        <label>
                            Mode
                            <Select
                                value={r.labelMode ?? "billboard"}
                                onChange={(e) => setRoom(r.id, { labelMode: e.target.value })}
                            >
                                <option value="billboard">Billboard</option>
                                <option value="3d">3D Stack</option>
                                <option value="static">Static</option>
                            </Select>
                        </label>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <label>
                                Size
                                <NumberInput
                                    min={0.02}
                                    step={0.02}
                                    value={r.labelSize ?? 0.24}
                                    onChange={(v) => setRoom(r.id, { labelSize: Number(v ?? 0) })}
                                />
                            </label>
                            <label>
                                Max Width (0 = no wrap)
                                <NumberInput
                                    min={0}
                                    step={1}
                                    value={r.labelMaxWidth ?? 24}
                                    onChange={(v) => setRoom(r.id, { labelMaxWidth: Number(v ?? 0) })}
                                />
                            </label>
                        </div>

                        <label style={{ display: "block" }}>
                            Alignment
                            <Select
                                value={r.labelAlign ?? "center"}
                                onChange={(e) => setRoom(r.id, { labelAlign: e.target.value })}
                            >
                                <option value="left">Left</option>
                                <option value="center">Center</option>
                                <option value="right">Right</option>
                            </Select>
                        </label>

                        <Checkbox
                            label="Wrap label text"
                            checked={(r.labelWrap ?? true) !== false}
                            onChange={(v) => setRoom(r.id, { labelWrap: v })}
                        />

                        <label style={{ display: "block" }}>
                            Text Color
                            <input
                                type="color"
                                value={r.labelColor ?? "#ffffff"}
                                onChange={(e) => setRoom(r.id, { labelColor: e.target.value })}
                            />
                        </label>

                        <label>
                            Fill Opacity
                            <NumberInput
                                min={0}
                                step={0.05}
                                value={r.labelFillOpacity ?? 1}
                                onChange={(v) => setRoom(r.id, { labelFillOpacity: Number(v ?? 1) })}
                            />
                        </label>

                        <Checkbox
                            label="Outline"
                            checked={(r.labelOutline ?? true) !== false}
                            onChange={(v) => setRoom(r.id, { labelOutline: v })}
                        />

                        {(r.labelOutline ?? true) !== false && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <label>
                                    Outline Width
                                    <NumberInput
                                        min={0}
                                        step={0.001}
                                        value={r.labelOutlineWidth ?? 0.005}
                                        onChange={(v) => setRoom(r.id, { labelOutlineWidth: Number(v ?? 0) })}
                                    />
                                </label>
                                <label style={{ display: "block" }}>
                                    Outline Color
                                    <input
                                        type="color"
                                        value={r.labelOutlineColor ?? "#000000"}
                                        onChange={(e) => setRoom(r.id, { labelOutlineColor: e.target.value })}
                                    />
                                </label>
                                <label>
                                    Outline Blur
                                    <NumberInput
                                        min={0}
                                        step={0.1}
                                        value={r.labelOutlineBlur ?? 0}
                                        onChange={(v) => setRoom(r.id, { labelOutlineBlur: Number(v ?? 0) })}
                                    />
                                </label>
                            </div>
                        )}

                        <label style={{ display: "block" }}>
                            Font URL (optional)
                            <Input
                                value={r.labelFont ?? ""}
                                placeholder="https://example.com/font.woff"
                                onChange={(e) => setRoom(r.id, { labelFont: e.target.value || null })}
                            />
                        </label>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <label>
                                Letter Spacing
                                <NumberInput
                                    step={0.01}
                                    value={r.labelLetterSpacing ?? 0}
                                    onChange={(v) => setRoom(r.id, { labelLetterSpacing: Number(v ?? 0) })}
                                />
                            </label>
                            <label>
                                Line Height
                                <NumberInput
                                    min={0.5}
                                    step={0.05}
                                    value={r.labelLineHeight ?? 1}
                                    onChange={(v) => setRoom(r.id, { labelLineHeight: Number(v ?? 1) })}
                                />
                            </label>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <label>
                                3D Layers
                                <NumberInput
                                    min={1}
                                    step={1}
                                    value={r.label3DLayers ?? 8}
                                    onChange={(v) => setRoom(r.id, { label3DLayers: Number(v ?? 1) })}
                                />
                            </label>
                            <label>
                                3D Step
                                <NumberInput
                                    min={0}
                                    step={0.005}
                                    value={r.label3DStep ?? 0.01}
                                    onChange={(v) => setRoom(r.id, { label3DStep: Number(v ?? 0) })}
                                />
                            </label>
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <Btn onClick={copyRoomLabelStyle}>Copy Label Style</Btn>
                            <Btn disabled={!canPasteRoomLabel} onClick={pasteRoomLabelStyle}>
                                Paste Label Style
                            </Btn>
                        </div>
                    </div>
                </fieldset>

                <fieldset
                    style={{
                        marginTop: 8,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.18)",
                    }}
                >
                    <legend style={{ opacity: 0.8 }}>Room Configurator</legend>
                    <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>Builder</div>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "90px 1fr 1fr",
                                gap: 8,
                                alignItems: "end",
                            }}
                        >
                            <label>
                                Quantity
                                <NumberInput
                                    min={1}
                                    step={1}
                                    value={Number(configDraft.quantity) || 1}
                                    onChange={(v) =>
                                        setConfigDraft((prev) => ({
                                            ...prev,
                                            quantity: Math.max(1, Math.floor(Number(v) || 1)),
                                        }))
                                    }
                                />
                            </label>
                            <label>
                                Shape
                                <Select
                                    value={configDraft.shape || "sphere"}
                                    onChange={(e) =>
                                        setConfigDraft((prev) => ({
                                            ...prev,
                                            shape: e.target.value,
                                        }))
                                    }
                                >
                                    {shapeOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <label>
                                Link
                                <Select
                                    value={configDraft.linkTo || ""}
                                    onChange={(e) =>
                                        setConfigDraft((prev) => ({
                                            ...prev,
                                            linkTo: e.target.value,
                                        }))
                                    }
                                >
                                    <option value="">No link</option>
                                    {allNodeOptions.map((n) => (
                                        <option key={n.id} value={n.id}>
                                            {n.label}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                            <label>
                                Link (List)
                                <Select
                                    value={configDraft.linkToItemId || ""}
                                    onChange={(e) =>
                                        setConfigDraft((prev) => ({
                                            ...prev,
                                            linkToItemId: e.target.value,
                                        }))
                                    }
                                >
                                    <option value="">No link</option>
                                    {configItems.map((it, idx) => (
                                        <option key={it.id} value={it.id}>
                                            #{idx + 1} {it.name ? `• ${it.name}` : ""}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <label>
                                Link Name
                                <Input
                                    value={configDraft.linkToName || ""}
                                    onChange={(e) =>
                                        setConfigDraft((prev) => ({
                                            ...prev,
                                            linkToName: e.target.value,
                                        }))
                                    }
                                    placeholder="Optional target name"
                                />
                            </label>
                            <label>
                                Link Style
                                <Select
                                    value={configDraft.linkStyle || "particles"}
                                    onChange={(e) =>
                                        setConfigDraft((prev) => ({
                                            ...prev,
                                            linkStyle: e.target.value,
                                        }))
                                    }
                                >
                                    <option value="particles">Flow</option>
                                    <option value="cable">Cable</option>
                                    <option value="solid">Solid</option>
                                    <option value="dashed">Dashed</option>
                                    <option value="wavy">Wavy</option>
                                </Select>
                            </label>
                            <label>
                                Link Count
                                <NumberInput
                                    min={1}
                                    step={1}
                                    value={configDraft.linkCount}
                                    onChange={(v) =>
                                        setConfigDraft((prev) => ({
                                            ...prev,
                                            linkCount: v,
                                        }))
                                    }
                                />
                            </label>
                            <label>
                                Link Color
                                <Input
                                    type="color"
                                    value={configDraft.linkColor || "#7cf"}
                                    onChange={(e) =>
                                        setConfigDraft((prev) => ({
                                            ...prev,
                                            linkColor: e.target.value,
                                        }))
                                    }
                                />
                            </label>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <Btn onClick={buildConfigList}>Build list</Btn>
                            <Btn onClick={() => addConfigItem(
                                configDraft.shape,
                                configDraft.linkTo,
                                configDraft.linkToItemId,
                                configDraft.linkToName,
                                configDraft.linkStyle,
                                configDraft.linkCount,
                                configDraft.linkColor,
                            )}>
                                + Single row
                            </Btn>
                            <Btn
                                disabled={!configItems.length}
                                onClick={() => setConfigItems([])}
                            >
                                Clear
                            </Btn>
                        </div>

                        {configItems.length ? (
                            <div style={{ display: "grid", gap: 8 }}>
                                {configItems.map((it, idx) => (
                                    <div
                                        key={it.id}
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "26px 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr auto",
                                            gap: 8,
                                            alignItems: "end",
                                        }}
                                    >
                                        <div style={{ fontSize: 11, opacity: 0.6 }}>#{idx + 1}</div>
                                        <label>
                                            Shape
                                            <Select
                                                value={it.shape || "sphere"}
                                                onChange={(e) =>
                                                    updateConfigItem(it.id, {
                                                        shape: e.target.value,
                                                        cluster: it.cluster || defaultClusterForShape(e.target.value),
                                                    })
                                                }
                                            >
                                                {shapeOptions.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </Select>
                                        </label>
                                        <label>
                                            Name
                                            <Input
                                                value={it.name || ""}
                                                onChange={(e) =>
                                                    updateConfigItem(it.id, { name: e.target.value })
                                                }
                                                placeholder="Optional"
                                            />
                                        </label>
                                        <label>
                                            Cluster
                                            <Select
                                                value={it.cluster || defaultClusterForShape(it.shape)}
                                                onChange={(e) =>
                                                    updateConfigItem(it.id, { cluster: e.target.value })
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
                                            Link
                                            <Select
                                                value={it.linkTo || ""}
                                                onChange={(e) =>
                                                    updateConfigItem(it.id, { linkTo: e.target.value })
                                                }
                                            >
                                                <option value="">No link</option>
                                                {allNodeOptions.map((n) => (
                                                    <option key={n.id} value={n.id}>
                                                        {n.label}
                                                    </option>
                                                ))}
                                            </Select>
                                        </label>
                                        <label>
                                            Link (List)
                                            <Select
                                                value={it.linkToItemId || ""}
                                                onChange={(e) =>
                                                    updateConfigItem(it.id, { linkToItemId: e.target.value })
                                                }
                                            >
                                                <option value="">No link</option>
                                                {configItems
                                                    .filter((row) => row.id !== it.id)
                                                    .map((row, ridx) => (
                                                        <option key={row.id} value={row.id}>
                                                            #{ridx + 1} {row.name ? `• ${row.name}` : ""}
                                                        </option>
                                                    ))}
                                            </Select>
                                        </label>
                                        <label>
                                            Link Name
                                            <Input
                                                value={it.linkToName || ""}
                                                onChange={(e) =>
                                                    updateConfigItem(it.id, { linkToName: e.target.value })
                                                }
                                                placeholder="Optional"
                                            />
                                        </label>
                                        <label>
                                            Link Style
                                            <Select
                                                value={it.linkStyle || "particles"}
                                                onChange={(e) =>
                                                    updateConfigItem(it.id, { linkStyle: e.target.value })
                                                }
                                            >
                                                <option value="particles">Flow</option>
                                                <option value="cable">Cable</option>
                                                <option value="solid">Solid</option>
                                                <option value="dashed">Dashed</option>
                                                <option value="wavy">Wavy</option>
                                            </Select>
                                        </label>
                                        <label>
                                            Link Count
                                            <NumberInput
                                                min={1}
                                                step={1}
                                                value={it.linkCount ?? ""}
                                                onChange={(v) =>
                                                    updateConfigItem(it.id, { linkCount: v })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Link Color
                                            <Input
                                                type="color"
                                                value={it.linkColor || "#7cf"}
                                                onChange={(e) =>
                                                    updateConfigItem(it.id, { linkColor: e.target.value })
                                                }
                                            />
                                        </label>
                                        <Btn onClick={() => removeConfigItem(it.id)}>Remove</Btn>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontSize: 12, opacity: 0.65 }}>
                                Build a list to configure nodes before adding them.
                            </div>
                        )}

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <Btn
                                variant="primary"
                                glow
                                disabled={!configItems.length}
                                onClick={applyRoomConfig}
                            >
                                Place
                            </Btn>
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                            Adds the listed nodes to this room and distributes them evenly around the center.
                        </div>
                    </div>
                </fieldset>

                <fieldset
                    style={{
                        marginTop: 8,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.18)",
                    }}
                >
                    <legend style={{ opacity: 0.8 }}>Room Actions</legend>
                    <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>
                            Organise
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                            Align & Spread
                        </div>

                        {!roomNodes.length ? (
                            <div style={{ fontSize: 12, opacity: 0.7 }}>
                                No nodes inside this room yet.
                            </div>
                        ) : (
                            <>
                                <label>
                                    Master Node
                                    <Select
                                        value={organiseMasterId}
                                        onChange={(e) =>
                                            setOrganiseMasterId(e.target.value)
                                        }
                                    >
                                        {roomNodes.map((n) => (
                                            <option key={n.id} value={n.id}>
                                                {n.label || n.name || n.id}
                                            </option>
                                        ))}
                                    </Select>
                                </label>
                                <label>
                                    Targets
                                    <Select
                                        value={organiseTargetMode}
                                        onChange={(e) =>
                                            setOrganiseTargetMode(e.target.value)
                                        }
                                    >
                                        <option value="all">All</option>
                                        <option value="single">Singular</option>
                                    </Select>
                                </label>
                                {organiseTargetMode === "single" ? (
                                    <label>
                                        Target Node
                                        <Select
                                            value={organiseTargetNodeId}
                                            onChange={(e) =>
                                                setOrganiseTargetNodeId(e.target.value)
                                            }
                                        >
                                            {roomNodes
                                                .filter((n) => n.id !== organiseMasterId)
                                                .map((n) => (
                                                    <option key={n.id} value={n.id}>
                                                        {n.label || n.name || n.id}
                                                    </option>
                                                ))}
                                        </Select>
                                    </label>
                                ) : (
                                    <label>
                                        Shape
                                        <Select
                                            value={organiseTargetShape}
                                            onChange={(e) =>
                                                setOrganiseTargetShape(e.target.value)
                                            }
                                        >
                                            {roomShapeOptions.length ? (
                                                roomShapeOptions.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))
                                            ) : (
                                                <option value="">No shapes</option>
                                            )}
                                        </Select>
                                    </label>
                                )}
                                <Btn
                                    variant="primary"
                                    glow
                                    disabled={organiseDisabled}
                                    onClick={alignAndSpread}
                                >
                                    Execute
                                </Btn>
                            </>
                        )}
                    </div>
                </fieldset>

                <div>
                    <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>
                        Center
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        <label>
                            X
                            <NumberInput
                                value={r.center?.[0] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setRoom(r.id, { center: [v, r.center?.[1] ?? 0, r.center?.[2] ?? 0] })
                                }
                            />
                        </label>
                        <label>
                            Y
                            <NumberInput
                                value={r.center?.[1] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setRoom(r.id, { center: [r.center?.[0] ?? 0, v, r.center?.[2] ?? 0] })
                                }
                            />
                        </label>
                        <label>
                            Z
                            <NumberInput
                                value={r.center?.[2] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setRoom(r.id, { center: [r.center?.[0] ?? 0, r.center?.[1] ?? 0, v] })
                                }
                            />
                        </label>
                    </div>
                </div>

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

                <div>
                    <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>
                        Rotation (radians)
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        <label>
                            X
                            <NumberInput
                                value={r.rotation?.[0] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setRoom(r.id, { rotation: [v, r.rotation?.[1] ?? 0, r.rotation?.[2] ?? 0] })
                                }
                            />
                        </label>
                        <label>
                            Y
                            <NumberInput
                                value={r.rotation?.[1] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setRoom(r.id, { rotation: [r.rotation?.[0] ?? 0, v, r.rotation?.[2] ?? 0] })
                                }
                            />
                        </label>
                        <label>
                            Z
                            <NumberInput
                                value={r.rotation?.[2] ?? 0}
                                step={0.05}
                                min={-9999}
                                onChange={(v) =>
                                    setRoom(r.id, { rotation: [r.rotation?.[0] ?? 0, r.rotation?.[1] ?? 0, v] })
                                }
                            />
                        </label>
                    </div>
                </div>

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
                {/* Vertex Editing */}
                <Panel title="Vertex Editing">
                    <Checkbox
                        label="Enable vertex edit"
                        checked={!!r.vertexEdit}
                        onChange={(v) => setRoom(r.id, { vertexEdit: v })}
                    />
                    <label>
                        Tool
                        <Select
                            value={r.vertexTool || "both"}
                            onChange={(e) => setRoom(r.id, { vertexTool: e.target.value })}
                        >
                            <option value="move">move</option>
                            <option value="add">add</option>
                            <option value="both">both</option>
                        </Select>
                    </label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Btn onClick={() => mirrorPoly("x")}>Mirror X</Btn>
                        <Btn onClick={() => mirrorPoly("z")}>Mirror Y</Btn>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                        {polyPoints.map(([x, z], i) => (
                            <div
                                key={`room-vert-${r.id}-${i}`}
                                style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr", gap: 6, alignItems: "center" }}
                            >
                                <div style={{ fontSize: 11, opacity: 0.8 }}>V{i + 1}</div>
                                <label>
                                    X
                                    <NumberInput
                                        value={x}
                                        step={0.05}
                                        min={-9999}
                                        onChange={(v) => {
                                            setRoomVertSelection([i]);
                                            const next = polyPoints.map((p, idx) => (idx === i ? [v, p[1]] : p));
                                            applyPoly(next);
                                        }}
                                    />
                                </label>
                                <label>
                                    Z
                                    <NumberInput
                                        value={z}
                                        step={0.05}
                                        min={-9999}
                                        onChange={(v) => {
                                            setRoomVertSelection([i]);
                                            const next = polyPoints.map((p, idx) => (idx === i ? [p[0], v] : p));
                                            applyPoly(next);
                                        }}
                                    />
                                </label>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                        <Checkbox
                            label="Show vertex labels"
                            checked={!!r.showVertexLabels}
                            onChange={(v) => setRoom(r.id, { showVertexLabels: v })}
                        />
                        <Checkbox
                            label="Show edge labels"
                            checked={!!r.showEdgeLabels}
                            onChange={(v) => setRoom(r.id, { showEdgeLabels: v })}
                        />
                    </div>
                </Panel>
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

function LinkInspector({ link: l, nodes = [], setLinks, requestDelete }) {
    if (!l) return null;

    const update = (patch) => {
        setLinks((prev) =>
            prev.map((x) =>
                x.id === l.id ? { ...x, ...patch } : x,
            ),
        );
    };

    const getAnchorSetsForNode = (node) => {
        if (!node) return [];
        const sets = Array.isArray(node.flowAnchorSets) ? node.flowAnchorSets : [];
        if (sets.length) return sets;
        const legacy = Array.isArray(node.flowAnchors) ? node.flowAnchors : [];
        if (legacy.length) {
            return [{
                id: node.flowAnchorActiveSetId || "fas-default",
                name: "Default",
            }];
        }
        return [];
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
                {(() => {
                    const toNode = nodes.find((n) => n.id === l.to);
                    const fromNode = nodes.find((n) => n.id === l.from);
                    const toSets = getAnchorSetsForNode(toNode);
                    const fromSets = getAnchorSetsForNode(fromNode);
                    const combinedSets = [...fromSets, ...toSets];
                    const knownIds = new Set(combinedSets.map((s) => s.id));
                    const hasCustom = l.flowAnchorSetId && !knownIds.has(l.flowAnchorSetId);
                    const fromIds = new Set(fromSets.map((s) => s.id));
                    const toIds = new Set(toSets.map((s) => s.id));
                    const selectionValue = (() => {
                        if (!l.flowAnchorSetId) return "";
                        if (l.flowAnchorSetOwnerId) return `${l.flowAnchorSetOwnerId}::${l.flowAnchorSetId}`;
                        if (fromIds.has(l.flowAnchorSetId)) return `${l.from}::${l.flowAnchorSetId}`;
                        if (toIds.has(l.flowAnchorSetId)) return `${l.to}::${l.flowAnchorSetId}`;
                        return "";
                    })();
                    const handleAnchorSetChange = (value) => {
                        if (!value) {
                            update({ flowAnchorSetId: undefined, flowAnchorSetOwnerId: undefined });
                            return;
                        }
                        const parts = String(value).split("::");
                        if (parts.length !== 2) {
                            update({ flowAnchorSetId: undefined, flowAnchorSetOwnerId: undefined });
                            return;
                        }
                        update({ flowAnchorSetOwnerId: parts[0] || undefined, flowAnchorSetId: parts[1] || undefined });
                    };
                    return (
                        <label>
                            Anchor set
                            <Select
                                value={selectionValue}
                                onChange={(e) => handleAnchorSetChange(e.target.value)}
                            >
                                <option value="">Auto (default)</option>
                                {hasCustom && (
                                    <option value={`${l.flowAnchorSetOwnerId || l.from || l.to}::${l.flowAnchorSetId}`}>
                                        {l.flowAnchorSetId} (missing)
                                    </option>
                                )}
                                {fromSets.length > 0 && (
                                    <optgroup label="From node">
                                        {fromSets.map((set) => (
                                            <option key={`from-${set.id}`} value={`${l.from}::${set.id}`}>
                                                {set.name || "Anchor Set"}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {toSets.length > 0 && (
                                    <optgroup label="To node">
                                        {toSets.map((set) => (
                                            <option key={`to-${set.id}`} value={`${l.to}::${set.id}`}>
                                                {set.name || "Anchor Set"}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </Select>
                        </label>
                    );
                })()}

                <label>
                    Label
                    <Input
                        value={l.label ?? ""}
                        onChange={(e) => update({ label: e.target.value })}
                        placeholder="A"
                    />
                </label>

                <label>
                    Description
                    <Input
                        value={l.description ?? ""}
                        onChange={(e) => update({ description: e.target.value })}
                        placeholder="Optional"
                    />
                </label>

                <label>
                    Active{" "}
                    <Checkbox
                        checked={l.active !== false}
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
                        Endpoints
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        <label>
                            Start X
                            <NumberInput
                                step={0.05}
                                value={l.offsets?.start?.[0] ?? 0}
                                onChange={(v) =>
                                    update({
                                        offsets: {
                                            ...(l.offsets || {}),
                                            start: [v, l.offsets?.start?.[1] ?? 0, l.offsets?.start?.[2] ?? 0],
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Start Y
                            <NumberInput
                                step={0.05}
                                value={l.offsets?.start?.[1] ?? 0}
                                onChange={(v) =>
                                    update({
                                        offsets: {
                                            ...(l.offsets || {}),
                                            start: [l.offsets?.start?.[0] ?? 0, v, l.offsets?.start?.[2] ?? 0],
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Start Z
                            <NumberInput
                                step={0.05}
                                value={l.offsets?.start?.[2] ?? 0}
                                onChange={(v) =>
                                    update({
                                        offsets: {
                                            ...(l.offsets || {}),
                                            start: [l.offsets?.start?.[0] ?? 0, l.offsets?.start?.[1] ?? 0, v],
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            End X
                            <NumberInput
                                step={0.05}
                                value={l.offsets?.end?.[0] ?? 0}
                                onChange={(v) =>
                                    update({
                                        offsets: {
                                            ...(l.offsets || {}),
                                            end: [v, l.offsets?.end?.[1] ?? 0, l.offsets?.end?.[2] ?? 0],
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            End Y
                            <NumberInput
                                step={0.05}
                                value={l.offsets?.end?.[1] ?? 0}
                                onChange={(v) =>
                                    update({
                                        offsets: {
                                            ...(l.offsets || {}),
                                            end: [l.offsets?.end?.[0] ?? 0, v, l.offsets?.end?.[2] ?? 0],
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            End Z
                            <NumberInput
                                step={0.05}
                                value={l.offsets?.end?.[2] ?? 0}
                                onChange={(v) =>
                                    update({
                                        offsets: {
                                            ...(l.offsets || {}),
                                            end: [l.offsets?.end?.[0] ?? 0, l.offsets?.end?.[1] ?? 0, v],
                                        },
                                    })
                                }
                            />
                        </label>
                    </div>
                </div>

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
                        <label>
                            Spread
                            <Slider
                                value={l.particles?.spread ?? 0}
                                min={0}
                                max={0.6}
                                step={0.01}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            spread: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Twist
                            <Slider
                                value={l.particles?.twist ?? 0}
                                min={-6}
                                max={6}
                                step={0.1}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            twist: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Jitter
                            <Slider
                                value={l.particles?.jitter ?? 0}
                                min={0}
                                max={0.4}
                                step={0.01}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            jitter: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Stretch
                            <Slider
                                value={l.particles?.stretch ?? 1}
                                min={0.5}
                                max={4}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            stretch: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Pulse Amp
                            <Slider
                                value={l.particles?.pulseAmp ?? 0}
                                min={0}
                                max={1}
                                step={0.02}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            pulseAmp: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Pulse Freq
                            <Slider
                                value={l.particles?.pulseFreq ?? 2}
                                min={0.2}
                                max={8}
                                step={0.1}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            pulseFreq: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Fade Tail
                            <Slider
                                value={l.particles?.fadeTail ?? 0}
                                min={0}
                                max={1}
                                step={0.02}
                                onChange={(v) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            fadeTail: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Blend
                            <Select
                                value={l.particles?.blend || "normal"}
                                onChange={(e) =>
                                    update({
                                        particles: {
                                            ...(l.particles || {}),
                                            blend: e.target.value,
                                        },
                                    })
                                }
                            >
                                <option value="normal">normal</option>
                                <option value="additive">additive</option>
                            </Select>
                        </label>
                    </>
                )}

                {l.style === "dashed" && (
                    <>
                        <label>
                            Dash length
                            <Slider
                                value={l.dash?.length ?? 1}
                                min={0.2}
                                max={4}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        dash: {
                                            ...(l.dash || {}),
                                            length: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Dash gap
                            <Slider
                                value={l.dash?.gap ?? 0.25}
                                min={0.02}
                                max={1}
                                step={0.01}
                                onChange={(v) =>
                                    update({
                                        dash: {
                                            ...(l.dash || {}),
                                            gap: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Dash speed
                            <Slider
                                value={l.dash?.speed ?? 1}
                                min={0}
                                max={3}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        dash: {
                                            ...(l.dash || {}),
                                            speed: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Dash offset
                            <Slider
                                value={l.dash?.offset ?? 0}
                                min={-4}
                                max={4}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        dash: {
                                            ...(l.dash || {}),
                                            offset: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Dash opacity
                            <Slider
                                value={l.dash?.opacity ?? 1}
                                min={0.1}
                                max={1}
                                step={0.05}
                                onChange={(v) =>
                                    update({
                                        dash: {
                                            ...(l.dash || {}),
                                            opacity: v,
                                        },
                                    })
                                }
                            />
                        </label>
                        <label>
                            Animate dashes{" "}
                            <Checkbox
                                checked={(l.dash?.animate ?? true) === true}
                                onChange={(v) =>
                                    update({
                                        dash: {
                                            ...(l.dash || {}),
                                            animate: v,
                                        },
                                    })
                                }
                            />
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

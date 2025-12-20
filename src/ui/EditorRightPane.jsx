// ui/EditorRightPane.jsx
import React, { useState } from "react";
import { Panel, Btn, Input, Select, Checkbox, Slider } from "./Controls.jsx";
import { DEFAULT_CLUSTERS } from "../utils/clusters.js";
import { OutgoingLinksEditor } from "../Interactive3DNodeShowcase.helpers.hud.jsx";
import { RepresentativePanel } from "../Interactive3DNodeShowcase.helpers.editor.jsx";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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
                        setLinks={setLinks}
                        mode={mode}
                        setMode={setMode}
                        requestDelete={requestDelete}
                        selectedBreakpoint={selectedBreakpoint}
                        setSelectedBreakpoint={setSelectedBreakpoint}
                        setLinkFromId={setLinkFromId}   // 🔹 NEW
                        levelFromNodeId={levelFromNodeId}         // 👈 NEW
                        setLevelFromNodeId={setLevelFromNodeId}   // 👈 NEW
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
                       }) {
    if (!n) return null;

    const [openMasterId, setOpenMasterId] = useState(null);

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


                    {/* 🔹 NEW: Level Target button */}
                    <Btn
                        onClick={() => {
                            // Always be in normal select mode for leveling
                            setMode("select");
                            setLinkFromId?.(null);

                            // Toggle: clicking again on same node cancels
                            setLevelFromNodeId?.((current) =>
                                current === n.id ? null : n.id,
                            );
                        }}
                        glow={levelFromNodeId === n.id}
                    >
                        {levelFromNodeId === n.id
                            ? "Level Target (pick…)"
                            : "Level Target"}
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

                {/* Light */}
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
                        Light
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
                        </Select>
                    </label>

                    {n.light?.type !== "none" && (
                        <>
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
                            <label>
                                Intensity
                                <Slider
                                    value={n.light?.intensity ?? 200}
                                    min={0}
                                    max={2000}
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
                            <label>
                                Distance
                                <Slider
                                    value={n.light?.distance ?? 8}
                                    min={0}
                                    max={50}
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

                            {n.light.type === "spot" && (
                                <>
                                    <label>
                                        Angle
                                        <Slider
                                            value={n.light.angle ?? 0.6}
                                            min={0.05}
                                            max={1.5}
                                            step={0.01}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light ||
                                                            {}),
                                                        angle: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Penumbra
                                        <Slider
                                            value={n.light.penumbra ?? 0.35}
                                            min={0}
                                            max={1}
                                            step={0.01}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light ||
                                                            {}),
                                                        penumbra: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Yaw (°)
                                        <Slider
                                            value={n.light.yaw ?? 0}
                                            min={-180}
                                            max={180}
                                            step={1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light ||
                                                            {}),
                                                        yaw: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Pitch (°)
                                        <Slider
                                            value={n.light.pitch ?? -25}
                                            min={-89}
                                            max={89}
                                            step={1}
                                            onChange={(v) =>
                                                setNode(n.id, {
                                                    light: {
                                                        ...(n.light ||
                                                            {}),
                                                        pitch: v,
                                                    },
                                                })
                                            }
                                        />
                                    </label>
                                </>
                            )}

                            <Checkbox
                                checked={!!n.light.enabled}
                                onChange={(v) =>
                                    setNode(n.id, {
                                        light: {
                                            ...(n.light || {}),
                                            enabled: v,
                                        },
                                    })
                                }
                                label="enabled"
                            />
                            <Checkbox
                                checked={!!n.light.showBounds}
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

                            {/* Shadows */}
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
                                    Shadows
                                </div>

                                <label
                                    style={{
                                        display: "block",
                                        marginTop: 6,
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            n.shadows?.cast ?? true
                                        }
                                        onChange={(e) =>
                                            setNode(n.id, {
                                                shadows: {
                                                    ...(n.shadows ||
                                                        {}),
                                                    cast: e.target
                                                        .checked,
                                                },
                                            })
                                        }
                                    />{" "}
                                    Cast shadows
                                </label>

                                <label
                                    style={{
                                        display: "block",
                                        marginTop: 6,
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            n.shadows?.receive ?? true
                                        }
                                        onChange={(e) =>
                                            setNode(n.id, {
                                                shadows: {
                                                    ...(n.shadows ||
                                                        {}),
                                                    receive:
                                                    e.target
                                                        .checked,
                                                },
                                            })
                                        }
                                    />{" "}
                                    Receive shadows
                                </label>

                                <label
                                    style={{
                                        display: "block",
                                        marginTop: 6,
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            n.shadows?.light ?? true
                                        }
                                        onChange={(e) =>
                                            setNode(n.id, {
                                                shadows: {
                                                    ...(n.shadows ||
                                                        {}),
                                                    light: e.target
                                                        .checked,
                                                },
                                            })
                                        }
                                    />{" "}
                                    Node light casts
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

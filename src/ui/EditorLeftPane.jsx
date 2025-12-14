import React, { useState, useEffect } from "react";
import { Btn, IconBtn, Input, Select, Checkbox, Slider, Panel } from "./Controls.jsx";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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
          {isOpen ? "▾" : "▸"}
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
                            animate,
                            setAnimate,
                            labelsOn,
                            setLabelsOn,
                        }) {

    const [paneWidth, setPaneWidth] = useState(() => {
        if (typeof window === "undefined") return 440;
        try {
            const saved = Number(localStorage.getItem("epic3d.leftPaneWidth.v1"));
            if (Number.isFinite(saved) && saved > 260) return saved;
        } catch {}
        return Math.min(440, window.innerWidth - 80);
    });

    // ✅ plain React + JS
    const [expandAllToken, setExpandAllToken] = useState(0);
    const [collapseAllToken, setCollapseAllToken] = useState(0);

    if (prodMode) return null;

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
                        Editor
                    </div>
                    <div
                        style={{
                            fontSize: 11,
                            opacity: 0.82,
                            color: "rgba(191,219,254,0.96)",
                        }}
                    >
                        Rooms • Links • HUD
                    </div>
                </div>

                {/* nicer, but still subtle, expand/collapse icons */}
                <div style={{ display: "flex", gap: 3 }}>
                    <IconBtn
                        label="⌄⌄"
                        title="Expand all sections"
                        onClick={() => setExpandAllToken((t) => t + 1)}
                    />
                    <IconBtn
                        label="⌃⌃"
                        title="Collapse all sections"
                        onClick={() => setCollapseAllToken((t) => t + 1)}
                    />
                </div>
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
                {/* Placement & snapping */}
                <SectionDetails
                    title="Placement & Snapping"
                    defaultOpen
                    expandAllToken={expandAllToken}
                    collapseAllToken={collapseAllToken}
                >
                    <Panel title="Placement">
                        <div style={{ display: "grid", gap: 8 }}>
                            <label>
                                Snap
                                <Input
                                    type="number"
                                    step="0.05"
                                    value={placement.snap}
                                    onChange={(e) =>
                                        setPlacement((p) => ({
                                            ...(p || {}),
                                            snap: Number(e.target.value) || 0,
                                        }))
                                    }
                                />
                            </label>
                            <div style={{ opacity: 0.75, fontSize: 12 }}>
                                Click model/ground to place. Esc cancels.
                            </div>
                        </div>
                    </Panel>
                </SectionDetails>

                {/* Rooms & Nodes */}
                {LegendTree && (
                    <SectionDetails
                        title="Rooms & Nodes"
                        defaultOpen
                        expandAllToken={expandAllToken}
                        collapseAllToken={collapseAllToken}
                    >
                        <LegendTree />
                    </SectionDetails>
                )}

                {/* Groups */}
                {GroupsPanel && (
                    <SectionDetails
                        title="Groups"
                        defaultOpen
                        expandAllToken={expandAllToken}
                        collapseAllToken={collapseAllToken}
                    >
                        <GroupsPanel />
                    </SectionDetails>
                )}

                {/* Groups – Members */}
                {GroupsMembersPanel && (
                    <SectionDetails
                        title="Groups – Members"
                        expandAllToken={expandAllToken}
                        collapseAllToken={collapseAllToken}
                    >
                        <GroupsMembersPanel />
                    </SectionDetails>
                )}

                {/* Decks */}
                {DecksPanel && (
                    <SectionDetails
                        title="Decks"
                        expandAllToken={expandAllToken}
                        collapseAllToken={collapseAllToken}
                    >
                        <DecksPanel />
                    </SectionDetails>
                )}

                {/* Links */}
                {LinksPanel && (
                    <SectionDetails
                        title="Links"
                        expandAllToken={expandAllToken}
                        collapseAllToken={collapseAllToken}
                    >
                        <LinksPanel />
                    </SectionDetails>
                )}

                {/* Flow defaults */}
                {FlowDefaultsPanel && (
                    <SectionDetails
                        title="Flow Defaults"
                        expandAllToken={expandAllToken}
                        collapseAllToken={collapseAllToken}
                    >
                        <FlowDefaultsPanel />
                    </SectionDetails>
                )}

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
                </SectionDetails>

                {/* Actions (logic / steps) */}
                {ActionsPanel && (
                    <SectionDetails
                        title="Action Buttons (Logic)"
                        expandAllToken={expandAllToken}
                        collapseAllToken={collapseAllToken}
                    >
                        <ActionsPanel />
                    </SectionDetails>
                )}

                {/* HUD Grid Layout editor */}
                <SectionDetails
                    title="Action Buttons – HUD Grid Layout"
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
            </div>

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

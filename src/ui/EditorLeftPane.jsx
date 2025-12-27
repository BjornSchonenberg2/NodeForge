import React, { useState, useEffect } from "react";
import { Btn, IconBtn, Input, Select, Checkbox, Slider, Panel } from "./Controls.jsx";

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

function MinusIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

                            // selection (for model move UI)
                            selected,
                            onMoveModel,
                            onResetModelPosition,
                            modelPosition,

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

                            animate,
                            setAnimate,
                            labelsOn,
                            setLabelsOn,
                            hudButtonsVisible = true,
                            setHudButtonsVisible,
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


                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <Btn
                                    onPointerDown={uiStart}
                                    onPointerUp={uiStop}
                                    onClick={() => onMoveModel && onMoveModel()}
                                    title="Move the imported 3D model with the gizmo"
                                    style={selected?.type === "model" ? { background: "rgba(70,220,255,0.14)", borderColor: "rgba(70,220,255,0.55)" } : undefined}
                                >
                                    {selected?.type === "model" ? "Moving Model" : "Move Model"}
                                </Btn>
                                {onResetModelPosition ? (
                                    <Btn
                                        onPointerDown={uiStart}
                                        onPointerUp={uiStop}
                                        onClick={() => onResetModelPosition()}
                                        title="Reset model offset back to origin"
                                    >
                                        Reset
                                    </Btn>
                                ) : null}
                            </div>
                            <div style={{ opacity: 0.75, fontSize: 12 }}>
                                Arrow keys nudge selection (Shift = 10×).
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
                                    Tip: Cell size controls how big each grid square is. With “Link snap to grid” enabled,
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

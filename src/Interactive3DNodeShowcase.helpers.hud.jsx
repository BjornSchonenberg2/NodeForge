import { getRackById, getProductById } from "./data/products/store";
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Flow clipboard (shared across inspectors / nodes)
// - position clipboard: per-axis (X/Y/Z)
// - style clipboard: copies visual/style fields (not id/from/to/breakpoints)
// ---------------------------------------------------------------------------
function getFlowClipboard() {
    if (typeof window === "undefined") {
        // SSR / tests
        return {
            pos: { x: null, y: null, z: null },
            style: null,
        };
    }
    const w = window;
    if (!w.__NODEFORGE_FLOW_CLIPBOARD__) {
        w.__NODEFORGE_FLOW_CLIPBOARD__ = {
            pos: { x: null, y: null, z: null },
            style: null,
        };
    }
    return w.__NODEFORGE_FLOW_CLIPBOARD__;
}

function deepCloneJson(x) {
    try {
        return JSON.parse(JSON.stringify(x));
    } catch {
        return x;
    }
}

function computeDefaultFlowPos(fromPos, toPos, curve) {
    const a = Array.isArray(fromPos) ? fromPos : [0, 0, 0];
    const b = Array.isArray(toPos) ? toPos : a;
    const mode = curve?.mode || "up";
    const bend = Number(curve?.bend ?? 0.3) || 0;

    const m = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
    if (!bend || mode === "straight") return m;

    const dx = (b[0] - a[0]) || 0;
    const dy = (b[1] - a[1]) || 0;
    const dz = (b[2] - a[2]) || 0;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0;
    if (!dist) return m;

    // UP = (0,1,0); side = dir x UP
    const dirx = dx / dist;
    const diry = dy / dist;
    const dirz = dz / dist;
    let sidex = diry * 0 - dirz * 1;
    let sidey = dirz * 0 - dirx * 0;
    let sidez = dirx * 1 - diry * 0;
    const sl = Math.sqrt(sidex * sidex + sidey * sidey + sidez * sidez) || 1;
    sidex /= sl;
    sidey /= sl;
    sidez /= sl;

    const k = dist * bend * 0.6;
    if (mode === "up") {
        m[1] += k;
    } else if (mode === "side") {
        m[0] += sidex * k;
        m[1] += sidey * k;
        m[2] += sidez * k;
    } else if (mode === "arc") {
        const k2 = dist * bend * 0.45;
        m[1] += k2;
        m[0] += sidex * k2;
        m[1] += sidey * k2;
        m[2] += sidez * k2;
    }
    return m;
}

function extractFlowStyle(link) {
    if (!link) return null;
    // Copy everything EXCEPT identity / endpoints / path control
    const {
        id,
        from,
        to,
        breakpoints,
        flowPos,
        targetName,
        ...rest
    } = link;
    return deepCloneJson(rest);
}

export function OutgoingLinksEditor({
                                        node,
                                        nodes,
                                        links,
                                        setLinks,
                                        selectedBreakpoint,
                                        setSelectedBreakpoint,
                                    }) {
    const clip = getFlowClipboard();

    const outgoing = links
        .filter((l) => l.from === node.id)
        .map((l) => ({
            ...l,
            targetName: nodes.find((n) => n.id === l.to)?.label || l.to,
        }));

    const outgoingWithBps = outgoing.filter(
        (l) => Array.isArray(l.breakpoints) && l.breakpoints.length > 0,
    );

// Bulk align helpers: apply X/Y/Z to ALL breakpoints across ALL outgoing flows from this node.
    const setAllFlowsBreakpointsAxis = (axis, value) => {
        const ai = axisToIndex(axis);
        const v = Number(value);
        if (!Number.isFinite(v)) return;

        setLinks((prev) =>
            prev.map((x) => {
                if (x.from !== node.id) return x;
                const bps = Array.isArray(x.breakpoints) ? x.breakpoints : [];
                if (!bps.length) return x;

                const next = bps.map((b) => {
                    const bb = Array.isArray(b) ? b : [0, 0, 0];
                    const out = [
                        Number(bb[0]) || 0,
                        Number(bb[1]) || 0,
                        Number(bb[2]) || 0,
                    ];
                    out[ai] = v;
                    return out;
                });

                return { ...x, breakpoints: next };
            }),
        );
    };

    const copyAllFlowsBreakpointsAxis = (axis) => {
        if (!outgoingWithBps.length) return;

        // Prefer the currently selected BP (if it belongs to an outgoing flow), else use the first flow with BPs.
        let link = null;
        let idx = 0;

        if (
            selectedBreakpoint &&
            selectedBreakpoint.linkId &&
            Number.isInteger(selectedBreakpoint.index)
        ) {
            const hit = outgoingWithBps.find((o) => o.id === selectedBreakpoint.linkId);
            if (hit) {
                link = hit;
                idx = selectedBreakpoint.index;
            }
        }

        if (!link) link = outgoingWithBps[0];

        const bps = Array.isArray(link.breakpoints) ? link.breakpoints : [];
        if (!bps.length) return;
        if (idx < 0 || idx >= bps.length) idx = 0;

        const bp = bps[idx];
        if (!Array.isArray(bp) || bp.length < 3) return;

        const v = Number(bp[axisToIndex(axis)]);
        if (!Number.isFinite(v)) return;

        clip.pos[axis] = v;
    };

    const pasteAllFlowsBreakpointsAxis = (axis) => {
        const v = clip.pos?.[axis];
        if (!Number.isFinite(Number(v))) return;
        setAllFlowsBreakpointsAxis(axis, v);
    };


// Bulk style helpers: copy/paste flow style across ALL outgoing links from this node.
    const copyAllFlowsStyle = () => {
        if (!outgoing.length) return;

        let src = null;

        // Prefer selected breakpoint's flow as source (if any), else first outgoing.
        if (selectedBreakpoint?.linkId) {
            const hit = outgoing.find((o) => o.id === selectedBreakpoint.linkId);
            if (hit) src = hit;
        }
        if (!src) src = outgoing[0];

        clip.style = extractFlowStyle(src);
    };

    const pasteAllFlowsStyle = () => {
        if (!clip.style) return;

        // Apply style fields to all outgoing flows; never touch endpoints/path.
        setLinks((prev) =>
            prev.map((x) =>
                x.from === node.id ? { ...x, ...deepCloneJson(clip.style) } : x,
            ),
        );
    };

    const [confirmDlg, setConfirmDlg] = useState(null);
    const confirmYesRef = useRef(null);

    useEffect(() => {
        if (!confirmDlg) return;
        const t = setTimeout(() => {
            try {
                confirmYesRef.current?.focus?.();
            } catch {
                // ignore
            }
        }, 0);

        const onKey = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                confirmDlg?.onConfirm?.();
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                confirmDlg?.onCancel?.();
            }
        };

        window.addEventListener("keydown", onKey, true);
        return () => {
            clearTimeout(t);
            window.removeEventListener("keydown", onKey, true);
        };
    }, [confirmDlg]);

    const unlinkNow = (linkId) => {
        if (!linkId) return;
        setLinks((prev) => prev.filter((x) => x.id !== linkId));
        if (selectedBreakpoint?.linkId === linkId && setSelectedBreakpoint) {
            setSelectedBreakpoint(null);
        }
    };

    const requestUnlink = (link) => {
        const linkId = link?.id;
        if (!linkId) return;

        const fromName =
            nodes?.find?.((n) => n.id === link?.from)?.name ||
            nodes?.find?.((n) => n.id === link?.from)?.label ||
            link?.from ||
            "Source";

        const toName =
            nodes?.find?.((n) => n.id === link?.to)?.name ||
            nodes?.find?.((n) => n.id === link?.to)?.label ||
            link?.to ||
            "Target";

        setConfirmDlg({
            title: "Unlink flow?",
            message: `${fromName} → ${toName}`,
            onConfirm: () => {
                setConfirmDlg(null);
                unlinkNow(linkId);
            },
            onCancel: () => setConfirmDlg(null),
        });
    };


    const patch = (id, p) =>
        setLinks((prev) =>
            prev.map((x) => (x.id === id ? { ...x, ...p } : x)),
        );

    const patchNested = (id, path, value) =>
        setLinks((prev) =>
            prev.map((x) => {
                if (x.id !== id) return x;
                const copy = { ...x };
                let cur = copy;
                for (let i = 0; i < path.length - 1; i++) {
                    const k = path[i];
                    cur[k] = cur[k] ? { ...cur[k] } : {};
                    cur = cur[k];
                }
                cur[path[path.length - 1]] = value;
                return copy;
            }),
        );

    const getNodePos = (nodeId) => nodes.find((n) => n.id === nodeId)?.position || [0, 0, 0];

    const getFlowPos = (l) => {
        const fp = l?.flowPos;
        if (Array.isArray(fp) && fp.length >= 3 && fp.every((v) => Number.isFinite(Number(v)))) {
            return [Number(fp[0]), Number(fp[1]), Number(fp[2])];
        }
        // Fallback: match Link3D's default curve midpoint so enabling flowPos does not visually jump.
        return computeDefaultFlowPos(getNodePos(l.from), getNodePos(l.to), l.curve);
    };

    const setFlowPosAxis = (id, l, axis, value) => {
        const cur = getFlowPos(l);
        const next = [...cur];
        const v = Number(value);
        if (axis === "x") next[0] = Number.isFinite(v) ? v : next[0];
        if (axis === "y") next[1] = Number.isFinite(v) ? v : next[1];
        if (axis === "z") next[2] = Number.isFinite(v) ? v : next[2];
        patch(id, { flowPos: next });
    };

    const copyFlowAxis = (l, axis) => {
        const fp = getFlowPos(l);
        if (axis === "x") clip.pos.x = fp[0];
        if (axis === "y") clip.pos.y = fp[1];
        if (axis === "z") clip.pos.z = fp[2];
    };

    const pasteFlowAxis = (l, axis) => {
        const v = axis === "x" ? clip.pos.x : axis === "y" ? clip.pos.y : clip.pos.z;
        if (!Number.isFinite(Number(v))) return;
        setFlowPosAxis(l.id, l, axis, v);
    };

    // Breakpoint clipboard helpers (reuse the same X/Y/Z clipboard as Flow Position)
    const axisToIndex = (axis) => (axis === "x" ? 0 : axis === "y" ? 1 : 2);

    const setBreakpointAxis = (linkId, idx, axis, value) => {
        const ai = axisToIndex(axis);
        const v = Number(value);

        setLinks((prev) =>
            prev.map((x) => {
                if (x.id !== linkId) return x;
                const bps = Array.isArray(x.breakpoints) ? x.breakpoints : [];
                if (idx < 0 || idx >= bps.length) return x;

                const next = bps.map((b, i) => {
                    if (i !== idx) return b;
                    const bb = Array.isArray(b) ? b : [0, 0, 0];
                    const out = [
                        Number(bb[0]) || 0,
                        Number(bb[1]) || 0,
                        Number(bb[2]) || 0,
                    ];
                    out[ai] = Number.isFinite(v) ? v : out[ai];
                    return out;
                });

                return { ...x, breakpoints: next };
            }),
        );
    };

    const copyBreakpointAxis = (l, idx, axis) => {
        const bps = Array.isArray(l.breakpoints) ? l.breakpoints : [];
        const bp = bps[idx];
        if (!Array.isArray(bp) || bp.length < 3) return;
        const ai = axisToIndex(axis);
        const v = Number(bp[ai]);
        if (!Number.isFinite(v)) return;
        clip.pos[axis] = v;
    };

    const pasteBreakpointAxis = (l, idx, axis) => {
        const v = clip.pos?.[axis];
        if (!Number.isFinite(Number(v))) return;
        setBreakpointAxis(l.id, idx, axis, v);
    };

    const setAllBreakpointsAxis = (linkId, axis, value) => {
        const ai = axisToIndex(axis);
        const v = Number(value);
        if (!Number.isFinite(v)) return;

        setLinks((prev) =>
            prev.map((x) => {
                if (x.id !== linkId) return x;
                const bps = Array.isArray(x.breakpoints) ? x.breakpoints : [];
                if (!bps.length) return x;

                const next = bps.map((b) => {
                    const bb = Array.isArray(b) ? b : [0, 0, 0];
                    const out = [
                        Number(bb[0]) || 0,
                        Number(bb[1]) || 0,
                        Number(bb[2]) || 0,
                    ];
                    out[ai] = v;
                    return out;
                });

                return { ...x, breakpoints: next };
            }),
        );
    };

    const copyAllBreakpointsAxis = (l, axis) => {
        const bps = Array.isArray(l.breakpoints) ? l.breakpoints : [];
        if (!bps.length) return;

        // Prefer selected breakpoint as the copy source; fallback to BP1.
        let idx = 0;
        if (
            selectedBreakpoint &&
            selectedBreakpoint.linkId === l.id &&
            Number.isInteger(selectedBreakpoint.index)
        ) {
            const si = selectedBreakpoint.index;
            if (si >= 0 && si < bps.length) idx = si;
        }

        const bp = bps[idx];
        if (!Array.isArray(bp) || bp.length < 3) return;
        const ai = axisToIndex(axis);
        const v = Number(bp[ai]);
        if (!Number.isFinite(v)) return;

        clip.pos[axis] = v;
    };

    const pasteAllBreakpointsAxis = (l, axis) => {
        const v = clip.pos?.[axis];
        if (!Number.isFinite(Number(v))) return;
        setAllBreakpointsAxis(l.id, axis, v);
    };


    const copyFlowStyle = (l) => {
        clip.style = extractFlowStyle(l);
    };

    const pasteFlowStyle = (l) => {
        if (!clip.style) return;
        // merge style fields; never touch endpoints/path
        patch(l.id, deepCloneJson(clip.style));
    };

    return (
        <div
            style={{
                borderTop: "1px dashed rgba(255,255,255,0.15)",
                paddingTop: 8,
                marginTop: 8,
            }}
        >
            <div style={{ fontWeight: 900, marginBottom: 6 }}>
                Outgoing Links (flow per link)
            </div>

            {outgoing.length > 0 && (
                <div
                    style={{
                        padding: 8,
                        borderRadius: 8,
                        border: "1px solid rgba(148,163,184,0.22)",
                        background: "rgba(2,6,23,0.55)",
                        marginBottom: 10,
                    }}
                    title="Bulk copy/paste for styles across ALL outgoing flows from this node. Copy uses the selected flow (via selected breakpoint if any), otherwise the first outgoing flow. Paste applies the copied style to every outgoing flow."
                >
                    <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6, opacity: 0.92 }}>
                        All flows — Style
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <button
                            type="button"
                            onClick={copyAllFlowsStyle}
                            style={{
                                fontSize: 11,
                                padding: "4px 10px",
                                borderRadius: 999,
                                border: "1px solid rgba(148,163,184,0.6)",
                                background: "rgba(15,23,42,0.9)",
                                color: "#e5e7eb",
                                cursor: "pointer",
                            }}
                            title="Copy style from selected flow (or first outgoing flow)"
                        >
                            Copy Style
                        </button>

                        <button
                            type="button"
                            onClick={pasteAllFlowsStyle}
                            disabled={!clip.style}
                            style={{
                                fontSize: 11,
                                padding: "4px 10px",
                                borderRadius: 999,
                                border: "1px solid rgba(148,163,184,0.6)",
                                background: clip.style ? "rgba(15,23,42,0.9)" : "rgba(15,23,42,0.55)",
                                color: clip.style ? "#e5e7eb" : "rgba(229,231,235,0.55)",
                                cursor: clip.style ? "pointer" : "not-allowed",
                            }}
                            title="Paste copied style onto ALL outgoing flows"
                        >
                            Paste Style to All
                        </button>

                        <div style={{ fontSize: 11, opacity: 0.65 }}>
                            Clipboard: {clip.style ? "style loaded" : "empty"}
                        </div>
                    </div>
                </div>
            )}

            {outgoingWithBps.length > 0 && (
                <div
                    style={{
                        padding: 8,
                        borderRadius: 8,
                        border: "1px solid rgba(148,163,184,0.22)",
                        background: "rgba(2,6,23,0.55)",
                        marginBottom: 10,
                    }}
                    title="Bulk copy/paste for ALL breakpoints across ALL outgoing flows from this node. Copy uses the selected breakpoint (if any), otherwise the first flow's BP 1. Paste applies to every breakpoint in every outgoing flow that has breakpoints."
                >
                    <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6, opacity: 0.92 }}>
                        All flows — Breakpoints
                    </div>

                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "auto 1fr 1fr 1fr",
                            gap: 8,
                            alignItems: "center",
                        }}
                    >
                        <div style={{ fontSize: 11, opacity: 0.75, paddingRight: 4 }}>Bulk</div>

                        {["X", "Y", "Z"].map((axis) => {
                            const axisKey = String(axis).toLowerCase();
                            const hasClip = Number.isFinite(Number(clip.pos?.[axisKey]));
                            return (
                                <div
                                    key={axis}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "16px auto auto",
                                        gap: 6,
                                        alignItems: "center",
                                        justifyContent: "start",
                                    }}
                                >
                                    <div style={{ fontSize: 11, opacity: 0.85 }}>{axis}</div>

                                    <button
                                        type="button"
                                        onClick={() => copyAllFlowsBreakpointsAxis(axisKey)}
                                        style={{
                                            fontSize: 10,
                                            padding: "3px 8px",
                                            borderRadius: 999,
                                            border: "1px solid rgba(148,163,184,0.6)",
                                            background: "rgba(15,23,42,0.9)",
                                            color: "#e5e7eb",
                                            cursor: "pointer",
                                        }}
                                        title={`Copy ${axis} from selected BP (or first flow BP 1)`}
                                    >
                                        C
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => pasteAllFlowsBreakpointsAxis(axisKey)}
                                        disabled={!hasClip}
                                        style={{
                                            fontSize: 10,
                                            padding: "3px 8px",
                                            borderRadius: 999,
                                            border: "1px solid rgba(148,163,184,0.6)",
                                            background: hasClip ? "rgba(15,23,42,0.9)" : "rgba(15,23,42,0.55)",
                                            color: hasClip ? "#e5e7eb" : "rgba(229,231,235,0.55)",
                                            cursor: hasClip ? "pointer" : "not-allowed",
                                        }}
                                        title={`Paste ${axis} to ALL breakpoints in ALL outgoing flows`}
                                    >
                                        P
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {outgoing.length === 0 && (
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                    No links originate from this node.
                </div>
            )}

            {outgoing.map((l) => (
                <div
                    key={l.id}
                    style={{
                        padding: 8,
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 6,
                        marginBottom: 8,
                        background: "linear-gradient(180deg,#020617,rgba(15,23,42,0.92))",
                    }}
                >
                    <div
                        style={{
                            fontSize: 12,
                            opacity: 0.8,
                            marginBottom: 6,
                        }}
                    >
                        to <strong>{l.targetName}</strong> (id: {l.id})
                    </div>

                    {/* Flow actions */}
                    <div
                        style={{
                            display: "flex",
                            gap: 6,
                            flexWrap: "wrap",
                            marginBottom: 8,
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => requestUnlink(l)}
                            style={{
                                fontSize: 11,
                                padding: "4px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(239,68,68,0.9)",
                                background: "rgba(127,29,29,0.95)",
                                color: "#fee2e2",
                                cursor: "pointer",
                            }}
                            title="Unlink / delete this flow"
                        >
                            Unlink
                        </button>

                        <button
                            type="button"
                            onClick={() => copyFlowStyle(l)}
                            style={{
                                fontSize: 11,
                                padding: "4px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(148,163,184,0.6)",
                                background: "rgba(15,23,42,0.9)",
                                color: "#e5e7eb",
                                cursor: "pointer",
                            }}
                            title="Copy this flow's style settings"
                        >
                            Copy Style
                        </button>

                        <button
                            type="button"
                            onClick={() => pasteFlowStyle(l)}
                            disabled={!clip.style}
                            style={{
                                fontSize: 11,
                                padding: "4px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(148,163,184,0.6)",
                                background: clip.style ? "rgba(15,23,42,0.9)" : "rgba(15,23,42,0.55)",
                                color: clip.style ? "#e5e7eb" : "rgba(229,231,235,0.55)",
                                cursor: clip.style ? "pointer" : "not-allowed",
                            }}
                            title="Paste the copied flow style onto this flow"
                        >
                            Paste Style
                        </button>
                    </div>

                    {/* Core */}
                    <label>
                        Style{" "}
                        <select
                            value={l.style || "particles"}
                            onChange={(e) =>
                                patch(l.id, { style: e.target.value })
                            }
                        >
                            <option value="particles">particles</option>
                            <option value="wavy">wavy</option>
                            <option value="icons">icons</option>
                            <option value="dashed">dashed</option>
                            <option value="solid">solid</option>
                            <option value="epic">epic</option>
                            <option value="sweep">sweep</option>
                            <option value="cable">cable</option>
                        </select>
                    </label>

                    <label style={{ display: "block", marginTop: 6 }}>
                        Speed
                        <input
                            type="range"
                            min={0}
                            max={4}
                            step={0.01}
                            value={l.speed ?? 1}
                            onChange={(e) =>
                                patch(l.id, {
                                    speed: Number(e.target.value),
                                })
                            }
                        />
                    </label>

                    <label style={{ display: "block", marginTop: 6 }}>
                        Color
                        <input
                            type="color"
                            value={l.color || "#7cf"}
                            onChange={(e) =>
                                patch(l.id, { color: e.target.value })
                            }
                        />
                    </label>

                    <label
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            marginTop: 6,
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={!!l.active}
                            onChange={(e) =>
                                patch(l.id, { active: e.target.checked })
                            }
                        />{" "}
                        Active
                    </label>

                    {/* Common meta */}
                    <div
                        style={{
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop:
                                "1px dashed rgba(255,255,255,0.12)",
                        }}
                    >
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 8,
                            }}
                        >
                            <label>
                                Kind{" "}
                                <select
                                    value={l.kind || ""}
                                    onChange={(e) =>
                                        patch(l.id, {
                                            kind:
                                                e.target.value || undefined,
                                        })
                                    }
                                >
                                    <option value="">(none)</option>
                                    <option value="wifi">Wi-Fi</option>
                                    <option value="wired">Wired</option>
                                    <option value="fiber">Fiber</option>
                                </select>
                            </label>

                            {/* Size/Thickness multiplier */}
                            <label
                                style={{
                                    display: "block",
                                    marginTop: 0,
                                }}
                            >
                                Scale
                                <input
                                    type="range"
                                    min={0.5}
                                    max={2}
                                    step={0.05}
                                    value={l.scale ?? 1}
                                    onChange={(e) =>
                                        patch(l.id, {
                                            scale: Number(e.target.value),
                                        })
                                    }
                                />
                            </label>
                        </div>

                        {/* Visual effects */}
                        <div
                            style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop:
                                    "1px dashed rgba(255,255,255,0.12)",
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 800,
                                    marginBottom: 4,
                                }}
                            >
                                Effects
                            </div>

                            <label style={{ display: "block" }}>
                                Glow
                                <input
                                    type="checkbox"
                                    checked={
                                        (l.effects?.glow ?? false) === true
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["effects", "glow"],
                                            e.target.checked,
                                        )
                                    }
                                />{" "}
                                Stronger glow
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 4,
                                }}
                            >
                                Highlight
                                <input
                                    type="checkbox"
                                    checked={
                                        (l.effects?.highlight ?? false) ===
                                        true
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["effects", "highlight"],
                                            e.target.checked,
                                        )
                                    }
                                />{" "}
                                Emphasize this link
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 4,
                                }}
                            >
                                Sparks
                                <input
                                    type="checkbox"
                                    checked={
                                        (l.effects?.sparks ?? false) === true
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["effects", "sparks"],
                                            e.target.checked,
                                        )
                                    }
                                />{" "}
                                Sparks (for “epic” tube)
                            </label>
                        </div>
                    </div>

                    {/* Curve block */}
                    <div
                        style={{
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop:
                                "1px dashed rgba(255,255,255,0.12)",
                        }}
                    >
                        <div
                            style={{
                                fontWeight: 800,
                                marginBottom: 4,
                            }}
                        >
                            Curve
                        </div>
                        <label>
                            Mode{" "}
                            <select
                                value={l.curve?.mode || "up"}
                                onChange={(e) =>
                                    patchNested(
                                        l.id,
                                        ["curve", "mode"],
                                        e.target.value,
                                    )
                                }
                            >
                                <option value="straight">straight</option>
                                <option value="up">up</option>
                                <option value="side">side</option>
                                <option value="arc">arc</option>
                            </select>
                        </label>
                        <label
                            style={{
                                display: "block",
                                marginTop: 6,
                            }}
                        >
                            Bend
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={l.curve?.bend ?? 0.3}
                                onChange={(e) =>
                                    patchNested(
                                        l.id,
                                        ["curve", "bend"],
                                        Number(e.target.value),
                                    )
                                }
                            />
                        </label>
                        <label
                            style={{
                                display: "block",
                                marginTop: 6,
                            }}
                        >
                            Noise Amp
                            <input
                                type="range"
                                min={0}
                                max={0.6}
                                step={0.005}
                                value={l.curve?.noiseAmp ?? 0}
                                onChange={(e) =>
                                    patchNested(
                                        l.id,
                                        ["curve", "noiseAmp"],
                                        Number(e.target.value),
                                    )
                                }
                            />
                        </label>
                        <label
                            style={{
                                display: "block",
                                marginTop: 6,
                            }}
                        >
                            Noise Freq
                            <input
                                type="range"
                                min={0.2}
                                max={8}
                                step={0.05}
                                value={l.curve?.noiseFreq ?? 1.5}
                                onChange={(e) =>
                                    patchNested(
                                        l.id,
                                        ["curve", "noiseFreq"],
                                        Number(e.target.value),
                                    )
                                }
                            />
                        </label>
                    </div>

                    {/* Flow Position (single control point) — only when there are NO breakpoints */}
                    {(!Array.isArray(l.breakpoints) || l.breakpoints.length === 0) && (
                        <div
                            style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: "1px dashed rgba(255,255,255,0.12)",
                            }}
                        >
                            <div style={{ fontWeight: 800, marginBottom: 4 }}>
                                Flow Position
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                                Control point used when there are no breakpoints. Copy / paste X/Y/Z
                                to align flows neatly.
                            </div>

                            <div style={{ display: "grid", gap: 6 }}>
                                {([
                                    ["x", 0],
                                    ["y", 1],
                                    ["z", 2],
                                ]).map(([axis, idx]) => {
                                    const fp = getFlowPos(l);
                                    const hasClip = Number.isFinite(Number(clip.pos?.[axis]));
                                    return (
                                        <div
                                            key={axis}
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "24px 1fr auto auto",
                                                gap: 6,
                                                alignItems: "center",
                                            }}
                                        >
                                            <div style={{ fontSize: 11, opacity: 0.85 }}>{String(axis).toUpperCase()}</div>
                                            <input
                                                type="number"
                                                value={fp[idx]}
                                                onChange={(e) => setFlowPosAxis(l.id, l, axis, e.target.value)}
                                                style={{
                                                    width: "100%",
                                                    fontSize: 11,
                                                    padding: "2px 6px",
                                                    borderRadius: 6,
                                                    border: "1px solid rgba(148,163,184,0.6)",
                                                    background: "rgba(15,23,42,0.9)",
                                                    color: "#e5e7eb",
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => copyFlowAxis(l, axis)}
                                                style={{
                                                    fontSize: 11,
                                                    padding: "3px 8px",
                                                    borderRadius: 999,
                                                    border: "1px solid rgba(148,163,184,0.6)",
                                                    background: "rgba(15,23,42,0.9)",
                                                    color: "#e5e7eb",
                                                    cursor: "pointer",
                                                }}
                                                title={`Copy ${String(axis).toUpperCase()}`}
                                            >
                                                Copy
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => pasteFlowAxis(l, axis)}
                                                disabled={!hasClip}
                                                style={{
                                                    fontSize: 11,
                                                    padding: "3px 8px",
                                                    borderRadius: 999,
                                                    border: "1px solid rgba(148,163,184,0.6)",
                                                    background: hasClip ? "rgba(15,23,42,0.9)" : "rgba(15,23,42,0.55)",
                                                    color: hasClip ? "#e5e7eb" : "rgba(229,231,235,0.55)",
                                                    cursor: hasClip ? "pointer" : "not-allowed",
                                                }}
                                                title={`Paste ${String(axis).toUpperCase()}`}
                                            >
                                                Paste
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Breakpoints (manual path control points) */}
                    <div
                        style={{
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop:
                                "1px dashed rgba(255,255,255,0.12)",
                        }}
                    >
                        <div
                            style={{
                                fontWeight: 800,
                                marginBottom: 4,
                            }}
                        >
                            Breakpoints
                        </div>
                        <div
                            style={{
                                fontSize: 12,
                                opacity: 0.8,
                                marginBottom: 4,
                            }}
                        >
                            Add control points to bend this link around
                            corners. The path will go from the source node
                            through each breakpoint to the target node.
                        </div>

                        {/* Add breakpoint button */}
                        <button
                            type="button"
                            onClick={() => {
                                const source =
                                    nodes.find((n) => n.id === l.from) || node;
                                const target = nodes.find((n) => n.id === l.to);

                                const fromPos = source?.position || [0, 0, 0];
                                const toPos = target?.position || fromPos;

                                // Existing breakpoints (ignored for placement, we recompute evenly)
                                const existing = Array.isArray(l.breakpoints)
                                    ? l.breakpoints
                                    : [];

                                // Total number of breakpoints after adding one
                                const count = existing.length + 1;

                                // Direction vector from source to target
                                const dir = [
                                    toPos[0] - fromPos[0],
                                    toPos[1] - fromPos[1],
                                    toPos[2] - fromPos[2],
                                ];

                                // Evenly distribute all breakpoints along the segment
                                const next = [];
                                for (let i = 0; i < count; i++) {
                                    const t = (i + 1) / (count + 1); // 0–1 along the link
                                    next.push([
                                        fromPos[0] + dir[0] * t,
                                        fromPos[1] + dir[1] * t,
                                        fromPos[2] + dir[2] * t,
                                    ]);
                                }

                                patch(l.id, { breakpoints: next });

                                if (setSelectedBreakpoint) {
                                    setSelectedBreakpoint({
                                        linkId: l.id,
                                        index: next.length - 1, // select the newly added one
                                    });
                                }
                            }}
                            style={{
                                fontSize: 11,
                                padding: "4px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(59,130,246,0.9)",
                                background: "rgba(37,99,235,0.9)",
                                color: "#e5f0ff",
                                cursor: "pointer",
                                marginTop: 4,
                            }}
                        >
                            + Add breakpoint
                        </button>


                        {/* Legend of breakpoints */}
                        {Array.isArray(l.breakpoints) &&
                            l.breakpoints.length > 0 && (
                                <div
                                    style={{
                                        marginTop: 8,
                                        display: "grid",
                                        gap: 6,
                                    }}
                                >
                                    <div
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                            padding: 6,
                                            borderRadius: 6,
                                            border: "1px solid rgba(148,163,184,0.35)",
                                            background: "rgba(2,6,23,0.55)",
                                            display: "grid",
                                            gridTemplateColumns: "auto 1fr 1fr 1fr auto",
                                            gap: 4,
                                            alignItems: "center",
                                        }}
                                        title="Bulk copy/paste for all breakpoints. Copy uses the selected breakpoint as source (or BP 1 if none selected). Paste applies to every breakpoint."
                                    >
                                        <div
                                            style={{
                                                fontSize: 11,
                                                opacity: 0.85,
                                                paddingRight: 4,
                                            }}
                                        >
                                            All
                                        </div>

                                        {["X", "Y", "Z"].map((axis) => {
                                            const axisKey = String(axis).toLowerCase();
                                            const hasClip = Number.isFinite(
                                                Number(clip.pos?.[axisKey]),
                                            );
                                            return (
                                                <div
                                                    key={axis}
                                                    style={{
                                                        display: "grid",
                                                        gridTemplateColumns:
                                                            "16px auto auto",
                                                        gap: 6,
                                                        alignItems: "center",
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            fontSize: 11,
                                                            opacity: 0.85,
                                                        }}
                                                    >
                                                        {axis}
                                                    </div>

                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            copyAllBreakpointsAxis(
                                                                l,
                                                                axisKey,
                                                            );
                                                        }}
                                                        style={{
                                                            fontSize: 10,
                                                            padding: "3px 8px",
                                                            borderRadius: 999,
                                                            border: "1px solid rgba(148,163,184,0.6)",
                                                            background:
                                                                "rgba(15,23,42,0.9)",
                                                            color: "#e5e7eb",
                                                            cursor: "pointer",
                                                        }}
                                                        title={`Copy ${axis} from selected BP (or BP 1)`}
                                                    >
                                                        C
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            pasteAllBreakpointsAxis(
                                                                l,
                                                                axisKey,
                                                            );
                                                        }}
                                                        disabled={!hasClip}
                                                        style={{
                                                            fontSize: 10,
                                                            padding: "3px 8px",
                                                            borderRadius: 999,
                                                            border: "1px solid rgba(148,163,184,0.6)",
                                                            background: hasClip
                                                                ? "rgba(15,23,42,0.9)"
                                                                : "rgba(15,23,42,0.55)",
                                                            color: hasClip
                                                                ? "#e5e7eb"
                                                                : "rgba(229,231,235,0.55)",
                                                            cursor: hasClip
                                                                ? "pointer"
                                                                : "not-allowed",
                                                        }}
                                                        title={`Paste ${axis} to ALL breakpoints`}
                                                    >
                                                        P
                                                    </button>
                                                </div>
                                            );
                                        })}

                                        <div
                                            style={{
                                                fontSize: 11,
                                                opacity: 0.65,
                                                textAlign: "right",
                                            }}
                                        >
                                            bulk
                                        </div>
                                    </div>

                                    {l.breakpoints.map((bp, idx) => {
                                        const isSelected =
                                            selectedBreakpoint &&
                                            selectedBreakpoint.linkId ===
                                            l.id &&
                                            selectedBreakpoint.index ===
                                            idx;

                                        return (
                                            <div
                                                key={idx}
                                                onClick={() => {
                                                    if (
                                                        setSelectedBreakpoint
                                                    ) {
                                                        setSelectedBreakpoint(
                                                            {
                                                                linkId:
                                                                l.id,
                                                                index: idx,
                                                            },
                                                        );
                                                    }
                                                }}
                                                style={{
                                                    padding: 6,
                                                    borderRadius: 6,
                                                    cursor: "pointer",
                                                    border: isSelected
                                                        ? "1px solid rgba(59,130,246,0.95)"
                                                        : "1px solid rgba(148,163,184,0.35)",
                                                    background: isSelected
                                                        ? "linear-gradient(135deg, rgba(30,64,175,0.9), rgba(15,23,42,0.95))"
                                                        : "rgba(15,23,42,0.85)",
                                                    display: "grid",
                                                    gridTemplateColumns:
                                                        "auto 1fr 1fr 1fr auto",
                                                    gap: 4,
                                                    alignItems:
                                                        "center",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        fontSize: 11,
                                                        opacity: 0.8,
                                                        paddingRight: 4,
                                                    }}
                                                >
                                                    BP {idx + 1}
                                                </div>

                                                {["X", "Y", "Z"].map((axis, axisIndex) => {
                                                    const axisKey = String(axis).toLowerCase();
                                                    const hasClip = Number.isFinite(Number(clip.pos?.[axisKey]));
                                                    return (
                                                        <div
                                                            key={axis}
                                                            style={{
                                                                display: "grid",
                                                                gridTemplateColumns: "16px 1fr auto auto",
                                                                gap: 4,
                                                                alignItems: "center",
                                                            }}
                                                        >
                                                            <div style={{ fontSize: 11, opacity: 0.85 }}>{axis}</div>
                                                            <input
                                                                type="number"
                                                                step={0.05}
                                                                value={bp?.[axisIndex] ?? 0}
                                                                onChange={(e) => setBreakpointAxis(l.id, idx, axisKey, e.target.value)}
                                                                style={{
                                                                    width: "100%",
                                                                    fontSize: 11,
                                                                    padding: "2px 4px",
                                                                    borderRadius: 4,
                                                                    border: "1px solid rgba(148,163,184,0.6)",
                                                                    background: "rgba(15,23,42,0.9)",
                                                                    color: "#e5e7eb",
                                                                }}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    copyBreakpointAxis(l, idx, axisKey);
                                                                }}
                                                                style={{
                                                                    fontSize: 10,
                                                                    padding: "3px 6px",
                                                                    borderRadius: 999,
                                                                    border: "1px solid rgba(148,163,184,0.6)",
                                                                    background: "rgba(15,23,42,0.9)",
                                                                    color: "#e5e7eb",
                                                                    cursor: "pointer",
                                                                }}
                                                                title={`Copy ${axis}`}
                                                            >
                                                                C
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    pasteBreakpointAxis(l, idx, axisKey);
                                                                }}
                                                                disabled={!hasClip}
                                                                style={{
                                                                    fontSize: 10,
                                                                    padding: "3px 6px",
                                                                    borderRadius: 999,
                                                                    border: "1px solid rgba(148,163,184,0.6)",
                                                                    background: hasClip ? "rgba(15,23,42,0.9)" : "rgba(15,23,42,0.55)",
                                                                    color: hasClip ? "#e5e7eb" : "rgba(229,231,235,0.55)",
                                                                    cursor: hasClip ? "pointer" : "not-allowed",
                                                                }}
                                                                title={`Paste ${axis}`}
                                                            >
                                                                P
                                                            </button>
                                                        </div>
                                                    );
                                                })}

                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const current =
                                                            Array.isArray(
                                                                l.breakpoints,
                                                            )
                                                                ? l.breakpoints
                                                                : [];
                                                        const next =
                                                            current.filter(
                                                                (
                                                                    _,
                                                                    i,
                                                                ) =>
                                                                    i !==
                                                                    idx,
                                                            );
                                                        patch(l.id, {
                                                            breakpoints:
                                                            next,
                                                        });

                                                        if (
                                                            selectedBreakpoint &&
                                                            selectedBreakpoint.linkId ===
                                                            l.id &&
                                                            selectedBreakpoint.index ===
                                                            idx &&
                                                            setSelectedBreakpoint
                                                        ) {
                                                            setSelectedBreakpoint(
                                                                null,
                                                            );
                                                        }
                                                    }}
                                                    style={{
                                                        marginLeft: 4,
                                                        fontSize: 11,
                                                        padding:
                                                            "3px 6px",
                                                        borderRadius: 999,
                                                        border: "1px solid rgba(239,68,68,0.9)",
                                                        background:
                                                            "rgba(127,29,29,0.95)",
                                                        color: "#fee2e2",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        );
                                    })}

                                    <button
                                        type="button"
                                        onClick={() => {
                                            patch(l.id, {
                                                breakpoints: [],
                                            });
                                            if (
                                                selectedBreakpoint &&
                                                selectedBreakpoint.linkId ===
                                                l.id &&
                                                setSelectedBreakpoint
                                            ) {
                                                setSelectedBreakpoint(
                                                    null,
                                                );
                                            }
                                        }}
                                        style={{
                                            marginTop: 4,
                                            fontSize: 11,
                                            textAlign: "left",
                                            opacity: 0.8,
                                            background: "none",
                                            border: "none",
                                            padding: 0,
                                            cursor: "pointer",
                                            color: "rgba(148,163,184,0.95)",
                                        }}
                                    >
                                        Clear all breakpoints
                                    </button>
                                </div>
                            )}
                    </div>

                    {/* Particles / Wavy */}
                    {(l.style === "particles" || l.style === "wavy") && (
                        <div
                            style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop:
                                    "1px dashed rgba(255,255,255,0.12)",
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 800,
                                    marginBottom: 4,
                                }}
                            >
                                Particles
                            </div>

                            <label style={{ display: "block" }}>
                                Count
                                <input
                                    type="range"
                                    min={1}
                                    max={80}
                                    step={1}
                                    value={l.particles?.count ?? 12}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["particles", "count"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Size
                                <input
                                    type="range"
                                    min={0.02}
                                    max={0.3}
                                    step={0.01}
                                    value={l.particles?.size ?? 0.06}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["particles", "size"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Opacity
                                <input
                                    type="range"
                                    min={0.1}
                                    max={1}
                                    step={0.05}
                                    value={
                                        l.particles?.opacity ?? 1
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["particles", "opacity"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Wave Amp
                                <input
                                    type="range"
                                    min={0}
                                    max={0.6}
                                    step={0.01}
                                    value={
                                        l.particles?.waveAmp ??
                                        (l.style === "wavy"
                                            ? 0.15
                                            : 0)
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["particles", "waveAmp"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Wave Freq
                                <input
                                    type="range"
                                    min={0.2}
                                    max={8}
                                    step={0.05}
                                    value={
                                        l.particles?.waveFreq ?? 2
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["particles", "waveFreq"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Shape
                                <select
                                    value={
                                        l.particles?.shape ||
                                        "sphere"
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["particles", "shape"],
                                            e.target.value,
                                        )
                                    }
                                >
                                    <option value="sphere">
                                        sphere
                                    </option>
                                    <option value="box">box</option>
                                    <option value="octa">octa</option>
                                </select>
                            </label>
                        </div>
                    )}
                    {/* Dashed */}
                    {l.style === "dashed" && (
                        <div
                            style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: "1px dashed rgba(255,255,255,0.12)",
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 800,
                                    marginBottom: 4,
                                }}
                            >
                                Dashed line
                            </div>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Dash length
                                <input
                                    type="range"
                                    min={0.2}
                                    max={4}
                                    step={0.05}
                                    value={l.dash?.length ?? 1}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["dash", "length"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Dash gap
                                <input
                                    type="range"
                                    min={0.02}
                                    max={1}
                                    step={0.01}
                                    value={l.dash?.gap ?? 0.25}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["dash", "gap"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Dash speed
                                <input
                                    type="range"
                                    min={0}
                                    max={3}
                                    step={0.05}
                                    value={l.dash?.speed ?? 1}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["dash", "speed"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>

                            <label
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    marginTop: 6,
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={(l.dash?.animate ?? true) === true}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["dash", "animate"],
                                            e.target.checked,
                                        )
                                    }
                                />{" "}
                                Animate dashes
                            </label>
                        </div>
                    )}

                    {/* Icons */}
                    {l.style === "icons" && (
                        <div
                            style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop:
                                    "1px dashed rgba(255,255,255,0.12)",
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 800,
                                    marginBottom: 4,
                                }}
                            >
                                Icons
                            </div>
                            <label style={{ display: "block" }}>
                                Icon kind
                                <select
                                    value={l.icons?.kind || "arrow"}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["icons", "kind"],
                                            e.target.value,
                                        )
                                    }
                                >
                                    <option value="arrow">
                                        arrow
                                    </option>
                                    <option value="dot">dot</option>
                                    <option value="square">
                                        square
                                    </option>
                                </select>
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Size
                                <input
                                    type="range"
                                    min={0.1}
                                    max={2}
                                    step={0.05}
                                    value={l.icons?.size ?? 0.8}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["icons", "size"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Spacing
                                <input
                                    type="range"
                                    min={0.1}
                                    max={2}
                                    step={0.05}
                                    value={
                                        l.icons?.spacing ?? 0.6
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["icons", "spacing"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>
                        </div>
                    )}

                    {/* Sweep */}
                    {l.style === "sweep" && (
                        <div
                            style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: "1px dashed rgba(255,255,255,0.12)",
                            }}
                        >
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>
                                Sweep animation
                            </div>

                            <div style={{ display: "grid", gap: 8 }}>
                                {/* Timing */}
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                                        Timing
                                    </div>

                                    <label style={{ display: "block" }}>
                                        Duration (s)
                                        <input
                                            type="range"
                                            min={0.1}
                                            max={12}
                                            step={0.05}
                                            value={l.sweep?.duration ?? 1.4}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "duration"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.duration ?? 1.4).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Hold at end (s)
                                        <input
                                            type="range"
                                            min={0}
                                            max={4}
                                            step={0.02}
                                            value={l.sweep?.hold ?? 0.12}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "hold"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.hold ?? 0.12).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Pause before restart (s)
                                        <input
                                            type="range"
                                            min={0}
                                            max={4}
                                            step={0.02}
                                            value={l.sweep?.pause ?? 0.2}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "pause"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.pause ?? 0.2).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Speed multiplier
                                        <input
                                            type="range"
                                            min={0}
                                            max={4}
                                            step={0.05}
                                            value={l.sweep?.speed ?? l.speed ?? 1}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "speed"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.speed ?? l.speed ?? 1).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Reset gap (s)
                                        <input
                                            type="range"
                                            min={0}
                                            max={2}
                                            step={0.01}
                                            value={l.sweep?.resetGap ?? 0.05}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "resetGap"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.resetGap ?? 0.05).toFixed(2)}
                                        </span>
                                    </label>
                                </div>

                                {/* Draw / direction */}
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                                        Draw & direction
                                    </div>

                                    <label style={{ display: "block" }}>
                                        Draw mode{" "}
                                        <select
                                            value={l.sweep?.fillMode ?? "trail"}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "fillMode"], e.target.value)
                                            }
                                        >
                                            <option value="trail">trail (moving window)</option>
                                            <option value="fill">fill (grow line)</option>
                                        </select>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Trail length
                                        <input
                                            type="range"
                                            min={0.02}
                                            max={1}
                                            step={0.01}
                                            value={l.sweep?.trailLength ?? 0.18}
                                            onChange={(e) =>
                                                patchNested(
                                                    l.id,
                                                    ["sweep", "trailLength"],
                                                    Number(e.target.value),
                                                )
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.trailLength ?? 0.18).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!(l.sweep?.baseVisible ?? false)}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "baseVisible"], e.target.checked)
                                            }
                                        />{" "}
                                        Show base line underneath
                                    </label>

                                    <label style={{ display: "block" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!(l.sweep?.invert ?? false)}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "invert"], e.target.checked)
                                            }
                                        />{" "}
                                        Reverse direction (boomerang start from target)
                                    </label>

                                    <label style={{ display: "block" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!(l.sweep?.pingpong ?? false)}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "pingpong"], e.target.checked)
                                            }
                                        />{" "}
                                        Ping-pong (boomerang)
                                    </label>

                                    {!!(l.sweep?.pingpong ?? false) && (
                                        <div style={{ display: "grid", gap: 6, paddingLeft: 10 }}>
                                            <label style={{ display: "block" }}>
                                                Back duration (s)
                                                <input
                                                    type="range"
                                                    min={0.1}
                                                    max={12}
                                                    step={0.05}
                                                    value={l.sweep?.durationBack ?? l.sweep?.duration ?? 1.4}
                                                    onChange={(e) =>
                                                        patchNested(
                                                            l.id,
                                                            ["sweep", "durationBack"],
                                                            Number(e.target.value),
                                                        )
                                                    }
                                                />{" "}
                                                <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                    {(l.sweep?.durationBack ?? l.sweep?.duration ?? 1.4).toFixed(2)}
                                                </span>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Back hold (s)
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={4}
                                                    step={0.02}
                                                    value={l.sweep?.holdBack ?? 0}
                                                    onChange={(e) =>
                                                        patchNested(l.id, ["sweep", "holdBack"], Number(e.target.value))
                                                    }
                                                />{" "}
                                                <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                    {(l.sweep?.holdBack ?? 0).toFixed(2)}
                                                </span>
                                            </label>
                                        </div>
                                    )}
                                </div>


                                {/* Path & breakpoints */}
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                                        Path & breakpoints
                                    </div>

                                    <label style={{ display: "block" }}>
                                        Breakpoint path mode{" "}
                                        <select
                                            value={l.sweep?.pathMode ?? "auto"}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "pathMode"], e.target.value)
                                            }
                                        >
                                            <option value="auto">auto (single curve if breakpoints)</option>
                                            <option value="single">single curve always</option>
                                            <option value="segments">per-segment (legacy)</option>
                                        </select>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Path type{" "}
                                        <select
                                            value={l.sweep?.pathType ?? "centripetal"}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "pathType"], e.target.value)
                                            }
                                        >
                                            <option value="centripetal">smooth (centripetal spline)</option>
                                            <option value="chordal">smooth (chordal spline)</option>
                                            <option value="catmullrom">smooth (catmull-rom + tension)</option>
                                            <option value="linear">linear (hard corners)</option>
                                        </select>
                                    </label>

                                    {String(l.sweep?.pathType ?? "centripetal").toLowerCase() === "catmullrom" && (
                                        <label style={{ display: "block" }}>
                                            Path tension
                                            <input
                                                type="range"
                                                min={0}
                                                max={1}
                                                step={0.01}
                                                value={l.sweep?.pathTension ?? 0.5}
                                                onChange={(e) =>
                                                    patchNested(l.id, ["sweep", "pathTension"], Number(e.target.value))
                                                }
                                            />{" "}
                                            <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                {(l.sweep?.pathTension ?? 0.5).toFixed(2)}
                                            </span>
                                        </label>
                                    )}
                                </div>

                                {/* Look */}
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                                        Look
                                    </div>

                                    <label style={{ display: "block" }}>
                                        Sweep color{" "}
                                        <input
                                            type="color"
                                            value={l.sweep?.color ?? l.color ?? "#7cf"}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "color"], e.target.value)
                                            }
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                patchNested(l.id, ["sweep", "color"], l.color || "#7cf")
                                            }
                                            style={{
                                                marginLeft: 8,
                                                fontSize: 11,
                                                padding: "2px 10px",
                                                borderRadius: 999,
                                                border: "1px solid rgba(148,163,184,0.55)",
                                                background: "rgba(15,23,42,0.8)",
                                                color: "#e5e7eb",
                                                cursor: "pointer",
                                            }}
                                            title="Copy the main flow color into the sweep color"
                                        >
                                            Use flow color
                                        </button>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!(l.sweep?.gradient ?? false)}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "gradient"], e.target.checked)
                                            }
                                        />{" "}
                                        Gradient
                                    </label>

                                    {(l.sweep?.gradient ?? false) && (
                                        <label style={{ display: "block" }}>
                                            Gradient color 2{" "}
                                            <input
                                                type="color"
                                                value={l.sweep?.color2 ?? "#ffffff"}
                                                onChange={(e) =>
                                                    patchNested(l.id, ["sweep", "color2"], e.target.value)
                                                }
                                            />
                                        </label>
                                    )}

                                    <label style={{ display: "block" }}>
                                        Thickness
                                        <input
                                            type="range"
                                            min={0.005}
                                            max={0.2}
                                            step={0.001}
                                            value={l.sweep?.thickness ?? 0.06}
                                            onChange={(e) =>
                                                patchNested(
                                                    l.id,
                                                    ["sweep", "thickness"],
                                                    Number(e.target.value),
                                                )
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.thickness ?? 0.06).toFixed(3)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Glow
                                        <input
                                            type="range"
                                            min={0}
                                            max={4}
                                            step={0.05}
                                            value={l.sweep?.glow ?? 1.15}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "glow"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.glow ?? 1.15).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Edge feather
                                        <input
                                            type="range"
                                            min={0}
                                            max={0.25}
                                            step={0.005}
                                            value={l.sweep?.feather ?? 0.06}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "feather"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.feather ?? 0.06).toFixed(3)}
                                        </span>
                                    </label>
                                </div>

                                {/* Fade */}
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                                        Fade
                                    </div>

                                    <label style={{ display: "block" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!(l.sweep?.fadeEnabled ?? true)}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "fadeEnabled"], e.target.checked)
                                            }
                                        />{" "}
                                        Enable fade
                                    </label>

                                    {!!(l.sweep?.fadeEnabled ?? true) && (
                                        <div style={{ display: "grid", gap: 6, paddingLeft: 10 }}>
                                            <label style={{ display: "block" }}>
                                                Fade amount
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={2}
                                                    step={0.02}
                                                    value={l.sweep?.fade ?? 0.6}
                                                    onChange={(e) =>
                                                        patchNested(l.id, ["sweep", "fade"], Number(e.target.value))
                                                    }
                                                />{" "}
                                                <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                    {(l.sweep?.fade ?? 0.6).toFixed(2)}
                                                </span>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Fade curve{" "}
                                                <select
                                                    value={l.sweep?.fadeCurve ?? "smooth"}
                                                    onChange={(e) =>
                                                        patchNested(l.id, ["sweep", "fadeCurve"], e.target.value)
                                                    }
                                                >
                                                    <option value="smooth">smooth</option>
                                                    <option value="linear">linear</option>
                                                    <option value="exp">exp</option>
                                                    <option value="expo">expo</option>
                                                    <option value="sine">sine</option>
                                                </select>
                                            </label>
                                        </div>
                                    )}
                                </div>

                                {/* Multi-pass */}
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                                        Multi-pass
                                    </div>

                                    <label style={{ display: "block" }}>
                                        Passes
                                        <input
                                            type="range"
                                            min={1}
                                            max={12}
                                            step={1}
                                            value={l.sweep?.passes ?? 1}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "passes"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {Math.round(l.sweep?.passes ?? 1)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Pass delay (s)
                                        <input
                                            type="range"
                                            min={0}
                                            max={2}
                                            step={0.01}
                                            value={l.sweep?.passDelay ?? 0.25}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "passDelay"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.passDelay ?? 0.25).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Pass colors (comma-separated hex)
                                        <input
                                            type="text"
                                            placeholder="#7cf,#f0f,#0f0"
                                            value={
                                                Array.isArray(l.sweep?.colors)
                                                    ? l.sweep.colors.join(",")
                                                    : typeof l.sweep?.colors === "string"
                                                        ? l.sweep.colors
                                                        : ""
                                            }
                                            onChange={(e) => {
                                                const raw = e.target.value || "";
                                                const parts = raw
                                                    .split(",")
                                                    .map((x) => x.trim())
                                                    .filter(Boolean)
                                                    .map((x) => (x.startsWith("#") ? x : `#${x}`));
                                                patchNested(
                                                    l.id,
                                                    ["sweep", "colors"],
                                                    parts.length ? parts : null,
                                                );
                                            }}
                                        />
                                    </label>
                                </div>

                                {/* Pulses */}
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                                        Pulses
                                    </div>

                                    <label style={{ display: "block" }}>
                                        Head size
                                        <input
                                            type="range"
                                            min={0.1}
                                            max={3}
                                            step={0.05}
                                            value={l.sweep?.headSize ?? 1}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "headSize"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.headSize ?? 1).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Head pulse amp
                                        <input
                                            type="range"
                                            min={0}
                                            max={2}
                                            step={0.02}
                                            value={l.sweep?.headPulseAmp ?? 0.2}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "headPulseAmp"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.headPulseAmp ?? 0.2).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Head pulse freq
                                        <input
                                            type="range"
                                            min={0}
                                            max={12}
                                            step={0.1}
                                            value={l.sweep?.headPulseFreq ?? 1.6}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "headPulseFreq"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.headPulseFreq ?? 1.6).toFixed(1)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Body pulse amp
                                        <input
                                            type="range"
                                            min={0}
                                            max={2}
                                            step={0.02}
                                            value={l.sweep?.pulseAmp ?? 0}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "pulseAmp"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.pulseAmp ?? 0).toFixed(2)}
                                        </span>
                                    </label>

                                    <label style={{ display: "block" }}>
                                        Body pulse freq
                                        <input
                                            type="range"
                                            min={0}
                                            max={12}
                                            step={0.1}
                                            value={l.sweep?.pulseFreq ?? 1.5}
                                            onChange={(e) =>
                                                patchNested(l.id, ["sweep", "pulseFreq"], Number(e.target.value))
                                            }
                                        />{" "}
                                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                                            {(l.sweep?.pulseFreq ?? 1.5).toFixed(1)}
                                        </span>
                                    </label>
                                </div>

                                {/* End FX */}
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                                        End FX (at target node)
                                    </div>

                                    <label style={{ display: "block" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!(l.sweep?.endFx?.enabled ?? false)}
                                            onChange={(e) =>
                                                patchNested(
                                                    l.id,
                                                    ["sweep", "endFx", "enabled"],
                                                    e.target.checked,
                                                )
                                            }
                                        />{" "}
                                        Enable end FX
                                    </label>

                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                        {[
                                            ["Wave", "wave"],
                                            ["Ripple", "ripple"],
                                            ["Burst", "burst"],
                                            ["Cone", "cone"],
                                            ["Sparkle", "sparkle"],
                                            ["Spiral", "spiral"],
                                        ].map(([label, type]) => (
                                            <button
                                                key={type}
                                                type="button"
                                                onClick={() =>
                                                    patchNested(l.id, ["sweep", "endFx"], {
                                                        enabled: true,
                                                        type,
                                                        size: 1.0,
                                                        duration: 0.35,
                                                        speed: 1.0,
                                                        color: null,
                                                        angleDeg: 0,
                                                        ease: "smooth",
                                                        softness: 0.4,
                                                    })
                                                }
                                                style={{
                                                    fontSize: 11,
                                                    padding: "4px 10px",
                                                    borderRadius: 999,
                                                    border: "1px solid rgba(148,163,184,0.55)",
                                                    background: "rgba(15,23,42,0.8)",
                                                    color: "#e5e7eb",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>

                                    {!!(l.sweep?.endFx?.enabled ?? false) && (
                                        <div style={{ display: "grid", gap: 6, paddingLeft: 10 }}>
                                            <label style={{ display: "block" }}>
                                                Type{" "}
                                                <select
                                                    value={l.sweep?.endFx?.type ?? "wave"}
                                                    onChange={(e) =>
                                                        patchNested(l.id, ["sweep", "endFx", "type"], e.target.value)
                                                    }
                                                >
                                                    <option value="wave">wave</option>
                                                    <option value="ripple">ripple</option>
                                                    <option value="burst">burst</option>
                                                    <option value="cone">cone</option>
                                                    <option value="sparkle">sparkle</option>
                                                    <option value="spiral">spiral</option>
                                                </select>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Size
                                                <input
                                                    type="range"
                                                    min={0.1}
                                                    max={4}
                                                    step={0.05}
                                                    value={l.sweep?.endFx?.size ?? 1}
                                                    onChange={(e) =>
                                                        patchNested(
                                                            l.id,
                                                            ["sweep", "endFx", "size"],
                                                            Number(e.target.value),
                                                        )
                                                    }
                                                />{" "}
                                                <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                    {(l.sweep?.endFx?.size ?? 1).toFixed(2)}
                                                </span>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Duration (s)
                                                <input
                                                    type="range"
                                                    min={0.05}
                                                    max={3}
                                                    step={0.01}
                                                    value={l.sweep?.endFx?.duration ?? 0.35}
                                                    onChange={(e) =>
                                                        patchNested(
                                                            l.id,
                                                            ["sweep", "endFx", "duration"],
                                                            Number(e.target.value),
                                                        )
                                                    }
                                                />{" "}
                                                <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                    {(l.sweep?.endFx?.duration ?? 0.35).toFixed(2)}
                                                </span>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Speed
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={6}
                                                    step={0.05}
                                                    value={l.sweep?.endFx?.speed ?? 1}
                                                    onChange={(e) =>
                                                        patchNested(
                                                            l.id,
                                                            ["sweep", "endFx", "speed"],
                                                            Number(e.target.value),
                                                        )
                                                    }
                                                />{" "}
                                                <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                    {(l.sweep?.endFx?.speed ?? 1).toFixed(2)}
                                                </span>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Softness
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={1}
                                                    step={0.02}
                                                    value={l.sweep?.endFx?.softness ?? 0.4}
                                                    onChange={(e) =>
                                                        patchNested(
                                                            l.id,
                                                            ["sweep", "endFx", "softness"],
                                                            Number(e.target.value),
                                                        )
                                                    }
                                                />{" "}
                                                <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                    {(l.sweep?.endFx?.softness ?? 0.4).toFixed(2)}
                                                </span>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Angle (deg)
                                                <input
                                                    type="range"
                                                    min={-180}
                                                    max={180}
                                                    step={1}
                                                    value={l.sweep?.endFx?.angleDeg ?? 0}
                                                    onChange={(e) =>
                                                        patchNested(
                                                            l.id,
                                                            ["sweep", "endFx", "angleDeg"],
                                                            Number(e.target.value),
                                                        )
                                                    }
                                                />{" "}
                                                <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                    {Math.round(l.sweep?.endFx?.angleDeg ?? 0)}
                                                </span>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Ease{" "}
                                                <select
                                                    value={l.sweep?.endFx?.ease ?? "smooth"}
                                                    onChange={(e) =>
                                                        patchNested(l.id, ["sweep", "endFx", "ease"], e.target.value)
                                                    }
                                                >
                                                    <option value="smooth">smooth</option>
                                                    <option value="linear">linear</option>
                                                    <option value="exp">exp</option>
                                                    <option value="expo">expo</option>
                                                    <option value="sine">sine</option>
                                                </select>
                                            </label>

                                            <label style={{ display: "block" }}>
                                                Color override{" "}
                                                <input
                                                    type="color"
                                                    value={l.sweep?.endFx?.color ?? "#ffffff"}
                                                    onChange={(e) =>
                                                        patchNested(
                                                            l.id,
                                                            ["sweep", "endFx", "color"],
                                                            e.target.value,
                                                        )
                                                    }
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        patchNested(l.id, ["sweep", "endFx", "color"], null)
                                                    }
                                                    style={{
                                                        marginLeft: 8,
                                                        fontSize: 11,
                                                        padding: "2px 10px",
                                                        borderRadius: 999,
                                                        border: "1px solid rgba(148,163,184,0.55)",
                                                        background: "rgba(15,23,42,0.8)",
                                                        color: "#e5e7eb",
                                                        cursor: "pointer",
                                                    }}
                                                    title="Clear override (use sweep color)"
                                                >
                                                    Clear
                                                </button>
                                            </label>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Cable bundle */}
                    {l.style === "cable" && (
                        <div
                            style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop:
                                    "1px dashed rgba(255,255,255,0.12)",
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 800,
                                    marginBottom: 4,
                                }}
                            >
                                Cable bundle
                            </div>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 4,
                                }}
                            >
                                Count{" "}
                                <input
                                    type="range"
                                    min={1}
                                    max={32}
                                    step={1}
                                    value={l.cable?.count ?? 4}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["cable", "count"],
                                            Number(e.target.value),
                                        )
                                    }
                                />{" "}
                                <span
                                    style={{
                                        fontSize: 11,
                                        opacity: 0.8,
                                    }}
                                >
                                    {l.cable?.count ?? 4} strands
                                </span>
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Spread{" "}
                                <input
                                    type="range"
                                    min={0}
                                    max={0.6}
                                    step={0.005}
                                    value={l.cable?.spread ?? 0.12}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["cable", "spread"],
                                            Number(e.target.value),
                                        )
                                    }
                                />{" "}
                                <span
                                    style={{
                                        fontSize: 11,
                                        opacity: 0.8,
                                    }}
                                >
                                    {(l.cable?.spread ?? 0.12).toFixed(2)} m
                                </span>
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Roughness{" "}
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={l.cable?.roughness ?? 0.25}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["cable", "roughness"],
                                            Number(e.target.value),
                                        )
                                    }
                                />{" "}
                                <span
                                    style={{
                                        fontSize: 11,
                                        opacity: 0.8,
                                    }}
                                >
                                    {(l.cable?.roughness ?? 0.25).toFixed(2)}
                                </span>
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Endpoint anchor{" "}
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={l.cable?.anchor ?? 1}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["cable", "anchor"],
                                            Number(e.target.value),
                                        )
                                    }
                                />{" "}
                                <span
                                    style={{
                                        fontSize: 11,
                                        opacity: 0.8,
                                    }}
                                >
                                    {((l.cable?.anchor ?? 1) * 100).toFixed(0)}
                                    % to core
                                </span>
                            </label>

                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Scramble / waviness{" "}
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={l.cable?.scramble ?? 0}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["cable", "scramble"],
                                            Number(e.target.value),
                                        )
                                    }
                                />{" "}
                                <span
                                    style={{
                                        fontSize: 11,
                                        opacity: 0.8,
                                    }}
                                >
                                    {(l.cable?.scramble ?? 0).toFixed(2)}
                                </span>
                            </label>
                        </div>
                    )}


                    {/* Epic tube */}
                    {l.style === "epic" && (
                        <div
                            style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop:
                                    "1px dashed rgba(255,255,255,0.12)",
                            }}
                        >
                            <div
                                style={{
                                    fontWeight: 800,
                                    marginBottom: 4,
                                }}
                            >
                                Epic Tube
                            </div>
                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Thickness
                                <input
                                    type="range"
                                    min={0.02}
                                    max={0.25}
                                    step={0.005}
                                    value={
                                        l.tube?.thickness ?? 0.06
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["tube", "thickness"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>
                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Glow
                                <input
                                    type="range"
                                    min={0}
                                    max={3}
                                    step={0.05}
                                    value={l.tube?.glow ?? 1.3}
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["tube", "glow"],
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </label>
                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Color
                                <input
                                    type="color"
                                    value={l.tube?.color ?? l.color ?? "#80d8ff"}

                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["tube", "color"],
                                            e.target.value,
                                        )
                                    }
                                />
                            </label>
                            <label
                                style={{
                                    display: "block",
                                    marginTop: 6,
                                }}
                            >
                                Trail
                                <input
                                    type="checkbox"
                                    checked={
                                        (l.tube?.trail ?? true) ===
                                        true
                                    }
                                    onChange={(e) =>
                                        patchNested(
                                            l.id,
                                            ["tube", "trail"],
                                            e.target.checked,
                                        )
                                    }
                                />
                            </label>
                        </div>
                    )}
                </div>
            ))}

            {confirmDlg && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 100000,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(0,0,0,0.55)",
                        backdropFilter: "blur(4px)",
                    }}
                    onMouseDown={(e) => {
                        // click outside to cancel
                        if (e.target === e.currentTarget) confirmDlg.onCancel?.();
                    }}
                >
                    <div
                        style={{
                            width: 420,
                            maxWidth: "92vw",
                            borderRadius: 14,
                            border: "1px solid rgba(148,163,184,0.32)",
                            background: "rgba(2,6,23,0.92)",
                            boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
                            padding: 14,
                            color: "#e5e7eb",
                        }}
                    >
                        <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 6 }}>
                            {confirmDlg.title || "Confirm"}
                        </div>
                        <div style={{ opacity: 0.92, fontSize: 12, marginBottom: 12 }}>
                            {confirmDlg.message || "Are you sure?"}
                        </div>

                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button
                                type="button"
                                onClick={() => confirmDlg.onCancel?.()}
                                style={{
                                    fontSize: 12,
                                    padding: "7px 10px",
                                    borderRadius: 10,
                                    border: "1px solid rgba(148,163,184,0.35)",
                                    background: "rgba(15,23,42,0.85)",
                                    color: "#e5e7eb",
                                    cursor: "pointer",
                                }}
                            >
                                Cancel (Esc)
                            </button>
                            <button
                                ref={confirmYesRef}
                                type="button"
                                onClick={() => confirmDlg.onConfirm?.()}
                                style={{
                                    fontSize: 12,
                                    padding: "7px 10px",
                                    borderRadius: 10,
                                    border: "1px solid rgba(148,163,184,0.65)",
                                    background: "rgba(59,130,246,0.22)",
                                    color: "#e5e7eb",
                                    cursor: "pointer",
                                    fontWeight: 800,
                                }}
                            >
                                Yes (Enter)
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
export function RackHUD({ node }) {
    if (!node) return null;

    const rep = node.represent || {};
    const rack = rep.rackId ? getRackById(rep.rackId) : rep.rack;

    // If this node has no rack info, don't show anything
    if (!rack) return null;

    const unit =
        typeof window !== "undefined"
            ? window.localStorage.getItem("epic3d.productUnits.v1") || "cm"
            : "cm";

    const w = rack.width ?? rack.dims?.w;
    const h = rack.height ?? rack.dims?.h;
    const l = rack.length ?? rack.dims?.l;

    return (
        <div
            style={{
                position: "absolute",
                top: 80,
                right: 16,
                zIndex: 30,
                minWidth: 220,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(15,23,42,0.92)",
                border: "1px solid rgba(148,163,184,0.6)",
                boxShadow: "0 18px 40px rgba(0,0,0,0.7)",
                color: "#e5f3ff",
                fontSize: 12,
                pointerEvents: "none",
            }}
        >
            <div
                style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.12,
                    opacity: 0.75,
                    marginBottom: 2,
                }}
            >
                Rack
            </div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {rack.name || node.label || "Rack"}
            </div>
            {(w || h || l) && (
                <div style={{ opacity: 0.9 }}>
                    W×H×L: {w ?? 0} × {h ?? 0} × {l ?? 0} {unit}
                </div>
            )}
            {rack.weight != null && rack.weight !== 0 && (
                <div style={{ opacity: 0.9 }}>Weight: {rack.weight}</div>
            )}
        </div>
    );
}

export function ProductHUD({ node }) {
    const id = node?.product?.id;
    if (!id) return null;

    const product = getProductById(id);
    if (!product) return null;

    const unit =
        typeof window !== "undefined"
            ? window.localStorage.getItem("epic3d.productUnits.v1") || "cm"
            : "cm";

    const w = product.width ?? product.dims?.w;
    const h = product.height ?? product.dims?.h;
    const l = product.length ?? product.dims?.l;

    const title = [product.category, product.make, product.model, product.name]
        .filter(Boolean)
        .join(" › ");

    return (
        <div
            style={{
                position: "absolute",
                top: 80,
                left: 16,
                zIndex: 30,
                minWidth: 260,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(15,23,42,0.92)",
                border: "1px solid rgba(148,163,184,0.6)",
                boxShadow: "0 18px 40px rgba(0,0,0,0.7)",
                color: "#e5f3ff",
                fontSize: 12,
                pointerEvents: "none",
            }}
        >
            <div
                style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.12,
                    opacity: 0.75,
                    marginBottom: 2,
                }}
            >
                Product
            </div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {title || "Product"}
            </div>
            {(w || h || l) && (
                <div style={{ opacity: 0.9 }}>
                    W×H×L: {w ?? 0} × {h ?? 0} × {l ?? 0} {unit}
                </div>
            )}
        </div>
    );
}

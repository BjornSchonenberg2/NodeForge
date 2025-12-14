import { getRackById, getProductById } from "./data/products/store";

export function OutgoingLinksEditor({
                                        node,
                                        nodes,
                                        links,
                                        setLinks,
                                        selectedBreakpoint,
                                        setSelectedBreakpoint,
                                    }) {
    const outgoing = links
        .filter((l) => l.from === node.id)
        .map((l) => ({
            ...l,
            targetName: nodes.find((n) => n.id === l.to)?.label || l.to,
        }));

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

                                                {["X", "Y", "Z"].map(
                                                    (
                                                        axis,
                                                        axisIndex,
                                                    ) => (
                                                        <label
                                                            key={axis}
                                                            style={{
                                                                fontSize: 11,
                                                            }}
                                                        >
                                                            {axis}
                                                            <input
                                                                type="number"
                                                                step={
                                                                    0.05
                                                                }
                                                                value={
                                                                    bp?.[
                                                                        axisIndex
                                                                        ] ??
                                                                    0
                                                                }
                                                                onChange={(
                                                                    e,
                                                                ) => {
                                                                    const val =
                                                                        Number(
                                                                            e
                                                                                .target
                                                                                .value,
                                                                        ) ||
                                                                        0;
                                                                    const current =
                                                                        Array.isArray(
                                                                            l.breakpoints,
                                                                        )
                                                                            ? l.breakpoints
                                                                            : [];
                                                                    const next =
                                                                        current.map(
                                                                            (
                                                                                b,
                                                                                i,
                                                                            ) =>
                                                                                i ===
                                                                                idx
                                                                                    ? [
                                                                                        axisIndex ===
                                                                                        0
                                                                                            ? val
                                                                                            : b?.[0] ??
                                                                                            0,
                                                                                        axisIndex ===
                                                                                        1
                                                                                            ? val
                                                                                            : b?.[1] ??
                                                                                            0,
                                                                                        axisIndex ===
                                                                                        2
                                                                                            ? val
                                                                                            : b?.[2] ??
                                                                                            0,
                                                                                    ]
                                                                                    : b,
                                                                        );
                                                                    patch(
                                                                        l.id,
                                                                        {
                                                                            breakpoints:
                                                                            next,
                                                                        },
                                                                    );
                                                                }}
                                                                style={{
                                                                    width: "100%",
                                                                    fontSize: 11,
                                                                    padding:
                                                                        "2px 4px",
                                                                    borderRadius: 4,
                                                                    border: "1px solid rgba(148,163,184,0.6)",
                                                                    background:
                                                                        "rgba(15,23,42,0.9)",
                                                                    color: "#e5e7eb",
                                                                }}
                                                            />
                                                        </label>
                                                    ),
                                                )}

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


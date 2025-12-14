// src/ui/RackListView.jsx
import React from "react";

/**
 * Props
 * - rack:      { id?, name, width, height, length, weight, items:[{productId,...}] }
 * - ui:        { infoFontSize, thumbSize, rowGap, compact, showRightSlot, showRackPhotos }
 * - unit:      "cm" | "mm" | "m"
 * - editable:  when true, rows become draggable and show a handle
 * - onReorder: (fromIdx:number, toIdx:number) => void
 * - disableDnD: force-disable drag & drop (safety)
 */
export default function RackListView({
                                         rack,
                                         ui = {},
                                         unit = "cm",
                                         editable = false,
                                         onReorder,
                                         disableDnD = false,
                                     }) {
    // DnD helpers – hooks must be called unconditionally before any early return
    const dragFromRef = React.useRef(null);
    const canDrag = editable && !!onReorder && !disableDnD;

    if (!rack) return null;

    const infoFont = Math.max(10, Math.min(22, Number(ui.infoFontSize ?? 13)));
    const thumbSize = Math.max(40, Math.min(160, Number(ui.thumbSize ?? 72)));
    const showPhotos = ui.showRackPhotos ?? true;
    const rowGap = ui.rowGap ?? 4;
    const compact = ui.compact ?? true;

    const lineStyle = {
        fontSize: Math.round(infoFont * 0.85),
        opacity: 0.9,
        lineHeight: compact ? 1.15 : 1.35,
    };

    const dndStart = (e, i) => {
        if (!canDrag) return;
        dragFromRef.current = i;
        e.dataTransfer.effectAllowed = "move";
        // Needed for Firefox
        e.dataTransfer.setData("text/plain", String(i));
    };

    const dndOver = (e) => {
        if (!canDrag) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
    };

    const dndDrop = (e, to) => {
        if (!canDrag) return;
        e.preventDefault();
        e.stopPropagation();
        const from = Number(e.dataTransfer.getData("text/plain") || dragFromRef.current);
        dragFromRef.current = null;
        if (Number.isInteger(from) && from !== to) {
            onReorder?.(from, to);
        }
    };

    const stopEverything = (e) => {
        // prevent the canvas/global drop handlers from hijacking image/file drops
        e.preventDefault();
        e.stopPropagation();
    };

    return (
        <div
            style={{ display: "grid", gap: 10 }}
            onDragEnter={stopEverything}
            onDragOver={stopEverything}
            onDrop={stopEverything}
        >
            {/* Header */}
            <div style={{ fontWeight: 900, fontSize: infoFont + 1 }}>
                {rack.name || "Rack"}
            </div>
            <div style={{ ...lineStyle }}>
                <strong>W×H×L:</strong>{" "}
                {(rack.width ?? 0)} × {(rack.height ?? 0)} × {(rack.length ?? 0)} {unit}
                {rack.weight ? ` · ${rack.weight} kg` : ""}
            </div>

            {/* Empty state */}
            {(!rack.items || rack.items.length === 0) && (
                <div style={{ opacity: 0.75, fontSize: Math.max(10, infoFont - 2) }}>
                    No products yet.
                </div>
            )}

            {/* Rows */}
            {(rack.items || []).map((it, i) => {
                const p = it?.p || it?.product || it?.__product;
                const id = it?.productId || p?.id;
                if (!(id || p)) return null;

                const name = p?.name || it?.name || "(unknown)";
                const makeModel = [p?.make, p?.model].filter(Boolean).join(" ");
                const dims = [
                    p?.width ?? p?.dims?.w,
                    p?.height ?? p?.dims?.h,
                    p?.length ?? p?.dims?.l,
                ]
                    .filter((v) => v != null)
                    .join(" × ");

                const grid =
                    showPhotos && p?.image
                        ? `${canDrag ? "28px " : ""}${thumbSize}px 1fr auto`
                        : `${canDrag ? "28px " : ""}1fr auto`;

                return (
                    <div
                        key={`${id}-${i}`}
                        draggable={canDrag}
                        onDragStart={(e) => dndStart(e, i)}
                        onDragOver={dndOver}
                        onDrop={(e) => dndDrop(e, i)}
                        style={{
                            display: "grid",
                            gridTemplateColumns: grid,
                            gap: 10,
                            alignItems: "center",
                            padding: 8,
                            borderRadius: 10,
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.10)",
                        }}
                    >
                        {canDrag && (
                            <div
                                title="Drag to reorder"
                                style={{
                                    cursor: "grab",
                                    userSelect: "none",
                                    fontSize: infoFont,
                                    opacity: 0.7,
                                    textAlign: "center",
                                }}
                            >
                                ≡
                            </div>
                        )}

                        {showPhotos && p?.image && (
                            <img
                                src={p.image}
                                alt={name}
                                style={{
                                    width: thumbSize,
                                    height: Math.round(thumbSize * 0.72),
                                    objectFit: "cover",
                                    borderRadius: 8,
                                    pointerEvents: "none",
                                }}
                                draggable={false}
                            />
                        )}

                        <div style={{ display: "grid", gap: rowGap, minWidth: 0 }}>
                            <div
                                style={{
                                    fontWeight: 800,
                                    fontSize: infoFont,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    lineHeight: compact ? 1.1 : 1.25,
                                }}
                                title={name}
                            >
                                {name}
                            </div>
                            {makeModel && (
                                <div
                                    style={{
                                        ...lineStyle,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {makeModel}
                                </div>
                            )}
                            {p?.description && <div style={{ ...lineStyle }}>{p.description}</div>}
                            <div style={{ ...lineStyle }}>
                                {dims && (
                                    <>
                                        Dims: {dims} {unit}
                                    </>
                                )}
                                {p?.weight ? ` · ${p.weight} kg` : ""}
                            </div>
                        </div>

                        {/* Right slot stays for external actions (delete, qty, etc.) */}
                        {ui.showRightSlot !== false && <div />}
                    </div>
                );
            })}
        </div>
    );
}

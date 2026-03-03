import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import RackListView from "./ui/RackListView.jsx";
import {
    listProducts,
    getProductById,
    listRacks,
    getRackById,
    upsertRack,
    deleteRack,
    addProductToRack,
    removeProductFromRack,
    moveRackItem,
} from "./data/products/store";

import { TAU } from "./utils/math.js";
import { Btn, Input, Select, Checkbox } from "./ui/Controls.jsx";

export function ProductSelectInline({ products, onPick, onCancel }) {
    const [q, setQ] = React.useState("");
    const list = React.useMemo(() => {
        const s = q.trim().toLowerCase();
        const src = Array.isArray(products) ? products : [];
        if (!s) return src.slice(0, 60);
        return src.filter(p => {
            const hay = [p.name, p.make, p.model, p.category, p.description]
                .filter(Boolean).join(" ").toLowerCase();
            return hay.includes(s);
        }).slice(0, 60);
    }, [q, products]);

    return (
        <div style={{
            background: "rgba(15,18,26,0.95)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10, padding: 8, width: 420,
            boxShadow: "0 12px 30px rgba(0,0,0,0.5)"
        }}>
            <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Type to search products…"
                style={{
                    width: "100%", padding: "10px 12px",
                    borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.06)", color: "#eaf2ff", outline: "none"
                }}
            />
            <div style={{ maxHeight: 300, overflow: "auto", marginTop: 8, display: "grid", gap: 6 }}>
                {list.map(p => (
                    <div key={p.id}
                         onClick={() => onPick?.(p)}
                         style={{
                             display: "grid",
                             gridTemplateColumns: p.image ? "56px 1fr" : "1fr",
                             gap: 10, alignItems: "center", padding: 8,
                             borderRadius: 8, cursor: "pointer",
                             background: "rgba(255,255,255,0.04)"
                         }}>
                        {p.image && <img src={p.image} alt={p.name}
                                         style={{ width: 56, height: 40, objectFit: "cover", borderRadius: 6 }}/>}
                        <div>
                            <div style={{ fontWeight: 700 }}>{p.name}</div>
                            <div style={{ opacity: 0.8, fontSize: 12 }}>
                                {[p.category, p.make, p.model].filter(Boolean).join(" › ")}
                            </div>
                        </div>
                    </div>
                ))}
                {list.length === 0 && <div style={{ opacity: 0.7, padding: 10 }}>No matches.</div>}
            </div>
            <div style={{ marginTop: 8, textAlign: "right" }}>
                <button onClick={onCancel}
                        style={{
                            padding: "6px 10px", borderRadius: 6,
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            color: "#cfe3ff", cursor: "pointer"
                        }}>
                    Cancel
                </button>
            </div>
        </div>
    );
}


export function RackItemsEditor({ node, setNode }) {
    const allProducts = React.useMemo(() => listProducts(), []);
    const rack = node?.represent?.rack || {};
    const items = rack.items || [];
    const [pickingIndex, setPickingIndex] = React.useState(null);

    const setRack = (fn) => {
        setNode?.(draft => {
            draft.represent ||= {};
            draft.represent.enabled = true;
            draft.represent.kind = "rack";
            draft.represent.rack ||= { name: "Rack", items: [] };
            fn(draft.represent.rack);
        });
    };

    const addEmptyRow = () => {
        setRack(r => {
            r.items ||= [];
            r.items.push({ productId: null });
        });
        setPickingIndex(items.length); // open picker for the new row
    };

    const removeRow = (idx) => {
        setRack(r => {
            r.items.splice(idx, 1);
        });
    };

    const changeRowProduct = (idx) => {
        setPickingIndex(idx);
    };

    const pickProduct = (p) => {
        setRack(r => {
            r.items[pickingIndex] = { productId: p.id };
        });
        setPickingIndex(null);
    };



    return (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 800 }}>Rack Items</div>
                <button
                    onClick={addEmptyRow}
                    title="Add product"
                    style={{
                        width: 28, height: 28, borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.06)",
                        color: "#dff",
                        cursor: "pointer"
                    }}
                >＋</button>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
                {items.length === 0 && (
                    <div style={{ opacity: 0.7 }}>No products yet. Click ＋ to add.</div>
                )}
                {items.map((it, i) => {
                    const p = it.productId ? getProductById(it.productId) : null;
                    const picking = pickingIndex === i;

                    return (
                        <div
                            key={`row-${i}-${it.productId || "empty"}`}
                            style={{
                                background: "rgba(255,255,255,0.06)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: 10,
                                padding: 8,
                                display: "grid",
                                gap: 8
                            }}
                        >
                            {/* When picking: show the inline selector */}
                            {picking ? (
                                <ProductSelectInline
                                    products={allProducts}
                                    onPick={pickProduct}
                                    onCancel={() => setPickingIndex(null)}
                                />
                            ) : (
                                <div style={{ display: "grid", gridTemplateColumns: p?.image ? "76px 1fr auto" : "1fr auto", gap: 10, alignItems: "center" }}>
                                    {p?.image && (
                                        <img
                                            src={p.image}
                                            alt={p?.name || "product"}
                                            style={{ width: 76, height: 56, objectFit: "cover", borderRadius: 8 }}
                                        />
                                    )}
                                    <div>
                                        <div style={{ fontWeight: 800 }}>{p?.name || <i>Choose a product…</i>}</div>
                                        {p && (
                                            <>
                                                <div style={{ opacity: 0.8, fontSize: 12 }}>
                                                    {[p.category, p.make, p.model].filter(Boolean).join(" › ")}
                                                </div>
                                                <div style={{ opacity: 0.9, fontSize: 12, marginTop: 4 }}>
                                                    <strong>W×H×L:</strong>{" "}
                                                    {(p.width ?? p?.dims?.w ?? 0)} × {(p.height ?? p?.dims?.h ?? 0)} × {(p.length ?? p?.dims?.l ?? 0)}{" "}
                                                    {localStorage.getItem("epic3d.productUnits.v1") || "cm"}
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div style={{ display: "flex", gap: 6 }}>
                                        <button
                                            onClick={() => changeRowProduct(i)}
                                            title="Change product"
                                            style={{
                                                padding: "6px 8px",
                                                borderRadius: 8,
                                                border: "1px solid rgba(255,255,255,0.12)",
                                                background: "rgba(255,255,255,0.06)",
                                                color: "#def",
                                                cursor: "pointer"
                                            }}
                                        >
                                            Change
                                        </button>
                                        <button
                                            onClick={() => removeRow(i)}
                                            title="Remove"
                                            style={{
                                                padding: "6px 8px",
                                                borderRadius: 8,
                                                border: "1px solid rgba(255,80,80,0.35)",
                                                background: "rgba(255,80,80,0.12)",
                                                color: "#ffd6d6",
                                                cursor: "pointer"
                                            }}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
/* ============================ Per-node signals (visuals) ============================ */


export function RepresentativePanel({ node, setNodeById }) {
    // Read from node safely (hooks must run regardless of node)
    const rep = node?.represent || {};
    const ui  = rep.ui || {};
    const enabled = !!rep.enabled;
    const kind = rep.kind || "rack";

    // Hooks MUST be unconditional
    const products = React.useMemo(() => listProducts(), []);
    const unit = localStorage.getItem("epic3d.productUnits.v1") || "cm";
    const [rackVersion, setRackVersion] = React.useState(0);

    // Inline or persisted rack, with a safe fallback
    const rack = rep.rackId ? getRackById(rep.rackId) : (rep.rack || { items: [] });

    const rackResolved = React.useMemo(() => {
        const src = rep.rackId ? getRackById(rep.rackId) : rep.rack;
        return src
            ? {
                ...src,
                items: (src.items || []).map((it) => ({
                    ...it,
                    __product: it.productId ? getProductById(it.productId) : null,
                })),
            }
            : { items: [] };
    }, [rep.rackId, rep.rack]);


    const handleReorder = React.useCallback(
        (from, to) => {
            if (rep.rackId) {
                moveRackItem(rep.rackId, from, to);
                setRackVersion((v) => v + 1);
                const refreshed = getRackById(rep.rackId);
                setNodeById(node.id, { represent: { ...rep, rackId: rep.rackId, rack: refreshed } });
            } else {
                const items = Array.from(rep.rack?.items || []);
                const [m] = items.splice(from, 1);
                items.splice(to, 0, m);
                setNodeById(node.id, {
                    represent: {
                        ...rep,
                        ui: { ...(rep.ui || {}) },             // <— keep the existing UI toggles
                        rack: { ...(rep.rack || {}), items },
                    },
                });
            }
        },
        [node.id, rep.rackId, rep.rack?.items, setNodeById]
    );

    const ensureRack = () => {
        const current = rep.rackId ? getRackById(rep.rackId) : rep.rack;
        const clean = upsertRack({
            id: current?.id,
            name: current?.name || "Rack",
            width: current?.width ?? 60,
            height: current?.height ?? 200,
            length: current?.length ?? 80,
            weight: current?.weight ?? 0,
            items: (current?.items || []).map(i => (
                i && i.productId ? { productId: String(i.productId), qty: Math.max(1, Number(i.qty || 1)) } : null
            )).filter(Boolean),
        });
        setNodeById(node.id, { represent: { ...rep, rackId: clean.id, rack: undefined } });
        return clean;
    };

    const setRackField = (key, value) => {
        const r = ensureRack();
        const updated = upsertRack({ ...r, [key]: Number(value) });
        setNodeById(node.id, { represent: { ...rep, rackId: updated.id, rack: undefined } });
    };

    const [adding, setAdding] = React.useState(false);

    const addProduct = (productId) => {
        if (!productId) return;
        const r = ensureRack();
        addProductToRack(r.id, productId, 1);
        const refreshed = getRackById(r.id);
        setNodeById(node.id, { represent: { ...rep, rackId: r.id, rack: refreshed } });
    };

    const removeProduct = (productId) => {
        if (rep.rackId) {
            removeProductFromRack(rep.rackId, productId, Number.MAX_SAFE_INTEGER);
            const refreshed = getRackById(rep.rackId);
            setNodeById(node.id, { represent: { ...rep, rackId: rep.rackId, rack: refreshed } });
        } else {
            const items = (rep.rack?.items || []).filter(i => i.productId !== productId);
            setNodeById(node.id, { represent: { ...rep, rack: { ...(rep.rack || {}), items } } });
        }
    };

    const updateRep = (patch) =>
        setNodeById(node.id, { represent: { ...rep, ...patch } });

    const updateUI = (patch) =>
        setNodeById(node.id, { represent: { ...rep, ui: { ...(ui || {}), ...patch } } });

    return (
        <div className="card">
            <div className="card-title">Representative</div>

            <div style={{ display:"grid", gap:8, gridTemplateColumns:"1fr 1fr" }}>
                <label style={{display:"flex",alignItems:"center",gap:8}}>
                    <input type="checkbox" checked={enabled} onChange={(e)=> updateRep({ enabled: e.target.checked })}/>
                    <span>Enabled</span>
                </label>
                <label>
                    <div style={{fontSize:11, opacity:.8}}>Kind</div>
                    <select value={kind} onChange={(e)=> updateRep({ kind: e.target.value })}>
                        <option value="product">Product</option>
                        <option value="rack">Rack</option>
                    </select>
                </label>
            </div>

            {/* PRODUCT MODE */}
            {enabled && kind === "product" && (
                <div style={{ display:"grid", gap:8, marginTop:8 }}>
                    <label>
                        <div style={{fontSize:11, opacity:.8}}>Select product</div>
                        <select
                            value={rep.productId || ""}
                            onChange={(e)=> updateRep({ productId: e.target.value || undefined })}
                        >
                            <option value="">(none)</option>
                            {(products || []).map(p => (
                                <option key={p.id} value={p.id}>
                                    {[p.category, p.make, p.model, p.name].filter(Boolean).join(" › ")}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div style={{borderTop:"1px dashed rgba(255,255,255,.15)", paddingTop:8}}>
                        <div style={{fontWeight:800, marginBottom:6}}>Display</div>
                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input
                                type="checkbox"
                                checked={(ui.show3DInfo ?? true)}
                                onChange={(e)=> updateUI({ show3DInfo: e.target.checked })}
                            />
                            <span>Show 3D info</span>
                        </label>
                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input
                                type="checkbox"
                                checked={(ui.showDims ?? true)}
                                onChange={(e)=> updateUI({ showDims: e.target.checked })}
                            />
                            <span>Show dimensions</span>
                        </label>
                    </div>
                </div>
            )}

            {/* RACK MODE */}
            {enabled && kind === "rack" && (
                <div style={{ display:"grid", gap:10, marginTop:8 }}>
                    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
                        <label>
                            <div style={{fontSize:11, opacity:.8}}>Rack name</div>
                            <input
                                value={rack?.name || ""}
                                onChange={(e)=> {
                                    const r = ensureRack();
                                    const u = upsertRack({ ...r, name: e.target.value || "Rack" });
                                    setNodeById(node.id, { represent: { ...rep, rackId: u.id, rack: undefined } });
                                }}
                            />
                        </label>
                        <label>
                            <div style={{fontSize:11, opacity:.8}}>Weight (kg)</div>
                            <input type="number" value={rack?.weight ?? 0}
                                   onChange={(e)=> setRackField("weight", e.target.value)} />
                        </label>
                        <label>
                            <div style={{fontSize:11, opacity:.8}}>Width (cm)</div>
                            <input type="number" value={rack?.width ?? 60}
                                   onChange={(e)=> setRackField("width", e.target.value)} />
                        </label>
                        <label>
                            <div style={{fontSize:11, opacity:.8}}>Height (cm)</div>
                            <input type="number" value={rack?.height ?? 200}
                                   onChange={(e)=> setRackField("height", e.target.value)} />
                        </label>
                        <label>
                            <div style={{fontSize:11, opacity:.8}}>Length (cm)</div>
                            <input type="number" value={rack?.length ?? 80}
                                   onChange={(e)=> setRackField("length", e.target.value)} />
                        </label>
                    </div>
                    <div style={{borderTop:"1px dashed rgba(255,255,255,.15)", paddingTop:8, marginTop:8}}>
                        <div style={{fontWeight:900, marginBottom:6}}>Shadows</div>
                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input
                                type="checkbox"
                                checked={(node?.shadows?.cast ?? true)}
                                onChange={(e)=> setNodeById(node.id, n => ({
                                    ...n, shadows: { ...(n.shadows||{}), cast: e.target.checked }
                                }))}
                            />
                            <span>Cast shadow</span>
                        </label>
                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input
                                type="checkbox"
                                checked={(node?.shadows?.receive ?? true)}
                                onChange={(e)=> setNodeById(node.id, n => ({
                                    ...n, shadows: { ...(n.shadows||{}), receive: e.target.checked }
                                }))}
                            />
                            <span>Receive shadow</span>
                        </label>
                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input
                                type="checkbox"
                                checked={(node?.shadows?.light ?? true)}
                                onChange={(e)=> setNodeById(node.id, n => ({
                                    ...n, shadows: { ...(n.shadows||{}), light: e.target.checked }
                                }))}
                            />
                            <span>Light casts shadow</span>
                        </label>
                    </div>

                    {/* Display toggles (used by Node3D for 3D card / dims / photos / sizes) */}
                    <div style={{borderTop:"1px dashed rgba(255,255,255,.15)", paddingTop:8}}>
                        <div style={{fontWeight:800, marginBottom:6}}>Display</div>
                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input type="checkbox" checked={(ui.show3DInfo ?? true)}
                                   onChange={(e)=> updateUI({ show3DInfo: e.target.checked })}/>
                            <span>Show 3D rack info</span>
                        </label>
                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input
                                type="checkbox"
                                checked={(ui.showHud ?? true)}
                                onChange={(e)=> updateUI({ showHud: e.target.checked })}
                            />
                            <span>Show on-screen HUD</span>
                        </label>

                        <label>
                            <div style={{fontSize:11, opacity:.8}}>HUD panel width (px)</div>
                            <input
                                type="number"
                                min={320}
                                max={820}
                                value={ui.panelWidth ?? 420}
                                onChange={(e)=> updateUI({ panelWidth: Number(e.target.value) || 420 })}
                            />
                        </label>

                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input type="checkbox" checked={(ui.useDims ?? true)}
                                   onChange={(e)=> updateUI({ useDims: e.target.checked })}/>
                            <span>Use rack dimensions for node</span>
                        </label>
                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input type="checkbox" checked={(ui.showDims ?? true)}
                                   onChange={(e)=> updateUI({ showDims: e.target.checked })}/>
                            <span>Show dimensions</span>
                        </label>
                        <label style={{display:"flex",alignItems:"center",gap:8}}>
                            <input type="checkbox" checked={(ui.showRackPhotos ?? true)}
                                   onChange={(e)=> updateUI({ showRackPhotos: e.target.checked })}/>
                            <span>Show product photos</span>
                        </label>
                    </div>

                    {/* List view of items */}
                    <div style={{borderTop:"1px dashed rgba(255,255,255,.15)", paddingTop:8}}>
                        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6}}>
                            <strong>Products in rack</strong>
                            <button
                                onClick={()=> setAdding(a => !a)}
                                style={{
                                    border: "1px dashed rgba(255,255,255,0.25)",
                                    background: "transparent",
                                    padding: "6px 10px",
                                    borderRadius: 10, color: "#a8c0ff", cursor: "pointer"
                                }}
                            >
                                + Add product
                            </button>
                        </div>

                        {adding && (
                            <div style={{ marginBottom: 8 }}>
                                <ProductSelectInline
                                    products={products}
                                    onPick={(p) => { addProduct(p.id); setAdding(false); }}
                                    onCancel={() => setAdding(false)}
                                />
                            </div>
                        )}

                        {(!rackResolved?.items || rackResolved.items.length === 0) && (
                            <div style={{ opacity: 0.75, fontSize: 12 }}>No products yet.</div>
                        )}

                        {rackResolved?.items?.length > 0 && (
                            <RackListView
                                key={rackVersion}      // refresh after store reorders
                                rack={rackResolved}    // uses __product for full info
                                unit={unit}
                                ui={{
                                    infoFontSize: ui?.infoFontSize ?? 13,
                                    thumbSize: ui?.thumbSize ?? 72,
                                    rowGap: 6,
                                    compact: true,
                                    showRackPhotos: ui?.showRackPhotos ?? true,
                                }}
                                editable               // <-- shows drag handles here (Inspector only)
                                onReorder={handleReorder}
                                // If your RackListView supports remove buttons, wire it here:
                                // onRemove={(productId) => removeProduct(productId)}
                            />
                        )}
                    </div>

                </div>
            )}
        </div>
    );
}

// --- Product binding block for Inspector (top-level component) ---

